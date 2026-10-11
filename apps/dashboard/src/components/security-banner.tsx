"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";

import { useAuth, useSession } from "@/lib/auth-context";
import { dateTimeJst, toDate } from "@/lib/format";
import { useNow, useTenant } from "@/lib/hooks";

import { Button } from "./ui";

const SHOW_FOR_MS = 7 * 24 * 3600 * 1000;

/**
 * Account protection: after a sign-in from a device this account had not used before, every page
 * shows this warning until the owner confirms it ("me") or signs every session out.
 */
export function SecurityBanner() {
  const { api } = useSession();
  const { signOut } = useAuth();
  const tenant = useTenant().data;
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const at = toDate(tenant?.security?.lastNewDeviceAt);
  const ack = toDate(tenant?.security?.acknowledgedAt);
  if (!at || (ack && ack >= at) || now - at.getTime() > SHOW_FOR_MS) return null;

  async function act(action: "ack" | "revoke") {
    if (action === "revoke" &&
        !window.confirm("すべての端末（この端末も含む）からログアウトします。よろしいですか？")) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/security", { body: { action } });
      if (action === "revoke") await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作できませんでした");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert" className="mb-5 rounded-card border border-warn/40 bg-warn/10 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">いつもと違う端末からログインがありました</p>
          <p className="mt-1 text-sm text-muted">
            {tenant?.security?.lastNewDevice ?? "不明な端末"}（{dateTimeJst(at)}）。
            心当たりがなければ、すべての端末からログアウトして、パスワードを変更してください。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("ack")}>自分のログインです</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => act("revoke")}>
              心当たりがない（すべての端末からログアウト）
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
