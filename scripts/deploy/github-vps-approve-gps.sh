#!/usr/bin/env bash
# Explicit, operator-dispatched approval of two reviewed M02 GPS migrations.
# Does not apply migrations, edit DB values, or allowlist any other migration.
set -euo pipefail

test -n "${VPS_SSH_PRIVATE_KEY:-}" && test -n "${VPS_KNOWN_HOSTS:-}" || {
  echo 'Missing VPS SSH secrets' >&2; exit 1;
}

schema=1795305600000_service-area-coverage
bootstrap=1795478400000_bootstrap-cao-bang-gps-coverage
for name in "$schema" "$bootstrap"; do
  test -f "database/migrations/$name.sql" || { echo 'Missing approved migration' >&2; exit 1; }
done
schema_hash=$(sha256sum "database/migrations/$schema.sql" | cut -d' ' -f1)
bootstrap_hash=$(sha256sum "database/migrations/$bootstrap.sql" | cut -d' ' -f1)
[[ $schema_hash =~ ^[0-9a-f]{64}$ && $bootstrap_hash =~ ^[0-9a-f]{64}$ ]] || exit 1

ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
chmod 700 "$ssh_dir"
printf '%s\n' "$VPS_SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$VPS_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
unset VPS_SSH_PRIVATE_KEY VPS_KNOWN_HOSTS

ssh_opts=(-i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts"
  -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

ssh "${ssh_opts[@]}" root@103.9.78.67 python3 - "$schema" "$schema_hash" "$bootstrap" "$bootstrap_hash" <<'REMOTE'
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

path = Path('/etc/11ship/migration-compatibility.json')
arguments = sys.argv[1:]
expected_names = (
    '1795305600000_service-area-coverage',
    '1795478400000_bootstrap-cao-bang-gps-coverage',
)
if len(arguments) != 4 or (arguments[0], arguments[2]) != expected_names:
    raise SystemExit('unexpected GPS approval request')
for digest in (arguments[1], arguments[3]):
    if re.fullmatch(r'[0-9a-f]{64}', digest) is None:
        raise SystemExit('invalid approved digest')
if not path.parent.is_dir() or path.is_symlink():
    raise SystemExit('unexpected migration policy path')
existing = json.loads(path.read_text()) if path.exists() else {}
if not isinstance(existing, dict):
    raise SystemExit('invalid migration policy')
for name, digest in ((arguments[0], arguments[1]), (arguments[2], arguments[3])):
    if name in existing and existing[name] != digest:
        raise SystemExit('migration policy conflict: refusing to overwrite an existing approval')
    existing[name] = digest

# Atomic change, root-only; preserve all previous approvals.
fd, temporary = tempfile.mkstemp(prefix='.migration-compatibility-', dir=path.parent)
try:
    os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, 'w') as handle:
        json.dump(existing, handle, sort_keys=True, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print('Approved only the two reviewed GPS migration hashes')
REMOTE
