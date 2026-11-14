#!/usr/bin/env node
// Exports the landing site as a self-contained folder (no dependency on this repo) and builds it once.
//   node scripts/landing-web-export.mjs [--out <dir>]     default: <repo>/landing-web-standalone (git-ignored)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Manual recursive copy: fs.cpSync into an existing folder crashes Node 24 on Windows. */
function copy(from, to) {
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from)) copy(join(from, e), join(to, e));
  } else {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const out = outIdx === -1 ? join(root, 'landing-web-standalone') : resolve(process.argv[outIdx + 1]);
const app = join(root, 'apps', 'landing-web');
const shared = join(root, 'apps', 'client-shared', 'public');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets', 'brand'), { recursive: true });
mkdirSync(join(out, 'assets', 'fonts'), { recursive: true });
copy(join(app, 'standalone'), out, { recursive: true });
copy(join(app, 'src'), join(out, 'src'), { recursive: true });
copy(join(app, 'site.config.json'), join(out, 'site.config.json'));
copy(join(shared, 'tokens.css'), join(out, 'assets', 'tokens.css'));
copy(join(shared, 'fonts', 'PlusJakartaSans-wght.woff2'), join(out, 'assets', 'fonts', 'PlusJakartaSans-wght.woff2'));
copy(join(shared, 'fonts', 'OFL.txt'), join(out, 'assets', 'fonts', 'OFL.txt'));
for (const f of ['logo-11-ui.png', 'logo-11food-ui.png', 'logo-11ship-ui.png']) {
  copy(join(shared, 'brand', f), join(out, 'assets', 'brand', f));
}
execFileSync(process.execPath, [join(out, 'build.mjs')], { stdio: 'inherit' });
console.log(`landing-web standalone exported to ${out}`);
