"use client";

import { ArrowRight, CircleAlert, Globe, Hourglass, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { ago } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";
import { siteReport } from "@/lib/site-link";
import type { Tenant } from "@/lib/types";

import { cx } from "./ui";

/**
 * The first thing on the dashboard: which site AgentGuard protects for this account, said plainly.
 * Protected = ownership confirmed and the site reports with the current key; "つながっています"
 * when a report arrived in the last 15 minutes.
 */
export function SiteGuardBanner() {
  const tenant = useTenant().data;
  // Nothing before the account loads, which also keeps the clock out of prerendering.
  return tenant ? <SiteGuardView tenant={tenant} /> : null;
}

const toSite = (label: string) => (
  <Link href="/app/site" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-brand hover:underline">
    {label} <ArrowRight size={14} />
  </Link>
);

function Frame({ tone, icon, title, children, action }: {
  tone: "safe" | "warn" | "muted"; icon: ReactNode; title: ReactNode; children: ReactNode; action?: ReactNode;
}) {
  return (
    <section aria-label="守っているサイト" className={cx("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border p-4 sm:p-5",
      tone === "safe" ? "border-safe/40 bg-linear-to-br from-safe/15 via-white to-white"
        : tone === "warn" ? "border-warn/40 bg-warn/10" : "border-dashed border-line bg-white")}>
      <span className={cx("grid size-12 shrink-0 place-items-center rounded-2xl",
        tone === "safe" ? "bg-safe text-white" : tone === "warn" ? "bg-warn/20 text-amber-700" : "bg-slate-100 text-muted")}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-base font-black text-ink sm:text-lg">{title}</div>
        <div className="mt-0.5 text-xs text-muted sm:text-sm">{children}</div>
      </div>
      {/* On phones the link gets its own line, so the text keeps the width. */}
      {action && <div className="w-full pl-16 sm:w-auto sm:pl-0">{action}</div>}
    </section>
  );
}

function SiteGuardView({ tenant }: { tenant: Tenant }) {
  const now = useNow(10_000);
  const site = tenant.site;
  const { last, alive, oldKey } = siteReport(tenant, now);
  const url = site && (
    <a href={site.url} target="_blank" rel="noreferrer" className="break-all font-mono font-semibold text-ink hover:underline">{site.url}</a>
  );

  if (!site) {
    return (
      <Frame tone="muted" icon={<Globe size={24} />} title="守っているサイトは、まだありません" action={toSite("守るサイトを登録する")}>
        自分のサイトを登録すると、届くアクセスをミハリと AI チームが1件ずつ見張って守ります。
      </Frame>
    );
  }
  if (site.status === "pending") {
    return (
      <Frame tone="warn" icon={<Hourglass size={24} />} title="サイトをつなぐ途中です" action={toSite("続きをする")}>
        {url} はまだ守れていません。「守るサイト」の画面で、残りの手順を進めてください。
      </Frame>
    );
  }
  if (oldKey) {
    return (
      <Frame tone="warn" icon={<CircleAlert size={24} />} title="サイトの接続キーが、前のキーのままです" action={toSite("入れかえ方を見る")}>
        {url} に入っているキーは、もう使えません。新しいキーに入れかえるまで、このサイトは守れていません。
      </Frame>
    );
  }
  if (!last) {
    return (
      <Frame tone="warn" icon={<Hourglass size={24} />} title="サイトからの合図を待っています" action={toSite("守るサイトの画面へ")}>
        {url} の登録は終わっています。つなぐファイルを置いてサイトを更新し、サイトをブラウザで1回開くと、守り始めます。
      </Frame>
    );
  }
  return (
    <Frame tone="safe" icon={<ShieldCheck size={26} />}
           title={<span className="flex flex-wrap items-center gap-2">このサイトを守っています
             <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold",
               alive ? "bg-safe/15 text-emerald-700" : "bg-slate-100 text-muted")}>
               <span className={cx("size-1.5 rounded-full", alive ? "animate-pulse bg-safe" : "bg-slate-400")} />
               {alive ? "つながっています" : "アクセス待ち"}
             </span>
           </span>}
           action={toSite("くわしく見る")}>
      {url}
      <span className="mt-0.5 block">
        {alive
          ? <>届くアクセスを、ミハリと AI チームが1件ずつ見張っています（最後にアクセスを確認：{ago(last, now)}）。</>
          : <>いまはアクセスがありません（最後にアクセスを確認：{ago(last, now)}）。アクセスが来たら、すぐに見張ります。</>}
      </span>
    </Frame>
  );
}
