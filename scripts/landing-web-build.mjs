#!/usr/bin/env node
// Builds the single static 11 landing site (/, /food, /ship) into apps/landing-web/dist. No bundler, no runtime dependency.
// Brand assets are copied unchanged from apps/client-shared/public (tokens, font, approved logos); nothing is redrawn.
//   node scripts/landing-web-build.mjs [--out <dir>]
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from '../apps/landing-web/src/pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const dist = outIdx === -1 ? join(root, 'apps', 'landing-web', 'dist') : resolve(process.argv[outIdx + 1]);
const shared = join(root, 'apps', 'client-shared', 'public');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'brand'), { recursive: true });
mkdirSync(join(dist, 'fonts'), { recursive: true });
cpSync(join(shared, 'tokens.css'), join(dist, 'tokens.css'));
cpSync(join(shared, 'fonts', 'PlusJakartaSans-wght.woff2'), join(dist, 'fonts', 'PlusJakartaSans-wght.woff2'));
for (const f of ['logo-11-ui.png', 'logo-11food-ui.png', 'logo-11ship-ui.png']) {
  cpSync(join(shared, 'brand', f), join(dist, 'brand', f));
}
cpSync(join(root, 'apps', 'landing-web', 'src', 'site.css'), join(dist, 'site.css'));
for (const [path, html] of Object.entries(pages)) {
  const dir = path === '/' ? dist : join(dist, path.replace(/^\//, ''));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
}
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n# PREVIEW: remove this block when the Owner approves publication.\n');
console.log(`landing-web built into ${dist} (${Object.keys(pages).length} pages)`);
