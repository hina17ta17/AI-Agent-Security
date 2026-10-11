"""AgentGuard target: the protected demo shop with Mihari (the WAF) in front of it.

Request flow for /s/{siteId}/...:
  1. resolve the site and the client IP (simulated IPs only with the dashboard's ID token)
  2. Mihari's rules inspect the request            -> "first response" time (ms)
  3. blocklist written by the AI team               -> 403
  4. maintenance mode approved by a human           -> 503
  5. rule hit                                       -> 403 + Pub/Sub event that wakes the AI team
  6. otherwise                                      -> the shop page
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from google.cloud import firestore
from pydantic import ValidationError

from . import ingest, shop, waf
from .config import get_settings
from .events import EventPublisher
from .logs import log
from .net import (
    SIM_IP_HEADER,
    SIM_TOKEN_HEADER,
    SimTokenVerifier,
    forwarded_client_ip,
    is_documentation_ip,
    parse_ip,
)
from .store import Store

JST = timezone(timedelta(hours=9))


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


app = FastAPI(title="AgentGuard demo shop", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")  # Cloud Run reserves paths ending in "z" (e.g. /healthz)
async def health():
    return {"ok": True}


@app.get("/")
async def root():
    return PlainTextResponse("AgentGuard demo shop host. Open /s/<siteId>/ from your AgentGuard dashboard.")


# ----------------------------------------------------------------------------- helpers

async def _read_body(request: Request, limit: int) -> bytes | None:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            return None
    return bytes(body)


def _flatten_json(value, prefix: str = "json", depth: int = 0):
    if depth > 5:
        return
    if isinstance(value, dict):
        for k, v in list(value.items())[:100]:
            yield ("json-key", str(k))
            yield from _flatten_json(v, f"{prefix}.{k}", depth + 1)
    elif isinstance(value, list):
        for i, v in enumerate(value[:100]):
            yield from _flatten_json(v, f"{prefix}[{i}]", depth + 1)
    elif isinstance(value, str):
        yield (prefix, value)


def _request_fields(request: Request, body: bytes) -> list[tuple[str, str]]:
    fields: list[tuple[str, str]] = [("path", request.scope.get("raw_path", b"").decode("latin-1"))]
    for key, value in request.query_params.multi_items():
        fields.append(("query-name", key))
        fields.append((f"query:{key}", value))
    if body:
        content_type = request.headers.get("content-type", "")
        text = body.decode("utf-8", "replace")
        if "application/x-www-form-urlencoded" in content_type:
            for key, value in parse_qsl(text, keep_blank_values=True):
                fields.append((f"form:{key}", value))
        elif "application/json" in content_type:
            try:
                fields.extend(_flatten_json(json.loads(text)))
            except ValueError:
                fields.append(("body", text))
        else:
            fields.append(("body", text))
    for header in ("user-agent", "referer"):
        if value := request.headers.get(header):
            fields.append((f"header:{header}", value))
    return fields


async def _resolve_ip(request: Request) -> tuple[str, bool]:
    real_ip = forwarded_client_ip(
        request.headers.get("x-forwarded-for"), request.client.host if request.client else None
    )
    token = request.headers.get(SIM_TOKEN_HEADER)
    sim_ip = parse_ip(request.headers.get(SIM_IP_HEADER))
    if token and sim_ip and is_documentation_ip(sim_ip):
        settings = app.state.settings
        audience = settings.sim_audience or f"https://{request.headers.get('host', '')}"
        if await asyncio.to_thread(app.state.verifier.verify, token, audience):
            return sim_ip, True
        log("WARNING", "rejected simulated source IP (token not from the dashboard)", realIp=real_ip)
    return real_ip, False


def _in_allowlist(ip: str, allowlist: list[str]) -> bool:
    addr = ipaddress.ip_address(ip)
    for cidr in allowlist:
        try:
            if addr in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


def _respond(html: str, status: int, *, decision: str, ip: str, t0: float, rule_ms: float,
             rule: str | None = None, event_id: str | None = None) -> HTMLResponse:
    headers = {
        "X-AgentGuard-Decision": decision,
        "X-AgentGuard-Client-IP": ip,
        "X-AgentGuard-Rule-Ms": f"{rule_ms:.3f}",
        "X-AgentGuard-Server-Ms": f"{(time.perf_counter() - t0) * 1000:.1f}",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'",
    }
    if rule:
        headers["X-AgentGuard-Rule"] = rule
    if event_id:
        headers["X-AgentGuard-Event-Id"] = event_id
    return HTMLResponse(html, status_code=status, headers=headers)


def _shop_page(site_id: str, route: str, request: Request, body: bytes) -> tuple[str, int]:
    form = dict(parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=True)) if body else {}
    if route == "":
        return shop.home(site_id), 200
    if route == "search":
        return shop.search(site_id, request.query_params.get("q", "")), 200
    if route == "login":
        return shop.login(site_id, failed=request.method == "POST"), 200
    if route == "contact":
        return shop.contact(site_id, form.get("message", "") if request.method == "POST" else None), 200
    if route == "files":
        return shop.files(site_id, request.query_params.get("name", "")), 200
    return shop.not_found(site_id), 404


# ----------------------------------------------------------------------------- protected site

@app.api_route("/s/{site_id}/{rest:path}", methods=["GET", "POST"])
async def protected_site(site_id: str, rest: str, request: Request):
    t0 = time.perf_counter()
    received_at = datetime.now(timezone.utc)
    settings = app.state.settings
    store: Store = app.state.store

    tenant_id = await store.tenant_for_site(site_id)
    if not tenant_id:
        return HTMLResponse(shop.not_found(None), status_code=404)

    body = await _read_body(request, settings.max_body_bytes)
    if body is None:
        return PlainTextResponse("Payload too large", status_code=413)
    ip, simulated = await _resolve_ip(request)

    # Mihari: pure CPU rule check. This is the "first response" time shown on the dashboard.
    t_rules = time.perf_counter()
    detection = waf.inspect(_request_fields(request, body))
    rule_ms = (time.perf_counter() - t_rules) * 1000

    block = await store.active_block(tenant_id, ip)
    if block:
        await store.count_blocked_hit(tenant_id, ip)
        until = block.get("expiresAt")
        until_text = until.astimezone(JST).strftime("%m/%d %H:%M") if until else "未定"
        log("NOTICE", "request from blocked IP", tenantId=tenant_id, ip=ip, simulated=simulated)
        return _respond(shop.blocked_by_list(block.get("reasonJa") or "AIチームの判断でブロック中です。", until_text),
                        403, decision="blocklist", ip=ip, t0=t0, rule_ms=rule_ms)

    state = await store.tenant_state(tenant_id)
    if state.in_maintenance(received_at) and not _in_allowlist(ip, state.allowlist):
        return _respond(shop.maintenance(), 503, decision="maintenance", ip=ip, t0=t0, rule_ms=rule_ms)

    if detection:
        event_id = uuid.uuid4().hex
        event = {
            "version": 1,
            "eventId": event_id,
            "tenantId": tenant_id,
            "siteId": site_id,
            "receivedAt": received_at.isoformat(timespec="milliseconds"),
            "wafRuleMs": round(rule_ms, 3),
            "ruleId": detection.rule_id,
            "attackType": detection.attack_type,
            "ruleLabelJa": detection.label_ja,
            "field": detection.field,
            "matched": detection.matched,
            "payload": detection.payload,
            "srcIp": ip,
            "simulated": simulated,
            "method": request.method,
            "path": "/" + rest,
            "userAgent": (request.headers.get("user-agent") or "")[:256],
        }
        try:
            await app.state.publisher.publish(event)
        except Exception as exc:  # the request is still blocked; only the AI hand-off failed
            log("ERROR", "failed to publish security event", eventId=event_id, error=repr(exc))
        log("NOTICE", "Mihari blocked a request", eventId=event_id, tenantId=tenant_id, ip=ip,
            rule=detection.rule_id, ruleMs=round(rule_ms, 3), simulated=simulated)
        return _respond(shop.blocked_by_waf(detection.label_ja, event_id), 403, decision="waf",
                        ip=ip, t0=t0, rule_ms=rule_ms, rule=detection.rule_id, event_id=event_id)

    html, status = _shop_page(site_id, rest.strip("/"), request, body)
    return _respond(html, status, decision="allow", ip=ip, t0=t0, rule_ms=rule_ms)


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
    # The attack simulator reports synthetic events with the dashboard's service-account token.
    if req.simulated and req.tenantId:
        settings = app.state.settings
        audience = settings.sim_audience or f"https://{request.headers.get('host', '')}"
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
