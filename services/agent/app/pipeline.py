"""Handles one WAF event end to end: group -> quota -> model access -> AI team -> record.

Fail-safe: if the AI cannot run (quota, invalid key, timeout, model error), a code-based
fallback still blocks the attacker for a short time and writes a template report.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from datetime import datetime, timedelta, timezone

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import errors as genai_errors
from google.genai import types
from opentelemetry import trace

from .concurrency import is_open, wave_block_minutes
from .config import Settings
from .context import Incident
from .guard import Gatekeeper
from .llm import KeyUnavailable, model_access
from .logs import log
from .models import SecurityEvent
from .store import Store
from .team import AGENT_NAMES, build_team
from .telemetry import trace_url
from .tools import do_block, protection_reason

JST = timezone(timedelta(hours=9))
tracer = trace.get_tracer("agentguard.agent")


class Pipeline:
    def __init__(self, settings: Settings, store: Store, gatekeeper: Gatekeeper):
        self.settings = settings
        self.store = store
        self.gatekeeper = gatekeeper
        self._local_ai: Counter[str] = Counter()  # AI slots this instance holds or is reserving, per tenant
        self._opening: dict[str, asyncio.Future] = {}  # in-flight "open the wave" call, per tenant

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
        decision, open_incident = await self._admit(event, incident_id)
        if decision == "grouped":
            if open_incident:
                await store.add_related_event(t, open_incident)
            return "grouped"
        if decision == "full":
            # Every AI slot of this tenant is busy: many attacks at once. Handle it as an attack wave.
            return await self._wave(event, tenant)

        inc = Incident(settings=s, store=store, event=event, incident_id=incident_id,
                       allowlist=list((tenant.get("settings") or {}).get("allowlist") or []))
        inc.timings["pushReceivedAt"] = push_received_at
        inc.mark("aiStartedAt")
        try:  # from here on an AI slot is reserved: it is released in `finally`, even after a crash
            inc.previous_incidents = int((await store.ip_history(t, event.src_ip)).get("incidents", 0))
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
            return await self._respond(inc, tenant)
        except Exception:
            await self._recover(inc)
            raise
        finally:
            # Never leave the dashboard stuck in "responding" (e.g. storage failing mid-incident).
            await self._release(inc)

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
        await self._share_with_wave(inc)
        await store.audit(t, "system", "incident_closed", {"incidentId": incident_id},
                          {"status": status, "actions": len(inc.actions)}, incident_id)
        log("NOTICE", "incident closed", incidentId=incident_id, tenantId=t, status=status, mode=inc.mode,
            route=inc.route, inputTokens=inc.usage.input_tokens, outputTokens=inc.usage.output_tokens,
            aiActionSec=round((action_at - event.received_at).total_seconds(), 2) if action_at else None)
        return status

    # ------------------------------------------------------------------ attack waves

    async def _admit(self, event: SecurityEvent, incident_id: str) -> tuple[str, str | None]:
        """Group with an open incident, reserve an AI slot, or report that every slot is busy.

        A burst lands on one instance (concurrency 40). When this instance alone already holds or is
        reserving every AI slot of the tenant, the answer is "full" without a transaction, so an
        attack wave never queues on the tenant document. Otherwise Firestore decides atomically.
        """
        s, store, t = self.settings, self.store, event.tenant_id
        if self._local_ai[t] >= s.max_concurrent_ai:
            open_incident = await store.find_open_group(t, event.src_ip, event.attack_type)
            return ("grouped", open_incident) if open_incident else ("full", None)
        self._local_ai[t] += 1
        try:
            decision = await store.admit(t, event.src_ip, event.attack_type, incident_id,
                                         cap=s.max_concurrent_ai, stale_sec=s.active_stale_sec,
                                         window_sec=s.dedupe_window_sec)
        except Exception as exc:
            # No consistent answer (e.g. extreme contention): block by rule rather than risk unbounded AI runs.
            log("WARNING", "admission failed; handling the event as part of an attack wave",
                tenantId=t, eventId=event.event_id, error=repr(exc)[:300])
            decision = ("full", None)
        if decision[0] != "admitted":
            self._release_local(t)
        return decision

    def _release_local(self, t: str) -> None:
        self._local_ai[t] -= 1
        if self._local_ai[t] <= 0:
            del self._local_ai[t]

    async def _open_wave(self, t: str) -> str:
        """Concurrent wave events on this instance share one open-or-create call per tenant."""
        task = self._opening.get(t)
        if task is None:
            task = asyncio.ensure_future(
                self.store.open_campaign(t, self.settings.wave_idle_sec, self.settings.active_stale_sec))
            self._opening[t] = task
            task.add_done_callback(lambda _: self._opening.pop(t, None))
        return await asyncio.shield(task)

    async def _wave(self, event: SecurityEvent, tenant: dict) -> str:
        """Every AI slot is busy: block at once by rule (no AI call), then count the event in the wave."""
        s, store, t = self.settings, self.store, event.tenant_id
        # The block comes first: opening or counting the wave must never delay it.
        known = tenant.get("campaignId")
        wave = await store.get_campaign(t, known) if known else None
        if wave and not is_open(wave.get("lastEventAt"), datetime.now(timezone.utc), s.wave_idle_sec):
            wave = None
        minutes, source = wave_block_minutes(event.attack_type, (wave or {}).get("aiDecisions"))
        # The same guard rails as Mamoru's tool: never block an allowlisted or internal address.
        probe = Incident(settings=s, store=store, event=event, incident_id=known or "wave",
                         allowlist=list((tenant.get("settings") or {}).get("allowlist") or []))
        why = protection_reason(probe)
        if not why:
            reason = (f"（攻撃の波）AIの判断に合わせて{minutes}分ブロック" if source == "ai"
                      else "（攻撃の波）同時に多数の攻撃が来たため、AIの解析を待たずにルールで即ブロック")
            until = await store.block_ip(t, event.src_ip, minutes, reason, known if wave else None, "system:wave")
            block_sec = round((datetime.now(timezone.utc) - event.received_at).total_seconds(), 2)
            log("NOTICE", "wave event blocked by rule", tenantId=t, ip=event.src_ip, attackType=event.attack_type,
                minutes=minutes, source=source, blockSec=block_sec)
        cid = known if wave else None
        try:  # the block is in place; the rest is bookkeeping for the dashboard
            cid = cid or await self._open_wave(t)
            if why:
                await store.record_wave_event(t, cid, event.src_ip, event.attack_type, None, "refused")
                await store.audit(t, "system:wave", "block_ip", {"ip": event.src_ip},
                                  {"status": "refused", "why": why, "campaignId": cid}, None)
                return "wave-refused"
            await store.record_wave_event(t, cid, event.src_ip, event.attack_type, minutes, source, block_sec)
            if source == "policy":
                # An AI decision may have landed while we were blocking by policy: apply it now.
                decision = (((await store.get_campaign(t, cid)) or {}).get("aiDecisions") or {}).get(event.attack_type) or {}
                later, later_source = wave_block_minutes(event.attack_type, {event.attack_type: decision})
                if later_source == "ai" and later > minutes:
                    await store.extend_wave_block(t, cid, event.src_ip, later, decision.get("incidentId") or cid)
                    minutes, source = later, "ai"
            await store.bump_ip_history(t, event.src_ip, cid)
            await store.audit(t, "system:wave", "block_ip", {"ip": event.src_ip, "minutes": minutes, "source": source},
                              {"status": "blocked", "until": until.isoformat(), "campaignId": cid}, None)
        except Exception as exc:
            log("WARNING", "could not record the wave event", campaignId=cid, error=repr(exc)[:300])
        return "wave-refused" if why else "wave"

    async def _share_with_wave(self, inc: Incident) -> None:
        """If an attack wave is open, the AI's decision guides it and tightens shorter rule blocks."""
        s, store, t = self.settings, self.store, inc.tenant_id
        try:
            cid = (await store.get_tenant(t) or {}).get("campaignId")
            wave = await store.get_campaign(t, cid) if cid else None
            if not wave or not is_open(wave.get("lastEventAt"), datetime.now(timezone.utc), s.wave_idle_sec):
                return
            block = next((a for a in inc.actions if a["type"] == "block_ip"), None)
            if not block or not inc.verdict:
                return
            minutes = int(block["minutes"])
            extended = await store.record_campaign_decision(t, cid, inc.event.attack_type, minutes,
                                                            inc.verdict.severity, inc.incident_id)
            await store.update_incident(t, inc.incident_id, {"campaignId": cid})
            if extended:
                await inc.step("system", "wave",
                               f"攻撃の波：ルールでブロックしていた同じ種類の攻撃 {len(extended)} 件を、"
                               f"AIの判断（{minutes}分）に合わせて延長しました。")
        except Exception as exc:  # sharing is an improvement, never a reason to fail the incident
            log("WARNING", "could not share the decision with the wave", incidentId=inc.incident_id,
                error=repr(exc)[:300])

    async def _release(self, inc: Incident) -> None:
        """Free the AI slot; the tenant returns to 'safe' once nothing else is running or pending."""
        try:
            for attempt in range(1, 4):
                try:
                    await self.store.finish_ai(inc.tenant_id, inc.incident_id, self.settings.active_stale_sec)
                    return
                except Exception as exc:  # after ACTIVE_STALE_SEC the slot is ignored anyway
                    log("ERROR" if attempt == 3 else "WARNING", "could not release the AI slot",
                        incidentId=inc.incident_id, attempt=attempt, error=repr(exc)[:300])
                    if attempt < 3:
                        await asyncio.sleep(0.5 * attempt)
        finally:
            self._release_local(inc.tenant_id)

    async def _recover(self, inc: Incident) -> None:
        """Best effort after an unexpected crash: keep the attacker out and mark the incident."""
        store, t = self.store, inc.tenant_id
        steps = []
        if not inc.actions:
            steps.append(("fallback block", lambda: do_block(
                inc, self.settings.fallback_block_minutes,
                "（自動）処理中にエラーが起きたため、WAFのルールに基づいて一時的にブロック", "system:fallback")))
        steps.append(("mark incident", lambda: store.update_incident(
            t, inc.incident_id, {"status": "fallback", "failure": "internal_error"})))
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
        # Operator-set override (e.g. the shared judge account). Clients cannot write tenant docs.
        override = (tenant.get("quotaOverride") or {}).get("byok" if wants_byok else "demo")
        has_override = isinstance(override, int) and 0 < override <= 10000

        if wants_byok:
            # The owner sets the cap on their own key: an integer, or None for no limit.
            raw = tenant.get("byokDailyLimit", s.byok_daily_limit_per_tenant) if "byokDailyLimit" in tenant \
                else s.byok_daily_limit_per_tenant
            daily_limit = override if has_override else (raw if (raw is None or (isinstance(raw, int) and raw > 0))
                                                         else s.byok_daily_limit_per_tenant)
            total_limit, global_limit = None, None
        else:
            # Demo: at most N per day and M ever per account; operator demo accounts are exempt.
            daily_limit = override if has_override else s.demo_daily_limit_per_tenant
            total_limit = None if has_override else s.demo_total_limit_per_tenant
            global_limit = s.demo_daily_limit_global

        q = await store.consume_quota(t, "byok" if wants_byok else "demo",
                                      daily_limit=daily_limit, total_limit=total_limit, global_limit=global_limit)
        if not q["allowed"]:
            msg = {
                "daily": f"本日のAI解析の上限（{q['daily_limit']}回）に達しました。",
                "total": f"デモモードは1アカウント累計{q['total_limit']}回までです。ご自分の Gemini APIキーを登録すると、続けて使えます。",
                "global": "本日のデモ全体の上限に達しました。しばらくしてからお試しください。",
            }.get(q["reason"], "AI解析の上限に達しました。")
            await inc.step("system", "warning", msg + "今回はルールに基づいて対処します。")
            return None, "quota_exceeded"
        used, limit = q["daily_used"], daily_limit

        try:
            access = await model_access(s, t, tenant, await store.get_secret(t) if wants_byok else None)
        except KeyUnavailable:
            await inc.step("system", "warning", "登録されたAPIキーを使えませんでした。設定画面でキーを確認してください。")
            return None, "key_unavailable"
        inc.mode = access.mode
        mode_ja = "あなたのAPIキー" if access.mode == "byok" else "デモモード"
        count_ja = f"本日 {used}/{limit} 回目" if limit is not None else f"本日 {used} 回目（制限なし）"
        await inc.step("system", "status", f"AIチーム出動！（{mode_ja}・{count_ja}）")

        report_parts: list[str] = []
        runner = Runner(app_name="agentguard", agent=build_team(inc, access.client, self.gatekeeper),
                        session_service=InMemorySessionService(), auto_create_session=True)
        message = types.Content(role="user", parts=[types.Part(text=f"incident {inc.incident_id}")])
        failure: str | None = None
        events = 0
        try:
            async with asyncio.timeout(s.run_timeout_sec):
                async for ev in runner.run_async(user_id=t, session_id=inc.incident_id, new_message=message):
                    events += 1
                    if events > s.max_run_events:
                        # A healthy run is far under this; reaching it means the team is looping.
                        # Stop now (the attacker is already blocked at the WAF, and the defender's
                        # tool budget caps real actions) rather than burn tokens until the timeout.
                        log("ERROR", "AI run exceeded the event cap; stopping to avoid a loop",
                            incidentId=inc.incident_id, events=events, cap=s.max_run_events)
                        failure = "loop_guard"
                        break
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

        why = {"timeout": "AIの応答が時間内に返ってこなかった", "model_busy": "AIが混み合っていて応答できなかった",
               "loop_guard": "AIの処理が同じ手順を繰り返したため、安全のため途中で停止した"}.get(
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
            "loop_guard": "AIの処理が同じ手順を繰り返し、安全のため停止したため",
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
