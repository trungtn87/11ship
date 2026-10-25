import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MATRIX_PATH, evaluateAfter, evaluatePreflight, parseMatrix } from '../../scripts/deploy/check-app-compat.mjs';

const matrix = (revision, food, ship) => ({ revision, mins: { FOOD: food, SHIP: ship } });
const live = (revision, comps) => ({ contract_revision: revision, components: comps });
const comp = (min, published, ready = true) => ({ min_client_version_code: min, published_version_code: published, artifact_ready: ready });

test('the matrix file in the repository is valid', () => {
  const m = parseMatrix(JSON.parse(readFileSync(MATRIX_PATH, 'utf8')));
  assert.ok(m.revision >= 1);
});

test('a minimum above 1 needs a stated reason, and bad shapes are refused', () => {
  const base = { schema: 1, contract_revision: 2, components: { FOOD: { min_client_version_code: 5, reason: null }, SHIP: { min_client_version_code: 1, reason: null } } };
  assert.throws(() => parseMatrix(base), /must say why/);
  assert.throws(() => parseMatrix({ ...base, schema: 2 }), /schema/);
  base.components.FOOD.reason = 'Cần bản mới';
  assert.throws(() => parseMatrix({ ...base, components: { FOOD: base.components.FOOD } }), /SHIP/);
  assert.equal(parseMatrix(base).mins.FOOD, 5);
});

test('unchanged baseline minimum passes with nothing published', () => {
  const r = evaluatePreflight({ matrix: matrix(1, 1, 1), live: live(1, { FOOD: comp(1, null, false), SHIP: comp(1, null, false) }) });
  assert.equal(r.ok, true);
});

test('raising a minimum with no published APK is blocked, per app independently', () => {
  const r = evaluatePreflight({ matrix: matrix(2, 1, 40), live: live(1, { FOOD: comp(1, null, false), SHIP: comp(1, 30) }) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /SHIP: backend minimum 40 but the newest PUBLISHED APK is versionCode 30/);
  assert.doesNotMatch(r.errors.join('\n'), /FOOD/);
});

test('raising a minimum is allowed once a downloadable APK at or above it is published', () => {
  const r = evaluatePreflight({ matrix: matrix(2, 1, 40), live: live(1, { FOOD: comp(1, null, false), SHIP: comp(1, 41) }) });
  assert.equal(r.ok, true);
  assert.equal(r.rows.find((x) => x.component === 'SHIP').status, 'OK');
});

test('a published APK whose file is not downloadable does not count', () => {
  const r = evaluatePreflight({ matrix: matrix(2, 1, 40), live: live(1, { FOOD: comp(1, null, false), SHIP: comp(1, 41, false) }) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /not downloadable/);
});

test('production unreadable or an older backend without the endpoint cannot prove a breaking change', () => {
  assert.equal(evaluatePreflight({ matrix: matrix(2, 1, 40), live: null }).ok, false);
  assert.equal(evaluatePreflight({ matrix: matrix(2, 1, 40), live: { notFound: true } }).ok, false);
  assert.equal(evaluatePreflight({ matrix: matrix(1, 1, 1), live: { notFound: true } }).ok, true);
});

test('a minimum change without a new contract_revision and a rollback of the revision are refused', () => {
  const l = live(2, { FOOD: comp(1, null, false), SHIP: comp(40, 41) });
  assert.match(evaluatePreflight({ matrix: matrix(2, 1, 41), live: l }).errors.join('\n'), /without a new contract_revision/);
  assert.match(evaluatePreflight({ matrix: matrix(1, 1, 40), live: l }).errors.join('\n'), /roll the contract back/);
});

test('an already unsatisfied minimum in production is a warning, not a new block', () => {
  const r = evaluatePreflight({ matrix: matrix(2, 1, 40), live: live(2, { FOOD: comp(1, null, false), SHIP: comp(40, 30) }) });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.length === 1);
});

test('after deploy: production must serve the matrix and give a below-minimum phone a download', () => {
  const m = matrix(2, 1, 40);
  const l = live(2, { FOOD: comp(1, null, false), SHIP: comp(40, 41) });
  const good = { SHIP: { status: 'UPDATE_REQUIRED', update_available: true } };
  assert.equal(evaluateAfter({ matrix: m, live: l, checks: good }).ok, true);
  assert.equal(evaluateAfter({ matrix: m, live: l, checks: { SHIP: { status: 'UPDATE_REQUIRED_UNAVAILABLE', update_available: false } } }).ok, false);
  assert.equal(evaluateAfter({ matrix: m, live: l, checks: { SHIP: { status: 'COMPATIBLE', update_available: false } } }).ok, false);
  assert.equal(evaluateAfter({ matrix: m, live: live(1, l.components), checks: good }).ok, false);
  assert.equal(evaluateAfter({ matrix: m, live: { notFound: true }, checks: {} }).ok, false);
});
