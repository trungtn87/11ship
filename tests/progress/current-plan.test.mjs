// The shipped docs/progress/plan.yml against the repository as it really is after the M00/M01 merges
// (post-merge repair, section 4). Every PR number below is the real one; nothing here marks a task done by
// hand: DONE still needs a merged PR AND a green required check on that PR's head.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProgress, STATE } from '../../scripts/progress/resolve.mjs';
import { livePlan, checks, merged, pr, snapshot, stateOf } from './helpers.mjs';

const MERGED_PRS = [1, 2, 3, 4, 6, 9, 10, 11, 12, 15, 16, 17];
const realHistory = (mergedCheck = checks.pass) =>
  MERGED_PRS.map((n) => merged(n, String(n % 10), { checks: n === 1 || n === 3 ? checks.none : mergedCheck }));
const draft19 = () => pr({ number: 19, draft: true, head_sha: 'b'.repeat(40), labels: [], checks: checks.running });
const resolve = (pulls) => resolveProgress(livePlan, snapshot(pulls));

describe('shipped plan pins the real PR numbers (nothing is matched by title or author)', () => {
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

  test('PR #5 stays ignored and #19 is pinned exactly once, as the repair task design', () => {
    assert.deepEqual(livePlan.ignored_prs.map((p) => p.number), [5]);
    assert.equal(byId.get('M01-R1').design_pr, 19);
    assert.equal(byId.get('M01-R1').implementation_pr ?? null, null);
  });
});

describe('resolved state with the merged history and draft PR #19', () => {
  const r = resolve([...realHistory(), draft19()]);

  test('every merged, green task is DONE and the A2 group rolls up', () => {
    for (const id of ['M00-B1', 'M00-C1', 'M00-C1A0', 'M00-C1A1', 'M00-C1B', 'M00-C1C', 'M01-A1', 'M01-A2', 'M01-A2S', 'M01-A2D']) {
      assert.equal(stateOf(r, id), STATE.DONE, id);
    }
  });

  test('the corrective work is open and honest: draft design PR #19 is DESIGNING, never DONE', () => {
    const repair = r.tasks.find((t) => t.id === 'M01-R1');
    assert.equal(repair.state, STATE.DESIGNING);
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
