"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { loadFirebase } from "./firebase-client";

type Session =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "signedOut" }
  | { status: "signedIn"; user: User; db: Firestore; ingestUrl: string };

type AuthApi = {
  session: Session;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  api: <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;
};

const AuthContext = createContext<AuthApi | null>(null);

const AUTH_ERRORS: Record<string, string> = {
  "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
  "auth/invalid-email": "メールアドレスの形式が正しくありません。",
  "auth/user-not-found": "メールアドレスまたはパスワードが違います。",
  "auth/wrong-password": "メールアドレスまたはパスワードが違います。",
  "auth/email-already-in-use": "このメールアドレスはすでに登録されています。ログインしてください。",
  "auth/weak-password": "パスワードは6文字以上にしてください。",
  "auth/popup-closed-by-user": "ログインがキャンセルされました。",
  "auth/cancelled-popup-request": "ログインがキャンセルされました。",
  "auth/popup-blocked": "ポップアップがブロックされました。ブラウザの設定を確認してください。",
  "auth/too-many-requests": "試行回数が多すぎます。しばらくしてからお試しください。",
  "auth/unauthorized-domain": "このURLからのログインが許可されていません（Firebase の承認済みドメインへの追加が必要です）。",
  "auth/network-request-failed": "ネットワークに接続できませんでした。",
};

export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code && AUTH_ERRORS[code]) return AUTH_ERRORS[code];
  return error instanceof Error ? error.message : "エラーが起きました。";
}

async function callApi<T>(user: User, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? "エラーが起きました。");
  return data as T;
}

/** Record one real sign-in (for the account's login history). Never blocks the login itself. */
async function recordLogin(user: User, method: "google" | "password" | "signup"): Promise<void> {
  try {
    await callApi(user, "/api/session", { body: { method } });
  } catch {
    // The login succeeded; only the history entry is missing.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: "loading" });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    loadFirebase()
      .then(({ auth, db }) => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (!user) return setSession({ status: "signedOut" });
          try {
            const { ingestUrl } = await callApi<{ ingestUrl: string }>(user, "/api/tenant");
            setSession({ status: "signedIn", user, db, ingestUrl });
          } catch (error) {
            setSession({ status: "error", message: authErrorMessage(error) });
          }
        });
      })
      .catch((error) => setSession({ status: "error", message: authErrorMessage(error) }));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { auth } = await loadFirebase();
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
    await recordLogin(user, "google");
  }, []);
  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { auth } = await loadFirebase();
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await recordLogin(user, "password");
  }, []);
  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const { auth } = await loadFirebase();
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await recordLogin(user, "signup");
  }, []);
  const signOut = useCallback(async () => {
    const { auth } = await loadFirebase();
    await fbSignOut(auth);
  }, []);
  const api = useCallback(
    async <T,>(path: string, init?: { method?: string; body?: unknown }) => {
      if (session.status !== "signedIn") throw new Error("ログインが必要です");
      return callApi<T>(session.user, path, init);
    },
    [session],
  );

  const value = useMemo<AuthApi>(
    () => ({ session, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, api }),
    [session, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, api],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** For pages under /app, which render only once signed in. */
export function useSession() {
  const { session, api } = useAuth();
  if (session.status !== "signedIn") throw new Error("useSession requires a signed-in session");
  return { ...session, uid: session.user.uid, api };
}
