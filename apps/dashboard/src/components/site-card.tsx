"use client";

import { Check, Copy, Globe, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks";
import type { ProtectedSite } from "@/lib/types";

import { Badge, Button, Card, CardHeader, cx } from "./ui";

function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className={cx("min-w-0 flex-1 overflow-x-auto rounded-xl border border-line bg-slate-50 px-3 py-2 text-xs", mono && "font-mono")}>
        {value}
      </code>
      <button
        type="button"
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="shrink-0 rounded-xl border border-line bg-white px-3 text-xs font-semibold text-brand hover:bg-brand/5"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function snippet(lang: "node" | "python", ingestUrl: string): string {
  if (lang === "node") {
    return `// AgentGuard 保護ミドルウェア（Express）。環境変数 AGENTGUARD_INGEST_KEY に取り込みキーを設定。
// パスワードなどの欄は伏せてから送ります（AgentGuard には届きません）。
const SECRET = /pass|pwd|token|secret|card|cvc|otp/i;
const hide = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, SECRET.test(k) ? "[伏せ字]" : v]));
app.use(async (req, res, next) => {
  try {
    const r = await fetch("${ingestUrl}", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: \`Bearer \${process.env.AGENTGUARD_INGEST_KEY}\` },
      body: JSON.stringify({
        method: req.method, path: req.path, query: hide(req.query),
        headers: { "user-agent": req.get("user-agent") || "", "content-type": "application/json" },
        body: req.body && typeof req.body === "object" ? JSON.stringify(hide(req.body)) : "",
        ip: req.ip,
      }),
      signal: AbortSignal.timeout(2000),
    });
    const d = await r.json();
    if (d.block) return res.status(403).send("Blocked by AgentGuard");
  } catch { /* 到達できないときは通す（サイトを止めない） */ }
  next();
});`;
  }
  return `# AgentGuard 保護ミドルウェア（FastAPI）。環境変数 AGENTGUARD_INGEST_KEY に取り込みキーを設定。
# パスワードなどの欄は伏せてから送ります（AgentGuard には届きません）。
import os, re, httpx
from starlette.responses import PlainTextResponse

SECRET = re.compile(r"pass|pwd|token|secret|card|cvc|otp", re.I)

@app.middleware("http")
async def agentguard(request, call_next):
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            r = await c.post("${ingestUrl}",
                headers={"authorization": f"Bearer {os.environ['AGENTGUARD_INGEST_KEY']}"},
                json={"method": request.method, "path": request.url.path,
                      "query": {k: ("[伏せ字]" if SECRET.search(k) else v) for k, v in request.query_params.items()},
                      "headers": {"user-agent": request.headers.get("user-agent", "")},
                      "ip": request.client.host if request.client else None})
        if r.json().get("block"):
            return PlainTextResponse("Blocked by AgentGuard", status_code=403)
    except Exception:
        pass  # 到達できないときは通す（サイトを止めない）
    return await call_next(request)`;
}

function RegisterForm() {
  const { api } = useSession();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/site", { body: { action: "register", url } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">守りたいご自分のサイトのURLを登録してください（1アカウント1つまで）。登録後、所有確認を行います。</p>
      <p className="text-xs text-muted">
        保存するのはサイトのURLと所有確認の状態だけです。サイトの中身や、ふつうの訪問者の情報は保存しません
        （攻撃と判定したときだけ、攻撃元IPと攻撃内容の一部を記録します）。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="h-11 flex-1 rounded-xl border border-line bg-white px-4 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button type="submit" disabled={busy || url.trim().length < 4}>{busy ? "登録中…" : "登録する"}</Button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </form>
  );
}

function VerifyPanel({ site, onVerified }: { site: ProtectedSite; onVerified: (key: string) => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState<"verify" | "remove" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function verify() {
    setBusy("verify");
    setMessage(null);
    try {
      const r = await api<{ verified: boolean; message?: string; ingestKey?: string }>("/api/site", { body: { action: "verify" } });
      if (r.verified && r.ingestKey) onVerified(r.ingestKey);
      setMessage(r.verified
        ? { ok: true, text: "所有を確認しました。" }
        : { ok: false, text: r.message ?? "確認できませんでした。" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "確認できませんでした" });
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!window.confirm("登録を取り消しますか？")) return;
    setBusy("remove");
    try { await api("/api/site", { body: { action: "remove" } }); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-bold">{site.host}</span>
        <Badge tone="warn">所有確認まち</Badge>
      </div>
      <p className="text-sm text-muted">
        他人のサイトを勝手に登録できないよう、<b className="text-ink">このサイトの持ち主だけができる作業</b>で本人確認をします。
        次の3ステップで終わります。
      </p>

      <div className="rounded-2xl border border-line p-3">
        <p className="text-xs font-bold text-ink">ステップ1：合言葉（トークン）をコピーする</p>
        <div className="mt-2"><CopyField value={site.token ?? ""} /></div>
      </div>

      <div className="rounded-2xl border border-line p-3">
        <p className="text-xs font-bold text-ink">ステップ2：次の <span className="text-brand">AかBのどちらか1つ</span> をする</p>

        <div className="mt-2 rounded-xl bg-brand/5 p-3">
          <p className="text-xs font-bold text-ink">A. ファイルを置く（おすすめ・かんたん）</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-muted">
            <li>サイトの公開フォルダに <code className="font-mono text-ink">.well-known</code> というフォルダを作る</li>
            <li>その中に <code className="font-mono text-ink">agentguard-verify.txt</code> というファイルを作り、コピーした合言葉を1行だけ貼り付けて保存する</li>
            <li>サイトを公開（デプロイ）し直す</li>
            <li>
              ブラウザで{" "}
              <a href={`${site.url}/.well-known/agentguard-verify.txt`} target="_blank" rel="noreferrer"
                 className="break-all font-mono text-brand hover:underline">{site.url}/.well-known/agentguard-verify.txt</a>{" "}
              を開き、合言葉が表示されればOK
            </li>
          </ol>
          <p className="mt-2 text-[11px] text-muted">
            公開フォルダの例：Next.js は <code className="font-mono">public/</code>、Express は <code className="font-mono">express.static()</code> で公開しているフォルダ、
            FastAPI は <code className="font-mono">StaticFiles</code> で公開しているフォルダ
          </p>
        </div>

        <div className="mt-2 rounded-xl border border-line p-3">
          <p className="text-xs font-bold text-ink">B. DNS に記録を足す（独自ドメインを持っていて、ファイルを置きにくい人向け）</p>
          <p className="mt-1 text-xs text-muted">ドメインの管理画面（お名前.com・Cloudflare など）で、次のレコードを追加します。</p>
          <table className="mt-2 w-full text-xs">
            <tbody className="divide-y divide-line">
              <tr><td className="w-28 py-1 text-muted">種類</td><td className="py-1 font-mono text-ink">TXT</td></tr>
              <tr><td className="py-1 text-muted">名前（ホスト）</td><td className="py-1 font-mono text-ink break-all">_agentguard.{site.host}</td></tr>
              <tr><td className="py-1 text-muted">値</td><td className="py-1 text-ink">ステップ1でコピーした合言葉</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            管理画面によっては、名前にドメイン部分を含めず <code className="font-mono">_agentguard</code>（サブドメインがあれば <code className="font-mono">_agentguard.サブドメイン</code>）と入力します。
            反映まで数分〜数時間かかることがあります。
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-line p-3">
        <p className="text-xs font-bold text-ink">ステップ3：「確認する」を押す</p>
        <p className="mt-1 text-xs text-muted">AgentGuard が合言葉を読みに行き、一致すれば登録が完了して「取り込みキー」が表示されます。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy !== null} onClick={verify}>{busy === "verify" ? "確認中…" : "確認する"}</Button>
        <Button variant="ghost" disabled={busy !== null} onClick={remove}><Trash2 size={14} /> やめる</Button>
      </div>
      {message && <p className={cx("text-sm", message.ok ? "text-emerald-600" : "text-rose-600")} role="status">{message.text}</p>}
    </div>
  );
}

function VerifiedPanel({ site, keyHint, freshKey }: { site: ProtectedSite; keyHint?: string; freshKey: string | null }) {
  const { api, ingestUrl } = useSession();
  const [lang, setLang] = useState<"node" | "python">("node");
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm(`${site.host} の保護をやめますか？取り込みキーは無効になります。`)) return;
    setBusy(true);
    try { await api("/api/site", { body: { action: "remove" } }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={site.url} target="_blank" rel="noreferrer" className="break-all font-mono text-sm text-brand hover:underline">{site.url}</a>
        <Badge tone="safe">保護中</Badge>
      </div>

      {freshKey ? (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3">
          <p className="text-xs font-bold text-amber-700">取り込みキー（この画面を離れると二度と表示されません）</p>
          <p className="mt-1 text-xs text-muted">サイトの環境変数 <code className="font-mono">AGENTGUARD_INGEST_KEY</code> に設定してください。</p>
          <div className="mt-2"><CopyField value={freshKey} /></div>
        </div>
      ) : (
        <p className="text-xs text-muted">取り込みキー：<code className="font-mono">ag_…{keyHint}</code>（再発行は「別のサイトに変更」から）</p>
      )}

      <div className="rounded-2xl border border-line">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="text-xs font-bold text-ink">組み込みコード</span>
          <div className="flex-1" />
          {(["node", "python"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)}
                    className={cx("rounded-lg px-2 py-1 text-xs font-semibold", lang === l ? "bg-brand/10 text-brand" : "text-muted hover:bg-slate-100")}>
              {l === "node" ? "Node.js" : "Python"}
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed"><code>{snippet(lang, ingestUrl)}</code></pre>
      </div>
      <p className="text-xs text-muted">
        このコードを自分のサイトに入れると、各リクエストが AgentGuard で検査され、攻撃はこのダッシュボードに表示されます。
        AgentGuard に届かないときはサイトを止めずそのまま通します（フェイルオープン）。
      </p>

      <Button variant="ghost" disabled={busy} onClick={remove}><Trash2 size={14} /> 保護をやめる / 別のサイトに変更</Button>
    </div>
  );
}

export function SiteCard() {
  const tenant = useTenant().data;
  const site = tenant?.site;
  // The ingest key is returned once by verify; held here (SiteCard stays mounted across the
  // pending -> verified transition) and shown until the owner reloads.
  const [freshKey, setFreshKey] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="守るサイト" icon={<Globe size={16} className="text-brand" />}
                  sub="あなたのサイトを登録して守ります（所有確認が必要・1つまで）" />
      <div className="p-5">
        {!site ? (
          <RegisterForm />
        ) : site.status === "pending" ? (
          <VerifyPanel site={site} onVerified={setFreshKey} />
        ) : (
          <VerifiedPanel site={site} keyHint={tenant?.ingestKeyHint} freshKey={freshKey} />
        )}
        <div className="mt-4 flex items-start gap-2 text-xs text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-safe" />
          <span>攻撃シミュレーターは、本物のサイトには送りません。見本の攻撃イベントを AgentGuard に流して、AIチームの動きを確認できます。</span>
        </div>
      </div>
    </Card>
  );
}
