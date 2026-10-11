"""The ingest endpoint: a registered external site (or the simulator) reports one request, and
Mihari inspects the reported fields. AgentGuard never sends traffic to the user's site; it only
receives descriptions of requests the site already handled and returns an allow/block decision.

Auth is one of:
  - Ingest key (real site): Authorization: Bearer <key>, mapped to a tenant by its hash.
  - Dashboard service-account ID token (the simulator): an explicit tenantId, simulated=true, and a
    documentation source IP (RFC 5737) only -- the same trust model as the demo attack simulator.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field

from . import waf
from .net import is_documentation_ip, parse_ip


class IngestRequest(BaseModel):
    method: str = Field(default="GET", max_length=10)
    path: str = Field(default="/", max_length=2048)
    query: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = Field(default="", max_length=64 * 1024)
    ip: str | None = None
    # Only honored on the simulator (service-account) path:
    tenantId: str | None = None
    simulated: bool = False


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _flatten_json(value: Any, prefix: str = "json", depth: int = 0):
    if depth > 5:
        return
    if isinstance(value, dict):
        for k, v in list(value.items())[:100]:
            yield ("json-key", str(k))
            yield from _flatten_json(v, f"{prefix}.{k}", depth + 1)
    elif isinstance(value, list):
        for v in value[:100]:
            yield from _flatten_json(v, prefix, depth + 1)
    elif isinstance(value, str):
        yield (prefix, value)


def fields_from_payload(req: IngestRequest) -> list[tuple[str, str]]:
    """Build the (field_name, value) pairs Mihari inspects, from the reported request."""
    fields: list[tuple[str, str]] = [("path", req.path)]
    for key, value in req.query.items():
        fields.append(("query-name", str(key)))
        fields.append((f"query:{key}", str(value)))
    content_type = ""
    for name, value in req.headers.items():
        lname = name.lower()
        if lname == "content-type":
            content_type = value
        if lname in ("user-agent", "referer", "x-forwarded-for", "cookie"):
            fields.append((f"header:{lname}", str(value)))
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
