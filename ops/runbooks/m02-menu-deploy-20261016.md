# Runbook — triển khai M02 (thực đơn, khám phá, lưu hồ sơ/lịch từ Android) lên VPS — 16/10/2026

**Trạng thái: chuẩn bị, CHƯA thực thi trên VPS.** Deploy và migration remote cần ủy quyền riêng của Owner; không suy từ việc code đã xong. Cùng quy tắc với [vps-production-update-20261014.md](vps-production-update-20261014.md): sao lưu trước, không reset/drop/down, không gửi bí mật qua chat.

## 0. Thay đổi so với bản đang chạy
| Hạng mục | Chi tiết |
|---|---|
| Migration mới (2) | (1) `1793145600000_create-menu`: hàm `app.fold_vi`, bảng `menu_categories`, `menu_images`, `menu_items`. Chỉ thêm, không sửa bảng cũ, không seed dữ liệu. (2) `1793232000000_menu-category-admin` (quản lý nhóm món trên Web Admin, 17/10/2026): cột `can_manage_catalog` (mặc định `false`, chỉ hàng SHOP và phải có VIEW) trên `admin_app_permissions` và `admin_invitation_permissions`; hàm `app.menu_category_key` và **thay** chỉ mục duy nhất `menu_categories_name_uq` (trước: bỏ dấu; nay: chỉ bỏ khác biệt hoa/thường, khoảng trắng, dạng Unicode — **không** bỏ dấu tiếng Việt); ràng buộc `sort_order` 0..100000 (`NOT VALID`: không quét lại dữ liệu cũ). Chỉ mục mới **lỏng hơn** chỉ mục cũ nên mọi dòng hiện có đều thỏa: không có gì bị gộp hay xóa, không cần kiểm tra trùng trước. Quyền ADMIN hiện có không đổi (mặc định `false`). |
| Grant runtime mới (3 bảng) | `menu_categories` (SELECT, **INSERT**, UPDATE — INSERT để Web Admin thêm nhóm), `menu_images` (SELECT, INSERT, UPDATE), `menu_items` (SELECT, INSERT, UPDATE) — đã có trong `ops/selfhosted/02-runtime-grants.sql` (chạy lại file là idempotent). |
| Backend | (1) bắt body gốc cho chữ ký thiết bị trên `/v1/shop/me/*` (sửa lỗi 403 khi lưu hồ sơ/lịch từ app); (2) `GET/POST/PUT /v1/shop/me/menu...`; (3) công khai không cần đăng nhập: `GET /v1/shops/:id`, `/v1/menu-images/:id`, `/v1/service-areas`, `/v1/menu-categories`, `/v1/discovery/shops`, `/v1/discovery/dishes`. |
| Web Admin | build Web Admin mới (route `/catalog/categories`, mục “Danh mục › Nhóm món”, ô “Nhóm món” trong lời mời Admin); backend phục vụ route này cho reload/bookmark. |
| nginx | thêm `location = /v1/shop/me/menu/images` với `client_max_body_size 3600k` (các route khác giữ `1m`). Bản mẫu: `ops/vinahost/nginx-11ship-staging.conf`. Áp dụng: sao vào `/etc/nginx/sites-available/...` (đúng file đang dùng), `nginx -t && systemctl reload nginx`. |
| Env | **không đổi**. |

## 1. Thứ tự
1. Sao lưu `pg_dump` (mục 2 của runbook 14/10). 
2. Giải gói release mới như mục 1 runbook 14/10; `current` chưa đổi.
3. Migration (từ release mới, shell operator): `node scripts/db-migrate-remote.js` → phải liệt kê đúng **2** migration pending (`1793145600000_create-menu`, `1793232000000_menu-category-admin`) — **sau** `1793059200000_account-scope-lifecycle-settings` của M01; rồi `--apply`.
4. Grants: `psql -d ship11_staging -v ON_ERROR_STOP=1 -f ops/selfhosted/02-runtime-grants.sql` (migration role).
5. nginx: cập nhật cấu hình, `nginx -t`, `systemctl reload nginx`.
6. Đổi `current` sang release mới và `systemctl restart 11ship-staging` (service giữ tên cũ).
7. Cấp **nhóm món hệ thống** bằng Web Admin (mục 2) — không có nhóm đang dùng thì chủ quán chưa thêm được món (đúng đặc tả: "Chưa có nhóm món để lựa chọn").

## 2. Nhóm món hệ thống: quản lý trên Web Admin (Danh mục › Nhóm món)
- **SYSTEM** quản lý đầy đủ. **ADMIN** chỉ khi có quyền “Nhóm món” (ô thứ 4 ở hàng *Chủ quán/SHOP* trong lời mời Admin; cần kèm quyền Xem). Quyền được cấp **khi tạo lời mời** (như mọi quyền Admin hiện có); ADMIN đã kích hoạt trước bản này **không** có quyền này và hệ thống chưa có màn sửa quyền của ADMIN đã kích hoạt: cần mời lại bằng lời mời mới có quyền, hoặc để SYSTEM quản lý. Backend kiểm tra quyền ở mọi lần đọc/ghi; ẩn nút ở UI không phải khóa.
- Thêm / sửa tên, thứ tự, trạng thái; ngừng dùng có xác nhận; **không có xóa**. Nhóm tạo bằng SQL trước đây hiện ra và quản lý được như nhóm mới. Mỗi thay đổi ghi `audit_logs` (`admin.menu_category.create.v1` / `.update.v1`: người thao tác, thời gian, giá trị trước/sau) và một sự kiện outbox.
- Tên nhóm duy nhất không phân biệt hoa/thường, khoảng trắng thừa, dạng Unicode (NFC), **kể cả nhóm ngừng dùng**; dấu tiếng Việt **được phân biệt** (“Ốc” ≠ “Oc”).
- Chỉ cần SQL khi chưa có tài khoản SYSTEM đăng nhập được Web Admin. Nếu dùng SQL (role migration), nhớ khóa trùng mới:
```sql
INSERT INTO app.menu_categories (category_id, name, status, sort_order, created_at, updated_at)
SELECT gen_random_uuid(), v.name, 'ACTIVE', v.ord, clock_timestamp(), clock_timestamp()
FROM (VALUES ('Ốc', 1), ('Hải sản', 2), ('Đồ uống', 3)) AS v(name, ord)
ON CONFLICT ((app.menu_category_key(name))) DO NOTHING;
```
Khu vực phục vụ (`app.service_areas`) vẫn do vận hành cấp như trước; khách chọn khu vực trong app từ `GET /v1/service-areas` (chỉ ACTIVE).

## 3. Kiểm chứng sau deploy (chưa chạy)
```bash
curl -s https://103.9.78.67.sslip.io/v1/service-areas
curl -s https://103.9.78.67.sslip.io/v1/menu-categories
curl -s "https://103.9.78.67.sslip.io/v1/discovery/shops?area_id=<id>"
```
Web Admin (SYSTEM): Danh mục › Nhóm món → thêm một nhóm, đổi thứ tự, ngừng dùng/kích hoạt; kiểm tra `app.audit_logs` có `admin.menu_category.*`. Trên điện thoại (APK mới, cài đè): tab Quán → vào chế độ quản lý → lưu giờ → đọc lại đúng; thêm món có ảnh; ẩn/hiện/xóa; Xem trước; Trang chủ khách → chọn khu vực → tìm → mở thực đơn.

## 4. Rollback
Đổi `current` về release cũ + `systemctl restart`. Migration `create-menu` chỉ thêm bảng; `menu-category-admin` chỉ thêm cột có mặc định, hàm, ràng buộc và đổi chỉ mục tên (bản cũ vẫn chạy được với chúng): bản cũ không cần down. Bản cũ **không** có các route mới nên app mới hiển thị "Không tải được dữ liệu" ở các màn thực đơn/khám phá (đúng, không dữ liệu giả).
