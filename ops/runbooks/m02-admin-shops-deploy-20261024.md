# Runbook — triển khai "Quản lý quán" trên Web Admin (M02) — 24/10/2026

**Trạng thái: chuẩn bị, CHƯA thực thi trên VPS.** Deploy và migration remote cần ủy quyền riêng của Owner. Cùng quy tắc với [vps-production-update-20261014.md](vps-production-update-20261014.md): sao lưu trước, không reset/drop/down.

## Thay đổi
| Hạng mục | Chi tiết |
|---|---|
| Migration mới (1) | `1796256000000_admin-shop-manage-right`: cột `can_manage_shops boolean NOT NULL DEFAULT false` trên `admin_app_permissions` và `admin_invitation_permissions`, kèm CHECK (cần `can_view`, chỉ `app = 'SHOP'`). Chỉ thêm cột/ràng buộc; mọi dòng hiện có thỏa (mặc định `false`); không copy từ `can_lock`. |
| Grants | **Không đổi.** Hai bảng đã có SELECT/INSERT cho `ship11_app`; cột mới nằm trong grant bảng. Chạy lại `ops/selfhosted/02-runtime-grants.sql` là không cần (idempotent nếu chạy). |
| Backend | `/v1/admin/shops...` (đọc, thực đơn, lịch sử, xem như khách, `disable`/`enable`), mã lỗi `SHOP_STATE_CONFLICT`, `SHOP_HAS_OPEN_WORK`; route SPA `/operations/shops`, `/operations/shops/:id`. |
| Web Admin | build mới (mục Vận hành › Quán; ô "Quản lý hoạt động quán" trong Phân quyền và Lời mời). |
| Env, nginx | không đổi. |

## Thứ tự
1. `pg_dump` (mục 2 runbook 14/10). 2. Giải gói release mới. 3. `node scripts/db-migrate-remote.js` phải liệt kê đúng migration pending nói trên (sau các migration M13/M07 đã có), rồi `--apply`. 4. Đổi `current`, restart dịch vụ. 5. Cấp quyền: SYSTEM mở Tài khoản › Phân quyền và bật "Quản lý hoạt động quán" cho ADMIN cần dùng (ADMIN hiện hữu mặc định chưa có).

## Kiểm chứng sau deploy (chưa chạy)
SYSTEM mở Vận hành › Quán; ADMIN chỉ Xem thấy danh sách nhưng không có nút; ADMIN có quyền mới thấy "Vô hiệu hóa quán" và bị từ chối khi quán còn đơn/giao hàng chưa kết thúc.

## Hoàn tác
Không có down tự động trên máy chủ thật. Cột mới vô hại nếu giữ nguyên (mặc định `false`); nếu phải quay về bản cũ, bản cũ bỏ qua cột này.
