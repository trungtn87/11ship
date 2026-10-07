import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../../scripts/progress/yaml-subset.mjs';
import { collectSnapshot, GitHubError } from '../../scripts/progress/github.mjs';
import { REQUIRED } from './helpers.mjs';

describe('yaml subset', () => {
  test('maps, lists, scalars and comments', () => {
    const doc = parseYaml(`
# comment
a: 1
b: "x # not a comment"   # real comment
c: 'it''s'
d: null
e: true
f: []
g: [x, "y, z", 3]
h:
  - one
  - two
i:
  - id: A
    deps:
      - B
    n: 2
  - id: C
    deps: []
j:
  k: v
`);
    assert.deepEqual(doc, {
      a: 1,
      b: 'x # not a comment',
      c: "it's",
      d: null,
      e: true,
      f: [],
      g: ['x', 'y, z', 3],
      h: ['one', 'two'],
      i: [{ id: 'A', deps: ['B'], n: 2 }, { id: 'C', deps: [] }],
      j: { k: 'v' },
    });
  });

  test('plain strings with commas and parentheses stay strings', () => {
    assert.deepEqual(parseYaml('x:\n  - Verify (Node 24, PostgreSQL 17)\n'), { x: ['Verify (Node 24, PostgreSQL 17)'] });
  });

  test('unsupported or malformed input fails loudly with a line number', () => {
    assert.throws(() => parseYaml('a:\n\tb: 1\n'), /line 2: tab/);
    assert.throws(() => parseYaml('a: 1\na: 2\n'), /line 2: duplicate key: a/);
    assert.throws(() => parseYaml('a: {b: 1}\n'), /flow maps/);
    assert.throws(() => parseYaml('a: &x 1\n'), /unsupported YAML syntax/);
    assert.throws(() => parseYaml('a: "oops\n'), /double-quoted/);
    assert.throws(() => parseYaml('a: 1\n   b: 2\n'), /unexpected indentation/);
    assert.throws(() => parseYaml('just text\n'), /key: value/);
  });
});

function fakeGitHub(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://api.github.com', '');
    calls.push({ path, auth: init.headers.Authorization });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    const body = typeof routes[key] === 'function' ? routes[key](path) : routes[key];
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

describe('collectSnapshot', () => {
  const pull = (number, extra = {}) => ({ number, title: `t${number}`, state: 'closed', draft: false, merged_at: null, head: { sha: `${number}`.repeat(40), ref: `b${number}` }, labels: [], ...extra });
  const run = (id, conclusion = 'success', name = REQUIRED) => ({ id, name, status: 'completed', conclusion });

  test('paginates and fetches checks only where needed; main CI is read from the real head', async () => {
    const many = Array.from({ length: 100 }, (_, i) => pull(i + 1));
    const second = [pull(101, { state: 'open', draft: true, labels: [{ name: 'module:M00-C1A1' }, { name: 'agent:claude' }] })];
    const { fetchImpl, calls } = fakeGitHub({
      '/repos/o/r/pulls?': (path) => (/[?&]page=1(&|$)/.test(path) ? many : second),
      '/repos/o/r/commits?': [{ sha: 'realreal', parents: [] }],
      '/repos/o/r/commits/realreal/check-runs': { check_runs: [run(2, 'failure'), run(3)] },
      [`/repos/o/r/commits/${'7'.repeat(40)}/check-runs`]: { check_runs: [run(1)] },
      [`/repos/o/r/commits/${'1'.repeat(40)}/check-runs`]: { check_runs: [run(1)] },
      [`/repos/o/r/commits/${'101'.repeat(40)}/check-runs`]: { check_runs: [run(9, null)] },
    });
    const snap = await collectSnapshot({ repo: 'o/r', mainBranch: 'main', requiredChecks: [REQUIRED], pinnedNumbers: [7], token: 'tok', fetchImpl });

    assert.equal(snap.pulls.length, 101);
    assert.deepEqual(snap.pulls.map((p) => p.number).slice(0, 3), [1, 2, 3]);
    assert.equal(snap.main.head_sha, 'realreal');
    assert.equal(snap.main.ci_sha, 'realreal');
    assert.deepEqual(snap.main.skipped_progress_shas, []);
    assert.deepEqual(snap.main.checks.map((c) => c.id), [2, 3]);
    assert.equal(snap.pulls.find((p) => p.number === 7).checks.length, 1, 'pinned PR gets checks');
    assert.equal(snap.pulls.find((p) => p.number === 8).checks.length, 0, 'unrelated closed PR does not');
    assert.deepEqual(snap.pulls.find((p) => p.number === 101).labels, ['agent:claude', 'module:M00-C1A1']);
    assert.ok(calls.every((c) => c.auth === 'Bearer tok'));
    assert.ok(!JSON.stringify(snap).includes('tok"'), 'token never lands in the snapshot');
  });

  test('review-labelled open PRs get the review status of their current head (sha, context, state) and nothing else', async () => {
    const head = '5'.repeat(40);
    const labeled = pull(5, { state: 'open', labels: [{ name: 'review:pass' }] });
    const { fetchImpl, calls } = fakeGitHub({
      '/repos/o/r/pulls?': [labeled],
      [`/repos/o/r/commits/${head}/check-runs`]: { check_runs: [run(1)] },
      [`/repos/o/r/commits/${head}/status`]: {
        sha: head,
        statuses: [
          { id: 7, context: '11ship/chatgpt-review', state: 'success', description: 'ChatGPT review passed', target_url: 'https://x', creator: { login: 'github-actions[bot]' } },
          { id: 9, context: 'ci/other', state: 'failure', creator: { login: 'github-actions[bot]' } },
        ],
      },
      '/repos/o/r/commits?': [{ sha: 'm1', parents: [] }],
      '/repos/o/r/commits/m1/check-runs': { check_runs: [run(1)] },
    });
    const snap = await collectSnapshot({ repo: 'o/r', mainBranch: 'main', requiredChecks: [REQUIRED], token: 'tok', fetchImpl });
    const p = snap.pulls[0];
    assert.deepEqual(p.review_status, { sha: head, context: '11ship/chatgpt-review', state: 'success' });
    assert.equal(p.label_events, undefined, 'label timestamps are not collected');
    assert.equal(p.head_committed_at, undefined, 'the head commit date is not collected');
    assert.ok(!calls.some((c) => /\/events/.test(c.path)));
  });

  test('API errors carry status and path but never the token', async () => {
    const { fetchImpl } = fakeGitHub({});
    await assert.rejects(
      collectSnapshot({ repo: 'o/r', mainBranch: 'main', requiredChecks: [REQUIRED], token: 'sekrit-token', fetchImpl }),
      (e) => e instanceof GitHubError && e.status === 404 && /pulls/.test(e.message) && !e.message.includes('sekrit-token'),
    );
  });

  test('no token -> clear error before any request', async () => {
    await assert.rejects(collectSnapshot({ repo: 'o/r', mainBranch: 'main', requiredChecks: [REQUIRED], fetchImpl: async () => assert.fail('no request expected') }), /GITHUB_TOKEN/);
  });
});
