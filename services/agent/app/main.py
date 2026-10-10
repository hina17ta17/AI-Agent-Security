"""AgentGuard agent service: woken by Pub/Sub push only when Mihari blocks something.

Cloud Run keeps zero instances while nothing happens, so the AI team costs nothing at rest.
The service requires authentication; only the Pub/Sub push identity may invoke it.
"""

from __future__ import annotations

import asyncio
import base64
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from google.cloud import firestore
from google.genai import types
from pydantic import ValidationError

from .config import Settings, get_settings
from .guard import Gatekeeper
from .llm import _demo_client
from .logs import log
from .models import SecurityEvent
from .pipeline import Pipeline
from .store import Store
from .telemetry import flush_traces, setup_tracing


async def warm_up(settings: Settings) -> None:
    """The first Gemini call on a fresh instance is slow (connection + auth setup); pay it at startup."""
    client = _demo_client(settings.project_id, settings.demo_location)

    async def ping(model: str) -> None:
        t0 = time.perf_counter()
        try:
            await client.aio.models.generate_content(
                model=model, contents="ping", config=types.GenerateContentConfig(max_output_tokens=8))
            log("INFO", "model warm-up done", model=model, seconds=round(time.perf_counter() - t0, 2))
        except Exception as exc:
            log("WARNING", "model warm-up failed", model=model, error=repr(exc)[:300])

    await asyncio.gather(*(ping(m) for m in sorted(settings.models)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = getattr(app.state, "settings", None) or get_settings()
    app.state.settings = settings
    setup_tracing(settings.enable_cloud_trace, settings.project_id)
    if not hasattr(app.state, "pipeline"):
        store = Store(firestore.AsyncClient(project=settings.project_id))
        gatekeeper = Gatekeeper(settings.armor_location, settings.armor_input_template,
                                settings.armor_output_template)
        app.state.pipeline = Pipeline(settings, store, gatekeeper)
        if not settings.dev_mode:
            # Awaited during startup (CPU is fully allocated then); bounded so startup never hangs.
            try:
                await asyncio.wait_for(warm_up(settings), timeout=25)
            except TimeoutError:
                log("WARNING", "model warm-up timed out")
    yield


app = FastAPI(title="AgentGuard agent", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")  # Cloud Run reserves paths ending in "z"
async def health():
    return {"ok": True}


@app.post("/pubsub")
async def pubsub_push(request: Request):
    try:
        envelope = await request.json()
        data = base64.b64decode(envelope["message"]["data"])
        event = SecurityEvent.model_validate_json(data)
    except (KeyError, ValueError, ValidationError) as exc:
        # Malformed messages are acknowledged (204) so Pub/Sub does not retry them forever.
        log("WARNING", "dropping malformed Pub/Sub message", error=repr(exc)[:300])
        return Response(status_code=204)
    try:
        outcome = await app.state.pipeline.handle(event)
    except Exception as exc:
        # The pipeline already contains a fail-safe; reaching here means storage itself failed.
        # Acknowledge to avoid re-running tools on redelivery; the error is in the logs.
        log("ERROR", "pipeline crashed", eventId=event.event_id, error=repr(exc)[:500])
        return Response(status_code=204)
    finally:
        await asyncio.to_thread(flush_traces)  # before responding: CPU is throttled afterwards
    log("INFO", "event handled", eventId=event.event_id, outcome=outcome)
    return Response(status_code=204)


@app.post("/dev/run")
async def dev_run(request: Request):
    """Local testing without Pub/Sub. Disabled unless DEV_MODE=true (never set on Cloud Run)."""
    if not app.state.settings.dev_mode:
        raise HTTPException(status_code=404)
    event = SecurityEvent.model_validate(await request.json())
    return {"outcome": await app.state.pipeline.handle(event)}
