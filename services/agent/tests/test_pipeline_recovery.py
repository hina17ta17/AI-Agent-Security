"""If something crashes mid-incident, the attacker is still blocked and the tenant never stays 'responding'."""

import asyncio

import pytest

from app.config import get_settings
from app.pipeline import Pipeline
from tests.conftest import FakeStore


class CrashingStore(FakeStore):
    def __init__(self):
        super().__init__()
        self.status_history: list[str] = []
        self.incident_updates: list[dict] = []

    async def claim_event(self, t, event_id):
        return True

    async def get_tenant(self, t):
        return {"aiMode": "demo", "settings": {"allowlist": []}}

    async def admit(self, t, ip, attack_type, incident_id, *, cap, stale_sec, window_sec):
        self.status_history.append("responding")
        return "admitted", None

    async def finish_ai(self, t, incident_id, stale_sec):
        self.status_history.append("safe")
        return "safe"

    async def ip_history(self, t, ip):
        return {}

    async def create_incident(self, t, i, data):
        pass

    async def bump_ip_history(self, t, ip, incident_id):
        raise RuntimeError("storage unavailable")  # crash right after 'responding'

    async def update_incident(self, t, i, data):
        self.incident_updates.append(data)


def test_crash_mid_incident_blocks_and_resets_status(event):
    store = CrashingStore()
    pipeline = Pipeline(get_settings(), store, gatekeeper=None)
    with pytest.raises(RuntimeError):
        asyncio.run(pipeline.handle(event))
    assert store.status_history == ["responding", "safe"]
    assert store.blocks[event.src_ip]["by"] == "system:fallback"
    assert store.incident_updates[-1]["status"] == "fallback"
