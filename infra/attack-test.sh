#!/usr/bin/env bash
# attack-test.sh - try a few simple attacks on one of YOUR sites and watch AgentGuard respond.
#
#   bash infra/attack-test.sh https://rgb-1032914465512.asia-northeast1.run.app
#
# Safety: only a Cloud Run service of this Google Cloud project is accepted, so this can never be
# pointed at someone else's site. The requests come from a Cloud Build worker, so the address
# AgentGuard blocks is the worker's, never your own PC's.
set -euo pipefail

GCLOUD="${GCLOUD:-gcloud}"
if ! command -v "$GCLOUD" >/dev/null 2>&1; then
  GCLOUD="/c/Users/${USERNAME:-$USER}/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud"
fi
g() { "$GCLOUD" --verbosity=error --quiet "$@"; }

SITE="${1:?usage: bash infra/attack-test.sh https://<your-cloud-run-site>}"
SITE="${SITE%/}"
PROJECT_ID="${PROJECT_ID:-$(g config get-value project)}"
REGION="${REGION:-asia-northeast1}"
NUMBER="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Every address of this project's Cloud Run services (both URL forms).
mine="$(g run services list --project "$PROJECT_ID" --format='value(metadata.name,status.url)' |
  while read -r name url; do
    echo "$url"
    echo "https://$name-$NUMBER.$REGION.run.app"
  done)"
if ! grep -qxF "$SITE" <<<"$mine"; then
  echo "refused: $SITE is not a Cloud Run service of project $PROJECT_ID (only your own sites can be tested)" >&2
  exit 1
fi

g builds submit --no-source --config="$ROOT/infra/attack-test.yaml" --region="$REGION" --project "$PROJECT_ID" \
  --service-account="projects/$PROJECT_ID/serviceAccounts/sa-build@$PROJECT_ID.iam.gserviceaccount.com" \
  --substitutions="_SITE=$SITE" 2>&1 | grep -E -- "== AgentGuard|-- [0-9]\.| -> |ERROR" || true
