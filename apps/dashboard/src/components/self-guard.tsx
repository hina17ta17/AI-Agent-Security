"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ago, dateTimeJst } from "@/lib/format";
import { useNow } from "@/lib/hooks";

import { cx } from "./ui";

type Recent = { at: number | null; label: string; result: "resolved" | "fallback" | "analyzing" | "other"; minutes: number | null };
type SelfStatus = {
  on: boolean; lastCheckedAt: number | null; checked: number; stopped: number; blockedIps: number; recent?: Recent[];
};

const ALIVE_MS = 15 * 60_000;
const count = (n: number) => n.toLocaleString("ja-JP");

function useSelfStatus(): SelfStatus | null {
  const [status, setStatus] = useState<SelfStatus | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/api/self-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SelfStatus | null) => { if (!stop && s) setStatus(s); })
      .catch(() => {}); // only a status card: keep the last numbers on a network hiccup
    void load();
    const t = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  return status;
}

/**
 * Proof that AgentGuard guards itself: this dashboard's own requests go through the same Mihari
 * and AI team as a registered site. Visible to everyone, signed in or not. `detailed` adds the
 * latest attacks it stopped (time, kind and result only); `moreHref` links to that view.
 */
export function SelfGuard({ compact = false, detailed = false, moreHref }: {
  compact?: boolean; detailed?: boolean; moreHref?: string;
}) {
  const status = useSelfStatus();
  // Nothing is shown before the numbers arrive, which also keeps the clock out of prerendering.
  return status ? <SelfGuardView status={status} compact={compact} detailed={detailed} moreHref={moreHref} /> : null;
}

function resultText(r: Recent): string {
  if (r.result === "analyzing") return "対応中";
  if (r.result === "fallback") return r.minutes ? `ルールで${r.minutes}分ブロック` : "ルールで遮断";
  return r.minutes ? `AIチームが${r.minutes}分ブロック` : "遮断して解決";
}

function SelfGuardView({ status, compact, detailed, moreHref }: {
  status: SelfStatus; compact: boolean; detailed: boolean; moreHref?: string;
}) {
  const now = useNow(5000);
  const alive = status.on && status.lastCheckedAt !== null && now - status.lastCheckedAt < ALIVE_MS;
  const recent = status.recent ?? [];

  return (
    <div className={cx("rounded-2xl border p-4", alive ? "border-safe/30 bg-safe/5" : "border-line bg-white/70")}>
      <p className="flex items-center gap-2 text-sm font-bold text-ink">
        <ShieldCheck size={16} className={alive ? "text-safe" : "text-muted"} />
        {alive ? "このサイト（AgentGuard）自身も、AIチームが守っています" : "AgentGuard 自身の見張りは、いま休止中です"}
      </p>
      {!compact && (
        <p className="mt-1 text-xs text-muted">
          このダッシュボードの画面と API に届くアクセスも、あなたのサイトと同じように、ミハリと AI チームが1件ずつ検査しています。
          パスワードの確認そのものは Google の Firebase Authentication が行い、何度も間違えるとそこで止まります（Google アカウントでのログインも同じです）。
        </p>
      )}
      <dl className={cx("mt-3 grid grid-cols-2 gap-2 text-center", !compact && "sm:grid-cols-4")}>
        {[
          ["最後の検査", status.lastCheckedAt ? ago(new Date(status.lastCheckedAt), now) : "—"],
          ["検査したアクセス", `${count(status.checked)}件`],
          ["止めた攻撃", `${count(status.stopped)}件`],
          ["ブロック中のIP", `${count(status.blockedIps)}件`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white/80 px-2 py-2">
            <dt className="text-[11px] text-muted">{label}</dt>
            <dd className="font-mono text-sm font-bold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {detailed && (
        <div className="mt-4">
          <p className="text-xs font-bold text-ink">最近止めた、AgentGuard への攻撃</p>
          {recent.length === 0 ? (
            <p className="mt-1 text-xs text-muted">まだありません。</p>
          ) : (
            <ul className="mt-1.5 divide-y divide-line rounded-xl border border-line bg-white/80">
              {recent.map((r, i) => (
                <li key={`${r.at}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-xs">
                  <span className="font-mono text-muted tabular-nums">{r.at ? dateTimeJst(new Date(r.at)) : "—"}</span>
                  <span className="font-semibold text-ink">{r.label}</span>
                  <span className={r.result === "analyzing" ? "text-rose-600" : "text-emerald-700"}>{resultText(r)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1.5 text-[11px] text-muted">攻撃元のアドレスや攻撃の中身は、ここには表示しません。</p>
        </div>
      )}
      {moreHref && (
        <Link href={moreHref} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
          止めた攻撃の記録を見る →
        </Link>
      )}
    </div>
  );
}
