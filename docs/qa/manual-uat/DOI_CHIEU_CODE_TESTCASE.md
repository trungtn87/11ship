# Đối chiếu mã nguồn ↔ test case, và những phần chưa xác minh

Tài liệu này cho biết: **chức năng nào thật sự có trong code** (đã đọc trực tiếp), **test case nào kiểm chức năng đó**, **phần nào chưa có / chưa đủ bằng chứng**, và **chỗ nào tài liệu nghiệp vụ khác với code**.

- Mã nguồn đã đối chiếu: nhánh `main`, commit `00d83cc565a2709543f06a351802cd0fb28ecfa7` (24/10/2026). Nhánh làm việc trùng đúng commit này.
- Khi code và tài liệu khác nhau, **code (hành vi đã đọc được) được coi là sự thật**; chỗ lệch được ghi ở mục 4 để Owner quyết định.
- Tuyệt đối không suy đoán chức năng chưa tìm thấy bằng chứng: phần đó nằm ở mục 3 với nhãn **NOT READY** hoặc **CẦN XÁC MINH**.

## 1. Cách đối chiếu và mức bằng chứng

| Nguồn đã đọc | Nội dung |
|---|---|
| `mobile/food`, `mobile/ship`, `mobile/packages/n11_shared` | Toàn bộ màn hình, nút, thông báo tiếng Việt của hai ứng dụng (Dart, 112 file mã) |
| `apps/admin-web/src` | 25 màn hình Web Admin và `core/menu.ts` (menu và quyền) |
| `apps/backend/src` | 61 module (đơn hàng, giao hàng, ví, phí, thông báo, quản trị…), 48 controller |
| `database/migrations` | 53 migration (cấu trúc dữ liệu) |
| `docs/current/*.md` | 58 tài liệu nghiệp vụ; **ưu tiên bản mới nhất** (M07 23–24/10/2026, M10 timeouts 21/10, M03 20/10, M14 24/10) |
| `tests/`, `mobile/**/test` | Bộ kiểm thử tự động hiện có (160 tệp tích hợp, 179 tệp unit backend, 33 tệp Admin Web, 59 tệp Flutter) |

Mức bằng chứng trong bảng ở mục 2: **CODE** = đã đọc mã giao diện/backend; **DOC** = chỉ có tài liệu; **TỰ ĐỘNG** = có kiểm thử tự động đối chiếu; **MÁY THẬT** = chỉ kiểm được trên thiết bị thật.

## 2. Bảng đối chiếu chức năng ↔ test case

| Nhóm | Chức năng thật trong code | Bằng chứng (file/tài liệu) | Mức | Test case | Ghi chú |
|---|---|---|---|---|---|
| A. Cài đặt và tài khoản | Cài APK 11Food/11Ship, cập nhật đè giữ dữ liệu và đăng nhập | `mobile/README.md; AGENTS.md (Android test updates); .github/workflows/mobile-apk.yml` | CODE + DOC | TC-SET-001, TC-SET-002, TC-SET-003, TC-SET-007, TC-SET-008, TC-SET-012 | APK, SHA, versionCode do Người phụ trách cung cấp; không có bản cài sẵn trong kho mã (chỉ build thử M14 trong downloads/m14) |
| A. Cài đặt và tài khoản | Quyền vị trí, thông báo, hướng dẫn khi bị từ chối | `mobile/ship/lib/ship_online.dart; discovery_views.dart; flows/location.dart` | CODE | TC-SET-004, TC-SET-005, TC-NOTI-004 | Android 13+ mới có hộp xin quyền thông báo |
| A. Cài đặt và tài khoản | Xem phiên bản ứng dụng | `account_views.dart:212 (showDiagnostics bị tắt/loại trừ); widgets/diagnostics_view.dart` | CODE | TC-SET-006 | Màn "Chẩn đoán kết nối" có dòng "Phiên bản" nhưng KHÔNG có đường vào từ tab Tài khoản -> CẦN XÁC MINH |
| A. Cài đặt và tài khoản | Cập nhật trong ứng dụng (M13): "Có bản mới", "Cần cập nhật", kiểm SHA-256 | `mobile/packages/n11_shared/lib/src/m13/*; docs/current/M13-implementation-20261023.md` | CODE + DOC | TC-SET-009, TC-SET-010 | Cần SYSTEM đăng ký bản phát hành; kiểm tay trên máy thật |
| A. Cài đặt và tài khoản | Chống thiết bị không đạt (khóa phần cứng, không root) | `mobile/README.md (Device proof); account_views.dart (DEVICE_PROOF_UNSUPPORTED)` | CODE | TC-SET-011, TC-ABN-017 | Cần máy không đạt hoặc đồng hồ sai để thử |
| A. Cài đặt và tài khoản | Đăng ký khách hàng 3 bước + OTP SMS | `account_views.dart (_foodForm); phone_verification.dart; ops/runbooks/sms-gateway.md` | CODE + TỰ ĐỘNG | TC-ACC-001, TC-ACC-002, TC-ACC-006, TC-ACC-007, TC-ACC-008, TC-ACC-009, TC-ACC-010, TC-ACC-011, TC-ACC-012, TC-ACC-013 | OTP chỉ qua máy SMS Gateway; hết SMS = báo lỗi trung thực |
| A. Cài đặt và tài khoản | Đăng ký chủ quán (mục đích "Chủ quán") và shipper | `account_views.dart; docs/current/M03-simplified-onboarding-20261020.md` | CODE + DOC | TC-ACC-003, TC-ACC-004, TC-ACC-005 | Shipper được kích hoạt ngay, ví 0đ, không duyệt hồ sơ |
| A. Cài đặt và tài khoản | Đăng nhập, đăng xuất, sai mật khẩu, giới hạn thử | `account_views.dart (LoginScreen, confirmLogout); session_controller.dart` | CODE + TỰ ĐỘNG | TC-ACC-014, TC-ACC-015, TC-ACC-016, TC-ACC-017 |  |
| A. Cài đặt và tài khoản | Khôi phục phiên khi mở lại app / khởi động lại máy | `session_controller.dart; mobile/README.md (Storage)` | CODE | TC-ACC-018, TC-ACC-019, TC-ACC-026 | Không chứa thông tin đăng nhập trong sao lưu |
| A. Cài đặt và tài khoản | Quên mật khẩu bằng SMS, hiệu lực thu hồi phiên cũ | `flows/reset_views.dart; reset_controller.dart; docs/tasks/M01-B-RESET-password-recovery-design.md` | CODE + TỰ ĐỘNG | TC-ACC-020, TC-ACC-021, TC-ACC-022 | SYSTEM không đặt lại được bằng luồng này |
| A. Cài đặt và tài khoản | Đổi mật khẩu, sửa họ tên | `account_views.dart (ChangePasswordScreen, ProfileScreen)` | CODE + TỰ ĐỘNG | TC-ACC-023, TC-ACC-024, TC-ACC-028 |  |
| A. Cài đặt và tài khoản | Một thiết bị/một phiên; đăng nhập máy khác đuổi máy cũ | `mobile/README.md (login from another phone ends the sessions); native-device-binding test` | CODE + TỰ ĐỘNG | TC-ACC-025, TC-ABN-020 |  |
| A. Cài đặt và tài khoản | Khóa/mở khóa tài khoản thu hồi phiên; khôi phục tài khoản khóa theo yêu cầu xóa | `apps/admin-web accounts-view.ts; docs/current/M01-final-package-20261014.md` | CODE + DOC + TỰ ĐỘNG | TC-ACC-027, TC-ACC-031, TC-ADM-013, TC-ADM-035 | Mở khóa không tự mở lại quán/hồ sơ shipper/số dư |
| A. Cài đặt và tài khoản | Điều khoản, chính sách, duyệt xem khi chưa đăng nhập, voucher | `account_views.dart (PolicyScreen, VoucherScreen); preview_views.dart` | CODE | TC-ACC-029, TC-ACC-030, TC-ACC-033 | Voucher: NOT READY; điều khoản: chờ Owner duyệt nội dung |
| A. Cài đặt và tài khoản | Công tắc OTP đăng ký / quên mật khẩu (SYSTEM) | `apps/admin-web settings-view.ts; docs/current/M01-final-package-20261014.md` | CODE + DOC | TC-ACC-032 | Chỉ thử khi Owner cho phép |
| B. Khách hàng 11Food | Trang chủ, định vị GPS, khu vực phục vụ, ngoài khu vực | `m02/discovery_views.dart; docs/ops/service-area-gps-154.md` | CODE + TỰ ĐỘNG | TC-CUS-001, TC-CUS-002, TC-CUS-003, TC-CUS-004 | Khu vực = vòng tròn 10 km quanh TP Cao Bằng; cần người thật đứng ngoài để thử |
| B. Khách hàng 11Food | Tìm quán/món, bộ lọc, nhóm món | `discovery_views.dart; tests/integration/discovery.int.spec.ts` | CODE + TỰ ĐỘNG | TC-CUS-005, TC-CUS-006, TC-CUS-007, TC-CUS-008 |  |
| B. Khách hàng 11Food | Chi tiết quán, giờ, thực đơn, món ẩn, quán đóng cửa, hết món, đánh giá quán | `m02/preview_views.dart; m11_rating_views.dart` | CODE + TỰ ĐỘNG | TC-CUS-009, TC-CUS-010, TC-CUS-011, TC-CUS-012, TC-CUS-013, TC-CUS-014 |  |
| B. Khách hàng 11Food | Giỏ hàng: thêm, gộp dòng, sửa, đổi quán, giữ trên máy chủ | `m10/m10_customer_views.dart; m10_cart.dart; docs/current/M10-implementation-20261018.md` | CODE + TỰ ĐỘNG | TC-CUS-015, TC-CUS-016, TC-CUS-017, TC-CUS-018, TC-CUS-019, TC-CUS-020, TC-CUS-034 |  |
| B. Khách hàng 11Food | Phí giao dự tính, "Chưa xác định phí", tổng dự kiến | `m10_common.dart; docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md` | CODE + TỰ ĐỘNG | TC-CUS-021, TC-FLOW-028 | Phụ thuộc bảng phí và dịch vụ tuyến |
| B. Khách hàng 11Food | Sổ địa chỉ giao hàng | `addresses/address_views.dart; tests/integration/customers-addresses.int.spec.ts` | CODE + TỰ ĐỘNG | TC-CUS-022, TC-CUS-023, TC-CUS-024 | Ghim trên bản đồ chỉ có khi APK có gói bản đồ |
| B. Khách hàng 11Food | Đặt hàng: người nhận, địa chỉ, ghi chú, đặt hộ, hẹn giờ, đóng cửa, đổi giá, hết món | `m10_customer_views.dart (CheckoutScreen)` | CODE + TỰ ĐỘNG | TC-CUS-025, TC-CUS-026, TC-CUS-027, TC-CUS-028, TC-CUS-029, TC-CUS-030, TC-CUS-031, TC-CUS-032, TC-CUS-033 |  |
| B. Khách hàng 11Food | Theo dõi đơn, hủy trước/sau xác nhận, đặt lại, riêng tư | `m10_customer_views.dart; apps/backend/src/orders/order-rules.ts` | CODE + TỰ ĐỘNG | TC-CUS-035, TC-CUS-036, TC-CUS-037, TC-CUS-038, TC-CUS-039, TC-CUS-040 |  |
| B. Khách hàng 11Food | Hủy đơn SAU khi shipper lấy hàng (người tạo đơn) | `docs/current/M07-owner-delivery-flow-20261023.md mục VII` | DOC + CODE + TỰ ĐỘNG | TC-FLOW-019 |  |
| B. Khách hàng 11Food | Thông báo và mở đúng đơn | `m08/m08_views.dart; food_tabs.dart (foodNotificationRouter)` | CODE + TỰ ĐỘNG | TC-NOTI-002, TC-NOTI-003, TC-NOTI-005, TC-FLOW-023, TC-SHOP-030 | Push thật cần Firebase (CẦN XÁC MINH) |
| C. Chủ quán 11Food | Hồ sơ quán + GPS lấy hàng, hoàn tất, chưa đủ điều kiện, ngoài khu vực | `flows/shop_views.dart; flows/location.dart; apps/backend/src/shop` | CODE + TỰ ĐỘNG | TC-SHOP-001, TC-SHOP-002, TC-SHOP-003, TC-SHOP-004 | KHÔNG có bước Admin duyệt; quán hoạt động khi hồ sơ đủ (TC-ADM-015) |
| C. Chủ quán 11Food | Chuyển chế độ quán/khách, sửa hồ sơ, logo | `m02/shop_tab.dart; shop_manage_views.dart; flows/shop_logo_widgets.dart` | CODE + TỰ ĐỘNG | TC-SHOP-005, TC-SHOP-006, TC-SHOP-007 |  |
| C. Chủ quán 11Food | Giờ hoạt động: cả tuần, từng ngày, qua đêm, lịch sai, chưa cài | `m02/hours_views.dart; schedule.dart` | CODE + TỰ ĐỘNG | TC-SHOP-008, TC-SHOP-009, TC-SHOP-010, TC-SHOP-011 |  |
| C. Chủ quán 11Food | Thực đơn: thêm/sửa/ẩn/xóa món, ảnh, nhóm món, xem như khách | `m02/menu_views.dart; preview_views.dart; apps/backend/src/menu` | CODE + TỰ ĐỘNG | TC-SHOP-012, TC-SHOP-013, TC-SHOP-014, TC-SHOP-015, TC-SHOP-016, TC-SHOP-017, TC-SHOP-018, TC-SHOP-019, TC-SHOP-020, TC-SHOP-037 | Cần Admin tạo nhóm món (TC-ADM-020) |
| C. Chủ quán 11Food | Nhận đơn, xác nhận, từ chối, chỉnh đơn, hủy đơn món, lọc/tìm, lịch sử | `m10/m10_shop_views.dart` | CODE + TỰ ĐỘNG | TC-SHOP-021, TC-SHOP-022, TC-SHOP-023, TC-SHOP-024, TC-SHOP-025, TC-SHOP-026, TC-SHOP-027 | Bước "Món đã sẵn sàng" đã bỏ (M07 23/10) |
| C. Chủ quán 11Food | Đơn hẹn giờ phía quán, đổi lịch, nhắc | `m10_shop_views.dart; apps/backend/src/orders (SCHEDULE_*)` | CODE + TỰ ĐỘNG | TC-SHOP-028, TC-SHOP-029, TC-FLOW-027 |  |
| C. Chủ quán 11Food | Gọi shipper cho đơn của khách (Quán/Khách trả phí), gọi lại, hủy yêu cầu giao | `m10_shop_views.dart (_call); m07_shop_views.dart` | CODE + TỰ ĐỘNG | TC-FLOW-001, TC-FLOW-002, TC-FLOW-006, TC-FLOW-017, TC-FLOW-018 |  |
| C. Chủ quán 11Food | Quán chủ động tạo yêu cầu giao (DIRECT) và các ràng buộc nhập liệu | `m07/m07_shop_views.dart (form tạo yêu cầu)` | CODE + TỰ ĐỘNG | TC-SHOP-031, TC-SHOP-032, TC-SHOP-033, TC-SHOP-034, TC-SHOP-035, TC-FLOW-003, TC-FLOW-004 | Không cần GPS điểm giao; không theo dõi hành trình |
| C. Chủ quán 11Food | Thương lượng phí (quán là người quyết định), xác nhận thay khách, xử lý hàng | `m07_shop_views.dart; docs/current/M07-owner-delivery-flow-20261023.md` | CODE + TỰ ĐỘNG | TC-FLOW-013, TC-FLOW-014, TC-SHOP-036, TC-FLOW-020, TC-FLOW-021, TC-FLOW-022 |  |
| D. Shipper 11Ship | Trang chủ shipper, online/offline, điều kiện ví, GPS | `mobile/ship/lib/ship_home.dart; ship_online.dart` | CODE + TỰ ĐỘNG | TC-DRV-001, TC-DRV-002, TC-DRV-003, TC-DRV-004, TC-DRV-005, TC-DRV-006 |  |
| D. Shipper 11Ship | Danh sách "Có thể nhận", quyền riêng tư trước khi nhận, bán kính 3 km, vị trí tươi | `m07/m07_ship_views.dart; apps/backend/src/shipping-policy` | CODE + TỰ ĐỘNG | TC-DRV-007, TC-DRV-008, TC-DRV-009, TC-DRV-010 | Test 3 km cần người đứng xa thật |
| D. Shipper 11Ship | Đồng ý/đề xuất phí/bỏ qua; đề xuất phí sau khi nhận | `m07_ship_views.dart (m07-fee-*, m07-propose-fee)` | CODE + TỰ ĐỘNG | TC-DRV-011, TC-DRV-024, TC-FLOW-007, TC-FLOW-008, TC-FLOW-009, TC-FLOW-010, TC-FLOW-011, TC-FLOW-012, TC-FLOW-015 |  |
| D. Shipper 11Ship | Hủy nhận đơn trước khi lấy hàng; sau khi lấy hàng không hủy/không "Giao thất bại" | `m07_ship_views.dart; docs/current/M07-owner-delivery-flow-20261023.md mục I` | CODE + TỰ ĐỘNG | TC-DRV-012, TC-DRV-013, TC-DRV-015, TC-FLOW-016 | Quyền hủy sau lấy hàng kiểm ở máy chủ (cần kỹ thuật viên gọi trực tiếp) |
| D. Shipper 11Ship | Giao thành công, lịch sử, địa chỉ mô tả (DIRECT) | `m07_ship_views.dart` | CODE + TỰ ĐỘNG | TC-DRV-014, TC-DRV-016, TC-DRV-017, TC-DRV-025 |  |
| D. Shipper 11Ship | Hồ sơ shipper, khóa tài khoản, thông báo shipper | `flows/driver_views.dart; m08_views.dart` | CODE + TỰ ĐỘNG | TC-DRV-020, TC-DRV-021, TC-DRV-023 |  |
| D. Shipper 11Ship | Xem vị trí/bản đồ, chỉ đường | `mobile/ship/lib/ship_m07.dart (kM14Map); docs/current/M14-*` | CODE | TC-DRV-018, TC-DRV-019 | Bản đồ phụ thuộc cờ build; CHỈ ĐƯỜNG KHÔNG CÓ (NOT READY) |
| D. Shipper 11Ship | Tab Thu nhập | `mobile/ship/lib/ship_tabs.dart (_income)` | CODE | TC-DRV-022 | NOT READY – chỉ khung "Chưa có dữ liệu" |
| D. Shipper 11Ship | Chạy nền, khóa màn hình, gửi vị trí, khởi động lại | `docs/current/M14-online-location-20261024.md; ship_online.dart` | CODE + DOC | TC-ABN-004, TC-ABN-005, TC-ABN-006, TC-ABN-007, TC-ABN-008, TC-ABN-014, TC-ABN-015 | Phần lớn CHỈ kiểm được trên máy thật; tài liệu nói rõ chưa chạy thật trên máy |
| E. Luồng giao hàng liên thông | Hai luồng ORDER và DIRECT trọn vẹn | `docs/current/M07-owner-delivery-flow-20261023.md; apps/backend/src/orders, delivery` | DOC + CODE + TỰ ĐỘNG | TC-FLOW-001, TC-FLOW-002, TC-FLOW-003, TC-FLOW-004 |  |
| E. Luồng giao hàng liên thông | Không có shipper nhận, ngừng tìm, gọi lại, tự hủy theo thời hạn | `docs/current/M10-timeouts-20261021.md; apps/admin-web order-timeouts-page.ts` | DOC + CODE + TỰ ĐỘNG | TC-FLOW-005, TC-FLOW-006, TC-FLOW-029, TC-NOTI-007, TC-ADM-026 | Mốc mặc định 30 phút nên cần rút ngắn bằng cấu hình để thử nhanh |
| E. Luồng giao hàng liên thông | Đề xuất phí: đồng ý/từ chối/hết hạn/sau khi nhận; quán/khách quyết định | `docs/current/M07-owner-delivery-flow-20261023.md (Addendum 24/10)` | DOC + CODE + TỰ ĐỘNG | TC-FLOW-007, TC-FLOW-008, TC-FLOW-009, TC-FLOW-010, TC-FLOW-011, TC-FLOW-012, TC-FLOW-013, TC-FLOW-014, TC-FLOW-015 |  |
| E. Luồng giao hàng liên thông | Hủy trước/sau lấy hàng, xử lý hàng, hoa hồng giải phóng | `docs/current/M07-owner-delivery-flow-20261023.md mục I, VII` | DOC + CODE + TỰ ĐỘNG | TC-FLOW-016, TC-FLOW-017, TC-FLOW-018, TC-FLOW-019, TC-FLOW-020, TC-FLOW-021, TC-FLOW-022, TC-FLOW-026 |  |
| E. Luồng giao hàng liên thông | Chống trùng đơn / yêu cầu giao; mất mạng lúc gửi | `docs/current/M10-implementation-20261018.md; idempotency` | CODE + TỰ ĐỘNG | TC-FLOW-024, TC-FLOW-025, TC-ABN-013, TC-ABN-002, TC-ABN-003 |  |
| E. Luồng giao hàng liên thông | Giới hạn số đơn cùng lúc / ghép đơn | `apps/admin-web config.ts (external_max_deliveries); M06-BC` | DOC | TC-FLOW-030 | Kỳ vọng chính xác cần Owner xác nhận (CẦN XÁC MINH) |
| F. Ví và tài chính | Ví shipper: số dư, tạm giữ, khả dụng, lịch sử, lọc | `wallet/wallet_views.dart; wallet_http.dart; docs/current/M04-*` | CODE + TỰ ĐỘNG | TC-WAL-001, TC-WAL-011, TC-WAL-012 |  |
| F. Ví và tài chính | Nạp tiền: yêu cầu, thông tin chuyển khoản, hủy; Admin ghi nhận/từ chối/trùng mã | `wallet_views.dart (Topup*); finance-admin-view.ts; M04-B2` | CODE + TỰ ĐỘNG | TC-WAL-002, TC-WAL-003, TC-WAL-004, TC-WAL-005, TC-WAL-006, TC-WAL-007, TC-WAL-008, TC-WAL-009, TC-WAL-010, TC-WAL-024 | Mã QR chưa hỗ trợ; ảnh chuyển khoản chưa dùng được |
| F. Ví và tài chính | Rút tiền chỉ trong luồng dừng hoạt động; Admin nhận xử lý/đã chuyển/đối soát | `wallet_views.dart (WithdrawScreen); finance-ops-view.ts; M04-C` | CODE + TỰ ĐỘNG | TC-WAL-014, TC-WAL-015, TC-WAL-016, TC-WAL-017, TC-WAL-023 | Không có nút Rút tiền riêng cho shipper đang hoạt động |
| F. Ví và tài chính | Phí giao và phí điều chỉnh (đề xuất, thỏa thuận); hoa hồng cấu hình | `M06 v1.1; finance-ops-view.ts (Đổi mức hoa hồng)` | DOC + CODE + TỰ ĐỘNG | TC-ADM-024, TC-ADM-025, TC-WAL-021, TC-WAL-022 |  |
| F. Ví và tài chính | Ví không đủ tiền; đơn đang giao không bị hủy khi số dư giảm | `shipping-eligibility.ts; wallet-driver-port.ts` | CODE + TỰ ĐỘNG | TC-DRV-003, TC-WAL-013 |  |
| F. Ví và tài chính | ADMIN/SYSTEM xử lý tài chính, phân quyền tài chính, tài khoản nhận tiền, tổng quan/đối soát | `finance-view.ts; finance-ops-view.ts; M04-B3` | CODE + TỰ ĐỘNG | TC-WAL-018, TC-WAL-019, TC-WAL-020, TC-WAL-025 |  |
| G. Web Admin | Đăng nhập, 2 lớp, mở lời mời, kích hoạt, phân quyền, khóa ADMIN, quên mật khẩu | `apps/admin-web view.ts, provisioning-view.ts, activation-view.ts, access-view.ts, reset-view.ts` | CODE + TỰ ĐỘNG | TC-ADM-001, TC-ADM-002, TC-ADM-003, TC-ADM-004, TC-ADM-005, TC-ADM-006, TC-ADM-009, TC-ADM-010, TC-ADM-011, TC-SEC-005 | SYSTEM do kỹ thuật viên tạo |
| G. Web Admin | Phân biệt quyền ADMIN và SYSTEM; menu theo quyền | `apps/admin-web core/menu.ts` | CODE + TỰ ĐỘNG | TC-ADM-007, TC-ADM-008, TC-SEC-006 |  |
| G. Web Admin | Người dùng: tìm, khóa, mở khóa, xóa | `accounts-view.ts` | CODE + TỰ ĐỘNG | TC-ADM-012, TC-ADM-013, TC-ADM-035, TC-ACC-027 |  |
| G. Web Admin | Quán: danh sách, chi tiết, vô hiệu hóa/kích hoạt; KHÔNG có duyệt hồ sơ | `shops-view.ts; docs/current/M02-admin-shops-20261024.md` | CODE + DOC + TỰ ĐỘNG | TC-ADM-014, TC-ADM-015, TC-ADM-016, TC-CUS-014 |  |
| G. Web Admin | Shipper: danh sách, khóa hoạt động, hồ sơ/ngân hàng cũ | `shippers-view.ts` | CODE + TỰ ĐỘNG | TC-ADM-017, TC-ADM-018, TC-ADM-019, TC-DRV-021 | Còn nút Xác minh/Từ chối dù shipper không cần duyệt (CẦN XÁC MINH) |
| G. Web Admin | Đơn hàng, giao hàng: tra cứu, hủy, đóng, giải phóng shipper, ghi nhận hàng | `orders-view.ts; deliveries-view.ts` | CODE + TỰ ĐỘNG | TC-ADM-021, TC-ADM-022, TC-ADM-023, TC-ADM-036 |  |
| G. Web Admin | Danh mục nhóm món; bảng phí; thời hạn đơn; cấu hình tập trung | `catalog-view.ts; shipping-policy-view.ts; order-timeouts-page.ts; config-view.ts` | CODE + TỰ ĐỘNG | TC-ADM-020, TC-ADM-024, TC-ADM-026, TC-ADM-027 |  |
| G. Web Admin | Nhật ký (audit), điều hành, báo cáo, vận hành hệ thống, sao lưu, giám sát | `audit-view.ts; overview-view.ts; reports-view.ts; ops-view.ts; backups-view.ts; monitoring-errors-view.ts` | CODE + TỰ ĐỘNG | TC-ADM-028, TC-ADM-029, TC-ADM-030, TC-ADM-031, TC-ADM-032 | Một số mục cần hạ tầng (Discord, máy giám sát ngoài) |
| G. Web Admin | Mục "Vùng hoạt động" và trang chủ Admin | `menu.ts (soon); shell-app.ts (#home)` | CODE | TC-ADM-033, TC-ADM-034 | NOT READY / nội dung cũ |
| G. Web Admin | Thông báo (Admin), đánh giá, phản ánh | `notifications-view.ts; feedback-view.ts` | CODE + TỰ ĐỘNG | TC-NOTI-006, TC-FEED-005, TC-FEED-006 |  |
| H. Trường hợp bất thường | Mất Internet, máy chủ chậm/không sẵn sàng | `errors.dart (healthCopy); connection_banner.dart` | CODE + TỰ ĐỘNG | TC-ABN-001, TC-ABN-009 | Làm chậm máy chủ cần kỹ thuật viên |
| H. Trường hợp bất thường | Hai người cùng thao tác một đơn (đua) | `apps/backend/src/delivery, orders; tests m07/m10` | CODE + TỰ ĐỘNG | TC-ABN-010, TC-ABN-011, TC-ABN-012, TC-ABN-021, TC-DRV-010, TC-AUTO-001 | Khó tái hiện bằng tay; cần chạy lặp |
| H. Trường hợp bất thường | Nhập dữ liệu sai/đặc biệt; màn hình nhỏ; Android khác đời; giờ sai; nút Back | `validators; tokens.dart` | CODE | TC-ABN-016, TC-ABN-018, TC-ABN-019, TC-ABN-022, TC-ACC-007 | Android 8/10/12/13/14 phụ thuộc máy sẵn có |
| Bổ sung | Thông báo đẩy, đồng bộ, cài đặt, riêng tư | `m08; docs/current/M08-implementation-20261018.md; ops/runbooks/m08-push-deploy-20261018.md` | CODE + DOC + TỰ ĐỘNG | TC-NOTI-001, TC-NOTI-002, TC-NOTI-003, TC-NOTI-004, TC-NOTI-005 | Push thật chưa chắc đã cấu hình (CẦN XÁC MINH) |
| Bổ sung | Đánh giá quán/shipper, phản ánh, ảnh minh chứng, xem xét lại | `m11; docs/current/M11-implementation-20261018.md` | CODE + TỰ ĐỘNG | TC-FEED-001, TC-FEED-002, TC-FEED-003, TC-FEED-004, TC-FEED-007, TC-FEED-008 |  |
| Bổ sung | Quyền, riêng tư, an toàn dữ liệu | `tests/integration; orders/delivery controllers` | CODE + TỰ ĐỘNG | TC-SEC-001, TC-SEC-002, TC-SEC-003, TC-SEC-004, TC-SEC-007 |  |
| Bổ sung | Đối chiếu kiểm thử tự động cho rủi ro khó thử tay | `.github/workflows/ci.yml; tests/integration` | TỰ ĐỘNG | TC-AUTO-002, TC-AUTO-003, TC-AUTO-004, TC-AUTO-005, TC-AUTO-006, TC-AUTO-007 | Chỉ cho kỹ thuật viên; không thay thế thử tay |

## 3. Chức năng chưa có, chưa hoàn thành hoặc chưa đủ bằng chứng

Mỗi dòng đều **có test case** (không bỏ qua), để ghi nhận hiện trạng.

| Chức năng / điểm | Bằng chứng trong mã nguồn | Tình trạng | Test case ghi nhận |
|---|---|---|---|
| Chỉ đường từng bước cho shipper | Không tìm thấy trong mobile/ship và n11_shared; chỉ có bản đồ offline hiển thị điểm | **NOT READY** | TC-DRV-019 |
| Tab "Thu nhập" của shipper | Chỉ có khung "Chưa có dữ liệu thu nhập" (ship_tabs.dart _income) | **NOT READY** | TC-DRV-022 |
| Voucher / mã giảm giá | Màn Voucher ghi "Tính năng voucher chưa được hỗ trợ" | **NOT READY** | TC-ACC-033 |
| Mục "Trợ giúp" trong hai app | ListItem soon: true | **NOT READY** | (không cần test: theo thiết kế) |
| Mục "Vùng hoạt động" ở Web Admin | menu.ts: soon("zones") | **NOT READY** | TC-ADM-033 |
| Mã QR chuyển khoản và đính kèm ảnh chuyển khoản khi nạp ví | wallet_views.dart: "Mã QR chưa được hỗ trợ ở phiên bản này"; "Đính kèm ảnh chưa dùng được" | **NOT READY** | TC-WAL-003 |
| Nút "Rút tiền" riêng cho shipper đang hoạt động | Chỉ có trong luồng "Dừng hoạt động / Rút tiền" (WithdrawScreen closing mode); nút riêng chỉ ở bản mẫu | **THEO THIẾT KẾ (M03 20/10)** | TC-WAL-014, TC-WAL-015 |
| Chuyển một phần khi rút tiền; API điều chỉnh số dư thủ công | docs/current/M04-C: "chưa được Owner duyệt – hệ thống từ chối an toàn" | **KHÔNG CÓ (cố ý)** | TC-WAL-016 |
| Duyệt quán / duyệt hồ sơ shipper bởi Admin | Quán ACTIVE ngay khi hồ sơ đủ; shipper ACTIVE ngay khi đăng ký; Web Admin chỉ có Vô hiệu hóa/Kích hoạt lại quán và các nút Xác minh/Từ chối cũ | **CẦN XÁC MINH (lệch tài liệu)** | TC-ADM-015, TC-ADM-019 |
| Hiển thị phiên bản ứng dụng trong app | Màn Chẩn đoán kết nối có dòng Phiên bản nhưng không có đường vào từ Tài khoản | **CẦN XÁC MINH** | TC-SET-006 |
| Thông báo đẩy thật (Firebase) | docs/current/M08: "APK bàn giao hiện chưa có push"; phụ thuộc cấu hình máy chủ và bản APK | **CẦN XÁC MINH** | TC-NOTI-001, TC-FLOW-023, TC-ABN-014 |
| Bản đồ ghim điểm giao / xem vị trí trong 11Food và 11Ship | Chỉ khi APK build có cờ M14_OFFLINE_MAP và gói bản đồ Cao Bằng | **CẦN XÁC MINH** | TC-DRV-018, TC-CUS-027, TC-CUS-022 |
| Khu vực phục vụ nhiều vùng | Hiện chỉ cấu hình vùng "Cao Bằng" bán kính 10 km (migration 1795478400000); thêm vùng cần kỹ thuật viên | **THEO CẤU HÌNH** | TC-CUS-003, TC-SHOP-004 |
| Ghép đơn / giới hạn số đơn cùng lúc | Có tham số cấu hình; kết quả mong đợi chi tiết cần Owner xác nhận | **CẦN XÁC MINH** | TC-FLOW-030 |
| Nội dung Điều khoản và Chính sách quyền riêng tư | docs/current/M01-terms-privacy-20261014.md ghi chờ Owner duyệt; Điều khoản hiển thị ghi "đặt món, giao hàng, ví và doanh thu chưa hoạt động" và "quyền chỉ có sau khi hồ sơ được duyệt"; Chính sách ghi "không theo dõi vị trí nền" trong khi 11Ship chia sẻ vị trí nền khi online | **CẦN XÁC MINH (lệch nội dung pháp lý)** | TC-ACC-029, TC-SEC-007 |
| Trang chủ Web Admin còn câu "sẽ có ở bước sau" | shell-app.ts #home | **LỆCH NỘI DUNG** | TC-ADM-034 |
| Tải lại trang con của Web Admin bị 404 | docs/current/M02-admin-shops-20261024.md mục "Phát hiện ngoài phạm vi" (SPA_ROUTES thiếu route) | **LỖI ĐÃ BIẾT** | TC-ADM-007 |
| Thanh toán trực tuyến / COD qua ứng dụng | Không có: tiền món và phí giao trả trực tiếp (m10_common.dart "Thanh toán trực tiếp") | **THEO THIẾT KẾ** | (không cần test: theo thiết kế) |

### 3.1 Điều kiện môi trường mà người kiểm thử mới **không tự tạo được**

| Điều kiện | Vì sao | Ai làm | Test bị ảnh hưởng nếu thiếu |
|---|---|---|---|
| Tài khoản **SYSTEM** | Không có đường tạo trên giao diện; do công cụ trên máy chủ | Kỹ thuật viên | Mọi test cần SYSTEM (TC-ADM-002/004…, cấu hình, phí, hoa hồng) |
| **SMS Gateway** (điện thoại gửi OTP) + danh sách số được phép nhận SMS | OTP chỉ đi qua máy này; mặc định chỉ số trong danh sách trắng nhận được | Kỹ thuật viên/Owner | TC-ACC-001…013, TC-ADM-005/011 |
| **Bảng phí giao** do SYSTEM áp dụng; **dịch vụ tuyến** | Thiếu thì phí "Chưa xác định phí" | SYSTEM/Kỹ thuật viên | TC-CUS-021, TC-FLOW-* |
| **Tiền thử nghiệm** trong ví shipper | Chỉ Admin ghi nhận được; mỗi ghi nhận là bút toán thật | Owner duyệt + Admin | TC-WAL-005 và mọi test shipper nhận đơn |
| **Thông báo đẩy (Firebase)** | Cần khóa dịch vụ và APK có hỗ trợ push | Kỹ thuật viên/Owner | TC-NOTI-001, TC-FLOW-023 (phần màn hình khóa), TC-ABN-014 |
| **Gói bản đồ Cao Bằng** trong APK | Cờ build `M14_OFFLINE_MAP` | Kỹ thuật viên | TC-DRV-018, TC-CUS-027 (ghim bản đồ) |
| **Hai bản APK** (cũ và mới) / bản phát hành trong Web Admin | Thử cập nhật đè và cập nhật trong ứng dụng | Kỹ thuật viên | TC-SET-007/008/009/010 |
| Người **đứng ngoài khu vực phục vụ** / **cách quán > 3 km** | Ứng dụng từ chối vị trí giả | Người kiểm thử có điều kiện | TC-CUS-003, TC-SHOP-004, TC-DRV-008 |
| Làm **chậm/ngừng máy chủ**, rút ngắn **thời hạn tự hủy** | Cấu hình hạ tầng | Kỹ thuật viên/SYSTEM | TC-ABN-009, TC-FLOW-005/012/029 |

## 4. Chỗ tài liệu khác với mã nguồn (cần Owner quyết định)

| # | Tài liệu nói | Mã nguồn thực tế | Cách bộ test xử lý |
|---|---|---|---|
| 1 | `README.md` và `docs/PROGRESS.md`: "Chưa có Wallet, Delivery, frontend, SMS…", tiến độ dừng ở M00-D1, "CI main: Lỗi" | Code đã có M01–M14: đơn hàng, giao hàng, ví, thông báo, đánh giá, Admin Web, ứng dụng Android | **Không dùng README/PROGRESS làm nguồn trạng thái.** Test viết theo code và `docs/current` mới nhất |
| 2 | Checklist Owner M07/M10 (18–19/10): có bước **"Món đã sẵn sàng"**, **"Giao thất bại"**, **"Ghi nhận thanh toán"**, "Đã thanh toán/Còn phải thu" | M07 23/10 **bỏ** "Món đã sẵn sàng", shipper **không còn** "Giao thất bại", UI **bỏ** dòng thanh toán; endpoint `.../ready` chỉ giữ để APK cũ không lỗi | Test **theo quyết định mới** (TC-DRV-015, TC-SHOP-022, TC-CUS-025). Test kiểm cả việc các nút cũ **không còn** |
| 3 | Bán kính tìm shipper: M07 ghi 5 km | M06 v1.1 (18/10) khóa **3 km** | Dùng 3 km (TC-DRV-008) |
| 4 | Màn đăng ký chủ quán: "Chỉ bán hàng **sau khi được duyệt**"; Admin Điều hành có thẻ "Hồ sơ quán/shipper **chờ duyệt**" | Quán ACTIVE ngay khi hồ sơ đủ; shipper ACTIVE ngay khi đăng ký (M03 20/10); Admin chỉ có Vô hiệu hóa/Kích hoạt lại | TC-ADM-015, TC-ADM-019 (CẦN XÁC MINH) |
| 5 | Điều khoản hiển thị cho người dùng: "đặt món, giao hàng, ví và doanh thu **chưa hoạt động**; quyền chỉ có sau khi hồ sơ được duyệt" | Các chức năng này **đã hoạt động** | TC-ACC-029 (báo mức CAO; Owner duyệt/sửa điều khoản và đổi phiên bản) |
| 6 | Chính sách quyền riêng tư: "ứng dụng không theo dõi vị trí nền" (nói về hồ sơ quán) | 11Ship chia sẻ vị trí **nền** khi online (M14) | TC-SEC-007 (CẦN XÁC MINH) |
| 7 | `docs/current/M01-production-profile`: "xóa/khóa USER phải duyệt lại khi có đơn/ví" | Đã có kiểm tra "Không thể khóa lúc này: còn đơn đang xử lý" (M01 final) | TC-ADM-013, TC-ACC-027 |
| 8 | Trang chủ Web Admin: "Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau" | Nhiều chức năng đã có | TC-ADM-034 |
| 9 | Màn Chẩn đoán kết nối có "Phiên bản" | Không có đường vào từ Tài khoản (cả hai app) | TC-SET-006 |
| 10 | M10 (19/10): "chưa có bản đồ trong 11Food; M10 chưa hoàn tất" | Đã có `food_m14.dart` (bản đồ chỉ-bản-đồ) nếu APK build có cờ | TC-CUS-027, TC-DRV-018 (CẦN XÁC MINH theo bản APK) |
| 11 | M08 (18/10): "APK bàn giao hiện chưa có push" | Không rõ bản đang thử đã có push | TC-NOTI-001 (CẦN XÁC MINH) |
| 12 | `docs/PROGRESS.md` ghi CI main có thể FAIL | Không kiểm được từ kho mã | Kỹ thuật viên xem CI đúng commit (TC-AUTO-001…007), nhưng **không dùng CI xanh để nghiệm thu** |
| 13 | Tải lại trang con Web Admin (F5) | Có thể 404 (SPA_ROUTES thiếu) – `M02-admin-shops-20261024.md` | Ghi ở "hạn chế đã biết" của hướng dẫn |

## 5. Phân loại test case

| Loại kiểm thử | Ý nghĩa | Số test |
|---|---|---|
| Thủ công | Người kiểm thử mới tự làm được bằng điện thoại và trình duyệt (khi đã có điều kiện mục 3.1) | 198 |
| Cần hỗ trợ kỹ thuật | Cần kỹ thuật viên/SYSTEM/Owner chuẩn bị hoặc thao tác một phần (tài khoản SYSTEM, SMS, tiền thử nghiệm, cấu hình…) | 84 |
| Tự động đã có (đối chiếu) | Chỉ đối chiếu kết quả kiểm thử tự động của CI; dành cho kỹ thuật viên | 7 |
| *Tình trạng sẵn sàng* | SẴN SÀNG 184 · CẦN HỖ TRỢ KỸ THUẬT 83 · CẦN XÁC MINH 18 · NOT READY 4 | 289 |

**Kiểm thử tự động đã có (chỉ để đối chiếu, KHÔNG thay thế thử tay):**

| Nhóm rủi ro | Bộ kiểm thử tự động (đường dẫn) | Ghi chú giới hạn |
|---|---|---|
| Đăng ký, OTP, phiên, thiết bị | `tests/integration/auth-*.int.spec.ts`, `client-auth-*`, `native-*`, `account-*`; `mobile/packages/n11_shared/test/session_controller_test.dart`, `otp_flows_test.dart` | Dùng nhà cung cấp OTP giả; không kiểm SMS thật, không kiểm máy thật |
| Quán, thực đơn, giờ mở, khu vực | `shop-*`, `menu.int.spec.ts`, `discovery.int.spec.ts`, `shop-service-areas.int.spec.ts`; Flutter `m02_*_test.dart` | Không có GPS thật |
| Đặt hàng (M10) | `m10-orders.int.spec.ts`, `m10-admin-orders.int.spec.ts`; Flutter `m10_orders_test.dart`, `one_page_order_test.dart` | Không kiểm 2–3 người thật và thông báo thật |
| Giao hàng (M07), phí (M06) | `m07-delivery.int.spec.ts`, `m06-*.int.spec.ts`; Flutter `m07_*_test.dart`, `m06_views_test.dart` | Dịch vụ tuyến là máy chủ cục bộ giả |
| Ví (M04) | `m04-*.int.spec.ts`; Flutter `wallet_*_test.dart` | Không có ngân hàng thật; đối soát chạy trên dữ liệu thử |
| Thông báo (M08), đánh giá/phản ánh (M11) | `m08-*.int.spec.ts`, `m11-*.int.spec.ts`; Flutter `m08_test.dart`, `m11_test.dart` | Push dùng nhà cung cấp giả |
| Web Admin | `admin-*.int.spec.ts`, `m12-*`, `m13-*`; `apps/admin-web/src/**/*.spec.ts` | Có kiểm bằng trình duyệt tự động nhưng không phải quy trình người dùng thật |
| Chống trùng, outbox, giao dịch, nâng cấp CSDL | `idempotency-*`, `outbox-*`, `transaction/*`, `migration.int.spec.ts`, `staging-db-upgrade-from-42.int.spec.ts` | Kiểm đúng kỹ thuật, không kiểm hành vi người dùng |
| Dịch vụ nền Android | `mobile/ship` (LocationReporterTest JVM), `mobile/gateway/test` | **Không chứng minh dịch vụ chạy ổn trên máy thật** (tài liệu M14 tự nêu) |

Tài liệu M07/M10/M14 tự ghi "chưa kiểm trên thiết bị thật". Vì vậy **mọi test P0 đều phải chạy trên máy thật** dù đã có kiểm thử tự động tương ứng.

## 6. Tự kiểm tra bộ test case (kết quả thực tế khi tạo tài liệu)

- **Tổng số test case: 289** (P0 132 · P1 122 · P2 35); **tổng số bước thao tác: 1085** (mỗi bước có kết quả mong đợi đối chiếu).
- **Mã test không trùng**: đạt. **Tên test không trùng**: đạt.
- **Mọi tham chiếu "phụ thuộc" trỏ tới test có thật và test đó được xếp chạy TRƯỚC**: đạt.
- **Mọi test đều có đủ**: điều kiện ban đầu, dữ liệu nhập, ≥2 bước kèm kết quả mong đợi, cách kết luận, cách khôi phục, căn cứ code/tài liệu: đạt.
- **Mọi test đều xuất hiện trong bảng đối chiếu mục 2**: đạt.
- **Bao phủ các nhóm đề bài (A–H)**: A = 45; B = 40; C = 37; D = 25; E = 30; F = 25; G = 36; H = 22; bổ sung (thông báo, đánh giá/phản ánh, quyền/riêng tư, đối chiếu tự động) = 29.
- **File CSV**: UTF-8 có BOM, 289 dòng dữ liệu × 32 cột, ô dài nhất 2296 ký tự (giới hạn của Excel 32.767); đã kiểm tra đọc lại được bằng bộ đọc CSV chuẩn.
- **Không có mật khẩu, mã OTP thật hay thông tin nhạy cảm** trong bộ tài liệu (chỉ dùng tên viết tắt tài khoản và nhãn SĐT-…).
- **Không chạy ứng dụng thật**: các điểm này là nhận định từ mã nguồn; xem mục 7.

## 7. Giới hạn của lần đối chiếu này

- Không chạy ứng dụng thật hay máy chủ thật; mọi tên nút, thông báo và kết quả mong đợi lấy từ **mã nguồn và tài liệu**. Nếu ứng dụng thật hiển thị khác (đổi chữ, thiếu nút), người kiểm thử ghi lại bằng chứng và gửi Owner; **đó là phát hiện, không phải lỗi của test**.
- Không xác minh được: trạng thái triển khai máy chủ thật, cấu hình Firebase, danh sách SMS được phép, bảng phí đang áp dụng, dữ liệu đã có trên máy chủ.
- Màn hình Web Admin được mô tả theo mã (menu, nhãn, thông báo); bố cục thật có thể khác.
- Các tên nhóm món ("Món chính", "Đồ uống"), tên quán/món/tài khoản test là **dữ liệu do bộ test đặt ra**, không có sẵn trong hệ thống.
