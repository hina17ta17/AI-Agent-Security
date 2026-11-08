<#
  bootstrap.ps1 - one-time Google Cloud setup.

  RUN THIS YOURSELF in your own PowerShell window (not through Claude),
  while logged in to gcloud with YOUR OWN Google account (project owner).

    powershell -ExecutionPolicy Bypass -File infra\bootstrap.ps1 -ProjectId YOUR_PROJECT_ID -ClaudeAccount YOUR_ACCOUNT@gmail.com

  -ClaudeAccount is a separate Google account used only by Claude Code.
  It gets exactly one permission: acting as the limited claude-dev service account.

  What it does (safe to run again; finished steps are skipped):
    1. Checks your login and that billing is enabled
    2. Enables the required APIs
    3. Creates service accounts (claude-dev + one per Cloud Run service)
    4. Grants least-privilege roles
    5. Creates a Cloud KMS key that encrypts users' Gemini API keys
    6. Lets the Claude-only account act as claude-dev (and nothing else)
    7. Logs your own account out of gcloud on this PC (pass -KeepMyLogin to stay logged in)

  claude-dev is NOT given: Owner/Editor, IAM admin, service account admin,
  Cloud KMS (cannot decrypt users' API keys), Secret Manager, API Keys, Billing.

  Service account key files are not used: Google blocks them by default
  (constraints/iam.disableServiceAccountKeyCreation), and impersonation is safer.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [Parameter(Mandatory = $true)][string]$ClaudeAccount,
  [string]$Region = "asia-northeast1",
  [switch]$KeepMyLogin
)

# Native-command stderr must not become terminating errors on Windows PowerShell 5.1,
# so failures are checked through $LASTEXITCODE instead.
$ErrorActionPreference = "Continue"

$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" }
if (-not (Test-Path $gcloud)) { throw "gcloud not found. Install the Google Cloud CLI first." }

function Invoke-G {
  & $gcloud @args
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($args -join ' ')" }
}

function Test-G {
  & $gcloud @args 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

# IAM bindings on freshly created service accounts can fail until they propagate.
function Invoke-GRetry {
  for ($i = 1; $i -le 6; $i++) {
    & $gcloud @args --quiet 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 10
  }
  # Last attempt shows the error message.
  & $gcloud @args --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed after retries: $($args -join ' ')" }
}

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. checks
Write-Step "Checking login and billing"
$account = (& $gcloud config get-value account 2>$null | Out-String).Trim()
if (-not $account -or $account -like "*gserviceaccount.com") {
  throw "Log in with your own Google account first: gcloud auth login"
}
if ($ClaudeAccount -ieq $account) {
  throw "-ClaudeAccount must be a DIFFERENT Google account from your own."
}
Write-Host "Logged in as your own account (not shown here)."

Invoke-G config set project $ProjectId --quiet 2>$null
$billing = (& $gcloud billing projects describe $ProjectId --format="value(billingEnabled)" 2>$null | Out-String).Trim()
if ($billing -eq "False") { throw "Billing is not enabled on $ProjectId. Link a billing account in the console first." }
if ($billing -ne "True") { Write-Host "Could not confirm billing status; continuing." -ForegroundColor Yellow }

# ---------------------------------------------------------------- 2. APIs
Write-Step "Enabling APIs (takes a minute)"
Invoke-G services enable `
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com `
  aiplatform.googleapis.com pubsub.googleapis.com firestore.googleapis.com `
  cloudkms.googleapis.com modelarmor.googleapis.com cloudtrace.googleapis.com `
  logging.googleapis.com monitoring.googleapis.com iam.googleapis.com `
  iamcredentials.googleapis.com serviceusage.googleapis.com cloudresourcemanager.googleapis.com `
  firebase.googleapis.com identitytoolkit.googleapis.com securetoken.googleapis.com `
  firebaserules.googleapis.com `
  --project $ProjectId

# ---------------------------------------------------------------- 3. service accounts
Write-Step "Creating service accounts"
$accounts = [ordered]@{
  "claude-dev"     = "Claude Code operator (limited)"
  "sa-dashboard"   = "Runtime: dashboard"
  "sa-target"      = "Runtime: protected demo site + WAF"
  "sa-agent"       = "Runtime: AI agent team"
  "sa-pubsub-push" = "Pub/Sub push invoker"
  "sa-build"       = "Cloud Build for source deploys"
}
foreach ($name in $accounts.Keys) {
  $email = "$name@$ProjectId.iam.gserviceaccount.com"
  if (Test-G iam service-accounts describe $email --project $ProjectId) {
    Write-Host "exists: $name"
    continue
  }
  # New projects may create only a few service accounts per minute (429 RESOURCE_EXHAUSTED).
  $created = $false
  for ($i = 1; $i -le 3 -and -not $created; $i++) {
    & $gcloud iam service-accounts create $name --display-name $accounts[$name] --project $ProjectId
    if ($LASTEXITCODE -eq 0) {
      $created = $true
    } else {
      Write-Host "Per-minute quota reached; waiting 65 seconds before retrying $name ..." -ForegroundColor Yellow
      Start-Sleep -Seconds 65
    }
  }
  if (-not $created) { throw "Could not create service account $name" }
}
function Sa($name) { return "serviceAccount:$name@$ProjectId.iam.gserviceaccount.com" }

# ---------------------------------------------------------------- 4. roles
Write-Step "Granting project roles"
$projectRoles = [ordered]@{
  "claude-dev"   = @(
    "roles/run.admin", "roles/run.sourceDeveloper", "roles/serviceusage.serviceUsageConsumer",
    "roles/pubsub.admin", "roles/datastore.owner", "roles/firebaserules.admin",
    "roles/modelarmor.admin", "roles/aiplatform.user",
    "roles/logging.viewer", "roles/cloudtrace.user", "roles/monitoring.viewer",
    "roles/iam.serviceAccountViewer", "roles/browser"
  )
  "sa-build"     = @("roles/run.builder")
  "sa-dashboard" = @("roles/datastore.user", "roles/cloudtrace.agent", "roles/logging.logWriter")
  "sa-target"    = @("roles/datastore.user", "roles/cloudtrace.agent", "roles/logging.logWriter", "roles/pubsub.publisher")
  "sa-agent"     = @("roles/datastore.user", "roles/cloudtrace.agent", "roles/logging.logWriter",
                     "roles/modelarmor.user", "roles/aiplatform.user")
}
foreach ($name in $projectRoles.Keys) {
  foreach ($role in $projectRoles[$name]) {
    Write-Host "$name <- $role"
    Invoke-GRetry projects add-iam-policy-binding $ProjectId --member (Sa $name) --role $role --condition=None
  }
}

Write-Step "Letting claude-dev deploy as the runtime accounts (actAs on those accounts only)"
foreach ($name in @("sa-dashboard", "sa-target", "sa-agent", "sa-pubsub-push", "sa-build")) {
  Invoke-GRetry iam service-accounts add-iam-policy-binding "$name@$ProjectId.iam.gserviceaccount.com" `
    --member (Sa "claude-dev") --role roles/iam.serviceAccountUser --project $ProjectId
}

# ---------------------------------------------------------------- 5. KMS for users' API keys
Write-Step "Creating Cloud KMS key for users' Gemini API keys"
$keyring = "byok"
$cryptoKey = "tenant-gemini-key"
if (-not (Test-G kms keyrings describe $keyring --location $Region --project $ProjectId)) {
  Invoke-G kms keyrings create $keyring --location $Region --project $ProjectId
}
if (-not (Test-G kms keys describe $cryptoKey --keyring $keyring --location $Region --project $ProjectId)) {
  $nextRotation = (Get-Date).ToUniversalTime().AddDays(90).ToString("yyyy-MM-ddTHH:mm:ssZ")
  Invoke-G kms keys create $cryptoKey --keyring $keyring --location $Region --purpose encryption `
    --rotation-period 90d --next-rotation-time $nextRotation --project $ProjectId
}
# Dashboard can only ENCRYPT (write-only). Only the agent can DECRYPT. claude-dev gets neither.
Invoke-GRetry kms keys add-iam-policy-binding $cryptoKey --keyring $keyring --location $Region `
  --member (Sa "sa-dashboard") --role roles/cloudkms.cryptoKeyEncrypter --project $ProjectId
Invoke-GRetry kms keys add-iam-policy-binding $cryptoKey --keyring $keyring --location $Region `
  --member (Sa "sa-agent") --role roles/cloudkms.cryptoKeyDecrypter --project $ProjectId

# ---------------------------------------------------------------- 6. Claude-only account
Write-Step "Letting the Claude-only account act as claude-dev (and nothing else)"
$claudeSa = "claude-dev@$ProjectId.iam.gserviceaccount.com"
Invoke-GRetry iam service-accounts add-iam-policy-binding $claudeSa `
  --member "user:$ClaudeAccount" --role roles/iam.serviceAccountTokenCreator --project $ProjectId

# ---------------------------------------------------------------- 7. log out
if (-not $KeepMyLogin) {
  Write-Step "Logging your own account out of gcloud on this PC"
  & $gcloud auth revoke $account --quiet 2>$null | Out-Null
  $adc = Join-Path $env:APPDATA "gcloud\application_default_credentials.json"
  if (Test-Path $adc) { & $gcloud auth application-default revoke --quiet 2>$null | Out-Null }
  & $gcloud config unset account 2>$null | Out-Null
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Tell Claude 'bootstrap done'. Claude will open a browser:"
Write-Host "sign in with the CLAUDE-ONLY account there, NOT your own account."
