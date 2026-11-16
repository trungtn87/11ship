// Regression guard (Codex re-review, PR #345): the Mobile APK workflow runs on pull_request and push, so it must never
// reference the upload-key secrets and must never publish a bundle (.aab) as an artifact. Signing of the AAB belongs to a
// later release workflow that runs in a protected environment (not in this PR). Reads the workflow file only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/mobile-apk.yml', 'utf8').replace(/\r\n/g, '\n');
const lines = workflow.split('\n');

// STORE-01 PR-G: comments never count as references. A full-line `#` comment is dropped, and so is a trailing `#` comment that
// sits outside quotes. A `#` inside quotes is kept, so a real secret reference after it is still seen.
function stripComments(text) {
  return text.split('\n').map(line => {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }).join('\n');
}
const code = stripComments(workflow);

test('the Mobile APK workflow never references the upload-key secrets or pins', () => {
  // Case-insensitive on purpose: GitHub names are not case-sensitive in expressions.
  assert.equal(/ANDROID_UPLOAD_/i.test(code), false, 'no ANDROID_UPLOAD_* reference in the PR/push workflow');
  assert.equal(/ANDROID_UPLOAD_CERT_SHA256/i.test(code), false, 'no upload certificate variable in the PR/push workflow');
});

test('the test APK is pinned only by ANDROID_TEST_SIGNER_SHA256; the Production pin never reaches the PR/push workflow (STORE-01 PR-D)', () => {
  // Lead decision: ANDROID_APP_SIGNER_SHA256 belongs to the AAB/Production release; the test APK has its own variable.
  assert.equal(/ANDROID_APP_SIGNER_SHA256/i.test(code), false, 'no Production pin variable in the Mobile APK workflow');
  assert.equal(/ANDROID_APP_SIGNER_PIN/i.test(code), false, 'no Production pin env name in the Mobile APK workflow');
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
  const body = stripComments(text);
  if (PRODUCTION_NAME.test(body)) problems.push('a Production signer variable name appears');
  for (const m of body.matchAll(VARS_REFERENCE)) {
    if (!VARS_ALLOWED_ACCESS.test(body.slice(m.index + m[0].length))) {
      problems.push(`vars is used in a dynamic or whole-object form at offset ${m.index}`);
    }
  }
  const assigned = [...body.matchAll(TEST_PIN_ASSIGNMENT)].map(m => m[1].trim());
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

// STORE-01 PR-G: the PR/push workflow must not hand its secrets to another workflow, and an upload-key or Production name is refused
// in any letter case. Works on comment-free text (see stripComments), so a note that names a secret does not fail the guard.
function guardProblems(text) {
  const body = stripComments(text);
  const problems = [...pinProblems(text)];
  if (/ANDROID_UPLOAD_/i.test(body)) problems.push('an ANDROID_UPLOAD_* secret or variable name appears (any case)');
  if (/^\s*secrets\s*:/im.test(body)) problems.push('a `secrets:` key passes secrets to another workflow (`secrets: inherit` or an explicit map)');
  if (/uses\s*:\s*['"]?[^\s'"]*\.github\/workflows\//i.test(body)) problems.push('a reusable workflow under .github/workflows is called');
  return problems;
}

test('the Mobile APK workflow passes the secret-name and reusable-workflow guard (positive: the real workflow)', () => {
  assert.deepEqual(guardProblems(workflow), []);
});

test('names and calls that appear only in YAML or shell comments do not fail the guard (positive)', () => {
  const sample = [
    '# ANDROID_UPLOAD_KEYSTORE_BASE64, vars.ANDROID_APP_SIGNER_SHA256, secrets: inherit and uses: ./.github/workflows/x.yml are not used here',
    `          ANDROID_TEST_SIGNER_PIN: ${TEST_PIN_VALUE} # ANDROID_UPLOAD_KEY_ALIAS was removed; vars.ANDROID_APP_SIGNER_SHA256 is not read`,
    "          run: echo ok # vars['ANDROID_APP_SIGNER_SHA256'] and secrets: inherit are comments",
  ].join('\n');
  assert.deepEqual(guardProblems(sample), []);
});

test('the guard refuses each upload-key or Production name in any letter case, and each secret hand-off (negative cases)', () => {
  const cases = {
    'lower-case upload secret reference': '          K: ${{ secrets.android_upload_keystore_base64 }}',
    'mixed-case upload secret reference': '          K: ${{ secrets.Android_Upload_Key_Alias }}',
    'lower-case Production variable reference': '          K: ${{ vars.android_app_signer_sha256 }}',
    'job passes every secret with secrets: inherit': '  call:\n    uses: vn/x\n    secrets: inherit',
    'explicit secrets map on a job': '  call:\n    secrets:\n      K: ${{ secrets.N11_SOMETHING }}',
    'local reusable workflow call': '  call:\n    uses: ./.github/workflows/mobile-aab-release.yml',
    'reusable workflow call with a repo path and ref': '  call:\n    uses: owner/repo/.github/workflows/release.yml@main',
    'upload secret hidden after a # inside quotes (a real reference, not a comment)': '          run: echo " #" ${{ secrets.ANDROID_UPLOAD_KEY_ALIAS }}',
  };
  for (const [name, extra] of Object.entries(cases)) {
    const mutated = `${workflow}\n${extra}\n`;
    assert.notDeepEqual(guardProblems(mutated), [], `the guard must refuse: ${name}`);
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
