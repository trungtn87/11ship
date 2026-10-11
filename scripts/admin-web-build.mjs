#!/usr/bin/env node
// Builds the administration web: TypeScript -> browser ES modules with the repo's own TypeScript, plus the static files of
// apps/admin-web/public. No bundler and no runtime dependency.
//
//   node scripts/admin-web-build.mjs            real build  -> apps/admin-web/dist
//   node scripts/admin-web-build.mjs --design   design preview -> apps/admin-web/dist-design
//
// The REAL build contains no design preview: the compiled `design` folder, design.html and design.css are removed, and the
// build fails if anything left still refers to them or carries the preview's sample data. The design build adds them. The
// preview is a separate page that creates no session and calls no backend (see scripts/ui-preview.mjs: connect-src 'none').
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'apps', 'admin-web');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function compile(dist, quiet) {
  const tsc = process.env.ADMIN_WEB_TSC ?? createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');
  rmSync(dist, { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, '-p', join(app, 'tsconfig.json'), '--outDir', join(dist, 'js')], { stdio: quiet ? 'pipe' : 'inherit' });
  cpSync(join(app, 'public'), dist, { recursive: true });
}

/** What must never be in a real build: the preview's folder, page, styles, and its invented people. */
const PREVIEW_MARKERS = [/\/design\/|design\.(html|css)/, /Dữ liệu minh họa/, /MINHHOA/];

export function buildAdminWeb({ quiet = false, outDir } = {}) {
  const dist = outDir ?? join(app, 'dist');
  compile(dist, quiet);
  rmSync(join(dist, 'js', 'design'), { recursive: true, force: true });
  rmSync(join(dist, 'design.html'), { force: true });
  rmSync(join(dist, 'design.css'), { force: true });
  for (const file of walk(dist)) {
    if (!/\.(js|html|css)$/.test(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    const marker = PREVIEW_MARKERS.find((pattern) => pattern.test(text));
    if (marker !== undefined) {
      throw new Error(`design preview content left in a real build: ${relative(root, file)} (${marker})`);
    }
  }
  if (!existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'js', 'dom', 'main.js'))) {
    throw new Error('admin-web build output is incomplete');
  }
  return dist;
}

export function buildAdminWebDesign({ quiet = false, outDir } = {}) {
  const dist = outDir ?? join(app, 'dist-design');
  compile(dist, quiet);
  if (!existsSync(join(dist, 'design.html')) || !existsSync(join(dist, 'js', 'design', 'main.js'))) {
    throw new Error('admin-web design build output is incomplete');
  }
  return { dist };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--design')) {
    console.log(`admin-web design preview built into ${buildAdminWebDesign().dist}`);
  } else {
    console.log(`admin-web built into ${buildAdminWeb()}`);
  }
}
