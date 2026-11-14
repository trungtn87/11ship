// Guard for the release AAB workflow (STORE-01 PR-A, #344). Two kinds of check:
//  1. the workflow file itself: manual dispatch only, main only, the protected environment, the upload-key secrets only on the
//     signing step, no Google Play upload, and the bundletool pin;
//  2. the merged-manifest checker mobile/tool/check-aab-release.py on fixture manifests (the same XML shape bundletool prints).
// No secret, no network: the workflow is read as text and the checker runs on local fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKFLOW = '.github/workflows/mobile-aab-release.yml';
const CHECKER = 'mobile/tool/check-aab-release.py';
const workflow = readFileSync(WORKFLOW, 'utf8');
const UPLOAD_NAMES = ['ANDROID_UPLOAD_KEYSTORE_BASE64', 'ANDROID_UPLOAD_KEYSTORE_PASSWORD', 'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD', 'ANDROID_UPLOAD_CERT_SHA256'];

// The top-level `on:` block: its lines up to the next top-level key.
function onBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^on:\s*$/.test(l));
  assert.notEqual(start, -1, 'the workflow has an on: block');
  const out = [];
  for (let i = start + 1; i < lines.length && (lines[i] === '' || /^\s/.test(lines[i])); i++) out.push(lines[i]);
  return out.join('\n');
}

test('the release workflow is started by hand only: workflow_dispatch and nothing else', () => {
  const block = onBlock(workflow);
  assert.match(block, /^\s{2}workflow_dispatch:/m);
  for (const trigger of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_call', 'release', 'repository_dispatch']) {
    assert.doesNotMatch(block, new RegExp(`^\\s{2}${trigger}:`, 'm'), `no ${trigger} trigger`);
  }
});

test('the app input is a choice of food or ship only', () => {
  assert.match(workflow, /app:\n\s+description:[^\n]*\n\s+required: true\n\s+type: choice\n\s+options:\n\s+- food\n\s+- ship/);
});

test('the build job runs only from main and only inside the protected environment android-release', () => {
  assert.match(workflow, /^\s{4}if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(workflow, /^\s{4}environment: android-release$/m);
  assert.match(workflow, /if \[ "\$GITHUB_REF" != "refs\/heads\/main" \]; then/, 'a step refuses any other ref too');
});

test('the upload-key secrets and the upload pin are named only in this workflow', () => {
  const others = readdirSync('.github/workflows').filter(f => f.endsWith('.yml') && f !== 'mobile-aab-release.yml');
  for (const file of others) {
    const text = readFileSync(join('.github/workflows', file), 'utf8');
    for (const name of UPLOAD_NAMES) assert.equal(text.includes(name), false, `${name} must not appear in ${file}`);
  }
});

test('the upload secrets reach only the signing step, not the whole job', () => {
  const steps = workflow.split(/\n\s{6}- /);
  const withUpload = steps.filter(s => s.includes('ANDROID_UPLOAD_KEYSTORE_BASE64: ${{ secrets'));
  // one step for the presence check and one for the signing step; every other step stays free of them
  assert.equal(withUpload.length, 2);
  assert.ok(withUpload.some(s => s.includes('name: Sign the bundle with the upload key')));
  assert.ok(withUpload.some(s => s.includes('name: Require the upload-key secrets')));
  assert.equal(/^\s{4}env:\s*\n\s{6}ANDROID_UPLOAD_/m.test(workflow), false, 'no job-level env carries the upload secrets');
});

test('nothing uploads to Google Play, publishes a release or creates a tag', () => {
  for (const term of ['r0adkll', 'upload-google-play', 'google-play', 'androidpublisher', 'fastlane', 'play-publish', 'gh release', 'git tag', 'git push', 'softprops/action-gh-release']) {
    assert.equal(workflow.includes(term), false, `no ${term}`);
  }
  assert.equal(/Not uploaded to Google Play/.test(workflow), true, 'the summary states the real status');
  assert.equal(/'uploaded_to_play': False/.test(workflow), true, 'the release record says it was not uploaded');
});

test('bundletool 1.18.3 is pinned: fixed release-tag URL, the official SHA-256, verified before java runs, fail closed', () => {
  const url = 'https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar';
  const pin = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29';
  assert.ok(workflow.includes(`curl -fsSL -o "$bt" ${url}`), 'download from the fixed tag');
  assert.doesNotMatch(workflow, /releases\/latest|bundletool-all-latest/, 'never "latest"');
  assert.ok(workflow.includes(`echo "${pin}  $bt" | sha256sum -c -`), 'the official checksum is checked on the downloaded file');
  assert.ok(workflow.includes('set -euo pipefail'), 'the step stops on any error');
  const download = workflow.indexOf(`curl -fsSL -o "$bt" ${url}`);
  const verify = workflow.indexOf('sha256sum -c -');
  const run = workflow.indexOf('java -jar "$bt" dump manifest');
  assert.ok(download > 0 && verify > download && run > verify, 'download, then verify the checksum, then run the jar');
});

test('the artifact is short-lived and named by the release version', () => {
  assert.match(workflow, /name: \$\{\{ env\.ARTIFACT_BASENAME \}\}-aab/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(workflow, /python3 mobile\/tool\/check-aab-release\.py/, 'the merged manifest is checked before the artifact is uploaded');
});

test('the bundletool checksum gate really fails closed: a file that is not the official jar is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-pin-'));
  try {
    const fake = join(dir, 'bundletool-all-1.18.3.jar');
    writeFileSync(fake, 'not the official bundletool');
    const pin = 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29';
    const r = spawnSync('bash', ['-c', `set -euo pipefail; echo "${pin}  ${fake}" | sha256sum -c - || exit 1; echo RAN`], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.ok(!r.stdout.includes('RAN'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the merged-manifest checker, on fixtures ----

const ANDROID = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const NET = 'android.permission.INTERNET';
const PEER = 'vn.eleven.n11.permission.PEER_ENDORSEMENT';
const FOOD_OK = {
  pkg: 'vn.eleven.food', name: '1.0.0', code: '1', target: 36,
  permissions: [NET, PEER, 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.POST_NOTIFICATIONS'],
  services: [],
};
const SHIP_OK = {
  pkg: 'vn.eleven.ship', name: '1.0.0', code: '1', target: 36,
  permissions: [NET, PEER, 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_LOCATION'],
  services: [{ name: 'vn.eleven.m14.flutter.ShipLocationService', fgs: 'location' }],
};

function manifestXml(spec) {
  const perms = spec.permissions.map(n => `  <uses-permission android:name="${n}"/>`).join('\n');
  const services = spec.services.map(s => `  <application><service android:name="${s.name}" android:exported="false" android:foregroundServiceType="${s.fgs}"/></application>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest ${ANDROID} package="${spec.pkg}" android:versionCode="${spec.code}" android:versionName="${spec.name}">
${perms}
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="${spec.target}"/>
${services}
</manifest>
`;
}

function check(app, spec, { name = '1.0.0', code = '1' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aab-manifest-'));
  try {
    const file = join(dir, 'manifest.xml');
    writeFileSync(file, manifestXml(spec));
    const r = spawnSync('python3', [CHECKER, app, file, name, code], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the checker accepts a clean food bundle and a clean ship bundle', () => {
  const food = check('food', FOOD_OK);
  assert.equal(food.status, 0, food.out);
  assert.match(food.out, /aab ok \(food\): vn\.eleven\.food 1\.0\.0\+1, targetSdk 36/);
  const ship = check('ship', SHIP_OK);
  assert.equal(ship.status, 0, ship.out);
});

test('REQUEST_INSTALL_PACKAGES is refused in both apps', () => {
  for (const [app, spec] of [['food', FOOD_OK], ['ship', SHIP_OK]]) {
    const r = check(app, { ...spec, permissions: [...spec.permissions, 'android.permission.REQUEST_INSTALL_PACKAGES'] });
    assert.equal(r.status, 1);
    assert.match(r.out, /forbidden permission/);
  }
});

test('background location is refused, including in ship', () => {
  const r = check('ship', { ...SHIP_OK, permissions: [...SHIP_OK.permissions, 'android.permission.ACCESS_BACKGROUND_LOCATION'] });
  assert.equal(r.status, 1);
  assert.match(r.out, /ACCESS_BACKGROUND_LOCATION/);
});

test('food carries no GPS service and no location foreground permission', () => {
  const withShipService = check('food', { ...FOOD_OK, services: [{ name: 'vn.eleven.m14.flutter.ShipLocationService', fgs: 'location' }] });
  assert.equal(withShipService.status, 1);
  assert.match(withShipService.out, /GPS service/);
  const withFgsLocation = check('food', { ...FOOD_OK, permissions: [...FOOD_OK.permissions, 'android.permission.FOREGROUND_SERVICE_LOCATION'] });
  assert.equal(withFgsLocation.status, 1);
  assert.match(withFgsLocation.out, /unexpected permission/);
});

test('ship must declare ShipLocationService with the location foreground type', () => {
  const missing = check('ship', { ...SHIP_OK, services: [] });
  assert.equal(missing.status, 1);
  assert.match(missing.out, /ShipLocationService/);
  const wrongType = check('ship', { ...SHIP_OK, services: [{ name: 'vn.eleven.m14.flutter.ShipLocationService', fgs: 'dataSync' }] });
  assert.equal(wrongType.status, 1);
  assert.match(wrongType.out, /foregroundServiceType="location"/);
});

test('targetSdk below 36 is refused', () => {
  const r = check('food', { ...FOOD_OK, target: 35 });
  assert.equal(r.status, 1);
  assert.match(r.out, /targetSdkVersion must be >= 36/);
});

test('a bundle with the wrong applicationId is refused', () => {
  const r = check('food', { ...FOOD_OK, pkg: 'vn.eleven.food.test' });
  assert.equal(r.status, 1);
  assert.match(r.out, /applicationId/);
});

test('a version that differs from pubspec is refused', () => {
  const r = check('ship', SHIP_OK, { code: '2' });
  assert.equal(r.status, 1);
  assert.match(r.out, /version mismatch/);
});

test('an unlisted permission is refused (the allowlist is exact)', () => {
  const r = check('food', { ...FOOD_OK, permissions: [...FOOD_OK.permissions, 'android.permission.CAMERA'] });
  assert.equal(r.status, 1);
  assert.match(r.out, /CAMERA/);
});
