"use client";

import {
  ArrowLeft, ArrowRight, Check, CircleCheck, ClipboardList, Copy, Download, ExternalLink, FolderDown, Loader2, PartyPopper, Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { toDate } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";
import type { ProtectedSite } from "@/lib/types";

import { CopyField } from "./copy-field";
import { KeyBox } from "./site-connect";
import { cloudRunCommand, cloudRunService, downloadSetupKit, type Host, HOSTS, LOCAL_ENV, publishGuide } from "./setup-kit";
import { INSTALL, integrationSnippet, type ServerFramework } from "./site-snippets";
import { Badge, Button, cx } from "./ui";

/**
 * Connecting a site, one step at a time: (1) what kind of site, (2) put the key in, (3) put one
 * file in, (4) update the site and wait. Only the current step is on screen, with a progress bar.
 * The first report from the site moves straight to the last step and checks ownership by itself.
 * Progress is remembered per site in this browser, so a reload does not start over.
 *
 * Wording: plain, short sentences. Technical words only with their meaning beside them.
 */

type Kind = ServerFramework | "static";
type Step = 1 | 2 | 3 | 4;

const KINDS: { id: Kind; label: string; sub: string }[] = [
  { id: "next", label: "Next.js", sub: "Vercel などで公開" },
  { id: "express", label: "Express", sub: "Node.js のサーバー" },
  { id: "fastapi", label: "FastAPI", sub: "Python のサーバー" },
  { id: "static", label: "HTMLだけのサイト", sub: "GitHub Pages など" },
];

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "種類" },
  { n: 2, label: "キー" },
  { n: 3, label: "ファイル" },
  { n: 4, label: "更新・確認" },
];

const ALIVE_MS = 15 * 60_000;

/** For Cloud Run, putting the key in is one pasted line in Cloud Shell (it also updates the site). */
function CloudRunShortcut({ host, connectionKey }: { host: string; connectionKey: string | null }) {
  const run = cloudRunService(host);
  const [, step2] = HOSTS.find((h) => h.id === "cloudrun")!.keySteps;
  return (
    <div className="mt-2 rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs">
      <p className="font-bold text-ink">いちばんかんたん：Cloud Shell に1行貼るだけ</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
        <li>
          <a href="https://console.cloud.google.com/run?cloudshell=true" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
            Cloud Shell を開く <ExternalLink size={11} />
          </a>
          を押します。Google Cloud の画面の下に、文字を打ちこむ黒い画面が出てきます（サイトのプロジェクトが選ばれているか確認してください）。
        </li>
        <li>{step2}</li>
      </ol>
      <div className="mt-2"><CopyField value={cloudRunCommand(host, connectionKey)} label="Cloud Shell に貼る1行" /></div>
      {!connectionKey && <p className="mt-1 text-rose-700">キーが表示されていないときは、上の「キーをなくした・作り直す」で新しいキーを出してください。</p>}
      <p className="mt-2 text-muted">この1行で、キーが入ったうえで、サイトも自動で更新されます。</p>
      {run && (
        <p className="mt-1 text-muted">
          画面でやりたい場合：
          <a href={`https://console.cloud.google.com/run/deploy/${run.region}/${run.service}`} target="_blank" rel="noreferrer"
             className="font-semibold text-brand hover:underline">{run.service} の設定画面を開く</a>
          →「変数とシークレット」→「変数を追加」で、名前に AGENTGUARD_KEY、値に接続キーを入れて →「デプロイ」を押します。
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
 * The whole setup as one block of text, for sending in a chat to whoever manages the site. It
 * contains the secret key, so it is offered only while the key is on screen.
 */
function buildHandoff(kind: ServerFramework, url: string, key: string, snippet: string): string {
  const i = INSTALL[kind];
  return [
    "【AgentGuard とつなぐ方法】このサイトを守るための設定です（5分くらいで終わります）",
    "",
    `守るサイト：${url}`,
    `サイトの種類：${KINDS.find((k) => k.id === kind)!.label}`,
    "",
    "1) サイトの秘密の設定（環境変数）に、次の1行を入れてください：",
    `   AGENTGUARD_KEY=${key}`,
    "   ※ このキーは人に見せてはいけない合言葉です。サイトのファイルの中には書かないでください。",
    "",
    `2) 下のコードを「${i.fileName}」という名前のファイルで保存して、${i.place}に置いてください。`,
    ...(i.addLines ? [`   それから、${i.addWhere}に、次を書き足してください：`, ...i.addLines.split("\n").map((l) => `     ${l}`)] : []),
    "",
    `----- ${i.fileName} ここから -----`,
    snippet,
    `----- ${i.fileName} ここまで -----`,
    "",
    "3) いつもどおりサイトを更新して（GitHub に送る・もう一度公開する）、ブラウザでサイトを1回開いてください。",
    "   → AgentGuard の「守るサイト」の画面が、自動で「つながりました」に変われば終わりです。",
  ].join("\n");
}

function HandoffBundle({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-3">
      <p className="flex items-center gap-2 text-xs font-bold text-ink">
        <ClipboardList size={14} className="text-brand" /> 自分でやらないとき
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        上の「設定セット（ZIP）」を、サイトを作った人にそのまま渡すのがいちばん確実です。チャットで送りたいときは、同じ内容を文章でコピーできます。
      </p>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-brand bg-white px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/5"
      >
        {copied ? <><Check size={14} /> コピーしました（送りたい相手に貼り付けてください）</> : <><Copy size={14} /> やり方をまとめてコピー</>}
      </button>
      <p className="mt-1.5 text-[11px] text-muted">※ 接続キー（合言葉）が入っています。渡す相手のほかには見せないでください。</p>
    </div>
  );
}

function Progress({ current, done, onGo }: { current: Step; done: (n: Step) => boolean; onGo: (n: Step) => void }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="進みぐあい">
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

const pre = "mt-1 overflow-x-auto rounded-xl border border-line bg-slate-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink";

/** How to update the site (push, deploy, restart) for the chosen hosting: the common way first. */
function PublishHelp({ host, kind, siteHost }: { host: Host; kind: ServerFramework; siteHost: string }) {
  const g = publishGuide(host, kind, siteHost);
  return (
    <div className="mt-2 space-y-2 text-xs">
      <p className="text-ink">{g.intro}</p>
      <p className="text-muted">{g.where}</p>
      {g.ways.map((w, i) => {
        const body = (
          <>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">{w.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            {w.code && <div className="mt-2"><CopyField value={w.code} label={w.name} /></div>}
          </>
        );
        return i === 0 ? (
          <div key={w.name} className="rounded-xl border border-brand/30 bg-brand/5 p-3">
            <p className="font-bold text-ink">{w.name}</p>
            {body}
          </div>
        ) : (
          <details key={w.name} className="rounded-xl border border-line p-3">
            <summary className="cursor-pointer font-semibold text-brand">{w.name}</summary>
            {body}
          </details>
        );
      })}
      <p className="text-ink">{g.done}</p>
      {g.notes.map((n) => <p key={n} className="text-muted">{n}</p>)}
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
      else setProblem(r.message ?? "確かめられませんでした。");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "確かめられませんでした。");
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
    if (!window.confirm("このサイトの登録をやめますか？")) return;
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

      {fw && (
        <div className="rounded-2xl border-2 border-brand/40 bg-linear-to-br from-brand/8 to-white p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-ink">
            <FolderDown size={17} className="text-brand" /> いちばんかんたん：必要なものをフォルダごとダウンロード
          </p>
          <p className="mt-1 text-xs text-muted">
            つなぐのに必要なファイルと接続キー、それに<b className="text-ink">「どこに何を入れるか」を書いた説明</b>を、1つのフォルダにまとめました。
            ダウンロードしたら、中の <code className="font-mono">READ_ME_FIRST.html</code> を開いて、上から順番にやるだけです。
          </p>
          <pre className={cx(pre, "mt-2 bg-white")}>{[
            "agentguard-setup/",
            "├─ READ_ME_FIRST.html        ← やり方の説明（最初に開く）",
            `├─ files_for_your_site/${install!.fileName}   ← サイトのフォルダに入れる`,
            "└─ AGENTGUARD_KEY.txt        ← 接続キー（合言葉。秘密の設定に入れる）",
          ].join("\n")}</pre>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => downloadSetupKit({ kind: fw, host, siteUrl: site.url, siteHost: site.host, key: connectionKey,
                                                      snippet: code, dashboardUrl: window.location.origin })}>
              <Download size={15} /> フォルダをダウンロード（ZIP）
            </Button>
            <span className="text-[11px] text-muted">
              いまの選択：{KINDS.find((k) => k.id === kind)!.label}・{hostSpec.label}（ちがうときは、下のステップ1と2で選びなおしてからダウンロードしてください）
            </span>
          </div>
          {!connectionKey && (
            <p className="mt-2 text-[11px] text-rose-700">
              接続キーは作ったときに1回しか見られないので、いまダウンロードするとキーが入りません。
              ステップ2の「キーをなくした・作り直す」で新しいキーを出してから、ダウンロードしてください。
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted">この画面を見ながら、下の4つのステップで進めることもできます。</p>
        </div>
      )}

      <Progress current={step} done={(n) => n < step} onGo={(n) => { if (n <= step) go(n); }} />

      <div className="rounded-2xl border border-line p-4 sm:p-5">
        {step === 1 && (
          <>
            <p className="text-sm font-bold text-ink">ステップ1：サイトは何で作られていますか？</p>
            <p className="mt-1 text-xs text-muted">
              URL から<b className="text-ink">「{KINDS.find((k) => k.id === kind)!.label}」</b>だと思いました。ちがっていたら、選びなおしてください。
              わからないときは、サイトを作った人に聞いてみてください。
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
                  守るには、サイトの中でプログラムを動かして、届いたアクセスを AgentGuard に知らせる必要があります。
                  GitHub Pages のような HTMLだけのサイトでは、プログラムを動かせないためです。Next.js・Express・FastAPI で作ったサイトなら守れます。
                </p>
                <button type="button" onClick={onOtherMethods} className="mt-2 font-semibold text-brand hover:underline">
                  あなたのサイトかどうかの確認だけする（ファイル・DNS を使う方法）→
                </button>
              </div>
            ) : (
              <Nav onNext={() => go(2)} />
            )}
          </>
        )}

        {step === 2 && fw && (
          <>
            <p className="text-sm font-bold text-ink">ステップ2：接続キーを、サイトの秘密の設定に入れる</p>
            <p className="mt-1 text-xs text-muted">
              接続キーは、あなたのサイトと AgentGuard をつなぐ合言葉です。サイトのファイルの中には書かずに、
              公開しているところの「秘密の設定（環境変数）」に入れます。
            </p>
            <div className="mt-3"><KeyBox connectionKey={connectionKey} keyHint={keyHint} onRotate={onRotate} /></div>
            <p className="mt-4 text-xs font-bold text-ink">サイトはどこで公開していますか？</p>
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
                  {hostSpec.keySteps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                {host === "other" && (
                  <div className="mt-2 rounded-xl border border-line bg-slate-50 p-3 text-xs">
                    <p className="text-muted">作るファイルの名前：<code className="font-mono text-ink">{LOCAL_ENV[fw].file}</code></p>
                    {connectionKey && (
                      <div className="mt-2">
                        <p className="mb-1 text-[11px] font-semibold text-ink">{LOCAL_ENV[fw].file} に貼る1行（そのままコピーできます）</p>
                        <CopyField value={`AGENTGUARD_KEY=${connectionKey}`} label={`${LOCAL_ENV[fw].file} に貼る1行`} />
                      </div>
                    )}
                    <p className="mt-2 text-muted">起動のしかた：</p>
                    <div className="mt-1"><CopyField value={LOCAL_ENV[fw].command} label="起動のしかた" /></div>
                    <p className={cx("mt-1", fw === "next" ? "text-muted" : "text-amber-800")}>{LOCAL_ENV[fw].note}</p>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted">{hostSpec.keyNote}</p>
              </>
            )}
            <details className="mt-4 rounded-xl border border-line p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-brand">（使わなくても大丈夫）もっと安全にしたいとき</summary>
              <p className="mt-2 text-muted">
                ふだんは、AgentGuard と連絡がとれないとき（AgentGuard が止まっている、返事が2秒より遅いなど）、サイトが止まらないように、アクセスをそのまま通します。
              </p>
              <p className="mt-1 text-muted">
                秘密の設定に <code className="font-mono">AGENTGUARD_FAIL_CLOSED=true</code> も足すと、連絡がとれないときも<b className="text-ink">アクセスを止めて</b>、
                確かめられないアクセスがサイトに届かないようにします。そのかわり、AgentGuard が止まっているあいだや、キーがまちがっているあいだは、サイトが見られなくなります
                （キーを作り直したら、秘密の設定のキーもすぐに入れかえてください）。
              </p>
              <div className="mt-2"><CopyField value="AGENTGUARD_FAIL_CLOSED=true" label="足す設定" /></div>
            </details>
            <Nav onBack={() => go(1)} onNext={() => go(3)} nextLabel="キーを入れた" />
          </>
        )}

        {step === 3 && fw && install && (
          <>
            <p className="text-sm font-bold text-ink">ステップ3：つなぐためのファイルを1つ置く</p>
            <p className="mt-1 text-xs text-muted">
              下のボタンで <b className="font-mono text-ink">{install.fileName}</b> をダウンロードして、
              <b className="text-ink">{install.place}</b>に置きます。
              {install.addLines ? "そのあと、決まった場所に1〜2行だけ書き足します。" : "置くだけで終わりです（中身を書きかえる必要はありません）。"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => download(install.fileName, code)}>
                <Download size={15} /> {install.fileName} をダウンロード
              </Button>
            </div>
            <p className="mt-4 text-xs font-bold text-ink">置く場所（置いたあとの形）</p>
            <pre className={pre}>{install.tree}</pre>
            <p className="mt-1 text-[11px] text-muted">
              「サイトのフォルダ」とは、<code className="font-mono">{fw === "fastapi" ? "main.py" : "package.json"}</code> が入っているフォルダのことです。
            </p>
            {fw === "next" && (
              <p className="mt-1 text-[11px] text-muted">
                Next.js のバージョンが15より前のときは、ファイルの名前を <code className="font-mono">middleware.ts</code> に変えてください。
                すでに同じ名前のファイルがあるときは、上書きしないで、サイトを作った人に相談してください（2つの中身をまとめる必要があります）。
              </p>
            )}
            {install.addLines && (
              <>
                <p className="mt-4 text-xs font-bold text-ink">書き足す行（{install.addWhere}）</p>
                <div className="mt-1"><CopyField value={install.addLines} label="書き足す行" /></div>
                <p className="mt-2 text-[11px] font-semibold text-muted">書き足したあとは、たとえばこんな感じです</p>
                <pre className={pre}>{install.context}</pre>
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
            <p className="text-sm font-bold text-ink">ステップ4：サイトを更新して、つながるのを待つ</p>
            <PublishHelp host={host} kind={fw} siteHost={site.host} />
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-muted">
              <li>更新が終わったら、
                <a href={site.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                  あなたのサイトを1回開いてください <ExternalLink size={11} />
                </a>
              </li>
              <li>この画面を開いたまま待ちます。自動で「つながりました」に変わります。</li>
            </ol>
            <div className={cx("mt-4 rounded-xl p-4 text-sm", alive ? "bg-safe/10 text-emerald-900" : "bg-slate-100 text-muted")} role="status">
              {!alive ? (
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <Loader2 size={16} className="shrink-0 animate-spin" /> サイトからの合図を待っています…
                </p>
              ) : checking ? (
                <p className="flex items-center gap-2 font-bold"><Loader2 size={16} className="animate-spin" /> つながりました。あなたのサイトか確かめています…</p>
              ) : problem ? (
                <div>
                  <p className="font-bold text-ink">つながりましたが、あなたのサイトだと確かめられませんでした</p>
                  <p className="mt-0.5 text-xs text-rose-700">{problem}</p>
                  <Button size="sm" className="mt-2" onClick={() => void verify()}>もう一度確かめる</Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 font-bold"><PartyPopper size={16} /> つながりました！</p>
              )}
            </div>
            {!alive && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer font-semibold text-brand">5分たっても変わらないとき</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>秘密の設定の名前が <code className="font-mono">AGENTGUARD_KEY</code>（すべて大文字）になっていますか？</li>
                  <li>キーを入れたあとに、サイトを更新しましたか？（Vercel と Cloud Run は、キーを入れたあとに更新しないと、キーが使われません）</li>
                  <li>ファイルの名前（{install?.fileName}）と、置いた場所（{install?.place}）は合っていますか？</li>
                  <li>それでもだめなときは、「戻る」で手順を見なおすか、下の「自分でやらないとき」で、サイトを作った人にやり方を渡してください。</li>
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
            ほかの方法で、あなたのサイトか確かめる（ファイル・DNS）
          </button>
        )}
        <button type="button" onClick={remove} disabled={busy} className="inline-flex items-center gap-1 font-semibold text-muted hover:text-rose-600">
          <Trash2 size={12} /> 登録をやめる
        </button>
      </div>
    </div>
  );
}
