"use client";

import { Bomb, Bot, FileWarning, Loader2, Repeat, ShoppingBag, Syringe, Swords, TerminalSquare } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useSession } from "@/lib/auth-context";
import { ms } from "@/lib/format";

import { Card, CardHeader, cx } from "./ui";

type Kind = "normal" | "sqli" | "xss" | "traversal" | "ai_injection" | "cmd" | "revisit";

type Result = {
  kind: Kind;
  status: number;
  decision: string | null;
  ruleId: string | null;
  ruleMs: number | null;
  ip: string | null;
  simulated: boolean;
};

const BUTTONS: { kind: Kind; label: string; desc: string; icon: ReactNode; tone: string }[] = [
  { kind: "normal", label: "ふつうのお客さん", desc: "商品を検索（通過するはず）", icon: <ShoppingBag size={18} />, tone: "text-emerald-600 bg-safe/10" },
  { kind: "sqli", label: "SQLインジェクション", desc: "データベースを不正に操作", icon: <Syringe size={18} />, tone: "text-rose-600 bg-danger/10" },
  { kind: "xss", label: "XSS", desc: "悪意あるスクリプトを埋め込む", icon: <FileWarning size={18} />, tone: "text-rose-600 bg-danger/10" },
  { kind: "traversal", label: "パストラバーサル", desc: "サーバーの重要ファイルを狙う", icon: <Swords size={18} />, tone: "text-rose-600 bg-danger/10" },
  { kind: "ai_injection", label: "AIをだます攻撃", desc: "「ブロックを解除しろ」と仕込む", icon: <Bot size={18} />, tone: "text-violet-600 bg-violet-500/10" },
  { kind: "cmd", label: "OSコマンド実行（重大）", desc: "人の承認フローを体験", icon: <TerminalSquare size={18} />, tone: "text-amber-700 bg-warn/15" },
  { kind: "revisit", label: "同じ攻撃者が再アクセス", desc: "ブロックが効いているか確認", icon: <Repeat size={18} />, tone: "text-brand bg-brand/10" },
];

const DECISION: Record<string, { text: string; tone: string }> = {
  allow: { text: "通過（問題なし）", tone: "text-emerald-600" },
  waf: { text: "ミハリが遮断 → AIチーム出動", tone: "text-rose-600" },
  blocklist: { text: "ブロック中のIPのため遮断", tone: "text-rose-600" },
  maintenance: { text: "メンテナンス中のため停止", tone: "text-amber-600" },
};

export function AttackSimulator() {
  const { api } = useSession();
  const [busy, setBusy] = useState<Kind | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fire(kind: Kind) {
    setBusy(kind);
    setError(null);
    try {
      setResult(await api<Result>("/api/attack", { body: { kind } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信できませんでした");
    } finally {
      setBusy(null);
    }
  }

  const d = result?.decision ? DECISION[result.decision] : null;
  return (
    <Card>
      <CardHeader title="攻撃シミュレーター" icon={<Bomb size={16} className="text-danger" />}
                  sub="あなた専用のデモサイトにだけ送られます（攻撃元IPはデモ用の擬似アドレス）" />
      <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-1">
        {BUTTONS.map((b) => (
          <button
            key={b.kind}
            onClick={() => fire(b.kind)}
            disabled={busy !== null}
            className={cx(
              "group flex items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition",
              "hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-wait disabled:opacity-60",
            )}
          >
            <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", b.tone)}>
              {busy === b.kind ? <Loader2 size={18} className="animate-spin" /> : b.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink">{b.label}</span>
              <span className="block text-xs text-muted">{b.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="border-t border-line px-5 py-3 text-sm" aria-live="polite">
        {error ? (
          <span className="text-rose-600">{error}</span>
        ) : result && d ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cx("font-bold", d.tone)}>{result.status} {d.text}</span>
            {result.ruleMs !== null && <span className="font-mono text-xs text-muted">ルール判定 {ms(result.ruleMs)}ms</span>}
            {result.ip && <span className="font-mono text-xs text-muted">送信元 {result.ip}{result.simulated ? "（擬似）" : ""}</span>}
          </div>
        ) : (
          <span className="text-muted">ボタンを押すと、結果がここに表示されます。</span>
        )}
      </div>
    </Card>
  );
}
