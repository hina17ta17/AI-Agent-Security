"use client";

import { type FirebaseApp, type FirebaseOptions, getApps, initializeApp } from "firebase/app";
import { type Auth, getAuth } from "firebase/auth";
import { type Firestore, getFirestore } from "firebase/firestore";

import { calibrate } from "./clock";

export type FirebaseClients = { app: FirebaseApp; auth: Auth; db: Firestore };

let clients: FirebaseClients | null = null;
let loading: Promise<FirebaseClients> | null = null;

/** The web config is fetched at runtime from /api/config (it lives in Cloud Run's environment). */
export function loadFirebase(): Promise<FirebaseClients> {
  if (clients) return Promise.resolve(clients);
  loading ??= (async () => {
    const t0 = Date.now();
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) throw new Error("設定を読み込めませんでした");
    const { firebase, now } = (await res.json()) as { firebase: FirebaseOptions; now: number };
    calibrate(now, t0, Date.now());
    const app = getApps()[0] ?? initializeApp(firebase);
    clients = { app, auth: getAuth(app), db: getFirestore(app) };
    return clients;
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
