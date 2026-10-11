"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cx } from "./ui";

/** A read-only value with a copy button (tokens, keys, DNS values, code). */
export function CopyField({ value, mono = true, label }: { value: string; mono?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className={cx("min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-xl border border-line bg-slate-50 px-3 py-2 text-xs", mono && "font-mono")}>
        {value}
      </code>
      <button
        type="button"
        aria-label={label ? `${label}をコピー` : "コピー"}
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line bg-white px-3 text-xs font-semibold text-brand hover:bg-brand/5"
      >
        {copied ? <><Check size={14} /> コピー済み</> : <><Copy size={14} /> コピー</>}
      </button>
    </div>
  );
}
