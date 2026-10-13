"use client";

import { History, ListChecks, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useState } from "react";

import { IncidentList } from "@/components/incident-list";
import { SelfGuard } from "@/components/self-guard";
import { Badge, Button, Card, CardHeader, cx, Empty } from "@/components/ui";
import { ACTOR_LABEL, AUDIT_ACTION, AUDIT_RESULT, dateTimeJst } from "@/lib/format";
import { useAuditLog, useIncidents, useLogins, useOwnerStatus } from "@/lib/hooks";
import type { AuditEntry } from "@/lib/types";

/**
 * Everything that happened, as lists: attacks and how they were handled, every action taken (by the
 * AI team, the rules or a person), sign-ins, and AgentGuard's own protection. Kept off the
 * dashboard, which shows only what is happening now.
 */

const TABS = [
  { id: "incidents", label: "攻撃と対応", icon: <ListChecks size={15} /> },
  { id: "audit", label: "操作の記録", icon: <History size={15} /> },
  { id: "logins", label: "ログイン", icon: <UserCheck size={15} /> },
  { id: "self", label: "AgentGuard 自身", icon: <ShieldCheck size={15} /> },
] as const;
type Tab = (typeof TABS)[number]["id"];

const STEP = 20;
const MAX = 200;

function MoreButton({ shown, max, onMore }: { shown: number; max: number; onMore: () => void }) {
  if (shown < max || max >= MAX) return null; // fewer than asked for: that is everything
  return (
    <div className="flex justify-center p-3">
      <Button variant="ghost" size="sm" onClick={onMore}>さらに表示する</Button>
    </div>
  );
}

function IncidentsTab() {
  const [max, setMax] = useState(STEP);
  const incidents = useIncidents(max).data;
  return (
    <div>
      <IncidentList incidents={incidents} />
      <MoreButton shown={incidents.length} max={max} onMore={() => setMax((m) => Math.min(m + STEP, MAX))} />
    </div>
  );
}

/** One line of detail from the recorded parameters (address, site, length, reason). */
function detail(a: AuditEntry): string {
  const p = a.params ?? {};
  const r = a.result ?? {};
  const parts: string[] = [];
  if (typeof p.ip === "string") parts.push(p.ip);
  if (typeof p.host === "string") parts.push(p.host + (typeof p.path === "string" ? p.path : ""));
  const minutes = typeof r.appliedMinutes === "number" ? r.appliedMinutes : typeof p.minutes === "number" ? p.minutes : null;
  if (minutes !== null && a.action !== "incident_closed") parts.push(`${minutes}分`);
  if (typeof p.mode === "string") parts.push(p.mode === "byok" ? "あなたのAPIキー" : "デモモード");
  if (typeof p.count === "number") parts.push(`${p.count}件`);
  if (typeof p.reasonJa === "string") parts.push(p.reasonJa);
  if (typeof r.why === "string") parts.push(r.why);
  return parts.join(" ・ ");
}

function AuditTab() {
  const [max, setMax] = useState(50);
  const entries = useAuditLog(max).data;
  return (
    <Card>
      <CardHeader title="操作の記録" icon={<History size={16} className="text-brand" />}
                  sub="AIチーム・自動ルール・あなたが行った操作のすべて（新しい順）" />
      {entries.length === 0 ? <Empty>まだ記録はありません</Empty> : (
        <ul className="divide-y divide-line px-2 pb-2">
          {entries.map((a) => {
            const code = String(a.result?.status ?? "");
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className="w-24 shrink-0 font-mono text-xs text-muted tabular-nums">{dateTimeJst(a.at)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={a.actor === "user" ? "brand" : "muted"}>{ACTOR_LABEL[a.actor] ?? a.actor}</Badge>
                    <span className="font-semibold text-ink">{AUDIT_ACTION[a.action] ?? a.action}</span>
                    {code && <span className="text-xs text-muted">{AUDIT_RESULT[code] ?? code}</span>}
                  </div>
                  {detail(a) && <p className="mt-0.5 break-all text-xs text-muted">{detail(a)}</p>}
                </div>
                {a.incidentId && (
                  <Link href={`/app/incidents/${a.incidentId}`} className="shrink-0 text-xs font-semibold text-brand hover:underline">
                    詳細 →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <MoreButton shown={entries.length} max={max} onMore={() => setMax((m) => Math.min(m + 50, MAX))} />
    </Card>
  );
}

function LoginsTab() {
  const logins = useLogins(20).data;
  return (
    <Card>
      <CardHeader title="ログイン履歴" icon={<UserCheck size={16} className="text-brand" />}
                  sub="最新20件。IPアドレスは最後の部分を伏せて保存しています" />
      {logins.length === 0 ? <Empty>まだ記録がありません（次のログインから記録されます）</Empty> : (
        <ul className="divide-y divide-line px-2 pb-2">
          {logins.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <span className="font-mono text-xs text-muted tabular-nums">{dateTimeJst(l.at)}</span>
              <span className="font-semibold text-ink">{l.device}</span>
              <span className="font-mono text-xs text-muted">{l.ipPrefix}</span>
              <span className="text-xs text-muted">{l.method}</span>
              {l.newDevice && <Badge tone="warn">新しい端末</Badge>}
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-4 text-xs text-muted">
        心当たりのないログインがあれば、<Link href="/app/settings" className="font-semibold text-brand hover:underline">設定</Link>の
        「すべての端末からログアウト」と「パスワードを変更する」を使ってください。
      </p>
    </Card>
  );
}

function HistoryTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === requested) ? (requested as Tab) : "incidents";
  const owner = useOwnerStatus().status;
  const select = (id: Tab) => router.replace(`${pathname}?tab=${id}`, { scroll: false });

  const body: Record<Tab, ReactNode> = {
    incidents: <IncidentsTab />,
    audit: <AuditTab />,
    logins: <LoginsTab />,
    self: (
      <div className="space-y-3">
        <SelfGuard moreHref={owner?.isOwner ? "/app/admin" : undefined} />
        <p className="text-xs text-muted">
          AgentGuard 自身が止めた攻撃の詳しい記録（いつ・どこから・どう対処したか）は、AgentGuard の管理者の1アカウントだけが見られます。
        </p>
      </div>
    ),
  };
  return (
    <>
      <div role="tablist" aria-label="履歴の種類" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => select(t.id)}
                  className={cx("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
                    tab === t.id ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-muted hover:border-brand/40")}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{body[tab]}</div>
    </>
  );
}

export default function HistoryPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="font-display text-2xl font-bold">履歴</h1>
      <Suspense fallback={<Empty>読み込み中…</Empty>}>
        <HistoryTabs />
      </Suspense>
    </div>
  );
}
