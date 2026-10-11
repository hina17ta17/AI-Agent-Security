import { randomBytes, createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, log, readJson } from "@/lib/server/http";
import {
  type CheckResult,
  checkDns,
  checkFile,
  normalizeSiteUrl,
  verifyFilePath,
  verifyTxtName,
} from "@/lib/server/site";
import { audit, tenantRef } from "@/lib/server/tenant";

const token = () => `agentguard-site-verify=${randomBytes(16).toString("hex")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ingestKeysOf = (uid: string) => db().collection("ingestKeys").where("tenantId", "==", uid);

/** What to fix, in the owner's words. */
function failureMessage(r: Exclude<CheckResult, { ok: true }>, url: string): string {
  switch (r.reason) {
    case "unreachable":
      return "サイトに接続できませんでした。URLが正しいか、サイトが公開されているかを確認してください。";
    case "not_found":
      return `ファイルが見つかりませんでした（${url}${verifyFilePath} の応答：${r.status}）。置き場所とファイル名、サイトを公開し直したかを確認してください。`;
    case "redirect":
      return `このURLは別の場所へ転送（リダイレクト）されています${r.location ? `（転送先：${r.location}）` : ""}。転送先のURLで登録し直してください。`;
    case "mismatch":
      return "見つかりましたが、合言葉が一致しません。画面に表示されている最新の合言葉を貼り直してください。";
    case "no_record":
      return "DNSの記録がまだ見つかりません。追加した直後は、反映まで数分〜数時間かかることがあります。";
  }
}

const WINDOW_MS = 60_000;
const MAX_CHECKS = 10;
const recent = new Map<string, number[]>(); // per-instance limit on ownership checks

function rateLimit(uid: string) {
  const now = Date.now();
  const hits = (recent.get(uid) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_CHECKS) throw new HttpError(429, "確認の回数が多すぎます。1分ほど待ってからもう一度お試しください。");
  hits.push(now);
  recent.set(uid, hits);
}

/** Register a site to protect, verify its ownership, or remove it. One site per account. */
export async function POST(request: Request) {
  return handle("site", async () => {
    const { uid } = await requireUser(request);
    const body = await readJson<{ action?: string; url?: string; method?: string }>(request);

    if (body.action === "register") {
      const { url, host } = normalizeSiteUrl(body.url);
      const site = {
        url, host, status: "pending" as const, token: token(),
        registeredAt: FieldValue.serverTimestamp(),
      };
      // Registering starts over (one site per account): release the previous site and its key.
      const previous = (await tenantRef(uid).get()).get("site") as { host?: string } | undefined;
      const keys = await ingestKeysOf(uid).get();
      const batch = db().batch();
      if (previous?.host) {
        const claim = await db().collection("siteClaims").doc(previous.host).get();
        if (claim.exists && claim.get("tenantId") === uid) batch.delete(claim.ref);
      }
      keys.docs.forEach((d) => batch.delete(d.ref));
      // update() replaces the whole site map, so no field of the previous site lingers.
      batch.update(tenantRef(uid), { site, ingestKeyHint: FieldValue.delete() });
      await batch.commit();
      await audit(uid, "register_site", { host }, { status: "pending_verification" });
      return json({
        site: { url, host, status: "pending", token: site.token },
        instructions: { filePath: verifyFilePath, txtName: `${verifyTxtName}.${host}` },
      });
    }

    if (body.action === "verify") {
      rateLimit(uid); // each check makes one request to the registered site
      const snap = await tenantRef(uid).get();
      const site = snap.get("site") as { host?: string; token?: string; status?: string; url?: string } | undefined;
      if (!site?.host || !site.token) throw new HttpError(400, "先にサイトを登録してください");

      const method = body.method === "dns" ? "dns" : "file";
      const result = method === "dns" ? await checkDns(site.host, site.token) : await checkFile(site.host, site.token);
      if (!result.ok) {
        return json({ verified: false, method, reason: result.reason, message: failureMessage(result, site.url ?? "") });
      }

      // One host can be claimed by only one account.
      const claimRef = db().collection("siteClaims").doc(site.host);
      const ingestKey = `ag_${randomBytes(24).toString("base64url")}`;
      await db().runTransaction(async (tx) => {
        const claim = await tx.get(claimRef);
        const oldKeys = await tx.get(ingestKeysOf(uid));
        if (claim.exists && claim.get("tenantId") !== uid) {
          throw new HttpError(409, "このドメインは、別のアカウントですでに登録されています。");
        }
        oldKeys.docs.forEach((d) => tx.delete(d.ref)); // a new key replaces any earlier one
        tx.set(claimRef, { tenantId: uid, host: site.host, claimedAt: FieldValue.serverTimestamp() });
        tx.set(db().collection("ingestKeys").doc(hash(ingestKey)),
          { tenantId: uid, host: site.host, createdAt: FieldValue.serverTimestamp() });
        tx.set(tenantRef(uid), {
          site: { ...site, status: "verified", verifiedAt: FieldValue.serverTimestamp() },
          ingestKeyHint: ingestKey.slice(-4),
        }, { merge: true });
      });
      await audit(uid, "verify_site", { host: site.host, method }, { status: "verified" });
      log("INFO", "site verified", { host: site.host });
      // The ingest key is returned once and never stored in plaintext.
      return json({ verified: true, ingestKey });
    }

    if (body.action === "remove") {
      const snap = await tenantRef(uid).get();
      const site = snap.get("site") as { host?: string } | undefined;
      const keys = await ingestKeysOf(uid).get();
      const batch = db().batch();
      if (site?.host) batch.delete(db().collection("siteClaims").doc(site.host));
      keys.docs.forEach((d) => batch.delete(d.ref)); // the site's ingest key stops working
      batch.set(tenantRef(uid), { site: FieldValue.delete(), ingestKeyHint: FieldValue.delete() }, { merge: true });
      await batch.commit();
      await audit(uid, "remove_site", { host: site?.host ?? null }, { status: "removed" });
      return json({ ok: true });
    }

    if (body.action === "restore") {
      await tenantRef(uid).set({ siteMode: "normal", maintenanceUntil: FieldValue.delete() }, { merge: true });
      await audit(uid, "restore_site", {}, { status: "site_normal" });
      return json({ ok: true });
    }

    throw new HttpError(400, "不明な操作です");
  });
}
