"""M14 vps.sh fail-closed rules (P6-1 review round 3, SỬA-9).

`rollback` is blocked: it touches no docker and exits non-zero. `restore-env` with a backup that points at a gateway runs the gateway gate BEFORE
it changes the backend env file; a red gate leaves the env file and the backend untouched. Stubs for id, docker, curl and systemctl are
loaded as shell functions (BASH_ENV); each call is recorded so the tests can prove what was NOT run.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
VPS = REPO / 'ops/m14/vps.sh'
# On Windows, `bash` may be the WSL launcher; M14_TEST_BASH selects another bash (for example Git Bash). Linux CI uses the default.
BASH = os.environ.get('M14_TEST_BASH', 'bash')
HEALTH = '{"ready": true, "routeVersion": "valhalla-3.9.1/motorcycle-shortest/abc123def456"}'

# Shell functions, loaded through BASH_ENV, replace the external commands vps.sh and gateway-gate.sh call: id (root), docker, systemctl and curl.
# PATH stubs are not used because a Windows PATH is not reliable under Git Bash. Each call is appended to $STUB_LOG; curl answers the gateway
# /health from $CURL_HEALTH ("ok" or "down") and any other URL (the backend ready endpoint) with ready.
BASH_ENV_TEXT = """
id() { echo 0; }
docker() { echo "docker $*" >> "$STUB_LOG"; return 0; }
systemctl() { echo "systemctl $*" >> "$STUB_LOG"; return 0; }
curl() {
  local url="${@: -1}"
  case "$url" in
    */health) if [ "${CURL_HEALTH:-ok}" = down ]; then return 7; fi; printf '%s' '""" + HEALTH + """' ;;
    *) printf '%s' '{"status": "ready"}' ;;
  esac
}
"""


class VpsRoutingGuardTests(unittest.TestCase):
    def setUp(self):
        if shutil.which(BASH) is None:
            self.skipTest('bash is required for the vps.sh tests (set M14_TEST_BASH to choose one)')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bash_env = self.root / 'stubs.sh'
        self.bash_env.write_text(BASH_ENV_TEXT, encoding='utf-8')
        self.log = self.root / 'calls.log'
        self.env = self.root / 'staging.env'
        self.env.write_text('APP_ENV=staging\nM14_ROUTING_ORIGIN=http://127.0.0.1:18014\n', encoding='utf-8')

    def run_vps(self, *args, curl_health='ok', backup_text=None):
        if backup_text is not None:
            backup = self.root / 'staging.env.m14-backup.test'
            backup.write_text(backup_text, encoding='utf-8')
            args = (*args, str(backup))
        env = {
            **os.environ,
            'BASH_ENV': str(self.bash_env),
            'STUB_LOG': str(self.log),
            'CURL_HEALTH': curl_health,
            'BACKEND_ENV_FILE': str(self.env),
            'BACKEND_SERVICE': 'staging-test',
            'BACKEND_READY_URL': 'http://backend.test/v1/health/ready',
            'M14_GATE_ORIGIN': 'http://127.0.0.1:18014',
            'M14_IMAGE_STATE': str(self.root / 'state'),
        }
        return subprocess.run([BASH, str(VPS), *args], capture_output=True, text=True, env=env, timeout=120)

    def calls(self):
        return self.log.read_text(encoding='utf-8').splitlines() if self.log.exists() else []

    def test_rollback_is_blocked_and_touches_nothing(self):
        result = self.run_vps('rollback')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('BLOCKED', result.stderr)
        self.assertIn('vps-update.py rollback', result.stderr)
        self.assertEqual([c for c in self.calls() if c.startswith('docker')], [])

    def test_restore_env_is_refused_when_the_gateway_gate_is_red_and_changes_nothing(self):
        before = self.env.read_text(encoding='utf-8')
        backup = 'APP_ENV=staging\nM14_ROUTING_ORIGIN=http://127.0.0.1:18014\n'
        result = self.run_vps('restore-env', curl_health='down', backup_text=backup)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('gateway', result.stdout + result.stderr)
        self.assertEqual(self.env.read_text(encoding='utf-8'), before)
        self.assertEqual([c for c in self.calls() if c.startswith('systemctl')], [])

    def test_restore_env_with_a_green_gate_restores_and_restarts_the_backend(self):
        backup = 'APP_ENV=staging\nM14_ROUTING_ORIGIN=http://127.0.0.1:18014\nM14_DATA_VERSION=restored\n'
        result = self.run_vps('restore-env', curl_health='ok', backup_text=backup)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('M14_DATA_VERSION=restored', self.env.read_text(encoding='utf-8'))
        self.assertIn('systemctl restart staging-test', self.calls())

    def test_restore_env_of_a_backup_without_a_gateway_does_not_depend_on_the_gateway(self):
        backup = 'APP_ENV=staging\n'
        result = self.run_vps('restore-env', curl_health='down', backup_text=backup)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.env.read_text(encoding='utf-8'), backup)
        self.assertIn('systemctl restart staging-test', self.calls())


if __name__ == '__main__':
    unittest.main()
