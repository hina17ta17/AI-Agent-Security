#!/usr/bin/env bash
# setup-cloud.sh - create AgentGuard's cloud resources (idempotent; safe to re-run).
#
# Runs with the limited operator account (claude-dev) after infra/bootstrap.ps1.
#
#   bash infra/setup-cloud.sh base                 # Firestore, TTL, rules, Pub/Sub topics, Model Armor
#   bash infra/setup-cloud.sh push <AGENT_URL>     # Pub/Sub push subscription -> agent service
#
# PROJECT_ID defaults to the active gcloud project.
set -euo pipefail

GCLOUD="${GCLOUD:-gcloud}"
if ! command -v "$GCLOUD" >/dev/null 2>&1; then
  GCLOUD="/c/Users/${USERNAME:-$USER}/AppData/Local/Google/Cloud SDK/google-cloud-sdk/bin/gcloud"
fi
g() { "$GCLOUD" --verbosity=error --quiet "$@"; }

PROJECT_ID="${PROJECT_ID:-$(g config get-value project)}"
REGION="${REGION:-asia-northeast1}"
ARMOR_LOCATION="${ARMOR_LOCATION:-us}"   # asia-northeast1 lacks multi-language detection
TOPIC="security-events"
DLQ_TOPIC="security-events-dlq"
SUBSCRIPTION="security-events-agent"
HERE="$(cd "$(dirname "$0")" && pwd)"

step() { printf '\n==> %s\n' "$*"; }

# ------------------------------------------------------------------ Firestore
setup_firestore() {
  step "Firestore (Native mode, $REGION)"
  if g firestore databases describe --database="(default)" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "exists: (default)"
  else
    g firestore databases create --database="(default)" --location="$REGION" \
      --type=firestore-native --project="$PROJECT_ID"
  fi

  step "Firestore TTL: blocklist entries expire automatically"
  g firestore fields ttls update expiresAt --collection-group=blocklist \
    --enable-ttl --async --project="$PROJECT_ID" >/dev/null || echo "(TTL update already in progress or set)"
}

# ------------------------------------------------------------------ Security rules
deploy_rules() {
  step "Firestore security rules"
  local token body ruleset api="https://firebaserules.googleapis.com/v1/projects/$PROJECT_ID"
  token="$(g auth print-access-token)"
  body="$(python -c 'import json,sys; print(json.dumps({"source":{"files":[{"name":"firestore.rules","content":open(sys.argv[1],encoding="utf-8").read()}]}}))' "$HERE/firestore.rules")"
  ruleset="$(curl -sf -X POST "$api/rulesets" -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" -d "$body" | python -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
  local release="{\"release\":{\"name\":\"projects/$PROJECT_ID/releases/cloud.firestore\",\"rulesetName\":\"$ruleset\"}}"
  if ! curl -sf -X PATCH "$api/releases/cloud.firestore" -H "Authorization: Bearer $token" \
       -H "Content-Type: application/json" -d "$release" >/dev/null; then
    curl -sf -X POST "$api/releases" -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
      -d "{\"name\":\"projects/$PROJECT_ID/releases/cloud.firestore\",\"rulesetName\":\"$ruleset\"}" >/dev/null
  fi
  echo "released: $ruleset"
}

# ------------------------------------------------------------------ Pub/Sub topics
setup_topics() {
  step "Pub/Sub topics"
  for t in "$TOPIC" "$DLQ_TOPIC"; do
    if g pubsub topics describe "$t" --project="$PROJECT_ID" >/dev/null 2>&1; then
      echo "exists: $t"
    else
      g pubsub topics create "$t" --project="$PROJECT_ID"
    fi
  done
  # Keep dead letters around for inspection.
  if ! g pubsub subscriptions describe "$DLQ_TOPIC-sub" --project="$PROJECT_ID" >/dev/null 2>&1; then
    g pubsub subscriptions create "$DLQ_TOPIC-sub" --topic="$DLQ_TOPIC" --project="$PROJECT_ID"
  fi
}

# ------------------------------------------------------------------ Model Armor
setup_model_armor() {
  step "Model Armor templates ($ARMOR_LOCATION)"
  export CLOUDSDK_API_ENDPOINT_OVERRIDES_MODELARMOR="https://modelarmor.$ARMOR_LOCATION.rep.googleapis.com/"
  local existing
  existing="$(g model-armor templates list --location="$ARMOR_LOCATION" --project="$PROJECT_ID" --format='value(name)')"

  # Input: attacker-controlled payloads are screened for prompt injection / jailbreak and bad URLs.
  if grep -q '/agentguard-input$' <<<"$existing"; then
    echo "exists: agentguard-input"
  else
    g model-armor templates create agentguard-input --location="$ARMOR_LOCATION" --project="$PROJECT_ID" \
      --pi-and-jailbreak-filter-settings-enforcement=enabled \
      --pi-and-jailbreak-filter-settings-confidence-level=medium-and-above \
      --malicious-uri-filter-settings-enforcement=enabled
  fi

  # Output: AI-written reports must not leak credentials/PII or contain harmful text.
  if grep -q '/agentguard-output$' <<<"$existing"; then
    echo "exists: agentguard-output"
  else
    g model-armor templates create agentguard-output --location="$ARMOR_LOCATION" --project="$PROJECT_ID" \
      --basic-config-filter-enforcement=enabled \
      --rai-settings-filters='[{"filterType":"HATE_SPEECH","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"HARASSMENT","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"SEXUALLY_EXPLICIT","confidenceLevel":"MEDIUM_AND_ABOVE"},{"filterType":"DANGEROUS","confidenceLevel":"HIGH"}]'
  fi
}

# ------------------------------------------------------------------ Push subscription
setup_push() {
  local agent_url="${1:?usage: setup-cloud.sh push <AGENT_URL>}"
  agent_url="${agent_url%/}"
  local push_sa="sa-pubsub-push@$PROJECT_ID.iam.gserviceaccount.com"
  local number
  number="$(g projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  local pubsub_agent="serviceAccount:service-$number@gcp-sa-pubsub.iam.gserviceaccount.com"

  step "Allow Pub/Sub to invoke the agent service (and nothing else)"
  g run services add-iam-policy-binding agent --region="$REGION" --project="$PROJECT_ID" \
    --member="serviceAccount:$push_sa" --role=roles/run.invoker >/dev/null

  step "Push subscription $SUBSCRIPTION -> $agent_url/pubsub"
  if g pubsub subscriptions describe "$SUBSCRIPTION" --project="$PROJECT_ID" >/dev/null 2>&1; then
    g pubsub subscriptions update "$SUBSCRIPTION" --project="$PROJECT_ID" \
      --push-endpoint="$agent_url/pubsub" --push-auth-service-account="$push_sa" \
      --push-auth-token-audience="$agent_url" >/dev/null
    echo "updated: $SUBSCRIPTION"
  else
    g pubsub subscriptions create "$SUBSCRIPTION" --topic="$TOPIC" --project="$PROJECT_ID" \
      --push-endpoint="$agent_url/pubsub" --push-auth-service-account="$push_sa" \
      --push-auth-token-audience="$agent_url" \
      --ack-deadline=120 --min-retry-delay=5s --max-retry-delay=60s \
      --dead-letter-topic="$DLQ_TOPIC" --max-delivery-attempts=5
  fi

  step "Dead-letter permissions for the Pub/Sub service agent"
  g pubsub topics add-iam-policy-binding "$DLQ_TOPIC" --project="$PROJECT_ID" \
    --member="$pubsub_agent" --role=roles/pubsub.publisher >/dev/null
  g pubsub subscriptions add-iam-policy-binding "$SUBSCRIPTION" --project="$PROJECT_ID" \
    --member="$pubsub_agent" --role=roles/pubsub.subscriber >/dev/null
  echo "done"
}

case "${1:-}" in
  base)  setup_firestore; deploy_rules; setup_topics; setup_model_armor ;;
  rules) deploy_rules ;;
  push)  setup_push "${2:-}" ;;
  *)     echo "usage: $0 base | rules | push <AGENT_URL>" >&2; exit 2 ;;
esac
