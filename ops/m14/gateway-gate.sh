#!/usr/bin/env bash
# M14 gateway gate, shared by ops/m14/vps.sh (check, connect, rollback) and scripts/deploy/vps-update.py (before a backend release is
# migrated, restarted or rolled back). Read-only. Exit 0 only when the gateway at the origin answers /health with ready:true and a routeVersion
# that the backend accepts (same pattern as apps/backend/src/delivery/m14-route-client.ts ROUTE_VERSION_PATTERN).
#
#   bash ops/m14/gateway-gate.sh [origin]     standalone: exit 0 = gate green, 1 = red (messages on stderr)
#   sourced: gateway_preflight [origin]       sets GATEWAY_ROUTE_VERSION on success
#
# Rollout order: upgrade the gateway, pass this gate, then the backend. Never roll the gateway back alone while a backend that expects routeVersion runs.
GATEWAY_ROUTE_VERSION=''
gate_say() { printf '== %s\n' "$*"; }
gate_die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

gateway_preflight() {
  local origin_url="${1:-${M14_GATE_ORIGIN:-http://127.0.0.1:18014}}" body version
  body="$(curl -sS --max-time 4 "$origin_url/health" 2>/dev/null)" || gate_die "gateway $origin_url/health did not answer: do NOT connect or restart the backend. Fix the gateway first (vps.sh up), then check again"
  grep -q '"ready": *true' <<<"$body" || gate_die 'gateway is not ready (ready:false, or no valid routeVersion): do NOT connect or restart the backend. Upgrade the gateway first'
  version="$(grep -o '"routeVersion": *"[^"]*"' <<<"$body" | head -1 | cut -d'"' -f4 || true)"
  grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,127}$' <<<"$version" || gate_die 'gateway routeVersion is missing or malformed: do NOT connect or restart the backend. The gateway is older than the backend or misconfigured'
  GATEWAY_ROUTE_VERSION="$version"
  gate_say "gateway check OK: ready, routeVersion=$version"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  gateway_preflight "${1:-}"
fi
