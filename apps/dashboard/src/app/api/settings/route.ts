import { isIP } from "node:net";

import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { audit, tenantRef } from "@/lib/server/tenant";

const MAX_ENTRIES = 20;

function validCidr(entry: string): boolean {
  const [ip, prefix, extra] = entry.split("/");
  if (extra !== undefined || !ip) return false;
  const family = isIP(ip);
  if (!family) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return family === 4 ? bits >= 8 && bits <= 32 : bits >= 16 && bits <= 128;
}

/** Allowlisted addresses are never blocked by the AI team (enforced in the agent's tool code). */
export async function POST(request: Request) {
  return handle("settings", async () => {
    const { uid } = await requireUser(request);
    const { allowlist } = await readJson<{ allowlist?: unknown }>(request);
    if (!Array.isArray(allowlist)) throw new HttpError(400, "許可リストの形式が正しくありません");
    const entries = [...new Set(allowlist.map((e) => String(e).trim()).filter(Boolean))];
    if (entries.length > MAX_ENTRIES) throw new HttpError(400, `許可リストは${MAX_ENTRIES}件までです`);
    const invalid = entries.filter((e) => !validCidr(e));
    if (invalid.length) throw new HttpError(400, `正しくない形式があります：${invalid.slice(0, 3).join("、")}`);
    await tenantRef(uid).set({ settings: { allowlist: entries } }, { merge: true });
    await audit(uid, "update_allowlist", { count: entries.length }, { status: "ok" });
    return json({ allowlist: entries });
  });
}
