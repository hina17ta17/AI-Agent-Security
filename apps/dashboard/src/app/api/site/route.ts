import { randomBytes, createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, log, readJson } from "@/lib/server/http";
import {
  type CheckResult,
  checkDns,
  checkFile,
  deriveVerifySecret,
  normalizeSiteUrl,
  verifyFilePath,
  verifyTxtName,
} from "@/lib/server/site";
import { audit, tenantRef } from "@/lib/server/tenant";

const token = () => `agentguard-site-verify=${randomBytes(16).toString("hex")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ingestKeysOf = (uid: string) => db().collection("ingestKeys").where("tenantId", "==", uid);

/**
 * The connection key is the only secret a site needs (environment variable AGENTGUARD_KEY):
 * it authorizes reports to /ingest and, through a derived secret, answers the ownership check.
 * It is shown once; AgentGuard keeps only its hash and the derived verify secret.
 */
const newConnectionKey = () => `agk_${randomBytes(24).toString("base64url")}`;
const keyRef = (key: string) => db().collection("ingestKeys").doc(hash(key));
const keyData = (uid: string, key: string, host: string, path: string) => ({
  tenantId: uid, host, path, verifySecret: deriveVerifySecret(key), createdAt: FieldValue.serverTimestamp(),
});

type StoredSite = { url?: string; host?: string; path?: string; token?: string; status?: string };

/** Firestore document id for a site: the host, plus the base path when there is one ("/" -> "|"). */
const claimId = (host: string, path?: string) => (path ? `${host}${path}`.replaceAll("/", "|") : host);

/** Drop this account's claim on a site (never another account's). */
async function releaseClaim(batch: FirebaseFirestore.WriteBatch, uid: string, site: StoredSite) {
  const ref = db().collection("siteClaims").doc(claimId(site.host!, site.path));
  const claim = await ref.get();
  if (claim.exists && claim.get("tenantId") === uid) batch.delete(ref);
}

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
      const { url, host, path } = normalizeSiteUrl(body.url);
      const previous = (await tenantRef(uid).get()).get("site") as StoredSite | undefined;
      // Correcting the URL of a pending site on the same host keeps its token and connection key,
      // so what is already set up on the site keeps working.
      const sameHostPending = previous?.status === "pending" && previous.host === host;
      const site = {
        url, host, path, status: "pending" as const, token: (sameHostPending && previous?.token) || token(),
        registeredAt: FieldValue.serverTimestamp(),
      };
      const keys = await ingestKeysOf(uid).get();
      const batch = db().batch();
      if (previous?.host) await releaseClaim(batch, uid, previous);
      let connectionKey: string | null = null;
      if (sameHostPending && !keys.empty) {
        keys.docs.forEach((d) => batch.update(d.ref, { host, path }));
      } else {
        // Registering starts over (one site per account): the previous site's key stops working.
        keys.docs.forEach((d) => batch.delete(d.ref));
        connectionKey = newConnectionKey();
        batch.set(keyRef(connectionKey), keyData(uid, connectionKey, host, path));
      }
      // update() replaces the whole site map, so no field of the previous site lingers.
      batch.update(tenantRef(uid), {
        site, siteLastReportAt: FieldValue.delete(),
        ...(connectionKey ? { ingestKeyHint: connectionKey.slice(-4) } : {}),
      });
      await batch.commit();
      await audit(uid, "register_site", { host, path }, { status: "pending_verification" });
      return json({
        site: { url, host, path, status: "pending", token: site.token },
        connectionKey, // shown once; null when the existing key was kept
        instructions: { filePath: `${path}${verifyFilePath}`, txtName: `${verifyTxtName}.${host}` },
      });
    }

    if (body.action === "rotate") {
      // A lost or leaked connection key is replaced; the old one stops working at once.
      const site = (await tenantRef(uid).get()).get("site") as StoredSite | undefined;
      if (!site?.host) throw new HttpError(400, "先にサイトを登録してください");
      const keys = await ingestKeysOf(uid).get();
      const connectionKey = newConnectionKey();
      const batch = db().batch();
      keys.docs.forEach((d) => batch.delete(d.ref));
      batch.set(keyRef(connectionKey), keyData(uid, connectionKey, site.host, site.path ?? ""));
      batch.update(tenantRef(uid), { ingestKeyHint: connectionKey.slice(-4) });
      await batch.commit();
      await audit(uid, "rotate_connection_key", { host: site.host }, { status: "rotated" });
      return json({ connectionKey });
    }

    if (body.action === "verify") {
      rateLimit(uid); // each check makes one request to the registered site
      const snap = await tenantRef(uid).get();
      const site = snap.get("site") as StoredSite | undefined;
      if (!site?.host || !site.token) throw new HttpError(400, "先にサイトを登録してください");

      const keys = await ingestKeysOf(uid).get();
      const verifySecrets = keys.docs.map((d) => d.get("verifySecret") as string | undefined).filter((v): v is string => !!v);
      const method = body.method === "dns" ? "dns" : "file";
      const result = method === "dns"
        ? await checkDns(site.host, site.token)
        : await checkFile(site.host, site.path ?? "", site.token, verifySecrets);
      if (!result.ok) {
        return json({ verified: false, method, reason: result.reason, message: failureMessage(result, site.url ?? "") });
      }

      // One site (host + base path) can be claimed by only one account.
      const claimRef = db().collection("siteClaims").doc(claimId(site.host, site.path));
      // Sites registered before connection keys existed get one now.
      const connectionKey = keys.empty ? newConnectionKey() : null;
      await db().runTransaction(async (tx) => {
        const claim = await tx.get(claimRef);
        if (claim.exists && claim.get("tenantId") !== uid) {
          throw new HttpError(409, "このサイトは、別のアカウントですでに登録されています。");
        }
        tx.set(claimRef, { tenantId: uid, host: site.host, path: site.path ?? "", claimedAt: FieldValue.serverTimestamp() });
        if (connectionKey) tx.set(keyRef(connectionKey), keyData(uid, connectionKey, site.host!, site.path ?? ""));
        tx.set(tenantRef(uid), {
          site: { ...site, status: "verified", verifiedAt: FieldValue.serverTimestamp() },
          ...(connectionKey ? { ingestKeyHint: connectionKey.slice(-4) } : {}),
        }, { merge: true });
      });
      await audit(uid, "verify_site", { host: site.host, path: site.path ?? "", method }, { status: "verified" });
      log("INFO", "site verified", { host: site.host });
      // "public": the token is still visible on the site and can now be removed.
      return json({ verified: true, connectionKey, mode: method === "dns" ? "dns" : (result.mode ?? "public") });
    }

    if (body.action === "remove") {
      const snap = await tenantRef(uid).get();
      const site = snap.get("site") as StoredSite | undefined;
      const keys = await ingestKeysOf(uid).get();
      const batch = db().batch();
      if (site?.host) await releaseClaim(batch, uid, site);
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
