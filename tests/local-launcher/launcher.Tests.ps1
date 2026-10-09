$ErrorActionPreference = 'Stop'
$scriptPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..\tools\local\11ship-launcher.ps1')).Path
. $scriptPath

$failures = [Collections.Generic.List[string]]::new()
function Check([bool]$Condition,[string]$Name) {
  if ($Condition) { Write-Host "PASS $Name" -ForegroundColor Green }
  else { Write-Host "FAIL $Name" -ForegroundColor Red; $failures.Add($Name) }
}

Check ((Tree-Hash (Join-Path $script:Repo 'database\migrations') '*.sql').Length -eq 64) 'migration tree hash is deterministic SHA-256'
Check ((File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json')).Length -eq 64) 'lockfile hash is SHA-256'
Check ((Get-BackendState) -eq $null) 'missing backend state is safe'
Check ((Http-Status 'http://127.0.0.1:1/not-listening') -eq 0) 'unreachable HTTP is reported as zero'

$source = Get-Content -Raw -Encoding utf8 -LiteralPath $scriptPath
foreach ($forbidden in @('reset --hard','down -v','db:migrate:remote','git stash','push --force')) {
  Check (!$source.Contains($forbidden)) "source excludes forbidden operation: $forbidden"
}
foreach ($required in @("'--ff-only'","'ship11_test'","'ship11_dev'",'TEST_DB_PASSWORD','Stop-Process','Start-Process')) {
  Check ($source.Contains($required)) "source contains safety control: $required"
}

$wrappers = Get-ChildItem -LiteralPath (Split-Path $scriptPath) -Filter '*.cmd'
Check ($wrappers.Count -eq 6) 'menu plus five command wrappers exist'
foreach ($wrapper in $wrappers) {
  $text = Get-Content -Raw -LiteralPath $wrapper.FullName
  Check ($text.Contains('powershell.exe -NoProfile -ExecutionPolicy Bypass')) "$($wrapper.Name) invokes Windows PowerShell explicitly"
  Check ($text.Contains('exit /b %code%')) "$($wrapper.Name) preserves exit code"
}

if ($failures.Count) { throw "$($failures.Count) launcher tests failed: $($failures -join ', ')" }
Write-Host 'All launcher tests passed.' -ForegroundColor Green
