"use client";

import { ArrowLeft, ArrowRight, Check, Download, ExternalLink, FileText, FolderOpen, Globe, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/lib/auth-context";
import type { ProtectedSite } from "@/lib/types";

import { CopyField } from "./copy-field";
import { Badge, Button, cx } from "./ui";

/**
 * Guided ownership verification. Method A (place a file) comes first; the owner can switch to
 * method B (DNS TXT) and back at any time, and each method remembers its own step.
 */

type Method = "file" | "dns";
type Framework = "next" | "express" | "fastapi" | "github" | "static";
type Saved = { method: Method; step: Record<Method, number>; framework: Framework };

const FILE_PATH = "/.well-known/agentguard-verify.txt";

// Domains handed out by hosting services: their DNS belongs to the service, so method B cannot work.
const PLATFORM = /\.(run\.app|vercel\.app|web\.app|firebaseapp\.com|netlify\.app|github\.io|pages\.dev|workers\.dev|herokuapp\.com|onrender\.com|fly\.dev|azurewebsites\.net|appspot\.com|cloudfunctions\.net|glitch\.me|replit\.app|railway\.app)$/;

// Two-part public suffixes, so the DNS "name" field can be shown as most providers expect it.
const SECOND_LEVEL = new Set([
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "ed.jp", "gr.jp", "lg.jp", "ad.jp",
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "com.br", "co.kr", "com.tw", "com.sg", "co.in",
]);

function dnsNames(host: string): { zone: string; short: string; full: string } {
  const parts = host.split(".");
  const take = SECOND_LEVEL.has(parts.slice(-2).join(".")) ? 3 : 2;
  const zone = parts.slice(-take).join(".");
  const sub = parts.slice(0, -take).join(".");
  return { zone, short: sub ? `_agentguard.${sub}` : "_agentguard", full: `_agentguard.${host}` };
}

const FRAMEWORKS: { id: Framework; label: string }[] = [
  { id: "next", label: "Next.js" },
  { id: "express", label: "Express（Node.js）" },
  { id: "fastapi", label: "FastAPI（Python）" },
  { id: "github", label: "GitHub Pages" },
  { id: "static", label: "その他・HTMLだけのサイト" },
];

const STEPS: Record<Method, string[]> = {
  file: ["合言葉を置く", "サイトを公開し直す", "確認する"],
  dns: ["DNSに記録を足す", "反映を待つ", "確認する"],
};

const storageKey = (siteUrl: string) => `agentguard.verify.${siteUrl}`;
export const isGitHubPages = (host: string) => host.endsWith(".github.io");

function load(siteUrl: string, host: string): Saved {
  const fallback: Saved = { method: "file", step: { file: 0, dns: 0 }, framework: isGitHubPages(host) ? "github" : "next" };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey(siteUrl));
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Saved>) } : fallback;
  } catch {
    return fallback; // private mode or blocked storage: start from the beginning
  }
}

function save(siteUrl: string, s: Saved) {
  try {
    window.localStorage.setItem(storageKey(siteUrl), JSON.stringify(s));
  } catch {
    // only a convenience: losing it just means starting at step 1 again
  }
}

function downloadFile(content: string, name = "agentguard-verify.txt") {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name; // exact name: avoids "agentguard-verify.txt.txt"
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type DirHandle = {
  name: string;
  getDirectoryHandle(name: string, o: { create: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
};
type Picker = (o?: { mode?: "readwrite"; id?: string }) => Promise<DirHandle>;

/**
 * Chrome / Edge can write into a folder the owner picks: create .well-known/agentguard-verify.txt
 * there (and, for GitHub Pages, the empty .nojekyll that makes Pages publish dot-folders).
 */
async function placeInFolder(token: string, noJekyll = false): Promise<{ status: "done"; folder: string } | { status: "cancelled" | "unsupported" | "error" }> {
  const picker = (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker;
  if (!picker) return { status: "unsupported" };
  try {
    const dir = await picker({ mode: "readwrite", id: "agentguard-public" });
    const wellKnown = await dir.getDirectoryHandle(".well-known", { create: true });
    const file = await wellKnown.getFileHandle("agentguard-verify.txt", { create: true });
    const out = await file.createWritable();
    await out.write(`${token}\n`);
    await out.close();
    if (noJekyll) {
      const marker = await (await dir.getFileHandle(".nojekyll", { create: true })).createWritable();
      await marker.write("");
      await marker.close();
    }
    return { status: "done", folder: dir.name };
  } catch (e) {
    return { status: (e as { name?: string })?.name === "AbortError" ? "cancelled" : "error" };
  }
}

function StepBar({ method, step, onGo }: { method: Method; step: number; onGo: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="進み具合">
      {STEPS[method].map((label, i) => (
        <li key={label} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onGo(i)}
            aria-current={i === step ? "step" : undefined}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition",
              i === step ? "bg-brand text-white" : i < step ? "bg-safe/15 text-emerald-700 hover:bg-safe/25" : "bg-slate-100 text-muted hover:bg-slate-200",
            )}
          >
            <span className="grid size-4 place-items-center rounded-full bg-white/30 text-[10px]">{i < step ? <Check size={11} /> : i + 1}</span>
            {label}
          </button>
          {i < STEPS[method].length - 1 && <span className="text-muted">›</span>}
        </li>
      ))}
    </ol>
  );
}

function Nav({ step, last, onBack, onNext, nextLabel }: {
  step: number; last: number; onBack: () => void; onNext: () => void; nextLabel?: string;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {step > 0 && <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={14} /> 戻る</Button>}
      {step < last && <Button size="sm" onClick={onNext}>{nextLabel ?? "できたので次へ"} <ArrowRight size={14} /></Button>}
    </div>
  );
}

function routeSnippet(fw: "express" | "fastapi", token: string): string {
  if (fw === "express") {
    return `// AgentGuard の所有確認用（確認が済んだら消しても大丈夫です）
app.get("${FILE_PATH}", (req, res) => res.type("text/plain").send("${token}"));`;
  }
  return `# AgentGuard の所有確認用（確認が済んだら消しても大丈夫です）
from fastapi.responses import PlainTextResponse

@app.get("${FILE_PATH}", response_class=PlainTextResponse)
def agentguard_verify():
    return "${token}"`;
}

function FilePlace({ site, framework, setFramework }: {
  site: ProtectedSite; framework: Framework; setFramework: (f: Framework) => void;
}) {
  const token = site.token ?? "";
  const [placed, setPlaced] = useState<string | null>(null);

  const github = framework === "github";

  async function pick() {
    const r = await placeInFolder(token, github);
    if (r.status === "done") {
      const hint = framework === "next" && r.folder !== "public"
        ? `（選んだのは「${r.folder}」フォルダです。Next.js では public フォルダを選んでください）` : "";
      setPlaced(`「${r.folder}」フォルダに .well-known/agentguard-verify.txt${github ? " と .nojekyll" : ""} を作りました${hint}`);
    } else if (r.status === "unsupported") {
      setPlaced("このブラウザではフォルダに直接置けません。下の「ファイルをダウンロード」を使ってください（Chrome / Edge なら直接置けます）。");
    } else if (r.status === "error") {
      setPlaced("置けませんでした。別のフォルダを選ぶか、「ファイルをダウンロード」を使ってください。");
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-bold text-ink">サイトを何で作っていますか？</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {FRAMEWORKS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFramework(f.id)}
                    className={cx("rounded-full border px-3 py-1 text-xs font-semibold",
                      framework === f.id ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-muted hover:border-brand/40")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {framework === "express" || framework === "fastapi" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            {framework === "express" ? "Express" : "FastAPI"} では、ファイルを置く代わりに<b className="text-ink">次の数行をアプリに追加</b>するのが確実です
            {framework === "express" && "（Express は初期設定のままだと「.」で始まるフォルダを公開しないため）"}。合言葉は入った状態です。
          </p>
          <CopyField value={routeSnippet(framework, token)} label="追加するコード" />
        </div>
      ) : (
        <div className="space-y-2">
          {github ? (
            <div className="space-y-1 text-xs text-muted">
              <p>GitHub Pages では、<b className="text-ink">リポジトリの一番上（index.html がある場所）</b>に次の2つを置いて push します。</p>
              <ul className="list-disc space-y-0.5 pl-5">
                <li><code className="font-mono text-ink">.well-known/agentguard-verify.txt</code>（中身は合言葉）</li>
                <li>
                  <code className="font-mono text-ink">.nojekyll</code>（中身は空）…
                  <b className="text-ink">これがないと GitHub Pages は「.」で始まるフォルダを公開しません</b>
                </li>
              </ul>
              <p>push してから公開に反映されるまで、1〜2分かかります。</p>
            </div>
          ) : (
            <p className="text-xs text-muted">
              {framework === "next"
                ? <>プロジェクトの <code className="font-mono text-ink">public</code> フォルダの中に置きます。</>
                : <>サイトの公開フォルダ（index.html がある場所）の中に置きます。</>}
              置く場所：<code className="font-mono text-ink">{framework === "next" ? "public" : "公開フォルダ"}/.well-known/agentguard-verify.txt</code>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={pick}>
              <FolderOpen size={14} /> {github ? "リポジトリのフォルダを選んで自動で置く" : "フォルダを選んで自動で置く"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadFile(`${token}\n`)}><Download size={14} /> 合言葉ファイルをダウンロード</Button>
            {github && (
              <Button size="sm" variant="ghost" onClick={() => downloadFile("", ".nojekyll")}><Download size={14} /> .nojekyll をダウンロード</Button>
            )}
          </div>
          {(github || framework === "static") && (
            <p className="rounded-xl bg-warn/10 px-3 py-2 text-[11px] text-amber-800">
              注意：{github ? "GitHub Pages" : "HTMLだけのサイト"}は、サーバーで動くプログラムを置けません。
              所有確認と登録はできますが、攻撃を検査する「組み込みコード」は動かないため、このままでは守れません。
              守るには、Node.js や Python などサーバーで動くサイトが必要です。
            </p>
          )}
          {placed && <p className="rounded-xl bg-safe/10 px-3 py-2 text-xs text-emerald-800" role="status">{placed}</p>}
          <details className="text-xs text-muted">
            <summary className="cursor-pointer font-semibold text-brand">ダウンロードして自分で置く場合の注意</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>ダウンロードしたファイルを、上の「置く場所」へ移動します（フォルダ <code className="font-mono">.well-known</code> がなければ作ります）。</li>
              <li>エクスプローラーで「.」で始まるフォルダを作れないときは、VS Code の「新しいフォルダー」で作ってください。</li>
              <li>ファイル名が <code className="font-mono">agentguard-verify.txt.txt</code> になっていないか、「表示 → ファイル名拡張子」をオンにして確認してください。</li>
              {github && <li><code className="font-mono">.nojekyll</code> は、<code className="font-mono">.well-known</code> フォルダと同じ場所（リポジトリの一番上）に置きます。</li>}
            </ul>
          </details>
          <p className="text-[11px] text-muted">合言葉だけ必要な場合：</p>
          <CopyField value={token} label="合言葉" />
        </div>
      )}
    </div>
  );
}

function DnsAdd({ site }: { site: ProtectedSite }) {
  const n = dnsNames(site.host);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        ドメインの管理画面（お名前.com・Cloudflare・Google Cloud DNS など）の「DNSレコード設定」で、次の内容のレコードを1つ追加します。
      </p>
      <div className="space-y-2 rounded-xl border border-line p-3">
        <div><p className="mb-1 text-[11px] font-bold text-muted">種類</p><CopyField value="TXT" label="種類" /></div>
        <div>
          <p className="mb-1 text-[11px] font-bold text-muted">名前（ホスト）</p>
          <CopyField value={n.short} label="名前" />
          <p className="mt-1 text-[11px] text-muted">
            多くの管理画面は、後ろに「.{n.zone}」を自動で付けます。完全な名前を入れる欄の場合は{" "}
            <code className="font-mono text-ink">{n.full}</code> と入れてください。
          </p>
        </div>
        <div><p className="mb-1 text-[11px] font-bold text-muted">値（内容）</p><CopyField value={site.token ?? ""} label="値" /></div>
      </div>
    </div>
  );
}

export function VerifyWizard({ site, onVerified }: { site: ProtectedSite; onVerified: (key: string) => void }) {
  const { api } = useSession();
  const [state, setState] = useState<Saved>(() => load(site.url, site.host));
  const [busy, setBusy] = useState<"verify" | "remove" | "edit" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; reason?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [newUrl, setNewUrl] = useState(site.url);
  const [editError, setEditError] = useState<string | null>(null);
  const dnsPossible = !PLATFORM.test(site.host);
  const method: Method = dnsPossible ? state.method : "file";
  const step = state.step[method] ?? 0;
  const last = STEPS[method].length - 1;

  function update(next: Partial<Saved>) {
    const merged = { ...state, ...next, step: { ...state.step, ...(next.step ?? {}) } };
    setState(merged);
    save(site.url, merged);
  }
  const goto = (i: number) => { setResult(null); update({ step: { ...state.step, [method]: Math.max(0, Math.min(last, i)) } }); };
  const switchTo = (m: Method) => { setResult(null); update({ method: m }); };

  async function verify() {
    setBusy("verify");
    setResult(null);
    try {
      const r = await api<{ verified: boolean; message?: string; reason?: string; ingestKey?: string }>(
        "/api/site", { body: { action: "verify", method } });
      if (r.verified && r.ingestKey) {
        save(site.url, { ...state, step: { file: 0, dns: 0 } });
        onVerified(r.ingestKey);
      }
      setResult(r.verified ? { ok: true, text: "所有を確認しました。" } : { ok: false, text: r.message ?? "確認できませんでした。", reason: r.reason });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "確認できませんでした" });
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!window.confirm("登録を取り消しますか？")) return;
    setBusy("remove");
    try { await api("/api/site", { body: { action: "remove" } }); } finally { setBusy(null); }
  }
  /** Fix a mistyped URL. On the same domain the token stays the same, so nothing needs redoing. */
  async function changeUrl() {
    setBusy("edit");
    setEditError(null);
    try {
      await api("/api/site", { body: { action: "register", url: newUrl } });
      setEditing(false);
      setResult(null);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "変更できませんでした");
    } finally {
      setBusy(null);
    }
  }

  const fileUrl = `${site.url}${FILE_PATH}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-sm font-bold">{site.url}</span>
        <Badge tone="warn">所有確認まち</Badge>
        {!editing && (
          <button type="button" onClick={() => { setNewUrl(site.url); setEditing(true); }}
                  className="text-xs font-semibold text-brand hover:underline">URLを直す</button>
        )}
      </div>
      {editing && (
        <div className="space-y-2 rounded-2xl border border-line p-3">
          <p className="text-xs text-muted">同じドメインのまま直す場合は、合言葉は変わりません（置いたファイルはそのまま使えます）。</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input type="url" value={newUrl} onChange={(e) => setNewUrl(e.target.value)}
                   className="h-10 flex-1 rounded-xl border border-line bg-white px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
            <Button size="sm" disabled={busy !== null} onClick={changeUrl}>{busy === "edit" ? "変更中…" : "この URL にする"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>やめる</Button>
          </div>
          {editError && <p className="text-xs text-rose-600">{editError}</p>}
        </div>
      )}
      <p className="text-sm text-muted">
        他人のサイトを勝手に登録できないよう、<b className="text-ink">サイトの持ち主だけができる作業</b>で本人確認をします。
        方法は2つあり、<b className="text-ink">途中でいつでも切り替えられます</b>。
      </p>

      <div role="tablist" aria-label="確認の方法" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {([
          { m: "file" as const, icon: <FileText size={16} />, title: "A. ファイルを置く", sub: "おすすめ・かんたん", disabled: false },
          { m: "dns" as const, icon: <Globe size={16} />, title: "B. DNSに記録を足す", sub: dnsPossible ? "独自ドメインがある人向け" : "このURLでは使えません", disabled: !dnsPossible },
        ]).map((o) => (
          <button key={o.m} type="button" role="tab" aria-selected={method === o.m} disabled={o.disabled}
                  onClick={() => switchTo(o.m)}
                  className={cx("flex items-center gap-3 rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                    method === o.m ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-line bg-white hover:border-brand/40")}>
            <span className={cx("grid size-9 place-items-center rounded-xl", method === o.m ? "bg-brand text-white" : "bg-slate-100 text-muted")}>{o.icon}</span>
            <span>
              <span className="block text-sm font-bold text-ink">{o.title}</span>
              <span className="block text-xs text-muted">{o.sub}</span>
            </span>
          </button>
        ))}
      </div>
      {!dnsPossible && (
        <p className="text-xs text-muted">
          このURL（{site.host}）はホスティングサービスのドメインなので、DNS の設定はサービス側が持っています。A の方法で確認してください。
        </p>
      )}

      <div className="rounded-2xl border border-line p-4">
        <StepBar method={method} step={step} onGo={goto} />
        <div className="mt-4">
          {method === "file" && step === 0 && (
            <FilePlace site={site} framework={state.framework} setFramework={(f) => update({ framework: f })} />
          )}
          {method === "file" && step === 1 && (
            <div className="space-y-2 text-sm">
              <p className="text-muted">変更したサイトを、いつもの方法で<b className="text-ink">公開（デプロイ）し直して</b>ください。パソコンの中にあるだけでは、AgentGuard から見えません。</p>
              <p className="text-muted">公開できたら、次のリンクを開いて合言葉が表示されるか確かめます。</p>
              <a href={fileUrl} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1.5 break-all rounded-xl border border-line bg-white px-3 py-2 font-mono text-xs text-brand hover:bg-brand/5">
                {fileUrl} <ExternalLink size={12} className="shrink-0" />
              </a>
            </div>
          )}
          {method === "dns" && step === 0 && <DnsAdd site={site} />}
          {method === "dns" && step === 1 && (
            <p className="text-sm text-muted">
              DNS の変更が世界中に行き渡るまで、<b className="text-ink">数分〜数時間</b>かかることがあります。少し待ってから次へ進んでください
              （確認に失敗しても、時間をおいて何度でもやり直せます）。
            </p>
          )}
          {step === last && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {method === "file" ? "AgentGuard がファイルを読みに行き、" : "AgentGuard が DNS の記録を調べ、"}
                合言葉が一致すれば登録が完了して「取り込みキー」が表示されます。
              </p>
              <Button disabled={busy !== null} onClick={verify}>
                {busy === "verify" ? <><Loader2 size={14} className="animate-spin" /> 確認中…</> : "確認する"}
              </Button>
              {result && (
                <div role="status" className={cx("rounded-xl px-3 py-2 text-sm", result.ok ? "bg-safe/10 text-emerald-800" : "bg-danger/8 text-rose-700")}>
                  {result.text}
                  {!result.ok && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {method === "file" && result.reason !== "redirect" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => goto(0)}>① 置き方を見直す</Button>
                          <Button size="sm" variant="ghost" onClick={() => goto(1)}>② 公開を見直す</Button>
                        </>
                      )}
                      {method === "dns" && <Button size="sm" variant="ghost" onClick={() => goto(0)}>① 記録を見直す</Button>}
                      {method === "file" && dnsPossible && (
                        <Button size="sm" variant="ghost" onClick={() => switchTo("dns")}>B（DNS）に切り替える</Button>
                      )}
                      {method === "dns" && <Button size="sm" variant="ghost" onClick={() => switchTo("file")}>A（ファイル）に切り替える</Button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <Nav step={step} last={last} onBack={() => goto(step - 1)} onNext={() => goto(step + 1)}
             nextLabel={method === "dns" && step === 1 ? "待ったので次へ" : undefined} />
      </div>

      <Button variant="ghost" size="sm" disabled={busy !== null} onClick={remove}><Trash2 size={14} /> 登録をやめる</Button>
    </div>
  );
}
