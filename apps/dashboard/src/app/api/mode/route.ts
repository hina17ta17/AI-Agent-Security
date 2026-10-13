import { requireEditor } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, getTenant, tenantRef } from "@/lib/server/tenant";

/** Switch between the demo mode and the tenant's own key. */
export async function POST(request: Request) {
  return handle("mode", async () => {
    const { uid } = await requireEditor(request);
    const { mode } = await readJson<{ mode?: string }>(request);
    if (mode !== "demo" && mode !== "byok") throw new HttpError(400, "不明なモードです");
    const tenant = await getTenant(uid);
    if (mode === "byok" && tenant.keyStatus !== "valid") {
      throw new HttpError(400, "先に設定画面で有効な APIキーを登録してください");
    }
    await tenantRef(uid).set({ aiMode: mode }, { merge: true });
    await audit(uid, "switch_ai_mode", { mode }, { status: "ok" });
    return json({ aiMode: mode });
  });
}
