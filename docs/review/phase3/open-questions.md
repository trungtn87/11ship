# Phase 3 — Câu hỏi mở bắt buộc Q2–Q9 (Q1 và Q8 xem `public-routes.md`, `outbox-m08.md`)

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Mọi kết luận dưới đây ghi rõ nhãn. **Không có runtime nào được chạy trong Phase 3**: mọi hành vi lúc chạy là NOT TESTED.

## Q2 — #295: mục "Ví của tôi" không kiểm `signedIn`
| Bước | Kết quả | Nhãn |
|---|---|---|
| Tab "Thu nhập" | `_income(context, actions, session)` luôn dựng `WalletEntry(session: session)` (`mobile/ship/lib/ship_tabs.dart:70,141`), không có điều kiện trên `session.status` | ĐÃ MỞ SOURCE |
| Tab "Tài khoản" | `entries:` luôn có `WalletListItem(key: account-wallet-entry, session: session)` (`ship_tabs.dart:201`). Ngay cạnh, mục "Trao đổi nạp tiền" và "Dừng hoạt động / Rút tiền" **có** điều kiện `session.status == SessionStatus.signedIn` (`ship_tabs.dart:202-203`) | ĐÃ MỞ SOURCE |
| Widget | `WalletListItem.build` chỉ chọn nguồn: có `session` thì `HttpWalletSource`, không có thì `NotWiredWalletSource`; không đọc `session.status` (`mobile/ship/lib/ship_wallet.dart:25-43`) | ĐÃ MỞ SOURCE |
| So sánh | `_notifications` **có** kiểm `session.status != signedIn` và hiện trạng thái trống (`ship_tabs.dart:150-153`) | ĐÃ MỞ SOURCE |
| Test hiện có | Không test nào dưới `mobile/` tham chiếu key `wallet-entry` hoặc `account-wallet-entry` (grep) | HEURISTIC (phủ định) |
| Kết luận | **Giả thuyết được xác nhận bằng static trace**: hai điểm dựng mục ví không điều kiện đăng nhập. Backend đã trả 403 đúng (B04-02). Chưa chạy runtime trong Phase 3 | static trace = ĐÃ MỞ SOURCE; hành vi runtime sau đăng xuất = NOT TESTED (đã có bằng chứng UI FAIL của Phase 1/B-03, không lặp lại) |
Trạng thái bug giữ nguyên: **#295 có bằng chứng**, loại B04 "sửa code".

## Q3 — #294: đường đi của phép tính khoảng cách
Backend có **một** `M14RouteClient` (`delivery/m14-route-client.ts:47`) gọi `POST {origin}/route` với 2 điểm; cache theo khóa **có hướng** `from>to` làm tròn 5 chữ số (`:69`); khi cấu hình thiếu, điểm sai, timeout hoặc lỗi thì trả `UNAVAILABLE` với lý do, **không bịa số** (`:62-97`, ĐÃ MỞ SOURCE). Dùng chung client không có nghĩa là các màn dùng cùng điểm đầu/cuối:
| Màn / luồng | Điểm đầu → điểm cuối thực tế | Bằng chứng |
|---|---|---|
| Trang chủ, Tìm kiếm (thẻ quán) | **vị trí thiết bị** (`LocationFix`, client gửi `origin`) → điểm lấy hàng của quán (`snapshot.pickupLat/Lng`); chỉ quán `publicVisible`; lỗi/không có tuyến → `UNAVAILABLE`, client hiển thị "không biết" | `mobile/.../m02/route_distance.dart:100-140`; `http_m02_api.dart:188-206`; `discovery-route/discovery-route-service.ts:44-80` (ĐÃ MỞ SOURCE) |
| Chi tiết quán | Không thấy lời gọi route-distances ở đường chi tiết quán; B-03 ghi Chi tiết quán không hiện khoảng cách (trái M02-R-12) | grep `route-distances` chỉ có `http_m02_api.dart:193` (ĐÃ MỞ SOURCE); hành vi UI = NOT TESTED trong Phase 3 |
| Báo giá/xem trước đơn và tạo/sửa đơn | **điểm lấy hàng của quán → điểm giao của khách** (`routes.routeResult(prepared.pickup, prepared.point)`); phí tính từ `route.leg.distanceM`; không có tuyến → `UNAVAILABLE`/`ROUTE_UNAVAILABLE` | `orders/order-customer-service.ts:208,245-255` (ĐÃ MỞ SOURCE) |
| Lưu khoảng cách | Khi tạo đơn, so khớp `expectedQuote` (status, distance, fee, reason, version, snapshot) với báo giá tính lại; lệch thì từ chối; lưu `feeEstimateDistanceM` | `order-customer-service.ts:419,449,667,687` (ĐÃ MỞ SOURCE) |
| Delivery (đơn giao) | quán → điểm giao (`delivery-customer-service.ts:101`); shipper → quán và quán → điểm giao (`delivery-shipper-service.ts:659-660`); đổi địa chỉ (`address-change-service.ts:147,631`) | ĐÃ MỞ SOURCE (chỉ dòng gọi) |
| Fallback | Không có fallback sang Haversine/đường chim bay trong `M14RouteClient`; thất bại = không có số | `m14-route-client.ts:62-97` |
**Kết luận Q3:** giả thuyết Phase 2 đúng ở phần "một client backend". **Sự khác biệt giữa hai màn không thể giải thích từ source riêng**: màn thẻ quán đo từ vị trí thiết bị tới quán, còn xem trước đơn đo từ quán tới điểm giao đã chọn. Hai phép đo chỉ bằng nhau nếu vị trí thiết bị trùng điểm giao và hai chiều cùng độ dài; với đường một chiều hai chiều có thể khác. Nên chênh 617 m so với 720 m (B-03 S-04) có thể do (a) hướng đo, (b) tọa độ khác nhau giữa vị trí thiết bị và ghim địa chỉ, (c) cache hoặc phiên bản dữ liệu Valhalla khác nhau. Không đủ bằng chứng để chọn: **UNKNOWN**; cần test có kiểm soát (cùng điểm, cả hai chiều) ở Phase 8. #294 giữ trạng thái đã có bằng chứng (S-04 FAIL).

## Q4 — `NotIntegrated*`
| Lớp | Thực tế (ĐÃ MỞ SOURCE) | Phân loại |
|---|---|---|
| `NotIntegratedDriverWalletPort` (`driver/driver-wallet-port.ts:27`) | Giá trị mặc định của `DelegatingDriverWalletPort`; `WalletModule.onModuleInit` gọi `port.bind(wallet)` thay bằng `WalletDriverPort` thật (`wallet/wallet.module.ts:34-37`; `driver-wallet-port.ts:47-48`) | **placeholder chuyển tiếp/fail-closed**: chỉ hoạt động nếu không nạp `WalletModule`. Không chết |
| `NotIntegratedCommissionAdjustmentPort` (`feedback/feedback-finance-port.ts:30`) | `COMMISSION_ADJUSTMENT_PORT` luôn bind `WalletCommissionAdjustmentAdapter` (`admin-auth/admin-auth.module.ts:264`); lớp này 0 tham chiếu (cả test, theo Phase 2) | **dead code** (ứng viên xóa), comment "cố ý giữ" lỗi thời |
| `NotIntegratedDeliveryOfferPort`, `…ShipperWorkPort`, `…ShipperLocationPort`, `…RouteMatrixPort` (`shipping-policy/shipping-ports.ts:68-93`) | Các token tương ứng bind `DeliveryOfferReader`, `ShipperWorkReader`, `ShipperLocationReader`, `M14RouteClient` (`shipping-policy/shipping-eligibility.module.ts:45-48`); chỉ test tích hợp dùng lớp stub (`tests/integration/m06-shipping-eligibility.int.spec.ts:304-307`, theo Phase 2) | **test-only stub nằm trong code sản phẩm**; không dead về logic nhưng không dùng ở runtime |
| Lệch tài liệu | Comment của `wallet/wallet.module.ts:22-27` nói `DRIVER_WALLET_PORT` "stays bound to NotIntegratedDriverWalletPort", trong khi `onModuleInit` bind cổng thật: comment lỗi thời | sửa comment |

## Q5 — chu trình Dart `shell ⇄ m08_views ⇄ account_views`
Đã đọc nội dung các import: `shell.dart:8-12` import `m08_views`/`m08_controller`; `m08_views.dart` import `../account/account_views.dart show n11Route` và `../shell.dart`; `account_views.dart:10` import `../shell.dart` (ĐÃ MỞ SOURCE). `n11Route` là hàm một dòng `MaterialPageRoute<void>(builder: (_) => screen)` (`account_views.dart:133`), **không giữ trạng thái**. Vòng chỉ là phụ thuộc kiểu và một hàm tiện ích, không có trạng thái chia sẻ qua vòng. **Kết luận:** vòng import là thật nhưng lành tính về runtime (Dart cho phép); rủi ro là bảo trì (mọi sửa `account_views.dart`, nơi có màn đăng xuất, kéo theo biên dịch `shell` và `m08`). Phân loại: **hoãn/refactor** (đưa `n11Route` ra tệp trung tính). Trạng thái runtime: NOT TESTED.

## Q6 — `AdminAuthModule` chứa `BusinessClientController`
`BusinessClientController` là nửa phía **client** (`@UseGuards(SessionAuthGuard)`, `@Controller('finance/me')`: `shop-payments`, `requests`, `receiving-accounts`, `notifications`) của cùng cặp `BusinessFinanceService` mà `BusinessAdminController` (`admin/business`) dùng cho Admin; `FinanceIdentity` phân biệt `kind: 'client'` và admin (`business-dashboard/business.controller.ts:62-70`); cả hai được khai báo trong `controllers` và danh sách `noStoreMiddleware` của `AdminAuthModule` (`admin-auth/admin-auth.module.ts:193,319`). **Kết luận:** đặt cùng module là **chủ ý theo dịch vụ dùng chung**, không phải do graph hiểu nhầm; về kiến trúc là **lệch ranh giới module** (module Admin phục vụ route phiên client), mức thấp. Ghi chú liên quan Phase 0: ba controller Admin (`AdminShop`, `AdminFeedback`, `AdminOrder`) không nằm trong danh sách `noStoreMiddleware`, nhưng mọi `/v1/admin/*` đã nhận `Cache-Control: no-store` từ `adminTransportMiddleware` cấp ứng dụng (`app.setup.ts:34-35`; `http/admin-transport.middleware.ts:17-22`) nên ứng viên đó **được giảm** (ĐÃ MỞ SOURCE).

## Q7 — `IdempotencyCleanup`
| Lớp kiểm | Kết quả | Bằng chứng (ĐÃ MỞ SOURCE) |
|---|---|---|
| Class tồn tại | Có: `clearExpiredReplay` (xóa nội dung replay, giữ dấu vân tay) và `deleteExpiredRecords` (xóa bản ghi quá hạn dedupe), có `FOR UPDATE SKIP LOCKED` | `idempotency/idempotency-cleanup.ts:30-80` |
| Provider | Đăng ký bằng factory trong `IdempotencyModule` và export | `idempotency/idempotency.module.ts:33-38` |
| Scheduler | **Không có**: comment của lớp ghi "There is NO scheduler here: a later slice or an operator calls it", "The executor's correctness does not depend on this ever running" (`idempotency-cleanup.ts:20-28`) | |
| Lời gọi lúc chạy | Không có call site ngoài test: grep `IdempotencyCleanup` trong `apps/backend/src`, `scripts`, `ops`, `.github`, `docs/current` chỉ thấy định nghĩa, module và `tests/integration/support/idempotency-fixtures.ts` | grep toàn các thư mục trên |
| Kết luận | Lớp tồn tại, được đăng ký, **không được gọi theo lịch hay bởi lệnh vận hành trong checkout này**. Hệ quả dự đoán: `app.idempotency_records` chỉ tăng (replay ciphertext không bị xóa sau TTL) trừ khi có công cụ ngoài repo gọi. Có công cụ ngoài repo hay không: **UNKNOWN**. Đúng với kết luận "không phải do thiếu `setInterval`": đã kiểm qua call site, không chỉ qua timer | Phân loại: yêu cầu hạ tầng **chưa nối** (M00-R-02 / ADR-003 §5) → ứng viên "sửa code" hoặc quyết định vận hành của Owner |

## Q9 — các lệch baseline đã nêu
| Mục | Kết quả (ĐÃ MỞ SOURCE) | Phân loại (không tự quyết xóa/giữ) |
|---|---|---|
| `VoucherScreen` vs "chưa có voucher" (M10-R-02) | Có lối "Voucher của tôi" (`key: voucher-entry`) trong tab Tài khoản (`account_views.dart:343`) mở `VoucherScreen` (`:1173-1179`, 3 tab Khả dụng/Đã dùng/Hết hạn) | trùng B04-13: Owner đã quyết gỡ lối vào/màn trống ở Phase 8 |
| Xóa tài khoản trong app | Không có route app. Admin có `POST /v1/admin/users/:user_id/delete` (`admin-account-lock/admin-account-lock.controller.ts:71`). Cả 4 `@Delete` còn lại: `orders/cart`, `customers/addresses/:id`, `customers/addresses/:id/defaults/:kind`, `notifications/push-token` (`@Delete` grep). Xóa admin dùng `POST`, nên "4 route @Delete" không phản ánh khả năng xóa | trùng B04-07: sửa code (Phase 8), baseline M01-R-11 |
| `DiagnosticsView` | Dựng trong shell (`shell.dart:510`), chỉ mở bởi mục "Chẩn đoán" của `AccountTab` khi `showDiagnostics && brand != food` (`account_views.dart:254`); 11Ship đặt `showDiagnostics: false` (`ship_tabs.dart:168`) và 11Food bị loại: **không có lối vào trong hai app như đang nối**. Chỉ hiện app/build/health, không dữ liệu nghiệp vụ (`diagnostics_view.dart:11-15`) | B04-14: Owner quyết "giữ có điều kiện"; phát hiện thêm: hiện không tới được từ UI sản phẩm. Quyết định giữ/nối là của Owner |
| `AdminLimitConfigVerifier`, `admin_sensitive_operations` | Có nguồn kỹ thuật: migration `1792195200000_create-admin-sensitive-operations.sql` dẫn "docs/tasks/M01-D-ADMIN-1B-technical-contract.md"; bảng dùng bởi `admin-provisioning/admin-operation-repository.ts` | không phải class-A nhưng có hợp đồng task; **Owner decision** để nâng lên baseline (B04-14) |
