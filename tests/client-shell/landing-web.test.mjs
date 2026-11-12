// Landing site (apps/landing-web): builds into a temp folder and checks links, assets, SEO basics, a11y basics and brand rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = mkdtempSync(join(tmpdir(), 'landing-'));
const ROUTES = ['/', '/food', '/ship', '/ho-tro', '/chinh-sach-quyen-rieng-tu', '/dieu-khoan', '/xoa-tai-khoan'];
const html = (route) => readFileSync(join(out, route === '/' ? '' : route, 'index.html'), 'utf8');

before(() => {
  execFileSync(process.execPath, [join(root, 'scripts', 'landing-web-build.mjs'), '--out', out], { stdio: 'pipe', env: { ...process.env, LANDING_PUBLISH: '', LANDING_SITE_URL: '' } });
});
after(() => rmSync(out, { recursive: true, force: true }));

describe('landing-web', () => {
  it('builds every route', () => {
    for (const r of ROUTES) assert.ok(existsSync(join(out, r === '/' ? '' : r, 'index.html')), r);
  });

  it('every internal link and asset resolves', () => {
    for (const r of ROUTES) {
      const page = html(r);
      for (const [, ref] of page.matchAll(/(?:href|src)="(\/[^"#]*)(?:#[^"]*)?"/g)) {
        const target = join(out, ref);
        assert.ok(existsSync(target) && (statSync(target).isFile() || existsSync(join(target, 'index.html'))), `${r} -> ${ref}`);
      }
    }
  });

  it('has exactly one h1, a title, a description, lang=vi and alt on every image', () => {
    for (const r of ROUTES) {
      const page = html(r);
      assert.equal((page.match(/<h1[ >]/g) ?? []).length, 1, `${r} h1`);
      assert.match(page, /<html lang="vi">/);
      assert.match(page, /<title>[^<]{5,}<\/title>/);
      assert.match(page, /<meta name="description" content="[^"]{20,}"/);
      for (const img of page.match(/<img [^>]*>/g) ?? []) assert.match(img, /alt="[^"]+"/, `${r} ${img}`);
    }
  });

  it('stays noindex until publication is switched on, with canonical on the 11local.vn domain', () => {
    for (const r of ROUTES) {
      assert.match(html(r), /name="robots" content="noindex,nofollow"/);
      assert.ok(html(r).includes(`rel="canonical" href="https://11local.vn${r}"`), `${r} canonical`);
    }
    assert.match(readFileSync(join(out, 'robots.txt'), 'utf8'), /Disallow: \//);
    assert.ok(!existsSync(join(out, 'sitemap.xml')));
  });

  it('writes sitemap.xml and an Allow robots.txt only when publication is on', () => {
    const pub = mkdtempSync(join(tmpdir(), 'landing-pub-'));
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'landing-web-build.mjs'), '--out', pub], { stdio: 'pipe', env: { ...process.env, LANDING_PUBLISH: '1' } });
      const sitemap = readFileSync(join(pub, 'sitemap.xml'), 'utf8');
      for (const r of ROUTES) assert.ok(sitemap.includes(`<loc>https://11local.vn${r}</loc>`), r);
      assert.match(readFileSync(join(pub, 'robots.txt'), 'utf8'), /Allow: \/\nSitemap: https:\/\/11local\.vn\/sitemap\.xml/);
      assert.doesNotMatch(readFileSync(join(pub, 'food', 'index.html'), 'utf8'), /noindex/);
    } finally {
      rmSync(pub, { recursive: true, force: true });
    }
  });

  it('shows no internal notes, placeholders or fake store links', () => {
    for (const r of ROUTES) {
      const page = html(r);
      assert.doesNotMatch(page, /chờ Owner|Owner duyệt|CHUA-CHOT|placeholder|lorem/i, r);
      assert.doesNotMatch(page, /play\.google\.com|\.apk/i, r);
    }
    assert.match(html('/'), /sắp có trên Google Play/);
  });

  it('uses the locked brand: taglines, colours, font, approved logo files only', () => {
    const home = html('/');
    assert.match(home, /Cần là có/);
    assert.match(html('/food'), /Thèm là có/);
    assert.match(html('/ship'), /Gọi là có/);
    const tokens = readFileSync(join(out, 'tokens.css'), 'utf8');
    assert.match(tokens, /#d8ad18/i);
    assert.match(tokens, /#2a2a2e/i);
    assert.match(tokens, /Plus Jakarta Sans/);
    assert.ok(statSync(join(out, 'fonts', 'PlusJakartaSans-wght.woff2')).size > 10_000);
    for (const f of readdirSync(join(out, 'brand'))) {
      const same = readFileSync(join(root, 'apps', 'client-shared', 'public', 'brand', f)).equals(readFileSync(join(out, 'brand', f)));
      assert.ok(same, `${f} must be the unmodified approved logo`);
    }
  });

  it('does not pretend unverified features exist: no income promises, no delivery-time or price claims', () => {
    for (const r of ROUTES) assert.doesNotMatch(html(r), /thu nhập (cao|ổn định)|bảo đảm|miễn phí giao|phút/i, r);
  });

  it('account deletion page links the backend page only when a URL is configured', () => {
    assert.doesNotMatch(html('/xoa-tai-khoan'), /href="[^"]*delete-account/);
  });
});
