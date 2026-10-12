"""AgentGuard target: Mihari (the WAF) as an ingest service for user-registered sites.

A registered site (or the attack simulator) reports a request to POST /ingest; Mihari's rules
inspect it, the AI team is woken for attacks, and the caller gets an allow/block decision back.
AgentGuard never sends traffic to the user's site.
"""

from __future__ import annotations

import asyncio
import ipaddress
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from google.cloud import firestore
from pydantic import ValidationError

from . import ingest, waf
from .config import get_settings
from .events import EventPublisher
from .logs import log
from .net import SimTokenVerifier
from .store import Store


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Components already placed on app.state (tests inject fakes) are kept.
    settings = getattr(app.state, "settings", None) or get_settings()
    app.state.settings = settings
    if not hasattr(app.state, "store"):
        app.state.store = Store(firestore.AsyncClient(project=settings.project_id))
    if not hasattr(app.state, "publisher"):
        app.state.publisher = EventPublisher(settings.project_id, settings.events_topic)
    if not hasattr(app.state, "verifier"):
        app.state.verifier = SimTokenVerifier(settings.dashboard_sa)
    yield


app = FastAPI(title="AgentGuard target", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")  # Cloud Run reserves paths ending in "z" (e.g. /healthz)
async def health():
    return {"ok": True}


@app.get("/")
async def root():
    return PlainTextResponse("AgentGuard WAF ingest. Protect your site from the AgentGuard dashboard.")


# ----------------------------------------------------------------------------- helpers

async def _read_body(request: Request, limit: int) -> bytes | None:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            return None
    return bytes(body)


def _in_allowlist(ip: str, allowlist: list[str]) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for cidr in allowlist:
        try:
            if addr in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


# ----------------------------------------------------------------------------- ingest (external sites)

async def _authenticate_ingest(request: Request, req: ingest.IngestRequest) -> tuple[str | None, bool]:
    """Returns (tenant_id, simulated). None tenant_id means the caller is not authorized."""
    token = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    if not token:
        return None, False
    store: Store = app.state.store
    tenant_id, _host = await store.tenant_for_ingest_key(ingest.hash_key(token))
    if tenant_id:
        return tenant_id, False  # a real site's ingest key
    settings = app.state.settings
    audience = settings.sim_audience or f"https://{request.headers.get('host', '')}"
    # AgentGuard's own dashboard reports its real visitors; the tenant comes from config, not the request.
    if req.agentguardSelf:
        if settings.self_tenant_id and await asyncio.to_thread(app.state.verifier.verify, token, audience):
            return settings.self_tenant_id, False
        log("WARNING", "rejected self-protection ingest (disabled or token not from the dashboard)")
        return None, False
    # The attack simulator reports synthetic events with the dashboard's service-account token.
    if req.simulated and req.tenantId:
        if await asyncio.to_thread(app.state.verifier.verify, token, audience):
            return req.tenantId, True
        log("WARNING", "rejected simulated ingest (token not from the dashboard)")
    return None, False


@app.post("/ingest")
async def ingest_request(request: Request):
    """A registered site (or the simulator) reports one request; Mihari returns an allow/block decision."""
    received_at = datetime.now(timezone.utc)
    store: Store = app.state.store
    raw = await _read_body(request, app.state.settings.max_body_bytes)
    if raw is None:
        return JSONResponse({"error": "payload too large"}, status_code=413)
    try:
        req = ingest.IngestRequest.model_validate_json(raw or b"{}")
    except ValidationError:
        return JSONResponse({"error": "invalid request"}, status_code=400)

    tenant_id, simulated = await _authenticate_ingest(request, req)
    if not tenant_id:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if not simulated:
        try:  # a real report: the dashboard shows the connection as alive
            await store.note_site_report(tenant_id)
            if req.agentguardSelf:
                await store.note_self_report()
        except Exception as exc:
            log("WARNING", "could not record the site report time", error=repr(exc)[:200])
    ip, simulated = ingest.resolve_ip(req, simulated)

    t_rules = time.perf_counter()
    detection = ingest.inspect_payload(req)
    rule_ms = (time.perf_counter() - t_rules) * 1000

    block = await store.active_block(tenant_id, ip)
    if block:
        await store.count_blocked_hit(tenant_id, ip)
        until = block.get("expiresAt")
        return _ingest_decision("block", ip, rule_ms, reason_ja=block.get("reasonJa") or "ブロック中のIPです。",
                                until=until.isoformat() if until else None)

    state = await store.tenant_state(tenant_id)
    if state.in_maintenance(received_at) and not _in_allowlist(ip, state.allowlist):
        return _ingest_decision("maintenance", ip, rule_ms, reason_ja="メンテナンス中です。")

    if detection:
        event_id = uuid.uuid4().hex
        await _publish_detection(tenant_id, None, detection, ip, simulated, req.method,
                                 req.path, req.headers.get("user-agent", ""), received_at, rule_ms, event_id)
        return _ingest_decision("block", ip, rule_ms, rule_id=detection.rule_id,
                                attack_type=detection.attack_type, reason_ja=detection.label_ja, event_id=event_id)

    return _ingest_decision("allow", ip, rule_ms)


def _ingest_decision(decision: str, ip: str, rule_ms: float, *, rule_id: str | None = None,
                     attack_type: str | None = None, reason_ja: str | None = None,
                     until: str | None = None, event_id: str | None = None) -> JSONResponse:
    block = decision in ("block", "maintenance")
    return JSONResponse({
        "decision": decision, "block": block, "ruleId": rule_id, "attackType": attack_type,
        "reasonJa": reason_ja, "until": until, "eventId": event_id, "ruleMs": round(rule_ms, 3),
        "ip": ip,
    }, status_code=200)


async def _publish_detection(tenant_id, site_id, detection, ip, simulated, method, path, user_agent,
                             received_at, rule_ms, event_id) -> None:
    event = {
        "version": 1, "eventId": event_id, "tenantId": tenant_id, "siteId": site_id,
        "receivedAt": received_at.isoformat(timespec="milliseconds"), "wafRuleMs": round(rule_ms, 3),
        "ruleId": detection.rule_id, "attackType": detection.attack_type, "ruleLabelJa": detection.label_ja,
        "field": detection.field, "matched": detection.matched, "payload": detection.payload,
        "srcIp": ip, "simulated": simulated, "method": method, "path": path[:300],
        "userAgent": (user_agent or "")[:256],
    }
    try:
        await app.state.publisher.publish(event)
    except Exception as exc:  # the decision is still returned; only the AI hand-off failed
        log("ERROR", "failed to publish security event", eventId=event_id, error=repr(exc))
    log("NOTICE", "Mihari flagged an ingested request", eventId=event_id, tenantId=tenant_id, ip=ip,
        rule=detection.rule_id, ruleMs=round(rule_ms, 3), simulated=simulated)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log("ERROR", "unhandled error", path=request.url.path, error=repr(exc))
    return JSONResponse({"error": "internal error"}, status_code=500)
