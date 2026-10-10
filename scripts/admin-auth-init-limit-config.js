'use strict';

// `npm run admin-auth:init-limit-config` — writes the administration limiter configuration row (key id + keyed check
// value) ONCE, before the application starts with ADMIN_AUTH_ENABLED=true. A thin launcher: all rules live in the
// compiled application (apps/backend/dist), so nothing is duplicated here. Needs `npm run build` first.
const { existsSync } = require('node:fs');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'apps', 'backend', 'dist', 'admin-auth', 'cli', 'admin-auth-cli.js');
if (!existsSync(cli)) {
  console.error('admin-auth:init-limit-config: the compiled application is missing. Run "npm run build" first.');
  process.exit(1);
}
require(cli)
  .runAdminAuthCli('init-limit-config', {
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
      console.error('admin-auth:init-limit-config: unexpected failure.');
      process.exitCode = 1;
    },
  );
