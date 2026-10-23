import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeAdminBuildTime } from '../../scripts/deploy/build-ubuntu-artifact.mjs';

test('packaged Admin manifests are byte-identical across builds at different wall-clock times', () => {
  const work = mkdtempSync(join(tmpdir(), '11ship-artifact-clock-'));
  try {
    const outputs = [];
    for (const [index, time] of ['2026-10-23T01:00:00Z', '2026-10-23T02:00:00Z'].entries()) {
      const stage = join(work, String(index));
      const folder = join(stage, 'apps', 'admin-web', 'dist');
      mkdirSync(folder, { recursive: true });
      const manifest = { source_sha: 'a'.repeat(40), built_at: time, fingerprint: 'same-code', files: 7 };
      const file = join(folder, 'build-manifest.json');
      writeFileSync(file, JSON.stringify(manifest));
      normalizeAdminBuildTime(stage, 1792713600);
      outputs.push(readFileSync(file, 'utf8'));
    }
    assert.equal(outputs[0], outputs[1]);
    assert.deepEqual(JSON.parse(outputs[0]), { source_sha: 'a'.repeat(40), built_at: new Date(1792713600 * 1000).toISOString(), fingerprint: 'same-code', files: 7 });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
