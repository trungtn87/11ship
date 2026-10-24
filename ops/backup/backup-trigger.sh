#!/usr/bin/env bash
# M12-F: runs the "Sao lưu ngay" job that SYSTEM queued in the Web Admin. The application only INSERTs the row; this script (started every minute by a timer, as the database
# owner role) claims it, runs backup.sh and writes the outcome back. One job at a time (database unique index) and one backup at a time (backup.sh's lock): a job that finds
# another backup running goes back to QUEUED and is taken at a later minute, never run twice.
set -euo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
: "${BACKUP_SOURCE_URL:?}" "${BACKUP_DIR:?}"
sql() { psql "$BACKUP_SOURCE_URL" -v ON_ERROR_STOP=1 -Atq "$@"; }
# A job whose runner died never stays RUNNING.
sql -c "UPDATE app.backup_jobs SET state = 'FAILED', error_code = 'INTERRUPTED', finished_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1 WHERE state = 'RUNNING' AND started_at < clock_timestamp() - interval '6 hours'" || true
job="$(sql -c "UPDATE app.backup_jobs SET state = 'RUNNING', started_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1 WHERE job_id = (SELECT job_id FROM app.backup_jobs WHERE state = 'QUEUED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING job_id")"
[[ -n "$job" ]] || exit 0
[[ "$job" =~ ^[0-9a-f-]{36}$ ]] || { bk_log "unexpected job id"; exit 1; }
result="$(mktemp "$BACKUP_DIR/.result.XXXXXX")"
trap 'rm -f -- "$result"' EXIT
set +e
BACKUP_KIND=MANUAL BACKUP_TRIGGER=WEB BACKUP_RESULT_FILE="$result" "$here/backup.sh"
status=$?
set -e
if (( status == 75 )); then
  sql -c "UPDATE app.backup_jobs SET state = 'QUEUED', started_at = NULL, version = version + 1 WHERE job_id = '$job'"
  bk_log "another backup is running; the job waits"
  exit 0
fi
backup_id="$(head -1 "$result" 2>/dev/null || true)"
[[ "$backup_id" =~ ^[0-9a-f-]{36}$ ]] || backup_id=""
if (( status == 0 )); then
  sql -c "UPDATE app.backup_jobs SET state = 'DONE', backup_id = NULLIF('$backup_id', '')::uuid, finished_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1 WHERE job_id = '$job'"
else
  code="$(sql -c "SELECT COALESCE((SELECT error_code FROM app.backup_records WHERE backup_id = NULLIF('$backup_id', '')::uuid), 'DUMP_FAILED')")"
  [[ "$code" =~ ^[A-Z_]{1,40}$ ]] || code=DUMP_FAILED
  sql -c "UPDATE app.backup_jobs SET state = 'FAILED', error_code = '$code', backup_id = NULLIF('$backup_id', '')::uuid, finished_at = date_trunc('milliseconds', clock_timestamp()), version = version + 1 WHERE job_id = '$job'"
fi
exit "$status"
