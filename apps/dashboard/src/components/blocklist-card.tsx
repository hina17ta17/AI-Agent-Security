"use client";

import { Ban, Unlock } from "lucide-react";
import { useState } from "react";

import { useSession } from "@/lib/auth-context";
import { ACTOR_LABEL, remaining, toDate } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { BlockEntry } from "@/lib/types";

import { Button, Card, CardHeader, Empty } from "./ui";

export function BlocklistCard({ entries }: { entries: BlockEntry[] }) {
  const { api } = useSession();
  const now = useNow(1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = entries.filter((e) => (toDate(e.expiresAt)?.getTime() ?? 0) > now);

  async function unblock(ip: string) {
    if (!window.confirm(`${ip} のブロックを解除しますか？（この操作は監査ログに記録されます）`)) return;
    setBusy(ip);
    setError(null);
    try {
      await api("/api/blocklist", { method: "DELETE", body: { ip } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "解除できませんでした");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader title="ブロック中のIP" icon={<Ban size={16} className="text-danger" />} sub="解除できるのは人だけです（AIは解除できません）" />
      {active.length === 0 ? (
        <Empty>現在ブロック中のIPはありません</Empty>
      ) : (
        <ul className="space-y-2 p-4 sm:p-5">
          {active.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-bold">{e.ip}</div>
                <div className="truncate text-xs text-muted">{e.reasonJa}</div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {ACTOR_LABEL[e.blockedBy] ?? "AgentGuard"} ・ <span className="font-semibold text-rose-600">{remaining(toDate(e.expiresAt), now)}</span>
                  {e.hits ? ` ・ ブロック後のアクセス ${e.hits}回` : ""}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => unblock(e.ip)} disabled={busy === e.ip}>
                <Unlock size={14} /> 解除
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-5 pb-4 text-xs text-rose-600">{error}</p>}
    </Card>
  );
}
