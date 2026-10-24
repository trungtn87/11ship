#!/usr/bin/env bash
# M12-F: restore an ENCRYPTED backup into a SCRATCH database and check it. This script NEVER restores over a live database: the target name must be a scratch name, it must not
# exist yet, and it is created here. Usage:
#   restore-rehearsal.sh <backup.dump.enc> <passphrase-file> <admin-url-of-the-scratch-server> <scratch-db-name> [--keep]
# Prints "name|value" lines (verify.sql) and exits 0 only when the restore finished and the checks ran. The scratch database is dropped at the end unless --keep.
set -euo pipefail

file="${1:?encrypted backup file}"
pass="${2:?passphrase file}"
admin_url="${3:?admin connection URL of the scratch server (database postgres)}"
scratch="${4:?scratch database name}"
keep="${5:-}"

# Guard 1: only a name that says "scratch". Production names (ship11_staging, ship11_dev, ship11_test, ...) can never match.
if ! [[ "$scratch" =~ ^ship11_(restore|verify)_[a-z0-9_]{1,30}$ ]]; then
  echo "REFUSED: '$scratch' is not a scratch database name (ship11_restore_* or ship11_verify_*)" >&2
  exit 64
fi
[[ -r "$file" && -r "$pass" ]] || { echo "REFUSED: backup or passphrase file not readable" >&2; exit 66; }

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
cleanup() {
  rm -rf "$work"
  if [[ "$keep" != "--keep" ]]; then
    psql "$admin_url" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"$scratch\"" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Guard 2: the scratch database must not exist (nothing is overwritten) and the server must not be asked to touch another database.
exists="$(psql "$admin_url" -Atqc "SELECT 1 FROM pg_database WHERE datname = '$scratch'")"
if [[ -n "$exists" ]]; then
  echo "REFUSED: database '$scratch' already exists; this script only creates new scratch databases" >&2
  trap - EXIT
  rm -rf "$work"
  exit 65
fi

openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$pass" -in "$file" -out "$work/decrypted" || { echo "REFUSED: the file could not be decrypted (wrong passphrase or damaged file)" >&2; exit 67; }
# A bundle (tar: database.dump + manifest.json [+ files.tar]) or, for the first backups, a bare pg_dump custom archive.
if [[ "$(head -c 5 "$work/decrypted")" == "PGDMP" ]]; then
  mv "$work/decrypted" "$work/backup.dump"
else
  tar --extract --file "$work/decrypted" --directory "$work" --no-same-owner --no-same-permissions database.dump manifest.json
  rm -f "$work/decrypted"
  # The manifest holds the checksum of every component: a damaged or swapped component is refused before it is restored.
  python3 - "$work" <<'PY' || { echo "REFUSED: a component does not match its manifest checksum" >&2; exit 68; }
import hashlib, json, sys
work = sys.argv[1]
manifest = json.load(open(work + '/manifest.json'))
for c in manifest['components']:
    if c['name'] != 'database.dump':
        continue  # files.tar is checked by restore-fetch.sh, which extracts it
    digest = hashlib.sha256()
    with open(work + '/' + c['name'], 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    if digest.hexdigest() != c['sha256']:
        raise SystemExit(1)
PY
  mv "$work/database.dump" "$work/backup.dump"
fi
psql "$admin_url" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$scratch\""
scratch_url="$(python3 -c 'import sys,urllib.parse as u; p=u.urlsplit(sys.argv[1]); print(u.urlunsplit(p._replace(path="/"+sys.argv[2])))' "$admin_url" "$scratch")"
# Owners/ACLs of the source roles may not exist on the scratch server: restore the data and objects, not the grants.
pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch_url" "$work/backup.dump"
psql "$scratch_url" -v ON_ERROR_STOP=1 -qf "$here/verify.sql"
