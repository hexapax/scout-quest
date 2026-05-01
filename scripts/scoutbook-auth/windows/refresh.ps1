# Headless Scoutbook token refresh on Windows.
#
# Runs `node refresh-token.mjs` (no --bootstrap flag) against the existing
# persistent profile at %LOCALAPPDATA%\scoutbook-auth\profile. Designed to
# be invoked unattended by Task Scheduler.
#
# Logs to .\windows\refresh.log next to this script. Rotates at 1 MB.
# Exit codes: 0 success, non-zero failure (including "session expired --
# re-bootstrap on workstation").

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Resolve-Path (Join-Path $here "..")
$root = $root.ProviderPath
$log  = Join-Path $here "refresh.log"

# Same local-Windows path layout that bootstrap.ps1 establishes. The
# scheduled task inherits these env vars when it spawns this script.
$localBase  = Join-Path $env:LOCALAPPDATA "scoutbook-auth"
$profileDir = Join-Path $localBase "profile"
$tokenFile  = Join-Path $localBase "token.txt"
$env:SCOUTBOOK_PROFILE_DIR = $profileDir
$env:SCOUTBOOK_TOKEN_FILE  = $tokenFile

# Light log rotation: roll past 1 MB to .log.old.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
  $old = "$log.old"
  if (Test-Path $old) { Remove-Item $old -Force }
  Move-Item $log $old
}

function Log([string]$msg) {
  $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
  Add-Content -Path $log -Value $line
  Write-Host $line
}

Set-Location $root
Log "=== refresh start ==="
Log "profile=$profileDir"
Log "token=$tokenFile"

if (-not (Test-Path $profileDir)) {
  Log "FATAL: profile dir does not exist; run bootstrap.ps1 first."
  exit 1
}

try {
  $output = & node refresh-token.mjs 2>&1
  $exit = $LASTEXITCODE
  $output | ForEach-Object { Log $_ }
  Log "=== refresh exit code: $exit ==="
  exit $exit
} catch {
  Log ("FATAL: " + $_.Exception.Message)
  exit 1
}
