# One-time interactive bootstrap on Windows-native PowerShell.
#
# Opens headed Chrome, you sign in to BSA (including reCAPTCHA), the script
# closes the window once a JWT cookie is detected. The persistent profile
# in ..\profile\ is reused by every subsequent refresh.
#
# Run this from regular PowerShell — NOT from WSL2. Headed Chrome from
# WSL2 needs WSLg working and adds moving parts for no benefit on a
# one-shot interactive step.
#
# IMPORTANT: invoke as
#   powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1
# if the repo lives on the WSL filesystem (\\wsl.localhost\…) — Windows
# tags those files as remote/untrusted and the default ExecutionPolicy
# refuses to run them.
#
# Prereqs:
#   - Node.js 20+ on PATH (winget install OpenJS.NodeJS.LTS)
#   - Real Chrome installed (the default Chrome install is fine)
#   - npm install + npx playwright install chromium have been run once
#     in the parent dir (see ..\README.md)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Resolve-Path (Join-Path $here "..")

Write-Host "Bootstrap dir: $root"
Set-Location $root

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing npm deps + Chromium..."
  npm install
  npx playwright install chromium
}

Write-Host ""
Write-Host "Launching Chrome — sign in when the window appears."
Write-Host "The script will close it automatically once your session is captured."
Write-Host ""

node refresh-token.mjs --bootstrap
$code = $LASTEXITCODE

if ($code -eq 0) {
  $tokenPath = Join-Path $root "token.txt"
  Write-Host ""
  Write-Host "Bootstrap complete." -ForegroundColor Green
  Write-Host "  Profile : $((Resolve-Path (Join-Path $root 'profile')).Path)"
  Write-Host "  Token   : $tokenPath"
  Write-Host ""
  Write-Host "Next: install the weekly scheduled task with"
  Write-Host "  pwsh $here\install-task.ps1"
} else {
  Write-Host ""
  Write-Host "Bootstrap failed with exit code $code." -ForegroundColor Red
  Write-Host "Check the most recent screenshot under .\debug\."
  exit $code
}
