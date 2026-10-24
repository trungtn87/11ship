# M02 — Quản lý quán trên Web Admin (2026-10-24)

Phạm vi: Web Admin › Vận hành › Quán (`/operations/shops`, `/operations/shops/:id`) + API `/v1/admin/shops`. Không có migration, không có grant mới (mọi bảng đã có quyền runtime). Không sửa hồ sơ/lịch/giá/món từ Admin.

## API (đọc: SYSTEM hoặc ADMIN có VIEW trên SHOP; ghi: SYSTEM hoặc ADMIN có VIEW + `can_lock` trên SHOP)
- `GET /v1/admin/shops?q&area&profile&schedule&limit&offset` — 20/trang; `profile` = trạng thái hồ sơ hiện có (INCOMPLETE/ACTIVE/DISABLED); `schedule` = OPEN/CLOSED do máy chủ tính cùng quy tắc `shop-availability-sql`.
- `GET /:id`, `/:id/menu`, `/:id/history`, `/:id/preview`.
- `POST /:id/disable|enable` `{expected_version, reason(1–500)}` + `Idempotency-Key`; chỉ đổi `shops.status` + `version`; audit (`admin.shop.disable.v1` / `enable.v1`, có lý do, trước/sau, phiên bản) + outbox (`shop.disabled_by_admin.v1` / `shop.enabled_by_admin.v1`, payload chỉ `shop_id,status,version`). Kích hoạt lại kiểm tra như hoàn tất onboarding (tọa độ lấy hàng + khu vực ACTIVE); không ép mở ngoài lịch; quán nháp bị từ chối (`SHOP_STATE_CONFLICT`) — chủ quán hoàn thiện trong 11Food.
- Lịch sử quản lý đọc từ `audit_logs` (resource `shop`); thay đổi hồ sơ/lịch của chủ quán chỉ có tên thao tác + phiên bản (audit hiện hành không lưu nội dung).

## Quyết định cần Owner xác nhận
1. **Quyền**: dùng lại `can_lock` của SHOP (nhãn đổi thành "Khóa tài khoản và vô hiệu hóa / kích hoạt lại quán"); admin đang có `can_lock` SHOP sẽ có thêm quyền này. Nếu muốn quyền riêng cần migration + màn Phân quyền.
2. **Xung đột đơn đang chạy khi quán DISABLED** (không tự sửa, không hủy đơn): `requireActiveShop` chặn (a) *xác nhận* đơn PENDING_CONFIRMATION, (b) *gọi shipper* cho đơn PREPARING chưa có delivery; vẫn cho từ chối/hủy/sửa đơn. Chủ quán không chọn được vai SHOP ở phiên đăng nhập mới khi quán không ACTIVE (phiên SHOP đang mở vẫn dùng được). Delivery đã tạo tiếp tục bình thường. Admin hiển thị số đơn chờ/đang chuẩn bị/lượt giao đang chạy trong popup.
3. Bản đồ web: chưa có tích hợp M14 cho web → hiển thị địa chỉ + tọa độ và ghi rõ chưa nối bản đồ.

## Phát hiện ngoài phạm vi
`SPA_ROUTES` (admin-web-hosting.ts) chưa liệt kê nhiều route cũ (`/accounts/*`, `/operations/orders|deliveries|notifications|reviews|complaints`, `/overview`, `/reports`, `/system/*`…): tải lại các trang đó trên hosting có thể 404. Chưa sửa ở gói này.
