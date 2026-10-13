import { adminAuth, db } from "./admin";
import { env } from "./env";
import { HttpError } from "./http";

/**
 * requireUser for actions that change something. AgentGuard's own account (the one that receives
 * the dashboard's own incidents) is read-only for everyone: even with its password, nobody can
 * change its site, keys, AI mode, limits, allowlist or blocks, or approve anything for it. Only the
 * code (the agent and the WAF, as service accounts) writes to it.
 */
export async function requireEditor(request: Request): Promise<{ uid: string; authTime: number }> {
  const user = await requireUser(request);
  const self = env.selfTenantId();
  if (self && user.uid === self) {
    throw new HttpError(403, "AgentGuard 自身の守りは、だれも変更できません（このアカウントは読み取り専用です）");
  }
  return user;
}

/**
 * Every API call carries the Firebase ID token in the Authorization header (no cookies,
 * so cross-site request forgery does not apply). The tenant is always the token's uid.
 *
 * "Sign out everywhere" sets tenants/{uid}.sessionsValidAfter: tokens from sign-ins before that
 * moment are refused here (and by the Firestore rules), so a stolen session stops working at once.
 */
export async function requireUser(request: Request): Promise<{ uid: string; authTime: number }> {
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "ログインが必要です");
  let uid: string;
  let authTime: number;
  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    uid = decoded.uid;
    authTime = decoded.auth_time;
  } catch {
    throw new HttpError(401, "ログインの有効期限が切れました。もう一度ログインしてください。");
  }
  const cutoff = (await db().collection("tenants").doc(uid).get()).get("sessionsValidAfter");
  if (typeof cutoff === "number" && authTime < cutoff) {
    throw new HttpError(401, "すべての端末からログアウトされました。もう一度ログインしてください。");
  }
  return { uid, authTime };
}
