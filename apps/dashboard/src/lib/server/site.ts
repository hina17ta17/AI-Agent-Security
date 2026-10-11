import { lookup } from "node:dns/promises";
import { resolveTxt } from "node:dns/promises";
import { isIP } from "node:net";

import { HttpError } from "./http";

/**
 * Registering an external site to protect requires proving you control it, by ownership
 * verification. Verification fetches a file from the site, so this module is careful about SSRF:
 * only https, only public hostnames, every resolved IP must be public, no redirects, and a short
 * timeout with a tiny body cap. (The attack simulator never sends real traffic to a registered
 * site, so registration alone can neither reach nor harm a site you do not control.)
 */

const WELL_KNOWN = "/.well-known/agentguard-verify.txt";
const TXT_PREFIX = "_agentguard";
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY = 1024;

export type SiteUrl = { url: string; host: string };

/** Parse and normalize to an https origin, rejecting anything that is not a public website. */
export function normalizeSiteUrl(input: unknown): SiteUrl {
  if (typeof input !== "string" || input.trim() === "") throw new HttpError(400, "サイトのURLを入力してください");
  let u: URL;
  try {
    u = new URL(input.trim().toLowerCase().startsWith("http") ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new HttpError(400, "URLの形式が正しくありません（例：https://example.com）");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "https で始まるURLにしてください（暗号化された通信のみ対応）");
  const host = u.hostname;
  if (!isPublicHostname(host)) throw new HttpError(400, "この宛先は登録できません（公開されているドメインを指定してください）");
  return { url: `https://${host}${u.port ? `:${u.port}` : ""}`, host };
}

/** Reject IP literals, localhost, and internal-only names up front (before any DNS lookup). */
export function isPublicHostname(host: string): boolean {
  if (!host || host.length > 253) return false;
  if (isIP(host)) return false; // a real site is named by a domain, not a bare IP
  if (!host.includes(".") || host.endsWith(".")) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|example|invalid|localdomain)$/.test(host)) return false;
  return /^[a-z0-9.-]+$/.test(host) && !host.includes("..");
}

/** True for addresses that must never be reached by a server-side fetch. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    return (
      a === 0 || a === 10 || a === 127 || // this host, private, loopback
      (a === 169 && b === 254) || // link-local
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 192 && b === 0) || // 192.0.0.0/24 and 192.0.2.0/24 (documentation)
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51) || a === 203 || // documentation ranges
      a >= 224 // multicast / reserved
    );
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase();
    if (ip6 === "::1" || ip6 === "::") return true;
    if (ip6.startsWith("fe80") || ip6.startsWith("fc") || ip6.startsWith("fd")) return true; // link-local / ULA
    if (ip6.startsWith("::ffff:")) return isPrivateAddress(ip6.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // not a valid IP -> treat as unsafe
}

async function assertPublicHost(host: string): Promise<void> {
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new HttpError(400, "このドメインが見つかりませんでした。URLを確認してください。");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new HttpError(400, "この宛先は確認できません（内部ネットワークのアドレスには接続しません）。");
  }
}

/** Why a check failed, so the owner knows what to fix. */
export type CheckResult =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "not_found" | "redirect" | "mismatch" | "no_record";
      status?: number; location?: string };

/** Fetch the well-known file and check it contains the token. Redirects are reported, never followed. */
export async function checkFile(host: string, token: string): Promise<CheckResult> {
  await assertPublicHost(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://${host}${WELL_KNOWN}`, {
      method: "GET",
      redirect: "manual", // a redirect could point back at an internal address: report it instead
      signal: controller.signal,
      headers: { "user-agent": "AgentGuard-SiteVerify/1.0", accept: "text/plain" },
      cache: "no-store",
    });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, reason: "redirect", status: res.status,
               location: (res.headers.get("location") ?? "").slice(0, 200) || undefined };
    }
    if (!res.ok) return { ok: false, reason: "not_found", status: res.status };
    const text = (await res.text()).slice(0, MAX_BODY);
    return text.includes(token) ? { ok: true } : { ok: false, reason: "mismatch" };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** Check a DNS TXT record at _agentguard.<host> contains the token. */
export async function checkDns(host: string, token: string): Promise<CheckResult> {
  let records: string[][];
  try {
    records = await resolveTxt(`${TXT_PREFIX}.${host}`);
  } catch {
    return { ok: false, reason: "no_record" }; // not added yet, or not propagated
  }
  return records.some((chunks) => chunks.join("").includes(token))
    ? { ok: true }
    : { ok: false, reason: records.length ? "mismatch" : "no_record" };
}

export const verifyFilePath = WELL_KNOWN;
export const verifyTxtName = TXT_PREFIX;
