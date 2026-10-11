#!/usr/bin/env node
// Verifies a built Ubuntu artifact the way the VPS operator will use it (M00-VPS-01, gói B):
//   node scripts/deploy/verify-ubuntu-artifact.mjs <path-to-.tar.gz> <expected-40-hex-sha>
// Checks, in a fresh temporary directory: the .sha256 file matches the archive; the archive holds one top-level folder named
// after the SHA; RELEASE.json names that SHA; every MANIFEST.sha256 entry matches; no source map / .env / key file; the
// compiled application and the operator tools load from the extracted tree (the native Argon2 module really hashes and
// verifies); the Admin web is the real build (no design preview); and the operator commands refuse, with their fixed
// codes, when no target is configured. It starts no server and contacts no database.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

function fail(message) {
  process.stderr.write(`verify-ubuntu-artifact: ${message}\n`);
  process.exit(1);
}

const [archive, expectedSha] = process.argv.slice(2);
if (archive === undefined || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')) {
  fail('usage: verify-ubuntu-artifact.mjs <archive.tar.gz> <40-hex source sha>');
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const archiveName = basename(archive);
if (archiveName !== `11ship-${expectedSha}-ubuntu24-amd64.tar.gz`) {
  fail(`unexpected archive name: ${archiveName}`);
}
const sumLine = readFileSync(`${archive}.sha256`, 'utf8').trim();
if (sumLine !== `${sha256(archive)}  ${archiveName}`) {
  fail('the .sha256 file does not match the archive');
}

const work = mkdtempSync(join(tmpdir(), 'ship11-verify-'));
try {
  execFileSync('tar', ['-xzf', archive, '-C', work]);
  const top = readdirSync(work);
  if (top.length !== 1 || top[0] !== `11ship-${expectedSha}-ubuntu24-amd64`) {
    fail(`the archive must hold exactly one top-level folder named after the SHA, found: ${top.join(', ')}`);
  }
  const rel = join(work, top[0]);

  const release = JSON.parse(readFileSync(join(rel, 'RELEASE.json'), 'utf8'));
  if (release.sourceSha !== expectedSha) {
    fail('RELEASE.json names a different source SHA');
  }

  let counted = 0;
  for (const line of readFileSync(join(rel, 'MANIFEST.sha256'), 'utf8').split('\n').filter((l) => l !== '')) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (match === null || sha256(join(rel, match[2])) !== match[1]) {
      fail(`manifest mismatch: ${line.slice(66)}`);
    }
    counted += 1;
  }

  const listing = execFileSync('find', [rel, '-type', 'f'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');
  const bad = listing.filter((f) => /\.map$|\/\.env(\.|$)|\.(pem|p12|jks|keystore)$|id_rsa|id_ed25519/.test(f) && !f.includes('/node_modules/'));
  if (bad.length > 0) {
    fail(`forbidden files in the artifact: ${bad.slice(0, 5).join(', ')}`);
  }
  if (listing.some((f) => f.endsWith('.map'))) {
    fail('source maps in the artifact');
  }
  for (const needed of [
    'apps/backend/dist/main.js',
    'apps/admin-web/dist/index.html',
    'apps/admin-web/dist/js/dom/main.js',
    'database/migrations',
    'scripts/db-migrate-remote.js',
    'ops/vinahost/11ship-staging.service',
    'ops/runbooks/ubuntu-vinahost-staging.md',
    'node_modules/argon2/package.json',
    'node_modules/pg/package.json',
    'node_modules/node-pg-migrate/package.json',
  ]) {
    if (!existsSync(join(rel, needed))) {
      fail(`missing from the artifact: ${needed}`);
    }
  }
  if (existsSync(join(rel, 'apps/admin-web/dist/design.html')) || existsSync(join(rel, 'apps/admin-web/dist/js/design'))) {
    fail('the Admin web in the artifact is not the real build');
  }
  for (const dev of ['typescript', 'jest', 'eslint']) {
    if (existsSync(join(rel, 'node_modules', dev))) {
      fail(`development dependency shipped: ${dev}`);
    }
  }

  // Load the compiled app and the native module from the extracted tree. A scrubbed environment: nothing from the build.
  const probe = `
    require('reflect-metadata');
    require('./apps/backend/dist/app.module.js');
    require('pg');
    require('node-pg-migrate');
    const { Argon2idPasswordHasher } = require('./apps/backend/dist/auth/password-hasher.js');
    (async () => {
      const hasher = new Argon2idPasswordHasher();
      const hash = await hasher.hash('artifact-probe-value-1');
      const ok = await hasher.verify(hash, 'artifact-probe-value-1');
      const no = await hasher.verify(hash, 'artifact-probe-value-2');
      if (ok !== true || no !== false) { throw new Error('argon2 verify result'); }
      process.stdout.write('modules and native argon2 ok\\n');
    })().catch((e) => { process.stderr.write('probe failed: ' + (e && e.code ? e.code : 'error') + '\\n'); process.exit(1); });
  `;
  const scrubbed = { PATH: process.env.PATH, HOME: work, NODE_ENV: 'production' };
  const loaded = spawnSync(process.execPath, ['-e', probe], { cwd: rel, env: scrubbed, encoding: 'utf8' });
  if (loaded.status !== 0) {
    fail(`the extracted application does not load: ${loaded.stderr.trim().split('\n').pop()}`);
  }

  // The operator commands must refuse (exit 1) with no target configured, proving they start from the artifact.
  for (const script of ['db-migrate-remote.js', 'admin-auth-init-limit-config.js', 'admin-auth-bootstrap-system.js', 'staging-seed-fixtures.js']) {
    const run = spawnSync(process.execPath, [join('scripts', script)], { cwd: rel, env: scrubbed, encoding: 'utf8', input: '' });
    if (run.status !== 1) {
      fail(`${script} should refuse with exit 1 when no target is configured (got ${run.status})`);
    }
  }
  process.stdout.write(`artifact verified: sha ${expectedSha}, ${counted} manifest entries, checksum ok\n`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
