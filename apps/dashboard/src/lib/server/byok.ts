import { KeyManagementServiceClient } from "@google-cloud/kms";

import { env } from "./env";

/**
 * Bring-your-own-key handling. The dashboard can ENCRYPT only (roles/cloudkms.cryptoKeyEncrypter);
 * only the agent service can decrypt. The plaintext key exists only in this request's memory.
 */
let kms: KeyManagementServiceClient | null = null;

export function tenantAad(uid: string): Buffer {
  return Buffer.from(`tenant:${uid}`, "utf8"); // ciphertext cannot be reused for another tenant
}

export async function encryptTenantKey(uid: string, apiKey: string): Promise<{ ciphertext: string; keyVersion: string }> {
  kms ??= new KeyManagementServiceClient();
  const [result] = await kms.encrypt({
    name: env.kmsKey(),
    plaintext: Buffer.from(apiKey, "utf8"),
    additionalAuthenticatedData: tenantAad(uid),
  });
  if (!result.ciphertext) throw new Error("KMS returned no ciphertext");
  return {
    ciphertext: Buffer.from(result.ciphertext as Uint8Array).toString("base64"),
    keyVersion: result.name ?? "",
  };
}

/** Basic shape check before any network call (keys are never echoed back). */
export function looksLikeApiKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 30 && value.length <= 200 && /^[A-Za-z0-9._\-]+$/.test(value);
}

export function keyHint(apiKey: string): string {
  return apiKey.slice(-4);
}

/**
 * Checks the key against the Gemini API models AgentGuard actually uses.
 * The key is sent only to generativelanguage.googleapis.com, in a header (never in a URL).
 */
export async function validateGeminiKey(apiKey: string, models: string[]): Promise<"valid" | "invalid" | "unreachable"> {
  try {
    for (const model of models) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
        headers: { "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return "invalid";
      if (!res.ok) return "unreachable";
    }
    return "valid";
  } catch {
    return "unreachable";
  }
}
