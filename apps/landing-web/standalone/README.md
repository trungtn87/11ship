# Website giới thiệu 11 / 11Food / 11Ship (bản tách riêng)

Website tĩnh độc lập, không dính repo 11ship, backend hay API. Chỉ cần Node 20+ để build; chạy trên VPS chỉ cần nginx.

## Xem thử trên máy
Bấm đúp `chay-thu.cmd` (hoặc `node build.mjs` rồi `node serve.mjs`), mở http://localhost:4173

Các trang: `/`, `/food`, `/ship`, `/ho-tro`, `/chinh-sach-quyen-rieng-tu`, `/dieu-khoan`, `/xoa-tai-khoan`.

## Đổi link và thông tin (không cần sửa code): `site.config.json`

| Khóa | Ý nghĩa |
|---|---|
| `siteUrl` | Địa chỉ website, ví dụ `https://ten-mien.vn` (dùng cho canonical và ảnh chia sẻ) |
| `publish` | `true` khi cho Google lập chỉ mục; `false` = `noindex` (mặc định, bản thử) |
| `playFoodUrl`, `playShipUrl` | Link Google Play. Để trống = nút "Sắp có trên Google Play" |
| `deleteAccountUrl` | Link trang xóa tài khoản của backend, chỉ điền khi đã deploy |
| `contactEmail` | Email hỗ trợ hiện ở trang Hỗ trợ |
| `privacyHtml`, `termsHtml` | Nội dung chính sách/điều khoản (HTML) đã được duyệt |

Sửa xong chạy `node build.mjs` (hoặc `chay-thu.cmd`). Site chỉ cho lập chỉ mục khi `siteUrl` có giá trị và `publish` là `true`.

## Đổi nội dung chữ và ảnh
- Chữ: `src/pages.mjs` (mỗi trang là một khối riêng).
- Giao diện: `src/site.css`. Ảnh: thay file trong `src/img/` (giữ tên file, hoặc sửa tên trong `pages.mjs`).
- Logo, font, màu nằm trong `assets/`, là bản gốc đã duyệt theo Brand Guideline v1.0: không sửa.

## Đưa lên VPS (chỉ khi Owner cho phép)
1. `node build.mjs`, chép **thư mục `dist/`** lên VPS, ví dụ `/var/www/11-landing`.
2. Dùng `nginx/11-landing.conf.example` làm server block riêng (đổi `DOMAIN`), cấp HTTPS bằng certbot.
3. Trỏ DNS của tên miền về VPS. Không đụng cấu hình nginx/backend của 11Ship.
