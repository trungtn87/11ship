// Shared builders for the progress tests. Plain data in, plain data out.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../../scripts/progress/yaml-subset.mjs';
import { validatePlan } from '../../scripts/progress/resolve.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// `plan` is the FROZEN plan of 2026-10-07: the snapshot-based acceptance tests describe the repository on that
// day and must not move when the live plan is corrected. `livePlan` is the shipped docs/progress/plan.yml.
export const plan = validatePlan(parseYaml(readFileSync(resolve(root, 'tests/progress/fixtures/plan-2026-10-07.yml'), 'utf8')));
export const livePlan = validatePlan(parseYaml(readFileSync(resolve(root, 'docs/progress/plan.yml'), 'utf8')));
export const REQUIRED = plan.required_checks[0];

const sha = (c) => String(c).repeat(40);

export const checks = {
  pass: [{ id: 10, name: REQUIRED, status: 'completed', conclusion: 'success' }],
  fail: [{ id: 10, name: REQUIRED, status: 'completed', conclusion: 'failure' }],
  running: [{ id: 10, name: REQUIRED, status: 'in_progress', conclusion: null }],
  none: [],
};

export function pr(overrides = {}) {
  return {
    number: 100,
    title: 'some title',
    state: 'open',
    draft: false,
    merged_at: null,
    head_sha: sha('a'),
    head_ref: 'branch',
    labels: [],
    checks: [],
    ...overrides,
  };
}

export const merged = (number, head, extra = {}) =>
  pr({ number, state: 'closed', merged_at: '2026-10-07T00:00:00Z', head_sha: sha(head), checks: checks.pass, ...extra });

/** PRs #1..#4 exactly as they are on GitHub today: merged, no labels, pinned in plan.yml. */
export const history = () => [
  merged(1, '1', { checks: checks.none }), // B1 design PR: older than CI
  merged(2, '2'), // B1 implementation
  merged(3, '3'), // C1 design
  merged(4, '4'), // C1A0 implementation
];

/** The closed-without-merge PR #5, green CI on its head, as on GitHub today. */
export const pr5 = (extra = {}) =>
  pr({ number: 5, state: 'closed', draft: true, merged_at: null, head_sha: sha('5'), checks: checks.pass, ...extra });

/** Main whose head is a normal commit that carries its own checks (the usual case). */
export const mainAt = (head, mainChecks = checks.pass) => ({ head_sha: head, ci_sha: head, skipped_progress_shas: [], checks: mainChecks });

export const snapshot = (pulls, mainChecks = checks.pass, main = mainAt(sha('c'), mainChecks)) => ({
  repo: plan.repo,
  pulls,
  main,
});

export const LABELS_C1A1 = ['agent:claude', 'type:implementation', 'module:M00-C1A1'];

export const taskOf = (result, id) => result.tasks.find((t) => t.id === id);
export const stateOf = (result, id) => taskOf(result, id).state;
export const prOf = (result, number) => result.prs.find((p) => p.number === number);
