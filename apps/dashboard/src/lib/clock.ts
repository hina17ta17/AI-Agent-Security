// Server-aligned clock for the browser.
//
// Elapsed times compare "now" with timestamps written by the servers. A viewer's PC clock can be
// off by seconds (a 2.4 s fast clock was observed in testing), which would inflate the counters.
// We estimate the offset once, NTP-style, from the /api/config round trip and use it everywhere.

let offsetMs = 0;

/** t0/t1: local Date.now() just before sending and just after receiving the response. */
export function calibrate(serverNowMs: number, t0: number, t1: number): void {
  if (!Number.isFinite(serverNowMs)) return;
  offsetMs = serverNowMs - (t0 + t1) / 2;
}

/** Milliseconds since the epoch on the servers' clock. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

export function clockOffsetMs(): number {
  return offsetMs;
}
