"use client";

import { Globe, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks";
import type { ProtectedSite } from "@/lib/types";

import { CopyField } from "./copy-field";
import { VerifyWizard } from "./site-verify";
import { Badge, Button, Card, CardHeader, cx } from "./ui";

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

function VerifiedPanel({ site, keyHint, freshKey }: { site: ProtectedSite; keyHint?: string; freshKey: string | null }) {
  const { api, ingestUrl } = useSession();
  const [lang, setLang] = useState<"node" | "python">("node");
  const [busy, setBusy] = useState(false);
  const keyBox = useRef<HTMLDivElement>(null);
  // Right after verification, take the owner straight to the one-time key (the next thing to do).
  useEffect(() => {
    if (freshKey) keyBox.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [freshKey]);

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
        <div ref={keyBox} className="rounded-2xl border border-warn/40 bg-warn/10 p-3">
          <p className="text-xs font-bold text-amber-700">所有を確認しました。次は取り込みキーを設定します（この画面を離れると二度と表示されません）</p>
          <p className="mt-1 text-xs text-muted">サイトの環境変数 <code className="font-mono">AGENTGUARD_INGEST_KEY</code> に設定し、下の組み込みコードをサイトに入れてください。</p>
          <div className="mt-2"><CopyField value={freshKey} label="取り込みキー" /></div>
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
          <VerifyWizard site={site} onVerified={setFreshKey} />
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
