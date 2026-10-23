import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { checkAndroid } = require('../../scripts/deploy/android-readiness.cjs');

test('internal readiness uses real parsers and guard: legacy missing/expired/future/near-expiry trust fails; password-only mode needs none', async () => {
  const dir = mkdtempSync(join(resolve('..'), '.android-readiness-')); 
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(dir, 'key'), '-out', join(dir, 'roots'), '-days', '1', '-subj', '/CN=readiness-test', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
    writeFileSync(join(dir, 'signers'), JSON.stringify({
      FOOD: { package_name: 'vn.eleven.food.test', signer_sha256: 'ab'.repeat(32) },
      SHIP: { package_name: 'vn.eleven.ship.test', signer_sha256: 'ab'.repeat(32) },
    }));
    const env = { APP_ENV: 'production', HOST: '127.0.0.1', CLIENT_AUTH_ANDROID_ENABLED: 'true', CLIENT_DEVICE_ENVIRONMENT: 'production',
      CLIENT_DEVICE_ALLOWED_SIGNERS_FILE: join(dir, 'signers'), CLIENT_DEVICE_ATTESTATION_ROOTS_FILE: join(dir, 'roots'), CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE: join(dir, 'snapshot') };
    const now = Date.now();
    const snapshot = age => writeFileSync(join(dir, 'snapshot'), JSON.stringify({ fetched_at: new Date(now - age * 3600000).toISOString(), entries: {} }));
    await assert.rejects(checkAndroid(env), /CLIENT_DEVICE_ATTESTATION_REVOCATION_FILE/);
    snapshot(1);
    assert.equal((await checkAndroid(env, resolve('.'), now)).androidTrust, 'ready');
    for (const age of [25, -1, 18.1]) {
      snapshot(age);
      await assert.rejects(checkAndroid(env, resolve('.'), now), /snapshot/);
    }
    snapshot(0);
    assert.equal((await checkAndroid({ APP_ENV: 'production', CLIENT_AUTH_ANDROID_ENABLED: 'false' })).accountAuthentication, 'password');
    const signers = readFileSync(join(dir, 'signers'), 'utf8');
    writeFileSync(join(dir, 'signers'), signers.replace('vn.eleven.food.test', 'untrusted.package'));
    await assert.rejects(checkAndroid(env), /CLIENT_DEVICE_ALLOWED_SIGNERS_FILE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('VPS orchestrator regression suite runs in deploy CI', () => {
  execFileSync('python3', ['-B', 'tests/deploy/vps-update.test.py'], { stdio: 'inherit' });
});
