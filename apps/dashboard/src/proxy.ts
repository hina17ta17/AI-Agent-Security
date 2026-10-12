import { GoogleAuth, type IdTokenClient } from "google-auth-library";
import { type NextRequest, NextResponse } from "next/server";

/**
 * AgentGuard protects itself. Every request to the dashboard is reported to the same /ingest
 * endpoint that customer sites use, so Mihari inspects it and the AI team handles attacks
 * (recorded under the self-protection tenant). Authentication is the dashboard's own service
 * account, so no key is stored. If AgentGuard cannot answer in time, the request passes
 * (fail-open): the dashboard never goes down because of its own protection.
 */

const TIMEOUT_MS = 1500;
const MAX_BODY = 8 * 1024;
// Never report secrets: field names that look sensitive are masked (the Gemini API key included),
// unless the value itself looks like an attack (then it is reported so Mihari can stop it).
const SECRET = /pass|pwd|token|secret|card|cvc|otp|key/i;
const ATTACK = /['"`]\s*(or|and)\s|['"`]\s*(--|#)|<\s*script|\bunion\s+select\b|;\s*(drop|delete|insert|update)\s/i;

let client: Promise<IdTokenClient> | null = null;

async function idToken(audience: string): Promise<string | null> {
  try {
    client ??= new GoogleAuth().getIdTokenClient(audience);
    const headers = await (await client).getRequestHeaders();
    return headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  } catch {
    client = null;
    return null;
  }
}

function mask(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => mask(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, k)]));
  }
  return SECRET.test(key) && !(typeof value === "string" && ATTACK.test(value)) ? "[伏せ字]" : value;
}

/** Every value of a repeated parameter (?q=a&q=b), not just the last one. */
function queryOf(params: URLSearchParams): unknown {
  const query: Record<string, unknown> = {};
  for (const [k, v] of params) {
    const prev = query[k];
    query[k] = prev === undefined ? v : [...(Array.isArray(prev) ? prev : [prev]), v];
  }
  return mask(query);
}

/**
 * API bodies are inspected too (read from a clone; the route still gets the body). The routes parse
 * any body as JSON whatever its content-type, so neither the content-type nor a missing
 * content-length may skip the inspection; bodies the routes would refuse as too large are skipped.
 */
async function reportedBody(request: NextRequest): Promise<string> {
  if (request.method === "GET" || request.method === "HEAD") return "";
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) return "";
  try {
    const text = await request.clone().text();
    return text && text.length <= MAX_BODY ? JSON.stringify(mask(JSON.parse(text))) : "";
  } catch {
    return ""; // not JSON: the route refuses it as well
  }
}

function blocked(request: NextRequest, reason: string | undefined): Response {
  const message = `AgentGuard がこのアクセスを止めました（${reason ?? "攻撃の疑い"}）。`;
  if (request.nextUrl.pathname.startsWith("/api/")) return Response.json({ error: message }, { status: 403 });
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>AgentGuard</title>` +
      `<body style="font-family:sans-serif;padding:40px;color:#1e293b"><h1>アクセスを止めました</h1><p>${message.replace(/[<>&]/g, "")}</p></body>`,
    { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

export async function proxy(request: NextRequest) {
  const target = process.env.TARGET_URL?.replace(/\/$/, "");
  if (process.env.SELF_PROTECT !== "on" || !target) return NextResponse.next();
  try {
    const token = await idToken(target);
    if (!token) return NextResponse.next();
    const query = queryOf(request.nextUrl.searchParams);
    const body = await reportedBody(request);
    const res = await fetch(`${target}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        method: request.method,
        path: request.nextUrl.pathname,
        query,
        headers: {
          "user-agent": request.headers.get("user-agent") ?? "",
          referer: request.headers.get("referer") ?? "",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body,
        // Cloud Run appends the real client last; anything before it was written by the client.
        ip: (request.headers.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || null,
        agentguardSelf: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const decision = (await res.json()) as { decision?: string; reasonJa?: string };
    // Only "block" is enforced: AgentGuard never puts itself into maintenance mode.
    if (decision.decision === "block") return blocked(request, decision.reasonJa);
  } catch {
    // fail-open
  }
  return NextResponse.next();
}

export const config = {
  // Static build assets carry no application logic; everything else (pages, data, API) is inspected.
  // The self-status card polls a fixed, input-free counter, so its polls are not counted as visits.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/self-status$).*)"],
};
