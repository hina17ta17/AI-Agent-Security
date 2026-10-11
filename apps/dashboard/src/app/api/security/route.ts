import { FieldValue } from "firebase-admin/firestore";

import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

/**
 * Account protection actions.
 *   ack:    "that sign-in was me" — hides the new-device warning
 *   revoke: "I don't recognize it" — every existing session (including this one) stops working
 */
export async function POST(request: Request) {
  return handle("security", async () => {
    const { uid } = await requireUser(request);
    const { action } = await readJson<{ action?: string }>(request);
    if (action === "ack") {
      await tenantRef(uid).set({ security: { acknowledgedAt: FieldValue.serverTimestamp() } }, { merge: true });
      await audit(uid, "confirm_sign_in", {}, { status: "acknowledged" });
      return json({ ok: true });
    }
    if (action === "revoke") {
      const cutoff = Math.floor(Date.now() / 1000);
      await tenantRef(uid).set(
        { sessionsValidAfter: cutoff, security: { acknowledgedAt: FieldValue.serverTimestamp() } },
        { merge: true },
      );
      await audit(uid, "sign_out_everywhere", {}, { status: "all_sessions_revoked" });
      return json({ ok: true });
    }
    throw new HttpError(400, "不明な操作です");
  });
}
