import { FieldValue } from "firebase-admin/firestore";

import { clientInfo } from "@/lib/server/client-info";
import { requireUser } from "@/lib/server/auth";
import { handle, json, log, readJson } from "@/lib/server/http";
import { ensureTenant, tenantRef } from "@/lib/server/tenant";

const METHODS: Record<string, string> = {
  google: "Google ログイン",
  password: "メール / パスワード",
  signup: "新規登録",
};
const KEEP = 20; // most recent sign-ins kept per account

/**
 * Records one sign-in for the account's own security view: time, a truncated network, a coarse
 * device label, and whether this device is new. Called once per real sign-in (not on page reloads).
 * Best-effort: the client ignores failures so a logging hiccup never blocks login.
 */
export async function POST(request: Request) {
  return handle("session", async () => {
    const { uid } = await requireUser(request);
    await ensureTenant(uid); // first sign-in also creates the tenant
    const { method } = await readJson<{ method?: string }>(request);
    const info = clientInfo(request, uid);

    const logins = tenantRef(uid).collection("logins");
    const prior = await logins.where("deviceHash", "==", info.deviceHash).limit(1).get();
    const anyPrior = await logins.limit(1).get();
    // The very first sign-in of an account is not "new" (there is nothing to compare it to).
    const newDevice = !anyPrior.empty && prior.empty;

    await logins.add({
      at: FieldValue.serverTimestamp(),
      ipPrefix: info.ipPrefix,
      device: info.device,
      deviceHash: info.deviceHash,
      method: METHODS[method ?? ""] ?? "ログイン",
      newDevice,
    });
    if (newDevice) {
      await tenantRef(uid).set(
        { security: { lastNewDeviceAt: FieldValue.serverTimestamp(), lastNewDevice: info.device } },
        { merge: true },
      );
    }

    // Trim old records so the collection can't grow without bound.
    const all = await logins.orderBy("at", "desc").offset(KEEP).limit(50).get();
    if (!all.empty) {
      const batch = tenantRef(uid).firestore.batch();
      all.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    log("INFO", "sign-in recorded", { device: info.device, newDevice });
    return json({ newDevice, device: info.device });
  });
}
