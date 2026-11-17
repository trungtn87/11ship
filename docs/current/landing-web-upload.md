# Website 11 (landing-web) — đóng gói và đưa lên máy chủ

> Trạng thái: **NOT TESTED trên VPS.** Đã kiểm tra local: build, test, zip mở được, tệp đầy đủ.

Written for: Owner và người vận hành máy chủ (không cần đọc code).

## 1. Đóng gói

```
npm run package:landing-web
```

Lệnh build site rồi nén thư mục tĩnh thành `landing-web-<7 ký tự SHA>.zip` ở thư mục gốc repo. File zip là sản phẩm build: **không commit**, đã nằm trong `.gitignore`.

## 2. Cấu trúc sau khi giải nén

```
index.html                       trang chủ            (/)
food/index.html                  11Food               (/food)
ship/index.html                  11Ship               (/ship)
ho-tro/index.html                Câu hỏi thường gặp   (/ho-tro)
chinh-sach-quyen-rieng-tu/       Chính sách quyền riêng tư
dieu-khoan-su-dung/              Điều khoản sử dụng
xoa-tai-khoan/                   Yêu cầu xóa tài khoản
site.css  fonts/  img/  brand/  robots.txt
```

Mặc định site **không cho Google lập chỉ mục** (`noindex`, `robots.txt` chặn tất cả). Chỉ bật khi Owner duyệt: `LANDING_PUBLISH=1` và `siteUrl` = `https://11local.vn` (xem `apps/landing-web/site.config.json`).

## 3. Mẫu nginx

Đặt thư mục đã giải nén vào `/var/www/11-landing` rồi dùng server block riêng (không đụng cấu hình 11Ship):

```nginx
server {
    listen 80;
    server_name 11local.vn;
    root /var/www/11-landing;
    index index.html;

    # đường dẫn không có đuôi .html: /food -> food/index.html
    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    location ~* \.(css|woff2|png|jpg|webp|svg)$ {
        expires 7d;
    }
}
```

Thêm HTTPS (certbot) theo quy trình chung của máy chủ. Bản mẫu đầy đủ: `apps/landing-web/standalone/nginx/11-landing.conf.example`.

## 4. Owner cần điền / quyết định sau

| Việc | Ở đâu | Ghi chú |
|---|---|---|
| Email hỗ trợ | `contactEmail` trong `site.config.json` | Hiện có giá trị trong repo; nút "Liên hệ ngay" dùng email này |
| Link Google Play 11Food / 11Ship | `playFoodUrl`, `playShipUrl` (hoặc `LANDING_PLAY_*`) | Chưa có = "Sắp có trên Google Play" |
| Link App Store / Google Play dùng chung | `appStoreUrl`, `googlePlayUrl` | Chưa có = badge "Sắp có" |
| Đích cho "Đăng ký ngay" (đối tác quán, tài xế) | Chưa có trong thiết kế | Hiện là trạng thái "Sắp có" |
| Câu trả lời FAQ 2–4 | `apps/landing-web/src/pages.mjs` (`FAQ_ITEMS`) | Thiết kế chưa có nội dung; hiện ghi "đang được cập nhật" |
| Mã QR tải app | Chưa đưa vào | Mã QR cần link Play thật |
| Ảnh minh họa | `apps/landing-web/src/img/figma/` | Lấy từ bộ thiết kế Figma; cần Owner xác nhận quyền dùng |
| Quyền dùng font Be Vietnam Pro | `src/fonts/` | Giấy phép SIL OFL (xem `OFL-BeVietnamPro.txt`) |
| Chính sách, điều khoản | `legal.mjs` (đã khớp PR #340) | Không đổi nội dung; chỉ đổi khi Owner duyệt bản mới |
