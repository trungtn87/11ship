#!/usr/bin/env bash
# M12-F: functions of the backup job, sourced by backup.sh / restore-drill.sh / backup-trigger.sh and by the tests. No function here prints a secret: everything that comes from
# rclone or curl goes through `bk_redact` before it is logged, and nothing sets `-x`.

BK_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BK_TOOLS="$BK_HERE/backup_tools.py"
BK_NAME_RE='^ship11-(DAILY|WEEKLY|PRE_MIGRATION|PRE_RESTORE|MANUAL)-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'

bk_log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
bk_redact() { python3 "$BK_TOOLS" redact; }
bk_classify() { python3 "$BK_TOOLS" classify; }

# Sunday on the Vietnam calendar (the 03:00 run of Sunday also becomes the weekly copy). Takes an epoch so it can be tested at the day edges.
bk_is_weekly_day() { [[ "$(TZ=Asia/Ho_Chi_Minh date -d "@${1:-$(date +%s)}" +%u)" == "7" ]]; }

# One run at a time, whoever starts it (timer, deploy, the Web Admin's job, a person). The second one gets exit 75 and creates nothing.
bk_lock() {
  exec 9>"${1:?lock file}"
  flock -n 9 || return 75
}

bk_rclone() {
  timeout "${BACKUP_RCLONE_TIMEOUT:-7200}" "${BACKUP_RCLONE:-rclone}" --config "${BACKUP_RCLONE_CONFIG:?}" "$@"
}

# The Drive is "configured" only when there is a remote name, a readable config file and the rclone binary. Anything less is DRIVE_NOT_CONFIGURED, never a silent local-only success.
bk_drive_configured() {
  [[ -n "${BACKUP_REMOTE:-}" && -n "${BACKUP_RCLONE_CONFIG:-}" && -r "${BACKUP_RCLONE_CONFIG}" ]] && command -v "${BACKUP_RCLONE:-rclone}" >/dev/null 2>&1
}

bk_remote_root() { printf '%s:' "${BACKUP_REMOTE%%:*}"; }

# Upload <file> (+ its manifest sidecar) to the Drive folder and VERIFY the copy there: same size and same MD5 as the local file. Sets BK_ERR to a code on failure.
# Integrity here is size + the MD5 that Drive computed itself; the file is not downloaded again (that is the periodic restore drill's job).
bk_upload_verify() {
  local file="$1" name manifest remote_md5 local_md5 size out code listing facts remote_size
  name="$(basename "$file")"
  manifest="${file%.tar.enc}.manifest.json"
  size="$(stat -c %s "$file")"
  local_md5="$(md5sum "$file" | cut -d' ' -f1)"
  BK_ERR=''
  # Room on Drive first: a full Drive is told as such instead of failing half way.
  if out="$(bk_rclone about "$(bk_remote_root)" --json 2>&1)"; then
    local free
    free="$(printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("free", ""))' 2>/dev/null || true)"
    if [[ "$free" =~ ^[0-9]+$ ]] && (( free < size + size / 10 )); then
      BK_ERR=DRIVE_QUOTA
      bk_log "Drive has $free bytes free, the backup needs about $size"
      return 1
    fi
  fi
  if ! out="$(bk_rclone mkdir "$BACKUP_REMOTE" 2>&1)"; then
    code="$(printf '%s' "$out" | bk_classify)"; BK_ERR="$code"; bk_log "mkdir failed ($code): $(printf '%s' "$out" | bk_redact | head -c 300)"; return 1
  fi
  # The bundle first, its manifest second: a manifest on Drive means the bundle was complete.
  if ! out="$(bk_rclone copyto "$file" "$BACKUP_REMOTE/$name" 2>&1)"; then
    code="$(printf '%s' "$out" | bk_classify)"; BK_ERR="$code"; bk_log "upload failed ($code): $(printf '%s' "$out" | bk_redact | head -c 300)"; return 1
  fi
  if [[ -f "$manifest" ]] && ! out="$(bk_rclone copyto "$manifest" "$BACKUP_REMOTE/$(basename "$manifest")" 2>&1)"; then
    code="$(printf '%s' "$out" | bk_classify)"; BK_ERR="$code"; bk_log "manifest upload failed ($code): $(printf '%s' "$out" | bk_redact | head -c 300)"; return 1
  fi
  if ! listing="$(bk_rclone lsjson --hash --files-only "$BACKUP_REMOTE" 2>&1)"; then
    code="$(printf '%s' "$listing" | bk_classify)"; BK_ERR="$code"; bk_log "listing failed ($code)"; return 1
  fi
  if ! facts="$(printf '%s' "$listing" | python3 "$BK_TOOLS" remote "$name")"; then
    BK_ERR=UPLOAD_VERIFY; bk_log "the uploaded file is not in the Drive folder"; return 1
  fi
  remote_size="${facts%% *}"; remote_md5="${facts##* }"
  if [[ "$remote_size" != "$size" || "$remote_md5" != "$local_md5" ]]; then
    BK_ERR=UPLOAD_VERIFY; bk_log "the copy on Drive differs (size $remote_size/$size)"; return 1
  fi
  if [[ -f "$manifest" ]] && ! printf '%s' "$listing" | python3 "$BK_TOOLS" remote "$(basename "$manifest")" >/dev/null; then
    BK_ERR=UPLOAD_VERIFY; bk_log "the manifest is not in the Drive folder"; return 1
  fi
  return 0
}

# Copy a verified Drive file to another name INSIDE the same folder (server side, no download) and check the copy.
bk_remote_copy_verify() {
  local from="$1" to="$2" out listing facts
  BK_ERR=''
  if ! out="$(bk_rclone copyto "$BACKUP_REMOTE/$from" "$BACKUP_REMOTE/$to" 2>&1)"; then
    BK_ERR="$(printf '%s' "$out" | bk_classify)"; bk_log "server-side copy failed ($BK_ERR)"; return 1
  fi
  listing="$(bk_rclone lsjson --hash --files-only "$BACKUP_REMOTE" 2>/dev/null)" || { BK_ERR=UPLOAD_VERIFY; return 1; }
  local a b
  a="$(printf '%s' "$listing" | python3 "$BK_TOOLS" remote "$from")" || { BK_ERR=UPLOAD_VERIFY; return 1; }
  b="$(printf '%s' "$listing" | python3 "$BK_TOOLS" remote "$to")" || { BK_ERR=UPLOAD_VERIFY; return 1; }
  [[ "$a" == "$b" ]] || { BK_ERR=UPLOAD_VERIFY; return 1; }
}

# Retention on Drive. ONLY after a verified upload (the caller passes the id of this run, which is never deleted). It lists the folder, asks backup_tools.py which of OUR files fell
# out of the policy and deletes exactly those names, one `deletefile` each. No sync, no purge, no wildcard: a file with any other name is never touched.
bk_remote_retention() {
  local protect_id="${1:?id of the verified run}" listing names name
  listing="$(bk_rclone lsjson --files-only "$BACKUP_REMOTE" 2>/dev/null)" || { bk_log "retention skipped: could not list the Drive folder"; return 0; }
  names="$(printf '%s' "$listing" | python3 "$BK_TOOLS" retention "$protect_id")" || { bk_log "retention refused by its own safety cap"; return 0; }
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    [[ "$name" =~ ^ship11-(DAILY|WEEKLY|PRE_MIGRATION|PRE_RESTORE|MANUAL)-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.(tar\.enc|manifest\.json)$ ]] || { bk_log "retention: refusing foreign name"; continue; }
    bk_rclone deletefile "$BACKUP_REMOTE/$name" >/dev/null 2>&1 && bk_log "retention: removed $name" || bk_log "retention: could not remove $name"
  done <<<"$names"
}

# ---- the local spool -----------------------------------------------------------------------------------------------------------------

bk_spool_bytes() { local total=0 f; for f in "${1:?dir}"/ship11-*.tar.enc; do [[ -e "$f" ]] && total=$((total + $(stat -c %s "$f"))); done; echo "$total"; }

bk_free_mb() { df -Pm "${1:?dir}" | awk 'NR==2 {print $4}'; }

# Copies that reached Drive and were verified keep only the newest few locally; copies that did NOT reach Drive are kept for the retry, but the spool has a hard size cap.
bk_spool_prune() {
  local dir="${1:?dir}" keep="${2:-2}" f n=0
  for f in $(ls -1t "$dir"/ship11-*.tar.enc 2>/dev/null); do
    if [[ -e "$f.offsite" ]]; then
      n=$((n + 1))
      if (( n > keep )); then rm -f -- "$f" "$f.offsite" "$f.attempts" "$f.id" "${f%.tar.enc}.manifest.json"; bk_log "spool: removed a verified local copy"; fi
    fi
  done
}

# Over the hard cap: drop the OLDEST unsent copies (never the newest one) until it fits. Loud, because it is lost redundancy.
bk_spool_trim_unsent() {
  local dir="${1:?dir}" cap_bytes=$(( ${2:?cap in MB} * 1048576 )) f
  for f in $(ls -1tr "$dir"/ship11-*.tar.enc 2>/dev/null); do
    (( $(bk_spool_bytes "$dir") <= cap_bytes )) && return 0
    [[ -e "$f.offsite" ]] && continue
    [[ "$f" == "$(ls -1t "$dir"/ship11-*.tar.enc | head -1)" ]] && continue
    rm -f -- "$f" "$f.attempts" "$f.id" "${f%.tar.enc}.manifest.json"
    bk_log "spool: over the size cap, dropped the oldest copy that never reached Drive"
  done
}

# ---- the M13 report -------------------------------------------------------------------------------------------------------------------

# Tells M13 (Discord alerts, Web Admin health) how the run ended. ok=true ONLY for a copy verified outside the VPS. The credential comes from a file (a systemd credential) and is
# passed to curl on stdin, so it is never on a command line, in the environment of curl or in a log. No URL, host or secret is logged.
bk_report() {
  local kind="${1:?BACKUP|RESTORE_TEST}" ok="${2:?true|false}" size="${3:-}" detail="${4:-}" body
  [[ -n "${BACKUP_OPS_URL:-}" && -r "${BACKUP_INGEST_KEY_FILE:-/nonexistent}" ]] || { bk_log "M13 report skipped: BACKUP_OPS_URL or the ingest key is not set"; return 0; }
  body="$(python3 - "$kind" "$ok" "$size" "$detail" <<'PY'
import json, sys, datetime
kind, ok, size, detail = sys.argv[1:5]
b = {'kind': kind, 'ok': ok == 'true', 'finished_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')}
if size.isdigit():
    b['size_bytes'] = int(size)
if detail:
    b['detail_code'] = detail
print(json.dumps(b))
PY
)"
  if { printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\n\r' <"$BACKUP_INGEST_KEY_FILE")"; } | curl --silent --show-error --fail --max-time 20 --config - \
      -H 'content-type: application/json' --data "$body" "$BACKUP_OPS_URL" >/dev/null 2>&1; then
    bk_log "M13 report sent ($kind ok=$ok ${detail:-})"
  else
    bk_log "M13 report could not be sent ($kind)"
  fi
}
