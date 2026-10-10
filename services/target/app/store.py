"""Firestore reads the WAF needs on the hot path (with small in-memory caches)."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from google.cloud import firestore

SITE_ID_RE = re.compile(r"^[a-z0-9]{8,32}$")


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
        self._sites = _TTLCache()
        self._tenants = _TTLCache()

    async def tenant_for_site(self, site_id: str) -> str | None:
        if not SITE_ID_RE.match(site_id):
            return None
        found, tenant_id = self._sites.get(site_id)
        if found:
            return tenant_id
        snap = await self.db.collection("sites").document(site_id).get()
        tenant_id = (snap.to_dict() or {}).get("tenantId") if snap.exists else None
        self._sites.put(site_id, tenant_id, ttl=300 if tenant_id else 30)
        return tenant_id

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
        await self._block_ref(tenant_id, ip).update(
            {"hits": firestore.Increment(1), "lastHitAt": firestore.SERVER_TIMESTAMP}
        )
