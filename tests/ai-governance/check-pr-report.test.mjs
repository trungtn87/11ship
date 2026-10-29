import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../scripts/ai-governance/check-pr-report.mjs';

const createdAt = '2026-10-28T01:00:00Z';
const headSha = 'b'.repeat(40);
const full = [
  '<!-- 11ship-agent-report:v1 -->',
  '- Executor: CLAUDE_LOCAL',
  '- Rules-read: AGENTS.md docs/ai-governance/README.md CLAUDE.md 2026-10-28',
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
  const result = validate(full, { draft: false, createdAt, headSha });
  assert.equal(result.passed, true);
  assert.deepEqual(result.errors, []);
});
test('missing reading acknowledgement fails on new ready PR', () => {
  const result = validate(full.replace('AGENTS.md', 'OTHER.md'), { createdAt, headSha });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('|'), /Rules-read/);
});
test('cannot claim pending report or short/invalid SHA is ready', () => {
  const result = validate(full.replace('a'.repeat(40), 'abc1234').replace('Sync-postflight: 2026-10-28 pushed and verified remote', 'Sync-postflight: PENDING'), { createdAt, headSha });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('|'), /Baseline-SHA/);
  assert.match(result.errors.join('|'), /Sync-postflight/);
});
test('draft PRs may keep working and resolve report later', () => {
  const result = validate('', { draft: true, createdAt, headSha });
  assert.equal(result.passed, true);
  assert.ok(result.warnings.length);
});
test('legacy PR without marker does not break existing in-flight work', () => {
  const result = validate('', { createdAt: '2026-10-20T10:00:00Z' });
  assert.equal(result.passed, true);
  assert.equal(result.enforced, false);
});
test('pre-existing PR opting into governance still needs complete report', () => {
  const result = validate('<!-- 11ship-agent-report:v1 -->', { createdAt: '2026-10-20T10:00:00Z', headSha });
  assert.equal(result.passed, false);
});
test('unresolved material blocker fails readiness', () => {
  const result = validate(full.replace('Open-blockers: NONE', 'Open-blockers: BLOCKED by missing product decision'), { createdAt, headSha });
  assert.equal(result.passed, false);
});

test('Codex role requires specific Codex contract acknowledgment', () => {
  const changed = full.replace('CLAUDE_LOCAL', 'CODEX_CLOUD').replace(' CLAUDE.md ', ' ');
  const result = validate(changed, { createdAt, headSha });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('|'), /Codex must confirm/);
  const restored = changed.replace('docs\/ai-governance\/README.md ', 'docs/ai-governance/README.md docs/ai-governance/CODEX-EXECUTION.md ');
  assert.equal(validate(restored, { createdAt, headSha }).passed, true);
});

test('ready report must match the current trusted PR head exactly', () => {
  const staleHead = 'c'.repeat(40);
  const fabricated = 'd'.repeat(40);
  for (const reported of [staleHead, fabricated]) {
    const result = validate(full.replace(headSha, reported), { createdAt, headSha });
    assert.equal(result.passed, false);
    assert.match(result.errors.join('|'), /must match the current trusted PR head SHA/);
  }
});

test('draft mismatch remains non-blocking but ready validation requires trusted head input', () => {
  const mismatch = full.replace(headSha, 'c'.repeat(40));
  assert.equal(validate(mismatch, { draft: true, createdAt, headSha }).passed, true);
  const missingTrustedHead = validate(full, { createdAt });
  assert.equal(missingTrustedHead.passed, false);
  assert.match(missingTrustedHead.errors.join('|'), /Trusted PR head SHA/);
});

test('pull_request_target workflow executes only trusted default-branch validator code', async () => {
  const { readFile } = await import('node:fs/promises');
  const workflow = await readFile(new URL('../../.github/workflows/ai-governance.yml', import.meta.url), 'utf8');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /checkout[^\n]*pull_request\.head|ref:\s*\$\{\{[^\n]*pull_request\.head/);
});
