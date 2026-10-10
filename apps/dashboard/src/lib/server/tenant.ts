import { randomBytes } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "./admin";
import { HttpError } from "./http";

export type TenantDoc = {
  siteId: string;
  siteMode: "normal" | "maintenance";
  aiMode: "demo" | "byok";
  keyStatus: "none" | "valid" | "invalid";
  keyHint: string | null;
  status: string;
  lastAttackerIp?: string;
  settings?: { allowlist?: string[] };
};

const SITE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newSiteId(): string {
  // 14 chars from 36 symbols (~72 bits): not guessable, matches the target's ^[a-z0-9]{8,32}$
  return Array.from(randomBytes(14), (b) => SITE_ALPHABET[b % SITE_ALPHABET.length]).join("");
}

export const tenantRef = (uid: string) => db().collection("tenants").doc(uid);

export async function ensureTenant(uid: string): Promise<TenantDoc> {
  const ref = tenantRef(uid);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.data() as TenantDoc | undefined;
    if (existing?.siteId) return existing;
    const siteId = newSiteId();
    const fresh: TenantDoc = {
      siteId,
      siteMode: "normal",
      aiMode: "demo",
      keyStatus: "none",
      keyHint: null,
      status: "safe",
      settings: { allowlist: [] },
    };
    tx.set(ref, { ...fresh, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db().collection("sites").doc(siteId), { tenantId: uid, createdAt: FieldValue.serverTimestamp() });
    return fresh;
  });
}

export async function getTenant(uid: string): Promise<TenantDoc> {
  const snap = await tenantRef(uid).get();
  if (!snap.exists) throw new HttpError(404, "アカウントの準備ができていません。ページを再読み込みしてください。");
  return snap.data() as TenantDoc;
}

/** Every human action is recorded next to the AI's actions (same audit trail). */
export async function audit(
  uid: string,
  action: string,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
  incidentId: string | null = null,
) {
  await tenantRef(uid).collection("audit").add({
    actor: "user",
    action,
    params,
    result,
    incidentId,
    at: FieldValue.serverTimestamp(),
  });
}
