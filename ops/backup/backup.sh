#!/usr/bin/env bash
# M12-F: one backup run. Dump -> encrypt -> VERIFY (restore into a scratch database and check) -> copy off the VPS -> record the result in app.backup_records.
# A backup is recorded SUCCEEDED only when it was encrypted AND verified; "offsite" is recorded true only when the upload command and the remote checksum command both succeeded.
# Without an off-VPS target the run still verifies and records it, with offsite=false: the Web Admin then says "no copy outside the VPS" and never shows the policy as healthy.
#
# Environment (all required unless marked optional):
#   BACKUP_SOURCE_URL     owner-role URL of the database to back up (read + write of app.backup_records)
#   BACKUP_SCRATCH_URL    admin URL of a server where scratch databases may be created (database postgres)
#   BACKUP_PASSPHRASE_FILE  file holding the encryption passphrase (mode 600, kept off the VPS as well)
#   BACKUP_DIR            local directory for encrypted files (mode 700)
#   BACKUP_KIND           DAILY | WEEKLY | PRE_MIGRATION | PRE_RESTORE | MANUAL (default DAILY)
#   BACKUP_UPLOAD_CMD     (optional) command that copies the file whose path is its last argument to the off-VPS store, e.g. 'rclone copyto' wrappers
#   BACKUP_REMOTE_SHA_CMD (optional) command printing the sha256 of the uploaded copy; must equal the local one
set -euo pipefail

: "${BACKUP_SOURCE_URL:?}" "${BACKUP_SCRATCH_URL:?}" "${BACKUP_PASSPHRASE_FILE:?}" "${BACKUP_DIR:?}"
kind="${BACKUP_KIND:-DAILY}"
case "$kind" in DAILY|WEEKLY|PRE_MIGRATION|PRE_RESTORE|MANUAL) ;; *) echo "REFUSED: unknown kind $kind" >&2; exit 64;; esac
here="$(cd "$(dirname "$0")" && pwd)"
id="$(cat /proc/sys/kernel/random/uuid)"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/ship11-$kind-$stamp-${id:0:8}.dump.enc"
scratch="ship11_verify_${stamp,,}_${id:0:6}"
scratch="${scratch//-/_}"
sql() { psql "$BACKUP_SOURCE_URL" -v ON_ERROR_STOP=1 -Atq "$@"; }
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"

sql -c "INSERT INTO app.backup_records (backup_id, kind, state, started_at) VALUES ('$id', '$kind', 'RUNNING', date_trunc('milliseconds', clock_timestamp()))"
fail() {
  local code="$1"
  sql -c "UPDATE app.backup_records SET state = 'FAILED', error_code = '$code', finished_at = date_trunc('milliseconds', clock_timestamp()) WHERE backup_id = '$id'" || true
  rm -f "$file"
  echo "BACKUP FAILED: $code" >&2
  exit 1
}

before_audit="$(sql -c 'SELECT count(*) FROM app.audit_logs')"
before_ledger="$(sql -c 'SELECT count(*) FROM app.wallet_ledger_entries')"
schema_before="$(sql -c "SELECT COALESCE((SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1), 'NONE')")"

(pg_dump -Fc --no-owner "$BACKUP_SOURCE_URL" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$file") || fail DUMP_FAILED
chmod 600 "$file"
sha="$(sha256sum "$file" | cut -d' ' -f1)"
size="$(stat -c %s "$file")"

# Verify by restoring the ENCRYPTED file exactly as a real restore would.
verify="$("$here/restore-rehearsal.sh" "$file" "$BACKUP_PASSPHRASE_FILE" "$BACKUP_SCRATCH_URL" "$scratch")" || fail VERIFY_RESTORE_FAILED
val() { printf '%s\n' "$verify" | sed -n "s/^$1|//p"; }
after_audit="$(sql -c 'SELECT count(*) FROM app.audit_logs')"
after_ledger="$(sql -c 'SELECT count(*) FROM app.wallet_ledger_entries')"
# The two tables are append-only: what the restored copy holds must lie between the counts before and after the dump.
[[ "$(val schema_version)" == "$schema_before" ]] || fail VERIFY_SCHEMA_MISMATCH
(( $(val audit_logs) >= before_audit && $(val audit_logs) <= after_audit )) || fail VERIFY_AUDIT_COUNT
(( $(val wallet_ledger_entries) >= before_ledger && $(val wallet_ledger_entries) <= after_ledger )) || fail VERIFY_LEDGER_COUNT
[[ "$(val ledger_wallet_difference_vnd)" == "0" ]] || fail VERIFY_LEDGER_DIFFERENCE
note="restored into scratch DB and checked: schema $schema_before, audit $(val audit_logs), ledger $(val wallet_ledger_entries), users $(val users)"

offsite=false
if [[ -n "${BACKUP_UPLOAD_CMD:-}" && -n "${BACKUP_REMOTE_SHA_CMD:-}" ]]; then
  if $BACKUP_UPLOAD_CMD "$file" && [[ "$($BACKUP_REMOTE_SHA_CMD "$file")" == "$sha" ]]; then
    offsite=true
  else
    note="$note; OFF-VPS COPY FAILED"
  fi
else
  note="$note; no off-VPS target configured"
fi

sql -c "UPDATE app.backup_records SET state = 'SUCCEEDED', finished_at = date_trunc('milliseconds', clock_timestamp()), size_bytes = $size, sha256 = '$sha', schema_version = '$schema_before',
        encrypted = true, offsite = $offsite, verified_at = date_trunc('milliseconds', clock_timestamp()), verify_note = left('$note', 500) WHERE backup_id = '$id'"

# Local retention: 7 daily + 4 weekly files (the off-VPS store applies its own retention). PRE_* and MANUAL files are kept.
prune() { { ls -1t "$BACKUP_DIR"/ship11-"$1"-*.dump.enc 2>/dev/null || true; } | tail -n +"$(($2 + 1))" | xargs -r rm -f --; }
prune DAILY 7
prune WEEKLY 4
echo "BACKUP OK id=$id kind=$kind size=$size sha256=$sha offsite=$offsite"
echo "$note"
