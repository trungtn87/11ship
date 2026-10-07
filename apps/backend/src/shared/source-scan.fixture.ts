import { readFileSync } from 'node:fs';
import path from 'node:path';

// Test-only helper (excluded from the build): reads a TypeScript source file of apps/backend/src with its
// comments removed, so a spec can prove structural facts about the CODE ("the writer never imports pg",
// "there is no claim/ack/lease code") without being fooled by prose in a comment.
//
// Compiled location is <root>/.test-dist/apps/backend/src/shared, so the repository root is 5 levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export function sourcePath(relativeToSrc: string): string {
  return path.join(REPO_ROOT, 'apps', 'backend', 'src', relativeToSrc);
}

/** Source text with block comments and whole-line `//` comments removed. */
export function codeOf(relativeToSrc: string): string {
  const text = readFileSync(sourcePath(relativeToSrc), 'utf8');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}
