import { FieldValue } from "firebase-admin/firestore";

import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

/** Ends maintenance mode early (human-only). */
export async function POST(request: Request) {
  return handle("site", async () => {
    const { uid } = await requireUser(request);
    const { action } = await readJson<{ action?: string }>(request);
    if (action !== "restore") throw new HttpError(400, "不明な操作です");
    await tenantRef(uid).set({ siteMode: "normal", maintenanceUntil: FieldValue.delete() }, { merge: true });
    await audit(uid, "restore_site", {}, { status: "site_normal" });
    return json({ ok: true });
  });
}
