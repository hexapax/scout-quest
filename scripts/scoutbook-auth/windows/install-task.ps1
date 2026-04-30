# Register a weekly Scoutbook-token-refresh scheduled task in Windows.
#
# Default schedule: Sundays at 03:00 local time.
# Override with -Day / -At parameters.
#
# Idempotent: if a task with the same name already exists, it's replaced.
#
# Run from an elevated PowerShell (Run as Administrator) the first time —
# Task Scheduler needs admin to register tasks under the user's principal
# in some environments. After that the task itself runs as the current
# user, no elevation needed.

[CmdletBinding()]
param(
  [ValidateSet('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')]
  [string]$Day = 'Sunday',
  [string]$At = '03:00',
  [string]$TaskName = 'ScoutbookTokenRefresh'
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$refresh = Join-Path $here "refresh.ps1"

if (-not (Test-Path $refresh)) {
  throw "refresh.ps1 not found next to install-task.ps1 (looked at: $refresh)"
}

# Trigger: weekly, run-as-current-user.
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $At

# Action: run powershell.exe with -File so we don't have to mess with
# execution policy for the task itself. -NoProfile keeps the start fast.
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$refresh`""

# Settings: allow on battery, don't stop if user logs off, restart on
# failure (1 attempt after 5 minutes), wake the computer to run.
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -RestartCount 1 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Weekly headless refresh of the Scoutbook JWT (scout-quest project)."

# Replace any existing task with the same name (idempotent).
try {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
  Write-Host "Removed existing task: $TaskName"
} catch {
  # No existing task — fine.
}

Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null
Write-Host ""
Write-Host "Scheduled task installed:" -ForegroundColor Green
Write-Host "  Name    : $TaskName"
Write-Host "  Trigger : Weekly $Day at $At"
Write-Host "  Action  : $refresh"
Write-Host ""
Write-Host "Inspect / edit later via:"
Write-Host "  Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
Write-Host "  taskschd.msc"
Write-Host ""
Write-Host "Run it now to verify (will not require sign-in if profile is healthy):"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
