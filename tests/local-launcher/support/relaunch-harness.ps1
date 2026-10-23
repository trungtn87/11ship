# Test helper for tests/local-launcher/launcher.Tests.ps1 (task M00.02). Not a product script.
# It stands in for "the launcher" in a sandbox checkout, with the same parameters as 11ship-launcher.ps1: it loads the
# launcher file that sits NEXT TO IT (so after an Update it loads the NEW code), replaces Docker, npm and node with
# recording fakes, then runs the launcher's real entry point Invoke-LauncherMain. When the launcher re-runs itself it
# starts THIS file again (RelaunchScript), so two real processes go through the real hand-over.
# Everything it does is appended to <repo>\.11ship-local\harness-calls-<pid>.log for the suite to read.
# ASCII on purpose: Windows PowerShell 5.1 reads a BOM-less script as ANSI.
param(
  [string]$Command = 'Menu',
  [string]$App,
  [switch]$Yes,
  [switch]$KeepDatabases,
  [switch]$ForceDependencies,
  [switch]$NoPause,
  [string]$RelaunchToken,
  [string]$RelaunchFromSha,
  [string]$RelaunchToSha,
  [string]$RelaunchLauncherHash
)
$ErrorActionPreference = 'Stop'
$given = @{
  Command = $Command; App = $App; Yes = [bool]$Yes; KeepDatabases = [bool]$KeepDatabases; ForceDependencies = [bool]$ForceDependencies
  NoPause = [bool]$NoPause; Token = $RelaunchToken; From = $RelaunchFromSha; To = $RelaunchToSha; Hash = $RelaunchLauncherHash
}
$harnessPath = $PSCommandPath
$onWindows = ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT)
$env:OS = 'Windows_NT'
if (!$onWindows) { Set-Alias -Name git.exe -Value git }

function Write-Call([string]$Text) {
  $dir = Join-Path $script:Repo '.11ship-local'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $line = ('{0} pid={1} {2}' -f [DateTime]::UtcNow.Ticks, $PID, $Text) + "`n"
  # One writer per file: concurrent AppendAllText calls can overwrite each other on Unix.
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { [IO.File]::AppendAllText((Join-Path $dir ('harness-calls-{0}.log' -f $PID)), $line); return } catch { Start-Sleep -Milliseconds 50 }
  }
  throw "Harness call log could not be written for pid=$PID"
}
function Test-HarnessLockHeld {
  $probe = Open-ExclusiveFile $script:LockFile
  if ($probe) { $probe.Dispose(); return $false }
  return $true
}
function docker.exe {
  $global:LASTEXITCODE = 0
  Write-Call ('docker {0}' -f ($args -join ' '))
  if ($args[0] -eq 'info') { return '29.8.2' }
  if ($args[0] -eq 'compose' -and $args -contains 'version') { return 'Docker Compose version v5.5.1' }
  if ($args[0] -eq 'inspect') { return 'healthy' }
}
function node.exe { $global:LASTEXITCODE = 0; if (($args -join ' ') -eq '--version') { return 'v24.21.0' } }
function npm.cmd {
  $line = ($args -join ' ')
  $global:LASTEXITCODE = 0
  if ($line -eq '--version') { return '11.9.0' }
  Write-Call ('npm {0} lockheld={1} cwd={2}' -f $line, (Test-HarnessLockHeld), (Split-Path -Leaf (Get-Location).Path))
  if ($line -eq 'ci') {
    if ($env:SHIP11_HARNESS_NPM_FAIL -eq '1') { $global:LASTEXITCODE = 1; return }
    New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
  }
}

. (Join-Path $PSScriptRoot '11ship-launcher.ps1')

# The launcher declared the same parameters again while loading and reset them: put the given values back.
$Command = $given.Command
if ($given.App) { $App = $given.App }
$Yes = $given.Yes
$KeepDatabases = $given.KeepDatabases
$ForceDependencies = $given.ForceDependencies
$NoPause = $given.NoPause
$RelaunchToken = $given.Token
$RelaunchFromSha = $given.From
$RelaunchToSha = $given.To
$RelaunchLauncherHash = $given.Hash
# The launcher re-runs itself through this file, so the new process gets the same fakes.
$script:RelaunchScript = $harnessPath
function Start-BackendProcess([string]$Stdout,[string]$Stderr) {
  Write-Call 'backend start'
  return [pscustomobject]@{ Id = 999999; StartTime = [DateTime]::UtcNow }
}

Write-Call ('start marker={0} command={1} yes={2} keep={3} force={4} nopause={5} token={6}' -f $script:TestMarker, $Command, $Yes, $KeepDatabases, $ForceDependencies, $NoPause, $RelaunchToken)
$delay = 0
# Only the re-run launcher waits, so the suite can look at the moment between the two owners of the lock.
if ($RelaunchToken -and [int]::TryParse([string]$env:SHIP11_HARNESS_DELAY_MS, [ref]$delay) -and $delay -gt 0) { Start-Sleep -Milliseconds $delay }
# Test barrier (F1): this process has loaded the launcher code that is on disk NOW. It waits here, before it asks for the
# lock, until the suite creates the file; by then another launcher may have replaced the code on disk.
if (!$RelaunchToken -and $env:SHIP11_HARNESS_WAIT_FILE) {
  $until = [DateTime]::UtcNow.AddSeconds(240)
  while (!(Test-Path -LiteralPath $env:SHIP11_HARNESS_WAIT_FILE) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 100 }
}
Invoke-LauncherMain
