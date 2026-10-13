import { isIP } from "node:net";

import { requireEditor } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

/** Unblocking is a human-only action: the AI team has no tool that can loosen a defense. */
export async function DELETE(request: Request) {
  return handle("blocklist", async () => {
    const { uid } = await requireEditor(request);
    const { ip } = await readJson<{ ip?: string }>(request);
    if (typeof ip !== "string" || !isIP(ip)) throw new HttpError(400, "IPアドレスの形式が正しくありません");
    const ref = tenantRef(uid).collection("blocklist").doc(ip);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "このIPはブロックされていません");
    await ref.delete();
    await audit(uid, "unblock_ip", { ip }, { status: "unblocked" }, (snap.data()?.incidentId as string) ?? null);
    return json({ ok: true });
  });
}
