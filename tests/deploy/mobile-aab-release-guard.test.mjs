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

test('the upload secrets reach only the signing step, not the whole job (Codex, PR #351)', () => {
  const steps = workflow.split(/\n\s{6}- /);
  const withUpload = steps.filter(s => /ANDROID_UPLOAD_(KEYSTORE_BASE64|KEYSTORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD):\s*\$\{\{\s*secrets\./.test(s));
  assert.equal(withUpload.length, 1, 'exactly one step receives the upload secrets');
  assert.ok(withUpload[0].includes('name: Sign the bundle with the upload key'));
  assert.equal(/^\s{4}env:/m.test(workflow), false, 'no job-level env at all');
  assert.equal(/^env:/m.test(workflow), false, 'no workflow-level env');
});

test('every action is a SHA-pinned allowlist entry; the workflow names no tag, branch or latest', () => {
  const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map(m => m[1]);
  assert.equal(uses.length, 4, 'checkout, setup-java, flutter-action, upload-artifact');
  for (const value of uses) assert.match(value, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/, value);
  assert.doesNotMatch(workflow, /@(v\d|main|master|latest)\b/);
});

test('nothing uploads to Google Play, publishes a release or creates a tag', () => {
  for (const term of ['r0adkll', 'upload-google-play', 'google-play', 'androidpublisher', 'fastlane', 'play-publish', 'gh release', 'git tag', 'git push', 'softprops/action-gh-release']) {
    assert.equal(workflow.includes(term), false, `no ${term}`);
  }
  assert.match(workflow, /'uploaded_to_play': False/, 'the release record says it was not uploaded');
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
  const services = spec.services.map(s => `  <application><service android:name="${s.name}" android:exported="false"${s.fgs === undefined ? '' : ` android:foregroundServiceType="${s.fgs}"`}/></application>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest ${ANDROID} package="${spec.pkg}" android:versionCode="${spec.code}" android:versionName="${spec.name}">
${perms}
  <uses-sdk android:minSdkVersion="26" android:targetSdkVersion="${spec.target}"/>
${services}
</manifest>
`;
}

// The checker reads the committed Play record and has no override (the script is pinned). So the default fixture versionCode
// is derived from that record: the committed highest for the app + 1. It is above the record whatever Owner has recorded,
// and the foregroundServiceType cases below stay about the manifest. An explicit `code` is used exactly as given.
const RECORD = 'mobile/release/play-submitted-versioncode.json';
const nextCode = app => JSON.parse(readFileSync(RECORD, 'utf8')).apps[app].highest_submitted_version_code + 1;

function check(app, spec, { name = '1.0.0', code } = {}) {
  let body = spec;
  if (code === undefined) {
    code = String(nextCode(app));
    body = { ...spec, code };
  }
  const dir = mkdtempSync(join(tmpdir(), 'aab-manifest-'));
  try {
    const file = join(dir, 'manifest.xml');
    writeFileSync(file, manifestXml(body));
    const r = spawnSync('python3', [CHECKER, app, file, name, code], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the checker accepts a clean food bundle and a clean ship bundle', () => {
  const food = check('food', FOOD_OK);
  assert.equal(food.status, 0, food.out);
  assert.match(food.out, new RegExp(`aab ok \\(food\\): vn\\.eleven\\.food 1\\.0\\.0\\+${nextCode('food')}, targetSdk 36`));
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
  assert.match(wrongType.out, /location \(name "location" or flag 0x8\); the bundle says foregroundServiceType='dataSync'/);
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

const SHIP_FGS = 'android.permission.FOREGROUND_SERVICE';
const SHIP_FGS_LOC = 'android.permission.FOREGROUND_SERVICE_LOCATION';

test('ship needs BOTH foreground-service permissions: each one alone is refused (Codex, PR #351)', () => {
  const onlyFgs = check('ship', { ...SHIP_OK, permissions: SHIP_OK.permissions.filter(p => p !== SHIP_FGS_LOC) });
  assert.equal(onlyFgs.status, 1, onlyFgs.out);
  assert.match(onlyFgs.out, /FOREGROUND_SERVICE_LOCATION/);
  const onlyLocation = check('ship', { ...SHIP_OK, permissions: SHIP_OK.permissions.filter(p => p !== SHIP_FGS) });
  assert.equal(onlyLocation.status, 1, onlyLocation.out);
  assert.match(onlyLocation.out, /FOREGROUND_SERVICE\b/);
  assert.equal(check('ship', SHIP_OK).status, 0, 'both present: accepted');
});

test('food must carry neither foreground-service permission, and its service stays out of the bundle', () => {
  for (const perm of [SHIP_FGS, SHIP_FGS_LOC]) {
    const r = check('food', { ...FOOD_OK, permissions: [...FOOD_OK.permissions, perm] });
    assert.equal(r.status, 1, perm);
    assert.match(r.out, /forbidden permission|unexpected permission/);
  }
  const gps = check('food', { ...FOOD_OK, services: [{ name: 'vn.eleven.m14.gps.RecorderService', fgs: 'location' }] });
  assert.equal(gps.status, 1);
  assert.match(gps.out, /GPS service|location foreground service/);
});

test('the DYNAMIC_RECEIVER permission is accepted only for the app\'s own package (Codex, PR #351)', () => {
  const own = (pkg, spec) => ({ ...spec, permissions: [...spec.permissions, `${pkg}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`] });
  assert.equal(check('food', own('vn.eleven.food', FOOD_OK)).status, 0, 'own package: accepted');
  assert.equal(check('ship', own('vn.eleven.ship', SHIP_OK)).status, 0, 'own package: accepted');
  const foreign = check('food', own('vn.eleven.ship', FOOD_OK));
  assert.equal(foreign.status, 1, 'the other app\'s prefix is refused');
  assert.match(foreign.out, /unexpected permission/);
  const prefixed = check('ship', { ...SHIP_OK, permissions: [...SHIP_OK.permissions, 'vn.eleven.ship.test.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'] });
  assert.equal(prefixed.status, 1, 'a look-alike prefix is refused');
});

test('an unlisted permission is refused (the allowlist is exact)', () => {
  const r = check('food', { ...FOOD_OK, permissions: [...FOOD_OK.permissions, 'android.permission.CAMERA'] });
  assert.equal(r.status, 1);
  assert.match(r.out, /CAMERA/);
});

// ---- foregroundServiceType as bundletool may print it: name, '|' list, or the numeric/hex flag value (location = 0x8) ----

const shipWithFgs = fgs => check('ship', { ...SHIP_OK, services: [{ name: 'vn.eleven.m14.flutter.ShipLocationService', fgs }] });

test('ship accepts every printed form of the location flag: name, list, decimal and hex values with bit 0x8 set', () => {
  for (const fgs of ['location', '8', '0x8', '0X8', 'location|dataSync', 'dataSync|location', '9', '0x9', '10', '0x0A', '12']) {
    const r = shipWithFgs(fgs);
    assert.equal(r.status, 0, `${fgs}: ${r.out}`);
  }
});

test('ship refuses a service without the location flag and prints the real value it saw', () => {
  for (const fgs of ['dataSync', '1', '0', '0x0', '0x1', '2', 'dataSync|connectedDevice', '7']) {
    const r = shipWithFgs(fgs);
    assert.equal(r.status, 1, `${fgs} must fail`);
    assert.match(r.out, /foreground service type/, fgs);
    assert.ok(r.out.includes(`foregroundServiceType='${fgs}'`), `${fgs} printed: ${r.out}`);
  }
});

test('ship refuses a service with no foregroundServiceType attribute at all', () => {
  const r = check('ship', { ...SHIP_OK, services: [{ name: 'vn.eleven.m14.flutter.ShipLocationService', fgs: undefined }] });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /foregroundServiceType=None/);
});

test('food refuses the location flag in any printed form, not only the name', () => {
  for (const fgs of ['location', '8', '0x8', 'dataSync|location', '9']) {
    const r = check('food', { ...FOOD_OK, services: [{ name: 'vn.eleven.n11.SyncService', fgs }] });
    assert.equal(r.status, 1, `${fgs}: ${r.out}`);
    assert.match(r.out, /location foreground service/, fgs);
  }
});

test('food accepts a non-location service type (dataSync, numeric 1)', () => {
  for (const fgs of ['dataSync', '1']) {
    const r = check('food', { ...FOOD_OK, services: [{ name: 'vn.eleven.n11.SyncService', fgs }] });
    assert.equal(r.status, 0, `${fgs}: ${r.out}`);
  }
});

// The form bundletool 1.18.3 really prints (checked on a ship bundle built 16/11/2026): 0x00000008 = location.
test('ship accepts the 8-digit hex form bundletool prints (0x00000008), and refuses 0x00000001 (dataSync)', () => {
  assert.equal(shipWithFgs('0x00000008').status, 0, 'location flag set');
  assert.equal(shipWithFgs('0x00000009').status, 0, 'dataSync|location');
  const r = shipWithFgs('0x00000001');
  assert.equal(r.status, 1);
  assert.ok(r.out.includes("foregroundServiceType='0x00000001'"), r.out);
});
