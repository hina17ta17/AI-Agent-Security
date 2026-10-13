#!/usr/bin/env bash
# deploy.sh - build from source and deploy one AgentGuard service to Cloud Run.
#
#   bash infra/deploy.sh target | agent | dashboard
#
# Each service runs as its own least-privilege service account; builds run as sa-build.
set -euo pipefail

GCLOUD="${GCLOUD:-gcloud}"
if ! command -v "$GCLOUD" >/dev/null 2>&1; then
  GCLOUD="/c/Users/${USERNAME:-$USER}/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud"
fi
g() { "$GCLOUD" --verbosity=error --quiet "$@"; }

PROJECT_ID="${PROJECT_ID:-$(g config get-value project)}"
REGION="${REGION:-asia-northeast1}"
NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# AgentGuard protects itself (dashboard -> /ingest); the receiving tenant is fixed here.
SELF_TENANT_ID="${SELF_TENANT_ID:-$(sed -n 's/^SELF_TENANT_ID=//p' "$ROOT/infra/self-tenant.env" 2>/dev/null | tr -d '\r')}"
url() { echo "https://$1-$NUMBER.$REGION.run.app"; }
sa() { echo "$1@$PROJECT_ID.iam.gserviceaccount.com"; }

common=(--region "$REGION" --project "$PROJECT_ID"
        --build-service-account "projects/$PROJECT_ID/serviceAccounts/$(sa sa-build)")

case "${1:-}" in
  target)
    g run deploy target --source "$ROOT/services/target" "${common[@]}" \
      --service-account "$(sa sa-target)" --allow-unauthenticated \
      --set-env-vars "PROJECT_ID=$PROJECT_ID,EVENTS_TOPIC=security-events,SIM_AUDIENCE=$(url target),SELF_TENANT_ID=$SELF_TENANT_ID" \
      --cpu 1 --memory 512Mi --min-instances "${TARGET_MIN_INSTANCES:-1}" --max-instances 10 --concurrency 80 --timeout 30
    ;;
  agent)
    # Private: only the Pub/Sub push identity can invoke it (see setup-cloud.sh push).
    # Concurrency 40: a burst of attacks lands on the warm instance (it mostly waits on I/O) instead of
    # waiting for cold starts; per tenant at most MAX_CONCURRENT_AI_PER_TENANT of them run the AI team.
    g run deploy agent --source "$ROOT/services/agent" "${common[@]}" \
      --service-account "$(sa sa-agent)" --no-allow-unauthenticated \
      --set-env-vars "PROJECT_ID=$PROJECT_ID,REGION=$REGION,ENABLE_CLOUD_TRACE=true,ARMOR_LOCATION=us,DEMO_DAILY_LIMIT_GLOBAL=${DEMO_DAILY_LIMIT_GLOBAL:-300},MAX_CONCURRENT_AI_PER_TENANT=${MAX_CONCURRENT_AI_PER_TENANT:-3},SELF_TENANT_ID=$SELF_TENANT_ID" \
      --cpu 1 --memory 1Gi --cpu-boost --min-instances "${AGENT_MIN_INSTANCES:-1}" --max-instances 10 \
      --concurrency 40 --timeout 180
    ;;
  dashboard)
    # Firebase web config (public identifiers) comes from apps/dashboard/.env.local, never from the repo.
    env_file="$ROOT/apps/dashboard/.env.local"
    [[ -f "$env_file" ]] || { echo "missing $env_file (copy .env.example)" >&2; exit 1; }
    firebase_vars="$(grep -E '^FIREBASE_[A-Z_]+=' "$env_file" | tr -d '\r' | paste -sd, -)"
    g run deploy dashboard --source "$ROOT/apps/dashboard" "${common[@]}" \
      --service-account "$(sa sa-dashboard)" --allow-unauthenticated \
      --set-env-vars "PROJECT_ID=$PROJECT_ID,TARGET_URL=$(url target),KMS_KEY=projects/$PROJECT_ID/locations/$REGION/keyRings/byok/cryptoKeys/tenant-gemini-key,SELF_PROTECT=${SELF_PROTECT:-on},SELF_TENANT_ID=$SELF_TENANT_ID,$firebase_vars" \
      --cpu 1 --memory 1Gi --min-instances "${DASHBOARD_MIN_INSTANCES:-1}" --max-instances 3 --concurrency 80 --timeout 60
    ;;
  *) echo "usage: $0 target | agent | dashboard" >&2; exit 2 ;;
esac
echo "deployed: $(url "$1")"
