#!/usr/bin/env bash
# M12-F: the RESTORE DRILL — proves that what is on Google Drive can really be brought back: download the newest backup, check, decrypt, restore it into a SCRATCH database and run
# verify.sql. It never touches the live database, sends no SMS/push/Discord and moves no money (the scratch database has no workers). The result is reported to M13 as RESTORE_TEST.
# Run it from a timer (weekly is enough) or by hand. Settings as backup.sh (+ BACKUP_SCRATCH_URL).
set -euo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
: "${BACKUP_SCRATCH_URL:?}" "${BACKUP_DIR:?}"
bk_lock "$BACKUP_DIR/.drill.lock" || { bk_log "another drill is running"; exit 75; }
tmp="$(mktemp -d "$BACKUP_DIR/.drill.XXXXXX")"
trap 'rm -rf -- "$tmp"' EXIT
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
if ! bk_drive_configured; then bk_report RESTORE_TEST false "" DRIVE_NOT_CONFIGURED; echo "DRILL FAILED: Drive is not configured" >&2; exit 1; fi
if ! "$here/restore-fetch.sh" "${1:-latest}" "$tmp/fetched" >"$tmp/fetch.log" 2>&1; then
  bk_log "drill: fetch failed: $(bk_redact <"$tmp/fetch.log" | tail -2 | tr '\n' ' ')"
  bk_report RESTORE_TEST false "" VERIFY_RESTORE; exit 1
fi
name="$(sed -n 's/^FETCHED \([^ ]*\) .*/\1/p' "$tmp/fetch.log")"
if result="$("$here/restore-rehearsal.sh" "$tmp/fetched/$name.tar.enc" "$BACKUP_PASSPHRASE_FILE" "$BACKUP_SCRATCH_URL" "ship11_restore_drill_${stamp,,}" 2>"$tmp/restore.err")"; then
  bk_log "drill OK for $name"; printf '%s\n' "$result"
  bk_report RESTORE_TEST true "" ""
else
  bk_log "drill FAILED for $name: $(bk_redact <"$tmp/restore.err" | tail -2 | tr '\n' ' ')"
  bk_report RESTORE_TEST false "" VERIFY_RESTORE; exit 1
fi
