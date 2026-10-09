// M00-D (Render Free + Supabase staging) on the dashboard. The rule under test: a merged D1 (configuration, tests,
// runbook) must never read as "deployed" or "Owner-tested". Those are separate leaves (D4, D5) that only their own
// merged evidence PRs can finish. Nothing here marks anything done by hand.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProgress, STATE, validatePlan } from '../../scripts/progress/resolve.mjs';
import { livePlan, checks, merged, pr, snapshot, stateOf, taskOf } from './helpers.mjs';

const MERGED_PRS = [1, 2, 3, 4, 6, 9, 10, 11, 12, 15, 16, 17];
const baseHistory = () =>
  MERGED_PRS.map((n) => merged(n, String(n % 10), { checks: n === 1 || n === 3 ? checks.none : checks.pass }));
const designPr = (extra = {}) => pr({ number: 22, draft: true, head_sha: 'd'.repeat(40), labels: [], checks: checks.pass, ...extra });
const d1Labels = ['agent:claude', 'type:implementation', 'module:M00-D1'];
const d1Pr = (extra = {}) => pr({ number: 23, draft: true, head_sha: 'e'.repeat(40), labels: d1Labels, checks: checks.pass, ...extra });
const resolve = (pulls) => resolveProgress(livePlan, snapshot(pulls));

describe('the M00-D entries of the shipped plan', () => {
  const byId = new Map(livePlan.tasks.map((t) => [t.id, t]));

  test('the design PR is pinned to #22 and the group holds exactly D1..D5', () => {
    assert.equal(byId.get('M00-D').design_pr, 22);
    assert.equal(byId.get('M00-D').kind, 'group');
    assert.deepEqual(livePlan.tasks.filter((t) => t.parent === 'M00-D').map((t) => t.id), ['M00-D1', 'M00-D2', 'M00-D3', 'M00-D4', 'M00-D5']);
  });

  test('implementation, remote deployment and Owner acceptance are separate leaves in a fixed chain', () => {
    assert.deepEqual(byId.get('M00-D1').depends_on, []);
    assert.deepEqual(byId.get('M00-D2').depends_on, ['M00-D1']);
    assert.deepEqual(byId.get('M00-D3').depends_on, ['M00-D1']);
    assert.deepEqual(byId.get('M00-D4').depends_on, ['M00-D2', 'M00-D3']);
    assert.deepEqual(byId.get('M00-D5').depends_on, ['M00-D4']);
  });

  test('D2 pins its approved design PR #26 and its own acceptance and evidence documents; DONE is never written by hand', () => {
    const d2 = byId.get('M00-D2');
    assert.equal(d2.design_pr, 26);
    assert.equal(d2.acceptance, 'docs/tasks/M00-D2-staging-fixtures.md');
    assert.equal(d2.evidence, 'docs/evidence/M00-D2.md');
    assert.equal(d2.requires_main_ci_green, true);
    assert.equal(d2.implementation_pr, undefined);
    assert.equal(d2.state, undefined);
    assert.equal(d2.status, undefined);
  });

  test('D1 has no pinned implementation PR (it is matched by labels), and no D leaf is a combined PR', () => {
    for (const id of ['M00-D1', 'M00-D2', 'M00-D3', 'M00-D4', 'M00-D5']) {
      assert.equal(byId.get(id).implementation_pr, undefined, id);
      assert.notEqual(byId.get(id).combined_design_implementation, true, id);
    }
  });

  test('the shipped plan stays valid', () => {
    assert.doesNotThrow(() => validatePlan(structuredClone(livePlan)));
  });
});

describe('while the design PR #22 is open', () => {
  test('the group is DESIGNING and D1 cannot be counted yet, even with a draft implementation PR', () => {
    const r = resolve([...baseHistory(), designPr(), d1Pr()]);
    assert.equal(stateOf(r, 'M00-D'), STATE.DESIGNING);
    assert.equal(stateOf(r, 'M00-D1'), STATE.DESIGNING);
    for (const id of ['M00-D2', 'M00-D3', 'M00-D4', 'M00-D5']) {
      assert.equal(stateOf(r, id), STATE.BLOCKED_BY_DEPENDENCY, id);
    }
  });
});

describe('once the design is merged', () => {
  const designMerged = () => merged(22, 'd', { labels: [] });

  test('a draft D1 implementation PR is CLAUDE_CODING and never DONE', () => {
    const r = resolve([...baseHistory(), designMerged(), d1Pr()]);
    assert.equal(stateOf(r, 'M00-D1'), STATE.CLAUDE_CODING);
    assert.equal(taskOf(r, 'M00-D1').pr, 23);
  });

  test('a merged, green D1 is DONE, but it does NOT make the backend deployed or Owner-tested', () => {
    const r = resolve([...baseHistory(), designMerged(), merged(23, 'e', { labels: d1Labels })]);
    assert.equal(stateOf(r, 'M00-D1'), STATE.DONE);
    // Remote deployment (D4) and Owner acceptance (D5) are untouched, and so is the group.
    assert.notEqual(stateOf(r, 'M00-D4'), STATE.DONE);
    assert.notEqual(stateOf(r, 'M00-D5'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-D5'), STATE.BLOCKED_BY_DEPENDENCY);
    assert.notEqual(stateOf(r, 'M00-D'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-D'), STATE.DESIGN_LOCKED);
  });

  test('only D1 counts toward progress after D1 merges: 9 of 14 leaves, never more', () => {
    const r = resolve([...baseHistory(), designMerged(), merged(23, 'e', { labels: d1Labels })]);
    assert.deepEqual([r.progress.overall.done, r.progress.overall.total], [9, 14]);
  });

  test('a merged D1 whose required check is not green is not DONE', () => {
    const r = resolve([...baseHistory(), designMerged(), merged(23, 'e', { labels: d1Labels, checks: checks.fail })]);
    assert.notEqual(stateOf(r, 'M00-D1'), STATE.DONE);
  });

  test('D4 and D5 stay open until their own evidence PRs merge, whatever D1..D3 do', () => {
    const d = (n, task, head) => merged(n, head, { labels: ['agent:claude', 'type:implementation', `module:${task}`] });
    const upToD3 = [...baseHistory(), designMerged(), merged(26, '6', { labels: [] }), d(23, 'M00-D1', 'e'), d(24, 'M00-D2', 'f'), d(25, 'M00-D3', 'a')];
    const r = resolve(upToD3);
    assert.equal(stateOf(r, 'M00-D3'), STATE.DONE);
    assert.equal(stateOf(r, 'M00-D4'), STATE.READY_FOR_CLAUDE);
    assert.equal(stateOf(r, 'M00-D5'), STATE.BLOCKED_BY_DEPENDENCY);
    const r2 = resolve([...upToD3, d(28, 'M00-D4', 'b')]);
    assert.equal(stateOf(r2, 'M00-D4'), STATE.DONE);
    assert.equal(stateOf(r2, 'M00-D5'), STATE.READY_FOR_CLAUDE);
    assert.notEqual(stateOf(r2, 'M00-D'), STATE.DONE);
  });
});

describe('the dashboard focus is not taken over by the M00-D lane', () => {
  test('the open repair (M01-R1) stays the focus while M00-D is only being designed', () => {
    const draft19 = pr({ number: 19, draft: true, head_sha: 'b'.repeat(40), labels: [], checks: checks.running });
    const r = resolve([...baseHistory(), draft19, designPr()]);
    assert.equal(r.focus.task, 'M01-R1');
  });
});

describe('M00-D2 (accounts without SMS) design gate and acceptance', () => {
  const d2Labels = ['agent:claude', 'type:implementation', 'module:M00-D2'];
  const d1Done = () => merged(23, 'e', { labels: d1Labels });
  const designMerged = () => merged(22, 'd', { labels: [] });
  const d2Design = (extra = {}) => pr({ number: 26, draft: false, head_sha: '6'.repeat(40), labels: [], checks: checks.pass, ...extra });
  const d2Impl = (extra = {}) => pr({ number: 27, draft: true, head_sha: '7'.repeat(40), labels: d2Labels, checks: checks.pass, ...extra });

  test('while design PR #26 is open D2 is in design review and its draft implementation PR cannot be DONE', () => {
    const r = resolve([...baseHistory(), designMerged(), d1Done(), d2Design(), d2Impl()]);
    assert.equal(stateOf(r, 'M00-D2'), STATE.DESIGN_REVIEW);
  });

  test('once #26 is merged a draft implementation PR is CLAUDE_CODING and never DONE', () => {
    const r = resolve([...baseHistory(), designMerged(), d1Done(), merged(26, '6', { labels: [] }), d2Impl()]);
    assert.equal(stateOf(r, 'M00-D2'), STATE.CLAUDE_CODING);
    assert.equal(taskOf(r, 'M00-D2').pr, 27);
  });

  test('a merged implementation PR with a green required check on its head is DONE', () => {
    const r = resolve([...baseHistory(), designMerged(), d1Done(), merged(26, '6', { labels: [] }), merged(27, '7', { labels: d2Labels })]);
    assert.equal(stateOf(r, 'M00-D2'), STATE.DONE);
  });

  test('a merged implementation PR whose required check failed is not DONE', () => {
    const r = resolve([...baseHistory(), designMerged(), d1Done(), merged(26, '6', { labels: [] }), merged(27, '7', { labels: d2Labels, checks: checks.fail })]);
    assert.notEqual(stateOf(r, 'M00-D2'), STATE.DONE);
  });

  test('with main CI red D2 is BLOCKED_BY_CI instead of ready, and with main green it is READY_FOR_CLAUDE (requires_main_ci_green)', () => {
    const pulls = [...baseHistory(), designMerged(), d1Done(), merged(26, '6', { labels: [] })];
    assert.equal(stateOf(resolveProgress(livePlan, snapshot(pulls, checks.fail)), 'M00-D2'), STATE.BLOCKED_BY_CI);
    assert.equal(stateOf(resolveProgress(livePlan, snapshot(pulls)), 'M00-D2'), STATE.READY_FOR_CLAUDE);
  });
});
