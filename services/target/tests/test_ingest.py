"""The ingest endpoint: a registered site (ingest key) or the simulator (SA token) reports a request."""

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
