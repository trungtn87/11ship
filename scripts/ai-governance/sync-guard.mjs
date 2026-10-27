#!/usr/bin/env node
// Non-destructive local↔GitHub preflight/postflight. Node 24+; no dependencies.
// Usage: node scripts/ai-governance/sync-guard.mjs --phase preflight --repo D:\11Ship
//        node scripts/ai-governance/sync-guard.mjs --phase postflight --repo D:\11Ship
//        node scripts/ai-governance/sync-guard.mjs --phase observe --repo D:\11Ship
// --phase observe is fetch/read-only and is safe for a scheduled check. No force/reset/clean/commit.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function classifySync(ahead, behind, remoteExists) {
  if (!remoteExists) return 'LOCAL_UNVERIFIED';
  if (ahead > 0 && behind > 0) return 'DIVERGED';
  if (ahead > 0) return 'LOCAL_AHEAD';
  if (behind > 0) return 'REMOTE_AHEAD';
  return 'SYNCED';
}

export function permittedAction({ phase, branch, state, dirty, remoteVerified }) {
  // "observe" is read-only: cannot change a worktree actively used by Claude.
  if (!remoteVerified || !branch || branch === 'HEAD') return 'REPORT_ONLY';
  if (phase === 'preflight' && state === 'REMOTE_AHEAD' && !dirty) return 'FAST_FORWARD';
  if (phase === 'postflight' && state === 'LOCAL_AHEAD' && branch !== 'main' && !dirty) return 'PUSH_FAST_FORWARD';
  return 'REPORT_ONLY';
}

function git(repo, args, allowFailure = false) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
  if (r.error || (r.status !== 0 && !allowFailure)) {
    throw new Error('git command failed: ' + args[0] + ' ' + (args[1] || '') + ' (exit ' + r.status + ')');
  }
  return { ok: r.status === 0, value: (r.stdout || '').trim() };
}

export function inspect(repo, fetchResult) {
  const root = git(repo, ['rev-parse', '--show-toplevel']).value;
  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true).value || 'HEAD';
  const localSha = git(root, ['rev-parse', 'HEAD']).value;
  const changes = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']).value;
  const remoteRef = branch === 'HEAD' ? null : 'refs/remotes/origin/' + branch;
  const remoteLookup = remoteRef ? git(root, ['rev-parse', '--verify', remoteRef], true) : { ok: false };
  const remoteSha = remoteLookup.ok ? remoteLookup.value : null;
  let ahead = null, behind = null;
  if (remoteSha) {
    const parts = git(root, ['rev-list', '--left-right', '--count', 'HEAD...' + remoteRef]).value.split(/\s+/);
    [ahead, behind] = parts.map(Number);
  }
  return {
    root, branch, localSha, remoteSha, dirty: Boolean(changes),
    // Never publish filenames or secret-bearing contents in automatic reports.
    changeCount: changes ? changes.split('\n').length : 0,
    ahead, behind,
    state: classifySync(ahead, behind, Boolean(remoteSha)),
    fetchVerified: fetchResult.ok,
    fetchError: fetchResult.ok ? null : 'Remote fetch unavailable; remote refs may be stale',
  };
}

function parseArgs(args) {
  const opts = { phase: 'preflight', repo: process.cwd(), offline: false, report: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo' || a === '--phase' || a === '--report') {
      if (!args[i + 1]) throw Error(a + ' requires a value');
      opts[a.slice(2)] = args[++i];
    } else if (a === '--offline') opts.offline = true;
    else throw Error('unknown option: ' + a);
  }
  if (!['preflight', 'postflight', 'observe'].includes(opts.phase)) throw Error('invalid phase');
  return opts;
}

export function runSync(options) {
  const { repo, phase } = options;
  // Fetch is non-destructive to local checked-out files; an offline failure is not a blanket stop.
  const fetch = options.offline ? { ok: false } : git(repo, ['fetch', '--no-tags', 'origin'], true);
  const report = { phase, checkedAt: new Date().toISOString(), ...inspect(repo, fetch) };
  let action = permittedAction({
    phase, branch: report.branch, state: report.state, dirty: report.dirty,
    remoteVerified: fetch.ok && Boolean(report.remoteSha),
  });
  report.action = action;
  report.actionResult = 'NOT_APPLICABLE';
  if (action === 'FAST_FORWARD') {
    const result = git(repo, ['merge', '--ff-only', 'refs/remotes/origin/' + report.branch], true);
    report.actionResult = result.ok ? 'SUCCESS' : 'FAILED_PRESERVED';
  }
  if (action === 'PUSH_FAST_FORWARD') {
    // Pushing non-main named upstream branch only. The server rejects a non-fast-forward push.
    const result = git(repo, ['push', 'origin', 'HEAD:refs/heads/' + report.branch], true);
    report.actionResult = result.ok ? 'SUCCESS' : 'FAILED_PRESERVED';
  }
  if (report.actionResult === 'SUCCESS') {
    const checked = inspect(repo, fetch);
    Object.assign(report, {
      localSha: checked.localSha, remoteSha: checked.remoteSha,
      ahead: checked.ahead, behind: checked.behind, state: checked.state,
    });
    // After push, refresh the remote tracking ref without touching the worktree.
    if (action === 'PUSH_FAST_FORWARD') {
      const verified = git(repo, ['ls-remote', '--heads', 'origin', report.branch], true);
      const actual = verified.ok ? verified.value.split(/\s/)[0] : null;
      report.remoteSha = actual || null;
      report.state = actual === report.localSha ? 'SYNCED' : 'LOCAL_UNVERIFIED';
      report.remoteHeadVerified = actual === report.localSha;
    }
  }
  report.safeToContinueIndependentWork = true;
  report.blockedOperations = report.state === 'DIVERGED'
    ? ['Same-branch integration without conflict resolution']
    : report.state === 'LOCAL_UNVERIFIED'
      ? ['Work depending on unverified remote/local-only changes']
      : [];
  return report;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = runSync(opts);
  if (opts.report) {
    const target = resolve(opts.report);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(result, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  // Successful inspection does not assert "SYNCED". Conflict is reported, not universally fatal.
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error('Sync Guard unable to inspect repository: ' + error.message);
    process.exitCode = 2;
  }
}
