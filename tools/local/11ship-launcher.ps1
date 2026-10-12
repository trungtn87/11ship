[CmdletBinding()]
param(
  [ValidateSet('Menu','Start','Update','Test','Stop','Status','InstallShortcut','App')]
  [string]$Command = 'Menu',
  [ValidateSet('Admin','Food','Ship')]
  [string]$App,
  [switch]$Yes,
  [switch]$KeepDatabases,
  [switch]$ForceDependencies,
  [switch]$NoPause,
  # Set only by a launcher that re-runs itself after Update replaced the launcher code (M00.02). Never typed by hand.
  [string]$RelaunchToken,
  [string]$RelaunchFromSha,
  [string]$RelaunchToSha,
  [string]$RelaunchLauncherHash
)

$ErrorActionPreference = 'Stop'
# Every path is derived from one repository root, so tests can point the launcher functions at a sandbox checkout.
function Initialize-LauncherPaths([string]$Repo) {
  $script:Repo = $Repo
  $script:StateDir = Join-Path $Repo '.11ship-local'
  $script:StateFile = Join-Path $script:StateDir 'backend.json'
  $script:InstallState = Join-Path $script:StateDir 'installed-lock.sha256'
  $script:LastTest = Join-Path $script:StateDir 'last-test.json'
  $script:LastRun = Join-Path $script:StateDir 'last-run.json'
  $script:Logs = Join-Path $script:StateDir 'logs'
  $script:Compose = Join-Path $Repo 'compose.dev.yml'
  $script:EnvFile = Join-Path $Repo '.env'
  # M00.02: shared lock, hand-over gate, display-only holder info, UAT pin and the launcher file itself.
  $script:LockFile = Join-Path $script:StateDir 'launch.lock'
  $script:GateFile = Join-Path $script:StateDir 'launch.gate'
  $script:LockInfoFile = Join-Path $script:StateDir 'launch.lock.info.json'
  $script:UatPinFile = Join-Path $script:StateDir 'uat-pin.json'
  $script:LauncherPath = Join-Path (Join-Path (Join-Path $Repo 'tools') 'local') '11ship-launcher.ps1'
  $script:RelaunchScript = $script:LauncherPath
  # M00.03: the backend build output, its manifest and its absolute entry script (the process identity is checked against it).
  $script:BackendDist = Join-Path (Join-Path (Join-Path $Repo 'apps') 'backend') 'dist'
  $script:BackendScript = Join-Path $script:BackendDist 'main.js'
  $script:BackendManifestFile = Join-Path $script:BackendDist 'build-manifest.json'
}
Initialize-LauncherPaths ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path)
$script:ExtraSecrets = @()
# Shared lock state of THIS process. The OS file handle is the only owner of the lock; the rest is bookkeeping.
$script:LockHandle = $null
$script:LockDepth = 0
$script:LockStep = ''
$script:TakeoverPending = $false
$script:IsRelaunched = $false
$script:LauncherStale = $false
$script:RelaunchExitCode = 0
$script:RelaunchTakeoverSeconds = 60
$script:UpdateResult = $null

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

# M00.02 F1: the identity of the launcher code THIS process loaded (SHA-256 of the file as it was at load time).
# Another launcher may replace the file while this process waits for the lock; the lock code compares this value with
# the file on disk once it owns the lock, before any step runs.
function Get-LauncherIdentity { return (File-HashOrEmpty $script:LauncherPath) }
$script:LoadedLauncherHash = Get-LauncherIdentity

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
      if ($key -notmatch '(?i)(PASSWORD|SECRET|KEYRING|TOKEN|DATABASE_URL|HMAC_KEY)') { continue }
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
# A null or empty value REMOVES the variable. On Linux an empty value would stay set, and Git reads GIT_DIR="" as a path.
function Set-ProcessEnv([string]$Name,$Value) {
  if ($null -eq $Value -or "$Value" -eq '') { Remove-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue }
  else { [Environment]::SetEnvironmentVariable($Name, [string]$Value, 'Process') }
}
function Invoke-WithEnv([hashtable]$Variables,[scriptblock]$Body) {
  $saved = @{}
  foreach ($name in @($Variables.Keys)) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  try {
    foreach ($name in @($Variables.Keys)) { Set-ProcessEnv $name $Variables[$name] }
    & $Body
  } finally {
    foreach ($name in @($saved.Keys)) { Set-ProcessEnv $name $saved[$name] }
  }
}

# ---------------------------------------------------------------------------------------------
# Shared exclusive lock (M00.02)
# ---------------------------------------------------------------------------------------------
# One lock per checkout covers update, dependency install, build, migration and process-state work, so two launches
# (three app wrappers started together, Update next to Start...) never run those steps at the same time.
#  - The OWNER of the lock is an exclusive OS file handle (FileShare.None) held for the whole operation. A crashed
#    process loses its handles, so the lock frees itself. Nothing here decides ownership from a file's age or contents,
#    and nothing ever stops the process that holds it.
#  - launch.lock.info.json only tells a WAITING launcher who is busy. It is display text: stale, missing or forged
#    content never grants or denies the lock.
#  - Calls nest (Start -> migrations -> dependencies): the process counts its own depth and takes the OS lock once.
#  - launch.gate exists for the hand-over to a new launcher process (Invoke-LauncherRelaunch). Normal acquirers pass
#    through it for one non-blocking try; the hand-over keeps it while the lock changes hands, so nobody slips in.
$script:StaleMessage = 'Launcher này đã được thay bằng bản mới sau Update và sẽ không chạy thêm lệnh nào. Hãy đóng cửa sổ rồi mở lại launcher để dùng bản mới.'
function Test-IsWindows { return ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) }
function Get-LockWaitSeconds {
  # The wait is 120 seconds. The environment variable can only SHORTEN it (a test aid); it can never extend it.
  $seconds = 120
  $raw = [Environment]::GetEnvironmentVariable('SHIP11_LOCK_TIMEOUT_SECONDS', 'Process')
  $parsed = 0
  if ($raw -and [int]::TryParse($raw, [ref]$parsed) -and $parsed -ge 1 -and $parsed -lt 120) { $seconds = $parsed }
  return $seconds
}
# Returns an exclusive handle, or $null while someone else holds the file. Any other failure is an error, not "busy".
function Open-ExclusiveFile([string]$Path) {
  try {
    return [IO.File]::Open($Path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  } catch {
    $inner = $_.Exception
    while ($inner.InnerException) { $inner = $inner.InnerException }
    $busy = ($inner -is [IO.IOException]) -and !($inner -is [IO.FileNotFoundException]) -and !($inner -is [IO.DirectoryNotFoundException]) -and !($inner -is [IO.PathTooLongException])
    if ($busy) { return $null }
    Fail "Không mở được tệp khóa $([IO.Path]::GetFileName($Path)): $($inner.Message)" 'LAUNCH_LOCK_UNAVAILABLE'
  }
}
function Write-LockInfo([string]$Step) {
  try {
    $info = [ordered]@{ pid = $PID; step = $Step; sinceUtc = [DateTime]::UtcNow.ToString('o'); repo = $script:Repo }
    $temporary = "$($script:LockInfoFile).$PID.tmp"
    [IO.File]::WriteAllText($temporary, ($info | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $script:LockInfoFile -Force
  } catch { }
}
function Remove-LockInfo { try { Remove-Item -LiteralPath $script:LockInfoFile -Force -ErrorAction SilentlyContinue } catch { } }
function Get-LockInfoText {
  try {
    if (!(Test-Path -LiteralPath $script:LockInfoFile)) { return '' }
    $info = Get-Content -Raw -LiteralPath $script:LockInfoFile | ConvertFrom-Json
    return "thao tác '$($info.step)', PID $($info.pid), từ $($info.sinceUtc) UTC (chỉ để hiển thị, có thể đã cũ)"
  } catch { return '' }
}
# Waits for the lock. A normal acquirer takes the gate for one non-blocking try at the lock and lets go of it at once.
# A launcher that was started by a hand-over ($Takeover) takes the lock directly: its parent keeps the gate meanwhile.
function Wait-ForLaunchLock([string]$Step,[bool]$Takeover) {
  $timeout = Get-LockWaitSeconds
  $started = [DateTime]::UtcNow
  $deadline = $started.AddSeconds($timeout)
  $lastNote = $started
  $announced = $false
  $pause = 250
  if ($Takeover) { $pause = 100 }
  while ($true) {
    $handle = $null
    if ($Takeover) { $handle = Open-ExclusiveFile $script:LockFile }
    else {
      $gate = Open-ExclusiveFile $script:GateFile
      if ($gate) {
        try { $handle = Open-ExclusiveFile $script:LockFile } finally { $gate.Dispose() }
      }
    }
    if ($handle) { return $handle }
    $now = [DateTime]::UtcNow
    $timedOut = ($now -ge $deadline)
    if ($timedOut -or !$announced -or ($now - $lastNote).TotalSeconds -ge 15) {
      $who = Get-LockInfoText
      $detail = ''
      if ($who) { $detail = " Đang giữ khóa: $who." }
      if ($timedOut) {
        Fail "Đã chờ $timeout giây mà chưa lấy được khóa dùng chung của checkout này (bước '$Step').$detail Launcher không chiếm khóa và không dừng tiến trình đang giữ khóa; hãy đợi thao tác đó xong rồi chạy lại." 'LAUNCH_LOCK_TIMEOUT'
      }
      Write-Info "Đang chờ khóa dùng chung (LAUNCH_LOCK_WAIT) trước bước '$Step'; tối đa $timeout giây.$detail"
      $announced = $true
      $lastNote = $now
    }
    Start-Sleep -Milliseconds $pause
  }
}
function Enter-LaunchLock([string]$Step) {
  Ensure-Dirs
  $handle = Wait-ForLaunchLock $Step ([bool]$script:TakeoverPending)
  $script:TakeoverPending = $false
  # The handle is a local until ownership is handed to the lock state below. ANY failure before that point (an unreadable
  # launcher file, a mismatch, an unexpected exception) disposes it here, so a failed step can never leave the lock held
  # until a garbage collection: the caller's try/finally does not exist yet.
  $owned = $false
  try {
    # F1: we own the lock now. Before anything runs, the code we loaded must still be the code on disk: another launcher
    # may have updated the checkout while we waited. Old code never runs a step; the lock is given back at once.
    $onDisk = ''
    try { $onDisk = Get-LauncherIdentity }
    catch {
      # F3: not being able to read the file proves nothing about its content, so nothing protected runs. This is not
      # "stale": once the file can be read again this same launcher continues normally.
      Fail "Không đọc được file launcher để xác minh mã đang chạy ($($_.Exception.Message)). Chưa làm gì cả và khóa đã được trả; hãy thử lại sau khi file không còn bị chương trình khác giữ." 'LAUNCHER_IDENTITY_UNREADABLE'
    }
    if (!$script:LoadedLauncherHash -or !$onDisk -or $onDisk -ne $script:LoadedLauncherHash) {
      $script:LauncherStale = $true
      Fail 'Mã launcher đang chạy trong cửa sổ này khác bản launcher hiện có trên đĩa (checkout đã được cập nhật trong lúc chờ khóa, hoặc không đọc được file launcher). Chưa làm gì cả. Hãy đóng cửa sổ này rồi mở lại launcher để dùng bản mới.' 'LAUNCHER_RELOAD_REQUIRED'
    }
    $script:LockHandle = $handle
    $script:LockDepth = 1
    $script:LockStep = $Step
    $owned = $true
  } finally {
    if (!$owned) { try { $handle.Dispose() } catch { } }
  }
  Write-LockInfo $Step
}
function Exit-LaunchLock {
  $handle = $script:LockHandle
  $script:LockHandle = $null
  $script:LockDepth = 0
  $script:LockStep = ''
  if ($handle) {
    # The display text goes first, while we still own the lock, so we never delete the next owner's text.
    Remove-LockInfo
    try { $handle.Dispose() } catch { }
  }
}
# Runs $Body while this process owns the lock. Safe to call again from inside $Body (same process, any depth).
# After a hand-over this process holds nothing but still counts a depth: every further use fails closed.
function Use-LaunchLock([string]$Step,[scriptblock]$Body) {
  if ($script:LauncherStale) { Fail $script:StaleMessage 'LAUNCHER_RELOAD_REQUIRED' }
  if ($script:LockDepth -gt 0) {
    if (!$script:LockHandle) { Fail $script:StaleMessage 'LAUNCHER_RELOAD_REQUIRED' }
    $outerStep = $script:LockStep
    $script:LockDepth++
    $script:LockStep = $Step
    Write-LockInfo $Step
    try { & $Body }
    finally {
      $script:LockDepth--
      $script:LockStep = $outerStep
      if ($script:LockHandle) { Write-LockInfo $outerStep }
    }
    return
  }
  Enter-LaunchLock $Step
  try { & $Body }
  finally { Exit-LaunchLock }
}

# ---------------------------------------------------------------------------------------------
# Re-running the launcher after Update replaced it (M00.02)
# ---------------------------------------------------------------------------------------------
# Update changes the launcher's own file while the OLD code is still running. The old process then starts the new
# launcher exactly once, hands the lock to it without a gap and waits for it. Rules:
#  1. The old process keeps the GATE, starts the new one, then lets go of the LOCK. The new process takes the lock
#     without using the gate; every other launcher needs the gate for its try, so none can run between the two owners.
#  2. The old process never waits for the new one while holding the lock (it released it before waiting), and the new
#     process never needs the gate, so the two cannot block each other.
#  3. The new process starts with -RelaunchToken/-RelaunchFromSha/-RelaunchToSha/-RelaunchLauncherHash. That is the
#     cycle guard: it re-checks branch, SHA and launcher file under the lock, does NOT fetch or update again, and
#     can never re-run itself (so it cannot loop). Anything that differs stops it.
#  4. The old process owns the console, the pause decision and the run record; the new one is started with -NoPause.
#  5. From the moment of the hand-over the old process is "stale" and refuses every further lock use.
function ConvertTo-QuotedArgument([string]$Value) {
  if ($Value -eq '') { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}
function Get-RelaunchArguments([string]$CommandName,[string]$Token,[string]$FromSha,[string]$ToSha,[string]$LauncherHash) {
  $list = New-Object 'Collections.Generic.List[string]'
  $list.Add('-Command'); $list.Add($CommandName)
  if ($CommandName -eq 'App' -and $App) { $list.Add('-App'); $list.Add([string]$App) }
  if ($Yes) { $list.Add('-Yes') }
  if ($KeepDatabases) { $list.Add('-KeepDatabases') }
  if ($ForceDependencies) { $list.Add('-ForceDependencies') }
  $list.Add('-NoPause')
  $list.Add('-RelaunchToken'); $list.Add($Token)
  $list.Add('-RelaunchFromSha'); $list.Add($FromSha)
  $list.Add('-RelaunchToSha'); $list.Add($ToSha)
  $list.Add('-RelaunchLauncherHash'); $list.Add($LauncherHash)
  return @($list.ToArray())
}
function Start-LauncherProcess([string[]]$Arguments) {
  $exe = (Get-Process -Id $PID).Path
  if (!$exe) { if (Test-IsWindows) { $exe = 'powershell.exe' } else { $exe = 'pwsh' } }
  $parts = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(ConvertTo-QuotedArgument $script:RelaunchScript)) + @($Arguments | ForEach-Object { ConvertTo-QuotedArgument $_ })
  # No -Wait: it would also wait for the backend the new launcher may leave running. The new process shares this console.
  if (Test-IsWindows) { $process = Start-Process -FilePath $exe -ArgumentList $parts -NoNewWindow -PassThru }
  else { $process = Start-Process -FilePath $exe -ArgumentList $parts -PassThru }
  $null = $process.Handle   # without a cached handle ExitCode can stay empty for a process started with -PassThru
  return $process
}
function Open-GateWithin([int]$Seconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  while ($true) {
    $gate = Open-ExclusiveFile $script:GateFile
    if ($gate) { return $gate }
    if ([DateTime]::UtcNow -ge $deadline) { return $null }
    Start-Sleep -Milliseconds 50
  }
}
# Called while this process owns the lock. Returns the new launcher's exit code once it has finished.
function Invoke-LauncherRelaunch([string]$CommandName,[string]$FromSha,[string]$ToSha,[string]$LauncherHash) {
  if ($script:IsRelaunched) { Fail 'Bản launcher mới không được tự chạy lại lần nữa (chỉ một lần cho mỗi Update).' 'RELAUNCH_LIMIT' }
  if (!$script:LockHandle -or $script:LockDepth -lt 1) { Fail 'Chỉ chạy lại launcher khi đang giữ khóa dùng chung.' 'RELAUNCH_FAILED' }
  # From here this process runs OLD launcher code on a checkout that holds NEW code: it must not run anything else.
  $script:LauncherStale = $true
  $token = [Guid]::NewGuid().ToString('N')
  $arguments = Get-RelaunchArguments $CommandName $token $FromSha $ToSha $LauncherHash
  $gate = Open-GateWithin 30
  if (!$gate) { Fail 'Không lấy được cổng bàn giao khóa trong 30 giây; không chạy lại launcher.' 'RELAUNCH_FAILED' }
  $process = $null
  $childHolds = $false
  try {
    try { $process = Start-LauncherProcess $arguments }
    catch { Fail "Không khởi động được bản launcher mới: $($_.Exception.Message)" 'RELAUNCH_FAILED' }
    # Give the lock away while still holding the gate. The new process takes it without the gate; all others need the gate.
    $handle = $script:LockHandle
    $script:LockHandle = $null
    Remove-LockInfo
    $handle.Dispose()
    $deadline = [DateTime]::UtcNow.AddSeconds($script:RelaunchTakeoverSeconds)
    while ($true) {
      if ($process.HasExited) { break }
      $probe = Open-ExclusiveFile $script:LockFile
      if ($probe) { $probe.Dispose() } else { $childHolds = $true; break }
      if ([DateTime]::UtcNow -ge $deadline) { break }
      Start-Sleep -Milliseconds 100
    }
    if (!$childHolds -and !$process.HasExited) {
      # The new process did not take over in time. Only it could have: take the lock back. If that fails it took it just now.
      $back = Open-ExclusiveFile $script:LockFile
      if ($back) {
        $script:LockHandle = $back
        try { $process.Kill() } catch { }
        Fail "Bản launcher mới không nhận khóa trong $($script:RelaunchTakeoverSeconds) giây; đã dừng nó và trả khóa. Chưa chạy bước nào bằng bản mới." 'RELAUNCH_FAILED'
      }
    }
  } finally {
    # The new process owns the lock now (or has finished): the gate is no longer needed.
    if ($gate) { $gate.Dispose() }
  }
  $null = $process.WaitForExit()
  $code = [int]$process.ExitCode
  $script:RelaunchExitCode = $code
  return $code
}
function Assert-RelaunchParameters {
  if ("$RelaunchToken" -cnotmatch '^[0-9a-f]{32}$' -or "$RelaunchFromSha" -cnotmatch '^[0-9a-f]{40}$' -or "$RelaunchToSha" -cnotmatch '^[0-9a-f]{40}$' -or "$RelaunchLauncherHash" -cnotmatch '^[0-9a-f]{64}$') {
    Fail 'Tham số chạy lại launcher không hợp lệ.' 'RELAUNCH_ARGUMENTS_INVALID'
  }
  if ($Command -ne 'Update') { Fail 'Chỉ lệnh Update được chạy lại sau khi cập nhật launcher.' 'RELAUNCH_ARGUMENTS_INVALID' }
}

# ---------------------------------------------------------------------------------------------
# Artifact and process identity (M00.03)
# ---------------------------------------------------------------------------------------------
# Three things are kept apart and never assumed equal:
#   SOURCE    the commit that is checked out (git HEAD);
#   ARTIFACT  what was built from it: the files of the build folder, described by a manifest that is written only after a
#             successful build (app_id, source_sha, build_fingerprint = SHA-256 over every built file, built_at, design_version);
#   PROCESS   what is running: recorded in the process registry at the moment the launcher starts it (pid, start time UTC,
#             repo, executable, script, host and port, source_sha, build_fingerprint).
# "Update succeeded" says something about the SOURCE only. A running process is whatever the registry recorded when it was
# started: it is never given the SHA of a newer build.
#
# A PID that exists, or a port that answers HTTP 200, proves nothing. A process is OWNED only when all of this holds: the
# registry is complete and belongs to this checkout and this target; the PID is alive with exactly the recorded start time;
# its executable is the recorded node and its script argument is this checkout's build output. The port is OURS only when
# every loopback or wildcard listener on it is that same PID. What cannot be proven is refused with a stable code and
# nothing is stopped: never by PID alone, by port, or by image name.
# Everything that changes an artifact, the registry or a process runs under the shared lock (Assert-LockHeld).
$script:BackendHost = '127.0.0.1'
$script:BackendPort = 3000
$script:ArtifactDesignVersion = '2.0.1'
$script:ProcessStopSeconds = 10
$script:BackendReadySeconds = 45
$script:BackendPollMilliseconds = 2000
$script:BuildExitCode = 0

function ConvertTo-Hex([byte[]]$Bytes) { return ([BitConverter]::ToString($Bytes).Replace('-', '').ToLowerInvariant()) }
function Test-Hex($Value,[int]$Length) {
  if ($Value -isnot [string]) { return $false }
  return ($Value -cmatch ('^[0-9a-f]{' + $Length + '}$'))
}
function Test-Property($Object,[string]$Name) { return [bool]($Object -and $Object.PSObject.Properties[$Name]) }
function Test-IntegerValue($Value) { return ($Value -is [int] -or $Value -is [long]) }
# PowerShell 7 turns ISO timestamps inside JSON into DateTime, Windows PowerShell 5.1 keeps the text: both end up as the same text.
function ConvertTo-UtcText($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [DateTime]) { return $Value.ToUniversalTime().ToString('o') }
  if ($Value -isnot [string] -or $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$') { return $null }
  $parsed = [DateTime]::MinValue
  if ([DateTime]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) { return $parsed.ToUniversalTime().ToString('o') }
  return $null
}
function ConvertTo-ComparablePath([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
  try { return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\/') } catch { return '' }
}
function Test-SamePath([string]$Left,[string]$Right) {
  $a = ConvertTo-ComparablePath $Left
  $b = ConvertTo-ComparablePath $Right
  if (!$a -or !$b) { return $false }
  return [string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)
}
function Format-ShortSha([string]$Value) {
  if ("$Value".Length -ge 7) { return "$Value".Substring(0, 7) }
  return 'không rõ'
}
function Format-ShortFingerprint([string]$Value) {
  if ("$Value".Length -ge 12) { return "$Value".Substring(0, 12) }
  return 'không rõ'
}
# Defence in depth: the callers below already run inside Use-LaunchLock; a future caller that forgets it fails closed.
function Assert-LockHeld([string]$What) {
  if ($script:LauncherStale -or $script:LockDepth -lt 1 -or !$script:LockHandle) {
    Fail "Thao tác '$What' đổi artifact hoặc process nên chỉ được chạy khi đang giữ khóa dùng chung của checkout; chưa làm gì cả." 'LAUNCH_LOCK_REQUIRED'
  }
}
# Temp file in the same folder, then rename over the target: a reader sees the old file or the new one, never half of one.
# When the rename fails the old file is untouched and no temp file is left behind.
function Write-TextAtomic([string]$Path,[string]$Text) {
  $directory = Split-Path -Parent $Path
  $temporary = Join-Path $directory ([IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::WriteAllText($temporary, $Text, (New-Object Text.UTF8Encoding($false)))
    for ($attempt = 1; $true; $attempt++) {
      try {
        # [NullString]::Value: a plain $null would reach .NET as an EMPTY string (an illegal path) instead of "no backup file".
        if (Test-Path -LiteralPath $Path -PathType Leaf) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) } else { [IO.File]::Move($temporary, $Path) }
        break
      } catch {
        # A reader (Status) may hold the file for a moment on Windows; anything lasting longer is an error.
        if ($attempt -ge 5) { throw }
        Start-Sleep -Milliseconds 100
      }
    }
  } catch {
    $reason = $_.Exception.Message
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    Fail "Không ghi được tệp trạng thái '$([IO.Path]::GetFileName($Path))' (ghi tạm rồi đổi tên thất bại; tệp cũ được giữ nguyên): $reason" 'STATE_WRITE_FAILED'
  }
}
# State: MISSING | UNREADABLE | INVALID | OK. A file that cannot be read is not the same as a file that is not there.
function Read-JsonObject([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return [pscustomobject]@{ State = 'MISSING'; Data = $null; Detail = '' } }
  $text = $null
  try { $text = [IO.File]::ReadAllText($Path, (New-Object Text.UTF8Encoding($false))) }
  catch { return [pscustomobject]@{ State = 'UNREADABLE'; Data = $null; Detail = "$($_.Exception.Message)" } }
  $data = $null
  try { $data = $text | ConvertFrom-Json } catch { return [pscustomobject]@{ State = 'INVALID'; Data = $null; Detail = 'không phải JSON hợp lệ' } }
  if ($null -eq $data -or $data -isnot [pscustomobject]) { return [pscustomobject]@{ State = 'INVALID'; Data = $null; Detail = 'không phải một đối tượng JSON' } }
  return [pscustomobject]@{ State = 'OK'; Data = $data; Detail = '' }
}

# A target is one local server the launcher can build and run. Only the backend exists today; the frontends of later
# packages describe themselves the same way, so the same identity code serves them.
# Texts and codes that differ between targets (the backend and, since M00.05, the HTTPS front of 11Food / 11Ship). A target
# without the property (for example one a test builds by hand) behaves as the backend.
function Get-TargetText($Target,[string]$Name,[string]$Default) {
  if ($Target -and $Target.PSObject.Properties[$Name] -and "$($Target.$Name)") { return "$($Target.$Name)" }
  return $Default
}
function Get-BackendTarget {
  return [pscustomobject]@{
    Kind = 'backend'
    AppId = 'BACKEND'
    Name = 'backend'
    Label = 'Backend'
    LabelMid = 'backend'
    Noun = 'backend 11Ship'
    Action = 'khởi động backend'
    RegistryName = 'backend.json'
    LogPrefix = 'backend'
    StartFailedCode = 'BACKEND_START_FAILED'
    NotReadyCode = 'BACKEND_NOT_READY'
    Host = [string]$script:BackendHost
    Port = [int]$script:BackendPort
    Script = $script:BackendScript
    ArtifactDir = $script:BackendDist
    ManifestFile = $script:BackendManifestFile
    RegistryFile = $script:StateFile
  }
}
function Get-HeadSha {
  $sha = Capture 'git.exe' @('-C', $script:Repo, 'rev-parse', 'HEAD')
  if ("$sha" -cnotmatch '^[0-9a-f]{40}$') { Fail 'Không đọc được commit hiện tại (git rev-parse HEAD lỗi); dừng an toàn, chưa build hay chạy gì cả.' 'GIT_STATE_UNREADABLE' }
  return $sha
}

# ---- artifact: fingerprint and manifest ----
# SHA-256 over the lines "<relative path>|<SHA-256 of the file>" of every file below the build folder (ordinal order, '/'
# separators), except the manifest at its root. Content, names, added and removed files all change it. $null = no files.
function Get-ArtifactFingerprint([string]$Directory) {
  if (!(Test-Path -LiteralPath $Directory -PathType Container)) { return $null }
  $root = (Resolve-Path -LiteralPath $Directory).Path.TrimEnd([char[]]'\/')
  $names = New-Object 'Collections.Generic.List[string]'
  $fullPaths = New-Object 'Collections.Generic.Dictionary[string,string]'
  foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -File -Force)) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    if ($relative -ceq 'build-manifest.json') { continue }
    $names.Add($relative)
    $fullPaths[$relative] = $file.FullName
  }
  if (!$names.Count) { return $null }
  $ordered = $names.ToArray()
  [Array]::Sort($ordered, [StringComparer]::Ordinal)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $lines = New-Object 'Collections.Generic.List[string]'
    foreach ($relative in $ordered) { $lines.Add($relative + '|' + (ConvertTo-Hex ($sha.ComputeHash([IO.File]::ReadAllBytes($fullPaths[$relative]))))) }
    return (ConvertTo-Hex ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines.ToArray() -join "`n")))))
  } finally { $sha.Clear() }
}
# Empty text = valid. Extra properties are tolerated (a frontend manifest carries more); the five required ones are strict.
function Get-ManifestProblem($Data,[string]$AppId) {
  foreach ($name in @('app_id', 'source_sha', 'build_fingerprint', 'built_at', 'design_version')) {
    if (!(Test-Property $Data $name)) { return "thiếu trường $name" }
  }
  if ($Data.app_id -isnot [string] -or $Data.app_id -cne $AppId) { return "app_id không phải $AppId" }
  if (!(Test-Hex $Data.source_sha 40)) { return 'source_sha phải là 40 ký tự hex thường' }
  if (!(Test-Hex $Data.build_fingerprint 64)) { return 'build_fingerprint phải là 64 ký tự hex thường' }
  if (!(ConvertTo-UtcText $Data.built_at)) { return 'built_at không phải thời điểm UTC hợp lệ' }
  if ($Data.design_version -isnot [string] -or $Data.design_version -cnotmatch '^[0-9A-Za-z._-]{1,32}$') { return 'design_version không hợp lệ' }
  return ''
}
function Write-BuildManifest($Target,[string]$SourceSha,[string]$Fingerprint) {
  Assert-LockHeld 'ghi manifest artifact'
  $manifest = [ordered]@{
    app_id = $Target.AppId
    source_sha = $SourceSha
    build_fingerprint = $Fingerprint
    built_at = [DateTime]::UtcNow.ToString('o')
    design_version = $script:ArtifactDesignVersion
  }
  Write-TextAtomic $Target.ManifestFile (($manifest | ConvertTo-Json) + "`n")
  return [pscustomobject]$manifest
}
# State: MISSING | UNREADABLE | INVALID | OK
function Read-BuildManifest($Target) {
  $read = Read-JsonObject $Target.ManifestFile
  if ($read.State -eq 'MISSING') { return [pscustomobject]@{ State = 'MISSING'; Manifest = $null; Detail = '' } }
  if ($read.State -ne 'OK') { return [pscustomobject]@{ State = $read.State; Manifest = $null; Detail = $read.Detail } }
  $problem = Get-ManifestProblem $read.Data $Target.AppId
  if ($problem) { return [pscustomobject]@{ State = 'INVALID'; Manifest = $null; Detail = $problem } }
  $data = $read.Data
  $manifest = [pscustomobject]@{
    app_id = [string]$data.app_id
    source_sha = [string]$data.source_sha
    build_fingerprint = [string]$data.build_fingerprint
    built_at = (ConvertTo-UtcText $data.built_at)
    design_version = [string]$data.design_version
  }
  return [pscustomobject]@{ State = 'OK'; Manifest = $manifest; Detail = '' }
}
# What the build folder is right now compared with its manifest.
# State: MISSING | UNREADABLE | INVALID | NO_ARTIFACT | CHANGED | OK
function Get-ArtifactState($Target) {
  $read = Read-BuildManifest $Target
  if ($read.State -eq 'MISSING') { return [pscustomobject]@{ State = 'MISSING'; Manifest = $null; Text = 'chưa có manifest (chưa build bằng launcher, hoặc lần build gần nhất lỗi)' } }
  if ($read.State -ne 'OK') { return [pscustomobject]@{ State = $read.State; Manifest = $null; Text = "manifest không dùng được ($($read.Detail))" } }
  $fingerprint = $null
  try { $fingerprint = Get-ArtifactFingerprint $Target.ArtifactDir }
  catch { return [pscustomobject]@{ State = 'UNREADABLE'; Manifest = $read.Manifest; Text = "không đọc được file build ($($_.Exception.Message))" } }
  if (!$fingerprint) { return [pscustomobject]@{ State = 'NO_ARTIFACT'; Manifest = $read.Manifest; Text = 'thư mục build trống hoặc không tồn tại' } }
  if ($fingerprint -cne $read.Manifest.build_fingerprint) { return [pscustomobject]@{ State = 'CHANGED'; Manifest = $read.Manifest; Text = 'file build đã đổi sau lần ghi manifest (manifest cũ, không còn mô tả đúng thư mục build)' } }
  return [pscustomobject]@{ State = 'OK'; Manifest = $read.Manifest; Text = '' }
}

# ---- process registry ----
# Empty text = valid. Every field the identity check needs is required and typed.
function Get-RegistryProblem($Data,$Target) {
  foreach ($name in @('schema', 'app_id', 'pid', 'started_utc', 'repo', 'executable', 'script', 'host', 'port', 'source_sha', 'build_fingerprint', 'built_at', 'design_version')) {
    if (!(Test-Property $Data $name)) { return "thiếu trường $name" }
  }
  if (!(Test-IntegerValue $Data.schema) -or [long]$Data.schema -ne 1) { return 'schema không được hỗ trợ' }
  if ($Data.app_id -isnot [string] -or $Data.app_id -cne $Target.AppId) { return "app_id không phải $($Target.AppId)" }
  if (!(Test-IntegerValue $Data.pid) -or [long]$Data.pid -lt 1 -or [long]$Data.pid -gt 2147483647) { return 'pid không hợp lệ' }
  if (!(ConvertTo-UtcText $Data.started_utc)) { return 'started_utc không phải thời điểm UTC hợp lệ' }
  foreach ($name in @('repo', 'executable', 'script', 'host')) {
    if ($Data.$name -isnot [string] -or [string]::IsNullOrWhiteSpace($Data.$name)) { return "$name không hợp lệ" }
  }
  if (!(Test-IntegerValue $Data.port) -or [long]$Data.port -lt 1 -or [long]$Data.port -gt 65535) { return 'port không hợp lệ' }
  if (!(Test-Hex $Data.source_sha 40)) { return 'source_sha phải là 40 ký tự hex thường' }
  if (!(Test-Hex $Data.build_fingerprint 64)) { return 'build_fingerprint phải là 64 ký tự hex thường' }
  if (!(ConvertTo-UtcText $Data.built_at)) { return 'built_at không phải thời điểm UTC hợp lệ' }
  if ($Data.design_version -isnot [string] -or $Data.design_version -cnotmatch '^[0-9A-Za-z._-]{1,32}$') { return 'design_version không hợp lệ' }
  return ''
}
# State: NONE | UNREADABLE | CORRUPT | LEGACY | OK. LEGACY = valid JSON from an older launcher that recorded no identity.
function Read-TargetRegistry($Target) {
  $read = Read-JsonObject $Target.RegistryFile
  if ($read.State -eq 'MISSING') { return [pscustomobject]@{ State = 'NONE'; Record = $null; Detail = '' } }
  if ($read.State -eq 'UNREADABLE') { return [pscustomobject]@{ State = 'UNREADABLE'; Record = $null; Detail = $read.Detail } }
  if ($read.State -ne 'OK') { return [pscustomobject]@{ State = 'CORRUPT'; Record = $null; Detail = $read.Detail } }
  if (!(Test-Property $read.Data 'schema')) { return [pscustomobject]@{ State = 'LEGACY'; Record = $null; Detail = '' } }
  $problem = Get-RegistryProblem $read.Data $Target
  if ($problem) { return [pscustomobject]@{ State = 'CORRUPT'; Record = $null; Detail = $problem } }
  $data = $read.Data
  $record = [pscustomobject]@{
    schema = [int]$data.schema
    app_id = [string]$data.app_id
    pid = [int]$data.pid
    started_utc = (ConvertTo-UtcText $data.started_utc)
    repo = [string]$data.repo
    executable = [string]$data.executable
    script = [string]$data.script
    host = [string]$data.host
    port = [int]$data.port
    source_sha = [string]$data.source_sha
    build_fingerprint = [string]$data.build_fingerprint
    built_at = (ConvertTo-UtcText $data.built_at)
    design_version = [string]$data.design_version
  }
  return [pscustomobject]@{ State = 'OK'; Record = $record; Detail = '' }
}
function Write-TargetRegistry($Target,$Details,$Manifest,[string]$Stdout,[string]$Stderr) {
  Assert-LockHeld 'ghi bản ghi process'
  $record = [ordered]@{
    schema = 1
    app_id = $Target.AppId
    pid = [int]$Details.ProcessId
    started_utc = (ConvertTo-UtcText $Details.StartUtc)
    repo = $script:Repo
    executable = [string]$Details.Executable
    script = $Target.Script
    host = $Target.Host
    port = [int]$Target.Port
    source_sha = $Manifest.source_sha
    build_fingerprint = $Manifest.build_fingerprint
    built_at = $Manifest.built_at
    design_version = $Manifest.design_version
    stdout = $Stdout
    stderr = $Stderr
  }
  Write-TextAtomic $Target.RegistryFile (($record | ConvertTo-Json) + "`n")
}
function Remove-TargetRegistry($Target) {
  Assert-LockHeld 'xóa bản ghi process'
  try { Remove-Item -LiteralPath $Target.RegistryFile -Force -ErrorAction Stop }
  catch {
    if (Test-Path -LiteralPath $Target.RegistryFile) { Fail "Không xóa được bản ghi process '$([IO.Path]::GetFileName($Target.RegistryFile))': $($_.Exception.Message)" 'STATE_WRITE_FAILED' }
  }
}

# ---- what the operating system says about a process and a port (seams: tests replace these) ----
# Windows command line -> arguments (quotes group, spaces separate). Element 0 is the executable.
function Split-CommandLine([string]$Text) {
  $tokens = New-Object 'Collections.Generic.List[string]'
  $builder = New-Object Text.StringBuilder
  $inQuotes = $false
  $started = $false
  foreach ($character in "$Text".ToCharArray()) {
    if ($character -eq [char]'"') { $inQuotes = !$inQuotes; $started = $true; continue }
    if (!$inQuotes -and [char]::IsWhiteSpace($character)) {
      if ($started) { $tokens.Add($builder.ToString()); [void]$builder.Clear(); $started = $false }
      continue
    }
    [void]$builder.Append($character)
    $started = $true
  }
  if ($started) { $tokens.Add($builder.ToString()) }
  return @($tokens.ToArray())
}
# The first argument after the executable that is not an option: for "node --env-file-if-exists=.env <script>" the script.
function Get-ScriptArgument($Arguments) {
  if ($null -eq $Arguments) { return '' }
  $list = @($Arguments)
  for ($index = 1; $index -lt $list.Count; $index++) {
    $token = "$($list[$index])"
    if ($token -and !$token.StartsWith('-')) { return $token }
  }
  return ''
}
# $null = no such process. Inspectable = $false = the process EXISTS but its identity cannot be read (start time, path or
# command line): an unknown identity, which is neither "ours" nor proof that anything ended. Throws when the OS cannot answer at all.
function Get-ProcessDetails([int]$ProcessId) {
  if (!(Test-IsWindows)) { throw 'Kiểm tra process chỉ được hỗ trợ trên Windows.' }
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  $start = $null
  try { $start = $process.StartTime.ToUniversalTime().ToString('o') } catch { }
  $cim = $null
  try { $cim = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop } catch { }
  if (!$start -or !$cim -or !$cim.ExecutablePath) {
    if (!(Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $null }
    return [pscustomobject]@{ ProcessId = $ProcessId; Name = "$($process.ProcessName)"; Inspectable = $false; StartUtc = ''; Executable = ''; CommandLine = ''; Arguments = @() }
  }
  return [pscustomobject]@{
    ProcessId = $ProcessId
    Name = "$($process.ProcessName)"
    Inspectable = $true
    StartUtc = $start
    Executable = "$($cim.ExecutablePath)"
    CommandLine = "$($cim.CommandLine)"
    Arguments = @(Split-CommandLine "$($cim.CommandLine)")
  }
}
# Every listening TCP socket on the port as { Address; ProcessId }. Readable = $false means the answer is unknown: it is
# never read as "nobody listens". (An empty list is returned inside the object, so it cannot be mistaken for $null.)
function Get-PortListeners([int]$Port) {
  if (!(Test-IsWindows)) { return [pscustomobject]@{ Readable = $false; Items = @(); Detail = 'chỉ hỗ trợ Windows' } }
  $rows = $null
  try { $rows = @(Get-NetTCPConnection -State Listen -ErrorAction Stop) }
  catch { return [pscustomobject]@{ Readable = $false; Items = @(); Detail = "$($_.Exception.Message)" } }
  $items = New-Object 'Collections.Generic.List[object]'
  foreach ($row in $rows) {
    if ([int]$row.LocalPort -eq $Port) { $items.Add([pscustomobject]@{ Address = "$($row.LocalAddress)"; ProcessId = [int]$row.OwningProcess }) }
  }
  return [pscustomobject]@{ Readable = $true; Items = @($items.ToArray()); Detail = '' }
}
# Windows only: stop a process through ONE open handle. While the handle is open the process object (and so its PID) cannot be
# recycled, so the start time that is checked and the process that is terminated are the same instance.
function Initialize-ProcessNative {
  if ('ShipLauncher.ProcessNative' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace ShipLauncher {
  public static class ProcessNative {
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetProcessTimes(IntPtr handle, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateProcess(IntPtr handle, uint exitCode);
    [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  }
}
'@
}
# Ends the process behind $ProcessId ONLY IF its start time is $ExpectedStartUtc (the instance the caller verified).
# Returns 'STOPPED' (the process has exited), 'NOT_FOUND' (no such process) or 'REPLACED' (the PID belongs to a process with
# another start time: nothing was touched). Throws when the process cannot be ended.
function Stop-OwnedProcess([int]$ProcessId,[string]$ExpectedStartUtc) {
  if (!(Test-IsWindows)) { throw 'Dừng process chỉ được hỗ trợ trên Windows.' }
  $expected = ConvertTo-UtcText $ExpectedStartUtc
  if (!$expected) { throw 'Thiếu giờ khởi động đã xác minh của process; không dừng theo PID đơn lẻ.' }
  Initialize-ProcessNative
  # PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE
  $handle = [ShipLauncher.ProcessNative]::OpenProcess([uint32]0x00101001, $false, $ProcessId)
  if ($handle -eq [IntPtr]::Zero) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($code -eq 87) { return 'NOT_FOUND' }
    throw "OpenProcess lỗi (mã Win32 $code)"
  }
  try {
    $creation = [long]0; $exited = [long]0; $kernel = [long]0; $user = [long]0
    if (![ShipLauncher.ProcessNative]::GetProcessTimes($handle, [ref]$creation, [ref]$exited, [ref]$kernel, [ref]$user)) {
      throw "GetProcessTimes lỗi (mã Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    }
    if ([DateTime]::FromFileTimeUtc($creation).ToString('o') -cne $expected) { return 'REPLACED' }
    if (![ShipLauncher.ProcessNative]::TerminateProcess($handle, [uint32]1)) {
      $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      # Already exited (the handle still exists): that is the outcome we want.
      if ([ShipLauncher.ProcessNative]::WaitForSingleObject($handle, [uint32]0) -ne 0) { throw "TerminateProcess lỗi (mã Win32 $code)" }
      return 'STOPPED'
    }
    if ([ShipLauncher.ProcessNative]::WaitForSingleObject($handle, [uint32]10000) -ne 0) { throw 'process chưa thoát sau lệnh dừng' }
    return 'STOPPED'
  } finally { [void][ShipLauncher.ProcessNative]::CloseHandle($handle) }
}
# Ends a process that THIS launcher just created, through the object Start-Process returned. That object keeps its own handle
# to the original process, so it can never end whoever holds the PID later. Never looks anything up by PID.
function Stop-StartedChild($Child) {
  try { if ($Child -and !$Child.HasExited) { $Child.Kill() } } catch { }
}

# ---- ownership: who is behind the registry and who is behind the port ----
function Test-ProcessMatchesTarget($Details,$Target) {
  if (!$Details -or !$Details.Inspectable) { return $false }
  if ([IO.Path]::GetFileName("$($Details.Executable)") -cnotmatch '(?i)^node(\.exe)?$') { return $false }
  $scriptArgument = Get-ScriptArgument $Details.Arguments
  if (!$scriptArgument) { return $false }
  return (Test-SamePath $scriptArgument $Target.Script)
}
function New-Ownership([string]$Status,[string]$Text,$Registry,$Details) {
  return [pscustomobject]@{ Status = $Status; Text = $Text; Registry = $Registry; Details = $Details }
}
# Status: NONE (no record) | STALE (the recorded process is gone, or its PID now belongs to another process; nothing to stop)
#         | UNVERIFIED (cannot be proven either way: nothing may be stopped or replaced) | OWNED (proven ours).
function Get-TargetOwnership($Target) {
  $registry = Read-TargetRegistry $Target
  if ($registry.State -eq 'NONE') { return (New-Ownership 'NONE' 'không có bản ghi process do launcher quản lý' $null $null) }
  if ($registry.State -eq 'UNREADABLE') { return (New-Ownership 'UNVERIFIED' "không đọc được tệp trạng thái ($($registry.Detail))" $null $null) }
  if ($registry.State -eq 'CORRUPT') { return (New-Ownership 'UNVERIFIED' "tệp trạng thái hỏng hoặc thiếu trường ($($registry.Detail))" $null $null) }
  if ($registry.State -eq 'LEGACY') { return (New-Ownership 'UNVERIFIED' 'tệp trạng thái do bản launcher cũ ghi, không có định danh (repo, lệnh chạy, commit, fingerprint)' $null $null) }
  $record = $registry.Record
  if (!(Test-SamePath $record.repo $script:Repo)) { return (New-Ownership 'UNVERIFIED' "bản ghi thuộc checkout khác ($($record.repo))" $record $null) }
  if (!(Test-SamePath $record.script $Target.Script) -or [int]$record.port -ne [int]$Target.Port -or $record.host -cne $Target.Host) {
    return (New-Ownership 'UNVERIFIED' 'bản ghi dùng script, host hoặc cổng khác cấu hình hiện tại' $record $null)
  }
  $details = $null
  try { $details = Get-ProcessDetails ([int]$record.pid) }
  catch { return (New-Ownership 'UNVERIFIED' "không kiểm tra được process PID $($record.pid) ($($_.Exception.Message))" $record $null) }
  if ($null -eq $details) { return (New-Ownership 'STALE' "process PID $($record.pid) đã kết thúc" $record $null) }
  # The PID exists but its identity cannot be read: unknown, so neither "ours" nor "gone" (the registry must be kept).
  if (!$details.Inspectable) { return (New-Ownership 'UNVERIFIED' "process PID $($record.pid) đang tồn tại nhưng không đọc được định danh (giờ khởi động, đường dẫn, dòng lệnh)" $record $details) }
  if ((ConvertTo-UtcText $details.StartUtc) -cne $record.started_utc) { return (New-Ownership 'STALE' "PID $($record.pid) đã được dùng lại bởi process khác (giờ khởi động khác bản ghi)" $record $details) }
  if (!(Test-SamePath $details.Executable $record.executable) -or !(Test-ProcessMatchesTarget $details $Target)) {
    return (New-Ownership 'UNVERIFIED' "process PID $($record.pid) có đúng giờ khởi động nhưng không phải node chạy script build của checkout này" $record $details)
  }
  return (New-Ownership 'OWNED' "process PID $($record.pid) khớp bản ghi" $record $details)
}
function Test-ConflictingListener([string]$Address) {
  return ("$Address" -in @('127.0.0.1', '0.0.0.0', '::', '::1', '[::]', '[::1]'))
}
# State: FREE | OURS (every loopback or wildcard listener is $OwnerProcessId) | FOREIGN | UNREADABLE (never treated as FREE).
# HTTP is not asked at all: a foreign process that answers 200 with the right body is still foreign.
function Get-TargetPortState($Target,[int]$OwnerProcessId) {
  $probe = $null
  try { $probe = Get-PortListeners ([int]$Target.Port) } catch { $probe = $null }
  if (!$probe -or !$probe.Readable) { return [pscustomobject]@{ State = 'UNREADABLE'; Foreign = @(); Owners = @() } }
  $relevant = @($probe.Items | Where-Object { Test-ConflictingListener $_.Address })
  if (!$relevant.Count) { return [pscustomobject]@{ State = 'FREE'; Foreign = @(); Owners = @() } }
  $owners = @($relevant | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
  $foreign = @($owners | Where-Object { $OwnerProcessId -le 0 -or $_ -ne $OwnerProcessId })
  if ($foreign.Count) { return [pscustomobject]@{ State = 'FOREIGN'; Foreign = $foreign; Owners = $owners } }
  return [pscustomobject]@{ State = 'OURS'; Foreign = @(); Owners = $owners }
}
function Get-ProcessLabel([int]$ProcessId) {
  try {
    $details = Get-ProcessDetails $ProcessId
    if ($details) { return "PID $ProcessId ($($details.Name))" }
  } catch { }
  return "PID $ProcessId"
}
function Get-UnverifiedText($Target,$Ownership,[string]$Action) {
  $noun = Get-TargetText $Target 'Noun' 'backend 11Ship'
  $registryName = Get-TargetText $Target 'RegistryName' 'backend.json'
  return ("Không xác minh được process $($Target.Name) do launcher quản lý: $($Ownership.Text). Launcher dừng an toàn ($Action): không build, không migration, không khởi động hay dừng process nào và giữ nguyên tệp trạng thái. PID tồn tại hoặc cổng $($Target.Port) trả HTTP 200 không phải bằng chứng. Nếu chắc chắn không còn $noun nào đang chạy: đóng process node đang giữ cổng $($Target.Port) (nếu có), xóa .11ship-local\$registryName rồi chạy lại.")
}
function Get-PortInUseText($Target,$Port) {
  $labels = @($Port.Foreign | ForEach-Object { Get-ProcessLabel ([int]$_) })
  return ("Cổng $($Target.Port) đang do process không thuộc launcher chiếm ($($labels -join ', ')). Launcher chỉ dừng process đã chứng minh là của mình nên không đụng tới nó, kể cả khi nó trả HTTP 200 đúng như backend. Hãy tự đóng dịch vụ đó rồi chạy lại. Chưa build, chưa migration, chưa khởi động hay dừng gì cả.")
}
# Ownership and port together, failing closed on anything that cannot be proven.
function Get-TargetSituation($Target,[string]$Action) {
  $ownership = Get-TargetOwnership $Target
  if ($ownership.Status -eq 'UNVERIFIED') { Fail (Get-UnverifiedText $Target $ownership $Action) 'PROCESS_IDENTITY_UNVERIFIED' }
  $ownerProcessId = 0
  if ($ownership.Status -eq 'OWNED') { $ownerProcessId = [int]$ownership.Registry.pid }
  $port = Get-TargetPortState $Target $ownerProcessId
  if ($port.State -eq 'UNREADABLE') { Fail "Không đọc được process đang lắng nghe cổng $($Target.Port). Không chứng minh được cổng thuộc launcher nên dừng an toàn ($Action): chưa build, chưa migration, chưa khởi động hay dừng gì cả." 'PORT_OWNER_UNREADABLE' }
  if ($port.State -eq 'FOREIGN') { Fail (Get-PortInUseText $Target $port) 'PORT_IN_USE' }
  return [pscustomobject]@{ Ownership = $ownership; Port = $port }
}

# ---- stopping: only what was proven, only that PID ----
function Wait-ProcessGone($Record,[int]$Seconds) {
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  do {
    $details = $null
    $known = $true
    try { $details = Get-ProcessDetails ([int]$Record.pid) } catch { $known = $false }
    if ($known) {
      # Gone (absent), or the PID now belongs to another process (a start time that was READ and differs): only these two
      # observations prove the recorded process ended. A process that exists but cannot be inspected proves nothing.
      if ($null -eq $details) { return $true }
      if ($details.Inspectable -and (ConvertTo-UtcText $details.StartUtc) -cne $Record.started_utc) { return $true }
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $until)
  return $false
}
function Stop-TargetProcess($Target,$Ownership) {
  Assert-LockHeld 'dừng process'
  if ($Ownership.Status -ne 'OWNED') { Fail 'Chỉ được dừng process đã xác minh là của launcher.' 'PROCESS_IDENTITY_UNVERIFIED' }
  $label = Get-TargetText $Target 'Label' 'Backend'
  $labelMid = Get-TargetText $Target 'LabelMid' 'backend'
  $record = $Ownership.Registry
  # Proven again immediately before the kill: the process may have ended and its PID been reused since the first check.
  $again = Get-TargetOwnership $Target
  if ($again.Status -eq 'NONE' -or $again.Status -eq 'STALE') {
    Write-Info "$label PID $($record.pid) đã kết thúc trước khi dừng; chỉ dọn bản ghi."
    Remove-TargetRegistry $Target
    return
  }
  if ($again.Status -ne 'OWNED' -or [int]$again.Registry.pid -ne [int]$record.pid) { Fail (Get-UnverifiedText $Target $again 'dừng process') 'PROCESS_IDENTITY_UNVERIFIED' }
  # The stop names the start time that was just verified, so it can only end that very instance.
  $outcome = ''
  try { $outcome = "$(Stop-OwnedProcess ([int]$record.pid) $record.started_utc)" }
  catch { Fail "Không dừng được $labelMid PID $($record.pid): $($_.Exception.Message). Bản ghi được giữ nguyên." 'PROCESS_STOP_FAILED' }
  if ($outcome -eq 'NOT_FOUND' -or $outcome -eq 'REPLACED') {
    # Nothing was ended by this call. Only a fresh observation of absence / another start time counts as "it ended".
    $after = Get-TargetOwnership $Target
    if ($after.Status -eq 'NONE' -or $after.Status -eq 'STALE') {
      Write-Info "$label PID $($record.pid) đã kết thúc (PID không còn thuộc process đã ghi); không dừng process nào, chỉ dọn bản ghi."
      Remove-TargetRegistry $Target
      return
    }
    Fail "Không xác nhận được $labelMid PID $($record.pid) đã kết thúc ($($after.Text)). Launcher không dừng process nào khác; bản ghi được giữ nguyên." 'PROCESS_STOP_FAILED'
  }
  if (!(Wait-ProcessGone $record $script:ProcessStopSeconds)) {
    Fail "$label PID $($record.pid) vẫn chạy sau $($script:ProcessStopSeconds) giây. Launcher không dùng cách mạnh hơn và không đụng process khác; bản ghi được giữ nguyên." 'PROCESS_STOP_FAILED'
  }
  Remove-TargetRegistry $Target
}
function Stop-TargetIfOwned($Target,[string]$Why) {
  $ownership = Get-TargetOwnership $Target
  if ($ownership.Status -eq 'UNVERIFIED') { Fail (Get-UnverifiedText $Target $ownership $Why) 'PROCESS_IDENTITY_UNVERIFIED' }
  if ($ownership.Status -ne 'OWNED') { return $false }
  Write-Info "Dừng $(Get-TargetText $Target 'LabelMid' 'backend') do launcher quản lý (PID $($ownership.Registry.pid)) $Why."
  Stop-TargetProcess $Target $ownership
  return $true
}

# ---- backend: health, start, build ----
function Get-BackendUrl([string]$Kind) { return ('http://' + $script:BackendHost + ':' + $script:BackendPort + '/v1/health/' + $Kind) }
function Get-HttpResult([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = "$($response.Content)" }
  } catch {
    if ($_.Exception.Response) { return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = '' } }
    return [pscustomobject]@{ Status = 0; Body = '' }
  }
}
function Http-Status([string]$Url) { return (Get-HttpResult $Url).Status }
# The health endpoints keep their agreed body: {"data":{"status":"ok"}} and {"data":{"status":"ready"}}.
function Test-HealthBody($Result,[string]$Expected) {
  if (!$Result -or [int]$Result.Status -ne 200) { return $false }
  $json = $null
  try { $json = "$($Result.Body)" | ConvertFrom-Json } catch { return $false }
  if (!$json -or !(Test-Property $json 'data') -or !$json.data -or !(Test-Property $json.data 'status')) { return $false }
  return ("$($json.data.status)" -ceq $Expected)
}
function Get-BackendHealth {
  $live = Get-HttpResult (Get-BackendUrl 'live')
  $ready = Get-HttpResult (Get-BackendUrl 'ready')
  return [pscustomobject]@{ LiveOk = (Test-HealthBody $live 'ok'); ReadyOk = (Test-HealthBody $ready 'ready'); LiveStatus = [int]$live.Status; ReadyStatus = [int]$ready.Status }
}
# Compatibility readers (older callers and tests): the registry data, or the proven process; $null for anything else.
function Get-BackendState {
  $registry = Read-TargetRegistry (Get-BackendTarget)
  if ($registry.State -ne 'OK') { return $null }
  return $registry.Record
}
function Get-OwnedBackendProcess {
  $ownership = Get-TargetOwnership (Get-BackendTarget)
  if ($ownership.Status -ne 'OWNED') { return $null }
  return [pscustomobject]@{ Id = [int]$ownership.Registry.pid; Name = $ownership.Details.Name }
}
# The entry script is passed as an ABSOLUTE path (quoted when it has spaces) so the command line of the running process
# names exactly which build it runs; the working folder is still the repository for .env.
function Get-BackendStartArguments { return @('--env-file-if-exists=.env', (ConvertTo-QuotedArgument $script:BackendScript)) }
function Start-BackendProcess([string]$Stdout,[string]$Stderr) {
  $child = Start-Process -FilePath 'node.exe' -ArgumentList (Get-BackendStartArguments) -WorkingDirectory $script:Repo -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru -WindowStyle Hidden
  # Cache the OS handle now: from here on this object refers to exactly this process, also after it exits and its PID is reused.
  if ($child) { $null = $child.Handle }
  return $child
}
# Ready means: the process we started is alive with the same start time, THE PORT BELONGS TO IT (not to someone who also
# answers), and both health endpoints return their agreed body.
function Wait-Backend($Target,[int]$ExpectedProcessId,[string]$ExpectedStartUtc) {
  $until = [DateTime]::UtcNow.AddSeconds($script:BackendReadySeconds)
  $problem = 'chưa phản hồi'
  $code = 'BACKEND_NOT_READY'
  do {
    $details = $null
    try { $details = Get-ProcessDetails $ExpectedProcessId } catch { $details = $null }
    if (!$details -or !$details.Inspectable -or (ConvertTo-UtcText $details.StartUtc) -cne $ExpectedStartUtc) {
      $problem = "process backend PID $ExpectedProcessId đã thoát sớm"
      $code = 'BACKEND_NOT_READY'
      break
    }
    $port = Get-TargetPortState $Target $ExpectedProcessId
    if ($port.State -eq 'FOREIGN') { $problem = "cổng $($Target.Port) còn do process khác giữ nên không chứng minh được phản hồi là của backend này"; $code = 'PORT_IN_USE' }
    elseif ($port.State -eq 'UNREADABLE') { $problem = "không đọc được process đang giữ cổng $($Target.Port)"; $code = 'PORT_OWNER_UNREADABLE' }
    elseif ($port.State -eq 'FREE') { $problem = "process chưa lắng nghe cổng $($Target.Port)"; $code = 'BACKEND_NOT_READY' }
    else {
      $health = Get-BackendHealth
      if ($health.LiveOk -and $health.ReadyOk) { Write-Ok "Backend live và ready (đúng process PID $ExpectedProcessId giữ cổng): $(Get-BackendUrl 'ready')"; return }
      $problem = "health chưa đúng (live=$($health.LiveStatus) ready=$($health.ReadyStatus), body phải là status ok / ready)"
      $code = 'BACKEND_NOT_READY'
    }
    Start-Sleep -Milliseconds $script:BackendPollMilliseconds
  } while ([DateTime]::UtcNow -lt $until)
  Fail "Backend chưa ready ($problem); xem log trong $script:Logs." $code
}
# A manifest describes a FINISHED build, so it is removed before the build starts: a build that fails leaves no manifest
# and therefore no fingerprint that could be mistaken for a ready artifact. The process that is running is not touched.
function Build-BackendArtifact($Target,[string]$Head) {
  Assert-LockHeld 'build backend'
  try { Remove-Item -LiteralPath $Target.ManifestFile -Force -ErrorAction Stop }
  catch {
    if (Test-Path -LiteralPath $Target.ManifestFile) { Fail "Không xóa được manifest cũ trước khi build: $($_.Exception.Message)" 'STATE_WRITE_FAILED' }
  }
  $script:BuildExitCode = 0
  Invoke-InRepo { & npm.cmd run build | Out-Host; $script:BuildExitCode = $LASTEXITCODE }
  if ($script:BuildExitCode -ne 0) {
    Fail "Build backend thất bại (npm.cmd exit $($script:BuildExitCode)). Launcher không ghi manifest hay fingerprint mới; backend đang chạy (nếu có) không bị đụng tới và vẫn là bản cũ." 'APP_BUILD_FAILED'
  }
  if (!(Test-Path -LiteralPath $Target.Script -PathType Leaf)) {
    Fail "Build báo thành công nhưng không có file chạy $($Target.Script); không ghi manifest." 'APP_BUILD_FAILED'
  }
  $fingerprint = $null
  try { $fingerprint = Get-ArtifactFingerprint $Target.ArtifactDir }
  catch { Fail "Không đọc được file build để tính fingerprint: $($_.Exception.Message)" 'ARTIFACT_UNREADABLE' }
  if (!$fingerprint) { Fail 'Thư mục build không có file nào sau khi build; không ghi manifest.' 'APP_BUILD_FAILED' }
  $manifest = Write-BuildManifest $Target $Head $fingerprint
  Write-Ok "Build backend xong: commit $(Format-ShortSha $Head), fingerprint $(Format-ShortFingerprint $fingerprint)"
  return $manifest
}
function Get-RestartReasons($Situation,$Manifest,[string]$Head,$Target=$null) {
  $reasons = New-Object 'Collections.Generic.List[string]'
  $record = $Situation.Ownership.Registry
  if ($Situation.Port.State -ne 'OURS') { $reasons.Add('process không lắng nghe cổng đã ghi') }
  if ($record.source_sha -cne $Manifest.source_sha -or $record.source_sha -cne $Head) {
    $reasons.Add("khác commit (process chạy $(Format-ShortSha $record.source_sha), mã nguồn và artifact mới $(Format-ShortSha $Head))")
  }
  if ($record.build_fingerprint -cne $Manifest.build_fingerprint) {
    $reasons.Add("khác fingerprint artifact (process $(Format-ShortFingerprint $record.build_fingerprint), artifact mới $(Format-ShortFingerprint $Manifest.build_fingerprint))")
  }
  if (!$reasons.Count -and (Get-TargetText $Target 'Kind' 'backend') -eq 'app') {
    $probe = Test-AppRuntime $Target $Manifest
    if (!$probe.Ok) { $reasons.Add("kiểm tra danh tính/health qua cổng HTTPS không đạt ($($probe.Code))") }
  }
  elseif (!$reasons.Count) {
    $health = Get-BackendHealth
    if (!$health.LiveOk -or !$health.ReadyOk) { $reasons.Add("health không đúng (live=$($health.LiveStatus) ready=$($health.ReadyStatus) hoặc body sai)") }
  }
  return @($reasons.ToArray())
}
function Start-NewBackendProcess($Target,$Manifest) {
  Assert-LockHeld 'khởi động backend'
  $label = Get-TargetText $Target 'Label' 'Backend'
  $labelMid = Get-TargetText $Target 'LabelMid' 'backend'
  $startFailedCode = Get-TargetText $Target 'StartFailedCode' 'BACKEND_START_FAILED'
  $notReadyCode = Get-TargetText $Target 'NotReadyCode' 'BACKEND_NOT_READY'
  $port = Get-TargetPortState $Target 0
  if ($port.State -eq 'UNREADABLE') { Fail "Không đọc được process đang lắng nghe cổng $($Target.Port); không khởi động $labelMid." 'PORT_OWNER_UNREADABLE' }
  if ($port.State -ne 'FREE') { Fail (Get-PortInUseText $Target $port) 'PORT_IN_USE' }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $prefix = Get-TargetText $Target 'LogPrefix' 'backend'
  $stdout = Join-Path $script:Logs "$prefix-$stamp.log"
  $stderr = Join-Path $script:Logs "$prefix-$stamp.err.log"
  $process = $null
  try { $process = Start-TargetChild $Target $stdout $stderr }
  catch { Fail "Không khởi động được ${labelMid}: $($_.Exception.Message)" $startFailedCode }
  if (!$process -or !$process.Id) { Fail "Không khởi động được $labelMid (không có process trả về)." $startFailedCode }
  $startedProcessId = [int]$process.Id
  # The process was created by this launcher a moment ago. Its OWN start time comes from the object Start-Process returned (it
  # holds a handle to the original process). The lookup by PID below only counts when it reports that same start time: if the
  # child already exited and Windows gave its PID to another process, that process is not ours and is never touched.
  # Every cleanup goes through $process itself (Stop-StartedChild), never through a PID.
  $ownStartUtc = $null
  try { $ownStartUtc = ConvertTo-UtcText $process.StartTime.ToUniversalTime().ToString('o') } catch { $ownStartUtc = $null }
  $details = $null
  try { $details = Get-ProcessDetails $startedProcessId } catch { $details = $null }
  $problem = ''
  if (!$ownStartUtc) { $problem = 'không đọc được giờ khởi động của process vừa tạo' }
  elseif (!$details -or !$details.Inspectable) { $problem = 'process vừa khởi động đã thoát hoặc không kiểm tra được' }
  elseif ((ConvertTo-UtcText $details.StartUtc) -cne $ownStartUtc) { $problem = 'process vừa tạo đã thoát và PID hiện thuộc process khác (không đụng tới process đó)' }
  elseif (!(Test-ProcessMatchesTarget $details $Target)) { $problem = 'process vừa khởi động không phải node chạy script build của checkout này' }
  if ($problem) {
    Stop-StartedChild $process
    Fail "$label vừa khởi động không xác minh được ($problem); chỉ process do launcher vừa tạo (nếu còn chạy) bị dừng. Xem log trong $script:Logs." $notReadyCode
  }
  try { Write-TargetRegistry $Target $details $Manifest $stdout $stderr }
  catch {
    $writeError = $_
    Stop-StartedChild $process
    throw $writeError
  }
  Wait-TargetReady $Target $Manifest $startedProcessId (ConvertTo-UtcText $details.StartUtc)
  Write-Ok "$label do launcher quản lý đã sẵn sàng và được xác minh: PID $startedProcessId, commit $(Format-ShortSha $Manifest.source_sha), fingerprint $(Format-ShortFingerprint $Manifest.build_fingerprint)"
}
# Decides between reuse, restart of the launcher's own process, and a fresh start. A process is reused ONLY when it is
# proven ours, listens on the port, runs exactly this source SHA and fingerprint, and answers the health bodies.
function Start-OrReuseBackend($Target,$Manifest,[string]$Head) {
  $label = Get-TargetText $Target 'Label' 'Backend'
  $situation = Get-TargetSituation $Target (Get-TargetText $Target 'Action' 'khởi động backend')
  $ownership = $situation.Ownership
  if ($ownership.Status -eq 'OWNED') {
    $reasons = @(Get-RestartReasons $situation $Manifest $Head $Target)
    if (!$reasons.Count) {
      Write-Ok "$label do launcher quản lý đang chạy đúng bản (PID $($ownership.Registry.pid), commit $(Format-ShortSha $Head), fingerprint $(Format-ShortFingerprint $Manifest.build_fingerprint)); dùng lại, không mở thêm bản thứ hai."
      return
    }
    Write-Info "$label đang chạy (PID $($ownership.Registry.pid)) không khớp bản mong đợi: $($reasons -join '; '). Dừng đúng process do launcher quản lý rồi khởi động lại."
    Stop-TargetProcess $Target $ownership
  }
  Start-NewBackendProcess $Target $Manifest
}
# ---------------------------------------------------------------------------------------------
# Phone apps (M00.05): the local HTTPS front of 11Food (8444) and 11Ship (8445) is a target like the backend
# ---------------------------------------------------------------------------------------------
# The front is scripts/food-web-dev.mjs / ship-web-dev.mjs (node), serving apps/<app>/dist over https://localhost:<port> and
# forwarding ONLY GET /v1/health/live and /v1/health/ready to the backend. It is built, started, reused, restarted and stopped with
# the SAME identity code as the backend (manifest + fingerprint, process record, ownership, port proof, shared lock). The browser
# is opened only after the process we started holds the port, answers /__11ship/runtime as the right app and build, and carries the
# backend's health bodies through (scripts/client-web-check.mjs probe, which pins the local certificate; nothing is switched off).
$script:AppReadySeconds = 30
$script:AppPollMilliseconds = 500
function Get-AppTarget([string]$AppId) {
  $entry = $script:AppCatalog[$AppId]
  if (!$entry -or $entry.Launch -ne 'client') { Fail "Ứng dụng $AppId không có máy chủ HTTPS do launcher quản lý." 'APP_UNKNOWN' }
  $dist = Join-Path (Join-Path (Join-Path $script:Repo 'apps') $entry.Key) 'dist'
  return [pscustomobject]@{
    Kind = 'app'
    AppId = $entry.Key
    Name = $entry.Short
    Label = $entry.Short
    LabelMid = $entry.Short
    Noun = "máy chủ HTTPS $($entry.Short)"
    Action = "khởi động $($entry.Short)"
    RegistryName = "$($entry.Key).json"
    LogPrefix = $entry.Key
    StartFailedCode = 'APP_START_FAILED'
    NotReadyCode = 'APP_START_FAILED'
    BuildScript = $entry.BuildScript
    Host = '127.0.0.1'
    Port = ([Uri]$entry.Url).Port
    Script = (Join-Path (Join-Path $script:Repo 'scripts') ([IO.Path]::GetFileName($entry.Runtime)))
    ArtifactDir = $dist
    ManifestFile = (Join-Path $dist 'build-manifest.json')
    RegistryFile = (Join-Path $script:StateDir "$($entry.Key).json")
  }
}
# Runs scripts/client-web-check.mjs (cert | probe) and returns its one JSON line as Ok/Code/Message. The checker exits 1 for
# every refusal and still prints the reason, so the exit code alone is not the answer (Capture would return $null).
function Invoke-ClientCheck([string[]]$Arguments) {
  $checker = Join-Path (Join-Path $script:Repo 'scripts') 'client-web-check.mjs'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $lines = @()
  try {
    Push-Location -LiteralPath $script:Repo
    try { $lines = @(& node.exe $checker @Arguments 2>&1) } finally { Pop-Location }
  } catch { $lines = @() }
  finally { $ErrorActionPreference = $previous }
  $json = $null
  foreach ($line in @($lines | ForEach-Object { "$_" } | Where-Object { $_.StartsWith('{') })) { try { $json = $line | ConvertFrom-Json } catch { } }
  if (!$json -or !(Test-Property $json 'ok') -or !(Test-Property $json 'code')) {
    return [pscustomobject]@{ Ok = $false; Code = 'CHECK_UNAVAILABLE'; Message = 'không đọc được kết quả của scripts/client-web-check.mjs' }
  }
  return [pscustomobject]@{ Ok = ($json.ok -eq $true); Code = "$($json.code)"; Message = "$($json.message)" }
}
function Get-CertificateFailCode([string]$Code) {
  if ($Code -in @('TLS_CERT_MISSING', 'TLS_KEY_MISSING')) { return 'APP_CERT_MISSING' }
  if ($Code -eq 'TLS_CERT_EXPIRED') { return 'APP_CERT_EXPIRED' }
  if ($Code -eq 'TLS_CERT_SAN_MISMATCH') { return 'APP_CERT_SAN_MISMATCH' }
  return 'APP_CERT_INVALID'
}
# Before anything is changed: the local certificate must exist, be in date, name localhost and 127.0.0.1 and match its key.
# The launcher never creates or installs one and never switches TLS verification off: that is the Owner's one-time setup.
function Assert-AppCertificate {
  $check = Invoke-ClientCheck @('cert')
  if ($check.Ok) { return }
  Fail ("Chứng chỉ HTTPS local chưa dùng được ($($check.Code)): $($check.Message). Launcher không tự tạo hay cài chứng chỉ và không tắt kiểm tra TLS. Hãy làm một lần theo ops\runbooks\local-https-runtime.md rồi chạy lại. Chưa làm gì: không cập nhật mã, không bật database hoặc backend, không mở trình duyệt.") (Get-CertificateFailCode $check.Code)
}
function Test-AppRuntime($Target,$Manifest) {
  return (Invoke-ClientCheck @('probe', '--app', [string]$Target.AppId, '--port', [string]$Target.Port, '--expect-sha', [string]$Manifest.source_sha, '--expect-fingerprint', [string]$Manifest.build_fingerprint))
}
function Get-ProbeFailCode([string]$Code) {
  if ($Code -eq 'TLS_PIN_MISMATCH') { return 'APP_TLS_MISMATCH' }
  if ($Code -eq 'PROBE_IDENTITY_MISMATCH') { return 'APP_IDENTITY_MISMATCH' }
  if ($Code -eq 'HEALTH_NOT_READY') { return 'BACKEND_NOT_READY' }
  if ($Code -eq 'HEALTH_FAILED') { return 'APP_HEALTH_FAILED' }
  if ($Code -eq 'ADMIN_AUTH_UNAVAILABLE') { return 'ADMIN_AUTH_UNAVAILABLE' }
  return 'APP_START_FAILED'
}
function Start-AppProcess($Target,[string]$Stdout,[string]$Stderr) {
  # The script is an ABSOLUTE path, so the command line of the running process names exactly which front it is.
  $child = Start-Process -FilePath 'node.exe' -ArgumentList @((ConvertTo-QuotedArgument $Target.Script)) -WorkingDirectory $script:Repo -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru -WindowStyle Hidden
  if ($child) { $null = $child.Handle }
  return $child
}
function Start-TargetChild($Target,[string]$Stdout,[string]$Stderr) {
  if ((Get-TargetText $Target 'Kind' 'backend') -eq 'app') { return (Start-AppProcess $Target $Stdout $Stderr) }
  return (Start-BackendProcess $Stdout $Stderr)
}
function Wait-TargetReady($Target,$Manifest,[int]$ExpectedProcessId,[string]$ExpectedStartUtc) {
  if ((Get-TargetText $Target 'Kind' 'backend') -eq 'app') { Wait-App $Target $Manifest $ExpectedProcessId $ExpectedStartUtc; return }
  Wait-Backend $Target $ExpectedProcessId $ExpectedStartUtc
}
# Ready means: the process we started is alive with the same start time, THE PORT BELONGS TO IT, and the probe (pinned
# certificate) finds the right app and build at /__11ship/runtime and the agreed health bodies through the front.
function Wait-App($Target,$Manifest,[int]$ExpectedProcessId,[string]$ExpectedStartUtc) {
  $until = [DateTime]::UtcNow.AddSeconds($script:AppReadySeconds)
  $problem = 'chưa phản hồi'
  $code = 'APP_START_FAILED'
  do {
    $details = $null
    try { $details = Get-ProcessDetails $ExpectedProcessId } catch { $details = $null }
    if (!$details -or !$details.Inspectable -or (ConvertTo-UtcText $details.StartUtc) -cne $ExpectedStartUtc) {
      $problem = "process $($Target.Label) PID $ExpectedProcessId đã thoát sớm (xem log trong $script:Logs; lỗi chứng chỉ hay cổng bận được ghi ở tệp .err.log)"
      $code = 'APP_START_FAILED'
      break
    }
    $port = Get-TargetPortState $Target $ExpectedProcessId
    if ($port.State -eq 'FOREIGN') { $problem = "cổng $($Target.Port) còn do process khác giữ nên không chứng minh được phản hồi là của $($Target.Label) này"; $code = 'PORT_IN_USE' }
    elseif ($port.State -eq 'UNREADABLE') { $problem = "không đọc được process đang giữ cổng $($Target.Port)"; $code = 'PORT_OWNER_UNREADABLE' }
    elseif ($port.State -eq 'FREE') { $problem = "process chưa lắng nghe cổng $($Target.Port)"; $code = 'APP_START_FAILED' }
    else {
      $probe = Test-AppRuntime $Target $Manifest
      if ($probe.Ok) { Write-Ok "$($Target.Label) sẵn sàng (đúng process PID $ExpectedProcessId giữ cổng, đúng ứng dụng và bản build, health của backend đi qua cổng HTTPS): https://localhost:$($Target.Port)"; return }
      $problem = "$($probe.Code): $($probe.Message)"
      $code = Get-ProbeFailCode $probe.Code
      # A different certificate or a different app on a port WE hold cannot heal by waiting.
      if ($probe.Code -in @('TLS_PIN_MISMATCH', 'PROBE_IDENTITY_MISMATCH')) { break }
      # The backend that is running was started without administration login (for example before .env had the Admin settings):
      # waiting does not change that. Only the Owner can restart it, through the launcher's own Stop.
      if ($probe.Code -eq 'ADMIN_AUTH_UNAVAILABLE') { $problem += '; backend đang chạy chưa bật đăng nhập Admin - hãy chạy 11Ship-Stop.cmd rồi 11Ship-Admin.cmd để backend đọc lại .env'; break }
    }
    Start-Sleep -Milliseconds $script:AppPollMilliseconds
  } while ([DateTime]::UtcNow -lt $until)
  Fail "$($Target.Label) chưa sẵn sàng ($problem); xem log trong $script:Logs." $code
}
# A manifest describes a FINISHED build, so it is removed before the build starts (same rule as the backend). The build itself
# (scripts/client-web-build.mjs) writes the manifest; the launcher then PROVES it: the folder must still match its fingerprint,
# and the commit in it must be the commit that is checked out.
function Build-AppArtifact($Target,[string]$Head) {
  Assert-LockHeld 'build ứng dụng'
  try { Remove-Item -LiteralPath $Target.ManifestFile -Force -ErrorAction Stop }
  catch {
    if (Test-Path -LiteralPath $Target.ManifestFile) { Fail "Không xóa được manifest cũ trước khi build: $($_.Exception.Message)" 'STATE_WRITE_FAILED' }
  }
  $script:BuildExitCode = 0
  Invoke-InRepo { & npm.cmd run $Target.BuildScript | Out-Host; $script:BuildExitCode = $LASTEXITCODE }
  if ($script:BuildExitCode -ne 0) {
    Fail "Build $($Target.Label) thất bại (npm.cmd exit $($script:BuildExitCode)). Launcher không dùng manifest cũ; $($Target.Label) đang chạy (nếu có) không bị đụng tới và vẫn là bản cũ." 'APP_BUILD_FAILED'
  }
  if (!(Test-Path -LiteralPath $Target.Script -PathType Leaf)) {
    Fail "Không có file chạy $($Target.Script); không thể khởi động $($Target.Label)." 'APP_BUILD_FAILED'
  }
  $state = $null
  try { $state = Get-ArtifactState $Target }
  catch { Fail "Không đọc được bản build $($Target.Label) để xác minh: $($_.Exception.Message)" 'ARTIFACT_UNREADABLE' }
  if ($state.State -ne 'OK') { Fail "Build $($Target.Label) không cho ra manifest dùng được: $($state.Text)." 'APP_BUILD_FAILED' }
  if ($state.Manifest.source_sha -cne $Head) { Fail "Manifest của build $($Target.Label) ghi commit $(Format-ShortSha $state.Manifest.source_sha) nhưng mã nguồn đang ở $(Format-ShortSha $Head); không chạy bản build không rõ nguồn." 'APP_BUILD_FAILED' }
  Write-Ok "Build $($Target.Label) xong: commit $(Format-ShortSha $Head), fingerprint $(Format-ShortFingerprint $state.Manifest.build_fingerprint)"
  return $state.Manifest
}
function Open-AppBrowser($Entry) {
  if ($env:SHIP11_NO_BROWSER -eq '1') { Write-Info "Không mở trình duyệt (SHIP11_NO_BROWSER=1). Địa chỉ: $($Entry.Url)"; return }
  try { Start-Process $Entry.Url }
  catch { Write-WarnLine "Không mở được trình duyệt tự động ($($_.Exception.Message)). Hãy mở $($Entry.Url) bằng tay." }
}
function Open-ClientApp([string]$AppId) {
  # Read-only pre-flight, BEFORE the lock and before anything is changed: tools, then the certificate.
  Assert-Tools
  Assert-AppCertificate
  if ($AppId -eq 'Admin') { Assert-AdminEnv }
  Use-LaunchLock 'app' { Open-ClientAppLocked $AppId }
}
function Open-ClientAppLocked([string]$AppId) {
  $entry = $script:AppCatalog[$AppId]
  $target = Get-AppTarget $AppId
  Ensure-Dirs
  # Identity first (M00.03): a foreign process on the port, or a record that cannot be proven, stops everything BEFORE the
  # database, the backend or a build is touched.
  $null = Get-TargetSituation $target $target.Action
  Write-Info "Mở $($entry.Name): bật database và backend, build rồi chạy máy chủ HTTPS $($entry.Url)."
  if ($AppId -eq 'Admin') { Start-LauncherLocked { Initialize-AdminAuth } } else { Start-LauncherLocked }
  $head = Get-HeadSha
  $manifest = Build-AppArtifact $target $head
  Start-OrReuseBackend $target $manifest $head
  Write-Ok "$($entry.Name) đã sẵn sàng tại $($entry.Url)."
  Open-AppBrowser $entry
}
# ---------------------------------------------------------------------------------------------
# Web Admin (M00.08): what the phone apps do not need - administration login settings, limiter configuration, SYSTEM account
# ---------------------------------------------------------------------------------------------
# The login, the Authenticator step, the sessions and the Origin/CSRF rules are the existing backend (admin-auth) and the existing
# front (scripts/admin-web-dev.mjs, which forwards ONLY /v1/admin-auth, /v1/admin and /v1/admin-activation and passes cookies,
# Origin and x-csrf-token through unchanged). The launcher adds nothing to them: it checks that .env is set for this origin,
# runs the two existing operator commands when they are needed, and proves the front and the login through the HTTPS port.
$script:AdminOrigin = 'https://localhost:8443'
# Read-only: lists the names of the .env settings that do not fit https://localhost:8443. Never returns a value.
function Get-AdminEnvProblems($EnvMap) {
  $problems = New-Object 'Collections.Generic.List[string]'
  if ("$($EnvMap['ADMIN_AUTH_ENABLED'])".Trim() -cne 'true') { $problems.Add('ADMIN_AUTH_ENABLED (phải là true)') }
  $origins = $null
  try { $origins = @("$($EnvMap['ADMIN_AUTH_ALLOWED_ORIGINS'])" | ConvertFrom-Json) } catch { $origins = $null }
  if ($null -eq $origins -or $origins.Count -ne 1 -or "$($origins[0])" -cne $script:AdminOrigin) { $problems.Add("ADMIN_AUTH_ALLOWED_ORIGINS (phải đúng một origin: [`"$script:AdminOrigin`"])") }
  if ($EnvMap.ContainsKey('ADMIN_AUTH_TRUSTED_PROXY_IPS') -and "$($EnvMap['ADMIN_AUTH_TRUSTED_PROXY_IPS'])".Trim() -cne '[]') { $problems.Add('ADMIN_AUTH_TRUSTED_PROXY_IPS (phải là [] - front local không dùng proxy tin cậy)') }
  $key = $null
  try { $key = [Convert]::FromBase64String("$($EnvMap['ADMIN_RATE_LIMIT_HMAC_KEY'])".Trim()) } catch { $key = $null }
  if ($null -eq $key -or $key.Length -ne 32) { $problems.Add('ADMIN_RATE_LIMIT_HMAC_KEY (base64 của đúng 32 byte ngẫu nhiên)') }
  if ([string]::IsNullOrWhiteSpace("$($EnvMap['ADMIN_RATE_LIMIT_KEY_ID'])")) { $problems.Add('ADMIN_RATE_LIMIT_KEY_ID (ví dụ local-limiter-1)') }
  return @($problems.ToArray())
}
# Before anything is changed. The launcher never writes .env (it holds the Owner's secrets) and never invents the limiter key.
function Assert-AdminEnv {
  $problems = @(Get-AdminEnvProblems (Read-DotEnvNames))
  if (!$problems.Count) { return }
  $nl = [Environment]::NewLine
  $lines = @($problems | ForEach-Object { "  - $_" }) -join $nl
  Fail ("Web Admin: .env chưa có cấu hình đăng nhập Admin cho $script:AdminOrigin. Cần sửa:$nl$lines${nl}Thêm vào .env (launcher không tự ghi .env; không commit file này):$nl  ADMIN_AUTH_ENABLED=true$nl  ADMIN_AUTH_ALLOWED_ORIGINS=[`"$script:AdminOrigin`"]$nl  ADMIN_AUTH_TRUSTED_PROXY_IPS=[]$nl  ADMIN_RATE_LIMIT_HMAC_KEY=<base64 của 32 byte ngẫu nhiên>$nl  ADMIN_RATE_LIMIT_KEY_ID=local-limiter-1${nl}Sinh khóa: node -e `"console.log(require('crypto').randomBytes(32).toString('base64'))`"${nl}Chưa làm gì: không cập nhật mã, không bật database hoặc backend, không mở trình duyệt.") 'ADMIN_ENV_INVALID'
}
# Runs one of the existing operator commands (scripts/admin-auth-*.js) with .env loaded by node itself. Credentials, if any, go
# through STANDARD INPUT only - never an argument, an environment variable, a file or a log. The commands print one fixed word
# or one fixed refusal code, and that text is redacted again here before it is shown.
function Invoke-AdminCli([string]$ScriptName,[string]$StdinText='') {
  $scriptPath = Join-Path (Join-Path $script:Repo 'scripts') $ScriptName
  if (!(Test-Path -LiteralPath $scriptPath -PathType Leaf)) { Fail "Thiếu $scriptPath." 'APP_RUNTIME_MISSING' }
  $previous = $ErrorActionPreference
  $previousEncoding = $OutputEncoding
  $ErrorActionPreference = 'Continue'
  $lines = @()
  $code = 1
  try {
    $OutputEncoding = New-Object Text.UTF8Encoding($false)
    Push-Location -LiteralPath $script:Repo
    try {
      if ($StdinText) { $lines = @($StdinText | & node.exe '--env-file=.env' $scriptPath 2>&1) }
      else { $lines = @(& node.exe '--env-file=.env' $scriptPath 2>&1) }
      $code = $LASTEXITCODE
    } finally { Pop-Location }
  } catch { $lines = @(); $code = 1 }
  finally { $OutputEncoding = $previousEncoding; $ErrorActionPreference = $previous }
  $text = Protect-Text ((@($lines | ForEach-Object { "$_" }) -join ' ').Trim()) (Get-KnownSecrets)
  return [pscustomobject]@{ ExitCode = $code; Text = $text }
}
function Get-AdminCliOutcome([string]$Text,[string]$Program) {
  $m = [regex]::Match("$Text", '(^|\s)' + [regex]::Escape($Program) + ':\s*(created|unchanged)(\s|$)')
  if ($m.Success) { return $m.Groups[2].Value }
  return $null
}
function ConvertFrom-SecureStringPlain([Security.SecureString]$Secure) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Read-SystemPhone { return "$(Read-Host 'Số điện thoại tài khoản SYSTEM')".Trim() }
function Read-SystemPassword([string]$Prompt) { return (Read-Host $Prompt -AsSecureString) }
# Creates the SYSTEM account only when the DEV database has none. Interactive on purpose: the phone and the password are typed
# by the Owner, held in memory, sent to the existing command on standard input and dropped. An account that exists is never
# touched, so there is nothing to overwrite.
function New-SystemAccount {
  $nl = [Environment]::NewLine
  if (Test-InputRedirected) {
    Fail "DB DEV chưa có tài khoản SYSTEM và launcher không thể hỏi số điện thoại/mật khẩu khi đầu vào bị chuyển hướng.${nl}Hãy chạy lại 11Ship-Admin.cmd bằng cách bấm đúp (cửa sổ thường) để nhập; hoặc chạy thủ công theo ops\runbooks\local-https-runtime.md." 'ADMIN_SYSTEM_MISSING'
  }
  if (!(Confirm-Step 'DB DEV chưa có tài khoản SYSTEM (quản trị cao nhất). Tạo bây giờ?')) {
    Fail 'Không có tài khoản SYSTEM thì không đăng nhập Web Admin được. Chưa tạo gì; chạy lại 11Ship-Admin.cmd khi sẵn sàng.' 'ADMIN_SYSTEM_MISSING'
  }
  $phone = Read-SystemPhone
  $first = Read-SystemPassword 'Mật khẩu (không hiện khi gõ)'
  $second = Read-SystemPassword 'Nhập lại mật khẩu'
  $password = ConvertFrom-SecureStringPlain $first
  $again = ConvertFrom-SecureStringPlain $second
  if ([string]::IsNullOrEmpty($phone) -or [string]::IsNullOrEmpty($password)) { Fail 'Cần nhập cả số điện thoại và mật khẩu.' 'ADMIN_SYSTEM_INPUT_INVALID' }
  if ($password -cne $again) { Fail 'Hai lần nhập mật khẩu không giống nhau. Chưa tạo gì.' 'ADMIN_SYSTEM_INPUT_INVALID' }
  # Known to the redaction from now on, so no message of this run can ever echo it.
  $script:ExtraSecrets = @($script:ExtraSecrets + @($password))
  $json = ([ordered]@{ phone = $phone; password = $password } | ConvertTo-Json -Compress)
  $result = $null
  try { $result = Invoke-AdminCli 'admin-auth-bootstrap-system.js' $json }
  finally { $json = $null; $password = $null; $again = $null; $first = $null; $second = $null }
  $outcome = Get-AdminCliOutcome $result.Text 'admin-auth:bootstrap-system'
  if ($result.ExitCode -ne 0 -or !$outcome) {
    Fail "Không tạo được tài khoản SYSTEM ($($result.Text)). Chạy lại 11Ship-Admin.cmd để nhập lại; số điện thoại và mật khẩu không được lưu ở đâu cả." 'ADMIN_SYSTEM_BOOTSTRAP_FAILED'
  }
  Write-Ok "Tài khoản SYSTEM: $outcome (mật khẩu không được ghi vào log hay tệp nào)"
}
# Runs under the launch lock, after the migrations and before the backend starts.
function Initialize-AdminAuth {
  $limit = Invoke-AdminCli 'admin-auth-init-limit-config.js'
  $outcome = Get-AdminCliOutcome $limit.Text 'admin-auth:init-limit-config'
  if ($limit.ExitCode -ne 0 -or !$outcome) {
    Fail "Không khởi tạo được cấu hình giới hạn đăng nhập Admin ($($limit.Text)). Kiểm tra ADMIN_RATE_LIMIT_HMAC_KEY/ADMIN_RATE_LIMIT_KEY_ID trong .env: nếu đã đổi khóa sau lần khởi tạo đầu thì DB DEV đang giữ khóa cũ." 'ADMIN_LIMIT_CONFIG_FAILED'
  }
  Write-Ok "Cấu hình giới hạn đăng nhập Admin: $outcome"
  $count = Invoke-DevSql "SELECT count(*) FROM app.admin_memberships WHERE admin_role = 'SYSTEM'"
  if ($null -eq $count) { Fail 'Không đọc được bảng quản trị của DB DEV (app.admin_memberships); migration đã áp dụng chưa?' 'ADMIN_STATE_UNAVAILABLE' }
  if ("$count".Trim() -cne '0') { Write-Ok 'Tài khoản SYSTEM đã có trong DB DEV: giữ nguyên, không tạo lại và không đổi mật khẩu.'; return }
  New-SystemAccount
}
function Get-AppStatusLines([string]$Head) {
  $lines = New-Object 'Collections.Generic.List[string]'
  foreach ($appId in @('Admin', 'Food', 'Ship')) {
    $entry = $script:AppCatalog[$appId]
    $text = ''
    try {
      $target = Get-AppTarget $appId
      $ownership = Get-TargetOwnership $target
      if ($ownership.Status -eq 'OWNED') {
        $record = $ownership.Registry
        $port = Get-TargetPortState $target ([int]$record.pid)
        $portText = if ($port.State -eq 'OURS') { 'đúng process của launcher' } else { "cổng ở trạng thái $($port.State)" }
        $text = "đang chạy, PID $($record.pid), commit $(Format-ShortSha $record.source_sha), fingerprint $(Format-ShortFingerprint $record.build_fingerprint); cổng $($target.Port): $portText"
        if ($record.source_sha -cne $Head) { $text += " - KHÁC HEAD ($(Format-ShortSha $Head)): mở lại ứng dụng để build và khởi động lại" }
      }
      elseif ($ownership.Status -eq 'UNVERIFIED') { $text = "KHÔNG XÁC MINH ĐƯỢC (mã PROCESS_IDENTITY_UNVERIFIED) - $($ownership.Text)" }
      elseif ($ownership.Status -eq 'STALE') { $text = "bản ghi cũ - $($ownership.Text)" }
      else { $text = 'chưa chạy bằng launcher' }
    } catch { $text = "không kiểm tra được ($($_.Exception.Message))" }
    $lines.Add("$($entry.Short) - $($entry.Url): $text")
  }
  return @($lines.ToArray())
}
function Stop-AppTarget([string]$AppId) {
  $target = Get-AppTarget $AppId
  $ownership = Get-TargetOwnership $target
  if ($ownership.Status -eq 'UNVERIFIED') { Fail (Get-UnverifiedText $target $ownership "dừng $($target.Label)") 'PROCESS_IDENTITY_UNVERIFIED' }
  if ($ownership.Status -eq 'OWNED') { Stop-TargetProcess $target $ownership; Write-Ok "Đã dừng đúng $($target.Label) do launcher quản lý (đã xác minh PID, giờ khởi động, node và script)" }
  elseif ($ownership.Status -eq 'STALE') { Write-WarnLine "Bản ghi $($target.Label) cũ ($($ownership.Text)); không dừng process nào, chỉ dọn bản ghi."; Remove-TargetRegistry $target }
}
# Update only moves the SOURCE. It never builds or restarts, so it must say plainly when a launcher-owned backend still
# runs an older build. Returns $true in that case. Changes nothing.
function Write-BackendUpdateNotice([string]$Head) {
  $target = Get-BackendTarget
  $ownership = Get-TargetOwnership $target
  if ($ownership.Status -eq 'UNVERIFIED') {
    Write-WarnLine "PROCESS_IDENTITY_UNVERIFIED: không xác minh được backend đang chạy ($($ownership.Text)). Update không đụng tới process nào; xem runbook trước khi chạy Start."
    return $false
  }
  if ($ownership.Status -ne 'OWNED') { return $false }
  $record = $ownership.Registry
  if ($record.source_sha -ceq $Head) {
    Write-Info "Backend do launcher quản lý (PID $($record.pid)) chạy artifact build từ đúng commit $(Format-ShortSha $Head). Update không build lại hay khởi động lại; Start sẽ xác minh lại artifact và process."
    return $false
  }
  Write-WarnLine "BACKEND_RUNNING_OLD_VERSION: mã nguồn đã ở commit $(Format-ShortSha $Head) nhưng backend do launcher quản lý (PID $($record.pid)) vẫn chạy artifact build từ commit $(Format-ShortSha $record.source_sha) (fingerprint $(Format-ShortFingerprint $record.build_fingerprint)). Update chỉ cập nhật mã nguồn và dependency, không build lại hay khởi động lại process. Hãy chạy Start: launcher sẽ build, xác minh rồi chỉ khởi động lại đúng process này."
  return $true
}
# Three layers for Status (read-only: it writes, removes and stops nothing, and never takes the lock).
function Get-BackendIdentityLines([string]$Head) {
  $lines = New-Object 'Collections.Generic.List[string]'
  $target = Get-BackendTarget
  $lines.Add("Backend - nguồn (HEAD): $Head")
  $artifact = $null
  try { $artifact = Get-ArtifactState $target }
  catch { $artifact = [pscustomobject]@{ State = 'UNREADABLE'; Manifest = $null; Text = "không đọc được ($($_.Exception.Message))" } }
  if ($artifact.State -eq 'OK') {
    $text = "OK - build từ commit $(Format-ShortSha $artifact.Manifest.source_sha), fingerprint $(Format-ShortFingerprint $artifact.Manifest.build_fingerprint)"
    if ($artifact.Manifest.source_sha -cne $Head) { $text += " - KHÁC HEAD ($(Format-ShortSha $Head)): artifact cũ so với mã nguồn, Start sẽ build lại" }
  } else { $text = "$($artifact.State) - $($artifact.Text)" }
  $lines.Add("Backend - artifact: $text")
  $ownership = $null
  try { $ownership = Get-TargetOwnership $target }
  catch { $ownership = New-Ownership 'UNVERIFIED' "không kiểm tra được ($($_.Exception.Message))" $null $null }
  $ownerProcessId = 0
  if ($ownership.Status -eq 'OWNED') {
    $ownerProcessId = [int]$ownership.Registry.pid
    $record = $ownership.Registry
    $text = "do launcher quản lý, PID $($record.pid), commit $(Format-ShortSha $record.source_sha), fingerprint $(Format-ShortFingerprint $record.build_fingerprint)"
    if ($artifact.State -eq 'OK' -and $record.source_sha -ceq $artifact.Manifest.source_sha -and $record.build_fingerprint -ceq $artifact.Manifest.build_fingerprint -and $record.source_sha -ceq $Head) { $text += ' - KHỚP artifact và mã nguồn hiện tại' }
    else { $text += ' - KHÁC artifact hoặc mã nguồn hiện tại: Start sẽ build, xác minh rồi restart đúng process này' }
  }
  elseif ($ownership.Status -eq 'UNVERIFIED') { $text = "KHÔNG XÁC MINH ĐƯỢC (mã PROCESS_IDENTITY_UNVERIFIED) - $($ownership.Text); launcher sẽ không dừng, thay hay chạy gì" }
  elseif ($ownership.Status -eq 'STALE') { $text = "bản ghi cũ - $($ownership.Text); Start sẽ thay" }
  else { $text = 'không có process do launcher quản lý' }
  $lines.Add("Backend - process: $text")
  $port = Get-TargetPortState $target $ownerProcessId
  if ($port.State -eq 'FREE') { $text = 'trống' }
  elseif ($port.State -eq 'OURS') { $text = "đúng process của launcher (PID $ownerProcessId)" }
  elseif ($port.State -eq 'FOREIGN') { $text = "đang do process KHÔNG thuộc launcher chiếm (PID $($port.Foreign -join ', ')); launcher sẽ từ chối với PORT_IN_USE, kể cả khi nó trả HTTP 200" }
  else { $text = 'không đọc được process đang giữ cổng (PORT_OWNER_UNREADABLE)' }
  $lines.Add("Backend - cổng $($target.Port): $text")
  return @($lines.ToArray())
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
function Ensure-Dependencies { Use-LaunchLock 'dependencies' { Ensure-DependenciesLocked } }
function Ensure-DependenciesLocked {
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
function Confirm-DevMigrations([scriptblock]$BeforeApply) { Use-LaunchLock 'migration' { Confirm-DevMigrationsLocked $BeforeApply } }
# $BeforeApply (M00.03) runs only after Owner confirmed and before the first migration statement: Start uses it to stop the
# old backend so it never serves a database schema it was not built for.
function Confirm-DevMigrationsLocked([scriptblock]$BeforeApply) {
  $plan = Get-MigrationPlan
  if ($plan.Unknown.Count) { Write-WarnLine "DB DEV có $($plan.Unknown.Count) migration không có trong mã nguồn hiện tại. Launcher không sửa hoặc xóa dữ liệu." }
  if (!$plan.Pending.Count) { Write-Ok "DB DEV đã áp dụng đủ $($plan.Files.Count) migration (kiểm tra trực tiếp trong PostgreSQL)"; return }
  Write-WarnLine "DB DEV còn $($plan.Pending.Count)/$($plan.Files.Count) migration chưa áp dụng:"
  foreach ($name in $plan.Pending) { Write-Host "    - $name" }
  $sha = Capture 'git.exe' @('-C',$script:Repo,'rev-parse','--short','HEAD')
  Write-Info "Đích: DEV local — database=ship11_dev user=ship11_dev host=127.0.0.1:5432 (mật khẩu được ẩn); commit=$sha"
  if (!(Confirm-Step 'Áp dụng các migration trên vào ship11_dev local?')) { Fail 'Đã hủy trước khi chạy backend vì migration DEV chưa được xác nhận.' 'MIGRATION_DECLINED' }
  if ($BeforeApply) { & $BeforeApply }
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
function Start-Launcher { Use-LaunchLock 'start' { Start-LauncherLocked } }
function Start-LauncherLocked([scriptblock]$BeforeBackend=$null) {
  Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
  Compose @('up','-d','db-dev','db-test')
  Wait-ContainerHealthy 'ship11-db-dev'; Wait-ContainerHealthy 'ship11-db-test'
  if ((Get-DependencyState) -ne 'ok') { Fail 'Dependency thiếu hoặc chưa khớp lockfile đã ghi nhận. Hãy chạy 11Ship-Update trước.' 'DEPENDENCIES_NOT_READY' }
  $target = Get-BackendTarget
  $head = Get-HeadSha
  # M00.03: identity first. A process or a port that cannot be proven ours stops everything BEFORE a build or a migration
  # touches anything (PROCESS_IDENTITY_UNVERIFIED / PORT_IN_USE / PORT_OWNER_UNREADABLE).
  $null = Get-TargetSituation $target 'khởi động backend'
  $manifest = Build-BackendArtifact $target $head
  # A pending migration is applied only after Owner confirmed; the launcher-owned old backend is stopped first.
  Confirm-DevMigrations { $null = Stop-TargetIfOwned $target 'trước khi áp dụng migration DEV' }
  # M00.08: Web Admin needs the limiter configuration (and a SYSTEM account) BEFORE the backend starts with administration login on:
  # it refuses to listen without the configuration row. Needs the migrated schema and the backend build, so it runs exactly here.
  if ($BeforeBackend) { & $BeforeBackend }
  Start-OrReuseBackend $target $manifest $head
}
# ---------------------------------------------------------------------------------------------
# Git update (M00.02)
# ---------------------------------------------------------------------------------------------
# Two modes, chosen by the checkout itself:
#  - main (default): only branch main that tracks origin/main, fast-forward only. Never switches branch, never
#    discards or hides local changes, never deletes or overwrites an untracked or ignored file.
#  - UAT: a separate checkout whose .11ship-local\uat-pin.json holds ONE full commit SHA. Update only verifies that HEAD
#    is that commit; it does not fetch, pull or check out. A pin file that is unreadable is an error, never "main".
function Get-UatPin {
  if (!(Test-Path -LiteralPath $script:UatPinFile)) { return $null }
  $sha = ''
  try { $pin = Get-Content -Raw -LiteralPath $script:UatPinFile | ConvertFrom-Json; $sha = "$($pin.sha)".Trim() } catch { }
  if ($sha -notmatch '^[0-9a-fA-F]{40}$') { Fail 'Tệp pin UAT (.11ship-local\uat-pin.json) hỏng hoặc không chứa SHA đầy đủ 40 ký tự. Launcher không tự quay về chế độ main.' 'UAT_PIN_INVALID' }
  return $sha.ToLowerInvariant()
}
function Get-UpdateModeText([string]$Head) {
  try { $pin = Get-UatPin } catch { return 'UAT — tệp pin không hợp lệ (UAT_PIN_INVALID); Update sẽ từ chối' }
  if (!$pin) { return 'main — chỉ fast-forward nhánh main từ origin/main' }
  $short = 'không xác định'
  if ("$Head".Length -ge 7) { $short = "$Head".Substring(0, 7) }
  if ($pin -eq $Head) { return "UAT — pin $($pin.Substring(0, 7)), HEAD khớp; không tự pull" }
  return "UAT — pin $($pin.Substring(0, 7)) nhưng HEAD là $short; Update sẽ từ chối"
}
# Runs inside the repository. Changes nothing. Returns the current HEAD.
function Assert-GitSafeState([string]$Pin) {
  $gitDir = Capture 'git.exe' @('rev-parse','--git-dir')
  if ($gitDir -eq $null) { Fail 'Không phải Git repo.' 'NOT_A_GIT_REPO' }
  foreach ($marker in @('MERGE_HEAD','rebase-merge','rebase-apply','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','sequencer')) {
    if (Test-Path -LiteralPath (Join-Path $gitDir $marker)) { Fail "Git operation đang dở: $marker" 'GIT_OPERATION_IN_PROGRESS' }
  }
  if (!$Pin) {
    $branch = Capture 'git.exe' @('symbolic-ref','--short','HEAD')
    if ($branch -eq $null) { Fail 'Đang detached HEAD; hãy chuyển về nhánh main (launcher không tự chuyển nhánh).' 'DETACHED_HEAD' }
    $upstreamName = Capture 'git.exe' @('rev-parse','--abbrev-ref','--symbolic-full-name','@{u}')
    if ($upstreamName -eq $null) { Fail 'Branch chưa có upstream.' 'NO_UPSTREAM' }
    if ($branch -cne 'main') { Fail "Chế độ main chỉ cập nhật nhánh main; đang ở nhánh '$branch'. Launcher không tự chuyển nhánh." 'NOT_MAIN_BRANCH' }
    if ($upstreamName -cne 'origin/main') { Fail "Nhánh main phải theo dõi origin/main; hiện theo dõi '$upstreamName'." 'UPSTREAM_MISMATCH' }
  }
  # A failed read is not an empty answer: Capture returns $null for exit != 0 and '' for a clean tree.
  $status = Capture 'git.exe' @('status','--porcelain','--untracked-files=no')
  if ($null -eq $status) { Fail 'Không đọc được trạng thái Git (git status lỗi); dừng an toàn, chưa cập nhật gì.' 'GIT_STATE_UNREADABLE' }
  if ($status) { Fail 'Có thay đổi tracked chưa commit; launcher không tự stash.' 'DIRTY_TRACKED' }
  $head = Capture 'git.exe' @('rev-parse','HEAD')
  if ("$head" -notmatch '^[0-9a-f]{40}$') { Fail 'Không đọc được commit hiện tại.' 'GIT_STATE_UNREADABLE' }
  return $head
}
# Returns the number of new migrations, or $null when Git could not be read (never 0 for "unknown").
function Get-AddedMigrationCount([string]$FromSha,[string]$ToSha) {
  $names = Capture 'git.exe' @('-c','core.quotepath=false','diff','--no-renames','--name-only','--diff-filter=A',$FromSha,$ToSha,'--','database/migrations')
  if ($null -eq $names) { return $null }
  return @("$names" -split "`r?`n" | Where-Object { $_ -match '\.sql$' }).Count
}
# Runs inside the repository with the caller's Git location variables removed. Result goes to $script:UpdateResult.
function Invoke-GitSourceUpdate {
  $pin = Get-UatPin
  $head = Assert-GitSafeState $pin
  if ($pin) {
    if ($head -ne $pin) { Fail "Chế độ UAT: HEAD $($head.Substring(0, 7)) khác SHA đã pin $($pin.Substring(0, 7)). Launcher không tự pull và không tự checkout; hãy dùng đúng checkout UAT đã pin." 'UAT_SHA_MISMATCH' }
    $script:UpdateResult = [pscustomobject]@{ Mode = 'UAT'; Moved = $false; OldHead = $head; NewHead = $head; OldLauncherHash = '' }
    Write-Ok "Chế độ UAT: HEAD khớp SHA đã pin ($($pin.Substring(0, 7))); không fetch, không cập nhật mã"
    return
  }
  $oldLauncher = File-HashOrEmpty $script:LauncherPath
  & git.exe fetch --prune origin
  if ($LASTEXITCODE -ne 0) { Fail 'git fetch thất bại; không cập nhật và không báo thành công. Kiểm tra mạng rồi chạy lại.' 'GIT_FETCH_FAILED' }
  $upstream = Capture 'git.exe' @('rev-parse','@{u}')
  if ("$upstream" -notmatch '^[0-9a-f]{40}$') { Fail 'Không đọc được commit của origin/main sau khi fetch.' 'GIT_FETCH_FAILED' }
  if ($upstream -eq $head) {
    $script:UpdateResult = [pscustomobject]@{ Mode = 'main'; Moved = $false; OldHead = $head; NewHead = $head; OldLauncherHash = $oldLauncher }
    return
  }
  & git.exe merge-base --is-ancestor $head $upstream
  # exit 1 = HEAD is not an ancestor (history diverged); any other failure means Git could not tell.
  if ($LASTEXITCODE -eq 1) { Fail 'Không thể fast-forward tới upstream (lịch sử local đã rẽ nhánh hoặc đi trước).' 'NON_FAST_FORWARD' }
  if ($LASTEXITCODE -ne 0) { Fail 'Không kiểm tra được quan hệ lịch sử với upstream (git merge-base lỗi); dừng an toàn, chưa cập nhật gì.' 'GIT_STATE_UNREADABLE' }
  # A file the update would ADD must not already exist on disk, tracked or not: an untracked file, or an ignored one such
  # as .env, is never overwritten.
  $addedText = Capture 'git.exe' @('-c','core.quotepath=false','diff','--no-renames','--name-only','--diff-filter=A',$head,$upstream)
  if ($null -eq $addedText) { Fail 'Không đọc được danh sách file mà bản cập nhật sẽ thêm (git diff lỗi); dừng trước khi merge để không ghi đè file local (kể cả .env).' 'GIT_DIFF_UNREADABLE' }
  $added = @("$addedText" -split "`r?`n" | Where-Object { $_ })
  foreach ($path in $added) {
    if (Test-Path -LiteralPath (Join-Path $script:Repo $path)) { Fail 'File untracked sẽ bị upstream ghi đè; dừng an toàn, không xóa hay di chuyển file.' 'UNTRACKED_COLLISION' }
  }
  $mergeArguments = @('merge','--ff-only',$upstream)
  & git.exe @mergeArguments
  if ($LASTEXITCODE -ne 0) { Fail 'git merge --ff-only thất bại; mã nguồn giữ nguyên trạng thái trước đó.' 'GIT_UPDATE_FAILED' }
  $newHead = Capture 'git.exe' @('rev-parse','HEAD')
  if ($newHead -ne $upstream) { Fail 'Sau cập nhật HEAD không khớp origin/main.' 'GIT_UPDATE_FAILED' }
  $script:UpdateResult = [pscustomobject]@{ Mode = 'main'; Moved = $true; OldHead = $head; NewHead = $newHead; OldLauncherHash = $oldLauncher }
}
# The re-run launcher does not update again. Under the lock it only re-checks that the checkout is exactly what the
# first launcher produced, and stops on any difference.
function Confirm-RelaunchedCheckout {
  $pin = Get-UatPin
  $head = Assert-GitSafeState $pin
  if ($head -ne $RelaunchToSha) { Fail "Bản launcher mới thấy HEAD $($head.Substring(0, 7)) khác commit đã cập nhật $($RelaunchToSha.Substring(0, 7)); dừng, không chạy tiếp." 'RELAUNCH_SHA_MISMATCH' }
  if ((File-HashOrEmpty $script:LauncherPath) -ne $RelaunchLauncherHash) { Fail 'Mã launcher trên đĩa khác bản đã cập nhật; dừng, không chạy tiếp.' 'RELAUNCH_LAUNCHER_MISMATCH' }
  $script:UpdateResult = [pscustomobject]@{ Mode = 'relaunch'; Moved = $false; OldHead = $RelaunchFromSha; NewHead = $head; OldLauncherHash = '' }
  Write-Ok "Bản launcher mới đã nhận khóa và xác minh checkout $($head.Substring(0, 7)); tiếp tục các bước còn lại"
}
function Update-Launcher {
  Use-LaunchLock 'update' {
    Ensure-Dirs; Assert-Tools; $null = Assert-LocalEnv
    $script:UpdateResult = $null
    $gitEnvironment = @{ GIT_DIR = $null; GIT_WORK_TREE = $null; GIT_INDEX_FILE = $null }
    Invoke-InRepo {
      Invoke-WithEnv $gitEnvironment {
        if ($script:IsRelaunched) { Confirm-RelaunchedCheckout } else { Invoke-GitSourceUpdate }
      }
    }
    $result = $script:UpdateResult
    if (!$result) { Fail 'Cập nhật không trả kết quả; dừng an toàn.' 'GIT_UPDATE_FAILED' }
    if ($result.Moved) {
      $newLauncher = File-HashOrEmpty $script:LauncherPath
      if ($newLauncher -ne $result.OldLauncherHash) {
        Write-Info 'Bản cập nhật thay đổi chính launcher; chạy lại bước này bằng bản mới (đúng một lần).'
        $code = Invoke-LauncherRelaunch 'Update' $result.OldHead $result.NewHead $newLauncher
        if ($code -ne 0) { Fail "Bản launcher mới kết thúc với lỗi (exit $code); xem thông báo ngay phía trên." 'RELAUNCH_CHILD_FAILED' }
        Write-WarnLine 'Launcher đã được cập nhật và bản mới đã chạy lại bước Update. Tiến trình này dùng mã cũ nên sẽ không chạy thêm lệnh nào; nếu đang ở menu, chọn 0 rồi mở lại launcher.'
        return
      }
    }
    # F01: always let Ensure-Dependencies decide from the recorded lock hash. A machine that already has
    # node_modules but no recorded state (first run) must not report success without recording one.
    Ensure-Dependencies
    $script:AddedMigrations = 0
    if ($result.OldHead -ne $result.NewHead) { Invoke-InRepo { $script:AddedMigrations = Get-AddedMigrationCount $result.OldHead $result.NewHead } }
    if ($null -eq $script:AddedMigrations) { Write-WarnLine 'MIGRATION_COUNT_UNREADABLE: không đọc được số migration mới của bản cập nhật (git diff lỗi). Không có nghĩa là 0; Start vẫn kiểm tra DB DEV và hỏi trước khi áp dụng.' }
    elseif ($script:AddedMigrations -gt 0) { Write-WarnLine "Bản cập nhật có $($script:AddedMigrations) migration mới. Start sẽ kiểm tra DB DEV và hỏi trước khi áp dụng." }
    # M00.03: the source moved, the running backend did not. Say so instead of leaving a "success" that hides an old version.
    # The HEAD Update itself verified (no second Git read, so a Git hiccup after a good update cannot turn it into a failure).
    $noticeHead = "$($result.NewHead)"
    if ($noticeHead -cmatch '^[0-9a-f]{40}$') { $null = Write-BackendUpdateNotice $noticeHead }
    if ($result.Mode -eq 'UAT') { Write-Ok 'Kiểm tra checkout UAT hoàn tất (chỉ mã nguồn; chưa build hay chạy lại backend)' }
    elseif ($result.Moved -or $result.Mode -eq 'relaunch') { Write-Ok 'Cập nhật MÃ NGUỒN và dependency hoàn tất (fast-forward). Update không build lại hay chạy lại backend: dùng Start để có artifact và process mới.' }
    else { Write-Ok 'Cập nhật mã nguồn hoàn tất: đã ở commit mới nhất của origin/main (chưa build hay chạy lại backend)' }
  }
}
function Test-Launcher { Use-LaunchLock 'test' { Test-LauncherLocked } }
function Test-LauncherLocked {
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
function Stop-Launcher { Use-LaunchLock 'stop' { Stop-LauncherLocked } }
function Stop-LauncherLocked {
  Ensure-Dirs
  # M00.05: the HTTPS fronts of the apps first (they only forward to the backend), each only if proven the launcher's own.
  foreach ($appId in @('Admin', 'Food', 'Ship')) { Stop-AppTarget $appId }
  $target = Get-BackendTarget
  $ownership = Get-TargetOwnership $target
  if ($ownership.Status -eq 'UNVERIFIED') { Fail (Get-UnverifiedText $target $ownership 'dừng backend') 'PROCESS_IDENTITY_UNVERIFIED' }
  if ($ownership.Status -eq 'OWNED') { Stop-TargetProcess $target $ownership; Write-Ok 'Đã dừng đúng backend do launcher quản lý (đã xác minh PID, giờ khởi động, node và script build)' }
  elseif ($ownership.Status -eq 'STALE') { Write-WarnLine "Bản ghi backend cũ ($($ownership.Text)); không dừng process nào, chỉ dọn bản ghi."; Remove-TargetRegistry $target }
  else { Write-Info 'Không có backend nào do launcher quản lý đang chạy.' }
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
  Write-Host "Chế độ cập nhật: $(Get-UpdateModeText $head)"
  foreach ($pair in @(@('Node','node.exe','--version'),@('npm','npm.cmd','--version'),@('Docker','docker.exe','--version'))) { if (Command-Exists $pair[1]) { Write-Host "$($pair[0]): $(Capture $pair[1] @($pair[2]))" } else { Write-Host "$($pair[0]): không có" } }
  $ps = if (Command-Exists 'docker.exe') { Capture 'docker.exe' @('compose','--env-file',$script:EnvFile,'-f',$script:Compose,'ps') } else { $null }
  if ($ps -eq $null) { Write-Host 'Database: không đọc được — Docker chưa chạy hoặc thiếu .env' } else { Write-Host $ps }
  # M00.03: source, artifact, process and port are reported separately; Status is read-only (no lock, no write, no stop).
  foreach ($line in @(Get-BackendIdentityLines $head)) { Write-Host $line }
  Write-Host "Health (chỉ để tham khảo, không chứng minh quyền sở hữu) live=$(Http-Status (Get-BackendUrl 'live')) ready=$(Http-Status (Get-BackendUrl 'ready'))"
  # M00.05/M00.08: the HTTPS fronts of Web Admin, 11Food and 11Ship, each with its commit and fingerprint (read-only, like the backend lines above).
  foreach ($line in @(Get-AppStatusLines $head)) { Write-Host $line }
  Write-Host "Test gần nhất: $((Get-LastTestStatus $script:LastTest $head).Text)"
}
# M00.09: Desktop shortcuts. One for the test menu (as before) and one per app, each pointing at the wrapper of THIS checkout
# (absolute path of the repo it was installed from; nothing machine-specific is committed). Re-running overwrites only these
# four .lnk files, so it is idempotent. Seams: the Desktop folder and the .lnk writer, so tests never touch a real Desktop.
function Get-DesktopFolder { return [Environment]::GetFolderPath('Desktop') }
function Save-DesktopShortcut([string]$Link,[string]$Target,[string]$WorkingDirectory) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Link); $shortcut.TargetPath = $Target; $shortcut.WorkingDirectory = $WorkingDirectory; $shortcut.Save()
}
function Get-ShortcutPlan {
  $local = Join-Path (Join-Path $script:Repo 'tools') 'local'
  return @(
    [pscustomobject]@{ Name = '11Ship Test.lnk';  Target = (Join-Path $local '11Ship.cmd') },
    [pscustomobject]@{ Name = '11Ship Admin.lnk'; Target = (Join-Path $local '11Ship-Admin.cmd') },
    [pscustomobject]@{ Name = '11Ship Food.lnk';  Target = (Join-Path $local '11Ship-Food.cmd') },
    [pscustomobject]@{ Name = '11Ship Ship.lnk';  Target = (Join-Path $local '11Ship-Ship.cmd') }
  )
}
function Install-Shortcut {
  $plan = @(Get-ShortcutPlan)
  # Check everything first: no half-made set of shortcuts that point at a missing file.
  foreach ($item in $plan) { if (!(Test-Path -LiteralPath $item.Target -PathType Leaf)) { Fail "Thiếu $($item.Target); không tạo shortcut." 'SHORTCUT_TARGET_MISSING' } }
  $desktop = Get-DesktopFolder
  if (!$desktop -or !(Test-Path -LiteralPath $desktop -PathType Container)) { Fail 'Không tìm thấy thư mục Desktop; không tạo shortcut.' 'SHORTCUT_DESKTOP_MISSING' }
  foreach ($item in $plan) {
    $link = Join-Path $desktop $item.Name
    Save-DesktopShortcut $link $item.Target $script:Repo
    Write-Ok "Đã tạo shortcut: $link -> $($item.Target)"
  }
}

# ---------------------------------------------------------------------------------------------
# Applications (M00.01): entry for the three PC surfaces behind 11Ship-Admin / -Food / -Ship
# ---------------------------------------------------------------------------------------------
# The wrappers only choose the app; everything else is shared. This package ships the entry point and its
# refusal path, not the launch sequence: opening an app needs the shared lock (M00.02, now in place), artifact/process
# identity (M00.03) and a real local server for the surface (M00.05 and later). While any of those is missing the
# launcher says so and exits with a non-zero code, BEFORE it takes the lock, updates code, starts a database or backend,
# or opens a browser. A design preview or any answer on a port is not the application (design M00 v2.1, R05/R08).
# Runtime = repo-relative entry of the real local server for that surface; $null means none exists yet.
$script:AppCatalog = [ordered]@{
  # Launch = 'client': the launcher builds, runs, proves and opens the app (M00.05; Web Admin since M00.08, with the extra
  # Admin steps of Open-ClientApp / Initialize-AdminAuth: .env check, limiter configuration, SYSTEM account).
  Admin = [pscustomobject]@{ Name = 'Web Admin';             Url = 'https://localhost:8443'; Runtime = 'scripts/admin-web-dev.mjs'; Package = 'M00.05/M00.08'; Launch = 'client'; Key = 'admin-web'; Short = 'Web Admin'; BuildScript = 'build:admin-web'; Pending = '' }
  Food  = [pscustomobject]@{ Name = '11Food (khách + quán)'; Url = 'https://localhost:8444'; Runtime = 'scripts/food-web-dev.mjs';  Package = 'M00.05/M00.06'; Launch = 'client'; Key = 'food-web'; Short = '11Food';    BuildScript = 'build:food-web'; Pending = '' }
  Ship  = [pscustomobject]@{ Name = '11Ship (xế)';           Url = 'https://localhost:8445'; Runtime = 'scripts/ship-web-dev.mjs';  Package = 'M00.05/M00.07'; Launch = 'client'; Key = 'ship-web'; Short = '11Ship';    BuildScript = 'build:ship-web'; Pending = '' }
}
# What the shared orchestrator guarantees today. A package flips its entry to Ready only when it is integrated and verified.
# ExclusiveLock (M00.02): Start, Update, Test, Stop, dependency and migration steps all run under Use-LaunchLock; the behaviour
# suite proves that from inside each step. ArtifactIdentity (M00.03): manifest + process registry + ownership/port proof for
# the backend target (Get-BackendTarget); a frontend target of a later package describes itself the same way. Ready is claimed
# only for what the behaviour suite proves in CI; the Owner smoke on a real PC is a separate, still open gate.
$script:OrchestratorCapabilities = [ordered]@{
  ExclusiveLock    = [pscustomobject]@{ Ready = $true;  Code = 'LAUNCH_LOCK_MISSING';       Package = 'M00.02'; Text = 'chưa có khóa độc quyền dùng chung cho update/build/migration/process' }
  ArtifactIdentity = [pscustomobject]@{ Ready = $true;  Code = 'ARTIFACT_IDENTITY_MISSING'; Package = 'M00.03'; Text = 'chưa có định danh artifact/process để xác minh đúng bản đang chạy' }
  # M00.05: the launch sequence of the phone apps (certificate check, backend, build, HTTPS front, proof, browser). An entry
  # whose surface has no launch (none today; Admin got its own in M00.08) still refuses with APP_NOT_READY and names what is missing.
  AppLaunchSequence = [pscustomobject]@{ Ready = $true;  Code = 'APP_LAUNCH_SEQUENCE_MISSING'; Package = 'M00.05'; Text = 'chưa có trình tự mở ứng dụng (HTTPS local, máy chủ riêng của bề mặt, trình duyệt)' }
}
function Get-AppLaunchBlockers([string]$AppId) {
  $entry = $script:AppCatalog[$AppId]
  if (!$entry) { Fail "Ứng dụng không hợp lệ: $AppId. Chỉ có Admin, Food, Ship." 'APP_UNKNOWN' }
  $blockers = New-Object 'Collections.Generic.List[object]'
  $runtimeMissing = (!$entry.Runtime -or !(Test-Path -LiteralPath (Join-Path $script:Repo $entry.Runtime) -PathType Leaf))
  if (!$runtimeMissing -and $entry.Launch -eq 'client') {
    $helpers = @('scripts/client-web-check.mjs', 'scripts/client-web-build.mjs')
    if ($AppId -eq 'Admin') { $helpers = @('scripts/client-web-check.mjs', 'scripts/admin-web-build.mjs', 'scripts/admin-auth-init-limit-config.js', 'scripts/admin-auth-bootstrap-system.js') }
    foreach ($helper in $helpers) { if (!(Test-Path -LiteralPath (Join-Path $script:Repo $helper) -PathType Leaf)) { $runtimeMissing = $true } }
  }
  if ($runtimeMissing) {
    $blockers.Add([pscustomobject]@{ Code = 'APP_RUNTIME_MISSING'; Package = $entry.Package; Text = "chưa có máy chủ chạy thật cho $($entry.Name) (không dùng bản xem thử thay thế)" })
  }
  if ($entry.Launch -ne 'client') {
    $blockers.Add([pscustomobject]@{ Code = 'APP_LAUNCH_PACKAGE_MISSING'; Package = 'M00.08'; Text = "launcher chưa mở được $($entry.Name): $($entry.Pending)" })
  }
  foreach ($capability in @($script:OrchestratorCapabilities.Values)) {
    if (!$capability.Ready) { $blockers.Add([pscustomobject]@{ Code = $capability.Code; Package = $capability.Package; Text = $capability.Text }) }
  }
  return @($blockers.ToArray())
}
function Open-AppLauncher([string]$AppId) {
  if (!$AppId) { Fail 'Thiếu tên ứng dụng. Hãy mở 11Ship-Admin.cmd, 11Ship-Food.cmd hoặc 11Ship-Ship.cmd.' 'APP_NOT_SPECIFIED' }
  $entry = $script:AppCatalog[$AppId]
  if (!$entry) { Fail "Ứng dụng không hợp lệ: $AppId. Chỉ có Admin, Food, Ship." 'APP_UNKNOWN' }
  $blockers = @(Get-AppLaunchBlockers $AppId)
  if ($blockers.Count) {
    $lines = @($blockers | ForEach-Object { "  - $($_.Code): $($_.Text) (gói $($_.Package))" }) -join [Environment]::NewLine
    $nl = [Environment]::NewLine
    Fail ("$($entry.Name) chưa sẵn sàng để mở ($($entry.Url)). Còn thiếu:$nl$lines${nl}Chưa làm gì: không cập nhật mã, không bật database hoặc backend, không mở trình duyệt.") 'APP_NOT_READY'
  }
  if ($entry.Launch -eq 'client') { Open-ClientApp $AppId; return }
  # Every prerequisite is declared ready, yet no launch sequence exists for this surface: refuse instead of guessing.
  Fail "$($entry.Name): các điều kiện đã khai báo sẵn sàng nhưng trình tự mở ứng dụng chưa được triển khai." 'APP_LAUNCH_NOT_IMPLEMENTED'
}
function Invoke-LauncherCommand([string]$Name) {
  # After a hand-over this process holds OLD launcher code: it refuses every command, in the menu as well.
  if ($script:LauncherStale) { Fail $script:StaleMessage 'LAUNCHER_RELOAD_REQUIRED' }
  switch ($Name) { 'Start' { Start-Launcher } 'Update' { Update-Launcher } 'Test' { Test-Launcher } 'Stop' { Stop-Launcher } 'Status' { Status-Launcher } 'InstallShortcut' { Install-Shortcut } 'App' { Open-AppLauncher $App } default { Menu } }
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

# The entry point is a function so the launcher that is re-run after an Update (and the tests) use the very same code path.
function Invoke-LauncherMain {
  $script:IsRelaunched = [bool]$RelaunchToken
  $script:TakeoverPending = $script:IsRelaunched
  $exitCode = 0
  try {
    if ($script:IsRelaunched) { Assert-RelaunchParameters }
    Invoke-LauncherCommand $Command
  } catch { Write-Failure $_; $exitCode = 1 }
  # A new launcher that failed reports its own code; the first launcher exits with that same code.
  if ($exitCode -ne 0 -and $script:RelaunchExitCode -ne 0) { $exitCode = $script:RelaunchExitCode }
  if ($Command -ne 'Menu') {
    # A launcher started by a hand-over only continues the work: the first launcher prints the result, decides the pause
    # (it is the one a double-click started) and writes the run record.
    if ($script:IsRelaunched) { exit $exitCode }
    $label = if ($Command -eq 'App') { "App $App".Trim() } else { $Command }
    if ($exitCode -eq 0) { Write-Host "Kết quả ${label}: THÀNH CÔNG (exit 0)" -ForegroundColor Green }
    else { Write-Host "Kết quả ${label}: THẤT BẠI (exit $exitCode)" -ForegroundColor Red }
    $pauseState = Get-PauseState
    Write-RunRecord $label $exitCode $pauseState
    if ($pauseState.Wait) { Write-Host ''; [void](Read-Host 'Nhấn Enter để đóng cửa sổ') }
  }
  exit $exitCode
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-LauncherMain }
