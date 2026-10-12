import { connection } from "next/server";

import { db } from "@/lib/server/admin";
import { env } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";

/**
 * "AgentGuard protects itself", in facts anyone may see: when the dashboard last had a request
 * inspected, how many it has inspected, how many attacks on it the team stopped, and the latest of
 * those (time, kind of attack and what was done). Never the attacker's address, the request itself
 * or anything about the dashboard's visitors.
 */
type Recent = { at: number | null; label: string; result: "resolved" | "fallback" | "analyzing" | "other"; minutes: number | null };
type SelfStatus = {
  on: boolean; lastCheckedAt: number | null; checked: number; stopped: number; blockedIps: number; recent: Recent[];
};

const TTL_MS = 30_000;
const RECENT = 10;
let cached: { at: number; value: SelfStatus } | null = null; // per instance; bounds Firestore reads

const OFF: SelfStatus = { on: false, lastCheckedAt: null, checked: 0, stopped: 0, blockedIps: 0, recent: [] };

function resultOf(status: unknown): Recent["result"] {
  if (status === "resolved" || status === "awaiting_approval") return "resolved";
  if (status === "fallback" || status === "analyzing") return status;
  return "other";
}

async function read(): Promise<SelfStatus> {
  const tenantId = env.selfTenantId();
  if (!tenantId) return OFF;
  const tenant = db().collection("tenants").doc(tenantId);
  const [status, incidents, blocked, latest] = await Promise.all([
    db().collection("status").doc("self").get(),
    tenant.collection("incidents").count().get(),
    tenant.collection("blocklist").where("expiresAt", ">", new Date()).count().get(),
    tenant.collection("incidents").orderBy("createdAt", "desc").limit(RECENT)
      .select("createdAt", "status", "attack.labelJa", "actions").get(),
  ]);
  const last = status.get("lastCheckedAt") as FirebaseFirestore.Timestamp | undefined;
  return {
    on: process.env.SELF_PROTECT === "on",
    lastCheckedAt: last ? last.toMillis() : null,
    checked: Number(status.get("checked") ?? 0),
    stopped: incidents.data().count,
    blockedIps: blocked.data().count,
    recent: latest.docs.map((d) => {
      const block = ((d.get("actions") ?? []) as { type?: string; minutes?: number }[]).find((a) => a.type === "block_ip");
      return {
        at: (d.get("createdAt") as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? null,
        label: String(d.get("attack.labelJa") ?? "攻撃").slice(0, 60),
        result: resultOf(d.get("status")),
        minutes: typeof block?.minutes === "number" ? block.minutes : null,
      };
    }),
  };
}

export async function GET() {
  await connection();
  return handle("self-status", async () => {
    if (!cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), value: await read() };
    return json(cached.value);
  });
}
