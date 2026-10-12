import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M00.04: connection state of the phone apps. Pure logic of client-shared (health.ts, errors.ts, connection.ts,
// environment.ts), run on the compiled output with a fake clock and a fake fetch. Real servers are used elsewhere:
// connection-browser.test.mjs (real browser) and tests/integration/client-health.int.spec.ts (real backend).

let out;
let lib;
let dist;
const load = (name) => import(pathToFileURL(join(lib, name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'client-health-'));
  const built = buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true });
  dist = built.dist;
  lib = join(built.dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

/** Manual clock: nothing fires until `advance`. */
class Clock {
  constructor() {
    this.t = 1_000_000;
    this.queue = [];
    this.seq = 0;
  }
  now() {
    return this.t;
  }
  set(callback, milliseconds) {
    const id = ++this.seq;
    this.queue.push({ id, at: this.t + milliseconds, callback, milliseconds });
    return id;
  }
  clear(id) {
    this.queue = this.queue.filter((entry) => entry.id !== id);
  }
  advance(milliseconds) {
    const end = this.t + milliseconds;
    for (;;) {
      const due = this.queue.filter((entry) => entry.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) {
        break;
      }
      this.queue = this.queue.filter((entry) => entry !== due);
      this.t = due.at;
      due.callback();
    }
    this.t = end;
  }
  pending() {
    return this.queue.map((entry) => entry.milliseconds);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LIVE_OK = () => json({ data: { status: 'ok' } });
const READY_OK = () => json({ data: { status: 'ready' } });

/** fetch fake: `handler(url, init, index)` returns a Response, a promise, or throws. Every call is recorded. */
function fakeFetch(handler) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    try {
      return Promise.resolve(handler(String(url), init, calls.length - 1));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  fn.calls = calls;
  return fn;
}

/** A pending request that rejects when it is aborted (what a real fetch does). */
const abortable = (init) =>
  new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });

const route = (table) => (url, init) => {
  const key = new URL(url, 'http://x').pathname;
  const entry = table[key];
  if (entry === undefined) {
    return new Response('not found', { status: 404 });
  }
  return typeof entry === 'function' ? entry(init) : entry;
};

async function monitorWith(handler, extra = {}) {
  const { HealthMonitor } = await load('health.js');
  const clock = new Clock();
  const fetchFn = fakeFetch(handler);
  const monitor = new HealthMonitor({ fetch: fetchFn, timers: clock, ...extra });
  return { monitor, clock, fetchFn };
}

describe('health: live and ready', () => {
  it('both answers right -> ready, with both probes ok and the time of the check', async () => {
    const { monitor, clock } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': READY_OK() }));
    const snapshot = await monitor.check();
    assert.equal(snapshot.phase, 'ready');
    assert.equal(snapshot.live.state, 'ok');
    assert.equal(snapshot.ready.state, 'ok');
    assert.equal(snapshot.live.httpStatus, 200);
    assert.equal(snapshot.lastCheckedAt, clock.now());
  });

  it('asks live first, then ready, on the paths of the contract', async () => {
    const { monitor, fetchFn } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': READY_OK() }), { baseUrl: 'https://localhost:8444' });
    await monitor.check();
    assert.deepEqual(
      fetchFn.calls.map((call) => call.url),
      ['https://localhost:8444/v1/health/live', 'https://localhost:8444/v1/health/ready'],
    );
  });

  it('ready 503 with live ok -> backend not ready (the process is alive, so it is not "offline")', async () => {
    const { monitor } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': json({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503) }));
    const snapshot = await monitor.check();
    assert.equal(snapshot.phase, 'backend_not_ready');
    assert.equal(snapshot.live.state, 'ok');
    assert.deepEqual({ state: snapshot.ready.state, reason: snapshot.ready.reason, httpStatus: snapshot.ready.httpStatus }, { state: 'failed', reason: 'NOT_READY', httpStatus: 503 });
  });

  it('503 on LIVE is not "not ready": the contract allows it only for ready -> unexpected status', async () => {
    const { monitor, fetchFn } = await monitorWith(route({ '/v1/health/live': json({}, 503) }));
    const snapshot = await monitor.check();
    assert.equal(snapshot.phase, 'bad_response');
    assert.equal(snapshot.live.reason, 'UNEXPECTED_STATUS');
    assert.equal(fetchFn.calls.length, 1, 'ready is not asked when live did not answer');
    assert.equal(snapshot.ready.state, 'skipped');
  });

  it('a 200 with the wrong body is never ok (live and ready)', async () => {
    const wrongLive = ['{}', '[]', 'null', '"ok"', '{"status":"ok"}', '{"data":null}', '{"data":[]}', '{"data":{"status":"ready"}}', '{"data":{"status":"OK"}}', '{"data":{}}', 'not json', '', '<html>ok</html>', '{"data":{"status":"ok"'];
    for (const body of wrongLive) {
      const { monitor } = await monitorWith(route({ '/v1/health/live': new Response(body, { status: 200 }) }));
      const snapshot = await monitor.check();
      assert.equal(snapshot.phase, 'bad_response', `live body ${JSON.stringify(body)}`);
      assert.equal(snapshot.live.reason, 'BAD_RESPONSE');
    }
    const wrongReady = ['{"data":{"status":"ok"}}', '{"data":{"status":"not_ready"}}', '{}', 'ready', ''];
    for (const body of wrongReady) {
      const { monitor } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': new Response(body, { status: 200 }) }));
      const snapshot = await monitor.check();
      assert.equal(snapshot.phase, 'bad_response', `ready body ${JSON.stringify(body)}`);
      assert.equal(snapshot.live.state, 'ok');
      assert.equal(snapshot.ready.reason, 'BAD_RESPONSE');
    }
  });

  it('other HTTP statuses are unexpected, never ok', async () => {
    for (const status of [201, 204, 301, 400, 401, 403, 404, 500, 502, 504]) {
      const { monitor } = await monitorWith(route({ '/v1/health/live': new Response(status === 204 ? null : '', { status }) }));
      const snapshot = await monitor.check();
      assert.equal(snapshot.phase, 'bad_response', String(status));
      assert.equal(snapshot.live.reason, 'UNEXPECTED_STATUS', String(status));
    }
    const { monitor } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': json({}, 500) }));
    const snapshot = await monitor.check();
    assert.equal(snapshot.phase, 'bad_response');
    assert.equal(snapshot.ready.reason, 'UNEXPECTED_STATUS');
    assert.equal(snapshot.ready.httpStatus, 500);
  });

  it('a body larger than a health answer can be is refused', async () => {
    const huge = JSON.stringify({ data: { status: 'ok', pad: 'x'.repeat(10_000) } });
    const { monitor } = await monitorWith(route({ '/v1/health/live': new Response(huge, { status: 200 }) }));
    const snapshot = await monitor.check();
    assert.equal(snapshot.live.reason, 'BAD_RESPONSE');
  });

  it('request: GET, no-store, no credentials, no referrer, no Authorization/Cookie, 5 s limit', async () => {
    const { monitor, fetchFn, clock } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': READY_OK() }));
    const pending = monitor.check();
    assert.deepEqual(clock.pending(), [5000], 'one 5 second timer for the request in flight');
    await pending;
    for (const { init } of fetchFn.calls) {
      assert.equal(init.method, 'GET');
      assert.equal(init.cache, 'no-store');
      assert.equal(init.credentials, 'omit');
      assert.equal(init.referrerPolicy, 'no-referrer');
      assert.equal(init.redirect, 'error');
      const names = Object.keys(init.headers).map((name) => name.toLowerCase());
      assert.deepEqual(names, ['accept']);
      assert.equal(init.body, undefined);
    }
    assert.deepEqual(clock.pending(), [], 'timers are cleared when a request ends');
  });
});

describe('health: offline, timeout and retry', () => {
  it('fetch rejects -> offline, and nothing the exception said reaches the snapshot', async () => {
    const secret = 'postgres://app:hunter2@db.internal:5432/ship11?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij';
    const { monitor, fetchFn } = await monitorWith(() => {
      throw new TypeError(`Failed to fetch ${secret}`);
    });
    const snapshot = await monitor.check();
    assert.equal(snapshot.phase, 'offline');
    assert.equal(snapshot.live.reason, 'OFFLINE');
    assert.equal(snapshot.ready.state, 'skipped');
    assert.equal(fetchFn.calls.length, 1);
    const text = JSON.stringify(snapshot);
    for (const leak of ['hunter2', 'postgres', 'token', 'eyJ', 'Failed to fetch', 'TypeError']) {
      assert.equal(text.includes(leak), false, leak);
    }
  });

  it('no answer within 5 seconds -> timeout, and the request is aborted', async () => {
    let signal;
    const { monitor, clock } = await monitorWith((url, init) => {
      signal = init.signal;
      return abortable(init);
    });
    const pending = monitor.check();
    await flush();
    clock.advance(4999);
    await flush();
    assert.equal(monitor.snapshot().phase, 'checking', 'still waiting at 4.999 s');
    assert.equal(signal.aborted, false);
    clock.advance(1);
    const snapshot = await pending;
    assert.equal(snapshot.phase, 'timeout');
    assert.equal(snapshot.live.reason, 'TIMEOUT');
    assert.equal(snapshot.live.elapsedMs, 5000);
    assert.equal(signal.aborted, true);
  });

  it('timeout also holds when the transport ignores the abort signal (never settles)', async () => {
    const { monitor, clock } = await monitorWith(() => new Promise(() => undefined));
    const pending = monitor.check();
    await flush();
    clock.advance(5000);
    assert.equal((await pending).phase, 'timeout');
  });

  it('timeout while reading the body, and timeout of ready after a good live', async () => {
    const stalledBody = new Response(new ReadableStream({ start() {} }), { status: 200 });
    const first = await monitorWith(() => stalledBody);
    const pending = first.monitor.check();
    await flush();
    first.clock.advance(5000);
    assert.equal((await pending).phase, 'timeout');

    const second = await monitorWith((url, init) => (url.endsWith('/live') ? LIVE_OK() : abortable(init)));
    const pendingReady = second.monitor.check();
    await flush();
    second.clock.advance(5000);
    const snapshot = await pendingReady;
    assert.equal(snapshot.phase, 'timeout');
    assert.equal(snapshot.live.state, 'ok');
    assert.equal(snapshot.ready.reason, 'TIMEOUT');
  });

  it('retry: offline -> checking at once (the old state is gone) -> ready; last check time is kept while checking', async () => {
    let up = false;
    const { monitor, clock } = await monitorWith((url) => {
      if (!up) {
        throw new TypeError('Failed to fetch');
      }
      return url.endsWith('/live') ? LIVE_OK() : READY_OK();
    });
    const seen = [];
    monitor.subscribe((state) => seen.push(`${state.phase}:${state.lastCheckedAt ?? '-'}`));
    const first = await monitor.check();
    assert.equal(first.phase, 'offline');
    const failedAt = first.lastCheckedAt;
    clock.advance(1234);
    up = true;
    const retry = monitor.check();
    assert.equal(monitor.snapshot().phase, 'checking', 'the previous result is replaced immediately');
    assert.equal(monitor.snapshot().lastCheckedAt, failedAt, 'the last check time stays visible while checking');
    assert.equal(monitor.snapshot().live.state, 'pending');
    const second = await retry;
    assert.equal(second.phase, 'ready');
    assert.equal(second.lastCheckedAt, failedAt + 1234);
    assert.deepEqual(seen[0], `checking:-`);
    assert.ok(seen.includes(`offline:${failedAt}`));
    assert.equal(seen.at(-1), `ready:${failedAt + 1234}`);
  });

  it('subscribe is silent until something changes; unsubscribe stops it', async () => {
    const { monitor } = await monitorWith(route({ '/v1/health/live': LIVE_OK(), '/v1/health/ready': READY_OK() }));
    let count = 0;
    const off = monitor.subscribe(() => {
      count += 1;
    });
    assert.equal(count, 0);
    await monitor.check();
    assert.ok(count > 0);
    const before = count;
    off();
    await monitor.check();
    assert.equal(count, before);
  });
});

describe('health: generation guard (a stale answer never overwrites a newer state)', () => {
  it('an old slow answer that arrives after a newer check finished is dropped', async () => {
    const pending = [];
    const { monitor } = await monitorWith((url) => {
      if (pending.length === 0) {
        return new Promise((resolve) => pending.push(resolve)); // check A: parked, ignores abort
      }
      return url.endsWith('/live') ? LIVE_OK() : READY_OK();
    });
    const a = monitor.check();
    await flush();
    const b = monitor.check();
    const second = await b;
    assert.equal(second.phase, 'ready');
    const generation = second.generation;
    pending[0](json({ data: { status: 'nonsense' } })); // A answers late, with a bad body
    const late = await a;
    assert.equal(late.phase, 'ready', 'the late answer of A is ignored');
    assert.equal(monitor.snapshot().generation, generation);
    assert.equal(monitor.snapshot().live.state, 'ok');
  });

  it('an old /ready answer that arrives late (after live was ok) is dropped too', async () => {
    const parked = [];
    const { monitor } = await monitorWith((url, init, index) => {
      if (index === 1) {
        return new Promise((resolve) => parked.push(resolve)); // check A: live (call 0) ok, ready (call 1) parked
      }
      return url.endsWith('/live') ? LIVE_OK() : READY_OK();
    });
    const a = monitor.check();
    await flush();
    assert.equal(monitor.snapshot().live.state, 'ok');
    const second = await monitor.check();
    assert.equal(second.phase, 'ready');
    parked[0](json({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503)); // A's ready answers 503 after B finished
    await a;
    assert.equal(monitor.snapshot().phase, 'ready', 'the old 503 does not replace the newer "ready"');
    assert.equal(monitor.snapshot().ready.state, 'ok');
    assert.equal(monitor.snapshot().generation, second.generation);
  });

  it('an old good answer cannot hide a newer failure', async () => {
    const parked = [];
    let calls = 0;
    const { monitor } = await monitorWith((url) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => parked.push(resolve));
      }
      throw new TypeError('Failed to fetch');
    });
    const a = monitor.check();
    await flush();
    const b = await monitor.check();
    assert.equal(b.phase, 'offline');
    parked[0](LIVE_OK());
    await a;
    assert.equal(monitor.snapshot().phase, 'offline', 'a stale "ok" does not bring back a connected state');
  });

  it('markOffline shows offline at once, cancels the check in flight and its answer is dropped', async () => {
    let signal;
    const parked = [];
    const { monitor } = await monitorWith((url, init) => {
      signal = init.signal;
      return new Promise((resolve) => parked.push(resolve));
    });
    const a = monitor.check();
    await flush();
    monitor.markOffline();
    assert.equal(monitor.snapshot().phase, 'offline');
    assert.equal(signal.aborted, true);
    parked[0](LIVE_OK());
    await a;
    assert.equal(monitor.snapshot().phase, 'offline');
    assert.equal(monitor.snapshot().live.reason, 'OFFLINE');
  });

  it('stop cancels a check in flight and applies nothing', async () => {
    const parked = [];
    const { monitor } = await monitorWith(() => new Promise((resolve) => parked.push(resolve)));
    const seen = [];
    const a = monitor.check();
    await flush();
    monitor.subscribe((state) => seen.push(state.phase));
    monitor.stop();
    parked[0](LIVE_OK());
    await a;
    assert.deepEqual(seen, []);
    assert.equal(monitor.snapshot().phase, 'checking');
  });
});

describe('health: polling', () => {
  it('start checks now, then again after the interval, only while shouldPoll allows', async () => {
    let allow = true;
    const { monitor, clock, fetchFn } = await monitorWith(route({ '/v1/health/live': () => LIVE_OK(), '/v1/health/ready': () => READY_OK() }), { intervalMs: 30_000, shouldPoll: () => allow });
    monitor.start();
    await flush();
    assert.equal(fetchFn.calls.length, 2);
    assert.deepEqual(clock.pending(), [30_000]);
    clock.advance(29_999);
    await flush();
    assert.equal(fetchFn.calls.length, 2);
    clock.advance(1);
    await flush();
    assert.equal(fetchFn.calls.length, 4, 'second check after the interval');
    allow = false;
    clock.advance(30_000);
    await flush();
    assert.equal(fetchFn.calls.length, 4, 'a hidden page is not polled');
    assert.deepEqual(clock.pending(), [30_000], 'but the poll stays scheduled');
    allow = true;
    clock.advance(30_000);
    await flush();
    assert.equal(fetchFn.calls.length, 6);
    monitor.stop();
    assert.deepEqual(clock.pending(), []);
  });

  it('without an interval nothing repeats by itself', async () => {
    const { monitor, clock, fetchFn } = await monitorWith(route({ '/v1/health/live': () => LIVE_OK(), '/v1/health/ready': () => READY_OK() }));
    monitor.start();
    await flush();
    assert.deepEqual(clock.pending(), []);
    assert.equal(fetchFn.calls.length, 2);
  });
});

describe('derivePhase', () => {
  it('maps every pair of probe results to one phase', async () => {
    const { derivePhase } = await load('health.js');
    const ok = { state: 'ok', httpStatus: 200, elapsedMs: 1 };
    const failed = (reason) => ({ state: 'failed', reason, elapsedMs: 1 });
    const pending = { state: 'pending' };
    const skipped = { state: 'skipped' };
    assert.equal(derivePhase(pending, pending), 'checking');
    assert.equal(derivePhase(ok, pending), 'checking');
    assert.equal(derivePhase(ok, ok), 'ready');
    assert.equal(derivePhase(ok, failed('NOT_READY')), 'backend_not_ready');
    assert.equal(derivePhase(ok, failed('OFFLINE')), 'offline');
    assert.equal(derivePhase(ok, failed('TIMEOUT')), 'timeout');
    assert.equal(derivePhase(ok, failed('BAD_RESPONSE')), 'bad_response');
    assert.equal(derivePhase(ok, failed('UNEXPECTED_STATUS')), 'bad_response');
    assert.equal(derivePhase(failed('OFFLINE'), skipped), 'offline');
    assert.equal(derivePhase(failed('TIMEOUT'), skipped), 'timeout');
    assert.equal(derivePhase(failed('BAD_RESPONSE'), skipped), 'bad_response');
    assert.equal(derivePhase(failed('NOT_READY'), skipped), 'bad_response', 'NOT_READY only means something after a good live');
  });
});

describe('errors: copy and sanitization', () => {
  it('every phase has Vietnamese title and text, and a reason label; none carries technical words', async () => {
    const { HEALTH_COPY, HEALTH_REASON_LABEL } = await load('errors.js');
    assert.deepEqual(Object.keys(HEALTH_COPY).sort(), ['backend_not_ready', 'bad_response', 'checking', 'offline', 'ready', 'timeout']);
    for (const copy of [...Object.values(HEALTH_COPY), ...Object.values(HEALTH_REASON_LABEL).map((title) => ({ title, text: '' }))]) {
      assert.ok(copy.title.length > 0);
      assert.match(`${copy.title} ${copy.text}`, /[ăâêôơưđáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]|Máy|Không|Vui|Đang|Quá|Nội|Mã|Chưa/u, 'Vietnamese words');
      assert.doesNotMatch(`${copy.title} ${copy.text}`, /exception|stack|error|undefined|null|postgres|token|password|secret|https?:|ECONN|ENOTFOUND|\bat \w/i);
    }
  });

  it('removes credentials, tokens, connection strings, stack lines and control characters', async () => {
    const { sanitizeDiagnosticText } = await load('errors.js');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const cases = [
      ['postgres://app:hunter2@db.internal:5432/ship11', ['hunter2']],
      ['https://user:s3cret@host/path', ['s3cret']],
      ['Authorization: Bearer abcdef0123456789abcdef', ['abcdef0123456789abcdef']],
      ['Bearer abcdef0123456789', ['abcdef0123456789']],
      [`token=${jwt}`, [jwt, 'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk']],
      [`the jwt is ${jwt} ok`, [jwt]],
      ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end', ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'c2lnbmF0dXJl']],
      ['password=hunter2&user=a', ['hunter2']],
      ['{"password":"hunter2","x":1}', ['hunter2']],
      ['Cookie: session=abc123def456; other=1', ['abc123def456']],
      ['Set-Cookie: __Host-sid=abc123def456', ['abc123def456']],
      ['api_key: sk_live_1234567890', ['sk_live_1234567890']],
      ['DATABASE_URL=postgres://u:p@h/db', ['postgres://u:p@h']],
      ['otp=123456', ['123456']],
      ['deadbeef'.repeat(8), ['deadbeefdeadbeef']],
      ['x'.repeat(40), ['xxxxxxxxxxxxxxxxxxxx']],
    ];
    for (const [input, forbidden] of cases) {
      const cleaned = sanitizeDiagnosticText(input, 500);
      for (const word of forbidden) {
        assert.equal(cleaned.includes(word), false, `${JSON.stringify(input)} -> ${JSON.stringify(cleaned)} still has ${word}`);
      }
      assert.ok(cleaned.includes('[đã ẩn]'), `${JSON.stringify(input)} was not marked as hidden: ${cleaned}`);
    }
    const stack = 'Error: boom\n    at Object.<anonymous> (/srv/app/dist/main.js:10:5)\n    at Module._compile (node:internal/modules/cjs/loader:1:1)';
    assert.equal(sanitizeDiagnosticText(stack), 'Error: boom');
    assert.equal(sanitizeDiagnosticText('a\u0000b\u001fc\u007fd e'), 'a b c d e');
  });

  it('keeps ordinary text, caps the length, and never throws on non-strings', async () => {
    const { sanitizeDiagnosticText } = await load('errors.js');
    assert.equal(sanitizeDiagnosticText('https://localhost:8444'), 'https://localhost:8444');
    assert.equal(sanitizeDiagnosticText('Địa chỉ: Quận 1'), 'Địa chỉ: Quận 1');
    const long = sanitizeDiagnosticText('abc '.repeat(200), 50);
    assert.equal(long.length, 50);
    assert.ok(long.endsWith('…'));
    for (const value of [undefined, null, 5, {}, [], Symbol('x')]) {
      assert.equal(sanitizeDiagnosticText(value), '');
    }
  });
});

describe('connection: diagnostics report', () => {
  const build = { kind: 'ok', info: { appId: 'food-web', mode: 'live', sourceSha: 'a'.repeat(40), fingerprint: '0123456789abcdef'.repeat(4) } };
  const state = async (phase, extra = {}) => {
    const { initialSnapshot } = await load('health.js');
    return { health: { ...initialSnapshot(), ...extra, phase }, build, origin: 'https://localhost:8444' };
  };

  it('lists app, build, status, both probes and the time; keeps the public fingerprint whole', async () => {
    const { diagnosticsReport } = await load('connection.js');
    const report = diagnosticsReport(
      '11Food',
      await state('backend_not_ready', {
        generation: 2,
        live: { state: 'ok', httpStatus: 200, elapsedMs: 11 },
        ready: { state: 'failed', reason: 'NOT_READY', httpStatus: 503, elapsedMs: 40 },
        lastCheckedAt: Date.UTC(2026, 9, 12, 1, 2, 3),
      }),
    );
    for (const expected of ['Chẩn đoán 11Food', 'https://localhost:8444', 'Bản dựng: live', `Mã nguồn: ${'a'.repeat(40)}`, `Dấu vân tay bản dựng: ${'0123456789abcdef'.repeat(4)}`, 'Máy chủ chưa sẵn sàng', 'Còn sống (live): đạt (HTTP 200, 11 ms)', 'Sẵn sàng (ready): không đạt — Chưa sẵn sàng (503) (HTTP 503), 40 ms', 'Lần kiểm tra gần nhất: ']) {
      assert.ok(report.includes(expected), `missing: ${expected}\n${report}`);
    }
    assert.equal(report.includes('Lần kiểm tra gần nhất: chưa có'), false);
  });

  it('says so when the build or the check is unknown, and never prints a secret from the address', async () => {
    const { diagnosticsReport } = await load('connection.js');
    const unknown = diagnosticsReport('11Ship', { ...(await state('checking')), build: { kind: 'unavailable' }, origin: 'https://admin:hunter2@localhost:8445/?token=abcdefabcdefabcdefabcdefabcdefabcdef' });
    assert.ok(unknown.includes('Bản dựng: chưa đọc được'));
    assert.ok(unknown.includes('Lần kiểm tra gần nhất: chưa có'));
    assert.equal(unknown.includes('hunter2'), false);
    assert.equal(unknown.includes('abcdefabcdefabcdef'), false);
    const loading = diagnosticsReport('11Ship', { ...(await state('checking')), build: { kind: 'loading' } });
    assert.ok(loading.includes('Bản dựng: đang đọc'));
  });
});

describe('environment: build info', () => {
  const GOOD = { app_id: 'food-web', mode: 'live', source_sha: 'b'.repeat(40), fingerprint: 'c'.repeat(64), files: 12 };

  it('accepts the manifest the build writes and nothing else', async () => {
    const { parseBuildManifest } = await load('environment.js');
    assert.deepEqual(parseBuildManifest(GOOD), { appId: 'food-web', mode: 'live', sourceSha: 'b'.repeat(40), fingerprint: 'c'.repeat(64) });
    assert.equal(parseBuildManifest({ ...GOOD, source_sha: 'unknown' })?.sourceSha, 'unknown');
    assert.equal(parseBuildManifest({ ...GOOD, mode: 'design' })?.mode, 'design');
    for (const bad of [null, [], 'x', 5, {}, { ...GOOD, app_id: 'Food Web' }, { ...GOOD, app_id: '' }, { ...GOOD, mode: 'dev' }, { ...GOOD, source_sha: 'abc' }, { ...GOOD, source_sha: 'B'.repeat(40) }, { ...GOOD, fingerprint: 'c'.repeat(63) }, { ...GOOD, fingerprint: 5 }, { ...GOOD, source_sha: undefined }]) {
      assert.equal(parseBuildManifest(bad), undefined, JSON.stringify(bad));
    }
  });

  it('the build really writes a manifest this parser accepts', async () => {
    const { parseBuildManifest } = await load('environment.js');
    const { readFileSync } = await import('node:fs');
    const manifest = JSON.parse(readFileSync(join(dist, 'build-manifest.json'), 'utf8'));
    const info = parseBuildManifest(manifest);
    assert.ok(info !== undefined, JSON.stringify(manifest));
    assert.equal(info.appId, 'ui-foundation');
    assert.equal(info.mode, 'design');
  });

  it('loadBuildInfo: ok, wrong status, wrong body, no network and timeout -> ok or unavailable, same request rules', async () => {
    const { loadBuildInfo } = await load('environment.js');
    const clock = new Clock();
    const good = fakeFetch(() => json(GOOD));
    assert.equal((await loadBuildInfo({ fetch: good, timers: clock })).kind, 'ok');
    assert.equal(good.calls[0].url, '/build-manifest.json');
    assert.equal(good.calls[0].init.cache, 'no-store');
    assert.equal(good.calls[0].init.credentials, 'omit');
    for (const handler of [() => json(GOOD, 404), () => new Response('nope', { status: 200 }), () => json({ ...GOOD, mode: 'x' }), () => new Response('x'.repeat(9000), { status: 200 }), () => {
      throw new TypeError('Failed to fetch');
    }]) {
      assert.equal((await loadBuildInfo({ fetch: fakeFetch(handler), timers: clock })).kind, 'unavailable');
    }
    const stalled = loadBuildInfo({ fetch: fakeFetch((url, init) => abortable(init)), timers: clock });
    await flush();
    clock.advance(5000);
    assert.equal((await stalled).kind, 'unavailable');
  });
});

describe('connection view', () => {
  it('live view follows the monitor, carries the build once loaded, and recheck starts a new check', async () => {
    const { liveConnection } = await load('connection.js');
    const { monitor, fetchFn } = await monitorWith(route({ '/v1/health/live': () => LIVE_OK(), '/v1/health/ready': () => READY_OK() }));
    const view = liveConnection(monitor, 'https://localhost:8444');
    const seen = [];
    view.subscribe((state) => seen.push(state.health.phase));
    assert.equal(view.state().build.kind, 'loading');
    assert.equal(view.state().origin, 'https://localhost:8444');
    view.recheck();
    await flush();
    await flush();
    assert.equal(view.state().health.phase, 'ready');
    assert.equal(fetchFn.calls.length, 2);
    view.setBuild({ kind: 'unavailable' });
    assert.equal(view.state().build.kind, 'unavailable');
    assert.ok(seen.includes('checking') && seen.includes('ready'));
  });

  it('static view is a fixed example: no notifications and recheck does nothing', async () => {
    const { staticConnection } = await load('connection.js');
    const { initialSnapshot } = await load('health.js');
    const fixed = { health: initialSnapshot(), build: { kind: 'loading' }, origin: 'x' };
    const view = staticConnection(fixed);
    let called = 0;
    view.subscribe(() => (called += 1))();
    view.recheck();
    assert.equal(view.state(), fixed);
    assert.equal(called, 0);
  });
});
