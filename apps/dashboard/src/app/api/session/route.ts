import { requireUser } from "@/lib/server/auth";
import { handle, json, readJson } from "@/lib/server/http";
import { recordSignIn } from "@/lib/server/sign-in";
import { ensureTenant } from "@/lib/server/tenant";

const METHODS: Record<string, string> = {
  google: "Google ログイン",
  password: "メール / パスワード",
  signup: "新規登録",
};

/**
 * Records one sign-in for the account's own security view: time, a truncated network, a coarse
 * device label, and whether this device is new. Called once per real sign-in (not on page reloads).
 * Best-effort: the client ignores failures so a logging hiccup never blocks login.
 */
export async function POST(request: Request) {
  return handle("session", async () => {
    const { uid, authTime } = await requireUser(request);
    await ensureTenant(uid); // first sign-in also creates the tenant
    const { method } = await readJson<{ method?: string }>(request);
    // The sign-in itself was already recorded by requireUser; this adds how the person signed in.
    const { newDevice, device } = await recordSignIn(uid, authTime, request, METHODS[method ?? ""] ?? "ログイン");
    return json({ newDevice, device });
  });
}
