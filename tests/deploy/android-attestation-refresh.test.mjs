import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { refresh, toSnapshot } from '../../scripts/android-attestation-refresh.mjs';

const require = createRequire(import.meta.url);
const answer = (status, body) => async () => ({ status, text: async () => body });
const GOOD = JSON.stringify({ entries: { '1a2b': { status: 'REVOKED', reason: 'KEY_COMPROMISE', comment: 'x' }, ff: { status: 'SUSPENDED' } } });

describe('android attestation refresh', () => {
  test('writes exactly {fetched_at, entries:{serial:{status}}} atomically with mode 0640, and the service parser accepts it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'att-'));
    const file = join(dir, 'rev.json');
    const count = await refresh(file, { fetchImpl: answer(200, GOOD), now: () => Date.parse('2026-10-14T10:00:00Z') });
    assert.equal(count, 2);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(written, { fetched_at: '2026-10-14T10:00:00.000Z', entries: { '1a2b': { status: 'REVOKED' }, ff: { status: 'SUSPENDED' } } });
    assert.equal(statSync(file).mode & 0o777, 0o640);
    const { parseRevocationSnapshot } = require('../../apps/backend/dist/config/client-device-config.js');
    assert.ok(parseRevocationSnapshot(written) !== undefined);
  });

  test('any failure leaves the previous file untouched (a stale list is refused by the server, never trusted)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'att-'));
    const file = join(dir, 'rev.json');
    writeFileSync(file, 'PREVIOUS');
    for (const impl of [answer(503, ''), answer(200, 'not json'), answer(200, '{"entries":[]}'), answer(200, '{"entries":{"XYZ":{"status":"REVOKED"}}}'), async () => { throw new Error('down'); }]) {
      await assert.rejects(refresh(file, { fetchImpl: impl }));
      assert.equal(readFileSync(file, 'utf8'), 'PREVIOUS');
    }
    assert.throws(() => toSnapshot('{}', 0));
  });
});
