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

test('the test APK is pinned only by ANDROID_TEST_SIGNER_SHA256; the Production pin never reaches the PR/push workflow (STORE-01 PR-D)', () => {
  // Lead decision: ANDROID_APP_SIGNER_SHA256 belongs to the AAB/Production release; the test APK has its own variable.
  assert.equal(workflow.includes('ANDROID_APP_SIGNER_SHA256'), false, 'no Production pin variable in the Mobile APK workflow');
  assert.equal(workflow.includes('ANDROID_APP_SIGNER_PIN'), false, 'no Production pin env name in the Mobile APK workflow');
  assert.ok(workflow.includes('ANDROID_TEST_SIGNER_PIN: ${{ vars.ANDROID_TEST_SIGNER_SHA256 }}'), 'the test pin comes from ANDROID_TEST_SIGNER_SHA256');
  // The pin stays optional: unset means "not pinned yet", never a failed build (current behaviour kept).
  assert.ok(workflow.includes('if [ -n "${ANDROID_TEST_SIGNER_PIN:-}" ]; then'), 'the check runs only when the test pin is set');
  assert.ok(workflow.includes('ANDROID_TEST_SIGNER_SHA256 is not set (test signer not pinned yet)'), 'an unset pin is reported, not failed');
  assert.ok(workflow.includes('[ "$apk_fp" = "$ANDROID_TEST_SIGNER_PIN" ]'), 'a set pin must equal the APK signer exactly');
});

// STORE-01 PR-E: a stricter detector for the Production signer pin. It catches every access form (dot, quoted bracket, dynamic bracket,
// whole-object toJSON(vars)), any mention of the Production variable, and a step-level env override of the test pin.
// It returns a list of problems; an empty list means the workflow is clean.
const PRODUCTION_NAME = /ANDROID_APP_SIGNER/i;
const VARS_REFERENCE = /\bvars\b/g;
const VARS_ALLOWED_ACCESS = /^\s*(?:\.\s*[A-Za-z_][A-Za-z0-9_]*|\[\s*(['"])[A-Z0-9_]+\1\s*\])/;
const TEST_PIN_ASSIGNMENT = /^\s*ANDROID_TEST_SIGNER_PIN:[ \t]*(.*)$/gm;
const TEST_PIN_VALUE = '${{ vars.ANDROID_TEST_SIGNER_SHA256 }}';

function pinProblems(text) {
  const problems = [];
  if (PRODUCTION_NAME.test(text)) problems.push('a Production signer variable name appears');
  for (const m of text.matchAll(VARS_REFERENCE)) {
    if (!VARS_ALLOWED_ACCESS.test(text.slice(m.index + m[0].length))) {
      problems.push(`vars is used in a dynamic or whole-object form at offset ${m.index}`);
    }
  }
  const assigned = [...text.matchAll(TEST_PIN_ASSIGNMENT)].map(m => m[1].trim());
  if (assigned.length !== 1) problems.push(`ANDROID_TEST_SIGNER_PIN must be assigned exactly once (found ${assigned.length})`);
  else if (assigned[0] !== TEST_PIN_VALUE) problems.push(`ANDROID_TEST_SIGNER_PIN must come from ANDROID_TEST_SIGNER_SHA256 (found ${assigned[0]})`);
  return problems;
}

test('the Mobile APK workflow passes the Production-pin detector (positive: the real workflow)', () => {
  assert.deepEqual(pinProblems(workflow), []);
});

test('the detector accepts ordinary non-signer vars reads (dot and quoted bracket)', () => {
  const sample = [
    `ANDROID_TEST_SIGNER_PIN: ${TEST_PIN_VALUE}`,
    '          FCM_PROJECT_ID: ${{ vars.FCM_PROJECT_ID }}',
    "          FCM_SENDER_ID: ${{ vars['FCM_SENDER_ID'] }}",
  ].join('\n');
  assert.deepEqual(pinProblems(sample), []);
});

test('the detector refuses each Production-pin access form and each step-level override (negative cases)', () => {
  const pinLine = lines.find(l => /^\s*ANDROID_TEST_SIGNER_PIN:/.test(l));
  assert.ok(pinLine, 'the real workflow has the test pin line');
  const expr = body => '${{ ' + body + ' }}';
  const mutations = {
    'dot access to the Production variable': pinLine.replace(TEST_PIN_VALUE, expr('vars.ANDROID_APP_SIGNER_SHA256')),
    "single-quoted bracket access to the Production variable": pinLine.replace(TEST_PIN_VALUE, expr("vars['ANDROID_APP_SIGNER_SHA256']")),
    'double-quoted bracket access to the Production variable': pinLine.replace(TEST_PIN_VALUE, expr('vars["ANDROID_APP_SIGNER_SHA256"]')),
    'test pin overridden by another variable at step level': pinLine.replace(TEST_PIN_VALUE, expr('vars.N11_DEVICE_ENVIRONMENT')),
    'dynamic bracket name built with format()': pinLine.replace(TEST_PIN_VALUE, expr("vars[format('ANDROID_APP_{0}', 'SIGNER_SHA256')]")),
    'whole vars object serialised': pinLine.replace(TEST_PIN_VALUE, expr('toJSON(vars)')),
    'a second step env line naming the Production variable': `${pinLine}\n          ANDROID_APP_SIGNER_PIN: ${expr('vars.ANDROID_APP_SIGNER_SHA256')}`,
    'the test pin assigned twice (second override)': `${pinLine}\n${pinLine}`,
  };
  for (const [name, replacement] of Object.entries(mutations)) {
    const mutated = workflow.replace(pinLine, replacement);
    assert.notEqual(mutated, workflow, `mutation applied: ${name}`);
    assert.notDeepEqual(pinProblems(mutated), [], `the detector must refuse: ${name}`);
  }
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
