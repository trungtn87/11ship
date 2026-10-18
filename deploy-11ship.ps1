#requires -Version 5.1
<#
11SHIP AUTO DEPLOY. One command, no SHA/path/SQL input. Never stores or reads an SSH password.
Reuses CI's Ubuntu artifact, existing db-migrate-remote.js, grants and systemd service.
Dot-source loads functions only for the offline Windows/PowerShell 7 contract tests.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$script:Repo = 'trungtn87/11ship'
$script:Api = 'https://api.github.com'
$script:Target = 'root@103.9.78.67'
$script:SshOptions = @('-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3')
$script:KeyOptions = @()
$script:Headers = @{Accept='application/vnd.github+json'; 'X-GitHub-Api-Version'='2022-11-28'; 'User-Agent'='11ship-one-click'}

function Invoke-Github([string]$Path, [switch]$AllowNotFound) {
  try { return Invoke-RestMethod -Uri "$script:Api/repos/$script:Repo/$Path" -Headers $script:Headers -TimeoutSec 30 }
  catch { if ($AllowNotFound -and $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { return $null }; throw 'GITHUB_ACCESS_FAILED: Khong truy cap duoc GitHub. Can quyen doc repo va Actions; dang nhap GitHub CLI mot lan neu repo rieng tu.' }
}
function Read-AllPages([string]$Path, [string]$Field='') {
  $out = @(); $separator = '?'; if ($Path.Contains('?')) { $separator='&' }
  for ($page=1; $page -le 100; $page++) {
    $r = Invoke-Github ($Path + $separator + "per_page=100&page=$page")
    if ($Field) { $items=@($r.$Field) } else { $items=@($r) }
    $out += $items
    if ($items.Count -lt 100) { return $out }
  }
  throw 'GITHUB_PAGINATION_LIMIT'
}
function Resolve-MainRelease {
  $main = Invoke-Github 'commits/main'
  $sha = $main.sha; $mainHead=$sha
  # Progress bot intentionally skips CI. Only its exact docs-only commits may be traversed.
  for ($n=0; $n -lt 50; $n++) {
    if ($main.commit.message -notmatch '^chore\(progress\): update docs/PROGRESS\.md \[skip ci\]') { break }
    if ($main.author.login -ne 'github-actions[bot]' -or @($main.files).Count -ne 1 -or $main.files[0].filename -ne 'docs/PROGRESS.md' -or @($main.parents).Count -ne 1) { throw 'MAIN_SKIP_CI_NOT_PROVEN' }
    $sha=$main.parents[0].sha
    $main=Invoke-Github "commits/$sha"
  }
  if ($sha -notmatch '^[0-9a-f]{40}$') { throw 'MAIN_SHA_INVALID' }
  $runs=@(Read-AllPages "actions/workflows/ci.yml/runs?head_sha=$sha&branch=main&event=push" 'workflow_runs')
  $run=$runs | Sort-Object id -Descending | Select-Object -First 1
  if (-not $run -or $run.head_sha -ne $sha -or $run.head_branch -ne 'main' -or $run.event -ne 'push' -or $run.status -ne 'completed' -or $run.conclusion -ne 'success') { throw 'CI_NOT_GREEN: CI cua ban main moi nhat chua thanh cong. Khong lui sang ban cu.' }
  $checks=@(Read-AllPages "commits/$sha/check-runs" 'check_runs')
  # Any failure/pending check on the source SHA is a stop, even if not named in protection.
  foreach ($group in ($checks | Group-Object name)) {
    $check=$group.Group | Sort-Object id -Descending | Select-Object -First 1
    if ($check.status -ne 'completed' -or $check.conclusion -notin @('success','skipped','neutral')) { throw 'CHECK_NOT_GREEN' }
  }
  $statuses=@(Read-AllPages "commits/$sha/statuses")
  foreach ($group in ($statuses | Group-Object context)) {
    if (($group.Group | Sort-Object id -Descending | Select-Object -First 1).state -ne 'success') { throw 'STATUS_NOT_GREEN' }
  }
  # Effective rulesets expose required contexts without requiring repository administration rights.
  $classic=Invoke-Github 'branches/main/protection/required_status_checks' -AllowNotFound
  if ($classic) {
    foreach ($name in $classic.contexts) {
      $check=@($checks | Where-Object name -eq $name | Sort-Object id -Descending)
      $status=@($statuses | Where-Object context -eq $name | Sort-Object id -Descending)
      if ($check.Count) { if ($check[0].status -ne 'completed' -or $check[0].conclusion -ne 'success') { throw 'REQUIRED_CHECK_NOT_GREEN' } }
      elseif (-not $status.Count -or $status[0].state -ne 'success') { throw 'REQUIRED_CHECK_MISSING' }
    }
    foreach ($bound in $classic.checks) {
      if ($null -ne $bound.app_id -and $bound.app_id -ne -1) {
        $matched=@($checks | Where-Object { $_.name -eq $bound.context -and $_.app.id -eq $bound.app_id } | Sort-Object id -Descending)
        if (-not $matched.Count -or $matched[0].status -ne 'completed' -or $matched[0].conclusion -ne 'success') { throw 'REQUIRED_APP_CHECK_MISSING' }
      }
    }
  }
  $rules=@(Invoke-Github 'rules/branches/main')
  foreach ($rule in @($rules | Where-Object type -eq 'required_status_checks')) {
    foreach ($required in $rule.parameters.required_status_checks) {
      $matching=@($checks | Where-Object { $_.name -eq $required.context -and ($null -eq $required.integration_id -or $_.app.id -eq $required.integration_id) } | Sort-Object id -Descending)
      $status=@($statuses | Where-Object context -eq $required.context | Sort-Object id -Descending)
      if ($matching.Count) { if ($matching[0].status -ne 'completed' -or $matching[0].conclusion -ne 'success') { throw 'REQUIRED_CHECK_NOT_GREEN' } }
      elseif (-not $status.Count -or $status[0].state -ne 'success') { throw 'REQUIRED_CHECK_MISSING' }
    }
  }
  $artifacts=@(Read-AllPages "actions/runs/$($run.id)/artifacts" 'artifacts')
  $artifact=$artifacts | Where-Object { $_.name -eq "11ship-$sha-ubuntu24-amd64" -and -not $_.expired } | Sort-Object id -Descending | Select-Object -First 1
  if (-not $artifact -or $artifact.workflow_run.head_sha -ne $sha -or $artifact.digest -notmatch '^sha256:[0-9a-f]{64}$') { throw 'ARTIFACT_MISSING_OR_WRONG_SHA' }
  return [pscustomobject]@{Sha=$sha; Main=$mainHead; Run=$run.id; Artifact=$artifact}
}
function Get-Artifact([object]$Release, [string]$Directory) {
  $url="$script:Api/repos/$script:Repo/actions/artifacts/$($Release.Artifact.id)/zip"
  $response=$null
  try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $script:Headers -MaximumRedirection 0 -TimeoutSec 30 }
  catch { $response=$_.Exception.Response }
  if (-not $response -or [int]$response.StatusCode -ne 302) { throw 'ARTIFACT_DOWNLOAD_AUTH_FAILED' }
  $location=[string]$response.Headers.Location
  if (-not $location) { $location=[string]$response.Headers['Location'] }
  $uri=[Uri]$location
  if ($uri.Scheme -ne 'https' -or $uri.Host -notmatch '(\.blob\.core\.windows\.net|\.githubusercontent\.com|\.github\.com)$') { throw 'ARTIFACT_REDIRECT_INVALID' }
  $zip=Join-Path $Directory 'artifact.zip'
  # No Authorization header is forwarded to the signed storage URL.
  try { Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $zip -TimeoutSec 120 | Out-Null } catch { throw 'ARTIFACT_DOWNLOAD_FAILED' }
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Release.Artifact.digest.Substring(7)) { throw 'ZIP_CHECKSUM_INVALID' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive=[IO.Compression.ZipFile]::OpenRead($zip)
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -match '(^/|^[A-Za-z]:|\\|(^|/)\.\.(/|$))') { throw 'ZIP_PATH_INVALID' }
    }
  } finally { $archive.Dispose() }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $Directory 'unpacked')
  $packageName="11ship-$($Release.Sha)-ubuntu24-amd64.tar.gz"
  $packages=@(Get-ChildItem (Join-Path $Directory 'unpacked') -Recurse -File -Filter $packageName)
  if ($packages.Count -ne 1) { throw 'PACKAGE_MISSING' }
  $package=$packages[0].FullName; $side="$package.sha256"
  if (-not (Test-Path -LiteralPath $side)) { throw 'CHECKSUM_MISSING' }
  $hash=(Get-FileHash $package -Algorithm SHA256).Hash.ToLowerInvariant()
  if ([IO.File]::ReadAllText($side).Trim() -cne "$hash  $packageName") { throw 'CHECKSUM_INVALID' }
  $top="11ship-$($Release.Sha)-ubuntu24-amd64"
  $manifest=(& tar -xOf $package "$top/MANIFEST.sha256" 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'MANIFEST_MISSING' }
  $metadata=(& tar -xOf $package "$top/RELEASE.json" 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0 -or ($metadata | ConvertFrom-Json).sourceSha -ne $Release.Sha) { throw 'RELEASE_SHA_INVALID' }
  $helper=(& tar -xOf $package "$top/scripts/deploy/deploy-vps.sh" 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'HELPER_MISSING' }
  $helperFile=Join-Path $Directory 'deploy-vps.sh'
  [IO.File]::WriteAllText($helperFile, "$helper`n", (New-Object Text.UTF8Encoding($false)))
  $helperHash=(Get-FileHash $helperFile -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($manifest -notmatch "(?m)^$helperHash  scripts/deploy/deploy-vps\.sh$") { throw 'HELPER_MANIFEST_INVALID' }
  return [pscustomobject]@{Package=$package; Checksum=$side; Helper=$helperFile; Hash=$hash}
}
function Invoke-Ssh([string]$Command, [switch]$AllowFailure) {
  $ErrorActionPreference = 'Continue'
  $output=@(& ssh @script:SshOptions @script:KeyOptions -o BatchMode=yes $script:Target $Command 2>$null)
  $code=$LASTEXITCODE
  if ($code -ne 0 -and -not $AllowFailure) { throw 'SSH_CONNECTION_FAILED: Ket noi mat; tac vu VPS co the van dang chay. Chay lai script de kiem tra, khong tu khoi dong lai service.' }
  return [pscustomobject]@{Code=$code; Text=($output -join "`n")}
}
function Initialize-Ssh {
  # Require a previously verified host key; never accept an arbitrary server key automatically.
  & ssh-keygen -F '103.9.78.67' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'SSH_HOST_KEY_UNKNOWN: Can xac minh host key VPS mot lan bang OpenSSH; khong tu dong tin khoa la.' }
  $keyDir=Join-Path $env:LOCALAPPDATA '11Ship\ssh'; $key=Join-Path $keyDir 'deploy_ed25519'
  if (Test-Path -LiteralPath $key) { $script:KeyOptions=@('-i',$key,'-o','IdentitiesOnly=yes') }
  if ((Invoke-Ssh 'true' -AllowFailure).Code -eq 0) { return }
  # Try the user's normal agent/default key before provisioning our dedicated key.
  $script:KeyOptions=@()
  if ((Invoke-Ssh 'true' -AllowFailure).Code -eq 0) { return }
  if (-not (Test-Path -LiteralPath $key)) {
    New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
    $account=[Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls $keyDir /inheritance:r /grant:r "${account}:(OI)(CI)F" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0 -or $key.Contains('"')) { throw 'SSH_KEY_ACL_FAILED' }
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=(Get-Command ssh-keygen).Source
    $info.Arguments='-q -t ed25519 -N "" -f "' + $key + '"'
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $process=[Diagnostics.Process]::Start($info); $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'SSH_KEY_GENERATION_FAILED' }
  }
  $public=[IO.File]::ReadAllText("$key.pub").Trim()
  if ($public -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$') { throw 'SSH_PUBLIC_KEY_INVALID' }
  # Public material only. Bootstrap stdin never contains the SSH password; OpenSSH owns its console prompt.
  $public=($public -split ' ')[0..1] -join ' '
  $bootstrap="umask 077`nmkdir -p /root/.ssh`ntouch /root/.ssh/authorized_keys`ngrep -qxF '$public' /root/.ssh/authorized_keys || printf '%s\n' '$public' >> /root/.ssh/authorized_keys`nchmod 700 /root/.ssh`nchmod 600 /root/.ssh/authorized_keys`n"
  $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bootstrap))
  Write-Host 'Nhap mat khau SSH mot lan de cai khoa deploy rieng (OpenSSH khong hien ky tu).'
  & ssh @script:SshOptions -o PubkeyAuthentication=no -o PreferredAuthentications=keyboard-interactive,password -o NumberOfPasswordPrompts=1 $script:Target "printf '%s' '$encoded' | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { throw 'SSH_KEY_BOOTSTRAP_FAILED' }
  $script:KeyOptions=@('-i',$key,'-o','IdentitiesOnly=yes')
  if ((Invoke-Ssh 'true' -AllowFailure).Code -ne 0) { throw 'SSH_KEY_LOGIN_DISABLED: Khoa da cai nhung VPS chua cho phep dang nhap bang khoa; khong tu sua sshd.' }
}
function Send-File([string]$File, [string]$Remote) {
  & scp @script:SshOptions @script:KeyOptions -o BatchMode=yes $File "${script:Target}:$Remote" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'SCP_FAILED: Chua doi release. Co the chay lai.' }
}
function Get-Receipt([string]$Job) {
  $r=Invoke-Ssh "test ! -f /var/lib/11ship-deploy/$Job.json || cat /var/lib/11ship-deploy/$Job.json"
  if ($r.Text) { return $r.Text | ConvertFrom-Json }
  return $null
}
function Wait-Deployment([string]$Job) {
  $last=''; $stageNames=@{connect='[1/8] Ket noi VPS';package='[4/8] Kiem tra goi';preflight='[4/8] Migration preflight';backup='[5/8] Sao luu database';migration='[6/8] Migration';restart='[7/8] Khoi dong dich vu';health='[8/8] Kiem tra hoat dong'}
  for ($i=0; $i -lt 360; $i++) {
    $receipt=Get-Receipt $Job
    if ($receipt) {
      if ($receipt.step -ne $last) { Write-Host $stageNames[$receipt.step]; $last=$receipt.step }
      if ($receipt.status -in @('success','unchanged')) { return $receipt }
      if ($receipt.status -eq 'failed') { throw "DEPLOY_FAILED: Buoc=$($receipt.step); Nguyen nhan=$($receipt.reason); Service=$($receipt.service); Rollback=$($receipt.rollback). Khong tu restore database." }
    }
    if ($i -ge 2) {
      $unit=Invoke-Ssh "systemctl show 11ship-deploy-$Job --property=ActiveState --value" -AllowFailure
      if ($unit.Code -ne 0 -or $unit.Text -notin @('active','activating','deactivating')) {
        $final=Get-Receipt $Job
        if ($final -and $final.status -in @('success','unchanged')) { return $final }
        throw 'REMOTE_JOB_ENDED_UNKNOWN: Tac vu VPS da dung; schema co the da thay doi. Khong tu rollback hoac chay lai migration.'
      }
    }
    Start-Sleep -Seconds 5
  }
  throw 'DEPLOY_WAIT_TIMEOUT: Chua xac dinh ket qua. Tac vu VPS khong bi huy; chay lai script de xem trang thai.'
}
function Get-GithubToken {
  $ErrorActionPreference='Continue'
  if ($env:GH_TOKEN) { return $env:GH_TOKEN }
  if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
  if (Get-Command gh -ErrorAction SilentlyContinue) {
    $value=(& gh auth token 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -eq 0) { return $value }
  }
  return $null
}
function Start-11ShipDeploy {
  $timer=[Diagnostics.Stopwatch]::StartNew(); $work=$null; $job=$null; $phase='github'; $sshReady=$false
  Write-Host "`n11SHIP AUTO DEPLOY`n"
  try {
    if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
    foreach ($cmd in 'ssh','scp','ssh-keygen','tar') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "TOOL_MISSING: $cmd. Can Windows OpenSSH Client va tar." } }
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    $token=Get-GithubToken
    if ($token) { $script:Headers.Authorization="Bearer $token" }
    $release=Resolve-MainRelease
    $phase='ssh'
    Initialize-Ssh
    $sshReady=$true
    Write-Host '[1/8] Ket noi VPS OK'
    Write-Host "[2/8] GitHub CI OK - $($release.Sha.Substring(0,7))"
    # Reattach to an interrupted deployment before uploading/starting another one.
    $prior=Invoke-Ssh "test ! -f /var/lib/11ship-deploy/last-job || cat /var/lib/11ship-deploy/last-job"
    if ($prior.Text -match '^[0-9a-f]{32}$') {
      $receipt=Get-Receipt $prior.Text
      if ($receipt -and $receipt.status -eq 'running') { $job=$prior.Text; $result=Wait-Deployment $job; if ($result.sha -eq $release.Sha) { return $result } }
    }
    $probe=@'
set -eu
sha=$(node -p 'JSON.parse(require("fs").readFileSync("/opt/11ship/current/RELEASE.json","utf8")).sourceSha')
printf '%s' "$sha"
'@
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probe))
    $running=(Invoke-Ssh "printf '%s' '$encoded' | base64 -d | bash").Text
    if ($running -eq $release.Sha) {
      $healthProbe=@'
set -eu
systemctl is-active --quiet 11ship-staging
test "$(env -u APP_ENV node --env-file=/etc/11ship/staging.env -p 'process.env.APP_ENV')" = production
test "$(curl -fsS --max-time 10 http://127.0.0.1:3000/v1/health/ready)" = '{"data":{"status":"ready"}}'
test "$(curl -fsS --max-time 10 https://103.9.78.67.sslip.io/v1/health/ready)" = '{"data":{"status":"ready"}}'
curl -fsS --max-time 15 https://103.9.78.67.sslip.io/ | cmp -s - /opt/11ship/current/apps/admin-web/dist/index.html
test "$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d ship11_staging -c 'SELECT current_database()')" = ship11_staging
'@
      $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($healthProbe))
      Invoke-Ssh "printf '%s' '$encoded' | base64 -d | bash" | Out-Null
      return [pscustomobject]@{status='unchanged';sha=$release.Sha;service='active';rollback='not-needed'}
    }
    $work=Join-Path ([IO.Path]::GetTempPath()) ('11ship-'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work | Out-Null
    $phase='package'
    $package=Get-Artifact $release $work
    Write-Host '[3/8] Tai phien ban moi OK'
    $job=[Guid]::NewGuid().ToString('N'); $upload="/root/11ship-upload/$job"
    Invoke-Ssh "umask 077; mkdir -p $upload" | Out-Null
    Send-File $package.Package $upload
    Send-File $package.Checksum $upload
    Send-File $package.Helper $upload
    # Recheck exact main selection immediately before delegating production changes.
    $latest=Resolve-MainRelease
    if ($latest.Sha -ne $release.Sha) { throw 'MAIN_CHANGED: Main da thay doi; chay lai de lay ban moi nhat.' }
    $hash=(Get-FileHash $package.Helper -Algorithm SHA256).Hash.ToLowerInvariant()
    $phase='remote-deploy'
    $command="echo '$hash  $upload/deploy-vps.sh' | sha256sum -c - >/dev/null && chmod 700 $upload/deploy-vps.sh && systemd-run --quiet --unit=11ship-deploy-$job --property=Type=exec --property=RuntimeMaxSec=1800 /bin/bash $upload/deploy-vps.sh $($release.Sha) $job $upload"
    Invoke-Ssh $command | Out-Null
    $result=Wait-Deployment $job
    if ($result.sha -ne $release.Sha) { throw 'RECEIPT_SHA_MISMATCH' }
    return $result
  } catch {
    # Only controlled codes are surfaced. Never print exception dumps, request headers or child-process logs.
    $message=$_.Exception.Message
    if ($message -notmatch '^[A-Z][A-Z0-9_]+(?::|$)') { $message='UNEXPECTED_ERROR: Da dung. Khong hien chi tiet co the chua bi mat.' }
    Write-Host "`nDEPLOY THAT BAI`nBuoc: $phase`n$message" -ForegroundColor Red
    $service='chua-kiem-tra'; $rollback='chua-bat-dau'
    if ($sshReady) {
      try { $state=Invoke-Ssh 'systemctl is-active 11ship-staging' -AllowFailure; if ($state.Text -match '^[a-z-]+$') { $service=$state.Text } } catch { $service='chua-xac-dinh' }
    }
    if ($job) { $rollback='xem-receipt-hoac-chua-xac-dinh' }
    Write-Host "Service: $service; Rollback: $rollback"
    if ($job) { Write-Host "Ma phien: $job. Mat SSH khong co nghia la deploy da dung; chay lai script de kiem tra." }
    throw '11SHIP_DEPLOY_STOPPED'
  } finally {
    $script:Headers.Remove('Authorization'); $token=$null
    if ($work -and (Test-Path $work)) { Remove-Item -Recurse -Force -LiteralPath $work }
    Write-Host ('Thoi gian: {0:n0} giay' -f $timer.Elapsed.TotalSeconds)
  }
}
if ($MyInvocation.InvocationName -ne '.') {
  try {
    $result=Start-11ShipDeploy
    if ($result.status -eq 'unchanged') { Write-Host 'KHONG CAN DEPLOY - ban moi nhat da chay va health OK' -ForegroundColor Green }
    else { Write-Host 'DEPLOY THANH CONG' -ForegroundColor Green }
    Write-Host "Phien ban: $($result.sha)`nWeb Admin: https://103.9.78.67.sslip.io`nDatabase: Giu nguyen"
  } catch { exit 1 }
}
