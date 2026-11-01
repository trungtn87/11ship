import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { evaluateGate } from '../../scripts/deploy/ci-gate.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const GATE = join(ROOT, 'scripts/deploy/ci-gate.mjs');

// ---- workflow policy -------------------------------------------------------------------------

// Minimal line-based split of `jobs:` into { name -> block text } (no YAML dependency is declared:
// js-yaml is only transitive). FAIL-CLOSED: anything this parser does not positively recognise throws,
// so a quoted/odd job id or unusual structure can never hide a job from the policy below.
function jobsOf(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.flatMap((line, i) => (/^jobs\s*:/.test(line) ? [i] : []));
  if (starts.length !== 1 || !/^jobs:\s*(#.*)?$/.test(lines[starts[0]])) throw Error('workflow must have exactly one plain "jobs:" mapping');
  const jobs = {};
  let current = null;
  for (const line of lines.slice(starts[0] + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
    if (/^\s*(#.*)?$/.test(line)) { if (current) jobs[current].push(line); continue; }
    if (/\t/.test(line.match(/^\s*/)[0])) throw Error('tab indentation inside jobs: is not supported: ' + line);
    const indent = line.match(/^ */)[0].length;
    if (indent === 2) {
      const key = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/.exec(line);
      if (!key) throw Error('unrecognised job key (quoted, flow-style or inline): ' + line);
      if (Object.hasOwn(jobs, key[1])) throw Error('duplicate job id: ' + key[1]);
      current = key[1]; jobs[current] = [];
    } else if (indent < 2 || current === null) {
      throw Error('unexpected indentation under jobs: ' + line);
    } else jobs[current].push(line);
  }
  if (!Object.keys(jobs).length) throw Error('no jobs recognised');
  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join('\n')]));
}

// Reaching the VPS = holding the SSH key (deploy scripts ssh internally) or calling ssh/scp/rsync directly.
const sshesToVps = block => /secrets.VPS_SSH_PRIVATE_KEY/.test(block) || /(^|[\s;&|(`])(ssh|scp|rsync|sftp)\s/m.test(block);
const needsCiGate = block => /^\s+needs:\s*(\[[^\]]*\bci-gate\b[^\]]*\]|ci-gate)\s*$/m.test(block)
  || /^\s+needs:\s*\n(\s+-\s*\S+\n)*\s+-\s*ci-gate\s*$/m.test(block);

// Read-only exceptions. Each entry must stay justified: it may not apply, push, or change state on the VPS.
const READ_ONLY_ALLOWLIST = {
  'diagnose-vps-release.yml': {
    jobs: ['diagnose'],
    reason: 'workflow_dispatch diagnosis only prints release integrity (hash compare, systemctl is-active); it applies nothing.',
    // SECURITY BOUNDARY = this pin. The whole job text (ssh command + remote script) is locked by sha256;
    // any edit fails the test until Lead + Codex re-review the read-only claim and the hash is updated.
    pinnedSha256: '9d2f6d627082c8b525dd78ca1d48abdc0ee05456813b30305ba3a2091e4ec4e7',
    // Secondary layer ONLY, NOT a security boundary (a denylist cannot prove read-only; e.g. subprocess lists,
    // open(...,'w'), docker, reboot all slip past). It only gives a friendlier hint on obvious mistakes.
    forbidden: /\b(systemctl\s+(restart|start|stop|reload|enable|disable)|rm\s|mv\s|ln\s+-s|chmod|chown|unlink|write_|os\.(remove|rename|system)|shutil|\.mkdir|tar\s+-?x|pg_|psql|python3\s+-B\s+\S*vps-update|cp\s|tee\s|>\s*\/(opt|etc|root))/,
  },
};

const jobSha256 = block => createHash('sha256').update(block.replace(/\r\n/g, '\n').trimEnd() + '\n').digest('hex');

function assertPinnedReadOnly(file, name, block, allow) {
  assert.equal(jobSha256(block), allow.pinnedSha256,
    `${file}:${name} diagnose job changed: requires Lead + Codex re-review of read-only claim, then update the pinned hash (${allow.reason})`);
  assert.doesNotMatch(block.split(/<<'PY'/).slice(1).join(''), allow.forbidden, `${file}:${name} contains an obviously state-changing command (secondary denylist)`);
}

test('diagnose read-only pin: any edit to the job fails, including state-changing calls the denylist misses', () => {
  const allow = READ_ONLY_ALLOWLIST['diagnose-vps-release.yml'];
  const block = jobsOf(readFileSync(join(WORKFLOWS, 'diagnose-vps-release.yml'), 'utf8')).diagnose;
  assert.ok(block, 'diagnose job exists');
  assertPinnedReadOnly('diagnose-vps-release.yml', 'diagnose', block, allow);
  assertPinnedReadOnly('diagnose-vps-release.yml', 'diagnose', block.replace(/\r?\n/g, '\r\n'), allow); // CRLF checkout is the same job
  const inserted = [
    "subprocess.run(['systemctl','restart','x'])",
    "open('/etc/11ship/x','w').write('1')",
    "Path('/etc/x').write_text('1')",
    "subprocess.run(['reboot'])",
    "subprocess.run(['docker','rm','x'])",
  ];
  for (const line of inserted) {
    const tampered = block.replace("          print('target: '+str(target))", `          ${line}\n          print('target: '+str(target))`);
    assert.notEqual(tampered, block, 'insertion point exists');
    assert.throws(() => assertPinnedReadOnly('diagnose-vps-release.yml', 'diagnose', tampered, allow), /diagnose job changed: requires Lead \+ Codex re-review/, line);
  }
  // A comment-only edit is also a change that needs re-review.
  assert.throws(() => assertPinnedReadOnly('diagnose-vps-release.yml', 'diagnose', block + '    # x\n', allow), /diagnose job changed/);
});

// Every job that can reach the VPS (holds the SSH key or calls ssh/scp/rsync/sftp) must need ci-gate,
// whether or not it declares an environment. Only the pinned read-only diagnose job is exempt.
function policyViolations(file, text) {
  const violations = [];
  let reaching = 0;
  for (const [name, block] of Object.entries(jobsOf(text))) {
    if (!sshesToVps(block)) continue;
    reaching += 1;
    const allow = READ_ONLY_ALLOWLIST[file];
    if (allow && allow.jobs.includes(name)) {
      try { assertPinnedReadOnly(file, name, block, allow); } catch (error) { violations.push(error.message); }
      continue;
    }
    if (!needsCiGate(block)) violations.push(`${file}:${name} can reach the VPS over ssh without "needs: ci-gate"`);
  }
  return { violations, reaching };
}

test('every job that can reach the VPS over ssh needs ci-gate (environment or not), except the pinned read-only diagnose job', () => {
  const files = readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.length > 0);
  let reaching = 0;
  for (const file of files) {
    const r = policyViolations(file, readFileSync(join(WORKFLOWS, file), 'utf8'));
    assert.deepEqual(r.violations, [], file);
    reaching += r.reaching;
  }
  assert.ok(reaching >= 2, 'expected to inspect the deploy-vps.yml and diagnose-vps-release.yml jobs');
});

test('policy negatives (in memory): ssh-capable jobs without ci-gate fail even with no environment; odd job ids fail closed', () => {
  const wf = jobs => 'name: x\non: workflow_dispatch\njobs:\n' + jobs;
  const keyNoEnv = wf('  sneaky:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n        env:\n          K: ${{ secrets.VPS_SSH_PRIVATE_KEY }}\n');
  const sshNoEnv = wf('  sneaky:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: ssh root@host reboot\n');
  const rsyncNoEnv = wf('  sneaky:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: |\n          set -e\n          rsync -a x root@host:/y\n');
  for (const text of [keyNoEnv, sshNoEnv, rsyncNoEnv]) {
    const r = policyViolations('evil.yml', text);
    assert.equal(r.violations.length, 1, text);
    assert.match(r.violations[0], /without "needs: ci-gate"/);
  }
  // Control: the same job passes once it needs ci-gate.
  assert.deepEqual(policyViolations('ok.yml', sshNoEnv.replace('    runs-on', '    needs: ci-gate\n    runs-on')).violations, []);
  // Quoted / flow-style / odd ids cannot hide a job: the parser throws.
  for (const key of ['"sneaky":', "'sneaky':", 'sneaky : ', '? sneaky']) {
    assert.throws(() => policyViolations('evil.yml', wf('  ' + key + '\n    runs-on: ubuntu-24.04\n    steps:\n      - run: ssh root@host reboot\n')), /unrecognised job key/, key);
  }
  assert.throws(() => policyViolations('evil.yml', wf('  a:\n    runs-on: x\n  a:\n    runs-on: y\n')), /duplicate job id/);
  assert.throws(() => policyViolations('evil.yml', 'name: x\njobs: { a: { runs-on: x } }\n'), /plain "jobs:"/);
  assert.throws(() => policyViolations('evil.yml', 'name: x\non: push\n'), /plain "jobs:"/);
});

test('the retired one-off recovery workflow is gone and nothing references it', () => {
  assert.ok(!readdirSync(WORKFLOWS).includes('recover-vps-6270be9.yml'));
  for (const file of readdirSync(WORKFLOWS)) assert.doesNotMatch(readFileSync(join(WORKFLOWS, file), 'utf8'), /recover-vps-6270be9|recover-6270be9\.sh/, file);
});

test('deploy-vps.yml: ci-gate runs the gate on a resolved SHA and the deploy job checks out exactly that SHA', () => {
  const text = readFileSync(join(WORKFLOWS, 'deploy-vps.yml'), 'utf8');
  const jobs = jobsOf(text);
  assert.ok(jobs['ci-gate'] && jobs.deploy);
  assert.match(jobs['ci-gate'], /outputs:\s*\n\s+sha:\s*\$\{\{\s*steps\.source\.outputs\.sha\s*\}\}/);
  assert.match(jobs['ci-gate'], /node scripts\/deploy\/ci-gate\.mjs "\$DEPLOY_SHA"/);
  assert.ok(needsCiGate(jobs.deploy), 'deploy must need ci-gate');
  assert.match(jobs.deploy, /uses:\s*actions\/checkout@v4\s*\n\s+with:\s*\n\s+ref:\s*\$\{\{\s*needs\.ci-gate\.outputs\.sha\s*\}\}/);
  assert.doesNotMatch(jobs.deploy, /ref:\s*main\b/);
});

// ---- main() exit codes via a local fake GitHub API ---------------------------------------------

const sha = n => String(n).repeat(40);
const ciRun = head => ({ status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_sha: head, path: '.github/workflows/ci.yml' });

async function withApi(handler, fn) {
  const server = http.createServer(handler);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(done => server.close(done)); }
}

function runGate(api, args, cwd = ROOT) {
  return new Promise(done => {
    const child = spawn(process.execPath, [GATE, ...args], {
      cwd, env: { ...process.env, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', GITHUB_API_URL: api },
    });
    let stderr = ''; let stdout = '';
    child.stderr.on('data', d => { stderr += d; });
    child.stdout.on('data', d => { stdout += d; });
    child.on('close', code => done({ code, stderr, stdout }));
  });
}

test('main(): a green CI run on the exact SHA exits 0 (positive control)', async () => {
  await withApi((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ workflow_runs: [ciRun(sha('a'))] })); },
    async api => { const r = await runGate(api, [sha('a')]); assert.equal(r.code, 0, r.stderr); });
});

test('main(): HTTP 4xx/5xx from the GitHub API exits 1 (fail closed)', async () => {
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await withApi((req, res) => { res.statusCode = status; res.end('{}'); }, async api => {
      const r = await runGate(api, [sha('a')]);
      assert.equal(r.code, 1, `HTTP ${status}`);
      assert.match(r.stderr, new RegExp(`GitHub API ${status}`));
    });
  }
});

test('main(): malformed JSON exits 1', async () => {
  await withApi((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{not json'); }, async api => {
    assert.equal((await runGate(api, [sha('a')])).code, 1);
  });
});

test('main(): network failure (nothing listening) exits 1', async () => {
  const probe = http.createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const dead = `http://127.0.0.1:${probe.address().port}`; await new Promise(done => probe.close(done));
  assert.equal((await runGate(dead, [sha('a')])).code, 1);
});

test('main(): missing repo/token or malformed SHA exits 1', async () => {
  const bare = await new Promise(done => {
    const env = { ...process.env }; delete env.GITHUB_TOKEN; delete env.GITHUB_REPOSITORY;
    const c = spawn(process.execPath, [GATE, sha('a')], { env }); c.on('close', code => done(code));
  });
  assert.equal(bare, 1);
  await withApi((req, res) => res.end(JSON.stringify({ workflow_runs: [] })), async api => {
    assert.equal((await runGate(api, ['main'])).code, 1);
  });
});

test('main(): a response without workflow_runs is treated as no green CI (exit 1)', async () => {
  await withApi((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}'); }, async api => {
    assert.equal((await runGate(api, [sha('a')])).code, 1);
  });
});

// ---- merge commits / first-parent, against a real git repo ---------------------------------------

test('main(): bot-subject merge commit cannot smuggle code in through its second parent (first-parent walk + full diff)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.txt'), '1'); git('add', '.'); git('commit', '-q', '-m', 'feat: code');
    const green = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'side');
    writeFileSync(join(dir, 'src.js'), 'evil'); git('add', '.'); git('commit', '-q', '-m', 'feat: side code');
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-q', 'side', '-m', 'chore(progress): update docs/PROGRESS.md');
    const merge = git('rev-parse', 'HEAD');
    assert.equal(git('rev-parse', merge + '^1'), green);
    await withApi((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ workflow_runs: req.url.includes(`head_sha=${green}`) ? [ciRun(green)] : [] }));
    }, async api => {
      const r = await runGate(api, [merge], dir);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /src\.js/);
    });
    // Control: a bot commit that only touches docs/PROGRESS.md on top of the green commit passes.
    git('reset', '-q', '--hard', green);
    mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs/PROGRESS.md'), 'x');
    git('add', 'docs/PROGRESS.md'); git('commit', '-q', '-m', 'chore(progress): update docs/PROGRESS.md');
    const bot = git('rev-parse', 'HEAD');
    await withApi((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ workflow_runs: req.url.includes(`head_sha=${green}`) ? [ciRun(green)] : [] }));
    }, async api => { const r = await runGate(api, [bot], dir); assert.equal(r.code, 0, r.stderr); });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('main(): a non-bot merge commit with no CI run of its own is refused even if its first parent is green', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'a.txt'), '1'); git('add', '.'); git('commit', '-q', '-m', 'feat: code');
    const green = git('rev-parse', 'HEAD');
    git('checkout', '-q', '-b', 'side');
    writeFileSync(join(dir, 'b.txt'), '2'); git('add', '.'); git('commit', '-q', '-m', 'feat: side');
    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-q', 'side', '-m', "Merge branch 'side'");
    const merge = git('rev-parse', 'HEAD');
    await withApi((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ workflow_runs: req.url.includes(`head_sha=${green}`) ? [ciRun(green)] : [] }));
    }, async api => { assert.equal((await runGate(api, [merge], dir)).code, 1); });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- several runs on the same SHA --------------------------------------------------------------

test('multiple runs on one SHA: ANY success on the immutable SHA suffices, even if a newer run failed/was cancelled (documented behaviour)', async () => {
  // A SHA is immutable, so a green run proves that exact code passed CI. A later failed/cancelled
  // attempt (rerun, flaky infra) does not invalidate it. Changing this policy must be a conscious decision.
  const order = [
    [ciRun(sha('a')), { ...ciRun(sha('a')), conclusion: 'failure' }],
    [{ ...ciRun(sha('a')), conclusion: 'cancelled' }, ciRun(sha('a'))],
    [{ ...ciRun(sha('a')), conclusion: 'failure' }, { ...ciRun(sha('a')), conclusion: 'cancelled' }, ciRun(sha('a'))],
  ];
  for (const runs of order) {
    const r = await evaluateGate(sha('a'), { listCiRuns: async () => runs, subject: async () => 'feat', parent: async () => null, changedFiles: async () => [] });
    assert.deepEqual([r.ok, r.via], [true, 'direct']);
  }
  // Only non-success attempts: still refused.
  const none = await evaluateGate(sha('a'), { listCiRuns: async () => [{ ...ciRun(sha('a')), conclusion: 'failure' }, { ...ciRun(sha('a')), conclusion: 'cancelled' }], subject: async () => 'feat', parent: async () => null, changedFiles: async () => [] });
  assert.equal(none.ok, false);
});
