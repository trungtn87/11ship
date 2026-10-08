import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { livePlan, checks, merged, pr, snapshot, stateOf, root } from './helpers.mjs';
import { resolveProgress, validatePlan, STATE } from '../../scripts/progress/resolve.mjs';
import { renderProgress, withPlan } from '../../scripts/progress/render.mjs';

const history = () => [1,2,3,4,6,9,10,11,12,15,16,17,19].map(n => merged(n, String(n % 10)));
const draft = number => pr({ number, draft: true, checks: checks.pass });
const current = () => resolveProgress(livePlan, snapshot([...history(), draft(14), draft(18), draft(20)]));
const byId = id => livePlan.tasks.find(t => t.id === id);

test('delivery plan preserves merged backend history and remains valid', () => {
  assert.doesNotThrow(() => validatePlan(livePlan));
  for (const [id, number] of Object.entries({'M00-B1':2,'M00-C1A0':4,'M00-C1A1':6,'M00-C1B':9,'M00-C1C':10,'M01-A1':12,'M01-A2S':16,'M01-A2D':17,'M01-R1':19})) {
    assert.equal(byId(id).implementation_pr, number);
    assert.equal(stateOf(current(), id), STATE.DONE);
  }
});
test('local belongs to M00; M01 gaps and M02 stages are represented', () => {
  for (const id of ['M00-LOCAL-RUN','M00-LOCAL-DATA','M00-LOCAL-QA','M00-LOCAL-UAT']) assert.equal(byId(id).module,'M00');
  for (const id of ['M01-B-LOGOUT','M01-B-PASSWORD','M01-B-PHONE','M01-C-SMS','M01-D-ACCESS','M01-D-2FA','M01-UI-AUTH','M01-UI-ONBOARD','M01-E2E','M01-UAT']) assert.equal(byId(id).module,'M01');
  for (const slice of ['A','B']) for (const stage of ['BE','UI','E2E','UAT']) assert.equal(byId('M02-'+slice+'-'+stage).module,'M02');
  assert.equal(livePlan.tasks.some(t => t.id.startsWith('R01')),false);
});
test('backend DONE does not mean module or Owner UAT DONE', () => {
  const r=current();
  assert.deepEqual([r.progress.overall.done,r.progress.overall.total],[9,42]);
  assert.ok(r.progress.modules.every(m => m.done < m.total));
  for (const id of ['M00-LOCAL-UAT','M01-UAT','M01-B-UAT','M01-C-UAT','M01-D-UAT','M02-A-UAT','M02-B-UAT']) assert.notEqual(stateOf(r,id),STATE.DONE,id);
  assert.equal(livePlan.roadmap_complete,false);
});
test('M02 backend is ready after its own design without waiting for local or M01 UAT', () => {
  const r=resolveProgress(livePlan,snapshot([...history(),draft(14),merged(18,'8'),draft(20)]));
  assert.equal(stateOf(r,'M02-A-BE'),STATE.READY_FOR_CLAUDE);
  for (const id of ['M00-LOCAL-UAT','M01-UI-AUTH','M01-UAT']) assert.notEqual(stateOf(r,id),STATE.DONE);
});
test('UI, E2E and UAT wait for their own predecessors', () => {
  const r=current();
  for (const id of ['M01-UI-AUTH','M01-UI-ONBOARD','M01-E2E','M01-UAT','M02-A-UI','M02-A-E2E','M02-A-UAT']) assert.equal(stateOf(r,id),STATE.BLOCKED_BY_DEPENDENCY,id);
  assert.deepEqual(byId('M01-UAT').depends_on,['M01-E2E']);
  assert.deepEqual(byId('M02-A-UAT').depends_on,['M02-A-E2E']);
});
test('even merged UAT evidence cannot bypass a missing predecessor', () => {
  const p=structuredClone(livePlan);
  p.tasks.find(t => t.id==='M01-UAT').implementation_pr=99;
  const r=resolveProgress(p,snapshot([...history(),merged(99,'9')]));
  assert.equal(stateOf(r,'M01-UAT'),STATE.BLOCKED_BY_DEPENDENCY);
  assert.ok(r.attention.some(a => a.code==='MERGED_BEFORE_DEPENDENCY'&&a.pr===99));
});
test('red backend dependency blocks M02 even when its design merged', () => {
  const pulls=history().map(p => p.number===19?{...p,checks:checks.fail}:p);
  const r=resolveProgress(livePlan,snapshot([...pulls,merged(18,'8')]));
  assert.equal(stateOf(r,'M02-A-BE'),STATE.BLOCKED_BY_DEPENDENCY);
});
test('new acceptance checklists exist', () => {
  for (const t of livePlan.tasks.filter(t => /delivery-checklist/.test(t.acceptance??''))) assert.ok(existsSync(resolve(root,t.acceptance)),t.acceptance);
});
test('dashboard renders parallel tracks and checklist links from resolved states', () => {
  const md=renderProgress(withPlan(current(),livePlan));
  assert.match(md,/Các luồng song song và checklist/);
  for (const m of ['M00','M01','M02']) assert.ok(md.includes('tasks/'+m+'-delivery-checklist.md'));
  assert.ok(md.includes('9 / 42'));
  assert.match(md,/Backend DONE không đồng nghĩa UI/);
});
