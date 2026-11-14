// Regression guard for the Play bundle (AAB) signing path (Codex review, PR #345, HIGH).
// Behaviour: mobile/tool/sign-aab.sh runs on real bundles built here and signed with throw-away test keys
// (keytool/jarsigner from the JDK; no secret, no network). The workflow guard lives in mobile-apk-aab-guard.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const signer = 'mobile/tool/sign-aab.sh';
const PASS = 'upldpass1';

function makeDir() { return mkdtempSync(join(tmpdir(), 'aab-sign-')); }

function keystore(dir, name, alias) {
  const file = join(dir, name);
  execFileSync('keytool', ['-genkeypair', '-keystore', file, '-storepass', PASS, '-keypass', PASS, '-alias', alias,
    '-dname', `CN=${alias}`, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000'], { stdio: 'ignore' });
  return file;
}

function certFingerprint(keystore, alias) {
  const der = execFileSync('keytool', ['-exportcert', '-keystore', keystore, '-alias', alias, '-storepass', PASS], { stdio: ['ignore', 'pipe', 'ignore'] });
  return createHash('sha256').update(der).digest('hex');
}

// A bundle with a base module and a services file: the services file must survive the signature removal.
function unsignedBundle(dir) {
  const file = join(dir, 'unsigned.aab');
  const code = `import sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('base/manifest/AndroidManifest.xml','manifest')
    z.writestr('base/dex/classes.dex','dex')
    z.writestr('META-INF/services/vn.eleven.example.txt','svc')`;
  execFileSync('python3', ['-c', code, file]);
  return file;
}

function signerBlocks(aab) {
  return execFileSync('unzip', ['-Z1', aab], { encoding: 'utf8' }).split('\n').filter(n => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/.test(n)).length;
}

function signerFingerprints(aab) {
  const out = execFileSync('keytool', ['-printcert', '-jarfile', aab], { encoding: 'utf8' });
  return [...new Set(out.split('\n').filter(l => /SHA256:/.test(l)).map(l => l.replace(/.*SHA256: */, '').replace(/:/g, '').toLowerCase()))];
}

function runSigner(dir, env, { unsigned, out, apkFp }) {
  return spawnSync('bash', [signer, unsigned, out, apkFp], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

function fixtures() {
  const dir = makeDir();
  const up = keystore(dir, 'upload.jks', 'upload');
  const app = keystore(dir, 'app.jks', 'app');
  const debug = keystore(dir, 'debug.jks', 'androiddebugkey');
  const unsigned = unsignedBundle(dir);
  // The state Flutter produces: a release bundle carrying the debug key's signature.
  const debugSigned = join(dir, 'debug-signed.aab');
  writeFileSync(debugSigned, readFileSync(unsigned));
  execFileSync('jarsigner', ['-keystore', debug, '-storepass', PASS, '-keypass', PASS, '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', debugSigned, 'androiddebugkey'], { stdio: 'ignore' });
  const env = {
    ANDROID_UPLOAD_KEYSTORE_BASE64: readFileSync(up).toString('base64'),
    ANDROID_UPLOAD_KEYSTORE_PASSWORD: PASS,
    ANDROID_UPLOAD_KEY_ALIAS: 'upload',
    ANDROID_UPLOAD_KEY_PASSWORD: PASS,
  };
  return { dir, up, app, debugSigned, env };
}

const APK_FP = 'a'.repeat(64); // stands for the APK's app-signing certificate in these unit cases

test('the old path is broken: jarsigner on a debug-signed bundle leaves two signers', () => {
  const f = fixtures();
  try {
    const old = join(f.dir, 'old.aab');
    writeFileSync(old, readFileSync(f.debugSigned));
    execFileSync('jarsigner', ['-keystore', f.up, '-storepass', PASS, '-keypass', PASS, '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', old, 'upload'], { stdio: 'ignore' });
    assert.equal(signerBlocks(old), 2, 'the debug signature stays next to the upload signature');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('a debug-signed bundle comes out signed by the upload key only, with exactly one signer', () => {
  const f = fixtures();
  try {
    const out = join(f.dir, 'signed.aab');
    const r = runSigner(f.dir, f.env, { unsigned: f.debugSigned, out, apkFp: APK_FP });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(signerBlocks(out), 1);
    assert.deepEqual(signerFingerprints(out), [certFingerprint(f.up, 'upload')]);
    assert.ok(execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).includes('META-INF/services/vn.eleven.example.txt'), 'non-signature META-INF content is kept');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('refused when the upload certificate equals the APK app-signing certificate', () => {
  const f = fixtures();
  try {
    const up = certFingerprint(f.up, 'upload');
    const r = runSigner(f.dir, f.env, { unsigned: f.debugSigned, out: join(f.dir, 'x.aab'), apkFp: up });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /equals app-signing key/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('refused when the upload certificate equals the pinned app-signing certificate', () => {
  const f = fixtures();
  try {
    const up = certFingerprint(f.up, 'upload');
    const r = runSigner(f.dir, { ...f.env, ANDROID_APP_SIGNER_PIN: up }, { unsigned: f.debugSigned, out: join(f.dir, 'x.aab'), apkFp: APK_FP });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /equals app-signing key/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('refused when a pinned upload certificate does not match the signing key', () => {
  const f = fixtures();
  try {
    const r = runSigner(f.dir, { ...f.env, ANDROID_UPLOAD_CERT_PIN: 'b'.repeat(64) }, { unsigned: f.debugSigned, out: join(f.dir, 'x.aab'), apkFp: APK_FP });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /pinned upload certificate/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('refused without the upload key, naming the variable and never printing a value', () => {
  const f = fixtures();
  try {
    const env = { ...f.env, ANDROID_UPLOAD_KEYSTORE_BASE64: '' };
    const r = runSigner(f.dir, env, { unsigned: f.debugSigned, out: join(f.dir, 'x.aab'), apkFp: APK_FP });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ANDROID_UPLOAD_KEYSTORE_BASE64 is not set/);
    assert.ok(!r.stderr.includes(f.env.ANDROID_UPLOAD_KEYSTORE_PASSWORD));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
