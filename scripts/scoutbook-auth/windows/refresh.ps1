# Headless Scoutbook token refresh on Windows.
#
# Runs `node refresh-token.mjs` (no --bootstrap flag) against the existing
# persistent profile. Designed to be invoked unattended by Task Scheduler.
#
# Logs to .\windows\refresh.log next to this script. Rotates at 1 MB.
# Exit codes: 0 success, non-zero failure (including "session expired —
# re-bootstrap on workstation").

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Resolve-Path (Join-Path $here "..")
$log  = Join-Path $here "refresh.log"

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
