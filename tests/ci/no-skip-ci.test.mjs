import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SKIP_TOKEN, findSkipTokens } from '../../scripts/ci/check-no-skip-ci.mjs';

// Tokens are assembled at runtime so this file never contains a literal marker.
const bracket = words => '[' + words + ']';
const BAD = ['skip ci', 'ci skip', 'no ci', 'skip actions', 'actions skip'].flatMap(w => [bracket(w), bracket(w.toUpperCase()), bracket(w.replace(' ', '  ')), bracket(' ' + w + ' ')]);

test('every bracketed marker is detected, in any case and spacing', () => {
  for (const token of BAD) assert.ok(SKIP_TOKEN.test(`fix: thing ${token}`), token);
  for (const token of ['skip-checks: true', 'Skip-Checks: TRUE', 'skip-checks:true']) assert.ok(SKIP_TOKEN.test(`msg\n\n${token}\n`), token);
});

test('unbracketed words, other brackets and skip-checks false are not flagged', () => {
  for (const text of ['skip ci', 'we ci skip this', 'no ci today', '[skip]', '[ci]', '[skip tests]', 'skip-checks: false', 'skip-checks', '[skipci]', '']) {
    assert.equal(SKIP_TOKEN.test(text), false, text);
  }
});

test('title, body and each commit message are checked and reported by location', () => {
  const hits = findSkipTokens({
    title: 'feat: ok',
    body: 'text\n' + bracket('Ci Skip'),
    commits: [{ sha: 'a'.repeat(40), message: 'feat: clean' }, { sha: 'b'.repeat(40), message: 'chore: x\n\nskip-checks: true' }],
  });
  assert.deepEqual(hits.map(h => h.where), ['PR body', 'commit bbbbbbbbbbbb']);
  assert.deepEqual(findSkipTokens({ title: bracket('no ci') }).map(h => h.where), ['PR title']);
  assert.deepEqual(findSkipTokens({ title: 'a', body: null, commits: [] }), []);
  assert.deepEqual(findSkipTokens(), []);
});

test('workflow is plain pull_request, read-only, and passes PR text as environment data', () => {
  const text = readFileSync(new URL('../../.github/workflows/no-skip-ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.match(text, /\n  pull_request:\n/);
  assert.ok(!/pull_request_target/.test(text));
  assert.match(text, /permissions:\n  contents: read\n/);
  assert.ok(!/: write/.test(text));
  for (const line of text.split('\n').filter(l => /^\s+run:/.test(l))) assert.ok(!line.includes('${{'), line);
});

test('update-progress pushes to main only when PROGRESS_PUBLISH is exactly true', () => {
  const text = readFileSync(new URL('../../.github/workflows/update-progress.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const step = text.slice(text.indexOf('      - name: Commit when changed'));
  assert.match(step.split('\n').slice(0, 3).join('\n'), /if: \$\{\{ vars\.PROGRESS_PUBLISH == 'true' \}\}/);
  assert.ok(text.includes('node scripts/generate-progress.mjs'), 'generator is kept');
});
