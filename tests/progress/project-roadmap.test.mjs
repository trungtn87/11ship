import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { livePlan, root, checks, pr, merged, snapshot } from './helpers.mjs';
import { resolveProgress, validatePlan, STATE } from '../../scripts/progress/resolve.mjs';
import { renderProgress, withPlan } from '../../scripts/progress/render.mjs';
import { collectSnapshot } from '../../scripts/progress/github.mjs';
import { ownerDecision, acceptanceValid } from '../../scripts/progress/acceptance.mjs';

const actual = JSON.parse(readFileSync(resolve(root, 'tests/progress/fixtures/live-2026-10-09-roadmap.json'), 'utf8'));
const get = (r, id) => r.tasks.find((t) => t.id === id);
const resolved = () => resolveProgress(livePlan, actual);
const sha = 'a'.repeat(40);
const leaf = (id, extra = {}) => ({ id, module: 'M01', title: id, kind: 'leaf', parent: null, order: 1, owner_role: 'CLAUDE', design_role: 'CHATGPT', review_role: 'CHATGPT', depends_on: [], ...extra });
const tiny = (tasks) => ({ schema_version: 1, project: { id: '11ship', name: '11Ship' }, repo: 'trungtn87/11ship', main_branch: 'main', owner_login: 'trungtn87', required_checks: livePlan.required_checks, modules: [{ id: 'M01', title: 'Auth', order: 1 }], tasks });

test('inventory counts modules, leaves and groups separately, preserves historical IDs and pins', () => {
  assert.deepEqual(livePlan.modules.map((m) => m.id), Array.from({ length: 13 }, (_, i) => `M${String(i).padStart(2, '0')}`));
  assert.equal(livePlan.tasks.filter((t) => t.kind === 'leaf').length, 121);
  assert.equal(livePlan.tasks.filter((t) => t.kind === 'group').length, 13);
  assert.equal(livePlan.roadmap_complete, false);
  const t = (id) => livePlan.tasks.find((x) => x.id === id);
  assert.equal(t('M00-D1').implementation_pr, 25);
  assert.equal(t('M00-D2').design_pr, 26);
  assert.equal(t('M00-D2').implementation_pr, 27);
  assert.equal(t('M02-A-BE').implementation_pr, 21);
  assert.equal(t('M03-PLAN').design_pr, 7);
  assert.equal(t('M02-B-BE').module, 'M09');
  assert.equal(t('M03-A').requires_own_design, true);
  for (const task of livePlan.tasks) assert.ok(existsSync(resolve(root, task.acceptance)), task.acceptance);
  assert.doesNotThrow(() => validatePlan(livePlan));
});

test('real merged M02 and D1 are retained; green backend never makes any whole module locked', () => {
  const r = resolved();
  assert.equal(get(r, 'M02-A-BE').state, STATE.DONE);
  assert.equal(get(r, 'M02-A-BE').implemented_pr, 21);
  assert.deepEqual(get(r, 'M02-A-BE').start_unmet, ['M01-UAT']);
  assert.equal(get(r, 'M00-D1').state, STATE.DONE);
  assert.equal(get(r, 'M00-D2').active_implementation_pr, 27);
  assert.equal(get(r, 'M00-D2').design_state, STATE.DESIGNING);
  assert.equal(get(r, 'M00-D2').state, STATE.DESIGNING);
  assert.equal(get(r, 'M03-PLAN').design_state, STATE.DESIGNING);
  assert.ok(r.module_delivery.every((m) => !m.locked));
  assert.equal(r.progress.overall.done, 11);
  assert.notEqual(get(r, 'M00-D4').state, STATE.DONE);
  assert.notEqual(get(r, 'M01-UAT').state, STATE.DONE);
});

test('start gate blocks new and in-flight work while design remains independently visible', () => {
  const p = tiny([leaf('M01-UAT', { phase: 'owner_acceptance' }), leaf('M02-NEW', { order: 2, start_after: ['M01-UAT'], design_pr: 80 })]);
  const r = resolveProgress(p, snapshot([merged(80, 'a'), pr({ number: 81, labels: ['agent:claude', 'type:implementation', 'module:M02-NEW'], checks: checks.pass })]));
  assert.equal(get(r, 'M02-NEW').state, STATE.BLOCKED_BY_DEPENDENCY);
  assert.equal(get(r, 'M02-NEW').design_state, STATE.DESIGN_LOCKED);
  assert.equal(get(r, 'M02-NEW').active_implementation_pr, 81);
  assert.deepEqual(get(r, 'M02-NEW').unmet, ['M01-UAT']);
});

test('roadmap/group outline cannot unlock a slice requiring its own design', () => {
  const p = tiny([{ ...leaf('M01-G'), kind: 'group', design_pr: 80 }, leaf('M01-SLICE', { order: 2, parent: 'M01-G', requires_own_design: true })]);
  const r = resolveProgress(p, snapshot([merged(80, 'a')]));
  assert.equal(get(r, 'M01-SLICE').state, STATE.PLANNED);
  assert.equal(get(r, 'M01-G').state, STATE.DESIGN_LOCKED);
});

test('Owner identity, exact task/head, explicit accept, newest reject and changed head fail closed', () => {
  const c = (id, body, login = 'trungtn87') => ({ id, body, user: { login } });
  const accepted = ownerDecision([c(1, `OWNER_ACCEPTED M01-UAT ${sha}`)], 'trungtn87', 'M01-UAT');
  assert.ok(acceptanceValid(accepted, 'trungtn87', 'M01-UAT', sha));
  for (const [record, task, head] of [[accepted, 'M01-OTHER', sha], [accepted, 'M01-UAT', 'b'.repeat(40)], [null, 'M01-UAT', sha]]) assert.equal(acceptanceValid(record, 'trungtn87', task, head), false);
  assert.equal(ownerDecision([c(2, `OWNER_ACCEPTED M01-UAT ${sha}`, 'someone-else')], 'trungtn87', 'M01-UAT'), null);
  assert.equal(ownerDecision([c(3, `done: true OWNER_ACCEPTED M01-UAT ${sha}`)], 'trungtn87', 'M01-UAT'), null);
  const rejected = ownerDecision([c(1, `OWNER_ACCEPTED M01-UAT ${sha}`), c(4, `OWNER_REJECTED M01-UAT ${sha}`)], 'trungtn87', 'M01-UAT');
  assert.equal(acceptanceValid(rejected, 'trungtn87', 'M01-UAT', sha), false);
});

test('CI green and evidence merged still wait for Owner; accepted exact-head evidence opens gate once', () => {
  const p = tiny([leaf('M01-UAT', { implementation_pr: 80, phase: 'owner_acceptance' })]);
  const evidence = merged(80, 'a');
  assert.equal(get(resolveProgress(p, snapshot([evidence])), 'M01-UAT').state, STATE.WAITING_OWNER_ACCEPTANCE);
  const acceptance = { task: 'M01-UAT', head_sha: sha, decision: 'OWNER_ACCEPTED', owner_login: 'trungtn87', comment_id: 1 };
  const accepted = { ...evidence, owner_acceptances: [acceptance] };
  assert.equal(get(resolveProgress(p, snapshot([accepted])), 'M01-UAT').state, STATE.DONE);
  assert.notEqual(get(resolveProgress(p, snapshot([{ ...accepted, checks: checks.fail }])), 'M01-UAT').state, STATE.DONE);
  assert.notEqual(get(resolveProgress(p, snapshot([{ ...accepted, merged_at: null, state: 'open' }])), 'M01-UAT').state, STATE.DONE);
});

test('collector reads explicit Owner decisions only on bound evidence tasks, not PR title or author', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    let value;
    if (url.includes('/pulls?')) value = [{ number: 80, title: 'DONE fake', state: 'closed', merged_at: '2026-10-09', draft: false, head: { sha, ref: 'evidence' }, labels: [] }];
    else if (url.includes('/check-runs')) value = { check_runs: checks.pass };
    else if (url.includes('/issues/80/comments')) value = [{ id: 1, body: `OWNER_ACCEPTED M01-UAT ${sha}`, user: { login: 'trungtn87' } }];
    else if (url.includes('/commits?')) value = [];
    else throw Error('unexpected URL');
    return { ok: true, json: async () => value };
  };
  const r = await collectSnapshot({ repo: 'trungtn87/11ship', mainBranch: 'main', requiredChecks: livePlan.required_checks, pinnedNumbers: [80], evidenceTasks: [{ id: 'M01-UAT', implementation_pr: 80 }], ownerLogin: 'trungtn87', token: 'test-token', fetchImpl });
  assert.equal(r.pulls[0].owner_acceptances[0].head_sha, sha);
  assert.ok(calls.some((x) => x.includes('/issues/80/comments')));
});

test('release chain keeps Figma, SMS, field/system, money/security, recovery, load, Owner and production separate', () => {
  const t = (id) => livePlan.tasks.find((x) => x.id === id);
  assert.deepEqual(t('M01-C-SMS').start_after, ['M12-FIGMA-UAT']);
  assert.ok(t('M12-SYSTEM-E2E').depends_on.includes('M01-C-UAT'));
  assert.deepEqual(t('M12-SECURITY-MONEY').depends_on, ['M12-SYSTEM-E2E']);
  assert.ok(t('M12-RESTORE').depends_on.includes('M12-SECURITY-MONEY'));
  assert.deepEqual(t('M12-LOAD').depends_on, ['M12-RESTORE']);
  assert.deepEqual(t('M12-RELEASE-UAT').depends_on, ['M12-LOAD']);
  assert.deepEqual(t('M00-OPS-RELEASE').depends_on, ['M12-RELEASE-UAT']);
});

test('module completion requires app/test/Owner phases; renderer clearly separates design, backend and gates', () => {
  const p = tiny([leaf('M01-BE', { implementation_pr: 80, phase: 'backend' })]);
  assert.equal(resolveProgress(p, snapshot([merged(80, 'a')])).module_delivery[0].locked, false);
  const text = renderProgress(withPlan(resolved(), livePlan));
  assert.match(text, /Backend \| App test \| Test tự động \| Deploy \| Owner nghiệm thu/);
  assert.match(text, /M02-A-BE/);
  assert.match(text, /Gate M01 → code mới M02/);
  assert.doesNotMatch(text, /undefined/);
});

test('invalid phases, missing Owner and gate cycles are rejected', () => {
  assert.throws(() => validatePlan(tiny([leaf('M01-X', { phase: 'fake-done' })])), /invalid phase/);
  const p = tiny([leaf('M01-UAT', { phase: 'owner_acceptance' })]); delete p.owner_login;
  assert.throws(() => validatePlan(p), /owner_login/);
  assert.throws(() => validatePlan(tiny([leaf('M01-X', { start_after: ['M01-Y'] }), leaf('M01-Y', { order: 2, depends_on: ['M01-X'] })])), /cycle/);
});
