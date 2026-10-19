#!/usr/bin/env node
// Builds the Ubuntu 24.04 (linux x64) release artifact of the 11Ship staging service (M00-VPS-01, gói B).
//
//   node scripts/deploy/build-ubuntu-artifact.mjs --out <dir> [--sha <40-hex>] [--skip-build]
//
// Precondition: `npm ci` has already run (lockfile-pinned node_modules). The script then
//   1. runs `npm run build` and `npm run build:admin-web` (unless --skip-build);
//   2. assembles ONE tree: compiled backend, built admin web, migrations, operator scripts, ops templates, and ONLY the
//      production dependency closure plus the migration tool (node-pg-migrate) — no TypeScript, Jest, ESLint, no sources
//      of the apps, no source maps, no .env file;
//   3. refuses to continue when a secret-looking value, a private key, a source map or a design-preview file is present;
//   4. writes RELEASE.json (source SHA, Node version, platform) and MANIFEST.sha256 (every file);
//   5. creates a deterministic 11ship-<sha>-ubuntu24-amd64.tar.gz and its .sha256 next to it.
// It never reads, writes or prints a secret, and never contacts a database or a server.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ARTIFACT_PLATFORM = 'ubuntu24-amd64';
/** Operator tool that must be runnable from the release: it is a devDependency of the repository. */
export const OPERATOR_TOOLS = ['node-pg-migrate'];

/** Files and folders copied verbatim from the repository (relative paths). */
export const COPY_ENTRIES = [
  ['apps/backend/dist', 'apps/backend/dist'],
  ['apps/admin-web/dist', 'apps/admin-web/dist'],
  ['database/migrations', 'database/migrations'],
  ['scripts/db-migrate-remote.js', 'scripts/db-migrate-remote.js'],
  ['scripts/db-remote-target.js', 'scripts/db-remote-target.js'],
  ['scripts/staging-seed-fixtures.js', 'scripts/staging-seed-fixtures.js'],
  ['scripts/admin-auth-init-limit-config.js', 'scripts/admin-auth-init-limit-config.js'],
  ['scripts/admin-auth-bootstrap-system.js', 'scripts/admin-auth-bootstrap-system.js'],
  ['scripts/admin-auth-recover-system.js', 'scripts/admin-auth-recover-system.js'],
  ['scripts/sms-gateway-ctl.js', 'scripts/sms-gateway-ctl.js'],
  ['scripts/android-attestation-refresh.mjs', 'scripts/android-attestation-refresh.mjs'],
  ['scripts/deploy/android-readiness.cjs', 'scripts/deploy/android-readiness.cjs'],
  ['scripts/deploy/vps-update.py', 'scripts/deploy/vps-update.py'],
  ['scripts/deploy/vps-diagnose.py', 'scripts/deploy/vps-diagnose.py'],
  ['ops/selfhosted', 'ops/selfhosted'],
  ['ops/vinahost', 'ops/vinahost'],
  ['ops/runbooks/selfhosted-postgres-staging.md', 'ops/runbooks/selfhosted-postgres-staging.md'],
  ['ops/runbooks/ubuntu-vinahost-staging.md', 'ops/runbooks/ubuntu-vinahost-staging.md'],
  ['ops/runbooks/vps-production-update-20261014.md', 'ops/runbooks/vps-production-update-20261014.md'],
  ['ops/runbooks/vps-safe-update.md', 'ops/runbooks/vps-safe-update.md'],
  ['ops/runbooks/sms-gateway.md', 'ops/runbooks/sms-gateway.md'],
  ['docs/current/M01-terms-privacy-20261014.md', 'docs/current/M01-terms-privacy-20261014.md'],
  ['.node-version', '.node-version'],
];

/** Anything that must never be in the artifact. Checked on file NAMES. */
const FORBIDDEN_NAMES = [/\.map$/, /(^|\/)\.env($|\.)/, /\.(pem|key|p12|jks|keystore)$/i, /(^|\/)design(\.html|\.css)?$/, /id_rsa|id_ed25519/];
/** ... and on the CONTENT of our own files (not third-party node_modules). */
const FORBIDDEN_CONTENT = [
  /-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /\bpostgres(ql)?:\/\/[^\s:@/]+:(?!<)[^\s@/]{3,}@/i,
  /Dữ liệu minh họa|MINHHOA/,
];

function parseArgs(argv) {
  const args = { out: undefined, sha: undefined, skipBuild: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--out') {
      args.out = argv[++i];
    } else if (flag === '--sha') {
      args.sha = argv[++i];
    } else if (flag === '--skip-build') {
      args.skipBuild = true;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (args.out === undefined) {
    throw new Error('usage: build-ubuntu-artifact.mjs --out <dir> [--sha <40-hex>] [--skip-build]');
  }
  return args;
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

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

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Directory of package `name` as Node would resolve it from `fromDir`, or undefined. */
function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) {
      return realpathSync(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** The set of package directories needed at run time: dependencies, optionalDependencies and peers, transitively. */
export function dependencyClosure(rootNames, fromDir = root) {
  const seen = new Map();
  const queue = rootNames.map((name) => ({ name, from: fromDir, required: true }));
  while (queue.length > 0) {
    const { name, from, required } = queue.shift();
    const dir = resolvePackageDir(name, from);
    if (dir === undefined) {
      if (required) {
        throw new Error(`dependency ${name} is not installed (run npm ci first)`);
      }
      continue;
    }
    if (seen.has(dir)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    seen.set(dir, `${manifest.name}@${manifest.version}`);
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dep, from: dir, required: true });
    }
    for (const dep of Object.keys(manifest.optionalDependencies ?? {})) {
      queue.push({ name: dep, from: dir, required: false });
    }
    for (const dep of Object.keys(manifest.peerDependencies ?? {})) {
      queue.push({ name: dep, from: dir, required: false });
    }
  }
  return seen;
}

function copyPackageDirs(closure, stage) {
  const nodeModulesRoot = join(root, 'node_modules');
  for (const dir of closure.keys()) {
    const rel = relative(root, dir);
    if (rel.startsWith('..') || !rel.split(sep).includes('node_modules')) {
      throw new Error(`dependency outside node_modules: ${rel}`);
    }
    if (relative(nodeModulesRoot, dir).startsWith('..')) {
      throw new Error(`dependency outside the root node_modules: ${rel}`);
    }
    cpSync(dir, join(stage, rel), {
      recursive: true,
      dereference: true,
      // A nested node_modules of a package is copied only when the closure names it on its own.
      filter: (source) => {
        const inside = relative(dir, source).split(sep);
        return !inside.includes('node_modules') && !source.endsWith('.map');
      },
    });
  }
}

function stripSourceMapReferences(stage) {
  for (const file of walk(join(stage, 'apps'))) {
    if (file.endsWith('.map')) {
      rmSync(file);
    } else if (file.endsWith('.js')) {
      const text = readFileSync(file, 'utf8');
      const cleaned = text.replace(/\n\/\/# sourceMappingURL=.*\s*$/u, '\n');
      if (cleaned !== text) {
        writeFileSync(file, cleaned);
      }
    }
  }
}

function runtimePackageJson(sha) {
  return {
    name: '11ship-staging-release',
    version: '0.0.0',
    private: true,
    description: `11Ship staging release ${sha}`,
    engines: { node: '>=24 <25' },
    scripts: {
      start: 'node apps/backend/dist/main.js',
      'db:migrate:remote': 'node scripts/db-migrate-remote.js',
      'staging:seed-fixtures': 'node scripts/staging-seed-fixtures.js',
      'admin-auth:init-limit-config': 'node scripts/admin-auth-init-limit-config.js',
      'admin-auth:bootstrap-system': 'node scripts/admin-auth-bootstrap-system.js',
      'admin-auth:recover-system': 'node scripts/admin-auth-recover-system.js',
      'sms-gateway:ctl': 'node scripts/sms-gateway-ctl.js',
    },
  };
}

/** Throws when the tree holds anything that must not ship. Returns the number of files checked. */
export function assertCleanTree(stage) {
  const problems = [];
  const files = walk(stage);
  for (const file of files) {
    const rel = relative(stage, file).split(sep).join('/');
    const isThirdParty = rel.startsWith('node_modules/');
    if (!isThirdParty && FORBIDDEN_NAMES.some((pattern) => pattern.test(rel))) {
      problems.push(`forbidden file: ${rel}`);
    }
    if (rel.endsWith('.map')) {
      problems.push(`source map: ${rel}`);
    }
    if (!isThirdParty && /\.(js|mjs|json|html|css|md|sql|conf|service|example|sh|txt)$/.test(rel)) {
      const text = readFileSync(file, 'utf8');
      const hit = FORBIDDEN_CONTENT.find((pattern) => pattern.test(text));
      if (hit !== undefined) {
        problems.push(`forbidden content (${hit}): ${rel}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`artifact tree refused:\n  ${problems.join('\n  ')}`);
  }
  return files.length;
}

function writeManifest(stage) {
  const lines = walk(stage)
    .map((file) => relative(stage, file).split(sep).join('/'))
    .filter((rel) => rel !== 'MANIFEST.sha256')
    .sort()
    .map((rel) => `${sha256File(join(stage, rel))}  ${rel}`);
  writeFileSync(join(stage, 'MANIFEST.sha256'), `${lines.join('\n')}\n`);
  return lines.length;
}

function tarGz(parent, folder, target, epoch) {
  const tarPath = target.replace(/\.gz$/, '');
  execFileSync(
    'tar',
    ['--sort=name', `--mtime=@${epoch}`, '--owner=0', '--group=0', '--numeric-owner', '--format=gnu', '-cf', tarPath, '-C', parent, folder],
    { stdio: 'inherit' },
  );
  execFileSync('gzip', ['-n', '-9', '-f', tarPath], { stdio: 'inherit' });
}

export function buildArtifact(argv) {
  const args = parseArgs(argv);
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error(`the artifact is for linux x64 (Ubuntu 24.04); this machine is ${process.platform}/${process.arch}`);
  }
  const expectedNode = readFileSync(join(root, '.node-version'), 'utf8').trim();
  if (process.versions.node !== expectedNode) {
    throw new Error(`Node ${process.versions.node} differs from .node-version (${expectedNode})`);
  }
  const sha = args.sha ?? git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('the source SHA must be 40 lowercase hex characters');
  }
  if (args.sha === undefined && git('status', '--porcelain', '--untracked-files=no') !== '') {
    throw new Error('tracked files are modified; build from a clean checkout of the SHA');
  }

  if (!args.skipBuild) {
    for (const script of ['build', 'build:admin-web']) {
      execFileSync('npm', ['run', script], { cwd: root, stdio: 'inherit' });
    }
  }
  for (const [from] of COPY_ENTRIES) {
    if (!existsSync(join(root, from))) {
      throw new Error(`missing build input: ${from}`);
    }
  }

  const out = join(process.cwd(), args.out);
  const name = `11ship-${sha}-${ARTIFACT_PLATFORM}`;
  const stage = join(out, name);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  for (const [from, to] of COPY_ENTRIES) {
    cpSync(join(root, from), join(stage, to), { recursive: true, dereference: true });
  }
  cpSync(join(root, 'apps', 'backend', 'package.json'), join(stage, 'apps', 'backend', 'package.json'));
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(runtimePackageJson(sha), null, 2)}\n`);

  const backendManifest = JSON.parse(readFileSync(join(root, 'apps', 'backend', 'package.json'), 'utf8'));
  const closure = dependencyClosure([...Object.keys(backendManifest.dependencies ?? {}), ...OPERATOR_TOOLS]);
  copyPackageDirs(closure, stage);
  stripSourceMapReferences(stage);

  const epoch = Number(git('show', '-s', '--format=%ct', sha));
  writeFileSync(
    join(stage, 'RELEASE.json'),
    `${JSON.stringify(
      {
        project: '11ship',
        task: 'M00-VPS-01',
        sourceSha: sha,
        platform: ARTIFACT_PLATFORM,
        node: process.versions.node,
        npmPackages: [...closure.values()].sort(),
        commitTimeUtc: new Date(epoch * 1000).toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  const checked = assertCleanTree(stage);
  const listed = writeManifest(stage);

  const archive = join(out, `${name}.tar.gz`);
  rmSync(archive, { force: true });
  tarGz(out, name, archive, epoch);
  const digest = sha256File(archive);
  writeFileSync(`${archive}.sha256`, `${digest}  ${name}.tar.gz\n`);
  return { archive, digest, sha, files: listed, checked, bytes: statSync(archive).size, packages: closure.size };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    const result = buildArtifact(process.argv.slice(2));
    process.stdout.write(
      `artifact: ${result.archive}\nsha256:   ${result.digest}\nsource:   ${result.sha}\nfiles:    ${result.files} (${result.packages} npm packages)\nsize:     ${result.bytes} bytes\n`,
    );
  } catch (error) {
    process.stderr.write(`build-ubuntu-artifact: ${error instanceof Error ? error.message : 'failed'}\n`);
    process.exit(1);
  }
}
