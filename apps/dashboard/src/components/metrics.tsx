"use client";

import { Gauge } from "lucide-react";

import { ms, seconds, toDate, USD_TO_JPY, yen } from "@/lib/format";
import { useDemoTotal, useNow } from "@/lib/hooks";
import type { BlockEntry, Incident, Usage } from "@/lib/types";

import { Card, CardHeader, Stat } from "./ui";

export function Metrics({ latest, incidents, blocklist, usage, aiMode, byokLimit }: {
  latest: Incident | null;
  incidents: Incident[];
  blocklist: BlockEntry[];
  usage: Usage | null;
  aiMode: "demo" | "byok" | undefined;
  byokLimit?: number | null;
}) {
  const now = useNow(5000);
  const demoTotal = useDemoTotal();
  const activeBlocks = blocklist.filter((b) => (toDate(b.expiresAt)?.getTime() ?? 0) > now).length;
  const costs = incidents.map((i) => i.estCostUsd).filter((c): c is number => typeof c === "number" && c > 0);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const runs = usage?.aiRuns ?? 0;

  // "今日の利用" differs by mode: demo shows today/3 and the lifetime total/10; BYOK shows today
  // against the owner's own cap, or "制限なし".
  const byok = aiMode === "byok";
  const dailyLimit = byok ? (byokLimit === undefined ? 200 : byokLimit) : 3;
  const usageValue = byok
    ? (dailyLimit === null ? String(runs) : `${runs}/${dailyLimit}`)
    : `${runs}/${dailyLimit}`;
  const usageUnit = byok && dailyLimit === null ? "回（制限なし）" : "回";
  const usageHint = byok
    ? "あなたのAPIキーで実行（1日の上限は設定で変更できます）"
    : demoTotal
      ? `デモモード：1日${dailyLimit}回まで・累計 ${demoTotal.demoRuns}/${demoTotal.limit}回`
      : `デモモード：1日${dailyLimit}回まで・1アカウント累計10回まで`;

  return (
    <Card>
      <CardHeader title="いまの数字" icon={<Gauge size={16} className="text-brand" />} sub="すべて実際の計測値です" />
      <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
        <Stat label="初動遮断（ミハリ）" value={ms(latest?.timings?.wafRuleMs)} unit="ms" tone="brand"
              hint="攻撃のリクエストをルールで止めるまで" />
        <Stat label="AIの対処完了" value={seconds(latest?.timings?.aiActionSec)} unit="秒" tone="safe"
              hint="検知からマモルのブロックまで" />
        <Stat label="ブロック中のIP" value={String(activeBlocks)} unit="件" tone={activeBlocks ? "danger" : "muted"}
              hint="期限が来ると自動で解除" />
        <Stat label="今日のAI解析" value={usageValue} unit={usageUnit} tone="muted" hint={usageHint} />
        <div className="col-span-2">
          <Stat label="1件あたりのAIコスト（平均）" value={avgCost === null ? "—" : yen(avgCost)} tone="brand"
                hint={`Gemini の料金から計算（1ドル=${USD_TO_JPY}円で換算）`} />
        </div>
      </div>
    </Card>
  );
}
