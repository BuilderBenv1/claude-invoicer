<#
.SYNOPSIS
  Installs the Claude Invoicer agent as a hidden Scheduled Task that auto-starts
  at logon and keeps running (so tracking survives PC restarts).

.EXAMPLE
  # Write config + register the task in one go:
  .\install-task.ps1 -ApiUrl "https://your-app.vercel.app" -Token "your-shared-secret"

.EXAMPLE
  # Register the task only (you already created ~/.claude-invoicer/agent.json):
  .\install-task.ps1
#>
[CmdletBinding()]
param(
  [string]$ApiUrl,
  [string]$Token,
  [int]$IdleCapMin = 5,
  [int]$ScanIntervalMin = 5,
  [string]$TaskName = "ClaudeInvoicerAgent"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..\..\..")).Path
$entry = Join-Path $repoRoot "apps\agent\src\index.ts"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node not found on PATH. Install Node.js >= 20 first." }
if (-not (Test-Path $entry)) { throw "Agent entry not found at $entry" }

# Optionally write the agent config (holds the shared secret).
$cfgDir = Join-Path $env:USERPROFILE ".claude-invoicer"
$cfgPath = Join-Path $cfgDir "agent.json"
if ($ApiUrl -and $Token) {
  if (-not (Test-Path $cfgDir)) { New-Item -ItemType Directory -Path $cfgDir | Out-Null }
  $cfg = [ordered]@{
    apiBaseUrl      = $ApiUrl.TrimEnd('/')
    deviceToken     = $Token
    idleCapMin      = $IdleCapMin
    scanIntervalMin = $ScanIntervalMin
  }
  ($cfg | ConvertTo-Json) | Set-Content -Path $cfgPath -Encoding utf8
  Write-Host "Wrote config to $cfgPath"
}
elseif (-not (Test-Path $cfgPath)) {
  Write-Warning "No agent.json at $cfgPath and no -ApiUrl/-Token supplied. The agent cannot upload until you create it (see SETUP.md)."
}

# Ensure dependencies are installed at the repo root.
if (-not (Test-Path (Join-Path $repoRoot "node_modules\tsx"))) {
  Write-Host "Installing dependencies (npm install)..."
  Push-Location $repoRoot
  try { & npm install | Out-Null } finally { Pop-Location }
}

$action = New-ScheduledTaskAction -Execute $node -Argument "--import tsx `"$entry`"" -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$settings.Hidden = $true
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "Registered scheduled task '$TaskName' (hidden, auto-starts at logon)."

Start-ScheduledTask -TaskName $TaskName
Write-Host "Started '$TaskName'. It scans every $ScanIntervalMin min and relaunches automatically after a restart."
Write-Host "Manage it anytime with: Get-ScheduledTask $TaskName  |  Stop-ScheduledTask $TaskName"
