"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";

import { ago, seconds, yen } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { Incident } from "@/lib/types";

import { Badge, Card, CardHeader, Empty, type Tone } from "./ui";

export const STATUS: Record<Incident["status"], { label: string; tone: Tone }> = {
  analyzing: { label: "対応中", tone: "danger" },
  resolved: { label: "解決", tone: "safe" },
  awaiting_approval: { label: "承認待ち", tone: "warn" },
  fallback: { label: "ルールで対処", tone: "warn" },
};

export function IncidentList({ incidents }: { incidents: Incident[] }) {
  const now = useNow(10000);
  return (
    <Card>
      <CardHeader title="インシデント履歴" icon={<ListChecks size={16} className="text-brand" />} sub="クリックすると詳細とタイムラインを見られます" />
      {incidents.length === 0 ? (
        <Empty>まだインシデントはありません</Empty>
      ) : (
        <ul className="divide-y divide-line px-2 pb-2 pt-2">
          {incidents.map((i) => {
            const s = STATUS[i.status] ?? STATUS.analyzing;
            const block = i.actions?.find((a) => a.type === "block_ip");
            return (
              <li key={i.id}>
                <Link href={`/app/incidents/${i.id}`} className="flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold">{i.attack?.labelJa ?? "攻撃"}</span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {i.guard?.promptInjection && <Badge tone="danger">AIをだます攻撃</Badge>}
                      {(i.relatedEvents ?? 1) > 1 && <Badge tone="muted">+{(i.relatedEvents ?? 1) - 1}件</Badge>}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-muted">
                      {i.attack?.srcIp} ・ {i.attack?.method} {i.attack?.path} ・ {ago(i.createdAt, now)}
                    </div>
                  </div>
                  <div className="hidden text-right text-xs text-muted sm:block">
                    <div><span className="font-mono font-bold text-emerald-600">{seconds(i.timings?.aiActionSec)}</span> 秒で対処</div>
                    <div>{block ? `${block.minutes}分ブロック` : "—"} ・ {yen(i.estCostUsd)}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
