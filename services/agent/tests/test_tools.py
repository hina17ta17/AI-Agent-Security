"""The defender's safety rules are enforced in code, whatever the model asks for."""

import asyncio

from app import tools
from tests.conftest import PI_GUARD, verdict


def run(coro):
    return asyncio.run(coro)


def test_block_uses_incident_ip_and_clamps_minutes(incident):
    result = run(tools.do_block(incident, 999999, "テスト", "agent:mamoru"))
    assert result["status"] == "blocked"
    assert result["ip"] == "203.0.113.7"
    assert result["minutes"] == incident.settings.max_block_minutes
    assert incident.actions[0]["requestedMinutes"] == 999999


def test_block_has_a_minimum(incident):
    assert run(tools.do_block(incident, 1, "テスト", "agent:mamoru"))["minutes"] == tools.MIN_BLOCK_MINUTES


def test_ai_targeted_attacks_get_at_least_four_hours(incident):
    incident.guard = PI_GUARD
    result = run(tools.do_block(incident, 30, "テスト", "agent:mamoru"))
    assert result["minutes"] == tools.AI_TARGETED_MIN_BLOCK_MINUTES


def test_allowlisted_ip_is_never_blocked(incident):
    incident.allowlist = ["203.0.113.0/24"]
    result = run(tools.do_block(incident, 60, "テスト", "agent:mamoru"))
    assert result["status"] == "refused"
    assert incident.store.blocks == {}
    assert incident.store.audits[-1][3]["status"] == "refused"


def test_internal_ip_is_never_blocked(incident):
    incident.event = incident.event.model_copy(update={"src_ip": "10.1.2.3", "simulated": False})
    assert run(tools.do_block(incident, 60, "テスト", "agent:mamoru"))["status"] == "refused"


def test_documentation_ip_needs_the_simulated_flag(incident):
    incident.event = incident.event.model_copy(update={"simulated": False})
    assert run(tools.do_block(incident, 60, "テスト", "agent:mamoru"))["status"] == "refused"


def test_public_ip_can_be_blocked(incident):
    incident.event = incident.event.model_copy(update={"src_ip": "60.91.17.173", "simulated": False})
    assert run(tools.do_block(incident, 60, "テスト", "agent:mamoru"))["status"] == "blocked"


def test_reason_is_sanitized(incident):
    run(tools.do_block(incident, 60, "理由\x00\n" + "あ" * 500, "agent:mamoru"))
    reason = incident.store.blocks["203.0.113.7"]["reason"]
    assert "\x00" not in reason and "\n" not in reason
    assert len(reason) <= 120


def test_isolation_only_for_critical(incident):
    incident.verdict = verdict(severity="high")
    assert run(tools.do_request_isolation(incident, 30, "テスト", "agent:mamoru"))["status"] == "refused"
    incident.verdict = verdict(severity="critical")
    result = run(tools.do_request_isolation(incident, 999, "テスト", "agent:mamoru"))
    assert result["status"] == "pending_human_approval"
    [approval] = incident.store.approvals.values()
    assert approval["minutes"] == tools.ISOLATION_MAX_MINUTES
    assert approval["action"] == "isolate_site"


def test_tool_call_budget(incident):
    block_ip, watch_ip, _ = tools.build_defender_tools(incident)
    outcomes = [run(watch_ip("監視")) for _ in range(tools.MAX_TOOL_CALLS + 1)]
    assert outcomes[-1]["status"] == "refused"
    assert all(o["status"] == "watching" for o in outcomes[:-1])


def test_there_is_no_tool_to_loosen_defenses(incident):
    names = {f.__name__ for f in tools.build_defender_tools(incident)}
    assert names == {"block_ip", "watch_ip", "request_isolation"}
    assert not any("unblock" in n or "allow" in n or "remove" in n for n in names)
