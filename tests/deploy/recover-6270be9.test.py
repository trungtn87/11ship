"""Exercise approval writes in isolated files; never invokes SSH, SQL or systemd."""
import fcntl
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SHA = '6270be903e7c94b5155b3db9a353a7761b864722'
OLD = 'aadde62d08a9a7bc500ff1a50fe84fd2acbd2e74'
NAMES = ['1795305600000_service-area-coverage', '1795392000000_order-stage-timeouts']
SOURCE = (ROOT / 'scripts/deploy/recover-6270be9.sh').read_text().split("<<'PY'\n", 1)[1].split('\nPY\n', 1)[0]


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / '11ship'
        self.sql = self.base / 'releases' / SHA / 'database/migrations'
        self.sql.mkdir(parents=True)
        for name in NAMES:
            shutil.copyfile(ROOT / 'database/migrations' / (name + '.sql'), self.sql / (name + '.sql'))
        (self.base / 'releases' / OLD).mkdir()
        (self.base / 'current').symlink_to(self.base / 'releases' / OLD)
        (self.base / 'tools').mkdir()
        shutil.copyfile(ROOT / 'scripts/deploy/vps-update.py', self.base / 'tools/vps-update.py')
        self.policy = self.root / 'migration-compatibility.json'
        self.policy.write_text(json.dumps({'historical': 'preserved'}))
        self.policy.chmod(0o600)
        self.fixture_owner = 0

    def run_policy(self):
        code = SOURCE.replace("Path('/opt/11ship')", 'Path(' + repr(str(self.base)) + ')').replace(
            "Path('/etc/11ship/migration-compatibility.json')", 'Path(' + repr(str(self.policy)) + ')')
        # The VPS operator is root; CI's temporary files belong to runner. Model
        # only this fixture's owner metadata without changing the production guard.
        harness = """from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
original_lstat = Path.lstat
def fixture_lstat(path):
    actual = original_lstat(path)
    if str(path) == POLICY_PATH:
        return SimpleNamespace(st_mode=actual.st_mode, st_uid=FIXTURE_OWNER)
    return actual
with patch.object(Path, 'lstat', fixture_lstat):
    exec(SOURCE_CODE)
""".replace('POLICY_PATH', repr(str(self.policy))).replace('FIXTURE_OWNER', str(self.fixture_owner)).replace('SOURCE_CODE', repr(code))
        return subprocess.run(['python3', '-c', harness], capture_output=True, text=True)

    def assert_rejected(self, message):
        before = self.policy.read_bytes()
        result = self.run_policy()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertEqual(before, self.policy.read_bytes())
        self.assertFalse(list(self.root.glob('*.before-*')))

    def test_preserves_history_and_backs_up_before_atomic_write(self):
        before = self.policy.read_bytes()
        result = self.run_policy()
        self.assertEqual(result.returncode, 0, result.stderr)
        values = json.loads(self.policy.read_text())
        self.assertEqual(values['historical'], 'preserved')
        self.assertEqual(set(values), {'historical', *NAMES})
        self.assertEqual(self.policy.stat().st_mode & 0o777, 0o600)
        backups = list(self.root.glob('*.before-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), before)

    def test_sql_change_does_not_approve(self):
        (self.sql / (NAMES[0] + '.sql')).write_text('unexpected SQL')
        self.assert_rejected('migration content differs')

    def test_conflicting_existing_hash_does_not_change_policy(self):
        self.policy.write_text(json.dumps({NAMES[1]: 'conflict'}))
        self.assert_rejected('existing approval conflicts')

    def test_unsafe_policy_permissions_rejected(self):
        self.policy.chmod(0o666)
        self.assert_rejected('policy ownership/type/permissions')

    def test_non_root_policy_owner_rejected(self):
        self.fixture_owner = 1001
        self.assert_rejected('policy ownership/type/permissions')

    def test_later_release_cannot_be_downgraded(self):
        current = self.base / 'current'
        current.unlink()
        later = self.base / 'releases' / ('f' * 40)
        later.mkdir()
        current.symlink_to(later)
        self.assert_rejected('VPS current differs')

    def test_changed_updater_cannot_run(self):
        (self.base / 'tools/vps-update.py').write_text('unexpected updater')
        self.assert_rejected('updater differs')

    def test_concurrent_deploy_keeps_policy_unchanged(self):
        with (self.base / '.deploy.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assert_rejected('Resource temporarily unavailable')


if __name__ == '__main__':
    unittest.main()
