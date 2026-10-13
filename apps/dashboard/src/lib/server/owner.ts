import { createHash, timingSafeEqual } from "node:crypto";

import { FieldValue, type Timestamp } from "firebase-admin/firestore";

import { db } from "./admin";
import { requireUser } from "./auth";
import { env } from "./env";
import { HttpError } from "./http";

/**
 * AgentGuard's manager: exactly one account that may see AgentGuard's own protection in detail and
 * manage it (unblock, allowlist). Nobody else can, and the self-protection account itself stays
 * read-only. The manager is the first account to enter the one-time manager code, which the operator
 * hands only to the project owner; after one use the code is gone, so nobody else can become manager.
 *
 * Both documents live in config/, which the Firestore rules deny to every browser.
 */
const ownerRef = () => db().collection("config").doc("selfOwner");
const claimRef = () => db().collection("config").doc("selfOwnerClaim");

export async function selfOwnerUid(): Promise<string | null> {
  const snap = await ownerRef().get();
  return (snap.get("uid") as string | undefined) ?? null;
}

/** requireUser, and the caller must be AgentGuard's manager. */
export async function requireSelfOwner(request: Request): Promise<{ uid: string; selfTenantId: string }> {
  const { uid } = await requireUser(request);
  const selfTenantId = env.selfTenantId();
  if (!selfTenantId) throw new HttpError(404, "AgentGuard 自身の守りが設定されていません");
  if ((await selfOwnerUid()) !== uid) throw new HttpError(403, "AgentGuard の管理者だけが使えます");
  return { uid, selfTenantId };
}

/** Make `uid` the manager if the code matches and nobody is manager yet. The code works once. */
export async function claimSelfOwner(uid: string, code: string): Promise<void> {
  if (env.selfTenantId() === uid) throw new HttpError(403, "このアカウントは管理者になれません");
  const given = createHash("sha256").update(code.trim()).digest();
  await db().runTransaction(async (tx) => {
    const [owner, claim] = await Promise.all([tx.get(ownerRef()), tx.get(claimRef())]);
    if (owner.exists) throw new HttpError(409, "AgentGuard の管理者は、すでに決まっています");
    const stored = claim.get("codeHash") as string | undefined;
    const expires = claim.get("expiresAt") as Timestamp | undefined;
    if (!stored || !/^[a-f0-9]{64}$/.test(stored) || !expires || expires.toMillis() < Date.now()) {
      throw new HttpError(400, "管理者コードが有効ではありません（使用済み・期限切れの可能性があります）");
    }
    if (!timingSafeEqual(Buffer.from(stored, "hex"), given)) throw new HttpError(400, "管理者コードが違います");
    tx.set(ownerRef(), { uid, claimedAt: FieldValue.serverTimestamp() });
    tx.delete(claimRef()); // one use only
  });
}
