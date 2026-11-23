#!/usr/bin/env node
// Decides how much of ci.yml a run needs. Pure policy in plan(); the CLI only reads facts that the workflow
// collected (event, draft flag, changed files, reuse evidence) and writes job outputs.
//
// Integration runs ONCE per run, in CI mode (the full suite with the wrong-user and remote-path fixtures).
// The former "local mode" pass is no longer run on PRs or on pushes to main (Owner decision 2026-11-21);
// it only runs for workflow_dispatch and for fail-closed cases.
//
// Fail-closed: an unknown event, or an empty or unknown diff, selects the FULL run (both integration modes).
// A run is only lighter when a rule below proves it.
// The required check "Verify (Node 24, PostgreSQL 17)" always runs and always reports; only its integration steps vary.
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Paths that cannot change what the backend integration suite exercises. docs/verification is NOT here:
// tests/integration/admin-activation-migration.int.spec.ts compares the migrations byte for byte with it.
export const isSkippablePath = file =>
  /^mobile\//.test(file)
  || /^tests\/deploy\/fixtures\/mobile-[^/]+\.golden\.json$/.test(file)
  || (/^docs\//.test(file) && !/^docs\/verification\//.test(file))
  || /^[^/]+\.md$/.test(file);

// facts: { event, draft, files, reuse, parentGreen }
//   files: changed paths (PR: base..merge ref; push: parent..commit), [] when unknown
//   reuse: an artifact proves this exact git tree already passed a full integration run
//   parentGreen: (push only) the parent commit has a successful ci.yml push run
// returns { integration: 'none' | 'ci' | 'both', heavy: boolean, reason: string }
//   'ci'   = integration once, CI mode (full suite, real fixtures)
//   'both' = CI mode plus local mode; only for workflow_dispatch and fail-closed cases
//   heavy=false also skips the self-hosted/Windows jobs, which are not required checks.
export function plan({ event, draft = false, files = [], reuse = false, parentGreen = false } = {}) {
  if (event === 'pull_request' && draft) {
    return { integration: 'none', heavy: false, reason: 'draft PR: quick checks only; the full run starts at Ready for review' };
  }
  const known = Array.isArray(files) && files.length > 0;
  if (known && files.every(isSkippablePath)) {
    if (event === 'pull_request' || (event === 'push' && parentGreen)) {
      return { integration: 'none', heavy: false, reason: 'only mobile/, docs/ (not docs/verification/) or root *.md changed' };
    }
  }
  if (reuse) {
    return { integration: 'none', heavy: true, reason: 'this exact git tree already passed the full integration run (artifact found)' };
  }
  if ((event === 'pull_request' || event === 'push') && known) {
    return { integration: 'ci', heavy: true, reason: event === 'pull_request' ? 'PR: integration once, in CI mode' : 'main push: integration once, in CI mode' };
  }
  return {
    integration: 'both',
    heavy: true,
    reason: event === 'workflow_dispatch' ? 'manual run: both modes' : 'unknown event or empty/unknown diff: both modes (fail-closed)',
  };
}

function main() {
  const flag = name => String(process.env[name] || '').toLowerCase() === 'true';
  const filesFile = process.env.CHANGED_FILES_FILE;
  let files = [];
  try { files = filesFile ? readFileSync(filesFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean) : []; } catch { files = []; }
  const result = plan({ event: process.env.EVENT_NAME, draft: flag('DRAFT'), files, reuse: flag('REUSE'), parentGreen: flag('PARENT_GREEN') });
  console.log(`CI plan: integration=${result.integration} heavy=${result.heavy} (${result.reason}); ${files.length} changed file(s)`);
  const out = process.env.GITHUB_OUTPUT;
  if (out) appendFileSync(out, `integration=${result.integration}\nheavy=${result.heavy}\nreason=${result.reason}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
