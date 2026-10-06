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
