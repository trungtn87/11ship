import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Brand assets: the five Owner-approved originals are untouched, every derived file (web, PC admin, Flutter, Android launcher and
// splash) matches the manifest written by tools/brand/build-brand-assets.py, and every logo slot points at a file that exists.
// The checks use no image library: PNG colour type and size are read from the file header; the alpha measurements in the manifest
// were taken from the original pixels by the generator.

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const manifest = JSON.parse(read('docs/brand/brand-assets.json').toString('utf8'));

const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;
const LOGOS = ['logo-11', 'logo-11food', 'logo-11ship'];
const ICONS = ['icon-11food', 'icon-11ship'];

function pngHeader(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), colorType: buffer[25] };
}

describe('brand assets', () => {
  it('keeps the five approved originals byte-identical to the manifest', () => {
    for (const name of [...LOGOS, ...ICONS]) {
      assert.equal(sha(read(`docs/brand/originals/${name}.png`)), manifest.originals[`${name}.png`], name);
    }
  });

  it('logos have a real alpha channel (transparent corners, nearly opaque ink); icons are opaque squares', () => {
    for (const name of LOGOS) {
      const header = pngHeader(read(`docs/brand/originals/${name}.png`));
      assert.equal(header.colorType, COLOR_TYPE_RGBA, `${name}: not RGBA`);
      const alpha = manifest.alpha[name];
      assert.deepEqual([header.width, header.height], alpha.size, name);
      assert.deepEqual(alpha.corner_alpha, [0, 0, 0, 0], `${name}: corners are not transparent`);
      assert.ok(alpha.transparent_share > 0.5, `${name}: background is not transparent`);
      assert.ok(alpha.median_alpha_of_ink >= 250, `${name}: ink is translucent`);
    }
    for (const name of ICONS) {
      const header = pngHeader(read(`docs/brand/originals/${name}.png`));
      assert.equal(header.colorType, COLOR_TYPE_RGB, name);
      assert.equal(header.width, header.height, `${name}: not square`);
    }
  });

  it('every derived file exists and matches the manifest', () => {
    const entries = [...Object.entries(manifest.derived), ...Object.entries(manifest.android)].filter(([path]) => path.endsWith('.png'));
    assert.ok(entries.length >= 40);
    for (const [path, hash] of entries) {
      assert.ok(existsSync(new URL(path, root)), `${path} is missing`);
      assert.equal(sha(read(path)), hash, `${path} is stale: run python3 tools/brand/build-brand-assets.py`);
    }
  });

  it('the Flutter copies of the UI logos are identical to the web copies', () => {
    for (const name of LOGOS) {
      assert.deepEqual(read(`mobile/packages/n11_shared/assets/brand/${name}-ui.png`), read(`apps/client-shared/public/brand/${name}-ui.png`), name);
    }
  });

  it('the logo slots of the web apps and the PC admin console point at existing files', () => {
    const brand = read('apps/client-shared/src/brand.ts').toString('utf8');
    const paths = [...brand.matchAll(/(?:FOOD|SHIP):\s*'(\/brand\/[^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(paths.sort(), ['/brand/logo-11food-ui.png', '/brand/logo-11ship-ui.png']);
    for (const path of paths) {
      assert.ok(existsSync(new URL(`apps/client-shared/public${path}`, root)), path);
    }
    const admin = read('apps/admin-web/src/dom/dom.ts').toString('utf8');
    assert.match(admin, /src: '\/logo-11-ui\.png'/);
    assert.ok(existsSync(new URL('apps/admin-web/public/logo-11-ui.png', root)));
  });
});
