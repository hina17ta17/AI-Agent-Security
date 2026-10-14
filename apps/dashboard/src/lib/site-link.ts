import { toDate } from "./format";
import type { Tenant } from "./types";

/** Reports within this window count as "connected" (the WAF records them at most once a minute). */
export const ALIVE_MS = 15 * 60_000;

/**
 * What the latest report from the registered site says. A report counts only when it came with the
 * current connection key: right after a key is replaced (re-registering, "作り直す"), the old key still
 * works for up to a minute because the WAF caches keys, and its reports must not look like the new
 * key working (that made the ownership check fail with a key mismatch right after registering).
 */
export function siteReport(tenant: Tenant | null | undefined, now: number): { last: Date | null; alive: boolean; oldKey: boolean } {
  const last = toDate(tenant?.siteLastReportAt);
  const recent = last !== null && now - last.getTime() < ALIVE_MS;
  const from = tenant?.siteReportKeyHint;
  const current = tenant?.ingestKeyHint;
  // The latest report came with a key that is no longer the current one: the site still has the old key.
  const oldKey = last !== null && !!from && !!current && from !== current;
  return { last, alive: recent && !oldKey, oldKey };
}
