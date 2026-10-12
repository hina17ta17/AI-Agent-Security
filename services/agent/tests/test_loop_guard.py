"""If the AI team loops, the run stops at the event cap instead of spinning until the timeout."""
import dataclasses

import app.pipeline as pipeline_mod
from app.config import get_settings
from app.llm import ModelAccess
from app.pipeline import Pipeline
from tests.conftest import FakeStore


class QuotaStore(FakeStore):
    async def get_secret(self, t):
        return None

    async def consume_quota(self, t, mode, *, daily_limit, total_limit, global_limit):
        return {"allowed": True, "reason": None, "daily_used": 1, "total_used": 1,
                "daily_limit": daily_limit, "total_limit": total_limit}


class _Event:
    usage_metadata = None
    model_version = None
    author = "system"   # not an agent -> _record_event skips it quickly
    content = None


class _LoopingRunner:
    """Stands in for the ADK Runner: yields far more events than a healthy run ever would."""
    def __init__(self, *a, **k):
        pass

    async def run_async(self, **k):
        for _ in range(10_000):
            yield _Event()


def test_a_runaway_loop_is_stopped_at_the_event_cap(incident, monkeypatch):
    incident.settings = dataclasses.replace(get_settings(), max_run_events=20)
    incident.store = QuotaStore()
    pipeline = Pipeline(incident.settings, incident.store, gatekeeper=object())
    monkeypatch.setattr(pipeline_mod, "model_access",
                        lambda *a, **k: _ret(ModelAccess(client=object(), mode="demo")))
    monkeypatch.setattr(pipeline_mod, "build_team", lambda *a, **k: object())
    monkeypatch.setattr(pipeline_mod, "Runner", _LoopingRunner)

    import asyncio
    report, failure = asyncio.run(pipeline._run_ai(incident, {"aiMode": "demo", "settings": {}}))
    assert failure == "loop_guard"
    assert report is None


async def _ret(v):
    return v
