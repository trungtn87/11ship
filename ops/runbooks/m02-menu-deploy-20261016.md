# Runbook — triển khai M02 (thực đơn, khám phá, lưu hồ sơ/lịch từ Android) lên VPS — 16/10/2026

**Trạng thái: chuẩn bị, CHƯA thực thi trên VPS.** Deploy và migration remote cần ủy quyền riêng của Owner; không suy từ việc code đã xong. Cùng quy tắc với [vps-production-update-20261014.md](vps-production-update-20261014.md): sao lưu trước, không reset/drop/down, không gửi bí mật qua chat.

## 0. Thay đổi so với bản đang chạy
| Hạng mục | Chi tiết |
|---|---|
| Migration mới (1) | `1793059200000_create-menu`: hàm `app.fold_vi`, bảng `menu_categories`, `menu_images`, `menu_items`. Chỉ thêm, không sửa bảng cũ, không seed dữ liệu. |
| Grant runtime mới (3 bảng) | `menu_categories` (SELECT, UPDATE), `menu_images` (SELECT, INSERT, UPDATE), `menu_items` (SELECT, INSERT, UPDATE) — đã có trong `ops/selfhosted/02-runtime-grants.sql` (chạy lại file là idempotent). |
| Backend | (1) bắt body gốc cho chữ ký thiết bị trên `/v1/shop/me/*` (sửa lỗi 403 khi lưu hồ sơ/lịch từ app); (2) `GET/POST/PUT /v1/shop/me/menu...`; (3) công khai không cần đăng nhập: `GET /v1/shops/:id`, `/v1/menu-images/:id`, `/v1/service-areas`, `/v1/menu-categories`, `/v1/discovery/shops`, `/v1/discovery/dishes`. |
| nginx | thêm `location = /v1/shop/me/menu/images` với `client_max_body_size 3600k` (các route khác giữ `1m`). Bản mẫu: `ops/vinahost/nginx-11ship-staging.conf`. Áp dụng: sao vào `/etc/nginx/sites-available/...` (đúng file đang dùng), `nginx -t && systemctl reload nginx`. |
| Env | **không đổi**. |

## 1. Thứ tự
1. Sao lưu `pg_dump` (mục 2 của runbook 14/10). 
2. Giải gói release mới như mục 1 runbook 14/10; `current` chưa đổi.
3. Migration (từ release mới, shell operator): `node scripts/db-migrate-remote.js` → phải liệt kê đúng **1** migration pending (`1793059200000_create-menu`); rồi `--apply`.
4. Grants: `psql -d ship11_staging -v ON_ERROR_STOP=1 -f ops/selfhosted/02-runtime-grants.sql` (migration role).
5. nginx: cập nhật cấu hình, `nginx -t`, `systemctl reload nginx`.
6. Đổi `current` sang release mới và `systemctl restart 11ship-staging` (service giữ tên cũ).
7. Cấp **nhóm món hệ thống** (mục 2) — không có nhóm thì chủ quán chưa thêm được món (đúng đặc tả: "Chưa có nhóm món để lựa chọn").

## 2. Cấp nhóm món hệ thống (vận hành, role migration; không có API admin trong bản này)
Nhóm do hệ thống quản lý; ứng dụng không thêm/xóa nhóm. Tên duy nhất không phân biệt hoa thường/dấu. Ví dụ:
```sql
INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at)
SELECT gen_random_uuid(), v.name, 'ACTIVE', v.ord, clock_timestamp(), clock_timestamp()
FROM (VALUES ('Ốc', 1), ('Hải sản', 2), ('Đồ uống', 3)) AS v(name, ord)
ON CONFLICT ((app.fold_vi(name))) DO NOTHING;

-- đổi tên / thứ tự / ngừng (không xóa vật lý; món đã gắn nhóm được giữ nguyên và vẫn công khai):
UPDATE app.menu_categories SET status = 'INACTIVE', version = version + 1, updated_at = clock_timestamp() WHERE app.fold_vi(name) = app.fold_vi('Đồ uống');
```
Khu vực phục vụ (`app.service_areas`) cũng do vận hành cấp như trước; khách chọn khu vực trong app từ `GET /v1/service-areas` (chỉ ACTIVE).

## 3. Kiểm chứng sau deploy (chưa chạy)
```bash
curl -s https://103.9.78.67.sslip.io/v1/service-areas
curl -s https://103.9.78.67.sslip.io/v1/menu-categories
curl -s "https://103.9.78.67.sslip.io/v1/discovery/shops?area_id=<id>"
```
Trên điện thoại (APK mới, cài đè): tab Quán → vào chế độ quản lý → lưu giờ → đọc lại đúng; thêm món có ảnh; ẩn/hiện/xóa; Xem trước; Trang chủ khách → chọn khu vực → tìm → mở thực đơn.

## 4. Rollback
Đổi `current` về release cũ + `systemctl restart`. Migration chỉ thêm bảng: bản cũ không dùng chúng, không cần down. Bản cũ **không** có các route mới nên app mới hiển thị "Không tải được dữ liệu" ở các màn thực đơn/khám phá (đúng, không dữ liệu giả).
