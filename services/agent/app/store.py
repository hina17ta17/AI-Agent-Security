"""Firestore persistence for incidents, live steps, defenses, approvals, audit and quotas.

Layout (all tenant data is readable by its owner in the dashboard; see infra/firestore.rules):
  tenants/{t}                         status, aiMode, keyStatus, settings ...
  tenants/{t}/incidents/{i}           one incident (+ steps subcollection for the live feed)
  tenants/{t}/blocklist/{ip}          enforced by the WAF on every request (TTL: expiresAt)
  tenants/{t}/watchlist/{ip}
  tenants/{t}/approvals/{a}           actions that wait for a human
  tenants/{t}/audit/{x}               who did what, why, and the result
  tenants/{t}/usage/{yyyymmdd}        AI runs per day
  tenants/{t}/eventLog/{eventId}      idempotency for Pub/Sub redeliveries
  tenants/{t}/dedupe/{ip_type}        groups bursts of the same attack into one incident
  tenantSecrets/{t}                   KMS ciphertext of the BYOK key (never readable by clients)
  usage/{yyyymmdd}                    global demo-mode counter (never readable by clients)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from google.api_core.exceptions import AlreadyExists
from google.cloud import firestore

JST = timezone(timedelta(hours=9))


def today_key(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(JST).strftime("%Y%m%d")


class Store:
    def __init__(self, db: firestore.AsyncClient):
        self.db = db

    # ------------------------------------------------------------------ refs
    def tenant(self, t: str):
        return self.db.collection("tenants").document(t)

    def incident(self, t: str, i: str):
        return self.tenant(t).collection("incidents").document(i)

    # ------------------------------------------------------------------ reads
    async def get_tenant(self, t: str) -> dict | None:
        snap = await self.tenant(t).get()
        return snap.to_dict() if snap.exists else None

    async def get_secret(self, t: str) -> dict | None:
        snap = await self.db.collection("tenantSecrets").document(t).get()
        return snap.to_dict() if snap.exists else None

    async def ip_history(self, t: str, ip: str) -> dict:
        snap = await self.tenant(t).collection("ipHistory").document(ip).get()
        return snap.to_dict() or {}

    # ------------------------------------------------------------------ idempotency / grouping
    async def claim_event(self, t: str, event_id: str) -> bool:
        """False if this Pub/Sub event was already processed (redelivery)."""
        try:
            await self.tenant(t).collection("eventLog").document(event_id).create(
                {"at": firestore.SERVER_TIMESTAMP, "expiresAt": datetime.now(timezone.utc) + timedelta(days=2)}
            )
            return True
        except AlreadyExists:
            return False

    async def group_or_open(self, t: str, ip: str, attack_type: str, new_incident_id: str,
                            window_sec: int) -> str | None:
        """Return the open incident id for the same IP+attack within the window, else register ours."""
        ref = self.tenant(t).collection("dedupe").document(f"{ip}_{attack_type}")
        now = datetime.now(timezone.utc)

        @firestore.async_transactional
        async def txn(transaction):
            snap = await ref.get(transaction=transaction)
            data = snap.to_dict() if snap.exists else None
            if data and data.get("expiresAt") and data["expiresAt"] > now:
                return data["incidentId"]
            transaction.set(ref, {"incidentId": new_incident_id, "expiresAt": now + timedelta(seconds=window_sec)})
            return None

        return await txn(self.db.transaction())

    async def consume_quota(self, t: str, mode: str, per_tenant: int, global_limit: int | None) -> tuple[bool, int, int]:
        """Atomically count one AI run. Returns (allowed, used_after, limit)."""
        day = today_key()
        tref = self.tenant(t).collection("usage").document(day)
        gref = self.db.collection("usage").document(day) if global_limit is not None else None

        @firestore.async_transactional
        async def txn(transaction):
            tsnap = await tref.get(transaction=transaction)
            used = (tsnap.to_dict() or {}).get("aiRuns", 0) if tsnap.exists else 0
            gused = 0
            if gref is not None:
                gsnap = await gref.get(transaction=transaction)
                gused = (gsnap.to_dict() or {}).get("demoRuns", 0) if gsnap.exists else 0
            if used >= per_tenant or (gref is not None and gused >= global_limit):
                return False, used, per_tenant
            transaction.set(tref, {"aiRuns": used + 1, "mode": mode, "limit": per_tenant,
                                   "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
            if gref is not None:
                transaction.set(gref, {"demoRuns": gused + 1}, merge=True)
            return True, used + 1, per_tenant

        return await txn(self.db.transaction())

    # ------------------------------------------------------------------ incidents & live feed
    async def create_incident(self, t: str, i: str, data: dict) -> None:
        await self.incident(t, i).set({**data, "createdAt": firestore.SERVER_TIMESTAMP})

    async def update_incident(self, t: str, i: str, data: dict) -> None:
        await self.incident(t, i).set({**data, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)

    async def add_related_event(self, t: str, i: str) -> None:
        await self.incident(t, i).set(
            {"relatedEvents": firestore.Increment(1), "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True
        )

    async def add_step(self, t: str, i: str, seq: int, agent: str, kind: str, text: str,
                       extra: dict | None = None) -> None:
        await self.incident(t, i).collection("steps").document(f"{seq:04d}").set(
            {"seq": seq, "agent": agent, "kind": kind, "text": text[:2000], "extra": extra or {},
             "at": firestore.SERVER_TIMESTAMP}
        )

    async def set_tenant_status(self, t: str, status: str, incident_id: str | None = None) -> None:
        data: dict[str, Any] = {"status": status, "statusAt": firestore.SERVER_TIMESTAMP}
        if incident_id is not None:
            data["activeIncidentId"] = incident_id
        await self.tenant(t).set(data, merge=True)

    async def bump_ip_history(self, t: str, ip: str, incident_id: str) -> None:
        await self.tenant(t).collection("ipHistory").document(ip).set(
            {"incidents": firestore.Increment(1), "lastIncidentId": incident_id,
             "lastAt": firestore.SERVER_TIMESTAMP}, merge=True
        )

    # ------------------------------------------------------------------ defenses
    async def block_ip(self, t: str, ip: str, minutes: int, reason_ja: str, incident_id: str,
                       by: str) -> datetime:
        """Block (or extend a block). A block is never shortened here."""
        ref = self.tenant(t).collection("blocklist").document(ip)
        until = datetime.now(timezone.utc) + timedelta(minutes=minutes)

        @firestore.async_transactional
        async def txn(transaction):
            snap = await ref.get(transaction=transaction)
            current = (snap.to_dict() or {}).get("expiresAt") if snap.exists else None
            final = max(until, current) if current else until
            transaction.set(ref, {"ip": ip, "reasonJa": reason_ja, "incidentId": incident_id, "blockedBy": by,
                                  "minutes": minutes, "expiresAt": final, "createdAt": firestore.SERVER_TIMESTAMP},
                            merge=True)
            return final

        return await txn(self.db.transaction())

    async def watch_ip(self, t: str, ip: str, reason_ja: str, incident_id: str, by: str) -> None:
        await self.tenant(t).collection("watchlist").document(ip).set(
            {"ip": ip, "reasonJa": reason_ja, "incidentId": incident_id, "watchedBy": by,
             "expiresAt": datetime.now(timezone.utc) + timedelta(hours=24), "createdAt": firestore.SERVER_TIMESTAMP},
            merge=True,
        )

    async def create_approval(self, t: str, approval_id: str, data: dict) -> None:
        await self.tenant(t).collection("approvals").document(approval_id).set(
            {**data, "status": "pending", "createdAt": firestore.SERVER_TIMESTAMP}
        )

    async def audit(self, t: str, actor: str, action: str, params: dict, result: dict,
                    incident_id: str | None = None) -> None:
        await self.tenant(t).collection("audit").add(
            {"actor": actor, "action": action, "params": params, "result": result,
             "incidentId": incident_id, "at": firestore.SERVER_TIMESTAMP}
        )

    async def mark_key_invalid(self, t: str) -> None:
        await self.tenant(t).set({"keyStatus": "invalid", "keyCheckedAt": firestore.SERVER_TIMESTAMP}, merge=True)
