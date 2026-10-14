/**
 * The integration code shown to site owners. One environment variable (AGENTGUARD_KEY) and one
 * block of code do everything:
 *  - answer AgentGuard's ownership check with HMAC(HMAC(key, "agentguard-verify"), challenge),
 *    so the key itself never leaves the site;
 *  - report each request (query, and form / JSON bodies) to /ingest and follow the allow/block
 *    decision (fail-open).
 * Values of secret-looking fields are masked before they leave the site, except when the value
 * itself looks like an attack (a login form's password box is a classic injection point).
 * Must stay in sync with deriveVerifySecret() in src/lib/server/site.ts.
 *
 * The snippets are template strings: "\\" here becomes "\" in the code shown to the owner.
 */

export type ServerFramework = "next" | "express" | "fastapi";

const VERIFY = "/.well-known/agentguard-verify.txt";

// Shared by the JavaScript snippets (\x60 is a backtick, which a template string cannot hold as is).
const JS_MASK = `// パスワードなどの欄は伏せて送ります（攻撃の形をした値だけは、検査のためそのまま送ります）
const SECRET = /pass|pwd|token|secret|card|cvc|otp|api[-_]?key/i;
const ATTACK = /['"\\x60]\\s*(or|and)\\s|['"\\x60]\\s*(--|#)|<\\s*script|\\bunion\\s+select\\b|;\\s*(drop|delete|insert|update)\\s/i;
const mask = (v, k = "") =>
  Array.isArray(v) ? v.map((x) => mask(x, k))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, mask(vv, kk)]))
  : SECRET.test(k) && !(typeof v === "string" && ATTACK.test(v)) ? "[伏せ字]" : v;`;

export function integrationSnippet(fw: ServerFramework, ingestUrl: string, basePath: string): string {
  const verifyPath = `${basePath}${VERIFY}`;
  if (fw === "next") {
    return `// AgentGuard 連携（Next.js）
// 1) このファイル（proxy.ts）を、package.json と同じフォルダに置く（src フォルダを使っているなら src の中）
//    ※ Next.js 15 以前は、ファイル名を middleware.ts にしてください
// 2) 環境変数 AGENTGUARD_KEY に接続キーを設定する
// これだけで、所有確認と保護の両方が動きます。コードの書き換えは不要です。
// 検査はサイトの処理より先に行われ、攻撃と判断したアクセスはサイトのコードまで届きません。
// （任意）AGENTGUARD_FAIL_CLOSED=true も設定すると、AgentGuard に確認できないときもアクセスを止めます。
import { NextResponse, type NextRequest } from "next/server";

const AGENTGUARD_INGEST = "${ingestUrl}";
const AGENTGUARD_VERIFY_PATH = "${verifyPath}";
${JS_MASK.replace("const mask = (v, k = \"\") =>", "const mask = (v: unknown, k = \"\"): unknown =>")}

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
}
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

// 同じ名前の値が複数あるときは、すべて送ります
function queryOf(url: URL): unknown {
  const q: Record<string, unknown> = {};
  for (const [k, v] of url.searchParams) {
    const prev = q[k];
    q[k] = prev === undefined ? v : [...(Array.isArray(prev) ? prev : [prev]), v];
  }
  return mask(q);
}

// フォームと JSON の中身も検査します（ファイルの送信などは対象外）
async function bodyOf(request: NextRequest): Promise<{ body: string; type: string }> {
  const type = request.headers.get("content-type") ?? "";
  if (request.method === "GET" || request.method === "HEAD") return { body: "", type: "" };
  try {
    const text = await request.clone().text();
    if (type.includes("application/json")) {
      return { body: JSON.stringify(mask(JSON.parse(text))).slice(0, 60000), type: "application/json" };
    }
    if (type.includes("application/x-www-form-urlencoded")) {
      const form = [...new URLSearchParams(text)].map(([k, v]) => [k, String(mask(v, k))]);
      return { body: new URLSearchParams(form).toString().slice(0, 60000), type: "application/x-www-form-urlencoded" };
    }
  } catch {
    // 読めない中身は送らない
  }
  return { body: "", type: "" };
}

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
    const { body, type } = await bodyOf(request);
    const r = await fetch(AGENTGUARD_INGEST, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({
        method: request.method, path: url.pathname, query: queryOf(url), body,
        headers: { "user-agent": request.headers.get("user-agent") ?? "", referer: request.headers.get("referer") ?? "", "content-type": type },
        // 本当の接続元は X-Forwarded-For の最後（前の部分は偽装できます）
        ip: (request.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || null,
      }),
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error("AgentGuard " + r.status);
    const d = await r.json();
    if (d.block) return new Response("AgentGuard がこのアクセスを止めました（" + (d.reasonJa ?? "攻撃の疑い") + "）",
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch {
    // AgentGuard に確認できないとき：ふだんは通す（サイトを止めない）。FAIL_CLOSED なら安全のため止める
    if (process.env.AGENTGUARD_FAIL_CLOSED === "true") {
      return new Response("安全のため、一時的にアクセスを止めています。しばらくしてからもう一度お試しください。",
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "30" } });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };`;
  }
  if (fw === "express") {
    return `// AgentGuard 連携（Express）
// 1) このファイル（agentguard.cjs）を、server.js（または app.js）と同じフォルダに置く
// 2) server.js の app.use(express.json()) のすぐ下に、次の1行を足す
//      require("./agentguard.cjs")(app);
//    （import を使うプロジェクトなら： import agentguard from "./agentguard.cjs"; agentguard(app); ）
// 3) 環境変数 AGENTGUARD_KEY に接続キーを設定する
// これだけで、所有確認と保護の両方が動きます。
// 検査はサイトの処理（app.get など）より先に行われ、攻撃と判断したアクセスはサイトのコードまで届きません。
// （任意）AGENTGUARD_FAIL_CLOSED=true も設定すると、AgentGuard に確認できないときもアクセスを止めます。
const { createHmac } = require("node:crypto");

const AGENTGUARD_INGEST = "${ingestUrl}";
const AGENTGUARD_VERIFY_PATH = "${verifyPath}";
${JS_MASK}
// 本当の接続元は X-Forwarded-For の最後（前の部分は偽装できます）
const clientIp = (req) => (req.get("x-forwarded-for") || "").split(",").pop().trim() || req.socket.remoteAddress;

module.exports = function agentguard(app) {
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
        headers: { "content-type": "application/json", authorization: "Bearer " + key },
        body: JSON.stringify({
          method: req.method, path: req.path, query: mask(req.query),
          headers: { "user-agent": req.get("user-agent") || "", referer: req.get("referer") || "", "content-type": "application/json" },
          // フォームと JSON の中身も検査します
          body: req.body && typeof req.body === "object" && Object.keys(req.body).length ? JSON.stringify(mask(req.body)).slice(0, 60000) : "",
          ip: clientIp(req),
        }),
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) throw new Error("AgentGuard " + r.status);
      const d = await r.json();
      if (d.block) return res.status(403).type("text/plain; charset=utf-8").send("AgentGuard がこのアクセスを止めました（" + (d.reasonJa ?? "攻撃の疑い") + "）");
    } catch {
      // AgentGuard に確認できないとき：ふだんは通す（サイトを止めない）。FAIL_CLOSED なら安全のため止める
      if (process.env.AGENTGUARD_FAIL_CLOSED === "true") {
        return res.status(503).set("retry-after", "30").type("text/plain; charset=utf-8")
          .send("安全のため、一時的にアクセスを止めています。しばらくしてからもう一度お試しください。");
      }
    }
    next();
  });
};`;
  }
  return `# AgentGuard 連携（FastAPI）
# 1) このファイル（agentguard.py）を、main.py と同じフォルダに置く
# 2) main.py の app = FastAPI() のすぐ下に、次の2行を足す
#      from agentguard import protect
#      protect(app)
# 3) 環境変数 AGENTGUARD_KEY に接続キーを設定する（httpx を使うので、まだなら pip install httpx）
# これだけで、所有確認と保護の両方が動きます。
# 検査はサイトの処理（@app.get など）より先に行われ、攻撃と判断したアクセスはサイトのコードまで届きません。
# （任意）AGENTGUARD_FAIL_CLOSED=true も設定すると、AgentGuard に確認できないときもアクセスを止めます。
import hashlib, hmac, json, os, re
from urllib.parse import parse_qsl, urlencode

import httpx
from starlette.responses import PlainTextResponse

AGENTGUARD_INGEST = "${ingestUrl}"
AGENTGUARD_VERIFY_PATH = "${verifyPath}"
# パスワードなどの欄は伏せて送ります（攻撃の形をした値だけは、検査のためそのまま送ります）
SECRET = re.compile(r"pass|pwd|token|secret|card|cvc|otp|api[-_]?key", re.I)
ATTACK = re.compile(r"['\\"\\x60]\\s*(or|and)\\s|['\\"\\x60]\\s*(--|#)|<\\s*script|\\bunion\\s+select\\b|;\\s*(drop|delete|insert|update)\\s", re.I)


def mask(v, k=""):
    if isinstance(v, dict):
        return {kk: mask(vv, kk) for kk, vv in v.items()}
    if isinstance(v, list):
        return [mask(x, k) for x in v]
    if k and SECRET.search(k) and not (isinstance(v, str) and ATTACK.search(v)):
        return "[伏せ字]"
    return v


def client_ip(request):
    # 本当の接続元は X-Forwarded-For の最後（前の部分は偽装できます）
    xff = request.headers.get("x-forwarded-for", "")
    return xff.split(",")[-1].strip() if xff else (request.client.host if request.client else None)


async def body_of(request):
    # フォームと JSON の中身も検査します（ファイルの送信などは対象外）
    if request.method in ("GET", "HEAD"):
        return "", ""
    ctype = request.headers.get("content-type", "")
    raw = (await request.body()).decode("utf-8", "replace")
    try:
        if "application/json" in ctype:
            return json.dumps(mask(json.loads(raw)), ensure_ascii=False)[:60000], "application/json"
        if "application/x-www-form-urlencoded" in ctype:
            return urlencode([(k, mask(v, k)) for k, v in parse_qsl(raw, keep_blank_values=True)])[:60000], ctype
    except ValueError:
        pass  # 読めない中身は送らない
    return "", ""


def protect(app):
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
            query = {}  # 同じ名前の値が複数あるときは、すべて送ります
            for k, v in request.query_params.multi_items():
                query.setdefault(k, []).append(v)
            query = mask({k: v[0] if len(v) == 1 else v for k, v in query.items()})
            body, ctype = await body_of(request)
            async with httpx.AsyncClient(timeout=2.0) as c:
                r = await c.post(AGENTGUARD_INGEST, headers={"authorization": "Bearer " + key}, json={
                    "method": request.method, "path": request.url.path, "query": query, "body": body,
                    "headers": {"user-agent": request.headers.get("user-agent", ""), "referer": request.headers.get("referer", ""),
                                "content-type": ctype},
                    "ip": client_ip(request)})
            r.raise_for_status()
            d = r.json()
            if d.get("block"):
                return PlainTextResponse("AgentGuard がこのアクセスを止めました（" + (d.get("reasonJa") or "攻撃の疑い") + "）", status_code=403)
        except Exception:
            # AgentGuard に確認できないとき：ふだんは通す（サイトを止めない）。FAIL_CLOSED なら安全のため止める
            if os.environ.get("AGENTGUARD_FAIL_CLOSED") == "true":
                return PlainTextResponse("安全のため、一時的にアクセスを止めています。しばらくしてからもう一度お試しください。",
                                         status_code=503, headers={"retry-after": "30"})
        return await call_next(request)`;
}

/**
 * How each framework is installed, in the owner's terms: the file to save (and where), the folder
 * picture, and the line(s) to add to an existing file. Next.js needs no edit at all.
 */
export const INSTALL: Record<ServerFramework, {
  fileName: string; place: string; tree: string; addLines: string | null; addWhere: string | null; context: string | null;
}> = {
  next: {
    fileName: "proxy.ts",
    place: "package.json と同じフォルダ（src フォルダがあるなら src の中）",
    tree: "あなたのサイトのフォルダ/\n├─ package.json\n├─ next.config.js\n├─ proxy.ts        ← ここに置く（新しいファイル）\n└─ app/",
    addLines: null,
    addWhere: null,
    context: null,
  },
  express: {
    fileName: "agentguard.cjs",
    place: "server.js（または app.js）と同じフォルダ",
    tree: "あなたのサイトのフォルダ/\n├─ package.json\n├─ server.js       ← ここに1行足す\n└─ agentguard.cjs  ← ここに置く（新しいファイル）",
    addLines: 'require("./agentguard.cjs")(app);',
    addWhere: "server.js の app.use(express.json()) のすぐ下（app.get などのルートより前）",
    context: 'const app = express();\napp.use(express.json());\nrequire("./agentguard.cjs")(app);   // ← この1行を足す\n\napp.get("/", (req, res) => { ... });',
  },
  fastapi: {
    fileName: "agentguard.py",
    place: "main.py と同じフォルダ",
    tree: "あなたのサイトのフォルダ/\n├─ requirements.txt\n├─ main.py         ← ここに2行足す\n└─ agentguard.py   ← ここに置く（新しいファイル）",
    addLines: "from agentguard import protect\nprotect(app)",
    addWhere: "main.py の app = FastAPI() のすぐ下",
    context: "app = FastAPI()\nfrom agentguard import protect   # ← この2行を足す\nprotect(app)\n\n@app.get(\"/\")\ndef home(): ...",
  },
};

/** Where to put AGENTGUARD_KEY, by hosting service. */
export const KEY_PLACES: { name: string; how: string }[] = [
  { name: "Vercel", how: "プロジェクトの Settings → Environment Variables で AGENTGUARD_KEY を追加 → Deployments から Redeploy" },
  { name: "Cloud Run", how: "サービスの「新しいリビジョンの編集とデプロイ」→「変数とシークレット」で AGENTGUARD_KEY を追加" },
  { name: "自分のPC・その他", how: "Next.js は .env.local に AGENTGUARD_KEY=… と書くだけ。Express は .env に書いて node --env-file=.env server.js で起動、FastAPI は .env に書いて uvicorn main:app --env-file .env で起動（どちらもファイルを置くだけでは読み込まれません）。このファイルは公開リポジトリに入れない" },
];
