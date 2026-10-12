
import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

const MAX = 10000;

/**
 * The daily AI-run cap for the owner's own Gemini key (BYOK). `limit` is a positive integer, or
 * null for "no limit". It only bounds runs that use the owner's key and money; the demo caps
 * (per day and per account) are fixed and enforced in the agent, not here.
 */
export async function POST(request: Request) {
  return handle("limits", async () => {
    const { uid } = await requireUser(request);
    const { limit } = await readJson<{ limit?: unknown }>(request);
    let value: number | null;
    if (limit === null) {
      value = null; // unlimited
    } else if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= MAX) {
      value = limit;
    } else {
      throw new HttpError(400, `回数は1〜${MAX}の整数、または「制限なし」にしてください`);
    }
    await tenantRef(uid).set({ byokDailyLimit: value }, { merge: true });
    await audit(uid, "set_byok_limit", { limit: value }, { status: "ok" });
    return json({ byokDailyLimit: value });
  });
}
