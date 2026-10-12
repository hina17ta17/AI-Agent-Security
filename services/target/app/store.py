"""Firestore reads the WAF needs on the hot path (with small in-memory caches)."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore

_HEX64 = re.compile(r"^[a-f0-9]{64}$")


@dataclass
class TenantState:
    tenant_id: str
    site_mode: str = "normal"  # normal | maintenance
    maintenance_until: datetime | None = None
    allowlist: list[str] = field(default_factory=list)

    def in_maintenance(self, now: datetime) -> bool:
        if self.site_mode != "maintenance":
            return False
        return self.maintenance_until is None or self.maintenance_until > now


class _TTLCache:
    def __init__(self) -> None:
        self._items: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> tuple[bool, Any]:
        hit = self._items.get(key)
        if hit and hit[0] > time.monotonic():
            return True, hit[1]
        return False, None

    def put(self, key: str, value: Any, ttl: float) -> None:
        if len(self._items) > 5000:
            self._items.clear()
        self._items[key] = (time.monotonic() + ttl, value)


class Store:
    def __init__(self, db: firestore.AsyncClient):
        self.db = db
        self._tenants = _TTLCache()
        self._keys = _TTLCache()
        self._reports = _TTLCache()
        self._self_checked = 0
        self._self_flushed = float("-inf")  # the first report is written at once
        self._hits: dict[tuple[str, str], int] = {}  # requests from blocked IPs, not yet written
        self._hits_flushed: dict[tuple[str, str], float] = {}

    async def note_site_report(self, tenant_id: str) -> None:
        """Let the dashboard show "your site is connected": record the last report, at most once a minute."""
        found, _ = self._reports.get(tenant_id)
        if found:
            return
        self._reports.put(tenant_id, True, ttl=60)
        await self.db.collection("tenants").document(tenant_id).update({"siteLastReportAt": firestore.SERVER_TIMESTAMP})

    async def note_self_report(self) -> None:
        """Count AgentGuard's own inspected requests for the public "AgentGuard protects itself" card.

        Counted in memory and written at most once a minute per instance, so a burst costs one write.
        """
        self._self_checked += 1
        now = time.monotonic()
        if now - self._self_flushed < 60:
            return
        checked, self._self_checked, self._self_flushed = self._self_checked, 0, now
        await self.db.collection("status").document("self").set(
            {"lastCheckedAt": firestore.SERVER_TIMESTAMP, "checked": firestore.Increment(checked)}, merge=True)

    async def tenant_for_ingest_key(self, key_hash: str) -> tuple[str | None, str | None]:
        """Map a hashed ingest key to (tenantId, host). Cached briefly; only the hash is ever stored."""
        if not _HEX64.match(key_hash):
            return None, None
        found, value = self._keys.get(key_hash)
        if found:
            return value
        snap = await self.db.collection("ingestKeys").document(key_hash).get()
        data = snap.to_dict() if snap.exists else None
        value = (data.get("tenantId"), data.get("host")) if data else (None, None)
        self._keys.put(key_hash, value, ttl=60 if value[0] else 30)  # a removed site's key stops within a minute
        return value

    async def tenant_state(self, tenant_id: str) -> TenantState:
        found, state = self._tenants.get(tenant_id)
        if found:
            return state
        snap = await self.db.collection("tenants").document(tenant_id).get()
        data = snap.to_dict() or {}
        settings = data.get("settings") or {}
        state = TenantState(
            tenant_id=tenant_id,
            site_mode=data.get("siteMode", "normal"),
            maintenance_until=data.get("maintenanceUntil"),
            allowlist=list(settings.get("allowlist") or []),
        )
        self._tenants.put(tenant_id, state, ttl=2)  # short: approvals must take effect quickly
        return state

    def _block_ref(self, tenant_id: str, ip: str):
        return self.db.collection("tenants").document(tenant_id).collection("blocklist").document(ip)

    async def active_block(self, tenant_id: str, ip: str) -> dict | None:
        """Always read fresh: a block the AI just added must apply to the very next request."""
        snap = await self._block_ref(tenant_id, ip).get()
        if not snap.exists:
            return None
        entry = snap.to_dict() or {}
        expires_at = entry.get("expiresAt")
        if expires_at and expires_at <= datetime.now(timezone.utc):
            return None  # Firestore TTL deletion can lag; expiry is enforced here
        return entry

    async def count_blocked_hit(self, tenant_id: str, ip: str) -> None:
        """Count a request from a blocked IP ("ブロック後のアクセス n回"), at most one write per 10 s.

        A blocked attacker who floods requests must not turn this counter into errors: the block
        decision is returned only after it, and an error there would let the request through
        (the site's code fails open). So the count is buffered and a failed write is ignored.
        """
        key = (tenant_id, ip)
        if len(self._hits) > 5000:
            self._hits.clear()  # a bounded buffer: losing some counts is fine
        self._hits[key] = self._hits.get(key, 0) + 1
        now = time.monotonic()
        if now - self._hits_flushed.get(key, float("-inf")) < 10:
            return
        hits = self._hits.pop(key)
        self._hits_flushed[key] = now
        if len(self._hits_flushed) > 5000:
            self._hits_flushed.clear()
        try:
            await self._block_ref(tenant_id, ip).update(
                {"hits": firestore.Increment(hits), "lastHitAt": firestore.SERVER_TIMESTAMP})
        except Exception:
            pass  # only a counter (and the block may have just been lifted): never fail the decision
