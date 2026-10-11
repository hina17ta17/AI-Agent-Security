import { adminAuth, db } from "./admin";
import { HttpError } from "./http";

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
