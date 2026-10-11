// 11Ship test OTP inbox reader (M01.22). Read-only operator tool for the PC.
// Thin entry point: the logic lives in apps/backend/src/test-sms (tool-session / tool-client) and runs from the
// compiled backend (npm run build). It reads the private discovery state, verifies the backend process, then lists
// messages and shows a code ON SCREEN only. It sends nothing, resends nothing, verifies nothing, and takes no
// argument: a code, token or port is never put on a command line, in a file or in the environment.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps', 'backend', 'dist', 'test-sms');
const require = createRequire(import.meta.url);

if (process.argv.length > 2) {
  console.error('Công cụ này không nhận tham số. Chạy lại không kèm tham số.');
  process.exit(2);
}
if (!existsSync(path.join(dist, 'tool-session.js'))) {
  console.error('Chưa build backend. Chạy "npm run build" trong thư mục repo rồi thử lại.');
  process.exit(1);
}

const { runToolSession } = require(path.join(dist, 'tool-session.js'));
const { createPlatform } = require(path.join(dist, 'test-sms-platform.js'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const lines = [];
const waiters = [];
let closed = false;
rl.on('line', (line) => {
  const waiter = waiters.shift();
  if (waiter) waiter(line);
  else lines.push(line);
});
rl.on('close', () => {
  closed = true;
  while (waiters.length > 0) waiters.shift()(undefined);
});

const io = {
  print: (line) => console.log(line),
  ask: (prompt) =>
    new Promise((resolve) => {
      process.stdout.write(prompt);
      if (lines.length > 0) resolve(lines.shift());
      else if (closed) resolve(undefined);
      else waiters.push(resolve);
    }),
};

const code = await runToolSession({ io, platform: createPlatform(), repoRoot: root });
rl.close();
process.exitCode = code;
