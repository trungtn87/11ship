# M02 — Quản lý quán trên Web Admin (2026-10-24)

Phạm vi: Web Admin › Vận hành › Quán (`/operations/shops`, `/operations/shops/:id`) + API `/v1/admin/shops`. Không có migration, không có grant mới (mọi bảng đã có quyền runtime). Không sửa hồ sơ/lịch/giá/món từ Admin.

## API (đọc: SYSTEM hoặc ADMIN có VIEW trên SHOP; ghi: SYSTEM hoặc ADMIN có VIEW + quyền riêng `can_manage_shops` "Quản lý hoạt động quán" trên SHOP)
- `GET /v1/admin/shops?q&area&profile&schedule&limit&offset` — 20/trang; `profile` = trạng thái hồ sơ hiện có (INCOMPLETE/ACTIVE/DISABLED); `schedule` = OPEN/CLOSED do máy chủ tính cùng quy tắc `shop-availability-sql`.
- `GET /:id`, `/:id/menu`, `/:id/history`, `/:id/preview`.
- `POST /:id/disable|enable` `{expected_version, reason(1–500)}` + `Idempotency-Key`; chỉ đổi `shops.status` + `version`; **vô hiệu hóa bị từ chối `SHOP_HAS_OPEN_WORK` (409) khi quán còn đơn chưa ở trạng thái kết thúc M10 hoặc delivery chưa ở trạng thái terminal M07** (đếm lại trong giao dịch, dưới khóa dòng quán FOR UPDATE; đơn khách khóa quán FOR SHARE và lệnh chủ quán khóa FOR UPDATE nên không chen được); audit (`admin.shop.disable.v1` / `enable.v1`, có lý do, trước/sau, phiên bản) + outbox (`shop.disabled_by_admin.v1` / `shop.enabled_by_admin.v1`, payload chỉ `shop_id,status,version`). Kích hoạt lại kiểm tra như hoàn tất onboarding (tọa độ lấy hàng + khu vực ACTIVE); không ép mở ngoài lịch; quán nháp bị từ chối (`SHOP_STATE_CONFLICT`) — chủ quán hoàn thiện trong 11Food.
- Lịch sử quản lý đọc từ `audit_logs` (resource `shop`); thay đổi hồ sơ/lịch của chủ quán chỉ có tên thao tác + phiên bản (audit hiện hành không lưu nội dung).

## Quyền (Owner duyệt 2026-10-24)
- Cột mới `can_manage_shops` (mặc định `false`) trên `admin_app_permissions` và `admin_invitation_permissions`, chỉ SHOP và phải có VIEW (CHECK ở DB + validator). SYSTEM luôn có. ADMIN hiện hữu và lời mời cũ: `false`, không suy từ `can_lock`. `can_lock` giữ nguyên nghĩa/nhãn "Khóa tài khoản" và không còn cho phép đổi trạng thái quán.
- Nối vào: lời mời (tạo/cấp lại), kích hoạt (copy snapshot), ma trận Phân quyền, đọc quyền. Replay kiểm lại quyền hiện tại.
- Migration `1796256000000_admin-shop-manage-right.sql`; không đổi grants (cột mới nằm trong grant bảng hiện có). Hướng dẫn: `ops/runbooks/m02-admin-shops-deploy-20261024.md`.

## Còn lại
- Bản đồ web: chưa có tích hợp M14 cho web → hiển thị địa chỉ + tọa độ và ghi rõ chưa nối bản đồ.
- Quán DISABLED: backend vẫn chặn xác nhận/gọi shipper của chủ quán và chọn vai SHOP ở phiên mới — không còn là xung đột vì giờ chỉ vô hiệu hóa được khi hết việc.

## Phát hiện ngoài phạm vi
`SPA_ROUTES` (admin-web-hosting.ts) chưa liệt kê nhiều route cũ (`/accounts/*`, `/operations/orders|deliveries|notifications|reviews|complaints`, `/overview`, `/reports`, `/system/*`…): tải lại các trang đó trên hosting có thể 404. Chưa sửa ở gói này.
