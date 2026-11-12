// Page templates of the 11 landing site (/, /food, /ship + support and legal pages).
// Copy states only what the apps do today. Undecided facts (contact channel, legal text, store URL) are never invented.

import { existsSync, readFileSync } from 'node:fs';
import { TERMS_SECTIONS, PRIVACY_SECTIONS, TERMS_VERSION, PRIVACY_VERSION } from './legal.mjs';

// Settings come from site.config.json (next to src/), overridden by LANDING_* environment variables.
const CONFIG_PATH = new URL('../site.config.json', import.meta.url);
const FILE = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, '')) : {};
const ENV = {
  LANDING_SITE_URL: FILE.siteUrl, LANDING_PUBLISH: FILE.publish ? '1' : '', LANDING_PLAY_FOOD_URL: FILE.playFoodUrl,
  LANDING_PLAY_SHIP_URL: FILE.playShipUrl, LANDING_DELETE_ACCOUNT_URL: FILE.deleteAccountUrl,
  LANDING_GOOGLE_PLAY_URL: FILE.googlePlayUrl, LANDING_APP_STORE_URL: FILE.appStoreUrl,
  ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('LANDING_') && v !== undefined && v !== '')),
};
/** Support e-mail shown on /ho-tro. Empty until the Owner approves a public address. */
const CONTACT_EMAIL = FILE.contactEmail ?? '';
const CONTACT_PHONE = FILE.contactPhone ?? '';
const CONTACT_TEXT = [CONTACT_EMAIL && `Email: ${CONTACT_EMAIL}`, CONTACT_PHONE && `Điện thoại: ${CONTACT_PHONE}`].filter(Boolean).join(' · ');
/** Legal texts (HTML) shown on the privacy / terms pages. Empty = "being finalised" page. Only Owner-approved text goes here. */
const PRIVACY_HTML = FILE.privacyHtml ?? '';
const TERMS_HTML = FILE.termsHtml ?? '';
/** Public origin, e.g. https://example.vn. Unset until the Owner decides the domain: no canonical/og:url is emitted. */
export const SITE = (ENV.LANDING_SITE_URL ?? '').replace(/\/$/, '');
/** Publication switch: the site stays noindex until the Owner approves it (LANDING_PUBLISH=1 and a domain). */
export const PUBLISH = ENV.LANDING_PUBLISH === '1' && SITE !== '';
/** Google Play listing URLs. Unset = "coming soon" button, never a fake link. */
const PLAY = { food: ENV.LANDING_PLAY_FOOD_URL ?? '', ship: ENV.LANDING_PLAY_SHIP_URL ?? '' };
/** Store links of the download band (Owner to fill). Empty = "sắp có" badge. */
const STORE = { googlePlay: ENV.LANDING_GOOGLE_PLAY_URL ?? '', appStore: ENV.LANDING_APP_STORE_URL ?? '' };
/** Public account-deletion page of the backend (POST /v1/account-deletion/confirm). Unset until verified as deployed. */
const DELETE_URL = ENV.LANDING_DELETE_ACCOUNT_URL ?? '';

const img = (f, alt, w, h, extra = '') => `<img src="/img/${f}" alt="${alt}" width="${w}" height="${h}" decoding="async" ${extra}>`;
const NAV = [['/', 'Trang chủ'], ['/food', '11Food'], ['/ship', '11Ship'], ['/ho-tro', 'Hỗ trợ']];

const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-store" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9l1.5-5h13L20 9M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11zM5 14v6h14v-6M10 20v-4h4v4"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></symbol>
<symbol id="i-bag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></symbol>
<symbol id="i-bike" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h6l-3-8H9M15 9h3l1 5"/></symbol>
<symbol id="i-fork" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 21V3c-2.5 1-4 4-4 8h4"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5"/></symbol>
<symbol id="i-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v5H5a1 1 0 0 1-1-1zM20 13h-3v5h2a1 1 0 0 0 1-1z"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
</defs></svg>`;

/** Google Play button: a real link only when the listing URL is known; otherwise a non-interactive "coming soon" badge. */
const playBtn = (key, cls = 'btn--dark') => {
  const url = PLAY[key];
  return url
    ? `<a class="btn ${cls}" href="${url}" rel="noopener">${icon('play')}Tải trên Google Play</a>`
    : `<span class="btn ${cls} btn--soon" role="note">${icon('play')}Sắp có trên Google Play</span>`;
};

/** Badge of the download band: link when the URL is set, otherwise a "coming soon" note (never a fake link). */
const badge = (url, store, platform, logo) => {
  const mark = `<img class="store-logo" src="/img/store/${logo}" alt="" aria-hidden="true" width="28" height="28">`;
  return url
    ? `<a class="store" href="${url}" rel="noopener">${mark}<span><b>${store}</b><small>${platform}</small></span></a>`
    : `<span class="store store--soon" role="note">${mark}<span><b>${store}</b><small>${platform}: sắp có</small></span></span>`;
};

/** Store link for the download band: a real link only with a listing URL; otherwise a non-clickable "coming soon" badge. */
const storeLink = (key, name) => {
  const url = PLAY[key];
  return url
    ? `<a class="store" href="${url}" rel="noopener">${icon('play')}${name} trên Google Play</a>`
    : `<span class="store store--soon" role="note">${icon('play')}${name}: sắp có trên Google Play</span>`;
};

function layout({ path, title, desc, current, body, dark = false }) {
  const canonical = SITE === '' ? '' : `<link rel="canonical" href="${SITE}${path}"><meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/img/og-11.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`;
  const robots = PUBLISH ? '' : '<meta name="robots" content="noindex,nofollow">';
  const nav = NAV.map(([h, l]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">${robots}${canonical}
<meta property="og:type" content="website"><meta property="og:locale" content="vi_VN"><meta property="og:site_name" content="11"><meta name="twitter:card" content="summary_large_image"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta name="theme-color" content="#d8ad18"><link rel="icon" type="image/png" href="/brand/logo-11-ui.png">
<link rel="preload" href="/fonts/PlusJakartaSans-wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/site.css"></head>
<body>${SPRITE}<a class="skip" href="#main">Bỏ qua điều hướng</a>
<header class="top"><div class="wrap bar"><a class="brand" href="/" aria-label="11 — trang chủ"><img src="/brand/logo-11-ui.png" alt="11" width="66" height="44"></a>
<span class="loc">Cao Bằng</span><nav class="menu" aria-label="Chính">${nav}</nav>
<a class="btn btn--primary btn--sm bar-cta" href="/#tai-ung-dung">Tải ứng dụng</a>
<details class="burger"><summary aria-label="Mở menu">${icon('menu')}</summary><div class="drawer">${nav}</div></details></div></header>
<main id="main">${body}</main>
<footer><div class="wrap"><div class="fgrid">
<div><span class="logo-chip"><img src="/brand/logo-11-ui.png" alt="11 — Cần là có" width="54" height="36"></span><p><b>11 — Cần là có.</b><br>Đặt món và giao hàng tại Cao Bằng.</p></div>
<div><h3>Ứng dụng</h3><ul><li><a href="/food">11Food — Thèm là có</a></li><li><a href="/ship">11Ship — Gọi là có</a></li></ul></div>
<div><h3>Hỗ trợ</h3><ul><li><a href="/ho-tro">Trung tâm hỗ trợ</a></li><li><a href="/ho-tro#faq">Câu hỏi thường gặp</a></li><li><a href="/ho-tro#lien-he">Liên hệ</a></li></ul></div>
<div><h3>Pháp lý</h3><ul><li><a href="/chinh-sach-quyen-rieng-tu">Chính sách quyền riêng tư</a></li><li><a href="/dieu-khoan">Điều khoản sử dụng</a></li><li><a href="/xoa-tai-khoan">Yêu cầu xóa tài khoản</a></li></ul></div>
</div><p class="legal">© 11 — Cần là có.</p></div></footer></body></html>`;
}

const faq = (items) => items.map(([q, a]) => `<details class="qa"><summary>${q}</summary><p>${a}</p></details>`).join('');
const feat = (ic, t, d) => `<li><span class="ficon">${icon(ic)}</span><div><b>${t}</b><span>${d}</span></div></li>`;
const step = (t, d) => `<li><b>${t}</b><span>${d}</span></li>`;


const FAQ_COMMON = [
  ['Ứng dụng dùng ở đâu?', 'Tại Cao Bằng.'],
  ['Tôi cần gì để bắt đầu?', 'Điện thoại Android và một tài khoản đăng ký bằng số điện thoại, xác minh bằng mã SMS.'],
  ['Làm sao xóa tài khoản?', 'Xem trang <a href="/xoa-tai-khoan">Yêu cầu xóa tài khoản</a>.'],
];

/** Placeholders from the draft become neutral text on public pages (no internal notes). */
const neutral = (t) => t.replace(/\[CHỜ OWNER[^\]]*\]/g, (m) => (/EMAIL|KÊNH/.test(m) && CONTACT_TEXT !== '' ? CONTACT_TEXT : '[Thông tin đang được hoàn thiện]'));
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Full legal page. approvedHtml (Owner-approved text from site.config.json) replaces the draft when set. */
const legalPage = (title, lead, sections, version, slug, approvedHtml) => {
  if (approvedHtml !== '') return `<section class="doc"><div class="wrap narrow"><h1>${title}</h1>${approvedHtml}</div></section>`;
  const toc = sections.map((x) => `<a href="#${slug}-${x.id}">${esc(x.title)}</a>`).join('');
  const body = sections.map((x) => `<article class="legal-sec" id="${slug}-${x.id}"><h2>${esc(x.title)}</h2>${x.paragraphs.map((p) => `<p>${esc(neutral(p))}</p>`).join('')}</article>`).join('');
  return `<section class="doc legal"><div class="wrap">
<h1>${title}</h1><p class="lead">${lead}</p>
<p class="draft-note" role="note">Bản dự thảo ${version}. Nội dung đang được hoàn thiện và sẽ có hiệu lực khi được công bố chính thức.</p>
<div class="legal-grid"><nav class="toc" aria-label="Mục lục"><strong>Nội dung</strong>${toc}</nav><div class="legal-body">${body}</div></div>
</div></section>`;
};

export const pages = {
  '/': layout({
    path: '/', current: '/',
    title: '11 — Cần là có | 11Food và 11Ship tại Cao Bằng',
    desc: '11 — Cần là có. Một nơi cho nhu cầu đặt món và giao hàng tại Cao Bằng: 11Food cho khách đặt đồ ăn, 11Ship cho cửa hàng và shipper.',
    body: `<section class="hero hero--home"><div class="wrap hero-grid">
<div class="hero-text">
<p class="eyebrow-chip">${icon('pin')}Dịch vụ tại Cao Bằng</p>
<h1>11 — Cần là có.</h1>
<p class="lead">Một nơi cho nhu cầu đặt món và giao hàng tại Cao Bằng. Chọn dịch vụ bạn cần, mọi thứ đều dễ dàng hơn.</p>
<div class="cta"><a class="btn btn--primary" href="/food">Khám phá 11Food${icon('arrow')}</a><a class="btn btn--ghost" href="/ship">Khám phá 11Ship${icon('arrow')}</a></div>
<p class="muted small">Tập trung phục vụ nhu cầu tại địa phương</p>
</div>
<div class="hero-photos">
<div class="hp-main">${img('hero-home.webp', 'Thác Bản Giốc, Cao Bằng', 2000, 1100, 'fetchpriority="high"')}</div>
<div class="hp-food">${img('card-food.webp', 'Phở vịt, bánh cuốn và hạt dẻ Cao Bằng', 1200, 900, 'loading="lazy"')}</div>
<div class="hp-ship">${img('hero-ship.webp', 'Shipper 11Ship mặc đồng phục vàng', 1600, 1100, 'loading="lazy"')}</div>
</div></div></section>
<section class="svc-sec"><div class="wrap">
<p class="kicker">Chọn đúng dịch vụ</p>
<h2>Hai ứng dụng, cùng một trải nghiệm tiện lợi.</h2>
<div class="duo">
<article class="svc svc--food"><div class="svc-body"><img class="logo" src="/brand/logo-11food-ui.png" alt="11Food" width="175" height="69"><p class="tag">Thèm là có</p><p>Tìm quán, chọn món và đặt đồ ăn quanh bạn.</p><a class="btn btn--primary" href="/food">Tìm hiểu 11Food${icon('arrow')}</a></div>${img('card-food.webp', 'Phở vịt và bánh cuốn Cao Bằng', 1200, 900, 'loading="lazy"')}</article>
<article class="svc svc--ship"><div class="svc-body"><img class="logo" src="/brand/logo-11ship-ui.png" alt="11Ship" width="175" height="87"><p class="tag">Gọi là có</p><p>Dành cho cửa hàng và shipper kết nối giao hàng.</p><a class="btn btn--dark-cta" href="/ship">Tìm hiểu 11Ship${icon('arrow')}</a></div>${img('hero-ship.webp', 'Shipper 11Ship mặc đồng phục vàng', 1600, 1100, 'loading="lazy"')}</article>
</div></div></section>
<section class="pull"><div class="wrap"><ul class="feats feats--card">
${feat('fork', 'Đặt món dễ dàng', 'Xem quán và chọn món.')}
${feat('bike', 'Giao hàng tiện lợi', 'Kết nối với shipper.')}
${feat('pin', 'Phục vụ Cao Bằng', 'Tập trung địa phương.')}
${feat('check', 'Rõ ràng, dễ dùng', 'Theo dõi đơn hàng.')}</ul></div></section>
<section class="dl-sec" id="tai-ung-dung"><div class="wrap"><div class="dl">
<div><h2>Sẵn sàng trải nghiệm 11?</h2><p>11Food và 11Ship dành cho Android và iOS.</p></div>
<div class="stores">${badge(STORE.googlePlay, 'Google Play', 'Android', 'google-play.svg')}${badge(STORE.appStore, 'App Store', 'iOS', 'app-store.svg')}</div>
</div></div></section>`,
  }),

  '/food': layout({
    path: '/food', current: '/food',
    title: '11Food — Thèm là có | Đặt đồ ăn tại Cao Bằng',
    desc: '11Food — Thèm là có. Khám phá quán ăn, chọn món yêu thích và đặt đồ ăn tại Cao Bằng.',
    body: `<section class="hero hero--food"><div class="hero-art hero-art--food">${img('hero-food.webp', 'Đặc sản Cao Bằng: phở vịt, bánh cuốn, chả và hạt dẻ', 2000, 1100, 'fetchpriority="high"')}</div><div class="wrap hero-text">
<span class="chip">${icon('pin')}Cao Bằng</span>
<p class="brandline"><img src="/brand/logo-11food-ui.png" alt="11Food" width="200" height="80"><span>| Thèm là có</span></p>
<h1>Đói bụng? Mở 11Food.</h1><p class="lead">Khám phá quán ăn, chọn món yêu thích và đặt đồ ăn tại Cao Bằng.</p>${playBtn('food')}</div></section>
<section class="pull"><div class="wrap"><ul class="feats feats--card">
${feat('store', 'Khám phá quán ăn', 'Tìm quán ăn, cafe và nhiều món ngon quanh bạn.')}
${feat('search', 'Chọn món dễ dàng', 'Xem thực đơn, chọn món yêu thích.')}
${feat('bag', 'Đặt món nhanh gọn', 'Xác nhận đơn và đặt món ngay trên điện thoại.')}
${feat('pin', 'Theo dõi đơn hàng', 'Xem trạng thái đơn hàng trong ứng dụng.')}</ul></div></section>
<section><div class="wrap"><h2>Đặt món đơn giản</h2><ol class="steps">${step('Chọn quán', 'Xem danh sách quán và thực đơn.')}${step('Chọn món', 'Tìm món bạn thèm, thêm vào đơn.')}${step('Đặt món', 'Xác nhận địa chỉ nhận và đặt.')}${step('Theo dõi đơn', 'Xem trạng thái đơn hàng.')}</ol></div></section>
<section><div class="wrap narrow"><h2>Câu hỏi thường gặp</h2>${faq([['11Food dùng cho ai?', 'Khách hàng muốn đặt đồ ăn. Cửa hàng và shipper dùng <a href="/ship">11Ship</a>.'], ...FAQ_COMMON])}</div></section>`,
  }),

  '/ship': layout({
    path: '/ship', current: '/ship',
    title: '11Ship — Gọi là có | Giao hàng cho cửa hàng và shipper tại Cao Bằng',
    desc: '11Ship — Gọi là có. Ứng dụng dành cho cửa hàng và shipper tại Cao Bằng.',
    body: `<section class="hero hero--ship"><div class="hero-art hero-art--ship">${img('hero-ship.webp', 'Shipper 11Ship mặc đồng phục vàng', 1600, 1100, 'fetchpriority="high"')}</div><div class="wrap hero-text"><div>
<span class="chip">${icon('pin')}Cao Bằng</span>
<p class="brandline"><img src="/brand/logo-11ship-ui.png" alt="11Ship" width="200" height="100"><span>| Gọi là có</span></p>
<h1>Có hàng cần giao? Mở 11Ship.</h1><p class="lead">Ứng dụng dành cho cửa hàng và shipper tại Cao Bằng.</p>${playBtn('ship')}</div></div></section>
<section><div class="wrap"><h2>Dành cho ai?</h2><div class="duo">
<article class="who"><span class="ficon">${icon('store')}</span><div><h3>Cửa hàng</h3><p>Gọi shipper và theo dõi từng đơn giao hàng.</p></div></article>
<article class="who"><span class="ficon">${icon('bike')}</span><div><h3>Shipper</h3><p>Nhận đơn, giao hàng và theo dõi các chuyến của mình.</p></div></article></div>
<p class="muted">Một tài khoản có thể có cả hai vai trò; sau khi đăng nhập bạn chọn vai trò muốn dùng.</p></div></section>
<section class="alt"><div class="wrap"><h2>Cách hoạt động</h2><div class="duo">
<div><h3>Cửa hàng</h3><ol class="steps steps--one">${step('Đăng ký', 'Tạo tài khoản và hồ sơ cửa hàng.')}${step('Gọi shipper', 'Nhập điểm lấy và điểm giao.')}${step('Theo dõi', 'Xem trạng thái giao nhận.')}</ol></div>
<div><h3>Shipper</h3><ol class="steps steps--one">${step('Đăng ký', 'Tạo hồ sơ shipper để được duyệt.')}${step('Nhận đơn', 'Chọn đơn trong khu vực hoạt động.')}${step('Giao hàng', 'Cập nhật trạng thái chuyến giao.')}</ol></div></div></div></section>
<section><div class="wrap narrow"><h2>Câu hỏi thường gặp</h2>${faq([['11Ship dùng cho ai?', 'Cửa hàng và shipper. Muốn đặt đồ ăn, hãy dùng <a href="/food">11Food</a>.'], ['Tài khoản được duyệt như thế nào?', 'Hồ sơ quán hoặc hồ sơ shipper cần được duyệt trước khi bạn có thể bán hàng hoặc nhận đơn.'], ...FAQ_COMMON])}</div></section>`,
  }),

  '/ho-tro': layout({
    path: '/ho-tro', current: '/ho-tro',
    title: 'Hỗ trợ — 11Food và 11Ship', desc: 'Câu hỏi thường gặp và hỗ trợ người dùng 11Food, 11Ship.',
    body: `<section class="doc"><div class="wrap narrow"><h1>Hỗ trợ</h1><p class="lead">Giải đáp nhanh cho người dùng 11Food và 11Ship.</p>
<h2 id="faq">Câu hỏi thường gặp</h2>${faq([['11Food và 11Ship khác nhau thế nào?', '11Food dành cho khách hàng đặt đồ ăn. 11Ship dành cho cửa hàng và shipper.'], ['Dịch vụ phục vụ ở đâu?', 'Tại Cao Bằng.'], ['Mã xác minh gửi đến đâu?', 'Mã được gửi bằng tin nhắn SMS tới số điện thoại bạn nhập khi đăng ký.'], ['Tôi muốn xóa tài khoản?', 'Xem trang <a href="/xoa-tai-khoan">Yêu cầu xóa tài khoản</a>.']])}
<h2 id="lien-he">Liên hệ</h2>${CONTACT_TEXT === '' ? '<p>Thông tin liên hệ hỗ trợ sẽ được cập nhật tại trang này.</p>' : `<p>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><br>Điện thoại: <a href="tel:${CONTACT_PHONE.replace(/s/g, '')}">${CONTACT_PHONE}</a></p>`}</div></section>`,
  }),

  '/chinh-sach-quyen-rieng-tu': layout({
    path: '/chinh-sach-quyen-rieng-tu', current: '',
    title: 'Chính sách quyền riêng tư — 11Food và 11Ship', desc: 'Chính sách quyền riêng tư của 11Food và 11Ship: dữ liệu nào được xử lý, vì sao, và quyền của bạn.',
    body: legalPage('Chính sách quyền riêng tư', 'Áp dụng cho khách hàng, chủ quán và shipper khi dùng 11Food và 11Ship.', PRIVACY_SECTIONS, PRIVACY_VERSION, 'privacy', PRIVACY_HTML),
  }),

  '/dieu-khoan': layout({
    path: '/dieu-khoan', current: '',
    title: 'Điều khoản sử dụng — 11Food và 11Ship', desc: 'Điều khoản sử dụng 11Food và 11Ship cho khách hàng, chủ quán và shipper.',
    body: legalPage('Điều khoản sử dụng', 'Áp dụng cho khách hàng, chủ quán và shipper trong hệ sinh thái 11Food và 11Ship.', TERMS_SECTIONS, TERMS_VERSION, 'terms', TERMS_HTML),
  }),

  '/xoa-tai-khoan': layout({
    path: '/xoa-tai-khoan', current: '',
    title: 'Yêu cầu xóa tài khoản — 11Food và 11Ship', desc: 'Hướng dẫn yêu cầu xóa tài khoản 11Food và 11Ship.',
    body: `<section class="doc"><div class="wrap narrow"><h1>Yêu cầu xóa tài khoản</h1><p class="lead">Áp dụng cho tài khoản 11Food và tài khoản 11Ship (cửa hàng, shipper). Hai ứng dụng dùng chung một tài khoản đăng nhập bằng số điện thoại.</p>
${DELETE_URL === '' ? '<p>Chức năng yêu cầu xóa tài khoản trực tuyến đang được hoàn thiện và sẽ mở tại trang này.</p>' : `<p>Bạn cần số điện thoại và mật khẩu của tài khoản.</p><p><a class="btn btn--primary" href="${DELETE_URL}">Tiếp tục yêu cầu xóa tài khoản</a></p>`}</div></section>`,
  }),
};
