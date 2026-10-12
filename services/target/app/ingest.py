"""The ingest endpoint: a registered external site (or the simulator) reports one request, and
Mihari inspects the reported fields. AgentGuard never sends traffic to the user's site; it only
receives descriptions of requests the site already handled and returns an allow/block decision.

Auth is one of:
  - Ingest key (real site): Authorization: Bearer <key>, mapped to a tenant by its hash.
  - Dashboard service-account ID token + agentguardSelf=true (AgentGuard protects itself): the
    dashboard's real visitors, recorded under the tenant fixed by SELF_TENANT_ID.
  - Dashboard service-account ID token (the simulator): an explicit tenantId, simulated=true, and a
    documentation source IP (RFC 5737) only -- the same trust model as the demo attack simulator.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field, field_validator

from . import waf
from .net import is_documentation_ip, parse_ip

MAX_TEXT = waf.MAX_FIELD_CHARS  # longer paths / bodies / values are cut to this, never refused
MAX_ITEMS = 100  # JSON items looked at one by one; the rest is inspected as raw text


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value[:MAX_TEXT]
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)[:MAX_TEXT]
    return str(value)[:MAX_TEXT]


class IngestRequest(BaseModel):
    """A reported request. Oversized or oddly shaped fields are cut down rather than rejected:
    the integration code lets a request through when AgentGuard refuses the report (fail-open), so
    a refusal would let an attacker pass just by sending a long path or a repeated parameter."""

    method: str = "GET"
    path: str = "/"
    # Values may be lists or objects (Express parses ?q=a&q=b as an array, ?q[x]=1 as an object).
    query: dict[str, Any] = Field(default_factory=dict)
    headers: dict[str, Any] = Field(default_factory=dict)
    body: str = ""
    ip: str | None = None
    # Only honored on the simulator (service-account) path:
    tenantId: str | None = None
    simulated: bool = False
    # AgentGuard's own dashboard reporting its traffic (service-account path; tenant fixed by config).
    agentguardSelf: bool = False

    @field_validator("method", "path", "body", mode="before")
    @classmethod
    def _clip(cls, value: Any) -> str:
        return _text(value)

    @field_validator("ip", mode="before")
    @classmethod
    def _ip_text(cls, value: Any) -> str | None:
        return None if value is None else _text(value)[:64]


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _flatten_json(value: Any, prefix: str = "json", depth: int = 0):
    """Every string in a JSON value, with its field name. Past the depth or item limits the rest is
    inspected as raw text, so nesting deeply or putting the attack in item 101 hides nothing."""
    if depth > 5:
        if isinstance(value, (dict, list)):
            yield (prefix, _text(value))
            return
    if isinstance(value, dict):
        items = list(value.items())
        for k, v in items[:MAX_ITEMS]:
            yield ("json-key", str(k))
            yield from _flatten_json(v, f"{prefix}.{k}", depth + 1)
        if len(items) > MAX_ITEMS:
            yield (prefix, _text(dict(items[MAX_ITEMS:])))
    elif isinstance(value, list):
        for v in value[:MAX_ITEMS]:
            yield from _flatten_json(v, prefix, depth + 1)
        if len(value) > MAX_ITEMS:
            yield (prefix, _text(value[MAX_ITEMS:]))
    elif isinstance(value, str):
        yield (prefix, value)


def fields_from_payload(req: IngestRequest) -> list[tuple[str, str]]:
    """Build the (field_name, value) pairs Mihari inspects, from the reported request."""
    fields: list[tuple[str, str]] = [("path", req.path)]
    params = list(req.query.items())
    for key, value in params[:MAX_ITEMS]:
        fields.append(("query-name", str(key)))
        if isinstance(value, (dict, list)):
            fields.extend(_flatten_json(value, f"query:{key}"))
        else:
            fields.append((f"query:{key}", _text(value)))
    if len(params) > MAX_ITEMS:
        fields.append(("query", _text(dict(params[MAX_ITEMS:]))))
    content_type = ""
    for name, value in req.headers.items():
        lname = str(name).lower()
        if lname == "content-type":
            content_type = _text(value)
        if lname in ("user-agent", "referer", "x-forwarded-for", "cookie"):
            fields.append((f"header:{lname}", _text(value)))
    if req.body:
        if "application/json" in content_type:
            try:
                fields.extend(_flatten_json(json.loads(req.body)))
            except ValueError:
                fields.append(("body", req.body))
        else:
            # Covers form-encoded and raw bodies alike (rules run over the decoded text).
            fields.append(("body", req.body))
    return fields


def resolve_ip(req: IngestRequest, simulated: bool) -> tuple[str, bool]:
    """The reported client IP. On the simulator path it must be a documentation address."""
    ip = parse_ip(req.ip) if req.ip else None
    if simulated:
        if ip and is_documentation_ip(ip):
            return ip, True
        return "203.0.113.1", True  # fall back to a safe documentation address
    return (ip or "0.0.0.0"), False


def inspect_payload(req: IngestRequest) -> waf.Detection | None:
    return waf.inspect(fields_from_payload(req))
