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
function splitWorkflow(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.flatMap((line, i) => (/^jobs\s*:/.test(line) ? [i] : []));
  if (starts.length !== 1 || !/^jobs:\s*(#.*)?$/.test(lines[starts[0]])) throw Error('workflow must have exactly one plain "jobs:" mapping');
  const jobs = {};
  const outside = lines.slice(0, starts[0] + 1); // everything that is not inside a job: header, on:, env:, permissions: ...
  let current = null;
  let i = starts[0] + 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // next top-level key
    if (/^\s*(#.*)?$/.test(line)) { if (current) jobs[current].push(line); else outside.push(line); continue; }
    if (/\t/.test(line.match(/^\s*/)[0])) throw Error('tab indentation inside jobs: is not supported: ' + line);
    const indent = line.match(/^ */)[0].length;
    if (indent === 2) {
      const key = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/.exec(line);
      if (!key) throw Error('unrecognised job key (quoted, flow-style or inline): ' + line);
      if (Object.hasOwn(jobs, key[1])) throw Error('duplicate job id: ' + key[1]);
      current = key[1]; jobs[current] = [];
      outside.push(line);
    } else if (indent < 2 || current === null) {
      throw Error('unexpected indentation under jobs: ' + line);
    } else jobs[current].push(line);
  }
  outside.push(...lines.slice(i));
  if (!Object.keys(jobs).length) throw Error('no jobs recognised');
  return { jobs: Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join('\n')])), outside: outside.join('\n') };
}
const jobsOf = rawText => splitWorkflow(rawText).jobs;

// Job-level properties (indent 4) only; step-level keys such as an "env: needs: ..." never count.
function jobProps(block) {
  const props = {};
  let cur = null;
  for (const line of block.split('\n')) {
    if (/^\s*(#.*)?$/.test(line)) { if (cur) props[cur].push(line); continue; }
    const indent = line.match(/^ */)[0].length;
    if (indent === 4) {
      const m = /^ {4}([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
      if (!m) throw Error('unrecognised job property: ' + line);
      if (Object.hasOwn(props, m[1])) throw Error('duplicate job property: ' + m[1]);
      cur = m[1]; props[cur] = [m[2]];
    } else if (indent > 4 && cur) props[cur].push(line);
    else throw Error('unexpected indentation in job: ' + line);
  }
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.join('\n')]));
}
const needsList = value => value.replace(/#.*$/gm, '').replace(/^\s*-\s+/gm, ' ').replace(/[[\],]/g, ' ').split(/\s+/).filter(Boolean);

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

// ---- closed topology -----------------------------------------------------------------------
// SECURITY BOUNDARY for real is the Owner's GitHub configuration: the SSH secret lives ONLY in environment
// vps-production, whose deployment branches are limited to main (optionally with a required reviewer).
// The checks below are a DETECTION layer: they keep every other workflow away from the VPS and pin the
// two places that may touch it. Nothing here proves the GitHub settings (NOT TESTED until the Owner sets them).
//
//  * Only deploy-vps.yml:deploy and diagnose-vps-release.yml:diagnose may declare an environment pointing at
//    vps-production (any spelling/case); every other workflow may declare no `environment` at all.
//  * Only those two jobs may mention VPS_* secrets/vars. No workflow may hand over the whole secrets
//    context (toJSON(secrets), secrets[...], ${{ secrets }}).
//  * No other workflow may use ssh/scp/rsync/sftp (any path), secrets: inherit, a local reusable
//    workflow/composite action, or scripts/deploy/* beyond: node build-ubuntu-artifact.mjs /
//    verify-ubuntu-artifact.mjs (offline build/verify) and node check-app-compat.mjs with --static only
//    (--live and --after make network calls and are NOT exempt).
//  * deploy-vps.yml has exactly the jobs ci-gate (pinned by sha256) and deploy (job-level needs ci-gate,
//    no always()/failure()/cancelled() in its job-level if, matched case-insensitively).
const SENSITIVE = /vps_|vps-production|\bssh\b|\bscp\b|\brsync\b|\bsftp\b|secrets:\s*inherit|uses:\s*\.\/|github-vps-|vps-diagnose|recover-6270/i;
// Whole-context secret access (the dot form secrets.NAME is fine).
const SECRETS_CONTEXT = /tojson\s*\(\s*secrets\b|\bsecrets\s*\[|\bsecrets\s*\}\}|\(\s*secrets\s*[,)]|,\s*secrets\s*[,)]/i;
const SAFE_NODE_SCRIPTS = ['check-app-compat.mjs', 'build-ubuntu-artifact.mjs', 'verify-ubuntu-artifact.mjs'];
const CI_GATE_PINNED_SHA256 = 'fb9340b2e5d610b291e788a0970792263aa127d77f3a08b325217f8b2f35343e';

function unsafeReferences(text) {
  const out = [];
  const hit = SENSITIVE.exec(text);
  if (hit) out.push(`mentions "${hit[0]}"`);
  const ctx = SECRETS_CONTEXT.exec(text);
  if (ctx) out.push(`passes the whole secrets context ("${ctx[0]}")`);
  for (const m of text.matchAll(/scripts\/deploy(?!\/)/g)) out.push(`bare scripts/deploy reference at ${m.index}`);
  for (const m of text.matchAll(/scripts\/deploy\/([^\s"']*)/g)) {
    const before = text.slice(Math.max(0, m.index - 5), m.index);
    if (before !== 'node ' || !SAFE_NODE_SCRIPTS.includes(m[1])) { out.push(`calls scripts/deploy/${m[1]} (not an allowed "node" build/verify script)`); continue; }
    if (m[1] === 'check-app-compat.mjs') {
      const rest = text.slice(m.index + m[0].length).split('\n', 1)[0];
      if (rest.trim() !== '--static') out.push(`calls check-app-compat.mjs without exactly --static ("${rest.trim()}")`);
    }
  }
  return out;
}

function deployJobViolations(block) {
  const props = jobProps(block);
  const out = [];
  if (!needsList(props.needs ?? '').includes('ci-gate')) out.push('deploy job must have a job-level needs containing ci-gate');
  if (props.if !== undefined && /\b(always|failure|cancelled)\s*\(/i.test(props.if)) out.push('deploy job-level if must not use always()/failure()/cancelled()');
  if (!/vps-production/i.test(props.environment ?? '')) out.push('deploy job must declare environment vps-production');
  return out;
}

// Owner-approved narrow exception (STORE-01 PR-A, #344): the manual Play AAB release may declare environment android-release.
// Only this exact file, job id, environment and shape pass; everything else in the file is held to the strictest rules below.
const AAB_RELEASE = { file: 'mobile-aab-release.yml', job: 'aab', environment: 'android-release', runsOn: 'ubuntu-24.04', ifRef: "github.ref == 'refs/heads/main'" };
const AAB_JOB_KEYS = ['name', 'if', 'runs-on', 'timeout-minutes', 'environment', 'steps'];

// The lines under a top-level key (up to the next line at column 0).
function blockAfter(text, key) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => new RegExp(`^${key}:\\s*(#.*)?$`).test(l));
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length && !/^\S/.test(lines[i]); i += 1) body.push(lines[i]);
  return body;
}

// The keys directly under a block (indent 2). null when anything is not a plain key (flow style, list, scalar), so it fails closed.
function childKeys(body) {
  if (body === null) return null;
  const keys = [];
  for (const line of body) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const indent = line.match(/^ */)[0].length;
    if (indent !== 2) continue;
    const m = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/.exec(line);
    if (!m) return null;
    keys.push(m[1]);
  }
  return keys;
}

function aabReleaseViolations(text, jobs) {
  const f = AAB_RELEASE.file;
  const out = [];
  const add = reason => out.push(`${f}: ${reason}`);
  const names = Object.keys(jobs);
  if (names.length !== 1 || names[0] !== AAB_RELEASE.job) add(`must have exactly the job ${AAB_RELEASE.job} (found ${names.join(', ')})`);
  if (/^---/m.test(text)) add('must be a single YAML document');
  // Anchors, aliases and merge keys can reuse or hide a value (an environment, a job, a trigger): none are allowed.
  if (/:\s*[&*][A-Za-z0-9_-]/.test(text) || /^\s*-\s*[&*][A-Za-z0-9_-]/m.test(text) || /<<\s*:/.test(text)) add('YAML anchors, aliases and merge keys are not allowed');
  if ((text.match(/^\s*environment\s*:/gm) ?? []).length !== 1) add('exactly one environment declaration is allowed');
  const triggers = childKeys(blockAfter(text, 'on'));
  if (JSON.stringify(triggers) !== JSON.stringify(['workflow_dispatch'])) add(`the only trigger is workflow_dispatch (found ${JSON.stringify(triggers)})`);
  if (/:\s*write(-all)?\b|write-all/.test(text)) add('no write permission');
  if (/\bgh\s+(workflow|api|run)\b|workflow_run|repository_dispatch|workflow_call|deploy-vps|diagnose-vps|ci-gate|\bself-hosted\b/i.test(text)) add('must not trigger or call another workflow, or use a self-hosted runner');
  if (!text.includes('if [ "$GITHUB_REF" != "refs/heads/main" ]; then')) add('a step must refuse any ref other than main');
  const job = jobs[AAB_RELEASE.job];
  if (job !== undefined) {
    const props = jobProps(job);
    const extra = Object.keys(props).filter(k => !AAB_JOB_KEYS.includes(k));
    if (extra.length) add(`job keys outside the allowlist (a reusable workflow, secrets or a second environment would show here): ${extra.join(', ')}`);
    if ((props.environment ?? '').trim() !== AAB_RELEASE.environment) add(`environment must be exactly ${AAB_RELEASE.environment}`);
    if ((props.if ?? '').trim() !== AAB_RELEASE.ifRef) add(`the job must be restricted to ${AAB_RELEASE.ifRef}`);
    if ((props['runs-on'] ?? '').trim() !== AAB_RELEASE.runsOn) add(`runs-on must be ${AAB_RELEASE.runsOn} (no self-hosted runner)`);
    out.push(...unsafeReferences(job).map(r => `${f}:${AAB_RELEASE.job} ${r}`));
  }
  return out;
}

function topologyViolations(file, text) {
  const { jobs, outside } = splitWorkflow(text);
  const out = [];
  const bad = (where, list) => list.forEach(reason => out.push(`${file}:${where} ${reason}`));
  // The one workflow-level mention allowed: deploy-vps.yml serialises runs with this concurrency group name.
  const outsideChecked = file === 'deploy-vps.yml' ? outside.replace('\n  group: vps-production-deploy\n', '\n') : outside;
  bad('(outside jobs: workflow-level env, permissions, triggers)', unsafeReferences(outsideChecked));
  // The whole secrets context is never handed over, not even in the two allowed workflows.
  if (SECRETS_CONTEXT.test(text)) out.push(`${file} passes the whole secrets context`);
  if (file === 'deploy-vps.yml') {
    if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify(['ci-gate', 'deploy'])) out.push(`${file} must have exactly the jobs ci-gate, deploy (found ${Object.keys(jobs).join(', ')})`);
    if (jobs['ci-gate'] === undefined) out.push(`${file} has no ci-gate job`);
    else if (jobSha256(jobs['ci-gate']) !== CI_GATE_PINNED_SHA256) out.push(`${file}:ci-gate job changed: requires Lead + Codex re-review of the gate, then update the pinned hash`);
    if (jobs.deploy === undefined) out.push(`${file} has no deploy job`);
    else out.push(...deployJobViolations(jobs.deploy).map(reason => `${file}:deploy ${reason}`));
  } else if (file === 'diagnose-vps-release.yml') {
    if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify(['diagnose'])) out.push(`${file} must have exactly the job diagnose (found ${Object.keys(jobs).join(', ')})`);
    const allow = READ_ONLY_ALLOWLIST[file];
    if (jobs.diagnose !== undefined) { try { assertPinnedReadOnly(file, 'diagnose', jobs.diagnose, allow); } catch (error) { out.push(error.message); } }
  } else if (file === AAB_RELEASE.file) {
    out.push(...aabReleaseViolations(text, jobs));
  } else {
    for (const [name, block] of Object.entries(jobs)) {
      bad(name, unsafeReferences(block));
      // No environment at all outside the two allowed jobs (also catches dynamic names like ${{ inputs.x }}).
      if (jobProps(block).environment !== undefined) out.push(`${file}:${name} declares an environment (only deploy-vps.yml:deploy and diagnose-vps-release.yml:diagnose may)`);
    }
  }
  return out;
}

// ---- AAB release exception: the one accepted pair, and every variant that must fail ----------------
const AAB_FILE = 'mobile-aab-release.yml';
const aabReal = () => readFileSync(join(WORKFLOWS, AAB_FILE), 'utf8').replace(/\r\n/g, '\n');
const aabMutate = (from, to) => {
  const text = aabReal();
  assert.ok(text.includes(from), `mutation anchor exists: ${JSON.stringify(from)}`);
  return text.replace(from, to);
};
// A parser that refuses the text (fail-closed throw) also counts as the guard catching it.
const failsWith = (file, text, pattern) => {
  let v;
  try { v = topologyViolations(file, text); } catch (error) { v = [String(error.message)]; }
  assert.ok(v.length > 0, `expected a violation for ${file}`);
  assert.ok(v.some(x => pattern.test(x)), `expected ${pattern} in ${JSON.stringify(v)}`);
};

test('AAB exception: the exact pair (mobile-aab-release.yml:aab, android-release, main, dispatch only) passes', () => {
  assert.deepEqual(topologyViolations(AAB_FILE, aabReal()), []);
});

test('AAB exception: any other file name keeps the old rule (environment forbidden)', () => {
  for (const name of ['mobile-aab-release.yaml', 'mobile-aab-release-copy.yml', 'Mobile-AAB-Release.yml', 'mobile-aab.yml']) {
    failsWith(name, aabReal(), /declares an environment/);
  }
});

test('AAB exception: a renamed or extra job, or a second job with the environment, fails', () => {
  failsWith(AAB_FILE, aabMutate('\n  aab:\n', '\n  release:\n'), /must have exactly the job aab/);
  // a second job that also declares the environment, even when the first one is correct
  failsWith(AAB_FILE, aabReal() + '\n  second:\n    runs-on: ubuntu-24.04\n    environment: android-release\n    steps:\n      - run: echo hi\n', /must have exactly the job aab|exactly one environment/);
});

test('AAB exception: a different environment name fails, however it is spelled', () => {
  for (const env of ['vps-production', 'android-release-x', 'Android-Release', '"android-release"', "'android-release'", 'ANDROID-RELEASE']) {
    failsWith(AAB_FILE, aabMutate('environment: android-release', `environment: ${env}`), /environment must be exactly android-release|vps-production/);
  }
});

test('AAB exception: any trigger besides workflow_dispatch fails (push, pull_request, schedule, flow style)', () => {
  for (const trig of ['push', 'pull_request', 'pull_request_target', 'schedule', 'workflow_call', 'release', 'repository_dispatch']) {
    failsWith(AAB_FILE, aabMutate('on:\n  workflow_dispatch:', `on:\n  ${trig}:\n  workflow_dispatch:`), /only trigger is workflow_dispatch/);
  }
  failsWith(AAB_FILE, aabMutate('on:\n  workflow_dispatch:', 'on: [push, workflow_dispatch]'), /only trigger is workflow_dispatch/);
  failsWith(AAB_FILE, aabMutate('on:\n  workflow_dispatch:', 'on: workflow_dispatch'), /only trigger is workflow_dispatch/);
});

test('AAB exception: the main-branch restriction must be in the job itself, not only in a step', () => {
  failsWith(AAB_FILE, aabMutate("    if: github.ref == 'refs/heads/main'\n", ''), /restricted to github\.ref == 'refs\/heads\/main'/);
  failsWith(AAB_FILE, aabMutate("    if: github.ref == 'refs/heads/main'", "    if: github.ref != ''"), /restricted to/);
  failsWith(AAB_FILE, aabMutate("    if: github.ref == 'refs/heads/main'", "    if: always() && github.ref == 'refs/heads/main'"), /restricted to/);
  // the step guard is the second layer: removing it fails too
  failsWith(AAB_FILE, aabMutate('if [ "$GITHUB_REF" != "refs/heads/main" ]; then', 'if false; then'), /refuse any ref other than main/);
});

test('AAB exception: runner must be the GitHub-hosted ubuntu image, never a self-hosted (VPS) runner', () => {
  failsWith(AAB_FILE, aabMutate('runs-on: ubuntu-24.04', 'runs-on: [self-hosted, M00-VPS-01]'), /runs-on must be ubuntu-24\.04|self-hosted|VPS/);
  failsWith(AAB_FILE, aabMutate('runs-on: ubuntu-24.04', 'runs-on: ${{ inputs.app }}'), /runs-on must be/);
});

test('AAB exception: a reusable workflow call or any extra job key (uses, secrets, needs, with) fails', () => {
  failsWith(AAB_FILE, aabMutate('    environment: android-release\n', '    environment: android-release\n    uses: ./.github/workflows/deploy-vps.yml\n'), /job keys outside the allowlist.*uses|deploy-vps/);
  failsWith(AAB_FILE, aabMutate('    environment: android-release\n', '    environment: android-release\n    secrets: inherit\n'), /job keys outside the allowlist|secrets: inherit/);
  failsWith(AAB_FILE, aabMutate('    environment: android-release\n', '    environment: android-release\n    needs: [deploy]\n'), /job keys outside the allowlist/);
});

test('AAB exception: YAML anchors, aliases and merge keys cannot reuse or hide a value', () => {
  failsWith(AAB_FILE, aabMutate('environment: android-release', 'environment: &e android-release'), /anchors, aliases/);
  failsWith(AAB_FILE, aabMutate('runs-on: ubuntu-24.04', 'runs-on: *e'), /anchors, aliases/);
  failsWith(AAB_FILE, aabMutate('    steps:\n', '    <<: {environment: vps-production}\n    steps:\n'), /anchors, aliases|vps-production/);
});

test('AAB exception: a second YAML document cannot add a job or an environment', () => {
  failsWith(AAB_FILE, aabReal() + '\n---\njobs:\n  deploy:\n    environment: vps-production\n', /single YAML document|vps-production|jobs/);
});

test('AAB exception: no VPS, SSH, deploy-script, workflow-call or secrets-context reference anywhere in the file', () => {
  const inserts = [
    ['      - run: ssh deploy@host true\n', /mentions "\bssh\b"/],
    ['      - run: scp file deploy@host:/x\n', /mentions/],
    ['      - run: rsync -a . host:/x\n', /mentions/],
    ['      - env:\n          X: ${{ secrets.VPS_SSH_KEY }}\n        run: true\n', /mentions "VPS_"/i],
    ['      - run: node scripts/deploy/vps-update.mjs\n', /calls scripts\/deploy\/vps-update/],
    ['      - run: node scripts/deploy/check-app-compat.mjs --live\n', /check-app-compat\.mjs without exactly --static/],
    ['      - run: gh workflow run deploy-vps.yml\n', /must not trigger or call another workflow/],
    ['      - run: gh api repos/x/y/actions/workflows\n', /must not trigger or call another workflow/],
    ['      - uses: ./.github/actions/deploy\n', /mentions/],
    ['      - env: ${{ toJSON(secrets) }}\n        run: true\n', /passes the whole secrets context/],
  ];
  for (const [line, pattern] of inserts) {
    const text = aabReal().replace('\n    steps:\n', `\n    steps:\n${line}`);
    assert.notEqual(text, aabReal(), 'insertion point exists');
    failsWith(AAB_FILE, text, pattern);
  }
});

test('AAB exception: a write permission or a workflow_run/repository_dispatch trigger cannot be added quietly', () => {
  failsWith(AAB_FILE, aabMutate('permissions:\n  contents: read', 'permissions:\n  contents: write'), /no write permission/);
  failsWith(AAB_FILE, aabMutate('permissions:\n  contents: read', 'permissions: write-all'), /no write permission/);
  failsWith(AAB_FILE, aabMutate('on:\n  workflow_dispatch:', 'on:\n  workflow_run:\n    workflows: [Mobile APK]\n  workflow_dispatch:'), /only trigger is workflow_dispatch/);
});

test('AAB exception: the exception is keyed to the file; the same pair under another job id in another file never passes', () => {
  // the same job text placed in a different workflow file is an ordinary workflow: the environment is forbidden there
  failsWith('mobile-apk.yml', aabReal(), /declares an environment/);
});

test('closed topology: only deploy-vps.yml:deploy and diagnose-vps-release.yml:diagnose reach the VPS; deploy is gated; every other workflow is clean', () => {
  const files = readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.includes('deploy-vps.yml') && files.includes('diagnose-vps-release.yml'));
  for (const file of files) assert.deepEqual(topologyViolations(file, readFileSync(join(WORKFLOWS, file), 'utf8')), [], file);
  // The three allowed scripts never reach the VPS (check-app-compat only over HTTPS, and only --static is exempt).
  for (const name of SAFE_NODE_SCRIPTS) assert.doesNotMatch(readFileSync(join(ROOT, 'scripts/deploy', name), 'utf8'), /vps_|\bssh\b|\bscp\b|\brsync\b|\bsftp\b/i, name);
  // No local composite actions / reusable workflows exist that could hide a VPS call.
  assert.ok(!readdirSync(join(ROOT, '.github')).includes('actions'), '.github/actions must not exist');
});

test('topology negatives (in memory): every bypass scenario fails', () => {
  const deploy = readFileSync(join(WORKFLOWS, 'deploy-vps.yml'), 'utf8').replace(/\r\n/g, '\n');
  const other = readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.deepEqual(topologyViolations('deploy-vps.yml', deploy), []);
  assert.deepEqual(topologyViolations('ci.yml', other), []);
  const mustChange = (text, from, to) => { assert.ok(text.includes(from), 'mutation anchor: ' + from); return text.replace(from, to); };
  const wf = job => 'name: x\non: workflow_dispatch\njobs:\n' + job;
  const sneaky = run => wf('  sneaky:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: ' + run + '\n');
  const expectFail = (file, text, pattern, label) => {
    const v = topologyViolations(file, text);
    assert.ok(v.length > 0 && v.some(line => pattern.test(line)), `${label}: expected ${pattern}, got ${JSON.stringify(v)}`);
  };

  // 1. "needs: ci-gate" only nested inside a step env: not a job-level needs.
  const noJobNeeds = mustChange(deploy, '  deploy:\n    needs: ci-gate\n', '  deploy:\n') + '      - run: echo\n        env:\n          needs: ci-gate\n';
  assert.deepEqual(Object.keys(splitWorkflow(deploy).jobs), ['ci-gate', 'deploy'], 'deploy is the last job');
  expectFail('deploy-vps.yml', noJobNeeds, /job-level needs containing ci-gate/, 'nested needs');
  // 2. A fake ci-gate job that does not run the real gate.
  expectFail('deploy-vps.yml', mustChange(deploy, 'run: node scripts/deploy/ci-gate.mjs "$DEPLOY_SHA"', 'run: echo ok'), /ci-gate job changed/, 'fake ci-gate');
  // 3. deploy job-level if that survives a failed gate.
  for (const cond of ['always()', 'failure()', 'cancelled()', '!cancelled()', 'Always()', 'FAILURE()', 'Cancelled()', '!CANCELLED()', 'ALWAYS ()', "github.ref == 'refs/heads/main' || always()"]) {
    expectFail('deploy-vps.yml', mustChange(deploy, "  deploy:\n    needs: ci-gate\n    if: github.ref == 'refs/heads/main'", `  deploy:\n    needs: ci-gate\n    if: ${cond}`), /must not use always/, cond);
  }
  // 4. The SSH key at workflow level, in deploy-vps.yml itself and in another workflow.
  expectFail('deploy-vps.yml', mustChange(deploy, '\npermissions:', '\nenv:\n  K: ${{ secrets.VPS_SSH_PRIVATE_KEY }}\npermissions:'), /outside jobs/, 'workflow-level key in deploy-vps');
  expectFail('evil.yml', 'name: x\non: push\nenv:\n  K: ${{ secrets.VPS_SSH_PRIVATE_KEY }}\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n', /outside jobs/, 'workflow-level key elsewhere');
  expectFail('evil.yml', sneaky('echo hi\n        env:\n          K: ${{ secrets.VPS_SSH_PRIVATE_KEY }}'), /sneaky/, 'key in another workflow job');
  // 5. The deploy script run from another workflow.
  expectFail('evil.yml', sneaky('bash scripts/deploy/github-vps-deploy.sh'), /sneaky/, 'bash deploy script');
  expectFail('evil.yml', sneaky('python3 scripts/deploy/vps-update.py apply'), /not an allowed/, 'vps-update');
  expectFail('evil.yml', sneaky('node ./scripts/deploy/check-app-compat.mjs'), /not an allowed/, 'relative node path');
  expectFail('evil.yml', sneaky('cd scripts/deploy && ./github-vps-deploy.sh'), /sneaky/, 'cd into scripts/deploy');
  // 6. ssh by absolute path, scp/rsync/sftp.
  for (const run of ['/usr/bin/ssh root@host reboot', 'ssh root@host', 'scp x root@host:/y', 'rsync -a x root@host:/y', 'sftp root@host']) expectFail('evil.yml', sneaky(run), /sneaky/, run);
  // 7. secrets: inherit and local reusable workflows / composite actions.
  expectFail('evil.yml', wf('  call:\n    uses: org/repo/.github/workflows/x.yml@v1\n    secrets: inherit\n'), /secrets:\s*inherit/, 'secrets inherit');
  expectFail('evil.yml', wf('  call:\n    uses: ./.github/workflows/deploy-vps.yml\n'), /uses:\s*\.\//, 'local reusable workflow');
  expectFail('evil.yml', sneaky('echo hi\n      - uses: ./.github/actions/deploy'), /uses:\s*\.\//, 'local composite action');
  // 8. Another workflow declaring the production environment (any form/case) or an environment at all,
  //    and handing over the whole secrets context, then running an arbitrary script.
  const envJob = env => wf('  sneaky:\n    runs-on: ubuntu-24.04\n' + env + '    steps:\n      - run: scripts/remote-op.sh\n');
  for (const env of ['    environment: vps-production\n', '    environment: VPS-Production\n', '    environment: { name: vps-production }\n', '    environment:\n      name: VPS-PRODUCTION\n', '    environment: ${{ inputs.target }}\n']) {
    expectFail('evil.yml', envJob(env), /sneaky/, env.trim());
  }
  expectFail('evil.yml', wf("  sneaky:\n    runs-on: ubuntu-24.04\n    environment: vps-production\n    steps:\n      - run: scripts/remote-op.sh\n        env:\n          ALL: ${{ toJSON(secrets) }}\n"), /whole secrets context/, 'toJSON(secrets)');
  for (const expr of ['${{ toJSON(secrets) }}', '${{ tojson( secrets ) }}', "${{ secrets['VPS_SSH_PRIVATE_KEY'] }}", "${{ secrets[format('{0}', 'X')] }}", '${{ secrets }}']) {
    expectFail('evil.yml', sneaky('echo ' + expr), /secrets context/, expr);
    expectFail('deploy-vps.yml', deploy + '\n# ' + expr + '\n', /whole secrets context/, 'deploy-vps ' + expr);
  }
  // 9. check-app-compat is exempt only with --static.
  for (const args of ['--live https://example.com', '--live "$ORIGIN" --after', '--after', '', '--static --live https://example.com', '"$MODE" "$ORIGIN" # --static', '--static $X', '--static # x', '--static "--live"']) {
    expectFail('evil.yml', sneaky('node scripts/deploy/check-app-compat.mjs ' + args), /without exactly --static/, 'check-app-compat ' + args);
  }
  // Controls: the offline Node scripts ci.yml uses are allowed.
  assert.deepEqual(topologyViolations('evil.yml', sneaky('node scripts/deploy/check-app-compat.mjs --static')), []);
  // Extra jobs in deploy-vps.yml are refused.
  expectFail('deploy-vps.yml', deploy + '  extra:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo\n', /exactly the jobs/, 'extra job');
});

test('parser is fail-closed: odd job ids and structures throw instead of hiding a job', () => {
  const wf = jobs => 'name: x\non: workflow_dispatch\njobs:\n' + jobs;
  for (const key of ['"sneaky":', "'sneaky':", 'sneaky : ', '? sneaky']) {
    assert.throws(() => splitWorkflow(wf('  ' + key + '\n    runs-on: ubuntu-24.04\n    steps:\n      - run: ssh root@host reboot\n')), /unrecognised job key/, key);
  }
  assert.throws(() => splitWorkflow(wf('  a:\n    runs-on: x\n  a:\n    runs-on: y\n')), /duplicate job id/);
  assert.throws(() => splitWorkflow('name: x\njobs: { a: { runs-on: x } }\n'), /plain "jobs:"/);
  assert.throws(() => splitWorkflow('name: x\non: push\n'), /plain "jobs:"/);
  assert.throws(() => jobProps('    "needs": ci-gate\n    runs-on: x'), /unrecognised job property/);
  assert.throws(() => jobProps('    needs: a\n    needs: ci-gate'), /duplicate job property/);
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
  assert.ok(needsList(jobProps(jobs.deploy).needs ?? '').includes('ci-gate'), 'deploy must need ci-gate');
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
