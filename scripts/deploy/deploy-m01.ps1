<#
.SYNOPSIS
  Trien khai goi release 11Ship (M01) len VPS VinaHost qua SSH/SCP tu Windows PowerShell.
.DESCRIPTION
  Tu dong hoa cac muc 1-3 va 6 cua ops/runbooks/vps-production-update-20261014.md:
    1. Kiem tra truoc (local + tren VPS), khong thay doi gi tren VPS.
    2. Tai goi len, kiem tra sha256 va RELEASE.json tren VPS.
    3. Sao luu pg_dump + staging.env.
    4. Migrate (--apply) + grant (chi khi co -Migrate, co xac nhan).
    5. Doi symlink current, restart 11ship-staging.
    6. Health check; neu that bai tu quay lai release cu (chi ma, khong dung schema).
  KHONG lam: sua /etc/11ship/staging.env, tao file tin cay Android, ghep cap SMS Gateway (xem runbook muc 4, 5, 7).
  Khong in/gui bi mat. Script chi doc ten bien/ton tai file, khong doc gia tri.
.EXAMPLE
  .\deploy-m01.ps1 -Package .\11ship-0123abc...-ubuntu24-amd64.tar.gz -DryRun
  .\deploy-m01.ps1 -Package .\11ship-<sha>-ubuntu24-amd64.tar.gz -Migrate
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Package,
  [string]$VpsHost = '103.9.78.67',
  [string]$User = 'root',
  [int]$Port = 22,
  [string]$IdentityFile,
  [string]$Origin = 'https://103.9.78.67.sslip.io',
  [string]$ExpectedSha,
  [switch]$Migrate,       # ap dung migration + grant (can ban sao luu; hoi xac nhan)
  [switch]$DryRun,        # chi kiem tra truoc, dung truoc khi tai len
  [switch]$AllowPassword, # cho phep hoi mat khau (mac dinh BatchMode=yes, can khoa SSH)
  [switch]$Yes            # bo qua cau hoi xac nhan
)
$ErrorActionPreference = 'Stop'

function Say($m)  { Write-Host "[deploy-m01] $m" }
function Fail($m) { Write-Host "[deploy-m01] LOI: $m" -ForegroundColor Red; exit 1 }
function Confirm-Step($q) {
  if ($Yes) { return }
  if ((Read-Host "$q (go 'yes' de tiep tuc)") -ne 'yes') { Fail 'Da dung theo yeu cau, chua doi gi them.' }
}

# --- 0. Cong cu va tham so --------------------------------------------------------------------------------------
foreach ($t in 'ssh', 'scp') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Fail "Thieu '$t' (bat OpenSSH Client trong Windows Optional Features)." } }
if (-not (Test-Path -LiteralPath $Package -PathType Leaf)) { Fail "Khong thay goi: $Package" }
$Package = (Resolve-Path -LiteralPath $Package).Path
$pkgName = Split-Path $Package -Leaf
if ($pkgName -notmatch '^11ship-([0-9a-f]{40})-ubuntu24-amd64\.tar\.gz$') { Fail "Ten goi phai la 11ship-<sha40>-ubuntu24-amd64.tar.gz, dang la: $pkgName" }
$Sha = $Matches[1]
if ($ExpectedSha -and $ExpectedSha.ToLower() -ne $Sha) { Fail "SHA trong ten goi ($Sha) khac -ExpectedSha ($ExpectedSha)." }
if ($VpsHost -notmatch '^[A-Za-z0-9._-]+$' -or $User -notmatch '^[a-z_][a-z0-9_-]*$') { Fail 'VpsHost/User chua ky tu khong hop le.' }
if ($Origin -notmatch '^https://[A-Za-z0-9.-]+$') { Fail 'Origin phai la https://host (khong co duong dan).' }

$sshOpts = @('-p', $Port, '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15')
if (-not $AllowPassword) { $sshOpts += @('-o', 'BatchMode=yes') }
if ($IdentityFile) { $sshOpts += @('-i', $IdentityFile) }
$scpOpts = @('-P', $Port, '-o', 'ConnectTimeout=15') + $(if (-not $AllowPassword) { @('-o', 'BatchMode=yes') } else { @() }) + $(if ($IdentityFile) { @('-i', $IdentityFile) } else { @() })
$target = "$User@$VpsHost"

# Chay mot doan bash tren VPS qua stdin (tranh loi quote cua Windows). Script chi chua ASCII.
function Invoke-Remote([string]$Script, [string]$What) {
  $body = "set -euo pipefail`nSHA='$Sha'`nPKG='$pkgName'`nHASH='$localHash'`n" + ($Script -replace "`r`n", "`n")
  $body | & ssh @sshOpts $target 'bash -s'
  if ($LASTEXITCODE -ne 0) { Fail "$What that bai (ma $LASTEXITCODE)." }
}

# --- 1. Kiem tra truoc (local) ----------------------------------------------------------------------------------
Say "Goi: $pkgName"
$sha256Side = "$Package.sha256"
$localHash = (Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash.ToLower()
if (Test-Path -LiteralPath $sha256Side) {
  $want = ((Get-Content -LiteralPath $sha256Side -TotalCount 1) -split '\s+')[0].ToLower()
  if ($want -ne $localHash) { Fail "sha256 cua goi ($localHash) khac file .sha256 ($want). Tai lai artifact." }
  Say 'sha256 khop file .sha256.'
} else {
  Say "CANH BAO: khong co $pkgName.sha256 canh goi; chi tinh hash local ($localHash)."
  Confirm-Step 'Tiep tuc khong co file .sha256?'
}

# --- 1b. Kiem tra truoc (VPS, chi doc) -------------------------------------------------------------------------
Say "Kiem tra VPS $target ..."
Invoke-Remote @'
fail() { echo "PRECHECK LOI: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || fail "can quyen root (dang la $(id -un))"
command -v node >/dev/null || fail "thieu node"
command -v pg_dump >/dev/null || fail "thieu pg_dump"
[ -L /opt/11ship/current ] || fail "/opt/11ship/current khong phai symlink"
echo "current -> $(readlink /opt/11ship/current)"
systemctl is-active --quiet 11ship-staging && echo "service: active" || echo "CANH BAO: 11ship-staging dang khong active"
avail=$(df -Pm /opt /var/backups 2>/dev/null | awk 'NR>1{print $4}' | sort -n | head -1)
[ "${avail:-0}" -ge 1024 ] || fail "con duoi 1 GB trong /opt hoac /var/backups (${avail:-?} MB)"
[ -f /etc/11ship/staging.env ] || fail "thieu /etc/11ship/staging.env"
grep -q '^APP_ENV=production$' /etc/11ship/staging.env || fail "staging.env chua APP_ENV=production (runbook muc 5; chua sua env)"
for f in android-signers.json android-attestation-roots.pem android-attestation-revocation.json; do
  [ -f "/etc/11ship/trust/$f" ] || fail "thieu /etc/11ship/trust/$f (runbook muc 4); dich vu se tu choi khoi dong"
done
[ -d "/opt/11ship/releases/$SHA" ] && echo "release $SHA da co tren VPS (se dung lai sau khi kiem tra RELEASE.json)" || echo "release $SHA chua co"
echo "PRECHECK OK"
'@ 'Kiem tra VPS'

if ($Migrate) {
  Invoke-Remote @'
[ -f /root/ship11-secrets/operator.env ] || { echo "thieu /root/ship11-secrets/operator.env" >&2; exit 1; }
grep -q '^APP_ENV=production$' /root/ship11-secrets/operator.env || { echo "operator.env chua APP_ENV=production (runbook muc 3)" >&2; exit 1; }
echo "operator.env OK"
'@ 'Kiem tra operator.env'
}

if ($DryRun) { Say 'DryRun: kiem tra xong, chua tai len hay doi gi tren VPS.'; exit 0 }
Confirm-Step "Tai goi len $target va chuan bi release $Sha (chua doi current)?"

# --- 2. Tai len va kiem tra --------------------------------------------------------------------------------------
Say 'Tai goi len ...'
Invoke-Remote 'install -d -m 700 /root/11ship-upload' 'Tao thu muc tai len'
& scp @scpOpts $Package "${target}:/root/11ship-upload/$pkgName"
if ($LASTEXITCODE -ne 0) { Fail 'scp that bai.' }
Invoke-Remote @'
cd /root/11ship-upload
echo "$HASH  $PKG" | sha256sum -c -
install -d -m 755 /opt/11ship/releases
if [ ! -d "/opt/11ship/releases/$SHA" ]; then tar -xzf "$PKG" -C /opt/11ship/releases; fi
[ -d "/opt/11ship/releases/$SHA" ] || { echo "goi khong giai nen ra /opt/11ship/releases/$SHA" >&2; exit 1; }
rel=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sha))' "/opt/11ship/releases/$SHA/RELEASE.json")
[ "$rel" = "$SHA" ] || { echo "RELEASE.json sha ($rel) khac $SHA" >&2; exit 1; }
echo "RELEASE.json khop $SHA"
'@ 'Kiem tra goi tren VPS'

# --- 3. Sao luu (bat buoc truoc migrate va doi release) -----------------------------------------------------------
Say 'Sao luu pg_dump va staging.env ...'
Invoke-Remote @'
ts=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 /var/backups/11ship
sudo -u postgres pg_dump -Fc ship11_staging > "/var/backups/11ship/ship11_staging-$ts.dump"
cp -a /etc/11ship/staging.env "/var/backups/11ship/staging.env.$ts"
chmod 600 "/var/backups/11ship/ship11_staging-$ts.dump" "/var/backups/11ship/staging.env.$ts"
ls -l "/var/backups/11ship/ship11_staging-$ts.dump"
echo "Nho chep ban sao ra ngoai VPS (runbook muc 2)."
'@ 'Sao luu'

# --- 4. Migrate + grant (tuy chon) ---------------------------------------------------------------------------------
if ($Migrate) {
  Say 'Migration o che do doc (liet ke pending) ...'
  Invoke-Remote @'
set -a; . /root/ship11-secrets/operator.env; set +a
cd "/opt/11ship/releases/$SHA"
node scripts/db-migrate-remote.js
'@ 'Liet ke migration'
  Confirm-Step 'Danh sach pending o tren dung nhu ky vong? Ap dung migration + grant'
  Invoke-Remote @'
set -a; . /root/ship11-secrets/operator.env; set +a
cd "/opt/11ship/releases/$SHA"
node scripts/db-migrate-remote.js --apply
sudo -u postgres psql -d ship11_staging -v ON_ERROR_STOP=1 -f "ops/selfhosted/02-runtime-grants.sql"
if [ -f ops/selfhosted/03-runtime-function-grants.sql ]; then
  sudo -u postgres psql -d ship11_staging -v ON_ERROR_STOP=1 -f "ops/selfhosted/03-runtime-function-grants.sql"
fi
'@ 'Migrate/grant (khong chay lai bang cach xoa/reset; xem runbook muc 3)'
} else {
  Say 'Bo qua migrate (khong co -Migrate). Neu release moi co migration pending, dich vu co the loi.'
}

# --- 5. Doi release + restart + health ---------------------------------------------------------------------------
Confirm-Step "Doi /opt/11ship/current sang $Sha va restart 11ship-staging?"
Invoke-Remote @'
prev=$(readlink /opt/11ship/current)
echo "$prev" > /root/11ship-upload/previous-release.txt
ln -sfn "/opt/11ship/releases/$SHA" /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
systemctl reset-failed 11ship-staging 2>/dev/null || true
systemctl restart 11ship-staging
ok=0
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/v1/health/ready >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = 1 ]; then echo "health/ready OK (loopback)"; exit 0; fi
echo "health/ready THAT BAI; quay lai $prev (chi ma)" >&2
journalctl -u 11ship-staging -n 40 --no-pager >&2 || true
ln -sfn "$prev" /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
systemctl restart 11ship-staging || true
exit 1
'@ 'Doi release / health check (da quay lai release cu neu health that bai; schema khong duoc hoan lai)'

# --- 6. Kiem tra cong khai ------------------------------------------------------------------------------------------
Say "Kiem tra $Origin ..."
$bad = 0
foreach ($p in '/v1/health/ready', '/v1/client-auth/config', '/v1/account-recovery/config') {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri ($Origin + $p) -TimeoutSec 20
    Say ("{0} -> {1} {2}" -f $p, $r.StatusCode, ($r.Content -replace '\s+', ' ').Substring(0, [Math]::Min(120, $r.Content.Length)))
  } catch { Write-Host "[deploy-m01] $p -> LOI: $($_.Exception.Message)" -ForegroundColor Red; $bad++ }
}
if ($bad) { Fail "$bad endpoint cong khai loi. Release da doi sang $Sha; xem 'journalctl -u 11ship-staging' hoac rollback (runbook muc 9)." }
Say "XONG: release $Sha dang chay. Cac muc con lai (APK, SMS Gateway, thu that) theo runbook muc 7-8 - CHUA KIEM."
