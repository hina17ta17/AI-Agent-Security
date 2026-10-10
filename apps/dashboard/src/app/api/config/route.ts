import { connection } from "next/server";

import { env } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";

// Public Firebase web config, read from the runtime environment.
// connection() must run outside handle(): during the build it rejects on purpose to move this
// handler to request time, and that signal must not be caught as an error.
export async function GET() {
  await connection();
  return handle("config", async () => json({ firebase: env.firebase() }));
}
