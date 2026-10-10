import { adminAuth } from "./admin";
import { HttpError } from "./http";

/**
 * Every API call carries the Firebase ID token in the Authorization header (no cookies,
 * so cross-site request forgery does not apply). The tenant is always the token's uid.
 */
export async function requireUser(request: Request): Promise<{ uid: string }> {
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "ログインが必要です");
  try {
    const decoded = await adminAuth().verifyIdToken(match[1]);
    return { uid: decoded.uid };
  } catch {
    throw new HttpError(401, "ログインの有効期限が切れました。もう一度ログインしてください。");
  }
}
