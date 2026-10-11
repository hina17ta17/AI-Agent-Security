"""Many attacks at once: AI slots, status, and the attack wave (rule blocks guided by the AI)."""

import asyncio
from datetime import datetime, timedelta, timezone

from app.concurrency import (
    DEFAULT_WAVE_MINUTES,
    FALLBACK_WAVE_MINUTES,
    derive_status,
    is_open,
    prune_active,
    wave_block_minutes,
)
from app.config import get_settings
from app.context import Incident
from app.pipeline import Pipeline
from tests.conftest import FakeStore, verdict

NOW = datetime(2026, 10, 11, 5, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------- pure rules

def test_prune_active_drops_stale_and_invalid_entries():
    active = {"fresh": NOW - timedelta(seconds=10), "stale": NOW - timedelta(seconds=301), "bad": "x"}
    assert prune_active(active, NOW, 300) == {"fresh": active["fresh"]}
    assert prune_active(None, NOW) == {}


def test_status_stays_responding_while_any_investigation_runs():
    assert derive_status(2, pending_approval=True) == "responding"
    assert derive_status(0, pending_approval=True) == "awaiting_approval"
    assert derive_status(0, pending_approval=False) == "safe"


def test_wave_uses_policy_until_the_ai_decides_longer():
    assert wave_block_minutes("sqli", None) == (DEFAULT_WAVE_MINUTES["sqli"], "policy")
    assert wave_block_minutes("sqli", {"sqli": {"minutes": 240}}) == (240, "ai")
    # A shorter AI decision never lets the rest of a mass attack go free sooner than the policy.
    assert wave_block_minutes("sqli", {"sqli": {"minutes": 30}}) == (DEFAULT_WAVE_MINUTES["sqli"], "policy")
    assert wave_block_minutes("sqli", {"xss": {"minutes": 999}}) == (DEFAULT_WAVE_MINUTES["sqli"], "policy")
    assert wave_block_minutes("sqli", {"sqli": {"minutes": True}}) == (DEFAULT_WAVE_MINUTES["sqli"], "policy")
    assert wave_block_minutes("other", None) == (FALLBACK_WAVE_MINUTES, "policy")


def test_wave_closes_after_idle_time():
    assert is_open(NOW - timedelta(seconds=59), NOW, 60)
    assert not is_open(NOW - timedelta(seconds=61), NOW, 60)
    assert not is_open(None, NOW, 60)


# ---------------------------------------------------------------------------- pipeline

class WaveStore(FakeStore):
    """In-memory store for the admission and wave paths."""

    def __init__(self, decision=("full", None), decisions_seen=(None,), allowlist=(), campaign_id="wave-1",
                 open_group=None):
        super().__init__()
        self.decision = decision
        self.campaign_id = campaign_id
        self.open_group = open_group
        self.admit_calls = 0
        self.open_calls = 0
        self.decisions_seen = list(decisions_seen)  # aiDecisions returned by successive reads
        self.allowlist = list(allowlist)
        self.wave_events: list[tuple] = []
        self.extended: list[tuple] = []
        self.related: list[str] = []
        self.released: list[str] = []
        self.campaign_decisions: list[tuple] = []
        self.incident_updates: list[dict] = []

    async def claim_event(self, t, event_id):
        return True

    async def get_tenant(self, t):
        return {"aiMode": "demo", "settings": {"allowlist": self.allowlist}, "campaignId": self.campaign_id}

    async def find_open_group(self, t, ip, attack_type):
        return self.open_group

    async def admit(self, t, ip, attack_type, incident_id, *, cap, stale_sec, window_sec):
        self.admit_calls += 1
        if isinstance(self.decision, Exception):
            raise self.decision
        return self.decision

    async def add_related_event(self, t, i):
        self.related.append(i)

    async def open_campaign(self, t, idle_sec, stale_sec):
        self.open_calls += 1
        await asyncio.sleep(0.01)  # concurrent callers overlap
        return "wave-1"

    async def get_campaign(self, t, cid):
        decisions = self.decisions_seen.pop(0) if len(self.decisions_seen) > 1 else self.decisions_seen[0]
        return {"id": cid, "lastEventAt": datetime.now(timezone.utc), "aiDecisions": decisions}

    async def record_wave_event(self, t, cid, ip, attack_type, minutes, source, block_sec=None):
        self.wave_events.append((ip, attack_type, minutes, source))
        assert minutes is None or block_sec is not None  # every rule block reports how fast it was

    async def extend_wave_block(self, t, cid, ip, minutes, incident_id):
        self.extended.append((ip, minutes, incident_id))
        await self.block_ip(t, ip, minutes, "extended", incident_id, "system:wave")

    async def bump_ip_history(self, t, ip, incident_id):
        pass

    async def finish_ai(self, t, incident_id, stale_sec):
        self.released.append(incident_id)
        return "safe"

    async def record_campaign_decision(self, t, cid, attack_type, minutes, severity, incident_id):
        self.campaign_decisions.append((attack_type, minutes, severity, incident_id))
        return ["203.0.113.50", "203.0.113.51"]

    async def update_incident(self, t, i, data):
        self.incident_updates.append(data)


def run(pipeline, event):
    return asyncio.run(pipeline.handle(event))


def test_wave_event_is_blocked_by_rule_without_ai(event):
    store = WaveStore()
    assert run(Pipeline(get_settings(), store, gatekeeper=None), event) == "wave"
    assert store.blocks[event.src_ip]["by"] == "system:wave"
    assert store.blocks[event.src_ip]["minutes"] == DEFAULT_WAVE_MINUTES["sqli"]
    assert store.wave_events == [(event.src_ip, "sqli", DEFAULT_WAVE_MINUTES["sqli"], "policy")]
    assert store.released == []  # no AI slot was taken


def test_wave_follows_a_longer_ai_decision(event):
    store = WaveStore(decisions_seen=({"sqli": {"minutes": 240, "incidentId": "inc-1"}},))
    run(Pipeline(get_settings(), store, gatekeeper=None), event)
    assert store.blocks[event.src_ip]["minutes"] == 240
    assert store.wave_events[0][3] == "ai"


def test_wave_rechecks_a_decision_that_lands_while_blocking(event):
    store = WaveStore(decisions_seen=(None, {"sqli": {"minutes": 240, "incidentId": "inc-1"}}))
    run(Pipeline(get_settings(), store, gatekeeper=None), event)
    assert store.extended == [(event.src_ip, 240, "inc-1")]
    assert store.blocks[event.src_ip]["minutes"] == 240


def test_wave_never_blocks_an_allowlisted_address(event):
    store = WaveStore(allowlist=["203.0.113.0/24"])
    assert run(Pipeline(get_settings(), store, gatekeeper=None), event) == "wave-refused"
    assert store.blocks == {}
    assert store.wave_events == [(event.src_ip, "sqli", None, "refused")]


def test_failed_admission_falls_back_to_a_rule_block(event):
    store = WaveStore(decision=ValueError("Failed to commit transaction in 12 attempts."))
    assert run(Pipeline(get_settings(), store, gatekeeper=None), event) == "wave"
    assert store.blocks[event.src_ip]["by"] == "system:wave"


def test_same_attacker_and_type_is_grouped_into_the_open_incident(event):
    store = WaveStore(decision=("grouped", "inc-1"))
    assert run(Pipeline(get_settings(), store, gatekeeper=None), event) == "grouped"
    assert store.related == ["inc-1"]
    assert store.blocks == {}


def test_slot_is_released_after_success_and_after_a_crash(event, monkeypatch):
    for outcome in ("resolved", RuntimeError("boom")):
        store = WaveStore(decision=("admitted", None))
        store.ip_history = lambda t, ip: asyncio.sleep(0, {})
        store.create_incident = lambda t, i, data: asyncio.sleep(0)

        async def respond(self, inc, tenant, outcome=outcome):
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        monkeypatch.setattr(Pipeline, "_respond", respond)
        pipeline = Pipeline(get_settings(), store, gatekeeper=None)
        try:
            run(pipeline, event)
        except RuntimeError:
            assert store.blocks[event.src_ip]["by"] == "system:fallback"
        assert len(store.released) == 1
        assert pipeline._local_ai == {}  # this instance holds no slot any more


def test_a_full_instance_skips_the_admission_transaction(event):
    """A burst on one instance: once it holds every slot, more events go straight to the wave."""
    store = WaveStore(decision=("admitted", None))
    pipeline = Pipeline(get_settings(), store, gatekeeper=None)
    pipeline._local_ai[event.tenant_id] = get_settings().max_concurrent_ai
    assert run(pipeline, event) == "wave"
    assert store.admit_calls == 0
    assert store.blocks[event.src_ip]["by"] == "system:wave"


def test_a_full_instance_still_groups_the_same_attacker(event):
    store = WaveStore(decision=("admitted", None), open_group="inc-1")
    pipeline = Pipeline(get_settings(), store, gatekeeper=None)
    pipeline._local_ai[event.tenant_id] = get_settings().max_concurrent_ai
    assert run(pipeline, event) == "grouped"
    assert store.related == ["inc-1"] and store.blocks == {}


def test_a_new_wave_is_opened_once_and_never_delays_the_block(event):
    store = WaveStore(campaign_id=None)
    pipeline = Pipeline(get_settings(), store, gatekeeper=None)
    tenant = {"settings": {"allowlist": []}}
    second = event.model_copy(update={"src_ip": "203.0.113.99", "event_id": "b" * 32})

    async def burst():
        return await asyncio.gather(pipeline._wave(event, tenant), pipeline._wave(second, tenant))

    assert asyncio.run(burst()) == ["wave", "wave"]
    assert store.open_calls == 1  # concurrent events on one instance share the call
    assert {ip for ip, *_ in store.wave_events} == {event.src_ip, "203.0.113.99"}
    assert set(store.blocks) == {event.src_ip, "203.0.113.99"}


def test_transactions_retry_contention_raised_while_reading(monkeypatch):
    """The client retries aborted commits only; aborts raised by reads must be retried by us."""
    from google.api_core.exceptions import Aborted, NotFound

    from app import store as store_module

    monkeypatch.setattr(store_module.random, "uniform", lambda a, b: 0.0)  # no real pauses in tests

    class FakeDb:
        def transaction(self, max_attempts):
            return object()

    def flaky(failures):
        calls = []

        async def txn(transaction):
            calls.append(1)
            if len(calls) <= len(failures):
                raise failures[len(calls) - 1]
            return "ok"
        return txn, calls

    contention = Aborted("Aborted due to cross-transaction contention.")
    exhausted = ValueError("Failed to commit transaction in 12 attempts.")
    exhausted.__cause__ = contention
    store = store_module.Store(FakeDb())

    txn, calls = flaky([contention, exhausted])
    assert asyncio.run(store._transact(txn)) == "ok" and len(calls) == 3

    txn, calls = flaky([NotFound("no tenant")])  # not contention: surfaced at once
    try:
        asyncio.run(store._transact(txn))
        raise AssertionError("expected NotFound")
    except NotFound:
        assert len(calls) == 1

    txn, calls = flaky([contention] * 10)  # bounded
    try:
        asyncio.run(store._transact(txn))
        raise AssertionError("expected Aborted")
    except Aborted:
        assert len(calls) == store_module.TXN_RETRIES


def test_ai_decision_is_shared_with_the_open_wave(event):
    store = WaveStore()
    inc = Incident(settings=get_settings(), store=store, event=event, incident_id="inc-1", allowlist=[])
    inc.verdict = verdict(severity="high")
    inc.actions.append({"type": "block_ip", "ip": event.src_ip, "minutes": 240, "by": "agent:mamoru"})
    asyncio.run(Pipeline(get_settings(), store, gatekeeper=None)._share_with_wave(inc))
    assert store.campaign_decisions == [("sqli", 240, "high", "inc-1")]
    assert store.incident_updates[-1] == {"campaignId": "wave-1"}
    assert any("2 件" in text for _, _, _, text in store.steps)
