#!/usr/bin/env node
// Prints screenshots of a CI browser test as GitHub annotations, in the order asked, while they fit (CI only).
// Usage: node scripts/ci-print-shots.mjs <title-prefix> <directory> <name> [<name> ...]
//
// The job logs and artifacts cannot always be downloaded, so a reviewer reassembles an image from its annotations (the same
// way as the Admin web shots): base64 parts of 4000 characters in annotations titled "<prefix> <name> i/n (image data)", with a
// manifest first. GitHub keeps at most 10 notice and 10 warning annotations per step, so this step is separate from the test
// steps (they have their own budget) and only whole images are printed: an image that does not fit is skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [prefix, directory, ...names] = process.argv.slice(2);
if (prefix === undefined || directory === undefined || names.length === 0) {
  console.error('usage: ci-print-shots <title-prefix> <directory> <name> [<name> ...]');
  process.exit(2);
}
const PART = 4_000;
const CAPACITY = 10 + 10;
const lines = [];
const manifest = [];
for (const name of names) {
  const file = join(directory, `${name}.webp`);
  if (!existsSync(file)) {
    continue;
  }
  const encoded = readFileSync(file).toString('base64');
  const total = Math.ceil(encoded.length / PART);
  if (lines.length + total > CAPACITY) {
    continue;
  }
  manifest.push(`${name}=${String(total)}`);
  for (let index = 0; index < total; index += 1) {
    lines.push(`title=${prefix} ${name} ${String(index + 1)}/${String(total)} (image data)::${encoded.slice(index * PART, (index + 1) * PART)}`);
  }
}
// The manifest takes one notice, so the images get 9 notices and 10 warnings.
console.log(`::notice title=${prefix} manifest::${manifest.join(' ')}`);
lines.forEach((line, index) => {
  console.log(`::${index < 9 ? 'notice' : 'warning'} ${line}`);
});
