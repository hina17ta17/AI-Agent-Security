"use client";

import { Ban, ChevronDown, ChevronUp, Crown, History, ListChecks, RefreshCw, ShieldCheck, Unlock, Users } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ReportBody } from "@/components/report";
import { SelfGuard } from "@/components/self-guard";
import { Badge, Button, Card, CardHeader, cx, Empty } from "@/components/ui";
import { useSession } from "@/lib/auth-context";
import { ACTOR_LABEL, ago, AUDIT_ACTION, AUDIT_RESULT, dateTimeJst, remaining, timeJst } from "@/lib/format";
import { useNow, useOwnerStatus } from "@/lib/hooks";

/**
 * AgentGuard's manager page: AgentGuard's own protection in full (attacks with addresses, blocks,
 * allowlist, every action). Only the one manager account gets data here; the server checks it on
 * every request, so this page is not the protection — it only shows what the server allows.
 */

type Overview = {
  checked: number; lastCheckedAt: number | null; allowlist: string[];
  incidents: { id: string; at: number | null; status: string | null; label: string; srcIp: string | null;
               method: string | null; path: string | null; severity: string | null; promptInjection: boolean; minutes: number | null }[];
  blocks: { ip: string; reasonJa: string; blockedBy: string; expiresAt: number | null; hits: number }[];
  audit: { id: string; at: number | null; actor: string; action: string; status: string | null; params: Record<string, unknown> }[];
};
type Detail = { id: string; report: string; payloadPreview: string; steps: { agent: string; kind: string; text: string; at: number | null }[] };

const RESULT: Record<string, { text: string; tone: "safe" | "warn" | "danger" | "muted" }> = {
  resolved: { text: "解決", tone: "safe" },
  awaiting_approval: { text: "承認待ち", tone: "warn" },
  fallback: { text: "ルールで対処", tone: "warn" },
  analyzing: { text: "対応中", tone: "danger" },
};
const date = (t: number | null) => (t ? dateTimeJst(new Date(t)) : "—");

function IncidentRow({ i }: { i: Overview["incidents"][number] }) {
  const { api } = useSession();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = RESULT[i.status ?? ""] ?? { text: i.status ?? "—", tone: "muted" as const };

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      try { setDetail(await api<Detail>("/api/owner", { body: { action: "incident", id: i.id } })); }
      catch (e) { setError(e instanceof Error ? e.message : "読み込めませんでした"); }
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-white">
      <button type="button" onClick={() => void toggle()} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-sm">
        <span className="font-mono text-xs text-muted tabular-nums">{date(i.at)}</span>
        <span className="font-semibold text-ink">{i.label}</span>
        <Badge tone={r.tone}>{r.text}</Badge>
        {i.promptInjection && <Badge tone="danger">AIをだます攻撃</Badge>}
        <span className="font-mono text-xs text-muted">{i.srcIp} ・ {i.method} {i.path}</span>
        {i.minutes && <span className="text-xs text-muted">{i.minutes}分ブロック</span>}
        <span className="ml-auto text-muted">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {error ? <p className="text-xs text-rose-600">{error}</p> : !detail ? <p className="text-xs text-muted">読み込み中…</p> : (
            <div className="space-y-3">
              <ol className="space-y-1 text-xs">
                {detail.steps.filter((s) => s.kind !== "thought").map((s, n) => (
                  <li key={n} className="flex gap-2">
                    <span className="shrink-0 font-mono text-muted tabular-nums">{s.at ? timeJst(new Date(s.at)) : ""}</span>
                    <span className="shrink-0 font-semibold text-ink">{s.agent}</span>
                    <span className="text-muted">{s.text}</span>
                  </li>
                ))}
              </ol>
              {detail.payloadPreview && (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-3 font-mono text-[11px] text-slate-100">{detail.payloadPreview}</pre>
              )}
              {detail.report && <div className="rounded-xl bg-slate-50 p-3"><ReportBody markdown={detail.report} /></div>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AllowlistEditor({ initial, onSaved }: { initial: string[]; onSaved: () => void }) {
  const { api } = useSession();
  const [text, setText] = useState(initial.join("\n"));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    const entries = text.split(/\s+/).filter(Boolean);
    const odd = entries.filter((e) => !/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(e));
    if (odd.length) return setNote({ ok: false, text: `IPアドレスか範囲で入力してください：${odd.slice(0, 3).join("、")}` });
    try {
      await api("/api/owner", { body: { action: "allowlist", allowlist: entries } });
      setNote({ ok: true, text: "保存しました。ここにあるIPは、AgentGuard 自身の守りでブロックされません。" });
      onSaved();
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : "保存できませんでした" }); }
  }
  return (
    <div className="p-5">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} spellCheck={false}
                placeholder={"例）\n203.0.113.10"}
                className="w-full rounded-xl border border-line bg-white p-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
      <Button className="mt-2" onClick={() => void save()}>保存する</Button>
      {note && <p className={cx("mt-2 text-sm", note.ok ? "text-emerald-600" : "text-rose-600")}>{note.text}</p>}
    </div>
  );
}

type SiteRow = {
  url: string; state: "protecting" | "old_key" | "waiting" | "pending"; connectedNow: boolean;
  lastReportAt: number | null; registeredAt: number | null; attacksToday: number;
};
type SitesOverview = {
  accounts: number; sites: number; protecting: number; pending: number; connectedNow: number; attacksToday: number; list: SiteRow[];
};

const SITE_STATE: Record<SiteRow["state"], { label: string; tone: "safe" | "warn" | "muted" }> = {
  protecting: { label: "守っている", tone: "safe" },
  old_key: { label: "前のキーのまま", tone: "warn" },
  waiting: { label: "合図待ち", tone: "muted" },
  pending: { label: "つなぐ途中", tone: "muted" },
};

/** How many people use AgentGuard, and the registered sites (no e-mail addresses or account ids). */
function SitesCard({ now }: { now: number }) {
  const { api } = useSession();
  const [data, setData] = useState<SitesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let stop = false;
    api<SitesOverview>("/api/owner", { body: { action: "sites" } })
      .then((d) => { if (!stop) { setData(d); setError(null); } })
      .catch((e) => { if (!stop) setError(e instanceof Error ? e.message : "読み込めませんでした"); });
    const t = setTimeout(() => setRound((r) => r + 1), 60_000); // refresh every minute
    return () => { stop = true; clearTimeout(t); };
  }, [api, round]);

  const tile = (label: string, value: number, hint?: string) => (
    <div className="rounded-2xl border border-line bg-white px-3 py-2.5">
      <div className="text-[11px] font-semibold text-muted">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums text-ink">{value.toLocaleString("ja-JP")}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );

  return (
    <Card>
      <CardHeader title="AgentGuard を使っている人（全体）" icon={<Users size={16} className="text-brand" />}
                  sub="数と、登録されているサイトの一覧です。メールアドレスなどの個人情報は表示しません"
                  right={<Button size="sm" variant="ghost" onClick={() => setRound((r) => r + 1)}><RefreshCw size={13} /> 更新</Button>} />
      {error && !data ? <Empty>{error}</Empty> : !data ? <Empty>読み込み中…</Empty> : (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {tile("アカウント", data.accounts)}
            {tile("登録サイト", data.sites)}
            {tile("守っている", data.protecting, `いまつながっている：${data.connectedNow}`)}
            {tile("準備中", data.pending, "つなぐ途中・合図待ちなど")}
            {tile("今日止めた攻撃", data.attacksToday, "本物のアクセスだけ")}
          </div>
          {data.list.length === 0 ? <Empty>まだ登録されているサイトはありません</Empty> : (
            <ul className="space-y-2">
              {data.list.map((s, n) => (
                <li key={`${s.url}-${n}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-white px-3 py-2.5">
                  <a href={s.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-ink hover:underline">{s.url}</a>
                  <Badge tone={SITE_STATE[s.state].tone}>{SITE_STATE[s.state].label}</Badge>
                  {s.connectedNow && <Badge tone="safe">つながっている</Badge>}
                  <span className="w-full text-[11px] text-muted sm:w-auto">
                    最後の合図：{s.lastReportAt ? ago(new Date(s.lastReportAt), now) : "まだ"}
                    ・今日止めた攻撃：{s.attacksToday}件
                    {s.registeredAt ? `・登録：${date(s.registeredAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function Manager() {
  const { api } = useSession();
  const now = useNow(1000);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((r) => r + 1), []);

  useEffect(() => {
    let stop = false;
    api<Overview>("/api/owner", { body: { action: "overview" } })
      .then((d) => { if (!stop) { setData(d); setError(null); } })
      .catch((e) => { if (!stop) setError(e instanceof Error ? e.message : "読み込めませんでした"); });
    const t = setTimeout(() => setRound((r) => r + 1), 20_000); // refresh every 20 seconds
    return () => { stop = true; clearTimeout(t); };
  }, [api, round]);

  async function unblock(ip: string) {
    if (!window.confirm(`${ip} のブロックを解除しますか？（記録に残ります）`)) return;
    try { await api("/api/owner", { body: { action: "unblock", ip } }); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "解除できませんでした"); }
  }

  if (error && !data) return <Empty>{error}</Empty>;
  if (!data) return <Empty>読み込み中…</Empty>;
  const active = data.blocks.filter((b) => (b.expiresAt ?? 0) > now);

  return (
    <div className="space-y-5">
      <SelfGuard />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <SitesCard now={now} />

      <Card>
        <CardHeader title="AgentGuard への攻撃と対応" icon={<ListChecks size={16} className="text-brand" />}
                    sub="最新30件。行をクリックすると、AIチームの対応と報告書を見られます"
                    right={<Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={13} /> 更新</Button>} />
        {data.incidents.length === 0 ? <Empty>まだ攻撃はありません</Empty> : (
          <ul className="space-y-2 p-4 sm:p-5">{data.incidents.map((i) => <IncidentRow key={i.id} i={i} />)}</ul>
        )}
      </Card>

      <Card>
        <CardHeader title="ブロック中のIP（AgentGuard 自身）" icon={<Ban size={16} className="text-danger" />}
                    sub="解除できるのは管理者のあなただけです（AIは解除できません）" />
        {active.length === 0 ? <Empty>ブロック中のIPはありません</Empty> : (
          <ul className="space-y-2 p-4 sm:p-5">
            {active.map((b) => (
              <li key={b.ip} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm font-bold">{b.ip}</div>
                  <div className="truncate text-xs text-muted">{b.reasonJa}</div>
                  <div className="text-[11px] text-muted">
                    {ACTOR_LABEL[b.blockedBy] ?? "AgentGuard"} ・ <span className="font-semibold text-rose-600">{remaining(b.expiresAt ? new Date(b.expiresAt) : null, now)}</span>
                    {b.hits ? ` ・ ブロック後のアクセス ${b.hits}回` : ""}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void unblock(b.ip)}><Unlock size={14} /> 解除</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="許可リスト（AgentGuard 自身）" icon={<ShieldCheck size={16} className="text-safe" />}
                    sub="ここに入れたIP（あなたの自宅や職場など）は、AgentGuard 自身の守りで絶対にブロックされません" />
        <AllowlistEditor key={data.allowlist.join(",")} initial={data.allowlist} onSaved={reload} />
      </Card>

      <Card>
        <CardHeader title="操作の記録（AgentGuard 自身）" icon={<History size={16} className="text-brand" />} sub="最新40件" />
        {data.audit.length === 0 ? <Empty>まだ記録はありません</Empty> : (
          <ul className="divide-y divide-line px-2 pb-2">
            {data.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 font-mono text-xs text-muted tabular-nums">{date(a.at)}</span>
                <Badge tone={a.actor === "owner" ? "brand" : "muted"}>{ACTOR_LABEL[a.actor] ?? a.actor}</Badge>
                <span className="font-semibold text-ink">{AUDIT_ACTION[a.action] ?? a.action}</span>
                {a.status && <span className="text-xs text-muted">{AUDIT_RESULT[a.status] ?? a.status}</span>}
                {typeof a.params.ip === "string" && <span className="font-mono text-xs text-muted">{a.params.ip}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const { status } = useOwnerStatus();
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold"><Crown size={22} className="text-amber-500" /> AgentGuard の管理</h1>
        <p className="mt-1 text-sm text-muted">AgentGuard 自身の守りの詳しい記録と操作です。見られるのは、管理者の1アカウントだけです。</p>
      </div>
      {!status ? <Empty>確認しています…</Empty> : status.isOwner ? <Manager /> : (
        <Empty>
          このページは AgentGuard の管理者だけが見られます。
          {!status.claimed && <> 管理者コードをお持ちなら、<Link href="/app/settings" className="font-semibold text-brand">設定</Link>から管理者になれます。</>}
        </Empty>
      )}
    </div>
  );
}
