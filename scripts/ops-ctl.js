'use strict';

// `npm run ops:ctl -- ingest-key create --label <name> --scope PROBE|BACKUP|DEPLOY | ingest-key list | ingest-key revoke --key-id <uuid>` — operator tool of
// M13 (the machine credentials of the external probe, the backup job and the deploy pipeline). A thin launcher: all rules live in the compiled application.
// Needs `npm run build` first.
const { existsSync } = require('node:fs');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'apps', 'backend', 'dist', 'ops', 'cli', 'ops-cli.js');
if (!existsSync(cli)) {
  console.error('ops:ctl: the compiled application is missing. Run "npm run build" first.');
  process.exit(1);
}
require(cli)
  .runOpsCli({
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
      console.error('ops:ctl: unexpected failure.');
      process.exitCode = 1;
    },
  );
