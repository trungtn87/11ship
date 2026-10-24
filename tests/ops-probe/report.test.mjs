import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UsageError, buildRequest, run } from '../../scripts/ops-report.mjs';

const FIXED = () => new Date('2026-10-18T10:00:00.000Z');

describe('ops-report (backup and deploy reporter)', () => {
  it('builds exactly the documented bodies', () => {
    assert.deepEqual(buildRequest(['backup', '--ok', '--size-bytes', '1234'], FIXED), { path: '/backup', body: { kind: 'BACKUP', ok: true, finished_at: '2026-10-18T10:00:00.000Z', size_bytes: 1234 } });
    assert.deepEqual(buildRequest(['restore-test', '--fail', '--code', 'PG_RESTORE_ERR'], FIXED).body, { kind: 'RESTORE_TEST', ok: false, finished_at: '2026-10-18T10:00:00.000Z', detail_code: 'PG_RESTORE_ERR' });
    assert.deepEqual(buildRequest(['deploy-start', '--component', 'BACKEND', '--to', '1.2.0', '--from', '1.1.0', '--db-migration'], FIXED).body, { action: 'start', component: 'BACKEND', to_version: '1.2.0', has_db_migration: true, from_version: '1.1.0' });
    assert.deepEqual(buildRequest(['deploy-finish', '--id', 'x', '--status', 'FAILED', '--health', 'FAILED', '--detail', 'ready 503']).body, { action: 'finish', deploy_id: 'x', status: 'FAILED', health_result: 'FAILED', health_detail: 'ready 503' });
  });

  it('refuses anything else (no free path, no command, no unknown component or status)', () => {
    for (const argv of [[], ['rm'], ['backup'], ['backup', '--ok', '--fail'], ['backup', '--ok', '--size-bytes', 'x'], ['backup', '--ok', '--code', 'lower'], ['deploy-start', '--component', 'NOPE', '--to', '1'], ['deploy-start', '--component', 'BACKEND'], ['deploy-finish', '--id', 'x', '--status', 'DONE'], ['backup', 'stray']]) {
      assert.throws(() => buildRequest(argv, FIXED), UsageError, JSON.stringify(argv));
    }
  });

  it('sends one authenticated POST, prints the deploy id, and says plainly when M13 cannot be reached or refuses', async () => {
    const seen = [];
    const out = [];
    const err = [];
    const env = { OPS_INGEST_BASE: 'https://x.example/v1/ops/ingest/', OPS_INGEST_TOKEN_FILE: '/secret' };
    const readFile = () => 'TOKEN-VALUE\n';
    const ok = async (url, init) => {
      seen.push({ url, init });
      return { status: 200, text: async () => JSON.stringify({ data: { deploy_id: 'abc' } }) };
    };
    assert.equal(await run(['deploy-start', '--component', 'M14', '--to', '2.0'], { env, fetchFn: ok, readFile, out: (l) => out.push(l), err: (l) => err.push(l), now: FIXED }), 0);
    assert.equal(seen[0].url, 'https://x.example/v1/ops/ingest/deploy');
    assert.equal(seen[0].init.headers.authorization, 'Bearer TOKEN-VALUE');
    assert.equal(seen[0].init.redirect, 'manual');
    assert.match(out[0], /deploy id abc/);
    assert.equal(await run(['backup', '--ok'], { env, fetchFn: async () => ({ status: 401, text: async () => '{}' }), readFile, out: () => undefined, err: (l) => err.push(l), now: FIXED }), 1);
    assert.equal(await run(['backup', '--ok'], { env, fetchFn: async () => { throw new Error('refused'); }, readFile, out: () => undefined, err: (l) => err.push(l), now: FIXED }), 1);
    assert.match(err.join('\n'), /refused \(HTTP 401\)/);
    assert.match(err.join('\n'), /unreachable/);
    assert.ok(!err.join('\n').includes('TOKEN-VALUE'));
    assert.equal(await run(['backup', '--ok'], { env: {}, readFile, out: () => undefined, err: () => undefined }), 2);
    assert.equal(await run(['backup', '--ok'], { env: { OPS_INGEST_BASE: 'http://evil.example/x', OPS_INGEST_TOKEN: 't' }, out: () => undefined, err: () => undefined }), 2);
  });
});
