import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, isSkippablePath } from '../../scripts/ci/ci-plan.mjs';

const pr = (files, extra = {}) => plan({ event: 'pull_request', files, ...extra });

test('draft PR runs quick checks only, whatever it touches', () => {
  assert.equal(pr(['apps/backend/src/a.ts'], { draft: true }).integration, 'none');
  assert.equal(pr(['apps/backend/src/a.ts'], { draft: true }).heavy, false);
});

test('ready PR touching only mobile/docs/root md skips integration', () => {
  assert.equal(pr(['mobile/food/lib/a.dart', 'docs/process/x.md', 'README.md']).integration, 'none');
});

test('docs/verification is not skippable (a migration test reads it)', () => {
  assert.equal(isSkippablePath('docs/verification/m01-d-admin-1c-ddl/sql/001.sql'), false);
  assert.equal(pr(['docs/verification/m01-d-admin-1c-ddl/sql/001.sql']).integration, 'ci');
});

test('one unknown path makes the whole PR a backend PR', () => {
  assert.equal(pr(['mobile/a.dart', 'apps/backend/src/a.ts']).integration, 'ci');
  assert.equal(pr(['database/migrations/1.sql']).integration, 'ci');
  assert.equal(pr(['nested/dir/notes.md']).integration, 'ci');
});

test('test infrastructure or workflow changes also run local mode', () => {
  for (const f of ['tests/integration/support/db.ts', 'jest.integration.config.js', 'package.json', 'package-lock.json', '.github/workflows/ci.yml', 'scripts/ci/ci-plan.mjs']) {
    assert.equal(pr([f]).integration, 'both', f);
  }
});

test('empty or unknown diff is fail-closed', () => {
  assert.equal(pr([]).integration, 'both');
  assert.equal(plan({}).integration, 'both');
  assert.equal(plan({ event: 'weird', files: ['docs/a.md'] }).integration, 'both');
});

test('push to main runs both modes unless proven otherwise', () => {
  assert.equal(plan({ event: 'push', files: ['apps/backend/src/a.ts'] }).integration, 'both');
  assert.equal(plan({ event: 'workflow_dispatch', files: ['docs/a.md'] }).integration, 'both');
});

test('push of a docs-only commit skips only when the parent run is green', () => {
  assert.equal(plan({ event: 'push', files: ['docs/a.md'], parentGreen: true }).integration, 'none');
  assert.equal(plan({ event: 'push', files: ['docs/a.md'], parentGreen: false }).integration, 'both');
});

test('identical tree already proven reuses the result', () => {
  const r = plan({ event: 'push', files: ['apps/backend/src/a.ts'], reuse: true });
  assert.equal(r.integration, 'none');
  assert.equal(r.heavy, true);
});

test('draft is only a PR concept: a push with draft flag still runs full', () => {
  assert.equal(plan({ event: 'push', draft: true, files: ['apps/x.ts'] }).integration, 'both');
});
