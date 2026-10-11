"""Handles one WAF event end to end: group -> quota -> model access -> AI team -> record.

Fail-safe: if the AI cannot run (quota, invalid key, timeout, model error), a code-based
fallback still blocks the attacker for a short time and writes a template report.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import errors as genai_errors
from google.genai import types
from opentelemetry import trace

from .config import Settings
from .context import Incident
from .guard import Gatekeeper
from .llm import KeyUnavailable, model_access
from .logs import log
from .models import SecurityEvent
from .store import Store
from .team import AGENT_NAMES, build_team
from .telemetry import trace_url
from .tools import do_block

JST = timezone(timedelta(hours=9))
tracer = trace.get_tracer("agentguard.agent")


class Pipeline:
    def __init__(self, settings: Settings, store: Store, gatekeeper: Gatekeeper):
        self.settings = settings
        self.store = store
        self.gatekeeper = gatekeeper

    async def handle(self, event: SecurityEvent) -> str:
        s, store, t = self.settings, self.store, event.tenant_id
        push_received_at = datetime.now(timezone.utc)
        if not await store.claim_event(t, event.event_id):
            return "duplicate-delivery"
        tenant = await store.get_tenant(t)
        if tenant is None:
            log("WARNING", "event for unknown tenant", tenantId=t, eventId=event.event_id)
            return "unknown-tenant"

        incident_id = f"{event.received_at.astimezone(JST):%Y%m%d-%H%M%S}-{event.event_id[:6]}"
        open_incident = await store.group_or_open(t, event.src_ip, event.attack_type, incident_id,
                                                  s.dedupe_window_sec)
        if open_incident:
            await store.add_related_event(t, open_incident)
            return "grouped"

        history = await store.ip_history(t, event.src_ip)
        inc = Incident(settings=s, store=store, event=event, incident_id=incident_id,
                       allowlist=list((tenant.get("settings") or {}).get("allowlist") or []),
                       previous_incidents=int(history.get("incidents", 0)))
        inc.timings["pushReceivedAt"] = push_received_at
        inc.mark("aiStartedAt")
        await store.create_incident(t, incident_id, {
            "status": "analyzing",
            "eventId": event.event_id,
            "relatedEvents": 1,
            "attack": {
                "ruleId": event.rule_id, "type": event.attack_type, "labelJa": event.rule_label_ja,
                "method": event.method, "path": event.path[:300], "field": event.field,
                "srcIp": event.src_ip, "simulated": event.simulated, "payloadPreview": event.payload[:300],
            },
            "timings": {"receivedAt": event.received_at, "wafRuleMs": event.waf_rule_ms},
        })
        await store.set_tenant_status(t, "responding", incident_id)
        try:
            return await self._respond(inc, tenant)
        except Exception:
            # Never leave the dashboard stuck in "responding" (e.g. storage failing mid-incident).
            await self._recover(inc)
            raise

    async def _respond(self, inc: Incident, tenant: dict) -> str:
        s, store, event = self.settings, self.store, inc.event
        t, incident_id = inc.tenant_id, inc.incident_id
        await store.bump_ip_history(t, event.src_ip, incident_id)
        await inc.step("mihari", "detect",
                       f"ミハリ：{event.rule_label_ja} を {event.waf_rule_ms:.2f}ms で遮断しました。AIチームに出動を依頼します。",
                       {"ruleId": event.rule_id, "field": event.field})

        with tracer.start_as_current_span("agentguard.incident", attributes={
            "agentguard.incident_id": incident_id, "agentguard.attack_type": event.attack_type,
            "agentguard.rule_id": event.rule_id,
        }) as span:
            ctx = span.get_span_context()
            trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else None  # None when tracing is off
            report, failure = await self._run_ai(inc, tenant)

        if failure:
            report = await self._fallback(inc, failure)
        elif report and not await self.gatekeeper.screen_report(report):
            report = "### 報告書について\n報告書に表示できない内容が含まれていたため、自動で非表示にしました。対応内容はタイムラインをご確認ください。"

        resolved_at = inc.mark("resolvedAt")
        defended_by_ai = failure in (None, "report_unavailable")
        status = "awaiting_approval" if inc.approvals else ("resolved" if defended_by_ai else "fallback")
        timings = {k: v for k, v in inc.timings.items()}
        action_at = inc.timings.get("actionAt")
        await store.update_incident(t, incident_id, {
            "status": status,
            "mode": inc.mode,
            "route": inc.route,
            "guard": inc.guard.as_dict() if inc.guard else None,
            "verdict": inc.verdict.model_dump() if inc.verdict else None,
            "actions": inc.actions,
            "approvals": [{"id": a["id"], "action": a["action"], "minutes": a["minutes"]} for a in inc.approvals],
            "report": {"markdown": report or ""},
            "failure": failure,
            "usage": {"inputTokens": inc.usage.input_tokens, "outputTokens": inc.usage.output_tokens,
                      "byModel": inc.usage.by_model},
            "estCostUsd": inc.usage.cost_usd(),
            "traceId": trace_id,
            "traceUrl": trace_url(s.project_id, trace_id),
            "timings": {
                **timings,
                "receivedAt": event.received_at,
                "wafRuleMs": event.waf_rule_ms,
                "aiActionSec": round((action_at - event.received_at).total_seconds(), 2) if action_at else None,
                "totalSec": round((resolved_at - event.received_at).total_seconds(), 2),
            },
        })
        await store.set_tenant_status(t, "awaiting_approval" if inc.approvals else "safe", incident_id)
        await store.audit(t, "system", "incident_closed", {"incidentId": incident_id},
                          {"status": status, "actions": len(inc.actions)}, incident_id)
        log("NOTICE", "incident closed", incidentId=incident_id, tenantId=t, status=status, mode=inc.mode,
            route=inc.route, inputTokens=inc.usage.input_tokens, outputTokens=inc.usage.output_tokens,
            aiActionSec=round((action_at - event.received_at).total_seconds(), 2) if action_at else None)
        return status

    async def _recover(self, inc: Incident) -> None:
        """Best effort after an unexpected crash: keep the attacker out and reset the tenant status."""
        store, t = self.store, inc.tenant_id
        steps = []
        if not inc.actions:
            steps.append(("fallback block", lambda: do_block(
                inc, self.settings.fallback_block_minutes,
                "（自動）処理中にエラーが起きたため、WAFのルールに基づいて一時的にブロック", "system:fallback")))
        steps.append(("mark incident", lambda: store.update_incident(
            t, inc.incident_id, {"status": "fallback", "failure": "internal_error"})))
        steps.append(("reset tenant status", lambda: store.set_tenant_status(
            t, "awaiting_approval" if inc.approvals else "safe", inc.incident_id)))
        for name, run in steps:
            try:
                await run()
            except Exception as exc:
                log("ERROR", "recovery step failed", incidentId=inc.incident_id, step=name, error=repr(exc)[:300])

    # ------------------------------------------------------------------ AI team

    async def _run_ai(self, inc: Incident, tenant: dict) -> tuple[str | None, str | None]:
        """Returns (report_markdown, failure_reason)."""
        s, store, t = self.settings, self.store, inc.tenant_id
        wants_byok = tenant.get("aiMode") == "byok"
        limit = s.byok_daily_limit_per_tenant if wants_byok else s.demo_daily_limit_per_tenant
        # Operator-set override (e.g. the shared judge account). Clients cannot write tenant docs.
        override = (tenant.get("quotaOverride") or {}).get("byok" if wants_byok else "demo")
        if isinstance(override, int) and 0 < override <= 500:
            limit = override
        allowed, used, _ = await store.consume_quota(t, "byok" if wants_byok else "demo", limit,
                                                     None if wants_byok else s.demo_daily_limit_global)
        if not allowed:
            await inc.step("system", "warning", f"本日のAI解析の上限（{limit}回）に達しました。ルールに基づいて対処します。")
            return None, "quota_exceeded"

        try:
            access = await model_access(s, t, tenant, await store.get_secret(t) if wants_byok else None)
        except KeyUnavailable:
            await inc.step("system", "warning", "登録されたAPIキーを使えませんでした。設定画面でキーを確認してください。")
            return None, "key_unavailable"
        inc.mode = access.mode
        mode_ja = "あなたのAPIキー" if access.mode == "byok" else "デモモード"
        await inc.step("system", "status", f"AIチーム出動！（{mode_ja}・本日 {used}/{limit} 回目）")

        report_parts: list[str] = []
        runner = Runner(app_name="agentguard", agent=build_team(inc, access.client, self.gatekeeper),
                        session_service=InMemorySessionService(), auto_create_session=True)
        message = types.Content(role="user", parts=[types.Part(text=f"incident {inc.incident_id}")])
        failure: str | None = None
        try:
            async with asyncio.timeout(s.run_timeout_sec):
                async for ev in runner.run_async(user_id=t, session_id=inc.incident_id, new_message=message):
                    await self._record_event(inc, ev, report_parts)
        except TimeoutError:
            failure = "timeout"
        except genai_errors.ClientError as exc:
            if access.mode == "byok" and exc.code in (400, 401, 403):
                await store.mark_key_invalid(t)
                await inc.step("system", "error", "APIキーが無効になっています。設定画面でキーを更新してください。")
                return None, "key_rejected"
            log("ERROR", "model client error", incidentId=inc.incident_id, code=exc.code, error=str(exc)[:300])
            failure = "model_busy" if exc.code == 429 else "model_error"
        except Exception as exc:  # never leave an incident half-handled
            log("ERROR", "AI team failed", incidentId=inc.incident_id, error=repr(exc)[:500])
            failure = "agent_error"

        if failure is None:
            inc.mark("reportAt")
            await inc.step("tsutae", "message", "報告書をまとめました。「ツタエの報告書」をご覧ください。")
            return "".join(report_parts).strip(), None

        if self._defense_done(inc):
            # The defense already happened; only the report is missing. Retry it with the fast model.
            await inc.step("system", "warning", "防御は完了しています。報告書の作成で混雑エラーが起きたため、別のモデルで作り直します。")
            report = await self._report_with_fast_model(inc, access)
            inc.mark("reportAt")
            if report:
                await inc.step("tsutae", "message", "報告書をまとめました。「ツタエの報告書」をご覧ください。")
                return report, None
            return None, "report_unavailable"

        why = {"timeout": "AIの応答が時間内に返ってこなかった", "model_busy": "AIが混み合っていて応答できなかった"}.get(
            failure, "AIの処理中にエラーが起きた")
        await inc.step("system", "error", f"{why}ため、ルールに基づいて対処します。")
        return None, failure

    @staticmethod
    def _defense_done(inc: Incident) -> bool:
        if inc.verdict is None or inc.route is None:
            return False
        if inc.route == "DEFEND":
            return any(a["type"] == "block_ip" for a in inc.actions)
        return True  # WATCH / DISMISS are completed by code before the reporter runs

    async def _report_with_fast_model(self, inc: Incident, access) -> str | None:
        from .prompts import TSUTAE_INSTRUCTION, reporter_brief

        try:
            resp = await asyncio.wait_for(access.client.aio.models.generate_content(
                model=self.settings.model_analyst, contents=reporter_brief(inc),
                config=types.GenerateContentConfig(system_instruction=TSUTAE_INSTRUCTION),
            ), timeout=30)
            inc.usage.add(resp.usage_metadata, self.settings.model_analyst)
            return (resp.text or "").strip() or None
        except Exception as exc:
            log("WARNING", "report retry failed", incidentId=inc.incident_id, error=repr(exc)[:300])
            return None

    async def _record_event(self, inc: Incident, ev, report_parts: list[str]) -> None:
        inc.usage.add(ev.usage_metadata, ev.model_version)
        if ev.author not in AGENT_NAMES or not ev.content or not ev.content.parts:
            return
        for part in ev.content.parts:
            if part.thought and part.text:
                await inc.step(ev.author, "thought", part.text.strip()[:1500])
            elif part.function_call:
                args = dict(part.function_call.args or {})
                await inc.step(ev.author, "tool_call",
                               f"{part.function_call.name}({json.dumps(args, ensure_ascii=False)})",
                               {"tool": part.function_call.name, "args": args})
            elif part.function_response:
                continue  # the tools already wrote their own result steps
            elif part.text:
                if ev.author == "shirabe":
                    await self._record_verdict_text(inc, part.text)
                elif ev.author == "tsutae":
                    report_parts.append(part.text)
                else:
                    await inc.step(ev.author, "message", part.text.strip()[:500])

    async def _record_verdict_text(self, inc: Incident, text: str) -> None:
        try:
            data = json.loads(text)
        except ValueError:
            data = {}
        narration = str(data.get("narration_ja") or "判定を出しました。")[:200]
        await inc.step("shirabe", "verdict", narration, {"verdict": data})

    # ------------------------------------------------------------------ fail-safe

    async def _fallback(self, inc: Incident, failure: str) -> str:
        if failure == "report_unavailable":
            return self._template_report(inc)
        reason = {
            "quota_exceeded": "本日のAI解析の上限に達したため",
            "key_unavailable": "APIキーを使えなかったため",
            "key_rejected": "APIキーが無効だったため",
            "timeout": "AIの応答が遅れたため",
            "model_busy": "AIが混み合っていたため",
        }.get(failure, "AIの処理でエラーが起きたため")
        if not inc.actions:
            await do_block(inc, self.settings.fallback_block_minutes,
                           f"（自動）{reason}、WAFのルールに基づいて一時的にブロック", "system:fallback")
        block = next((a for a in inc.actions if a["type"] == "block_ip"), None)
        action_text = f"{block['ip']} を {block['minutes']}分ブロックしました" if block else "追加の対処はできませんでした"
        return (
            "### 何が起きたか\n"
            f"{inc.event.rule_label_ja} の疑いがあるアクセスを、ミハリ（WAF）が遮断しました。\n\n"
            "### AIチームの対応\n"
            f"{reason}、AIによる詳しい解析は行わず、決められたルールに従って {action_text}。\n\n"
            "### あなたへのおすすめ\n"
            + ("設定画面で Gemini の APIキーを確認してください。" if failure.startswith("key") else
               "しばらくしてから、もう一度ダッシュボードで状況を確認してください。")
        )

    @staticmethod
    def _template_report(inc: Incident) -> str:
        """Fact-only report used when the AI defended successfully but no model could write the report."""
        from .prompts import actor_ja

        actions = "、".join(
            f"{a['ip']} を {a['minutes']}分ブロック（{actor_ja(a['by'])}）" if a["type"] == "block_ip"
            else f"{a['ip']} を監視リストに追加（{actor_ja(a['by'])}）"
            for a in inc.actions
        ) or "追加の対処はありません"
        pending = "サイトの一時停止の承認をお願いします（ダッシュボードの承認ボタン）。" if inc.approvals else \
            "現在、あなたが対応する必要のある作業はありません。"
        return (
            "### 何が起きたか\n"
            f"{inc.event.rule_label_ja} の疑いがあるアクセスを、ミハリ（WAF）が遮断しました。\n\n"
            "### AIチームの対応\n"
            f"シラベが解析し、マモルが対処しました：{actions}。（報告書は混雑のため簡易版です）\n\n"
            "### あなたへのおすすめ\n"
            f"{pending}"
        )
