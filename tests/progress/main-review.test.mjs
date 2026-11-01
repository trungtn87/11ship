// Regression tests for the two PR #8 blockers:
//   MAIN-CI-01..04    main CI is judged on the real head; only a verified progress-bot commit is skipped.
//   reset-review      cleanup of review:* labels when the head changes (defense in depth only).
// The exact-SHA review binding itself (REVIEW-SHA-01..08) is tested in review-sha.test.mjs.
// Plus the manifest role validation and static checks of the workflow that enforces the binding.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectSnapshot, GitHubError } from '../../scripts/progress/github.mjs';
import { resetReviewLabels } from '../../scripts/progress/review.mjs';
import { resolveProgress, validatePlan, mainStatus, STATE, CI } from '../../scripts/progress/resolve.mjs';
import { buildMarkdown } from '../../scripts/generate-progress.mjs';
import { PROGRESS_BOT, PROGRESS_COMMIT_MESSAGE, REVIEW_LABELS } from '../../scripts/progress/constants.mjs';
import { plan, livePlan, REQUIRED, checks, history, merged, snapshot, LABELS_C1A1, stateOf, root } from './helpers.mjs';

// ---------------------------------------------------------------------------------------------
// A tiny fake of the GitHub REST API. The longest matching route wins; unknown paths are 404.

function fakeGitHub(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://api.github.com', '');
    const method = init.method ?? 'GET';
    calls.push({ method, path, auth: init.headers?.Authorization });
    const key = Object.keys(routes)
      .filter((k) => path.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    const route = routes[key];
    const body = typeof route === 'function' ? route(path, method) : route;
    if (body instanceof Error) return { ok: false, status: body.status, json: async () => ({ message: body.message }) };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchImpl, calls };
}

const run = (id, status, conclusion, name = REQUIRED) => ({ id, name, status, conclusion });
const green = [run(1, 'completed', 'success')];

const identity = (who) => ({ name: who.name, email: who.email, date: '2026-10-07T00:00:00Z' });
const BOT_META = { author: identity(PROGRESS_BOT), committer: identity(PROGRESS_BOT) };
const HUMAN = { name: 'Dev', email: 'dev@example.com' };

/** A list entry of GET /commits. */
const entry = (sha, parent, { message = 'feat: code', meta = { author: identity(HUMAN), committer: identity(HUMAN) }, login = 'dev' } = {}) => ({
  sha,
  parents: parent ? [{ sha: parent }] : [],
  commit: { message, ...meta },
  author: { login },
  committer: { login },
});

const progressEntry = (sha, parent, over = {}) => entry(sha, parent, { message: PROGRESS_COMMIT_MESSAGE, meta: BOT_META, login: PROGRESS_BOT.login, ...over });

/** Routes for one main branch: `commits` newest first, `runs` by sha, `files` by sha (detail endpoint). */
function mainRoutes({ commits, runs = {}, files = {} }) {
  const routes = {
    '/repos/o/r/pulls?': [],
    '/repos/o/r/commits?': commits,
  };
  for (const c of commits) {
    routes[`/repos/o/r/commits/${c.sha}/check-runs`] = { check_runs: runs[c.sha] ?? [] };
    routes[`/repos/o/r/commits/${c.sha}`] = { sha: c.sha, parents: c.parents, files: (files[c.sha] ?? ['src/app.ts']).map((filename) => ({ filename })) };
  }
  return routes;
}

async function mainFor(spec) {
  const { fetchImpl, calls } = fakeGitHub(mainRoutes(spec));
  const snap = await collectSnapshot({ repo: 'o/r', mainBranch: 'main', requiredChecks: [REQUIRED], token: 'tok', fetchImpl });
  const result = resolveProgress(plan, { ...snap, pulls: [] });
  return { snap, result, calls };
}

// ---------------------------------------------------------------------------------------------

describe('main CI is judged on the real head (blocker 1)', () => {
  test('MAIN-CI-01 a new code commit without a required check never inherits the green of the previous commit', async () => {
    const { snap, result, calls } = await mainFor({
      commits: [entry('head1', 'old1'), entry('old1', 'old0'), entry('old0', null)],
      runs: { old1: green, old0: green }, // older commits are green; head has no check at all yet
    });
    assert.equal(snap.main.head_sha, 'head1');
    assert.equal(snap.main.ci_sha, 'head1', 'CI is looked up on the head and nowhere else');
    assert.deepEqual(snap.main.skipped_progress_shas, []);
    assert.deepEqual(snap.main.checks, []);
    assert.equal(result.main.ci, CI.NONE);
    assert.notEqual(result.main.ci, CI.PASS);
    assert.ok(!calls.some((c) => c.path.includes('/old1/check-runs') || c.path.includes('/old0/check-runs')), 'older commits are never consulted');
  });

  test('MAIN-CI-01b a head that only has other checks is RUNNING, not PASS', async () => {
    const { result } = await mainFor({
      commits: [entry('head1', 'old1'), entry('old1', null)],
      runs: { head1: [run(5, 'completed', 'success', 'Some other workflow')], old1: green },
    });
    assert.equal(result.main.ci, CI.RUNNING);
  });

  test('MAIN-CI-02 a trusted progress-bot head is skipped; CI comes from its parent and both SHAs are kept apart', async () => {
    const { snap, result } = await mainFor({
      commits: [progressEntry('bot1', 'code1'), entry('code1', 'code0'), entry('code0', null)],
      runs: { code1: green },
      files: { bot1: ['docs/PROGRESS.md'] },
    });
    assert.equal(snap.main.head_sha, 'bot1');
    assert.equal(snap.main.ci_sha, 'code1');
    assert.deepEqual(snap.main.skipped_progress_shas, ['bot1']);
    assert.equal(result.main.head_sha, 'bot1', 'actual main head is the bot commit');
    assert.equal(result.main.ci_sha, 'code1', 'CI source is the parent');
    assert.equal(result.main.head_is_progress_commit, true);
    assert.equal(result.main.ci, CI.PASS);
  });

  test('MAIN-CI-02b several progress-bot commits in a row are all skipped, but only as an unbroken chain from the head', async () => {
    const { snap, result } = await mainFor({
      commits: [progressEntry('bot2', 'bot1'), progressEntry('bot1', 'code1'), entry('code1', null)],
      runs: { code1: green },
      files: { bot2: ['docs/PROGRESS.md'], bot1: ['docs/PROGRESS.md'] },
    });
    assert.deepEqual(snap.main.skipped_progress_shas, ['bot2', 'bot1']);
    assert.equal(result.main.ci_sha, 'code1');
    assert.equal(result.main.ci, CI.PASS);
  });

  test('MAIN-CI-02c a progress-bot head above a code commit whose CI is not done yet is RUNNING', async () => {
    const { result } = await mainFor({
      commits: [progressEntry('bot1', 'code1'), entry('code1', null)],
      runs: { code1: [run(2, 'in_progress', null)] },
      files: { bot1: ['docs/PROGRESS.md'] },
    });
    assert.equal(result.main.ci, CI.RUNNING);
  });

  // Anything that merely looks like a progress commit must be treated as a normal commit.
  const lookalikes = {
    'wrong message': () => progressEntry('x1', 'code1', { message: 'chore(progress): update docs/PROGRESS.md' }),
    'extra message body': () => progressEntry('x1', 'code1', { message: `${PROGRESS_COMMIT_MESSAGE}\n\nand also some code` }),
    'human author': () => progressEntry('x1', 'code1', { meta: { author: identity(HUMAN), committer: identity(PROGRESS_BOT) } }),
    'human committer': () => progressEntry('x1', 'code1', { meta: { author: identity(PROGRESS_BOT), committer: identity(HUMAN) } }),
    'bot name with another email': () => progressEntry('x1', 'code1', { meta: { author: identity({ ...PROGRESS_BOT, email: 'evil@example.com' }), committer: identity(PROGRESS_BOT) } }),
    'GitHub login of someone else': () => progressEntry('x1', 'code1', { login: 'mallory' }),
    'two parents': () => ({ ...progressEntry('x1', 'code1'), parents: [{ sha: 'code1' }, { sha: 'other' }] }),
    'no identity at all': () => ({ sha: 'x1', parents: [{ sha: 'code1' }], commit: { message: PROGRESS_COMMIT_MESSAGE } }),
  };
  for (const [name, make] of Object.entries(lookalikes)) {
    test(`MAIN-CI-02d lookalike (${name}) is not skipped: main CI is not PASS`, async () => {
      const { snap, result } = await mainFor({
        commits: [make(), entry('code1', null)],
        runs: { code1: green },
        files: { x1: ['docs/PROGRESS.md'] },
      });
      assert.equal(snap.main.ci_sha, 'x1');
      assert.deepEqual(snap.main.skipped_progress_shas, []);
      assert.notEqual(result.main.ci, CI.PASS);
    });
  }

  test('MAIN-CI-02e a bot-looking commit that touches more than docs/PROGRESS.md is not skipped', async () => {
    for (const files of [['docs/PROGRESS.md', 'src/app.ts'], ['src/app.ts'], []]) {
      const { snap, result } = await mainFor({
        commits: [progressEntry('bot1', 'code1'), entry('code1', null)],
        runs: { code1: green },
        files: { bot1: files },
      });
      assert.equal(snap.main.ci_sha, 'bot1', `files: ${files.join(', ') || '(none)'}`);
      assert.notEqual(result.main.ci, CI.PASS);
    }
  });

  test('MAIN-CI-02f a broken parent chain stops the walk instead of guessing', async () => {
    const { snap, result } = await mainFor({
      commits: [progressEntry('bot1', 'code1'), entry('unrelated', null), entry('code1', null)],
      runs: { code1: green, unrelated: green },
      files: { bot1: ['docs/PROGRESS.md'] },
    });
    assert.equal(snap.main.ci_sha, null);
    assert.equal(result.main.ci, CI.NONE);
  });

  test('MAIN-CI-02g only progress commits within the look-back window: no CI commit found means NONE', async () => {
    const bots = ['b3', 'b2', 'b1'];
    const commits = bots.map((sha, i) => progressEntry(sha, bots[i + 1] ?? 'code1'));
    const { result } = await mainFor({ commits, runs: { code1: green }, files: { b3: ['docs/PROGRESS.md'], b2: ['docs/PROGRESS.md'], b1: ['docs/PROGRESS.md'] } });
    assert.equal(result.main.ci, CI.NONE);
  });

  test('MAIN-CI-03 a normal head whose required check failed is FAIL', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      const { result } = await mainFor({
        commits: [entry('head1', 'old1'), entry('old1', null)],
        runs: { head1: [run(7, 'completed', conclusion)], old1: green },
      });
      assert.equal(result.main.ci, CI.FAIL, conclusion);
    }
  });

  test('MAIN-CI-04 a normal head whose required check is queued or in progress is RUNNING', async () => {
    for (const status of ['queued', 'in_progress', 'waiting', 'pending']) {
      const { result } = await mainFor({
        commits: [entry('head1', 'old1'), entry('old1', null)],
        runs: { head1: [run(8, status, null)], old1: green },
      });
      assert.equal(result.main.ci, CI.RUNNING, status);
    }
  });

  test('the resolver also refuses checks that do not belong to the head (defense in depth)', () => {
    const forged = { head_sha: 'head1', ci_sha: 'old1', skipped_progress_shas: [], checks: checks.pass };
    assert.equal(mainStatus(forged, plan.required_checks).ci, CI.NONE);
    const wrongChain = { head_sha: 'head1', ci_sha: 'old1', skipped_progress_shas: ['other'], checks: checks.pass };
    assert.equal(mainStatus(wrongChain, plan.required_checks).ci, CI.NONE);
    assert.equal(mainStatus({ head_sha: 'h', ci_sha: 'h', skipped_progress_shas: [], checks: checks.pass }, plan.required_checks).ci, CI.PASS);
    assert.equal(mainStatus(undefined, plan.required_checks).ci, CI.NONE);
  });

  test('a head without CI blocks starting a task that requires green main, even if the commit below is green', async () => {
    const m01 = plan.tasks.find((t) => t.requires_main_ci_green);
    assert.ok(m01, 'plan has a task gated on main CI');
    const m00Done = [
      ...history(),
      merged(6, '6', { labels: LABELS_C1A1 }),
      merged(8, '8', { labels: ['agent:claude', 'type:implementation', 'module:M00-C1B'] }),
      merged(9, '9', { labels: ['agent:claude', 'type:implementation', 'module:M00-C1C'] }),
      merged(20, 'd', { labels: ['agent:chatgpt', 'type:design', `module:${m01.id}`] }),
    ];
    const stale = await mainFor({ commits: [entry('head1', 'old1'), entry('old1', null)], runs: { old1: green } });
    const blocked = resolveProgress(plan, { ...snapshot(m00Done), main: stale.snap.main });
    assert.equal(blocked.main.ci, CI.NONE);
    assert.equal(stateOf(blocked, m01.id), STATE.BLOCKED_BY_CI);

    const verified = await mainFor({ commits: [entry('head1', 'old1'), entry('old1', null)], runs: { head1: green } });
    const open = resolveProgress(plan, { ...snapshot(m00Done), main: verified.snap.main });
    assert.equal(stateOf(open, m01.id), STATE.READY_FOR_CLAUDE);
  });

  test('the dashboard never shows an older SHA as the head, and never prints a progress-bot SHA', async () => {
    const normal = await mainFor({ commits: [entry('a'.repeat(40), 'b'.repeat(40)), entry('b'.repeat(40), null)], runs: { ['b'.repeat(40)]: green } });
    const mdNormal = buildMarkdown(plan, { ...normal.snap, pulls: [] });
    assert.match(mdNormal, /Dữ liệu theo main HEAD `aaaaaaa`/);
    assert.match(mdNormal, /\(chưa xác minh CI cho HEAD; không dùng kết quả của commit cũ\) · CI main: —/);
    assert.ok(!mdNormal.includes('bbbbbbb'), 'the old green commit is not named');

    const bot = await mainFor({
      commits: [progressEntry('d'.repeat(40), 'c'.repeat(40)), entry('c'.repeat(40), null)],
      runs: { ['c'.repeat(40)]: green },
      files: { ['d'.repeat(40)]: ['docs/PROGRESS.md'] },
    });
    const mdBot = buildMarkdown(plan, { ...bot.snap, pulls: [] });
    assert.match(mdBot, /Dữ liệu theo mã main `ccccccc` \(HEAD là commit progress-bot chỉ sửa tài liệu; CI được đọc từ commit mã này\)/);
    assert.ok(!mdBot.includes('ddddddd'), 'the bot SHA changes with every dashboard commit, so it is not printed');
    // Regenerating after the dashboard's own commit must not produce yet another change.
    assert.equal(buildMarkdown(plan, { ...bot.snap, pulls: [] }), mdBot);
  });
});

// ---------------------------------------------------------------------------------------------

describe('reset-review: cleanup of review labels when the head changes (defense in depth)', () => {
  const REVIEW_ALL = ['review:pass', 'review:in-progress', 'review:changes-requested'];

  /** An in-memory PR plus a fake GitHub that serves its labels. */
  function livePr(labels) {
    const state = { labels: [...labels] };
    const { fetchImpl, calls } = fakeGitHub({
      '/repos/o/r/issues/6/labels?': () => state.labels.map((name) => ({ name })),
      '/repos/o/r/issues/6/labels/': (path, method) => {
        assert.equal(method, 'DELETE');
        const name = decodeURIComponent(path.split('/labels/')[1]);
        state.labels = state.labels.filter((l) => l !== name);
        return state.labels.map((n) => ({ name: n }));
      },
    });
    return { state, fetchImpl, calls };
  }

  test('pushing a new head removes the review labels of the old one and leaves every other label alone', async () => {
    const live = livePr([...LABELS_C1A1, 'review:pass', 'review:in-progress']);
    const { removed } = await resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl: live.fetchImpl });
    assert.deepEqual(removed.sort(), ['review:in-progress', 'review:pass']);
    assert.deepEqual(live.state.labels.sort(), [...LABELS_C1A1].sort(), 'only review:* labels are touched');
  });

  test('all three review labels are removed, in-progress and changes-requested too', async () => {
    const live = livePr([...LABELS_C1A1, ...REVIEW_ALL]);
    const { removed } = await resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl: live.fetchImpl });
    assert.deepEqual(removed.sort(), [...REVIEW_ALL].sort());
    assert.deepEqual(REVIEW_LABELS.slice().sort(), [...REVIEW_ALL].sort());
    assert.ok(REVIEW_ALL.every((l) => !live.state.labels.includes(l)));
  });

  test('a PR without review labels is left alone (no DELETE is sent)', async () => {
    const live = livePr([...LABELS_C1A1]);
    const { removed } = await resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl: live.fetchImpl });
    assert.deepEqual(removed, []);
    assert.ok(live.calls.every((c) => c.method === 'GET'));
  });

  test('a label that disappears between read and delete (404) is not an error', async () => {
    const { fetchImpl } = fakeGitHub({
      '/repos/o/r/issues/6/labels?': [{ name: 'review:pass' }],
      '/repos/o/r/issues/6/labels/': Object.assign(new Error('Label does not exist'), { status: 404 }),
    });
    const { removed } = await resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl });
    assert.deepEqual(removed, ['review:pass']);
  });

  test('fail closed: any other API failure throws, so the publish job does not run', async () => {
    const readFails = fakeGitHub({});
    await assert.rejects(resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'sekrit-token', fetchImpl: readFails.fetchImpl }), (e) => e instanceof GitHubError && e.status === 404 && !e.message.includes('sekrit-token'));
    const deleteFails = fakeGitHub({
      '/repos/o/r/issues/6/labels?': [{ name: 'review:pass' }],
      '/repos/o/r/issues/6/labels/': Object.assign(new Error('Resource not accessible by integration'), { status: 403 }),
    });
    await assert.rejects(resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'sekrit-token', fetchImpl: deleteFails.fetchImpl }), (e) => e.status === 403 && !e.message.includes('sekrit-token'));
    await assert.rejects(resetReviewLabels({ repo: 'o/r', prNumber: 6, fetchImpl: async () => assert.fail('no request expected') }), /GITHUB_TOKEN/);
  });

  test('only a plain positive integer PR number and an owner/name repo are accepted', async () => {
    const never = async () => assert.fail('no request expected');
    for (const bad of ['0', '-1', '1.5', '1e3', 'abc', '', '6; rm -rf /', '6/../7', '6 ', undefined, null, NaN, 1234567890123]) {
      await assert.rejects(resetReviewLabels({ repo: 'o/r', prNumber: bad, token: 'tok', fetchImpl: never }), /PR number/, String(bad));
    }
    for (const bad of ['', 'no-slash', 'a/b/c', 'o/r;x', undefined]) {
      await assert.rejects(resetReviewLabels({ repo: bad, prNumber: 6, token: 'tok', fetchImpl: never }), /repository/, String(bad));
    }
  });

  test('requests go to the PR number given and use the token only as a bearer header', async () => {
    const live = livePr([...LABELS_C1A1, 'review:pass']);
    await resetReviewLabels({ repo: 'o/r', prNumber: '6', token: 'tok', fetchImpl: live.fetchImpl });
    assert.ok(live.calls.every((c) => c.path.startsWith('/repos/o/r/issues/6/labels') && c.auth === 'Bearer tok'));
    assert.ok(live.calls.every((c) => !c.path.includes('tok')));
  });
});

// ---------------------------------------------------------------------------------------------

describe('workflow wiring (static checks)', () => {
  const text = readFileSync(resolve(root, '.github/workflows/update-progress.yml'), 'utf8').replaceAll('\r\n', '\n');
  const jobBlock = (name) => {
    const start = text.indexOf(`\n  ${name}:`);
    assert.notEqual(start, -1, `job ${name} exists`);
    const next = text.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
    return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
  };
  const runLines = (block) => block.split('\n').filter((l) => /^\s*run:/.test(l) || /^\s{12,}\S/.test(l));

  test('the commit the workflow makes is exactly the one the collector trusts', () => {
    assert.ok(text.includes(`git commit -m "${PROGRESS_COMMIT_MESSAGE}"`));
    assert.ok(text.includes(`git config user.name "${PROGRESS_BOT.name}"`));
    assert.ok(text.includes(`git config user.email "${PROGRESS_BOT.email}"`));
    assert.ok(text.includes('git add docs/PROGRESS.md'));
    assert.ok(!/git add (-A|\.|--all)/.test(text), 'only docs/PROGRESS.md is ever staged');
  });

  test('review-status binds the review to the head SHA with minimal permissions and no PR code', () => {
    const block = jobBlock('review-status');
    assert.match(block, /github\.event_name == 'pull_request_target'/);
    assert.match(block, /github\.event\.action == 'labeled' \|\| github\.event\.action == 'unlabeled'/);
    assert.match(block, /startsWith\(github\.event\.label\.name, 'review:'\)/);
    assert.match(block, /permissions:\n\s+contents: read\n\s+pull-requests: read\n\s+statuses: write\n/);
    assert.ok(!/(issues|actions|checks|packages|id-token|deployments|contents: write|pull-requests: write): /.test(block.split('steps:')[0]), 'no other permission');
    assert.match(block, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.ok(!/head\.ref|github\.head_ref|pull_request\.title|pull_request\.body/.test(block), 'no branch, title or body');
    assert.ok(!/npm (ci|install)/.test(block), 'no dependencies installed next to a write token');
    assert.match(block, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
    assert.match(block, /EVENT_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    assert.match(block, /run: node scripts\/sync-review-status\.mjs/);
    assert.match(block, /concurrency:\n\s+group: review-status-\$\{\{ github\.event\.pull_request\.number \}\}/);
    // the PR head is only ever a value handed to the script as data; the code that runs is the default branch's
    assert.ok(!/ref: .*pull_request/.test(block), 'the PR head is never checked out');
  });

  test('reset-review runs only for synchronize on pull_request_target with minimal permissions and no PR code', () => {
    const block = jobBlock('reset-review');
    assert.match(block, /if: github\.event_name == 'pull_request_target' && github\.event\.action == 'synchronize'/);
    assert.match(block, /permissions:\n\s+contents: read\n\s+pull-requests: write\n/);
    assert.ok(!/(issues|actions|checks|packages|id-token|statuses|deployments): /.test(block.split('steps:')[0]), 'no other permission');
    assert.match(block, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.ok(!/pull_request\.head|head\.ref|head\.sha|github\.head_ref/.test(block), 'the PR head is never checked out or used');
    assert.ok(!/npm (ci|install)/.test(block), 'no dependencies installed next to a write token');
    assert.match(block, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
    assert.match(block, /run: node scripts\/reset-review-labels\.mjs/);
  });

  test('no run: line interpolates anything from the event', () => {
    for (const name of ['preview', 'review-status', 'reset-review', 'publish', 'commit-progress']) {
      for (const line of runLines(jobBlock(name))) assert.ok(!line.includes('${{'), `${name}: ${line.trim()}`);
    }
  });

  test('publish waits for review-status and reset-review and is skipped if either failed', () => {
    const block = jobBlock('publish');
    assert.match(block, /needs: \[reset-review, review-status\]/);
    assert.match(block, /needs\.reset-review\.result == 'success' \|\| needs\.reset-review\.result == 'skipped'/);
    assert.match(block, /needs\.review-status\.result == 'success' \|\| needs\.review-status\.result == 'skipped'/);
    assert.match(block, /github\.event_name != 'pull_request'/);
    // S-02: the generator job holds no write token; only commit-progress does.
    assert.match(block, /permissions:\n\s+contents: read\n/);
    assert.ok(!/: write/.test(block), 'publish (generator) has no write permission');
    assert.ok(!/git (push|commit)/.test(block), 'publish does not commit or push');
  });

  test('commit-progress is the only job with contents: write and runs only while PROGRESS_PUBLISH is true', () => {
    const block = jobBlock('commit-progress');
    assert.match(block, /needs: publish\n/);
    assert.match(block, /if: \$\{\{ !cancelled\(\) && needs\.publish\.result == 'success' && vars\.PROGRESS_PUBLISH == 'true' \}\}/);
    assert.match(block, /contents: write/);
    assert.equal((text.replace(/^\s*#.*$/gm, '').match(/contents: write/g) ?? []).length, 1, 'exactly one job can write repository contents');
    assert.ok(!/pull_request\.head|head\.ref|head\.sha|github\.head_ref/.test(block), 'the PR head is never used');
  });

  test('only the review-status job may write commit statuses; the jobs that read them can read them', () => {
    const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'); // comments may mention it
    assert.equal((code.match(/statuses: write/g) ?? []).length, 1, 'one job has statuses: write');
    for (const name of ['preview', 'publish']) assert.match(jobBlock(name), /statuses: read/, `${name} reads statuses`);
    assert.ok(!/statuses: write/.test(jobBlock('publish')) && !/statuses: write/.test(jobBlock('preview')) && !/statuses: write/.test(jobBlock('reset-review')));
  });

  test('loop guards stay in place', () => {
    assert.match(text, /paths-ignore:\n\s+- docs\/PROGRESS\.md/);
    assert.match(text, /workflow_run:\n\s+workflows: \[CI\]/);
    assert.ok(!/workflow_run:\n\s+workflows: \[[^\]]*Update progress/.test(text));
    assert.match(jobBlock('commit-progress'), /git diff --quiet -- docs\/PROGRESS\.md/);
  });
});

// ---------------------------------------------------------------------------------------------

describe('manifest roles are fixed in schema v1 (finding)', () => {
  const withTask = (patch) => {
    const copy = structuredClone(plan);
    Object.assign(copy.tasks[0], patch);
    return copy;
  };

  test('the shipped plan.yml uses exactly the fixed workflow roles', () => {
    for (const t of livePlan.tasks) {
      assert.equal(t.owner_role, 'CLAUDE', t.id);
      assert.equal(t.design_role, 'CHATGPT', t.id);
      assert.equal(t.review_role, 'CHATGPT', t.id);
    }
  });

  test('any other or missing role value is rejected, so the fields cannot pretend to be configurable', () => {
    for (const patch of [{ owner_role: 'CHATGPT' }, { design_role: 'CLAUDE' }, { review_role: 'OWNER' }, { review_role: 'chatgpt' }, { owner_role: undefined }, { design_role: null }]) {
      assert.throws(() => validatePlan(withTask(patch)), /not configurable|must be/, JSON.stringify(patch));
    }
    assert.doesNotThrow(() => validatePlan(withTask({})));
  });

  test('the error says which task and field, and that roles are not configurable yet', () => {
    assert.throws(() => validatePlan(withTask({ review_role: 'OWNER' })), (e) => e.message.includes(`task ${plan.tasks[0].id}: review_role must be CHATGPT`) && e.message.includes('not configurable yet'));
  });
});
