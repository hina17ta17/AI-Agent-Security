import { FieldValue } from "firebase-admin/firestore";

import { requireEditor } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

/**
 * Deleting one attack record (the incident with its step-by-step record and report) at the owner's
 * request. Not deletable here: an investigation still running or waiting for the owner's approval,
 * and the record of actions and of sign-ins, which are the evidence if an account is ever taken
 * over. The deletion itself is written to the record of actions. Blocks are not touched.
 */
export async function DELETE(request: Request) {
  return handle("history", async () => {
    const { uid } = await requireEditor(request);
    const { incidentId } = await readJson<{ incidentId?: unknown }>(request);
    if (typeof incidentId !== "string" || !/^[\w-]{6,80}$/.test(incidentId)) throw new HttpError(400, "不明な記録です");
    const tenant = tenantRef(uid);
    const ref = tenant.collection("incidents").doc(incidentId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "この記録は見つかりません（すでに削除されています）");
    const status = snap.get("status");
    if (status === "analyzing") {
      throw new HttpError(409, "AIチームが対応している最中なので、まだ削除できません。終わってからもう一度お試しください。");
    }
    const pending = await tenant.collection("approvals").where("incidentId", "==", incidentId).where("status", "==", "pending").limit(1).get();
    if (status === "awaiting_approval" || !pending.empty) {
      throw new HttpError(409, "あなたの承認を待っている記録なので、削除できません。先に承認か却下をしてください。");
    }
    // The step-by-step record goes with it (Firestore does not delete sub-collections by itself).
    const steps = await ref.collection("steps").get();
    for (let i = 0; i < steps.docs.length; i += 400) {
      const batch = tenant.firestore.batch();
      steps.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    const batch = tenant.firestore.batch();
    batch.delete(ref);
    if ((await tenant.get()).get("activeIncidentId") === incidentId) batch.update(tenant, { activeIncidentId: FieldValue.delete() });
    await batch.commit();
    await audit(uid, "delete_history", { reasonJa: (snap.get("attack.labelJa") as string | undefined) ?? "攻撃の記録", incidentId },
                { status: "deleted" });
    return json({ ok: true });
  });
}
