// The shipped docs/progress/plan.yml against the repository as it really is after the M00/M01 merges
// (post-merge repair, section 4). Every PR number below is the real one; nothing here marks a task done by
// hand: DONE still needs a merged PR AND a green required check on that PR's head.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProgress, STATE } from '../../scripts/progress/resolve.mjs';
import { REVIEW_CONTEXT } from '../../scripts/progress/constants.mjs';
import { repairPlan as livePlan, checks, merged, pr, snapshot, stateOf } from './helpers.mjs';

const MERGED_PRS = [1, 2, 3, 4, 6, 9, 10, 11, 12, 15, 16, 17];
const realHistory = (mergedCheck = checks.pass) =>
  MERGED_PRS.map((n) => merged(n, String(n % 10), { checks: n === 1 || n === 3 ? checks.none : mergedCheck }));
const draft19 = () => pr({ number: 19, draft: true, head_sha: 'b'.repeat(40), labels: [], checks: checks.running });
const resolve = (pulls) => resolveProgress(livePlan, snapshot(pulls));

describe('frozen repair plan pins the real PR numbers (nothing is matched by title or author)', () => {
  const byId = new Map(livePlan.tasks.map((t) => [t.id, t]));

  test('implementation pins', () => {
    const expected = { 'M00-B1': 2, 'M00-C1A0': 4, 'M00-C1A1': 6, 'M00-C1B': 9, 'M00-C1C': 10, 'M01-A1': 12, 'M01-A2S': 16, 'M01-A2D': 17 };
    for (const [id, n] of Object.entries(expected)) assert.equal(byId.get(id).implementation_pr, n, id);
  });

  test('design pins: A1 is #11, the A2 group is #15, C1 is #3, B1 is #1', () => {
    assert.equal(byId.get('M01-A1').design_pr, 11);
    assert.equal(byId.get('M01-A2').design_pr, 15);
    assert.equal(byId.get('M00-C1').design_pr, 3);
    assert.equal(byId.get('M00-B1').design_pr, 1);
  });

  test('the monolithic M01 leaf is gone: A1 is a leaf, A2 is a group of A2S and A2D', () => {
    assert.equal(byId.has('M01'), false);
    assert.equal(byId.get('M01-A1').kind, 'leaf');
    assert.equal(byId.get('M01-A2').kind, 'group');
    assert.deepEqual(livePlan.tasks.filter((t) => t.parent === 'M01-A2').map((t) => t.id), ['M01-A2S', 'M01-A2D']);
  });

  test('PR #5 stays ignored and #19 is the explicit combined design + implementation PR of M01-R1', () => {
    assert.deepEqual(livePlan.ignored_prs.map((p) => p.number), [5]);
    const r1 = byId.get('M01-R1');
    assert.equal(r1.design_pr, 19);
    assert.equal(r1.implementation_pr, 19);
    assert.equal(r1.combined_design_implementation, true);
    assert.deepEqual(livePlan.tasks.filter((t) => t.combined_design_implementation).map((t) => t.id), ['M01-R1']);
  });
});

describe('resolved state with the merged history and draft PR #19', () => {
  const r = resolve([...realHistory(), draft19()]);

  test('every merged, green task is DONE and the A2 group rolls up', () => {
    for (const id of ['M00-B1', 'M00-C1', 'M00-C1A0', 'M00-C1A1', 'M00-C1B', 'M00-C1C', 'M01-A1', 'M01-A2', 'M01-A2S', 'M01-A2D']) {
      assert.equal(stateOf(r, id), STATE.DONE, id);
    }
  });

  test('the corrective work is open and honest: draft combined PR #19 is CLAUDE_CODING, never DONE', () => {
    const repair = r.tasks.find((t) => t.id === 'M01-R1');
    assert.equal(repair.state, STATE.CLAUDE_CODING);
    assert.equal(repair.pr, 19);
  });

  test('progress is computed from leaves: M00 5/5, M01 3/4, overall 8/9 (88%, rounded down)', () => {
    const m = Object.fromEntries(r.progress.modules.map((x) => [x.id, x]));
    assert.deepEqual([m.M00.done, m.M00.total], [5, 5]);
    assert.deepEqual([m.M01.done, m.M01.total, m.M01.percent], [3, 4, 75]);
    assert.deepEqual([r.progress.overall.done, r.progress.overall.total, r.progress.overall.percent], [8, 9, 88]);
  });

  test('the dashboard focus is the repair, not a finished task', () => {
    assert.equal(r.focus.task, 'M01-R1');
  });
});

describe('a merge without a green required check on its head is not DONE', () => {
  test('A2D merged with failing checks is CI_FAILED and holds nothing else back falsely', () => {
    const pulls = realHistory().map((p) => (p.number === 17 ? { ...p, checks: checks.fail } : p));
    const r = resolve(pulls);
    assert.equal(stateOf(r, 'M01-A2D'), STATE.CI_FAILED);
    assert.equal(stateOf(r, 'M01-A2'), STATE.DESIGN_LOCKED);
    assert.equal(stateOf(r, 'M01-A2S'), STATE.DONE);
  });

  test('A2D cannot be DONE while A2S is not (merged before dependency)', () => {
    const r = resolve(realHistory().filter((p) => p.number !== 16));
    assert.notEqual(stateOf(r, 'M01-A2S'), STATE.DONE);
    assert.equal(stateOf(r, 'M01-A2D'), STATE.BLOCKED_BY_DEPENDENCY);
  });

  test('without the A1 implementation PR nothing under M01 is DONE', () => {
    const r = resolve(realHistory().filter((p) => p.number !== 12));
    assert.notEqual(stateOf(r, 'M01-A1'), STATE.DONE);
    assert.equal(stateOf(r, 'M01-A2S'), STATE.BLOCKED_BY_DEPENDENCY);
  });
});

// ---------------------------------------------------------------------------------------------
// Post-merge repair, section 6: the explicitly combined design + implementation PR.

import { validatePlan, PR_STATE } from '../../scripts/progress/resolve.mjs';

const clonePlan = () => structuredClone(livePlan);
const taskOf = (p, id) => p.tasks.find((t) => t.id === id);
const sha = (c) => String(c).repeat(40);
const reviewStatus = (head, state) => ({ context: REVIEW_CONTEXT, state, sha: head });

describe('combined PR: manifest validation', () => {
  const invalid = (mutate, pattern) => {
    const p = clonePlan();
    mutate(p);
    assert.throws(() => validatePlan(p), pattern);
  };

  test('the frozen repair plan is valid', () => {
    assert.doesNotThrow(() => validatePlan(clonePlan()));
  });

  test('the flag must be a boolean; absent or false keeps the old behaviour', () => {
    invalid((p) => { taskOf(p, 'M01-R1').combined_design_implementation = 'yes'; }, /must be true or false/);
    invalid((p) => { taskOf(p, 'M01-R1').combined_design_implementation = 1; }, /must be true or false/);
    const off = clonePlan();
    taskOf(off, 'M01-R1').combined_design_implementation = false;
    // false + equal pins is just an unflagged duplicate pin.
    assert.throws(() => validatePlan(off), /pinned twice/);
  });

  test('true needs equal, positive, integer pins on a leaf', () => {
    invalid((p) => { taskOf(p, 'M01-R1').implementation_pr = 20; }, /same positive PR number/);
    invalid((p) => { delete taskOf(p, 'M01-R1').implementation_pr; }, /same positive PR number/);
    invalid((p) => { delete taskOf(p, 'M01-R1').design_pr; }, /same positive PR number/);
    invalid((p) => { const t = taskOf(p, 'M01-R1'); t.design_pr = 0; t.implementation_pr = 0; }, /same positive PR number/);
    invalid((p) => { const t = taskOf(p, 'M01-R1'); t.design_pr = -3; t.implementation_pr = -3; }, /same positive PR number/);
    invalid((p) => { const t = taskOf(p, 'M01-R1'); t.design_pr = 1.5; t.implementation_pr = 1.5; }, /same positive PR number|must be a PR number/);
  });

  test('a combined group is rejected', () => {
    invalid((p) => { const g = taskOf(p, 'M01-A2'); g.combined_design_implementation = true; g.implementation_pr = g.design_pr; }, /only valid on a leaf/);
  });

  test('the same PR reused by ANOTHER task is rejected, flagged or not', () => {
    invalid((p) => { taskOf(p, 'M01-A2S').implementation_pr = 19; }, /pinned twice/);
    invalid((p) => { taskOf(p, 'M00-B1').design_pr = 19; }, /pinned twice/);
    invalid((p) => { const t = taskOf(p, 'M01-A2S'); t.design_pr = 50; t.implementation_pr = 50; t.combined_design_implementation = true; taskOf(p, 'M01-A2D').implementation_pr = 50; }, /pinned twice/);
  });

  test('an unflagged duplicate on an ordinary task is rejected', () => {
    invalid((p) => { const t = taskOf(p, 'M01-A2S'); t.design_pr = 16; }, /pinned twice/);
  });

  test('a pinned-and-ignored PR is still an error', () => {
    invalid((p) => { p.ignored_prs.push({ number: 19, task: 'M01-R1', reason: 'x' }); }, /both pinned and ignored/);
  });
});

describe('combined PR: lifecycle of M01-R1 (PR #19)', () => {
  const head = sha('b');
  const combinedPr = (extra = {}) => pr({ number: 19, head_sha: head, labels: [], checks: checks.pass, ...extra });
  const r1 = (pulls, plan = livePlan) => resolveProgress(plan, snapshot([...realHistory(), ...pulls])).tasks.find((t) => t.id === 'M01-R1');

  test('draft with green CI is CLAUDE_CODING, never DONE; draft with running CI too', () => {
    assert.equal(r1([combinedPr({ draft: true })]).state, STATE.CLAUDE_CODING);
    assert.equal(r1([combinedPr({ draft: true, checks: checks.running })]).state, STATE.CLAUDE_CODING);
  });

  test('failing required CI is CI_FAILED', () => {
    assert.equal(r1([combinedPr({ draft: true, checks: checks.fail })]).state, STATE.CI_FAILED);
    assert.equal(r1([combinedPr({ checks: checks.fail })]).state, STATE.CI_FAILED);
  });

  test('ready + green CI without a bound review waits for ChatGPT; ready + running CI is CI_RUNNING', () => {
    assert.equal(r1([combinedPr()]).state, STATE.WAITING_CHATGPT_REVIEW);
    assert.equal(r1([combinedPr({ checks: checks.running })]).state, STATE.CI_RUNNING);
  });

  test('valid bound reviews map to the existing states; changes-requested keeps its precedence', () => {
    const bound = (label, state) => combinedPr({ labels: [label], review_status: reviewStatus(head, state) });
    assert.equal(r1([bound('review:in-progress', 'pending')]).state, STATE.CHATGPT_REVIEW);
    assert.equal(r1([bound('review:pass', 'success')]).state, STATE.READY_TO_MERGE);
    assert.equal(r1([bound('review:changes-requested', 'failure')]).state, STATE.CHANGES_REQUESTED);
    assert.equal(r1([{ ...bound('review:changes-requested', 'failure'), draft: true }]).state, STATE.CHANGES_REQUESTED);
  });

  test('a review label whose status belongs to an OLD head (push after PASS) is ignored with attention', () => {
    const stale = combinedPr({ labels: ['review:pass'], review_status: reviewStatus(sha('9'), 'success') });
    const result = resolveProgress(livePlan, snapshot([...realHistory(), stale]));
    assert.equal(result.tasks.find((t) => t.id === 'M01-R1').state, STATE.WAITING_CHATGPT_REVIEW);
    assert.ok(result.attention.some((a) => a.code === 'REVIEW_NOT_BOUND' && a.pr === 19));
  });

  test('merged with green required checks on its own head is DONE exactly once', () => {
    const result = resolveProgress(livePlan, snapshot([...realHistory(), merged(19, 'b')]));
    const r = result.tasks.find((t) => t.id === 'M01-R1');
    assert.equal(r.state, STATE.DONE);
    assert.equal(r.pr, 19);
    // one PR row, one leaf in the totals, no attention
    assert.equal(result.prs.filter((p) => p.number === 19).length, 1);
    assert.deepEqual([result.progress.overall.done, result.progress.overall.total], [9, 9]);
    assert.deepEqual(result.attention, []);
  });

  test('merged with failing, missing or pending required checks is never DONE', () => {
    assert.equal(r1([merged(19, 'b', { checks: checks.fail })]).state, STATE.CI_FAILED);
    assert.equal(r1([merged(19, 'b', { checks: checks.none })]).state, STATE.CI_RUNNING);
    assert.equal(r1([merged(19, 'b', { checks: checks.running })]).state, STATE.CI_RUNNING);
  });

  test('closed without merge: a CANCELLED PR, the task is neither DONE nor READY_FOR_CLAUDE', () => {
    const r = r1([combinedPr({ state: 'closed', merged_at: null })]);
    assert.notEqual(r.state, STATE.DONE);
    assert.notEqual(r.state, STATE.READY_FOR_CLAUDE);
    assert.equal(r.state, STATE.PLANNED);
    const result = resolveProgress(livePlan, snapshot([...realHistory(), combinedPr({ state: 'closed', merged_at: null })]));
    assert.equal(result.prs.find((p) => p.number === 19).lifecycle, PR_STATE.CANCELLED);
  });

  test('absent from the snapshot: not ready, not done', () => {
    assert.equal(r1([]).state, STATE.PLANNED);
  });

  test('unsatisfied dependencies block even a merged combined PR', () => {
    const history = realHistory().filter((p) => p.number !== 17);
    const result = resolveProgress(livePlan, snapshot([...history, merged(19, 'b')]));
    const r = result.tasks.find((t) => t.id === 'M01-R1');
    assert.equal(r.state, STATE.BLOCKED_BY_DEPENDENCY);
    assert.ok(result.attention.some((a) => a.code === 'MERGED_BEFORE_DEPENDENCY' && a.pr === 19));
  });

  test('no double counting while open: one PR row and one leaf of weight 1', () => {
    const result = resolveProgress(livePlan, snapshot([...realHistory(), combinedPr({ draft: true })]));
    assert.equal(result.prs.filter((p) => p.number === 19).length, 1);
    assert.deepEqual([result.progress.overall.done, result.progress.overall.total], [8, 9]);
  });

  test('the OLD model fails the corrected expectation: design-only pin makes merged-green #19 READY_FOR_CLAUDE', () => {
    const old = clonePlan();
    const t = taskOf(old, 'M01-R1');
    delete t.implementation_pr;
    delete t.combined_design_implementation;
    validatePlan(old);
    const wrong = r1([merged(19, 'b')], old);
    assert.equal(wrong.state, STATE.READY_FOR_CLAUDE); // what the audit reported
    assert.equal(r1([merged(19, 'b')]).state, STATE.DONE); // the repaired result
  });
});

describe('combined PR: ordinary tasks are unchanged', () => {
  test('an ordinary leaf still waits for its separate design to merge', () => {
    const p = clonePlan();
    taskOf(p, 'M01-R1').combined_design_implementation = undefined;
    delete taskOf(p, 'M01-R1').combined_design_implementation;
    delete taskOf(p, 'M01-R1').implementation_pr;
    const draft = pr({ number: 19, draft: true, head_sha: sha('b'), checks: checks.pass });
    assert.equal(resolveProgress(p, snapshot([...realHistory(), draft])).tasks.find((t) => t.id === 'M01-R1').state, STATE.DESIGNING);
  });

  test('the frozen 2026-10-07 plan has no combined task', async () => {
    const { plan } = await import('./helpers.mjs');
    assert.equal(plan.tasks.some((t) => t.combined_design_implementation), false);
  });
});

// ---------------------------------------------------------------------------------------------
// Re-audit of 3c935b3: design lifecycle of the combined PR (P2) and null in the optional flag (P3).

describe('combined PR: design_state follows the real PR lifecycle', () => {
  const head = sha('b');
  const combinedPr = (extra = {}) => pr({ number: 19, head_sha: head, labels: [], checks: checks.pass, ...extra });
  const task = (pulls) => resolveProgress(livePlan, snapshot([...realHistory(), ...pulls])).tasks.find((t) => t.id === 'M01-R1');

  test('Draft -> DESIGNING, with the implementation state untouched', () => {
    const r = task([combinedPr({ draft: true })]);
    assert.equal(r.design_state, STATE.DESIGNING);
    assert.equal(r.design_pr, 19);
    assert.equal(r.state, STATE.CLAUDE_CODING);
  });

  test('Open, not Draft -> DESIGN_REVIEW (implementation: waiting for review, or CI)', () => {
    const r = task([combinedPr()]);
    assert.equal(r.design_state, STATE.DESIGN_REVIEW);
    assert.equal(r.state, STATE.WAITING_CHATGPT_REVIEW);
    assert.equal(task([combinedPr({ checks: checks.fail })]).design_state, STATE.DESIGN_REVIEW);
  });

  test('Merged -> DESIGN_LOCKED, and DONE only with green required checks', () => {
    const ok = task([merged(19, 'b')]);
    assert.equal(ok.design_state, STATE.DESIGN_LOCKED);
    assert.equal(ok.state, STATE.DONE);
    const red = task([merged(19, 'b', { checks: checks.fail })]);
    assert.equal(red.design_state, STATE.DESIGN_LOCKED);
    assert.equal(red.state, STATE.CI_FAILED);
  });

  test('Missing, or closed without merge -> PLANNED (design not locked, not ready for Claude)', () => {
    for (const pulls of [[], [combinedPr({ state: 'closed', merged_at: null })]]) {
      const r = task(pulls);
      assert.equal(r.design_state, STATE.PLANNED);
      assert.equal(r.state, STATE.PLANNED);
    }
  });

  test('still counted once: one PR row, one leaf, and ordinary tasks keep their own design lookup', () => {
    const result = resolveProgress(livePlan, snapshot([...realHistory(), combinedPr({ draft: true })]));
    assert.equal(result.prs.filter((p) => p.number === 19).length, 1);
    assert.equal(result.progress.overall.total, 9);
    const a2s = result.tasks.find((t) => t.id === 'M01-A2S');
    assert.equal(a2s.design_state, STATE.DESIGN_LOCKED);
    assert.equal(a2s.design_pr, 15);
  });
});

describe('combined_design_implementation: present means boolean (null included)', () => {
  const withValue = (value) => {
    const p = structuredClone(livePlan);
    p.tasks.find((t) => t.id === 'M01-R1').combined_design_implementation = value;
    return p;
  };

  for (const [label, value] of [['null', null], ['string true', 'true'], ['empty string', ''], ['zero', 0], ['one', 1], ['object', {}], ['array', []]]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => validatePlan(withValue(value)), /must be true or false/);
    });
  }

  test('rejects null on an ordinary task too, and reads null from real YAML', async () => {
    const { parseYaml } = await import('../../scripts/progress/yaml-subset.mjs');
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../../docs/progress/plan.yml', import.meta.url), 'utf8').replace(
      /(  - id: M01-A2S\n)/,
      '$1    combined_design_implementation: null\n',
    );
    assert.throws(() => validatePlan(parseYaml(text)), /M01-A2S: combined_design_implementation must be true or false/);
  });

  test('absent and false keep the old behaviour; true stays valid on the combined leaf', () => {
    assert.doesNotThrow(() => validatePlan(withValue(true)));
    const absent = structuredClone(livePlan);
    delete absent.tasks.find((t) => t.id === 'M01-A2S').combined_design_implementation;
    assert.doesNotThrow(() => validatePlan(absent));
    const falsy = structuredClone(livePlan);
    falsy.tasks.find((t) => t.id === 'M01-A2S').combined_design_implementation = false;
    assert.doesNotThrow(() => validatePlan(falsy));
  });
});
