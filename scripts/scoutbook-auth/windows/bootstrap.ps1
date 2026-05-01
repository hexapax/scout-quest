# One-time interactive bootstrap on Windows-native PowerShell.
#
# Opens headed Chrome, you sign in to BSA (including reCAPTCHA), the script
# closes the window once a JWT cookie is detected. The persistent profile
# lives at %LOCALAPPDATA%\scoutbook-auth\profile (LOCAL Windows filesystem,
# not the WSL UNC share -- Chrome handles UNC profile dirs poorly).
#
# Run this from regular PowerShell -- NOT from WSL2. Headed Chrome from
# WSL2 needs WSLg working and adds moving parts for no benefit on a
# one-shot interactive step.
#
# IMPORTANT: invoke as
#   powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1
# if the repo lives on the WSL filesystem (\\wsl.localhost\...) -- Windows
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

# Convert PowerShell's PSDrive-prefixed UNC path back to a real
# \\server\share\... path so child processes (Node, Chrome) get a clean
# string. Without this the path looks like
# "Microsoft.PowerShell.Core\FileSystem::\\wsl.localhost\..." which
# confuses some tooling.
$root = $root.ProviderPath

# Profile + token live on the LOCAL Windows filesystem, not on the WSL
# UNC share. Chrome is flaky with profile dirs on UNC paths (silent
# failures persisting cookies, occasional file-lock errors). The repo
# itself can stay on \\wsl.localhost\... -- only the live profile matters.
$localBase  = Join-Path $env:LOCALAPPDATA "scoutbook-auth"
$profileDir = Join-Path $localBase "profile"
$tokenFile  = Join-Path $localBase "token.txt"
New-Item -Path $localBase -ItemType Directory -Force | Out-Null

$env:SCOUTBOOK_PROFILE_DIR = $profileDir
$env:SCOUTBOOK_TOKEN_FILE  = $tokenFile

Write-Host "Bootstrap dir : $root"
Write-Host "Profile dir   : $profileDir"
Write-Host "Token file    : $tokenFile"
Write-Host ""

Set-Location $root

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing npm deps + Chromium..."
  npm install
  npx playwright install chromium
}

Write-Host ""
Write-Host "Launching Chrome -- sign in when the window appears."
Write-Host "If you don't see Chrome, check the taskbar / Alt-Tab -- the window"
Write-Host "sometimes opens behind PowerShell."
Write-Host "The script will close the window once your session is captured."
Write-Host ""

node refresh-token.mjs --bootstrap
$code = $LASTEXITCODE

if ($code -eq 0) {
  Write-Host ""
  Write-Host "Bootstrap complete." -ForegroundColor Green
  Write-Host "  Profile : $profileDir"
  Write-Host "  Token   : $tokenFile"
  Write-Host ""
  Write-Host "Next: install the weekly scheduled task with"
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\install-task.ps1"
} else {
  Write-Host ""
  Write-Host "Bootstrap failed with exit code $code." -ForegroundColor Red
  Write-Host "Failure screenshot is under $(Join-Path $root 'debug')."
  exit $code
}
