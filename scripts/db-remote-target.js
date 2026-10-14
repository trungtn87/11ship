'use strict';

// Target contract shared by the remote operator commands (db:migrate:remote, staging:seed-fixtures) — M00-VPS-01, package A.
//
// There are two supported remote targets, chosen by the operator with DB_REMOTE_TARGET:
//   SUPABASE     (default when the variable is not set): the Supabase SESSION pooler path of M00-D1. Unchanged; its rules
//                stay in scripts/db-migrate-remote.js.
//   SELF_HOSTED  PostgreSQL 17 on the SAME machine as the service (the VinaHost VPS), staging only. Exactly one target:
//                host name localhost, port 5432, database ship11_staging, operator role ship11_migrator, runtime role
//                ship11_app, the operator typing MIGRATION_CONFIRM_TARGET=localhost:5432/ship11_staging. There is no
//                option to name another host, database or role: a different machine is a different, reviewed change.
//
// Any other selector value fails before anything connects. This module is pure (no I/O) except the one SQL text it
// exports; every problem names a variable and a rule, never a value. The TypeScript twin of these rules lives in
// apps/backend/src/admin-auth/cli/cli-target-guard.ts (the administration CLI); tests/deploy/db-remote-target-parity
// .test.mjs runs both on one case matrix, so the two guards cannot drift apart.

const SELECTOR_VARIABLE = 'DB_REMOTE_TARGET';
const TARGET_SUPABASE = 'SUPABASE';
const TARGET_SELF_HOSTED = 'SELF_HOSTED';

const SELF_HOSTED = Object.freeze({
  // Owner decision 2026-10-14: the VPS is the real operating build and keeps its data, so APP_ENV=production is accepted on
  // this ONE instance, still under the database name ship11_staging (the name does not decide the environment). Every other
  // coordinate (host, port, database, roles, TLS, typed confirmation, server-reported identity) stays exact.
  appEnvs: Object.freeze(['staging', 'production']),
  host: 'localhost',
  port: 5432,
  database: 'ship11_staging',
  migrationRole: 'ship11_migrator',
  runtimeRole: 'ship11_app',
  confirmTarget: 'localhost:5432/ship11_staging',
});

/** Returns { selector } ('SUPABASE' when unset) or { problem }. Exact, case-sensitive; an empty value is not "unset". */
function resolveRemoteTargetSelector(env) {
  const raw = env[SELECTOR_VARIABLE];
  if (raw === undefined) {
    return { selector: TARGET_SUPABASE };
  }
  if (raw === TARGET_SUPABASE || raw === TARGET_SELF_HOSTED) {
    return { selector: raw };
  }
  return { problem: `${SELECTOR_VARIABLE} must be ${TARGET_SUPABASE} or ${TARGET_SELF_HOSTED} (or not set, which means ${TARGET_SUPABASE}).` };
}

/**
 * One URL of the self-hosted path. Structural gates only (usable postgres URL, no query string or fragment, host,
 * port, database); the role name is checked by the caller so the "same role" problem can be reported first.
 * Returns { parsed } or { problem }.
 */
function checkSelfHostedUrl(raw, variable) {
  if (raw === undefined) {
    return { problem: `missing or invalid environment variable: ${variable}` };
  }
  let url;
  let database;
  let username;
  try {
    url = new URL(raw);
    database = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
  } catch {
    return { problem: `missing or invalid environment variable: ${variable}` };
  }
  if (!/^postgres(ql)?:$/.test(url.protocol) || url.hostname === '' || database === '' || username === '') {
    return { problem: `missing or invalid environment variable: ${variable}` };
  }
  // node-postgres lets URL parameters override the explicit TLS options, so a query string (or a fragment) is refused.
  if (raw.includes('?') || raw.includes('#') || url.search !== '' || url.hash !== '') {
    return { problem: `${variable} must not carry a query string or a fragment.` };
  }
  const port = url.port === '' ? SELF_HOSTED.port : Number(url.port);
  if (url.hostname !== SELF_HOSTED.host) {
    return { problem: `${variable} must use the host name ${SELF_HOSTED.host} (the server certificate names localhost; an IP address or another host is refused).` };
  }
  if (port !== SELF_HOSTED.port) {
    return { problem: `${variable} must use port ${SELF_HOSTED.port}.` };
  }
  if (database !== SELF_HOSTED.database) {
    return { problem: `${variable} must use the database ${SELF_HOSTED.database}.` };
  }
  return { parsed: { host: url.hostname, port, database, username } };
}

/**
 * The target gates of the SELF_HOSTED path. Pure; returns { problem } or
 * { kind: 'SELF_HOSTED', target, runtime, rawUrl, confirmTarget } like the Supabase branch of checkRemoteTargets.
 */
function checkSelfHostedTargets(env) {
  if (!SELF_HOSTED.appEnvs.includes(env.APP_ENV)) {
    return { problem: `${SELECTOR_VARIABLE}=${TARGET_SELF_HOSTED} is only for APP_ENV=${SELF_HOSTED.appEnvs.join(' or APP_ENV=')}.` };
  }
  const migration = checkSelfHostedUrl(env.MIGRATION_DATABASE_URL, 'MIGRATION_DATABASE_URL');
  if (migration.parsed === undefined) {
    return { problem: migration.problem };
  }
  const runtime = checkSelfHostedUrl(env.DATABASE_URL, 'DATABASE_URL');
  if (runtime.parsed === undefined) {
    return { problem: runtime.problem };
  }
  if (migration.parsed.username === runtime.parsed.username) {
    return { problem: 'MIGRATION_DATABASE_URL and DATABASE_URL use the same role. Migration and runtime credentials must differ.' };
  }
  if (migration.parsed.username !== SELF_HOSTED.migrationRole) {
    return { problem: `MIGRATION_DATABASE_URL must use the role ${SELF_HOSTED.migrationRole}.` };
  }
  if (runtime.parsed.username !== SELF_HOSTED.runtimeRole) {
    return { problem: `DATABASE_URL must use the role ${SELF_HOSTED.runtimeRole}.` };
  }
  return {
    kind: TARGET_SELF_HOSTED,
    target: migration.parsed,
    runtime: runtime.parsed,
    rawUrl: env.MIGRATION_DATABASE_URL,
    confirmTarget: SELF_HOSTED.confirmTarget,
  };
}

// What the SERVER says about the connection that is actually open (not what the URL said). Read-only. Run right after
// connecting — the connection is already TLS-verified, because the client was built with { ca, rejectUnauthorized: true } —
// and before any migration, seed or bootstrap. Keep this text identical to SELF_HOSTED_IDENTITY_SQL in cli-target-guard.ts
// (the parity test compares them).
const SELF_HOSTED_IDENTITY_SQL =
  'SELECT current_database() AS database_name, current_user AS user_name, session_user AS session_user_name, ' +
  'inet_server_port() AS server_port, ' +
  'COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls, ' +
  '(SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged';

/** Returns a fixed problem sentence (no value) or undefined when the connected identity is the self-hosted operator target. */
function selfHostedIdentityProblem(row) {
  if (row === undefined || row === null) {
    return 'refused: the server did not report the connected identity.';
  }
  if (row.database_name !== SELF_HOSTED.database) {
    return `refused: the connected database is not ${SELF_HOSTED.database}.`;
  }
  if (row.user_name !== SELF_HOSTED.migrationRole || row.session_user_name !== SELF_HOSTED.migrationRole) {
    return `refused: the connected role is not ${SELF_HOSTED.migrationRole}.`;
  }
  if (row.privileged !== false) {
    return 'refused: the connected role has an elevated attribute (superuser, createrole, createdb, replication or bypassrls).';
  }
  if (Number(row.server_port) !== SELF_HOSTED.port) {
    return `refused: the server did not answer on port ${SELF_HOSTED.port}.`;
  }
  if (row.tls !== true) {
    return 'refused: the connection is not encrypted with TLS.';
  }
  return undefined;
}

module.exports = {
  SELECTOR_VARIABLE,
  TARGET_SUPABASE,
  TARGET_SELF_HOSTED,
  SELF_HOSTED,
  SELF_HOSTED_IDENTITY_SQL,
  resolveRemoteTargetSelector,
  checkSelfHostedUrl,
  checkSelfHostedTargets,
  selfHostedIdentityProblem,
};
