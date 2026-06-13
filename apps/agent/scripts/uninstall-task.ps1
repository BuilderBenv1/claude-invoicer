<#
.SYNOPSIS
  Stops and removes the Claude Invoicer agent scheduled task.
#>
[CmdletBinding()]
param(
  [string]$TaskName = "ClaudeInvoicerAgent"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No scheduled task named '$TaskName' found. Nothing to do."
  return
}

try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed scheduled task '$TaskName'. (Your config at ~/.claude-invoicer was left intact.)"
