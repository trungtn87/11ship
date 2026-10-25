#!/usr/bin/env node
// Generates the Vietnam mobile prefix tables used by the backend (TypeScript) and both phone apps (Dart) from the ONE data file
// config/vn-mobile-prefixes.json, so the OTP phone rule cannot drift between them. `--check` writes nothing and fails when a
// generated file is stale (the backend unit tests run it).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'config/vn-mobile-prefixes.json');
const targets = {
  ts: join(root, 'apps/backend/src/auth/vn-mobile-prefixes.generated.ts'),
  dart: join(root, 'mobile/packages/n11_shared/lib/src/account/vn_mobile_prefixes.g.dart'),
};

const data = JSON.parse(readFileSync(source, 'utf8'));
const prefixes = data.prefixes.map((entry) => entry.prefix);
for (const prefix of prefixes) {
  if (!/^0[3-9][0-9]{1,8}$/.test(prefix)) throw new Error(`invalid prefix ${prefix}`);
}
const sorted = [...prefixes].sort();
if (new Set(prefixes).size !== prefixes.length) throw new Error('duplicate prefix');
for (let i = 0; i < sorted.length; i++) {
  for (let j = i + 1; j < sorted.length; j++) {
    if (sorted[j].startsWith(sorted[i])) throw new Error(`overlapping prefixes ${sorted[i]} and ${sorted[j]}`);
  }
}

const header = `Generated from config/vn-mobile-prefixes.json by scripts/gen-vn-mobile-prefixes.mjs. Do not edit.`;
const list = sorted.map((prefix) => `'${prefix}'`);
const rendered = {
  ts: `// ${header}\n// Data reviewed ${data.reviewedOn}; official confirmation status: ${data.verification.status}.\n\nexport const VN_MOBILE_PREFIXES_REVIEWED_ON = '${data.reviewedOn}';\n\n/** Allocated national mobile prefixes (leading 0, 3 or more digits, no overlaps). */\nexport const VN_MOBILE_PREFIXES: readonly string[] = [\n${list.map((item) => `  ${item},`).join('\n')}\n];\n`,
  dart: `// ${header}\n// Data reviewed ${data.reviewedOn}; official confirmation status: ${data.verification.status}.\n\nconst String vnMobilePrefixesReviewedOn = '${data.reviewedOn}';\n\n/// Allocated national mobile prefixes (leading 0, 3 or more digits, no overlaps).\nconst List<String> vnMobilePrefixes = <String>[\n${list.map((item) => `  ${item},`).join('\n')}\n];\n`,
};

const check = process.argv.includes('--check');
let stale = false;
for (const [kind, path] of Object.entries(targets)) {
  let current;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === rendered[kind]) continue;
  if (check) {
    console.error(`stale generated file: ${path}`);
    stale = true;
  } else {
    writeFileSync(path, rendered[kind]);
  }
}
if (stale) process.exit(1);
