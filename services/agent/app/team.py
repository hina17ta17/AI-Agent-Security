"""The AgentGuard team as an ADK 2.x graph Workflow.

    START -> bannin (code: Model Armor gate) -> shirabe (LLM: analyst, structured verdict)
          -> sentry (code: routing policy)
               DEFEND  -> mamoru (LLM + tools) -> handoff (code) -> tsutae (LLM: report)
               WATCH   -> watch (code)                           -> tsutae
               DISMISS -> dismiss (code)                         -> tsutae

Routing is code, not model output: attacks on the AI itself always go to DEFEND, and
the agent holding the tools only ever sees code-built briefs.
"""

from __future__ import annotations

from google import genai
from google.adk import Event, Workflow
from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini
from google.adk.planners import BuiltInPlanner
from google.genai import types
from pydantic import ValidationError

from . import prompts
from .context import Incident
from .guard import Gatekeeper
from .models import SEVERITY_ORDER, Verdict
from .tools import build_defender_tools, do_watch

AGENT_NAMES = ("shirabe", "mamoru", "tsutae")


def decide_route(verdict: Verdict, ai_targeted_by_guard: bool) -> str:
    """Code-level routing policy (documented in docs/design.md, §7)."""
    if ai_targeted_by_guard or verdict.targets_ai:
        return "DEFEND"
    if verdict.attack_type == "benign" or (verdict.recommended_action == "none" and verdict.confidence < 0.5):
        return "DISMISS"
    if SEVERITY_ORDER[verdict.severity] >= SEVERITY_ORDER["high"] or verdict.recommended_action in ("block", "isolate"):
        return "DEFEND"
    return "WATCH"


def normalize_verdict(raw, ai_targeted_by_guard: bool) -> Verdict:
    """Validate the analyst's output and apply code-level floors."""
    try:
        verdict = Verdict.model_validate(raw)
    except ValidationError:
        # Unparseable output: assume the worst the WAF evidence allows.
        verdict = Verdict(attack_type="other", confidence=0.5, severity="high", targets_ai=ai_targeted_by_guard,
                          recommended_action="block", narration_ja="判定結果を読み取れなかったため、安全側で対処します。",
                          evidence=[])
    updates: dict = {"narration_ja": verdict.narration_ja[:160], "evidence": [x[:100] for x in verdict.evidence[:3]]}
    if ai_targeted_by_guard:
        updates["targets_ai"] = True
    if updates.get("targets_ai", verdict.targets_ai) and SEVERITY_ORDER[verdict.severity] < SEVERITY_ORDER["high"]:
        updates["severity"] = "high"
    return verdict.model_copy(update=updates)


def _planner(include_thoughts: bool) -> BuiltInPlanner:
    return BuiltInPlanner(thinking_config=types.ThinkingConfig(include_thoughts=include_thoughts, thinking_level="LOW"))


def build_team(inc: Incident, client: genai.Client, gatekeeper: Gatekeeper) -> Workflow:
    model = Gemini(model=inc.settings.model, client=client,
                   retry_options=types.HttpRetryOptions(attempts=2, initial_delay=1.0))

    async def bannin(node_input):
        """Gatekeeper: screen the attacker payload before any AI sees it."""
        await inc.step("bannin", "status", "番人（Model Armor）が攻撃文を検査しています…")
        inc.guard = await gatekeeper.screen_payload(inc.event.payload)
        inc.mark("guardAt")
        g = inc.guard
        if not g.screened:
            await inc.step("bannin", "guard", "検査サービスに接続できなかったため、念のため攻撃文はAIに渡しません。",
                           g.as_dict())
        elif g.prompt_injection:
            await inc.step("bannin", "guard",
                           f"AIをだまそうとする文章を検出しました（確信度 {g.pi_confidence}）。攻撃文の本文はAIに渡しません。",
                           g.as_dict())
        elif g.malicious_uri:
            await inc.step("bannin", "guard", "危険なURLを検出しました。攻撃文の本文はAIに渡しません。", g.as_dict())
        else:
            await inc.step("bannin", "guard", "AIへの不正な指示は見つかりませんでした。シラベに渡します。", g.as_dict())
        return Event(output=prompts.analyst_brief(inc))

    shirabe = LlmAgent(
        name="shirabe",
        description="Analyst: classifies the blocked request.",
        model=model,
        instruction=prompts.SHIRABE_INSTRUCTION,
        include_contents="none",
        output_schema=Verdict,
        output_key="verdict",
        planner=_planner(include_thoughts=True),
    )

    async def sentry(node_input):
        """Routing policy in code."""
        ai_targeted = bool(inc.guard and inc.guard.prompt_injection)
        inc.verdict = normalize_verdict(node_input, ai_targeted)
        inc.mark("verdictAt")
        inc.route = decide_route(inc.verdict, ai_targeted)
        label = {"DEFEND": "防御", "WATCH": "監視", "DISMISS": "見送り"}[inc.route]
        reason = "AIを狙った攻撃のため、必ず防御に回します。" if (ai_targeted or inc.verdict.targets_ai) else ""
        await inc.step("system", "route", f"ルールにより「{label}」の手順に進みます。{reason}",
                       {"route": inc.route, "verdict": inc.verdict.model_dump()})
        output = prompts.defender_brief(inc) if inc.route == "DEFEND" else ""
        return Event(route=inc.route, output=output)

    mamoru = LlmAgent(
        name="mamoru",
        description="Defender: decides and executes the response with policy-enforced tools.",
        model=model,
        instruction=prompts.MAMORU_INSTRUCTION,
        include_contents="none",
        tools=build_defender_tools(inc),
        planner=_planner(include_thoughts=True),
    )

    async def handoff(node_input):
        """Mamoru's free text is not forwarded; the reporter gets code-built facts only."""
        return Event(output=prompts.reporter_brief(inc))

    async def watch(node_input):
        await do_watch(inc, "シラベの判定で重大度が低かったため、ブロックせず監視します", "system:policy")
        return Event(output=prompts.reporter_brief(inc))

    async def dismiss(node_input):
        await inc.step("system", "route", "誤検知の可能性が高いため、追加の対処は行いません（このリクエスト自体はWAFが遮断済み）。")
        return Event(output=prompts.reporter_brief(inc))

    tsutae = LlmAgent(
        name="tsutae",
        description="Reporter: writes a plain-Japanese incident report.",
        model=model,
        instruction=prompts.TSUTAE_INSTRUCTION,
        include_contents="none",
        planner=_planner(include_thoughts=False),
    )

    return Workflow(
        name="agentguard_team",
        edges=[
            ("START", bannin, shirabe, sentry),
            (sentry, {"DEFEND": mamoru, "WATCH": watch, "DISMISS": dismiss}),
            (mamoru, handoff, tsutae),
            (watch, tsutae),
            (dismiss, tsutae),
        ],
    )
