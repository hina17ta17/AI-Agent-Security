"use client";

import { CircleCheck, ExternalLink, Loader2, PartyPopper, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { toDate } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";
import type { ProtectedSite } from "@/lib/types";

import { CopyField } from "./copy-field";
import { KeyBox } from "./site-connect";
import { integrationSnippet, type ServerFramework } from "./site-snippets";
import { Badge, Button, cx } from "./ui";

/**
 * Connecting a site, in three plain steps: pick the kind of site, put the key in, put the code in.
 * After that nothing more is asked: the first report from the site turns the status green and
 * the ownership check runs by itself.
 */

type Kind = ServerFramework | "static";
type Host = "vercel" | "cloudrun" | "other";

const KINDS: { id: Kind; label: string; sub: string }[] = [
  { id: "next", label: "Next.js", sub: "Vercel などで公開" },
  { id: "express", label: "Express", sub: "Node.js のサーバー" },
  { id: "fastapi", label: "FastAPI", sub: "Python のサーバー" },
  { id: "static", label: "HTMLだけのサイト", sub: "GitHub Pages など" },
];

const HOSTS: { id: Host; label: string; steps: string[] }[] = [
  {
    id: "vercel", label: "Vercel",
    steps: [
      "vercel.com でこのサイトのプロジェクトを開く",
      "上のメニューの「Settings」→ 左の「Environment Variables」",
      "Key に AGENTGUARD_KEY、Value に上の接続キーを貼って「Save」",
    ],
  },
  {
    id: "cloudrun", label: "Cloud Run",
    steps: [
      "Google Cloud コンソールで Cloud Run のサービスを開く",
      "「新しいリビジョンの編集とデプロイ」→「変数とシークレット」",
      "「変数を追加」で 名前 AGENTGUARD_KEY、値 に上の接続キーを貼って「デプロイ」",
    ],
  },
  {
    id: "other", label: "それ以外・自分のPC",
    steps: [
      "サイトのフォルダにある .env ファイルを開く（なければ作る）",
      "AGENTGUARD_KEY=（上の接続キー） の1行を書いて保存",
      ".env は GitHub などに公開しないでください",
    ],
  },
];

const WHERE: Record<ServerFramework, { file: string; how: string }> = {
  next: {
    file: "proxy.ts（Next.js 15 以前は middleware.ts）",
    how: "package.json と同じ場所に新しいファイルを作り、下のコードを丸ごと貼り付けます（src フォルダを使っている場合は src の中）。",
  },
  express: {
    file: "サーバーのファイル（server.js / app.js など）",
    how: "const app = express() と app.use(express.json()) の下、ほかの app.get などより前に貼り付けます。",
  },
  fastapi: {
    file: "main.py",
    how: "app = FastAPI() の下に貼り付けます（httpx を使うので、まだなら pip install httpx）。",
  },
};

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

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-ink">
        <span className={cx("grid size-6 place-items-center rounded-full text-xs text-white", done ? "bg-safe" : "bg-brand")}>
          {done ? <CircleCheck size={14} /> : n}
        </span>
        {title}
      </p>
      <div className="mt-3">{children}</div>
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
  const [kind, setKind] = useState<Kind>(() => guessKind(site.host));
  const [host, setHost] = useState<Host>(() => guessHost(site.host));
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);

  const last = toDate(tenant?.siteLastReportAt);
  const alive = last !== null && now - last.getTime() < ALIVE_MS;

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-sm font-bold">{site.url}</span>
        <Badge tone="warn">つなぐ準備中</Badge>
      </div>
      <p className="text-sm text-muted">
        あと3ステップで、このサイトを守れます。<b className="text-ink">キーとコードをサイトに入れるだけ</b>で、
        あとは AgentGuard が自動でつながりを確かめます。
      </p>

      <Step n={1} title="サイトの種類を選ぶ" done={kind !== "static"}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)}
                    className={cx("rounded-xl border p-2.5 text-left transition",
                      kind === k.id ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-line bg-white hover:border-brand/40")}>
              <span className="block text-sm font-bold text-ink">{k.label}</span>
              <span className="block text-[11px] text-muted">{k.sub}</span>
            </button>
          ))}
        </div>
      </Step>

      {kind === "static" ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-amber-900">
          <p className="font-bold">HTMLだけのサイトは、守ることができません</p>
          <p className="mt-1 text-xs">
            守るには、届いたアクセスをサイトの中で AgentGuard に知らせるプログラムが必要ですが、GitHub Pages などの
            HTMLだけのサイトではプログラムを動かせないためです。Next.js・Express・FastAPI で作ったサイトなら守れます。
          </p>
          <button type="button" onClick={onOtherMethods} className="mt-2 text-xs font-semibold text-brand hover:underline">
            所有確認だけ行う（ファイル・DNS の方法）→
          </button>
        </div>
      ) : (
        <>
          <Step n={2} title="接続キーを、サイトの設定に入れる" done={alive}>
            <KeyBox connectionKey={connectionKey} keyHint={keyHint} onRotate={onRotate} />
            <p className="mt-3 text-xs font-bold text-ink">どこに入れる？（サイトを公開している場所を選んでください）</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {HOSTS.map((h) => (
                <button key={h.id} type="button" onClick={() => setHost(h.id)}
                        className={cx("rounded-full border px-3 py-1 text-xs font-semibold",
                          host === h.id ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-muted hover:border-brand/40")}>
                  {h.label}
                </button>
              ))}
            </div>
            {host === "cloudrun" ? (
              <CloudRunShortcut host={site.host} connectionKey={connectionKey} />
            ) : (
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
                {HOSTS.find((h) => h.id === host)!.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            )}
          </Step>

          <Step n={3} title="コードをサイトに追加して、公開し直す" done={alive}>
            <p className="text-xs text-muted">
              ファイル：<b className="text-ink">{WHERE[kind].file}</b>。{WHERE[kind].how}
              保存したら、いつもどおりサイトを公開し直します（Vercel なら GitHub に push するだけ）。
            </p>
            <div className="mt-2">
              <CopyField value={integrationSnippet(kind, ingestUrl, site.path ?? "")} label="組み込みコード" />
            </div>
          </Step>

          <div className={cx("rounded-2xl p-4 text-sm", alive ? "bg-safe/10 text-emerald-900" : "bg-slate-100 text-muted")}
               role="status">
            {!alive ? (
              <div className="flex items-start gap-2">
                <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
                <div>
                  <p className="font-bold text-ink">サイトからの合図を待っています</p>
                  <p className="mt-0.5 text-xs">
                    公開し直したら、サイトを一度ブラウザで開いてください。合図が届くと、ここが自動で緑になり、所有確認も自動で終わります。
                  </p>
                  <a href={site.url} target="_blank" rel="noreferrer"
                     className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
                    サイトを開く <ExternalLink size={12} />
                  </a>
                </div>
              </div>
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
        </>
      )}

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
