import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProgress, ciStatus, prLifecycle, STATE, PR_STATE, OWNER, CI, validatePlan } from '../../scripts/progress/resolve.mjs';
import { plan, checks, pr, merged, history, pr5, snapshot, LABELS_C1A1, stateOf, taskOf, prOf, REQUIRED } from './helpers.mjs';

const resolve = (pulls, mainChecks) => resolveProgress(plan, snapshot(pulls, mainChecks));

describe('required cases P01-P09', () => {
  test('P01 merged PR + required CI green -> DONE', () => {
    const r = resolve(history());
    assert.equal(stateOf(r, 'M00-B1'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-C1A0'), STATE.DONE);
    assert.equal(taskOf(r, 'M00-C1A0').pr, 4);
    assert.equal(taskOf(r, 'M00-C1A0').ci, CI.PASS);
  });

  test('P01b label-matched merged Claude implementation PR + CI green -> DONE', () => {
    const r = resolve([...history(), merged(6, '6', { labels: LABELS_C1A1 })]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-C1B'), STATE.READY_FOR_CLAUDE);
  });

  test('P02 closed non-merged PR -> CANCELLED', () => {
    assert.equal(prLifecycle({ number: 9, state: 'closed', merged_at: null }), PR_STATE.CANCELLED);
    const r = resolve([...history(), pr({ number: 9, state: 'closed', labels: LABELS_C1A1, checks: checks.pass })]);
    assert.equal(prOf(r, 9).lifecycle, PR_STATE.CANCELLED);
    assert.equal(prOf(r, 9).counted, false);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
  });

  test('P03 draft Claude implementation PR -> CLAUDE_CODING', () => {
    const r = resolve([...history(), pr({ number: 6, draft: true, labels: LABELS_C1A1, checks: checks.running })]);
    const t = taskOf(r, 'M00-C1A1');
    assert.equal(t.state, STATE.CLAUDE_CODING);
    assert.equal(t.owner, OWNER.CLAUDE);
    assert.equal(t.pr, 6);
  });

  test('P04 open Claude PR + CI fail -> CI_FAILED (draft or ready)', () => {
    for (const draft of [false, true]) {
      const r = resolve([...history(), pr({ number: 6, draft, labels: LABELS_C1A1, checks: checks.fail })]);
      assert.equal(stateOf(r, 'M00-C1A1'), STATE.CI_FAILED, `draft=${draft}`);
      assert.equal(taskOf(r, 'M00-C1A1').owner, OWNER.CLAUDE);
    }
  });

  test('P05 ready PR + CI green + no review gate -> WAITING_CHATGPT_REVIEW', () => {
    const r = resolve([...history(), pr({ number: 6, labels: LABELS_C1A1, checks: checks.pass })]);
    const t = taskOf(r, 'M00-C1A1');
    assert.equal(t.state, STATE.WAITING_CHATGPT_REVIEW);
    assert.equal(t.owner, OWNER.CHATGPT);
    assert.equal(r.focus.task, 'M00-C1A1');
  });

  test('P05b ready PR with CI still running -> CI_RUNNING', () => {
    const r = resolve([...history(), pr({ number: 6, labels: LABELS_C1A1, checks: checks.running })]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.CI_RUNNING);
  });

  test('P06 dependency not DONE -> BLOCKED_BY_DEPENDENCY, even with a labelled open PR', () => {
    const r = resolve([...history(), pr({ number: 8, labels: ['agent:claude', 'type:implementation', 'module:M00-C1B'], checks: checks.pass })]);
    assert.equal(stateOf(r, 'M00-C1B'), STATE.BLOCKED_BY_DEPENDENCY);
    assert.deepEqual(taskOf(r, 'M00-C1B').unmet, ['M00-C1A1']);
  });

  test('P06b a branch or PR existing never unblocks a task', () => {
    const r = resolve([...history(), pr({ number: 8, head_ref: 'feat/m00-c1b', draft: true, checks: checks.pass })]);
    assert.equal(stateOf(r, 'M00-C1B'), STATE.BLOCKED_BY_DEPENDENCY);
  });

  test('P07 PR #5 (closed without merge, green CI on head) is never DONE', () => {
    const r = resolve([...history(), pr5()]);
    assert.equal(prOf(r, 5).lifecycle, PR_STATE.CANCELLED);
    assert.equal(prOf(r, 5).ci, CI.PASS, 'the fixture really has green CI');
    assert.equal(prOf(r, 5).counted, false);
    assert.notEqual(stateOf(r, 'M00-C1A1'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
    assert.equal(stateOf(r, 'M00-C1B'), STATE.BLOCKED_BY_DEPENDENCY);
    assert.equal(r.progress.overall.done, 2);
  });

  test('P07b PR #5 stays ignored even if it is reopened or labelled like a valid PR', () => {
    const reopened = pr5({ state: 'open', draft: false, labels: LABELS_C1A1 });
    const r = resolve([...history(), reopened]);
    assert.equal(prOf(r, 5).lifecycle, PR_STATE.CANCELLED);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
    const mergedAnyway = pr5({ state: 'closed', merged_at: '2026-10-07T03:00:00Z' });
    const r2 = resolve([...history(), mergedAnyway]);
    assert.notEqual(stateOf(r2, 'M00-C1A1'), STATE.DONE);
    assert.equal(r2.progress.overall.done, 2);
  });

  test('P08 C1A0 DONE + no valid C1A1 PR -> READY_FOR_CLAUDE', () => {
    const r = resolve(history());
    const t = taskOf(r, 'M00-C1A1');
    assert.equal(t.state, STATE.READY_FOR_CLAUDE);
    assert.equal(t.owner, OWNER.CLAUDE);
    assert.equal(t.head, 'main');
    assert.equal(r.focus.task, 'M00-C1A1');
    assert.equal(r.focus.owner, OWNER.CLAUDE);
    assert.equal(r.focus.chatgpt, 'Waiting for Claude implementation before review');
    assert.deepEqual(r.focus.blocked_by, []);
  });

  test('P09 C1A1 not DONE -> C1B, C1C and M01 all BLOCKED_BY_DEPENDENCY', () => {
    const r = resolve(history());
    for (const id of ['M00-C1B', 'M00-C1C', 'M01']) assert.equal(stateOf(r, id), STATE.BLOCKED_BY_DEPENDENCY, id);
  });
});

describe('what is not allowed to move a task', () => {
  test('unlabelled PRs are surfaced but never counted, whatever the title says', () => {
    const r = resolve([...history(), pr({ number: 6, title: 'M00-C1A1: DONE all tests pass ready', draft: true, checks: checks.pass })]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
    assert.equal(prOf(r, 6).counted, false);
    assert.ok(r.attention.some((a) => a.code === 'UNCLASSIFIED_PR' && a.pr === 6));
  });

  test('implementation PR labelled agent:chatgpt is a workflow violation and not counted', () => {
    const r = resolve([...history(), pr({ number: 6, labels: ['agent:chatgpt', 'type:implementation', 'module:M00-C1A1'], checks: checks.pass })]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
    assert.ok(r.attention.some((a) => a.code === 'AGENT_MISMATCH' && a.pr === 6));
  });

  test('unknown module label and ambiguous labels are not counted', () => {
    const r = resolve([
      ...history(),
      pr({ number: 6, labels: ['agent:claude', 'type:implementation', 'module:M99-X'] }),
      pr({ number: 7, labels: ['agent:claude', 'type:implementation', 'module:M00-C1A1', 'module:M00-C1B'] }),
    ]);
    assert.ok(r.attention.some((a) => a.code === 'UNKNOWN_MODULE' && a.pr === 6));
    assert.ok(r.attention.some((a) => a.code === 'AMBIGUOUS_PR' && a.pr === 7));
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_FOR_CLAUDE);
  });

  test('type:infra PRs are out of plan and raise no attention', () => {
    const r = resolve([...history(), pr({ number: 9, labels: ['agent:claude', 'type:infra'] })]);
    assert.equal(prOf(r, 9).role, 'infra');
    assert.equal(r.attention.length, 0);
  });

  test('merged implementation PR with failing or unverified CI is not DONE', () => {
    const bad = resolve([...history(), merged(6, '6', { labels: LABELS_C1A1, checks: checks.fail })]);
    assert.equal(stateOf(bad, 'M00-C1A1'), STATE.CI_FAILED);
    const unverified = resolve([...history(), merged(6, '6', { labels: LABELS_C1A1, checks: checks.none })]);
    assert.equal(stateOf(unverified, 'M00-C1A1'), STATE.CI_RUNNING);
    assert.equal(unverified.progress.overall.done, 2);
  });

  test('a PR merged before its dependency is not counted', () => {
    const r = resolve([...history().slice(0, 3), merged(8, '8', { labels: ['agent:claude', 'type:implementation', 'module:M00-C1B'] })]);
    assert.equal(stateOf(r, 'M00-C1A0'), STATE.READY_FOR_CLAUDE);
    assert.equal(stateOf(r, 'M00-C1B'), STATE.BLOCKED_BY_DEPENDENCY);
    assert.ok(r.attention.some((a) => a.code === 'MERGED_BEFORE_DEPENDENCY' && a.pr === 8));
  });
});

describe('review gate', () => {
  const head = 'b'.repeat(40);
  const REVIEW_CONTEXT = '11ship/chatgpt-review';
  // A review label counts only with a trusted status for exactly this head; see review-sha.test.mjs.
  const backed = (state, sha = head) => ({ sha, context: REVIEW_CONTEXT, state });
  const open = (labels, review_status, extra = {}) =>
    pr({
      number: 6,
      head_sha: head,
      labels: [...LABELS_C1A1, ...labels],
      checks: checks.pass,
      review_status,
      ...extra,
    });

  test('review labels backed by a status on the current head drive CHATGPT_REVIEW, CHANGES_REQUESTED and READY_TO_MERGE', () => {
    let r = resolve([...history(), open(['review:in-progress'], backed('pending'))]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.CHATGPT_REVIEW);
    r = resolve([...history(), open(['review:changes-requested'], backed('failure'))]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.CHANGES_REQUESTED);
    assert.equal(taskOf(r, 'M00-C1A1').owner, OWNER.CLAUDE);
    r = resolve([...history(), open(['review:pass'], backed('success'))]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.READY_TO_MERGE);
    assert.equal(taskOf(r, 'M00-C1A1').owner, OWNER.OWNER);
  });

  test('a review label whose status is on an older head is ignored (new push invalidates PASS)', () => {
    const r = resolve([...history(), open(['review:pass'], backed('success', 'a'.repeat(40)))]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
    assert.ok(r.attention.some((a) => a.code === 'REVIEW_NOT_BOUND'));
  });

  test('a review label with no status at all is ignored', () => {
    const r = resolve([...history(), open(['review:pass'], null)]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.WAITING_CHATGPT_REVIEW);
  });

  test('READY_TO_MERGE needs green CI even with a valid PASS', () => {
    const r = resolve([...history(), open(['review:pass'], backed('success'), { checks: checks.fail })]);
    assert.equal(stateOf(r, 'M00-C1A1'), STATE.CI_FAILED);
  });
});

describe('design gate and main CI gate', () => {
  const design = (labels, extra = {}) => pr({ number: 20, labels, ...extra });
  const m01 = ['agent:chatgpt', 'type:design', 'module:M01'];
  const allM00Done = () => [
    ...history(),
    merged(6, '6', { labels: LABELS_C1A1 }),
    merged(8, '8', { labels: ['agent:claude', 'type:implementation', 'module:M00-C1B'] }),
    merged(9, '9', { labels: ['agent:claude', 'type:implementation', 'module:M00-C1C'] }),
  ];

  test('M01 with M00 done but no design PR is PLANNED, with ChatGPT owning the next step', () => {
    const r = resolve(allM00Done());
    assert.equal(stateOf(r, 'M00-C1'), STATE.DONE);
    assert.equal(stateOf(r, 'M01'), STATE.PLANNED);
    assert.equal(taskOf(r, 'M01').owner, OWNER.CHATGPT);
  });

  test('design PR draft -> DESIGNING, ready -> DESIGN_REVIEW (Owner), merged -> READY_FOR_CLAUDE', () => {
    assert.equal(stateOf(resolve([...allM00Done(), design(m01, { draft: true })]), 'M01'), STATE.DESIGNING);
    const review = resolve([...allM00Done(), design(m01)]);
    assert.equal(stateOf(review, 'M01'), STATE.DESIGN_REVIEW);
    assert.equal(taskOf(review, 'M01').owner, OWNER.OWNER);
    assert.equal(stateOf(resolve([...allM00Done(), merged(20, 'd', { labels: m01 })]), 'M01'), STATE.READY_FOR_CLAUDE);
  });

  test('requires_main_ci_green: red or missing main CI blocks starting M01', () => {
    const base = [...allM00Done(), merged(20, 'd', { labels: m01 })];
    assert.equal(stateOf(resolve(base, checks.fail), 'M01'), STATE.BLOCKED_BY_CI);
    assert.equal(stateOf(resolve(base, checks.running), 'M01'), STATE.BLOCKED_BY_CI);
    assert.equal(stateOf(resolve(base, checks.none), 'M01'), STATE.BLOCKED_BY_CI);
    assert.equal(stateOf(resolve(base, checks.pass), 'M01'), STATE.READY_FOR_CLAUDE);
  });

  test('a group is DONE only when its design is locked and all children are DONE', () => {
    assert.equal(stateOf(resolve(history()), 'M00-C1'), STATE.DESIGN_LOCKED);
    assert.equal(stateOf(resolve(allM00Done()), 'M00-C1'), STATE.DONE);
    const noDesign = resolve(history().filter((p) => p.number !== 3));
    assert.equal(stateOf(noDesign, 'M00-C1'), STATE.PLANNED);
    assert.equal(stateOf(noDesign, 'M00-C1A1'), STATE.PLANNED, 'children inherit the missing design lock');
  });
});

describe('progress numbers', () => {
  test('weighted by leaf tasks, not by commits or cancelled PRs', () => {
    const r = resolve([...history(), pr5()]);
    assert.deepEqual(
      { done: r.progress.overall.done, total: r.progress.overall.total, percent: r.progress.overall.percent },
      { done: 2, total: 6, percent: 33 },
    );
    assert.equal(r.progress.current_module.id, 'M00');
    assert.deepEqual([r.progress.current_module.done, r.progress.current_module.total], [2, 5]);
  });

  test('percent is rounded down so it never overstates', () => {
    const r = resolve([...history(), merged(6, '6', { labels: LABELS_C1A1 })]);
    assert.equal(r.progress.overall.percent, 50);
    assert.equal(resolve(history()).progress.overall.percent, 33);
  });
});

describe('ciStatus', () => {
  test('latest run per check name wins (a green re-run clears an old failure)', () => {
    const runs = [
      { id: 1, name: REQUIRED, status: 'completed', conclusion: 'failure' },
      { id: 2, name: REQUIRED, status: 'completed', conclusion: 'success' },
    ];
    assert.equal(ciStatus(runs, [REQUIRED]), CI.PASS);
    assert.equal(ciStatus([...runs].reverse(), [REQUIRED]), CI.PASS);
  });

  test('missing, queued, neutral or skipped required checks never count as PASS', () => {
    assert.equal(ciStatus([{ id: 1, name: 'other', status: 'completed', conclusion: 'success' }], [REQUIRED]), CI.RUNNING);
    assert.equal(ciStatus([{ id: 1, name: REQUIRED, status: 'queued', conclusion: null }], [REQUIRED]), CI.RUNNING);
    assert.equal(ciStatus([{ id: 1, name: REQUIRED, status: 'completed', conclusion: 'skipped' }], [REQUIRED]), CI.RUNNING);
    assert.equal(ciStatus([{ id: 1, name: REQUIRED, status: 'completed', conclusion: 'cancelled' }], [REQUIRED]), CI.FAIL);
    assert.equal(ciStatus([], [REQUIRED]), CI.NONE);
  });
});

describe('plan validation', () => {
  const clone = () => structuredClone(plan);

  test('the real plan is valid', () => assert.doesNotThrow(() => validatePlan(clone())));

  test('rejects cycles, unknown ids, duplicates and double pins', () => {
    let p = clone();
    p.tasks.find((t) => t.id === 'M00-C1A0').depends_on = ['M00-C1C'];
    assert.throws(() => validatePlan(p), /dependency cycle/);
    p = clone();
    p.tasks[0].depends_on = ['M99'];
    assert.throws(() => validatePlan(p), /unknown dependency M99/);
    p = clone();
    p.tasks[1].id = p.tasks[0].id;
    assert.throws(() => validatePlan(p), /duplicate task id/);
    p = clone();
    p.tasks.find((t) => t.id === 'M00-C1A1').implementation_pr = 4;
    assert.throws(() => validatePlan(p), /pinned twice/);
    p = clone();
    p.ignored_prs.push({ number: 4 });
    assert.throws(() => validatePlan(p), /both pinned and ignored/);
  });
});
