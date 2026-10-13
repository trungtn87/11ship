'use strict';

// `npm run admin-auth:recover-system -- --check|--apply` — local/CI recovery of the existing SYSTEM password; JSON on standard
// input only (never an argument or environment variable). A thin launcher: all rules live in the compiled application.
// Needs `npm run build` first.
const { existsSync } = require('node:fs');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'apps', 'backend', 'dist', 'admin-auth', 'cli', 'admin-auth-cli.js');
if (!existsSync(cli)) {
  console.error('admin-auth:recover-system: the compiled application is missing. Run "npm run build" first.');
  process.exit(1);
}
require(cli)
  .runAdminAuthCli('recover-system', {
    env: process.env,
    argv: process.argv.slice(2),
    stdin: process.stdin,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  })
  .then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error('admin-auth:recover-system: unexpected failure.');
      process.exitCode = 1;
    },
  );
