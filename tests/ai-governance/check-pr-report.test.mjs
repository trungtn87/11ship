import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../scripts/ai-governance/check-pr-report.mjs';

const createdAt = '2026-10-28T01:00:00Z';
const full = [
  '<!-- 11ship-agent-report:v1 -->',
  '- Executor: CLAUDE_LOCAL',
  '- Rules-read: AGENTS.md docs/ai-governance/README.md 2026-10-28',
  '- Scope: #239 exact accepted behavior',
  '- Baseline-SHA: ' + 'a'.repeat(40),
  '- Sync-preflight: 2026-10-28 ahead 0 behind 0 clean local/remote verified',
  '- Scope-checklist: Passed required cases A and B',
  '- Tests: Focused test pass and CI run link',
  '- Sync-postflight: 2026-10-28 pushed and verified remote',
  '- Remote-head-SHA: ' + 'b'.repeat(40),
  '- Open-blockers: NONE',
].join('\n');

test('complete ready-to-review report passes', () => {
  const result = validate(full, { draft: false, createdAt });
  assert.equal(result.passed, true);
  assert.deepEqual(result.errors, []);
});
test('missing reading acknowledgement fails on new ready PR', () => {
  const result = validate(full.replace('AGENTS.md', 'OTHER.md'), { createdAt });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('|'), /Rules-read/);
});
test('cannot claim pending report or short/invalid SHA is ready', () => {
  const result = validate(full.replace('a'.repeat(40), 'abc1234').replace('Sync-postflight: 2026-10-28 pushed and verified remote', 'Sync-postflight: PENDING'), { createdAt });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('|'), /Baseline-SHA/);
  assert.match(result.errors.join('|'), /Sync-postflight/);
});
test('draft PRs may keep working and resolve report later', () => {
  const result = validate('', { draft: true, createdAt });
  assert.equal(result.passed, true);
  assert.ok(result.warnings.length);
});
test('legacy PR without marker does not break existing in-flight work', () => {
  const result = validate('', { createdAt: '2026-10-20T10:00:00Z' });
  assert.equal(result.passed, true);
  assert.equal(result.enforced, false);
});
test('pre-existing PR opting into governance still needs complete report', () => {
  const result = validate('<!-- 11ship-agent-report:v1 -->', { createdAt: '2026-10-20T10:00:00Z' });
  assert.equal(result.passed, false);
});
test('unresolved material blocker fails readiness', () => {
  const result = validate(full.replace('Open-blockers: NONE', 'Open-blockers: BLOCKED by missing product decision'), { createdAt });
  assert.equal(result.passed, false);
});
