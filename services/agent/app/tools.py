"""Mamoru's tools. Every safety rule is enforced here in code, not left to the model.

Policy (the model cannot change any of this):
- The IP to act on is the incident's attacker IP from the WAF event. The model never chooses it.
- Defenses only get stricter: there is no unblock / loosen tool. Only humans can relax things.
- Allowlisted and internal network addresses are never blocked.
- Block length is clamped (5 min .. MAX_BLOCK_MINUTES); AI-targeted attacks get at least 4 hours.
- Site isolation (maintenance mode) is only *requested*; a human must approve it on the dashboard,
  and it can only be requested for critical incidents.
- At most MAX_TOOL_CALLS tool calls per incident.
"""

from __future__ import annotations

import ipaddress
import re
import uuid
from datetime import timedelta, timezone

from .context import Incident

MAX_TOOL_CALLS = 4
MIN_BLOCK_MINUTES = 5
AI_TARGETED_MIN_BLOCK_MINUTES = 240
ISOLATION_MIN_MINUTES, ISOLATION_MAX_MINUTES = 10, 120
JST = timezone(timedelta(hours=9))

_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_DOC_NETS = tuple(ipaddress.ip_network(n) for n in ("192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"))


def _step_agent(actor: str) -> str:
    """Live-feed author for an actor: the defender agent, or the system for code-based rules."""
    return "mamoru" if actor == "agent:mamoru" else "system"


def clean_text(text: str, limit: int) -> str:
    text = _CTRL.sub(" ", str(text or "")).strip()
    return text[:limit]


def protection_reason(inc: Incident) -> str | None:
    """Why the attacker IP must not be blocked, or None if blocking is allowed."""
    ip = inc.event.src_ip
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return "IPアドレスの形式が正しくありません"
    for cidr in inc.allowlist:
        try:
            if addr in ipaddress.ip_network(cidr, strict=False):
                return "許可リストに登録されたIPアドレスです"
        except ValueError:
            continue
    is_demo_address = inc.event.simulated and any(addr in net for net in _DOC_NETS)
    if not is_demo_address and (addr.is_private or addr.is_loopback or addr.is_link_local
                                or addr.is_multicast or addr.is_unspecified or addr.is_reserved):
        return "社内・内部ネットワークのIPアドレスはブロックしません"
    return None


def _ai_targeted(inc: Incident) -> bool:
    return bool((inc.guard and inc.guard.prompt_injection) or (inc.verdict and inc.verdict.targets_ai))


def _budget_exceeded(inc: Incident) -> dict | None:
    inc.tool_calls += 1
    if inc.tool_calls > MAX_TOOL_CALLS:
        return {"status": "refused", "why": "このインシデントで使える操作の回数を超えました"}
    return None


async def do_block(inc: Incident, minutes: int, reason_ja: str, actor: str) -> dict:
    ip = inc.event.src_ip
    reason = clean_text(reason_ja, 120) or "攻撃を検知したため"
    if why := protection_reason(inc):
        await inc.step(_step_agent(actor), "refused", f"{ip} はブロックしませんでした（{why}）")
        await inc.store.audit(inc.tenant_id, actor, "block_ip", {"ip": ip, "minutes": minutes},
                              {"status": "refused", "why": why}, inc.incident_id)
        return {"status": "refused", "why": why}

    requested = int(minutes)
    applied = max(MIN_BLOCK_MINUTES, min(requested, inc.settings.max_block_minutes))
    if _ai_targeted(inc):
        applied = max(applied, AI_TARGETED_MIN_BLOCK_MINUTES)
    until = await inc.store.block_ip(inc.tenant_id, ip, applied, reason, inc.incident_id, actor)
    inc.mark("actionAt")
    action = {"type": "block_ip", "ip": ip, "minutes": applied, "requestedMinutes": requested,
              "until": until.isoformat(), "reasonJa": reason, "by": actor}
    inc.actions.append(action)
    await inc.store.audit(inc.tenant_id, actor, "block_ip", {"ip": ip, "minutes": requested, "reasonJa": reason},
                          {"status": "blocked", "appliedMinutes": applied, "until": until.isoformat()},
                          inc.incident_id)
    note = f"（要求 {requested}分 → ルールにより {applied}分）" if applied != requested else ""
    await inc.step(_step_agent(actor), "action",
                   f"{ip} を {applied}分ブロックしました{note}。解除予定 {until.astimezone(JST):%H:%M}",
                   {"action": action})
    return {"status": "blocked", "ip": ip, "minutes": applied, "until": until.isoformat()}


async def do_watch(inc: Incident, reason_ja: str, actor: str) -> dict:
    ip = inc.event.src_ip
    reason = clean_text(reason_ja, 120) or "不審なアクセスのため"
    await inc.store.watch_ip(inc.tenant_id, ip, reason, inc.incident_id, actor)
    inc.mark("actionAt")
    action = {"type": "watch_ip", "ip": ip, "reasonJa": reason, "by": actor}
    inc.actions.append(action)
    await inc.store.audit(inc.tenant_id, actor, "watch_ip", {"ip": ip, "reasonJa": reason},
                          {"status": "watching"}, inc.incident_id)
    await inc.step(_step_agent(actor), "action", f"{ip} を24時間の監視リストに追加しました", {"action": action})
    return {"status": "watching", "ip": ip}


async def do_request_isolation(inc: Incident, minutes: int, reason_ja: str, actor: str) -> dict:
    if not inc.verdict or inc.verdict.severity != "critical":
        why = "サイトの一時停止は重大度が critical のときだけ依頼できます"
        await inc.store.audit(inc.tenant_id, actor, "request_isolation", {"minutes": minutes},
                              {"status": "refused", "why": why}, inc.incident_id)
        return {"status": "refused", "why": why}
    applied = max(ISOLATION_MIN_MINUTES, min(int(minutes), ISOLATION_MAX_MINUTES))
    reason = clean_text(reason_ja, 160) or "重大な攻撃のため"
    approval_id = uuid.uuid4().hex[:16]
    approval = {"id": approval_id, "action": "isolate_site", "minutes": applied, "reasonJa": reason,
                "incidentId": inc.incident_id, "requestedBy": actor}
    await inc.store.create_approval(inc.tenant_id, approval_id, approval)
    inc.approvals.append(approval)
    inc.mark("actionAt")
    await inc.store.audit(inc.tenant_id, actor, "request_isolation", {"minutes": applied, "reasonJa": reason},
                          {"status": "pending_human_approval", "approvalId": approval_id}, inc.incident_id)
    await inc.step(_step_agent(actor), "approval",
                   f"サイトを{applied}分間一時停止する許可を、あなたに求めています（承認されるまで実行しません）",
                   {"approval": approval})
    return {"status": "pending_human_approval", "approval_id": approval_id}


def build_defender_tools(inc: Incident) -> list:
    actor = "agent:mamoru"

    async def block_ip(minutes: int, reason_ja: str) -> dict:
        """Block this incident's attacker IP address for `minutes` minutes.

        Args:
          minutes: How long to block. Guide: medium=30, high=60-240, critical=720-1440.
          reason_ja: Short Japanese reason shown to the site owner (max 120 characters).
        """
        if refused := _budget_exceeded(inc):
            return refused
        return await do_block(inc, minutes, reason_ja, actor)

    async def watch_ip(reason_ja: str) -> dict:
        """Put this incident's attacker IP under 24-hour watch without blocking it.

        Args:
          reason_ja: Short Japanese reason shown to the site owner (max 120 characters).
        """
        if refused := _budget_exceeded(inc):
            return refused
        return await do_watch(inc, reason_ja, actor)

    async def request_isolation(minutes: int, reason_ja: str) -> dict:
        """Ask the human owner to put the whole site into maintenance mode. Critical incidents only.

        Nothing happens until a human approves it on the dashboard.

        Args:
          minutes: Requested maintenance length (10-120).
          reason_ja: Short Japanese reason shown to the site owner (max 160 characters).
        """
        if refused := _budget_exceeded(inc):
            return refused
        return await do_request_isolation(inc, minutes, reason_ja, actor)

    return [block_ip, watch_ip, request_isolation]
