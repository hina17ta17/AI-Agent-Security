import { FieldValue } from "firebase-admin/firestore";

import { clientInfo } from "./client-info";
import { log } from "./http";
import { tenantRef } from "./tenant";

const KEEP = 20; // most recent sign-ins kept per account
const seen = new Set<string>(); // sign-ins already recorded by this instance

/**
 * Records one sign-in for the account's own security view: time, a truncated network, a coarse device
 * label, and whether this device is new. Keyed by the token's auth_time (one record per sign-in), and
 * called by every authenticated API call, so a sign-in that never opens the dashboard (a stolen
 * password used against the API directly) is recorded and flagged as well. Only the dashboard's own
 * call right after signing in knows the method (Google / password / sign-up); it fills that in.
 */
export async function recordSignIn(uid: string, authTime: number, request: Request,
                                   method?: string): Promise<{ newDevice: boolean; device: string }> {
  const info = clientInfo(request, uid);
  const memo = `${uid}:${authTime}:${info.deviceHash}`;
  if (!method && seen.has(memo)) return { newDevice: false, device: info.device };
  const logins = tenantRef(uid).collection("logins");
  const ref = logins.doc(`t${authTime}-${info.deviceHash.slice(0, 12)}`); // one record per sign-in and device
  const existing = await ref.get();
  if (existing.exists) {
    if (method) await ref.update({ method });
  } else {
    const [prior, anyPrior] = await Promise.all([
      logins.where("deviceHash", "==", info.deviceHash).limit(1).get(),
      logins.limit(1).get(),
    ]);
    // The very first sign-in of an account is not "new" (there is nothing to compare it to).
    const newDevice = !anyPrior.empty && prior.empty;
    try {
      await ref.create({
        at: FieldValue.serverTimestamp(), authTime, ipPrefix: info.ipPrefix, device: info.device,
        deviceHash: info.deviceHash, method: method ?? "ログイン", newDevice,
      });
    } catch (e) {
      // Another request of the same sign-in got there first (the dashboard calls several APIs at once).
      if ((e as { code?: number }).code !== 6) throw e;
      if (method) await ref.update({ method });
      seen.add(memo);
      return { newDevice: Boolean((await ref.get()).get("newDevice")), device: info.device };
    }
    if (newDevice) {
      await tenantRef(uid).set(
        { security: { lastNewDeviceAt: FieldValue.serverTimestamp(), lastNewDevice: info.device } },
        { merge: true },
      );
    }
    // Trim old records so the collection can't grow without bound.
    const old = await logins.orderBy("at", "desc").offset(KEEP).limit(50).get();
    if (!old.empty) {
      const batch = tenantRef(uid).firestore.batch();
      old.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    log("INFO", "sign-in recorded", { device: info.device, newDevice });
  }
  if (seen.size > 5000) seen.clear();
  seen.add(memo);
  return { newDevice: Boolean((existing.exists ? existing : await ref.get()).get("newDevice")), device: info.device };
}
