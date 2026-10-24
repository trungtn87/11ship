#!/usr/bin/env bash
# M12-F: one backup run.
#   PostgreSQL (pg_dump, never a copy of the running data directory) [+ extra files] + manifest -> one tar -> encrypted (openssl AES-256, passphrase file)
#   -> restore of the ENCRYPTED file into a scratch database and checks (verify.sql) -> upload to the Google Drive folder with rclone -> check the copy on Drive (size + MD5)
#   -> retention (only after that) -> record in app.backup_records -> report to M13 (Discord alerts).
# The run is "successful" ONLY when the copy outside the VPS was verified. Every step before that is recorded on its own (STARTED, LOCAL, UPLOADED, VERIFIED) and a failure keeps
# the encrypted local copy for the retry of the next run, within a size cap and a number of attempts.
#
# Settings: see backup.env.example. Exit codes: 0 verified outside the VPS, 1 failed (recorded), 64 bad settings, 75 another run is active (nothing is created).
set -euo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

: "${BACKUP_SOURCE_URL:?}" "${BACKUP_SCRATCH_URL:?}" "${BACKUP_DIR:?}"
kind="${BACKUP_KIND:-DAILY}"
trigger="${BACKUP_TRIGGER:-MANUAL}"
case "$kind" in DAILY|WEEKLY|PRE_MIGRATION|PRE_RESTORE|MANUAL) ;; *) echo "REFUSED: unknown kind $kind" >&2; exit 64;; esac
case "$trigger" in TIMER|DEPLOY|MANUAL|WEB) ;; *) echo "REFUSED: unknown trigger $trigger" >&2; exit 64;; esac
spool_max_mb="${BACKUP_SPOOL_MAX_MB:-4096}"
min_free_mb="${BACKUP_MIN_FREE_MB:-1024}"
warn_percent="${BACKUP_SPOOL_WARN_PERCENT:-80}"
max_attempts="${BACKUP_UPLOAD_ATTEMPTS:-5}"
keep_local="${BACKUP_KEEP_LOCAL_VERIFIED:-2}"

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
bk_lock "$BACKUP_DIR/.backup.lock" || { bk_log "another backup is running: nothing was started"; exit 75; }

id="$(cat /proc/sys/kernel/random/uuid)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
base="ship11-$kind-$stamp-${id:0:8}"
file="$BACKUP_DIR/$base.tar.enc"
manifest_file="$BACKUP_DIR/$base.manifest.json"
work=""
stage=STARTED
sql() { psql "$BACKUP_SOURCE_URL" -v ON_ERROR_STOP=1 -Atq "$@"; }
cleanup() { [[ -z "$work" ]] || rm -rf -- "$work"; }
trap cleanup EXIT

# Release and commit of the code that runs now (no secret in them): RELEASE.json of the current release, when there is one.
release=""; commit=""
if [[ -r "${BACKUP_RELEASE_FILE:-/opt/11ship/current/RELEASE.json}" ]]; then
  rel_out="$(python3 - "${BACKUP_RELEASE_FILE:-/opt/11ship/current/RELEASE.json}" <<'PY' || true
import json, re, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    d = {}
v = str(d.get('version') or d.get('release') or '')
s = str(d.get('sha') or d.get('commit') or '')
print((v if re.fullmatch(r'[A-Za-z0-9._-]{1,64}', v) else '-'), (s if re.fullmatch(r'[0-9a-f]{40}', s) else '-'))
PY
)"
  read -r release commit <<<"${rel_out:--  -}" || true
  [[ "$release" != "-" ]] || release=""; [[ "$commit" != "-" ]] || commit=""
fi

# A run that died (power, kill -9) leaves RUNNING behind: it ends INTERRUPTED, never "running" forever.
sql -c "UPDATE app.backup_records SET state = 'FAILED', error_code = 'INTERRUPTED', failed_stage = stage, finished_at = date_trunc('milliseconds', clock_timestamp()) WHERE state = 'RUNNING' AND started_at < clock_timestamp() - interval '6 hours'" || true

rec_insert() {
  sql -c "INSERT INTO app.backup_records (backup_id, kind, state, started_at, stage, trigger_kind, release_version, commit_sha) VALUES ('$id', '$kind', 'RUNNING', date_trunc('milliseconds', clock_timestamp()), 'STARTED', '$trigger', NULLIF('$release', ''), NULLIF('$commit', ''))"
}
if [[ -n "${BACKUP_RESULT_FILE:-}" ]]; then printf '%s\n' "$id" >"$BACKUP_RESULT_FILE"; fi
rec_insert

# A failure keeps the stage it stopped at and, from LOCAL on, the encrypted local copy (a good backup is never deleted because the upload failed).
fail() {
  local code="$1"
  sql -c "UPDATE app.backup_records SET state = 'FAILED', error_code = '$code', failed_stage = '$stage', finished_at = date_trunc('milliseconds', clock_timestamp()) WHERE backup_id = '$id'" || true
  if [[ "$stage" == "STARTED" ]]; then rm -f -- "$file" "$manifest_file"; fi
  bk_report BACKUP false "" "$code"
  bk_log "BACKUP FAILED at stage $stage: $code"
  exit 1
}

# ---- before anything is made: the tools, the key, the room -----------------------------------------------------------------------------
[[ -r "${BACKUP_PASSPHRASE_FILE:-/nonexistent}" ]] || fail PASSPHRASE_MISSING
server_major="$(( $(sql -c 'SHOW server_version_num') / 10000 ))"
tool_major="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
(( tool_major >= server_major )) || { bk_log "pg_dump $tool_major is older than the server $server_major"; fail PG_TOOL_OLD; }
bk_spool_prune "$BACKUP_DIR" "$keep_local"
used_mb=$(( $(bk_spool_bytes "$BACKUP_DIR") / 1048576 ))
if (( used_mb * 100 >= spool_max_mb * warn_percent )); then bk_log "WARNING: the backup folder uses ${used_mb} MB of its ${spool_max_mb} MB cap"; fi
(( $(bk_free_mb "$BACKUP_DIR") >= min_free_mb )) || fail DISK_LOW
db_mb="$(( $(sql -c 'SELECT pg_database_size(current_database())') / 1048576 + 1 ))"
(( $(bk_free_mb "$BACKUP_DIR") >= db_mb * 2 + min_free_mb / 4 )) || fail DISK_LOW

# ---- the bundle ------------------------------------------------------------------------------------------------------------------------
work="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
bk_log "dump ($kind, trigger $trigger)"
pg_dump -Fc --no-owner --file "$work/database.dump" "$BACKUP_SOURCE_URL" || fail DUMP_FAILED
schema_version="$(sql -c "SELECT COALESCE((SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1), 'NONE')")"
components=("database.dump:$(stat -c %s "$work/database.dump"):$(sha256sum "$work/database.dump" | cut -d' ' -f1)")
extra=()
if [[ -n "${BACKUP_EXTRA_PATHS:-}" ]]; then
  # Files outside the database (none today: menu and complaint pictures and shop logos are inside it). Copied AFTER the dump; see the consistency note in the manifest.
  read -r -a extra <<<"$BACKUP_EXTRA_PATHS"
  rel=(); for p in "${extra[@]}"; do [[ "$p" == /* && -e "$p" ]] || fail FILES_FAILED; rel+=("${p#/}"); done
  tar --create --file "$work/files.tar" --directory / --no-same-owner "${rel[@]}" || fail FILES_FAILED
  components+=("files.tar:$(stat -c %s "$work/files.tar"):$(sha256sum "$work/files.tar" | cut -d' ' -f1)")
fi
inventory="$(python3 - "$(sql -c 'SELECT pg_database_size(current_database())')" "${extra[*]:-}" <<'PY'
import json, sys
print(json.dumps({'menu_images': 'database', 'shop_logos': 'database', 'complaint_attachments': 'database', 'database_bytes': int(sys.argv[1]), 'extra_paths': sys.argv[2].split() if sys.argv[2] else []}))
PY
)"
python3 "$BK_TOOLS" manifest "$kind" "$trigger" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$release" "$commit" "$schema_version" "$(pg_dump --version | awk '{print $NF}')" "$(sql -c 'SHOW server_version')" "$inventory" "${components[@]}" >"$work/manifest.json"

before_audit="$(sql -c 'SELECT count(*) FROM app.audit_logs')"
before_ledger="$(sql -c 'SELECT count(*) FROM app.wallet_ledger_entries')"
(cd "$work" && tar --create --file - database.dump manifest.json $( [[ -f files.tar ]] && echo files.tar )) \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$file" || fail ENCRYPT_FAILED
sha="$(sha256sum "$file" | cut -d' ' -f1)"
size="$(stat -c %s "$file")"
rm -rf -- "$work"; work=""
printf '%s\n' "$id" >"$file.id"

# The spool cap: this copy must fit (older unsent copies make room), otherwise stop with SPOOL_FULL and keep nothing half made.
bk_spool_trim_unsent "$BACKUP_DIR" "$spool_max_mb"
(( $(bk_spool_bytes "$BACKUP_DIR") <= spool_max_mb * 1048576 )) || { rm -f -- "$file" "$file.id"; fail SPOOL_FULL; }

# ---- verify on the VPS: restore the ENCRYPTED file exactly as a real restore would --------------------------------------------------------
bk_log "restore check"
verify="$("$here/restore-rehearsal.sh" "$file" "$BACKUP_PASSPHRASE_FILE" "$BACKUP_SCRATCH_URL" "ship11_verify_${stamp,,}_${id:0:6}")" || { stage=STARTED; rm -f -- "$file" "$file.id"; fail VERIFY_RESTORE; }
val() { printf '%s\n' "$verify" | sed -n "s/^$1|//p"; }
after_audit="$(sql -c 'SELECT count(*) FROM app.audit_logs')"
after_ledger="$(sql -c 'SELECT count(*) FROM app.wallet_ledger_entries')"
check_fail() { rm -f -- "$file" "$file.id"; fail "$1"; }
[[ "$(val schema_version)" == "$schema_version" ]] || check_fail VERIFY_SCHEMA_MISMATCH
(( $(val audit_logs) >= before_audit && $(val audit_logs) <= after_audit )) || check_fail VERIFY_AUDIT_COUNT
(( $(val wallet_ledger_entries) >= before_ledger && $(val wallet_ledger_entries) <= after_ledger )) || check_fail VERIFY_LEDGER_COUNT
[[ "$(val ledger_wallet_difference_vnd)" == "0" ]] || check_fail VERIFY_LEDGER_DIFFERENCE
note="restored into scratch DB and checked: schema $schema_version, audit $(val audit_logs), ledger $(val wallet_ledger_entries), users $(val users)"

python3 - "$file" "$sha" "$size" "$kind" "$base" >"$manifest_file" <<'PY'
import json, sys
# The manifest that sits next to the bundle on Drive: readable without the passphrase, so the folder can be listed and checked. It holds no secret and no customer data.
file, sha, size, kind, base = sys.argv[1:6]
print(json.dumps({'format': 1, 'name': base + '.tar.enc', 'kind': kind, 'bundle_bytes': int(size), 'bundle_sha256': sha, 'encrypted': 'openssl enc -aes-256-cbc -pbkdf2 (passphrase kept outside the VPS)'}, sort_keys=True, indent=2))
PY
stage=LOCAL
sql -c "UPDATE app.backup_records SET stage = 'LOCAL', size_bytes = $size, sha256 = '$sha', schema_version = '$schema_version', encrypted = true, verified_at = date_trunc('milliseconds', clock_timestamp()), verify_note = left('$note', 500) WHERE backup_id = '$id'"
bk_log "local copy made and restore-checked ($size bytes)"

# ---- Google Drive ---------------------------------------------------------------------------------------------------------------------
bk_drive_configured || fail DRIVE_NOT_CONFIGURED
ok_offsite() {
  local rec="$1" ident="$2" localfile="$3"
  sql -c "UPDATE app.backup_records SET stage = 'VERIFIED', state = 'SUCCEEDED', offsite = true, offsite_verified_at = date_trunc('milliseconds', clock_timestamp()), error_code = NULL, failed_stage = NULL, finished_at = date_trunc('milliseconds', clock_timestamp()) WHERE backup_id = '$rec'"
  printf '%s\n' "$(date -u +%FT%TZ) $ident" >"$localfile.offsite"
}
bk_log "upload"
if ! bk_upload_verify "$file"; then
  attempts=$(( $(cat "$file.attempts" 2>/dev/null || echo 0) + 1 )); echo "$attempts" >"$file.attempts"
  fail "${BK_ERR:-UPLOAD_FAILED}"
fi
stage=UPLOADED; sql -c "UPDATE app.backup_records SET stage = 'UPLOADED' WHERE backup_id = '$id'"
stage=VERIFIED
ok_offsite "$id" "$base" "$file"

# The Sunday run of the daily chain also becomes the weekly copy (a server-side copy on Drive, checked), so daily and weekly are two separate chains with their own counts.
if [[ "$kind" == "DAILY" ]] && bk_is_weekly_day; then
  weekly="ship11-WEEKLY-$stamp-${id:0:8}"
  if bk_remote_copy_verify "$base.tar.enc" "$weekly.tar.enc" && bk_remote_copy_verify "$base.manifest.json" "$weekly.manifest.json"; then bk_log "weekly copy made"; else bk_log "WARNING: the weekly copy failed ($BK_ERR); the daily copy is fine"; fi
fi

# Retry what an earlier run could not send (bounded: BACKUP_UPLOAD_ATTEMPTS per file), then retention, then the local spool.
for old in $(ls -1tr "$BACKUP_DIR"/ship11-*.tar.enc 2>/dev/null); do
  [[ "$old" != "$file" && ! -e "$old.offsite" && -r "$old.id" ]] || continue
  tries="$(cat "$old.attempts" 2>/dev/null || echo 0)"
  (( tries < max_attempts )) || { bk_log "an earlier copy was not sent after $tries attempts; it stays local and is no longer retried"; continue; }
  oldid="$(cat "$old.id")"
  if bk_upload_verify "$old"; then ok_offsite "$oldid" "$(basename "$old" .tar.enc)" "$old"; bk_log "an earlier copy was sent now"; else echo $((tries + 1)) >"$old.attempts"; bk_log "retry failed (${BK_ERR:-UPLOAD_FAILED})"; fi
done
bk_remote_retention "${id:0:8}"
bk_spool_prune "$BACKUP_DIR" "$keep_local"
bk_report BACKUP true "$size" ""
echo "BACKUP OK id=$id kind=$kind size=$size offsite=true"
