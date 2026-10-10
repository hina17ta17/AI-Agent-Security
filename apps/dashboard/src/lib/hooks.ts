"use client";

import {
  collection,
  doc,
  type DocumentData,
  type DocumentReference,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Query,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";

import { useSession } from "./auth-context";
import type { Approval, AuditEntry, BlockEntry, Incident, Step, Tenant, Usage } from "./types";

type Live<T> = { data: T; loading: boolean; error: string | null };

// Results are stored together with the key they belong to; state is only ever set from
// Firestore callbacks, and "loading" is derived (no synchronous setState inside effects).
type Keyed<T> = { key: string | null; data: T; error: string | null };

function useLiveQuery<T>(key: string | null, build: () => Query<DocumentData>): Live<(T & { id: string })[]> {
  const [state, setState] = useState<Keyed<(T & { id: string })[]>>({ key: null, data: [], error: null });
  useEffect(() => {
    if (!key) return;
    return onSnapshot(
      build(),
      (snap) => setState({ key, data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })), error: null }),
      (err) => setState({ key, data: [], error: err.message }),
    );
    // `key` fully describes the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return { data: [], loading: false, error: null };
  const current = state.key === key;
  return { data: current ? state.data : [], loading: !current, error: current ? state.error : null };
}

function useLiveDoc<T>(key: string | null, build: () => DocumentReference<DocumentData>): Live<(T & { id: string }) | null> {
  const [state, setState] = useState<Keyed<(T & { id: string }) | null>>({ key: null, data: null, error: null });
  useEffect(() => {
    if (!key) return;
    return onSnapshot(
      build(),
      (snap) => setState({ key, data: snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null, error: null }),
      (err) => setState({ key, data: null, error: err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return { data: null, loading: false, error: null };
  const current = state.key === key;
  return { data: current ? state.data : null, loading: !current, error: current ? state.error : null };
}

export function useTenant(): Live<Tenant | null> {
  const { db, uid } = useSession();
  return useLiveDoc<Tenant>(`tenant/${uid}`, () => doc(db, "tenants", uid));
}

export function useIncidents(max = 20) {
  const { db, uid } = useSession();
  return useLiveQuery<Incident>(`incidents/${uid}/${max}`, () =>
    query(collection(db, "tenants", uid, "incidents"), orderBy("createdAt", "desc"), limit(max)));
}

export function useIncident(id: string | null) {
  const { db, uid } = useSession();
  return useLiveDoc<Incident>(id ? `incident/${uid}/${id}` : null, () => doc(db, "tenants", uid, "incidents", id!));
}

export function useSteps(incidentId: string | null) {
  const { db, uid } = useSession();
  return useLiveQuery<Step>(incidentId ? `steps/${uid}/${incidentId}` : null, () =>
    query(collection(db, "tenants", uid, "incidents", incidentId!, "steps"), orderBy("seq")));
}

export function useBlocklist() {
  const { db, uid } = useSession();
  return useLiveQuery<BlockEntry>(`blocklist/${uid}`, () =>
    query(collection(db, "tenants", uid, "blocklist"), orderBy("expiresAt", "desc"), limit(50)));
}

export function usePendingApprovals() {
  const { db, uid } = useSession();
  return useLiveQuery<Approval>(`approvals/${uid}`, () =>
    query(collection(db, "tenants", uid, "approvals"), where("status", "==", "pending"), limit(10)));
}

export function useAudit(incidentId: string) {
  const { db, uid } = useSession();
  return useLiveQuery<AuditEntry>(`audit/${uid}/${incidentId}`, () =>
    query(collection(db, "tenants", uid, "audit"), where("incidentId", "==", incidentId), limit(50)));
}

function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date()).replaceAll("-", "");
}

export function useUsageToday(): Usage | null {
  const { db, uid } = useSession();
  const day = todayJst();
  return useLiveDoc<Usage>(`usage/${uid}/${day}`, () => doc(db, "tenants", uid, "usage", day)).data;
}

/** Re-renders every `ms` so countdowns and "n秒前" stay fresh. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
