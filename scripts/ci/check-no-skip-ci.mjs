#!/usr/bin/env node
// Fail a pull request whose title, body or any commit message carries a CI-skip marker. On squash or
// merge such a marker would reach main and stop CI from running on it. Read-only; the PR text is data.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// [skip ci] [ci skip] [no ci] [skip actions] [actions skip] (square brackets), and skip-checks: true.
export const SKIP_TOKEN = /\[\s*(?:skip\s+ci|ci\s+skip|no\s+ci|skip\s+actions|actions\s+skip)\s*\]|skip-checks\s*:\s*true/i;

export function findSkipTokens({ title = '', body = '', commits = [] } = {}) {
  const sources = [['PR title', title], ['PR body', body], ...commits.map(({ sha, message }) => [`commit ${String(sha).slice(0, 12)}`, message])];
  return sources.filter(([, text]) => SKIP_TOKEN.test(String(text || ''))).map(([where, text]) => ({ where, match: SKIP_TOKEN.exec(String(text))[0] }));
}

const SHA = /^[0-9a-f]{40}$/i;

function main() {
  const { PR_TITLE = '', PR_BODY = '', BASE_SHA, HEAD_SHA } = process.env;
  if (!SHA.test(BASE_SHA || '') || !SHA.test(HEAD_SHA || '')) throw Error('BASE_SHA and HEAD_SHA must be full SHAs');
  const raw = execFileSync('git', ['log', '--format=%H%x1f%B%x1e', `${BASE_SHA}..${HEAD_SHA}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const commits = raw.split('\x1e').map(entry => entry.replace(/^\n+/, '')).filter(Boolean).map(entry => {
    const [sha, ...rest] = entry.split('\x1f');
    return { sha, message: rest.join('\x1f') };
  });
  const hits = findSkipTokens({ title: PR_TITLE, body: PR_BODY, commits });
  console.log(`Checked PR title, PR body and ${commits.length} commit message(s).`);
  if (!hits.length) return;
  for (const { where, match } of hits) console.error(`::error title=CI-skip marker found::${where} contains "${match}". Remove it: on merge it would stop CI from running on main.`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error('::error title=skip-ci check error::' + error.message); process.exitCode = 2; }
}
