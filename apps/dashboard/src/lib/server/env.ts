// Server-only runtime configuration. Read lazily so values come from the Cloud Run
// environment at request time, never from the build machine.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  projectId: () => required("PROJECT_ID"),
  targetUrl: () => required("TARGET_URL").replace(/\/$/, ""),
  kmsKey: () => required("KMS_KEY"),
  /** The account that receives AgentGuard's own incidents (empty: self-protection is not set up). */
  selfTenantId: () => process.env.SELF_TENANT_ID ?? "",
  firebase: () => ({
    apiKey: required("FIREBASE_API_KEY"),
    authDomain: required("FIREBASE_AUTH_DOMAIN"),
    projectId: required("FIREBASE_PROJECT_ID"),
    appId: required("FIREBASE_APP_ID"),
    messagingSenderId: required("FIREBASE_MESSAGING_SENDER_ID"),
  }),
};
