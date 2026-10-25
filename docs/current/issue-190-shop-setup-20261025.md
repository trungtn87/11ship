# Issue #190 — Checklist thiết lập quán, chặn quán chưa đủ điều kiện, liên hệ nhanh, khoảng cách đường đi

Cập nhật 25/10/2026. Một PR tổng: backend + 11Food + Admin Web. Chưa merge/deploy/migrate VPS.

## Nguồn sự thật: server tính từ dữ liệu thật
Bốn bước (không lưu cờ, tính lại mỗi lần đọc): (1) tài khoản; (2) tên, địa chỉ, SĐT liên hệ, khu vực đang hoạt động **và lịch hoạt động**; (3) tọa độ lấy hàng (không phải (0,0), địa chỉ nhập tay không thay GPS); (4) ≥1 món `VISIBLE`, giá > 0, có ảnh. Quy tắc một chỗ: `apps/backend/src/shop-setup/shop-setup-rules.ts` (+ `menu/menu-readiness-sql.ts`, `shop/shop-availability-sql.ts::hasPickupPointSql`).

Công khai = quán `ACTIVE` + chủ quán không bị khóa + đủ 4 bước. Mọi API công khai dùng cùng cổng `ShopSetupGate`: `GET /v1/shops/:id`, `/v1/shops/:id/reviews`, logo, `GET /v1/discovery/shops|dishes` (và lọc nhóm món), giỏ/kiểm tra/đặt/đặt lại (M10), xem trước của Admin. Quán cũ `ACTIVE` thiếu điều kiện bị chặn như quán mới. Ngoài giờ nhưng đã thiết lập: vẫn xem được menu/liên hệ, chỉ không đặt mới. Đơn đã tạo không bị đụng.

## Tự kích hoạt
`ShopActivation.reconcile` chạy trong giao dịch của mọi thay đổi có thể làm đủ điều kiện (cập nhật hồ sơ, đặt giờ, thêm/sửa/ẩn/hiện/xóa món, Admin mở lại quán) và khi chủ quán đọc checklist (dự phòng cho dữ liệu cũ). Ghi `activated_at` đúng một lần (`WHERE activated_at IS NULL`), một audit `shop.auto_activated.v1` (actor SYSTEM) và một outbox `shop.activated.v1`. Gọi lặp/đồng thời không tạo thêm. Không tăng version hồ sơ. Không có bước gửi duyệt; các thao tác sửa hồ sơ/giờ/món không bị điều kiện này chặn.

API chủ quán: `GET /v1/onboarding/shop/setup` (x/4, từng bước, mục thiếu, trạng thái INCOMPLETE/ACTIVATED/LOCKED/NEEDS_REVIEW, yêu cầu của Admin). `GET /v1/shop/me` báo `NO_PICKUP_POINT` / `NO_SELLABLE_ITEM` thay vì ONLINE khi chưa đủ.

## Liên hệ nhanh
`GET /v1/shops/:id` trả `contact {phone, zalo_url, messenger_url, facebook_url}` từ `contact_phone_normalized`, `zalo`, `facebook` của hồ sơ. Server chuẩn hóa: chỉ https, host cố định (zalo.me, m.me, facebook.com), không userinfo/port, không suy ID từ chuỗi lạ. App kiểm tra lại, gọi chỉ mở trình quay số (`N11LaunchChannel`, ACTION_DIAL, không quyền mới); không mở được → sao chép + thông báo.

## Khoảng cách đường đi
`POST /v1/discovery/route-distances` (công khai, ≤20 quán/lần): định tuyến M14 từ vị trí hiện tại của khách (làm tròn ~11 m, không lưu) đến điểm lấy hàng của quán (từ dòng DB), chỉ quán công khai. Tối đa 4 route đồng thời toàn hệ thống, hàng đợi có trần, cache của `M14RouteClient` (5 phút). App: `RouteDistanceController` — một request tại một thời điểm, ≤20 quán/request, ≤60 quán, cache 10 phút, lỗi chờ 1 phút, bỏ kết quả khi đổi vị trí/điểm quán/khu vực. Không có route → “Chưa xác định quãng đường” (kèm “≈ x km đường chim bay” có nhãn). Không dùng chặng quán → địa chỉ giao; phí M06 và GPS foreground giữ nguyên.

## Admin Web (trang Quản lý quán, quyền `can_manage_shops`)
Danh sách/chi tiết có `setup` (x/4, mục thiếu, lý do khóa, yêu cầu), bộ lọc `setup=INCOMPLETE|ACTIVATED|LOCKED|NEEDS_REVIEW`. Lệnh mới `request-info` / `clear-request` (cần lý do, version, Idempotency-Key; chỉ ghi audit khi có thay đổi thật). Disable/enable giữ nguyên; mở lại không bỏ qua điều kiện.

## Migration
`1796515200000_shop-setup-readiness.sql` (tiến, không sửa migration cũ): 3 cột nullable trên `app.shops`, 2 CHECK, backfill `activated_at` cho quán đã đủ điều kiện. Hash đã ghi trong `ops/selfhosted/reviewed-migrations.json`. Chưa chạy trên VPS.

## Giới hạn
Server không phân biệt tọa độ lấy từ GPS với ghim tay trên bản đồ (không có cột nguồn); “GPS tại quán” dựa vào việc app chỉ cho chọn vị trí qua bộ chọn hiện có. Xem trước menu của chủ quán không hiển thị nút liên hệ.
