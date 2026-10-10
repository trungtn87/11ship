[CmdletBinding()]
param([ValidateSet('Admin','Food','Ship')][string]$App)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $PSScriptRoot '11ship-launcher.ps1'
function Step([string]$command) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher -Command $command -NoPause
  if ($LASTEXITCODE -ne 0) { throw "11Ship $command failed (exit $LASTEXITCODE). See launcher logs." }
}
function HasScript([string]$name) {
  $package = Get-Content -Raw -LiteralPath (Join-Path $repo 'package.json') | ConvertFrom-Json
  return [bool]($package.scripts.PSObject.Properties.Name -contains $name)
}
try {
  # Update first. Existing M00 guard refuses non-fast-forward and tracked modifications.
  # Never silently launch stale code after a failed update.
  Step 'Update'
  Step 'Start'
  switch ($App) {
    'Admin' {
      if (!(HasScript 'build:admin-web') -or !(HasScript 'admin-web:dev')) {
        throw 'Web Admin is not yet integrated into main. Merge its reviewed PR first.'
      }
      & npm.cmd run build:admin-web
      if ($LASTEXITCODE -ne 0) { throw 'Web Admin build failed.' }
      $port = 8443
      $url = 'https://localhost:8443'
      $probe = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
      if (!$probe) {
        $outDir = Join-Path $repo '.11ship-local\logs'
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
        $out = Join-Path $outDir 'admin-web.out.log'
        $err = Join-Path $outDir 'admin-web.err.log'
        Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/admin-web-dev.mjs' -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
      }
      $ready = $false
      for ($i=0; $i -lt 20; $i++) {
        try {
          $r = & curl.exe -k -s -o NUL -w '%{http_code}' --max-time 2 $url
          if ($LASTEXITCODE -eq 0 -and $r -eq '200') { $ready = $true; break }
        } catch {}
        Start-Sleep -Seconds 1
      }
      if (!$ready) { throw 'Web Admin did not become ready on HTTPS 8443. Check .11ship-local/logs.' }
      Start-Process $url
    }
    'Food' { throw '11Food application is not yet integrated into main. Launcher reserved; no fake success.' }
    'Ship' { throw '11Ship driver application is not yet integrated into main. Launcher reserved; no fake success.' }
  }
  Write-Host "[PASS] $App launched; shared backend remains running." -ForegroundColor Green
  exit 0
} catch {
  Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'No databases or user files were deleted.' -ForegroundColor Yellow
  if ([Environment]::UserInteractive) { [void](Read-Host 'Press Enter to close') }
  exit 1
}
