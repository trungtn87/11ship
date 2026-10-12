#!/usr/bin/env bash
# CI only (GitHub Actions, Ubuntu 24.04, disposable runner; review F4 of PR #71): installs the REAL ops/vinahost/11ship-staging.service,
# unmodified, over a throw-away fake release and proves, with real systemd, that
#   - a service that fails at once is restarted a FINITE number of times and then stays failed (start-limit-hit);
#   - fixing the environment and `reset-failed` + `start` recovers it;
#   - it runs as the unprivileged user from the release root with SIGTERM, and stops gracefully (exit 0) on `systemctl stop`.
# The fake application is a few lines of Node; it touches no database and no real unit or data. Run:
#   sudo -E bash tests/vps/systemd-restart-probe.sh   from the repository root.
set -euo pipefail
[ "${GITHUB_ACTIONS:-}" = "true" ] || { echo "refused: this test only runs in GitHub Actions" >&2; exit 1; }
[ "${SYSTEMD_PROBE_CONFIRM:-}" = "disposable-ci-runner" ] || { echo "refused: set SYSTEMD_PROBE_CONFIRM=disposable-ci-runner" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "refused: run with sudo" >&2; exit 1; }
[ -d /run/systemd/system ] || { echo "refused: systemd is not PID 1 here" >&2; exit 1; }

repo="$PWD"
unit=11ship-staging
pass=0
ok() { pass=$((pass + 1)); echo "ok - $*"; }
die() { echo "NOT OK - $*" >&2; journalctl -u "$unit" --no-pager -n 30 >&2 || true; exit 1; }
prop() { systemctl show "$unit" -p "$1" --value; }

# --- fake release: the layout the unit expects (WorkingDirectory=/opt/11ship/current, apps/backend/dist/main.js)
id ship11 >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin ship11
release=/opt/11ship/releases/probe
install -d -m 755 /opt/11ship /opt/11ship/releases "$release/apps/backend/dist"
cat > "$release/apps/backend/dist/main.js" <<'JS'
// Fake application of the probe. Exits 1 at once unless the environment says PROBE_OK=1 (a stand-in for an invalid configuration).
const http = require('node:http');
if (process.env.PROBE_OK !== '1') {
  console.error('probe: invalid configuration. Check environment variable(s): PROBE_OK');
  process.exit(1);
}
const server = http.createServer((req, res) => {
  res.statusCode = req.url === '/v1/health/ready' ? 200 : 404;
  res.end(JSON.stringify({ user: process.getuid(), cwd: process.cwd(), nodeOptions: process.env.NODE_OPTIONS ?? '' }));
});
server.listen(3000, '127.0.0.1', () => console.log('probe: listening'));
process.on('SIGTERM', () => {
  console.log('probe: SIGTERM received, closing');
  server.close(() => process.exit(0));
});
JS
chown -R root:root "$release"
ln -sfn "$release" /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current

# node must be where `/usr/bin/env node` finds it under systemd's default PATH.
node_bin="$(command -v node)"
[ -x /usr/local/bin/node ] || ln -s "$node_bin" /usr/local/bin/node

install -d -m 750 -o root -g ship11 /etc/11ship
( umask 027; printf 'PROBE_OK=0\n' > /etc/11ship/staging.env )
chown root:ship11 /etc/11ship/staging.env; chmod 640 /etc/11ship/staging.env

# --- the REAL unit, byte for byte
install -m 644 "$repo/ops/vinahost/11ship-staging.service" "/etc/systemd/system/$unit.service"
cmp -s "$repo/ops/vinahost/11ship-staging.service" "/etc/systemd/system/$unit.service" || die "installed unit differs from the repository file"
systemctl daemon-reload
systemd-analyze verify "/etc/systemd/system/$unit.service" || die "systemd-analyze verify"
[ "$(prop StartLimitBurst)" = "5" ] && [ "$(prop StartLimitIntervalUSec)" = "5min" ] || die "start limit properties: $(prop StartLimitBurst) / $(prop StartLimitIntervalUSec)"
[ "$(prop RestartUSec)" = "5s" ] && [ "$(prop Restart)" = "on-failure" ] || die "restart properties"
ok "unit verifies; StartLimitBurst=5 in 5min with RestartSec=5 (the loop cannot outrun the limit)"

# --- 1. immediate failure -> finite restarts -> failed / start-limit-hit
systemctl start "$unit" --no-block
state=""
for _ in $(seq 1 90); do
  state="$(prop ActiveState)"; [ "$state" = "failed" ] && break; sleep 1
done
[ "$state" = "failed" ] || die "service did not reach the failed state within 90 s (state=$state): the restart loop is not bounded"
result="$(prop Result)"
[ "$result" = "start-limit-hit" ] || die "expected Result=start-limit-hit, got $result"
restarts="$(prop NRestarts)"
[ "$restarts" -ge 3 ] && [ "$restarts" -le 5 ] || die "unexpected NRestarts=$restarts"
ok "failing service stopped after a finite number of attempts (NRestarts=$restarts, Result=$result)"
sleep 20
[ "$(prop NRestarts)" = "$restarts" ] && [ "$(prop ActiveState)" = "failed" ] || die "the service restarted again after the limit was hit"
journalctl -u "$unit" --no-pager | grep -q 'Check environment variable' || die "the failure reason is not in the journal"
ok "no further restarts after the limit; the reason (variable NAMES only) is in the journal"

# --- 2. a plain `start` while the limit is hit is refused; fix + reset-failed + start recovers
if systemctl start "$unit" 2>/dev/null; then die "start succeeded while the start limit was hit and the environment still wrong"; fi
sed -i 's/^PROBE_OK=0$/PROBE_OK=1/' /etc/11ship/staging.env
systemctl reset-failed "$unit"
systemctl start "$unit"
for _ in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/v1/health/ready >/tmp/probe.json 2>/dev/null && break; sleep 1; done
[ "$(prop ActiveState)" = "active" ] || die "service not active after reset-failed and start"
ok "after fixing the environment, reset-failed + start recovers the service"

# --- 3. identity, working directory, hardening, heap limit
[ "$(prop User)" = "ship11" ] && [ "$(prop Group)" = "ship11" ] || die "User/Group"
[ "$(prop WorkingDirectory)" = "/opt/11ship/current" ] || die "WorkingDirectory"
[ "$(prop NoNewPrivileges)" = "yes" ] && [ "$(prop ProtectSystem)" = "strict" ] || die "hardening"
[ "$(prop KillSignal)" = "15" ] || die "KillSignal"
grep -q '"user":'"$(id -u ship11)" /tmp/probe.json || die "the process does not run as ship11: $(cat /tmp/probe.json)"
grep -q '"cwd":"/opt/11ship/releases/probe"' /tmp/probe.json || die "the working directory is not the release root: $(cat /tmp/probe.json)"
grep -q -- '--max-old-space-size=384' /tmp/probe.json || die "heap limit missing"
ok "runs as ship11 from the release root with the 384 MB heap limit and hardening"

# --- 4. graceful stop on SIGTERM
systemctl stop "$unit"
[ "$(prop Result)" = "success" ] || die "stop was not clean: Result=$(prop Result)"
journalctl -u "$unit" --no-pager | grep -q 'SIGTERM received, closing' || die "the application did not see SIGTERM"
ok "systemctl stop sends SIGTERM and the service exits cleanly (Result=success)"

echo; echo "systemd-probe: $pass checks passed"
