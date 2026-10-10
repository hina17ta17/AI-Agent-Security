import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { db } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

/**
 * Human-in-the-loop: the AI can only REQUEST site isolation; it happens here, when a human approves.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/approvals/[id]">) {
  return handle("approvals", async () => {
    const { uid } = await requireUser(request);
    const { id } = await ctx.params;
    const { decision } = await readJson<{ decision?: string }>(request);
    if (decision !== "approve" && decision !== "reject") throw new HttpError(400, "不明な操作です");
    if (!/^[a-f0-9]{8,32}$/.test(id)) throw new HttpError(400, "不明な承認IDです");

    const tenant = tenantRef(uid);
    const approvalRef = tenant.collection("approvals").doc(id);
    const outcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(approvalRef);
      if (!snap.exists) throw new HttpError(404, "承認依頼が見つかりません");
      const approval = snap.data()!;
      if (approval.status !== "pending") throw new HttpError(409, "この依頼はすでに処理されています");
      const minutes = Math.max(10, Math.min(Number(approval.minutes) || 30, 120));
      let until: Date | null = null;
      if (decision === "approve" && approval.action === "isolate_site") {
        until = new Date(Date.now() + minutes * 60_000);
        tx.set(tenant, { siteMode: "maintenance", maintenanceUntil: Timestamp.fromDate(until) }, { merge: true });
      }
      tx.update(approvalRef, {
        status: decision === "approve" ? "approved" : "rejected",
        decidedBy: "user",
        decidedAt: FieldValue.serverTimestamp(),
      });
      if (approval.incidentId) {
        tx.set(tenant.collection("incidents").doc(approval.incidentId), {
          status: "resolved",
          approvalDecision: decision,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { action: approval.action as string, incidentId: (approval.incidentId as string) ?? null, minutes, until };
    });

    const pending = await tenant.collection("approvals").where("status", "==", "pending").limit(1).get();
    if (pending.empty) await tenant.set({ status: "safe" }, { merge: true });
    await audit(uid, decision === "approve" ? "approve_isolation" : "reject_isolation",
      { approvalId: id, minutes: outcome.minutes },
      { status: decision === "approve" ? "site_in_maintenance" : "rejected", until: outcome.until?.toISOString() ?? null },
      outcome.incidentId);
    return json({ ok: true, decision, until: outcome.until?.toISOString() ?? null });
  });
}
