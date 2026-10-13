"use client";

import { Crown, Globe, History, LayoutDashboard, Loader2, LogOut, Settings, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { AttackBackdrop } from "@/components/attack-backdrop";
import { Logo } from "@/components/logo";
import { SecurityBanner } from "@/components/security-banner";
import { Badge, Button, cx } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useOwnerStatus, useTenant } from "@/lib/hooks";
import { setMuted, useMuted } from "@/lib/sound";

function ModeBadge() {
  const tenant = useTenant().data;
  if (!tenant) return null;
  return tenant.aiMode === "byok" ? <Badge tone="safe">あなたのAPIキー</Badge> : <Badge tone="brand">デモモード</Badge>;
}

function Nav() {
  const path = usePathname();
  const owner = useOwnerStatus().status?.isOwner ?? false; // the manager item is shown to the manager only
  const item = (href: string, label: string, icon: ReactNode) => (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold transition sm:px-3",
        path === href ? "bg-brand/10 text-brand" : "text-muted hover:bg-slate-100 hover:text-ink",
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
  return (
    <nav className="flex items-center gap-1">
      {item("/app", "ダッシュボード", <LayoutDashboard size={16} />)}
      {item("/app/site", "守るサイト", <Globe size={16} />)}
      {item("/app/history", "履歴", <History size={16} />)}
      {item("/app/settings", "設定", <Settings size={16} />)}
      {owner && item("/app/admin", "管理", <Crown size={16} />)}
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const muted = useMuted();

  useEffect(() => {
    if (session.status === "signedOut") router.replace("/");
  }, [session.status, router]);

  if (session.status === "error") {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-display text-lg font-bold">読み込めませんでした</p>
          <p className="mt-1 text-sm text-muted">{session.message}</p>
          {/* After "sign out everywhere" this device's session is refused for good: reloading cannot
              help, so offer a way back to the login screen. */}
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => window.location.reload()}>再読み込み</Button>
            <Button variant="ghost" onClick={() => void signOut().then(() => router.replace("/"))}>ログインし直す</Button>
          </div>
        </div>
      </div>
    );
  }
  if (session.status !== "signedIn") {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AttackBackdrop />
      <header className="sticky top-0 z-20 border-b border-line bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-1.5 px-4 py-3 sm:gap-3 sm:px-6">
          <Link href="/app" aria-label="AgentGuard ダッシュボード"><Logo compact /></Link>
          <div className="ml-2 hidden md:block"><ModeBadge /></div>
          <div className="flex-1" />
          <Nav />
          <button
            onClick={() => setMuted(!muted)}
            className="rounded-xl p-2 text-muted hover:bg-slate-100 hover:text-ink"
            aria-label={muted ? "通知音をオンにする" : "通知音をオフにする"}
            title={muted ? "通知音：オフ" : "通知音：オン"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button onClick={() => signOut()} className="rounded-xl p-2 text-muted hover:bg-slate-100 hover:text-ink" aria-label="ログアウト" title="ログアウト">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <SecurityBanner />
        {children}
      </main>
    </div>
  );
}
