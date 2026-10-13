import { isIP } from "node:net";

import type { Timestamp } from "firebase-admin/firestore";

import { db } from "@/lib/server/admin";
import { parseAllowlist } from "@/lib/server/allowlist";
import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { claimSelfOwner, requireSelfOwner, selfOwnerUid } from "@/lib/server/owner";
import { audit, tenantRef } from "@/lib/server/tenant";

/**
 * AgentGuard's manager (one account). Everyone may ask whether they are the manager and, while no
 * manager exists, claim it with the one-time code; everything else is for the manager only and
 * acts on AgentGuard's own protection with server credentials (its account itself stays read-only).
 */

const ms = (t: unknown) => (t && typeof (t as Timestamp).toMillis === "function" ? (t as Timestamp).toMillis() : null);

const WINDOW_MS = 60_000;
const MAX_CLAIMS = 5;
const recent = new Map<string, number[]>(); // per-instance limit on code attempts

function rateLimit(uid: string) {
  const now = Date.now();
  const hits = (recent.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_CLAIMS) throw new HttpError(429, "試行回数が多すぎます。1分ほど待ってからお試しください。");
  hits.push(now);
  recent.set(uid, hits);
}

async function overview(selfTenantId: string) {
  const tenant = tenantRef(selfTenantId);
  const [doc, incidents, blocks, auditLog, status] = await Promise.all([
    tenant.get(),
    tenant.collection("incidents").orderBy("createdAt", "desc").limit(30).get(),
    tenant.collection("blocklist").where("expiresAt", ">", new Date()).orderBy("expiresAt", "desc").limit(100).get(),
    tenant.collection("audit").orderBy("at", "desc").limit(40).get(),
    db().collection("status").doc("self").get(),
  ]);
  return {
    checked: Number(status.get("checked") ?? 0),
    lastCheckedAt: ms(status.get("lastCheckedAt")),
    allowlist: ((doc.get("settings") ?? {}).allowlist ?? []) as string[],
    incidents: incidents.docs.map((d) => {
      const i = d.data();
      const block = (i.actions ?? []).find((a: { type?: string }) => a.type === "block_ip");
      return {
        id: d.id, at: ms(i.createdAt), status: i.status ?? null,
        label: i.attack?.labelJa ?? "攻撃", srcIp: i.attack?.srcIp ?? null,
        method: i.attack?.method ?? null, path: i.attack?.path ?? null,
        severity: i.verdict?.severity ?? null, promptInjection: Boolean(i.guard?.promptInjection),
        minutes: typeof block?.minutes === "number" ? block.minutes : null,
      };
    }),
    blocks: blocks.docs.map((d) => {
      const b = d.data();
      return { ip: d.id, reasonJa: b.reasonJa ?? "", blockedBy: b.blockedBy ?? "", expiresAt: ms(b.expiresAt), hits: b.hits ?? 0 };
    }),
    audit: auditLog.docs.map((d) => {
      const a = d.data();
      return { id: d.id, at: ms(a.at), actor: a.actor, action: a.action, status: a.result?.status ?? null, params: a.params ?? {} };
    }),
  };
}

async function incidentDetail(selfTenantId: string, id: unknown) {
  if (typeof id !== "string" || !/^[\w-]{6,80}$/.test(id)) throw new HttpError(400, "不明なインシデントです");
  const ref = tenantRef(selfTenantId).collection("incidents").doc(id);
  const [doc, steps] = await Promise.all([ref.get(), ref.collection("steps").orderBy("seq").get()]);
  if (!doc.exists) throw new HttpError(404, "インシデントが見つかりません");
  const i = doc.data()!;
  return {
    id, report: i.report?.markdown ?? "", payloadPreview: i.attack?.payloadPreview ?? "",
    steps: steps.docs.map((s) => ({ agent: s.get("agent"), kind: s.get("kind"), text: s.get("text"), at: ms(s.get("at")) })),
  };
}

export async function POST(request: Request) {
  return handle("owner", async () => {
    const body = await readJson<{ action?: string; code?: unknown; id?: unknown; ip?: unknown; allowlist?: unknown }>(request);

    if (body.action === "status") {
      const { uid } = await requireUser(request);
      const available = Boolean(env.selfTenantId());
      const owner = available ? await selfOwnerUid() : null;
      return json({ available, claimed: owner !== null, isOwner: owner === uid });
    }

    if (body.action === "claim") {
      const { uid } = await requireUser(request);
      rateLimit(uid);
      if (typeof body.code !== "string" || body.code.trim().length < 16) throw new HttpError(400, "管理者コードを入力してください");
      await claimSelfOwner(uid, body.code);
      await audit(uid, "become_self_owner", {}, { status: "ok" });
      await audit(env.selfTenantId(), "become_self_owner", {}, { status: "ok" }, null, "owner");
      return json({ isOwner: true });
    }

    const { selfTenantId } = await requireSelfOwner(request);
    if (body.action === "overview") return json(await overview(selfTenantId));
    if (body.action === "incident") return json(await incidentDetail(selfTenantId, body.id));

    if (body.action === "unblock") {
      if (typeof body.ip !== "string" || !isIP(body.ip)) throw new HttpError(400, "IPアドレスの形式が正しくありません");
      const ref = tenantRef(selfTenantId).collection("blocklist").doc(body.ip);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpError(404, "このIPはブロックされていません");
      await ref.delete();
      await audit(selfTenantId, "unblock_ip", { ip: body.ip }, { status: "unblocked" },
        (snap.get("incidentId") as string | undefined) ?? null, "owner");
      return json({ ok: true });
    }

    if (body.action === "allowlist") {
      const entries = parseAllowlist(body.allowlist);
      await tenantRef(selfTenantId).set({ settings: { allowlist: entries } }, { merge: true });
      await audit(selfTenantId, "update_allowlist", { count: entries.length }, { status: "ok" }, null, "owner");
      return json({ allowlist: entries });
    }

    throw new HttpError(400, "不明な操作です");
  });
}
