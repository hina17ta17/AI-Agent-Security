import { requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { ensureTenant } from "@/lib/server/tenant";

/** Creates the tenant (and its private demo site) on first login; returns the site URL. */
export async function POST(request: Request) {
  return handle("tenant", async () => {
    const { uid } = await requireUser(request);
    const tenant = await ensureTenant(uid);
    return json({
      siteId: tenant.siteId,
      siteUrl: `${env.targetUrl()}/s/${tenant.siteId}/`,
      ingestUrl: `${env.targetUrl()}/ingest`,
    });
  });
}
