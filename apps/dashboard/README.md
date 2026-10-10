# AgentGuard dashboard

Next.js 16 (App Router, Cache Components) + Tailwind CSS v4 + Firebase.

- Live view of the AI team (Firestore `onSnapshot`), attack simulator, approvals, blocklist, settings
- Server routes (`src/app/api/*`) verify the Firebase ID token and act only on the caller's tenant
- BYOK: `POST /api/keys` validates the Gemini key, encrypts it with Cloud KMS (encrypt-only identity) and
  stores ciphertext; the key is never returned or logged

## Local development

```bash
cp .env.example .env.local   # fill in the Firebase web config and server settings
npm ci
npm run dev
```

Server routes use Application Default Credentials. On Cloud Run they run as `sa-dashboard`.

## Deploy

```bash
bash ../../infra/deploy.sh dashboard
```
