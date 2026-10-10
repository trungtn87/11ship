[CmdletBinding()]
param(
  [ValidateSet('Menu','Start','Update','Test','Stop','Status','InstallShortcut')]
  [string]$Command = 'Menu',
  [switch]$Yes,
  [switch]$KeepDatabases,
  [switch]$ForceDependencies,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$script:Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:StateDir = Join-Path $script:Repo '.11ship-local'
$script:StateFile = Join-Path $script:StateDir 'backend.json'
$script:InstallState = Join-Path $script:StateDir 'installed-lock.sha256'
$script:LastTest = Join-Path $script:StateDir 'last-test.json'
$script:LastRun = Join-Path $script:StateDir 'last-run.json'
$script:Logs = Join-Path $script:StateDir 'logs'
$script:Compose = Join-Path $script:Repo 'compose.dev.yml'
$script:EnvFile = Join-Path $script:Repo '.env'
$script:ExtraSecrets = @()

function Write-Info([string]$Message) { Write-Host "[11Ship] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "[PASS] $Message" -ForegroundColor Green }
function Write-WarnLine([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
# Every guard failure carries a stable ASCII code so Owner can quote it and tests can assert on it.
function Fail([string]$Message,[string]$Code='') {
  if ($Code) { throw "[FAIL] $Message (mã lỗi: $Code)" }
  throw "[FAIL] $Message"
}
function Ensure-Dirs { New-Item -ItemType Directory -Force -Path $script:StateDir,$script:Logs | Out-Null }
function Invoke-InRepo([scriptblock]$Body) { Push-Location -LiteralPath $script:Repo; try { & $Body } finally { Pop-Location } }
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

# ---------------------------------------------------------------------------------------------
# .env and secrets
# ---------------------------------------------------------------------------------------------
function ConvertFrom-DotEnvValue([string]$Raw) {
  $value = "$Raw".Trim()
  if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[$value.Length-1] -eq '"') -or ($value[0] -eq "'" -and $value[$value.Length-1] -eq "'"))) {
    return $value.Substring(1, $value.Length - 2)
  }
  return ($value -replace '\s+#.*$','')
}
function Read-DotEnvFile {
  $result = @{}
  if (!(Test-Path -LiteralPath $script:EnvFile)) { return $result }
  foreach ($line in Get-Content -LiteralPath $script:EnvFile -Encoding UTF8) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $result[$matches[1]] = ConvertFrom-DotEnvValue $matches[2] }
  }
  return $result
}
function Read-DotEnvNames {
  if (!(Test-Path -LiteralPath $script:EnvFile)) { Fail 'Thiếu .env. Sao chép từ .env.example và điền secret local.' 'ENV_FILE_MISSING' }
  return Read-DotEnvFile
}
# Values that must never reach the console or a log file. Best effort: never throws.
function Get-KnownSecrets {
  $list = @()
  try {
    $envMap = Read-DotEnvFile
    foreach ($key in @($envMap.Keys)) {
      if ($key -notmatch '(?i)(PASSWORD|SECRET|KEYRING|TOKEN|DATABASE_URL)') { continue }
      $value = [string]$envMap[$key]
      # A URL is kept readable in logs; only its password is a secret.
      if ($key -notmatch '(?i)DATABASE_URL') { $list += $value }
      if ($key -match '(?i)KEYRING') { foreach ($entry in $value.Split(',')) { $i = $entry.IndexOf(':'); if ($i -ge 0) { $list += $entry.Substring($i + 1) } } }
      if ($key -match '(?i)DATABASE_URL') {
        $m = [regex]::Match($value, '://[^:/@\s]*:(.*)@')
        if ($m.Success) { $list += $m.Groups[1].Value; try { $list += [Uri]::UnescapeDataString($m.Groups[1].Value) } catch { } }
      }
    }
  } catch { }
  return @($list + $script:ExtraSecrets)
}
function Protect-Text([string]$Text,[string[]]$Secrets=@()) {
  if ([string]::IsNullOrEmpty($Text)) { return $Text }
  $out = $Text
  foreach ($secret in @($Secrets | Where-Object { $_ -and $_.Length -ge 4 } | Sort-Object -Property Length -Descending)) { $out = $out.Replace($secret, '***') }
  return [regex]::Replace($out, '(?i)\b([a-z][a-z0-9+.\-]*://)([^\s/:@]*):([^\s/@]*)@', '$1$2:***@')
}
function Assert-LocalEnv {
  $envMap = Read-DotEnvNames
  foreach ($name in @('APP_ENV','DATABASE_URL','DEV_DB_PASSWORD','TEST_DB_PASSWORD','AUTH_OTP_HMAC_SECRET','CRYPTO_ACTIVE_KEY_ID','CRYPTO_KEYRING')) {
    if (!$envMap.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($envMap[$name])) { Fail "Thiếu biến bắt buộc: $name" 'ENV_VARIABLE_MISSING' }
  }
  if ($envMap.APP_ENV -ne 'development') { Fail 'APP_ENV trong .env phải là development cho launcher local.' 'ENV_NOT_DEVELOPMENT' }
  $u = $null
  try { $u = [Uri]$envMap.DATABASE_URL } catch { }
  if (!$u -or $u.Host -notin @('127.0.0.1','localhost') -or $u.Port -ne 5432 -or $u.AbsolutePath -ne '/ship11_dev' -or $u.UserInfo.Split(':')[0] -ne 'ship11_dev') {
    Fail 'DATABASE_URL phải trỏ đúng DB DEV local (ship11_dev@127.0.0.1:5432/ship11_dev).' 'DEV_TARGET_GUARD'
  }
  return $envMap
}
function Assert-Tools {
  if ($env:OS -ne 'Windows_NT') { Fail 'Launcher chỉ hỗ trợ Windows.' 'NOT_WINDOWS' }
  foreach ($tool in @('git.exe','node.exe','npm.cmd')) { if (!(Command-Exists $tool)) { Fail "Không tìm thấy $tool." 'TOOL_MISSING' } }
  $node = "$(Capture 'node.exe' @('--version'))".TrimStart('v')
  if ($node -ne '24.21.0') { Fail "Node phải là 24.21.0; hiện tại $node." 'NODE_VERSION' }
  $npm = "$(Capture 'npm.cmd' @('--version'))"
  if (!$npm.StartsWith('11.')) { Fail "npm phải thuộc major 11; hiện tại $npm." 'NPM_VERSION' }
  if ($npm -ne '11.9.0') { Write-WarnLine "npm $npm khác bản khóa 11.9.0; CI dùng 11.9.0." }
  Assert-Docker
}
function Assert-Docker {
  if (!(Command-Exists 'docker.exe')) { Fail 'Không tìm thấy Docker. Hãy cài Docker Desktop rồi thử lại.' 'DOCKER_UNAVAILABLE' }
  if ((Capture 'docker.exe' @('info','--format','{{.ServerVersion}}')) -eq $null) { Fail 'Docker chưa chạy. Hãy mở Docker Desktop, chờ báo "Engine running" rồi thử lại.' 'DOCKER_UNAVAILABLE' }
  if ((Capture 'docker.exe' @('compose','version')) -eq $null) { Fail 'Docker Compose không khả dụng. Hãy cập nhật Docker Desktop.' 'DOCKER_UNAVAILABLE' }
}
function Compose([string[]]$Arguments) { Run 'docker.exe' (@('compose','--env-file',$script:EnvFile,'-f',$script:Compose) + $Arguments) }
function Wait-ContainerHealthy([string]$Name,[int]$TimeoutSeconds=90) {
  $until = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $state = Capture 'docker.exe' @('inspect','--format','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',$Name)
    if ($state -eq 'healthy') { Write-Ok "$Name healthy"; return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $until)
  Fail "$Name không healthy sau $TimeoutSeconds giây." 'CONTAINER_UNHEALTHY'
}
# Runs a block with some process environment variables replaced ($null removes one), then restores them.
function Invoke-WithEnv([hashtable]$Variables,[scriptblock]$Body) {
  $saved = @{}
  foreach ($name in @($Variables.Keys)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  try {
    foreach ($name in @($Variables.Keys)) { [Environment]::SetEnvironmentVariable($name, $Variables[$name], 'Process') }
    & $Body
  } finally {
    foreach ($name in @($saved.Keys)) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
}

# ---------------------------------------------------------------------------------------------
# Backend process ownership
# ---------------------------------------------------------------------------------------------
function Get-BackendState {
  if (!(Test-Path -LiteralPath $script:StateFile)) { return $null }
  try { return Get-Content -Raw -LiteralPath $script:StateFile | ConvertFrom-Json } catch { return $null }
}
function Get-OwnedBackendProcess {
  $state = Get-BackendState
  if (!$state -or !$state.pid) { return $null }
  $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  # PowerShell 7 parses ISO timestamps in JSON into DateTime; Windows PowerShell 5.1 keeps the string.
  $recorded = if ($state.startedUtc -is [DateTime]) { $state.startedUtc.ToUniversalTime().ToString('o') } else { "$($state.startedUtc)" }
  if ($process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().ToString('o') -ne $recorded) { return $null }
  return $process
}
function Start-BackendProcess([string]$Stdout,[string]$Stderr) {
  return Start-Process -FilePath 'node.exe' -ArgumentList @('--env-file-if-exists=.env','apps/backend/dist/main.js') -WorkingDirectory $script:Repo -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru -WindowStyle Hidden
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
    if ((Http-Status 'http://127.0.0.1:3000/v1/health/live') -eq 200 -and (Http-Status 'http://127.0.0.1:3000/v1/health/ready') -eq 200) { Write-Ok 'Backend live và ready: http://127.0.0.1:3000/v1/health/ready'; return }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $until)
  Fail "Backend chưa ready; xem log trong $script:Logs." 'BACKEND_NOT_READY'
}
function Test-InputRedirected { try { return [Console]::IsInputRedirected } catch { return $true } }
function Test-OutputRedirected { try { return [Console]::IsOutputRedirected } catch { return $true } }
function Confirm-Step([string]$Prompt) {
  if ($Yes) { return $true }
  return ("$(Read-Host "$Prompt [y/N]")".Trim() -match '^(y|yes)$')
}

# ---------------------------------------------------------------------------------------------
# Dependencies (F01): the recorded lock hash decides, not "did the lockfile change in this update"
# ---------------------------------------------------------------------------------------------
function Get-DependencyState {
  if (!(Test-Path -LiteralPath (Join-Path $script:Repo 'node_modules'))) { return 'missing' }
  if (!(Test-Path -LiteralPath $script:InstallState)) { return 'unrecorded' }
  $saved = "$(Get-Content -Raw -LiteralPath $script:InstallState)".Trim()
  if ($saved -ne (File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json'))) { return 'changed' }
  return 'ok'
}
function Ensure-Dependencies {
  $state = Get-DependencyState
  if (!$ForceDependencies -and $state -eq 'ok') { Write-Ok 'Dependency khớp lockfile đã ghi nhận'; return }
  $reason = if ($ForceDependencies) { 'Owner yêu cầu -ForceDependencies' }
    elseif ($state -eq 'missing') { 'chưa có node_modules' }
    elseif ($state -eq 'unrecorded') { 'launcher chưa ghi nhận lần cài nào (lần chạy đầu)' }
    else { 'package-lock.json khác lần cài đã ghi nhận' }
  Write-Info "Cài dependency đúng lockfile (npm ci) vì $reason..."
  Invoke-InRepo { Run 'npm.cmd' @('ci') }
  # Recorded only after npm ci succeeded (Run throws otherwise).
  Set-Content -NoNewline -Encoding ascii -LiteralPath $script:InstallState -Value (File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json'))
  Write-Ok 'Đã cài dependency và ghi nhận lockfile'
}

# ---------------------------------------------------------------------------------------------
# Migrations (F02): the DEV database itself is the source of truth, never a local cache file
# ---------------------------------------------------------------------------------------------
function Get-MigrationFiles {
  $dir = Join-Path $script:Repo 'database\migrations'
  if (!(Test-Path -LiteralPath $dir)) { return @() }
  return @(Get-ChildItem -LiteralPath $dir -File -Filter '*.sql' | ForEach-Object { $_.BaseName } | Sort-Object)
}
function Invoke-DevSql([string]$Sql) {
  # psql inside the DEV container over its local socket: read-only queries, no credential on any command line.
  return Capture 'docker.exe' @('exec','ship11-db-dev','psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U','ship11_dev','-d','ship11_dev','-c',$Sql)
}
function Get-AppliedMigrations {
  $exists = Invoke-DevSql "SELECT to_regclass('public.pgmigrations') IS NOT NULL"
  if ($exists -eq $null) { Fail 'Không đọc được trạng thái migration từ DB DEV (ship11-db-dev).' 'MIGRATION_STATE_UNAVAILABLE' }
  if ($exists -ne 't') { return @() }
  $names = Invoke-DevSql 'SELECT name FROM public.pgmigrations ORDER BY id'
  if ($names -eq $null) { Fail 'Không đọc được danh sách migration đã áp dụng từ DB DEV.' 'MIGRATION_STATE_UNAVAILABLE' }
  return @($names -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
function Get-MigrationPlan {
  $files = @(Get-MigrationFiles)
  $applied = @(Get-AppliedMigrations)
  return [pscustomobject]@{
    Files = $files
    Applied = $applied
    Pending = @($files | Where-Object { $applied -notcontains $_ })
    Unknown = @($applied | Where-Object { $files -notcontains $_ })
  }
}
function Confirm-DevMigrations {
  $plan = Get-MigrationPlan
  if ($plan.Unknown.Count) { Write-WarnLine "DB DEV có $($plan.Unknown.Count) migration không có trong mã nguồn hiện tại. Launcher không sửa hoặc xóa dữ liệu." }
  if (!$plan.Pending.Count) { Write-Ok "DB DEV đã áp dụng đủ $($plan.Files.Count) migration (kiểm tra trực tiếp trong PostgreSQL)"; return }
  Write-WarnLine "DB DEV còn $($plan.Pending.Count)/$($plan.Files.Count) migration chưa áp dụng:"
  foreach ($name in $plan.Pending) { Write-Host "    - $name" }
  $sha = Capture 'git.exe' @('-C',$script:Repo,'rev-parse','--short','HEAD')
  Write-Info "Đích: DEV local — database=ship11_dev user=ship11_dev host=127.0.0.1:5432 (mật khẩu được ẩn); commit=$sha"
  if (!(Confirm-Step 'Áp dụng các migration trên vào ship11_dev local?')) { Fail 'Đã hủy trước khi chạy backend vì migration DEV chưa được xác nhận.' 'MIGRATION_DECLINED' }
  # db:migrate reads .env itself; clear inherited variables so a stray shell value can never redirect it.
  Invoke-WithEnv @{ APP_ENV=$null; NODE_ENV=$null; DATABASE_URL=$null } { Invoke-InRepo { Run 'npm.cmd' @('run','db:migrate') } }
  $after = Get-MigrationPlan
  if ($after.Pending.Count) { Fail "Sau khi chạy migration, DB DEV vẫn còn $($after.Pending.Count) migration chưa áp dụng." 'MIGRATION_INCOMPLETE' }
  Write-Ok 'Đã áp dụng migration vào DB DEV'
}

# ---------------------------------------------------------------------------------------------
# TEST database target (F03)
# ---------------------------------------------------------------------------------------------
function ConvertTo-UriComponent([string]$Value) {
  # RFC 3986: everything except unreserved characters is percent-encoded, byte by byte in UTF-8.
  $sb = New-Object Text.StringBuilder
  foreach ($b in [Text.Encoding]::UTF8.GetBytes("$Value")) {
    if (($b -ge 48 -and $b -le 57) -or ($b -ge 65 -and $b -le 90) -or ($b -ge 97 -and $b -le 122) -or $b -eq 45 -or $b -eq 46 -or $b -eq 95 -or $b -eq 126) { [void]$sb.Append([char]$b) }
    else { [void]$sb.Append('%' + $b.ToString('X2')) }
  }
  return $sb.ToString()
}
function Assert-TestDatabaseUrl([string]$Url,[string]$Password) {
  $m = [regex]::Match("$Url", '^postgres://ship11_test:([A-Za-z0-9\-._~%]*)@127\.0\.0\.1:5433/ship11_test$')
  $decoded = $null
  if ($m.Success) { try { $decoded = [Uri]::UnescapeDataString($m.Groups[1].Value) } catch { } }
  if (!$m.Success -or $decoded -cne $Password) { Fail 'Guard TEST từ chối database đích: chỉ chấp nhận ship11_test@127.0.0.1:5433/ship11_test.' 'TEST_TARGET_GUARD' }
}
function New-TestDatabaseUrl([string]$Password) {
  $url = 'postgres://ship11_test:' + (ConvertTo-UriComponent $Password) + '@127.0.0.1:5433/ship11_test'
  Assert-TestDatabaseUrl $url $Password
  return $url
}
function Get-ContainerEnv([string]$Name) {
  $raw = Capture 'docker.exe' @('inspect','--format','{{range .Config.Env}}{{println .}}{{end}}',$Name)
  if ($raw -eq $null) { Fail "Không đọc được cấu hình container $Name." 'CONTAINER_INSPECT_FAILED' }
  $map = @{}
  foreach ($line in ($raw -split "`r?`n")) { $i = $line.IndexOf('='); if ($i -gt 0) { $map[$line.Substring(0, $i)] = $line.Substring($i + 1) } }
  return $map
}
# The password PostgreSQL TEST really runs with is read from the running container, so the launcher cannot
# disagree with Docker Compose about quoting in .env. The container must be the TEST one on port 5433.
function Get-TestDatabaseUrl {
  $containerEnv = Get-ContainerEnv 'ship11-db-test'
  if ($containerEnv['POSTGRES_USER'] -cne 'ship11_test' -or $containerEnv['POSTGRES_DB'] -cne 'ship11_test') { Fail 'Guard TEST: container ship11-db-test không phải database/user ship11_test.' 'TEST_TARGET_GUARD' }
  $binding = Capture 'docker.exe' @('port','ship11-db-test','5432/tcp')
  if ($binding -ne '127.0.0.1:5433') { Fail 'Guard TEST: ship11-db-test phải lắng nghe đúng 127.0.0.1:5433.' 'TEST_TARGET_GUARD' }
  $password = [string]$containerEnv['POSTGRES_PASSWORD']
  if ([string]::IsNullOrEmpty($password)) { Fail 'Guard TEST: không xác định được mật khẩu của ship11-db-test.' 'TEST_TARGET_GUARD' }
  $url = New-TestDatabaseUrl $password
  $script:ExtraSecrets = @($script:ExtraSecrets + @($password, (ConvertTo-UriComponent $password)))
  return $url
}
function Start-NpmStep([string[]]$NpmArgs,[string]$Stdout,[string]$Stderr) {
  $process = Start-Process -FilePath 'npm.cmd' -ArgumentList $NpmArgs -WorkingDirectory $script:Repo -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -Wait -PassThru -WindowStyle Hidden
  return $process.ExitCode
}
function Write-RedactedLog([string[]]$Sources,[string]$Destination,[string[]]$Secrets) {
  $lines = @(foreach ($source in $Sources) { if (Test-Path -LiteralPath $source) { Get-Content -LiteralPath $source -Encoding UTF8 } })
  $text = Protect-Text ($lines -join [Environment]::NewLine) $Secrets
  [IO.File]::WriteAllText($Destination, "$text", (New-Object Text.UTF8Encoding($false)))
}
# Runs one npm step. Raw output only ever exists in temporary files that are redacted into the log and removed.
function Invoke-LoggedStep([string[]]$NpmArgs,[string]$Log,[string[]]$Secrets) {
  $rawOut = "$Log.stdout.raw"; $rawErr = "$Log.stderr.raw"
  try { return (Start-NpmStep $NpmArgs $rawOut $rawErr) }
  finally {
    Write-RedactedLog @($rawOut, $rawErr) $Log $Secrets
    Remove-Item -LiteralPath $rawOut,$rawErr -Force -ErrorAction SilentlyContinue
  }
}

# ---------------------------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------------------------
function Start-Launcher {
  Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
  Compose @('up','-d','db-dev','db-test')
  Wait-ContainerHealthy 'ship11-db-dev'; Wait-ContainerHealthy 'ship11-db-test'
  if ((Get-DependencyState) -ne 'ok') { Fail 'Dependency thiếu hoặc chưa khớp lockfile đã ghi nhận. Hãy chạy 11Ship-Update trước.' 'DEPENDENCIES_NOT_READY' }
  Invoke-InRepo { Run 'npm.cmd' @('run','build') }
  Confirm-DevMigrations
  $owned = Get-OwnedBackendProcess
  if ($owned) { Write-Info "Backend do launcher quản lý đang chạy (PID $($owned.Id)); không mở thêm bản thứ hai." }
  else {
    if ((Http-Status 'http://127.0.0.1:3000/v1/health/live') -ne 0) { Fail 'Cổng 3000 đã có dịch vụ không do launcher quản lý. Launcher không dừng process lạ; hãy tự đóng dịch vụ đó.' 'PORT_IN_USE' }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $script:Logs "backend-$stamp.log"; $stderr = Join-Path $script:Logs "backend-$stamp.err.log"
    $p = Start-BackendProcess $stdout $stderr
    @{ pid=$p.Id; startedUtc=$p.StartTime.ToUniversalTime().ToString('o'); commit=(Capture 'git.exe' @('-C',$script:Repo,'rev-parse','HEAD')); stdout=$stdout; stderr=$stderr } | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $script:StateFile
  }
  Wait-Backend
}
function Update-Launcher {
  Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
  Invoke-InRepo {
    $gitDir = Capture 'git.exe' @('rev-parse','--git-dir')
    if ($gitDir -eq $null) { Fail 'Không phải Git repo.' 'NOT_A_GIT_REPO' }
    foreach ($marker in @('MERGE_HEAD','rebase-merge','rebase-apply','CHERRY_PICK_HEAD','REVERT_HEAD')) { if (Test-Path (Join-Path $gitDir $marker)) { Fail "Git operation đang dở: $marker" 'GIT_OPERATION_IN_PROGRESS' } }
    if ((Capture 'git.exe' @('symbolic-ref','--short','HEAD')) -eq $null) { Fail 'Đang detached HEAD; hãy chuyển về một branch có upstream.' 'DETACHED_HEAD' }
    if ((Capture 'git.exe' @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}')) -eq $null) { Fail 'Branch chưa có upstream.' 'NO_UPSTREAM' }
    if ((Capture 'git.exe' @('status','--porcelain','--untracked-files=no'))) { Fail 'Có thay đổi tracked chưa commit; launcher không tự stash.' 'DIRTY_TRACKED' }
    $oldMigrations = @(Get-MigrationFiles)
    Run 'git.exe' @('fetch','--prune','origin')
    $upstream = Capture 'git.exe' @('rev-parse','@{u}')
    & git.exe merge-base --is-ancestor HEAD $upstream; if ($LASTEXITCODE -ne 0) { Fail 'Không thể fast-forward tới upstream (lịch sử local đã rẽ nhánh hoặc đi trước).' 'NON_FAST_FORWARD' }
    $incoming = @("$(Capture 'git.exe' @('-c','core.quotepath=false','diff','--name-only','HEAD',$upstream))" -split "`r?`n")
    $untracked = @("$(Capture 'git.exe' @('-c','core.quotepath=false','ls-files','--others','--exclude-standard'))" -split "`r?`n")
    if (@($incoming | Where-Object { $_ -and $_ -in $untracked }).Count) { Fail 'File untracked sẽ bị upstream ghi đè; dừng an toàn, không xóa hay di chuyển file.' 'UNTRACKED_COLLISION' }
    Run 'git.exe' @('merge','--ff-only','@{u}')
    # F01: always let Ensure-Dependencies decide from the recorded lock hash. A machine that already has
    # node_modules but no recorded state (first run) must not report success without recording one.
    Ensure-Dependencies
    $newMigrations = @(Get-MigrationFiles | Where-Object { $oldMigrations -notcontains $_ })
    if ($newMigrations.Count) { Write-WarnLine "Bản cập nhật có $($newMigrations.Count) migration mới. Start sẽ kiểm tra DB DEV và hỏi trước khi áp dụng." }
  }
  Write-Ok 'Cập nhật fast-forward hoàn tất'
}
function Test-Launcher {
  Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
  Compose @('up','-d','db-test'); Wait-ContainerHealthy 'ship11-db-test'
  # G01: variables that CI uses to reach extra fixture databases (or to authenticate psql) must never be
  # inherited from the Owner's terminal. Local Test means ship11_test on 127.0.0.1:5433 and nothing else.
  # They are removed for every npm step (npm ci included) and restored afterwards, also when a step fails.
  $ciOnly = @{ TEST_WRONG_USER_DATABASE_URL=$null; TEST_REMOTE_PATH_DATABASE_URL=$null; TEST_REMOTE_PATH_RUNTIME_URL=$null; PGPASSWORD=$null }
  Invoke-WithEnv $ciOnly { Ensure-Dependencies }
  $testUrl = Get-TestDatabaseUrl
  $secrets = Get-KnownSecrets
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'; $sha = Capture 'git.exe' @('-C',$script:Repo,'rev-parse','HEAD')
  # A list, not an array: the steps run inside a child scope and must add to this same object.
  $summary = New-Object 'Collections.Generic.List[object]'
  Write-Info 'Đích test: ship11_test@127.0.0.1:5433/ship11_test (mật khẩu được ẩn). DB DEV không bị đụng tới.'
  Invoke-WithEnv (@{ APP_ENV='test'; NODE_ENV='test'; DATABASE_URL=$testUrl } + $ciOnly) {
    foreach ($name in @($ciOnly.Keys)) { if ([Environment]::GetEnvironmentVariable($name, 'Process')) { Fail "Guard TEST: biến $name vẫn còn trong môi trường test." 'TEST_ENV_GUARD' } }
    if ($env:APP_ENV -cne 'test' -or $env:DATABASE_URL -cne $testUrl -or $env:DATABASE_URL -notmatch '^postgres://ship11_test:[A-Za-z0-9\-._~%]*@127\.0\.0\.1:5433/ship11_test$') {
      Fail 'Guard TEST từ chối môi trường test trước khi chạy suite.' 'TEST_TARGET_GUARD'
    }
    foreach ($step in @(
      @('lint','run','lint'), @('typecheck','run','typecheck'), @('build','run','build'), @('launcher-contract','run','launcher:test'), @('deploy','run','deploy:test'),
      @('unit','run','test:unit'), @('migrate-test','run','db:migrate'), @('integration-local','run','test:integration'), @('progress-test','run','progress:test'), @('progress-check','run','progress:check')
    )) {
      $name = $step[0]; $log = Join-Path $script:Logs "$stamp-$name.log"; Write-Info "Test: $name"
      if ($name -eq 'progress-check' -and !$env:GITHUB_TOKEN -and !$env:GH_TOKEN) {
        $summary.Add([pscustomobject]@{step=$name;result='SKIP';exitCode=0;log='Cần GITHUB_TOKEN hoặc GH_TOKEN; CI vẫn chạy check tương ứng.'})
        Write-WarnLine 'Bỏ qua progress-check vì máy Owner không có GitHub token.'
        continue
      }
      $code = Invoke-LoggedStep @($step[1..($step.Count-1)]) $log $secrets
      $summary.Add([pscustomobject]@{step=$name;result=if($code -eq 0){'PASS'}else{'FAIL'};exitCode=$code;log=$log})
      if ($code -ne 0) { break }
    }
  }
  $result = if (@($summary | Where-Object result -eq 'FAIL').Count) {'FAIL'} else {'PASS'}
  @{timestamp=(Get-Date).ToUniversalTime().ToString('o');commit=$sha;result=$result;steps=$summary.ToArray()} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 -LiteralPath $script:LastTest
  Write-Host (($summary | Format-Table -AutoSize | Out-String).TrimEnd())
  if ($result -ne 'PASS') { Fail "Test FAIL; xem log trong $script:Logs." 'TEST_FAILED' }
  Write-Ok "Toàn bộ local test PASS cho commit $sha"
}
function Stop-Launcher {
  Ensure-Dirs
  $p = Get-OwnedBackendProcess
  if ($p) { Stop-Process -Id $p.Id; $p.WaitForExit(10000) | Out-Null; Write-Ok 'Đã dừng backend do launcher quản lý' }
  elseif (Test-Path -LiteralPath $script:StateFile) { Write-WarnLine 'State backend cũ/không khớp (PID đã đổi chủ hoặc đã tắt); không dừng process khác.' }
  else { Write-Info 'Không có backend nào do launcher quản lý đang chạy.' }
  Remove-Item -LiteralPath $script:StateFile -Force -ErrorAction SilentlyContinue
  if (!$KeepDatabases) { $null = Assert-LocalEnv; Assert-Docker; Compose @('stop','db-dev','db-test'); Write-Ok 'Đã dừng DB; volume DEV được giữ nguyên' }
}
# F04: a result is only reported as PASS/FAIL when it belongs to the commit that is checked out now.
function Get-LastTestStatus([string]$SummaryPath,[string]$Head) {
  if (!(Test-Path -LiteralPath $SummaryPath)) { return [pscustomobject]@{ Label='CHƯA TEST'; Text='CHƯA TEST — chưa có summary hợp lệ. Hãy chạy 11Ship-Test.' } }
  $s = $null
  try { $s = Get-Content -Raw -LiteralPath $SummaryPath | ConvertFrom-Json } catch { }
  if (!$s -or "$($s.commit)" -notmatch '^[0-9a-f]{40}$' -or "$($s.result)" -notin @('PASS','FAIL')) {
    return [pscustomobject]@{ Label='KHÔNG HỢP LỆ'; Text='KHÔNG HỢP LỆ — summary test hỏng hoặc thiếu commit SHA. Hãy chạy lại 11Ship-Test.' }
  }
  $old = "$($s.commit)".Substring(0, 7)
  if ("$Head" -notmatch '^[0-9a-f]{40}$' -or $s.commit -ne $Head) {
    $now = if ("$Head".Length -ge 7) { "$Head".Substring(0, 7) } else { 'không xác định' }
    return [pscustomobject]@{ Label='STALE'; Text="STALE — commit hiện tại $now CHƯA được test. Kết quả cũ ($($s.result)) thuộc commit $old. Hãy chạy 11Ship-Test." }
  }
  return [pscustomobject]@{ Label="$($s.result)"; Text="$($s.result) — commit $old, lúc $($s.timestamp)" }
}
function Status-Launcher {
  Ensure-Dirs
  Write-Info "Repo: $script:Repo"
  $branch = Capture 'git.exe' @('-C',$script:Repo,'branch','--show-current'); $up = Capture 'git.exe' @('-C',$script:Repo,'rev-parse','--abbrev-ref','@{u}')
  $head = Capture 'git.exe' @('-C',$script:Repo,'rev-parse','HEAD')
  $dirty = [bool](Capture 'git.exe' @('-C',$script:Repo,'status','--porcelain'))
  $aheadBehind = if ($up) { "$(Capture 'git.exe' @('-C',$script:Repo,'rev-list','--left-right','--count','HEAD...@{u}'))" -replace '\s+','/' } else { 'N/A' }
  Write-Host "Git: branch=$branch upstream=$up ahead/behind=$aheadBehind commit=$head dirty=$dirty"
  foreach ($pair in @(@('Node','node.exe','--version'),@('npm','npm.cmd','--version'),@('Docker','docker.exe','--version'))) { if (Command-Exists $pair[1]) { Write-Host "$($pair[0]): $(Capture $pair[1] @($pair[2]))" } else { Write-Host "$($pair[0]): không có" } }
  $ps = if (Command-Exists 'docker.exe') { Capture 'docker.exe' @('compose','--env-file',$script:EnvFile,'-f',$script:Compose,'ps') } else { $null }
  if ($ps -eq $null) { Write-Host 'Database: không đọc được — Docker chưa chạy hoặc thiếu .env' } else { Write-Host $ps }
  $p = Get-OwnedBackendProcess; Write-Host "Backend launcher PID: $(if($p){$p.Id}else{'không chạy'})"
  Write-Host "Health live=$(Http-Status 'http://127.0.0.1:3000/v1/health/live') ready=$(Http-Status 'http://127.0.0.1:3000/v1/health/ready')"
  Write-Host 'Web quản trị / Khách / Quán / Xế / App quản lý: N/A — chưa có trong repo'
  Write-Host "Test gần nhất: $((Get-LastTestStatus $script:LastTest $head).Text)"
}
function Install-Shortcut {
  $desktop = [Environment]::GetFolderPath('Desktop'); $target = Join-Path $PSScriptRoot '11Ship.cmd'; $link = Join-Path $desktop '11Ship Test.lnk'
  $shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($link); $shortcut.TargetPath = $target; $shortcut.WorkingDirectory = $script:Repo; $shortcut.Save(); Write-Ok "Đã tạo shortcut: $link"
}
function Invoke-LauncherCommand([string]$Name) {
  switch ($Name) { 'Start' { Start-Launcher } 'Update' { Update-Launcher } 'Test' { Test-Launcher } 'Stop' { Stop-Launcher } 'Status' { Status-Launcher } 'InstallShortcut' { Install-Shortcut } default { Menu } }
}
function Write-Failure($ErrorRecord) { Write-Host (Protect-Text "$($ErrorRecord.Exception.Message)" (Get-KnownSecrets)) -ForegroundColor Red }
# F05: the menu stays open until Owner chooses 0, so a result is never lost with the window.
function Menu {
  $names = @{ '1'='Start'; '2'='Update'; '3'='Test'; '4'='Stop'; '5'='Status'; '6'='InstallShortcut' }
  while ($true) {
    Write-Host ''
    Write-Host '=============== 11Ship — Công cụ test local ===============' -ForegroundColor Yellow
    Write-Host '  1. Start   — Bật database và backend'
    Write-Host '  2. Update  — Lấy mã mới nhất (chỉ fast-forward)'
    Write-Host '  3. Test    — Chạy toàn bộ kiểm tra kỹ thuật trên DB TEST'
    Write-Host '  4. Stop    — Dừng backend và database (giữ dữ liệu DEV)'
    Write-Host '  5. Status  — Xem trạng thái hiện tại'
    Write-Host '  6. Tạo shortcut trên Desktop'
    Write-Host '  0. Thoát'
    $choice = Read-Host 'Nhập số rồi nhấn Enter'
    if ($choice -eq $null) { return }
    $choice = "$choice".Trim()
    if ($choice -eq '0') { return }
    if (!$names.ContainsKey($choice)) {
      if (Test-InputRedirected) { return }
      Write-WarnLine 'Lựa chọn không hợp lệ. Hãy nhập một số từ 0 đến 6.'
      continue
    }
    $name = $names[$choice]
    try { Invoke-LauncherCommand $name; Write-Host "Kết quả ${name}: THÀNH CÔNG" -ForegroundColor Green }
    catch { Write-Failure $_; Write-Host "Kết quả ${name}: THẤT BẠI" -ForegroundColor Red }
  }
}

# ---------------------------------------------------------------------------------------------
# F05: keep the window open only when it was opened for this run (double-click / shortcut)
# ---------------------------------------------------------------------------------------------
function Get-PauseDecision([bool]$NoPauseRequested,[bool]$InputRedirected,[bool]$OutputRedirected,[int]$ConsoleProcessCount,[string]$ParentName,[string]$ParentCommandLine) {
  if ($NoPauseRequested -or $InputRedirected -or $OutputRedirected) { return $false }
  # Double-click: Explorer starts "cmd.exe /c <wrapper>" in a new console that holds only that cmd and this
  # PowerShell. A terminal has its own shell attached too (3+ processes) or runs the wrapper without /c.
  if ($ConsoleProcessCount -lt 1 -or $ConsoleProcessCount -gt 2) { return $false }
  if ("$ParentName" -notmatch '^(?i)cmd(\.exe)?$') { return $false }
  return [bool]("$ParentCommandLine" -match '(?i)(^|\s)/c(\s|"|$)')
}
function Get-ConsoleProcessCount {
  try {
    if (-not ('Ship11.ConsoleNative' -as [type])) {
      Add-Type -Namespace Ship11 -Name ConsoleNative -MemberDefinition '[DllImport("kernel32.dll", SetLastError = true)] public static extern uint GetConsoleProcessList(uint[] processList, uint processCount);'
    }
    $buffer = New-Object 'uint32[]' 16
    return [int][Ship11.ConsoleNative]::GetConsoleProcessList($buffer, 16)
  } catch { return 0 }
}
function Get-ParentProcessInfo {
  try {
    $me = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($me.ParentProcessId)"
    return [pscustomobject]@{ Name="$($parent.Name)"; CommandLine="$($parent.CommandLine)" }
  } catch { return [pscustomobject]@{ Name=''; CommandLine='' } }
}
function Get-PauseState {
  $state = [pscustomobject]@{ Wait=$false; ConsoleProcesses=0; Parent='' }
  if ($NoPause -or $env:SHIP11_NO_PAUSE -eq '1') { return $state }
  if ((Test-InputRedirected) -or (Test-OutputRedirected)) { return $state }
  $parent = Get-ParentProcessInfo
  $state.Parent = $parent.Name
  $state.ConsoleProcesses = Get-ConsoleProcessCount
  $state.Wait = Get-PauseDecision $false $false $false $state.ConsoleProcesses $parent.Name $parent.CommandLine
  return $state
}
# The last finished command is also kept on disk, so a result survives even a closed window.
function Write-RunRecord([string]$Name,[int]$ExitCode,$PauseState) {
  try {
    Ensure-Dirs
    @{ command=$Name; exitCode=$ExitCode; finishedUtc=[DateTime]::UtcNow.ToString('o'); waitedForOwner=[bool]$PauseState.Wait; consoleProcesses=$PauseState.ConsoleProcesses; parent=$PauseState.Parent } | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath $script:LastRun
  } catch { }
}

if ($MyInvocation.InvocationName -ne '.') {
  $exitCode = 0
  try { Invoke-LauncherCommand $Command } catch { Write-Failure $_; $exitCode = 1 }
  if ($Command -ne 'Menu') {
    if ($exitCode -eq 0) { Write-Host "Kết quả ${Command}: THÀNH CÔNG (exit 0)" -ForegroundColor Green }
    else { Write-Host "Kết quả ${Command}: THẤT BẠI (exit $exitCode)" -ForegroundColor Red }
    $pauseState = Get-PauseState
    Write-RunRecord $Command $exitCode $pauseState
    if ($pauseState.Wait) { Write-Host ''; [void](Read-Host 'Nhấn Enter để đóng cửa sổ') }
  }
  exit $exitCode
}
