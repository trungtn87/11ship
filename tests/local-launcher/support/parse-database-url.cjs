'use strict';

// Helper for launcher.Tests.ps1 (M00-L, F03). Parses T_URL with the same parser the PostgreSQL driver uses and
// compares the result with T_PASSWORD. Prints OK, MISMATCH or MISSING; never prints the URL or the password.
const { createRequire } = require('node:module');
const path = require('node:path');

const repo = process.env.T_REPO || path.resolve(__dirname, '..', '..', '..');
let parse;
try {
  const fromRepo = createRequire(path.join(repo, 'package.json'));
  const pg = createRequire(fromRepo.resolve('pg/package.json'));
  ({ parse } = pg('pg-connection-string'));
} catch {
  process.stdout.write('MISSING');
  process.exit(0);
}

const c = parse(process.env.T_URL ?? '');
const ok =
  c.password === process.env.T_PASSWORD &&
  c.user === 'ship11_test' &&
  c.database === 'ship11_test' &&
  c.host === '127.0.0.1' &&
  String(c.port) === '5433';
process.stdout.write(ok ? 'OK' : 'MISMATCH');
