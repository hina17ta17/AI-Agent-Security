"use client";

import { Cpu, ExternalLink, Globe, KeyRound, Lock, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Badge, Button, Card, CardHeader, cx } from "@/components/ui";
import { useSession } from "@/lib/auth-context";
import { remaining, toDate } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";

function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "エラーが起きました" });
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, run };
}

function Note({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p className={cx("mt-3 text-sm", m.ok ? "text-emerald-600" : "text-rose-600")} role="status">{m.text}</p>;
}

function ApiKeyCard() {
  const { api } = useSession();
  const tenant = useTenant().data;
  const [apiKey, setApiKey] = useState("");
  const save = useAction();
  const remove = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = apiKey;
    setApiKey(""); // clear the field immediately; the key is never kept in the page
    await save.run(() => api("/api/keys", { body: { apiKey: value } }), "APIキーを検証し、暗号化して保存しました。");
  }

  const status = tenant?.keyStatus ?? "none";
  return (
    <Card>
      <CardHeader title="Gemini APIキー" icon={<KeyRound size={16} className="text-brand" />} sub="あなたのキーで AIチームを動かせます（入れない場合はデモモード）" />
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-slate-50 px-4 py-3">
          <Lock size={16} className="text-muted" />
          {status === "none" ? (
            <span className="text-sm text-muted">未登録</span>
          ) : (
            <>
              <span className="font-mono text-sm tracking-widest">●●●●●●●●{tenant?.keyHint}</span>
              {status === "valid" ? <Badge tone="safe">検証済み</Badge> : <Badge tone="danger">無効（更新してください）</Badge>}
            </>
          )}
          <div className="flex-1" />
          {status !== "none" && (
            <Button variant="ghost" size="sm" disabled={remove.busy}
                    onClick={() => window.confirm("登録したキーを削除して、デモモードに戻しますか？") &&
                      remove.run(() => api("/api/keys", { method: "DELETE" }), "キーを削除しました。デモモードに戻りました。")}>
              <Trash2 size={14} /> 削除
            </Button>
          )}
        </div>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="apikey">Gemini APIキー</label>
          <input
            id="apikey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={status === "none" ? "APIキーを貼り付け" : "新しいキーに置き換える"}
            className="h-11 flex-1 rounded-xl border border-line bg-white px-4 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <Button type="submit" disabled={save.busy || apiKey.length < 10}>{save.busy ? "確認中…" : status === "none" ? "登録する" : "置き換える"}</Button>
        </form>
        <Note m={save.message ?? remove.message} />

        <ul className="mt-5 space-y-2 text-xs leading-relaxed text-muted">
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-safe" />
            <span>キーは登録時に Gemini で使えるか確認したあと、<b className="text-ink">Cloud KMS で暗号化</b>して保存します。画面に表示されるのは末尾4文字だけで、<b className="text-ink">開発者を含め、誰も中身を見られません</b>。</span></li>
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-safe" />
            <span>暗号化はダッシュボードにしかできず、復号はAIチームのサーバーが攻撃に対応するときだけ、そのアカウント用に行います。</span></li>
          <li className="flex gap-2"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-warn" />
            <span>AgentGuard 専用のキーを作り、Gemini API だけに使えるよう制限することをおすすめします。無料枠のキーでは、送信内容が Google のサービス改善に使われる場合があります。</span></li>
        </ul>
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
          Google AI Studio でキーを作る <ExternalLink size={12} />
        </a>
      </div>
    </Card>
  );
}

function ModeCard() {
  const { api } = useSession();
  const tenant = useTenant().data;
  const act = useAction();
  const options = [
    { mode: "demo" as const, title: "デモモード", desc: "AgentGuard の Gemini を使います（1日10回まで）。審査やお試し向け。" },
    { mode: "byok" as const, title: "あなたのAPIキー", desc: "登録したキーで動きます（1日200回まで）。料金はあなたの Google アカウントに請求されます。" },
  ];
  return (
    <Card>
      <CardHeader title="AIの実行モード" icon={<Cpu size={16} className="text-brand" />} />
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {options.map((o) => {
          const selected = tenant?.aiMode === o.mode;
          const disabled = o.mode === "byok" && tenant?.keyStatus !== "valid";
          return (
            <button key={o.mode} disabled={disabled || act.busy || selected}
                    onClick={() => act.run(() => api("/api/mode", { body: { mode: o.mode } }), "モードを切り替えました。")}
                    className={cx("rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed",
                      selected ? "border-brand bg-brand/5 ring-2 ring-brand/20" : "border-line bg-white hover:border-brand/40",
                      disabled && "opacity-50")}>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold">{o.title}</span>
                {selected && <Badge tone="brand">使用中</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted">{disabled ? "先に APIキーを登録してください。" : o.desc}</p>
            </button>
          );
        })}
      </div>
      <div className="px-5 pb-5"><Note m={act.message} /></div>
    </Card>
  );
}

function AllowlistCard() {
  const tenant = useTenant().data;
  const saved = (tenant?.settings?.allowlist ?? []).join("\n");
  // Re-mount the editor when the saved list changes, so it starts from the stored value.
  return <AllowlistEditor key={saved} initial={saved} />;
}

function AllowlistEditor({ initial }: { initial: string }) {
  const { api } = useSession();
  const [text, setText] = useState(initial);
  const act = useAction();
  return (
    <Card>
      <CardHeader title="許可リスト" icon={<Globe size={16} className="text-brand" />} sub="ここに入れたIP・範囲は、AIチームが絶対にブロックしません" />
      <div className="p-5">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} spellCheck={false}
                  placeholder={"例）\n203.0.113.0/24\n2001:db8::/32"}
                  className="w-full rounded-xl border border-line bg-white p-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        <Button className="mt-2" disabled={act.busy}
                onClick={() => act.run(() => api("/api/settings", { body: { allowlist: text.split(/\s+/).filter(Boolean) } }), "許可リストを保存しました。")}>
          保存する
        </Button>
        <Note m={act.message} />
      </div>
    </Card>
  );
}

function SiteCard() {
  const { api, siteUrl } = useSession();
  const tenant = useTenant().data;
  const now = useNow(1000);
  const act = useAction();
  const until = toDate(tenant?.maintenanceUntil);
  const inMaintenance = tenant?.siteMode === "maintenance" && (!until || until.getTime() > now);
  return (
    <Card>
      <CardHeader title="守っているデモサイト" icon={<Wrench size={16} className="text-brand" />} sub="あなた専用の架空のお店「ひだまり雑貨店」" />
      <div className="p-5">
        <a href={siteUrl} target="_blank" rel="noreferrer" className="break-all font-mono text-sm text-brand hover:underline">{siteUrl}</a>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {inMaintenance ? <Badge tone="warn">メンテナンス中（{remaining(until, now)}）</Badge> : <Badge tone="safe">公開中</Badge>}
          {inMaintenance && (
            <Button variant="ghost" size="sm" disabled={act.busy}
                    onClick={() => act.run(() => api("/api/site", { body: { action: "restore" } }), "メンテナンスを解除しました。")}>
              メンテナンスを解除する
            </Button>
          )}
        </div>
        <Note m={act.message} />
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-display text-2xl font-bold">設定</h1>
      <ApiKeyCard />
      <ModeCard />
      <AllowlistCard />
      <SiteCard />
    </div>
  );
}
