/**
 * The integration code shown to site owners. One environment variable (AGENTGUARD_KEY) and one
 * block of code do everything:
 *  - answer AgentGuard's ownership check with HMAC(HMAC(key, "agentguard-verify"), challenge),
 *    so the key itself never leaves the site;
 *  - report each request to /ingest and follow the allow/block decision (fail-open).
 * Must stay in sync with deriveVerifySecret() in src/lib/server/site.ts.
 */

export type ServerFramework = "next" | "express" | "fastapi";

const VERIFY = "/.well-known/agentguard-verify.txt";

export function integrationSnippet(fw: ServerFramework, ingestUrl: string, basePath: string): string {
  const verifyPath = `${basePath}${VERIFY}`;
  if (fw === "next") {
    return `// AgentGuard 連携（Next.js）
// ファイル：Next.js 16 以降は proxy.ts、15 以前は middleware.ts（app フォルダと同じ階層。src を使っているなら src/ の中）
// 環境変数 AGENTGUARD_KEY に接続キーを設定するだけで、所有確認と保護の両方が動きます。
import { NextResponse, type NextRequest } from "next/server";

const AGENTGUARD_INGEST = "${ingestUrl}";
const AGENTGUARD_VERIFY_PATH = "${verifyPath}";
const SECRET = /pass|pwd|token|secret|card|cvc|otp/i;

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
}
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

export default async function agentguard(request: NextRequest) {
  const key = process.env.AGENTGUARD_KEY;
  if (!key) return NextResponse.next();
  const url = request.nextUrl;
  if (url.pathname === AGENTGUARD_VERIFY_PATH) {
    // 所有確認：キーそのものは見せずに、毎回ちがう問題への答えだけを返す
    const secret = await hmac(new TextEncoder().encode(key), "agentguard-verify");
    const answer = hex(await hmac(secret, url.searchParams.get("challenge") ?? ""));
    return new Response(answer, { headers: { "content-type": "text/plain" } });
  }
  try {
    const query = Object.fromEntries([...url.searchParams].map(([k, v]) => [k, SECRET.test(k) ? "[伏せ字]" : v]));
    const r = await fetch(AGENTGUARD_INGEST, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: \`Bearer \${key}\` },
      body: JSON.stringify({
        method: request.method, path: url.pathname, query,
        headers: { "user-agent": request.headers.get("user-agent") ?? "", referer: request.headers.get("referer") ?? "" },
        // 本当の接続元は X-Forwarded-For の最後（前の部分は偽装できます）
        ip: (request.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || null,
      }),
      signal: AbortSignal.timeout(2000),
    });
    const d = await r.json();
    if (d.block) return new Response(\`AgentGuard がこのアクセスを止めました（\${d.reasonJa ?? "攻撃の疑い"}）\`,
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    // AgentGuard に届かないときは通す（サイトを止めない）
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };`;
  }
  if (fw === "express") {
    return `// AgentGuard 連携（Express）
// 環境変数 AGENTGUARD_KEY に接続キーを設定するだけで、所有確認と保護の両方が動きます。
// app.use(express.json()) などの後、ほかのルートより前に置いてください。
const { createHmac } = require("node:crypto");

const AGENTGUARD_INGEST = "${ingestUrl}";
const AGENTGUARD_VERIFY_PATH = "${verifyPath}";
const SECRET = /pass|pwd|token|secret|card|cvc|otp/i;
const hide = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, SECRET.test(k) ? "[伏せ字]" : v]));
// 本当の接続元は X-Forwarded-For の最後（前の部分は偽装できます）
const clientIp = (req) => (req.get("x-forwarded-for") || "").split(",").pop().trim() || req.socket.remoteAddress;

app.use(async (req, res, next) => {
  const key = process.env.AGENTGUARD_KEY;
  if (!key) return next();
  if (req.path === AGENTGUARD_VERIFY_PATH) {
    // 所有確認：キーそのものは見せずに、毎回ちがう問題への答えだけを返す
    const secret = createHmac("sha256", key).update("agentguard-verify").digest();
    const answer = createHmac("sha256", secret).update(String(req.query.challenge || "")).digest("hex");
    return res.type("text/plain").send(answer);
  }
  try {
    const r = await fetch(AGENTGUARD_INGEST, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: \`Bearer \${key}\` },
      body: JSON.stringify({
        method: req.method, path: req.path, query: hide(req.query),
        headers: { "user-agent": req.get("user-agent") || "", referer: req.get("referer") || "", "content-type": "application/json" },
        body: req.body && typeof req.body === "object" && Object.keys(req.body).length ? JSON.stringify(hide(req.body)) : "",
        ip: clientIp(req),
      }),
      signal: AbortSignal.timeout(2000),
    });
    const d = await r.json();
    if (d.block) return res.status(403).type("text/plain; charset=utf-8").send(\`AgentGuard がこのアクセスを止めました（\${d.reasonJa ?? "攻撃の疑い"}）\`);
  } catch {
    // AgentGuard に届かないときは通す（サイトを止めない）
  }
  next();
});`;
  }
  return `# AgentGuard 連携（FastAPI）
# 環境変数 AGENTGUARD_KEY に接続キーを設定するだけで、所有確認と保護の両方が動きます。
import hashlib, hmac, os, re

import httpx
from starlette.responses import PlainTextResponse

AGENTGUARD_INGEST = "${ingestUrl}"
AGENTGUARD_VERIFY_PATH = "${verifyPath}"
SECRET = re.compile(r"pass|pwd|token|secret|card|cvc|otp", re.I)


def client_ip(request):
    # 本当の接続元は X-Forwarded-For の最後（前の部分は偽装できます）
    xff = request.headers.get("x-forwarded-for", "")
    return xff.split(",")[-1].strip() if xff else (request.client.host if request.client else None)


@app.middleware("http")
async def agentguard(request, call_next):
    key = os.environ.get("AGENTGUARD_KEY")
    if not key:
        return await call_next(request)
    if request.url.path == AGENTGUARD_VERIFY_PATH:
        # 所有確認：キーそのものは見せずに、毎回ちがう問題への答えだけを返す
        secret = hmac.new(key.encode(), b"agentguard-verify", hashlib.sha256).digest()
        challenge = request.query_params.get("challenge", "").encode()
        return PlainTextResponse(hmac.new(secret, challenge, hashlib.sha256).hexdigest())
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            r = await c.post(AGENTGUARD_INGEST, headers={"authorization": f"Bearer {key}"}, json={
                "method": request.method, "path": request.url.path,
                "query": {k: ("[伏せ字]" if SECRET.search(k) else v) for k, v in request.query_params.items()},
                "headers": {"user-agent": request.headers.get("user-agent", ""), "referer": request.headers.get("referer", "")},
                "ip": client_ip(request)})
        d = r.json()
        if d.get("block"):
            return PlainTextResponse(f"AgentGuard がこのアクセスを止めました（{d.get('reasonJa') or '攻撃の疑い'}）", status_code=403)
    except Exception:
        pass  # AgentGuard に届かないときは通す（サイトを止めない）
    return await call_next(request)`;
}

/** Where to put AGENTGUARD_KEY, by hosting service. */
export const KEY_PLACES: { name: string; how: string }[] = [
  { name: "Vercel", how: "プロジェクトの Settings → Environment Variables で AGENTGUARD_KEY を追加 → Deployments から Redeploy" },
  { name: "Cloud Run", how: "サービスの「新しいリビジョンの編集とデプロイ」→「変数とシークレット」で AGENTGUARD_KEY を追加" },
  { name: "自分のPC・その他", how: ".env ファイルに AGENTGUARD_KEY=… と書く（.env は公開リポジトリに入れない）" },
];
