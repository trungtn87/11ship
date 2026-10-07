'use strict';

// CI helper: turns the tail of a step's captured output into a GitHub error annotation, so a
// failure can be read from the run's annotations without downloading the job log.
// Usage: node scripts/annotate-log.js <label> <log-file> [lines]
const { existsSync, readFileSync } = require('node:fs');

const [label, file, linesArg] = process.argv.slice(2);
const lines = Number(linesArg ?? 40);
if (!label || !file || !Number.isInteger(lines) || lines < 1) {
  console.error('usage: annotate-log.js <label> <log-file> [lines]');
  process.exit(2);
}

const text = existsSync(file) ? readFileSync(file, 'utf8') : '(no output captured)';
const tail = text
  .split('\n')
  .slice(-lines)
  .join('\n')
  .replace(/%/g, '%25')
  .replace(/\r/g, '%0D')
  .replace(/\n/g, '%0A')
  .slice(0, 6000);
console.log(`::error title=${label} output (tail)::${tail}`);
