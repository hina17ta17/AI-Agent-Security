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
url() { echo "https://$1-$NUMBER.$REGION.run.app"; }
sa() { echo "$1@$PROJECT_ID.iam.gserviceaccount.com"; }

common=(--region "$REGION" --project "$PROJECT_ID"
        --build-service-account "projects/$PROJECT_ID/serviceAccounts/$(sa sa-build)")

case "${1:-}" in
  target)
    g run deploy target --source "$ROOT/services/target" "${common[@]}" \
      --service-account "$(sa sa-target)" --allow-unauthenticated \
      --set-env-vars "PROJECT_ID=$PROJECT_ID,EVENTS_TOPIC=security-events,SIM_AUDIENCE=$(url target)" \
      --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 80 --timeout 30
    ;;
  agent)
    # Private: only the Pub/Sub push identity can invoke it (see setup-cloud.sh push).
    g run deploy agent --source "$ROOT/services/agent" "${common[@]}" \
      --service-account "$(sa sa-agent)" --no-allow-unauthenticated \
      --set-env-vars "PROJECT_ID=$PROJECT_ID,REGION=$REGION,ENABLE_CLOUD_TRACE=true,ARMOR_LOCATION=us" \
      --cpu 1 --memory 1Gi --cpu-boost --min-instances "${AGENT_MIN_INSTANCES:-0}" --max-instances 3 \
      --concurrency 10 --timeout 180
    ;;
  dashboard)
    g run deploy dashboard --source "$ROOT/apps/dashboard" "${common[@]}" \
      --service-account "$(sa sa-dashboard)" --allow-unauthenticated \
      --set-env-vars "PROJECT_ID=$PROJECT_ID,TARGET_URL=$(url target),KMS_KEY=projects/$PROJECT_ID/locations/$REGION/keyRings/byok/cryptoKeys/tenant-gemini-key" \
      --cpu 1 --memory 1Gi --min-instances 0 --max-instances 3 --concurrency 80 --timeout 60
    ;;
  *) echo "usage: $0 target | agent | dashboard" >&2; exit 2 ;;
esac
echo "deployed: $(url "$1")"
