"use client";

import {
  ArrowLeft, ArrowRight, Check, CircleCheck, ClipboardList, Copy, Download, ExternalLink, Loader2, PartyPopper, Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { toDate } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";
import type { ProtectedSite } from "@/lib/types";

import { CopyField } from "./copy-field";
import { KeyBox } from "./site-connect";
import { INSTALL, integrationSnippet, type ServerFramework } from "./site-snippets";
import { Badge, Button, cx } from "./ui";

/**
 * Connecting a site, one step at a time: (1) what kind of site, (2) put the key in, (3) put one
 * file in, (4) publish and wait. Only the current step is on screen, with a progress bar above.
 * The first report from the site moves straight to the last step and checks ownership by itself.
 * Progress is remembered per site in this browser, so a reload does not start over.
 */

type Kind = ServerFramework | "static";
type Host = "vercel" | "cloudrun" | "other";
type Step = 1 | 2 | 3 | 4;

const KINDS: { id: Kind; label: string; sub: string }[] = [
  { id: "next", label: "Next.js", sub: "Vercel などで公開" },
  { id: "express", label: "Express", sub: "Node.js のサーバー" },
  { id: "fastapi", label: "FastAPI", sub: "Python のサーバー" },
  { id: "static", label: "HTMLだけのサイト", sub: "GitHub Pages など" },
];

const HOSTS: { id: Host; label: string; steps: string[]; publish: string }[] = [
  {
    id: "vercel", label: "Vercel",
    steps: [
      "vercel.com にログインし、このサイトのプロジェクトをクリック",
      "上のメニューの「Settings」→ 左の「Environment Variables」",
      "Key に AGENTGUARD_KEY、Value に上の接続キーを貼って「Save」",
    ],
    publish: "GitHub に push する（自動で公開し直されます）。push しない場合は Vercel の「Deployments」→ 一番上の「…」→「Redeploy」",
  },
  {
    id: "cloudrun", label: "Cloud Run",
    steps: [
      "Google Cloud コンソールで Cloud Run のサービスを開く",
      "「新しいリビジョンの編集とデプロイ」→「変数とシークレット」",
      "「変数を追加」で 名前 AGENTGUARD_KEY、値 に上の接続キーを貼って「デプロイ」",
    ],
    publish: "いつもの方法でデプロイし直す（例：gcloud run deploy サービス名 --source .）",
  },
  {
    id: "other", label: "それ以外・自分のPC",
    steps: [
      "サイトのフォルダにある .env ファイルを開く（なければ新しく作る）",
      "下の「.env に貼る1行」をコピーして貼り付け、保存",
      ".env は GitHub などに公開しないでください",
    ],
    publish: "サーバーを再起動する（止めて、もう一度起動する）",
  },
];

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "種類" },
  { n: 2, label: "キー" },
  { n: 3, label: "ファイル" },
  { n: 4, label: "公開・確認" },
];

const ALIVE_MS = 15 * 60_000;

// Region codes in the short form of Cloud Run URLs (service-hash-xx.a.run.app).
const RUN_REGIONS: Record<string, string> = { an: "asia-northeast1", uc: "us-central1", ue: "us-east1", ew: "europe-west1" };

/** The Cloud Run service and region, read from a run.app address (null for other addresses). */
export function cloudRunService(host: string): { service: string; region: string } | null {
  const long = host.match(/^(.+)-\d{6,}\.([a-z0-9-]+)\.run\.app$/); // service-PROJECTNUMBER.REGION.run.app
  if (long) return { service: long[1], region: long[2] };
  const short = host.match(/^(.+)-[a-z0-9]{10}-([a-z]{2})\.a\.run\.app$/);
  if (short && RUN_REGIONS[short[2]]) return { service: short[1], region: RUN_REGIONS[short[2]] };
  return null;
}

/** For Cloud Run, setting the key is one pasted line in Cloud Shell (it also redeploys the service). */
function CloudRunShortcut({ host, connectionKey }: { host: string; connectionKey: string | null }) {
  const run = cloudRunService(host);
  const service = run?.service ?? "サービス名";
  const region = run?.region ?? "リージョン";
  const command = `gcloud run services update ${service} --region ${region} --update-env-vars AGENTGUARD_KEY=${connectionKey ?? "（接続キー）"}`;
  return (
    <div className="mt-2 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs">
      <p className="font-bold text-ink">いちばんかんたん：Cloud Shell に1行貼るだけ</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
        <li>
          <a href="https://console.cloud.google.com/run?cloudshell=true" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
            Cloud Shell を開く <ExternalLink size={11} />
          </a>
          （Google Cloud の画面の下に、コマンドを打つ黒い画面が開きます。サイトのプロジェクトが選ばれていることを確認）
        </li>
        <li>下の1行をコピーして貼り付け、Enter を押す。終わると自動で公開し直されます（1〜2分）。</li>
      </ol>
      <div className="mt-2"><CopyField value={command} label="Cloud Shell のコマンド" /></div>
      {!connectionKey && <p className="mt-1 text-rose-700">キーが表示されていないときは、上の「キーをなくした・作り直す」で新しいキーを出してください。</p>}
      {run && (
        <p className="mt-2 text-muted">
          画面でやる場合：
          <a href={`https://console.cloud.google.com/run/deploy/${run.region}/${run.service}`} target="_blank" rel="noreferrer"
             className="font-semibold text-brand hover:underline">{run.service} の編集画面を開く</a>
          →「変数とシークレット」→「変数を追加」で AGENTGUARD_KEY を追加 →「デプロイ」
        </p>
      )}
    </div>
  );
}

function guessKind(host: string): Kind {
  if (host.endsWith(".github.io")) return "static";
  return "next";
}
function guessHost(host: string): Host {
  if (host.endsWith(".vercel.app")) return "vercel";
  if (host.endsWith(".run.app")) return "cloudrun";
  return "other";
}

/** Save the integration file in the browser's Downloads folder. */
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Saved = { step: Step; kind: Kind; host: Host };
const storageKey = (siteUrl: string) => `agentguard.connect.${siteUrl}`;

function load(site: ProtectedSite): Saved {
  const fallback: Saved = { step: 1, kind: guessKind(site.host), host: guessHost(site.host) };
  try {
    const raw = window.localStorage.getItem(storageKey(site.url));
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Saved>) } : fallback;
  } catch {
    return fallback; // private mode or blocked storage: start at step 1
  }
}

function save(siteUrl: string, s: Saved) {
  try {
    window.localStorage.setItem(storageKey(siteUrl), JSON.stringify(s));
  } catch {
    // only a convenience
  }
}

/**
 * The whole setup as one block of text: site, key line, which file, the code, and the steps.
 * A non-technical owner can copy this and hand it to whoever manages the site — the "anyone can do
 * it" path. It contains the secret key, so it is offered only while the key is on screen.
 */
function buildHandoff(kind: ServerFramework, url: string, key: string, snippet: string): string {
  const i = INSTALL[kind];
  return [
    "【AgentGuard 連携手順】このサイトを守るための設定です（5分ほどで終わります）",
    "",
    `対象サイト：${url}`,
    `種類：${KINDS.find((k) => k.id === kind)!.label}`,
    "",
    "1) サーバーの環境変数に、次の1行を追加する：",
    `   AGENTGUARD_KEY=${key}`,
    "   ※ このキーは秘密です。公開リポジトリやHTMLには書かず、サーバーの環境変数にだけ入れてください。",
    "",
    `2) 下のコードを「${i.fileName}」という名前のファイルに保存し、${i.place}に置く。`,
    ...(i.addLines ? [`   さらに ${i.addWhere} に、次を足す：`, ...i.addLines.split("\n").map((l) => `     ${l}`)] : []),
    "",
    `----- ${i.fileName} ここから -----`,
    snippet,
    `----- ${i.fileName} ここまで -----`,
    "",
    "3) いつもどおりサイトを公開し直し、ブラウザで一度開く。",
    "   → AgentGuard の「守るサイト」画面が自動で「つながりました」に変わり、設定は完了です。",
  ].join("\n");
}

function HandoffBundle({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-3">
      <p className="flex items-center gap-2 text-xs font-bold text-ink">
        <ClipboardList size={14} className="text-brand" /> 自分で設定しない場合
      </p>
      <p className="mt-0.5 text-[11px] text-muted">サイトを作った人・管理している人に、この手順（キー・ファイル・やること入り）をそのまま渡してください。</p>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-brand bg-white px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5"
      >
        {copied ? <><Check size={14} /> コピーしました（渡す相手に貼り付け）</> : <><Copy size={14} /> 設定手順をまとめてコピー</>}
      </button>
      <p className="mt-1.5 text-[11px] text-muted">※ 秘密の接続キーが含まれます。渡す相手以外には共有しないでください。</p>
    </div>
  );
}

function Progress({ current, done, onGo }: { current: Step; done: (n: Step) => boolean; onGo: (n: Step) => void }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="設定の進み具合">
      {STEPS.map((s) => {
        const isDone = done(s.n);
        const isNow = s.n === current;
        return (
          <li key={s.n}>
            <button type="button" onClick={() => onGo(s.n)} disabled={!isDone && !isNow && s.n > current}
                    aria-current={isNow ? "step" : undefined}
                    className="flex w-full flex-col items-center gap-1 disabled:cursor-not-allowed">
              <span className={cx("h-1.5 w-full rounded-full", isDone ? "bg-safe" : isNow ? "bg-brand" : "bg-line")} />
              <span className={cx("flex items-center gap-1 text-[11px] font-semibold",
                isNow ? "text-brand" : isDone ? "text-emerald-700" : "text-muted")}>
                {isDone ? <CircleCheck size={12} /> : <span className="tabular-nums">{s.n}</span>} {s.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Nav({ onBack, onNext, nextLabel = "次へ", nextDisabled = false }: {
  onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean;
}) {
  return (
    <div className="mt-5 flex items-center justify-between gap-2">
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> 戻る</Button>
      ) : <span />}
      {onNext && <Button onClick={onNext} disabled={nextDisabled}>{nextLabel} <ArrowRight size={15} /></Button>}
    </div>
  );
}

export function ConnectWizard({ site, connectionKey, keyHint, onRotate, onVerified, onOtherMethods }: {
  site: ProtectedSite;
  connectionKey: string | null;
  keyHint?: string;
  onRotate: () => Promise<void>;
  onVerified: (key: string | null, mode: "connected" | "private" | "public" | "dns") => void;
  onOtherMethods: () => void;
}) {
  const { api, ingestUrl } = useSession();
  const tenant = useTenant().data;
  const now = useNow(3000);
  const [state, setState] = useState<Saved>(() => load(site));
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const last = toDate(tenant?.siteLastReportAt);
  const alive = last !== null && now - last.getTime() < ALIVE_MS;
  const { kind, host } = state;
  // A report from the site means the key and the file are already in place: show the last step.
  const step: Step = alive && kind !== "static" ? 4 : state.step;
  const update = (patch: Partial<Saved>) => {
    const next = { ...state, ...patch };
    setState(next);
    save(site.url, next);
  };
  const go = (n: Step) => update({ step: n });

  const verify = useCallback(async () => {
    setChecking(true);
    setProblem(null);
    try {
      const r = await api<{ verified: boolean; message?: string; connectionKey?: string | null; mode?: "connected" | "private" | "public" | "dns" }>(
        "/api/site", { body: { action: "verify", method: "file" } });
      if (r.verified) onVerified(r.connectionKey ?? null, r.mode ?? "connected");
      else setProblem(r.message ?? "確認できませんでした。");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "確認できませんでした。");
    } finally {
      setChecking(false);
    }
  }, [api, onVerified]);

  // The first report from the site means the code and key are in place: check ownership by itself.
  useEffect(() => {
    if (!alive || tried.current || kind === "static") return;
    const t = setTimeout(() => { tried.current = true; void verify(); }, 0);
    return () => clearTimeout(t);
  }, [alive, kind, verify]);

  async function remove() {
    if (!window.confirm("登録を取り消しますか？")) return;
    setBusy(true);
    try { await api("/api/site", { body: { action: "remove" } }); } finally { setBusy(false); }
  }

  const fw = kind === "static" ? null : kind;
  const install = fw ? INSTALL[fw] : null;
  const code = fw ? integrationSnippet(fw, ingestUrl, site.path ?? "") : "";
  const hostSpec = HOSTS.find((h) => h.id === host)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-sm font-bold">{site.url}</span>
        <Badge tone="warn">つなぐ途中</Badge>
      </div>

      <Progress current={step} done={(n) => n < step} onGo={(n) => { if (n <= step) go(n); }} />

      <div className="rounded-2xl border border-line p-4 sm:p-5">
        {step === 1 && (
          <>
            <p className="text-sm font-bold text-ink">ステップ1：サイトの種類を選ぶ</p>
            <p className="mt-1 text-xs text-muted">
              URL から<b className="text-ink">「{KINDS.find((k) => k.id === kind)!.label}」</b>と推測しました。違う場合は選び直してください。
              分からないときは、サイトを作った人に「何で作ったか」を聞いてください。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KINDS.map((k) => (
                <button key={k.id} type="button" onClick={() => update({ kind: k.id })}
                        className={cx("rounded-xl border p-2.5 text-left transition",
                          kind === k.id ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-line bg-white hover:border-brand/40")}>
                  <span className="block text-sm font-bold text-ink">{k.label}</span>
                  <span className="block text-[11px] text-muted">{k.sub}</span>
                </button>
              ))}
            </div>
            {kind === "static" ? (
              <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-amber-900">
                <p className="font-bold">HTMLだけのサイトは、守ることができません</p>
                <p className="mt-1">
                  守るには、届いたアクセスをサイトの中で AgentGuard に知らせるプログラムが必要ですが、GitHub Pages などの
                  HTMLだけのサイトではプログラムを動かせないためです。Next.js・Express・FastAPI で作ったサイトなら守れます。
                </p>
                <button type="button" onClick={onOtherMethods} className="mt-2 font-semibold text-brand hover:underline">
                  所有確認だけ行う（ファイル・DNS の方法）→
                </button>
              </div>
            ) : (
              <Nav onNext={() => go(2)} />
            )}
          </>
        )}

        {step === 2 && fw && (
          <>
            <p className="text-sm font-bold text-ink">ステップ2：接続キーを、サイトの設定に入れる</p>
            <p className="mt-1 text-xs text-muted">接続キーは、あなたのサイトだけが AgentGuard とつながるための合言葉です。</p>
            <div className="mt-3"><KeyBox connectionKey={connectionKey} keyHint={keyHint} onRotate={onRotate} /></div>
            <p className="mt-4 text-xs font-bold text-ink">サイトを公開している場所は？</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {HOSTS.map((h) => (
                <button key={h.id} type="button" onClick={() => update({ host: h.id })}
                        className={cx("rounded-full border px-3 py-1 text-xs font-semibold",
                          host === h.id ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-muted hover:border-brand/40")}>
                  {h.label}
                </button>
              ))}
            </div>
            {host === "cloudrun" ? (
              <CloudRunShortcut host={site.host} connectionKey={connectionKey} />
            ) : (
              <>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
                  {hostSpec.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                {host === "other" && connectionKey && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-semibold text-ink">.env に貼る1行（そのままコピーできます）</p>
                    <CopyField value={`AGENTGUARD_KEY=${connectionKey}`} label=".env の1行" />
                  </div>
                )}
              </>
            )}
            <details className="mt-4 rounded-xl border border-line p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-brand">より安全にする（任意）：AgentGuard に確認できないときも止める</summary>
              <p className="mt-2 text-muted">
                ふだんは、AgentGuard に届かない・2秒以内に返事がないとき、サイトを止めないようにアクセスを通します。
                環境変数 <code className="font-mono">AGENTGUARD_FAIL_CLOSED</code> を <code className="font-mono">true</code> にすると、
                そのときも<b className="text-ink">アクセスを止めて</b>、確認できないアクセスがサイトのコードに届かないようにします。
              </p>
              <p className="mt-1 text-muted">
                そのかわり、AgentGuard が止まっている間や、キーが正しくない間は、サイトが「一時的に利用できません」になります
                （キーを作り直したら、すぐ環境変数も入れ替えてください）。
              </p>
              <div className="mt-2"><CopyField value="AGENTGUARD_FAIL_CLOSED=true" label="追加する環境変数" /></div>
            </details>
            <Nav onBack={() => go(1)} onNext={() => go(3)} nextLabel="キーを入れた" />
          </>
        )}

        {step === 3 && fw && install && (
          <>
            <p className="text-sm font-bold text-ink">ステップ3：ファイルを1つ置く</p>
            <p className="mt-1 text-xs text-muted">
              下のボタンで <b className="font-mono text-ink">{install.fileName}</b> をダウンロードし、
              <b className="text-ink">{install.place}</b>に置きます。
              {install.addLines ? "あとは指定の場所に1〜2行足すだけです。" : "置くだけで終わりです（コードの書き換えはいりません）。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => download(install.fileName, code)}>
                <Download size={15} /> {install.fileName} をダウンロード
              </Button>
            </div>
            <p className="mt-4 text-xs font-bold text-ink">置く場所</p>
            <pre className="mt-1 overflow-x-auto rounded-xl border border-line bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">{install.tree}</pre>
            {fw === "next" && (
              <p className="mt-1 text-[11px] text-muted">
                Next.js 15 以前は、ファイル名を <code className="font-mono">middleware.ts</code> に変えてください。
                すでに同じ名前のファイルがある場合は、サイトを作った人に相談してください（中身をまとめる必要があります）。
              </p>
            )}
            {install.addLines && (
              <>
                <p className="mt-4 text-xs font-bold text-ink">足す行（{install.addWhere}）</p>
                <div className="mt-1"><CopyField value={install.addLines} label="足す行" /></div>
                <p className="mt-2 text-[11px] font-semibold text-muted">足したあとの見た目（例）</p>
                <pre className="mt-1 overflow-x-auto rounded-xl border border-line bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink">{install.context}</pre>
              </>
            )}
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-semibold text-brand">ダウンロードできないとき：中身をコピーする</summary>
              <div className="mt-2"><CopyField value={code} label={`${install.fileName} の中身`} /></div>
            </details>
            <Nav onBack={() => go(2)} onNext={() => go(4)} nextLabel="ファイルを置いた" />
          </>
        )}

        {step === 4 && fw && (
          <>
            <p className="text-sm font-bold text-ink">ステップ4：公開し直して、つながるのを待つ</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
              <li>{hostSpec.publish}</li>
              <li>公開が終わったら、
                <a href={site.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                  サイトを一度開く <ExternalLink size={11} />
                </a>
              </li>
              <li>この画面を開いたまま待つ（自動で「つながりました」に変わります）</li>
            </ol>
            <div className={cx("mt-4 rounded-xl p-4 text-sm", alive ? "bg-safe/10 text-emerald-900" : "bg-slate-100 text-muted")} role="status">
              {!alive ? (
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <Loader2 size={16} className="shrink-0 animate-spin" /> サイトからの合図を待っています…
                </p>
              ) : checking ? (
                <p className="flex items-center gap-2 font-bold"><Loader2 size={16} className="animate-spin" /> つながりました。所有を確認しています…</p>
              ) : problem ? (
                <div>
                  <p className="font-bold text-ink">つながりましたが、所有確認でつまずきました</p>
                  <p className="mt-0.5 text-xs text-rose-700">{problem}</p>
                  <Button size="sm" className="mt-2" onClick={() => void verify()}>もう一度確認する</Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 font-bold"><PartyPopper size={16} /> つながりました！</p>
              )}
            </div>
            {!alive && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer font-semibold text-brand">5分たっても変わらないとき</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>環境変数の名前が <code className="font-mono">AGENTGUARD_KEY</code>（すべて大文字）になっているか</li>
                  <li>キーを入れたあと、公開し直したか（Vercel・Cloud Run は環境変数を変えたら公開し直しが必要）</li>
                  <li>ファイル名と置き場所が合っているか（{install?.fileName}・{install?.place}）</li>
                  <li>それでもだめなら「戻る」で手順を見直すか、下の「自分で設定しない場合」で手順を人に渡してください</li>
                </ul>
              </details>
            )}
            <Nav onBack={() => go(3)} />
          </>
        )}
      </div>

      {fw && connectionKey && <HandoffBundle text={buildHandoff(fw, site.url, connectionKey, code)} />}

      <div className="flex flex-wrap gap-3 text-xs">
        {kind !== "static" && (
          <button type="button" onClick={onOtherMethods} className="font-semibold text-muted hover:text-brand hover:underline">
            ほかの方法で所有確認する（ファイル・DNS）
          </button>
        )}
        <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1 font-semibold text-muted hover:text-rose-600">
          <Trash2 size={12} /> 登録をやめる
        </button>
      </div>
    </div>
  );
}
