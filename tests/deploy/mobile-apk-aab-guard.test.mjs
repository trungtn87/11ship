// Regression guard (Codex re-review, PR #345): the Mobile APK workflow runs on pull_request and push, so it must never
// reference the upload-key secrets and must never publish a bundle (.aab) as an artifact. Signing of the AAB belongs to a
// later release workflow that runs in a protected environment (not in this PR). Reads the workflow file only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/mobile-apk.yml', 'utf8');
const lines = workflow.split('\n');

test('the Mobile APK workflow never references the upload-key secrets or pins', () => {
  assert.equal(workflow.includes('ANDROID_UPLOAD_'), false, 'no ANDROID_UPLOAD_* reference in the PR/push workflow');
  assert.equal(workflow.includes('ANDROID_UPLOAD_CERT_SHA256'), false, 'no upload certificate variable in the PR/push workflow');
});

test('no upload-artifact step publishes a bundle (.aab)', () => {
  // A path: line that names an .aab file anywhere in the workflow is an artifact publication of a bundle.
  const aabPaths = lines.filter(l => /^\s*path:\s*.*\.aab\b/.test(l));
  assert.deepEqual(aabPaths, [], 'no artifact path may point at an .aab file');
  assert.equal(/actions\/upload-artifact@[^\n]*\n(?:[^\n]*\n){0,8}?[^\n]*\.aab\b/.test(workflow), false, 'no upload-artifact step names an .aab');
});

test('the bundle is built into a temporary path only, with the structure check and a plain summary', () => {
  assert.ok(workflow.includes('tmp="$RUNNER_TEMP/compiled-$APK_BASENAME.aab"'), 'bundle copied to a runner temp path');
  assert.ok(workflow.includes("unzip -l \"$tmp\" | grep -q 'base/manifest/AndroidManifest.xml'"), 'base manifest check kept');
  assert.ok(workflow.includes('AAB: compiled and structure-checked only; not signed, not uploaded'), 'summary states the real status');
});
