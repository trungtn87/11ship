import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { AddressInfo, createServer } from 'node:net';
import { dirname, join } from 'node:path';

// Test harness of the administration web: the repository's own scripts run as processes, exactly as the local run
// guide uses them (jest cannot import the .mjs scripts directly).

export function repoRoot(): string {
  let directory = __dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { name?: string };
      if (pkg.name === '11ship') {
        return directory;
      }
    } catch {
      // keep going up
    }
    directory = dirname(directory);
  }
  throw new Error('repository root not found');
}

/** Runs one of the repository's admin web scripts exactly as a developer does (`node scripts/...`). */
export function runScript(name: string, args: string[] = []): void {
  execFileSync(process.execPath, [join(repoRoot(), 'scripts', name), ...args], { cwd: repoRoot(), stdio: 'pipe' });
}

/** Starts the local HTTPS front (scripts/admin-web-dev.mjs) as its own process and waits until it listens. */
export async function startFront(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(repoRoot(), 'scripts', 'admin-web-dev.mjs')], {
    cwd: repoRoot(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`admin web front did not start: ${output}`)), 20_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('admin web: ')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`admin web front exited (${String(code)}): ${output}`));
    });
  });
  return child;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
