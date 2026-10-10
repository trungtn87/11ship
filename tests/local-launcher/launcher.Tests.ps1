# Behaviour tests for tools/local/11ship-launcher.ps1 (task M00-L).
#
# These tests RUN the launcher functions. Git is real (throw-away repositories in a temp folder whose path
# contains a space). Docker, npm and the backend process start are replaced by recording fakes, so nothing here
# can reach the Owner's DEV database, the real repository state in .11ship-local, or any remote system.
# The file is ASCII on purpose: Windows PowerShell 5.1 reads a BOM-less script as ANSI.
# Runs on Windows PowerShell 5.1 (the Owner's shell and the Windows CI job) and on PowerShell 7 (Ubuntu CI).
$ErrorActionPreference = 'Stop'
$scriptPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..\tools\local\11ship-launcher.ps1')).Path
$realRepo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$onWindows = ($env:OS -eq 'Windows_NT')
if (!$onWindows) { Set-Alias -Name git.exe -Value git }
$savedEnv = @{}
foreach ($name in @('OS','APP_ENV','NODE_ENV','DATABASE_URL','GITHUB_TOKEN','GH_TOKEN','SHIP11_NO_PAUSE')) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$env:OS = 'Windows_NT'
. $scriptPath

$failures = New-Object 'Collections.Generic.List[string]'
$script:Passed = 0
$script:Skipped = New-Object 'Collections.Generic.List[string]'
function Say([string]$Text) { [Console]::Out.WriteLine($Text) }
function Check([bool]$Condition,[string]$Name) {
  if ($Condition) { $script:Passed++; Say "PASS $Name" } else { Say "FAIL $Name"; $failures.Add($Name) }
}
function Section([string]$Name) { Say ''; Say "== $Name" }
function Get-FailMessage([scriptblock]$Body) {
  try { & $Body | Out-Null } catch { return "$($_.Exception.Message)" }
  return ''
}
function Expect-Fail([string]$Code,[string]$Name,[scriptblock]$Body) {
  $message = Get-FailMessage $Body
  $ok = $message.Contains(": $Code)")
  Check $ok "$Name -> $Code"
  if (!$ok) { Say "     actual: $message" }
}

# ---------------------------------------------------------------------------------------------
# Recording fakes
# ---------------------------------------------------------------------------------------------
$script:HostLog = New-Object 'Collections.Generic.List[string]'
$script:AllSql = New-Object 'Collections.Generic.List[string]'
$script:AllDocker = New-Object 'Collections.Generic.List[string]'
function Write-Host { param([Parameter(Position=0)]$Object,$ForegroundColor,[switch]$NoNewline) $script:HostLog.Add("$Object") }
function Read-Host { param($Prompt)
  $script:Prompts.Add("$Prompt")
  if ($script:Answers.Count) { return $script:Answers.Dequeue() }
  return $null
}
function docker.exe {
  $line = ($args -join ' ')
  $script:DockerCalls.Add($line); $script:AllDocker.Add($line)
  $global:LASTEXITCODE = 0
  if ($script:DockerDown) { $global:LASTEXITCODE = 1; return }
  if ($args[0] -eq 'info') { return '29.8.2' }
  if ($args[0] -eq '--version') { return 'Docker version 29.8.2' }
  if ($args[0] -eq 'compose') {
    if ($args -contains 'version') { return 'Docker Compose version v5.5.1' }
    if ($args -contains 'ps') { return 'NAME STATUS' }
    return
  }
  if ($args[0] -eq 'inspect') {
    if ($line.Contains('Config.Env')) {
      if ($script:InspectFails) { $global:LASTEXITCODE = 1; return }
      return $script:TestContainerEnv
    }
    return 'healthy'
  }
  if ($args[0] -eq 'port') { return $script:TestPortBinding }
  if ($args[0] -eq 'exec') {
    $sql = [string]$args[$args.Count - 1]
    $script:SqlCalls.Add($sql); $script:AllSql.Add($sql)
    if ($script:DbDown) { $global:LASTEXITCODE = 2; return }
    if ($sql.Contains('to_regclass')) { if ($script:DbHasTable) { return 't' } else { return 'f' } }
    if ($sql.StartsWith('SELECT name')) { return $script:DbApplied }
  }
}
function npm.cmd {
  $line = ($args -join ' ')
  $script:NpmCalls.Add($line)
  $global:LASTEXITCODE = 0
  if ($line -eq '--version') { return '11.9.0' }
  if ($line -eq 'ci') {
    if ($script:NpmCiFails) { $global:LASTEXITCODE = 1; return }
    New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
    return
  }
  if ($line -eq 'run db:migrate') {
    $script:MigrateEnv = "APP_ENV=[$env:APP_ENV] DATABASE_URL=[$env:DATABASE_URL]"
    if ($script:MigrateApplies) { $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles) }
  }
}
function node.exe { $global:LASTEXITCODE = 0; if (($args -join ' ') -eq '--version') { return 'v24.21.0' } }
function Http-Status([string]$Url) { $script:HttpCalls.Add($Url); if ($script:BackendStarts -gt 0) { return 200 }; return $script:HttpCode }
function Start-BackendProcess([string]$Stdout,[string]$Stderr) {
  $script:BackendStarts++
  return [pscustomobject]@{ Id = 999999; StartTime = [DateTime]::UtcNow }
}
function Start-NpmStep([string[]]$NpmArgs,[string]$Stdout,[string]$Stderr) {
  $name = $NpmArgs[$NpmArgs.Count - 1]
  $script:Steps.Add([pscustomobject]@{ Name = $name; AppEnv = $env:APP_ENV; NodeEnv = $env:NODE_ENV; DatabaseUrl = $env:DATABASE_URL })
  # A noisy step that prints every secret it can see, the way a failing tool might.
  $noise = @("step $name", "connecting to $env:DATABASE_URL", "raw password $script:TestPassword", "encoded $(ConvertTo-UriComponent $script:TestPassword)") + $script:EnvSecrets
  [IO.File]::WriteAllLines($Stdout, [string[]]$noise)
  [IO.File]::WriteAllLines($Stderr, [string[]]@("stderr of $name postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev"))
  if ($script:StepExit.ContainsKey($name)) { return $script:StepExit[$name] }
  return 0
}
function Reset-Fakes {
  $script:HostLog.Clear()
  $script:Prompts = New-Object 'Collections.Generic.List[string]'
  $script:Answers = New-Object 'Collections.Generic.Queue[object]'
  $script:DockerCalls = New-Object 'Collections.Generic.List[string]'
  $script:SqlCalls = New-Object 'Collections.Generic.List[string]'
  $script:NpmCalls = New-Object 'Collections.Generic.List[string]'
  $script:HttpCalls = New-Object 'Collections.Generic.List[string]'
  $script:Steps = New-Object 'Collections.Generic.List[object]'
  $script:StepExit = @{}
  $script:DockerDown = $false; $script:InspectFails = $false; $script:DbDown = $false
  $script:DbHasTable = $false; $script:DbApplied = @(); $script:MigrateApplies = $true; $script:MigrateEnv = ''
  $script:NpmCiFails = $false; $script:HttpCode = 0; $script:BackendStarts = 0
  $script:TestPortBinding = '127.0.0.1:5433'
  $script:TestContainerEnv = @('PATH=/usr/bin', 'POSTGRES_USER=ship11_test', "POSTGRES_PASSWORD=$script:TestPassword", 'POSTGRES_DB=ship11_test')
  $script:ExtraSecrets = @()
  Set-Variable -Scope Script -Name Yes -Value $false
  Set-Variable -Scope Script -Name KeepDatabases -Value $false
  Set-Variable -Scope Script -Name ForceDependencies -Value $false
}
function NpmCount([string]$Line) { return @($script:NpmCalls | Where-Object { $_ -eq $Line }).Count }

# ---------------------------------------------------------------------------------------------
# Sandboxes
# ---------------------------------------------------------------------------------------------
$script:TestPassword = 't@st/p#ss:w%rd?&=+ x!$'
$script:DevPassword = 'devS3cret-Value-0001'
$otpSecret = 'b3RwLXNlY3JldC1vdHAtc2VjcmV0LW90cC1zZWNyZXQ='
$keyringKey = 'a2V5cmluZy1zZWNyZXQta2V5cmluZy1zZWNyZXQtMTI='
$script:EnvSecrets = @($script:DevPassword, $otpSecret, $keyringKey, "local-key-1:$keyringKey")
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("11ship launcher tests " + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$script:SandboxIndex = 0
function Write-Text([string]$Path,[string]$Text) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Write-EnvFile([string]$AppEnv='development',[string]$DatabaseUrl='') {
  if (!$DatabaseUrl) { $DatabaseUrl = "postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev" }
  Write-Text $script:EnvFile (@(
    "APP_ENV=$AppEnv", "DATABASE_URL=$DatabaseUrl", "DEV_DB_PASSWORD=$($script:DevPassword)",
    "TEST_DB_PASSWORD='$($script:TestPassword)'", "AUTH_OTP_HMAC_SECRET=$otpSecret",
    'CRYPTO_ACTIVE_KEY_ID=local-key-1', "CRYPTO_KEYRING=local-key-1:$keyringKey"
  ) -join "`n")
}
function Use-Repo([string]$Repo) {
  $script:Repo = $Repo
  $script:StateDir = Join-Path $Repo '.11ship-local'
  $script:StateFile = Join-Path $script:StateDir 'backend.json'
  $script:InstallState = Join-Path $script:StateDir 'installed-lock.sha256'
  $script:LastTest = Join-Path $script:StateDir 'last-test.json'
  $script:LastRun = Join-Path $script:StateDir 'last-run.json'
  $script:Logs = Join-Path $script:StateDir 'logs'
  $script:Compose = Join-Path $Repo 'compose.dev.yml'
  $script:EnvFile = Join-Path $Repo '.env'
  Reset-Fakes
  Ensure-Dirs
  Write-EnvFile
}
function Invoke-Git([string]$Dir,[string[]]$Arguments) {
  $out = Capture 'git.exe' (@('-C',$Dir,'-c','user.name=Launcher Test','-c','user.email=launcher-test@example.invalid','-c','commit.gpgsign=false','-c','core.autocrlf=false') + $Arguments)
  if ($null -eq $out) { throw "git failed in ${Dir}: $($Arguments -join ' ')" }
  return $out
}
# origin.git (bare) <- seed (plays "upstream developer") and "owner repo" (the working copy the launcher manages).
function New-GitSandbox {
  $script:SandboxIndex++
  $root = Join-Path $tempRoot "case $script:SandboxIndex"
  $script:Origin = Join-Path $root 'origin.git'; $script:Seed = Join-Path $root 'seed'; $repo = Join-Path $root 'owner repo'
  New-Item -ItemType Directory -Force -Path $script:Seed | Out-Null
  if ($null -eq (Capture 'git.exe' @('init','--bare','--initial-branch=main',$script:Origin))) { throw 'git init --bare failed' }
  if ($null -eq (Capture 'git.exe' @('init','--initial-branch=main',$script:Seed))) { throw 'git init failed' }
  Write-Text (Join-Path $script:Seed '.gitignore') ".env`nnode_modules/`n.11ship-local/`n"
  Write-Text (Join-Path $script:Seed 'package-lock.json') '{"lockfileVersion":3,"revision":1}'
  Write-Text (Join-Path $script:Seed 'database/migrations/1000_first.sql') 'SELECT 1;'
  Write-Text (Join-Path $script:Seed 'database/migrations/2000_second.sql') 'SELECT 2;'
  Invoke-Git $script:Seed @('add','-A') | Out-Null
  Invoke-Git $script:Seed @('commit','-m','init') | Out-Null
  Invoke-Git $script:Seed @('remote','add','origin',$script:Origin) | Out-Null
  Invoke-Git $script:Seed @('push','-u','origin','main') | Out-Null
  if ($null -eq (Capture 'git.exe' @('clone',$script:Origin,$repo))) { throw 'git clone failed' }
  Use-Repo $repo
}
function Push-Upstream([string]$RelativePath,[string]$Text) {
  Write-Text (Join-Path $script:Seed $RelativePath) $Text
  Invoke-Git $script:Seed @('add','-A') | Out-Null
  Invoke-Git $script:Seed @('commit','-m',"upstream $RelativePath") | Out-Null
  Invoke-Git $script:Seed @('push','origin','main') | Out-Null
}
function Head { return Invoke-Git $script:Repo @('rev-parse','HEAD') }
function Record-Install {
  New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
  Write-Text $script:InstallState (File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json'))
}
$nodeApp = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
function Start-IdleNode {
  if ($onWindows) { return Start-Process -FilePath $nodeApp.Source -ArgumentList @('-e','setTimeout(function(){},120000)') -PassThru -WindowStyle Hidden }
  return Start-Process -FilePath $nodeApp.Source -ArgumentList @('-e','setTimeout(function(){},120000)') -PassThru
}
function Write-BackendState($Process,[string]$StartedUtc='') {
  if (!$StartedUtc) { $StartedUtc = $Process.StartTime.ToUniversalTime().ToString('o') }
  Write-Text $script:StateFile (@{ pid = $Process.Id; startedUtc = $StartedUtc } | ConvertTo-Json)
}
function Stop-Quietly($Process) { try { if ($Process -and !$Process.HasExited) { $Process.Kill(); $Process.WaitForExit(5000) | Out-Null } } catch { } }

try {
  # =============================================================================================
  Section 'Update guards (real git): dirty tracked, untracked collision, detached, no upstream, non-fast-forward'
  # =============================================================================================
  New-GitSandbox; Record-Install
  $before = Head
  Write-Text (Join-Path $script:Repo 'package-lock.json') '{"owner":"local edit"}'
  Expect-Fail 'DIRTY_TRACKED' 'Update stops on a dirty tracked file' { Update-Launcher }
  Check ((Get-Content -Raw -LiteralPath (Join-Path $script:Repo 'package-lock.json')) -eq '{"owner":"local edit"}') 'dirty tracked file is left exactly as the Owner wrote it'
  Check ((Invoke-Git $script:Repo @('stash','list')) -eq '') 'no stash was created'
  Check ((Head) -eq $before) 'HEAD did not move'
  Check ((NpmCount 'ci') -eq 0) 'npm ci did not run after a refused update'

  New-GitSandbox; Record-Install
  $before = Head
  $owned = Join-Path $script:Repo 'tore package.json'
  Write-Text $owned '{"owner":"untracked, must survive"}'
  $ownedHash = File-HashOrEmpty $owned
  Push-Upstream 'tore package.json' '{"upstream":"would overwrite"}'
  Expect-Fail 'UNTRACKED_COLLISION' 'Update stops when upstream would overwrite an untracked file' { Update-Launcher }
  Check ((File-HashOrEmpty $owned) -eq $ownedHash) 'colliding untracked file is byte-for-byte intact'
  Check ((Head) -eq $before) 'HEAD did not move on untracked collision'

  New-GitSandbox; Record-Install
  $owned = Join-Path $script:Repo 'tore package.json'
  Write-Text $owned '{"owner":"untracked, no collision"}'
  $ownedHash = File-HashOrEmpty $owned
  Push-Upstream 'docs/note.md' 'new upstream file'
  Update-Launcher | Out-Null
  Check ((File-HashOrEmpty $owned) -eq $ownedHash) 'non-colliding untracked file survives a successful update byte-for-byte'
  Check ((Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'successful update fast-forwards to upstream'
  Check ((Invoke-Git $script:Repo @('status','--porcelain','--untracked-files=all')).Contains('?? "tore package.json"') -or (Invoke-Git $script:Repo @('status','--porcelain','--untracked-files=all')).Contains('?? tore package.json')) 'the untracked file is still untracked (never added)'

  New-GitSandbox; Record-Install
  Invoke-Git $script:Repo @('checkout','--detach','HEAD') | Out-Null
  Push-Upstream 'docs/note.md' 'x'
  $before = Head
  Expect-Fail 'DETACHED_HEAD' 'Update stops on detached HEAD' { Update-Launcher }
  Check ((Head) -eq $before) 'HEAD did not move while detached'

  New-GitSandbox; Record-Install
  Invoke-Git $script:Repo @('checkout','-b','feature/no-upstream') | Out-Null
  Expect-Fail 'NO_UPSTREAM' 'Update stops on a branch without upstream' { Update-Launcher }

  New-GitSandbox; Record-Install
  Write-Text (Join-Path $script:Repo 'local.txt') 'local commit'
  Invoke-Git $script:Repo @('add','local.txt') | Out-Null
  Invoke-Git $script:Repo @('commit','-m','local work') | Out-Null
  $before = Head
  Push-Upstream 'docs/note.md' 'diverged'
  Expect-Fail 'NON_FAST_FORWARD' 'Update stops when history diverged' { Update-Launcher }
  Check ((Head) -eq $before) 'no merge commit, no reset: HEAD is still the local commit'
  Check ((Invoke-Git $script:Repo @('rev-list','--count','--merges','HEAD')) -eq '0') 'history contains no merge commit'
  Check ((Get-Content -Raw -LiteralPath (Join-Path $script:Repo 'local.txt')) -eq 'local commit') 'local commit content is intact'

  # =============================================================================================
  Section 'F01 dependencies: lockfile unchanged / changed / first run / failure'
  # =============================================================================================
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'no lock change'
  Update-Launcher | Out-Null
  Check ((NpmCount 'ci') -eq 0) 'lockfile unchanged and recorded: npm ci is not run'

  New-GitSandbox; Record-Install
  $oldRecorded = Get-Content -Raw -LiteralPath $script:InstallState
  Push-Upstream 'package-lock.json' '{"lockfileVersion":3,"revision":2}'
  Update-Launcher | Out-Null
  Check ((NpmCount 'ci') -eq 1) 'lockfile changed by upstream: npm ci runs exactly once'
  $newRecorded = Get-Content -Raw -LiteralPath $script:InstallState
  Check ($newRecorded -ne $oldRecorded -and $newRecorded -eq (File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json'))) 'recorded lock hash now matches the new lockfile'

  # F01 regression: node_modules exists, lockfile unchanged, nothing to pull, but no installed-lock.sha256 yet.
  New-GitSandbox
  New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
  Check (!(Test-Path -LiteralPath $script:InstallState)) 'first run precondition: no recorded lock state'
  Check ((Get-DependencyState) -eq 'unrecorded') 'first run is detected as unrecorded'
  Expect-Fail 'DEPENDENCIES_NOT_READY' 'Start refuses an unrecorded dependency state' { Start-Launcher }
  Check ((NpmCount 'run build') -eq 0) 'Start did not build on unrecorded dependencies'
  Reset-Fakes
  Update-Launcher | Out-Null
  Check ((NpmCount 'ci') -eq 1) 'F01: Update without any flag completes the dependency state (npm ci once)'
  Check ((Get-DependencyState) -eq 'ok') 'F01: dependency state is recorded after Update'
  Reset-Fakes
  Update-Launcher | Out-Null
  Check ((NpmCount 'ci') -eq 0) 'F01: second Update does not reinstall'
  Reset-Fakes; $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles)
  Start-Launcher | Out-Null
  Check ($script:BackendStarts -eq 1) 'F01: Start works right after that Update'

  New-GitSandbox
  New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
  $script:NpmCiFails = $true
  $message = Get-FailMessage { Update-Launcher }
  Check ($message -ne '') 'failed npm ci makes Update fail'
  Check (!(Test-Path -LiteralPath $script:InstallState)) 'failed npm ci records no dependency state'
  Check (@($script:HostLog | Where-Object { $_.Contains('fast-forward ho') }).Count -eq 0) 'failed Update never announces completion'

  New-GitSandbox; Record-Install
  Set-Variable -Scope Script -Name ForceDependencies -Value $true
  Update-Launcher | Out-Null
  Check ((NpmCount 'ci') -eq 1) '-ForceDependencies still forces npm ci'
  Reset-Fakes

  New-GitSandbox; Record-Install
  Push-Upstream 'database/migrations/3000_third.sql' 'SELECT 3;'
  Update-Launcher | Out-Null
  Check (@($script:HostLog | Where-Object { $_.Contains('1 migration') }).Count -eq 1) 'Update announces a new upstream migration'
  Check ((NpmCount 'run db:migrate') -eq 0 -and $script:SqlCalls.Count -eq 0) 'Update never migrates or touches the database'

  # =============================================================================================
  Section 'F02 migrations: real DEV database state decides, never a local cache file'
  # =============================================================================================
  New-GitSandbox; Record-Install
  # A stale cache from the previous launcher version claiming "everything applied".
  Write-Text (Join-Path $script:StateDir 'migrations.sha256') ('a' * 64)
  $cacheHash = File-HashOrEmpty (Join-Path $script:StateDir 'migrations.sha256')
  $script:DbHasTable = $false   # brand-new DEV database: no pgmigrations table at all
  $plan = Get-MigrationPlan
  Check ($plan.Pending.Count -eq 2 -and $plan.Applied.Count -eq 0) 'new database + stale cache: both migrations are detected as pending'
  $script:Answers.Enqueue('n')
  Expect-Fail 'MIGRATION_DECLINED' 'Start asks the Owner and stops when the answer is no' { Start-Launcher }
  Check ($script:Prompts.Count -eq 1 -and $script:Prompts[0].Contains('ship11_dev')) 'the prompt names the DEV target'
  Check ((NpmCount 'run db:migrate') -eq 0) 'declined: db:migrate was not run'
  Check ($script:BackendStarts -eq 0) 'declined: backend was not started'
  Check (@($script:HostLog | Where-Object { $_.Contains('1000_first') -or $_.Contains('2000_second') }).Count -eq 2) 'pending migration names are shown before asking'

  Reset-Fakes; $script:DbHasTable = $false
  $env:APP_ENV = 'test'; $env:DATABASE_URL = 'postgres://stray:stray@127.0.0.1:5433/ship11_test'
  $script:Answers.Enqueue('y')
  Start-Launcher | Out-Null
  Check ((NpmCount 'run db:migrate') -eq 1) 'accepted: db:migrate runs exactly once'
  Check ($script:MigrateEnv -eq 'APP_ENV=[] DATABASE_URL=[]') 'DEV migration runs with inherited APP_ENV/DATABASE_URL cleared (db:migrate reads .env itself)'
  Check ($env:APP_ENV -eq 'test' -and $env:DATABASE_URL.Contains('stray')) 'caller environment is restored after the migration'
  Check ($script:BackendStarts -eq 1) 'accepted: backend starts after the migration'
  Check ((File-HashOrEmpty (Join-Path $script:StateDir 'migrations.sha256')) -eq $cacheHash) 'the legacy cache file is neither trusted nor modified'
  $env:APP_ENV = $null; $env:DATABASE_URL = $null

  Reset-Fakes; $script:DbHasTable = $true; $script:DbApplied = @('1000_first','2000_second')
  Start-Launcher | Out-Null
  Check ($script:Prompts.Count -eq 0 -and (NpmCount 'run db:migrate') -eq 0) 'database already migrated: no prompt, no migration'

  Reset-Fakes; $script:DbHasTable = $true; $script:DbApplied = @('1000_first')
  $plan = Get-MigrationPlan
  Check ($plan.Pending.Count -eq 1 -and $plan.Pending[0] -eq '2000_second') 'partially migrated database: only the missing migration is pending'

  Reset-Fakes; $script:DbHasTable = $true; $script:DbApplied = @('1000_first','2000_second','9000_from_other_branch')
  $plan = Get-MigrationPlan
  Check ($plan.Pending.Count -eq 0 -and $plan.Unknown.Count -eq 1) 'a migration unknown to this checkout is reported, not removed'
  Start-Launcher | Out-Null
  Check ((NpmCount 'run db:migrate') -eq 0) 'unknown migration in the database triggers no migration run'

  Reset-Fakes; $script:DbDown = $true
  Expect-Fail 'MIGRATION_STATE_UNAVAILABLE' 'unreadable database state is an error, never "already migrated"' { Start-Launcher }
  Check ($script:BackendStarts -eq 0) 'backend does not start when the migration state is unknown'

  Reset-Fakes; $script:DbHasTable = $false; $script:MigrateApplies = $false; $script:Answers.Enqueue('y')
  Expect-Fail 'MIGRATION_INCOMPLETE' 'migration that leaves pending entries is reported' { Start-Launcher }
  Check ($script:BackendStarts -eq 0) 'backend does not start after an incomplete migration'

  $sqlSeen = @($script:AllSql)
  Check ($sqlSeen.Count -gt 0 -and @($sqlSeen | Where-Object { $_ -notmatch '^SELECT ' -or $_ -match '(?i)\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|ALTER|CREATE)\b' }).Count -eq 0) 'launcher only sends read-only SELECT statements to the DEV database'
  Check (@($script:AllDocker | Where-Object { $_.StartsWith('exec') -and !$_.StartsWith('exec ship11-db-dev psql ') }).Count -eq 0) 'migration state is read from the DEV container only'

  # =============================================================================================
  Section 'Start when a backend is already running / stale PID / foreign service on the port'
  # =============================================================================================
  if (!$nodeApp) { Check $false 'node is required for process ownership tests' }
  else {
    New-GitSandbox; Record-Install; $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles)
    $idle = Start-IdleNode
    try {
      Write-BackendState $idle
      $ownedProcess = Get-OwnedBackendProcess
      Check ($ownedProcess -and $ownedProcess.Id -eq $idle.Id) 'a recorded node process with matching start time is owned'
      $script:HttpCode = 200
      Start-Launcher | Out-Null
      Check ($script:BackendStarts -eq 0) 'Start with a running launcher backend does not start a second one'
      Check (!$idle.HasExited) 'the running backend was not restarted or killed by Start'

      # Stale PID: same live PID, different start time => the PID now belongs to someone else.
      Write-BackendState $idle '2001-01-01T00:00:00.0000000Z'
      Check ($null -eq (Get-OwnedBackendProcess)) 'stale state (PID reused, other start time) is not owned'
      Set-Variable -Scope Script -Name KeepDatabases -Value $true
      $script:DockerCalls.Clear()
      Stop-Launcher | Out-Null
      Check (!$idle.HasExited) 'Stop does not kill a process it does not own'
      Check (!(Test-Path -LiteralPath $script:StateFile)) 'Stop clears the stale state file'
      Check (@($script:DockerCalls | Where-Object { $_.StartsWith('compose') }).Count -eq 0) '-KeepDatabases leaves Docker alone'

      # Foreign service on the port, no launcher state.
      Reset-Fakes; $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles); $script:HttpCode = 200
      Expect-Fail 'PORT_IN_USE' 'Start refuses a port owned by a foreign service' { Start-Launcher }
      Check ($script:BackendStarts -eq 0 -and !$idle.HasExited) 'the foreign process is left alone and nothing is started'

      # The current PowerShell is alive with a matching start time but is not node.
      $self = Get-Process -Id $PID
      Write-BackendState $self
      Check ($null -eq (Get-OwnedBackendProcess)) 'a non-node process is never treated as the backend'

      # Owned process is stopped by Stop.
      Reset-Fakes; Set-Variable -Scope Script -Name KeepDatabases -Value $true
      Write-BackendState $idle
      Stop-Launcher | Out-Null
      $idle.WaitForExit(10000) | Out-Null
      Check ($idle.HasExited) 'Stop ends the backend it owns'
    } finally { Stop-Quietly $idle }

    # Stale PID of a process that no longer exists: Start replaces the state and starts one backend.
    New-GitSandbox; Record-Install; $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles)
    $dead = Start-IdleNode; $deadStarted = $dead.StartTime.ToUniversalTime().ToString('o'); Stop-Quietly $dead
    Write-Text $script:StateFile (@{ pid = $dead.Id; startedUtc = $deadStarted } | ConvertTo-Json)
    Check ($null -eq (Get-OwnedBackendProcess)) 'state pointing at an exited process is not owned'
    Start-Launcher | Out-Null
    Check ($script:BackendStarts -eq 1) 'Start with a stale PID starts exactly one backend'
    Check ((Get-BackendState).pid -eq 999999) 'the stale state file is replaced by the new backend'
  }
  Write-Text $script:StateFile '{ not json'
  Check ($null -eq (Get-BackendState)) 'corrupt backend state is treated as no state'

  # =============================================================================================
  Section 'Stop keeps the DEV volume'
  # =============================================================================================
  New-GitSandbox
  Stop-Launcher | Out-Null
  $composeCalls = @($script:DockerCalls | Where-Object { $_.StartsWith('compose') -and !$_.EndsWith('version') })
  Check ($composeCalls.Count -eq 1 -and $composeCalls[0].EndsWith(' stop db-dev db-test')) 'Stop issues exactly one compose command: stop db-dev db-test'
  Check (@($script:DockerCalls | Where-Object { $_ -match '(?i)(\bdown\b|\s-v\b|--volumes|\bvolume\b|\brm\b|\bprune\b)' }).Count -eq 0) 'Stop never issues down / -v / volume / rm / prune'

  # =============================================================================================
  Section 'Docker unavailable'
  # =============================================================================================
  New-GitSandbox; Record-Install
  $script:DockerDown = $true
  Expect-Fail 'DOCKER_UNAVAILABLE' 'Start reports Docker unavailable' { Start-Launcher }
  Expect-Fail 'DOCKER_UNAVAILABLE' 'Test reports Docker unavailable' { Test-Launcher }
  Expect-Fail 'DOCKER_UNAVAILABLE' 'Update reports Docker unavailable' { Update-Launcher }
  Expect-Fail 'DOCKER_UNAVAILABLE' 'Stop (with databases) reports Docker unavailable' { Stop-Launcher }
  Check (@($script:DockerCalls | Where-Object { $_.StartsWith('compose --env-file') }).Count -eq 0) 'no compose command is attempted without Docker'
  Check ((NpmCount 'run build') -eq 0 -and $script:Steps.Count -eq 0 -and $script:BackendStarts -eq 0) 'nothing is built, tested or started without Docker'
  $script:HostLog.Clear()
  $statusError = Get-FailMessage { Status-Launcher }
  Check ($statusError -eq '') 'Status still works when Docker is unavailable'
  Check (@($script:HostLog | Where-Object { $_.StartsWith('Database:') }).Count -eq 1) 'Status says the database state cannot be read'

  # =============================================================================================
  Section 'Local .env guard (DEV target)'
  # =============================================================================================
  New-GitSandbox
  Write-EnvFile 'development' "postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5433/ship11_test"
  Expect-Fail 'DEV_TARGET_GUARD' '.env pointing at another database is refused' { Assert-LocalEnv }
  Write-EnvFile 'development' "postgres://ship11_dev:$($script:DevPassword)@db.example.com:5432/ship11_dev"
  $message = Get-FailMessage { Assert-LocalEnv }
  Check ($message.Contains(': DEV_TARGET_GUARD)') -and !$message.Contains($script:DevPassword) -and !$message.Contains('db.example.com')) 'remote DATABASE_URL is refused without printing its value'
  Write-EnvFile 'production'
  Expect-Fail 'ENV_NOT_DEVELOPMENT' 'APP_ENV=production is refused' { Assert-LocalEnv }
  Write-Text $script:EnvFile "APP_ENV=development`nDATABASE_URL=postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev`n"
  $message = Get-FailMessage { Assert-LocalEnv }
  Check ($message.Contains('DEV_DB_PASSWORD') -and $message.Contains(': ENV_VARIABLE_MISSING)') -and !$message.Contains($script:DevPassword)) 'missing variable is named, no value is printed'
  Remove-Item -LiteralPath $script:EnvFile -Force
  Expect-Fail 'ENV_FILE_MISSING' 'missing .env is reported' { Assert-LocalEnv }
  Check ((ConvertFrom-DotEnvValue ' "quo ted#x" ') -eq 'quo ted#x' -and (ConvertFrom-DotEnvValue "'s#q'") -eq 's#q' -and (ConvertFrom-DotEnvValue 'plain # comment') -eq 'plain') '.env values: quotes are removed and inline comments ignored'

  # =============================================================================================
  Section 'F03 TEST database URL: URL-reserved characters in the password'
  # =============================================================================================
  $helper = Join-Path $PSScriptRoot 'support/parse-database-url.cjs'
  $pgAvailable = $false
  if ($nodeApp) {
    $env:T_URL = 'postgres://ship11_test:x@127.0.0.1:5433/ship11_test'; $env:T_PASSWORD = 'x'; $env:T_REPO = $realRepo
    $probe = (& $nodeApp.Source $helper | Out-String).Trim()
    $pgAvailable = ($probe -eq 'OK')
    if (!$pgAvailable -and $probe -ne 'MISSING') { Check $false "pg-connection-string probe returned: $probe" }
  }
  if (!$pgAvailable) {
    if ($env:CI) { Check $false 'pg-connection-string must be installed in CI (run npm ci first)' }
    else { $script:Skipped.Add('real pg-connection-string round trip (node_modules not installed)') }
  }
  $passwords = @(
    'change_me_test', 'p@ss', 'a/b', 'a#b', 'a:b', '100%', '%41%2F', 'a?b&c=d', 'a+b c', "quote'`"q", 'back\slash', '[v6]:{x}|<y>^`~',
    '@/#:%?&=+ $,;!*()[]', $script:TestPassword, ('m' + [char]0x1EAD + 't kh' + [char]0x1EA9 + 'u'), '-._~azAZ09'
  )
  foreach ($password in $passwords) {
    $label = ConvertTo-UriComponent $password
    $url = New-TestDatabaseUrl $password
    $encoded = $url.Substring('postgres://ship11_test:'.Length, $url.Length - 'postgres://ship11_test:'.Length - '@127.0.0.1:5433/ship11_test'.Length)
    Check ($encoded -cmatch '^[A-Za-z0-9\-._~%]*$' -and [Uri]::UnescapeDataString($encoded) -ceq $password) "password round-trips through the URL: $label"
    if ($pgAvailable) {
      $env:T_URL = $url; $env:T_PASSWORD = $password
      Check (((& $nodeApp.Source $helper | Out-String).Trim()) -eq 'OK') "pg driver parser reads the same password, user, host, port and database: $label"
    }
  }
  foreach ($bad in @(
    @('postgres://ship11_dev:x@127.0.0.1:5432/ship11_dev', 'x', 'DEV URL'),
    @('postgres://ship11_test:x@127.0.0.1:5432/ship11_test', 'x', 'test names on the DEV port'),
    @('postgres://ship11_test:x@127.0.0.1:5433/ship11_dev', 'x', 'DEV database on the TEST port'),
    @('postgres://ship11_dev:x@127.0.0.1:5433/ship11_test', 'x', 'DEV user'),
    @('postgres://ship11_test:x@db.example.com:5433/ship11_test', 'x', 'remote host'),
    @('postgres://ship11_test:x@127.0.0.1:5433/ship11_test?options=-csearch_path=prod', 'x', 'query string'),
    @('postgres://ship11_test:a@evil.example:5432/ship11_dev#@127.0.0.1:5433/ship11_test', 'a@evil.example:5432/ship11_dev#', 'unencoded password that smuggles another host'),
    @('postgres://ship11_test:x@127.0.0.1:5433/ship11_test', 'y', 'password that does not decode to the real one')
  )) { Expect-Fail 'TEST_TARGET_GUARD' "Assert-TestDatabaseUrl rejects $($bad[2])" { Assert-TestDatabaseUrl $bad[0] $bad[1] } }

  # =============================================================================================
  Section 'DEV/TEST isolation and secret redaction in the Test command'
  # =============================================================================================
  New-GitSandbox; Record-Install
  $env:APP_ENV = 'development'; $env:NODE_ENV = 'development'; $env:DATABASE_URL = "postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev"
  $env:GITHUB_TOKEN = $null; $env:GH_TOKEN = $null
  Test-Launcher | Out-Null
  Check ($script:Steps.Count -eq 9) 'all nine npm steps ran (progress-check is skipped without a token)'
  Check (@($script:Steps | Where-Object { $_.AppEnv -cne 'test' -or $_.NodeEnv -cne 'test' }).Count -eq 0) 'every step ran with APP_ENV=test and NODE_ENV=test'
  Check (@($script:Steps | Where-Object { $_.DatabaseUrl -cnotmatch '^postgres://ship11_test:[A-Za-z0-9\-._~%]*@127\.0\.0\.1:5433/ship11_test$' }).Count -eq 0) 'every step saw only ship11_test@127.0.0.1:5433/ship11_test'
  Check (@($script:Steps | Where-Object { $_.DatabaseUrl.Contains('ship11_dev') -or $_.DatabaseUrl.Contains(':5432') }).Count -eq 0) 'no step ever saw the DEV database URL'
  Check ($env:APP_ENV -eq 'development' -and $env:DATABASE_URL.Contains('ship11_dev')) 'caller environment is restored after the tests'
  $summary = Get-Content -Raw -LiteralPath $script:LastTest | ConvertFrom-Json
  Check ($summary.result -eq 'PASS' -and $summary.commit -eq (Head)) 'summary is PASS and bound to the tested commit SHA'
  Check (@($summary.steps).Count -eq 10 -and @($summary.steps | Where-Object { $_.result -eq 'SKIP' -and $_.step -eq 'progress-check' }).Count -eq 1) 'summary lists 9 PASS steps and progress-check as SKIP, not PASS'
  $logFiles = @(Get-ChildItem -LiteralPath $script:Logs -File)
  Check ($logFiles.Count -eq 9 -and @($logFiles | Where-Object { $_.Name.EndsWith('.raw') }).Count -eq 0) 'one redacted log per step, no raw output left on disk'
  $everything = (@($logFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) + @(Get-Content -Raw -LiteralPath $script:LastTest) + @($script:HostLog)) -join "`n"
  $leaks = @(@($script:TestPassword, (ConvertTo-UriComponent $script:TestPassword), $script:DevPassword, $otpSecret, $keyringKey) | Where-Object { $everything.Contains($_) })
  Check ($leaks.Count -eq 0) 'no password, encoded password, OTP secret or keyring key in logs, summary or console'
  Check ($everything.Contains('postgres://ship11_test:***@127.0.0.1:5433/ship11_test') -and $everything.Contains('step test:integration')) 'logs keep the useful text with credentials replaced by ***'

  Reset-Fakes; $script:StepExit['test:unit'] = 1
  Expect-Fail 'TEST_FAILED' 'a failing step fails the Test command' { Test-Launcher }
  $summary = Get-Content -Raw -LiteralPath $script:LastTest | ConvertFrom-Json
  Check ($summary.result -eq 'FAIL' -and @($script:Steps | Where-Object { $_.Name -eq 'test:integration' }).Count -eq 0) 'summary is FAIL and later steps (integration) did not run'

  Reset-Fakes; $script:TestContainerEnv = @('POSTGRES_USER=ship11_dev', "POSTGRES_PASSWORD=$script:DevPassword", 'POSTGRES_DB=ship11_dev')
  Expect-Fail 'TEST_TARGET_GUARD' 'a container that is really the DEV database is refused' { Test-Launcher }
  Check ($script:Steps.Count -eq 0) 'no test step ran against a DEV-shaped container'
  Reset-Fakes; $script:TestPortBinding = '127.0.0.1:5432'
  Expect-Fail 'TEST_TARGET_GUARD' 'a TEST container published on the DEV port is refused' { Test-Launcher }
  Check ($script:Steps.Count -eq 0) 'no test step ran on the DEV port'
  Reset-Fakes; $script:InspectFails = $true
  Expect-Fail 'CONTAINER_INSPECT_FAILED' 'unknown TEST container configuration is refused' { Test-Launcher }
  Check ($script:Steps.Count -eq 0) 'no test step ran with an unknown target'
  $env:APP_ENV = $null; $env:NODE_ENV = $null; $env:DATABASE_URL = $null

  Reset-Fakes
  $redacted = Protect-Text "x postgres://ship11_test:pw-value@127.0.0.1:5433/ship11_test y https://user:tok3n@example.com/z k=$otpSecret" @($otpSecret)
  Check ($redacted -eq 'x postgres://ship11_test:***@127.0.0.1:5433/ship11_test y https://user:***@example.com/z k=***') 'Protect-Text hides URL credentials of any scheme and known secret values'
  Check ((Protect-Text 'http://127.0.0.1:3000/v1/health/ready' @()) -eq 'http://127.0.0.1:3000/v1/health/ready') 'Protect-Text leaves credential-free URLs readable'
  Write-EnvFile
  $script:HostLog.Clear()
  try { throw "boom $($script:DevPassword) postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev" } catch { Write-Failure $_ }
  Check ($script:HostLog.Count -eq 1 -and !$script:HostLog[0].Contains($script:DevPassword) -and $script:HostLog[0].Contains('***')) 'an unexpected error message is redacted before it is printed'

  # =============================================================================================
  Section 'F04 Status: PASS only for the commit that is checked out'
  # =============================================================================================
  New-GitSandbox; Record-Install
  $head = Head
  Write-Text $script:LastTest (@{ timestamp = '2026-10-10T01:02:03.0000000Z'; commit = $head; result = 'PASS'; steps = @() } | ConvertTo-Json)
  Check ((Get-LastTestStatus $script:LastTest $head).Label -eq 'PASS') 'summary of the current commit is reported as PASS'
  Status-Launcher | Out-Null
  $line = @($script:HostLog | Where-Object { $_.StartsWith('Test g') })
  Check ($line.Count -eq 1 -and $line[0].Contains(': PASS') -and !$line[0].Contains('STALE')) 'Status prints PASS for the tested commit'
  Check (@($script:HostLog | Where-Object { $_.StartsWith('Git:') -and $_.Contains("commit=$head") }).Count -eq 1) 'Status prints the current commit SHA'

  Write-Text (Join-Path $script:Repo 'new-code.txt') 'untested change'
  Invoke-Git $script:Repo @('add','new-code.txt') | Out-Null
  Invoke-Git $script:Repo @('commit','-m','new code') | Out-Null
  $newHead = Head
  $status = Get-LastTestStatus $script:LastTest $newHead
  Check ($status.Label -eq 'STALE') 'F04: summary of an older commit is STALE'
  Check ($status.Text.StartsWith('STALE') -and $status.Text.Contains($newHead.Substring(0, 7)) -and $status.Text.Contains($head.Substring(0, 7))) 'F04: STALE text names the untested and the tested commit'
  $script:HostLog.Clear()
  Status-Launcher | Out-Null
  $line = @($script:HostLog | Where-Object { $_.StartsWith('Test g') })
  Check ($line.Count -eq 1 -and $line[0].Contains(': STALE') -and !$line[0].Contains(': PASS')) 'F04: Status prints STALE, not PASS, for new untested code'

  Write-Text $script:LastTest (@{ timestamp = 'x'; commit = $newHead; result = 'FAIL'; steps = @() } | ConvertTo-Json)
  Check ((Get-LastTestStatus $script:LastTest $newHead).Label -eq 'FAIL') 'a FAIL summary of the current commit is reported as FAIL'
  Check ((Get-LastTestStatus $script:LastTest '').Label -eq 'STALE') 'unknown current commit never yields PASS/FAIL'
  foreach ($broken in @('{ not json', '{"result":"PASS"}', '{"result":"PASS","commit":"abc"}', ('{"result":"MAYBE","commit":"' + $newHead + '"}'))) {
    Write-Text $script:LastTest $broken
    Check ((Get-LastTestStatus $script:LastTest $newHead).Label -notin @('PASS','FAIL')) "invalid summary is never PASS/FAIL: $broken"
  }
  Remove-Item -LiteralPath $script:LastTest -Force
  Check ((Get-LastTestStatus $script:LastTest $newHead).Label -notin @('PASS','FAIL','STALE')) 'missing summary is reported as not tested'

  # =============================================================================================
  Section 'F05 double-click decision and menu loop'
  # =============================================================================================
  $doubleClick = 'C:\WINDOWS\system32\cmd.exe /c ""D:\11 Ship\tools\local\11Ship-Start.cmd" "'
  Check ((Get-PauseDecision $false $false $false 2 'cmd.exe' $doubleClick) -eq $true) 'double-click (cmd /c wrapper alone in its console) waits for the Owner'
  Check ((Get-PauseDecision $false $false $false 2 'cmd.exe' '"C:\WINDOWS\system32\cmd.exe" ') -eq $false) 'interactive cmd terminal does not wait'
  Check ((Get-PauseDecision $false $false $false 3 'cmd.exe' $doubleClick) -eq $false) 'PowerShell terminal (shell also attached to the console) does not wait'
  Check ((Get-PauseDecision $false $false $false 2 'cmd.exe' 'C:\WINDOWS\system32\cmd.exe /k "x.cmd"') -eq $false) 'cmd /k (window stays open anyway) does not wait'
  Check ((Get-PauseDecision $false $true $false 2 'cmd.exe' $doubleClick) -eq $false) 'redirected input never waits'
  Check ((Get-PauseDecision $false $false $true 2 'cmd.exe' $doubleClick) -eq $false) 'redirected output never waits'
  Check ((Get-PauseDecision $true $false $false 2 'cmd.exe' $doubleClick) -eq $false) '-NoPause never waits'
  Check ((Get-PauseDecision $false $false $false 2 'powershell.exe' 'powershell.exe -File x.ps1') -eq $false) 'direct PowerShell invocation does not wait'
  Check ((Get-PauseDecision $false $false $false 0 'cmd.exe' $doubleClick) -eq $false) 'unknown console state does not wait'

  $script:MenuCalls = New-Object 'Collections.Generic.List[string]'
  $realInvoke = ${function:Invoke-LauncherCommand}
  function Invoke-LauncherCommand([string]$Name) { $script:MenuCalls.Add($Name); if ($Name -eq 'Test') { throw '[FAIL] simulated failure' } }
  function Test-InputRedirected { return $script:InputRedirected }
  $script:InputRedirected = $false
  Reset-Fakes
  foreach ($answer in @('5','x','3','1','0','4')) { $script:Answers.Enqueue($answer) }
  Menu | Out-Null
  Check (($script:MenuCalls -join ',') -eq 'Status,Test,Start') 'menu keeps running after each action (including a failed one) until 0 is chosen'
  Check ($script:Answers.Count -eq 1) 'menu stops reading input after 0'
  Check (@($script:HostLog | Where-Object { $_.Contains('Status:') }).Count -eq 1 -and @($script:HostLog | Where-Object { $_.Contains('simulated failure') }).Count -eq 1) 'menu prints the result of each action'
  Check (@($script:HostLog | Where-Object { $_ -match '^\s+[0-6]\. ' }).Count -eq 35) 'menu shows all seven numbered choices each time'
  Reset-Fakes; $script:MenuCalls.Clear()
  Menu | Out-Null
  Check ($script:MenuCalls.Count -eq 0 -and $script:Prompts.Count -eq 1) 'menu exits at end of input instead of looping'
  Reset-Fakes; $script:InputRedirected = $true; $script:Answers.Enqueue('')
  Menu | Out-Null
  Check ($script:Prompts.Count -eq 1) 'menu exits on an empty line when input is redirected'
  Set-Item -Path function:Invoke-LauncherCommand -Value $realInvoke

  # =============================================================================================
  Section 'Wrappers and real Windows double-click behaviour'
  # =============================================================================================
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $scriptPath
  foreach ($forbidden in @('reset --hard','down -v','db:migrate:remote','git stash','push --force','audit fix')) { Check (!$source.Contains($forbidden)) "source excludes forbidden operation: $forbidden" }
  $wrappers = @(Get-ChildItem -LiteralPath (Split-Path $scriptPath) -Filter '*.cmd')
  Check ($wrappers.Count -eq 6) 'menu plus five command wrappers exist'
  foreach ($wrapper in $wrappers) {
    $text = Get-Content -Raw -LiteralPath $wrapper.FullName
    Check ($text.Contains('powershell.exe -NoProfile -ExecutionPolicy Bypass') -and $text.Contains('exit /b %code%') -and $text -notmatch '(?im)^\s*pause\b') "$($wrapper.Name) calls Windows PowerShell, preserves the exit code and has no unconditional pause"
  }

  if (!$onWindows) { $script:Skipped.Add('real Windows wrapper runs (cmd.exe double-click simulation) - not Windows') }
  else {
    # A copy of tools\local in a folder with a space: the wrappers then manage that empty sandbox, not this repo.
    $copyRepo = Join-Path $tempRoot 'copy repo'
    $copyLocal = Join-Path (Join-Path $copyRepo 'tools') 'local'
    New-Item -ItemType Directory -Force -Path $copyLocal | Out-Null
    Copy-Item -Path (Join-Path (Split-Path $scriptPath) '*') -Destination $copyLocal
    $wrapper = Join-Path $copyLocal '11Ship-Status.cmd'
    $runRecord = Join-Path (Join-Path $copyRepo '.11ship-local') 'last-run.json'
    $emptyInput = Join-Path $tempRoot 'empty-input.txt'; Write-Text $emptyInput ''
    $captured = Join-Path $tempRoot 'status-output.txt'
    $env:SHIP11_NO_PAUSE = $null

    # Terminal / automation style: redirected streams. Must finish by itself.
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ""{0}""' -f $wrapper) -RedirectStandardInput $emptyInput -RedirectStandardOutput $captured -PassThru -WindowStyle Hidden
    $finished = $p.WaitForExit(180000)
    if (!$finished) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
    Check $finished 'F05: wrapper with redirected streams finishes without waiting for a key'
    Check ($finished -and $p.ExitCode -eq 0) 'F05: Status wrapper exits 0 from a path that contains a space'
    Check ((Test-Path -LiteralPath $captured) -and (Get-Content -Raw -LiteralPath $captured).Contains('N/A')) 'F05: Status output reached the caller'
    $record = if (Test-Path -LiteralPath $runRecord) { Get-Content -Raw -LiteralPath $runRecord | ConvertFrom-Json } else { $null }
    Check ($record -and $record.command -eq 'Status' -and $record.exitCode -eq 0 -and $record.waitedForOwner -eq $false) 'F05: run record says Status succeeded without a pause'
    Remove-Item -LiteralPath $runRecord -Force -ErrorAction SilentlyContinue

    # Double-click: Explorer runs  cmd.exe /c ""<wrapper>""  in a NEW console. Same call here.
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ""{0}""' -f $wrapper) -PassThru -WindowStyle Hidden
    try {
      $deadline = [DateTime]::UtcNow.AddSeconds(180)
      while (!(Test-Path -LiteralPath $runRecord) -and !$p.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
      Start-Sleep -Seconds 5
      $record = if (Test-Path -LiteralPath $runRecord) { Get-Content -Raw -LiteralPath $runRecord | ConvertFrom-Json } else { $null }
      Check ($record -and $record.command -eq 'Status' -and $record.exitCode -eq 0) 'F05: double-clicked Status finished successfully'
      if ($record) { Say "     run record: waitedForOwner=$($record.waitedForOwner) consoleProcesses=$($record.consoleProcesses) parent=$($record.parent)" }
      Check ($record -and $record.waitedForOwner -eq $true) 'F05: double-clicked Status decided to keep the window open'
      Check (!$p.HasExited) 'F05: the window is still open 5 seconds after a SUCCESSFUL double-clicked Status'
    } finally { if (!$p.HasExited) { & taskkill.exe /PID $p.Id /T /F | Out-Null } }
  }
}
finally {
  foreach ($name in @($savedEnv.Keys)) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Say ''
foreach ($item in $script:Skipped) { Say "SKIP $item" }
Say "SUMMARY pass=$script:Passed fail=$($failures.Count) skip=$($script:Skipped.Count)"
if ($failures.Count) { Say "FAILED: $($failures -join ' | ')"; exit 1 }
exit 0
