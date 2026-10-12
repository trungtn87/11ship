// Fingerprint of a build folder, the SAME algorithm as Get-ArtifactFingerprint in tools/local/11ship-launcher.ps1 (M00.03):
// SHA-256 over the lines "<relative path>|<SHA-256 of the file>" of every file below the folder (ordinal order, '/'
// separators, joined by "\n"), except `build-manifest.json` at the folder's root. Content, names, added and removed files
// all change it. null = no files. The launcher recomputes it to prove that the folder it serves is the one the manifest
// describes, so the two implementations must never drift apart (tests/client-shell/runtime.test.mjs pins a known value).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function filesBelow(directory, prefix = '') {
  const out = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...filesBelow(directory, relative));
    } else {
      out.push(relative);
    }
  }
  return out;
}

export function artifactFingerprint(directory) {
  const names = filesBelow(directory).filter((relative) => relative !== 'build-manifest.json');
  if (names.length === 0) {
    return null;
  }
  names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const lines = names.map((relative) => `${relative}|${createHash('sha256').update(readFileSync(join(directory, relative))).digest('hex')}`);
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
