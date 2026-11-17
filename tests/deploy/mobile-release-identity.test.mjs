// Regression guard for the official Android identity (Owner decision 13/11/2026): one version source per app, official applicationIds,
// and no CI sequence that could contradict the pubspec. Reads files only; no device, no signing key, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/mobile-apk.yml', 'utf8');
const script = 'mobile/tool/app-version.sh';

test('app-version.sh derives name, code and APK file from the pubspec for both apps', () => {
  const food = execFileSync('bash', [script, 'food'], { encoding: 'utf8' }).trim();
  const ship = execFileSync('bash', [script, 'ship'], { encoding: 'utf8' }).trim();
  assert.match(food, /^\d+\.\d+\.\d+ \d+ 11Food-v\d+\.\d+\.\d+$/);
  assert.match(ship, /^\d+\.\d+\.\d+ \d+ 11Ship-v\d+\.\d+\.\d+$/);
  const pubspec = readFileSync('mobile/food/pubspec.yaml', 'utf8');
  const [name, code] = food.split(' ');
  assert.ok(pubspec.includes(`version: ${name}+${code}`), 'versionName/versionCode must come from pubspec.yaml');
});

test('the workflow never takes versionCode from run_number and reads the pubspec identity', () => {
  assert.equal(/versionCode=['"]?\$\{\{ github\.run_number/.test(workflow), false);
  assert.equal(/--build-number="\$\{\{ github\.run_number/.test(workflow), false);
  assert.ok(workflow.includes('mobile/tool/app-version.sh'), 'CI must read the release identity through app-version.sh');
  assert.ok(workflow.includes("grep -q \"versionName='$APP_VERSION_NAME'\""), 'CI must verify the APK versionName');
});

test('current app code, CI and tests name only the official applicationIds (gateway excluded)', () => {
  const files = ['mobile/tool/prepare-android.sh', 'mobile/tool/check-apk-permissions.sh', 'apps/backend/src/ops/ops-constants.ts', 'apps/backend/src/config/client-device-config.ts', '.github/workflows/mobile-apk.yml'];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.equal(/vn\.eleven\.(food|ship)\.test/.test(text), false, `${file} still names a .test applicationId`);
  }
  assert.ok(readFileSync('mobile/tool/prepare-android.sh', 'utf8').includes('app_id="vn.eleven.food"'));
  assert.ok(readFileSync('mobile/tool/prepare-android.sh', 'utf8').includes('app_id="vn.eleven.ship"'));
});
