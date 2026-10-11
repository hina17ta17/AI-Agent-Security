// What is going on right now when several attacks arrive at once (mirrors services/agent/app/concurrency.py).
import { toDate } from "./format";
import type { Campaign, Incident, Tenant, TenantStatus } from "./types";

/** Same as the agent's ACTIVE_STALE_SEC: a crashed run can never keep the dashboard red. */
export const ACTIVE_STALE_MS = 300_000;
/** Shown as "in progress" while events arrived this recently. */
const WAVE_ACTIVE_MS = 10_000;
/** Incidents this recent are shown as tabs next to the ones still running. */
const RECENT_MS = 300_000;
/** A finished wave stays on screen for a while so its result can be read. */
const WAVE_VISIBLE_MS = 600_000;

const millis = (t: Parameters<typeof toDate>[0]) => toDate(t)?.getTime() ?? null;

/** Running AI investigations, newest first. */
export function activeIncidentIds(tenant: Tenant | null, now: number): string[] {
  return Object.entries(tenant?.active ?? {})
    .map(([id, at]) => [id, millis(at)] as const)
    .filter((e): e is readonly [string, number] => e[1] !== null && now - e[1] < ACTIVE_STALE_MS)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/** The tenant status as it should be shown now (a stale "responding" falls back to "safe"). */
export function liveStatus(tenant: Tenant | null, now: number): { status: TenantStatus; activeIds: string[] } {
  const activeIds = activeIncidentIds(tenant, now);
  let status: TenantStatus = tenant?.status ?? "safe";
  if (status === "responding") {
    const stale = tenant?.active
      ? activeIds.length === 0
      : now - (millis(tenant?.statusAt) ?? 0) >= ACTIVE_STALE_MS; // written before concurrent handling existed
    if (stale) status = "safe";
  }
  return { status, activeIds };
}

/** Incidents to show as tabs: everything still running plus the last few minutes. */
export function concurrentIncidents(incidents: Incident[], activeIds: string[], now: number, max = 6): Incident[] {
  return incidents
    .filter((i) => activeIds.includes(i.id) || now - (millis(i.createdAt) ?? 0) < RECENT_MS)
    .slice(0, max);
}

/** Attacks are still arriving (the agent keeps the wave open for WAVE_IDLE_SEC to absorb late events). */
export function waveActive(wave: Campaign | null, now: number): boolean {
  const last = millis(wave?.lastEventAt);
  return last !== null && now - last < WAVE_ACTIVE_MS;
}

export function waveVisible(wave: Campaign | null, now: number): wave is Campaign {
  const last = millis(wave?.lastEventAt);
  return last !== null && now - last < WAVE_VISIBLE_MS;
}
