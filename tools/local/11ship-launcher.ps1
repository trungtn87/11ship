[CmdletBinding()]
param(
  [ValidateSet('Menu','Start','Update','Test','Stop','Status','InstallShortcut')]
  [string]$Command = 'Menu',
  [switch]$Yes,
  [switch]$KeepDatabases,
  [switch]$ForceDependencies
)

$ErrorActionPreference = 'Stop'
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:StateDir = Join-Path $script:Repo '.11ship-local'
$script:StateFile = Join-Path $script:StateDir 'backend.json'
$script:InstallState = Join-Path $script:StateDir 'installed-lock.sha256'
$script:MigrationState = Join-Path $script:StateDir 'migrations.sha256'
$script:Logs = Join-Path $script:StateDir 'logs'
$script:Compose = Join-Path $script:Repo 'compose.dev.yml'
$script:EnvFile = Join-Path $script:Repo '.env'

function Write-Info([string]$Message) { Write-Host "[11Ship] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Write-WarnLine([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { throw "[FAIL] $Message" }
function Ensure-Dirs { New-Item -ItemType Directory -Force -Path $script:StateDir,$script:Logs | Out-Null }
function Invoke-InRepo([scriptblock]$Body) { Push-Location $script:Repo; try { & $Body } finally { Pop-Location } }
function Command-Exists([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }
function Run([string]$File,[string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { Fail "$File thất bại (exit $LASTEXITCODE)." }
}
function Capture([string]$File,[string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $value = & $File @Arguments 2>&1; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { return $null }
  return (($value | Out-String).Trim())
}
function File-HashOrEmpty([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return '' }
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}
function Tree-Hash([string]$Path,[string]$Filter='*') {
  if (!(Test-Path -LiteralPath $Path)) { return '' }
  $rows = Get-ChildItem -LiteralPath $Path -File -Recurse -Filter $Filter | Sort-Object FullName | ForEach-Object {
    "{0}:{1}" -f $_.FullName.Substring($Path.Length), (File-HashOrEmpty $_.FullName)
  }
  if (!$rows) { return '' }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($rows -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Read-DotEnvNames {
  if (!(Test-Path -LiteralPath $script:EnvFile)) { Fail 'Thiếu .env. Sao chép từ .env.example và điền secret local.' }
  $result = @{}
  foreach ($line in Get-Content -LiteralPath $script:EnvFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $result[$matches[1]] = $matches[2].Trim() }
  }
  return $result
}
function Assert-LocalEnv {
  $envMap = Read-DotEnvNames
  foreach ($name in @('APP_ENV','DATABASE_URL','DEV_DB_PASSWORD','TEST_DB_PASSWORD','AUTH_OTP_HMAC_SECRET','CRYPTO_ACTIVE_KEY_ID','CRYPTO_KEYRING')) {
    if (!$envMap.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($envMap[$name])) { Fail "Thiếu biến bắt buộc: $name" }
  }
  if ($envMap.APP_ENV -ne 'development') { Fail 'APP_ENV trong .env phải là development cho launcher local.' }
  try { $u = [Uri]$envMap.DATABASE_URL } catch { Fail 'DATABASE_URL local không hợp lệ.' }
  if ($u.Host -notin @('127.0.0.1','localhost') -or $u.Port -ne 5432 -or $u.AbsolutePath -ne '/ship11_dev' -or $u.UserInfo.Split(':')[0] -ne 'ship11_dev') {
    Fail 'DATABASE_URL phải trỏ đúng DB DEV local (ship11_dev@127.0.0.1:5432/ship11_dev).'
  }
  return $envMap
}
function Assert-Tools {
  if ($env:OS -ne 'Windows_NT') { Fail 'Launcher chỉ hỗ trợ Windows.' }
  foreach ($tool in @('git.exe','node.exe','npm.cmd','docker.exe')) { if (!(Command-Exists $tool)) { Fail "Không tìm thấy $tool." } }
  $node = (Capture 'node.exe' @('--version')).TrimStart('v')
  if ($node -ne '24.21.0') { Fail "Node phải là 24.21.0; hiện tại $node." }
  $npm = Capture 'npm.cmd' @('--version')
  if (!$npm.StartsWith('11.')) { Fail "npm phải thuộc major 11; hiện tại $npm." }
  if ($npm -ne '11.9.0') { Write-WarnLine "npm $npm khác bản khóa 11.9.0; CI dùng 11.9.0." }
  Run 'docker.exe' @('info','--format','{{.ServerVersion}}')
  Run 'docker.exe' @('compose','version')
}
function Compose([string[]]$Arguments) { Run 'docker.exe' (@('compose','--env-file',$script:EnvFile,'-f',$script:Compose) + $Arguments) }
function Wait-ContainerHealthy([string]$Name,[int]$TimeoutSeconds=90) {
  $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $state = Capture 'docker.exe' @('inspect','--format','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',$Name)
    if ($state -eq 'healthy') { Write-Ok "$Name healthy"; return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $until)
  Fail "$Name không healthy sau $TimeoutSeconds giây."
}
function Get-BackendState {
  if (!(Test-Path -LiteralPath $script:StateFile)) { return $null }
  try { return Get-Content -Raw -LiteralPath $script:StateFile | ConvertFrom-Json } catch { return $null }
}
function Get-OwnedBackendProcess {
  $state = Get-BackendState
  if (!$state) { return $null }
  $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().ToString('o') -ne $state.startedUtc) { return $null }
  return $process
}
function Http-Status([string]$Url) {
  try { return [int](Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3).StatusCode } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}
function Wait-Backend([int]$TimeoutSeconds=45) {
  $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    if ((Http-Status 'http://127.0.0.1:3000/v1/health/live') -eq 200 -and (Http-Status 'http://127.0.0.1:3000/v1/health/ready') -eq 200) { Write-Ok 'Backend live và ready'; return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $until)
  Fail "Backend chưa ready; xem log trong $script:Logs."
}
function Confirm-Step([string]$Prompt) {
  if ($Yes) { return $true }
  return ((Read-Host "$Prompt [y/N]") -match '^(y|yes)$')
}
function Ensure-Dependencies {
  $lock = File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json')
  $saved = if (Test-Path $script:InstallState) { (Get-Content -Raw $script:InstallState).Trim() } else { '' }
  if ($ForceDependencies -or !(Test-Path (Join-Path $script:Repo 'node_modules')) -or $lock -ne $saved) {
    Write-Info 'Cài dependency đúng lockfile...'
    Invoke-InRepo { Run 'npm.cmd' @('ci') }
    Set-Content -NoNewline -Encoding ascii -LiteralPath $script:InstallState -Value $lock
  } else { Write-Ok 'Dependency không đổi' }
}
function Start-Launcher {
  Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
  Compose @('up','-d','db-dev','db-test')
  Wait-ContainerHealthy 'ship11-db-dev'; Wait-ContainerHealthy 'ship11-db-test'
  $lock = File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json')
  $saved = if (Test-Path $script:InstallState) { (Get-Content -Raw $script:InstallState).Trim() } else { '' }
  if (!(Test-Path (Join-Path $script:Repo 'node_modules')) -or $lock -ne $saved) { Fail 'Dependency thiếu hoặc lockfile đã đổi. Hãy chạy 11Ship-Update trước.' }
  Invoke-InRepo { Run 'npm.cmd' @('run','build') }
  $migrationHash = Tree-Hash (Join-Path $script:Repo 'database\migrations') '*.sql'
  $applied = if (Test-Path $script:MigrationState) { (Get-Content -Raw $script:MigrationState).Trim() } else { '' }
  if ($migrationHash -ne $applied) {
    Write-WarnLine 'Migration DEV mới hoặc chưa được launcher ghi nhận.'
    if (Confirm-Step 'Áp dụng migration vào ship11_dev local?') {
      Invoke-InRepo { Run 'npm.cmd' @('run','db:migrate') }
      Set-Content -NoNewline -Encoding ascii -LiteralPath $script:MigrationState -Value $migrationHash
    } else { Fail 'Đã hủy trước khi chạy backend vì migration DEV chưa được xác nhận.' }
  }
  $owned = Get-OwnedBackendProcess
  if (!$owned) {
    if ((Http-Status 'http://127.0.0.1:3000/v1/health/live') -ne 0) { Fail 'Cổng backend đã có dịch vụ không do launcher quản lý.' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $script:Logs "backend-$stamp.log"; $stderr = Join-Path $script:Logs "backend-$stamp.err.log"
    $p = Start-Process -FilePath 'node.exe' -ArgumentList @('--env-file-if-exists=.env','apps/backend/dist/main.js') -WorkingDirectory $script:Repo -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    @{ pid=$p.Id; startedUtc=$p.StartTime.ToUniversalTime().ToString('o'); commit=(Capture 'git.exe' @('-C',$script:Repo,'rev-parse','HEAD')); stdout=$stdout; stderr=$stderr } | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $script:StateFile
  }
  Wait-Backend
}
function Update-Launcher {
  Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
  Invoke-InRepo {
    if (Capture 'git.exe' @('rev-parse','--git-dir') -eq $null) { Fail 'Không phải Git repo.' }
    foreach ($marker in @('MERGE_HEAD','rebase-merge','rebase-apply','CHERRY_PICK_HEAD','REVERT_HEAD')) { if (Test-Path (Join-Path (Capture 'git.exe' @('rev-parse','--git-dir')) $marker)) { Fail "Git operation đang dở: $marker" } }
    if (Capture 'git.exe' @('symbolic-ref','--short','HEAD') -eq $null) { Fail 'Đang detached HEAD.' }
    if (Capture 'git.exe' @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}') -eq $null) { Fail 'Branch chưa có upstream.' }
    if ((Capture 'git.exe' @('status','--porcelain','--untracked-files=no'))) { Fail 'Có thay đổi tracked; không tự stash.' }
    $oldLock = File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json')
    Run 'git.exe' @('fetch','--prune','origin')
    $upstream = Capture 'git.exe' @('rev-parse','@{u}')
    & git.exe merge-base --is-ancestor HEAD $upstream; if ($LASTEXITCODE -ne 0) { Fail 'Không thể fast-forward tới upstream.' }
    $incoming = @(Capture 'git.exe' @('diff','--name-only','HEAD',$upstream) -split "`r?`n")
    $untracked = @(Capture 'git.exe' @('ls-files','--others','--exclude-standard') -split "`r?`n")
    if (@($incoming | Where-Object { $_ -and $_ -in $untracked }).Count) { Fail 'File untracked sẽ bị upstream ghi đè; dừng an toàn.' }
    Run 'git.exe' @('merge','--ff-only','@{u}')
    $newLock = File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json')
    if ($ForceDependencies -or $oldLock -ne $newLock -or !(Test-Path (Join-Path $script:Repo 'node_modules'))) { Ensure-Dependencies }
    $migrationHash = Tree-Hash (Join-Path $script:Repo 'database\migrations') '*.sql'
    $applied = if (Test-Path $script:MigrationState) { (Get-Content -Raw $script:MigrationState).Trim() } else { '' }
    if ($migrationHash -ne $applied) { Write-WarnLine 'Có migration DEV chưa ghi nhận. Start sẽ hỏi trước khi áp dụng.' }
  }
  Write-Ok 'Cập nhật fast-forward hoàn tất'
}
function Test-Launcher {
  Ensure-Dirs; Assert-Tools; $envMap = Assert-LocalEnv
  Compose @('up','-d','db-test'); Wait-ContainerHealthy 'ship11-db-test'
  Ensure-Dependencies
  $oldApp=$env:APP_ENV; $oldDb=$env:DATABASE_URL; $oldNode=$env:NODE_ENV
  $env:APP_ENV='test'; $env:NODE_ENV='test'; $env:DATABASE_URL="postgres://ship11_test:$($envMap.TEST_DB_PASSWORD)@127.0.0.1:5433/ship11_test"
  try {
    $u=[Uri]$env:DATABASE_URL
    if ($u.Host -ne '127.0.0.1' -or $u.Port -ne 5433 -or $u.AbsolutePath -ne '/ship11_test' -or $u.UserInfo.Split(':')[0] -ne 'ship11_test') { Fail 'Guard TEST từ chối database đích.' }
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $sha=Capture 'git.exe' @('-C',$script:Repo,'rev-parse','HEAD'); $summary=@()
    foreach ($step in @(
      @('lint','run','lint'), @('typecheck','run','typecheck'), @('build','run','build'), @('deploy','run','deploy:test'),
      @('unit','run','test:unit'), @('migrate-test','run','db:migrate'), @('integration-local','run','test:integration'), @('progress-test','run','progress:test'), @('progress-check','run','progress:check')
    )) {
      $name=$step[0]; $log=Join-Path $script:Logs "$stamp-$name.log"; Write-Info "Test: $name"
      if ($name -eq 'progress-check' -and !$env:GITHUB_TOKEN -and !$env:GH_TOKEN) {
        $summary += [pscustomobject]@{step=$name;result='SKIP';exitCode=0;log='Cần GITHUB_TOKEN hoặc GH_TOKEN; CI vẫn chạy check tương ứng.'}
        Write-WarnLine 'Bỏ qua progress-check vì máy Owner không có GitHub token.'
        continue
      }
      Push-Location $script:Repo
      try { & npm.cmd @($step[1..($step.Count-1)]) *> $log; $code=$LASTEXITCODE } finally { Pop-Location }
      $summary += [pscustomobject]@{step=$name;result=if($code -eq 0){'PASS'}else{'FAIL'};exitCode=$code;log=$log}
      if ($code -ne 0) { break }
    }
    $result = if (@($summary | Where-Object result -eq 'FAIL').Count) {'FAIL'} else {'PASS'}
    @{timestamp=(Get-Date).ToUniversalTime().ToString('o');commit=$sha;result=$result;steps=$summary} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $script:StateDir 'last-test.json')
    $summary | Format-Table -AutoSize
    if ($result -ne 'PASS') { Fail 'Test FAIL; xem log phía trên.' }
  } finally { $env:APP_ENV=$oldApp; $env:DATABASE_URL=$oldDb; $env:NODE_ENV=$oldNode }
  Write-Ok 'Toàn bộ local test PASS'
}
function Stop-Launcher {
  Ensure-Dirs
  $p=Get-OwnedBackendProcess
  if ($p) { Stop-Process -Id $p.Id; $p.WaitForExit(10000) | Out-Null; Write-Ok 'Đã dừng backend do launcher quản lý' }
  elseif (Test-Path $script:StateFile) { Write-WarnLine 'State backend cũ/không khớp; không dừng process khác.' }
  Remove-Item -LiteralPath $script:StateFile -Force -ErrorAction SilentlyContinue
  if (!$KeepDatabases) { $null=Assert-LocalEnv; Compose @('stop','db-dev','db-test'); Write-Ok 'Đã dừng DB; volume DEV được giữ nguyên' }
}
function Status-Launcher {
  Ensure-Dirs
  Write-Info "Repo: $script:Repo"
  $branch=Capture 'git.exe' @('-C',$script:Repo,'branch','--show-current'); $up=Capture 'git.exe' @('-C',$script:Repo,'rev-parse','--abbrev-ref','@{u}')
  $dirty=[bool](Capture 'git.exe' @('-C',$script:Repo,'status','--porcelain'))
  Write-Host "Git: branch=$branch upstream=$up dirty=$dirty"
  foreach($pair in @(@('Node','node.exe','--version'),@('npm','npm.cmd','--version'),@('Docker','docker.exe','--version'))) { if(Command-Exists $pair[1]){ Write-Host "$($pair[0]): $(Capture $pair[1] @($pair[2]))" } else { Write-Host "$($pair[0]): không có" } }
  if (Command-Exists 'docker.exe') { & docker.exe compose --env-file $script:EnvFile -f $script:Compose ps 2>$null }
  $p=Get-OwnedBackendProcess; Write-Host "Backend launcher PID: $(if($p){$p.Id}else{'không chạy'})"
  Write-Host "Health live=$(Http-Status 'http://127.0.0.1:3000/v1/health/live') ready=$(Http-Status 'http://127.0.0.1:3000/v1/health/ready')"
  Write-Host 'Web quản trị / Khách / Quán / Xế / App quản lý: N/A — chưa có trong repo'
  $last=Join-Path $script:StateDir 'last-test.json'; if(Test-Path $last){$s=Get-Content -Raw $last|ConvertFrom-Json; Write-Host "Test gần nhất: $($s.result), commit=$($s.commit), $($s.timestamp)"}else{Write-Host 'Test gần nhất: chưa có summary hợp lệ'}
}
function Install-Shortcut {
  $desktop=[Environment]::GetFolderPath('Desktop'); $target=Join-Path $PSScriptRoot '11Ship.cmd'; $link=Join-Path $desktop '11Ship Test.lnk'
  $shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut($link); $shortcut.TargetPath=$target; $shortcut.WorkingDirectory=$script:Repo; $shortcut.Save(); Write-Ok "Đã tạo shortcut: $link"
}
function Menu {
  Write-Host "`n11Ship Local Test Launcher" -ForegroundColor Yellow
  Write-Host '1 Start  2 Update  3 Test  4 Stop  5 Status  6 Tạo shortcut  0 Thoát'
  switch(Read-Host 'Chọn'){'1'{Start-Launcher};'2'{Update-Launcher};'3'{Test-Launcher};'4'{Stop-Launcher};'5'{Status-Launcher};'6'{Install-Shortcut};default{return}}
}
if ($MyInvocation.InvocationName -ne '.') {
  try {
    switch($Command){'Start'{Start-Launcher};'Update'{Update-Launcher};'Test'{Test-Launcher};'Stop'{Stop-Launcher};'Status'{Status-Launcher};'InstallShortcut'{Install-Shortcut};default{Menu}}
    exit 0
  } catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
}
