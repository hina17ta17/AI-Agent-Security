"""AgentGuard agent service: woken by Pub/Sub push only when Mihari blocks something.

Cloud Run keeps zero instances while nothing happens, so the AI team costs nothing at rest.
The service requires authentication; only the Pub/Sub push identity may invoke it.
"""

from __future__ import annotations

import base64
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from google.cloud import firestore
from pydantic import ValidationError

from .config import get_settings
from .guard import Gatekeeper
from .logs import log
from .models import SecurityEvent
from .pipeline import Pipeline
from .store import Store
from .telemetry import setup_tracing


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = getattr(app.state, "settings", None) or get_settings()
    app.state.settings = settings
    setup_tracing(settings.enable_cloud_trace)
    if not hasattr(app.state, "pipeline"):
        store = Store(firestore.AsyncClient(project=settings.project_id))
        gatekeeper = Gatekeeper(settings.armor_location, settings.armor_input_template,
                                settings.armor_output_template)
        app.state.pipeline = Pipeline(settings, store, gatekeeper)
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
    log("INFO", "event handled", eventId=event.event_id, outcome=outcome)
    return Response(status_code=204)


@app.post("/dev/run")
async def dev_run(request: Request):
    """Local testing without Pub/Sub. Disabled unless DEV_MODE=true (never set on Cloud Run)."""
    if not app.state.settings.dev_mode:
        raise HTTPException(status_code=404)
    event = SecurityEvent.model_validate(await request.json())
    return {"outcome": await app.state.pipeline.handle(event)}
