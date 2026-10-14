"use client";

import { KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/lib/auth-context";

import { CopyField } from "./copy-field";
import { INSTALL, integrationSnippet, KEY_PLACES, type ServerFramework } from "./site-snippets";
import { Button, cx } from "./ui";

/**
 * The connection key (AGENTGUARD_KEY). Shown right after it is issued; afterwards only its last
 * four characters are known, and a lost key is replaced with "作り直す".
 */
export function KeyBox({ connectionKey, keyHint, onRotate }: {
  connectionKey: string | null; keyHint?: string; onRotate: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (keyHint && !window.confirm("いまの接続キーは使えなくなります。新しいキーを作りますか？（サイトに置いた .agentguard フォルダや、秘密の設定に入れたキーも、新しいものに入れかえる必要があります）")) return;
    setBusy(true);
    setError(null);
    try { await onRotate(); } catch (e) { setError(e instanceof Error ? e.message : "作り直せませんでした"); } finally { setBusy(false); }
  }

  if (connectionKey) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3">
        <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
          <KeyRound size={14} /> 接続キー（この画面を閉じると、もう見られません。いまコピーしてください）
        </p>
        <p className="mt-1 text-xs text-muted">ダウンロードするフォルダには、このキーが最初から保存されます。Vercel など GitHub から公開するときは、サイトの秘密の設定（環境変数）にも <code className="font-mono">AGENTGUARD_KEY</code> という名前で入れます。</p>
        <div className="mt-2"><CopyField value={connectionKey} label="接続キー" /></div>
        <p className="mt-2 text-[11px] text-muted">
          <b className="text-ink">接続キーは、人に見せてはいけない合言葉です。</b>サイトのファイルの中にそのまま書いたり、GitHub に上げたりしないでください。
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line p-3 text-xs text-muted">
      <KeyRound size={14} />
      {keyHint ? <>接続キー：<code className="font-mono">agk_…{keyHint}</code>（キーの全部が見られるのは、作ったときの1回だけです）</> : <>接続キーがまだありません。</>}
      <div className="flex-1" />
      <Button size="sm" variant="ghost" disabled={busy} onClick={rotate}>
        <RefreshCw size={13} /> {keyHint ? "キーをなくした・作り直す" : "接続キーを作る"}
      </Button>
      {error && <p className="w-full text-rose-600">{error}</p>}
    </div>
  );
}

const FRAMEWORKS: { id: ServerFramework; label: string }[] = [
  { id: "next", label: "Next.js（Vercel など）" },
  { id: "express", label: "Express（Node.js）" },
  { id: "fastapi", label: "FastAPI（Python）" },
];

/** One block of code that answers the ownership check and protects the site. */
export function IntegrationCode({ framework, onFramework, basePath }: {
  framework: ServerFramework; onFramework: (f: ServerFramework) => void; basePath: string;
}) {
  const { ingestUrl } = useSession();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {FRAMEWORKS.map((f) => (
          <button key={f.id} type="button" onClick={() => onFramework(f.id)}
                  className={cx("rounded-full border px-3 py-1 text-xs font-semibold",
                    framework === f.id ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-muted hover:border-brand/40")}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        ファイルの名前：<b className="font-mono text-ink">{INSTALL[framework].fileName}</b>（{INSTALL[framework].place}に置きます）
        {INSTALL[framework].addLines && <>。{INSTALL[framework].addWhere}に <code className="font-mono">{INSTALL[framework].addLines.replace("\n", " / ")}</code> を書き足します</>}
      </p>
      <CopyField value={integrationSnippet(framework, ingestUrl, basePath)} label="つなぐファイルの中身" />
      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-semibold text-brand">接続キー（AGENTGUARD_KEY）を、自分で入れるとき</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {KEY_PLACES.map((p) => <li key={p.name}><b className="text-ink">{p.name}</b>：{p.how}</li>)}
        </ul>
      </details>
    </div>
  );
}
