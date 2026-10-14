"""The ingest endpoint: a registered site (ingest key) or the simulator (SA token) reports a request."""

import json
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings
from app.store import TenantState

TENANT = "tenant-uid-1"
HOST = "shop.example.com"
INGEST_KEY = "ag_test_key_123456"
SIM_IP = "203.0.113.7"


class FakeStore:
    def __init__(self):
        self.blocks: dict[str, dict] = {}
        self.state = TenantState(tenant_id=TENANT)
        self.hits: list[str] = []
        self.reports: list[str] = []
        self.report_keys: list[str | None] = []
        self.self_reports = 0

    async def tenant_for_ingest_key(self, key_hash):
        if key_hash == hashlib.sha256(INGEST_KEY.encode()).hexdigest():
            return TENANT, HOST
        return None, None

    async def tenant_state(self, tenant_id):
        return self.state

    async def active_block(self, tenant_id, ip):
        return self.blocks.get(ip)

    async def count_blocked_hit(self, tenant_id, ip):
        self.hits.append(ip)

    async def note_site_report(self, tenant_id, key_hint=None):
        self.reports.append(tenant_id)
        self.report_keys.append(key_hint)

    async def note_self_report(self):
        self.self_reports += 1


class FakePublisher:
    def __init__(self):
        self.events: list[dict] = []

    async def publish(self, event):
        self.events.append(event)
        return "msg-1"


class FakeVerifier:
    def verify(self, token, audience):
        return token == "good-sa-token"


@pytest.fixture
def env():
    store, publisher = FakeStore(), FakePublisher()
    main.app.state.settings = Settings(
        project_id="test", events_topic="t", dashboard_sa="sa-dashboard@test.iam.gserviceaccount.com",
        sim_audience="https://target.test",
    )
    main.app.state.store = store
    main.app.state.publisher = publisher
    main.app.state.verifier = FakeVerifier()
    with TestClient(main.app) as client:
        yield client, store, publisher


def key_auth():
    return {"authorization": f"Bearer {INGEST_KEY}"}


def test_clean_request_is_allowed(env):
    client, _, publisher = env
    r = client.post("/ingest", json={"method": "GET", "path": "/search", "query": {"q": "マグカップ"}, "ip": "198.51.100.9"},
                    headers=key_auth())
    assert r.status_code == 200
    assert r.json()["decision"] == "allow" and r.json()["block"] is False
    assert publisher.events == []


def test_attack_is_flagged_and_event_published(env):
    client, _, publisher = env
    r = client.post("/ingest", json={"method": "GET", "path": "/search", "query": {"q": "1' OR '1'='1"}, "ip": "198.51.100.9"},
                    headers=key_auth())
    assert r.status_code == 200
    data = r.json()
    assert data["decision"] == "block" and data["block"] is True
    assert data["attackType"] == "sqli"
    [event] = publisher.events
    assert event["tenantId"] == TENANT and event["srcIp"] == "198.51.100.9"
    assert event["simulated"] is False and event["eventId"] == data["eventId"]


def test_attack_in_json_body_is_flagged(env):
    client, _, publisher = env
    r = client.post("/ingest", json={"method": "POST", "path": "/contact",
                                      "headers": {"content-type": "application/json"},
                                      "body": "{\"message\": \"<script>alert(1)</script>\"}"},
                    headers=key_auth())
    assert r.json()["decision"] == "block"
    assert publisher.events[0]["attackType"] == "xss"


def test_unauthorized_without_a_key(env):
    client, _, _ = env
    assert client.post("/ingest", json={"path": "/"}).status_code == 401
    assert client.post("/ingest", json={"path": "/"}, headers={"authorization": "Bearer wrong"}).status_code == 401


def test_simulator_uses_the_dashboard_token_and_documentation_ip(env):
    client, _, publisher = env
    r = client.post("/ingest",
                    json={"method": "GET", "path": "/search", "query": {"q": "1' OR '1'='1"},
                          "simulated": True, "tenantId": TENANT, "ip": SIM_IP},
                    headers={"authorization": "Bearer good-sa-token"})
    assert r.json()["decision"] == "block"
    assert publisher.events[0]["simulated"] is True and publisher.events[0]["srcIp"] == SIM_IP


def test_simulator_cannot_spoof_a_real_source_ip(env):
    client, _, publisher = env
    client.post("/ingest",
                json={"path": "/search", "query": {"q": "1' OR '1'='1"},
                      "simulated": True, "tenantId": TENANT, "ip": "8.8.8.8"},
                headers={"authorization": "Bearer good-sa-token"})
    # A non-documentation IP on the simulator path is replaced with a safe documentation address.
    assert publisher.events[0]["srcIp"] != "8.8.8.8"


def test_simulator_rejected_without_a_valid_dashboard_token(env):
    client, _, _ = env
    r = client.post("/ingest",
                    json={"path": "/", "simulated": True, "tenantId": TENANT},
                    headers={"authorization": "Bearer forged"})
    assert r.status_code == 401


def test_blocked_ip_is_rejected_without_a_new_event(env):
    client, store, publisher = env
    store.blocks["198.51.100.9"] = {
        "reasonJa": "SQLインジェクションのため",
        "expiresAt": datetime.now(timezone.utc) + timedelta(minutes=30),
    }
    r = client.post("/ingest", json={"path": "/", "ip": "198.51.100.9"}, headers=key_auth())
    assert r.json()["decision"] == "block"
    assert store.hits == ["198.51.100.9"] and publisher.events == []


# ---------------------------------------------------------------------------- AgentGuard protects itself

def with_self_tenant(tenant_id):
    main.app.state.settings = Settings(
        project_id="test", events_topic="t", dashboard_sa="sa-dashboard@test.iam.gserviceaccount.com",
        sim_audience="https://target.test", self_tenant_id=tenant_id,
    )


def test_dashboard_reports_its_own_visitors_to_the_self_tenant(env):
    client, _, publisher = env
    with_self_tenant("self-tenant")
    r = client.post("/ingest",
                    json={"method": "GET", "path": "/app", "query": {"q": "1' OR '1'='1"}, "ip": "198.51.100.9",
                          "agentguardSelf": True, "tenantId": "someone-else"},
                    headers={"authorization": "Bearer good-sa-token"})
    assert r.json()["decision"] == "block"
    [event] = publisher.events
    # The tenant is fixed by configuration (a request cannot pick another tenant), and the visitor's
    # real address is kept (this is real traffic, not the simulator).
    assert event["tenantId"] == "self-tenant"
    assert event["simulated"] is False and event["srcIp"] == "198.51.100.9"


def test_self_protection_is_counted_for_the_public_status(env):
    client, store, _ = env
    with_self_tenant("self-tenant")
    client.post("/ingest", json={"path": "/", "ip": "198.51.100.9", "agentguardSelf": True},
                headers={"authorization": "Bearer good-sa-token"})
    assert store.self_reports == 1 and store.reports == ["self-tenant"]


def test_self_protection_needs_the_dashboard_token(env):
    client, _, _ = env
    with_self_tenant("self-tenant")
    r = client.post("/ingest", json={"path": "/", "agentguardSelf": True},
                    headers={"authorization": "Bearer forged"})
    assert r.status_code == 401


def test_self_protection_is_off_without_a_configured_tenant(env):
    client, _, _ = env
    with_self_tenant("")
    r = client.post("/ingest", json={"path": "/", "agentguardSelf": True},
                    headers={"authorization": "Bearer good-sa-token"})
    assert r.status_code == 401


def test_a_real_site_report_marks_the_connection_alive(env):
    client, store, _ = env
    client.post("/ingest", json={"path": "/", "ip": "198.51.100.9"}, headers=key_auth())
    assert store.reports == [TENANT]
    # Which key reported (last 4 characters, as the dashboard shows them), so a report from a key that
    # was just replaced is not taken for the new key working.
    assert store.report_keys == [INGEST_KEY[-4:]]


def test_a_site_key_cannot_count_as_agentguard_itself(env):
    client, store, _ = env
    with_self_tenant("self-tenant")
    client.post("/ingest", json={"path": "/", "agentguardSelf": True}, headers=key_auth())
    assert store.self_reports == 0 and store.reports == [TENANT]


def test_simulated_reports_do_not_count_as_a_connection(env):
    client, store, _ = env
    client.post("/ingest", json={"path": "/", "simulated": True, "tenantId": TENANT, "ip": SIM_IP},
                headers={"authorization": "Bearer good-sa-token"})
    assert store.reports == []


# ---------------------------------------------------------------------------- reports are never refused for their shape

def test_a_repeated_parameter_is_inspected(env):
    # Express turns ?q=a&q=b into an array; refusing that report let the attack through (fail-open).
    client, _, _ = env
    r = client.post("/ingest", json={"path": "/", "query": {"q": ["ok", "1' OR '1'='1"]}, "ip": "198.51.100.9"},
                    headers=key_auth())
    assert r.status_code == 200 and r.json()["decision"] == "block"


def test_a_very_long_path_is_inspected_not_refused(env):
    client, _, _ = env
    r = client.post("/ingest", json={"path": "/" + "a" * 3000 + "/../../etc/passwd", "ip": "198.51.100.9"},
                    headers=key_auth())
    assert r.status_code == 200 and r.json()["decision"] == "block"


def test_deeply_nested_and_far_json_values_are_inspected(env):
    client, _, _ = env
    deep = {"a": {"b": {"c": {"d": {"e": {"f": {"g": "<script>alert(1)</script>"}}}}}}}
    far = {"items": ["ok"] * 150 + ["1' OR '1'='1"]}
    for body in (deep, far):
        r = client.post("/ingest", json={"method": "POST", "path": "/api", "ip": "198.51.100.9",
                                         "headers": {"content-type": "application/json"}, "body": json.dumps(body)},
                        headers=key_auth())
        assert r.json()["decision"] == "block", body


# ---------------------------------------------------------------------------- a flood from a blocked IP

class _Ref:
    """Stands in for any Firestore reference; every write fails (e.g. contention under a flood)."""
    writes = 0

    def collection(self, _):
        return self

    def document(self, _):
        return self

    async def update(self, _):
        _Ref.writes += 1
        raise RuntimeError("too much contention on this document")


def test_counting_hits_of_a_blocked_ip_never_fails_and_is_throttled():
    import asyncio
    from app.store import Store

    store = Store(_Ref())
    _Ref.writes = 0

    async def flood():
        for _ in range(500):
            await store.count_blocked_hit("t", "198.51.100.9")  # must not raise

    asyncio.run(flood())
    assert _Ref.writes == 1  # one write per 10 s, not one per request
