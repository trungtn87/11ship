// Page templates of the 11 landing site, rebuilt from the Figma UI kit "11 · 11Food & 11Ship · Website UI Kit"
// (pages 01 Trang chủ, 02 11Food, 03 11Ship Tài xế, 04 FAQ & Hỗ trợ, 05 Hệ thống thiết kế).
// Copy follows the Figma frames. Undecided facts (store URLs, support e-mail, FAQ answers not in the design) are never invented:
// they render as "Sắp có" or "đang cập nhật" states until the Owner supplies them.

import { existsSync, readFileSync } from 'node:fs';
import { TERMS_SECTIONS, PRIVACY_SECTIONS, TERMS_PAGE_VERSION, PRIVACY_PAGE_VERSION, LEGAL_EFFECTIVE_DATE } from './legal.mjs';

// Settings come from site.config.json (next to src/), overridden by LANDING_* environment variables.
const CONFIG_PATH = new URL('../site.config.json', import.meta.url);
const FILE = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, '')) : {};
const ENV = {
  LANDING_SITE_URL: FILE.siteUrl, LANDING_PUBLISH: FILE.publish ? '1' : '', LANDING_PLAY_FOOD_URL: FILE.playFoodUrl,
  LANDING_PLAY_SHIP_URL: FILE.playShipUrl,
  LANDING_GOOGLE_PLAY_URL: FILE.googlePlayUrl, LANDING_APP_STORE_URL: FILE.appStoreUrl,
  ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('LANDING_') && v !== undefined && v !== '')),
};
/** Support e-mail for the "Liên hệ ngay" band of the FAQ page. Empty = "Sắp có" state, never a made-up address. */
const CONTACT_EMAIL = FILE.contactEmail ?? '';
/** Legal texts (HTML) that override the PR #340 text in legal.mjs. Empty = use legal.mjs. Only Owner-approved text goes here. */
const PRIVACY_HTML = FILE.privacyHtml ?? '';
const TERMS_HTML = FILE.termsHtml ?? '';
/** Public origin, e.g. https://11local.vn. Unset = no canonical/og:url is emitted. */
export const SITE = (ENV.LANDING_SITE_URL ?? '').replace(/\/$/, '');
/** Publication switch: the site stays noindex until the Owner approves it (LANDING_PUBLISH=1 and a domain). */
export const PUBLISH = ENV.LANDING_PUBLISH === '1' && SITE !== '';
/** Google Play listing URLs per app. Unset = "Sắp có" state, never a fake link. */
const PLAY = { food: ENV.LANDING_PLAY_FOOD_URL ?? '', ship: ENV.LANDING_PLAY_SHIP_URL ?? '' };
/** Store URLs of the shared badges. Unset = "Sắp có" state. */
const STORE = { googlePlay: ENV.LANDING_GOOGLE_PLAY_URL ?? '', appStore: ENV.LANDING_APP_STORE_URL ?? '' };

const img = (f, alt, w, h, extra = '') => `<img src="/img/${f}" alt="${alt}" width="${w}" height="${h}" decoding="async" ${extra}>`;
const fig = (f, alt, w, h, extra = '') => img(`figma/${f}`, alt, w, h, extra);
const NAV = [['/', 'Trang chủ'], ['/food', '11Food'], ['/ship', '11Ship'], ['/ho-tro', 'Câu hỏi thường gặp']];

const icon = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></symbol>
</defs></svg>`;

/** Google Play action: a real link only when the listing URL is known; otherwise a "Sắp có" note. */
const playBtn = (key, cls = 'btn--dark') => {
  const url = PLAY[key];
  return url
    ? `<a class="btn ${cls}" href="${url}" rel="noopener">${icon('play')}Tải trên Google Play</a>`
    : `<span class="btn ${cls} btn--soon" role="note">${icon('play')}Sắp có trên Google Play</span>`;
};

/** Store badge (black pill of the Figma design). Link only when a URL is set; otherwise a "Sắp có" note. */
const storeBadge = (kind) => {
  const isIos = kind === 'appStore';
  const url = STORE[kind];
  const small = isIos ? 'Download on the' : 'GET IT ON';
  const big = isIos ? 'App Store' : 'Google Play';
  const logo = isIos ? 'app-store.svg' : 'google-play.svg';
  const inner = `<img class="store-logo" src="/img/store/${logo}" alt="" aria-hidden="true" width="20" height="20"><span><small>${small}</small><b>${big}</b></span>`;
  return url
    ? `<a class="store-badge" href="${url}" rel="noopener">${inner}</a>`
    : `<span class="store-badge store--soon" role="note" aria-label="${big}: sắp có">${inner}<em>Sắp có</em></span>`;
};

/** Contact action of the FAQ band: a mailto only when a support e-mail is configured. */
const contactBtn = () => (CONTACT_EMAIL
  ? `<a class="btn btn--primary" href="mailto:${CONTACT_EMAIL}">Liên hệ ngay</a>`
  : '<span class="btn btn--primary btn--soon" role="note">Sắp có</span>');

/** Partner CTA ("Đăng ký ngay" / "Đăng ký tài xế"): no destination in the design yet, so it is a "Sắp có" state. */
const soonCta = (label) => `<span class="btn btn--dark btn--soon" role="note">${label}<em>Sắp có</em></span>`;

function layout({ path, title, desc, current, body, variant = 'ink', pill = '<span class="pill">Cao Bằng</span>', logo = 'logo-11-ui.png', logoW = 66, logoH = 44 }) {
  const canonical = SITE === '' ? '' : `<link rel="canonical" href="${SITE}${path}"><meta property="og:url" content="${SITE}${path}"><meta property="og:image" content="${SITE}/img/og-11.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`;
  const robots = PUBLISH ? '' : '<meta name="robots" content="noindex,nofollow">';
  const nav = NAV.map(([h, l]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">${robots}${canonical}
<meta property="og:type" content="website"><meta property="og:locale" content="vi_VN"><meta property="og:site_name" content="11"><meta name="twitter:card" content="summary_large_image"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
<meta name="theme-color" content="#FFD400"><link rel="icon" type="image/png" href="/brand/logo-11-ui.png">
<link rel="preload" href="/fonts/BeVietnamPro-vietnamese-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css"></head>
<body class="v-${variant}">${SPRITE}<a class="skip" href="#main">Bỏ qua điều hướng</a>
<header class="top"><div class="wrap bar">
<a class="brand" href="/" aria-label="11 — trang chủ"><img src="/brand/${logo}" alt="${logo.startsWith('logo-11-') ? '11' : logo.startsWith('logo-11food') ? '11Food' : '11Ship'}" width="${logoW}" height="${logoH}"></a>
${pill}
<nav class="menu" aria-label="Chính">${nav}</nav>
<details class="burger"><summary aria-label="Mở menu">${icon('menu')}</summary><div class="drawer">${nav}</div></details></div></header>
<main id="main">${body}</main>
<footer class="foot"><div class="wrap foot-in">
<div class="foot-brand"><img src="/brand/logo-11-ui.png" alt="11" width="36" height="24"><b>Cần là có.</b></div>
<nav class="foot-links" aria-label="Ứng dụng"><a href="/food">11Food — Thèm là có</a><a href="/ship">11Ship — Gọi là có</a><a href="/ho-tro">Câu hỏi thường gặp</a></nav>
<nav class="foot-legal" aria-label="Pháp lý"><a href="/chinh-sach-quyen-rieng-tu">Chính sách quyền riêng tư</a><a href="/dieu-khoan-su-dung">Điều khoản sử dụng</a><a href="/xoa-tai-khoan">Yêu cầu xóa tài khoản</a></nav>
<p class="copy">© 2026 11 Cao Bằng</p>
</div></footer></body></html>`;
}

const cityPill = (dark) => `<span class="pill ${dark ? 'pill--dark' : 'pill--soft'}">${icon('pin')}Cao Bằng ${icon('chev')}</span>`;
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** FAQ: the four questions of the Figma frame. Answers not in the design are shown as "being updated", never invented. */
const FAQ_ITEMS = [
  ['Cách đặt món và theo dõi đơn trên 11Food?', 'Mở 11Food, chọn địa chỉ giao, chọn quán và món ăn. Kiểm tra phí, xác nhận đơn rồi theo dõi trạng thái và tài xế trong phần Đơn hàng.', true],
  ['Đăng ký tài xế 11Ship cần hồ sơ gì?', null],
  ['Phí giao hàng tại Cao Bằng tính thế nào?', null],
  ['Làm sao đăng ký quán ăn lên 11Food?', null],
];
const FAQ_PENDING = 'Câu trả lời đang được cập nhật.';

/** Full legal page. Text is the approved PR #340 text (legal.mjs); approvedHtml, when set in site.config.json, overrides it. */
const legalPage = ({ title, sections, version, slug, approvedHtml, crossHref, crossLabel }) => {
  if (approvedHtml !== '') return `<section class="doc"><div class="wrap narrow"><h1>${title}</h1>${approvedHtml}</div></section>`;
  const toc = sections.map((x) => `<a href="#${slug}-${x.id}">${esc(x.title)}</a>`).join('');
  const body = sections.map((x) => `<article class="legal-sec" id="${slug}-${x.id}"><h2>${esc(x.title)}</h2>${x.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</article>`).join('');
  return `<section class="doc legal-page"><div class="wrap">
<h1>${title}</h1>
<p class="meta">Ngày hiệu lực: ${LEGAL_EFFECTIVE_DATE} · Mã phiên bản: ${version}</p>
<p class="meta"><a href="${crossHref}">${crossLabel}</a></p>
<div class="legal-grid"><nav class="toc" aria-label="Mục lục"><strong>Nội dung</strong>${toc}</nav><div class="legal-body">${body}</div></div>
</div></section>`;
};

export const pages = {
  '/': layout({
    path: '/', current: '/',
    title: '11 — Cần là có | 11Food và 11Ship tại Cao Bằng',
    desc: '11 — Cần là có. Hệ sinh thái đặt đồ ăn 11Food và giao hàng 11Ship dành riêng cho người Cao Bằng.',
    pill: cityPill(true),
    body: `<section class="hero hero--home"><div class="wrap hero-grid">
<div class="hero-text">
<h1>ĐẶT MÓN CỰC NHANH –<br>GIAO HÀNG CỰC CHẤT</h1>
<p class="hero-sub">Hệ sinh thái đặt đồ ăn 11Food và giao hàng siêu tốc 11Ship dành riêng cho người Cao Bằng.</p>
<div class="cta-row"><a class="btn btn--dark" href="/food">Đặt món 11Food</a><a class="btn btn--outline" href="/ship">Tài xế 11Ship</a></div>
</div>
<div class="hero-art">${fig('hub-hero.png', 'Điện thoại hiển thị theo dõi đơn 11Food, shipper 11Ship và các món ăn Cao Bằng', 690, 440, 'fetchpriority="high"')}</div>
</div></section>

<section class="svc-sec"><div class="wrap">
<div class="sec-head"><h2>DỊCH VỤ CỦA 11</h2><h2>ĐỒNG HÀNH CÙNG 11</h2></div>
<div class="svc-grid">
<article class="svc svc--food">
  <h3>11Food</h3><p class="svc-sub">Delivery</p>
  <div class="svc-art">${fig('pho.png', 'Phở vịt', 150, 130, '')}</div>
  <a class="svc-cta" href="/food">Khám phá 11Food ›</a>
</article>
<article class="svc svc--ship">
  <h3>11Ship</h3><p class="svc-sub">Courier</p>
  <div class="svc-art">${fig('rider.png', 'Shipper 11Ship', 165, 143, '')}</div>
  <a class="svc-cta" href="/ship">Khám phá 11Ship ›</a>
</article>
<article class="partner partner--food">
  <p class="partner-kicker">Trở thành</p><h3>Đối tác Nhà hàng</h3>
  <p>Đưa món ngon của quán đến gần hơn với khách hàng Cao Bằng.</p>
  ${soonCta('Đăng ký ngay')}
</article>
<article class="partner partner--ship">
  <p class="partner-kicker">Đăng ký</p><h3>Tài xế 11Ship</h3>
  <p>Chủ động nhận đơn, giao hàng và theo dõi thu nhập mỗi ngày.</p>
  ${soonCta('Đăng ký ngay')}
</article>
</div></div></section>`,
  }),

  '/food': layout({
    path: '/food', current: '/food', variant: 'white',
    title: '11Food — Thèm là có | Đặt đồ ăn tại Cao Bằng',
    desc: '11Food — Thèm là có. Khám phá quán ăn, chọn món yêu thích và đặt đồ ăn tại Cao Bằng.',
    logo: 'logo-11food-ui.png', logoW: 145, logoH: 46,
    pill: cityPill(false),
    body: `<section class="hero hero--food"><div class="wrap hero-grid">
<div class="hero-text">
<h1>ĂN NGON TẠI NHÀ,<br>KHÔNG LO ĐI XA</h1>
<p class="hero-sub">Đủ món ngon quanh Cao Bằng —<br>Chạm là đặt, shipper giao liền.</p>
<div class="store-row">${storeBadge('appStore')}${storeBadge('googlePlay')}</div>
<div class="cta-row">${playBtn('food')}</div>
</div>
<div class="hero-art">${fig('food-hero.png', 'Đặc sản Cao Bằng và món ăn trên ứng dụng 11Food', 650, 484, 'fetchpriority="high"')}</div>
</div></section>

<section class="showcase"><div class="wrap">
<h2>TRẢI NGHIỆM ĐẶT MÓN TIỆN LỢI</h2>
<div class="phones">${fig('phone-food.png', '11Food: danh sách món ăn Cao Bằng', 245, 497)}${fig('phone-tracking.png', '11Food: theo dõi đơn hàng', 245, 497)}</div>
</div></section>

<section class="dl-band"><div class="wrap dl-band-in">
<img class="dl-logo" src="/brand/logo-11-ui.png" alt="11" width="54" height="36">
<div><b>Tải 11Food ngay</b><span>Trải nghiệm ngay</span></div>
<div class="store-row store-row--dark">${storeBadge('appStore')}${storeBadge('googlePlay')}</div>
</div></section>`,
  }),

  '/ship': layout({
    path: '/ship', current: '/ship', variant: 'ink',
    title: '11Ship — Gọi là có | Giao hàng cho cửa hàng và shipper tại Cao Bằng',
    desc: '11Ship — Gọi là có. Ứng dụng dành cho cửa hàng và shipper tại Cao Bằng.',
    logo: 'logo-11ship-ui.png', logoW: 145, logoH: 41,
    pill: '<span class="pill pill--ok">✓ Tài xế</span>',
    body: `<section class="hero hero--ship"><div class="wrap hero-grid">
<div class="hero-text">
<h1>NHẬN ĐƠN<br>CÙNG 11SHIP</h1>
<p class="hero-sub">Bật app là có đơn, chủ động thời gian, thu nhập minh bạch mỗi ngày.</p>
<div class="cta-row">${soonCta('Đăng ký tài xế')}</div>
</div>
<div class="hero-art">${fig('ship-hero.png', 'Shipper 11Ship trên đường giao hàng Cao Bằng', 380, 406, 'fetchpriority="high"')}</div>
</div></section>

<section class="driver-sec"><div class="wrap">
<h2>TRẢI NGHIỆM ỨNG DỤNG TÀI XẾ</h2>
<div class="driver-grid">
<div class="phones phones--3">${fig('phone-driver.png', '11Ship: màn hình nhận đơn', 175, 355)}${fig('phone-earnings.png', '11Ship: thu nhập hàng ngày', 175, 355)}${fig('phone-tracking-ship.png', '11Ship: bản đồ dẫn đường', 175, 355)}</div>
<div class="benefits">
<article class="benefit"><span class="b-ico" aria-hidden="true">◷</span><h3>Thời gian linh hoạt</h3><p>Chủ động nhận đơn theo thời gian của bạn.</p></article>
<article class="benefit"><span class="b-ico" aria-hidden="true">▣</span><h3>Thu nhập hấp dẫn</h3><p>Theo dõi thu nhập rõ ràng sau mỗi chuyến giao.</p></article>
</div>
</div>
</div></section>

<section class="dl-band dl-band--ship"><div class="wrap dl-band-in">
<img class="dl-logo" src="/brand/logo-11-ui.png" alt="11" width="54" height="36">
<div><b>Tải app 11Ship Tài xế</b><span>Trải nghiệm ngay</span></div>
<div class="store-row store-row--dark">${storeBadge('appStore')}${storeBadge('googlePlay')}</div>
</div></section>`,
  }),

  '/ho-tro': layout({
    path: '/ho-tro', current: '/ho-tro', variant: 'help',
    title: 'Câu hỏi thường gặp — 11Food và 11Ship', desc: 'Câu hỏi thường gặp và hỗ trợ 11Food, 11Ship: đặt món, giao hàng, tài khoản và liên hệ.',
    logo: 'logo-11-ui.png', logoW: 66, logoH: 44,
    pill: '<span class="pill pill--help">✓ Trợ giúp</span>',
    body: `<section class="search-hero"><div class="wrap search-hero-in">
<div class="search-text">
<h1>CÂU HỎI THƯỜNG<br>GẶP &amp; HỖ TRỢ</h1>
<p class="hero-sub">Tìm kiếm câu hỏi, giải quyết mọi thắc mắc ngay!</p>
<div class="search" role="presentation"><span class="search-ico" aria-hidden="true">${icon('search')}</span><span>Tìm kiếm câu hỏi...</span></div>
</div>
<div class="search-art">${fig('support-art.png', 'Minh họa trung tâm hỗ trợ 11', 330, 286)}</div>
</div></section>

<section class="faq-sec"><div class="wrap">
<div class="filters" aria-hidden="true"><span class="fpill fpill--on">Tất cả</span><span class="fpill">Đặt món 11Food</span><span class="fpill">Tài xế 11Ship</span><span class="fpill">Đối tác quán</span></div>
<h2>CÂU HỎI PHỔ BIẾN</h2>
<div class="faq-list">
${FAQ_ITEMS.map(([q, a, open]) => `<details class="qa"${open ? ' open' : ''}><summary><span>${q}</span><span class="qa-mark" aria-hidden="true">${open ? '⌄' : '+'}</span></summary><p>${a ?? FAQ_PENDING}</p></details>`).join('')}
</div>
<div class="direct"><img src="/brand/logo-11-ui.png" alt="11" width="46" height="31">
<div><b>Cần hỗ trợ trực tiếp?</b><span>Trò chuyện với chúng tôi</span></div>${contactBtn()}</div>
</div></section>`,
  }),

  '/chinh-sach-quyen-rieng-tu': layout({
    path: '/chinh-sach-quyen-rieng-tu', current: '', variant: 'white',
    title: 'Chính sách quyền riêng tư — 11Food và 11Ship', desc: 'Chính sách quyền riêng tư của 11Food và 11Ship: dữ liệu nào được xử lý, vì sao, và quyền của bạn.',
    body: legalPage({ title: 'Chính sách quyền riêng tư', sections: PRIVACY_SECTIONS, version: PRIVACY_PAGE_VERSION, slug: 'privacy', approvedHtml: PRIVACY_HTML, crossHref: '/dieu-khoan-su-dung', crossLabel: 'Xem Điều khoản sử dụng' }),
  }),

  '/dieu-khoan-su-dung': layout({
    path: '/dieu-khoan-su-dung', current: '', variant: 'white',
    title: 'Điều khoản sử dụng — 11Food và 11Ship', desc: 'Điều khoản sử dụng 11Food và 11Ship cho khách hàng, chủ quán và shipper.',
    body: legalPage({ title: 'Điều khoản sử dụng', sections: TERMS_SECTIONS, version: TERMS_PAGE_VERSION, slug: 'terms', approvedHtml: TERMS_HTML, crossHref: '/chinh-sach-quyen-rieng-tu', crossLabel: 'Xem Chính sách quyền riêng tư' }),
  }),

  '/xoa-tai-khoan': layout({
    path: '/xoa-tai-khoan', current: '', variant: 'white',
    title: 'Yêu cầu xóa tài khoản — 11Food và 11Ship', desc: 'Hướng dẫn gửi yêu cầu xóa tài khoản 11Food và 11Ship.',
    body: `<section class="doc"><div class="wrap">
<h1>Yêu cầu xóa tài khoản</h1>
<p class="lead">Hướng dẫn gửi yêu cầu xóa tài khoản 11Food và 11Ship.</p>
<ol class="flow">
<li><span class="flow-num">01</span><div><b>Đăng nhập</b><span>Mở ứng dụng và đăng nhập bằng số điện thoại, mật khẩu của tài khoản.</span></div></li>
<li><span class="flow-num">02</span><div><b>Gửi yêu cầu</b><span>Chọn chức năng xóa tài khoản trong ứng dụng.</span></div></li>
<li><span class="flow-num">03</span><div><b>Xác nhận</b><span>Làm theo bước xác nhận hiển thị trong ứng dụng.</span></div></li>
<li><span class="flow-num">04</span><div><b>Nhận kết quả</b><span>Hệ thống xử lý theo quy định áp dụng.</span></div></li>
</ol>
</div></section>`,
  }),
};
