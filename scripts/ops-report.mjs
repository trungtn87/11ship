#!/usr/bin/env node
// Reporter of the backup job and of the deploy procedure to M13 (design sections 5 and 12). It only POSTS what happened to the ingest endpoint with a
// machine credential of the matching scope (created with `npm run ops:ctl -- ingest-key create`). It runs nothing, reads no path the caller names and never
// touches a database or a deployment itself: M13 records and watches, the existing runbook procedure does the work.
//
//   OPS_INGEST_BASE        https://<host>/v1/ops/ingest
//   OPS_INGEST_TOKEN       the credential, or OPS_INGEST_TOKEN_FILE=<file holding it> (a file is preferred: it never appears in a process list)
//
//   node scripts/ops-report.mjs backup --ok [--size-bytes N] | backup --fail [--code DISK_FULL]
//   node scripts/ops-report.mjs restore-test --ok | restore-test --fail [--code X]
//   node scripts/ops-report.mjs deploy-start --component BACKEND --to 1.2.0 [--from 1.1.0] [--db-migration] [--note "..."]     (prints the deploy id)
//   node scripts/ops-report.mjs deploy-finish --id <deploy id> --status SUCCEEDED|FAILED|ROLLED_BACK [--health PASSED|FAILED] [--detail "..."] [--note "..."]

import { readFileSync } from 'node:fs';

const COMPONENTS = ['FOOD', 'SHIP', 'GATEWAY', 'WEB_ADMIN', 'BACKEND', 'M14', 'MAP_PACK'];

export class UsageError extends Error {}

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument ${a}`);
    const name = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[name] = true;
    else {
      out[name] = next;
      i += 1;
    }
  }
  return out;
}

const need = (f, name) => {
  if (typeof f[name] !== 'string' || f[name] === '') throw new UsageError(`--${name} is required`);
  return f[name];
};

/** The request each command sends (pure: no network, no clock besides the report time). */
export function buildRequest(argv, now = () => new Date()) {
  const [command, ...rest] = argv;
  const f = flags(rest);
  switch (command) {
    case 'backup':
    case 'restore-test': {
      if (f.ok === undefined && f.fail === undefined) throw new UsageError('say --ok or --fail');
      if (f.ok !== undefined && f.fail !== undefined) throw new UsageError('--ok and --fail are exclusive');
      const body = { kind: command === 'backup' ? 'BACKUP' : 'RESTORE_TEST', ok: f.ok !== undefined, finished_at: now().toISOString() };
      if (f['size-bytes'] !== undefined) {
        if (!/^\d{1,15}$/.test(String(f['size-bytes']))) throw new UsageError('--size-bytes must be a whole number');
        body.size_bytes = Number(f['size-bytes']);
      }
      if (f.code !== undefined) {
        if (!/^[A-Z0-9_]{1,32}$/.test(String(f.code))) throw new UsageError('--code must be UPPER_SNAKE_CASE');
        body.detail_code = f.code;
      }
      return { path: '/backup', body };
    }
    case 'deploy-start': {
      const component = need(f, 'component');
      if (!COMPONENTS.includes(component)) throw new UsageError('unknown --component');
      const body = { action: 'start', component, to_version: need(f, 'to'), has_db_migration: f['db-migration'] === true };
      if (f.from !== undefined) body.from_version = need(f, 'from');
      if (f.note !== undefined) body.note = need(f, 'note');
      return { path: '/deploy', body };
    }
    case 'deploy-finish': {
      const status = need(f, 'status');
      if (!['SUCCEEDED', 'FAILED', 'ROLLED_BACK'].includes(status)) throw new UsageError('--status must be SUCCEEDED, FAILED or ROLLED_BACK');
      const body = { action: 'finish', deploy_id: need(f, 'id'), status };
      if (f.health !== undefined) {
        if (f.health !== 'PASSED' && f.health !== 'FAILED') throw new UsageError('--health must be PASSED or FAILED');
        body.health_result = f.health;
      }
      if (f.detail !== undefined) body.health_detail = need(f, 'detail');
      if (f.note !== undefined) body.note = need(f, 'note');
      return { path: '/deploy', body };
    }
    default:
      throw new UsageError('commands: backup | restore-test | deploy-start | deploy-finish');
  }
}

export async function run(argv, { env = process.env, fetchFn = fetch, readFile = (p) => readFileSync(p, 'utf8'), out = (l) => console.log(l), err = (l) => console.error(l), now } = {}) {
  let request;
  try {
    request = buildRequest(argv, now);
  } catch (error) {
    err(`ops-report: ${error instanceof UsageError ? error.message : 'invalid arguments'}`);
    return 2;
  }
  const base = env.OPS_INGEST_BASE;
  let token = env.OPS_INGEST_TOKEN;
  if ((token === undefined || token === '') && env.OPS_INGEST_TOKEN_FILE) {
    try {
      token = readFile(env.OPS_INGEST_TOKEN_FILE).trim();
    } catch {
      token = undefined;
    }
  }
  if (!base || !/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base) || !token) {
    err('ops-report: set OPS_INGEST_BASE (https) and OPS_INGEST_TOKEN or OPS_INGEST_TOKEN_FILE');
    return 2;
  }
  try {
    const response = await fetchFn(`${base.replace(/\/+$/, '')}${request.path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(request.body), signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    if (response.status !== 200) {
      err(`ops-report: refused (HTTP ${response.status})`);
      return 1;
    }
    const id = JSON.parse(text)?.data?.deploy_id;
    out(id === undefined ? 'ops-report: recorded' : `ops-report: recorded; deploy id ${id}`);
    return 0;
  } catch {
    err('ops-report: the report could not be delivered (M13 unreachable); run it again when it is back');
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
