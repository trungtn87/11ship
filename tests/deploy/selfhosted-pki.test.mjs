// make-pki.sh: the two certificate procedures behave as the runbook says (review F3). Real openssl, real TLS handshakes in
// Node with verification ON (rejectUnauthorized true, host name checked): nothing here disables a check.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tls from 'node:tls';

const script = fileURLToPath(new URL('../../ops/selfhosted/make-pki.sh', import.meta.url));
const read = (...parts) => readFileSync(join(...parts), 'utf8');
let work;

function run(...args) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8' });
}
function fingerprint(file) {
  return execFileSync('openssl', ['x509', '-in', file, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf8' }).trim();
}
/** One TLS connection to a throwaway server presenting `serverDir`'s certificate, verified against `trust`. */
function handshake({ serverDir, trust, servername = 'localhost' }) {
  return new Promise((resolve) => {
    const server = tls.createServer({ key: read(serverDir, 'server.key'), cert: read(serverDir, 'server.crt'), minVersion: 'TLSv1.3' }, (socket) => socket.end());
    server.listen(0, '127.0.0.1', () => {
      const socket = tls.connect({ host: '127.0.0.1', port: server.address().port, servername, ca: trust, rejectUnauthorized: true }, () => {
        const authorized = socket.authorized;
        socket.end();
        server.close(() => resolve({ ok: authorized }));
      });
      socket.on('error', (error) => {
        server.close(() => resolve({ ok: false, code: error.code }));
      });
    });
  });
}

before(() => {
  work = mkdtempSync(join(tmpdir(), 'ship11-pki-test-'));
});
after(() => rmSync(work, { recursive: true, force: true }));

describe('make-pki.sh: new CA', () => {
  test('creates ca and server files, works with the legacy single argument too, and never overwrites', () => {
    const first = run('new', join(work, 'a'));
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /NEW CA/);
    for (const file of ['ca.key', 'ca.crt', 'server.key', 'server.crt']) {
      assert.ok(existsSync(join(work, 'a', file)), file);
    }
    assert.equal(run(join(work, 'legacy')).status, 0);
    const again = run('new', join(work, 'a'));
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
    assert.doesNotMatch(first.stdout + first.stderr, /PRIVATE KEY/);
  });

  test('a second new CA is a different CA: the first CA does not verify its leaf (the runbook must say so)', () => {
    assert.equal(run('new', join(work, 'c')).status, 0);
    assert.notEqual(fingerprint(join(work, 'a', 'ca.crt')), fingerprint(join(work, 'c', 'ca.crt')));
    const verify = spawnSync('openssl', ['verify', '-CAfile', join(work, 'a', 'ca.crt'), join(work, 'c', 'server.crt')], { encoding: 'utf8' });
    assert.notEqual(verify.status, 0);
  });
});

describe('make-pki.sh: renew-leaf keeps the CA', () => {
  test('issues a new key pair signed by the SAME ca.crt, without copying ca.key', () => {
    const renewed = run('renew-leaf', join(work, 'a'), join(work, 'b'));
    assert.equal(renewed.status, 0, renewed.stderr);
    assert.match(renewed.stdout, /SAME CA/);
    assert.equal(read(work, 'a', 'ca.crt'), read(work, 'b', 'ca.crt'));
    assert.ok(!existsSync(join(work, 'b', 'ca.key')), 'ca.key must not be copied');
    assert.notEqual(read(work, 'a', 'server.key'), read(work, 'b', 'server.key'));
    assert.notEqual(read(work, 'a', 'server.crt'), read(work, 'b', 'server.crt'));
    const verify = spawnSync('openssl', ['verify', '-CAfile', join(work, 'a', 'ca.crt'), '-verify_hostname', 'localhost', join(work, 'b', 'server.crt')], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stdout + verify.stderr);
    const ip = spawnSync('openssl', ['verify', '-CAfile', join(work, 'a', 'ca.crt'), '-verify_ip', '127.0.0.1', join(work, 'b', 'server.crt')], { encoding: 'utf8' });
    assert.notEqual(ip.status, 0, 'the leaf must not name an IP address');
  });

  test('refuses an existing target, a key of another CA, a loose key mode and a missing CA directory', () => {
    assert.equal(run('renew-leaf', join(work, 'a'), join(work, 'b')).status, 1);
    // ca.key of CA "c" with ca.crt of CA "a".
    const mixed = join(work, 'mixed');
    cpSync(join(work, 'a'), mixed, { recursive: true });
    cpSync(join(work, 'c', 'ca.key'), join(mixed, 'ca.key'));
    chmodSync(join(mixed, 'ca.key'), 0o600);
    const wrongKey = run('renew-leaf', mixed, join(work, 'out-mixed'));
    assert.equal(wrongKey.status, 1);
    assert.match(wrongKey.stderr, /does not belong/);
    const loose = join(work, 'loose');
    cpSync(join(work, 'a'), loose, { recursive: true });
    chmodSync(join(loose, 'ca.key'), 0o644);
    assert.match(run('renew-leaf', loose, join(work, 'out-loose')).stderr, /mode 600/);
    assert.equal(run('renew-leaf', join(work, 'missing'), join(work, 'out-missing')).status, 1);
    assert.ok(!existsSync(join(work, 'out-mixed')) && !existsSync(join(work, 'out-loose')) && !existsSync(join(work, 'out-missing')));
  });

  test('the renewed leaf is accepted by a client that trusts only the OLD ca.crt', async () => {
    const trust = read(work, 'a', 'ca.crt');
    assert.deepEqual(await handshake({ serverDir: join(work, 'a'), trust }), { ok: true });
    assert.deepEqual(await handshake({ serverDir: join(work, 'b'), trust }), { ok: true });
  });
});

describe('CA rotation: the client trust store decides', () => {
  test('a leaf of the NEW CA fails against the old trust store, and succeeds once the new CA is trusted', async () => {
    const oldTrust = read(work, 'a', 'ca.crt');
    const newTrust = read(work, 'c', 'ca.crt');
    const refused = await handshake({ serverDir: join(work, 'c'), trust: oldTrust });
    assert.equal(refused.ok, false);
    assert.match(refused.code, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
    // Step 1 of the runbook: trust BOTH. The old server certificate still verifies, and so does the new one.
    const both = `${oldTrust}${newTrust}`;
    assert.deepEqual(await handshake({ serverDir: join(work, 'a'), trust: both }), { ok: true });
    assert.deepEqual(await handshake({ serverDir: join(work, 'c'), trust: both }), { ok: true });
    // Step 3: only the new CA. The old server certificate is now refused (the old CA is retired).
    assert.deepEqual(await handshake({ serverDir: join(work, 'c'), trust: newTrust }), { ok: true });
    assert.equal((await handshake({ serverDir: join(work, 'a'), trust: newTrust })).ok, false);
  });

  test('host name verification stays on: the same certificate is refused for another name', async () => {
    const result = await handshake({ serverDir: join(work, 'b'), trust: read(work, 'a', 'ca.crt'), servername: 'db.example.test' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  });
});

describe('the runbook and the script say the same thing', () => {
  const runbook = readFileSync(new URL('../../ops/runbooks/selfhosted-postgres-staging.md', import.meta.url), 'utf8');
  test('both procedures are named and the false "same CA" claim for a re-run is gone', () => {
    assert.match(runbook, /renew-leaf/);
    assert.match(runbook, /make-pki\.sh new/);
    assert.doesNotMatch(runbook, /chạy lại script vào thư mục \*\*mới\*\*, thay hai file[^\n]*\n[^\n]*cùng CA nên không phải đổi/);
    assert.match(runbook, /xoay CA/i);
    assert.match(runbook, /tin cả hai CA|tin CẢ HAI/i);
  });
});
