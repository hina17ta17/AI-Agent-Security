"use client";

import { Gauge } from "lucide-react";

import { ms, seconds, toDate, USD_TO_JPY, yen } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { BlockEntry, Incident, Usage } from "@/lib/types";

import { Card, CardHeader, Stat } from "./ui";

export function Metrics({ latest, incidents, blocklist, usage, aiMode }: {
  latest: Incident | null;
  incidents: Incident[];
  blocklist: BlockEntry[];
  usage: Usage | null;
  aiMode: "demo" | "byok" | undefined;
}) {
  const now = useNow(5000);
  const activeBlocks = blocklist.filter((b) => (toDate(b.expiresAt)?.getTime() ?? 0) > now).length;
  const costs = incidents.map((i) => i.estCostUsd).filter((c): c is number => typeof c === "number" && c > 0);
  const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const limit = usage?.limit ?? (aiMode === "byok" ? 200 : 10);

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
        <Stat label="今日のAI解析" value={`${usage?.aiRuns ?? 0}/${limit}`} unit="回" tone="muted"
              hint={aiMode === "byok" ? "あなたのAPIキーで実行" : "デモモード（1日の上限あり）"} />
        <div className="col-span-2">
          <Stat label="1件あたりのAIコスト（平均）" value={avgCost === null ? "—" : yen(avgCost)} tone="brand"
                hint={`Gemini の料金から計算（1ドル=${USD_TO_JPY}円で換算）`} />
        </div>
      </div>
    </Card>
  );
}
