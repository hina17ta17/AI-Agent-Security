
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db } from "./admin";
import { HttpError } from "./http";

export type TenantDoc = {
  siteMode: "normal" | "maintenance";
  aiMode: "demo" | "byok";
  keyStatus: "none" | "valid" | "invalid";
  keyHint: string | null;
  status: string;
  lastAttackerIp?: string;
  settings?: { allowlist?: string[] };
};

export const tenantRef = (uid: string) => db().collection("tenants").doc(uid);

export async function ensureTenant(uid: string): Promise<TenantDoc> {
  const ref = tenantRef(uid);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.data() as TenantDoc | undefined;
    if (existing?.aiMode) return existing;
    const fresh: TenantDoc = {
      siteMode: "normal",
      aiMode: "demo",
      keyStatus: "none",
      keyHint: null,
      status: "safe",
      settings: { allowlist: [] },
    };
    tx.set(ref, { ...fresh, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    return fresh;
  });
}

export async function getTenant(uid: string): Promise<TenantDoc> {
  const snap = await tenantRef(uid).get();
  if (!snap.exists) throw new HttpError(404, "アカウントの準備ができていません。ページを再読み込みしてください。");
  return snap.data() as TenantDoc;
}

const ACTIVE_STALE_MS = 300_000; // same as the agent's ACTIVE_STALE_SEC

/**
 * Recompute the tenant status with the agent's rule: "responding" while any AI investigation
 * is still running (several can run at once), then "awaiting_approval", otherwise "safe".
 */
export async function settleStatus(uid: string) {
  const ref = tenantRef(uid);
  const pendingQuery = ref.collection("approvals").where("status", "==", "pending").limit(1);
  await db().runTransaction(async (tx) => {
    const [snap, pending] = await Promise.all([tx.get(ref), tx.get(pendingQuery)]);
    const active = Object.values((snap.get("active") ?? {}) as Record<string, unknown>)
      .filter((at) => at instanceof Timestamp && Date.now() - at.toMillis() < ACTIVE_STALE_MS).length;
    const status = active > 0 ? "responding" : pending.empty ? "safe" : "awaiting_approval";
    tx.set(ref, { status, statusAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

/** Every human action is recorded next to the AI's actions (same audit trail). */
export async function audit(
  uid: string,
  action: string,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
  incidentId: string | null = null,
  actor = "user", // "owner": AgentGuard's manager acting on AgentGuard's own protection
) {
  await tenantRef(uid).collection("audit").add({
    actor,
    action,
    params,
    result,
    incidentId,
    at: FieldValue.serverTimestamp(),
  });
}
