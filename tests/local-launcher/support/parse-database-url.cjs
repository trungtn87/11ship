'use strict';

// Helper for launcher.Tests.ps1 (M00-L, F03). Parses T_URL with the same parser the PostgreSQL driver uses and
// compares the result with T_PASSWORD. Prints OK, MISMATCH or MISSING; never prints the URL or the password.
const { createRequire } = require('node:module');
const path = require('node:path');

const repo = process.env.T_REPO || path.resolve(__dirname, '..', '..', '..');
// pg-connection-string is a dependency of pg (apps/backend). Try the hoisted copy first, then resolve it from pg.
function loadParser() {
  const bases = [path.join(repo, 'package.json'), path.join(repo, 'apps', 'backend', 'package.json')];
  for (const base of bases) {
    const fromBase = createRequire(base);
    try {
      return fromBase('pg-connection-string').parse;
    } catch {
      // not hoisted next to this base; look next to pg itself
    }
    try {
      return createRequire(fromBase.resolve('pg'))('pg-connection-string').parse;
    } catch {
      // pg is not installed for this base
    }
  }
  return null;
}

const parse = loadParser();
if (typeof parse !== 'function') {
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
