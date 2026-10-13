import { parseAllowlist } from "@/lib/server/allowlist";
import { requireEditor } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

/** Allowlisted addresses are never blocked by the AI team (enforced in the agent's tool code). */
export async function POST(request: Request) {
  return handle("settings", async () => {
    const { uid } = await requireEditor(request);
    const { allowlist } = await readJson<{ allowlist?: unknown }>(request);
    const entries = parseAllowlist(allowlist);
    await tenantRef(uid).set({ settings: { allowlist: entries } }, { merge: true });
    await audit(uid, "update_allowlist", { count: entries.length }, { status: "ok" });
    return json({ allowlist: entries });
  });
}
