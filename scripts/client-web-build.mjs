#!/usr/bin/env node
// Builds one of the phone UIs (apps/food-web, apps/ship-web, apps/ui-foundation) into a static site: TypeScript -> browser
// ES modules with the repo's own TypeScript (no bundler, no runtime dependency), plus the static files of apps/client-shared/
// public and of the app's own public folder.
//
//   node scripts/client-web-build.mjs <app> [--design] [--out <dir>]
//
// Real build (default): apps/<app>/dist. It contains NO design preview: every `design` folder of the compiled output, design.html
// and design.css are removed, and the build fails if anything left still refers to them.
// Design build (--design): apps/<app>/dist-design. Adds design.html (the preview page). The preview is a separate page that
// creates no session and calls no backend.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLIENT_APPS = ['food-web', 'ship-web', 'ui-foundation'];
/** Apps that exist only as a design preview (no real entry page). */
const DESIGN_ONLY = new Set(['ui-foundation']);

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

function removeDesignFolders(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.name === 'design') {
      rmSync(full, { recursive: true, force: true });
    } else {
      removeDesignFolders(full);
    }
  }
}

function sourceSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export function buildClientWeb(app, { design = false, outDir, quiet = false } = {}) {
  if (!CLIENT_APPS.includes(app)) {
    throw new Error(`unknown client app: ${app}`);
  }
  if (DESIGN_ONLY.has(app) && !design) {
    throw new Error(`${app} is a design-only app: build it with --design`);
  }
  const appDir = join(root, 'apps', app);
  const shared = join(root, 'apps', 'client-shared');
  const dist = outDir === undefined ? join(appDir, design ? 'dist-design' : 'dist') : resolve(outDir);
  const tsc = process.env.CLIENT_WEB_TSC ?? createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc');

  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  execFileSync(process.execPath, [tsc, '-p', join(appDir, 'tsconfig.json'), '--outDir', join(dist, 'js')], { stdio: quiet ? 'pipe' : 'inherit' });
  cpSync(join(shared, 'public'), dist, { recursive: true });
  cpSync(join(appDir, 'public'), dist, { recursive: true });

  if (!design) {
    removeDesignFolders(join(dist, 'js'));
    rmSync(join(dist, 'design.html'), { force: true });
    rmSync(join(dist, 'design.css'), { force: true });
    for (const file of walk(dist)) {
      if (/\.(js|html|css)$/.test(file) && /\/design\/|design\.(html|css)/.test(readFileSync(file, 'utf8'))) {
        throw new Error(`design preview reference left in a real build: ${relative(root, file)}`);
      }
    }
  }

  const entry = design ? 'design.html' : 'index.html';
  if (!existsSync(join(dist, entry))) {
    throw new Error(`${app} build output is incomplete: ${entry} is missing`);
  }

  // Fingerprint of the exact output, so an old build can never be mistaken for a new one.
  const hash = createHash('sha256');
  for (const file of walk(dist).sort()) {
    if (file.endsWith('build-manifest.json')) {
      continue;
    }
    hash.update(relative(dist, file));
    hash.update(readFileSync(file));
  }
  const manifest = { app_id: app, mode: design ? 'design' : 'live', source_sha: sourceSha(), fingerprint: hash.digest('hex'), files: walk(dist).length };
  writeFileSync(join(dist, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dist, manifest, size: walk(dist).reduce((sum, file) => sum + statSync(file).size, 0) };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const app = args.find((arg) => !arg.startsWith('--'));
  const outIndex = args.indexOf('--out');
  if (app === undefined) {
    console.error(`usage: client-web-build <${CLIENT_APPS.join('|')}> [--design] [--out <dir>]`);
    process.exit(2);
  }
  const result = buildClientWeb(app, { design: args.includes('--design'), outDir: outIndex === -1 ? undefined : args[outIndex + 1] });
  console.log(`${app} (${result.manifest.mode}) built into ${result.dist}`);
}
