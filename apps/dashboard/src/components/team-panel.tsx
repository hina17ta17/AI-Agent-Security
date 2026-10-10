"use client";

import { Sparkles } from "lucide-react";

import type { Incident, Step } from "@/lib/types";

import { type Member, type Mood, Mascot, TEAM } from "./mascots";
import { Card, CardHeader, cx } from "./ui";

const ORDER: Member[] = ["mihari", "bannin", "shirabe", "mamoru", "tsutae"];

export function moodsFor(incident: Incident | null, steps: Step[], live: boolean): Record<Member, Mood> {
  const moods = Object.fromEntries(ORDER.map((m) => [m, "idle"])) as Record<Member, Mood>;
  if (!incident) return moods;
  const spoke = new Set(steps.map((s) => s.agent));
  ORDER.forEach((m) => {
    if (spoke.has(m)) moods[m] = "happy"; // finished their part
  });
  if (!live) return moods;
  moods.mihari = "alert";
  const last = [...steps].reverse().find((s) => ORDER.includes(s.agent as Member));
  if (last) moods[last.agent as Member] = "active";
  return moods;
}

export function TeamPanel({ moods }: { moods: Record<Member, Mood> }) {
  return (
    <Card>
      <CardHeader title="AgentGuard チーム" icon={<Sparkles size={16} className="text-brand" />} sub="攻撃が来た瞬間だけ、AIのメンバーが出動します" />
      <div className="grid grid-cols-5 gap-2 p-4 sm:gap-3 sm:p-5">
        {ORDER.map((m) => {
          const t = TEAM[m];
          const mood = moods[m];
          const busy = mood === "active" || mood === "alert";
          return (
            <div
              key={m}
              className={cx(
                "flex flex-col items-center rounded-2xl border px-1 py-3 text-center transition",
                busy ? "border-transparent shadow-lift" : "border-line bg-white",
              )}
              style={busy ? { background: `${t.color}14` } : undefined}
            >
              <Mascot member={m} mood={mood} size={52} />
              <div className="mt-1.5 font-display text-sm font-bold">{t.name}</div>
              <div className="hidden text-[11px] leading-tight text-muted sm:block">{t.role}</div>
              <div className="mt-1 text-[10px] font-semibold" style={{ color: t.color }}>
                {mood === "active" ? "対応中…" : mood === "alert" ? "警戒中" : mood === "happy" ? "完了" : t.ai ? "待機（AI）" : "待機"}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
