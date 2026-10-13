import { isIP } from "node:net";

import { HttpError } from "./http";

export const MAX_ALLOWLIST = 20;

/** An IP address or a CIDR range of reasonable size (IPv4 /8 or narrower, IPv6 /16 or narrower). */
export function validCidr(entry: string): boolean {
  const [ip, prefix, extra] = entry.split("/");
  if (extra !== undefined || !ip) return false;
  const family = isIP(ip);
  if (!family) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return family === 4 ? bits >= 8 && bits <= 32 : bits >= 16 && bits <= 128;
}

/** Validate an allowlist from a request body; returns the de-duplicated entries. */
export function parseAllowlist(allowlist: unknown): string[] {
  if (!Array.isArray(allowlist)) throw new HttpError(400, "許可リストの形式が正しくありません");
  const entries = [...new Set(allowlist.map((e) => String(e).trim()).filter(Boolean))];
  if (entries.length > MAX_ALLOWLIST) throw new HttpError(400, `許可リストは${MAX_ALLOWLIST}件までです`);
  const invalid = entries.filter((e) => !validCidr(e));
  if (invalid.length) throw new HttpError(400, `正しくない形式があります：${invalid.slice(0, 3).join("、")}`);
  return entries;
}
