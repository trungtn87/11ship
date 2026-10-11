# Test helper for tests/local-launcher/launcher.Tests.ps1 (task M00.03). Not a product script.
# Like relaunch-harness.ps1 it stands in for "the launcher" in a sandbox checkout (same parameters, loads the launcher
# file that sits NEXT TO IT, runs the real entry point Invoke-LauncherMain), but its operating-system seams are backed by
# FILES in <repo>\.11ship-local (fakeos.procs, fakeos.listeners, fakeos.next). Several real launcher processes therefore
# see the SAME fake process table, so the suite can prove that two launchers started together build once, start ONE
# backend, and only ever stop the process that is recorded for this checkout.
# Everything it does is appended to <repo>\.11ship-local\harness-calls.log (with whether the shared lock was held).
# SHIP11_HARNESS_START_DELAY_MS keeps a freshly "started" backend unrecorded for a while: a second launcher that was not
# held back by the lock would run into it.
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
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { [IO.File]::AppendAllText((Join-Path $dir 'harness-calls.log'), $line); return } catch { Start-Sleep -Milliseconds 50 }
  }
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
  if ($args[0] -eq 'exec') {
    # The DEV database is fully migrated: every migration file of the checkout counts as applied.
    $sql = [string]$args[$args.Count - 1]
    if ($sql.Contains('to_regclass')) { return 't' }
    if ($sql.StartsWith('SELECT name')) { return (@(Get-MigrationFiles) -join "`n") }
  }
}
function node.exe { $global:LASTEXITCODE = 0; if (($args -join ' ') -eq '--version') { return 'v24.21.0' } }
function npm.cmd {
  $line = ($args -join ' ')
  $global:LASTEXITCODE = 0
  if ($line -eq '--version') { return '11.9.0' }
  Write-Call ('npm {0} lockheld={1} cwd={2}' -f $line, (Test-HarnessLockHeld), (Split-Path -Leaf (Get-Location).Path))
  if ($line -eq 'run build') {
    # Same content every time, so the build fingerprint is the same every time.
    New-Item -ItemType Directory -Force -Path $script:BackendDist | Out-Null
    [IO.File]::WriteAllText((Join-Path $script:BackendDist 'main.js'), '// harness build')
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
# ---- the fake operating system: one text file per table, shared by every launcher process of this checkout ----
function Get-FakeOsPath([string]$Name) { return (Join-Path (Join-Path $script:Repo '.11ship-local') ('fakeos.' + $Name)) }
function Read-FakeLines([string]$Name) {
  $path = Get-FakeOsPath $Name
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try {
      if (!(Test-Path -LiteralPath $path)) { return @() }
      return @([IO.File]::ReadAllLines($path) | Where-Object { $_ })
    } catch { Start-Sleep -Milliseconds 25 }
  }
  throw "fake OS table $Name cannot be read"
}
function Write-FakeLines([string]$Name,[string[]]$Lines) {
  $path = Get-FakeOsPath $Name
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { [IO.File]::WriteAllLines($path, [string[]]@($Lines)); return } catch { Start-Sleep -Milliseconds 25 }
  }
  throw "fake OS table $Name cannot be written"
}
function Read-FakeProcs {
  return @(Read-FakeLines 'procs' | ForEach-Object { $f = $_.Split('|'); [pscustomobject]@{ ProcId = [int]$f[0]; Start = $f[1]; Exe = $f[2]; Cmd = $f[3] } })
}
function Get-ProcessDetails([int]$ProcessId) {
  foreach ($row in @(Read-FakeProcs)) {
    if ($row.ProcId -eq $ProcessId) {
      return [pscustomobject]@{ ProcessId = $ProcessId; Name = 'node'; Inspectable = $true; StartUtc = $row.Start; Executable = $row.Exe; CommandLine = $row.Cmd; Arguments = @(Split-CommandLine $row.Cmd) }
    }
  }
  return $null
}
function Get-PortListeners([int]$Port) {
  $items = New-Object 'Collections.Generic.List[object]'
  foreach ($line in @(Read-FakeLines 'listeners')) {
    $f = $line.Split('|')
    if ([int]$f[2] -eq $Port) { $items.Add([pscustomobject]@{ Address = $f[0]; ProcessId = [int]$f[1] }) }
  }
  return [pscustomobject]@{ Readable = $true; Items = @($items.ToArray()); Detail = '' }
}
function Start-BackendProcess([string]$Stdout,[string]$Stderr) {
  $delay = 0
  [void][int]::TryParse([string]$env:SHIP11_HARNESS_START_DELAY_MS, [ref]$delay)
  Write-Call ('backend start lockheld={0}' -f (Test-HarnessLockHeld))
  $next = 40000
  $saved = @(Read-FakeLines 'next')
  if ($saved.Count) { $next = [int]$saved[0] }
  $newId = $next + 1
  Write-FakeLines 'next' @("$newId")
  $startUtc = [DateTime]::UtcNow.ToString('o')
  $exe = Join-Path (Join-Path (Join-Path $script:Repo '.11ship-local') 'fake-node') 'node.exe'
  $command = '"' + $exe + '" ' + ((Get-BackendStartArguments) -join ' ')
  Write-FakeLines 'procs' (@(Read-FakeLines 'procs') + ('{0}|{1}|{2}|{3}' -f $newId, $startUtc, $exe, $command))
  Write-FakeLines 'listeners' (@(Read-FakeLines 'listeners') + ('127.0.0.1|{0}|3000' -f $newId))
  if ($delay -gt 0) { Start-Sleep -Milliseconds $delay }
  return [pscustomobject]@{ Id = $newId; StartTime = [DateTime]::UtcNow }
}
function Stop-OwnedProcess([int]$ProcessId) {
  Write-Call ('backend stop pid={0} lockheld={1}' -f $ProcessId, (Test-HarnessLockHeld))
  Write-FakeLines 'procs' @(Read-FakeLines 'procs' | Where-Object { $_.Split('|')[0] -ne "$ProcessId" })
  Write-FakeLines 'listeners' @(Read-FakeLines 'listeners' | Where-Object { $_.Split('|')[1] -ne "$ProcessId" })
}
function Get-HttpResult([string]$Url) {
  $listening = @(Read-FakeLines 'listeners' | Where-Object { $_.EndsWith('|3000') }).Count -gt 0
  if (!$listening) { return [pscustomobject]@{ Status = 0; Body = '' } }
  if ($Url.EndsWith('/live')) { return [pscustomobject]@{ Status = 200; Body = '{"data":{"status":"ok"}}' } }
  return [pscustomobject]@{ Status = 200; Body = '{"data":{"status":"ready"}}' }
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
