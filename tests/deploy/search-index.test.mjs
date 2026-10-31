import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Issue #283: the offline place index shipped in the app is exactly what the build script makes from the OpenStreetMap extract in the repository.
const root = resolve(import.meta.dirname, '../..');
const builder = join(root, 'ops/m14/search-index/build-search-index.mjs');
const committed = join(root, 'mobile/packages/n11_shared/assets/places/caobang-places.json');

test('the committed offline place index is reproducible from ops/m14/data/caobang.osm.pbf', () => {
  const dir = mkdtempSync(join(tmpdir(), 'places-'));
  try {
    const out = join(dir, 'places.json');
    execFileSync(process.execPath, [builder, join(root, 'ops/m14/data/caobang.osm.pbf'), out], { stdio: 'pipe' });
    assert.equal(readFileSync(out, 'utf8'), readFileSync(committed, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the index only holds named places with a point inside the offline map package', () => {
  const doc = JSON.parse(readFileSync(committed, 'utf8'));
  const [minLng, minLat, maxLng, maxLat] = doc.bounds;
  assert.deepEqual(doc.bounds, [106.0, 22.43, 106.52, 22.91]);
  assert.equal(doc.count, doc.places.length);
  assert.ok(doc.places.length > 300);
  for (const [name, lat, lng, category] of doc.places) {
    assert.ok(name.trim().length > 0);
    assert.ok(lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat, `${name} is outside the map package`);
    assert.ok(category in doc.categories, `${name} has an unknown category`);
  }
  assert.match(doc.source, /OpenStreetMap/);
});
