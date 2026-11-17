#!/usr/bin/env bash
# Manual main-only workflow helper for the M14 routing gateway on the VPS. Two modes:
#   inspect  read-only: container, image ids and /health of the gateway (public health JSON only, no env, no secrets)
#   upgrade  ship the image built on the runner, `vps.sh load` + `vps.sh up` (health + smoke, auto-restores the previous container on failure),
#            then `vps.sh check` (the same gateway gate that blocks the backend deploy). It never touches the backend, its env file or its service.
set -euo pipefail
mode=${M14_MODE:-}
[[ $mode == inspect || $mode == upgrade ]] || { echo 'M14_MODE must be inspect or upgrade' >&2; exit 1; }
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
inbox="/root/11ship-actions/m14-$SOURCE_SHA"

if [[ $mode == inspect ]]; then
  ssh "${ssh_opts[@]}" "$destination" bash -s <<'REMOTE'
set -u
echo '== containers'; docker ps -a --filter name=m14 --format '{{.Names}}  {{.Image}}  {{.Status}}  {{.Ports}}' || echo 'docker not available'
echo '== images'; docker image ls 11ship-m14-routing --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedSince}}' || true
echo '== gateway /health (what the gate reads)'; curl -sS --max-time 4 http://127.0.0.1:18014/health || echo '(no answer)'
echo
echo '== gate'; if [ -f /opt/11ship/current/ops/m14/gateway-gate.sh ]; then bash /opt/11ship/current/ops/m14/gateway-gate.sh http://127.0.0.1:18014 || true; else echo 'no gate script in the running release'; fi
echo '== backend origin configured (name only)'; grep -c '^M14_ROUTING_ORIGIN=' /etc/11ship/staging.env || true
REMOTE
  exit 0
fi

# upgrade: image built on the runner (the 1 GB VPS must not build it). Build, save, verify the checksum on both ends.
image=11ship-m14-routing
docker build -f ops/m14/Dockerfile -t "$image:current" .
work=$(mktemp -d)
docker save "$image:current" | gzip > "$work/m14-image.tar.gz"
(cd "$work" && sha256sum m14-image.tar.gz > m14-image.tar.gz.sha256)
tar -C . -czf "$work/m14-ops.tar.gz" --exclude='ops/m14/data' ops/m14
ssh "${ssh_opts[@]}" "$destination" "install -d -m 700 '$inbox'"
scp "${ssh_opts[@]}" "$work/m14-image.tar.gz" "$work/m14-image.tar.gz.sha256" "$work/m14-ops.tar.gz" "$destination:$inbox/"
ssh "${ssh_opts[@]}" "$destination" bash -s -- "$inbox" <<'REMOTE'
set -euo pipefail
inbox=$1
cd "$inbox"
tar -xzf m14-ops.tar.gz
echo '== before'; curl -sS --max-time 4 http://127.0.0.1:18014/health || echo '(no answer)'; echo
bash ops/m14/vps.sh load "$inbox/m14-image.tar.gz"
bash ops/m14/vps.sh up
bash ops/m14/vps.sh check
echo '== after'; curl -sS --max-time 4 http://127.0.0.1:18014/health; echo
REMOTE
