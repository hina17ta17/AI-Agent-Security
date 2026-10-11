"use client";

import { CircleCheck, Layers, Loader2, Pin, PinOff, ShieldEllipsis, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { ATTACK_LABEL } from "@/lib/format";
import type { Incident } from "@/lib/types";

import { cx } from "./ui";

const STATE: Record<Incident["status"], { label: string; icon: ReactNode; tone: string }> = {
  analyzing: { label: "対応中", icon: <Loader2 size={14} className="animate-spin" />, tone: "text-rose-600" },
  resolved: { label: "完了", icon: <CircleCheck size={14} />, tone: "text-emerald-600" },
  awaiting_approval: { label: "承認待ち", icon: <ShieldEllipsis size={14} />, tone: "text-amber-600" },
  fallback: { label: "ルールで対処", icon: <TriangleAlert size={14} />, tone: "text-slate-500" },
};

/**
 * Several attacks handled at the same time. The view follows the newest one automatically
 * until a tab is chosen; then it stays on that incident until "自動で追う" is pressed.
 */
export function IncidentTabs({ incidents, running, focusId, pinned, onSelect, onAuto }: {
  incidents: Incident[];
  /** How many of them the AI team is still working on. */
  running: number;
  focusId: string | null;
  pinned: boolean;
  onSelect: (id: string) => void;
  onAuto: () => void;
}) {
  return (
    <section className="rounded-card border border-line bg-card p-3 shadow-soft sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="flex items-center gap-2 text-sm font-bold text-ink">
          <Layers size={16} className="text-brand" />
          直近の攻撃 {incidents.length}件
          {running > 0 && <span className="text-rose-600">（{running}件を並行して対応中）</span>}
        </p>
        {pinned ? (
          <button
            onClick={onAuto}
            className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/15"
          >
            <PinOff size={13} /> 固定を解除して自動で追う
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Pin size={13} /> 自動で最新を表示中（タブを選ぶと固定）
          </span>
        )}
      </div>
      <div role="tablist" aria-label="直近のインシデント" className="mt-2.5 flex flex-wrap gap-2">
        {incidents.map((i) => {
          const state = STATE[i.status] ?? STATE.resolved;
          const selected = i.id === focusId;
          const label = i.verdict?.targets_ai ? "AIをだます攻撃" : ATTACK_LABEL[i.attack?.type] ?? i.attack?.labelJa ?? "攻撃";
          return (
            <button
              key={i.id}
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(i.id)}
              className={cx(
                "flex min-w-0 items-center gap-2 rounded-2xl border px-3 py-2 text-left transition",
                selected ? "border-brand bg-brand/8 shadow-lift" : "border-line bg-white hover:-translate-y-0.5 hover:shadow-lift",
              )}
            >
              <span className={cx("shrink-0", state.tone)} title={state.label}>{state.icon}</span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-ink">{label}</span>
                <span className="block font-mono text-[11px] text-muted">
                  {i.attack?.srcIp} ・ <span className={state.tone}>{state.label}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
