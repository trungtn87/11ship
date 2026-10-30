# Install a non-destructive local Git observer (Windows PowerShell 5.1+).
# ONE-TIME opt-in on owner's actual PC; GitHub Actions cannot install tasks on D:\11Ship.
# Watcher is OBSERVE ONLY: fetch/inspect, never checkout/merge/push/reset.
[CmdletBinding()]
param(
  [ValidateSet('Install','Remove','RunOnce')]
  [string]$Action = 'Install',
  [string]$Repository = ''
)
$ErrorActionPreference = 'Stop'
$taskName = '11Ship-Local-Sync-Observer'
$script = Join-Path $PSScriptRoot 'monitor-local.mjs'
$repoRoot = if ($Repository) { (Resolve-Path -LiteralPath $Repository).Path } else {
  (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
}
if ($Action -eq 'Remove') {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
  Write-Host "$taskName removed (if present)"
  exit 0
}
$node = (Get-Command node -ErrorAction Stop).Source
if ($Action -eq 'RunOnce') {
  & $node $script --repo $repoRoot
  if ($LASTEXITCODE -ne 0) { throw 'Local Sync Observer failed' }
  exit 0
}
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$scheduledAction = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" --repo "{1}"' -f $script, $repoRoot) -WorkingDirectory $repoRoot
# Use the current interactive Windows account; no elevation/SYSTEM and no token sharing.
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $scheduledAction -Trigger $trigger -Principal $principal -Force -Description '11Ship: observe local Git worktrees without modifying tracked files' | Out-Null
Write-Host "$taskName installed for interactive sessions; does NOT run with the user signed out."
Write-Host 'Run once with: powershell -File scripts\ai-governance\install-local-monitor.ps1 -Action RunOnce'
