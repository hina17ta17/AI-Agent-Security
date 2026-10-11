# set-site-secret.ps1 - store a secret for the RGB site (Cloud Run "rgb") in Secret Manager
# and connect it to the service. RUN THIS YOURSELF with your own (owner) Google account.
#
#   .\infra\set-site-secret.ps1 -Kind verify   # AgentGuard ownership token -> AGENTGUARD_VERIFY_TOKEN
#   .\infra\set-site-secret.ps1 -Kind ingest   # AgentGuard ingest key      -> AGENTGUARD_INGEST_KEY
#
# - The value is typed hidden; it is never printed, logged, or kept in this repository.
# - It uses a separate gcloud configuration ("agentguard-owner"), so Claude's configuration
#   (claude-dev) is not used and cannot read the secret.
# - The site runs as its own service account (sa-site-rgb) that can read only these two secrets.
param(
  [Parameter(Mandatory = $true)][ValidateSet("verify", "ingest")][string]$Kind,
  [string]$Project = "agent-ai-511212",
  [string]$Region = "asia-northeast1",
  [string]$Service = "rgb"
)
$ErrorActionPreference = "Continue"
$cfg = "agentguard-owner"
$sa = "sa-site-rgb@$Project.iam.gserviceaccount.com"
if ($Kind -eq "verify") { $secret = "rgb-verify-token"; $envName = "AGENTGUARD_VERIFY_TOKEN" }
else { $secret = "rgb-ingest-key"; $envName = "AGENTGUARD_INGEST_KEY" }

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Check($what) { if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $what" -ForegroundColor Red; exit 1 } }

Step "Use your own Google account (configuration '$cfg')"
gcloud config configurations describe $cfg --format="value(name)" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  gcloud config configurations create $cfg --no-activate | Out-Null; Check "create configuration"
}
$account = gcloud config get-value account --configuration $cfg 2>$null
if (-not $account) {
  Write-Host "A browser window opens: sign in with YOUR Google account (the project owner)."
  gcloud auth login --configuration $cfg; Check "login"
}
gcloud config set project $Project --configuration $cfg 2>&1 | Out-Null

Step "Enable Secret Manager"
gcloud services enable secretmanager.googleapis.com --project $Project --configuration $cfg; Check "enable API"

Step "Service account for the site (no permissions except its own secrets)"
gcloud iam service-accounts describe $sa --project $Project --configuration $cfg --format="value(email)" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  gcloud iam service-accounts create sa-site-rgb --project $Project --configuration $cfg --display-name "RGB site (Cloud Run)"
  Check "create service account"
}

Step "Secret '$secret'"
gcloud secrets describe $secret --project $Project --configuration $cfg --format="value(name)" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  gcloud secrets create $secret --project $Project --configuration $cfg --replication-policy=automatic; Check "create secret"
}
$secure = Read-Host -AsSecureString "Paste the value (hidden), then press Enter"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$tmp = [IO.Path]::GetTempFileName()
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
  if (-not $plain) { Write-Host "Nothing was pasted." -ForegroundColor Red; exit 1 }
  [IO.File]::WriteAllText($tmp, $plain)  # no trailing newline
  gcloud secrets versions add $secret --project $Project --configuration $cfg --data-file=$tmp; Check "add secret version"
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  $plain = $null
}
gcloud secrets add-iam-policy-binding $secret --project $Project --configuration $cfg `
  --member "serviceAccount:$sa" --role roles/secretmanager.secretAccessor --condition=None | Out-Null
Check "grant the site access to the secret"

Step "Connect it to Cloud Run '$Service' as $envName"
gcloud run services update $Service --region $Region --project $Project --configuration $cfg `
  --service-account $sa --update-secrets "$envName=${secret}:latest"
Check "update the Cloud Run service"

Write-Host ""
Write-Host "Done. $envName is now available to the site (the value itself was never shown)." -ForegroundColor Green
