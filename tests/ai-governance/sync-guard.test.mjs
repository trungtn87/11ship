import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifySync, permittedAction } from '../../scripts/ai-governance/sync-guard.mjs';

const executable = resolve(fileURLToPath(new URL('../../scripts/ai-governance/sync-guard.mjs', import.meta.url)));
function run(program, args, cwd) {
  const r = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  assert.equal(r.status, 0, program + ' ' + args.join(' ') + '\n' + (r.stderr || ''));
  return (r.stdout || '').trim();
}
const git = (cwd, ...args) => run('git', args, cwd);
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), '11ship-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bare = join(dir, 'remote.git'), local = join(dir, 'local'), peer = join(dir, 'peer');
  git(dir, 'init', '--bare', bare);
  git(dir, 'clone', bare, local);
  git(local, 'config', 'user.name', 'Sync Test');
  git(local, 'config', 'user.email', 'sync@test.invalid');
  git(local, 'checkout', '-b', 'feature/task');
  writeFileSync(join(local, 'data.txt'), 'initial\n');
  git(local, 'add', 'data.txt');
  git(local, 'commit', '-m', 'initial');
  git(local, 'push', '-u', 'origin', 'feature/task');
  git(dir, 'clone', '-b', 'feature/task', bare, peer);
  git(peer, 'config', 'user.name', 'Peer Test');
  git(peer, 'config', 'user.email', 'peer@test.invalid');
  return { dir, bare, local, peer };
}
function guard(repo, phase, ...args) {
  const res = run(process.execPath, [executable, '--repo', repo, '--phase', phase, ...args], repo);
  return JSON.parse(res);
}
function commit(repo, text) {
  writeFileSync(join(repo, 'data.txt'), text);
  git(repo, 'add', 'data.txt');
  git(repo, 'commit', '-m', 'change');
}

test('pure status classifier and permitted actions never force on divergence', () => {
  assert.equal(classifySync(0, 0, true), 'SYNCED');
  assert.equal(classifySync(2, 0, true), 'LOCAL_AHEAD');
  assert.equal(classifySync(0, 3, true), 'REMOTE_AHEAD');
  assert.equal(classifySync(2, 3, true), 'DIVERGED');
  assert.equal(classifySync(0, 0, false), 'LOCAL_UNVERIFIED');
  assert.equal(permittedAction({ phase: 'preflight', branch: 'feature/task', state: 'REMOTE_AHEAD', dirty: false, remoteVerified: true }), 'FAST_FORWARD');
  assert.equal(permittedAction({ phase: 'postflight', branch: 'main', state: 'LOCAL_AHEAD', dirty: false, remoteVerified: true }), 'REPORT_ONLY');
  assert.equal(permittedAction({ phase: 'preflight', branch: 'feature/task', state: 'DIVERGED', dirty: false, remoteVerified: true }), 'REPORT_ONLY');
  assert.equal(permittedAction({ phase: 'preflight', branch: 'feature/task', state: 'REMOTE_AHEAD', dirty: true, remoteVerified: true }), 'REPORT_ONLY');
});
test('Claude local preflight fetches and fast-forwards safely after Codex remote push', t => {
  const { local, peer } = setup(t);
  commit(peer, 'codex change\n');
  git(peer, 'push', 'origin', 'feature/task');
  const result = guard(local, 'preflight');
  assert.equal(result.action, 'FAST_FORWARD');
  assert.equal(result.actionResult, 'SUCCESS');
  assert.equal(result.localSha, git(peer, 'rev-parse', 'HEAD'));
  assert.equal(readFileSync(join(local, 'data.txt'), 'utf8'), 'codex change\n');
});
test('Claude postflight pushes committed work to Github branch and verifies remote SHA', t => {
  const { local, peer } = setup(t);
  commit(local, 'claude change\n');
  const result = guard(local, 'postflight');
  assert.equal(result.action, 'PUSH_FAST_FORWARD');
  assert.equal(result.actionResult, 'SUCCESS');
  assert.equal(result.remoteHeadVerified, true);
  assert.equal(result.remoteSha, git(local, 'rev-parse', 'HEAD'));
  git(peer, 'fetch', 'origin');
  assert.equal(git(peer, 'rev-parse', 'origin/feature/task'), result.remoteSha);
});
test('diverged local and remote are preserved without merges or force pushes', t => {
  const { local, peer } = setup(t);
  commit(local, 'claude local-only change\n');
  const localSha = git(local, 'rev-parse', 'HEAD');
  commit(peer, 'codex remote change\n');
  git(peer, 'push', 'origin', 'feature/task');
  const pre = guard(local, 'preflight');
  const post = guard(local, 'postflight');
  assert.equal(pre.state, 'DIVERGED');
  assert.equal(pre.action, 'REPORT_ONLY');
  assert.equal(post.action, 'REPORT_ONLY');
  assert.equal(git(local, 'rev-parse', 'HEAD'), localSha);
  assert.equal(readFileSync(join(local, 'data.txt'), 'utf8'), 'claude local-only change\n');
  assert.equal(post.safeToContinueIndependentWork, true);
  assert.ok(post.blockedOperations.length);
});
test('dirty local worktree stays untouched when remote is ahead', t => {
  const { local, peer } = setup(t);
  commit(peer, 'remote file\n');
  git(peer, 'push', 'origin', 'feature/task');
  writeFileSync(join(local, 'untracked.local'), 'DO NOT DELETE\n');
  const result = guard(local, 'preflight');
  assert.equal(result.state, 'REMOTE_AHEAD');
  assert.equal(result.dirty, true);
  assert.equal(result.action, 'REPORT_ONLY');
  assert.equal(readFileSync(join(local, 'untracked.local'), 'utf8'), 'DO NOT DELETE\n');
});
test('offline/read-only observe cannot claim successful synchronization', t => {
  const { local } = setup(t);
  commit(local, 'unpublished\n');
  const offline = guard(local, 'postflight', '--offline');
  assert.equal(offline.fetchVerified, false);
  assert.equal(offline.action, 'REPORT_ONLY');
  assert.equal(offline.state, 'LOCAL_AHEAD');
  const observe = guard(local, 'observe');
  assert.equal(observe.action, 'REPORT_ONLY');
  assert.equal(observe.state, 'LOCAL_AHEAD');
});

test('deleted remote branch cannot be silently recreated by automated postflight', t => {
  const { local, peer } = setup(t);
  commit(local, 'do not resurrect branch\n');
  git(peer, 'push', 'origin', '--delete', 'feature/task');
  const report = guard(local, 'postflight');
  assert.equal(report.state, 'LOCAL_UNVERIFIED');
  assert.equal(report.action, 'REPORT_ONLY');
  assert.equal(git(local, 'rev-parse', 'HEAD').length, 40);
  assert.equal(git(local, 'show', 'HEAD:data.txt'), 'do not resurrect branch');
});
