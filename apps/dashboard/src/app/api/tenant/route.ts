import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { ensureTenant } from "@/lib/server/tenant";

/** Creates the tenant on first login; returns the ingest endpoint for the protection snippet. */
export async function POST(request: Request) {
  return handle("tenant", async () => {
    const { uid } = await requireUser(request);
    await ensureTenant(uid);
    return json({ ingestUrl: `${env.targetUrl()}/ingest` });
  });
}
