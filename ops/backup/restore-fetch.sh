#!/usr/bin/env bash
# M12-F: bring ONE backup back from Google Drive for a restore or a drill: download -> check -> decrypt -> unpack. Nothing here restores a database and nothing touches the live system.
#   restore-fetch.sh <backup name without extension | latest> <empty output directory>
# Settings: BACKUP_RCLONE_CONFIG, BACKUP_REMOTE, BACKUP_PASSPHRASE_FILE (the passphrase from the Owner's off-VPS copy when the VPS is gone). Exit: 0 done, 1 failed, 64/66 bad input.
# Checks, in this order: size and MD5 against what Drive reports -> SHA-256 of the bundle against the manifest next to it -> decryption -> SHA-256 of every component against the
# manifest inside. Any mismatch stops with a message and leaves nothing that looks like a good result.
set -euo pipefail
umask 077
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
want="${1:?backup name (ship11-KIND-STAMP-ID) or latest}"
out="${2:?output directory}"
: "${BACKUP_REMOTE:?}" "${BACKUP_RCLONE_CONFIG:?}" "${BACKUP_PASSPHRASE_FILE:?}"
[[ -r "$BACKUP_PASSPHRASE_FILE" ]] || { echo "REFUSED: passphrase file not readable" >&2; exit 66; }
if [[ -e "$out" && -n "$(ls -A "$out" 2>/dev/null)" ]]; then echo "REFUSED: $out is not empty" >&2; exit 65; fi
mkdir -p "$out"; chmod 700 "$out"

listing="$(bk_rclone lsjson --hash --files-only "$BACKUP_REMOTE")" || { echo "Drive listing failed: $(bk_classify <<<"$listing")" >&2; exit 1; }
if [[ "$want" == "latest" ]]; then
  want="$(printf '%s' "$listing" | python3 -c '
import json, re, sys
names = sorted(e["Name"][:-8] for e in json.load(sys.stdin) if re.fullmatch(r"ship11-(DAILY|WEEKLY|PRE_MIGRATION|PRE_RESTORE|MANUAL)-\d{8}T\d{6}Z-[0-9a-f]{8}\.tar\.enc", e["Name"]))
names.sort(key=lambda n: n.split("-")[2:4], reverse=True)
print(names[0] if names else "")')"
  [[ -n "$want" ]] || { echo "no backup found in the Drive folder" >&2; exit 1; }
fi
[[ "$want" =~ $BK_NAME_RE ]] || { echo "REFUSED: not a backup name of this job" >&2; exit 64; }

facts="$(printf '%s' "$listing" | python3 "$BK_TOOLS" remote "$want.tar.enc")" || { echo "the backup is not on Drive" >&2; exit 1; }
bk_rclone copyto "$BACKUP_REMOTE/$want.tar.enc" "$out/$want.tar.enc" >/dev/null 2>&1 || { echo "download failed" >&2; exit 1; }
bk_rclone copyto "$BACKUP_REMOTE/$want.manifest.json" "$out/$want.manifest.json" >/dev/null 2>&1 || { echo "the manifest could not be downloaded" >&2; exit 1; }
[[ "$(stat -c %s "$out/$want.tar.enc")" == "${facts%% *}" && "$(md5sum "$out/$want.tar.enc" | cut -d' ' -f1)" == "${facts##* }" ]] || { echo "CHECKSUM MISMATCH: the downloaded file differs from what Drive reports" >&2; rm -f "$out/$want.tar.enc"; exit 1; }
python3 - "$out/$want.manifest.json" "$out/$want.tar.enc" <<'PY' || { echo "CHECKSUM MISMATCH: the bundle does not match its manifest" >&2; rm -f "$out/$want.tar.enc"; exit 1; }
import hashlib, json, sys
m = json.load(open(sys.argv[1]))
d = hashlib.sha256()
with open(sys.argv[2], 'rb') as f:
    for chunk in iter(lambda: f.read(1 << 20), b''):
        d.update(chunk)
sys.exit(0 if d.hexdigest() == m['bundle_sha256'] else 1)
PY
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$out/$want.tar.enc" -out "$out/bundle.tar" 2>/dev/null || { echo "DECRYPTION FAILED: wrong passphrase or damaged file" >&2; rm -f "$out/bundle.tar"; exit 1; }
mkdir -p "$out/contents"
tar --extract --file "$out/bundle.tar" --directory "$out/contents" --no-same-owner --no-same-permissions
rm -f "$out/bundle.tar"
python3 - "$out/contents" <<'PY' || { echo "COMPONENT CHECKSUM MISMATCH" >&2; exit 1; }
import hashlib, json, sys
root = sys.argv[1]
for c in json.load(open(root + '/manifest.json'))['components']:
    d = hashlib.sha256()
    with open(root + '/' + c['name'], 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            d.update(chunk)
    if d.hexdigest() != c['sha256']:
        raise SystemExit(1)
PY
echo "FETCHED $want -> $out/contents (database.dump, manifest.json$( [[ -f "$out/contents/files.tar" ]] && echo ', files.tar'))"
