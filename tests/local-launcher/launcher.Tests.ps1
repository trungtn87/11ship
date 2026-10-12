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
# Every launcher Git call goes through this wrapper: it records the call and can make chosen reads fail (exit 128) so the
# suite can prove the launcher treats a failed read differently from an empty one. Real Git does the rest.
$script:RealGit = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$script:GitFaults = @{}
$script:GitCalls = New-Object 'Collections.Generic.List[string]'
function git.exe {
  $line = ($args -join ' ')
  $script:GitCalls.Add($line)
  foreach ($pattern in @($script:GitFaults.Values)) { if ($line -cmatch $pattern) { $global:LASTEXITCODE = 128; return } }
  & $script:RealGit @args
}
$savedEnv = @{}
foreach ($name in @('OS','APP_ENV','NODE_ENV','DATABASE_URL','GITHUB_TOKEN','GH_TOKEN','SHIP11_NO_PAUSE','TEST_WRONG_USER_DATABASE_URL','TEST_REMOTE_PATH_DATABASE_URL','TEST_REMOTE_PATH_RUNTIME_URL','PGPASSWORD','SHIP11_LOCK_TIMEOUT_SECONDS','SHIP11_NO_BROWSER','SHIP11_HARNESS_DELAY_MS','SHIP11_HARNESS_NPM_FAIL','GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE')) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$env:OS = 'Windows_NT'
. $scriptPath
# M00.03: the production operating-system seams, kept for the Windows-only section before the fakes below replace them.
$script:RealGetProcessDetails = ${function:Get-ProcessDetails}
$script:RealGetPortListeners = ${function:Get-PortListeners}
$script:RealStopOwnedProcess = ${function:Stop-OwnedProcess}
$psExe = (Get-Process -Id $PID).Path
$supportDir = Join-Path $PSScriptRoot 'support'
$lockHolderScript = Join-Path $supportDir 'lock-holder.ps1'
$harnessScript = Join-Path $supportDir 'relaunch-harness.ps1'
$identityHarnessScript = Join-Path $supportDir 'identity-harness.ps1'

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
# M00.02: every fake that stands for a shared step records whether the shared lock was held at that moment.
function Test-LockHeld {
  $probe = Open-ExclusiveFile $script:LockFile
  if ($probe) { $probe.Dispose(); return $false }
  return $true
}
# F3: the identity read can be made to fail AFTER the lock was taken (the real cause: the launcher file is held by another process).
$script:IdentityFault = $false
function Get-LauncherIdentity {
  if ($script:IdentityFault) { throw 'simulated: the launcher file cannot be read right now' }
  return (File-HashOrEmpty $script:LauncherPath)
}
function Test-GateHeld {
  $probe = Open-ExclusiveFile $script:GateFile
  if ($probe) { $probe.Dispose(); return $false }
  return $true
}
# A stand-in for the process the old launcher starts after an Update. Real processes are covered by the harness section.
function New-FakeChild([int]$ExitCode=0,[bool]$Exited=$true) {
  $child = [pscustomobject]@{ Id = 424242; HasExited = $Exited; ExitCode = $ExitCode; Killed = $false }
  $child | Add-Member -MemberType ScriptMethod -Name Kill -Value { $this.Killed = $true; $this.HasExited = $true }
  $child | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Milliseconds) $this.HasExited = $true; return $true }
  return $child
}
function Start-LauncherProcess([string[]]$Arguments) {
  $script:SpawnedArguments = @($Arguments)
  $script:SpawnObservations = [pscustomobject]@{ LockHeld = (Test-LockHeld); GateHeld = (Test-GateHeld); DockerCount = $script:DockerCalls.Count }
  if ($script:SpawnThrows) { throw 'simulated spawn failure' }
  return $script:FakeChild
}
function Add-LockObservation([string]$What) { $script:LockObs.Add([pscustomobject]@{ What = $What; Held = (Test-LockHeld) }) }
function docker.exe {
  $line = ($args -join ' ')
  $script:DockerCalls.Add($line); $script:AllDocker.Add($line)
  Add-LockObservation "docker $line"
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
    if ($sql.Contains('app.admin_memberships')) { return $script:SystemCount }
  }
}
function npm.cmd {
  $line = ($args -join ' ')
  $script:NpmCalls.Add($line)
  $global:LASTEXITCODE = 0
  if ($line -eq '--version') { return '11.9.0' }
  Add-LockObservation "npm $line"
  $script:NpmCwds.Add((Split-Path -Leaf (Get-Location).Path))
  if ($line -eq 'ci') {
    $script:NpmCiSawCiOnly = Get-CiOnlySnapshot
    if ($script:NpmCiFails) { $global:LASTEXITCODE = 1; return }
    New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
    return
  }
  if ($line -eq 'run build') {
    if ($script:BuildFails) { $global:LASTEXITCODE = 1; return }
    if (!$script:BuildNoOutput) {
      New-Item -ItemType Directory -Force -Path (Join-Path $script:BackendDist 'sub') | Out-Null
      [IO.File]::WriteAllText((Join-Path $script:BackendDist 'main.js'), $script:BuildContent)
      [IO.File]::WriteAllText((Join-Path (Join-Path $script:BackendDist 'sub') 'a.js'), 'module.a')
    }
    if ($script:BuildHook) { & $script:BuildHook }
    return
  }
  if ($line -match '^run build:(food|ship|admin)-web$') {
    $appKey = "$($Matches[1])-web"
    $script:AppBuilds.Add($appKey)
    if ($script:AppBuildFails) { $global:LASTEXITCODE = 1; return }
    if (!$script:AppBuildNoOutput) { Write-FakeAppBuild $appKey }
    return
  }
  if ($line -eq 'run db:migrate') {
    $script:MigrateAliveProcesses = $script:FakeProcs.Count
    $script:MigrateEnv = "APP_ENV=[$env:APP_ENV] DATABASE_URL=[$env:DATABASE_URL]"
    if ($script:MigrateApplies) { $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles) }
  }
}
function node.exe { $global:LASTEXITCODE = 0; if (($args -join ' ') -eq '--version') { return 'v24.21.0' } }
# ---- M00.03: the operating-system seams (processes, listening ports, HTTP) are an in-memory fake table ----
# Nothing here can reach a real process or port. The launcher's own identity logic runs on top of these answers.
function Add-FakeProcess([int]$ProcessId,[string]$StartUtc,[string]$Executable='',$Arguments=$null,[bool]$Inspectable=$true,[string]$Name='node') {
  if (!$Executable) { $Executable = $script:FakeNodeExe }
  if ($null -eq $Arguments) { $Arguments = @($Executable, '--env-file-if-exists=.env', $script:BackendScript) }
  $script:FakeProcs[$ProcessId] = [pscustomobject]@{ ProcessId = $ProcessId; Name = $Name; Inspectable = $Inspectable; StartUtc = $StartUtc; Executable = $Executable; CommandLine = (@($Arguments) -join ' '); Arguments = @($Arguments) }
}
function Add-FakeListener([string]$Address,[int]$ProcessId,[int]$Port=3000) {
  $script:FakeListeners = @($script:FakeListeners) + @([pscustomobject]@{ Address = $Address; ProcessId = $ProcessId; Port = $Port })
}
function Remove-FakeProcess([int]$ProcessId) {
  $script:FakeProcs.Remove($ProcessId)
  $script:FakeListeners = @($script:FakeListeners | Where-Object { $_.ProcessId -ne $ProcessId })
}
function Get-ProcessDetails([int]$ProcessId) {
  if ($script:ProcessReadFails) { throw 'simulated: the process list cannot be read' }
  $found = $null
  if ($script:FakeProcs.ContainsKey($ProcessId)) { $found = $script:FakeProcs[$ProcessId] }
  # One-shot: runs right AFTER this answer was computed, i.e. between a check and whatever the launcher does next.
  if ($script:DetailsHook) { $hook = $script:DetailsHook; $script:DetailsHook = $null; & $hook $ProcessId }
  return $found
}
function Get-PortListeners([int]$Port) {
  if ($script:ListenersUnreadable) { return [pscustomobject]@{ Readable = $false; Items = @(); Detail = 'simulated: access denied' } }
  $rows = @($script:FakeListeners | Where-Object { $_.Port -eq $Port } | ForEach-Object { [pscustomobject]@{ Address = $_.Address; ProcessId = $_.ProcessId } })
  return [pscustomobject]@{ Readable = $true; Items = $rows; Detail = '' }
}
# Same contract as the production seam: ends the process only when the process behind the PID still has the expected start time.
# An empty expected start time means 'whatever occupies the PID' (the old, unsafe call) and is killed.
function Stop-OwnedProcess([int]$ProcessId,[string]$ExpectedStartUtc='') {
  Add-LockObservation "backend stop $ProcessId"
  if ($script:StopThrows) { $script:StopCalls.Add($ProcessId); throw 'simulated: access denied' }
  if (!$script:FakeProcs.ContainsKey($ProcessId)) { return 'NOT_FOUND' }
  if ($ExpectedStartUtc -and (ConvertTo-UtcText $script:FakeProcs[$ProcessId].StartUtc) -cne (ConvertTo-UtcText $ExpectedStartUtc)) { return 'REPLACED' }
  $script:StopCalls.Add($ProcessId)
  if ($script:StopIgnored) { return 'STOPPED' }
  if ($script:StopMode -eq 'uninspectable') {
    # The process is gone for real but the launcher can no longer read it: exists-but-unreadable.
    $entry = $script:FakeProcs[$ProcessId]
    $script:FakeProcs[$ProcessId] = [pscustomobject]@{ ProcessId = $ProcessId; Name = $entry.Name; Inspectable = $false; StartUtc = ''; Executable = ''; CommandLine = ''; Arguments = @() }
    return 'STOPPED'
  }
  Remove-FakeProcess $ProcessId
  if ($script:StopMode -eq 'unreadable') { $script:ProcessReadFails = $true }
  return 'STOPPED'
}
# The object Start-Process returns: it keeps pointing at ITS process even after the PID was reused (like an OS handle).
function New-FakeBackendChild([int]$ChildId,[string]$OwnStartUtc) {
  $child = [pscustomobject]@{ Id = $ChildId; OwnStartUtc = $OwnStartUtc; StartTime = [DateTime]::Parse($OwnStartUtc, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) }
  $child | Add-Member -MemberType ScriptProperty -Name HasExited -Value {
    if (!$script:FakeProcs.ContainsKey($this.Id)) { $true } else { (ConvertTo-UtcText $script:FakeProcs[$this.Id].StartUtc) -cne (ConvertTo-UtcText $this.OwnStartUtc) }
  }
  $child | Add-Member -MemberType ScriptMethod -Name Kill -Value {
    if (!$this.HasExited) { $script:StopCalls.Add($this.Id); Remove-FakeProcess $this.Id }
  }
  return $child
}
function Get-HttpResult([string]$Url) {
  $script:HttpCalls.Add($Url)
  $listening = @($script:FakeListeners | Where-Object { $_.Port -eq 3000 }).Count -gt 0
  $kind = if ($Url.EndsWith('/live')) { 'live' } else { 'ready' }
  if ($script:HealthMode -eq 'never' -or !$listening) { return [pscustomobject]@{ Status = 0; Body = '' } }
  if ($script:HealthMode -eq 'wrongbody') { return [pscustomobject]@{ Status = 200; Body = '{"data":{"status":"starting"}}' } }
  if ($script:HealthMode -eq 'html') { return [pscustomobject]@{ Status = 200; Body = '<html>welcome</html>' } }
  if ($script:HealthMode -eq 'ready503' -and $kind -eq 'ready') { return [pscustomobject]@{ Status = 503; Body = '' } }
  $body = if ($kind -eq 'live') { '{"data":{"status":"ok"}}' } else { '{"data":{"status":"ready"}}' }
  return [pscustomobject]@{ Status = 200; Body = $body }
}
function Start-BackendProcess([string]$Stdout,[string]$Stderr) {
  $script:BackendStarts++
  Add-LockObservation 'backend start'
  if ($script:StartHook) { & $script:StartHook }
  if ($script:StartThrows) { throw 'simulated: node.exe cannot be started' }
  $script:FakePidCounter++
  $newId = $script:FakePidCounter
  $startUtc = [DateTime]::UtcNow.AddMilliseconds($newId).ToString('o')
  if ($script:StartReplacedBy) {
    # The child already exited and Windows gave its PID to someone else before the launcher looked: the occupant has another start time.
    $otherStart = [DateTime]::UtcNow.AddHours(-3).ToString('o')
    if ($script:StartReplacedBy -eq 'lookalike') { Add-FakeProcess $newId $otherStart } else { Add-FakeProcess $newId $otherStart '' @($script:FakeNodeExe, 'unrelated-service.js') }
    Add-FakeListener '127.0.0.1' $newId
  }
  elseif (!$script:StartVanishes) {
    $arguments = @($script:FakeNodeExe) + @(Get-BackendStartArguments)
    if ($script:StartScript) { $arguments = @($script:FakeNodeExe, '--env-file-if-exists=.env', $script:StartScript) }
    # The command line is what Windows reports: quoted when it has a space, split back into arguments by the launcher.
    $commandLine = '"' + $script:FakeNodeExe + '" ' + ((@($arguments)[1..(@($arguments).Count - 1)]) -join ' ')
    Add-FakeProcess $newId $startUtc $script:FakeNodeExe @(Split-CommandLine $commandLine)
    if ($script:StartListens) { Add-FakeListener '127.0.0.1' $newId }
  }
  return (New-FakeBackendChild $newId $startUtc)
}
function Start-NpmStep([string[]]$NpmArgs,[string]$Stdout,[string]$Stderr) {
  $name = $NpmArgs[$NpmArgs.Count - 1]
  Add-LockObservation "npm step $name"
  $script:Steps.Add([pscustomobject]@{ Name = $name; AppEnv = $env:APP_ENV; NodeEnv = $env:NODE_ENV; DatabaseUrl = $env:DATABASE_URL; CiOnly = (Get-CiOnlySnapshot) })
  # A noisy step that prints every secret it can see, the way a failing tool might.
  $noise = @("step $name", "connecting to $env:DATABASE_URL", "raw password $script:TestPassword", "encoded $(ConvertTo-UriComponent $script:TestPassword)") + $script:EnvSecrets
  [IO.File]::WriteAllLines($Stdout, [string[]]$noise)
  [IO.File]::WriteAllLines($Stderr, [string[]]@("stderr of $name postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev"))
  if ($script:StepExit.ContainsKey($name)) { return $script:StepExit[$name] }
  return 0
}
# ---- M00.05: the checker (scripts/client-web-check.mjs), the app process and the browser. The OS seams are the table above. ----
function New-CheckResult([bool]$Ok,[string]$Code,[string]$Message='simulated') { return [pscustomobject]@{ Ok = $Ok; Code = $Code; Message = $Message } }
function Invoke-ClientCheck([string[]]$Arguments) {
  $script:ClientChecks.Add(($Arguments -join ' '))
  if ($Arguments[0] -eq 'cert') {
    $script:CertSawComposeUp = @($script:DockerCalls | Where-Object { $_ -match 'compose.* up ' -or $_.EndsWith(' up') -or $_ -match ' up -d' }).Count
    $script:CertSawLock = (Test-LockHeld)
    $script:Events.Add('cert')
    if ($script:CertMode -eq 'ok') { return (New-CheckResult $true 'OK') }
    return (New-CheckResult $false $script:CertMode)
  }
  Add-LockObservation 'client probe'
  $script:ProbeCount++
  $script:Events.Add('probe')
  if ($script:ProbeMode -ne 'ok') { return (New-CheckResult $false $script:ProbeMode) }
  # An honest probe: something must hold the port.
  $port = [int]$Arguments[([array]::IndexOf($Arguments, '--port') + 1)]
  if (@($script:FakeListeners | Where-Object { $_.Port -eq $port }).Count -eq 0) { return (New-CheckResult $false 'PROBE_UNREACHABLE') }
  return (New-CheckResult $true 'OK')
}
function Write-FakeAppBuild([string]$AppKey) {
  $dist = Join-Path (Join-Path (Join-Path $script:Repo 'apps') $AppKey) 'dist'
  New-Item -ItemType Directory -Force -Path (Join-Path $dist 'js') | Out-Null
  [IO.File]::WriteAllText((Join-Path $dist 'index.html'), '<!doctype html>')
  [IO.File]::WriteAllText((Join-Path (Join-Path $dist 'js') 'main.js'), $script:AppBuildContent)
  if ($script:AppManifestMode -eq 'none') { return }
  $fingerprint = Get-ArtifactFingerprint $dist
  if ($script:AppManifestMode -eq 'badfp') { $fingerprint = ('0' * 64) }
  $sha = if ($script:AppManifestSha) { $script:AppManifestSha } else { Head }
  $manifest = [ordered]@{ app_id = $AppKey; mode = 'live'; source_sha = $sha; fingerprint = $fingerprint; build_fingerprint = $fingerprint; built_at = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"); design_version = '2.0.1'; files = 2 }
  [IO.File]::WriteAllText((Join-Path $dist 'build-manifest.json'), (($manifest | ConvertTo-Json) + "`n"), (New-Object Text.UTF8Encoding($false)))
}
function Start-AppProcess($Target,[string]$Stdout,[string]$Stderr) {
  $script:AppStarts.Add($Target.AppId)
  Add-LockObservation "app start $($Target.AppId)"
  $script:Events.Add("start $($Target.AppId)")
  if ($script:AppStartThrows) { throw 'simulated: node.exe cannot be started' }
  $script:FakePidCounter++
  $newId = $script:FakePidCounter
  $startUtc = [DateTime]::UtcNow.AddMilliseconds($newId).ToString('o')
  if (!$script:AppStartVanishes) {
    # The command line is what Windows reports: the executable, then the script as the only argument (quoted when it has a space).
    $commandLine = '"' + $script:FakeNodeExe + '" ' + (ConvertTo-QuotedArgument $Target.Script)
    Add-FakeProcess $newId $startUtc $script:FakeNodeExe @(Split-CommandLine $commandLine)
    if ($script:AppStartListens) { Add-FakeListener '127.0.0.1' $newId ([int]$Target.Port) }
  }
  return (New-FakeBackendChild $newId $startUtc)
}
$ciOnlyNames = @('TEST_WRONG_USER_DATABASE_URL','TEST_REMOTE_PATH_DATABASE_URL','TEST_REMOTE_PATH_RUNTIME_URL','PGPASSWORD')
# What a child process would inherit: "NAME=value" for every CI-only variable that is set, '' when none is.
function Get-CiOnlySnapshot { return (@($ciOnlyNames | ForEach-Object { $v = [Environment]::GetEnvironmentVariable($_, 'Process'); if ($v) { "$_=$v" } }) -join ';') }
function Reset-Fakes {
  $script:NpmCiSawCiOnly = $null
  # M00.02: a test never inherits a held lock, a hand-over state or a recorded observation from the previous one.
  if ($script:LockHandle) { try { $script:LockHandle.Dispose() } catch { } }
  $script:LockHandle = $null; $script:LockDepth = 0; $script:LockStep = ''
  $script:TakeoverPending = $false; $script:IsRelaunched = $false; $script:LauncherStale = $false; $script:RelaunchExitCode = 0
  $script:RelaunchTakeoverSeconds = 60; $script:UpdateResult = $null; $script:AddedMigrations = 0
  foreach ($relaunchName in @('RelaunchToken','RelaunchFromSha','RelaunchToSha','RelaunchLauncherHash')) { Set-Variable -Scope Script -Name $relaunchName -Value '' }
  $script:LockObs = New-Object 'Collections.Generic.List[object]'
  $script:NpmCwds = New-Object 'Collections.Generic.List[string]'
  $script:IdentityFault = $false
  $script:GitFaults = @{}; $script:GitCalls = New-Object 'Collections.Generic.List[string]'
  $script:SpawnedArguments = $null; $script:SpawnObservations = $null; $script:UseRealSpawn = $false; $script:FakeChild = $null; $script:SpawnThrows = $false
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
  $script:NpmCiFails = $false; $script:BackendStarts = 0
  # M00.03: a fresh, empty fake operating system for every test; fast timers so a refused/timed-out wait costs ~1 second.
  $script:FakeProcs = @{}; $script:FakeListeners = @(); $script:FakePidCounter = 40000; $script:StopCalls = New-Object 'Collections.Generic.List[int]'
  $script:ProcessReadFails = $false; $script:ListenersUnreadable = $false; $script:StopThrows = $false; $script:StopIgnored = $false
  $script:StartThrows = $false; $script:StartVanishes = $false; $script:StartListens = $true; $script:StartScript = ''; $script:StartHook = $null
  $script:StartReplacedBy = ''; $script:DetailsHook = $null; $script:StopMode = ''
  $script:BuildFails = $false; $script:BuildNoOutput = $false; $script:BuildHook = $null; $script:BuildContent = 'console.log("build one");'
  $script:HealthMode = 'ok'; $script:MigrateAliveProcesses = -1
  # M00.05
  $script:AppReadySeconds = 1; $script:AppPollMilliseconds = 10
  $script:ClientChecks = New-Object 'Collections.Generic.List[string]'; $script:Events = New-Object 'Collections.Generic.List[string]'
  $script:AppBuilds = New-Object 'Collections.Generic.List[string]'; $script:AppStarts = New-Object 'Collections.Generic.List[string]'; $script:Browser = New-Object 'Collections.Generic.List[string]'
  $script:CertMode = 'ok'; $script:CertSawComposeUp = -1; $script:CertSawLock = $null; $script:ProbeMode = 'ok'; $script:ProbeCount = 0
  $script:AppBuildFails = $false; $script:AppBuildNoOutput = $false; $script:AppManifestMode = ''; $script:AppManifestSha = ''; $script:AppBuildContent = 'app build one'
  $script:AppStartListens = $true; $script:AppStartVanishes = $false; $script:AppStartThrows = $false
  # M00.08
  $script:SystemCount = '1'
  $env:SHIP11_NO_BROWSER = $null
  $script:BackendPollMilliseconds = 10; $script:BackendReadySeconds = 1; $script:ProcessStopSeconds = 1
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
$callerFolder = Join-Path $tempRoot 'harness caller'
New-Item -ItemType Directory -Force -Path $callerFolder | Out-Null
$script:SandboxIndex = 0
$script:FakeNodeExe = Join-Path (Join-Path $tempRoot 'fake node') 'node.exe'
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
  Initialize-LauncherPaths $Repo
  # The code this process 'loaded' is the code of this checkout (the sandbox copy of the launcher), as in a real launch.
  $script:LoadedLauncherHash = File-HashOrEmpty $script:LauncherPath
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
  Write-Text (Join-Path $script:Seed '.gitignore') ".env`nnode_modules/`n.11ship-local/`napps/backend/dist/`napps/food-web/dist/`napps/ship-web/dist/`napps/admin-web/dist/`n"
  Write-Text (Join-Path $script:Seed 'package-lock.json') '{"lockfileVersion":3,"revision":1}'
  Write-Text (Join-Path $script:Seed 'database/migrations/1000_first.sql') 'SELECT 1;'
  Write-Text (Join-Path $script:Seed 'database/migrations/2000_second.sql') 'SELECT 2;'
  # M00.02: the checkout carries its own copy of the launcher (the file the hand-over compares) and the test harness.
  New-Item -ItemType Directory -Force -Path (Join-Path $script:Seed 'tools/local') | Out-Null
  Copy-Item -LiteralPath $scriptPath -Destination (Join-Path $script:Seed 'tools/local/11ship-launcher.ps1')
  Copy-Item -LiteralPath $harnessScript -Destination (Join-Path $script:Seed 'tools/local/relaunch-harness.ps1')
  Copy-Item -LiteralPath $identityHarnessScript -Destination (Join-Path $script:Seed 'tools/local/identity-harness.ps1')
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
# M00.02: upstream changes the launcher file itself (a comment plus a marker the harness prints).
function Push-UpstreamLauncher([string]$Marker) {
  $path = Join-Path $script:Seed 'tools/local/11ship-launcher.ps1'
  [IO.File]::AppendAllText($path, "`n# upstream launcher change $Marker`n`$script:TestMarker = '$Marker'`n")
  Invoke-Git $script:Seed @('add','-A') | Out-Null
  Invoke-Git $script:Seed @('commit','-m',"upstream launcher $Marker") | Out-Null
  Invoke-Git $script:Seed @('push','origin','main') | Out-Null
}
# Upstream adds a file that .gitignore hides in the owner's copy (git add -f), the way a tracked .env would.
function Push-UpstreamIgnored([string]$RelativePath,[string]$Text) {
  Write-Text (Join-Path $script:Seed $RelativePath) $Text
  Invoke-Git $script:Seed @('add','-f',$RelativePath) | Out-Null
  Invoke-Git $script:Seed @('commit','-m',"upstream ignored $RelativePath") | Out-Null
  Invoke-Git $script:Seed @('push','origin','main') | Out-Null
}
function Head { return Invoke-Git $script:Repo @('rev-parse','HEAD') }
function Write-UatPin([string]$Text) { Write-Text $script:UatPinFile $Text }
# Real child processes (lock holders, probes, launchers): arguments are quoted by hand because Windows PowerShell 5.1
# joins Start-Process arguments without quoting them.
function Quote-Arg([string]$Value) {
  if ($Value -match '[\s"]') { return '"' + $Value.Replace('"', '\"') + '"' }
  return $Value
}
function Start-Helper([string]$HelperScript,[string[]]$HelperArgs,[string]$StdinFile='') {
  # -NonInteractive makes Read-Host fail even with redirected input, so a helper that reads answers (the menu) runs without it.
  $parts = @('-NoProfile')
  if (!$StdinFile) { $parts += '-NonInteractive' }
  $parts += @('-ExecutionPolicy','Bypass','-File',(Quote-Arg $HelperScript)) + @($HelperArgs | ForEach-Object { Quote-Arg $_ })
  $stem = Join-Path $tempRoot ('helper-' + [Guid]::NewGuid().ToString('N'))
  $params = @{ FilePath = $psExe; ArgumentList = $parts; PassThru = $true; RedirectStandardOutput = "$stem.out"; RedirectStandardError = "$stem.err" }
  if ($StdinFile) { $params['RedirectStandardInput'] = $StdinFile }
  if ($onWindows) { $params['WindowStyle'] = 'Hidden' }
  $process = Start-Process @params
  $null = $process.Handle   # without a cached handle ExitCode stays empty for a process started with -PassThru
  $process | Add-Member -NotePropertyName OutFile -NotePropertyValue "$stem.out"
  $process | Add-Member -NotePropertyName ErrFile -NotePropertyValue "$stem.err"
  return $process
}
function Get-HelperText($Process) {
  $text = ''
  foreach ($file in @($Process.OutFile, $Process.ErrFile)) { if (Test-Path -LiteralPath $file) { $text += (Get-Content -Raw -LiteralPath $file) } }
  return "$text"
}
function Start-LockHolder([string]$Id,[string]$Step,[int]$HoldMs,[string]$ReadyFile='',[string]$EventFile='',[int]$StartDelayMs=0) {
  $holderArgs = @('-Launcher',$script:LauncherPath,'-Id',$Id,'-Step',$Step,'-HoldMs',"$HoldMs",'-StartDelayMs',"$StartDelayMs")
  if ($ReadyFile) { $holderArgs += @('-ReadyFile',$ReadyFile) }
  if ($EventFile) { $holderArgs += @('-EventFile',$EventFile) }
  return (Start-Helper $lockHolderScript $holderArgs)
}
function Wait-ForFile([string]$Path,[int]$Seconds=90) {
  $until = [DateTime]::UtcNow.AddSeconds($Seconds)
  while (!(Test-Path -LiteralPath $Path) -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 100 }
  return (Test-Path -LiteralPath $Path)
}
function Read-Events([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return @() }
  return @(Get-Content -LiteralPath $Path | Where-Object { $_ } | ForEach-Object { $f = $_.Split(' '); [pscustomobject]@{ Ticks = [int64]$f[0]; Id = $f[1]; What = $f[2] } } | Sort-Object Ticks)
}
# Runs the sandbox's own copy of the harness as a real launcher process from ANOTHER working folder; returns code + text.
function Invoke-Harness([string[]]$Arguments) {
  $harness = Join-Path (Join-Path (Join-Path $script:Repo 'tools') 'local') 'relaunch-harness.ps1'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'   # Windows PowerShell 5.1 turns native stderr into an error under 'Stop'
  Push-Location -LiteralPath $callerFolder
  try {
    $text = (& $psExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $harness @Arguments 2>&1 | Out-String)
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = $text }
  } finally { Pop-Location; $ErrorActionPreference = $previous }
}
function Read-HarnessCalls {
  $path = Join-Path $script:StateDir 'harness-calls.log'
  if (!(Test-Path -LiteralPath $path)) { return @() }
  return @(Get-Content -LiteralPath $path | Where-Object { $_ } | ForEach-Object {
    $m = [regex]::Match($_, '^(\d+) pid=(\d+) (.*)$')
    [pscustomobject]@{ Ticks = [int64]$m.Groups[1].Value; ProcessId = [int]$m.Groups[2].Value; Text = $m.Groups[3].Value }
  })
}
function Record-Install {
  New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
  Write-Text $script:InstallState (File-HashOrEmpty (Join-Path $script:Repo 'package-lock.json'))
}
$nodeApp = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
function Start-IdleNode {
  if ($onWindows) { return Start-Process -FilePath $nodeApp.Source -ArgumentList @('-e','setTimeout(function(){},120000)') -PassThru -WindowStyle Hidden }
  return Start-Process -FilePath $nodeApp.Source -ArgumentList @('-e','setTimeout(function(){},120000)') -PassThru
}
# A checkout that is ready for Start: dependencies recorded, DEV database fully migrated.
function New-StartSandbox { New-GitSandbox; Record-Install; $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles) }
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
  Check (@($script:HostLog | Where-Object { $_.Contains('(fast-forward)') }).Count -eq 0) 'failed Update never announces completion'

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
  Section 'M00.03 Start: a recorded backend is reused only when it is proven ours, current and healthy'
  # =============================================================================================
  New-StartSandbox
  $startedBefore = $script:BackendStarts
  Start-Launcher | Out-Null
  $record = (Read-TargetRegistry (Get-BackendTarget)).Record
  $manifestRead = Read-BuildManifest (Get-BackendTarget)
  Check ($script:BackendStarts -eq 1) 'first Start starts exactly one backend'
  Check ($manifestRead.State -eq 'OK' -and $manifestRead.Manifest.app_id -ceq 'BACKEND' -and $manifestRead.Manifest.source_sha -ceq (Head) -and $manifestRead.Manifest.design_version -ceq '2.0.1') 'the build manifest names the app, the exact HEAD and the design version'
  Check ($manifestRead.Manifest.build_fingerprint -cmatch '^[0-9a-f]{64}$') 'the manifest carries a 64-hex build fingerprint'
  Check ($record -and $record.app_id -ceq 'BACKEND' -and $record.schema -eq 1 -and $record.source_sha -ceq (Head) -and $record.build_fingerprint -ceq $manifestRead.Manifest.build_fingerprint) 'the process registry records the source SHA and the fingerprint of the artifact it was started from'
  Check ($record.repo -ceq $script:Repo -and $record.script -ceq $script:BackendScript -and $record.host -ceq '127.0.0.1' -and $record.port -eq 3000) 'the registry records checkout, absolute script, host and port'
  Check ($script:FakeProcs.ContainsKey([int]$record.pid) -and $record.started_utc -ceq $script:FakeProcs[[int]$record.pid].StartUtc) 'the registry records the exact start time of the process it started'
  Check (@($script:LockObs | Where-Object { $_.What -eq 'npm run build' -and $_.Held }).Count -eq 1 -and @($script:LockObs | Where-Object { $_.What -eq 'backend start' -and $_.Held }).Count -eq 1) 'build and process start both ran while the shared lock was held'
  Check ((Get-OwnedBackendProcess).Id -eq [int]$record.pid) 'ownership: the recorded process is proven ours'
  $firstPid = [int]$record.pid
  $buildsBefore = NpmCount 'run build'

  # Repeated Start: same source, same artifact, healthy process -> reuse; no second backend, no kill.
  Start-Launcher | Out-Null
  $again = (Read-TargetRegistry (Get-BackendTarget)).Record
  Check ($script:BackendStarts -eq 1 -and $script:StopCalls.Count -eq 0) 'repeated Start with the same artifact reuses the running backend (no second start, nothing stopped)'
  Check ((NpmCount 'run build') -eq $buildsBefore + 1) 'repeated Start still rebuilds, so a changed artifact can never be missed'
  Check ([int]$again.pid -eq $firstPid -and $again.started_utc -ceq $record.started_utc) 'the registry still names the same process'

  # Changed artifact (same source): the launcher-owned process is replaced, nothing else is touched.
  $bystander = 7001
  Add-FakeProcess $bystander ([DateTime]::UtcNow.ToString('o')) '' @($script:FakeNodeExe, 'other-project.js')
  $script:BuildContent = 'console.log("build two");'
  Start-Launcher | Out-Null
  $replaced = (Read-TargetRegistry (Get-BackendTarget)).Record
  $newManifest = (Read-BuildManifest (Get-BackendTarget)).Manifest
  Check ($script:BackendStarts -eq 2 -and $script:StopCalls.Count -eq 1 -and $script:StopCalls[0] -eq $firstPid) 'a different artifact fingerprint restarts exactly the recorded process'
  Check ($script:FakeProcs.ContainsKey($bystander) -and $script:StopCalls -notcontains $bystander) 'an unrelated node process is never touched'
  Check ([int]$replaced.pid -ne $firstPid -and $replaced.build_fingerprint -ceq $newManifest.build_fingerprint -and !$script:FakeProcs.ContainsKey($firstPid)) 'the registry now names the new process and the new fingerprint; the old process is gone'
  Check (@($script:LockObs | Where-Object { $_.What -like 'backend stop*' -and !$_.Held }).Count -eq 0) 'the stop happened under the shared lock'

  # Same fingerprint but a different source SHA (a new commit with identical build output) is still "an older version".
  $script:BuildContent = 'console.log("build two");'
  Push-Upstream 'docs/note.md' 'new commit'
  Update-Launcher | Out-Null
  $oldNotice = @($script:HostLog | Where-Object { $_.Contains('BACKEND_RUNNING_OLD_VERSION') })
  Check ($oldNotice.Count -eq 1 -and $script:StopCalls.Count -eq 1 -and $script:BackendStarts -eq 2) 'Update with a running older backend warns BACKEND_RUNNING_OLD_VERSION and stops/starts nothing'
  Check (@($script:HostLog | Where-Object { $_.Contains('(fast-forward). Update') }).Count -eq 1) 'Update says it moved the source only (no claim that the new version is running)'
  Check ((Read-TargetRegistry (Get-BackendTarget)).Record.source_sha -cne (Head)) 'the registry still says which (older) commit the process was built from'
  Start-Launcher | Out-Null
  $afterUpdate = (Read-TargetRegistry (Get-BackendTarget)).Record
  Check ($script:BackendStarts -eq 3 -and $script:StopCalls.Count -eq 2 -and $afterUpdate.source_sha -ceq (Head)) 'Start after Update replaces the backend with one built from the new commit even though the fingerprint is the same'
  $script:HostLog.Clear()
  Update-Launcher | Out-Null
  Check (@($script:HostLog | Where-Object { $_.Contains('BACKEND_RUNNING_OLD_VERSION') }).Count -eq 0) 'no old-version warning when the running backend was built from HEAD'

  # Health mismatch on an otherwise proven process: restart, then still fail when the new one is unhealthy as well.
  $script:HealthMode = 'wrongbody'
  $stopsBefore = $script:StopCalls.Count
  Expect-Fail 'BACKEND_NOT_READY' 'HTTP 200 with the wrong body is not ready (restart attempted, then refused)' { Start-Launcher }
  Check ($script:StopCalls.Count -eq $stopsBefore + 1) 'a proven but unhealthy backend was restarted (only that process)'
  foreach ($mode in @('ready503','html','never')) {
    New-StartSandbox
    $script:HealthMode = $mode
    Expect-Fail 'BACKEND_NOT_READY' "health mode '$mode' never counts as ready" { Start-Launcher }
  }

  # =============================================================================================
  Section 'M00.03 identity: PID reuse, a process that is not ours, metadata that is missing/old/corrupt'
  # =============================================================================================
  function Write-RegistryFor([int]$ProcessId,[string]$StartUtc,[hashtable]$Override=@{}) {
    $fields = [ordered]@{
      schema = 1; app_id = 'BACKEND'; pid = $ProcessId; started_utc = $StartUtc; repo = $script:Repo; executable = $script:FakeNodeExe
      script = $script:BackendScript; host = '127.0.0.1'; port = 3000; source_sha = (Head); build_fingerprint = ('b' * 64)
      built_at = [DateTime]::UtcNow.ToString('o'); design_version = '2.0.1'
    }
    foreach ($key in @($Override.Keys)) { if ($null -eq $Override[$key]) { $fields.Remove($key) } else { $fields[$key] = $Override[$key] } }
    Write-Text $script:StateFile ($fields | ConvertTo-Json)
  }
  function Assert-StartRefused([string]$Name,[string]$Code) {
    $registryBefore = if (Test-Path -LiteralPath $script:StateFile -PathType Leaf) { File-HashOrEmpty $script:StateFile } else { 'directory' }
    $processesBefore = $script:FakeProcs.Count
    Expect-Fail $Code "$Name -> Start" { Start-Launcher }
    $registryAfter = if (Test-Path -LiteralPath $script:StateFile -PathType Leaf) { File-HashOrEmpty $script:StateFile } else { 'directory' }
    Check ((NpmCount 'run build') -eq 0 -and (NpmCount 'run db:migrate') -eq 0 -and $script:BackendStarts -eq 0 -and $script:StopCalls.Count -eq 0) "$Name`: nothing was built, migrated, started or stopped"
    Check ($script:FakeProcs.Count -eq $processesBefore -and $registryAfter -eq $registryBefore) "$Name`: every process and the state file are exactly as before"
    Check (!(Test-Path -LiteralPath $script:BackendManifestFile)) "$Name`: no manifest was written"
  }
  function Assert-StopRefused([string]$Name) {
    $script:DockerCalls.Clear()
    Expect-Fail 'PROCESS_IDENTITY_UNVERIFIED' "$Name -> Stop" { Stop-Launcher }
    Check ($script:StopCalls.Count -eq 0 -and @($script:DockerCalls | Where-Object { $_ -match 'compose.* stop ' }).Count -eq 0) "$Name`: Stop killed nothing and stopped no database"
  }
  $liveStart = [DateTime]::UtcNow.ToString('o')
  $badRegistries = [ordered]@{
    'legacy state from the previous launcher (pid + startedUtc only)' = { Write-Text $script:StateFile ('{"pid":7100,"startedUtc":"' + $liveStart + '"}') }
    'registry that is not JSON' = { Write-Text $script:StateFile '{ not json' }
    'empty registry file' = { Write-Text $script:StateFile '' }
    'registry holding a JSON array' = { Write-Text $script:StateFile '[1,2,3]' }
    'registry without build_fingerprint' = { Write-RegistryFor 7100 $liveStart @{ build_fingerprint = $null } }
    'registry with a text pid' = { Write-RegistryFor 7100 $liveStart @{ pid = 'seven' } }
    'registry with another app_id' = { Write-RegistryFor 7100 $liveStart @{ app_id = 'ADMIN' } }
    'registry with a short source_sha' = { Write-RegistryFor 7100 $liveStart @{ source_sha = 'abc123' } }
    'registry with an unknown schema' = { Write-RegistryFor 7100 $liveStart @{ schema = 9 } }
    'registry of another checkout' = { Write-RegistryFor 7100 $liveStart @{ repo = (Join-Path $tempRoot 'some other checkout') } }
    'registry for another script' = { Write-RegistryFor 7100 $liveStart @{ script = (Join-Path $tempRoot 'other\dist\main.js') } }
    'registry for another port' = { Write-RegistryFor 7100 $liveStart @{ port = 3001 } }
    'registry that cannot be read (a folder in its place)' = { New-Item -ItemType Directory -Force -Path $script:StateFile | Out-Null }
  }
  foreach ($label in @($badRegistries.Keys)) {
    New-StartSandbox
    # A live node process that happens to be on the port and has the PID the (bad) registry names.
    Add-FakeProcess 7100 $liveStart
    Add-FakeListener '127.0.0.1' 7100
    & $badRegistries[$label]
    Assert-StartRefused $label 'PROCESS_IDENTITY_UNVERIFIED'
    Assert-StopRefused $label
    Check ($script:FakeProcs.ContainsKey(7100)) "$label`: the live process is still alive"
    Check ($script:HttpCalls.Count -eq 0) "$label`: no HTTP answer was used as evidence"
    $status = @(Get-BackendIdentityLines (Head)) -join "`n"
    Check ($status.Contains('PROCESS_IDENTITY_UNVERIFIED')) "$label`: Status reports PROCESS_IDENTITY_UNVERIFIED"
    if (Test-Path -LiteralPath $script:StateFile -PathType Container) { Remove-Item -LiteralPath $script:StateFile -Recurse -Force }
  }

  # PID reused: the recorded PID is alive but started at another time -> the recorded process is gone (STALE), the new owner of the PID is not touched.
  New-StartSandbox
  Add-FakeProcess 7200 ([DateTime]::UtcNow.ToString('o'))
  Write-RegistryFor 7200 '2001-01-01T00:00:00.0000000Z'
  Check ((Get-TargetOwnership (Get-BackendTarget)).Status -eq 'STALE') 'PID reuse (other start time) is STALE, not owned'
  Start-Launcher | Out-Null
  Check ($script:BackendStarts -eq 1 -and $script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey(7200)) 'stale record: Start launches its own backend and never kills the process that now has that PID'
  Check ((Read-TargetRegistry (Get-BackendTarget)).Record.pid -ne 7200) 'the registry no longer names the reused PID'

  # PID alive, same start time, but it is not node / not our script.
  $now = [DateTime]::UtcNow.ToString('o')
  $impostors = [ordered]@{
    'a non-node process with the recorded start time' = { Add-FakeProcess 7300 $now (Join-Path $tempRoot 'powershell.exe') @((Join-Path $tempRoot 'powershell.exe'), '-NoProfile') $true 'powershell' }
    'node running another project script' = { Add-FakeProcess 7300 $now '' @($script:FakeNodeExe, '--env-file-if-exists=.env', (Join-Path $tempRoot 'other project\apps\backend\dist\main.js')) }
    'node with no script argument' = { Add-FakeProcess 7300 $now '' @($script:FakeNodeExe) }
    'node from another install than the recorded executable' = { Add-FakeProcess 7300 $now (Join-Path $tempRoot 'elsewhere\node.exe') @((Join-Path $tempRoot 'elsewhere\node.exe'), $script:BackendScript) }
  }
  foreach ($label in @($impostors.Keys)) {
    New-StartSandbox
    & $impostors[$label]
    Add-FakeListener '127.0.0.1' 7300
    Write-RegistryFor 7300 $now
    Assert-StartRefused $label 'PROCESS_IDENTITY_UNVERIFIED'
    Assert-StopRefused $label
    Check ($script:FakeProcs.ContainsKey(7300)) "$label`: not killed"
  }
  # Review F1: a process that EXISTS but cannot be inspected is an unknown identity - neither ours nor proven gone.
  foreach ($withListener in @($false, $true)) {
    $where = if ($withListener) { 'holding the port' } else { 'with the port free' }
    New-StartSandbox
    Add-FakeProcess 7400 '' '' @() $false 'System'
    if ($withListener) { Add-FakeListener '127.0.0.1' 7400 }
    Write-RegistryFor 7400 $now
    Check ((Get-TargetOwnership (Get-BackendTarget)).Status -eq 'UNVERIFIED') "F1: an existing process that cannot be inspected is UNVERIFIED, not STALE ($where)"
    Assert-StartRefused "F1: uninspectable recorded process $where" 'PROCESS_IDENTITY_UNVERIFIED'
    Assert-StopRefused "F1: uninspectable recorded process $where"
    Check ((Test-Path -LiteralPath $script:StateFile -PathType Leaf) -and $script:FakeProcs.ContainsKey(7400)) "F1: the registry is retained and the process untouched ($where)"
    Check ((Get-BackendIdentityLines (Head)) -join ' ' -match 'PROCESS_IDENTITY_UNVERIFIED') "F1: Status reports it ($where)"
  }
  # The recorded process has ended: Start replaces the record; Stop only cleans it up.
  New-StartSandbox
  Write-RegistryFor 7500 $now
  $script:DockerCalls.Clear()
  Set-Variable -Scope Script -Name KeepDatabases -Value $true
  Stop-Launcher | Out-Null
  Check ($script:StopCalls.Count -eq 0 -and !(Test-Path -LiteralPath $script:StateFile)) 'Stop with a record of an ended process kills nothing and removes the record'
  Write-RegistryFor 7500 $now
  Start-Launcher | Out-Null
  Check ($script:BackendStarts -eq 1 -and $script:StopCalls.Count -eq 0 -and (Read-TargetRegistry (Get-BackendTarget)).Record.pid -ne 7500) 'Start with a record of an ended process starts one backend and records it'
  # The operating system cannot answer about processes: not "gone", not "ours".
  New-StartSandbox
  Write-RegistryFor 7600 $now
  $script:ProcessReadFails = $true
  Assert-StartRefused 'process list unreadable' 'PROCESS_IDENTITY_UNVERIFIED'
  Assert-StopRefused 'process list unreadable'

  # =============================================================================================
  Section 'M00.03 port: a foreign process on the port is refused, also when it answers HTTP 200'
  # =============================================================================================
  foreach ($address in @('127.0.0.1','0.0.0.0','::','::1')) {
    New-StartSandbox
    Add-FakeProcess 7700 $now '' @($script:FakeNodeExe, 'some-other-server.js')
    Add-FakeListener $address 7700
    Expect-Fail 'PORT_IN_USE' "foreign listener on $address (it even answers the health URLs with 200 and the right body)" { Start-Launcher }
    Check ((NpmCount 'run build') -eq 0 -and $script:BackendStarts -eq 0 -and $script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey(7700)) "foreign listener on $address`: no build, no start, nothing stopped"
    Check ($script:HttpCalls.Count -eq 0 -and !(Test-Path -LiteralPath $script:StateFile)) "foreign listener on $address`: HTTP was not used as proof and nothing was recorded"
    Set-Variable -Scope Script -Name KeepDatabases -Value $true
    Stop-Launcher | Out-Null
    Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey(7700)) "foreign listener on $address`: Stop without a record kills nothing"
  }
  New-StartSandbox
  Add-FakeProcess 7710 $now '' @($script:FakeNodeExe, 'some-other-server.js')
  Add-FakeListener '192.168.1.20' 7710
  Start-Launcher | Out-Null
  Check ($script:BackendStarts -eq 1) 'a listener bound to a LAN address only does not block 127.0.0.1:3000'
  # Our own process plus a foreign listener on the same port.
  New-StartSandbox
  Start-Launcher | Out-Null
  $ours = [int](Read-TargetRegistry (Get-BackendTarget)).Record.pid
  Add-FakeProcess 7720 $now '' @($script:FakeNodeExe, 'intruder.js')
  Add-FakeListener '0.0.0.0' 7720
  $buildsBefore = NpmCount 'run build'
  Expect-Fail 'PORT_IN_USE' 'our process plus a foreign listener on the same port is refused' { Start-Launcher }
  Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey($ours) -and $script:FakeProcs.ContainsKey(7720) -and (NpmCount 'run build') -eq $buildsBefore) 'neither our backend nor the intruder was stopped, and nothing was rebuilt'
  # The port owner cannot be read: never "free".
  New-StartSandbox
  $script:ListenersUnreadable = $true
  Expect-Fail 'PORT_OWNER_UNREADABLE' 'unreadable port owner is a refusal, not a free port' { Start-Launcher }
  Check ((NpmCount 'run build') -eq 0 -and $script:BackendStarts -eq 0) 'unreadable port owner: nothing built or started'
  $script:HostLog.Clear()
  $statusText = @(Get-BackendIdentityLines (Head)) -join "`n"
  Check ($statusText.Contains('PORT_OWNER_UNREADABLE')) 'Status reports the unreadable port owner'
  # Wait-Backend itself: the right process is alive but another process holds the port and answers perfectly.
  New-StartSandbox
  Add-FakeProcess 7800 $now
  Add-FakeProcess 7810 $now '' @($script:FakeNodeExe, 'intruder.js')
  Add-FakeListener '127.0.0.1' 7810
  Expect-Fail 'PORT_IN_USE' 'Wait-Backend: an answer from a different process than the one we started is not ready' { Wait-Backend (Get-BackendTarget) 7800 $now }
  Remove-FakeProcess 7810
  Expect-Fail 'BACKEND_NOT_READY' 'Wait-Backend: the process does not listen yet -> not ready' { Wait-Backend (Get-BackendTarget) 7800 $now }
  Add-FakeListener '127.0.0.1' 7800
  Wait-Backend (Get-BackendTarget) 7800 $now
  Check $true 'Wait-Backend: the right process holds the port and both health bodies match -> ready'
  Expect-Fail 'BACKEND_NOT_READY' 'Wait-Backend: the process has another start time (PID reused) -> not ready' { Wait-Backend (Get-BackendTarget) 7800 '2001-01-01T00:00:00.0000000Z' }

  # =============================================================================================
  Section 'M00.03 Stop: only the recorded, proven process, only that PID'
  # =============================================================================================
  New-StartSandbox
  Start-Launcher | Out-Null
  $ours = [int](Read-TargetRegistry (Get-BackendTarget)).Record.pid
  Add-FakeProcess 7900 $now '' @($script:FakeNodeExe, 'bystander-a.js')
  Add-FakeProcess 7901 $now '' @($script:FakeNodeExe, '--env-file-if-exists=.env', (Join-Path $tempRoot 'copy of repo\apps\backend\dist\main.js'))
  Add-FakeListener '127.0.0.1' 7901 8080
  Set-Variable -Scope Script -Name KeepDatabases -Value $true
  Stop-Launcher | Out-Null
  Check ($script:StopCalls.Count -eq 1 -and $script:StopCalls[0] -eq $ours -and !$script:FakeProcs.ContainsKey($ours)) 'Stop ends exactly the recorded process'
  Check ($script:FakeProcs.ContainsKey(7900) -and $script:FakeProcs.ContainsKey(7901)) 'other node processes (even another checkout''s backend) are left running'
  Check (!(Test-Path -LiteralPath $script:StateFile) -and @($script:LockObs | Where-Object { $_.What -eq "backend stop $ours" -and $_.Held }).Count -eq 1) 'the registry was removed after the stop, and the stop ran under the shared lock'
  Stop-Launcher | Out-Null
  Check ($script:StopCalls.Count -eq 1) 'a second Stop finds nothing to stop and kills nothing'
  Set-Variable -Scope Script -Name KeepDatabases -Value $false
  Start-Launcher | Out-Null
  $script:DockerCalls.Clear()
  Stop-Launcher | Out-Null
  Check (@($script:DockerCalls | Where-Object { $_.EndsWith(' stop db-dev db-test') }).Count -eq 1) 'Stop without -KeepDatabases still stops the databases (volume kept)'

  # The stop is re-proven right before the kill: the PID may have been reused since the first look.
  New-StartSandbox
  Start-Launcher | Out-Null
  $target = Get-BackendTarget
  $ownership = Get-TargetOwnership $target
  $ownedPid = [int]$ownership.Registry.pid
  Check ($ownership.Status -eq 'OWNED') 'precondition: the backend is owned'
  Add-FakeProcess $ownedPid '2001-01-01T00:00:00.0000000Z'
  $script:StopCalls.Clear()
  Use-LaunchLock 'test' { Stop-TargetProcess $target $ownership }
  Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey($ownedPid) -and !(Test-Path -LiteralPath $script:StateFile)) 'PID reused between the check and the kill: nothing is killed, the old record is dropped'
  New-StartSandbox
  Start-Launcher | Out-Null
  $ownership = Get-TargetOwnership (Get-BackendTarget)
  $ownedPid = [int]$ownership.Registry.pid
  Add-FakeProcess $ownedPid $ownership.Registry.started_utc (Join-Path $tempRoot 'powershell.exe') @((Join-Path $tempRoot 'powershell.exe'), '-NoProfile')
  $script:StopCalls.Clear()
  Expect-Fail 'PROCESS_IDENTITY_UNVERIFIED' 'same PID and start time but no longer our node -> refused at the last moment' { Use-LaunchLock 'test' { Stop-TargetProcess (Get-BackendTarget) $ownership } }
  Check ($script:StopCalls.Count -eq 0 -and (Test-Path -LiteralPath $script:StateFile)) 'nothing killed and the record is kept for the Owner to look at'
  # Stop that fails or does not take effect keeps the record and never escalates.
  New-StartSandbox
  Start-Launcher | Out-Null
  $script:StopThrows = $true
  Expect-Fail 'PROCESS_STOP_FAILED' 'a refused stop is reported' { Stop-Launcher }
  Check ((Test-Path -LiteralPath $script:StateFile) -and $script:StopCalls.Count -eq 1) 'refused stop: record kept, one attempt only'
  $script:StopThrows = $false; $script:StopIgnored = $true; $script:StopCalls.Clear()
  Expect-Fail 'PROCESS_STOP_FAILED' 'a process that keeps running after the stop is reported' { Stop-Launcher }
  Check ((Test-Path -LiteralPath $script:StateFile) -and $script:StopCalls.Count -eq 1) 'process still running: record kept, no escalation to another PID'

  # =============================================================================================
  Section 'M00.03 migration: the launcher-owned old backend is stopped only after the Owner confirmed'
  # =============================================================================================
  New-StartSandbox
  Start-Launcher | Out-Null
  $ours = [int](Read-TargetRegistry (Get-BackendTarget)).Record.pid
  Push-Upstream 'database/migrations/3000_third.sql' 'SELECT 3;'
  Update-Launcher | Out-Null
  $script:DbApplied = @('1000_first','2000_second'); $script:Answers.Enqueue('n')
  $script:StopCalls.Clear()
  Expect-Fail 'MIGRATION_DECLINED' 'declined migration with a backend running' { Start-Launcher }
  Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey($ours) -and (NpmCount 'run db:migrate') -eq 0) 'declined: the running backend stays up and nothing is migrated'
  $script:Answers.Enqueue('y')
  Start-Launcher | Out-Null
  Check ($script:StopCalls.Count -eq 1 -and $script:StopCalls[0] -eq $ours) 'accepted: the old backend is stopped'
  Check ($script:MigrateAliveProcesses -eq 0) 'the old backend was already stopped when db:migrate ran (it never serves a schema it was not built for)'
  Check ((Read-TargetRegistry (Get-BackendTarget)).Record.source_sha -ceq (Head) -and $script:FakeProcs.Count -eq 1) 'a new backend built from the new commit is recorded and is the only one'

  # =============================================================================================
  Section 'M00.03 build, start and state errors'
  # =============================================================================================
  New-StartSandbox
  Start-Launcher | Out-Null
  $before = Read-TargetRegistry (Get-BackendTarget)
  $oldManifestText = File-HashOrEmpty $script:BackendManifestFile
  Check ($oldManifestText -ne '') 'precondition: a manifest exists'
  $script:BuildFails = $true; $script:BuildContent = 'broken'
  $startsBefore = $script:BackendStarts; $script:StopCalls.Clear()
  Expect-Fail 'APP_BUILD_FAILED' 'build failure' { Start-Launcher }
  Check (!(Test-Path -LiteralPath $script:BackendManifestFile)) 'a failed build leaves no manifest (no old fingerprint can be mistaken for the new build)'
  Check ($script:BackendStarts -eq $startsBefore -and $script:StopCalls.Count -eq 0 -and (Get-OwnedBackendProcess).Id -eq [int]$before.Record.pid) 'a failed build does not touch the running backend'
  Check ((Read-TargetRegistry (Get-BackendTarget)).Record.build_fingerprint -ceq $before.Record.build_fingerprint -and (NpmCount 'run db:migrate') -eq 0) 'the registry still describes the (old) running build and no migration ran'
  $script:BuildFails = $false; $script:BuildNoOutput = $true
  Remove-Item -LiteralPath $script:BackendDist -Recurse -Force
  Expect-Fail 'APP_BUILD_FAILED' 'build that reports success but produces no entry script' { Start-Launcher }
  Check (!(Test-Path -LiteralPath $script:BackendManifestFile)) 'no manifest without a build output'
  $script:BuildNoOutput = $false
  # A manifest that cannot be written.
  $script:BuildHook = { New-Item -ItemType Directory -Force -Path $script:BackendManifestFile | Out-Null }
  Expect-Fail 'STATE_WRITE_FAILED' 'manifest that cannot be written' { Start-Launcher }
  Check (@(Get-ChildItem -LiteralPath $script:BackendDist -Filter '*.tmp' -ErrorAction SilentlyContinue).Count -eq 0) 'no temporary file is left behind'
  Remove-Item -LiteralPath $script:BackendManifestFile -Recurse -Force -ErrorAction SilentlyContinue
  $script:BuildHook = $null
  # The process cannot be started / does not look like what we asked for / vanishes.
  New-StartSandbox
  $script:StartThrows = $true
  Expect-Fail 'BACKEND_START_FAILED' 'node cannot be started' { Start-Launcher }
  Check (!(Test-Path -LiteralPath $script:StateFile)) 'no registry for a process that never started'
  New-StartSandbox
  $script:StartVanishes = $true
  Expect-Fail 'BACKEND_NOT_READY' 'the new process is gone before it can be recorded' { Start-Launcher }
  Check (!(Test-Path -LiteralPath $script:StateFile)) 'no registry for a vanished process'
  New-StartSandbox
  $script:StartScript = (Join-Path $tempRoot 'somewhere else\main.js')
  Expect-Fail 'BACKEND_NOT_READY' 'a process that is not node running this checkout''s script is not accepted' { Start-Launcher }
  Check ($script:StopCalls.Count -eq 1 -and $script:FakeProcs.Count -eq 0 -and !(Test-Path -LiteralPath $script:StateFile)) 'the unexpected process the launcher itself just created is stopped (by that PID) and nothing is recorded'
  New-StartSandbox
  $script:StartListens = $false
  Expect-Fail 'BACKEND_NOT_READY' 'a started process that never listens' { Start-Launcher }
  Check ((Get-TargetOwnership (Get-BackendTarget)).Status -eq 'OWNED') 'it stays recorded (proven ours) so the next Start can replace it'
  $stuckPid = [int](Read-TargetRegistry (Get-BackendTarget)).Record.pid
  $script:StartListens = $true; $script:StopCalls.Clear()
  Start-Launcher | Out-Null
  Check ($script:StopCalls.Count -eq 1 -and $script:StopCalls[0] -eq $stuckPid -and (Get-TargetPortState (Get-BackendTarget) ([int](Read-TargetRegistry (Get-BackendTarget)).Record.pid)).State -eq 'OURS') 'the next Start replaces that stuck process and the new one holds the port'
  # The registry cannot be written after the process was started: the process must not be left running unrecorded.
  New-StartSandbox
  $script:StartHook = { New-Item -ItemType Directory -Force -Path $script:StateFile | Out-Null }
  Expect-Fail 'STATE_WRITE_FAILED' 'registry that cannot be written' { Start-Launcher }
  Check ($script:StopCalls.Count -eq 1 -and $script:FakeProcs.Count -eq 0) 'the process started a moment ago is stopped, not left running unrecorded'
  Check (@(Get-ChildItem -LiteralPath $script:StateDir -Filter '*.tmp' -ErrorAction SilentlyContinue).Count -eq 0) 'no temporary state file is left behind'

  # =============================================================================================
  Section 'M00.03 review F1: exit is confirmed only by absence or a positively different start time'
  # =============================================================================================
  New-StartSandbox
  $goneRecord = [pscustomobject]@{ pid = 7600; started_utc = $now }
  Check ((Wait-ProcessGone $goneRecord 1)) 'F1: a process that is absent has ended'
  Add-FakeProcess 7600 '2001-01-01T00:00:00.0000000Z'
  Check ((Wait-ProcessGone $goneRecord 1)) 'F1: the PID now has a positively different start time -> the recorded process has ended'
  Add-FakeProcess 7600 '' '' @() $false 'System'
  Check (!(Wait-ProcessGone $goneRecord 1)) 'F1: an existing but uninspectable process is NOT proof of exit'
  Remove-FakeProcess 7600; Add-FakeProcess 7600 $now
  $script:ProcessReadFails = $true
  Check (!(Wait-ProcessGone $goneRecord 1)) 'F1: a failing process read is NOT proof of exit'
  $script:ProcessReadFails = $false

  foreach ($mode in @('unreadable','uninspectable')) {
    # Stop: the OS accepted the stop but the launcher cannot confirm the exit.
    New-StartSandbox
    Start-Launcher | Out-Null
    $script:StopMode = $mode; $script:StopCalls.Clear(); $script:DockerCalls.Clear()
    Expect-Fail 'PROCESS_STOP_FAILED' "F1: Stop whose exit cannot be confirmed ($mode) does not claim success" { Stop-Launcher }
    Check ((Test-Path -LiteralPath $script:StateFile -PathType Leaf) -and @($script:DockerCalls | Where-Object { $_ -match 'compose.* stop ' }).Count -eq 0) "F1: registry kept and databases not stopped ($mode)"
    Check (@($script:HostLog | Where-Object { $_ -match 'd.ng .ng backend' }).Count -eq 0) "F1: no stop success is announced ($mode)"

    # Migration: the old backend must be confirmed gone before db:migrate.
    New-StartSandbox
    Start-Launcher | Out-Null
    Push-Upstream 'database/migrations/3000_third.sql' 'SELECT 3;'
    Update-Launcher | Out-Null
    $script:DbApplied = @('1000_first','2000_second'); $script:Answers.Enqueue('y')
    $script:StopMode = $mode; $startsBefore = $script:BackendStarts
    Expect-Fail 'PROCESS_STOP_FAILED' "F1: unconfirmed stop blocks the migration ($mode)" { Start-Launcher }
    Check ((NpmCount 'run db:migrate') -eq 0 -and $script:BackendStarts -eq $startsBefore -and (Test-Path -LiteralPath $script:StateFile -PathType Leaf)) "F1: no migration, no new backend, registry kept ($mode)"

    # Restart (artifact changed): the old backend must be confirmed gone before a new one starts.
    New-StartSandbox
    Start-Launcher | Out-Null
    $script:BuildContent = 'console.log("changed");'; $script:StopMode = $mode; $startsBefore = $script:BackendStarts
    Expect-Fail 'PROCESS_STOP_FAILED' "F1: unconfirmed stop blocks the restart ($mode)" { Start-Launcher }
    Check ($script:BackendStarts -eq $startsBefore -and (Test-Path -LiteralPath $script:StateFile -PathType Leaf)) "F1: no second backend and registry kept ($mode)"
  }

  # =============================================================================================
  Section 'M00.03 review F2: termination targets the process instance that was verified, never a recycled PID'
  # =============================================================================================
  foreach ($kind in @('lookalike','other')) {
    New-StartSandbox
    $script:StartReplacedBy = $kind
    Expect-Fail 'BACKEND_NOT_READY' "F2: the new child exited and its PID went to another process ($kind) before identity inspection" { Start-Launcher }
    $occupant = $script:FakeProcs[$script:FakePidCounter]
    Check ($script:StopCalls.Count -eq 0 -and $occupant -and $script:FakeProcs.Count -eq 1) "F2: the replacement ($kind) survives and nothing was stopped"
    Check (!(Test-Path -LiteralPath $script:StateFile -PathType Leaf)) "F2: no registry claims the replacement ($kind)"
  }
  # Registry write fails after the identity check, and the child's PID is replaced in between.
  New-StartSandbox
  $script:StartHook = { New-Item -ItemType Directory -Force -Path $script:StateFile | Out-Null }
  $script:DetailsHook = { param($id) Add-FakeProcess $id ([DateTime]::UtcNow.AddHours(-2).ToString('o')) }
  Expect-Fail 'STATE_WRITE_FAILED' 'F2: registry-write cleanup after the child''s PID was replaced' { Start-Launcher }
  Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey($script:FakePidCounter) -and !(Test-Path -LiteralPath $script:StateFile -PathType Leaf)) 'F2: the replacement survives the cleanup and no registry names it'
  # The real child is still cleaned up (regression for the existing behaviour).
  New-StartSandbox
  $script:StartHook = { New-Item -ItemType Directory -Force -Path $script:StateFile | Out-Null }
  Expect-Fail 'STATE_WRITE_FAILED' 'F2: registry-write cleanup of the real child' { Start-Launcher }
  Check ($script:StopCalls.Count -eq 1 -and $script:FakeProcs.Count -eq 0) 'F2: the actual child is stopped'
  # Normal Stop: the PID changes hands between the last ownership proof and the termination.
  New-StartSandbox
  Start-Launcher | Out-Null
  $target = Get-BackendTarget
  $ownership = Get-TargetOwnership $target
  $ownedPid = [int]$ownership.Registry.pid
  $script:StopCalls.Clear()
  $script:DetailsHook = { param($id) Add-FakeProcess $id ([DateTime]::UtcNow.AddHours(-2).ToString('o')) }
  Use-LaunchLock 'test' { Stop-TargetProcess $target $ownership }
  Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey($ownedPid)) 'F2: PID replaced after the last proof: the termination targets the verified instance, so the replacement survives'
  Check (!(Test-Path -LiteralPath $script:StateFile -PathType Leaf)) 'F2: the registry of the ended process is dropped and does not claim the replacement'

  # =============================================================================================
  Section 'M00.03 shared lock: every artifact/process-changing step refuses to run without it'
  # =============================================================================================
  New-StartSandbox
  $target = Get-BackendTarget
  $fake = [pscustomobject]@{ Status = 'OWNED'; Registry = [pscustomobject]@{ pid = 1 }; Text = '' }
  $manifestStub = [pscustomobject]@{ source_sha = ('a' * 40); build_fingerprint = ('b' * 64); built_at = [DateTime]::UtcNow.ToString('o'); design_version = '2.0.1' }
  Expect-Fail 'LAUNCH_LOCK_REQUIRED' 'Build-BackendArtifact without the lock' { Build-BackendArtifact $target (Head) }
  Expect-Fail 'LAUNCH_LOCK_REQUIRED' 'Write-BuildManifest without the lock' { Write-BuildManifest $target (Head) ('b' * 64) }
  Expect-Fail 'LAUNCH_LOCK_REQUIRED' 'Write-TargetRegistry without the lock' { Write-TargetRegistry $target ([pscustomobject]@{ ProcessId = 1; StartUtc = $now; Executable = $script:FakeNodeExe }) $manifestStub '' '' }
  Expect-Fail 'LAUNCH_LOCK_REQUIRED' 'Remove-TargetRegistry without the lock' { Remove-TargetRegistry $target }
  Expect-Fail 'LAUNCH_LOCK_REQUIRED' 'Stop-TargetProcess without the lock' { Stop-TargetProcess $target $fake }
  Expect-Fail 'LAUNCH_LOCK_REQUIRED' 'Start-NewBackendProcess without the lock' { Start-NewBackendProcess $target $manifestStub }
  Check ($script:NpmCalls.Count -eq 0 -and $script:BackendStarts -eq 0 -and $script:StopCalls.Count -eq 0 -and !(Test-Path -LiteralPath $script:BackendManifestFile) -and !(Test-Path -LiteralPath $script:StateFile)) 'none of them changed anything'
  Check (!(Test-LockHeld)) 'no lock is left behind'

  # =============================================================================================
  Section 'M00.03 Status: source, artifact, process and port are reported separately and Status changes nothing'
  # =============================================================================================
  New-StartSandbox
  $lines = @(Get-BackendIdentityLines (Head))
  Check ($lines.Count -eq 4 -and $lines[0].StartsWith('Backend - ') -and (($lines -join "`n").Contains('MISSING'))) 'before any build: source, artifact (MISSING), process and port lines'
  Start-Launcher | Out-Null
  $statusPath = $script:StateFile; $registryHash = File-HashOrEmpty $statusPath; $manifestHash = File-HashOrEmpty $script:BackendManifestFile
  $script:HostLog.Clear(); $script:StopCalls.Clear(); $script:NpmCalls.Clear()
  Status-Launcher | Out-Null
  $text = $script:HostLog -join "`n"
  Check ($text -match 'artifact: OK' -and $text -match 'process: .*PID \d+') 'Status shows the artifact as OK and the process with its PID'
  Check ((File-HashOrEmpty $statusPath) -eq $registryHash -and (File-HashOrEmpty $script:BackendManifestFile) -eq $manifestHash -and $script:StopCalls.Count -eq 0 -and (NpmCount 'run build') -eq 0) 'Status wrote, removed and stopped nothing'
  Check (!(Test-LockHeld)) 'Status does not leave the lock held'
  Push-Upstream 'docs/note.md' 'newer'
  Update-Launcher | Out-Null
  $script:HostLog.Clear(); Status-Launcher | Out-Null
  $text = $script:HostLog -join "`n"
  Check ($text -match 'artifact: OK' -and $text.Contains('Start')) 'after Update Status still shows the OLD process/artifact commit next to the new HEAD'
  # Tampered, deleted and corrupt artifacts.
  $manifestFile = $script:BackendManifestFile
  Check ((Get-ArtifactState (Get-BackendTarget)).State -eq 'OK') 'artifact state OK before tampering'
  [IO.File]::AppendAllText($script:BackendScript, '// tampered')
  Check ((Get-ArtifactState (Get-BackendTarget)).State -eq 'CHANGED') 'a changed build file makes the manifest stale (CHANGED)'
  Remove-Item -LiteralPath $script:BackendDist -Recurse -Force
  Check ((Get-ArtifactState (Get-BackendTarget)).State -eq 'MISSING') 'a deleted build folder takes its manifest with it (MISSING)'
  $validManifest = '{"app_id":"BACKEND","source_sha":"' + ('a' * 40) + '","build_fingerprint":"' + ('b' * 64) + '","built_at":"2026-01-01T00:00:00Z","design_version":"2.0.1"}'
  Write-Text $manifestFile $validManifest
  Check ((Get-ArtifactState (Get-BackendTarget)).State -eq 'NO_ARTIFACT') 'a valid manifest in a folder without build files is NO_ARTIFACT'
  Write-Text (Join-Path $script:BackendDist 'main.js') 'x'
  Check ((Get-ArtifactState (Get-BackendTarget)).State -eq 'CHANGED') 'a manifest whose fingerprint does not describe the files is CHANGED'
  foreach ($case in @(@('{ not json','INVALID'),@('','INVALID'),@('[]','INVALID'),@('{"app_id":"BACKEND"}','INVALID'),@(('{"app_id":"ADMIN","source_sha":"' + ('a' * 40) + '","build_fingerprint":"' + ('b' * 64) + '","built_at":"2026-01-01T00:00:00Z","design_version":"2.0.1"}'),'INVALID'),@(('{"app_id":"BACKEND","source_sha":"short","build_fingerprint":"' + ('b' * 64) + '","built_at":"2026-01-01T00:00:00Z","design_version":"2.0.1"}'),'INVALID'),@(('{"app_id":"BACKEND","source_sha":"' + ('a' * 40) + '","build_fingerprint":"' + ('b' * 64) + '","built_at":"not a date","design_version":"2.0.1"}'),'INVALID'))) {
    Write-Text $manifestFile $case[0]
    Check ((Read-BuildManifest (Get-BackendTarget)).State -eq $case[1]) "manifest '$($case[0])' is $($case[1])"
  }
  Remove-Item -LiteralPath $manifestFile -Force
  Check ((Read-BuildManifest (Get-BackendTarget)).State -eq 'MISSING') 'no manifest is MISSING'
  New-Item -ItemType Directory -Force -Path $manifestFile | Out-Null
  Check ((Read-BuildManifest (Get-BackendTarget)).State -eq 'UNREADABLE') 'a manifest that cannot be read is UNREADABLE, not MISSING'
  Remove-Item -LiteralPath $manifestFile -Recurse -Force

  # Update while the registry is unprovable: it warns and still touches nothing.
  New-StartSandbox
  Write-Text $script:StateFile ('{"pid":7100,"startedUtc":"' + $liveStart + '"}')
  Push-Upstream 'docs/note.md' 'newer'
  Update-Launcher | Out-Null
  Check (@($script:HostLog | Where-Object { $_.Contains('PROCESS_IDENTITY_UNVERIFIED') }).Count -eq 1 -and $script:StopCalls.Count -eq 0 -and (Test-Path -LiteralPath $script:StateFile)) 'Update warns about an unprovable backend record, stops nothing and keeps the record'

  # =============================================================================================
  Section 'M00.03 two real launchers at the same time (file-backed fake process table)'
  # =============================================================================================
  function Get-IdentityHarness { return (Join-Path (Join-Path (Join-Path $script:Repo 'tools') 'local') 'identity-harness.ps1') }
  function Get-FakeOsLines([string]$Name) {
    $path = Join-Path $script:StateDir ('fakeos.' + $Name)
    if (!(Test-Path -LiteralPath $path)) { return @() }
    return @(Get-Content -LiteralPath $path | Where-Object { $_ })
  }
  function Wait-Helpers($Processes) { foreach ($proc in @($Processes)) { if (!$proc.WaitForExit(300000)) { Stop-Quietly $proc } } }
  New-StartSandbox
  $env:SHIP11_HARNESS_START_DELAY_MS = '1500'
  $racers = @()
  try {
    $racers = @((Start-Helper (Get-IdentityHarness) @('-Command','Start','-NoPause')), (Start-Helper (Get-IdentityHarness) @('-Command','Start','-NoPause')), (Start-Helper (Get-IdentityHarness) @('-Command','Start','-NoPause')))
    Wait-Helpers $racers
  } finally { $env:SHIP11_HARNESS_START_DELAY_MS = $null; foreach ($proc in $racers) { Stop-Quietly $proc } }
  $calls = @(Read-HarnessCalls)
  Check (@($racers | Where-Object { $_.HasExited -and $_.ExitCode -eq 0 }).Count -eq 3) 'three launchers started together all finish with exit 0'
  Check (@($calls | Where-Object { $_.Text.StartsWith('backend start') }).Count -eq 1) 'exactly one backend was started for the three launchers'
  Check (@($calls | Where-Object { $_.Text -match '^npm run build ' }).Count -eq 3 -and @($calls | Where-Object { $_.Text -match '^(npm run build|backend start|backend stop)' -and $_.Text -notmatch 'lockheld=True' }).Count -eq 0) 'every build/start/stop ran while the shared lock was held'
  Check (@(Get-FakeOsLines 'procs').Count -eq 1 -and @(Get-FakeOsLines 'listeners').Count -eq 1) 'one process and one listener exist in the fake machine'
  $raceRecord = (Read-TargetRegistry (Get-BackendTarget))
  Check ($raceRecord.State -eq 'OK' -and (@(Get-FakeOsLines 'procs')[0].Split('|')[0] -eq "$($raceRecord.Record.pid)")) 'the single registry names the single process'
  Check (!(Test-LockHeld) -and !(Test-GateHeld)) 'no lock or gate is left behind'

  # Start and Stop together: whichever goes second sees the result of the first; the end state is consistent.
  New-StartSandbox
  $env:SHIP11_HARNESS_START_DELAY_MS = '1000'
  $racers = @()
  try {
    $racers = @((Start-Helper (Get-IdentityHarness) @('-Command','Start','-NoPause')), (Start-Helper (Get-IdentityHarness) @('-Command','Stop','-KeepDatabases','-NoPause')), (Start-Helper (Get-IdentityHarness) @('-Command','Start','-NoPause')))
    Wait-Helpers $racers
  } finally { $env:SHIP11_HARNESS_START_DELAY_MS = $null; foreach ($proc in $racers) { Stop-Quietly $proc } }
  $calls = @(Read-HarnessCalls)
  $registryNow = Read-TargetRegistry (Get-BackendTarget)
  $procCount = @(Get-FakeOsLines 'procs').Count
  Check (@($racers | Where-Object { $_.HasExited -and $_.ExitCode -eq 0 }).Count -eq 3) 'Start, Stop and Start together all finish with exit 0'
  Check (@($calls | Where-Object { $_.Text -match '^(backend start|backend stop)' -and $_.Text -notmatch 'lockheld=True' }).Count -eq 0) 'every start and stop ran while the shared lock was held'
  Check (($registryNow.State -eq 'OK' -and $procCount -eq 1) -or ($registryNow.State -eq 'NONE' -and $procCount -eq 0)) "the end state is consistent: registry $($registryNow.State), $procCount process(es), never a process without a record or the reverse"
  Check (@($calls | Where-Object { $_.Text.StartsWith('backend start') }).Count -le 2) 'no more than two backends were ever started (each Stop can cost one restart, never a pile of them)'

  # =============================================================================================
  Section 'M00.03 real Windows seams: process details, listening port, ownership and stop on REAL node processes'
  # =============================================================================================
  if (!$onWindows -or !$nodeApp) { $script:Skipped.Add('M00.03 real process/port seams - needs Windows and node (the launcher-windows job runs them)') }
  else {
    New-GitSandbox
    $fakeDetails = ${function:Get-ProcessDetails}; $fakePorts = ${function:Get-PortListeners}; $fakeStop = ${function:Stop-OwnedProcess}
    $seamFolder = Join-Path $tempRoot ('Th' + [char]0x01B0 + ' m' + [char]0x1EE5 + 'c seam')
    New-Item -ItemType Directory -Force -Path $seamFolder | Out-Null
    $seamScript = Join-Path $seamFolder 'main.js'
    Write-Text $seamScript 'const net = require("net"); const server = net.createServer(); server.listen(Number(process.env.SEAM_PORT), "127.0.0.1"); setTimeout(function () {}, 120000);'
    $finder = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback), 0
    $finder.Start(); $seamPort = $finder.LocalEndpoint.Port; $finder.Stop()
    $seamNode = $null; $intruder = $null
    $savedPort = $script:BackendPort; $savedScript = $script:BackendScript
    $script:ProcessStopSeconds = 15   # a real process on a busy runner needs more than the 1 second the fast fakes use
    try {
      Set-Item -Path function:Get-ProcessDetails -Value $script:RealGetProcessDetails
      Set-Item -Path function:Get-PortListeners -Value $script:RealGetPortListeners
      Set-Item -Path function:Stop-OwnedProcess -Value $script:RealStopOwnedProcess
      $env:SEAM_PORT = "$seamPort"
      $seamNode = Start-Process -FilePath $nodeApp.Source -ArgumentList @('--env-file-if-exists=.env', (Quote-Arg $seamScript)) -WorkingDirectory $seamFolder -PassThru -WindowStyle Hidden
      $env:SEAM_PORT = $null
      $until = [DateTime]::UtcNow.AddSeconds(30)
      do { Start-Sleep -Milliseconds 200; $probe = Get-PortListeners $seamPort } while (@($probe.Items).Count -eq 0 -and [DateTime]::UtcNow -lt $until)
      $details = Get-ProcessDetails $seamNode.Id
      Check ($details -and $details.Inspectable) 'real: Get-ProcessDetails can inspect a node process started by this user'
      Check ($details.StartUtc -ceq $seamNode.StartTime.ToUniversalTime().ToString('o')) 'real: the start time equals the one Windows reports for the process'
      Check ([IO.Path]::GetFileName($details.Executable) -ieq 'node.exe' -and (Test-SamePath (Get-ScriptArgument $details.Arguments) $seamScript)) 'real: executable is node.exe and the script argument is the quoted path with spaces and Vietnamese letters'
      Check ($probe.Readable -and @($probe.Items | Where-Object { $_.ProcessId -eq $seamNode.Id -and $_.Address -eq '127.0.0.1' }).Count -eq 1) 'real: Get-PortListeners names the node process as the owner of the loopback listener'
      Check ($null -eq (Get-ProcessDetails 2147480000)) 'real: a PID that does not exist is $null (gone), not an error'

      $script:BackendPort = $seamPort; $script:BackendScript = $seamScript
      $seamTarget = Get-BackendTarget
      Check (Test-ProcessMatchesTarget $details $seamTarget) 'real: the process matches the target script'
      Check (!(Test-ProcessMatchesTarget $details ([pscustomobject]@{ Script = (Join-Path $seamFolder 'other.js') }))) 'real: the same process does not match another script'
      $foreignState = Get-TargetPortState $seamTarget 0
      Check ($foreignState.State -eq 'FOREIGN' -and $foreignState.Foreign -contains $seamNode.Id) 'real: without a record the listener is FOREIGN'
      Check ((Get-TargetPortState $seamTarget $seamNode.Id).State -eq 'OURS') 'real: with the right owner PID the same listener is OURS'
      Expect-Fail 'PORT_IN_USE' 'real: Start refuses a port held by a process the launcher did not record' { Get-TargetSituation $seamTarget 'test' }

      Write-RegistryFor $seamNode.Id $details.StartUtc @{ executable = $details.Executable; script = $seamScript; port = $seamPort }
      $owned = Get-TargetOwnership $seamTarget
      Check ($owned.Status -eq 'OWNED') 'real: a complete record with the real PID, start time, node and script is OWNED'
      Check ((Get-TargetSituation $seamTarget 'test').Port.State -eq 'OURS') 'real: and the port is OURS'
      Write-RegistryFor $seamNode.Id '2001-01-01T00:00:00.0000000Z' @{ executable = $details.Executable; script = $seamScript; port = $seamPort }
      Check ((Get-TargetOwnership $seamTarget).Status -eq 'STALE') 'real: the same PID with another recorded start time is STALE (PID reuse)'
      Write-RegistryFor $seamNode.Id $details.StartUtc @{ executable = $details.Executable; script = (Join-Path $seamFolder 'other.js'); port = $seamPort }
      Check ((Get-TargetOwnership $seamTarget).Status -eq 'UNVERIFIED') 'real: a record for another script is UNVERIFIED'

      # A second, unrelated node process answering on another port is never touched by a stop of the recorded one.
      $env:SEAM_PORT = "$($seamPort + 1)"
      $intruder = Start-Process -FilePath $nodeApp.Source -ArgumentList @('-e','setTimeout(function(){},120000)') -PassThru -WindowStyle Hidden
      $env:SEAM_PORT = $null
      Write-RegistryFor $seamNode.Id $details.StartUtc @{ executable = $details.Executable; script = $seamScript; port = $seamPort }
      Use-LaunchLock 'test' { Stop-TargetProcess $seamTarget (Get-TargetOwnership $seamTarget) }
      $seamNode.WaitForExit(15000) | Out-Null
      Check ($seamNode.HasExited -and !$intruder.HasExited) 'real: Stop ended exactly the recorded node process and no other node process'
      Check (!(Test-Path -LiteralPath $script:StateFile)) 'real: the record was removed after the stop'
      # F2 on the real OS: a stop names the verified start time; another start time (a recycled PID) is never terminated.
      Check ((Stop-OwnedProcess $intruder.Id '2001-01-01T00:00:00.0000000Z') -ceq 'REPLACED' -and !$intruder.HasExited) 'real F2: a PID whose start time differs from the verified one is not terminated (REPLACED)'
      Check ((Stop-OwnedProcess $seamNode.Id $details.StartUtc) -ceq 'STOPPED') 'real F2: a process that already exited (handle still open) is reported as stopped, nothing else is touched'
      Check ((Stop-OwnedProcess 2147480000 $details.StartUtc) -ceq 'NOT_FOUND') 'real F2: a PID that does not exist is NOT_FOUND'
      Check ((Stop-OwnedProcess $intruder.Id ([DateTime]::UtcNow.AddYears(-30).ToString('o'))) -ceq 'REPLACED' -and !$intruder.HasExited) 'real F2: still alive after a wrong start time'
      Check ((Stop-OwnedProcess $intruder.Id $intruder.StartTime.ToUniversalTime().ToString('o')) -ceq 'STOPPED') 'real F2: the verified start time is accepted and the process is terminated'
      $intruder.WaitForExit(15000) | Out-Null
      Check ($intruder.HasExited) 'real F2: and it has exited'
    } finally {
      $env:SEAM_PORT = $null
      Stop-Quietly $seamNode; Stop-Quietly $intruder
      $script:BackendPort = $savedPort; $script:BackendScript = $savedScript
      Set-Item -Path function:Get-ProcessDetails -Value $fakeDetails
      Set-Item -Path function:Get-PortListeners -Value $fakePorts
      Set-Item -Path function:Stop-OwnedProcess -Value $fakeStop
    }
  }

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
  Section 'G01 CI-only variables from the terminal never reach the Test steps'
  # =============================================================================================
  # Fake values only: a second "fixture" pointing at DEV, a remote host and an admin password.
  $ciOnlyValues = @{
    TEST_WRONG_USER_DATABASE_URL = 'postgres://ship11_dev:g01-wrong-user-pw@127.0.0.1:5432/ship11_dev'
    TEST_REMOTE_PATH_DATABASE_URL = 'postgres://migrator:g01-remote-path-pw@db.example.invalid:5432/postgres'
    TEST_REMOTE_PATH_RUNTIME_URL = 'postgres://runtime:g01-runtime-pw@db.example.invalid:5432/postgres'
    PGPASSWORD = 'g01-admin-password'
  }
  function Set-CiOnly { foreach ($name in $ciOnlyNames) { [Environment]::SetEnvironmentVariable($name, $ciOnlyValues[$name], 'Process') } }
  function Test-CiOnlyRestored { return (@($ciOnlyNames | Where-Object { [Environment]::GetEnvironmentVariable($_, 'Process') -cne $ciOnlyValues[$_] }).Count -eq 0) }
  function Test-NoCiOnlyLeak {
    $files = @(Get-ChildItem -LiteralPath $script:Logs -File | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName })
    $text = ($files + @(Get-Content -Raw -LiteralPath $script:LastTest) + @($script:HostLog)) -join "`n"
    return (@(@('g01-wrong-user-pw','g01-remote-path-pw','g01-runtime-pw','g01-admin-password','db.example.invalid') | Where-Object { $text.Contains($_) }).Count -eq 0)
  }
  $env:GITHUB_TOKEN = $null; $env:GH_TOKEN = $null

  New-GitSandbox   # no recorded install: npm ci runs too and must not see the variables either
  New-Item -ItemType Directory -Force -Path (Join-Path $script:Repo 'node_modules') | Out-Null
  Set-CiOnly
  Check ((Get-CiOnlySnapshot).Split(';').Count -eq 4) 'G01 precondition: all four CI-only variables are set in the calling terminal'
  Test-Launcher | Out-Null
  Check ($script:NpmCiSawCiOnly -eq '') 'G01: npm ci does not inherit any CI-only variable'
  Check ($script:Steps.Count -eq 9 -and @($script:Steps | Where-Object { $_.CiOnly -ne '' }).Count -eq 0) 'G01: none of the nine npm steps (migration and integration included) sees a CI-only variable when Test PASSes'
  Check (@($script:Steps | Where-Object { $_.AppEnv -cne 'test' -or $_.DatabaseUrl -cnotmatch '^postgres://ship11_test:[A-Za-z0-9\-._~%]*@127\.0\.0\.1:5433/ship11_test$' }).Count -eq 0) 'G01: steps still run with APP_ENV=test on ship11_test@127.0.0.1:5433 only'
  Check (Test-CiOnlyRestored) 'G01: the four variables are restored exactly after a PASS'
  Check (Test-NoCiOnlyLeak) 'G01: no CI-only value appears in logs, summary or console after a PASS'

  Reset-Fakes; $script:StepExit['test:integration'] = 1
  Expect-Fail 'TEST_FAILED' 'G01: Test still fails when integration fails' { Test-Launcher }
  Check ($script:Steps.Count -eq 8 -and @($script:Steps | Where-Object { $_.CiOnly -ne '' }).Count -eq 0) 'G01: no step sees a CI-only variable when Test FAILs'
  Check (Test-CiOnlyRestored) 'G01: the four variables are restored exactly after a FAIL'
  Check (Test-NoCiOnlyLeak) 'G01: no CI-only value appears in logs, summary or console after a FAIL'

  Reset-Fakes; $script:TestPortBinding = '127.0.0.1:5432'
  Expect-Fail 'TEST_TARGET_GUARD' 'G01: target guard still refuses the DEV port' { Test-Launcher }
  Check ($script:Steps.Count -eq 0 -and (Test-CiOnlyRestored)) 'G01: variables are restored when Test stops before any step'

  Reset-Fakes; $script:NpmCiFails = $true
  Remove-Item -LiteralPath $script:InstallState -Force -ErrorAction SilentlyContinue
  $message = Get-FailMessage { Test-Launcher }
  Check ($message -ne '' -and $script:NpmCiSawCiOnly -eq '' -and (Test-CiOnlyRestored)) 'G01: variables are hidden from a failing npm ci and restored afterwards'

  # Only one variable set: the others must stay unset afterwards (restore, not overwrite).
  Reset-Fakes; Record-Install
  foreach ($name in $ciOnlyNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $env:PGPASSWORD = 'g01-admin-password'
  Test-Launcher | Out-Null
  Check (@($script:Steps | Where-Object { $_.CiOnly -ne '' }).Count -eq 0 -and (Get-CiOnlySnapshot) -eq 'PGPASSWORD=g01-admin-password') 'G01: an unset variable stays unset and a set one comes back unchanged'
  foreach ($name in $ciOnlyNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }

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
  Section 'M00.01 app entry: Admin, Food and Ship refuse safely until their prerequisites exist'
  # =============================================================================================
  New-GitSandbox
  $appHead = Head
  $dockerBefore = $script:AllDocker.Count
  $sqlBefore = $script:AllSql.Count
  $script:ProcessStarts = New-Object 'Collections.Generic.List[string]'
  # Nothing may be started or opened (no backend, no frontend, no browser): record any attempt instead of doing it.
  function Start-Process { $script:ProcessStarts.Add(($args -join ' ')) | Out-Null }
  $adminRuntime = Join-Path $script:Repo 'scripts/admin-web-dev.mjs'
  try {
    Write-Text $adminRuntime '// stand-in for the real Admin local server'
    $appUrl = @{ Admin = 'https://localhost:8443'; Food = 'https://localhost:8444'; Ship = 'https://localhost:8445' }
    foreach ($appName in @('Admin','Food','Ship')) {
      Reset-Fakes
      $message = Get-FailMessage { Open-AppLauncher $appName }
      Check ($message.Contains(': APP_NOT_READY)')) "$appName -> APP_NOT_READY"
      Check (!$message.Contains('LAUNCH_LOCK_MISSING') -and !$message.Contains('ARTIFACT_IDENTITY_MISSING') -and !$message.Contains('APP_LAUNCH_SEQUENCE_MISSING')) "$appName message no longer lists the lock (M00.02), the artifact identity (M00.03) or the launch sequence (M00.05) as missing"
      Check (!$message.Contains('APP_LAUNCH_PACKAGE_MISSING')) "$appName no longer waits for a launch package (M00.08 gave Admin its launch)"
      Check ($message.Contains($appUrl[$appName])) "$appName message names its own address $($appUrl[$appName])"
      Check ($message.Contains('APP_RUNTIME_MISSING')) "$appName runtime blocker is derived from the repository (this sandbox has no complete local server for it)"
      Check ($script:DockerCalls.Count -eq 0 -and $script:NpmCalls.Count -eq 0 -and $script:HttpCalls.Count -eq 0 -and $script:SqlCalls.Count -eq 0) "$appName refusal runs no Docker, npm, HTTP or SQL"
      Check ($script:BackendStarts -eq 0 -and $script:ProcessStarts.Count -eq 0) "$appName refusal starts no backend, frontend or browser"
      Check (!(Test-Path -LiteralPath $script:LockFile) -and !(Test-Path -LiteralPath $script:GateFile) -and !(Test-Path -LiteralPath $script:LockInfoFile)) "$appName refusal happens before any lock is taken (no lock files created)"
    }
    Check ($script:AllDocker.Count -eq $dockerBefore -and $script:AllSql.Count -eq $sqlBefore) 'no app refusal touched the databases'
    Check ((Head) -eq $appHead -and !(Test-Path -LiteralPath $script:StateFile)) 'no app refusal updated the code or recorded a backend'

    Remove-Item -LiteralPath $adminRuntime -Force
    $message = Get-FailMessage { Open-AppLauncher 'Admin' }
    Check ($message.Contains('APP_RUNTIME_MISSING')) 'Admin without its local server file reports APP_RUNTIME_MISSING (not assumed present)'

    $script:App = 'Food'
    $message = Get-FailMessage { Invoke-LauncherCommand 'App' }
    Check ($message.Contains(': APP_NOT_READY)') -and $message.Contains('11Food') -and !$message.Contains('11Ship (') -and !$message.Contains('Web Admin')) 'the App command dispatches the selected app (Food) and only that one'
    # The dot-sourced -App parameter keeps its ValidateSet, so it is removed (not set to $null) to mean 'no app given'.
    Remove-Variable -Name App -Scope Script -ErrorAction SilentlyContinue
    Expect-Fail 'APP_NOT_SPECIFIED' 'App command without an app name' { Invoke-LauncherCommand 'App' }
    Expect-Fail 'APP_NOT_SPECIFIED' 'empty app name' { Open-AppLauncher '' }
    Expect-Fail 'APP_UNKNOWN' 'unknown app name (there is no separate shop app)' { Open-AppLauncher 'Shop' }

    # Fail closed: the orchestrator being ready is not enough, the surface itself must have its files.
    Write-Text $adminRuntime '// stand-in for the real Admin local server'
    $savedReady = @($script:OrchestratorCapabilities.Values | ForEach-Object { $_.Ready })
    try {
      foreach ($capability in @($script:OrchestratorCapabilities.Values)) { $capability.Ready = $true }
      Expect-Fail 'APP_NOT_READY' 'Food stays refused when only the orchestrator is declared ready (no local server for it)' { Open-AppLauncher 'Food' }
      Expect-Fail 'APP_NOT_READY' 'Admin stays refused when only the orchestrator is declared ready (its build and operator scripts are missing here)' { Open-AppLauncher 'Admin' }
    } finally {
      $i = 0
      foreach ($capability in @($script:OrchestratorCapabilities.Values)) { $capability.Ready = $savedReady[$i]; $i++ }
    }
    Check ($script:BackendStarts -eq 0 -and $script:ProcessStarts.Count -eq 0 -and $script:DockerCalls.Count -eq 0) 'the fail-closed path also starts and opens nothing'
    Check ($script:OrchestratorCapabilities['ExclusiveLock'].Ready -eq $true -and $script:OrchestratorCapabilities['ArtifactIdentity'].Ready -eq $true -and $script:OrchestratorCapabilities['AppLaunchSequence'].Ready -eq $true) 'prerequisites are: lock ready (M00.02), artifact identity ready (M00.03), app launch sequence ready (M00.05)'
  } finally {
    Remove-Item -Path function:Start-Process -ErrorAction SilentlyContinue
  }

  Check ((@($script:AppCatalog.Keys) -join ',') -ceq 'Admin,Food,Ship') 'the catalog has exactly Admin, Food and Ship (11Food covers customer and shop; 11Ship is the driver app)'
  $ports = @($script:AppCatalog.Values | ForEach-Object { ([Uri]$_.Url).Port })
  Check (($ports -join ',') -eq '8443,8444,8445' -and @($script:AppCatalog.Values | Where-Object { $_.Url -notmatch '^https://localhost:' }).Count -eq 0) 'catalog addresses follow the approved table (https://localhost:8443/8444/8445)'
  $appParameter = (Get-Command -Name $scriptPath).Parameters['App']
  $validApps = @($appParameter.Attributes | Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] } | ForEach-Object { $_.ValidValues })
  Check (($validApps -join ',') -ceq 'Admin,Food,Ship') 'the -App parameter accepts exactly the catalog apps'

  # =============================================================================================
  Section 'M00.05 launch of 11Food / 11Ship: certificate, backend, build, HTTPS front, proof, browser'
  # the same value is pinned by the Node build suite: both sides must compute one fingerprint
  $fpDir = Join-Path $tempRoot 'fp-pin'
  New-Item -ItemType Directory -Force -Path (Join-Path $fpDir 'sub') | Out-Null
  [IO.File]::WriteAllBytes((Join-Path $fpDir 'a.txt'), [byte[]][char[]]'a')
  [IO.File]::WriteAllBytes((Join-Path $fpDir 'sub\b.txt'), [byte[]][char[]]'b')
  Check ((Get-ArtifactFingerprint $fpDir) -ceq '67307b9269c97d70e6591b918f30a9b5dc19eb5d1866b508e289c14cc2c097aa') 'artifact fingerprint equals the value pinned by the Node build'
  # =============================================================================================
  function New-AppSandbox {
    New-StartSandbox
    foreach ($name in @('food-web-dev.mjs','ship-web-dev.mjs','client-web-check.mjs','client-web-build.mjs')) { Write-Text (Join-Path (Join-Path $script:Repo 'scripts') $name) "// stand-in for $name" }
  }
  function Get-AppRecord([string]$AppName) { return (Read-TargetRegistry (Get-AppTarget $AppName)).Record }
  function Get-ComposeUps { return @($script:DockerCalls | Where-Object { $_ -match ' up ' -or $_.EndsWith(' up') }).Count }
  # The browser is Start-Process; a recording stand-in, so nothing is ever opened.
  function Start-Process { $script:Browser.Add(($args -join ' ')) | Out-Null; $script:Events.Add('browser') | Out-Null }
  try {
    # ---- first launch: everything in order, under the lock, proven before the browser opens
    New-AppSandbox
    $head = Head
    Open-AppLauncher 'Food'
    $target = Get-AppTarget 'Food'
    $record = Get-AppRecord 'Food'
    $state = Get-ArtifactState $target
    Check ($script:Events.Count -ge 4 -and $script:Events[0] -ceq 'cert') 'Food: the certificate is checked first'
    Check ($script:CertSawComposeUp -eq 0 -and $script:CertSawLock -eq $false) 'Food: the certificate check happens before the lock is taken and before any database is started'
    Check ($script:BackendStarts -eq 1 -and $script:AppStarts.Count -eq 1 -and $script:AppStarts[0] -ceq 'food-web') 'Food: one backend and one Food front were started'
    Check ($script:AppBuilds.Count -eq 1 -and $script:AppBuilds[0] -ceq 'food-web' -and (NpmCount 'run build:food-web') -eq 1 -and (NpmCount 'run build:ship-web') -eq 0) 'Food: only the Food build ran'
    Check ($state.State -eq 'OK' -and $state.Manifest.app_id -ceq 'food-web' -and $state.Manifest.source_sha -ceq $head) 'Food: the manifest is the launcher-verified manifest of this commit and this exact folder'
    Check ($record -and $record.app_id -ceq 'food-web' -and $record.port -eq 8444 -and $record.host -ceq '127.0.0.1' -and $record.schema -eq 1) 'Food: the registry names the app, host and port 8444'
    Check ($record.script -ceq (Join-Path (Join-Path $script:Repo 'scripts') 'food-web-dev.mjs') -and $record.repo -ceq $script:Repo) 'Food: the registry records the absolute script and the checkout'
    Check ($record.source_sha -ceq $head -and $record.build_fingerprint -ceq $state.Manifest.build_fingerprint -and $record.design_version -ceq '2.0.1') 'Food: the registry records the commit and fingerprint of the artifact it was started from'
    Check ($script:FakeProcs.ContainsKey([int]$record.pid) -and $record.started_utc -ceq $script:FakeProcs[[int]$record.pid].StartUtc) 'Food: the registry records the exact start time of the process it started'
    Check ((Get-TargetOwnership $target).Status -eq 'OWNED') 'Food: the recorded process is proven ours'
    $probeLine = @($script:ClientChecks | Where-Object { $_.StartsWith('probe') })[0]
    Check ($probeLine -and $probeLine.Contains('--app food-web') -and $probeLine.Contains('--port 8444') -and $probeLine.Contains("--expect-sha $head") -and $probeLine.Contains("--expect-fingerprint $($state.Manifest.build_fingerprint)")) 'Food: the probe asks for this app, this port, this commit and this fingerprint'
    Check ($script:Events.IndexOf('probe') -gt $script:Events.IndexOf('start food-web') -and $script:Events.IndexOf('browser') -gt $script:Events.IndexOf('probe')) 'Food: order is certificate, start, proof, browser'
    Check ($script:Browser.Count -eq 1 -and $script:Browser[0] -ceq 'https://localhost:8444') 'Food: the browser opens exactly https://localhost:8444 once'
    Check (@($script:LockObs | Where-Object { $_.What -eq 'npm run build:food-web' -and $_.Held }).Count -eq 1 -and @($script:LockObs | Where-Object { $_.What -eq 'app start food-web' -and $_.Held }).Count -eq 1 -and @($script:LockObs | Where-Object { $_.What -eq 'client probe' -and $_.Held }).Count -ge 1) 'Food: build, process start and proof all ran while the shared lock was held'
    Check (!(@($script:HostLog) -join "`n").Contains($script:DevPassword)) 'Food: nothing printed contains a secret'
    Check (!(Test-LockHeld)) 'Food: the lock is released afterwards'

    # ---- repeated launch: same artifact, healthy front -> reused, nothing stopped, nothing started twice
    $firstPid = [int]$record.pid
    Open-AppLauncher 'Food'
    $again = Get-AppRecord 'Food'
    Check ($script:AppStarts.Count -eq 1 -and $script:BackendStarts -eq 1 -and $script:StopCalls.Count -eq 0) 'repeat: the running Food front and backend are reused (no second start, nothing stopped)'
    Check ($script:AppBuilds.Count -eq 2 -and [int]$again.pid -eq $firstPid) 'repeat: the app is rebuilt every time (a changed artifact can never be missed) and the same process stays'
    Check ($script:Browser.Count -eq 2) 'repeat: the browser is opened again'

    # ---- changed artifact: only the launcher-owned front is replaced; a bystander and the backend are untouched
    $bystander = 7101
    Add-FakeProcess $bystander ([DateTime]::UtcNow.ToString('o')) '' @($script:FakeNodeExe, 'other-project.js')
    $script:AppBuildContent = 'app build two'
    Open-AppLauncher 'Food'
    $replaced = Get-AppRecord 'Food'
    Check ($script:AppStarts.Count -eq 2 -and [int]$replaced.pid -ne $firstPid -and $replaced.build_fingerprint -cne $record.build_fingerprint) 'changed artifact: the front is restarted from the new artifact'
    Check ($script:StopCalls.Count -eq 1 -and $script:StopCalls[0] -eq $firstPid -and $script:FakeProcs.ContainsKey($bystander) -and $script:BackendStarts -eq 1) 'changed artifact: only the old Food front was stopped; the bystander and the backend were not touched'

    # ---- a front that stopped answering correctly is replaced even though the artifact is the same
    $script:ProbeMode = 'HEALTH_FAILED'
    $before = $script:AppStarts.Count
    Expect-Fail 'APP_HEALTH_FAILED' 'a front whose proof fails is restarted and, still failing, reported' { Open-AppLauncher 'Food' }
    Check ($script:AppStarts.Count -eq $before + 1) 'a front that fails its proof is restarted once (not left running unproven)'
    $script:ProbeMode = 'ok'

    # ---- Ship: its own port, script and record; Food is not touched
    $foodPid = [int](Get-AppRecord 'Food').pid
    $stopsBefore = $script:StopCalls.Count
    Open-AppLauncher 'Ship'
    $shipRecord = Get-AppRecord 'Ship'
    Check ($shipRecord -and $shipRecord.app_id -ceq 'ship-web' -and $shipRecord.port -eq 8445 -and $shipRecord.script -ceq (Join-Path (Join-Path $script:Repo 'scripts') 'ship-web-dev.mjs')) 'Ship: own record, script and port 8445'
    Check ($script:Browser[$script:Browser.Count - 1] -ceq 'https://localhost:8445' -and $script:StopCalls.Count -eq $stopsBefore -and $script:FakeProcs.ContainsKey($foodPid)) 'Ship: opens https://localhost:8445 and leaves Food alone'
    Check ((NpmCount 'run build:ship-web') -eq 1) 'Ship: only the Ship build ran for Ship'

    # ---- Status shows both fronts without writing anything
    $script:HostLog.Clear()
    Status-Launcher
    $status = @($script:HostLog) -join "`n"
    Check ($status -match '11Food - https://localhost:8444: ' -and $status -match '11Ship - https://localhost:8445: ' -and $status.Contains("PID $foodPid")) 'Status reports both fronts with their PID'

    # ---- Stop: the fronts first, only what is proven ours
    Stop-Launcher
    Check (!$script:FakeProcs.ContainsKey($foodPid) -and !$script:FakeProcs.ContainsKey([int]$shipRecord.pid) -and $script:FakeProcs.ContainsKey($bystander)) 'Stop ends both fronts and leaves the bystander'
    Check (!(Test-Path -LiteralPath (Get-AppTarget 'Food').RegistryFile) -and !(Test-Path -LiteralPath (Get-AppTarget 'Ship').RegistryFile) -and !(Test-Path -LiteralPath $script:StateFile)) 'Stop removes the records of both fronts and of the backend'

    # ---- certificate problems stop everything BEFORE the lock, a database, a build or a browser
    foreach ($case in @(@('TLS_CERT_MISSING','APP_CERT_MISSING'),@('TLS_KEY_MISSING','APP_CERT_MISSING'),@('TLS_CERT_EXPIRED','APP_CERT_EXPIRED'),@('TLS_CERT_SAN_MISMATCH','APP_CERT_SAN_MISMATCH'),@('TLS_KEY_MISMATCH','APP_CERT_INVALID'),@('TLS_CERT_NOT_YET_VALID','APP_CERT_INVALID'),@('CHECK_UNAVAILABLE','APP_CERT_INVALID'))) {
      New-AppSandbox
      $script:CertMode = $case[0]
      $message = Get-FailMessage { Open-AppLauncher 'Food' }
      Check ($message.Contains(": $($case[1]))") -and $message.Contains($case[0]) -and $message.Contains('local-https-runtime.md')) "certificate $($case[0]) -> $($case[1]) with the runbook named"
      Check (!(Test-LockHeld) -and (Get-ComposeUps) -eq 0 -and $script:BackendStarts -eq 0 -and $script:AppBuilds.Count -eq 0 -and $script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0 -and (NpmCount 'run build') -eq 0) "certificate $($case[0]): no lock, no database, no build, no process, no browser"
      Check (!(Test-Path -LiteralPath $script:StateFile) -and !(Test-Path -LiteralPath (Get-AppTarget 'Food').RegistryFile)) "certificate $($case[0]): nothing recorded"
      Check (!$message.Contains('--insecure') -and $message.Contains('Launcher')) "certificate $($case[0]): the message does not suggest switching verification off"
    }

    # ---- a foreign process on the port is never touched, even if it answers like our front
    New-AppSandbox
    Add-FakeProcess 7900 ([DateTime]::UtcNow.ToString('o')) '' @($script:FakeNodeExe, 'someone-elses-server.js')
    Add-FakeListener '127.0.0.1' 7900 8444
    Expect-Fail 'PORT_IN_USE' 'Food refuses a port held by a process the launcher did not start' { Open-AppLauncher 'Food' }
    Check ($script:StopCalls.Count -eq 0 -and $script:FakeProcs.ContainsKey(7900)) 'foreign port: the other process was not stopped'
    Check ((Get-ComposeUps) -eq 0 -and $script:BackendStarts -eq 0 -and $script:AppBuilds.Count -eq 0 -and $script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0 -and $script:ProbeCount -eq 0 -and $script:HttpCalls.Count -eq 0) 'foreign port: no database, backend, build, front, probe, HTTP or browser'
    Check (!(Test-Path -LiteralPath (Get-AppTarget 'Food').RegistryFile)) 'foreign port: nothing recorded'
    foreach ($address in @('0.0.0.0','::1','::')) {
      New-AppSandbox
      Add-FakeProcess 7901 ([DateTime]::UtcNow.ToString('o')) '' @($script:FakeNodeExe, 'x.js')
      Add-FakeListener $address 7901 8445
      Expect-Fail 'PORT_IN_USE' "Ship refuses a port held on $address by another process" { Open-AppLauncher 'Ship' }
      Check ($script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0 -and $script:StopCalls.Count -eq 0) "foreign listener on ${address}: nothing started, opened or stopped"
    }
    New-AppSandbox
    $script:ListenersUnreadable = $true
    Expect-Fail 'PORT_OWNER_UNREADABLE' 'an unreadable port is never treated as free' { Open-AppLauncher 'Food' }
    Check ($script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0) 'unreadable port: nothing started or opened'

    # ---- records that cannot be proven fail closed, before anything else
    foreach ($bad in @('{"pid":123,"startedUtc":"2026-01-01T00:00:00Z"}', 'not json at all', '[]', '{"schema":1,"app_id":"food-web"}')) {
      New-AppSandbox
      Write-Text (Get-AppTarget 'Food').RegistryFile $bad
      $message = Get-FailMessage { Open-AppLauncher 'Food' }
      Check ($message.Contains(': PROCESS_IDENTITY_UNVERIFIED)') -and $message.Contains('food-web.json')) "unprovable record $bad -> PROCESS_IDENTITY_UNVERIFIED naming food-web.json"
      Check ((Get-ComposeUps) -eq 0 -and $script:BackendStarts -eq 0 -and $script:AppBuilds.Count -eq 0 -and $script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0) "unprovable record ${bad}: no database, backend, build, front or browser"
      Check ((Get-Content -Raw -LiteralPath (Get-AppTarget 'Food').RegistryFile) -ceq $bad) "unprovable record ${bad}: kept as it was"
      $stopMessage = Get-FailMessage { Stop-Launcher }
      Check ($stopMessage.Contains(': PROCESS_IDENTITY_UNVERIFIED)') -and $script:StopCalls.Count -eq 0) "unprovable record ${bad}: Stop stops nothing"
    }

    # ---- a record of an ended process is replaced
    New-AppSandbox
    Open-AppLauncher 'Food'
    $endedPid = [int](Get-AppRecord 'Food').pid
    Remove-FakeProcess $endedPid
    Open-AppLauncher 'Food'
    Check ($script:AppStarts.Count -eq 2 -and [int](Get-AppRecord 'Food').pid -ne $endedPid -and $script:StopCalls.Count -eq 0) 'stale record: a new front is started and nothing was stopped'

    # ---- the proof fails after the process started: reported with its own code, browser never opened
    foreach ($case in @(@('TLS_PIN_MISMATCH','APP_TLS_MISMATCH',$false),@('PROBE_IDENTITY_MISMATCH','APP_IDENTITY_MISMATCH',$false),@('HEALTH_NOT_READY','BACKEND_NOT_READY',$true),@('HEALTH_FAILED','APP_HEALTH_FAILED',$true),@('PROBE_UNREACHABLE','APP_START_FAILED',$true),@('PROBE_TIMEOUT','APP_START_FAILED',$true),@('CHECK_UNAVAILABLE','APP_START_FAILED',$true))) {
      New-AppSandbox
      $script:ProbeMode = $case[0]
      Expect-Fail $case[1] "proof $($case[0])" { Open-AppLauncher 'Food' }
      Check ($script:Browser.Count -eq 0) "proof $($case[0]): the browser is never opened"
      if ($case[2]) { Check ($script:ProbeCount -gt 1) "proof $($case[0]): retried until the limit" } else { Check ($script:ProbeCount -eq 1) "proof $($case[0]): a certificate/app mismatch on a port we hold is final at once" }
    }

    # ---- the process does not come up
    foreach ($case in @(@('AppStartThrows'),@('AppStartVanishes'),@('AppStartListens'))) {
      New-AppSandbox
      if ($case[0] -eq 'AppStartListens') { $script:AppStartListens = $false } else { Set-Variable -Scope Script -Name $case[0] -Value $true }
      Expect-Fail 'APP_START_FAILED' "front that does not come up ($($case[0]))" { Open-AppLauncher 'Food' }
      Check ($script:Browser.Count -eq 0 -and $script:ProbeCount -eq 0) "front that does not come up ($($case[0])): no proof asked, no browser"
    }

    # ---- build problems: the running front is not touched, and no unproven artifact is run
    function Reset-BuildFaults { $script:AppBuildFails = $false; $script:AppBuildNoOutput = $false; $script:AppManifestMode = ''; $script:AppManifestSha = '' }
    New-AppSandbox
    Open-AppLauncher 'Food'
    $runningPid = [int](Get-AppRecord 'Food').pid
    $browserCount = $script:Browser.Count
    foreach ($case in @(@('AppBuildFails',$true,'build exits with an error'),@('AppBuildNoOutput',$true,'build leaves no artifact'),@('AppManifestMode','none','build writes no manifest'),@('AppManifestMode','badfp','manifest does not describe the folder'),@('AppManifestSha',('a' * 40),'manifest names another commit'))) {
      Set-Variable -Scope Script -Name $case[0] -Value $case[1]
      Expect-Fail 'APP_BUILD_FAILED' "Food: $($case[2])" { Open-AppLauncher 'Food' }
      Check ($script:FakeProcs.ContainsKey($runningPid) -and $script:StopCalls.Count -eq 0 -and $script:AppStarts.Count -eq 1 -and $script:Browser.Count -eq $browserCount) "Food: $($case[2]): the running front is untouched, nothing new started or opened"
      Check ((Get-AppRecord 'Food').pid -eq $runningPid) "Food: $($case[2]): the record still names the running front"
      Reset-BuildFaults
    }

    # ---- no browser when asked not to (for unattended runs), the front is still proven
    New-AppSandbox
    $env:SHIP11_NO_BROWSER = '1'
    Open-AppLauncher 'Ship'
    Check ($script:Browser.Count -eq 0 -and $script:ProbeCount -ge 1 -and (Get-AppRecord 'Ship')) 'SHIP11_NO_BROWSER=1: proven and recorded, but no browser'
    $env:SHIP11_NO_BROWSER = $null

    # ---- a launcher or checker file that is not there is reported as a missing runtime, before anything runs
    New-AppSandbox
    Remove-Item -LiteralPath (Join-Path (Join-Path $script:Repo 'scripts') 'client-web-check.mjs') -Force
    $message = Get-FailMessage { Open-AppLauncher 'Food' }
    Check ($message.Contains(': APP_NOT_READY)') -and $message.Contains('APP_RUNTIME_MISSING') -and $script:ClientChecks.Count -eq 0 -and !(Test-Path -LiteralPath $script:LockFile)) 'a missing checker script is APP_RUNTIME_MISSING and nothing runs'

    # =========================================================================================
    Section 'M00.08 Web Admin launch: .env gate, limiter configuration, SYSTEM only when missing, proof, no secret in output'
    # =========================================================================================
    $adminKey = [Convert]::ToBase64String([byte[]](1..32))
    $adminPhone = '0900000001'
    $adminPassword = 'Sys-T3st-P@ss-9921'
    function Write-AdminEnv([hashtable]$Override=@{}) {
      $values = [ordered]@{
        ADMIN_AUTH_ENABLED = 'true'
        ADMIN_AUTH_ALLOWED_ORIGINS = '["https://localhost:8443"]'
        ADMIN_AUTH_TRUSTED_PROXY_IPS = '[]'
        ADMIN_RATE_LIMIT_HMAC_KEY = $adminKey
        ADMIN_RATE_LIMIT_KEY_ID = 'local-limiter-1'
      }
      foreach ($name in @($Override.Keys)) { $values[$name] = $Override[$name] }
      $lines = @(Get-Content -LiteralPath $script:EnvFile) + @($values.Keys | Where-Object { $null -ne $values[$_] } | ForEach-Object { "$_=$($values[$_])" })
      Write-Text $script:EnvFile ($lines -join "`n")
    }
    function New-AdminSandbox([hashtable]$Override=@{}) {
      New-AppSandbox
      foreach ($name in @('admin-web-dev.mjs','admin-web-build.mjs','admin-auth-init-limit-config.js','admin-auth-bootstrap-system.js')) { Write-Text (Join-Path (Join-Path $script:Repo 'scripts') $name) "// stand-in for $name" }
      Write-AdminEnv $Override
      $script:AdminCli = New-Object 'Collections.Generic.List[object]'
      $script:AdminCliMode = 'ok'
      $script:AdminBootstrapMode = 'ok'
    }
    function Get-AdminRecord { return (Read-TargetRegistry (Get-AppTarget 'Admin')).Record }
    # The operator commands are a seam here; the real one is exercised below with a stand-in node.exe.
    $realInvokeAdminCli = ${function:Invoke-AdminCli}
    $realRequestPassword = ${function:Read-SystemPassword}
    $realRequestPhone = ${function:Read-SystemPhone}
    function Invoke-AdminCli([string]$ScriptName,[string]$StdinText='') {
      $kind = if ($ScriptName -like '*bootstrap*') { 'bootstrap' } else { 'init' }
      $script:AdminCli.Add([pscustomobject]@{ Kind = $kind; Stdin = $StdinText; Held = (Test-LockHeld); Backends = $script:BackendStarts })
      Add-LockObservation "admin cli $kind"
      if ($kind -eq 'init') {
        if ($script:AdminCliMode -ne 'ok') { return [pscustomobject]@{ ExitCode = 1; Text = 'admin-auth:init-limit-config: invalid or missing configuration. Check environment variable(s): ADMIN_RATE_LIMIT_HMAC_KEY' } }
        return [pscustomobject]@{ ExitCode = 0; Text = 'admin-auth:init-limit-config: unchanged' }
      }
      if ($script:AdminBootstrapMode -ne 'ok') { return [pscustomobject]@{ ExitCode = 1; Text = 'admin-auth:bootstrap-system: refused: PASSWORD_POLICY' } }
      return [pscustomobject]@{ ExitCode = 0; Text = 'admin-auth:bootstrap-system: created' }
    }
    function Read-SystemPhone { $script:Prompts.Add('phone'); return "$($script:Answers.Dequeue())" }
    function Read-SystemPassword([string]$Prompt) { $script:Prompts.Add($Prompt); return (ConvertTo-SecureString "$($script:Answers.Dequeue())" -AsPlainText -Force) }
    function Test-AdminNothingStarted { return ((Get-ComposeUps) -eq 0 -and $script:BackendStarts -eq 0 -and $script:AppBuilds.Count -eq 0 -and $script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0 -and $script:AdminCli.Count -eq 0) }
    try {
      # ---- .env gate: refused before the lock, any database, build, process or browser; .env is never written
      foreach ($case in @(
        @('administration login not enabled', @{ ADMIN_AUTH_ENABLED = 'false' }, 'ADMIN_AUTH_ENABLED'),
        @('no administration settings at all', @{ ADMIN_AUTH_ENABLED = $null; ADMIN_AUTH_ALLOWED_ORIGINS = $null; ADMIN_AUTH_TRUSTED_PROXY_IPS = $null; ADMIN_RATE_LIMIT_HMAC_KEY = $null; ADMIN_RATE_LIMIT_KEY_ID = $null }, 'ADMIN_RATE_LIMIT_KEY_ID'),
        @('another origin', @{ ADMIN_AUTH_ALLOWED_ORIGINS = '["https://localhost:9443"]' }, 'ADMIN_AUTH_ALLOWED_ORIGINS'),
        @('an extra origin', @{ ADMIN_AUTH_ALLOWED_ORIGINS = '["https://localhost:8443","https://evil.example"]' }, 'ADMIN_AUTH_ALLOWED_ORIGINS'),
        @('origin without TLS', @{ ADMIN_AUTH_ALLOWED_ORIGINS = '["http://localhost:8443"]' }, 'ADMIN_AUTH_ALLOWED_ORIGINS'),
        @('a trusted proxy', @{ ADMIN_AUTH_TRUSTED_PROXY_IPS = '["10.0.0.1"]' }, 'ADMIN_AUTH_TRUSTED_PROXY_IPS'),
        @('a key that is not 32 bytes', @{ ADMIN_RATE_LIMIT_HMAC_KEY = 'c2hvcnQ=' }, 'ADMIN_RATE_LIMIT_HMAC_KEY'),
        @('an empty key id', @{ ADMIN_RATE_LIMIT_KEY_ID = '' }, 'ADMIN_RATE_LIMIT_KEY_ID')
      )) {
        New-AdminSandbox $case[1]
        $envBefore = File-HashOrEmpty $script:EnvFile
        $message = Get-FailMessage { Open-AppLauncher 'Admin' }
        Check ($message.Contains(': ADMIN_ENV_INVALID)') -and $message.Contains($case[2]) ) "Admin .env gate: $($case[0]) -> ADMIN_ENV_INVALID naming $($case[2])"
        Check (!$message.Contains($adminKey) -and !$message.Contains($script:DevPassword)) "Admin .env gate: $($case[0]): the message prints no value of .env"
        Check (!(Test-LockHeld) -and (Test-AdminNothingStarted) -and !(Test-Path -LiteralPath $script:StateFile)) "Admin .env gate: $($case[0]): no lock, database, build, process, operator command or browser"
        Check ((File-HashOrEmpty $script:EnvFile) -ceq $envBefore) "Admin .env gate: $($case[0]): .env is not touched"
      }

      # ---- first launch with a SYSTEM account already in the DEV database: nothing is created, order and proof as for the phone apps
      New-AdminSandbox
      $head = Head
      $script:SystemCount = '1'
      Open-AppLauncher 'Admin'
      $record = Get-AdminRecord
      $state = Get-ArtifactState (Get-AppTarget 'Admin')
      Check ($script:Events[0] -ceq 'cert' -and $script:CertSawLock -eq $false -and $script:CertSawComposeUp -eq 0) 'Admin: certificate first, before the lock and any database'
      Check ($script:AdminCli.Count -eq 1 -and $script:AdminCli[0].Kind -ceq 'init' -and $script:AdminCli[0].Held -eq $true) 'Admin: the limiter configuration is initialised once, under the shared lock'
      Check (@($script:SqlCalls | Where-Object { $_.Contains('app.admin_memberships') -and $_.Contains("'SYSTEM'") -and $_.StartsWith('SELECT') }).Count -eq 1) 'Admin: the SYSTEM account is looked up with one read-only query'
      $order = @($script:LockObs | ForEach-Object { $_.What })
      Check ($order.IndexOf('admin cli init') -ge 0 -and $order.IndexOf('npm run build') -lt $order.IndexOf('admin cli init') -and $order.IndexOf('admin cli init') -lt $order.IndexOf('backend start') -and $order.IndexOf('backend start') -lt $order.IndexOf('app start admin-web')) 'Admin: backend build, then limiter configuration, THEN the backend starts (it refuses to listen without the configuration), then the front'
      Check ($script:AdminCli[0].Backends -eq 0 -and $script:BackendStarts -eq 1 -and $script:AppStarts.Count -eq 1 -and $script:AppStarts[0] -ceq 'admin-web') 'Admin: one backend and one Admin front were started, the front after the configuration'
      Check ($script:AppBuilds.Count -eq 1 -and $script:AppBuilds[0] -ceq 'admin-web' -and (NpmCount 'run build:admin-web') -eq 1 -and (NpmCount 'run build:food-web') -eq 0) 'Admin: only the Admin build ran'
      Check ($state.State -eq 'OK' -and $state.Manifest.app_id -ceq 'admin-web' -and $state.Manifest.source_sha -ceq $head) 'Admin: the manifest is the launcher-verified manifest of this commit and folder'
      Check ($record -and $record.app_id -ceq 'admin-web' -and $record.port -eq 8443 -and $record.script -ceq (Join-Path (Join-Path $script:Repo 'scripts') 'admin-web-dev.mjs') -and $record.source_sha -ceq $head) 'Admin: the registry names the Admin front, port 8443, its absolute script and the commit'
      Check ((Get-TargetOwnership (Get-AppTarget 'Admin')).Status -eq 'OWNED') 'Admin: the recorded process is proven ours'
      $probeLine = @($script:ClientChecks | Where-Object { $_.StartsWith('probe') })[0]
      Check ($probeLine.Contains('--app admin-web') -and $probeLine.Contains('--port 8443') -and $probeLine.Contains("--expect-sha $head") -and $probeLine.Contains("--expect-fingerprint $($state.Manifest.build_fingerprint)")) 'Admin: the probe asks for the Admin front, port 8443, this commit and this fingerprint'
      Check ($script:Browser.Count -eq 1 -and $script:Browser[0] -ceq 'https://localhost:8443' -and $script:Events.IndexOf('browser') -gt $script:Events.IndexOf('probe')) 'Admin: the browser opens https://localhost:8443 once, after the proof'
      Check (!(@($script:HostLog) -join "`n").Contains($adminKey) -and !(@($script:HostLog) -join "`n").Contains($script:DevPassword) -and !(Test-LockHeld)) 'Admin: nothing printed contains a secret; the lock is released'

      # ---- repeat: idempotent configuration, the account is not touched, the running front is reused
      $firstPid = [int]$record.pid
      Open-AppLauncher 'Admin'
      Check ($script:AdminCli.Count -eq 2 -and @($script:AdminCli | Where-Object { $_.Kind -eq 'bootstrap' }).Count -eq 0 -and $script:AppStarts.Count -eq 1 -and [int](Get-AdminRecord).pid -eq $firstPid -and $script:StopCalls.Count -eq 0) 'Admin repeat: configuration re-checked (unchanged), no account command, front and backend reused'

      # ---- the SYSTEM account is missing: asked in the console, sent on standard input only, nothing kept
      New-AdminSandbox
      $script:SystemCount = '0'
      $script:InputRedirected = $false
      foreach ($answer in @('y', $adminPhone, $adminPassword, $adminPassword)) { $script:Answers.Enqueue($answer) }
      Open-AppLauncher 'Admin'
      $bootstrap = @($script:AdminCli | Where-Object { $_.Kind -eq 'bootstrap' })
      $payload = $null
      try { $payload = $bootstrap[0].Stdin | ConvertFrom-Json } catch { }
      Check ($bootstrap.Count -eq 1 -and $bootstrap[0].Held -eq $true -and $bootstrap[0].Backends -eq 0) 'SYSTEM missing: one bootstrap, under the lock, before the backend starts'
      Check ($payload -and $payload.phone -ceq $adminPhone -and $payload.password -ceq $adminPassword -and @($payload.PSObject.Properties).Count -eq 2) 'SYSTEM missing: the command receives exactly {phone, password} on standard input'
      $everything = (@($script:HostLog) + @($script:Prompts) + @($script:ClientChecks) + @($script:NpmCalls) + @($script:DockerCalls) + @($script:SqlCalls)) -join "`n"
      Check (!$everything.Contains($adminPassword) -and !$everything.Contains($adminKey)) 'SYSTEM missing: the password appears in no output, prompt, argument, SQL or log'
      Check (@(Get-ChildItem -LiteralPath $script:Repo -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' } | Select-String -SimpleMatch -Pattern $adminPassword -List).Count -eq 0) 'SYSTEM missing: the password was written to no file of the checkout (logs included)'
      Check ($script:ExtraSecrets -contains $adminPassword) 'SYSTEM missing: the password is registered for redaction for the rest of the run'
      Check ($script:Browser.Count -eq 1 -and $script:AppStarts.Count -eq 1) 'SYSTEM missing: after the account exists the launch goes on and opens the browser'

      foreach ($case in @(
        @('the Owner declines', @('n'), 'ADMIN_SYSTEM_MISSING', $false),
        @('the passwords differ', @('y', $adminPhone, $adminPassword, 'other-password-0'), 'ADMIN_SYSTEM_INPUT_INVALID', $false),
        @('the phone is empty', @('y', '', $adminPassword, $adminPassword), 'ADMIN_SYSTEM_INPUT_INVALID', $false),
        @('input is redirected', @(), 'ADMIN_SYSTEM_MISSING', $true)
      )) {
        New-AdminSandbox
        $script:SystemCount = '0'
        $script:InputRedirected = $case[3]
        foreach ($answer in $case[1]) { $script:Answers.Enqueue($answer) }
        Expect-Fail $case[2] "SYSTEM missing, $($case[0])" { Open-AppLauncher 'Admin' }
        Check (@($script:AdminCli | Where-Object { $_.Kind -eq 'bootstrap' }).Count -eq 0 -and $script:BackendStarts -eq 0 -and $script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0 -and !(Test-LockHeld)) "SYSTEM missing, $($case[0]): no account created, no backend, no front, no browser, lock released"
        $script:InputRedirected = $false
      }
      New-AdminSandbox
      $script:SystemCount = '0'
      $script:AdminBootstrapMode = 'refused'
      foreach ($answer in @('y', $adminPhone, $adminPassword, $adminPassword)) { $script:Answers.Enqueue($answer) }
      $message = Get-FailMessage { Open-AppLauncher 'Admin' }
      Check ($message.Contains(': ADMIN_SYSTEM_BOOTSTRAP_FAILED)') -and $message.Contains('PASSWORD_POLICY') -and !$message.Contains($adminPassword) -and $script:BackendStarts -eq 0 -and $script:Browser.Count -eq 0) 'SYSTEM refused by the command: reported with its fixed code, no password echoed, backend and browser not reached'

      # ---- limiter configuration refused: the backend is not started with a login that cannot work
      New-AdminSandbox
      $script:AdminCliMode = 'refused'
      $message = Get-FailMessage { Open-AppLauncher 'Admin' }
      Check ($message.Contains(': ADMIN_LIMIT_CONFIG_FAILED)') -and $message.Contains('ADMIN_RATE_LIMIT_HMAC_KEY') -and $script:BackendStarts -eq 0 -and $script:AppStarts.Count -eq 0 -and $script:Browser.Count -eq 0 -and @($script:SqlCalls | Where-Object { $_.Contains('admin_memberships') }).Count -eq 0) 'limiter configuration refused: ADMIN_LIMIT_CONFIG_FAILED, no account query, no backend, no front, no browser'

      # ---- the backend that is running has no administration login (started before .env had the settings)
      New-AdminSandbox
      $script:ProbeMode = 'ADMIN_AUTH_UNAVAILABLE'
      $message = Get-FailMessage { Open-AppLauncher 'Admin' }
      Check ($message.Contains(': ADMIN_AUTH_UNAVAILABLE)') -and $message.Contains('11Ship-Stop.cmd') -and $script:ProbeCount -eq 1 -and $script:Browser.Count -eq 0) 'backend without administration login: ADMIN_AUTH_UNAVAILABLE at once, tells to Stop and start again, browser never opened'
      $script:ProbeMode = 'ok'

      # ---- Status and Stop include the Admin front, and only what is proven ours
      New-AdminSandbox
      Open-AppLauncher 'Admin'
      $adminPid = [int](Get-AdminRecord).pid
      $script:HostLog.Clear()
      Status-Launcher
      Check ((@($script:HostLog) -join "`n") -match 'Web Admin - https://localhost:8443: ' -and (@($script:HostLog) -join "`n").Contains("PID $adminPid")) 'Status reports the Admin front with its PID'
      Stop-Launcher
      Check (!$script:FakeProcs.ContainsKey($adminPid) -and !(Test-Path -LiteralPath (Get-AppTarget 'Admin').RegistryFile)) 'Stop ends the Admin front and removes its record'

      # ---- a build problem of the Admin app leaves the running front alone
      New-AdminSandbox
      Open-AppLauncher 'Admin'
      $runningPid = [int](Get-AdminRecord).pid
      $script:AppBuildFails = $true
      Expect-Fail 'APP_BUILD_FAILED' 'Admin: a failing build is reported' { Open-AppLauncher 'Admin' }
      Check ($script:FakeProcs.ContainsKey($runningPid) -and $script:StopCalls.Count -eq 0) 'Admin: a failing build leaves the running front untouched'
      $script:AppBuildFails = $false

      # ---- the real operator-command runner: .env is loaded by node, credentials only on standard input, output redacted
      Set-Item -Path function:Invoke-AdminCli -Value $realInvokeAdminCli
      New-AdminSandbox
      $script:NodeCalls = New-Object 'Collections.Generic.List[object]'
      $realNode = ${function:node.exe}
      function node.exe { $global:LASTEXITCODE = 0; $script:NodeCalls.Add([pscustomobject]@{ Arguments = @($args); Stdin = @($input) -join "`n" }); "admin-auth:bootstrap-system: unchanged"; "echo of $($script:ExtraSecrets -join '')" }
      try {
        $script:ExtraSecrets = @($adminPassword)
        $json = ([ordered]@{ phone = $adminPhone; password = $adminPassword } | ConvertTo-Json -Compress)
        $run = Invoke-AdminCli 'admin-auth-bootstrap-system.js' $json
        $call = $script:NodeCalls[0]
        Check ($run.ExitCode -eq 0 -and (Get-AdminCliOutcome $run.Text 'admin-auth:bootstrap-system') -ceq 'unchanged') 'operator runner: exit code and the one fixed word are read back'
        Check ($call.Arguments.Count -eq 2 -and $call.Arguments[0] -ceq '--env-file=.env' -and $call.Arguments[1] -ceq (Join-Path (Join-Path $script:Repo 'scripts') 'admin-auth-bootstrap-system.js')) 'operator runner: node loads .env itself; the only arguments are --env-file=.env and the script'
        Check ($call.Stdin.Contains($adminPassword) -and !(($call.Arguments -join ' ').Contains($adminPassword))) 'operator runner: the password goes through standard input and never through an argument'
        Check (!$run.Text.Contains($adminPassword)) 'operator runner: a command that echoes the password is redacted before the text is returned'
        $null = Invoke-AdminCli 'admin-auth-init-limit-config.js'
        Check ($script:NodeCalls.Count -eq 2 -and $script:NodeCalls[1].Stdin -ceq '') 'operator runner: the limiter command gets no standard input'
      } finally {
        Remove-Item -Path function:node.exe -ErrorAction SilentlyContinue
        Set-Item -Path function:node.exe -Value $realNode
        $script:ExtraSecrets = @()
      }
    } finally {
      Set-Item -Path function:Invoke-AdminCli -Value $realInvokeAdminCli
      Set-Item -Path function:Read-SystemPassword -Value $realRequestPassword
      Set-Item -Path function:Read-SystemPhone -Value $realRequestPhone
      $script:InputRedirected = $false
    }
  } finally {
    Remove-Item -Path function:Start-Process -ErrorAction SilentlyContinue
  }

  # =============================================================================================
  Section 'M00.01 launcher process: app argument, caller folder, exit code, folder with spaces and Vietnamese letters'
  # =============================================================================================
  # The real script runs in a child process of the SAME PowerShell edition, copied into a folder whose name has spaces and
  # Vietnamese letters (built from code points: this file stays ASCII), and is started from a DIFFERENT working directory.
  $psExe = (Get-Process -Id $PID).Path
  $accentName = 'Th' + [char]0x01B0 + ' m' + [char]0x1EE5 + 'c 11 Ship'
  $childRepo = Join-Path $tempRoot $accentName
  $childLocal = Join-Path (Join-Path $childRepo 'tools') 'local'
  New-Item -ItemType Directory -Force -Path $childLocal | Out-Null
  Copy-Item -LiteralPath $scriptPath -Destination $childLocal
  $childScript = Join-Path $childLocal '11ship-launcher.ps1'
  $callerCwd = Join-Path $tempRoot 'caller cwd'
  New-Item -ItemType Directory -Force -Path $callerCwd | Out-Null
  # Present and secret-bearing on purpose: a refusal must neither depend on it nor print it.
  Write-Text (Join-Path $childRepo '.env') "APP_ENV=development`nDEV_DB_PASSWORD=$($script:DevPassword)"
  function Invoke-Child([string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # Windows PowerShell 5.1 turns native stderr into an error under 'Stop'
    Push-Location -LiteralPath $callerCwd
    try {
      $text = (& $psExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $childScript @Arguments 2>&1 | Out-String)
      return [pscustomobject]@{ Code = $LASTEXITCODE; Text = $text }
    } finally { Pop-Location; $ErrorActionPreference = $previous }
  }
  $childRecord = Join-Path (Join-Path $childRepo '.11ship-local') 'last-run.json'
  foreach ($case in @(@('Admin','Web Admin'),@('Food','11Food'),@('Ship','11Ship'))) {
    $appName = $case[0]
    Remove-Item -LiteralPath (Join-Path $childRepo '.11ship-local') -Recurse -Force -ErrorAction SilentlyContinue
    $r = Invoke-Child @('-Command','App','-App',$appName)
    Check ($r.Code -eq 1) "$appName from another folder exits with code 1"
    Check ($r.Text.Contains(': APP_NOT_READY)') -and $r.Text.Contains($case[1])) "$appName output names the app and APP_NOT_READY"
    Check ($r.Text.Contains("App ${appName}:") -and $r.Text.Contains('(exit 1)')) "$appName output ends with its own failure line and exit code"
    Check (!$r.Text.Contains($script:DevPassword) -and !$r.Text.Contains('ENV_FILE_MISSING')) "$appName refusal prints no secret and does not depend on .env"
    $record = if (Test-Path -LiteralPath $childRecord) { Get-Content -Raw -LiteralPath $childRecord | ConvertFrom-Json } else { $null }
    Check ($record -and $record.command -ceq "App $appName" -and $record.exitCode -eq 1 -and $record.waitedForOwner -eq $false) "$appName run record is written next to the script, names the app and did not wait for a key"
    Check (!(Test-Path -LiteralPath (Join-Path $callerCwd '.11ship-local')) -and !(Test-Path -LiteralPath (Join-Path (Join-Path $childRepo '.11ship-local') 'backend.json'))) "$appName state goes to the script's repo, never the caller's folder, and no backend is recorded"
    Check (!(Test-Path -LiteralPath (Join-Path (Join-Path $childRepo '.11ship-local') 'launch.lock')) -and !(Test-Path -LiteralPath (Join-Path (Join-Path $childRepo '.11ship-local') 'launch.gate'))) "$appName refusal in a real process creates no lock files"
  }
  $r = Invoke-Child @('-Command','App')
  Check ($r.Code -eq 1 -and $r.Text.Contains(': APP_NOT_SPECIFIED)')) '-Command App without -App exits 1 with APP_NOT_SPECIFIED'
  $r = Invoke-Child @('-Command','App','-App','Shop')
  Check ($r.Code -ne 0 -and $r.Text.Contains('Shop')) 'an app outside Admin/Food/Ship is rejected before anything runs (non-zero exit)'
  $r = Invoke-Child @('-Command','App','-App','Food','-NoPause')
  Check ($r.Code -eq 1 -and $r.Text.Contains(': APP_NOT_READY)')) 'extra launcher arguments (-NoPause) are accepted next to -App'

  # =============================================================================================
  Section 'M00.02 shared lock: wait limit, release, nesting, display-only metadata'
  # =============================================================================================
  New-GitSandbox
  $env:SHIP11_LOCK_TIMEOUT_SECONDS = $null
  Check ((Get-LockWaitSeconds) -eq 120) 'the default wait for the lock is 120 seconds'
  foreach ($case in @(@('5',5),@('119',119),@('120',120),@('0',120),@('-3',120),@('500',120),@('abc',120))) {
    $env:SHIP11_LOCK_TIMEOUT_SECONDS = $case[0]
    Check ((Get-LockWaitSeconds) -eq $case[1]) "SHIP11_LOCK_TIMEOUT_SECONDS='$($case[0])' gives $($case[1]) seconds (the variable can only shorten the wait)"
  }
  $env:SHIP11_LOCK_TIMEOUT_SECONDS = $null

  $message = Get-FailMessage { Use-LaunchLock 'boom-test' { throw 'boom inside the lock' } }
  Check ($message.Contains('boom inside the lock')) 'an exception inside the lock reaches the caller unchanged'
  Check (!(Test-LockHeld) -and $script:LockDepth -eq 0 -and !$script:LockHandle) 'the lock is released after an exception'
  Check (!(Test-Path -LiteralPath $script:LockInfoFile)) 'the display file is removed after an exception'

  $trace = New-Object 'Collections.Generic.List[string]'
  $watch = [Diagnostics.Stopwatch]::StartNew()
  Use-LaunchLock 'outer' {
    $outerHandle = $script:LockHandle
    $trace.Add("a d=$($script:LockDepth) held=$(Test-LockHeld) step=$($script:LockStep)")
    Use-LaunchLock 'inner' {
      $trace.Add("b d=$($script:LockDepth) held=$(Test-LockHeld) step=$($script:LockStep) same=$($outerHandle -eq $script:LockHandle)")
      $trace.Add("c info=$((Get-Content -Raw -LiteralPath $script:LockInfoFile | ConvertFrom-Json).step)")
      Use-LaunchLock 'innermost' { $trace.Add("d d=$($script:LockDepth) held=$(Test-LockHeld)") }
    }
    $trace.Add("e d=$($script:LockDepth) held=$(Test-LockHeld) step=$($script:LockStep) info=$((Get-Content -Raw -LiteralPath $script:LockInfoFile | ConvertFrom-Json).step)")
    try { Use-LaunchLock 'bad' { throw 'inner boom' } } catch { $trace.Add("f caught=$($_.Exception.Message)") }
    $trace.Add("g d=$($script:LockDepth) held=$(Test-LockHeld)")
  }
  $watch.Stop()
  Check ($watch.Elapsed.TotalSeconds -lt 20) 'nested use of the lock in one process does not wait for itself (no deadlock)'
  Check ($trace[0] -ceq 'a d=1 held=True step=outer') 'outer call owns the lock at depth 1'
  Check ($trace[1] -ceq 'b d=2 held=True step=inner same=True') 'nested call reuses the same OS handle at depth 2'
  Check ($trace[2] -ceq 'c info=inner' -and $trace[3] -ceq 'd d=3 held=True') 'metadata follows the innermost step; depth 3 still holds'
  Check ($trace[4] -ceq 'e d=1 held=True step=outer info=outer') 'after the nested call the outer step and its metadata are restored'
  Check ($trace[5] -ceq 'f caught=inner boom' -and $trace[6] -ceq 'g d=1 held=True') 'an exception in a nested call leaves the outer lock held'
  Check (!(Test-LockHeld) -and $script:LockDepth -eq 0 -and !(Test-Path -LiteralPath $script:LockInfoFile)) 'the lock and its display file are gone after the outer call'
  $script:MetaInfo = $null
  Use-LaunchLock 'meta' { $script:MetaInfo = Get-Content -Raw -LiteralPath $script:LockInfoFile | ConvertFrom-Json }
  $info = $script:MetaInfo
  Check ($info.pid -eq $PID -and $info.step -ceq 'meta' -and $info.sinceUtc -and $info.repo -ceq $script:Repo) 'display metadata names this process, the step, the start time and the repo'

  # --- another REAL process holds the lock -------------------------------------------------------
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'pending upstream change'
  $headBefore = Head
  $ready = Join-Path $tempRoot 'holder-a.ready'
  $holderA = Start-LockHolder 'A' 'update' 60000 $ready
  try {
    Check (Wait-ForFile $ready) 'a second real process took the shared lock'
    Check (Test-LockHeld) 'the OS lock is held by that other process'
    $env:SHIP11_LOCK_TIMEOUT_SECONDS = '3'
    $script:Entered = $false
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $message = Get-FailMessage { Use-LaunchLock 'start' { $script:Entered = $true } }
    $watch.Stop()
    Check ($message.Contains(': LAUNCH_LOCK_TIMEOUT)') -and !$script:Entered) 'a competitor waits, then stops with LAUNCH_LOCK_TIMEOUT without running its step'
    Check ($watch.Elapsed.TotalSeconds -ge 2.5 -and $watch.Elapsed.TotalSeconds -lt 30) 'the competitor really waited for the limit'
    Check ($message.Contains("PID $($holderA.Id)") -and $message.Contains("'update'")) 'the timeout message names the holder (PID and step) from the display file'
    Check (@($script:HostLog | Where-Object { $_.Contains('LAUNCH_LOCK_WAIT') }).Count -ge 1) 'the competitor printed a waiting notice (LAUNCH_LOCK_WAIT) while it waited'
    Check (Test-LockHeld) 'the holder still holds the lock after the competitor gave up (nobody takes it over)'

    $env:SHIP11_LOCK_TIMEOUT_SECONDS = '1'
    foreach ($case in @('deleted','forged','corrupt','empty')) {
      if ($case -eq 'deleted') { Remove-Item -LiteralPath $script:LockInfoFile -Force -ErrorAction SilentlyContinue }
      elseif ($case -eq 'forged') { Write-Text $script:LockInfoFile '{"pid":999999,"step":"ghost","sinceUtc":"2001-01-01T00:00:00.0000000Z"}' }
      elseif ($case -eq 'corrupt') { Write-Text $script:LockInfoFile '{ not json' }
      else { Write-Text $script:LockInfoFile '' }
      $script:Entered = $false
      $message = Get-FailMessage { Use-LaunchLock 'start' { $script:Entered = $true } }
      Check ($message.Contains(': LAUNCH_LOCK_TIMEOUT)') -and !$script:Entered) "display file ${case}: the lock is still held by the OS handle, nobody gets in"
    }
    $aged = $false
    try { [IO.File]::SetLastWriteTimeUtc($script:LockFile, (Get-Date '2001-01-01').ToUniversalTime()); $aged = $true } catch { }
    if ($aged) {
      $script:Entered = $false
      $message = Get-FailMessage { Use-LaunchLock 'start' { $script:Entered = $true } }
      Check ($message.Contains(': LAUNCH_LOCK_TIMEOUT)') -and !$script:Entered) 'an old lock file (modified in 2001) does not free a lock that is still held'
    } else { $script:Skipped.Add('aged lock file check - this OS refuses to change the time of a file that is held open') }

    Reset-Fakes
    foreach ($commandName in @('Update','Start','Test','Stop')) { Expect-Fail 'LAUNCH_LOCK_TIMEOUT' "$commandName waits for the lock, then stops" { Invoke-LauncherCommand $commandName } }
    Check ((Head) -eq $headBefore -and $script:DockerCalls.Count -eq 0 -and $script:NpmCalls.Count -eq 0 -and $script:SqlCalls.Count -eq 0 -and $script:BackendStarts -eq 0 -and !(Test-Path -LiteralPath $script:StateFile)) 'steps that did not get the lock changed nothing (no git update, Docker, npm, SQL or backend)'

    $env:SHIP11_LOCK_TIMEOUT_SECONDS = '60'
    Reset-Fakes
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Status-Launcher | Out-Null
    $message = Get-FailMessage { Open-AppLauncher 'Admin' }
    $watch.Stop()
    Check ($watch.Elapsed.TotalSeconds -lt 20 -and $message.Contains(': APP_NOT_READY)') -and @($script:HostLog | Where-Object { $_.Contains('LAUNCH_LOCK_WAIT') }).Count -eq 0) 'Status and the App refusal take no lock: they answer at once while another process holds it'

    # A crash: the holder dies without cleaning up. Its display file stays behind, the OS frees the lock.
    Write-Text $script:LockInfoFile '{"pid":999999,"step":"ghost","sinceUtc":"2001-01-01T00:00:00.0000000Z"}'
    Stop-Quietly $holderA
    Check ($holderA.HasExited) 'the holder process was killed'
    Check (Test-Path -LiteralPath $script:LockInfoFile) 'its stale display file is still on disk'
    $env:SHIP11_LOCK_TIMEOUT_SECONDS = '30'
    $script:Entered = $false; $script:SeenPid = 0
    Use-LaunchLock 'after-crash' { $script:Entered = $true; $script:SeenPid = (Get-Content -Raw -LiteralPath $script:LockInfoFile | ConvertFrom-Json).pid }
    Check ($script:Entered -and $script:SeenPid -eq $PID) 'after the crash the lock is free again and the stale display file is replaced by the new owner'
    Check (!(Test-LockHeld) -and !(Test-Path -LiteralPath $script:LockInfoFile)) 'the new owner leaves no lock and no display file behind'
    Reset-Fakes
    Update-Launcher | Out-Null
    Check ((Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'a real Update runs normally after the crashed holder'
  } finally {
    Stop-Quietly $holderA
    $env:SHIP11_LOCK_TIMEOUT_SECONDS = $null
  }

  # --- three real processes compete at once ------------------------------------------------------
  New-GitSandbox
  $events = Join-Path $tempRoot 'concurrent-events.txt'
  $procs = @((Start-LockHolder 'P1' 'start' 1200 '' $events), (Start-LockHolder 'P2' 'update' 1200 '' $events), (Start-LockHolder 'P3' 'test' 1200 '' $events))
  foreach ($p in $procs) { if (!$p.WaitForExit(180000)) { Stop-Quietly $p } }
  Check (@($procs | Where-Object { $_.HasExited -and $_.ExitCode -eq 0 }).Count -eq 3) 'all three processes finished and each one got the lock in turn'
  $ev = Read-Events $events
  $spans = New-Object 'Collections.Generic.List[object]'
  foreach ($id in @('P1','P2','P3')) {
    $in = @($ev | Where-Object { $_.Id -eq $id -and $_.What -eq 'enter' }); $out = @($ev | Where-Object { $_.Id -eq $id -and $_.What -eq 'exit' })
    if ($in.Count -eq 1 -and $out.Count -eq 1) { $spans.Add([pscustomobject]@{ Id = $id; In = $in[0].Ticks; Out = $out[0].Ticks }) }
  }
  $ordered = @($spans | Sort-Object In)
  Check ($ordered.Count -eq 3) 'each process recorded one enter and one exit'
  $overlap = $false
  for ($i = 1; $i -lt $ordered.Count; $i++) { if ($ordered[$i].In -lt $ordered[$i - 1].Out) { $overlap = $true } }
  Check (!$overlap -and $ordered.Count -eq 3) 'no two processes were ever inside the lock at the same time'
  Check (!(Test-LockHeld)) 'the lock is free after all of them'

  # =============================================================================================
  Section 'M00.02 lock integration: update, dependencies, migration, build, process and test steps all run under the lock'
  # =============================================================================================
  function Assert-AllHeld([string]$Name,[string[]]$Expected) {
    $held = @($script:LockObs | Where-Object { $_.Held })
    Check ($script:LockObs.Count -gt 0 -and $held.Count -eq $script:LockObs.Count) "$Name`: every step ran with the lock held ($($script:LockObs.Count) observed)"
    foreach ($what in $Expected) { Check (@($script:LockObs | Where-Object { $_.What -eq $what }).Count -ge 1) "$Name`: observed '$what'" }
    Check (!(Test-LockHeld) -and $script:LockDepth -eq 0) "$Name`: the lock is released afterwards"
  }
  New-GitSandbox; Record-Install; $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles)
  Push-Location -LiteralPath $callerFolder
  try { Start-Launcher | Out-Null } finally { Pop-Location }
  Assert-AllHeld 'Start' @('npm run build','backend start')
  Check ($script:NpmCwds.Count -ge 1 -and @($script:NpmCwds | Where-Object { $_ -ne 'owner repo' }).Count -eq 0) 'Start: npm ran inside the repository that holds the script, not in the caller folder'

  New-GitSandbox; Record-Install
  $script:DbHasTable = $false; Set-Variable -Scope Script -Name Yes -Value $true
  Push-Location -LiteralPath $callerFolder
  try { Start-Launcher | Out-Null } finally { Pop-Location }
  Assert-AllHeld 'Start with migrations' @('npm run db:migrate','npm run build')
  Check (@($script:NpmCwds | Where-Object { $_ -ne 'owner repo' }).Count -eq 0) 'Start with migrations: db:migrate ran inside the script repository'

  New-GitSandbox; Record-Install
  Push-Upstream 'package-lock.json' '{"lockfileVersion":3,"revision":3}'
  Push-Location -LiteralPath $callerFolder
  try { Update-Launcher | Out-Null } finally { Pop-Location }
  Assert-AllHeld 'Update' @('npm ci')
  Check ($script:NpmCwds.Count -eq 1 -and $script:NpmCwds[0] -ceq 'owner repo') 'Update: npm ci ran inside the script repository'

  New-GitSandbox; Record-Install
  $env:APP_ENV = 'development'; $env:NODE_ENV = 'development'; $env:DATABASE_URL = "postgres://ship11_dev:$($script:DevPassword)@127.0.0.1:5432/ship11_dev"
  $env:GITHUB_TOKEN = $null; $env:GH_TOKEN = $null
  Test-Launcher | Out-Null
  Assert-AllHeld 'Test' @('npm step lint','npm step progress:test')
  Check (@($script:LockObs | Where-Object { $_.What -like 'npm step *' }).Count -eq 9) 'Test: all nine npm steps were observed under the lock'

  New-GitSandbox
  Stop-Launcher | Out-Null
  Assert-AllHeld 'Stop' @('docker compose --env-file ' + $script:EnvFile + ' -f ' + $script:Compose + ' stop db-dev db-test')

  # =============================================================================================
  Section 'M00.02 safe Git update: main mode'
  # =============================================================================================
  New-GitSandbox; Record-Install
  Invoke-Git $script:Repo @('checkout','-b','feature/x','--track','origin/main') | Out-Null
  Push-Upstream 'docs/note.md' 'x'
  $before = Head
  Expect-Fail 'NOT_MAIN_BRANCH' 'Update refuses a branch that is not main, even when it tracks origin/main' { Update-Launcher }
  Check ((Head) -eq $before -and (Invoke-Git $script:Repo @('rev-parse','--abbrev-ref','HEAD')) -ceq 'feature/x') 'no automatic branch switch, HEAD unchanged'

  New-GitSandbox; Record-Install
  Invoke-Git $script:Seed @('push','origin','main:other') | Out-Null
  Invoke-Git $script:Repo @('fetch','origin') | Out-Null
  Invoke-Git $script:Repo @('branch','--set-upstream-to=origin/other','main') | Out-Null
  Push-Upstream 'docs/note.md' 'x'
  $before = Head
  Expect-Fail 'UPSTREAM_MISMATCH' 'Update refuses main when it tracks something other than origin/main' { Update-Launcher }
  Check ((Head) -eq $before) 'HEAD unchanged on a wrong upstream'

  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'x'
  $before = Head
  Write-Text (Join-Path $script:Repo '.git/MERGE_HEAD') $before
  Expect-Fail 'GIT_OPERATION_IN_PROGRESS' 'Update refuses while a merge is in progress' { Update-Launcher }
  Check ((Head) -eq $before) 'HEAD unchanged while a Git operation is unfinished'
  Remove-Item -LiteralPath (Join-Path $script:Repo '.git/MERGE_HEAD') -Force

  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'x'
  $before = Head
  Invoke-Git $script:Repo @('remote','set-url','origin',(Join-Path $tempRoot 'there is no such origin.git')) | Out-Null
  Expect-Fail 'GIT_FETCH_FAILED' 'Update stops when git fetch fails' { Update-Launcher }
  Check ((Head) -eq $before -and (NpmCount 'ci') -eq 0 -and @($script:HostLog | Where-Object { $_.Contains('(fast-forward)') }).Count -eq 0) 'a failed fetch changes nothing and never reports success'

  New-GitSandbox; Record-Install
  $envBefore = File-HashOrEmpty $script:EnvFile
  Push-UpstreamIgnored '.env' 'UPSTREAM=would overwrite the Owner secrets'
  $before = Head
  Expect-Fail 'UNTRACKED_COLLISION' 'an ignored local file (.env) that upstream would add is protected too' { Update-Launcher }
  Check ((File-HashOrEmpty $script:EnvFile) -eq $envBefore -and (Head) -eq $before) '.env is byte-for-byte intact and HEAD did not move'

  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'moves on'
  $decoy = Join-Path $tempRoot 'decoy.git'
  $env:GIT_DIR = $decoy
  try { Update-Launcher | Out-Null; $restored = ($env:GIT_DIR -ceq $decoy) } finally { $env:GIT_DIR = $null }
  Check ($restored) 'GIT_DIR from the terminal is ignored during Update and put back afterwards'
  Check ((Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'with a decoy GIT_DIR the update still fast-forwarded the launcher repository'

  New-GitSandbox; Record-Install
  $before = Head
  Push-Upstream 'docs/note.md' 'fast forward'
  Update-Launcher | Out-Null
  $after = Head
  Check ($after -ne $before -and $after -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'main + origin/main + clean: a normal fast-forward still works'
  Check ((Invoke-Git $script:Repo @('rev-list','--count','--merges','HEAD')) -eq '0') 'the fast-forward made no merge commit'

  # =============================================================================================
  Section 'M00.02 safe Git update: UAT pin (verify only, never pull)'
  # =============================================================================================
  New-GitSandbox; Record-Install
  $pinned = Head
  Write-UatPin ('{ "sha": "' + $pinned + '" }')
  Push-Upstream 'docs/note.md' 'upstream moves on'
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  Update-Launcher | Out-Null
  Check ((Head) -eq $pinned -and (Invoke-Git $script:Seed @('rev-parse','HEAD')) -ne $pinned) 'UAT: HEAD equals the pin, so Update succeeds and does not pull the newer upstream commit'
  Check ((Invoke-Git $script:Repo @('rev-parse','origin/main')) -eq $originRef) 'UAT: Update did not even fetch (origin/main did not move)'
  Check (@($script:HostLog | Where-Object { $_.Contains('UAT') }).Count -ge 1) 'UAT: the output says the checkout was verified in UAT mode'
  Reset-Fakes
  Write-UatPin ('{"sha":"' + $pinned.ToUpperInvariant() + '"}')
  Update-Launcher | Out-Null
  Check ((Head) -eq $pinned) 'UAT: an upper-case pin SHA is accepted'
  Write-UatPin ('{"sha":"' + $pinned + '"}')
  Reset-Fakes
  Status-Launcher | Out-Null
  $modeLines = @($script:HostLog | Where-Object { $_ -match '^Ch.{1,3} .{1,3} c.{1,3}p nh.{1,3}t: ' })
  Check ($modeLines.Count -eq 1 -and $modeLines[0].Contains('UAT')) 'Status shows the update mode line with UAT'

  New-GitSandbox; Record-Install
  $pinned = Head
  Write-UatPin ('{"sha":"' + $pinned + '"}')
  Push-Upstream 'docs/note.md' 'upstream moves on'
  Invoke-Git $script:Repo @('checkout','--detach',$pinned) | Out-Null
  Update-Launcher | Out-Null
  Check ((Head) -eq $pinned) 'UAT: a detached HEAD on the pinned commit is correct and is accepted'

  New-GitSandbox; Record-Install
  $pinned = Head
  Write-UatPin ('{"sha":"' + ('a' * 40) + '"}')
  Push-Upstream 'docs/note.md' 'upstream moves on'
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  Expect-Fail 'UAT_SHA_MISMATCH' 'UAT: HEAD that differs from the pin is refused' { Update-Launcher }
  Check ((Head) -eq $pinned -and (Invoke-Git $script:Repo @('rev-parse','origin/main')) -eq $originRef -and (NpmCount 'ci') -eq 0) 'UAT mismatch: no pull, no checkout, no fetch, no install'

  foreach ($bad in @('{ not json', '{"sha":"abc123"}', '{"sha":""}', '{}', ('{"sha":"' + ('g' * 40) + '"}'), '')) {
    New-GitSandbox; Record-Install
    Write-UatPin $bad
    Push-Upstream 'docs/note.md' 'upstream moves on'
    $before = Head
    Expect-Fail 'UAT_PIN_INVALID' "UAT: an unusable pin file is an error, not a silent return to main: [$bad]" { Update-Launcher }
    Check ((Head) -eq $before) "UAT: unusable pin [$bad] leaves HEAD where it was (no fallback pull)"
  }
  Check ((Get-UpdateModeText $before).Contains('UAT_PIN_INVALID')) 'the mode text names UAT_PIN_INVALID for an unusable pin'

  New-GitSandbox; Record-Install
  $pinned = Head
  Write-UatPin ('{"sha":"' + $pinned + '"}')
  Write-Text (Join-Path $script:Repo 'package-lock.json') '{"owner":"local edit"}'
  Expect-Fail 'DIRTY_TRACKED' 'UAT: a modified tracked file still stops Update' { Update-Launcher }

  New-GitSandbox; Record-Install
  Check ((Get-UpdateModeText (Head)).Contains('main')) 'without a pin file the mode text says main'
  Reset-Fakes
  Status-Launcher | Out-Null
  $modeLines = @($script:HostLog | Where-Object { $_ -match '^Ch.{1,3} .{1,3} c.{1,3}p nh.{1,3}t: ' })
  Check ($modeLines.Count -eq 1 -and $modeLines[0].Contains('main')) 'Status shows the update mode line with main'

  # =============================================================================================
  Section 'M00.02 relaunch after Update changed the launcher (in-process, fake child)'
  # =============================================================================================
  function Arg-After([string[]]$List,[string]$Name) {
    $i = [Array]::IndexOf($List, $Name)
    if ($i -lt 0 -or ($i + 1) -ge $List.Count) { return $null }
    return $List[$i + 1]
  }
  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $oldHead = Head
  $newHead = Invoke-Git $script:Seed @('rev-parse','HEAD')
  Set-Variable -Scope Script -Name Yes -Value $true
  Set-Variable -Scope Script -Name KeepDatabases -Value $true
  Set-Variable -Scope Script -Name ForceDependencies -Value $true
  $script:FakeChild = New-FakeChild 0
  Push-Location -LiteralPath $callerFolder
  try { Update-Launcher | Out-Null } finally { Pop-Location }
  $spawn = @($script:SpawnedArguments)
  $newHash = File-HashOrEmpty $script:LauncherPath
  Check ($spawn.Count -gt 0 -and @($spawn | Where-Object { $_ -ceq '-RelaunchToken' }).Count -eq 1) 'a changed launcher is started exactly once'
  Check ((Arg-After $spawn '-Command') -ceq 'Update' -and $spawn -contains '-NoPause') 'the new launcher repeats Update and is told not to pause (the old one owns the window)'
  Check ($spawn -contains '-Yes' -and $spawn -contains '-KeepDatabases' -and $spawn -contains '-ForceDependencies' -and $spawn -notcontains '-App') 'the options the Owner gave (-Yes, -KeepDatabases, -ForceDependencies) are passed on'
  Check ((Arg-After $spawn '-RelaunchFromSha') -ceq $oldHead -and (Arg-After $spawn '-RelaunchToSha') -ceq $newHead -and (Arg-After $spawn '-RelaunchLauncherHash') -ceq $newHash) 'the guard carries the SHA before, the SHA after and the hash of the new launcher file'
  Check ((Arg-After $spawn '-RelaunchToken') -match '^[0-9a-f]{32}$') 'the guard carries a fresh token'
  Check ($script:SpawnObservations.LockHeld -and $script:SpawnObservations.GateHeld) 'while the new launcher is started the old one holds the lock and the hand-over gate'
  Check (!(Test-LockHeld) -and !(Test-GateHeld)) 'after the hand-over the old launcher holds neither (the new process owns what it needs)'
  Check ((NpmCount 'ci') -eq 0 -and $script:DockerCalls.Count -eq $script:SpawnObservations.DockerCount) 'the old launcher ran no dependency install or Docker step after the hand-over'
  $dockerAfterHandOver = $script:DockerCalls.Count
  Check ($script:LauncherStale -and $script:RelaunchExitCode -eq 0) 'the old launcher is marked stale; the child exit code is 0'
  Expect-Fail 'LAUNCHER_RELOAD_REQUIRED' 'a stale launcher refuses Start' { Start-Launcher }
  Expect-Fail 'LAUNCHER_RELOAD_REQUIRED' 'a stale launcher refuses a second Update (no loop)' { Update-Launcher }
  Expect-Fail 'LAUNCHER_RELOAD_REQUIRED' 'a stale launcher refuses menu commands too' { Invoke-LauncherCommand 'Status' }
  Check ($script:DockerCalls.Count -eq $dockerAfterHandOver -and (NpmCount 'ci') -eq 0 -and $script:SpawnedArguments.Count -eq $spawn.Count) 'refused commands ran nothing and started no second launcher'
  Check ((Head) -eq $newHead) 'HEAD is the new commit'

  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'not the launcher'
  $script:FakeChild = New-FakeChild 0
  Update-Launcher | Out-Null
  Check ($null -eq $script:SpawnedArguments -and !$script:LauncherStale) 'an update that does not change the launcher starts no second launcher'

  New-GitSandbox; Record-Install
  Check ($null -eq $script:SpawnedArguments) 'no update at all starts no second launcher'
  Update-Launcher | Out-Null
  Check ($null -eq $script:SpawnedArguments -and !$script:LauncherStale) 'already up to date: no second launcher'

  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $script:FakeChild = New-FakeChild 7
  $message = Get-FailMessage { Update-Launcher }
  Check ($message.Contains(': RELAUNCH_CHILD_FAILED)') -and $message.Contains('7')) 'a failing new launcher makes Update fail with its exit code'
  Check ($script:RelaunchExitCode -eq 7 -and !(Test-LockHeld)) 'the child exit code is kept for the first launcher to return, and no lock is left'

  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $script:SpawnThrows = $true
  Expect-Fail 'RELAUNCH_FAILED' 'a new launcher that cannot be started fails closed' { Update-Launcher }
  Check (!(Test-LockHeld) -and !(Test-GateHeld) -and (NpmCount 'ci') -eq 0) 'after a failed start no lock or gate is left, and no step ran with the old code'

  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $script:RelaunchTakeoverSeconds = 2
  $script:FakeChild = New-FakeChild 0 $false
  $watch = [Diagnostics.Stopwatch]::StartNew()
  Expect-Fail 'RELAUNCH_FAILED' 'a new launcher that never takes the lock is stopped and reported' { Update-Launcher }
  $watch.Stop()
  Check ($script:FakeChild.Killed -and $watch.Elapsed.TotalSeconds -ge 1.5 -and $watch.Elapsed.TotalSeconds -lt 30) 'that new launcher was killed after the hand-over wait'
  Check (!(Test-LockHeld) -and !(Test-GateHeld)) 'the old launcher took the lock back and released everything'

  New-GitSandbox
  $script:IsRelaunched = $true
  Expect-Fail 'RELAUNCH_LIMIT' 'a launcher that was itself started by a hand-over cannot start another one' { Use-LaunchLock 'x' { Invoke-LauncherRelaunch 'Update' ('a' * 40) ('b' * 40) ('c' * 64) } }
  Check ($null -eq $script:SpawnedArguments) 'RELAUNCH_LIMIT started nothing'
  $script:IsRelaunched = $false

  New-GitSandbox
  Set-Variable -Scope Script -Name Command -Value 'Update'
  try {
    foreach ($pair in @(@('RelaunchToken',('a' * 32)),@('RelaunchFromSha',('b' * 40)),@('RelaunchToSha',('c' * 40)),@('RelaunchLauncherHash',('d' * 64)))) { Set-Variable -Scope Script -Name $pair[0] -Value $pair[1] }
    Check ((Get-FailMessage { Assert-RelaunchParameters }) -eq '') 'well-formed re-run arguments are accepted'
    foreach ($pair in @(@('RelaunchToken','zz'),@('RelaunchFromSha',('b' * 39)),@('RelaunchToSha',''),@('RelaunchLauncherHash',('D' * 64)))) {
      $keep = Get-Variable -Scope Script -Name $pair[0] -ValueOnly
      Set-Variable -Scope Script -Name $pair[0] -Value $pair[1]
      Expect-Fail 'RELAUNCH_ARGUMENTS_INVALID' "malformed $($pair[0]) is refused" { Assert-RelaunchParameters }
      Set-Variable -Scope Script -Name $pair[0] -Value $keep
    }
    Set-Variable -Scope Script -Name Command -Value 'Start'
    Expect-Fail 'RELAUNCH_ARGUMENTS_INVALID' 'a re-run for any command other than Update is refused' { Assert-RelaunchParameters }
  } finally { Set-Variable -Scope Script -Name Command -Value 'Menu' }

  New-GitSandbox; Record-Install
  $okHead = Head
  Set-Variable -Scope Script -Name RelaunchFromSha -Value $okHead
  Set-Variable -Scope Script -Name RelaunchToSha -Value $okHead
  Set-Variable -Scope Script -Name RelaunchLauncherHash -Value (File-HashOrEmpty $script:LauncherPath)
  Push-Upstream 'docs/note.md' 'newer than the re-run'
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  Check ((Get-FailMessage { Invoke-InRepo { Confirm-RelaunchedCheckout } }) -eq '') 'the re-run launcher accepts the checkout the first launcher produced'
  Check ((Head) -eq $okHead -and (Invoke-Git $script:Repo @('rev-parse','origin/main')) -eq $originRef) 'verification neither fetches nor merges'
  Set-Variable -Scope Script -Name RelaunchToSha -Value ('f' * 40)
  Expect-Fail 'RELAUNCH_SHA_MISMATCH' 'a different HEAD stops the re-run launcher' { Invoke-InRepo { Confirm-RelaunchedCheckout } }
  Set-Variable -Scope Script -Name RelaunchToSha -Value $okHead
  Set-Variable -Scope Script -Name RelaunchLauncherHash -Value ('e' * 64)
  Expect-Fail 'RELAUNCH_LAUNCHER_MISMATCH' 'a different launcher file stops the re-run launcher' { Invoke-InRepo { Confirm-RelaunchedCheckout } }
  Set-Variable -Scope Script -Name RelaunchLauncherHash -Value (File-HashOrEmpty $script:LauncherPath)
  Write-Text (Join-Path $script:Repo 'package-lock.json') '{"owner":"local edit"}'
  Expect-Fail 'DIRTY_TRACKED' 'a modified tracked file stops the re-run launcher' { Invoke-InRepo { Confirm-RelaunchedCheckout } }

  New-GitSandbox; Record-Install
  $okHead = Head
  Push-Upstream 'docs/note.md' 'newer than the re-run'
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  $script:IsRelaunched = $true; $script:TakeoverPending = $true
  Set-Variable -Scope Script -Name RelaunchFromSha -Value $okHead
  Set-Variable -Scope Script -Name RelaunchToSha -Value $okHead
  Set-Variable -Scope Script -Name RelaunchLauncherHash -Value (File-HashOrEmpty $script:LauncherPath)
  Update-Launcher | Out-Null
  Check ((Head) -eq $okHead -and (Invoke-Git $script:Repo @('rev-parse','origin/main')) -eq $originRef -and $null -eq $script:SpawnedArguments) 'the re-run Update continues the work without updating again or starting a third launcher'
  Check (!$script:TakeoverPending -and !(Test-LockHeld)) 'the re-run launcher took the lock directly and released it at the end'
  Check ((Get-DependencyState) -eq 'ok') 'the re-run launcher left dependencies recorded as ok'

  # =============================================================================================
  Section 'M00.02 two real launcher processes: Update replaces the launcher and hands the lock over'
  # =============================================================================================
  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $newHead = Invoke-Git $script:Seed @('rev-parse','HEAD')
  $r = Invoke-Harness @('-Command','Update','-Yes','-ForceDependencies','-NoPause')
  $calls = @(Read-HarnessCalls)
  $starts = @($calls | Where-Object { $_.Text.StartsWith('start ') })
  if ($r.Code -ne 0) { Say $r.Text }
  Check ($r.Code -eq 0) 'process level: the first launcher exits 0 after the new one succeeded'
  Check ($starts.Count -eq 2) 'process level: exactly two launcher processes ran (the old one, the new one once)'
  if ($starts.Count -eq 2) {
    Check ($starts[0].Text -match 'marker= command=Update' -and $starts[1].Text -match 'marker=v2 command=Update') 'process level: the second process runs the NEW launcher code'
    Check ($starts[0].ProcessId -ne $starts[1].ProcessId -and $starts[0].Text -notmatch 'token=[0-9a-f]{32}' -and $starts[1].Text -match 'token=[0-9a-f]{32}') 'process level: only the second process carries the re-run token'
    Check ($starts[1].Text -match 'yes=True' -and $starts[1].Text -match 'force=True' -and $starts[1].Text -match 'nopause=True') 'process level: the new process kept -Yes and -ForceDependencies and was told -NoPause'
    $ci = @($calls | Where-Object { $_.Text -match '^npm ci ' })
    Check ($ci.Count -eq 1 -and $ci[0].ProcessId -eq $starts[1].ProcessId) 'process level: npm ci ran exactly once, in the new process'
    Check ($ci.Count -eq 1 -and $ci[0].Text -match 'lockheld=True' -and $ci[0].Text -match 'cwd=owner repo') 'process level: that npm ci ran under the lock, inside the repository of the script (caller folder was different)'
  }
  Check ((Head) -eq $newHead -and (Get-DependencyState) -eq 'ok') 'process level: code and dependency state are current'
  Check (([regex]::Matches($r.Text, '\(exit 0\)')).Count -eq 1) 'process level: only the first launcher printed the result line'
  $record = if (Test-Path -LiteralPath $script:LastRun) { Get-Content -Raw -LiteralPath $script:LastRun | ConvertFrom-Json } else { $null }
  Check ($record -and $record.command -ceq 'Update' -and $record.exitCode -eq 0) 'process level: the first launcher wrote the run record'
  Check (!(Test-LockHeld) -and !(Test-GateHeld)) 'process level: no lock or gate is left behind'

  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $env:SHIP11_HARNESS_NPM_FAIL = '1'
  try { $r = Invoke-Harness @('-Command','Update','-Yes','-ForceDependencies','-NoPause') } finally { $env:SHIP11_HARNESS_NPM_FAIL = $null }
  $calls = @(Read-HarnessCalls)
  Check ($r.Code -eq 1 -and $r.Text.Contains('RELAUNCH_CHILD_FAILED')) 'process level: a failing new launcher gives exit 1 and RELAUNCH_CHILD_FAILED'
  Check (@($calls | Where-Object { $_.Text.StartsWith('start ') }).Count -eq 2 -and @($calls | Where-Object { $_.Text -match '^npm ci ' }).Count -eq 1) 'process level: after the failure nothing was run again (no loop, no retry)'
  $record = if (Test-Path -LiteralPath $script:LastRun) { Get-Content -Raw -LiteralPath $script:LastRun | ConvertFrom-Json } else { $null }
  Check ($record -and $record.exitCode -eq 1) 'process level: the run record keeps exit code 1'
  Check (!(Test-LockHeld) -and !(Test-GateHeld)) 'process level: no lock or gate is left behind after a failure'

  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'not the launcher'
  $r = Invoke-Harness @('-Command','Update','-NoPause')
  $calls = @(Read-HarnessCalls)
  Check ($r.Code -eq 0 -and @($calls | Where-Object { $_.Text.StartsWith('start ') }).Count -eq 1 -and @($calls | Where-Object { $_.Text -match '^npm ' }).Count -eq 0) 'process level: an update that leaves the launcher alone runs one process and no install'

  # No gap: while the new process is still starting up, a third launcher must not get the lock.
  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $env:SHIP11_HARNESS_DELAY_MS = '12000'
  $events = Join-Path $tempRoot 'gap-events.txt'
  $harnessInSandbox = Join-Path (Join-Path (Join-Path $script:Repo 'tools') 'local') 'relaunch-harness.ps1'
  $oldProcess = Start-Helper $harnessInSandbox @('-Command','Update','-Yes','-ForceDependencies','-NoPause')
  $competitor = $null
  try {
    $until = [DateTime]::UtcNow.AddSeconds(120)
    $childStarted = $false
    while (!$childStarted -and !$oldProcess.HasExited -and [DateTime]::UtcNow -lt $until) {
      try { $childStarted = (@(Read-HarnessCalls | Where-Object { $_.Text -match 'token=[0-9a-f]{32}' }).Count -gt 0) } catch { }
      if (!$childStarted) { Start-Sleep -Milliseconds 100 }
    }
    Check $childStarted 'gap test: the new launcher process started (and is now waiting before it asks for the lock)'
    $competitor = Start-LockHolder 'C' 'start' 300 '' $events
    if (!$oldProcess.WaitForExit(240000)) { Stop-Quietly $oldProcess }
    if (!$competitor.WaitForExit(240000)) { Stop-Quietly $competitor }
    Check ($oldProcess.HasExited -and $oldProcess.ExitCode -eq 0 -and $competitor.HasExited -and $competitor.ExitCode -eq 0) 'gap test: both finished successfully'
    $calls = @(Read-HarnessCalls)
    $ci = @($calls | Where-Object { $_.Text -match '^npm ci ' })
    $ev = Read-Events $events
    $tried = @($ev | Where-Object { $_.What -eq 'try' }); $entered = @($ev | Where-Object { $_.What -eq 'enter' })
    Check ($ci.Count -eq 1 -and $tried.Count -eq 1 -and $entered.Count -eq 1) 'gap test: one npm ci by the new launcher, one attempt and one entry by the competitor'
    if ($ci.Count -eq 1 -and $tried.Count -eq 1 -and $entered.Count -eq 1) {
      Check ($tried[0].Ticks -lt $ci[0].Ticks) 'gap test: the competitor asked for the lock BEFORE the new launcher did its work (while the lock was between owners)'
      Check ($entered[0].Ticks -gt $ci[0].Ticks) 'gap test: the competitor got in only AFTER the new launcher finished its work, never in the gap'
    }
  } finally {
    $env:SHIP11_HARNESS_DELAY_MS = $null
    Stop-Quietly $oldProcess; if ($competitor) { Stop-Quietly $competitor }
  }

  # =============================================================================================
  Section 'M00.02 F2: a failed Git read stops the update; an empty answer still works'
  # =============================================================================================
  $faultStatus = '^status --porcelain --untracked-files=no$'
  $faultAdded = '^-c core\.quotepath=false diff --no-renames --name-only --diff-filter=A [0-9a-f]{40} [0-9a-f]{40}$'
  $faultMigrations = '^-c core\.quotepath=false diff --no-renames --name-only --diff-filter=A [0-9a-f]{40} [0-9a-f]{40} -- database/migrations$'
  function Assert-NothingHappened([string]$Name,[string]$HeadBefore) {
    Check ((Head) -eq $HeadBefore) "$Name`: HEAD did not move"
    Check (@($script:GitCalls | Where-Object { $_ -match '^merge ' }).Count -eq 0) "$Name`: git merge was never run"
    Check ((NpmCount 'ci') -eq 0 -and @($script:NpmCalls | Where-Object { $_ -ne '--version' }).Count -eq 0 -and $null -eq $script:SpawnedArguments -and !$script:LauncherStale) "$Name`: no npm step and no second launcher followed"
    Check (!(Test-LockHeld) -and !(Test-GateHeld)) "$Name`: no lock or gate is left"
  }

  # git status fails (exit 128): that is NOT "clean".
  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $before = Head
  $script:FakeChild = New-FakeChild 0
  $script:GitFaults['status'] = $faultStatus
  Expect-Fail 'GIT_STATE_UNREADABLE' 'git status failing is not read as a clean tree' { Update-Launcher }
  Assert-NothingHappened 'status read fails' $before
  Check (@($script:GitCalls | Where-Object { $_ -match '^fetch ' }).Count -eq 0) 'status read fails: it stopped before fetching'
  $script:GitFaults.Clear()
  $message = Get-FailMessage { Update-Launcher }
  Check ($message -eq '' -and (Head) -ne $before) 'status read fails: the same Update works once Git answers again'

  # git diff (files the update would add) fails while upstream adds an ignored .env that already exists.
  New-GitSandbox; Record-Install
  $envBefore = File-HashOrEmpty $script:EnvFile
  $envLength = ([IO.FileInfo]$script:EnvFile).Length
  Push-UpstreamIgnored '.env' 'UPSTREAM=would overwrite the Owner secrets'
  $before = Head
  $script:GitFaults['added'] = $faultAdded
  Expect-Fail 'GIT_DIFF_UNREADABLE' 'a failing diff of the added files is not read as "no collision"' { Update-Launcher }
  Assert-NothingHappened 'diff read fails' $before
  Check ((File-HashOrEmpty $script:EnvFile) -eq $envBefore -and ([IO.FileInfo]$script:EnvFile).Length -eq $envLength) 'diff read fails: the ignored .env is byte-for-byte intact (same SHA-256 and length)'
  $script:GitFaults.Clear()
  Expect-Fail 'UNTRACKED_COLLISION' 'with Git answering again the same upstream change is still refused as a collision' { Update-Launcher }
  Check ((File-HashOrEmpty $script:EnvFile) -eq $envBefore -and (Head) -eq $before) 'the ignored .env is still protected after the fault is gone'

  # Diff fails on an update that adds an ordinary file: also stops before merge.
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'new file'
  $before = Head
  $script:GitFaults['added'] = $faultAdded
  Expect-Fail 'GIT_DIFF_UNREADABLE' 'a failing diff stops an ordinary update too' { Update-Launcher }
  Assert-NothingHappened 'diff read fails (plain file)' $before

  # merge-base: exit 1 = not an ancestor (diverged); anything else = could not tell.
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'x'
  $before = Head
  $script:GitFaults['ancestor'] = '^merge-base --is-ancestor '
  Expect-Fail 'GIT_STATE_UNREADABLE' 'a failing ancestry check is reported as unreadable, not as diverged history' { Update-Launcher }
  Assert-NothingHappened 'ancestry check fails' $before

  # Valid empty answers must keep working: nothing added, nothing dirty.
  New-GitSandbox; Record-Install
  Push-Upstream 'database/migrations/1000_first.sql' 'SELECT 1; -- edited upstream'
  $before = Head
  $message = Get-FailMessage { Update-Launcher }
  Check ($message -eq '' -and (Head) -ne $before -and (Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'valid empty: an update that adds no file still fast-forwards'
  Check ($script:AddedMigrations -is [int] -and $script:AddedMigrations -eq 0) 'valid empty: zero new migrations is reported as 0'
  Check (@($script:HostLog | Where-Object { $_.Contains('UNREADABLE') }).Count -eq 0) 'valid empty: nothing is reported as unreadable'

  # Migration count: a failed read must not be reported as "0 new migrations".
  New-GitSandbox; Record-Install
  Push-Upstream 'database/migrations/3000_third.sql' 'SELECT 3;'
  $script:GitFaults['migrations'] = $faultMigrations
  $message = Get-FailMessage { Update-Launcher }
  Check ($message -eq '') 'migration count unreadable: Update itself succeeds'
  Check ((Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'migration count unreadable: the code update itself is complete'
  Check ($null -eq $script:AddedMigrations) 'migration count unreadable: the count is unknown (null), not 0'
  Check (@($script:HostLog | Where-Object { $_.Contains('MIGRATION_COUNT_UNREADABLE') }).Count -eq 1 -and @($script:HostLog | Where-Object { $_ -match '\d+ migration' }).Count -eq 0) 'migration count unreadable: the Owner is told it could not be read and no count is claimed'
  $script:GitFaults.Clear()
  Check ((Invoke-InRepo { Get-AddedMigrationCount (Invoke-Git $script:Seed @('rev-parse','HEAD~1')) (Invoke-Git $script:Seed @('rev-parse','HEAD')) }) -eq 1) 'migration count readable: one new migration is counted'
  $script:GitFaults['migrations'] = $faultMigrations
  Check ($null -eq (Invoke-InRepo { Get-AddedMigrationCount (Invoke-Git $script:Seed @('rev-parse','HEAD~1')) (Invoke-Git $script:Seed @('rev-parse','HEAD')) })) 'migration count unreadable: Get-AddedMigrationCount returns null'
  $script:GitFaults.Clear()

  # =============================================================================================
  Section 'M00.02 F1: a launcher that loaded old code refuses to act once the code on disk changed (in-process)'
  # =============================================================================================
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'pending'
  $before = Head
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  # Another launcher replaced this file after this process loaded it.
  [IO.File]::AppendAllText($script:LauncherPath, "`n# replaced by another launcher after this process loaded its code`n")
  Check ($script:LoadedLauncherHash -and (File-HashOrEmpty $script:LauncherPath) -ne $script:LoadedLauncherHash) 'precondition: the launcher on disk differs from the code this process loaded'
  foreach ($commandName in @('Start','Update','Test','Stop')) {
    Reset-Fakes
    Expect-Fail 'LAUNCHER_RELOAD_REQUIRED' "$commandName with old code is refused after it got the lock" { Invoke-LauncherCommand $commandName }
    Check ($script:DockerCalls.Count -eq 0 -and $script:NpmCalls.Count -eq 0 -and $script:SqlCalls.Count -eq 0 -and $script:BackendStarts -eq 0 -and !(Test-Path -LiteralPath $script:StateFile)) "$commandName with old code: no Docker, npm, SQL or backend"
    $gitCallsMade = $script:GitCalls.Count
    Check ($gitCallsMade -eq 0 -and (Head) -eq $before -and (Invoke-Git $script:Repo @('rev-parse','origin/main')) -eq $originRef) "$commandName with old code: no Git read or write either (no fetch, no merge)"
    Check (!(Test-LockHeld) -and $script:LockDepth -eq 0) "$commandName with old code: the lock was given back at once"
  }
  foreach ($stepName in @('Ensure-Dependencies','Confirm-DevMigrations')) {
    Reset-Fakes
    Expect-Fail 'LAUNCHER_RELOAD_REQUIRED' "$stepName with old code is refused" ([scriptblock]::Create($stepName))
    Check ($script:DockerCalls.Count -eq 0 -and $script:NpmCalls.Count -eq 0 -and $script:SqlCalls.Count -eq 0) "$stepName with old code: no Docker, npm or SQL"
  }
  Reset-Fakes
  Status-Launcher | Out-Null
  Check ($script:HostLog.Count -gt 0) 'Status (read only, no lock) still answers with old code'

  # The menu was opened before the update: every action it offers is refused, none of them runs old code.
  Reset-Fakes
  foreach ($answer in @('1','2','3','4','0')) { $script:Answers.Enqueue($answer) }
  Menu | Out-Null
  Check (@($script:HostLog | Where-Object { $_.Contains('LAUNCHER_RELOAD_REQUIRED') }).Count -eq 4) 'old menu: Start, Update, Test and Stop were each refused with LAUNCHER_RELOAD_REQUIRED'
  Check ($script:DockerCalls.Count -eq 0 -and $script:NpmCalls.Count -eq 0 -and $script:SqlCalls.Count -eq 0 -and $script:BackendStarts -eq 0 -and $script:GitCalls.Count -eq 0 -and $script:Answers.Count -eq 0) 'old menu: no Docker, npm, SQL, backend or Git, and the menu still ended on 0'
  Check (!(Test-LockHeld)) 'old menu: no lock left'

  # Identity that did not change: everything still runs (control).
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'pending'
  $message = Get-FailMessage { Update-Launcher }
  Check ($message -eq '' -and (Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'control: with unchanged launcher code Update still works'

  # =============================================================================================
  Section 'M00.02 F1: barrier with real processes - B loaded v1, A updates to v2 while B waits, B must not act with v1'
  # =============================================================================================
  New-GitSandbox; Record-Install
  Push-UpstreamLauncher 'v2'
  $newHead = Invoke-Git $script:Seed @('rev-parse','HEAD')
  $barrier = Join-Path $tempRoot 'f1-barrier.txt'
  Remove-Item -LiteralPath $barrier -Force -ErrorAction SilentlyContinue
  $harnessInSandbox = Join-Path (Join-Path (Join-Path $script:Repo 'tools') 'local') 'relaunch-harness.ps1'
  $menuAnswers = Join-Path $tempRoot 'f1-menu-answers.txt'
  [IO.File]::WriteAllText($menuAnswers, "1`n2`n0`n")
  $procB = @{}
  $procA = $null
  try {
    # B processes: they load the launcher that is on disk now (v1), then wait before asking for the lock.
    $env:SHIP11_HARNESS_WAIT_FILE = $barrier
    $procB['start'] = Start-Helper $harnessInSandbox @('-Command','Start','-NoPause')
    $procB['update'] = Start-Helper $harnessInSandbox @('-Command','Update','-Yes','-ForceDependencies','-NoPause')
    $procB['menu'] = Start-Helper $harnessInSandbox @() $menuAnswers
    $env:SHIP11_HARNESS_WAIT_FILE = $null
    $until = [DateTime]::UtcNow.AddSeconds(180)
    $loaded = 0
    while ($loaded -lt 3 -and [DateTime]::UtcNow -lt $until) {
      try { $loaded = @(Read-HarnessCalls | Where-Object { $_.Text.StartsWith('start ') }).Count } catch { }
      if ($loaded -lt 3) { Start-Sleep -Milliseconds 100 }
    }
    Check ($loaded -eq 3) 'barrier: three launcher processes loaded v1 and are waiting before they ask for the lock'
    Check (@(Read-HarnessCalls | Where-Object { $_.Text -match 'marker=v2' }).Count -eq 0) 'barrier: none of them has v2 code'

    # A updates the checkout to v2 (its new launcher holds the lock while the work runs).
    $env:SHIP11_HARNESS_DELAY_MS = '5000'
    $procA = Start-Helper $harnessInSandbox @('-Command','Update','-Yes','-ForceDependencies','-NoPause')
    $env:SHIP11_HARNESS_DELAY_MS = $null
    $until = [DateTime]::UtcNow.AddSeconds(240)
    $v2Started = $false
    while (!$v2Started -and !$procA.HasExited -and [DateTime]::UtcNow -lt $until) {
      try { $v2Started = (@(Read-HarnessCalls | Where-Object { $_.Text -match 'marker=v2' -and $_.Text -match 'token=[0-9a-f]{32}' }).Count -gt 0) } catch { }
      if (!$v2Started) { Start-Sleep -Milliseconds 100 }
    }
    Check $v2Started 'barrier: A put v2 on disk and started the v2 launcher'
    # Release the old processes now: they ask for the lock while v2 is working, and get it when v2 is done.
    [IO.File]::WriteAllText($barrier, 'go')
    foreach ($proc in @($procA) + @($procB.Values)) { if (!$proc.WaitForExit(300000)) { Stop-Quietly $proc } }

    $calls = @(Read-HarnessCalls)
    Check ($procA.HasExited -and $procA.ExitCode -eq 0) 'barrier: A (Update) finished with exit 0'
    $v2Process = @($calls | Where-Object { $_.Text -match 'marker=v2' } | Select-Object -First 1)
    $ci = @($calls | Where-Object { $_.Text -match '^npm ci ' })
    Check ($ci.Count -eq 1 -and $v2Process.Count -eq 1 -and $ci[0].ProcessId -eq $v2Process[0].ProcessId) 'barrier: npm ci ran exactly once, by the v2 launcher (nobody ran it with v1)'
    foreach ($key in @('start','update','menu')) {
      $proc = $procB[$key]
      $mine = @($calls | Where-Object { $_.ProcessId -eq $proc.Id -and !$_.Text.StartsWith('start ') })
      $text = Get-HelperText $proc
      Check ($proc.HasExited -and $mine.Count -eq 0) "barrier: old $key launcher ran no Docker, npm, build, migration or backend step ($($mine.Count) found)"
      Check ($text.Contains('LAUNCHER_RELOAD_REQUIRED')) "barrier: old $key launcher said LAUNCHER_RELOAD_REQUIRED"
    }
    Check ($procB['start'].ExitCode -eq 1 -and $procB['update'].ExitCode -eq 1) 'barrier: old Start and old Update exit 1 (refused)'
    Check ($procB['menu'].ExitCode -eq 0 -and ([regex]::Matches((Get-HelperText $procB['menu']), 'LAUNCHER_RELOAD_REQUIRED')).Count -ge 2) 'barrier: the old menu refused both actions it was asked for and ended normally'
    Check (@($calls | Where-Object { $_.Text.StartsWith('start ') }).Count -eq 5 -and @($calls | Where-Object { $_.Text -match 'token=[0-9a-f]{32}' }).Count -eq 1) 'barrier: five launcher processes in all, exactly one hand-over, no relaunch loop'
    Check ((Head) -eq $newHead) 'barrier: HEAD is the v2 commit'
    Check (!(Test-LockHeld) -and !(Test-GateHeld)) 'barrier: no lock or gate is left behind'
  } finally {
    $env:SHIP11_HARNESS_WAIT_FILE = $null; $env:SHIP11_HARNESS_DELAY_MS = $null
    if (!(Test-Path -LiteralPath $barrier)) { [IO.File]::WriteAllText($barrier, 'go') }
    foreach ($proc in @($procA) + @($procB.Values)) { if ($proc) { Stop-Quietly $proc } }
  }

  # =============================================================================================
  Section 'M00.02 F3: a failed identity read after the lock was taken gives the lock back at once'
  # =============================================================================================
  function Assert-IdentityFaultClean([string]$Name,[string]$HeadBefore,[string]$OriginBefore) {
    # Checked first and right away: a leaked handle would still hold the lock here (nothing forces a garbage collection).
    $held = Test-LockHeld
    $gitCallsMade = $script:GitCalls.Count
    Check (!$held) "$Name`: the lock is free immediately (no handle left for the garbage collector)"
    Check ($script:LockDepth -eq 0 -and !$script:LockHandle -and !$script:LauncherStale) "$Name`: no lock state is left and the launcher is not marked stale (it can recover)"
    Check ($script:DockerCalls.Count -eq 0 -and @($script:NpmCalls).Count -eq 0 -and $script:SqlCalls.Count -eq 0 -and $script:BackendStarts -eq 0 -and $gitCallsMade -eq 0 -and !(Test-Path -LiteralPath $script:StateFile)) "$Name`: no Git, npm, Docker, migration or backend step ran"
    Check ((Head) -eq $HeadBefore -and (Invoke-Git $script:Repo @('rev-parse','origin/main')) -eq $OriginBefore) "$Name`: HEAD and origin/main did not move"
  }
  # A short wait keeps a launcher that leaks its handle from stalling the whole run for 120 seconds per step.
  $env:SHIP11_LOCK_TIMEOUT_SECONDS = '3'
  New-GitSandbox; Record-Install
  Push-Upstream 'docs/note.md' 'pending'
  $before = Head
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  foreach ($commandName in @('Start','Update','Test','Stop')) {
    Reset-Fakes
    $script:IdentityFault = $true
    Expect-Fail 'LAUNCHER_IDENTITY_UNREADABLE' "$commandName with an unreadable launcher file stops with a stable code" { Invoke-LauncherCommand $commandName }
    Assert-IdentityFaultClean $commandName $before $originRef
  }
  foreach ($stepName in @('Ensure-Dependencies','Confirm-DevMigrations')) {
    Reset-Fakes
    $script:IdentityFault = $true
    Expect-Fail 'LAUNCHER_IDENTITY_UNREADABLE' "$stepName with an unreadable launcher file stops with a stable code" ([scriptblock]::Create($stepName))
    Assert-IdentityFaultClean $stepName $before $originRef
  }

  # The first process (here: the menu) stays alive; a second REAL process must get the lock at once.
  Reset-Fakes
  $script:IdentityFault = $true
  foreach ($answer in @('1','2','0')) { $script:Answers.Enqueue($answer) }
  Menu | Out-Null
  Check (@($script:HostLog | Where-Object { $_.Contains('LAUNCHER_IDENTITY_UNREADABLE') }).Count -eq 2 -and $script:Answers.Count -eq 0) 'live menu: Start and Update were each refused with LAUNCHER_IDENTITY_UNREADABLE and the menu kept running until 0'
  Assert-IdentityFaultClean 'live menu' $before $originRef
  $env:SHIP11_LOCK_TIMEOUT_SECONDS = '10'
  try {
    $second = Start-LockHolder 'second' 'start' 200
    $finished = $second.WaitForExit(120000)
    if (!$finished) { Stop-Quietly $second }
    Check ($finished -and $second.ExitCode -eq 0) 'a second real process got the lock immediately while the first process is still alive (no LAUNCH_LOCK_TIMEOUT)'
  } finally { $env:SHIP11_LOCK_TIMEOUT_SECONDS = '3' }

  # Readable again: the same launcher runs normally.
  $script:IdentityFault = $false
  Reset-Fakes
  $message = Get-FailMessage { Update-Launcher }
  Check ($message -eq '' -and (Head) -eq (Invoke-Git $script:Seed @('rev-parse','HEAD'))) 'once the launcher file is readable again the same process runs Update normally'
  Check (!(Test-LockHeld)) 'and gives the lock back afterwards'

  # The real cause: another process holds the launcher file open exclusively.
  New-GitSandbox; Record-Install
  $before = Head
  $originRef = Invoke-Git $script:Repo @('rev-parse','origin/main')
  $blocker = $null
  try { $blocker = [IO.File]::Open($script:LauncherPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) } catch { }
  $blocked = $false
  if ($blocker) { try { [void](Get-FileHash -Algorithm SHA256 -LiteralPath $script:LauncherPath) } catch { $blocked = $true } }
  if (!$blocked) {
    $script:Skipped.Add('F3 with a really locked launcher file - this OS does not stop another reader of a file held open')
    if ($blocker) { $blocker.Dispose() }
  } else {
    try {
      Reset-Fakes
      Expect-Fail 'LAUNCHER_IDENTITY_UNREADABLE' 'a launcher file held open by another process stops Start with a stable code' { Start-Launcher }
      Assert-IdentityFaultClean 'locked launcher file' $before $originRef
    } finally { $blocker.Dispose() }
    Reset-Fakes
    $script:DbHasTable = $true; $script:DbApplied = @(Get-MigrationFiles)
    $message = Get-FailMessage { Start-Launcher }
    Check ($message -eq '' -and $script:BackendStarts -eq 1) 'after the other process let go of the file, Start runs normally'
  }
  $env:SHIP11_LOCK_TIMEOUT_SECONDS = $null

  # =============================================================================================
  Section 'Wrappers and real Windows double-click behaviour'
  # =============================================================================================
  $source = Get-Content -Raw -Encoding UTF8 -LiteralPath $scriptPath
  foreach ($forbidden in @('reset --hard','down -v','db:migrate:remote','git stash','push --force','audit fix')) { Check (!$source.Contains($forbidden)) "source excludes forbidden operation: $forbidden" }
  # M01.22: the test SMS inbox reader is a separate tool (not a launcher wrapper); tests/test-sms-tool covers it.
  $wrappers = @(Get-ChildItem -LiteralPath (Split-Path $scriptPath) -Filter '*.cmd' | Where-Object { $_.Name -ne '11ship-test-sms.cmd' })
  Check ($wrappers.Count -eq 9) 'menu, five command wrappers and three app wrappers exist'
  $expectedWrappers = @('11Ship.cmd','11Ship-Start.cmd','11Ship-Update.cmd','11Ship-Test.cmd','11Ship-Stop.cmd','11Ship-Status.cmd','11Ship-Admin.cmd','11Ship-Food.cmd','11Ship-Ship.cmd')
  Check ((@($wrappers | ForEach-Object { $_.Name } | Sort-Object) -join '|') -ceq (@($expectedWrappers | Sort-Object) -join '|')) 'wrapper inventory is exactly the nine expected names (no separate shop-owner app)'
  foreach ($wrapper in $wrappers) {
    $text = Get-Content -Raw -LiteralPath $wrapper.FullName
    Check ($text.Contains('powershell.exe -NoProfile -ExecutionPolicy Bypass') -and $text.Contains('exit /b %code%') -and $text -notmatch '(?im)^\s*pause\b') "$($wrapper.Name) calls Windows PowerShell, preserves the exit code and has no unconditional pause"
  }
  foreach ($appName in @('Admin','Food','Ship')) {
    $text = Get-Content -Raw -LiteralPath (Join-Path (Split-Path $scriptPath) "11Ship-$appName.cmd")
    $named = @([regex]::Matches($text, '-App\s+(\S+)'))
    Check ($named.Count -eq 1 -and $named[0].Groups[1].Value -ceq $appName) "11Ship-$appName.cmd passes exactly -App $appName"
    Check ($text.Contains('-Command App -App') -and $text.Contains('"%~dp011ship-launcher.ps1"') -and $text.Contains('%*')) "11Ship-$appName.cmd uses the shared launcher next to itself (not the caller folder) and forwards extra arguments"
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
    $null = $p.Handle   # without a cached handle, ExitCode stays empty for a process started with -PassThru
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

    # M00.01: the three app wrappers themselves, in a folder with a space and Vietnamese letters, started from ANOTHER folder.
    $appRepo = Join-Path $tempRoot ('Th' + [char]0x01B0 + ' m' + [char]0x1EE5 + 'c wrappers')
    $appLocal = Join-Path (Join-Path $appRepo 'tools') 'local'
    New-Item -ItemType Directory -Force -Path $appLocal | Out-Null
    Copy-Item -Path (Join-Path (Split-Path $scriptPath) '*') -Destination $appLocal
    $otherCwd = Join-Path $tempRoot 'other cwd'
    New-Item -ItemType Directory -Force -Path $otherCwd | Out-Null
    $appRecord = Join-Path (Join-Path $appRepo '.11ship-local') 'last-run.json'
    foreach ($appName in @('Admin','Food','Ship')) {
      Remove-Item -LiteralPath (Join-Path $appRepo '.11ship-local') -Recurse -Force -ErrorAction SilentlyContinue
      $appWrapper = Join-Path $appLocal "11Ship-$appName.cmd"
      $appOut = Join-Path $tempRoot "app-$appName-output.txt"
      $p = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c ""{0}" -NoPause"' -f $appWrapper) -WorkingDirectory $otherCwd -RedirectStandardInput $emptyInput -RedirectStandardOutput $appOut -PassThru -WindowStyle Hidden
      $null = $p.Handle
      $finished = $p.WaitForExit(180000)
      if (!$finished) { & taskkill.exe /PID $p.Id /T /F | Out-Null }
      Check $finished "M00.01: 11Ship-$appName.cmd finishes by itself when its streams are redirected"
      Check ($finished -and $p.ExitCode -eq 1) "M00.01: 11Ship-$appName.cmd returns the launcher exit code 1 (not ready), not 0"
      $outText = if (Test-Path -LiteralPath $appOut) { Get-Content -Raw -LiteralPath $appOut } else { '' }
      Check ($outText.Contains(': APP_NOT_READY)')) "M00.01: 11Ship-$appName.cmd output reached the caller with APP_NOT_READY"
      $record = if (Test-Path -LiteralPath $appRecord) { Get-Content -Raw -LiteralPath $appRecord | ConvertFrom-Json } else { $null }
      Check ($record -and $record.command -ceq "App $appName" -and $record.exitCode -eq 1) "M00.01: 11Ship-$appName.cmd ran the right app from a folder with spaces and Vietnamese letters"
      Check (!(Test-Path -LiteralPath (Join-Path $otherCwd '.11ship-local'))) "M00.01: 11Ship-$appName.cmd ignores the caller's working folder"
    }
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
