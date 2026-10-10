"use client";

import { Activity, ArrowLeft, ExternalLink, ListChecks, ShieldCheck, Swords } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";

import { ApprovalBanner } from "@/components/approval-banner";
import { STATUS } from "@/components/incident-list";
import { LiveFeed } from "@/components/live-feed";
import { ReportCard } from "@/components/report";
import { TimelineBar } from "@/components/timeline-bar";
import { Badge, Card, CardHeader, Empty } from "@/components/ui";
import { ACTOR_LABEL, ATTACK_LABEL, dateTimeJst, SEVERITY, seconds, timeJst, yen } from "@/lib/format";
import { useAudit, useIncident, usePendingApprovals, useSteps } from "@/lib/hooks";

const AUDIT_ACTION: Record<string, string> = {
  block_ip: "IPをブロック",
  watch_ip: "監視リストに追加",
  request_isolation: "サイト停止の承認を依頼",
  incident_closed: "インシデントを完了",
  approve_isolation: "サイト停止を承認",
  reject_isolation: "サイト停止を却下",
  unblock_ip: "ブロックを解除",
};

const AUDIT_RESULT: Record<string, string> = {
  blocked: "ブロックしました",
  watching: "監視中",
  refused: "ルールにより拒否",
  pending_human_approval: "人の承認待ち",
  resolved: "解決",
  awaiting_approval: "承認待ちで完了",
  fallback: "ルールで対処して完了",
  site_in_maintenance: "サイトを一時停止",
  rejected: "却下",
  unblocked: "解除しました",
};

function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="min-w-0 text-right font-medium">{v}</span>
    </div>
  );
}

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: incident, loading } = useIncident(id);
  const steps = useSteps(id).data;
  const audit = useAudit(id).data.sort((a, b) => (a.at?.toMillis() ?? 0) - (b.at?.toMillis() ?? 0));
  const approvals = usePendingApprovals().data.filter((a) => a.incidentId === id);

  if (loading) return <Empty>読み込み中…</Empty>;
  if (!incident) return <Empty>インシデントが見つかりません。<Link href="/app" className="text-brand">ダッシュボードへ</Link></Empty>;

  const s = STATUS[incident.status] ?? STATUS.analyzing;
  const v = incident.verdict;
  const g = incident.guard;

  return (
    <div className="space-y-5">
      <Link href="/app" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft size={16} /> ダッシュボードへ
      </Link>
      <ApprovalBanner approvals={approvals} />

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.tone}>{s.label}</Badge>
          {g?.promptInjection && <Badge tone="danger">AIをだます攻撃を検知</Badge>}
          <Badge tone="muted">{incident.mode === "byok" ? "あなたのAPIキー" : "デモモード"}</Badge>
          <span className="text-xs text-muted">{dateTimeJst(incident.timings?.receivedAt)} ・ ID {incident.id}</span>
        </div>
        <h1 className="mt-2 font-display text-2xl font-bold">{incident.attack.labelJa}</h1>
        <p className="mt-1 font-mono text-sm text-muted">
          {incident.attack.srcIp}{incident.attack.simulated ? "（デモ用の擬似アドレス）" : ""} → {incident.attack.method} {incident.attack.path}
        </p>
        <div className="mt-5"><TimelineBar incident={incident} /></div>
        <p className="mt-3 text-xs text-muted">
          AIの対処完了：<b className="text-emerald-600">{seconds(incident.timings?.aiActionSec)}秒</b> ／ 全体：{seconds(incident.timings?.totalSec)}秒
          （ミハリが受け取った時点からの実測値）
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <LiveFeed incident={incident} steps={steps} live={incident.status === "analyzing"} title="対応の記録" showLink={false} />
          <ReportCard markdown={incident.report?.markdown} pending={incident.status === "analyzing"} />
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="シラベの判定" icon={<Activity size={16} className="text-amber-500" />} />
            <div className="px-5 pb-4 pt-2">
              {v ? (
                <>
                  <Row k="攻撃の種類" v={ATTACK_LABEL[v.attack_type] ?? v.attack_type} />
                  <Row k="重大度" v={<Badge tone={SEVERITY[v.severity].tone}>{SEVERITY[v.severity].label}</Badge>} />
                  <Row k="確信度" v={`${Math.round(v.confidence * 100)}%`} />
                  <Row k="AIを狙った攻撃" v={v.targets_ai ? "はい" : "いいえ"} />
                  <Row k="手順（ルールで決定）" v={{ DEFEND: "防御", WATCH: "監視", DISMISS: "見送り" }[incident.route ?? "DEFEND"] ?? "—"} />
                  {v.evidence?.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-muted">{v.evidence.map((e, i) => <li key={i}>・{e}</li>)}</ul>
                  )}
                </>
              ) : <p className="py-2 text-sm text-muted">判定はまだありません</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="番人（Model Armor）の検査" icon={<ShieldCheck size={16} className="text-cyan-500" />} />
            <div className="px-5 pb-4 pt-2">
              {g ? (
                <>
                  <Row k="AIへの不正な指示" v={g.promptInjection ? <Badge tone="danger">検出（{g.piConfidence}）</Badge> : <Badge tone="safe">なし</Badge>} />
                  <Row k="危険なURL" v={g.maliciousUri ? <Badge tone="danger">検出</Badge> : <Badge tone="safe">なし</Badge>} />
                  <Row k="攻撃文をAIに渡したか" v={g.payloadWithheld ? "渡していない（安全のため）" : "検査後に、信頼できないデータとして渡した"} />
                </>
              ) : <p className="py-2 text-sm text-muted">検査結果はまだありません</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="攻撃の中身（表示のみ）" icon={<Swords size={16} className="text-danger" />} sub="文字列として表示しているだけで、実行されることはありません" />
            <div className="px-5 pb-5 pt-2">
              <Row k="ルール" v={<code className="font-mono text-xs">{incident.attack.ruleId}</code>} />
              <Row k="調べた項目" v={<code className="font-mono text-xs">{incident.attack.field}</code>} />
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 font-mono text-[11px] text-slate-100">{incident.attack.payloadPreview}</pre>
            </div>
          </Card>

          <Card>
            <CardHeader title="コストと記録" icon={<ExternalLink size={16} className="text-brand" />} />
            <div className="px-5 pb-4 pt-2">
              <Row k="AIコスト" v={`${yen(incident.estCostUsd)}（$${(incident.estCostUsd ?? 0).toFixed(4)}）`} />
              {Object.entries(incident.usage?.byModel ?? {}).map(([model, u]) => (
                <Row key={model} k={<code className="font-mono text-[11px]">{model}</code>} v={`${u.inputTokens} / ${u.outputTokens} tokens`} />
              ))}
              {incident.traceUrl && (
                <a href={incident.traceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                  Cloud Trace で処理の流れを見る <ExternalLink size={12} />
                </a>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="監査ログ" icon={<ListChecks size={16} className="text-brand" />} sub="AIと人が行った操作のすべて" />
            {audit.length === 0 ? <Empty>記録はまだありません</Empty> : (
              <ol className="space-y-2 px-5 pb-5 pt-2">
                {audit.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line bg-white px-3 py-2 text-xs">
                    <div className="flex justify-between gap-2">
                      <span className="font-bold">{ACTOR_LABEL[a.actor] ?? a.actor}：{AUDIT_ACTION[a.action] ?? a.action}</span>
                      <span className="text-muted tabular-nums">{timeJst(a.at)}</span>
                    </div>
                    <div className="mt-0.5 text-muted">
                      結果：{(() => {
                        const code = String((a.result as { status?: string })?.status ?? "");
                        return AUDIT_RESULT[code] ?? (code || "—");
                      })()}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
