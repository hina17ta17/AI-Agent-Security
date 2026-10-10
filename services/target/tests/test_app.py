"""Request-flow tests for the target service with in-memory fakes (no cloud access)."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import main
from app.config import Settings
from app.store import TenantState

SITE = "demosite01"
TENANT = "tenant-uid-1"
SIM_IP = "203.0.113.7"


class FakeStore:
    def __init__(self):
        self.blocks: dict[str, dict] = {}
        self.state = TenantState(tenant_id=TENANT)
        self.hits: list[str] = []

    async def tenant_for_site(self, site_id):
        return TENANT if site_id == SITE else None

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
    def __init__(self, valid_token="good-token"):
        self.valid_token = valid_token

    def verify(self, token, audience):
        return token == self.valid_token


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


SIM = {"x-agentguard-sim-token": "good-token", "x-agentguard-sim-ip": SIM_IP}


def test_normal_page_is_served(env):
    client, _, publisher = env
    r = client.get(f"/s/{SITE}/search", params={"q": "マグカップ"})
    assert r.status_code == 200
    assert r.headers["x-agentguard-decision"] == "allow"
    assert "朝のマグカップ" in r.text
    assert publisher.events == []


def test_unknown_site_is_404(env):
    client, _, _ = env
    assert client.get("/s/unknownsite/").status_code == 404


def test_attack_is_blocked_and_event_published(env):
    client, _, publisher = env
    r = client.get(f"/s/{SITE}/search", params={"q": "1' OR '1'='1"}, headers=SIM)
    assert r.status_code == 403
    assert r.headers["x-agentguard-decision"] == "waf"
    assert r.headers["x-agentguard-rule"] == "sqli-tautology"
    assert float(r.headers["x-agentguard-rule-ms"]) < 50
    [event] = publisher.events
    assert event["tenantId"] == TENANT
    assert event["srcIp"] == SIM_IP and event["simulated"] is True
    assert event["attackType"] == "sqli"
    assert event["eventId"] == r.headers["x-agentguard-event-id"]


def test_form_body_is_inspected(env):
    client, _, publisher = env
    r = client.post(f"/s/{SITE}/contact", data={"message": "<script>alert(1)</script>"}, headers=SIM)
    assert r.status_code == 403
    assert publisher.events[0]["field"] == "form:message"


def test_simulated_ip_requires_dashboard_token(env):
    client, _, publisher = env
    forged = {"x-agentguard-sim-token": "forged", "x-agentguard-sim-ip": SIM_IP}
    client.get(f"/s/{SITE}/search", params={"q": "' OR '1'='1"}, headers=forged)
    assert publisher.events[0]["simulated"] is False
    assert publisher.events[0]["srcIp"] != SIM_IP


def test_simulated_ip_must_be_documentation_range(env):
    client, _, publisher = env
    real_looking = {"x-agentguard-sim-token": "good-token", "x-agentguard-sim-ip": "8.8.8.8"}
    client.get(f"/s/{SITE}/search", params={"q": "' OR '1'='1"}, headers=real_looking)
    assert publisher.events[0]["srcIp"] != "8.8.8.8"


def test_blocked_ip_is_rejected_without_new_event(env):
    client, store, publisher = env
    store.blocks[SIM_IP] = {
        "reasonJa": "SQLインジェクションのため",
        "expiresAt": datetime.now(timezone.utc) + timedelta(minutes=30),
    }
    r = client.get(f"/s/{SITE}/", headers=SIM)
    assert r.status_code == 403
    assert r.headers["x-agentguard-decision"] == "blocklist"
    assert store.hits == [SIM_IP]
    assert publisher.events == []


def test_maintenance_mode_returns_503(env):
    client, store, _ = env
    store.state = TenantState(tenant_id=TENANT, site_mode="maintenance",
                              maintenance_until=datetime.now(timezone.utc) + timedelta(minutes=10))
    r = client.get(f"/s/{SITE}/", headers=SIM)
    assert r.status_code == 503
    assert r.headers["x-agentguard-decision"] == "maintenance"


def test_maintenance_allowlist_passes(env):
    client, store, _ = env
    store.state = TenantState(tenant_id=TENANT, site_mode="maintenance", maintenance_until=None,
                              allowlist=["203.0.113.0/24"])
    assert client.get(f"/s/{SITE}/", headers=SIM).status_code == 200


def test_user_input_is_escaped(env):
    client, _, _ = env
    r = client.get(f"/s/{SITE}/files", params={"name": "<b>catalog</b>.pdf"})
    assert r.status_code == 200
    assert "<b>catalog</b>" not in r.text
    assert "&lt;b&gt;catalog&lt;/b&gt;" in r.text
