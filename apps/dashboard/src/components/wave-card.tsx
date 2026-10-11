"use client";

import { Waves } from "lucide-react";

import { waveActive } from "@/lib/activity";
import { ago, ATTACK_LABEL, seconds, SEVERITY } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { Campaign } from "@/lib/types";

import { Badge, Card, CardHeader, cx } from "./ui";

const SHOWN_IPS = 10;

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className={cx("font-mono text-2xl font-bold tabular-nums", tone ?? "text-ink")}>
        {value}<span className="ml-0.5 text-xs font-semibold text-muted">件</span>
      </div>
    </div>
  );
}

/**
 * Many attacks at once: the AI team investigates a few in full (in parallel), and every other
 * event is blocked by rule immediately. The AI's decision then lengthens those rule blocks.
 */
export function WaveCard({ wave }: { wave: Campaign }) {
  const now = useNow(1000);
  const open = waveActive(wave, now);
  const analyzed = wave.analyzedIncidents?.length ?? 0;
  const types = Object.entries(wave.byType ?? {}).sort((a, b) => b[1] - a[1]);
  const decisions = Object.entries(wave.aiDecisions ?? {});
  const ips = wave.ips ?? [];
  const avgBlockSec = wave.timedBlocks ? (wave.blockSecTotal ?? 0) / wave.timedBlocks : null;

  return (
    <Card className={cx(open && "border-rose-200")}>
      <CardHeader
        title="攻撃の波"
        icon={<Waves size={16} className="text-danger" />}
        sub="同時に多数の攻撃：AIは代表を詳しく調べ、残りはAIを待たずにルールで即ブロック"
        right={open ? <Badge tone="danger">進行中</Badge> : <Badge tone="safe">終息（{ago(wave.lastEventAt, now)}）</Badge>}
      />
      <div className="grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4 sm:px-5">
        <Stat label="攻撃の数" value={(wave.events ?? 0) + analyzed} />
        <Stat label="AIが詳しく調査" value={analyzed} tone="text-brand" />
        <Stat label="ルールで即ブロック" value={wave.ruleBlocks ?? 0} tone="text-rose-600" />
        <Stat label="AIの判断で延長" value={wave.extendedBlocks ?? 0} tone="text-emerald-600" />
      </div>
      <div className="space-y-3 p-4 text-sm sm:p-5">
        {avgBlockSec !== null && (
          <p className="text-xs text-muted">
            検知からルールでブロックするまで
            <span className="mx-1 font-mono text-sm font-bold text-rose-600 tabular-nums">平均 {seconds(avgBlockSec)} 秒</span>
            （最大 {seconds(wave.blockSecMax)} 秒）。AI の調査を待たずに止めています
          </p>
        )}
        {types.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">ルールで止めた攻撃の種類</span>
            {types.map(([type, n]) => (
              <Badge key={type} tone="danger">{ATTACK_LABEL[type] ?? type} {n}</Badge>
            ))}
          </div>
        )}
        <div className="rounded-2xl bg-brand/5 px-3 py-2.5">
          <div className="text-xs font-semibold text-brand">AIの判断（同じ種類の攻撃に反映）</div>
          {decisions.length === 0 ? (
            <p className="mt-0.5 text-xs text-muted">シラベとマモルが代表の攻撃を調べています…（その間もルールで防御済み）</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {decisions.map(([type, d]) => (
                <li key={type} className="text-xs text-ink">
                  <span className="font-bold">{ATTACK_LABEL[type] ?? type}</span>：{d.minutes}分ブロック
                  <span className="text-muted">（重大度 {SEVERITY[d.severity]?.label ?? d.severity}）</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-muted">ルールより長い判断のときだけ延長します（防御が弱まることはありません）</p>
        </div>
        {ips.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted">攻撃元IP {ips.length}件</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {ips.slice(-SHOWN_IPS).reverse().map((ip) => (
                <span key={ip} className="rounded-lg bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-ink">{ip}</span>
              ))}
              {ips.length > SHOWN_IPS && <span className="px-1 text-[11px] text-muted">ほか {ips.length - SHOWN_IPS}件</span>}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
