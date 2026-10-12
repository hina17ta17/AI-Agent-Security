import { connection } from "next/server";

import { db } from "@/lib/server/admin";
import { env } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";

/**
 * "AgentGuard protects itself", in numbers anyone may see: when the dashboard last had a request
 * inspected, how many it has inspected, and how many attacks on it the team stopped. Only counts
 * leave the server, never what the requests were or who sent them.
 */
type SelfStatus = { on: boolean; lastCheckedAt: number | null; checked: number; stopped: number; blockedIps: number };

const TTL_MS = 30_000;
let cached: { at: number; value: SelfStatus } | null = null; // per instance; bounds Firestore reads

async function read(): Promise<SelfStatus> {
  const tenantId = env.selfTenantId();
  if (!tenantId) return { on: false, lastCheckedAt: null, checked: 0, stopped: 0, blockedIps: 0 };
  const tenant = db().collection("tenants").doc(tenantId);
  const [status, incidents, blocked] = await Promise.all([
    db().collection("status").doc("self").get(),
    tenant.collection("incidents").count().get(),
    tenant.collection("blocklist").where("expiresAt", ">", new Date()).count().get(),
  ]);
  const last = status.get("lastCheckedAt") as FirebaseFirestore.Timestamp | undefined;
  return {
    on: process.env.SELF_PROTECT === "on",
    lastCheckedAt: last ? last.toMillis() : null,
    checked: Number(status.get("checked") ?? 0),
    stopped: incidents.data().count,
    blockedIps: blocked.data().count,
  };
}

export async function GET() {
  await connection();
  return handle("self-status", async () => {
    if (!cached || Date.now() - cached.at > TTL_MS) cached = { at: Date.now(), value: await read() };
    return json(cached.value);
  });
}
