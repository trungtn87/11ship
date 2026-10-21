#!/usr/bin/env bash
# Manual main-only workflow. No password, env upload, unreviewed migration or host-key bypass.
set -euo pipefail
[[ ${SOURCE_SHA:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid source SHA' >&2; exit 1; }
test -n "${VPS_SSH_PRIVATE_KEY:-}" && test -n "${VPS_KNOWN_HOSTS:-}" || {
  echo 'Configure VPS_SSH_PRIVATE_KEY and VPS_KNOWN_HOSTS in vps-production environment secrets.' >&2
  exit 1
}
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
destination=root@103.9.78.67
inbox="/root/11ship-actions/$SOURCE_SHA"
archive="11ship-${SOURCE_SHA}-ubuntu24-amd64.tar.gz"
ssh "${ssh_opts[@]}" "$destination" "install -d -m 700 '$inbox'"
scp "${ssh_opts[@]}" "artifact-out/$archive" "artifact-out/$archive.sha256" \
  scripts/deploy/vps-update.py "$destination:$inbox/"
ssh "${ssh_opts[@]}" "$destination" bash -s -- "$SOURCE_SHA" <<'REMOTE'
set -euo pipefail
sha=$1
[[ $sha =~ ^[a-f0-9]{40}$ ]] || exit 1
inbox="/root/11ship-actions/$sha"
archive="11ship-${sha}-ubuntu24-amd64.tar.gz"
(cd "$inbox" && sha256sum -c "$archive.sha256")
# Keep the installed updater for operator recovery; never copy env/trust/DB credentials.
install -d -m 755 /opt/11ship/tools
if test -f /opt/11ship/tools/vps-update.py; then
  cp -p /opt/11ship/tools/vps-update.py "$inbox/vps-update.before.py"
fi
install -m 644 "$inbox/vps-update.py" /opt/11ship/tools/vps-update.py
python3 -B /opt/11ship/tools/vps-update.py update "$inbox/$archive" "$sha"
REMOTE
