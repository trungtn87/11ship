$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$tokens=$null; $parseErrors=$null
[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'deploy-11ship.ps1'),[ref]$tokens,[ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
. (Join-Path $root 'deploy-11ship.ps1')
function Assert($ok,[string]$why) { if (-not $ok) { throw "ASSERT: $why" } }
function Assert-Throws([scriptblock]$action,[string]$code) {
  $caught=$false
  try { & $action | Out-Null } catch { $caught=$true; Assert ($_.Exception.Message -like "$code*") "expected $code, got $($_.Exception.Message)" }
  Assert $caught "expected failure $code"
}
$script:Case='green'; $sha='a'*40
function Invoke-Github([string]$Path,[switch]$AllowNotFound) {
  if ($Path -eq 'commits/main') {return [pscustomobject]@{sha=$sha;commit=@{message='feat: release'};author=@{login='owner'}}}
  if ($Path -like 'actions/workflows/ci.yml/runs*') {
    $conclusion='success';if($script:Case -eq 'ci-fails'){$conclusion='failure'}
    return @{workflow_runs=@([pscustomobject]@{id=1;head_sha=$sha;head_branch='main';event='push';status='completed';conclusion=$conclusion})}
  }
  if ($Path -like 'commits/*/check-runs*') {return @{check_runs=@()}}
  if ($Path -like 'commits/*/statuses*') {return @()}
  if ($Path -eq 'branches/main/protection/required_status_checks') {
    if($script:Case -eq 'required-missing'){return @{contexts=@('must-pass');checks=@()}}
    return $null
  }
  if ($Path -eq 'rules/branches/main') {return @()}
  if ($Path -like 'actions/runs/1/artifacts*') {
    $artifactSha=$sha;if($script:Case -eq 'wrong-sha'){$artifactSha='b'*40}
    return @{artifacts=@([pscustomobject]@{id=5;name="11ship-$sha-ubuntu24-amd64";expired=$false;digest=('sha256:'+('c'*64));workflow_run=@{head_sha=$artifactSha}})}
  }
  throw "UNEXPECTED_TEST_ROUTE: $Path"
}
Assert ((Resolve-MainRelease).Sha -eq $sha) 'selects exact green main artifact'
$script:Case='ci-fails'; Assert-Throws {Resolve-MainRelease} 'CI_NOT_GREEN'
$script:Case='wrong-sha'; Assert-Throws {Resolve-MainRelease} 'ARTIFACT_MISSING_OR_WRONG_SHA'
$script:Case='required-missing'; Assert-Throws {Resolve-MainRelease} 'REQUIRED_CHECK_MISSING'
$script:Case='green'
# No network is used. Native ssh command failure is exercised through the actual Invoke-Ssh wrapper.
function ssh { $global:LASTEXITCODE=255 }
Assert-Throws {Invoke-Ssh 'true'} 'SSH_CONNECTION_FAILED'
# Never announce success for a failed/unknown remote receipt.
function Get-Receipt($Job) {return [pscustomobject]@{status='failed';step='migration';reason='MIGRATION_FAILED_CODE_UNCHANGED';service='active';rollback='not-needed'}}
Assert-Throws {Wait-Deployment ('d'*32)} 'DEPLOY_FAILED'
function Get-Receipt($Job) {return [pscustomobject]@{status='unchanged';step='health';sha=$sha;service='active';rollback='not-needed'}}
Assert ((Wait-Deployment ('d'*32)).status -eq 'unchanged') 'no-new-version health result'
# A real ZIP with a tampered digest is refused before extraction or any SSH call.
$work=Join-Path ([IO.Path]::GetTempPath()) ('11ship-test-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $work | Out-Null
try {
  function Invoke-WebRequest {param($UseBasicParsing,$Uri,$Headers,$MaximumRedirection,$TimeoutSec,$OutFile)
    if($OutFile){[IO.File]::WriteAllText($OutFile,'tampered');return}
    return [pscustomobject]@{StatusCode=302;Headers=@{Location='https://fixture.blob.core.windows.net/artifact'}}
  }
  $release=[pscustomobject]@{Sha=$sha;Artifact=@{id=5;digest=('sha256:'+('0'*64))}}
  Assert-Throws {Get-Artifact $release $work} 'ZIP_CHECKSUM_INVALID'
} finally {Remove-Item -LiteralPath $work -Recurse -Force}
Write-Host 'PASS: parser, main/CI/provenance, required check, checksum, SSH loss, failed receipt, no-update result'
