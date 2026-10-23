#!/usr/bin/env bash
# Explicit approval of the two additive migrations already reviewed in PRs #165 and #170.
# Does not apply migrations, edit DB values, or approve any other migration.
set -euo pipefail

test -n "${VPS_SSH_PRIVATE_KEY:-}" && test -n "${VPS_KNOWN_HOSTS:-}" || {
  echo 'Missing VPS SSH secrets' >&2; exit 1;
}

schema=1795564800000_shop-display-order-codes
bootstrap=1795651200000_password-client-sessions
for name in "$schema" "$bootstrap"; do
  test -f "database/migrations/$name.sql" || { echo 'Missing approved migration' >&2; exit 1; }
done
schema_hash=$(sha256sum "database/migrations/$schema.sql" | cut -d' ' -f1)
bootstrap_hash=$(sha256sum "database/migrations/$bootstrap.sql" | cut -d' ' -f1)
[[ $schema_hash =~ ^[0-9a-f]{64}$ && $bootstrap_hash =~ ^[0-9a-f]{64}$ ]] || exit 1
# Pin the exact reviewed SQL; edits require another review rather than a new blanket approval.
[[ $schema_hash == 28c43af8392e4e14a3d7b7a3487ad0c740d24e12c3aeece2271210df09568fb0 ]] || { echo 'Shop-code migration differs from reviewed SQL' >&2; exit 1; }
[[ $bootstrap_hash == 6b184f2463e52e61e45a27a6d8598024929a86b3c9212f716f102c21666ab9e2 ]] || { echo 'Password-session migration differs from reviewed SQL' >&2; exit 1; }

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
    '1795564800000_shop-display-order-codes',
    '1795651200000_password-client-sessions',
)
if len(arguments) != 4 or (arguments[0], arguments[2]) != expected_names:
    raise SystemExit('unexpected M01/shop-code approval request')
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
print('Approved only the two reviewed M01/shop-code migration hashes')
REMOTE
