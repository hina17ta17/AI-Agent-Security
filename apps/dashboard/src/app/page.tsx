"use client";

import { Bot, KeyRound, Loader2, Mail, Timer, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Logo } from "@/components/logo";
import { type Member, Mascot, TEAM } from "@/components/mascots";
import { SelfGuard } from "@/components/self-guard";
import { Button, cx } from "@/components/ui";
import { authErrorMessage, useAuth } from "@/lib/auth-context";

const MEMBERS: Member[] = ["mihari", "bannin", "shirabe", "mamoru", "tsutae"];

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <Zap size={18} />, title: "0.1ミリ秒で初動遮断", text: "軽量WAFの「ミハリ」が、怪しいリクエストをその場で止めます。" },
  { icon: <Timer size={18} />, title: "数秒でAIが対処", text: "攻撃のときだけAIが出動。解析・ブロック・報告まで自動で行います。" },
  { icon: <Bot size={18} />, title: "AIをだます攻撃にも強い", text: "攻撃文に仕込まれた命令は、Model Armor が見抜いてAIに渡しません。" },
  { icon: <KeyRound size={18} />, title: "APIキーは誰にも見えない", text: "あなたのキーは暗号化して保管。開発者も中身を見ることはできません。" },
];

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z" />
    </svg>
  );
}

function LoginCard() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() => (mode === "login" ? signInWithEmail(email, password) : signUpWithEmail(email, password)));
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-line bg-white/90 p-6 shadow-lift backdrop-blur">
      <h2 className="font-display text-lg font-bold">はじめる</h2>
      <p className="mt-1 text-xs text-muted">ログインすると、あなた専用のダッシュボードが用意されます。</p>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => run(signInWithGoogle)} disabled={busy}>
        <GoogleMark /> Google でログイン
      </Button>
      <div className="my-4 flex items-center gap-3 text-[11px] text-muted">
        <span className="h-px flex-1 bg-line" /> またはメールアドレスで <span className="h-px flex-1 bg-line" />
      </div>
      <form onSubmit={submit} className="space-y-2">
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メールアドレス"
               className="h-11 w-full rounded-xl border border-line px-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        <input type="password" required minLength={6} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password}
               onChange={(e) => setPassword(e.target.value)} placeholder="パスワード（6文字以上）"
               className="h-11 w-full rounded-xl border border-line px-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
          {mode === "login" ? "メールでログイン" : "メールで新規登録"}
        </Button>
      </form>
      {error && <p className="mt-3 text-xs text-rose-600" role="alert">{error}</p>}
      <button className="mt-3 text-xs font-semibold text-brand hover:underline" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "はじめての方は新規登録" : "登録済みの方はログイン"}
      </button>
    </div>
  );
}

export default function Home() {
  const { session } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (session.status === "signedIn") router.replace("/app");
  }, [session.status, router]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="grid-dots absolute inset-0 opacity-70" />
      <div className="absolute -left-40 -top-40 size-130 rounded-full bg-brand/15 blur-3xl" />
      <div className="absolute -right-40 top-40 size-120 rounded-full bg-brand2/15 blur-3xl" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6 lg:py-16">
        <header><Logo size="lg" /></header>

        <section className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-bold text-brand shadow-soft">
              <span className="size-2 rounded-full bg-safe" /> セキュリティ担当がいなくても大丈夫
            </p>
            <h1 className="mt-4 font-display text-4xl leading-tight font-bold sm:text-5xl">
              小さなお店のサイトを、<br />
              <span className="text-gradient">AIのチーム</span>が守ります。
            </h1>
            <p className="mt-4 max-w-xl text-muted">
              ふだんは軽い見張り番が静かに見守り、攻撃が来た瞬間だけAIが出動。
              解析・防御・報告までを自律的に行い、その様子をリアルタイムでお見せします。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {MEMBERS.map((m, i) => (
                <motion.div key={m} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.08 * i }}
                            className="flex w-26 flex-col items-center rounded-2xl border border-line bg-white/90 px-2 py-3 text-center shadow-soft">
                  <Mascot member={m} mood={i === 2 ? "active" : "happy"} size={52} />
                  <span className="mt-1 font-display text-sm font-bold">{TEAM[m].name}</span>
                  <span className="text-[10px] leading-tight text-muted">{TEAM[m].role}</span>
                </motion.div>
              ))}
            </div>
          </div>
          <div className={cx("flex justify-center lg:justify-end")}>
            {session.status === "loading" || session.status === "signedIn" ? (
              <div className="grid h-72 w-full max-w-sm place-items-center rounded-card border border-line bg-white/80"><Loader2 className="animate-spin text-muted" /></div>
            ) : (
              <LoginCard />
            )}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-card border border-line bg-white/90 p-5 shadow-soft">
              <span className="brand-gradient grid size-9 place-items-center rounded-xl text-white">{f.icon}</span>
              <h3 className="mt-3 font-display font-bold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </section>

        <SelfGuard />
      </div>
    </main>
  );
}
