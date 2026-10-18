#!/usr/bin/env bash
# Invoked ONLY by deploy-11ship.ps1 in a detached transient systemd unit. No terminal, no secrets in arguments/logs.
set -Eeuo pipefail
umask 077
SHA=${1:?}; JOB=${2:?}; UPLOAD=${3:?}
[[ "$SHA" =~ ^[0-9a-f]{40}$ && "$JOB" =~ ^[0-9a-f]{32}$ && "$UPLOAD" = "/root/11ship-upload/$JOB" ]] || exit 2
ROOT=/opt/11ship
STATE=/var/lib/11ship-deploy
BACKUPS=/var/backups/11ship
SERVICE=11ship-staging
ORIGIN=https://103.9.78.67.sslip.io
step=connect; switched=0; rollback_safe=0; rollback=not-needed; previous=unknown
mkdir -p "$STATE"
chmod 700 "$STATE"
receipt="$STATE/$JOB.json"
write_receipt() {
  local status=$1 reason=$2 service
  service=$(systemctl is-active "$SERVICE" 2>/dev/null || true)
  [[ "$service" =~ ^[a-z-]+$ ]] || service=unknown
  printf '{"status":"%s","step":"%s","reason":"%s","service":"%s","rollback":"%s","sha":"%s","previous":"%s"}\n' "$status" "$step" "$reason" "$service" "$rollback" "$SHA" "$previous" > "$receipt.tmp"
  mv -f "$receipt.tmp" "$receipt"
}
fail() { write_receipt failed "$1"; exit 1; }
atomic_current() {
  rm -f "$ROOT/.current-$JOB" || return 1
  ln -s "$1" "$ROOT/.current-$JOB" || return 1
  mv -Tf "$ROOT/.current-$JOB" "$ROOT/current"
}
health() {
  local body
  systemctl is-active --quiet "$SERVICE" || return 1
  body=$(curl --fail --silent --show-error --connect-timeout 5 --max-time 10 http://127.0.0.1:3000/v1/health/ready 2>/dev/null) || return 1
  [[ "$body" = '{"data":{"status":"ready"}}' ]] || return 1
  body=$(curl --fail --silent --show-error --connect-timeout 5 --max-time 10 "$ORIGIN/v1/health/ready" 2>/dev/null) || return 1
  [[ "$body" = '{"data":{"status":"ready"}}' ]] || return 1
  # Compare real Admin entry point, not merely an arbitrary HTTP 200 page.
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$ORIGIN/" -o "$UPLOAD/admin.html" 2>/dev/null || return 1
  cmp -s "$UPLOAD/admin.html" "$ROOT/current/apps/admin-web/dist/index.html" || return 1
  # Readiness uses DatabaseService.isReady; this read also verifies the actual expected DB.
  [[ "$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d ship11_staging -c 'SELECT current_database()' 2>/dev/null)" = ship11_staging ]]
}
on_error() {
  trap - ERR HUP INT TERM
  if [[ "$switched" = 1 ]]; then
    if [[ "$rollback_safe" = 1 ]]; then
      rollback=failed
      if atomic_current "$previous" && systemctl restart "$SERVICE"; then
        for _ in {1..15}; do
          if health; then rollback=restored; break; fi
          sleep 2
        done
      fi
    else rollback=unsafe-schema-changed; fi
  fi
  write_receipt failed "${failure_reason:-STEP_FAILED}"
  exit 1
}
trap on_error ERR HUP INT TERM
exec 9>/var/lock/11ship-deploy.lock
flock -n 9 || fail DEPLOY_BUSY
printf '%s' "$JOB" > "$STATE/last-job.tmp"
mv -f "$STATE/last-job.tmp" "$STATE/last-job"
write_receipt running OK
[[ $(id -u) = 0 && -L "$ROOT/current" ]] || fail VPS_LAYOUT_INVALID
previous=$(readlink -f "$ROOT/current")
[[ "$previous" = "$ROOT/releases/"* && "$previous" != *'"'* && "$previous" != *'..'* && "$previous" =~ ^[a-zA-Z0-9/._-]+$ ]] || fail PREVIOUS_RELEASE_INVALID
for cmd in node python3 pg_dump pg_restore psql curl runuser sha256sum tar systemctl; do command -v "$cmd" >/dev/null || fail VPS_TOOL_MISSING; done
[[ $(node -p 'process.versions.node.split(".")[0]') = 24 ]] || fail NODE_VERSION_INVALID
[[ $(env -u APP_ENV node --env-file=/etc/11ship/staging.env -p 'process.env.APP_ENV') = production ]] || fail RUNTIME_NOT_PRODUCTION
if [[ $(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sourceSha' "$previous/RELEASE.json") = "$SHA" ]]; then
  step=health
  health || fail EXISTING_RELEASE_UNHEALTHY
  write_receipt unchanged OK; exit 0
fi
[[ -r /root/ship11-secrets/operator.env && -r /etc/11ship/staging.env ]] || fail OPERATOR_CONFIG_MISSING
[[ $(df -Pm "$ROOT" /var | awk 'NR>1{print $4}' | sort -n | head -1) -ge 1024 ]] || fail DISK_SPACE_LOW
step=package; write_receipt running OK
cd "$UPLOAD"
PKG="11ship-$SHA-ubuntu24-amd64.tar.gz"
sha256sum -c "$PKG.sha256" > verify.log 2>&1 || fail CHECKSUM_INVALID
# Reject traversal, devices and links before extraction or execution of any artifact content.
python3 - "$PKG" "11ship-$SHA-ubuntu24-amd64" <<'PY'
import sys,tarfile
root=sys.argv[2]
with tarfile.open(sys.argv[1],'r:gz') as t:
 members=t.getmembers()
 if not members: raise SystemExit(1)
 for m in members:
  if not (m.isfile() or m.isdir()) or m.name.startswith('/') or '..' in m.name.split('/') or not (m.name==root or m.name.startswith(root+'/')): raise SystemExit(1)
PY
stage="$UPLOAD/extracted"
mkdir "$stage"
tar -xzf "$PKG" -C "$stage" --no-same-owner
new="$stage/11ship-$SHA-ubuntu24-amd64"
[[ $(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sourceSha' "$new/RELEASE.json") = "$SHA" ]] || fail SOURCE_SHA_INVALID
(cd "$new" && sha256sum -c MANIFEST.sha256 > "$UPLOAD/manifest.log" 2>&1) || fail MANIFEST_INVALID
node "$new/scripts/deploy/verify-ubuntu-artifact.mjs" "$UPLOAD/$PKG" "$SHA" > "$UPLOAD/artifact-check.log" 2>&1 || fail ARTIFACT_INVALID
# Config is parsed by the repository's own compiled loader in the runner; never print its contents.
step=preflight; write_receipt running OK
(
  set -a
  . /root/ship11-secrets/operator.env || exit 1
  set +a
  [[ "${APP_ENV:-}" = production && "${DB_REMOTE_TARGET:-}" = SELF_HOSTED ]] || exit 1
  cd "$new" || exit 1
  node scripts/db-migrate-remote.js
) > "$UPLOAD/preflight.log" 2>&1 || fail MIGRATION_PREFLIGHT_FAILED
if ! node "$new/scripts/deploy/deploy-check.mjs" "$new" "$previous" "$UPLOAD/preflight.log" > "$UPLOAD/plan.json" 2> "$UPLOAD/policy-error.log"; then
  reason=$(cat "$UPLOAD/policy-error.log")
  [[ "$reason" =~ ^(MIGRATION_REQUIRES_REVIEW:[0-9]+_[a-z0-9_-]+|MIGRATION_HISTORY_CHANGED|GRANTS_REQUIRES_REVIEW|PREFLIGHT_INVALID)$ ]] || reason=DEPLOY_POLICY_INVALID
  fail "$reason"
fi
pending=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).pending.length' "$UPLOAD/plan.json")
rollback_safe=1
[[ "$pending" = 0 ]] || rollback_safe=0
# Grants must be forward-only approved GRANT statements (deploy-check). Changed grants also disable automatic rollback.
for grant in 02-runtime-grants.sql 03-runtime-function-grants.sql; do
  cmp -s "$new/ops/selfhosted/$grant" "$previous/ops/selfhosted/$grant" || rollback_safe=0
done
step=backup; write_receipt running OK
backup="$BACKUPS/$(date -u +%Y%m%dT%H%M%SZ)-$JOB"
install -d -m 700 "$backup"
runuser -u postgres -- pg_dump -Fc -d ship11_staging > "$backup/database.dump" 2> "$UPLOAD/backup-error.log"
[[ -s "$backup/database.dump" ]] || fail BACKUP_EMPTY
pg_restore --list "$backup/database.dump" > /dev/null 2> "$UPLOAD/backup-verify.log" || fail BACKUP_INVALID
sha256sum "$backup/database.dump" > "$backup/database.dump.sha256"
cp -a /etc/11ship/staging.env "$backup/staging.env"
chmod 600 "$backup"/*
# Preserve a durable recovery record before any possible schema mutation.
printf '%s\n' "$previous" > "$backup/previous-release.txt"
step=migration; write_receipt running OK
if [[ "$pending" != 0 ]]; then
  (
    set -a; . /root/ship11-secrets/operator.env || exit 1; set +a
    [[ "${APP_ENV:-}" = production && "${DB_REMOTE_TARGET:-}" = SELF_HOSTED ]] || exit 1
    cd "$new" || exit 1
    node scripts/db-migrate-remote.js --apply || exit 1
    node scripts/db-migrate-remote.js
  ) > "$UPLOAD/migration.log" 2>&1 || fail MIGRATION_FAILED_CODE_UNCHANGED
  grep -Eq 'db:migrate:remote: [0-9]+ applied, 0 pending of' "$UPLOAD/migration.log" || fail MIGRATION_INCOMPLETE
fi
for grant in 02-runtime-grants.sql 03-runtime-function-grants.sql; do
  if [[ "$pending" != 0 ]] || ! cmp -s "$new/ops/selfhosted/$grant" "$previous/ops/selfhosted/$grant"; then
    runuser -u postgres -- psql -X -d ship11_staging -v ON_ERROR_STOP=1 -f "$new/ops/selfhosted/$grant" > "$UPLOAD/grants.log" 2>&1 || fail GRANTS_FAILED_CODE_UNCHANGED
  fi
done
release="$ROOT/releases/11ship-$SHA-ubuntu24-amd64"
if [[ -e "$release" ]]; then
  # An immutable existing release must be exactly the verified artifact, not merely claim the SHA.
  diff -qr "$new" "$release" > "$UPLOAD/reuse.log" || fail EXISTING_RELEASE_DIFFERS
else mv "$new" "$release"; fi
step=restart; write_receipt running OK
# No modification of env, trust files, nginx, TLS, firewall, service unit or gateway.
switched=1
atomic_current "$release"
systemctl restart "$SERVICE"
step=health; write_receipt running OK
for _ in {1..20}; do
  if health; then write_receipt success OK; exit 0; fi
  sleep 3
done
failure_reason=HEALTH_FAILED
on_error
