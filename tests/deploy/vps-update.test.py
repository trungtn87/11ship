import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).resolve().parents[2] / 'scripts/deploy/vps-update.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.patch = patch.object(d, 'BASE', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        (self.root / 'releases').mkdir()
        self.old = self.release('a')
        self.new = self.release('b')
        d.link('current', self.old)
        d.link('previous', self.new)

    def release(self, char):
        release = self.root / 'releases' / (char * 40)
        release.mkdir()
        (release / 'code').write_text('code')
        (release / 'MANIFEST.sha256').write_text(hashlib.sha256(b'code').hexdigest() + '  code\n')
        return release

    def test_failed_health_restores_previous_code_and_checks_it(self):
        with patch.object(d, 'run') as run, patch.object(d, 'health', side_effect=[RuntimeError('503'), None]) as health:
            with self.assertRaisesRegex(RuntimeError, 'previous code restored'):
                d.switch(self.new, self.old)
            self.assertEqual((self.root / 'current').resolve(), self.old)
            self.assertEqual(health.call_args_list[1].args, (self.old,))
            self.assertEqual(run.call_count, 2)

    def test_no_pending_keeps_config_keys_shared_files_and_never_migrates_or_seeds(self):
        shared = self.root / 'shared'
        shared.mkdir()
        for name in ['staging.env', 'keyring', 'image', 'revocation.json']:
            (shared / name).write_bytes(b'original bytes')
        with patch.object(d, 'verify_service'), patch.object(d, 'extract', return_value=self.new), \
             patch.object(d, 'probe', side_effect=['ready', 'ready', '[]']), patch.object(d, 'run'), \
             patch.object(d, 'backup') as backup, patch.object(d, 'migrate') as migrate, patch.object(d, 'switch'):
            d.update('archive', 'b' * 40)
            backup.assert_not_called()
            migrate.assert_not_called()
        self.assertTrue(all(p.read_bytes() == b'original bytes' for p in shared.iterdir()))

    def test_unapproved_migration_stops_before_backup_or_schema_change(self):
        with patch.object(d, 'verify_service'), patch.object(d, 'extract', return_value=self.new), \
             patch.object(d, 'probe', side_effect=['ready', 'ready', '["new-migration"]']), patch.object(d, 'run'), \
             patch.object(d, 'POLICY', self.root / 'missing'), patch.object(d, 'backup') as backup, patch.object(d, 'migrate') as migrate:
            with self.assertRaisesRegex(RuntimeError, 'reviewed backward-compatible hashes'):
                d.update('archive', 'b' * 40)
            backup.assert_not_called()
            migrate.assert_not_called()
        self.assertEqual((self.root / 'current').resolve(), self.old)

    def test_failed_backup_never_migrates(self):
        with patch.object(d, 'verify_service'), patch.object(d, 'extract', return_value=self.new), \
             patch.object(d, 'probe', side_effect=['ready', 'ready', '["approved"]']), patch.object(d, 'compatible'), patch.object(d, 'run'), \
             patch.object(d, 'backup', side_effect=RuntimeError('backup failed')), patch.object(d, 'migrate') as migrate:
            with self.assertRaisesRegex(RuntimeError, 'backup failed'):
                d.update('archive', 'b' * 40)
            migrate.assert_not_called()
        self.assertEqual((self.root / 'current').resolve(), self.old)

    def test_prune_only_old_code_preserves_shared_current_previous_and_links(self):
        obsolete = self.release('c')
        shared = self.root / 'shared'
        shared.mkdir()
        (shared / 'image').write_text('upload')
        (self.root / 'releases' / ('d' * 40)).symlink_to(shared)
        d.prune()
        self.assertFalse(obsolete.exists())
        self.assertTrue(self.old.exists() and self.new.exists())
        self.assertEqual((shared / 'image').read_text(), 'upload')

    def test_prune_refuses_release_containing_uploads(self):
        obsolete = self.release('c')
        (obsolete / 'image').write_text('do not delete')
        with self.assertRaisesRegex(RuntimeError, 'unlisted data'):
            d.prune()
        self.assertTrue((obsolete / 'image').exists())

    def test_archive_traversal_and_symlink_are_rejected(self):
        for kind in ['traversal', 'symlink']:
            archive = self.root / ('11ship-' + 'e' * 40 + '-ubuntu24-amd64.tar.gz')
            with tarfile.open(archive, 'w:gz') as tar:
                member = tarfile.TarInfo(('11ship-' + 'e' * 40 + '-ubuntu24-amd64/') + ('../../escaped' if kind == 'traversal' else 'link'))
                if kind == 'symlink':
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/etc/11ship'
                tar.addfile(member, io.BytesIO())
            archive.with_name(archive.name + '.sha256').write_text(d.digest(archive) + '  ' + archive.name)
            with self.assertRaisesRegex(RuntimeError, 'unsafe artifact'):
                d.extract(archive, 'e' * 40)

    def test_rollback_requires_compatible_deploy_record(self):
        with patch.object(d, 'verify_service'), patch.object(d, 'switch') as switch:
            with self.assertRaises(FileNotFoundError):
                d.rollback()
            switch.assert_not_called()

    def test_operator_env_cannot_override_runtime_file(self):
        with patch.object(d, 'run', return_value='[]') as run:
            d.probe(self.new, 'plan', operator=True)
            args = run.call_args.args[0]
            self.assertLess(args.index('EnvironmentFile=' + d.OPERATOR), args.index('EnvironmentFile=' + d.ENV))

    def test_healthy_https_still_rejects_unavailable_android(self):
        responses = ['active', '{"data":{"status":"ready"}}\n200',
                     '{"data":{"registration_verification":"REQUIRED"}}\n200', '<script src="/js/dom/main.js"></script>\n200']
        with patch.object(d, 'run', side_effect=responses * 12), patch.object(d, 'time') as clock, \
             patch.object(d, 'probe', side_effect=RuntimeError('snapshot stale')) as probe:
            with self.assertRaisesRegex(RuntimeError, 'snapshot stale'):
                d.health(self.new)
            self.assertEqual(probe.call_count, 12)

    def test_rollback_can_recover_a_stopped_application(self):
        properties = {'User': 'ship11', 'Group': 'ship11', 'WorkingDirectory': str(self.root / 'current'),
                      'EnvironmentFiles': d.ENV + ' (ignore_errors=no)', 'ExecStart': 'node apps/backend/dist/main.js',
                      'Environment': '', 'RootDirectory': '', 'RootImage': ''}
        with patch.object(d, 'prop', side_effect=properties.get), patch.object(d, 'run', return_value='/opt/11ship/current/scripts/android-attestation-refresh.mjs /etc/11ship/trust/android-attestation-revocation.json') as run:
            d.verify_service()
            self.assertFalse(any('is-active' in call.args[0] for call in run.call_args_list))

    def test_only_exact_root_owned_non_writable_refresh_wrapper_is_accepted(self):
        from types import SimpleNamespace
        wrapper = self.root / 'refresh-android.sh'
        wrapper.write_text(d.REFRESH_WRAPPER_CONTENT)
        wrapper.chmod(0o755)
        properties = {'User': 'ship11', 'Group': 'ship11', 'WorkingDirectory': str(self.root / 'current'),
                      'EnvironmentFiles': d.ENV + ' (ignore_errors=no)', 'ExecStart': 'node apps/backend/dist/main.js',
                      'Environment': '', 'RootDirectory': '', 'RootImage': ''}
        start = '{ path=/opt/11ship/tools/refresh-android.sh ; argv[]=/opt/11ship/tools/refresh-android.sh ; }'
        with patch.object(d, 'prop', side_effect=properties.get), patch.object(d, 'run', return_value=start), \
             patch.object(d, 'REFRESH_WRAPPER', wrapper):
            # lstat owner is mocked so this test also runs as a non-root developer.
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_uid=0, st_mode=0o100755)):
                d.verify_service()
                wrapper.write_text(d.REFRESH_WRAPPER_CONTENT + 'echo changed\n')
                with self.assertRaisesRegex(RuntimeError, 'wrapper content or permissions'):
                    d.verify_service()
            wrapper.write_text(d.REFRESH_WRAPPER_CONTENT)
            for owner, mode in [(1000, 0o100755), (0, 0o100775)]:
                with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_uid=owner, st_mode=mode)):
                    with self.assertRaisesRegex(RuntimeError, 'wrapper content or permissions'):
                        d.verify_service()

    def test_verified_release_permissions_ignore_restrictive_umask(self):
        folder = self.new / 'apps/backend'
        folder.mkdir(parents=True)
        script = folder / 'main.js'
        script.write_text('code')
        executable = folder / 'tool'
        executable.write_text('tool')
        for path in (self.new, self.new / 'apps', folder):
            path.chmod(0o700)
        script.chmod(0o600)
        executable.chmod(0o700)
        d.make_release_readable(self.new)
        for path in (self.new, self.new / 'apps', folder):
            self.assertEqual(path.stat().st_mode & 0o777, 0o755)
        self.assertEqual(script.stat().st_mode & 0o777, 0o644)
        self.assertEqual(executable.stat().st_mode & 0o777, 0o755)
        self.assertEqual(script.read_text(), 'code')

    def test_existing_release_retry_checks_all_files_and_refuses_drift(self):
        import shutil
        verified = self.root / 'verified'
        shutil.copytree(self.new, verified)
        d.verify_existing_release(self.new, verified)
        (self.new / 'code').write_text('modified')
        with self.assertRaisesRegex(RuntimeError, 'never overwrite'):
            d.verify_existing_release(self.new, verified)
        self.assertEqual((self.new / 'code').read_text(), 'modified')

    def test_existing_release_retry_refuses_links_and_extra_files(self):
        import shutil
        verified = self.root / 'verified'
        shutil.copytree(self.new, verified)
        extra = self.new / 'extra'
        extra.write_text('user data')
        with self.assertRaisesRegex(RuntimeError, 'never overwrite'):
            d.verify_existing_release(self.new, verified)
        extra.unlink()
        extra.symlink_to(self.old / 'code')
        with self.assertRaisesRegex(RuntimeError, 'links or special'):
            d.verify_existing_release(self.new, verified)

    def test_same_release_retry_preserves_rollback_record(self):
        before = (self.root / 'previous').resolve()
        with patch.object(d, 'verify_service'), patch.object(d, 'extract', return_value=self.old), \
             patch.object(d, 'probe', side_effect=['ready', 'ready', '[]']), patch.object(d, 'run'), \
             patch.object(d, 'health') as health, patch.object(d, 'save_state') as save, \
             patch.object(d, 'switch') as switch:
            d.update('archive', 'a' * 40)
            health.assert_called_once_with(self.old)
            switch.assert_not_called()
            save.assert_not_called()
        self.assertEqual((self.root / 'previous').resolve(), before)


if __name__ == '__main__':
    unittest.main()
