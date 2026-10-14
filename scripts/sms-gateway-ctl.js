'use strict';

// `npm run sms-gateway:ctl -- pair --label <name> | list | revoke --device-id <uuid> | enable | disable` — operator tool of the SMS
// gateway (issue #102). A thin launcher: all rules live in the compiled application. Needs `npm run build` first.
const { existsSync } = require('node:fs');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'apps', 'backend', 'dist', 'sms-gateway', 'cli', 'sms-gateway-cli.js');
if (!existsSync(cli)) {
  console.error('sms-gateway:ctl: the compiled application is missing. Run "npm run build" first.');
  process.exit(1);
}
require(cli)
  .runSmsGatewayCli({
    env: process.env,
    argv: process.argv.slice(2),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  })
  .then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      console.error('sms-gateway:ctl: unexpected failure.');
      process.exitCode = 1;
    },
  );
