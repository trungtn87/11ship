import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClientWeb } from '../../scripts/client-web-build.mjs';

// M01.06 — the logic of the shared auth components that needs no browser: the countdown (server deadline, resume, no drift)
// and the OTP extraction. How the components look and behave on a 360px screen is auth-components-browser.test.mjs.

let out;
let lib;
const load = (name) => import(pathToFileURL(join(lib, name)).href);

before(() => {
  out = mkdtempSync(join(tmpdir(), 'client-components-'));
  lib = join(buildClientWeb('ui-foundation', { design: true, outDir: out, quiet: true }).dist, 'js', 'client-shared', 'src');
});
after(() => rmSync(out, { recursive: true, force: true }));

function harness(startMs = 1_000_000) {
  const state = { now: startMs, steps: new Set(), resumes: new Set() };
  return {
    state,
    clock: { now: () => state.now },
    ticker: {
      setInterval(callback) {
        const handle = state.steps.size + 1;
        state.steps.add({ handle, callback });
        return handle;
      },
      clearInterval(handle) {
        for (const step of state.steps) if (step.handle === handle) state.steps.delete(step);
      },
    },
    resume: { subscribe: (callback) => (state.resumes.add(callback), () => state.resumes.delete(callback)) },
    step: () => [...state.steps].forEach((s) => s.callback()),
    comeBack: () => [...state.resumes].forEach((c) => c()),
  };
}

describe('countdown from a server deadline', () => {
  it('shows the time left on the deadline, immediately, and ends once', async () => {
    const { countdownUntil } = await load('components.js');
    const h = harness();
    const ticks = [];
    let done = 0;
    countdownUntil(h.state.now + 60_000, (r) => ticks.push(r), () => done++, h);
    assert.deepEqual(ticks, [60]);
    h.state.now += 1_000;
    h.step();
    assert.deepEqual(ticks, [60, 59]);
    h.step(); // same second: no repeated tick
    assert.deepEqual(ticks, [60, 59]);
    h.state.now += 59_000;
    h.step();
    h.step();
    assert.equal(ticks.at(-1), 0);
    assert.equal(done, 1);
    assert.equal(h.state.steps.size, 0, 'interval released');
    assert.equal(h.state.resumes.size, 0, 'resume listener released');
  });

  it('does not drift: a throttled tab that only ran two steps still shows the true time', async () => {
    const { countdownUntil } = await load('components.js');
    const h = harness();
    const ticks = [];
    countdownUntil(h.state.now + 120_000, (r) => ticks.push(r), () => undefined, h);
    h.state.now += 1_000;
    h.step();
    h.state.now += 89_000; // the tab slept: no steps for 89 s
    h.step();
    assert.equal(ticks.at(-1), 30, 'recomputed from the clock, not decremented per step');
  });

  it('coming back from the background recomputes at once, without waiting for the next step', async () => {
    const { countdownUntil } = await load('components.js');
    const h = harness();
    const ticks = [];
    let done = 0;
    countdownUntil(h.state.now + 60_000, (r) => ticks.push(r), () => done++, h);
    h.state.now += 45_000;
    h.comeBack();
    assert.equal(ticks.at(-1), 15);
    h.state.now += 20_000; // the phone slept past the deadline
    h.comeBack();
    assert.equal(ticks.at(-1), 0);
    assert.equal(done, 1);
    h.comeBack();
    assert.equal(done, 1, 'done is never repeated');
  });

  it('a deadline in the past is done immediately; stop() ends it silently; a clock set backwards never adds time', async () => {
    const { countdownUntil } = await load('components.js');
    let h = harness();
    let ticks = [];
    let done = 0;
    countdownUntil(h.state.now - 5_000, (r) => ticks.push(r), () => done++, h);
    assert.deepEqual([ticks, done], [[0], 1]);

    h = harness();
    ticks = [];
    done = 0;
    const handle = countdownUntil(h.state.now + 10_000, (r) => ticks.push(r), () => done++, h);
    handle.stop();
    h.state.now += 20_000;
    h.step();
    h.comeBack();
    assert.deepEqual([ticks, done], [[10], 0]);

    h = harness();
    ticks = [];
    countdownUntil(h.state.now + 10_000, (r) => ticks.push(r), () => undefined, h);
    h.state.now -= 3_600_000; // someone moved the clock back an hour
    h.step();
    assert.ok(Math.max(...ticks) <= 10, JSON.stringify(ticks));
  });

  it('the old seconds-based call still works and counts to the same deadline', async () => {
    const { countdown } = await load('components.js');
    const h = harness();
    const ticks = [];
    let done = 0;
    countdown(3, (r) => ticks.push(r), () => done++, h.ticker, { clock: h.clock, resume: h.resume });
    for (let i = 0; i < 3; i += 1) {
      h.state.now += 1_000;
      h.step();
    }
    assert.deepEqual([ticks, done], [[3, 2, 1, 0], 1]);
  });

  it('nothing in the countdown sends a request or starts another timer by itself', async () => {
    const { countdownUntil } = await load('components.js');
    const h = harness();
    let fetched = 0;
    globalThis.fetch = () => (fetched++, Promise.reject(new Error('no network expected')));
    countdownUntil(h.state.now + 1_000, () => undefined, () => undefined, h);
    h.state.now += 5_000;
    h.step();
    assert.equal(fetched, 0);
    assert.equal(h.state.steps.size, 0, 'no new interval after the deadline');
    delete globalThis.fetch;
  });
});

describe('OTP text', () => {
  it('a standalone six-digit code wins over digits elsewhere in a pasted message; leading zeros stay', async () => {
    const { extractOtp, sanitizeOtp } = await load('validation.js');
    assert.equal(extractOtp('11Ship: ma xac minh cua ban la 012345. Khong chia se.'), '012345');
    assert.equal(extractOtp('G-001234'), '001234');
    assert.equal(extractOtp('123 456'), '123456');
    assert.equal(extractOtp('12-34-56'), '123456');
    assert.equal(extractOtp('1234567'), '123456', 'seven digits in a row are not a six-digit code: the first six');
    assert.equal(extractOtp('12ab3'), '123');
    assert.equal(extractOtp('٠١٢٣٤٥'), '', 'only ASCII digits');
    assert.equal(extractOtp(''), '');
    assert.equal(sanitizeOtp(' 01a2-345678'), '012345', 'the existing rule is unchanged');
  });
});
