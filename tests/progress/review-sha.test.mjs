// Final PR #8 blocker: a review result is valid only for the EXACT head SHA that was reviewed.
//
//   REVIEW-SHA-01..08   head A -> B, stale labels, race between workflows, forged or mismatched
//                       statuses. Most of them run the real writer (syncReviewStatus), the real
//                       collector (collectSnapshot) and the real resolver against a small stateful
//                       fake of GitHub, so the order in which things happen is part of the test.
//
// The invariant: whatever order the workflows run in, and whatever the commit timestamps say, a
// head with no trusted status of its own is never READY_TO_MERGE.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapshot, GitHubError } from '../../scripts/progress/github.mjs';
import { resetReviewLabels, syncReviewStatus } from '../../scripts/progress/review.mjs';
import { expectedReviewStatus, reviewBinding } from '../../scripts/progress/review-binding.mjs';
import { resolveProgress, STATE } from '../../scripts/progress/resolve.mjs';
import { PROGRESS_BOT, REVIEW_CONTEXT, REVIEW_LABELS, REVIEW_LABEL_STATE, REVIEW_STATUS_DESCRIPTION } from '../../scripts/progress/constants.mjs';
import { plan, REQUIRED, history, pr, checks, snapshot, LABELS_C1A1, stateOf, taskOf } from './helpers.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const BOT = { login: PROGRESS_BOT.login };
const PASS = 'review:pass';
const IN_PROGRESS = 'review:in-progress';
const CHANGES = 'review:changes-requested';

// ---------------------------------------------------------------------------------------------
// A stateful fake of the parts of GitHub the review flow touches: one PR (#6) in o/r, commit
// statuses per SHA, check runs (always green), and a main branch with a normal head commit.

function fakeRepo({ head = A, labels = [] } = {}) {
  const sim = { head, labels: [...labels], state: 'open', statuses: {}, nextId: 1, calls: [], afterPost: null };
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fail = (status, message) => ({ ok: false, status, json: async () => ({ message }) });

  sim.postStatus = (sha, state, context = REVIEW_CONTEXT, creator = BOT) => {
    (sim.statuses[sha] ??= []).push({ id: sim.nextId++, context, state, creator });
  };
  /** A new commit is pushed: only the head changes. Labels stay until reset-review removes them. */
  sim.push = (sha) => {
    sim.head = sha;
  };
  const pull = () => ({
    number: 6,
    title: 'ignored title',
    state: sim.state,
    draft: false,
    merged_at: null,
    head: { sha: sim.head, ref: 'branch' },
    labels: sim.labels.map((name) => ({ name })),
  });

  sim.fetchImpl = async (url, init = {}) => {
    const path = url.replace('https://api.github.com', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    sim.calls.push({ method, path, body, auth: init.headers?.Authorization });
    let m;
    if (method === 'GET' && path === '/repos/o/r/pulls/6') return json(pull());
    if (method === 'GET' && path.startsWith('/repos/o/r/pulls?')) return json([pull()]);
    if (method === 'GET' && path.startsWith('/repos/o/r/issues/6/labels?')) return json(sim.labels.map((name) => ({ name })));
    if (method === 'DELETE' && (m = path.match(/^\/repos\/o\/r\/issues\/6\/labels\/(.+)$/))) {
      sim.labels = sim.labels.filter((l) => l !== decodeURIComponent(m[1]));
      return json(sim.labels.map((name) => ({ name })));
    }
    if (method === 'POST' && (m = path.match(/^\/repos\/o\/r\/statuses\/([0-9a-f]{40})$/))) {
      sim.postStatus(m[1], body.state, body.context);
      if (sim.afterPost) sim.afterPost();
      return json({ id: sim.nextId - 1 });
    }
    if (method === 'GET' && (m = path.match(/^\/repos\/o\/r\/commits\/([0-9a-f]{40})\/status\?/))) {
      const newest = new Map();
      for (const s of sim.statuses[m[1]] ?? []) if (!newest.has(s.context) || s.id > newest.get(s.context).id) newest.set(s.context, s);
      return json({ sha: m[1], statuses: [...newest.values()] });
    }
    if (method === 'GET' && /\/commits\/[^/]+\/check-runs/.test(path)) return json({ check_runs: [{ id: 1, name: REQUIRED, status: 'completed', conclusion: 'success' }] });
    if (method === 'GET' && path.startsWith('/repos/o/r/commits?')) {
      return json([{ sha: 'm1', parents: [], commit: { message: 'feat: code' }, author: { login: 'dev' }, committer: { login: 'dev' } }]);
    }
    return fail(404, 'Not Found');
  };
  return sim;
}

const sync = (sim, eventHeadSha) => syncReviewStatus({ repo: 'o/r', prNumber: 6, eventHeadSha, token: 'tok', fetchImpl: sim.fetchImpl });

/** What a `publish` run sees: collect from GitHub right now, then resolve. */
async function dashboard(sim) {
  const snap = await collectSnapshot({ repo: 'o/r', mainBranch: 'main', requiredChecks: [REQUIRED], token: 'tok', fetchImpl: sim.fetchImpl });
  const result = resolveProgress(plan, { ...snap, pulls: [...history(), ...snap.pulls] });
  return { snap, result, state: stateOf(result, 'M00-C1A1'), head: taskOf(result, 'M00-C1A1').head };
}

/** Pure resolver input, for the cases that are about a crafted or forged snapshot. */
const resolveWith = (fields) => resolveProgress(plan, snapshot([...history(), pr({ number: 6, labels: LABELS_C1A1, checks: checks.pass, head_sha: B, ...fields })]));
const status = (over = {}) => ({ sha: B, context: REVIEW_CONTEXT, state: 'success', ...over });

// ---------------------------------------------------------------------------------------------

describe('REVIEW-SHA: a review result is bound to the exact head SHA', () => {
  test('REVIEW-SHA-01 head A, review:pass, trusted success status on A, CI green -> READY_TO_MERGE', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    const out = await sync(sim, A);
    assert.deepEqual([out.written, out.sha, out.state], [true, A, 'success']);
    const post = sim.calls.find((c) => c.method === 'POST');
    assert.equal(post.path, `/repos/o/r/statuses/${A}`, 'the status goes on the head SHA, nowhere else');
    assert.deepEqual(post.body, { state: 'success', context: REVIEW_CONTEXT, description: REVIEW_STATUS_DESCRIPTION.success });

    const d = await dashboard(sim);
    assert.deepEqual(d.snap.pulls[0].review_status, { sha: A, context: REVIEW_CONTEXT, state: 'success' });
    assert.equal(d.state, STATE.READY_TO_MERGE);
    assert.equal(d.head, A);
  });

  test('REVIEW-SHA-02 head A passed, head becomes B, the old review:pass label is still there and reset-review has not run -> WAITING_CHATGPT_REVIEW', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    await sync(sim, A);
    assert.equal((await dashboard(sim)).state, STATE.READY_TO_MERGE, 'precondition: A is ready');

    sim.push(B); // reset-review has NOT run: review:pass is still on the PR
    assert.ok(sim.labels.includes(PASS));
    const d = await dashboard(sim);
    assert.equal(d.snap.pulls[0].review_status, null, 'B has no review status of its own');
    assert.equal(d.state, STATE.WAITING_CHATGPT_REVIEW);
    assert.notEqual(d.state, STATE.READY_TO_MERGE);
    assert.ok(d.result.attention.some((a) => a.code === 'REVIEW_NOT_BOUND' && a.pr === 6), 'the unbacked label is reported');
  });

  test('REVIEW-SHA-03 the commit timestamp of B is older than the PASS of A: still WAITING, timestamps are not the root', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    await sync(sim, A);
    sim.push(B);
    const d = await dashboard(sim);
    assert.equal(d.state, STATE.WAITING_CHATGPT_REVIEW);
    // The collector no longer reads label events or commit dates at all.
    assert.ok(!sim.calls.some((c) => /\/issues\/\d+\/events/.test(c.path)), 'label timestamps are never fetched');
    assert.ok(!sim.calls.some((c) => c.path === `/repos/o/r/commits/${B}` || c.path === `/repos/o/r/commits/${A}`), 'commit dates are never fetched');

    // Even a snapshot that still carries old-style timestamps (B committed BEFORE the PASS was given)
    // cannot turn the label into a review: timestamps are ignored, only the status counts.
    const r = resolveWith({ labels: [...LABELS_C1A1, PASS], head_committed_at: '2026-10-07T08:00:00Z', label_events: { [PASS]: '2026-10-07T11:00:00Z' } });
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
    // and in the other direction (label newer than commit) a missing status is still not a PASS
    const r2 = resolveWith({ labels: [...LABELS_C1A1, PASS], head_committed_at: '2026-10-07T10:00:00Z', label_events: { [PASS]: '2026-10-07T12:00:00Z' } });
    assert.equal(stateOf(r2, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
  });

  test('REVIEW-SHA-04 head B, review:pass applied for B, trusted success status on exactly B -> READY_TO_MERGE', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    await sync(sim, A);
    sim.push(B);
    await resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl: sim.fetchImpl }); // cleanup runs
    assert.ok(!sim.labels.includes(PASS));
    sim.labels.push(PASS); // ChatGPT reviews B and labels it
    await sync(sim, B);

    const d = await dashboard(sim);
    assert.deepEqual(d.snap.pulls[0].review_status, { sha: B, context: REVIEW_CONTEXT, state: 'success' });
    assert.equal(d.state, STATE.READY_TO_MERGE);
    assert.equal(d.head, B);
    assert.deepEqual(sim.statuses[A].map((s) => s.state), ['success'], 'the status on A is untouched and stays on A');
  });

  test('REVIEW-SHA-05 race: head A -> B, review:pass of A still there, CI of B green, publish runs BEFORE reset-review -> WAITING_CHATGPT_REVIEW', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    await sync(sim, A); // A was reviewed and passed
    sim.push(B); // push of B; CI of B is green (the fake always serves green checks)
    sim.calls.length = 0;

    // workflow_run "Update progress" for CI of B: reset-review was skipped in this run, publish runs now.
    const beforeReset = await dashboard(sim);
    assert.equal(beforeReset.state, STATE.WAITING_CHATGPT_REVIEW);
    assert.notEqual(beforeReset.state, STATE.READY_TO_MERGE);
    assert.ok(sim.calls.some((c) => c.path.startsWith(`/repos/o/r/commits/${B}/status`)), 'the status is read for the current head B');
    assert.ok(!sim.calls.some((c) => c.path.startsWith(`/repos/o/r/commits/${A}/status`)), 'the status of the old head A is never consulted');

    // reset-review finally runs: nothing changes for the better or worse
    await resetReviewLabels({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl: sim.fetchImpl });
    assert.equal((await dashboard(sim)).state, STATE.WAITING_CHATGPT_REVIEW);
  });

  test('REVIEW-SHA-05b race: the label event is for A but the head is already B when the job runs -> nothing is written, B waits', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    sim.push(B); // pushed after ChatGPT labelled A, before the status job read the PR
    const out = await sync(sim, A); // the event carries A
    assert.equal(out.written, false);
    assert.match(out.skipped, /head changed/);
    assert.ok(!sim.calls.some((c) => c.method === 'POST'), 'no status is written for B on the strength of a review of A');
    const d = await dashboard(sim);
    assert.equal(d.state, STATE.WAITING_CHATGPT_REVIEW);
    assert.equal(d.snap.pulls[0].review_status, null);
  });

  test('REVIEW-SHA-05c race: the head moves while the status is being written -> the status stays on the old SHA and is never copied to the new head', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    sim.afterPost = () => {
      sim.afterPost = null;
      sim.push(B);
    };
    const out = await sync(sim, A);
    assert.deepEqual([out.written, out.sha], [true, A]);
    assert.deepEqual(sim.calls.filter((c) => c.method === 'POST').map((c) => c.path), [`/repos/o/r/statuses/${A}`], 'exactly one write, on A');
    assert.equal(sim.statuses[B], undefined);
    assert.equal((await dashboard(sim)).state, STATE.WAITING_CHATGPT_REVIEW);
  });

  test('REVIEW-SHA-06 review:pass, success status but on SHA A while the current head is B -> WAITING_CHATGPT_REVIEW', () => {
    const r = resolveWith({ labels: [...LABELS_C1A1, PASS], review_status: status({ sha: A }) });
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
    assert.ok(r.attention.some((a) => a.code === 'REVIEW_NOT_BOUND' && /another SHA/.test(a.message)));
  });

  test('REVIEW-SHA-07 review:pass, status on B but with the wrong context -> not a PASS', () => {
    for (const context of ['ci/other', '11ship/chatgpt-review ', '11Ship/ChatGPT-Review', '', undefined, null]) {
      const r = resolveWith({ labels: [...LABELS_C1A1, PASS], review_status: status({ context }) });
      assert.notEqual(stateOf(r, 'M00-C1A1'), STATE.READY_TO_MERGE, String(context));
      assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW, String(context));
    }
  });

  test('REVIEW-SHA-08 review:pass, status on B but with state pending or failure (or anything else) -> not READY_TO_MERGE', () => {
    for (const state of ['pending', 'failure', 'error', 'SUCCESS', '', undefined]) {
      const r = resolveWith({ labels: [...LABELS_C1A1, PASS], review_status: status({ state }) });
      assert.notEqual(stateOf(r, 'M00-C1A1'), STATE.READY_TO_MERGE, String(state));
      assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW, String(state));
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('the resolver never takes a label as evidence on its own', () => {
  test('a snapshot without review_status (older format, or nothing collected) fails closed', () => {
    for (const fields of [{}, { review_status: null }, { review_status: undefined }, { review_status: 'success' }, { review_status: [] }]) {
      for (const label of REVIEW_LABELS) {
        const r = resolveWith({ labels: [...LABELS_C1A1, label], ...fields });
        assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW, `${label} ${JSON.stringify(fields)}`);
      }
    }
  });

  test('each label is valid only with the one state it stands for, on the current head', () => {
    const cases = [
      [PASS, 'success', STATE.READY_TO_MERGE],
      [CHANGES, 'failure', STATE.CHANGES_REQUESTED],
      [IN_PROGRESS, 'pending', STATE.CHATGPT_REVIEW],
    ];
    for (const [label, state, expected] of cases) {
      assert.equal(stateOf(resolveWith({ labels: [...LABELS_C1A1, label], review_status: status({ state }) }), 'M00-C1A1'), expected, label);
    }
    for (const [label, state] of cases) {
      for (const wrong of ['success', 'failure', 'pending', 'error'].filter((s) => s !== state)) {
        const r = resolveWith({ labels: [...LABELS_C1A1, label], review_status: status({ state: wrong }) });
        assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW, `${label} with ${wrong}`);
      }
    }
  });

  test('a status without its label is not a review either', () => {
    const r = resolveWith({ labels: [...LABELS_C1A1], review_status: status() });
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
  });

  test('more than one review label is ambiguous: none is used, even with a matching success status', () => {
    const r = resolveWith({ labels: [...LABELS_C1A1, PASS, IN_PROGRESS], review_status: status() });
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
    assert.ok(r.attention.some((a) => a.code === 'REVIEW_NOT_BOUND' && /more than one review label/.test(a.message)));
  });

  test('a changes-requested status for an old head does not leak onto the new head either', () => {
    const r = resolveWith({ labels: [...LABELS_C1A1, CHANGES], review_status: status({ sha: A, state: 'failure' }) });
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
  });

  test('a head SHA that is unknown never matches', () => {
    for (const head of [null, undefined, '']) {
      const verdict = reviewBinding({ head_sha: head, labels: [PASS], review_status: { sha: head, context: REVIEW_CONTEXT, state: 'success' } });
      assert.equal(verdict.valid, false, String(head));
    }
  });

  test('red CI still wins over a valid PASS, and a draft PR is still coding', () => {
    const ok = { labels: [...LABELS_C1A1, PASS], review_status: status() };
    assert.equal(stateOf(resolveWith({ ...ok, checks: checks.fail }), 'M00-C1A1'), STATE.CI_FAILED);
    assert.equal(stateOf(resolveWith({ ...ok, checks: checks.running }), 'M00-C1A1'), STATE.CI_RUNNING);
    assert.equal(stateOf(resolveWith({ ...ok, draft: true, labels: [...LABELS_C1A1, IN_PROGRESS], review_status: status({ state: 'pending' }) }), 'M00-C1A1'), STATE.CLAUDE_CODING);
  });

  test('the dashboard output is identical for identical snapshots', () => {
    const fields = { labels: [...LABELS_C1A1, PASS], review_status: status() };
    assert.equal(JSON.stringify(resolveWith(fields)), JSON.stringify(resolveWith(structuredClone(fields))));
  });
});

// ---------------------------------------------------------------------------------------------

describe('the trusted writer: label -> status on the current head', () => {
  test('each review label maps to its state with the one context and a fixed description', async () => {
    for (const label of REVIEW_LABELS) {
      const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, label] });
      const out = await sync(sim, A);
      assert.equal(out.state, REVIEW_LABEL_STATE[label]);
      const post = sim.calls.find((c) => c.method === 'POST');
      assert.deepEqual(post.body, { state: REVIEW_LABEL_STATE[label], context: REVIEW_CONTEXT, description: REVIEW_STATUS_DESCRIPTION[REVIEW_LABEL_STATE[label]] }, label);
    }
    assert.deepEqual(REVIEW_LABEL_STATE, { 'review:in-progress': 'pending', 'review:changes-requested': 'failure', 'review:pass': 'success' });
    assert.equal(REVIEW_CONTEXT, '11ship/chatgpt-review');
  });

  test('no review label, or several, writes an error status that revokes any earlier result on that head', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    await sync(sim, A);
    sim.labels = sim.labels.filter((l) => l !== PASS); // a person removes the label
    const none = await sync(sim, A);
    assert.equal(none.state, 'error');
    assert.equal((await dashboard(sim)).snap.pulls[0].review_status, undefined, 'no label, so the collector does not even look');

    sim.labels.push(PASS, IN_PROGRESS);
    assert.equal((await sync(sim, A)).state, 'error');
    assert.deepEqual(expectedReviewStatus([PASS, IN_PROGRESS]).reason, 'ambiguous');
    assert.deepEqual(expectedReviewStatus([]).reason, 'none');
    const d = await dashboard(sim);
    assert.equal(d.snap.pulls[0].review_status.state, 'error');
    assert.equal(d.state, STATE.WAITING_CHATGPT_REVIEW);
  });

  test('labels that change on the same head while writing are written again and settle', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, IN_PROGRESS] });
    sim.afterPost = () => {
      sim.afterPost = null;
      sim.labels = sim.labels.filter((l) => l !== IN_PROGRESS).concat(PASS);
    };
    const out = await sync(sim, A);
    assert.equal(out.state, 'success');
    assert.deepEqual(sim.statuses[A].map((s) => s.state), ['pending', 'success']);
  });

  test('fails closed when the result does not settle', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, IN_PROGRESS] });
    let flip = false;
    sim.afterPost = () => {
      flip = !flip;
      sim.labels = LABELS_C1A1.concat(flip ? PASS : IN_PROGRESS);
    };
    await assert.rejects(sync(sim, A), /did not settle/);
  });

  test('a PR that is not open is left alone', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    sim.state = 'closed';
    const out = await sync(sim, A);
    assert.equal(out.written, false);
    assert.ok(!sim.calls.some((c) => c.method === 'POST'));
  });

  test('API failures throw, so the job fails and publish of the same run does not run', async () => {
    const never = async () => assert.fail('no request expected');
    await assert.rejects(syncReviewStatus({ repo: 'o/r', prNumber: 6, token: 'sekrit-token', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ message: 'boom' }) }) }), (e) => e instanceof GitHubError && e.status === 500 && !e.message.includes('sekrit-token'));
    const writeFails = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    const inner = writeFails.fetchImpl;
    writeFails.fetchImpl = async (url, init = {}) => (init.method === 'POST' ? { ok: false, status: 403, json: async () => ({ message: 'Resource not accessible by integration' }) } : inner(url, init));
    await assert.rejects(sync(writeFails, A), (e) => e.status === 403 && !e.message.includes('tok"'));
    await assert.rejects(syncReviewStatus({ repo: 'o/r', prNumber: 6, fetchImpl: never }), /GITHUB_TOKEN/);
    // a PR without a usable head SHA is an error, not a guess
    await assert.rejects(syncReviewStatus({ repo: 'o/r', prNumber: 6, token: 'tok', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ state: 'open', labels: [], head: { sha: 'not-a-sha' } }) }) }), /usable head SHA/);
  });

  test('only a plain positive PR number, an owner/name repo and a 40-hex event SHA are accepted', async () => {
    const never = async () => assert.fail('no request expected');
    for (const bad of ['0', '-1', '1.5', 'abc', '', '6; rm -rf /', '6/../7', undefined, null, NaN]) {
      await assert.rejects(syncReviewStatus({ repo: 'o/r', prNumber: bad, token: 'tok', fetchImpl: never }), /PR number/, String(bad));
    }
    for (const bad of ['', 'no-slash', 'a/b/c', 'o/r;x', undefined]) {
      await assert.rejects(syncReviewStatus({ repo: bad, prNumber: 6, token: 'tok', fetchImpl: never }), /repository/, String(bad));
    }
    for (const bad of ['abc', 'A'.repeat(40), `${A};x`, 'a'.repeat(39), 'a'.repeat(41)]) {
      await assert.rejects(syncReviewStatus({ repo: 'o/r', prNumber: 6, eventHeadSha: bad, token: 'tok', fetchImpl: never }), /event head SHA/, bad);
    }
  });

  test('requests only touch this PR and its head, and the token is only a bearer header', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    await sync(sim, A);
    assert.ok(sim.calls.every((c) => c.path === '/repos/o/r/pulls/6' || c.path === `/repos/o/r/statuses/${A}`), sim.calls.map((c) => c.path).join(' '));
    assert.ok(sim.calls.every((c) => c.auth === 'Bearer tok' && !c.path.includes('tok')));
    assert.ok(!JSON.stringify(sim.calls.map((c) => c.body)).includes('ignored title'), 'nothing from the PR title or body is sent');
  });
});

// ---------------------------------------------------------------------------------------------

describe('the collector keeps only the review status of the current head', () => {
  test('review_status is exactly { sha, context, state } and the sha is the one GitHub reports', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    sim.postStatus(A, 'success');
    const { snap } = await dashboard(sim);
    assert.deepEqual(Object.keys(snap.pulls[0].review_status).sort(), ['context', 'sha', 'state']);
    assert.ok(!JSON.stringify(snap).includes('tok"'), 'token never lands in the snapshot');
  });

  test('statuses on a PR without review labels are not requested', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1] });
    await dashboard(sim);
    assert.ok(!sim.calls.some((c) => c.path.includes('/status')));
  });

  test('the newest status of the context wins', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    sim.postStatus(A, 'pending');
    sim.postStatus(A, 'success');
    assert.equal((await dashboard(sim)).state, STATE.READY_TO_MERGE);
    sim.postStatus(A, 'failure');
    const d = await dashboard(sim);
    assert.equal(d.snap.pulls[0].review_status.state, 'failure');
    assert.equal(d.state, STATE.WAITING_CHATGPT_REVIEW, 'label says pass, newest status says failure');
  });

  test('a status forged by someone other than the Actions token is never a review, and can only hide the real one', async () => {
    const forged = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    forged.postStatus(A, 'success', REVIEW_CONTEXT, { login: 'some-human' });
    const d1 = await dashboard(forged);
    assert.equal(d1.snap.pulls[0].review_status, null);
    assert.equal(d1.state, STATE.WAITING_CHATGPT_REVIEW);

    const noCreator = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    noCreator.postStatus(A, 'success', REVIEW_CONTEXT, null);
    assert.equal((await dashboard(noCreator)).state, STATE.WAITING_CHATGPT_REVIEW);

    const hidden = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    hidden.postStatus(A, 'success'); // the real one
    hidden.postStatus(A, 'failure', REVIEW_CONTEXT, { login: 'some-human' }); // newer, forged
    assert.equal((await dashboard(hidden)).state, STATE.WAITING_CHATGPT_REVIEW, 'fails closed, never open');

    const otherContext = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    otherContext.postStatus(A, 'success', 'ci/other');
    assert.equal((await dashboard(otherContext)).state, STATE.WAITING_CHATGPT_REVIEW);
  });

  test('a failing status read is an error, not an empty answer (the dashboard is not generated from a guess)', async () => {
    const sim = fakeRepo({ head: A, labels: [...LABELS_C1A1, PASS] });
    const inner = sim.fetchImpl;
    sim.fetchImpl = async (url, init) => (url.includes('/status?') ? { ok: false, status: 403, json: async () => ({ message: 'Resource not accessible by integration' }) } : inner(url, init));
    await assert.rejects(dashboard(sim), (e) => e instanceof GitHubError && e.status === 403 && /status/.test(e.message) && !e.message.includes('tok"'));
  });
});
