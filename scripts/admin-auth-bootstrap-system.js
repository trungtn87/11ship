'use strict';

// `npm run admin-auth:bootstrap-system` — creates the one SYSTEM administrator from a JSON object on standard input
// ({"phone": "...", "password": "..."}); never from an argument or an environment variable. Run it only after
// admin-auth:init-limit-config succeeded. A thin launcher: all rules live in the compiled application. Needs
// `npm run build` first.
const { existsSync } = require('node:fs');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'apps', 'backend', 'dist', 'admin-auth', 'cli', 'admin-auth-cli.js');
if (!existsSync(cli)) {
  console.error('admin-auth:bootstrap-system: the compiled application is missing. Run "npm run build" first.');
  process.exit(1);
}
require(cli)
  .runAdminAuthCli('bootstrap-system', {
    env: process.env,
    stdin: process.stdin,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  })
  .then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error('admin-auth:bootstrap-system: unexpected failure.');
      process.exitCode = 1;
    },
  );
