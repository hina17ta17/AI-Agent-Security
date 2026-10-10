import { applicationDefault, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

import { env } from "./env";

// On Cloud Run this authenticates as sa-dashboard (Firestore + KMS encrypt only).
function app(): App {
  return getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: env.projectId() });
}

export const adminAuth = () => getAuth(app());
export const db = () => getFirestore(app());
