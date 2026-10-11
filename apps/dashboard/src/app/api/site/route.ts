import { randomBytes, createHash } from "node:crypto";

import { FieldValue } from "firebase-admin/firestore";

import { db } from "@/lib/server/admin";
import { requireUser } from "@/lib/server/auth";
import { handle, HttpError, json, log, readJson } from "@/lib/server/http";
import {
  normalizeSiteUrl,
  verifyByDns,
  verifyByFile,
  verifyFilePath,
  verifyTxtName,
} from "@/lib/server/site";
import { audit, tenantRef } from "@/lib/server/tenant";

const token = () => `agentguard-site-verify=${randomBytes(16).toString("hex")}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const ingestKeysOf = (uid: string) => db().collection("ingestKeys").where("tenantId", "==", uid);

/** Register a site to protect, verify its ownership, or remove it. One site per account. */
export async function POST(request: Request) {
  return handle("site", async () => {
    const { uid } = await requireUser(request);
    const body = await readJson<{ action?: string; url?: string }>(request);

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
      const snap = await tenantRef(uid).get();
      const site = snap.get("site") as { host?: string; token?: string; status?: string; url?: string } | undefined;
      if (!site?.host || !site.token) throw new HttpError(400, "先にサイトを登録してください");

      const ok = (await verifyByFile(site.host, site.token)) || (await verifyByDns(site.host, site.token));
      if (!ok) {
        return json({
          verified: false,
          message: "確認できませんでした。ファイルかDNSの設定を確認し、数分おいてからもう一度お試しください。",
        });
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
      await audit(uid, "verify_site", { host: site.host }, { status: "verified" });
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
