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
  tenants/{t}/campaigns/{c}           an attack wave (many attacks at once) + blocks subcollection
  tenants/{t}.active                  {incidentId: startedAt} of the AI investigations running now
  tenantSecrets/{t}                   KMS ciphertext of the BYOK key (never readable by clients)
  usage/{yyyymmdd}                    global demo-mode counter (never readable by clients)
"""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from google.api_core.exceptions import Aborted, AlreadyExists
from google.cloud import firestore

from .concurrency import derive_status, is_open, prune_active

JST = timezone(timedelta(hours=9))
TXN_ATTEMPTS = 12  # commit retries inside one transaction (default 5): a wave touches the tenant document at once
TXN_RETRIES = 6  # whole-transaction retries for aborts raised while reading


def today_key(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(JST).strftime("%Y%m%d")


def _is_contention(exc: BaseException) -> bool:
    """Firestore aborted the transaction because others touched the same documents."""
    seen = 0
    while exc is not None and seen < 4:
        if isinstance(exc, Aborted):
            return True
        exc, seen = exc.__cause__ or exc.__context__, seen + 1
    return False


class Store:
    def __init__(self, db: firestore.AsyncClient):
        self.db = db

    async def _transact(self, txn):
        """Run a @async_transactional function, retrying contention.

        The client library retries aborted commits, but an abort raised while reading inside the
        transaction escapes. Bursts of attacks make many events touch the same tenant and usage
        documents at once, so those are retried here with a short jittered pause.
        """
        for attempt in range(1, TXN_RETRIES + 1):
            try:
                return await txn(self.db.transaction(max_attempts=TXN_ATTEMPTS))
            except Exception as exc:
                if attempt == TXN_RETRIES or not _is_contention(exc):
                    raise
                await asyncio.sleep(random.uniform(0.05, 0.2) * attempt)

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

    def _group_ref(self, t: str, ip: str, attack_type: str):
        return self.tenant(t).collection("dedupe").document(f"{ip}_{attack_type}")

    async def find_open_group(self, t: str, ip: str, attack_type: str) -> str | None:
        """The open incident for the same IP + attack type, if any (a plain read, no transaction)."""
        snap = await self._group_ref(t, ip, attack_type).get()
        data = snap.to_dict() if snap.exists else None
        if data and data.get("expiresAt") and data["expiresAt"] > datetime.now(timezone.utc):
            return data.get("incidentId")
        return None

    # ------------------------------------------------------------------ concurrent investigations
    async def admit(self, t: str, ip: str, attack_type: str, incident_id: str, *, cap: int, stale_sec: int,
                    window_sec: int) -> tuple[str, str | None]:
        """One atomic decision for a new event.

        ("grouped", id)  the same IP + attack type already has an open incident: count it there
        ("admitted", None)  an AI slot was reserved and the group registered for this incident
        ("full", None)  every AI slot of the tenant is busy: the event joins the attack wave
        """
        tref, gref = self.tenant(t), self._group_ref(t, ip, attack_type)
        now = datetime.now(timezone.utc)

        @firestore.async_transactional
        async def txn(transaction):
            gsnap = await gref.get(transaction=transaction)
            group = gsnap.to_dict() if gsnap.exists else None
            if group and group.get("expiresAt") and group["expiresAt"] > now:
                return "grouped", group.get("incidentId")
            tsnap = await tref.get(transaction=transaction)
            active = prune_active((tsnap.to_dict() or {}).get("active"), now, stale_sec)
            if len(active) >= cap:
                return "full", None
            active[incident_id] = now
            transaction.set(gref, {"incidentId": incident_id, "expiresAt": now + timedelta(seconds=window_sec)})
            # update() replaces the whole map, so stale entries are dropped as well.
            transaction.update(tref, {"active": active, "status": "responding", "activeIncidentId": incident_id,
                                      "statusAt": firestore.SERVER_TIMESTAMP})
            return "admitted", None

        return await self._transact(txn)

    async def finish_ai(self, t: str, incident_id: str, stale_sec: int) -> str:
        """Release the slot and derive the tenant status from what is still running or pending."""
        ref = self.tenant(t)
        pending_q = ref.collection("approvals").where(
            filter=firestore.FieldFilter("status", "==", "pending")).limit(1)

        @firestore.async_transactional
        async def txn(transaction):
            snap = await ref.get(transaction=transaction)
            active = prune_active((snap.to_dict() or {}).get("active"), datetime.now(timezone.utc), stale_sec)
            active.pop(incident_id, None)
            pending = False
            async for _ in pending_q.stream(transaction=transaction):
                pending = True
            status = derive_status(len(active), pending)
            transaction.update(ref, {"active": active, "status": status, "statusAt": firestore.SERVER_TIMESTAMP})
            return status

        return await self._transact(txn)

    # ------------------------------------------------------------------ attack waves
    def campaign(self, t: str, cid: str):
        return self.tenant(t).collection("campaigns").document(cid)

    async def get_campaign(self, t: str, cid: str) -> dict | None:
        snap = await self.campaign(t, cid).get()
        return snap.to_dict() if snap.exists else None

    async def open_campaign(self, t: str, idle_sec: int, stale_sec: int) -> str:
        """The tenant's current attack wave, or a new one. Concurrent callers converge on one wave.

        A new wave starts with the AI investigations running at that moment (its representatives).
        """
        ref = self.tenant(t)
        now = datetime.now(timezone.utc)
        current = (await ref.get()).to_dict() or {}
        cid = current.get("campaignId")
        if cid:
            wave = await self.get_campaign(t, cid)
            if wave and is_open(wave.get("lastEventAt"), now, idle_sec):
                return cid

        @firestore.async_transactional
        async def txn(transaction):
            snap = await ref.get(transaction=transaction)
            data = snap.to_dict() or {}
            latest = data.get("campaignId")
            if latest and latest != cid:
                return latest  # another event opened a new wave meanwhile
            new_id = f"wave-{now.astimezone(JST):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
            transaction.set(self.campaign(t, new_id), {
                "id": new_id, "openedAt": now, "lastEventAt": now, "events": 0, "ruleBlocks": 0,
                "extendedBlocks": 0, "byType": {}, "ips": [],
                "analyzedIncidents": sorted(prune_active(data.get("active"), now, stale_sec)), "aiDecisions": {},
            })
            transaction.update(ref, {"campaignId": new_id})
            return new_id

        return await self._transact(txn)

    async def record_wave_event(self, t: str, cid: str, ip: str, attack_type: str, minutes: int | None,
                                source: str, block_sec: float | None = None) -> None:
        """Count one event of the wave; field transforms avoid read-modify-write contention.

        block_sec: seconds from the WAF detection to the rule block being in place.
        """
        update: dict[str, Any] = {
            "events": firestore.Increment(1),
            f"byType.{attack_type}": firestore.Increment(1),
            "ips": firestore.ArrayUnion([ip]),
            "lastEventAt": firestore.SERVER_TIMESTAMP,
        }
        if minutes:
            update["ruleBlocks"] = firestore.Increment(1)
            if block_sec is not None:
                update["timedBlocks"] = firestore.Increment(1)
                update["blockSecTotal"] = firestore.Increment(block_sec)
                update["blockSecMax"] = firestore.Maximum(block_sec)
        await self.campaign(t, cid).update(update)
        if minutes:
            await self.campaign(t, cid).collection("blocks").document(ip).set(
                {"ip": ip, "type": attack_type, "minutes": minutes, "source": source, "blockSec": block_sec,
                 "at": firestore.SERVER_TIMESTAMP}, merge=True)

    async def extend_wave_block(self, t: str, cid: str, ip: str, minutes: int, incident_id: str) -> None:
        """Lengthen one rule block of the wave to the AI's decision (block_ip never shortens)."""
        await self.block_ip(t, ip, minutes, f"（攻撃の波）AIの判断に合わせて{minutes}分に延長", incident_id, "system:wave")
        await self.campaign(t, cid).collection("blocks").document(ip).set(
            {"minutes": minutes, "source": "ai", "extendedAt": firestore.SERVER_TIMESTAMP}, merge=True)
        await self.campaign(t, cid).update({"extendedBlocks": firestore.Increment(1)})

    async def record_campaign_decision(self, t: str, cid: str, attack_type: str, minutes: int, severity: str,
                                       incident_id: str) -> list[str]:
        """Remember the AI's decision for this attack type and extend shorter rule blocks of the wave."""
        ref = self.campaign(t, cid)
        wave = await self.get_campaign(t, cid) or {}
        current = ((wave.get("aiDecisions") or {}).get(attack_type) or {}).get("minutes") or 0
        update: dict[str, Any] = {"analyzedIncidents": firestore.ArrayUnion([incident_id])}
        if minutes > current:
            update[f"aiDecisions.{attack_type}"] = {"minutes": minutes, "severity": severity, "incidentId": incident_id}
        await ref.update(update)
        # Written before the scan below: wave events that record their block later re-check the decision.
        blocks = ref.collection("blocks").where(filter=firestore.FieldFilter("type", "==", attack_type))
        shorter = [d for d in [b.to_dict() or {} async for b in blocks.stream()]
                   if d.get("source") == "policy" and int(d.get("minutes") or 0) < minutes]
        limit = asyncio.Semaphore(8)

        async def extend(ip: str) -> None:
            async with limit:
                await self.extend_wave_block(t, cid, ip, minutes, incident_id)

        await asyncio.gather(*(extend(d["ip"]) for d in shorter))
        return [d["ip"] for d in shorter]

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

        return await self._transact(txn)

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

    async def bump_ip_history(self, t: str, ip: str, incident_id: str) -> None:
        await self.tenant(t).collection("ipHistory").document(ip).set(
            {"incidents": firestore.Increment(1), "lastIncidentId": incident_id,
             "lastAt": firestore.SERVER_TIMESTAMP}, merge=True
        )

    # ------------------------------------------------------------------ defenses
    async def block_ip(self, t: str, ip: str, minutes: int, reason_ja: str, incident_id: str | None,
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

        return await self._transact(txn)

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
