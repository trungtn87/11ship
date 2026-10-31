#!/usr/bin/env node
// Fail-closed deploy gate: the deploy SHA must have a successful "CI" (ci.yml) push run on main.
// A bot `chore(progress):` commit has no CI run (it is not built); it is accepted only when it
// differs from its last non-bot ancestor, which DID pass CI, by docs/PROGRESS.md or docs/progress/* only.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CI_WORKFLOW_FILE = 'ci.yml';
export const PROGRESS_SUBJECT = /^chore\(progress\):/;
const SHA = /^[0-9a-f]{40}$/;
const MAX_WALK = 50;

export const isProgressOnlyPath = file => file === 'docs/PROGRESS.md' || /^docs\/progress\/[^/].*$/.test(file);

export const hasCiSuccess = (runs, sha) => (Array.isArray(runs) ? runs : []).some(run =>
  run && run.conclusion === 'success' && run.status === 'completed' && run.event === 'push'
  && run.head_branch === 'main' && String(run.head_sha || '').toLowerCase() === sha
  && String(run.path || '').endsWith('/' + CI_WORKFLOW_FILE));

// deps: { listCiRuns(sha) -> runs[], subject(sha) -> string, parent(sha) -> sha|null, changedFiles(from, to) -> string[] }
export async function evaluateGate(deploySha, deps) {
  const sha = String(deploySha || '').toLowerCase();
  if (!SHA.test(sha)) return { ok: false, reason: 'Deploy SHA is missing or not a full 40-character SHA: ' + deploySha };
  if (hasCiSuccess(await deps.listCiRuns(sha), sha)) return { ok: true, ciSha: sha, via: 'direct' };
  if (!PROGRESS_SUBJECT.test(await deps.subject(sha))) {
    return { ok: false, reason: `No successful CI run (ci.yml, push, main) found for ${sha}. Wait for CI to pass on this exact SHA, then rerun.` };
  }
  let cursor = sha;
  for (let i = 0; i < MAX_WALK; i += 1) {
    const parent = await deps.parent(cursor);
    if (!parent) break;
    cursor = parent;
    if (PROGRESS_SUBJECT.test(await deps.subject(cursor))) continue;
    if (!hasCiSuccess(await deps.listCiRuns(cursor), cursor)) {
      return { ok: false, reason: `Deploy SHA ${sha} is a progress-bot commit but its code ancestor ${cursor} has no successful CI run.` };
    }
    const others = (await deps.changedFiles(cursor, sha)).filter(file => !isProgressOnlyPath(file));
    if (others.length) {
      return { ok: false, reason: `Progress-bot commit ${sha} differs from CI-green ${cursor} in files other than docs/PROGRESS.md or docs/progress/*: ${others.join(', ')}` };
    }
    return { ok: true, ciSha: cursor, via: 'progress-bot' };
  }
  return { ok: false, reason: `Deploy SHA ${sha} is a progress-bot commit and no CI-checked code ancestor was found within ${MAX_WALK} commits.` };
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

async function main() {
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token, GITHUB_API_URL: api = 'https://api.github.com' } = process.env;
  const deploySha = process.argv[2] || git('rev-parse', 'HEAD');
  if (!repo || !token) throw Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const listCiRuns = async sha => {
    const url = `${api}/repos/${repo}/actions/workflows/${CI_WORKFLOW_FILE}/runs?head_sha=${sha}&event=push&branch=main&per_page=100`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } });
    if (!response.ok) throw Error(`GitHub API ${response.status} listing CI runs for ${sha}`);
    return (await response.json()).workflow_runs;
  };
  const result = await evaluateGate(deploySha, {
    listCiRuns,
    subject: sha => git('log', '-1', '--format=%s', sha),
    parent: sha => git('rev-list', '--first-parent', '--max-count=2', sha).split('\n')[1] || null,
    changedFiles: (from, to) => git('diff', '--name-only', from, to).split('\n').filter(Boolean),
  });
  if (!result.ok) {
    console.error('::error title=Deploy blocked by CI gate::' + result.reason);
    process.exitCode = 1;
    return;
  }
  console.log(`CI gate passed for ${deploySha} (CI-green SHA ${result.ciSha}, via ${result.via}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('::error title=CI gate error::' + error.message); process.exitCode = 1; });
}
