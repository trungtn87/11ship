#!/usr/bin/env node
// Windows Scheduled Task entrypoint: read-only worktree watcher.
// Fetches remote references and snapshots status; DOES NOT checkout, merge, commit, push or alter files.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runSync } from './sync-guard.mjs';

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--repo') throw Error('usage: node monitor-local.mjs --repo D:\\11Ship');
  return resolve(args[1]);
}
function findWorktrees(repo) {
  const r = spawnSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw Error('Cannot enumerate Git worktrees');
  const values = [];
  for (const line of r.stdout.split(/\r?\n/)) if (line.startsWith('worktree ')) values.push(line.slice(9));
  return values;
}
export function snapshot(repo) {
  const reports = [];
  for (const worktree of findWorktrees(repo)) {
    try { reports.push(runSync({ phase: 'observe', repo: worktree })); }
    catch (error) { reports.push({ root: worktree, state: 'LOCAL_UNVERIFIED', error: error.message }); }
  }
  return { collectedAt: new Date().toISOString(), reports };
}
function main() {
  const root = parseArgs(process.argv.slice(2));
  const data = snapshot(root);
  const filepath = join(root, '.11ship-local', 'ai-sync-observer.json');
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n');
  console.log('Observed ' + data.reports.length + ' local worktree(s); report saved in ignored .11ship-local directory.');
  if (data.reports.some(r => r.error)) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error('Local watcher failed: ' + error.message); process.exitCode = 2; }
}
