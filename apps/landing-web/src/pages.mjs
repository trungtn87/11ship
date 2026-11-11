// Page templates of the 11 landing site. Copy states only what the apps do today; anything undecided is marked "chờ Owner".
const SITE = 'https://CHUA-CHOT-TEN-MIEN'; // domain not decided by the Owner: canonical stays a placeholder until then
const NAV = [['/food', '11Food'], ['/ship', '11Ship'], ['/#tai-ung-dung', 'Tải ứng dụng']];

const play = (name) =>
  `<div class="play"><span class="btn btn--dark" aria-disabled="true">Sắp có trên Google Play</span><small>${name}: chưa có liên kết phát hành.</small></div>`;
const ph = (t) => `<div class="ph" role="img" aria-label="${t}">${t}<br>(ảnh chờ Owner duyệt)</div>`;

function layout({ path, title, desc, current, body }) {
  const nav = NAV.map(([h, l]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">
<meta name="robots" content="noindex"><!-- PREVIEW until Owner approval -->
<link rel="canonical" href="${SITE}${path}">
<meta property="og:type" content="website"><meta property="og:locale" content="vi_VN"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="${SITE}/brand/logo-11-ui.png">
<meta name="theme-color" content="#d8ad18"><link rel="icon" type="image/png" href="/brand/logo-11-ui.png">
<link rel="preload" href="/fonts/PlusJakartaSans-wght.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/site.css"></head>
<body><a class="skip" href="#main">Bỏ qua điều hướng</a>
<header class="top"><div class="wrap bar"><a class="brand" href="/" aria-label="11 — trang chủ"><img src="/brand/logo-11-ui.png" alt="11" width="60" height="40"></a><nav class="menu" aria-label="Chính">${nav}</nav></div></header>
<main id="main">${body}</main>
<footer><div class="wrap"><div class="grid3">
<div><span class="logo-chip"><img src="/brand/logo-11-ui.png" alt="11 — Cần là có" width="54" height="36"></span><p>11 — Cần là có.<br>Đặt món và giao hàng tại Cao Bằng.</p></div>
<div><h3>Ứng dụng</h3><ul><li><a href="/food">11Food — Thèm là có</a></li><li><a href="/ship">11Ship — Gọi là có</a></li></ul></div>
<div><h3>Hỗ trợ và pháp lý</h3><ul><li><span class="soon">Chính sách quyền riêng tư — chờ Owner duyệt đăng</span></li><li><span class="soon">Điều khoản sử dụng — chờ Owner duyệt đăng</span></li><li><span class="soon">Yêu cầu xóa tài khoản — chờ triển khai</span></li><li><span class="soon">Liên hệ hỗ trợ — chờ Owner duyệt</span></li></ul></div>
</div><p class="legal">© 11. Bản xem trước thiết kế — chưa công bố.</p></div></footer></body></html>`;
}

const appCard = (cls, logo, name, tag, text, href, cta) =>
  `<article class="card ${cls}"><img class="logo" src="/brand/${logo}" alt="${name}" height="56"><p class="tag">${tag}</p><p>${text}</p><div class="cta"><a class="btn btn--primary" href="${href}">${cta}</a></div></article>`;

const faq = (items) => items.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('');
const heroLogo = (file, name) => `<img src="/brand/${file}" alt="${name}" height="64" style="height:64px;width:auto;margin-bottom:16px">`;

export const pages = {
  '/': layout({
    path: '/',
    current: '/',
    title: '11 — Cần là có | 11Food và 11Ship tại Cao Bằng',
    desc: '11 — Cần là có. Hai ứng dụng tại Cao Bằng: 11Food để đặt món, 11Ship cho cửa hàng và shipper.',
    body: `<section class="hero"><div class="wrap"><div><p class="eyebrow">Cao Bằng</p><h1>Cần là có.</h1><p class="lead">Hai ứng dụng đời thường: đặt đồ ăn với 11Food, gọi và nhận giao hàng với 11Ship.</p><div class="cta"><a class="btn btn--primary" href="/food">Xem 11Food</a><a class="btn btn--ghost" href="/ship">Xem 11Ship</a></div></div>${ph('Ảnh Cao Bằng / hình đại diện thương hiệu 11')}</div></section>
<section><div class="wrap"><h2>Hai ứng dụng, một thương hiệu</h2><div class="apps">
${appCard('', 'logo-11food-ui.png', '11Food', 'Thèm là có', 'Dành cho khách hàng: tìm quán, xem món và đặt đồ ăn ngay trên điện thoại.', '/food', 'Tìm hiểu 11Food')}
${appCard('card--dark', 'logo-11ship-ui.png', '11Ship', 'Gọi là có', 'Dành cho cửa hàng và shipper: gọi shipper, nhận chuyến và theo dõi giao nhận.', '/ship', 'Tìm hiểu 11Ship')}
</div></div></section>
<section class="alt"><div class="wrap"><h2>Cách hoạt động</h2><div class="grid2">
<div><h3>11Food</h3><ol class="steps"><li><b>Chọn quán</b><span>Xem quán và món.</span></li><li><b>Đặt món</b><span>Chọn món, xác nhận đơn.</span></li><li><b>Theo dõi đơn</b><span>Xem trạng thái đơn.</span></li></ol></div>
<div><h3>11Ship</h3><ol class="steps"><li><b>Tạo tài khoản</b><span>Chọn vai trò cửa hàng hoặc shipper.</span></li><li><b>Gọi hoặc nhận chuyến</b><span>Cửa hàng gọi shipper; shipper nhận chuyến.</span></li><li><b>Theo dõi giao nhận</b><span>Xem trạng thái từng chuyến.</span></li></ol></div>
</div></div></section>
<section id="tai-ung-dung"><div class="wrap"><h2>Tải ứng dụng</h2><div class="apps"><div class="card"><h3>11Food</h3>${play('11Food')}</div><div class="card"><h3>11Ship</h3>${play('11Ship')}</div></div></div></section>`,
  }),

  '/food': layout({
    path: '/food',
    current: '/food',
    title: '11Food — Thèm là có | Đặt đồ ăn tại Cao Bằng',
    desc: '11Food — Thèm là có. Khám phá quán ăn, chọn món yêu thích và đặt đồ ăn tại Cao Bằng.',
    body: `<section class="hero"><div class="wrap"><div>${heroLogo('logo-11food-ui.png', '11Food')}<p class="eyebrow">Thèm là có</p><h1>Đói bụng? Mở 11Food.</h1><p class="lead">Khám phá quán ăn, chọn món yêu thích và đặt đồ ăn tại Cao Bằng.</p>${play('11Food')}</div>${ph('Ảnh món ăn thật / màn hình app đã nghiệm thu')}</div></section>
<section><div class="wrap"><h2>Đặt món đơn giản</h2><ol class="steps"><li><b>Khám phá quán và món</b><span>Xem danh sách quán và thực đơn.</span></li><li><b>Tìm kiếm và chọn món</b><span>Tìm món bạn thèm, thêm vào đơn.</span></li><li><b>Đặt món</b><span>Xác nhận địa chỉ nhận và đặt.</span></li><li><b>Theo dõi đơn</b><span>Xem trạng thái đơn hàng trong ứng dụng.</span></li></ol></div></section>
<section class="alt"><div class="wrap"><h2>Phạm vi phục vụ</h2><p class="lead">Hiện phục vụ tại Cao Bằng. Danh sách quán, thời gian giao và phí giao hiển thị trong ứng dụng.</p><p class="note">Số lượng quán, thời gian giao, phí và khuyến mại: chờ dữ liệu và quyết định của Owner, không công bố ở đây.</p></div></section>
<section><div class="wrap"><h2>Câu hỏi thường gặp</h2>${faq([
      ['11Food dùng ở đâu?', 'Tại Cao Bằng.'],
      ['Tôi cần gì để đặt món?', 'Ứng dụng 11Food trên điện thoại Android và một tài khoản đăng ký bằng số điện thoại.'],
      ['Làm sao xóa tài khoản?', 'Hướng dẫn xóa tài khoản sẽ có ở trang riêng sau khi chức năng được triển khai trên hệ thống chính thức.'],
      ['Tôi là cửa hàng hoặc shipper?', 'Hãy xem 11Ship.'],
    ])}
<p><a class="btn btn--ghost" href="/ship">Xem 11Ship</a></p></div></section>`,
  }),

  '/ship': layout({
    path: '/ship',
    current: '/ship',
    title: '11Ship — Gọi là có | Giao hàng cho cửa hàng và shipper tại Cao Bằng',
    desc: '11Ship — Gọi là có. Ứng dụng dành cho cửa hàng và shipper tại Cao Bằng.',
    body: `<section class="hero"><div class="wrap"><div>${heroLogo('logo-11ship-ui.png', '11Ship')}<p class="eyebrow">Gọi là có</p><h1>Có hàng cần giao? Mở 11Ship.</h1><p class="lead">Ứng dụng dành cho cửa hàng và shipper tại Cao Bằng.</p>${play('11Ship')}</div>${ph('Ảnh shipper thật / màn hình app đã nghiệm thu')}</div></section>
<section><div class="wrap"><h2>Hai nhóm người dùng</h2><div class="apps">
<div class="card"><h3>Cửa hàng</h3><p>Tạo yêu cầu giao hàng, gọi shipper và theo dõi từng chuyến.</p></div>
<div class="card card--dark"><h3>Shipper</h3><p>Đăng ký, nhận chuyến và theo dõi giao nhận trong ứng dụng.</p></div></div>
<p>Một tài khoản có thể có cả hai vai trò; sau khi đăng nhập bạn chọn vai trò muốn dùng.</p></div></section>
<section class="alt"><div class="wrap"><h2>Cách dùng</h2><div class="grid2">
<div><h3>Cửa hàng</h3><ol class="steps"><li><b>Đăng ký</b><span>Tạo tài khoản và hồ sơ cửa hàng.</span></li><li><b>Gọi shipper</b><span>Nhập điểm lấy, điểm giao.</span></li><li><b>Theo dõi</b><span>Xem trạng thái giao nhận.</span></li></ol></div>
<div><h3>Shipper</h3><ol class="steps"><li><b>Đăng ký</b><span>Tạo hồ sơ shipper.</span></li><li><b>Nhận chuyến</b><span>Chọn chuyến trong khu vực hoạt động.</span></li><li><b>Giao hàng</b><span>Cập nhật trạng thái chuyến.</span></li></ol></div></div></div></section>
<section><div class="wrap"><h2>Ví, thu nhập và phí</h2><p class="lead">Thông tin ví, phí và thu nhập theo chính sách thực tế của 11Ship, xem trong ứng dụng. Không có cam kết thu nhập.</p><p class="note">Chi tiết phí và chính sách ví: chờ Owner chốt nội dung công bố.</p></div></section>
<section class="alt"><div class="wrap"><h2>Câu hỏi thường gặp</h2>${faq([
      ['11Ship hoạt động ở đâu?', 'Tại Cao Bằng.'],
      ['Tôi vừa là cửa hàng vừa là shipper?', 'Được, một tài khoản có thể có cả hai vai trò.'],
      ['Làm sao xóa tài khoản?', 'Hướng dẫn xóa tài khoản sẽ có ở trang riêng sau khi chức năng được triển khai trên hệ thống chính thức.'],
      ['Tôi muốn đặt đồ ăn?', 'Hãy xem 11Food.'],
    ])}
<p><a class="btn btn--ghost" href="/food">Xem 11Food</a></p></div></section>`,
  }),
};
