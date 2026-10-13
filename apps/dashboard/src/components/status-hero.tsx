"use client";

import { ArrowRight, ExternalLink, Layers, ShieldAlert, ShieldCheck, ShieldEllipsis, Wrench } from "lucide-react";
import type { Timestamp } from "firebase/firestore";
import { motion } from "motion/react";
import Link from "next/link";

import { liveStatus } from "@/lib/activity";
import { remaining, seconds, toDate } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { Incident, Tenant } from "@/lib/types";

import { cx } from "./ui";

type Mode = "safe" | "responding" | "awaiting" | "maintenance";

const COPY: Record<Mode, { title: string; sub: string; ring: string; glow: string; text: string }> = {
  safe: { title: "平常運転中", sub: "ミハリが静かに見張っています", ring: "bg-safe", glow: "from-safe/25", text: "text-emerald-600" },
  responding: { title: "迎撃中！", sub: "AIチームが出動しています", ring: "bg-danger", glow: "from-danger/25", text: "text-rose-600" },
  awaiting: { title: "あなたの判断を待っています", sub: "AIチームから承認の依頼が届いています", ring: "bg-warn", glow: "from-warn/30", text: "text-amber-600" },
  maintenance: { title: "メンテナンス中", sub: "承認により、サイトを一時停止しています", ring: "bg-warn", glow: "from-warn/30", text: "text-amber-600" },
};

export function StatusHero({ tenant, incident, defendedAt }: {
  tenant: Tenant | null;
  incident: Incident | null;
  /** Server time of the first defensive action (block/watch) of the active incident, if done. */
  defendedAt?: Timestamp | null;
}) {
  const now = useNow(200);
  const { status, activeIds } = liveStatus(tenant, now);
  const maintenanceUntil = toDate(tenant?.maintenanceUntil);
  const inMaintenance = tenant?.siteMode === "maintenance" && (!maintenanceUntil || maintenanceUntil.getTime() > now);
  const mode: Mode =
    status === "responding" ? "responding"
    : status === "awaiting_approval" ? "awaiting"
    : inMaintenance ? "maintenance"
    : "safe";
  const c = COPY[mode];
  // Timers belong to the incident on screen; with concurrent attacks others may still be running.
  const incidentLive = mode === "responding" && incident?.status === "analyzing";
  // Both timestamps come from server clocks; `now` is server-aligned (see lib/clock.ts).
  const received = toDate(incident?.timings?.receivedAt);
  const defended = toDate(defendedAt);
  const defendSec = mode === "responding" && received && defended
    ? Math.max(0, (defended.getTime() - received.getTime()) / 1000) : null;
  const elapsed = incidentLive && received && defendSec === null
    ? Math.max(0, (now - received.getTime()) / 1000) : null;
  const concurrent = mode === "responding" ? activeIds.length : 0;
  const Icon = mode === "responding" ? ShieldAlert : mode === "awaiting" ? ShieldEllipsis : mode === "maintenance" ? Wrench : ShieldCheck;

  return (
    <section className="relative overflow-hidden rounded-card border border-line bg-card shadow-soft">
      <div className={cx("absolute inset-0 bg-linear-to-br to-transparent transition-colors duration-700", c.glow)} />
      <div className="grid-dots absolute inset-0 opacity-60" />
      <div className="relative flex flex-col items-center gap-6 p-6 sm:flex-row sm:p-8">
        <div className="relative grid size-36 shrink-0 place-items-center">
          <span className={cx("absolute inset-0 rounded-full opacity-20", c.ring, mode === "safe" && "animate-breathe")} />
          {mode === "responding" && (
            <>
              <span className={cx("absolute inset-0 rounded-full", c.ring, "animate-ripple")} />
              <span className={cx("absolute inset-0 rounded-full", c.ring, "animate-ripple [animation-delay:0.8s]")} />
            </>
          )}
          <span className="absolute inset-4 rounded-full bg-white shadow-soft" />
          {/* Remount with a pop-in on every change; no exit phase, so the icon can never get stuck hidden. */}
          <motion.span
            key={mode}
            initial={{ scale: 0.6, opacity: 0, rotate: -10 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className={cx("relative", c.text)}
          >
            <Icon size={58} strokeWidth={1.8} />
          </motion.span>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-bold tracking-widest text-muted">STATUS</p>
          <motion.h1
            key={c.title}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={cx("mt-1 font-display text-3xl font-bold sm:text-4xl", c.text)}
          >
            {c.title}
          </motion.h1>
          <p className="mt-1 text-sm text-muted">{c.sub}</p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            {concurrent >= 2 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger px-3 py-1 text-sm font-bold text-white tabular-nums">
                <Layers size={14} /> 同時に {concurrent} 件対応中
              </span>
            )}
            {elapsed !== null && (
              <span className="rounded-full bg-danger/10 px-3 py-1 font-mono text-sm font-bold text-rose-600 tabular-nums">
                経過 {seconds(elapsed)} 秒
              </span>
            )}
            {defendSec !== null && (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-safe/15 px-3 py-1 font-mono text-sm font-bold text-emerald-700 tabular-nums">
                  <ShieldCheck size={14} /> 防御完了 {seconds(defendSec)} 秒
                </span>
                {incidentLive && <span className="text-xs text-muted">ツタエが報告書を作成中…</span>}
              </>
            )}
            {mode === "maintenance" && (
              <span className="rounded-full bg-warn/15 px-3 py-1 text-sm font-semibold text-amber-700">
                解除まで {remaining(maintenanceUntil, now)}
              </span>
            )}
            {tenant?.site?.status === "verified" ? (
              <a
                href={tenant.site.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold text-brand hover:bg-brand/5"
              >
                守っているサイトを開く <ExternalLink size={14} />
              </a>
            ) : (
              <Link
                href="/app/site"
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-sm font-semibold text-brand hover:bg-brand/5"
              >
                {tenant?.site ? "サイトとの連携を仕上げる" : "守るサイトを登録する"} <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
