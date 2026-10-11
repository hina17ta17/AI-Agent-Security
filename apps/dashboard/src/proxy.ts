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
// Never report secrets: field names that look sensitive are masked (the Gemini API key included).
const SECRET = /pass|pwd|token|secret|card|cvc|otp|key/i;

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

function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET.test(k) ? "[伏せ字]" : mask(v)]));
  }
  return value;
}

/** Small JSON bodies of API calls are inspected too (read from a clone; the route still gets the body). */
async function reportedBody(request: NextRequest): Promise<string> {
  if (request.method === "GET" || request.method === "HEAD") return "";
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!length || length > MAX_BODY || !(request.headers.get("content-type") ?? "").includes("application/json")) return "";
  try {
    return JSON.stringify(mask(JSON.parse(await request.clone().text())));
  } catch {
    return "";
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
    const query = Object.fromEntries(
      [...request.nextUrl.searchParams].map(([k, v]) => [k, SECRET.test(k) ? "[伏せ字]" : v]));
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
