import { FieldValue } from "firebase-admin/firestore";

import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { type AttackKind, CUSTOMER_IP, randomAttackerIp, sendAttack } from "@/lib/server/simulator";
import { getTenant, tenantRef } from "@/lib/server/tenant";

const KINDS: AttackKind[] = ["normal", "sqli", "xss", "traversal", "ai_injection", "cmd", "revisit"];
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const recent = new Map<string, number[]>(); // per-instance rate limit for the demo buttons

function rateLimit(uid: string) {
  const now = Date.now();
  const hits = (recent.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) throw new HttpError(429, "少し時間をおいてから、もう一度お試しください。");
  hits.push(now);
  recent.set(uid, hits);
}

/** Sends one simulated request to the caller's OWN demo site. Arbitrary targets are impossible. */
export async function POST(request: Request) {
  return handle("attack", async () => {
    const { uid } = await requireUser(request);
    const { kind } = await readJson<{ kind?: string }>(request);
    if (!KINDS.includes(kind as AttackKind)) throw new HttpError(400, "不明な操作です");
    rateLimit(uid);

    const tenant = await getTenant(uid);
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
