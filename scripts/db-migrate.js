'use strict';

// `npm run db:migrate` — applies all pending SQL migrations (up) with node-pg-migrate.
// - Never runs automatically on server start.
// - Keeps the tool's migration lock enabled (no --no-lock).
// - Names missing variables only; never prints the DATABASE_URL value.
// - Must be started through npm so node_modules/.bin is on PATH.
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

// Developer convenience: read .env, but never for APP_ENV=test so dev credentials
// cannot leak into a test run. Variables already set in the environment are not overridden.
if (process.env.APP_ENV !== 'test' && existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch {
    console.error('db:migrate: could not read .env; continuing with the process environment.');
  }
}

// Remote databases have their own explicit path (strict TLS, separate migration credential, target confirmation).
// This local command refuses to touch them even if DATABASE_URL points somewhere remote.
if (process.env.APP_ENV === 'staging' || process.env.APP_ENV === 'production') {
  console.error('db:migrate: refused for APP_ENV=staging|production. Use "npm run db:migrate:remote" for remote databases.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('db:migrate: missing required environment variable: DATABASE_URL');
  process.exit(1);
}

const args = ['up', '--migrations-dir', 'database/migrations', ...process.argv.slice(2)];

const result = spawnSync('node-pg-migrate', args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`db:migrate: could not start node-pg-migrate (${result.error.code ?? 'UNKNOWN'}). Run it through "npm run db:migrate".`);
  process.exit(1);
}

process.exit(result.status ?? 1);
