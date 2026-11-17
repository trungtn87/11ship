// Landing site (apps/landing-web): builds into a temp folder and checks links, assets, SEO basics, a11y basics and brand rules.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as legal from '../../apps/landing-web/src/legal.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = mkdtempSync(join(tmpdir(), 'landing-'));
const ROUTES = ['/', '/food', '/ship', '/ho-tro', '/chinh-sach-quyen-rieng-tu', '/dieu-khoan-su-dung', '/xoa-tai-khoan'];
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
      for (const img of page.match(/<img [^>]*>/g) ?? []) {
        if (img.includes('aria-hidden="true"')) continue; // decorative logo next to a visible store name
        assert.match(img, /alt="[^"]+"/, `${r} ${img}`);
      }
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
    assert.match(html('/'), /sắp có/i);
  });

  it('uses the Figma design-system tokens (page 05): yellow, ink, soft grey, Be Vietnam Pro', () => {
    const home = html('/');
    assert.match(home, /Cần là có/);
    assert.match(html('/food'), /Thèm là có/);
    assert.match(html('/ship'), /Gọi là có/);
    const css = readFileSync(join(out, 'site.css'), 'utf8');
    assert.match(css, /--brand: #ffd400/i);
    assert.match(css, /--ink: #141414/i);
    assert.match(css, /--soft: #f5f5f7/i);
    assert.match(css, /font-family: 'Be Vietnam Pro'/);
    for (const w of [400, 500, 700, 800, 900]) {
      assert.ok(statSync(join(out, 'fonts', `BeVietnamPro-latin-${w}.woff2`)).size > 10_000, `font ${w}`);
      assert.ok(statSync(join(out, 'fonts', `BeVietnamPro-vietnamese-${w}.woff2`)).size > 10_000, `vi font ${w}`);
    }
    for (const f of readdirSync(join(out, 'brand'))) {
      const same = readFileSync(join(root, 'apps', 'client-shared', 'public', 'brand', f)).equals(readFileSync(join(out, 'brand', f)));
      assert.ok(same, `${f} must be the unmodified approved logo`);
    }
  });

  it('does not pretend unverified features exist: no income promises, no delivery-time or price claims', () => {
    for (const r of ROUTES) assert.doesNotMatch(html(r), /thu nhập (cao|ổn định)|bảo đảm|miễn phí giao|phút/i, r);
  });

  it('menu has exactly the four Figma items in order, on every page', () => {
    for (const r of ROUTES.slice(0, 4)) {
      const menu = html(r).match(/<nav class="menu" aria-label="Chính">([\s\S]*?)<\/nav>/)[1];
      const items = [...menu.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
      assert.deepEqual(items, [['/', 'Trang chủ'], ['/food', '11Food'], ['/ship', '11Ship'], ['/ho-tro', 'Câu hỏi thường gặp']], r);
    }
  });

  it('footer links the three legal and account pages on every page', () => {
    for (const r of ROUTES) {
      for (const p of ['/chinh-sach-quyen-rieng-tu', '/dieu-khoan-su-dung', '/xoa-tai-khoan']) {
        assert.ok(html(r).includes(`href="${p}"`), `${r} -> ${p}`);
      }
    }
  });

  it('FAQ page shows the four Figma questions and no answer invented for the unanswered ones', () => {
    const faq = html('/ho-tro');
    assert.equal((faq.match(/<details class="qa"/g) ?? []).length, 4);
    assert.match(faq, /Cách đặt món và theo dõi đơn trên 11Food\?/);
    assert.match(faq, /Làm sao đăng ký quán ăn lên 11Food\?/);
    assert.equal((faq.match(/đang được cập nhật/g) ?? []).length, 3);
  });

  it('account deletion page links the backend page only when a URL is configured', () => {
    assert.doesNotMatch(html('/xoa-tai-khoan'), /href="[^"]*delete-account/);
  });

  it('legal pages use the PR #340 paths, versions and cross-links', () => {
    assert.match(html('/dieu-khoan-su-dung'), /Mã phiên bản: terms-20261114-v3/);
    assert.match(html('/chinh-sach-quyen-rieng-tu'), /Mã phiên bản: privacy-20261114-v3/);
    assert.match(html('/chinh-sach-quyen-rieng-tu'), /href="\/dieu-khoan-su-dung"/);
    assert.match(html('/dieu-khoan-su-dung'), /href="\/chinh-sach-quyen-rieng-tu"/);
    assert.match(html('/'), /href="\/dieu-khoan-su-dung"/);
    assert.doesNotMatch(html('/'), /href="\/dieu-khoan"/);
    assert.equal(existsSync(join(out, 'dieu-khoan')), false, 'old /dieu-khoan path must not be built');
  });
});

// Drift guard: legal.mjs must equal the PR #340 sources on main. The branch is rebased on main (includes #340), so the
// comparison runs; the skip branch only applies if a checkout ever lacks the sources, and then says so explicitly.
describe('legal text matches PR #340 sources', () => {
  const termsSrc = join(root, 'apps', 'backend', 'src', 'legal', 'terms-page.ts');
  const privacySrc = join(root, 'apps', 'backend', 'src', 'legal', 'privacy-page.ts');
  const haveSources = existsSync(termsSrc) && existsSync(privacySrc);
  const skip = haveSources ? false : 'PR #340 chưa có trong repo (cần merge và rebase nhánh này lên main)';

  // Flatten [id, title, ...paragraphs] per section so the comparison is exact and order-sensitive.
  const flat = (sections) => sections.flatMap((s) => [s.id, s.title, ...s.paragraphs]);

  it('versions, paths and section counts are correct (always checked)', () => {
    assert.equal(legal.TERMS_PAGE_VERSION, 'terms-20261114-v3');
    assert.equal(legal.PRIVACY_PAGE_VERSION, 'privacy-20261114-v3');
    assert.equal(legal.TERMS_PAGE_PATH, 'dieu-khoan-su-dung');
    assert.equal(legal.PRIVACY_PAGE_PATH, 'chinh-sach-quyen-rieng-tu');
    assert.equal(legal.TERMS_SECTIONS.length, 16);
    assert.equal(legal.PRIVACY_SECTIONS.length, 12);
  });

  it('no draft placeholders or draft labels remain in legal.mjs (always checked)', () => {
    const text = readFileSync(join(root, 'apps', 'landing-web', 'src', 'legal.mjs'), 'utf8');
    assert.doesNotMatch(text, /CHỜ|DỰ THẢO|dự thảo|chưa có hiệu lực|\[[A-ZĐ ]{8,}\]/);
  });

  it('terms text equals terms-page.ts from PR #340', { skip }, () => {
    const src = readFileSync(termsSrc, 'utf8');
    const block = src.match(/const sections: readonly TermsSection\[\] = (\[[\s\S]*?\n\]);/)[1];
    assert.equal(src.match(/export const TERMS_PAGE_VERSION = '([^']+)'/)[1], legal.TERMS_PAGE_VERSION);
    assert.deepEqual(flat(JSON.parse(block)), flat(legal.TERMS_SECTIONS));
  });

  it('privacy text equals privacy-page.ts from PR #340', { skip }, () => {
    const src = readFileSync(privacySrc, 'utf8');
    const decode = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const sections = [...src.matchAll(/<section id="([^"]+)"><h2>([^<]*)<\/h2>([\s\S]*?)<\/section>/g)].map(([, id, title, inner]) => ({
      id, title: decode(title), paragraphs: [...inner.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1])),
    }));
    assert.equal(src.match(/export const PRIVACY_PAGE_VERSION = '([^']+)'/)[1], legal.PRIVACY_PAGE_VERSION);
    assert.deepEqual(flat(sections), flat(legal.PRIVACY_SECTIONS));
  });
});
