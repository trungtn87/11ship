import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPY_ENTRIES, runtimePackageJson } from '../../scripts/deploy/build-ubuntu-artifact.mjs';

test('documented push:check command starts from a standalone release and refuses without credentials', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const release = mkdtempSync(join(tmpdir(), '11ship-push-release-'));
  try {
    writeFileSync(join(release, 'package.json'), JSON.stringify(runtimePackageJson('a'.repeat(40))));
    // Use exactly the operator files selected by the artifact builder; no access to the source checkout from the child.
    for (const [from, to] of COPY_ENTRIES.filter(([, to]) => to === 'scripts/push-check.js')) {
      mkdirSync(dirname(join(release, to)), { recursive: true });
      cpSync(join(root, from), join(release, to));
    }
    const dist = join(release, 'apps', 'backend', 'dist');
    mkdirSync(join(dist, 'config'), { recursive: true });
    mkdirSync(join(dist, 'notifications'), { recursive: true });
    // The packaged CLI should stop before touching the provider when no FCM configuration exists.
    writeFileSync(join(dist, 'config', 'push-config.js'), 'exports.parsePushConfig = () => ({ ok: true, config: undefined });');
    writeFileSync(join(dist, 'notifications', 'push-provider.js'), 'exports.FcmPushProvider = class { constructor() { throw new Error("provider must not start"); } };');
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '--silent', 'push:check'], {
      cwd: release,
      env: { PATH: process.env.PATH, HOME: release, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec } : {}) },
      shell: process.platform === 'win32',
      encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.error?.message ?? result.stderr);
    assert.match(result.stderr, /push:check: NOT_CONFIGURED/);
    assert.doesNotMatch(result.stderr, /Missing script|MODULE_NOT_FOUND|provider must not start/);
  } finally {
    rmSync(release, { recursive: true, force: true });
  }
});
