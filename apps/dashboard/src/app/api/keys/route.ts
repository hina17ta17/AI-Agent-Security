import { FieldValue } from "firebase-admin/firestore";

import { db } from "@/lib/server/admin";
import { requireEditor } from "@/lib/server/auth";
import { encryptTenantKey, keyHint, looksLikeApiKey, validateGeminiKey } from "@/lib/server/byok";
import { handle, HttpError, json, log, readJson } from "@/lib/server/http";
import { audit, getTenant, tenantRef } from "@/lib/server/tenant";

// Models the agent service uses with a tenant's key (keep in sync with services/agent/app/config.py).
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

/**
 * Registers (or replaces) the tenant's Gemini API key.
 * The key is validated, encrypted with Cloud KMS (bound to this tenant), and stored as ciphertext.
 * It is never returned, logged, or stored in plaintext. Only the last 4 characters are kept for display.
 */
export async function POST(request: Request) {
  return handle("keys:post", async () => {
    const { uid } = await requireEditor(request);
    await getTenant(uid);
    const body = await readJson<{ apiKey?: unknown }>(request);
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : body.apiKey;
    if (!looksLikeApiKey(apiKey)) throw new HttpError(400, "APIキーの形式が正しくありません");

    const check = await validateGeminiKey(apiKey, MODELS);
    if (check === "invalid") {
      throw new HttpError(400, "このキーでは AgentGuard が使う Gemini モデルを利用できませんでした。キーを確認してください。");
    }
    if (check === "unreachable") throw new HttpError(503, "キーを確認できませんでした。時間をおいてもう一度お試しください。");

    const { ciphertext, keyVersion } = await encryptTenantKey(uid, apiKey);
    const hint = keyHint(apiKey);
    const batch = db().batch();
    batch.set(db().collection("tenantSecrets").doc(uid), {
      ciphertext, keyVersion, aadScheme: "tenant:{uid}", updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(tenantRef(uid), {
      aiMode: "byok", keyStatus: "valid", keyHint: hint, keyUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    await audit(uid, "register_api_key", { keyHint: hint }, { status: "encrypted_and_stored" });
    log("INFO", "tenant API key registered", { keyHint: hint });
    return json({ keyHint: hint, keyStatus: "valid", aiMode: "byok" });
  });
}

/** Deletes the stored ciphertext and returns the tenant to demo mode. */
export async function DELETE(request: Request) {
  return handle("keys:delete", async () => {
    const { uid } = await requireEditor(request);
    const batch = db().batch();
    batch.delete(db().collection("tenantSecrets").doc(uid));
    batch.set(tenantRef(uid), {
      aiMode: "demo", keyStatus: "none", keyHint: null, keyUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    await audit(uid, "delete_api_key", {}, { status: "deleted" });
    return json({ keyStatus: "none", aiMode: "demo" });
  });
}
