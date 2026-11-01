import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGate, hasCiSuccess, isProgressOnlyPath } from '../../scripts/deploy/ci-gate.mjs';

const sha = n => String(n).repeat(40);
const run = (head, over = {}) => ({ status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_sha: head, path: '.github/workflows/ci.yml', ...over });

function deps({ runs = {}, subjects = {}, parents = {}, files = [] } = {}) {
  return {
    listCiRuns: async s => runs[s] || [],
    subject: async s => subjects[s] || 'feat: code',
    parent: async s => parents[s] || null,
    changedFiles: async () => files,
  };
}

test('passes when the exact SHA has a successful CI push run', async () => {
  const r = await evaluateGate(sha('a'), deps({ runs: { [sha('a')]: [run(sha('a'))] } }));
  assert.deepEqual([r.ok, r.via], [true, 'direct']);
});

test('fails when there is no CI run, or only failed / cancelled / in-progress / foreign runs', async () => {
  for (const runs of [[], [run(sha('a'), { conclusion: 'failure' })], [run(sha('a'), { conclusion: 'cancelled' })],
    [run(sha('a'), { status: 'in_progress', conclusion: null })], [run(sha('a'), { event: 'pull_request' })],
    [run(sha('a'), { head_branch: 'other' })], [run(sha('a'), { path: '.github/workflows/deploy-vps.yml' })], [run(sha('b'))]]) {
    const r = await evaluateGate(sha('a'), deps({ runs: { [sha('a')]: runs } }));
    assert.equal(r.ok, false, JSON.stringify(runs));
    assert.match(r.reason, /No successful CI run/);
  }
});

test('fails closed on a malformed SHA', async () => {
  for (const bad of ['', undefined, 'abc', 'main', sha('a') + '0']) assert.equal((await evaluateGate(bad, deps())).ok, false);
});

test('a CI-green parent does not make a later non-bot code commit deployable', async () => {
  const d = deps({ runs: { [sha('b')]: [run(sha('b'))] }, parents: { [sha('a')]: sha('b') } });
  assert.equal((await evaluateGate(sha('a'), d)).ok, false);
});

test('progress-bot commit is accepted when only PROGRESS files changed since the CI-green ancestor', async () => {
  const bot = 'chore(progress): update docs/PROGRESS.md [skip ci]';
  const d = deps({
    runs: { [sha('c')]: [run(sha('c'))] },
    subjects: { [sha('a')]: bot, [sha('b')]: bot },
    parents: { [sha('a')]: sha('b'), [sha('b')]: sha('c') },
    files: ['docs/PROGRESS.md', 'docs/progress/2026-11.md'],
  });
  const r = await evaluateGate(sha('a'), d);
  assert.deepEqual([r.ok, r.ciSha, r.via], [true, sha('c'), 'progress-bot']);
});

test('progress-bot commit is refused when the diff touches any other file', async () => {
  const d = deps({
    runs: { [sha('c')]: [run(sha('c'))] },
    subjects: { [sha('a')]: 'chore(progress): x [skip ci]' },
    parents: { [sha('a')]: sha('c') },
    files: ['docs/PROGRESS.md', '.github/workflows/deploy-vps.yml'],
  });
  const r = await evaluateGate(sha('a'), d);
  assert.equal(r.ok, false);
  assert.match(r.reason, /deploy-vps\.yml/);
});

test('progress-bot commit is refused when the code ancestor has no green CI', async () => {
  const d = deps({ subjects: { [sha('a')]: 'chore(progress): x' }, parents: { [sha('a')]: sha('c') } });
  assert.match((await evaluateGate(sha('a'), d)).reason, /no successful CI/);
});

test('progress-bot chain with no code ancestor in range fails', async () => {
  const d = { ...deps(), subject: async () => 'chore(progress): x', parent: async () => sha('d') };
  assert.match((await evaluateGate(sha('a'), d)).reason, /no CI-checked code ancestor/);
});

test('progress path matcher is exact', () => {
  assert.equal(isProgressOnlyPath('docs/PROGRESS.md'), true);
  assert.equal(isProgressOnlyPath('docs/progress/a.json'), true);
  for (const p of ['docs/PROGRESS.md.bak', 'docs/progress', 'docs/other/PROGRESS.md', 'scripts/docs/progress/x', 'docs/progress/']) assert.equal(isProgressOnlyPath(p), false, p);
  assert.equal(hasCiSuccess(null, sha('a')), false);
});
