"use client";

import { Globe, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks";
import type { ProtectedSite } from "@/lib/types";

import { ConnectionStatus } from "./connection-status";
import { IntegrationCode, KeyBox } from "./site-connect";
import type { ServerFramework } from "./site-snippets";
import { isGitHubPages, VerifyWizard } from "./site-verify";
import { Badge, Button, Card, CardHeader } from "./ui";

function RegisterForm({ onRegistered }: { onRegistered: (key: string | null) => void }) {
  const { api } = useSession();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ connectionKey: string | null }>("/api/site", { body: { action: "register", url } });
      onRegistered(r.connectionKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">守りたいご自分のサイトのURLを登録してください（1アカウント1つまで）。登録すると、サイトにつなぐための「接続キー」が発行されます。</p>
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

function VerifiedPanel({ site, keyHint, connectionKey, verifiedMode, onRotate }: {
  site: ProtectedSite; keyHint?: string; connectionKey: string | null;
  verifiedMode: "connected" | "private" | "public" | "dns" | null; onRotate: () => Promise<void>;
}) {
  const { api } = useSession();
  const [framework, setFramework] = useState<ServerFramework>("next");
  const [busy, setBusy] = useState(false);
  const staticSite = isGitHubPages(site.host);

  async function remove() {
    if (!window.confirm(`${site.host} の保護をやめますか？接続キーは無効になります。`)) return;
    setBusy(true);
    try { await api("/api/site", { body: { action: "remove" } }); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <a href={site.url} target="_blank" rel="noreferrer" className="break-all font-mono text-sm text-brand hover:underline">{site.url}</a>
        <Badge tone="safe">所有確認済み</Badge>
      </div>
      {verifiedMode === "public" && (
        <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs text-amber-800">
          <b>合言葉のファイルは今も外から見える状態です。</b>確認は済んだので、もう消してください（悪用はできませんが、AgentGuard を使っていることが分かってしまいます）。
        </p>
      )}
      {staticSite ? (
        <p className="rounded-xl bg-warn/10 px-3 py-2 text-xs text-amber-800">
          GitHub Pages は、サーバーで動くプログラムを置けないため、組み込みコードを動かせません。
          所有確認は済んでいますが、攻撃を検査して守るには、Node.js や Python などサーバーで動くサイトが必要です。
        </p>
      ) : (
        <>
          <ConnectionStatus />
          <KeyBox connectionKey={connectionKey} keyHint={keyHint} onRotate={onRotate} />
          <div>
            <p className="mb-1 text-xs font-bold text-ink">組み込みコード（サイトに入れたままにします）</p>
            <IntegrationCode framework={framework} onFramework={setFramework} basePath={site.path ?? ""} />
          </div>
          <p className="text-xs text-muted">
            各アクセスが AgentGuard で検査され、攻撃はこのダッシュボードに表示されます。AgentGuard に届かないときはサイトを止めずに通します。
          </p>
        </>
      )}
      <Button variant="ghost" disabled={busy} onClick={remove}><Trash2 size={14} /> 保護をやめる / 別のサイトに変更</Button>
    </div>
  );
}




export function SiteCard() {
  const { api } = useSession();
  const tenant = useTenant().data;
  const site = tenant?.site;
  // The connection key is returned once (on registration, re-issue, or first verification of an
  // older registration). SiteCard stays mounted across pending -> verified, so it is kept here.
  const [connectionKey, setConnectionKey] = useState<string | null>(null);
  const [verifiedMode, setVerifiedMode] = useState<"connected" | "private" | "public" | "dns" | null>(null);

  async function rotate() {
    const r = await api<{ connectionKey: string }>("/api/site", { body: { action: "rotate" } });
    setConnectionKey(r.connectionKey);
  }

  return (
    <Card>
      <CardHeader title="守るサイト" icon={<Globe size={16} className="text-brand" />}
                  sub="あなたのサイトを登録して守ります（所有確認が必要・1つまで）" />
      <div className="p-5">
        {!site ? (
          <RegisterForm onRegistered={setConnectionKey} />
        ) : site.status === "pending" ? (
          <VerifyWizard site={site} connectionKey={connectionKey} keyHint={tenant?.ingestKeyHint} onRotate={rotate}
                        onVerified={(key, mode) => { if (key) setConnectionKey(key); setVerifiedMode(mode); }} />
        ) : (
          <VerifiedPanel site={site} keyHint={tenant?.ingestKeyHint} connectionKey={connectionKey}
                         verifiedMode={verifiedMode} onRotate={rotate} />
        )}
        <div className="mt-4 flex items-start gap-2 text-xs text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-safe" />
          <span>攻撃シミュレーターは、本物のサイトには送りません。見本の攻撃イベントを AgentGuard に流して、AIチームの動きを確認できます。</span>
        </div>
      </div>
    </Card>
  );
}
