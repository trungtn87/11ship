# M02 — UI Flutter (11Food, điện thoại): đã dựng, đã nối, còn thiếu

Phạm vi gói này (Owner 14/10/2026): chỉ UI Flutter, điều hướng, trạng thái hiển thị và nối **API đã có**. Không backend, schema, migration, API mới. Bộ thiết kế: [UI v3 chốt tạm](../ui/m02/v3/README.md). Không phải nghiệm thu Owner, không đóng M02.

## Màn đã dựng (Flutter, `mobile/packages/n11_shared/lib/src/m02/`)
| Màn | File | Nối API |
|---|---|---|
| Q01 Quản lý cửa hàng (trạng thái theo lịch từ máy chủ, tải lại khi mở/quay lại foreground/30 giây, không request chồng) | `shop_manage_views.dart` | `GET /v1/shop/me` — **đã nối** |
| Q02 Hồ sơ quán (xem/sửa, lấy GPS khi bấm, khu vực, conflict, chỉ đọc) | `shop_manage_views.dart` | `PUT /v1/shop/me/profile`, `GET /v1/onboarding/shop/service-areas` — **đã nối** |
| Q03/Q04 Giờ hoạt động, chỉnh giờ (Cả tuần, từng ngày, nhiều khoảng, phút lẻ, qua đêm, 24 giờ, đóng cả tuần, kiểm trùng cả vòng tuần, tối đa 28) | `hours_views.dart`, `schedule.dart` | `PUT /v1/shop/me/business-hours` — **đã nối** |
| Q05 Thực đơn, Q06-A/B thêm/sửa món, ảnh, nhóm, hiện/ẩn/xóa mềm | `menu_views.dart`, `menu_controller.dart` | **chưa nối** (xem dưới) |
| Q07 Xem trước, K01 khách xem quán, K02 giờ hoạt động phía khách | `preview_views.dart`, `public_shop_controller.dart` | **chưa nối** (xem dưới) |

Lối vào: Tài khoản → Quản lý cửa hàng → Cửa hàng của tôi → (bật chế độ cửa hàng) → **Quản lý hoạt động quán** (Q01). Q07 có nút "Xem như khách" mở K01 bằng id quán của chính chủ quán; không có trang tìm quán (đúng đặc tả).

## Quy tắc pending / ghi (đã có test)
- Timeout / mất mạng / 502-504 / `TRANSACTION_OUTCOME_UNKNOWN` giữ nguyên **key + body** của thao tác; khóa mọi chỉnh sửa và thao tác ghi khác; chỉ nút "Thử lại" gửi lại đúng key/body đó. Thử lại lỗi mạng tiếp vẫn giữ. Chỉ giải phóng khi máy chủ trả 2xx hoặc từ chối dứt khoát.
- Hết phiên: xóa nháp và thao tác pending, không replay dưới tài khoản khác.
- Conflict giữ nháp; "Tải bản mới" hỏi xác nhận lần hai. Lưu xong mà đọc lại lỗi → "Đã lưu, chưa tải lại được dữ liệu".
- Validate giờ chỉ báo lỗi cạnh khoảng, không sửa giờ đã nhập; không công tắc nhận đơn.

## Phần chưa nối — cần task chức năng riêng (đúng phần thiếu)
Backend hiện **không có**: bảng/API nhóm món (catalog), món (tạo/sửa/ẩn/hiện/xóa mềm, version, idempotency), upload ảnh + URL ảnh, API công khai xem quán + thực đơn, và nguồn cấp nhóm món (D01/D02 cần capability Admin chưa có). UI dùng các cổng `MenuApi`, `PublicShopApi`, `ImagePickerPort` (`menu_models.dart`); bản này gắn `UnwiredMenuApi` / `UnwiredPublicShopApi`, nên Q05–Q07/K01 hiển thị đúng "Chưa nối máy chủ", **không có dữ liệu mẫu**. Khi có endpoint, chỉ cần một lớp cài đặt mỗi cổng và truyền vào `createFlows(menuApi:, publicApi:)` — màn không đổi. Giới hạn tên/giá/ảnh để máy chủ quyết; UI chỉ kiểm tên không rỗng và giá > 0.
- **Chọn ảnh**: `mobile/food/lib/image_picker_adapter.dart` (gói `image_picker`, bộ chọn ảnh hệ thống, không camera, không quyền mới). Chưa có nơi tải lên nên chưa kiểm được trọn luồng.

## Lỗi nền phát hiện, ngoài phạm vi UI (không sửa trong gói này)
**`PUT /v1/shop/me/profile` và `/business-hours` từ app Android sẽ bị máy chủ từ chối (403 `DEVICE_PROOF_*`)**: `apps/backend/src/app.setup.ts` chỉ bật bắt raw-body cho chữ ký thiết bị trên `client-auth`, `customer/me/profile`, `onboarding`, không có `shop/me`; chữ ký body ghi không khớp. `GET /v1/shop/me` vẫn chạy. Đã chứng minh bằng test tích hợp native (bỏ phần sửa → 403). Bản sửa + test nằm ở nhánh cục bộ `claude/m02-menu-backend-draft` (commit `833d2c7`, **chưa push**, gồm cả bản nháp backend thực đơn/API công khai/migration — toàn bộ ngoài phạm vi). Cần giao task backend riêng để Q02/Q03 lưu được trên máy thật.

## Kiểm tra
`flutter analyze` + `flutter test` ở `mobile/packages/n11_shared` (170 test) và `mobile/food`, `mobile/ship`. Bao gồm: logic lịch (qua đêm/24h/CN→T2), controller pending/conflict/đọc lại, từng màn ở 360 và 390px, bàn phím mở (footer còn bấm được), vùng chạm ≥ 44px. Ảnh chụp: `N11_SCREENSHOTS=<dir> flutter test test/m02_screenshots_test.dart` trong `mobile/food` (icon Material không nạp trong môi trường test nên hiện ô vuông). **Chưa kiểm**: máy thật, TalkBack, GPS thật, chọn ảnh thật.
