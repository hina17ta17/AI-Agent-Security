import { createHash } from "node:crypto";

/**
 * Coarse, privacy-preserving facts about a sign-in, for the account's own security view.
 *
 * We deliberately never store a full IP address or a precise fingerprint: the owner (and no one
 * else, including the operator) sees only a truncated network and a browser/OS label. The device
 * hash is salted with the uid, so the same browser under two accounts never correlates.
 */
export type ClientInfo = {
  ipPrefix: string; // e.g. "203.0.113.x" or "2001:db8:1::" — never the full address
  device: string; // e.g. "Chrome / Windows"
  deviceHash: string; // sha256(uid + device), for "new device" matching only
};

/** Cloud Run appends the real client last; earlier entries were written by the client and can be faked. */
function clientIp(xff: string | null): string | null {
  const last = (xff ?? "").split(",").pop()?.trim();
  return last || null;
}

/** Drop the host part so a stored "location" can never identify one machine or person. */
export function truncateIp(ip: string | null): string {
  if (!ip) return "不明";
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean).slice(0, 3);
    return groups.length ? `${groups.join(":")}::` : "不明";
  }
  const octets = ip.split(".");
  return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.x` : "不明";
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/\bWindows\b/, "Windows"],
  [/\b(iPhone|iPad|iOS)\b/, "iOS"],
  [/\bMac OS X\b/, "macOS"],
  [/\bAndroid\b/, "Android"],
  [/\bLinux\b/, "Linux"],
];

function label(ua: string, table: [RegExp, string][]): string | null {
  for (const [re, name] of table) if (re.test(ua)) return name;
  return null;
}

/** Read the client facts from the request headers (Cloud Run puts the real client first in XFF). */
export function clientInfo(request: Request, uid: string): ClientInfo {
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 400);
  const browser = label(ua, BROWSERS) ?? "不明なブラウザ";
  const system = label(ua, SYSTEMS) ?? "不明なOS";
  const device = `${browser} / ${system}`;
  return {
    ipPrefix: truncateIp(clientIp(request.headers.get("x-forwarded-for"))),
    device,
    deviceHash: createHash("sha256").update(`${uid}\u0000${device}`).digest("hex").slice(0, 16),
  };
}
