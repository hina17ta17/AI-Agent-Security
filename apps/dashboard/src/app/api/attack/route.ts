import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import {
  type AttackKind,
  type AttackResult,
  CUSTOMER_IP,
  distinctAttackerIps,
  randomAttackerIp,
  sendAttack,
} from "@/lib/server/simulator";
import { getTenant, tenantRef } from "@/lib/server/tenant";

const KINDS: AttackKind[] = ["normal", "sqli", "xss", "traversal", "ai_injection", "cmd", "revisit"];

/**
 * Many attacks at once, each from a different demo address, all sent at the same moment.
 * No "cmd": a mass attack should not flood the owner with isolation requests.
 */
const BULK = {
  burst: { kinds: ["sqli", "xss", "traversal", "ai_injection", "sqli"] as AttackKind[], cost: 2 },
  wave: {
    kinds: [...Array<AttackKind>(14).fill("sqli"), ...Array<AttackKind>(8).fill("xss"), ...Array<AttackKind>(8).fill("traversal")],
    cost: 4,
  },
} as const;
type BulkKind = keyof typeof BULK;

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const recent = new Map<string, number[]>(); // per-instance rate limit for the demo buttons

function rateLimit(uid: string, cost = 1) {
  const now = Date.now();
  const hits = (recent.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length + cost > MAX_PER_WINDOW) throw new HttpError(429, "少し時間をおいてから、もう一度お試しください。");
  hits.push(...Array<number>(cost).fill(now));
  recent.set(uid, hits);
}

async function blockedIps(uid: string): Promise<Set<string>> {
  const snap = await tenantRef(uid).collection("blocklist").where("expiresAt", ">", Timestamp.now()).select().get();
  return new Set(snap.docs.map((d) => d.id));
}

function summarize(kind: BulkKind, results: (AttackResult | null)[]) {
  const sent = results.filter((r): r is AttackResult => r !== null);
  const decisions: Record<string, number> = {};
  for (const r of sent) decisions[r.decision ?? "unknown"] = (decisions[r.decision ?? "unknown"] ?? 0) + 1;
  return {
    kind,
    count: results.length,
    sent: sent.length,
    blocked: sent.filter((r) => r.status === 403).length,
    decisions,
    maxRuleMs: sent.reduce((m, r) => Math.max(m, r.ruleMs ?? 0), 0),
    simulated: sent.length > 0 && sent.every((r) => r.simulated),
  };
}

/** Sends simulated requests to the caller's OWN demo site. Arbitrary targets are impossible. */
export async function POST(request: Request) {
  return handle("attack", async () => {
    const { uid } = await requireUser(request);
    const { kind } = await readJson<{ kind?: string }>(request);
    const bulk = Object.hasOwn(BULK, kind ?? "") ? (kind as BulkKind) : null;
    if (!bulk && !KINDS.includes(kind as AttackKind)) throw new HttpError(400, "不明な操作です");
    rateLimit(uid, bulk ? BULK[bulk].cost : 1);

    const tenant = await getTenant(uid);
    if (bulk) {
      const kinds = BULK[bulk].kinds;
      const ips = distinctAttackerIps(kinds.length, await blockedIps(uid));
      if (ips.length === 0) throw new HttpError(409, "デモ用の攻撃元アドレスがすべてブロック中です。しばらくしてからお試しください。");
      const results = await Promise.all(
        ips.map((ip, i) => sendAttack(tenant.siteId, kinds[i], ip).catch(() => null)),
      );
      await tenantRef(uid).set({ lastAttackerIp: ips.at(-1), lastAttackAt: FieldValue.serverTimestamp() }, { merge: true });
      return json(summarize(bulk, results));
    }

    const attackKind = kind as AttackKind;
    let ip: string;
    if (attackKind === "normal") ip = CUSTOMER_IP;
    else if (attackKind === "revisit") {
      if (!tenant.lastAttackerIp) throw new HttpError(400, "まだ攻撃が行われていません。先に攻撃ボタンを押してください。");
      ip = tenant.lastAttackerIp;
    } else ip = randomAttackerIp(attackKind);

    const result = await sendAttack(tenant.siteId, attackKind, ip);
    if (attackKind !== "normal" && attackKind !== "revisit") {
      await tenantRef(uid).set({ lastAttackerIp: ip, lastAttackAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return json({ kind: attackKind, ...result });
  });
}
