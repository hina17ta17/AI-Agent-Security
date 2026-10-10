export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Structured log line for Cloud Logging. Never pass request bodies or secrets here. */
export function log(severity: "INFO" | "WARNING" | "ERROR", message: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, message, component: "dashboard", ...fields }));
}

export async function handle(route: string, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    log("ERROR", "api error", { route, error: error instanceof Error ? error.name + ": " + error.message.slice(0, 300) : "unknown" });
    return json({ error: "サーバーでエラーが起きました。時間をおいてもう一度お試しください。" }, 500);
  }
}

export async function readJson<T>(request: Request, maxBytes = 8 * 1024): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "リクエストが大きすぎます");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "リクエストの形式が正しくありません");
  }
}
