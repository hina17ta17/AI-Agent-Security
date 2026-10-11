"use client";

import { Brain, Cog, Radio, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";

import { ATTACK_LABEL, SEVERITY, timeJst } from "@/lib/format";
import type { Incident, Step, Verdict } from "@/lib/types";

import { type Member, Mascot, TEAM } from "./mascots";
import { Badge, Card, CardHeader, cx, Empty } from "./ui";

const KIND_STYLE: Record<string, string> = {
  detect: "border-danger/30 bg-danger/5",
  guard: "border-brand2/30 bg-brand2/5",
  verdict: "border-warn/40 bg-warn/8",
  action: "border-safe/40 bg-safe/10 font-semibold",
  approval: "border-warn/50 bg-warn/12 font-semibold",
  refused: "border-warn/40 bg-warn/8",
  policy: "border-warn/40 bg-warn/8",
  wave: "border-brand/30 bg-brand/5 font-semibold",
  warning: "border-warn/40 bg-warn/8",
  error: "border-danger/40 bg-danger/8",
};

function Avatar({ agent }: { agent: Step["agent"] }) {
  if (agent === "system") {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-muted">
        <Cog size={18} />
      </span>
    );
  }
  return <Mascot member={agent as Member} size={36} className="shrink-0" />;
}

function VerdictChips({ v }: { v: Partial<Verdict> }) {
  const sev = v.severity ? SEVERITY[v.severity] : null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {v.attack_type && <Badge tone="brand">{ATTACK_LABEL[v.attack_type] ?? v.attack_type}</Badge>}
      {sev && <Badge tone={sev.tone}>重大度：{sev.label}</Badge>}
      {typeof v.confidence === "number" && <Badge tone="muted">確信度 {Math.round(v.confidence * 100)}%</Badge>}
      {v.targets_ai && <Badge tone="danger">AIを狙った攻撃</Badge>}
    </div>
  );
}

function StepBubble({ step }: { step: Step }) {
  const name = step.agent === "system" ? "システム" : TEAM[step.agent as Member]?.name ?? step.agent;
  const guardHit = step.kind === "guard" && (step.extra as { promptInjection?: boolean })?.promptInjection;

  if (step.kind === "thought") {
    return (
      <details className="group ml-12 rounded-xl border border-dashed border-line bg-slate-50/70 px-3 py-2 text-xs text-muted">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold">
          <Brain size={13} /> {name}の内部思考（英語・要約）を見る
        </summary>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{step.text}</p>
      </details>
    );
  }
  if (step.kind === "tool_call") {
    const tool = (step.extra as { tool?: string })?.tool ?? "tool";
    return (
      <div className="ml-12 flex items-center gap-2 text-xs text-muted">
        <Wrench size={13} className="text-safe" />
        <code className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-ink">{tool}</code>
        <span>を実行</span>
      </div>
    );
  }
  if (step.kind === "status" || step.kind === "route") {
    return (
      <div className="flex items-center gap-2 py-0.5 pl-1 text-xs text-muted">
        <Radio size={12} className="text-brand" />
        <span>{step.text}</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <Avatar agent={step.agent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span className="font-display font-bold text-ink">{name}</span>
          <span className="text-muted tabular-nums">{timeJst(step.at)}</span>
        </div>
        <div className={cx("mt-1 rounded-2xl rounded-tl-md border border-line bg-white px-3.5 py-2.5 text-sm leading-relaxed", KIND_STYLE[step.kind], guardHit && "border-danger/50 bg-danger/10 font-semibold text-rose-700")}>
          {step.text}
          {step.kind === "verdict" && <VerdictChips v={(step.extra as { verdict?: Partial<Verdict> })?.verdict ?? {}} />}
        </div>
      </div>
    </div>
  );
}

export function LiveFeed({ incident, steps, live, title, showLink = true }: {
  incident: Incident | null;
  steps: Step[];
  live: boolean;
  title?: string;
  showLink?: boolean;
}) {
  // No automatic scrolling: the page stays where the viewer is, and the feed simply grows.
  return (
    <Card className="flex min-h-105 flex-col">
      <CardHeader
        title={live ? "ライブ実況" : title ?? "直近の対応"}
        icon={<span className={cx("size-2.5 rounded-full", live ? "bg-danger animate-pulse" : "bg-safe")} />}
        sub={incident ? `${incident.attack?.labelJa ?? "攻撃"}｜${incident.attack?.srcIp ?? ""}` : undefined}
        right={incident && showLink && <Link href={`/app/incidents/${incident.id}`} className="text-xs font-semibold text-brand hover:underline">詳細 →</Link>}
      />
      {!incident ? (
        <Empty>まだ攻撃はありません。右の「攻撃シミュレーター」で試してみましょう。</Empty>
      ) : (
        <div className="mt-3 flex-1 space-y-3 px-5 pb-5">
          <AnimatePresence initial={false}>
            {steps.map((s) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                <StepBubble step={s} />
              </motion.div>
            ))}
          </AnimatePresence>
          {live && (
            <div className="flex items-center gap-2 pl-12 text-xs text-muted">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="size-1.5 animate-bounce rounded-full bg-brand" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              チームが対応中…
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
