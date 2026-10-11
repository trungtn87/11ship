#!/usr/bin/env node
// Builds the administration web into apps/admin-web/dist: TypeScript -> browser ES modules (dist/js) with the repo's own
// TypeScript, plus the static files of apps/admin-web/public. No bundler and no runtime dependency.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'admin-web');
const dist = join(app, 'dist');

export function buildAdminWeb({ quiet = false } = {}) {
  const tsc = process.env.ADMIN_WEB_TSC ?? createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');
  rmSync(dist, { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, '-p', join(app, 'tsconfig.json')], { stdio: quiet ? 'pipe' : 'inherit' });
  cpSync(join(app, 'public'), dist, { recursive: true });
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'js', 'dom', 'main.js'))) {
    throw new Error('admin-web build output is incomplete');
  }
  return dist;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = buildAdminWeb();
  console.log(`admin-web built into ${out}`);
}
