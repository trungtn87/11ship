#!/usr/bin/env bash
# M14 Valhalla routing on the VinaHost VPS (issue #239). Run as root from a reviewed checkout of this repository (not under /root: keep it readable).
# Nothing here opens a port to the Internet: the container publishes 127.0.0.1:18014 only and the backend talks to it over loopback.
#
#   preflight                 read-only: Docker, RAM, disk, load, port 18014
#   build                     build the image on this host (refuses when RAM/disk are short; use `load` with an image built elsewhere)
#   load <image.tar.gz>       load an image built elsewhere; the .sha256 next to it must match
#   up                        start the routing container, wait for /health, run smoke.py; on any failure restores the previous container (or removes this one)
#   connect                   set M14_ROUTING_ORIGIN in the backend env file, restart the backend, check readiness; on failure restores the env file and restarts
#   status                    container, health, stats, backend origin (no secrets printed)
#   load-test [n] [c]         n routes with c in parallel (default 40 / 4) and the resources it used
#   rollback                  routing: previous image back (or stop). Backend: `restore-env <backup>` puts a saved env file back
#   restore-env <backup>      restore a backup made by `connect`, restart the backend, check readiness
#
# Environment overrides: M14_IMAGE (default 11ship-m14-routing), M14_RATE_PER_MIN (default 600 here), M14_MAX_CONCURRENT (default 4 here),
# BACKEND_ENV_FILE (/etc/11ship/staging.env), BACKEND_SERVICE (11ship-staging), BACKEND_READY_URL (http://127.0.0.1:3000/v1/health/ready).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
image="${M14_IMAGE:-11ship-m14-routing}"
origin='http://127.0.0.1:18014'
env_file="${BACKEND_ENV_FILE:-/etc/11ship/staging.env}"
service="${BACKEND_SERVICE:-11ship-staging}"
ready_url="${BACKEND_READY_URL:-http://127.0.0.1:3000/v1/health/ready}"
compose=(docker compose -p m14 -f "$here/compose.yaml")
export M14_IMAGE_REF="$image:current"
export M14_RATE_PER_MIN="${M14_RATE_PER_MIN:-600}"
export M14_MAX_CONCURRENT="${M14_MAX_CONCURRENT:-4}"

say() { printf '== %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need_root() { [ "$(id -u)" = 0 ] || die 'run as root'; }

avail_mb() { free -m | awk '/^Mem:/ {print $7}'; }
disk_mb() { df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2 {print $4}' || df -Pm / | awk 'NR==2 {print $4}'; }

preflight() {
  need_root
  command -v docker >/dev/null || die 'docker is not installed (install it first; this script does not)'
  docker compose version >/dev/null 2>&1 || die 'docker compose plugin is missing'
  say "RAM available: $(avail_mb) MB, swap: $(free -m | awk '/^Swap:/ {print $2}') MB, disk free for docker: $(disk_mb) MB, load: $(cut -d' ' -f1-3 /proc/loadavg)"
  if ss -ltn 2>/dev/null | grep -q '127.0.0.1:18014\|:18014 '; then
    docker ps --format '{{.Names}} {{.Ports}}' | grep -q 18014 && say 'port 18014 is already used by a container (ours, if `status` shows m14-routing)' || die 'port 18014 is used by something that is not a container'
  fi
  say 'existing containers:'; docker ps --format '  {{.Names}}  {{.Image}}  {{.Ports}}'
  [ -f "$repo/ops/m14/data/caobang.osm.pbf" ] || die 'ops/m14/data/caobang.osm.pbf is missing from this checkout'
  say 'preflight done (read-only)'
}

build() {
  need_root; preflight
  [ "$(avail_mb)" -ge 700 ] && [ "$(disk_mb)" -ge 3000 ] || die "not enough free RAM (>=700 MB) or disk (>=3000 MB) to build here: build the image elsewhere (docker build -f ops/m14/Dockerfile -t $image:current .), docker save | gzip, copy it with its .sha256, then run \`$0 load\`"
  keep_previous
  say 'building (one valhalla thread, niced)'
  nice -n 15 docker build -f "$repo/ops/m14/Dockerfile" -t "$image:current" "$repo"
}

load() {
  need_root
  local file="${1:?image tar.gz}"
  [ -f "$file" ] && [ -f "$file.sha256" ] || die "need $file and $file.sha256"
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256")
  keep_previous
  gunzip -c "$file" | docker load
  docker image inspect "$image:current" >/dev/null 2>&1 || die "the archive did not contain $image:current"
}

keep_previous() {
  if docker image inspect "$image:current" >/dev/null 2>&1; then
    docker tag "$image:current" "$image:previous"
    say "kept the running image as $image:previous"
  fi
}

wait_health() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 4 "$origin/health" 2>/dev/null | grep -q '"ready": *true'; then return 0; fi
    sleep 3
  done
  return 1
}

up() {
  need_root
  docker image inspect "$image:current" >/dev/null 2>&1 || die "no image $image:current: run build or load first"
  "${compose[@]}" up -d --no-build
  if wait_health && python3 "$here/smoke.py" "$origin" >/dev/null; then
    say "routing is healthy and answered a real route (smoke.py); report: $(pwd)/routing-smoke.json"
    return 0
  fi
  say 'health or smoke FAILED: rolling the routing container back'
  rollback
  die 'routing did not become healthy; previous state restored (see `docker logs m14-routing-1`)'
}

rollback() {
  need_root
  if docker image inspect "$image:previous" >/dev/null 2>&1; then
    docker tag "$image:previous" "$image:current"
    "${compose[@]}" up -d --no-build --force-recreate
    wait_health && say 'previous routing image is running again' || say 'previous image did not come up either: check docker logs'
  else
    "${compose[@]}" down
    say 'no previous image: the routing container is stopped (the backend keeps reporting routes as unavailable, never a straight line)'
  fi
}

connect() {
  need_root
  curl -fsS --max-time 4 "$origin/health" | grep -q '"ready": *true' || die 'routing is not healthy: run up first'
  [ -f "$env_file" ] || die "$env_file not found"
  local backup="$env_file.m14-backup.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p "$env_file" "$backup"
  say "env backup: $backup"
  if grep -q '^M14_ROUTING_ORIGIN=' "$env_file"; then
    sed -i "s|^M14_ROUTING_ORIGIN=.*|M14_ROUTING_ORIGIN=$origin|" "$env_file"
  else
    printf '\nM14_ROUTING_ORIGIN=%s\n' "$origin" >> "$env_file"
  fi
  systemctl restart "$service"
  if backend_ready; then
    say "backend restarted with M14_ROUTING_ORIGIN=$origin and is ready"
  else
    say 'backend NOT ready: restoring the env file'
    restore_env "$backup"
    die 'backend did not become ready with the routing origin; env restored'
  fi
}

backend_ready() {
  local i
  for i in $(seq 1 40); do
    if systemctl is-active --quiet "$service" && curl -fsS --max-time 4 "$ready_url" 2>/dev/null | grep -q '"status": *"ready"'; then return 0; fi
    sleep 3
  done
  return 1
}

restore_env() {
  need_root
  local backup="${1:?backup file}"
  [ -f "$backup" ] || die "no such backup: $backup"
  cp -p "$backup" "$env_file"
  systemctl restart "$service"
  backend_ready && say 'env restored, backend ready' || die 'env restored but the backend is not ready: investigate with journalctl'
}

status() {
  say 'container'; docker ps -a --filter name=m14 --format '  {{.Names}}  {{.Image}}  {{.Status}}  {{.Ports}}'
  say 'health'; curl -sS --max-time 4 "$origin/health" || echo '  (no answer)'
  echo
  say 'resources'; docker stats --no-stream --format '  {{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} pids={{.PIDs}}' 2>/dev/null | grep m14 || true
  free -m | sed 's/^/  /'
  say 'backend origin (name only)'; grep -c '^M14_ROUTING_ORIGIN=' "$env_file" | sed 's/^/  lines in env file: /'
}

loadtest() { python3 "$here/load-test.py" "$origin" "${1:-40}" "${2:-4}"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  preflight) preflight ;;
  build) build ;;
  load) load "$@" ;;
  up) up ;;
  connect) connect ;;
  status) status ;;
  load-test) loadtest "$@" ;;
  rollback) rollback ;;
  restore-env) restore_env "$@" ;;
  *) sed -n '2,18p' "$0"; exit 2 ;;
esac
