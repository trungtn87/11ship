'use strict';

// Removes the compiled test output directory. Deliberately limited to .test-dist so it can
// never delete anything else, whatever argument it receives.
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = '.test-dist';
const target = process.argv[2];

if (target !== ALLOWED) {
  console.error(`clean-dir: only "${ALLOWED}" may be removed by this script.`);
  process.exit(1);
}

fs.rmSync(path.resolve(process.cwd(), ALLOWED), { recursive: true, force: true });
