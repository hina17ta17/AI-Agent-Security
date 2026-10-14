import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { resolveTxt } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { HttpError } from "./http";

/**
 * Registering an external site to protect requires proving you control it, by ownership
 * verification. Verification fetches a file from the site, so this module is careful about SSRF:
 * only https, only public hostnames, every resolved IP must be public, no redirects, and a short
 * timeout with a tiny body cap. (The attack simulator never sends real traffic to a registered
 * site, so registration alone can neither reach nor harm a site you do not control.)
 *
 * Two ways to answer the check at <base>/.well-known/agentguard-verify.txt?challenge=<nonce>:
 *  - private (sites that run code): return HMAC-SHA256(key = token, message = nonce) in hex. The
 *    token stays in the site's environment and never appears publicly; each check uses a fresh
 *    random nonce, and an answer to someone else's nonce reveals nothing about the token.
 *  - public (static sites, e.g. GitHub Pages): a plain file containing the token.
 */

const WELL_KNOWN = "/.well-known/agentguard-verify.txt";
const TXT_PREFIX = "_agentguard";
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY = 1024;

/**
 * A site is a host plus an optional base path: a GitHub Pages project site lives at
 * https://<user>.github.io/<repo>/, so its files (and the ownership file) are under /<repo>/.
 */
export type SiteUrl = { url: string; host: string; path: string };

// Code-hosting pages are not websites; their own site hosting lives on another domain.
const REPO_HOSTS: Record<string, (seg: string[]) => string | null> = {
  "github.com": (s) => (s[0] ? `https://${s[0].toLowerCase()}.github.io/${s[1] ? `${s[1]}/` : ""}` : null),
  "www.github.com": (s) => (s[0] ? `https://${s[0].toLowerCase()}.github.io/${s[1] ? `${s[1]}/` : ""}` : null),
  "gitlab.com": (s) => (s[0] ? `https://${s[0].toLowerCase()}.gitlab.io/${s[1] ? `${s[1]}/` : ""}` : null),
  "bitbucket.org": () => null,
};

/** Parse and normalize to https://host[/base-path], rejecting anything that is not a public website. */
export function normalizeSiteUrl(input: unknown): SiteUrl {
  if (typeof input !== "string" || input.trim() === "") throw new HttpError(400, "サイトのURLを入力してください");
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new HttpError(400, "URLの形式が正しくありません（例：https://example.com）");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "https で始まるURLにしてください（暗号化された通信のみ対応）");
  if (u.port) throw new HttpError(400, "ポート番号の付いたURLには対応していません（https://example.com の形で入力してください）");
  const host = u.hostname;

  const segments = u.pathname.split("/").filter(Boolean);
  const repo = REPO_HOSTS[host];
  if (repo) {
    const pages = repo(segments);
    throw new HttpError(400, "これはプログラムを置く「リポジトリ」のページで、公開されているWebサイトではありません。"
      + (pages ? `GitHub Pages などで公開している場合は、公開先のURL（例：${pages}）を登録してください。` : "公開先のURLを登録してください。"));
  }
  if (!isPublicHostname(host)) throw new HttpError(400, "この宛先は登録できません（公開されているドメインを指定してください）");

  // Keep the base path (the site may live in a sub-folder); drop query, hash and a trailing "/".
  if (segments.some((s) => s === "." || s === "..")) throw new HttpError(400, "URLの形式が正しくありません");
  const path = segments.length ? `/${segments.join("/")}` : "";
  if (path.length > 200 || !/^[A-Za-z0-9._~%\-/]*$/.test(path)) {
    throw new HttpError(400, "URLのパスに使えない文字が含まれています");
  }
  return { url: `https://${host}${path}`, host, path };
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
      (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) || // IETF assignments, TEST-NET-1
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 198 && b === 51 && p[2] === 100) || // TEST-NET-2
      (a === 203 && b === 0 && p[2] === 113) || // TEST-NET-3 (the rest of 203.x is ordinary public space)
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

/**
 * The address check again at connect time. assertPublicHost() runs before the fetch, but a name can
 * answer differently a moment later (DNS rebinding); resolving here, inside the connection itself,
 * means the address actually connected to is the one that was checked.
 */
const publicOnlyLookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
  lookupCallback(hostname, { all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("refused: internal address"), { code: "EADDRNOTAVAIL" }));
    }
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}) as unknown as LookupFunction;

/** One GET over https to a checked public address: no redirects followed, tiny body, hard timeout. */
function getOnce(url: string): Promise<{ status: number; location: string | null; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET",
      lookup: publicOnlyLookup,
      headers: { "user-agent": "AgentGuard-SiteVerify/1.0", accept: "text/plain" },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
        if (text.length > MAX_BODY) res.destroy();
      });
      res.on("error", () => {}); // a dropped connection ends in "close" below
      res.on("close", () => resolve({
        status: res.statusCode ?? 0,
        location: typeof res.headers.location === "string" ? res.headers.location : null,
        text: text.slice(0, MAX_BODY),
      }));
    });
    const timer = setTimeout(() => req.destroy(new Error("timeout")), FETCH_TIMEOUT_MS);
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
    req.end();
  });
}

/** Why a check failed, so the owner knows what to fix. */
export type CheckResult =
  | { ok: true; mode?: "connected" | "private" | "public" }
  | { ok: false; reason: "unreachable" | "not_found" | "redirect" | "mismatch" | "key_mismatch" | "no_record";
      status?: number; location?: string };

/** The answer a site that keeps the token private gives to a challenge. */
export function challengeAnswer(token: string, challenge: string): string {
  return createHmac("sha256", token).update(challenge).digest("hex");
}

/**
 * One connection key does everything on the site. AgentGuard stores only its hash (to accept
 * reports) and this derived verify secret (to check ownership answers), never the key itself.
 * The site's integration code derives the same secret and answers HMAC(secret, challenge).
 */
export function deriveVerifySecret(connectionKey: string): string {
  return createHmac("sha256", connectionKey).update("agentguard-verify").digest("hex");
}

function connectedAnswer(verifySecret: string, challenge: string): string {
  return createHmac("sha256", Buffer.from(verifySecret, "hex")).update(challenge).digest("hex");
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Ask <base>/.well-known/agentguard-verify.txt with a fresh challenge. Accepts the private answer
 * (HMAC of the challenge) or the public token. Redirects are reported, never followed.
 * `path` is the site's base path ("" or "/repo"); the file lives under it.
 */
export async function checkFile(host: string, path: string, token: string,
                                verifySecrets: string[] = []): Promise<CheckResult> {
  await assertPublicHost(host); // early, clear error; the connection checks the address again
  const challenge = randomBytes(16).toString("hex");
  try {
    // A redirect could point back at an internal address: it is reported, never followed.
    const res = await getOnce(`https://${host}${path}${WELL_KNOWN}?challenge=${challenge}`);
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, reason: "redirect", status: res.status, location: (res.location ?? "").slice(0, 200) || undefined };
    }
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: "not_found", status: res.status };
    const answer = res.text.trim();
    if (verifySecrets.some((v) => sameText(answer, connectedAnswer(v, challenge)))) return { ok: true, mode: "connected" };
    if (sameText(answer, challengeAnswer(token, challenge))) return { ok: true, mode: "private" };
    if (res.text.includes(token)) return { ok: true, mode: "public" };
    // An HMAC-shaped answer means AgentGuard's code is running on the site, with another key.
    return { ok: false, reason: /^[0-9a-f]{64}$/.test(answer) ? "key_mismatch" : "mismatch" };
  } catch {
    return { ok: false, reason: "unreachable" };
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
