"use client";

import { CheckCircle2, ShieldEllipsis, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";

import { useSession } from "@/lib/auth-context";
import type { Approval } from "@/lib/types";

import { Mascot } from "./mascots";
import { Button } from "./ui";

/** Human-in-the-loop: the AI asked for something big; nothing happens until a person decides. */
export function ApprovalBanner({ approvals }: { approvals: Approval[] }) {
  const { api } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/approvals/${id}`, { body: { decision } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "処理できませんでした");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AnimatePresence>
      {approvals.map((a) => (
        <motion.div
          key={a.id}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden rounded-card border-2 border-warn/60 bg-linear-to-r from-amber-50 to-white shadow-soft"
        >
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <Mascot member="mamoru" mood="alert" size={56} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
                <ShieldEllipsis size={14} /> マモルからの承認依頼（あなたが決めるまで実行されません）
              </p>
              <p className="mt-1 font-display text-lg font-bold">サイトを {a.minutes} 分間メンテナンスモードにしてもよいですか？</p>
              <p className="mt-0.5 text-sm text-muted">{a.reasonJa}</p>
              <Link href={`/app/incidents/${a.incidentId}`} className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">
                インシデントの詳細を見る →
              </Link>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="danger" onClick={() => decide(a.id, "approve")} disabled={busy === a.id}>
                <CheckCircle2 size={16} /> 承認する
              </Button>
              <Button variant="ghost" onClick={() => decide(a.id, "reject")} disabled={busy === a.id}>
                <XCircle size={16} /> 却下
              </Button>
            </div>
          </div>
          {error && <p className="px-5 pb-4 text-xs text-rose-600">{error}</p>}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
