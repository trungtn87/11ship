# Test helper for tests/local-launcher/launcher.Tests.ps1 (task M00.02). Not a product script.
# It loads the launcher that belongs to ONE checkout (-Launcher), takes that checkout's shared launcher lock through the
# real Use-LaunchLock, holds it for -HoldMs and records when it was inside, so the suite can watch several real
# processes compete for the lock. Exit code: 0 = ran inside the lock, 3 = could not get the lock (message on stderr).
# ASCII on purpose: Windows PowerShell 5.1 reads a BOM-less script as ANSI.
param(
  [Parameter(Mandatory = $true)][string]$Launcher,
  [string]$Id = 'holder',
  [string]$Step = 'holder',
  [string]$ReadyFile = '',
  [string]$EventFile = '',
  [int]$StartDelayMs = 0,
  [int]$HoldMs = 1000
)
$ErrorActionPreference = 'Stop'
. $Launcher

function Write-HelperEvent([string]$What) {
  if (!$EventFile) { return }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
      [IO.File]::AppendAllText($EventFile, ('{0} {1} {2}' -f [DateTime]::UtcNow.Ticks, $Id, $What) + "`n")
      return
    } catch { Start-Sleep -Milliseconds 50 }
  }
}

if ($StartDelayMs -gt 0) { Start-Sleep -Milliseconds $StartDelayMs }
Write-HelperEvent 'try'
try {
  Use-LaunchLock $Step {
    Write-HelperEvent 'enter'
    if ($ReadyFile) { [IO.File]::WriteAllText($ReadyFile, 'ready') }
    Start-Sleep -Milliseconds $HoldMs
    Write-HelperEvent 'exit'
  }
} catch {
  Write-HelperEvent 'failed'
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 3
}
exit 0
