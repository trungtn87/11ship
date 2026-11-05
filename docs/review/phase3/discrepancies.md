# Phase 3 — Danh sách lệch / thiếu (B)

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Phân loại B-04: sửa code / sửa test / sửa tài liệu-baseline / hoãn / Owner decision. Mọi mục là kết quả đối chiếu tĩnh; runtime NOT TESTED. Không có mục nào được đổi thành PASS.

## 1. Thiếu (MISSING) — chỉ sau khi nêu phạm vi quét

| Req | Tóm tắt | Phạm vi đã quét | B-04 |
|---|---|---|---|
| M10-R-26 | Đơn đã xác nhận nhưng chưa gọi shipper (C-22) | Đã quét: orders/order-sweeper.ts, order-timeouts/order-timeout-sweeper.ts, orders/order-delivery-adapter.ts, orders/order-customer-delivery-service.ts, admin-overview/admin-action-queue-reader.ts, ops-analytics/ops-anomaly-repository.ts, và mọi file .ts có 'PREPARING' (12 file); grep unassigned/notCalled/CONFIRMED_NO_DELIVERY trên apps/backend/src | sửa code (Phase 8) + Owner chốt mốc SYSTEM (C-22) |

## 2. Lệch (MISMATCH)

| Req | Yêu cầu | Source làm gì | Bằng chứng | B-04 | Issue |
|---|---|---|---|---|---|
| M04-R-09 | Quyền tài chính Admin | Baseline nói ba quyền tách riêng; code mới cho cấp hai, quyền wallet.adjustment.post còn 'đặt trước, chưa cấp được'. admin-feedback/admin-feedback-service.ts:31,498,795-797 đòi quyền wallet.adjustment.post cho ADMIN (SYSTEM mặc nhiên có), nhưng dịch vụ cấp quyền từ chối cấp tên này (finance-access-constants.ts:24-31 không liệt kê, :47 reserved) nên trên thực tế chỉ SYSTEM post được điều chỉnh | finance-access/finance-access-constants.ts:8-9 (wallet.read, wallet.topup.record là grantable), :43-47 (wallet.adjustment.post nằm trong RESERVED_FINANCE_PERMISSIONS: bảng chấp nhận tên nhưng service từ chối cấp) | sửa tài liệu hoặc sửa code; Owner decision | B04 mới |
| M04-R-13 | Ví chỉ hiện khi đã đăng nhập `[P8]` | Lối vào ví không bị ẩn khi khách/đã đăng xuất. Đây là #295, đã tái hiện trong B-03. Nguyên nhân gốc chưa tái hiện lại trong Phase 3 (không chạy app) | mobile/ship/lib/ship_tabs.dart:141 (WalletEntry dựng không kèm điều kiện signedIn), :99,:152,:202-203 (các mục khác có kiểm signedIn); B-03 Codex + Lead review: sau đăng xuất và mở lại app vẫn thấy 'Ví của tôi' và Thu nhập | sửa code (Phase 8) | #295 |
| M10-R-02 | Chưa có tính năng thanh toán mở rộng | Owner 02/11 (B04-13) yêu cầu không hiển thị lối vào 'Voucher của tôi' trong 11Food; lối vào vẫn có ở account_views. Màn rỗng không có API voucher (không có chức năng voucher ngầm) | mobile/packages/n11_shared/lib/src/account/account_views.dart:343 (ListItem key voucher-entry 'Voucher của tôi' -> VoucherScreen), :1172-1174 (màn rỗng: 'no voucher API, storage or redemption') | sửa code (Phase 8) | B04-13 |
| M10-R-09 | Khách sửa đơn khi chờ xác nhận `[P8]` | Backend khớp (PENDING_CONFIRMATION + version). Yêu cầu bắt buộc chọn địa chỉ/ghim ngay trong luồng sửa chưa được chứng minh: B-03 S-06 BLOCKED do #299; không PASS | orders/order-customer-service.ts:565,622 (chỉ PENDING_CONFIRMATION), :542,625 (kiểm expected_version); #238 (ghim bản đồ trong luồng sửa chưa kiểm UI), #299 (11Food OOM khi mở bộ chọn bản đồ) | sửa code (Phase 8) | #238, #299 |

## 3. Một phần (PARTIAL) có phân loại B-04 cụ thể

| Req | Điểm lệch/thiếu | B-04 | Issue |
|---|---|---|---|
| M00-R-02 (PARTIAL) | Cơ chế có thật. 'Mọi mutation' không đúng nghĩa đen: có ngoại lệ có chủ ý (đo vị trí ghi đè, OTP, login, preview) và một số mutation trạng thái chưa thấy khóa. Danh sách 52 cần Owner/Phase 5 duyệt | B04 mới: Owner decision (ngoại lệ hợp lệ?) |  |
| M01-R-11 (PARTIAL) | Phần Admin thực hiện và nhánh purge/khoá có. Đường 'người dùng gửi yêu cầu xoá ngay trong app/web' chưa thấy sau khi đã quét 4 route @Delete và controller client-auth | Owner decision (xác nhận C-20 phạm vi app) / sửa code (Phase 8) | C-20; B04 liên quan |
| M01-R-15 (PARTIAL) | Server thu hồi phiên và client xoá trạng thái đăng nhập. Phần 'dừng GPS/push theo phiên' và 'driver ngừng nhận đơn' chưa thấy móc nối; #295 cho thấy UI Ship vẫn hiện Ví/Thu nhập sau đăng xuất | sửa code (Phase 8) | #295 |
| M01-R-16 (PARTIAL) | Cơ chế epoch có, nhưng cache từng màn (ví, đơn, thông báo) chưa đọc hết nên không khẳng định B không thấy dữ liệu A | sửa code/test (Phase 6/8) | #295 |
| M02-R-08 (PARTIAL) | Chỉ https và host cố định đúng. Giới hạn trong code thấy 300; chưa thấy giá trị 160 cho một trong hai trường | sửa tài liệu hoặc code (xác nhận 160/300) | Cần đối chiếu |
| M02-R-12 (PARTIAL) | Backend không bịa số. Nhưng Chi tiết quán không hiện khoảng cách và nguồn số khác nhau giữa route-distances và orders/preview (#294) | sửa code (Phase 8) | #294 |
| M04-R-05 (PARTIAL) | Cộng ví chỉ qua Admin xác nhận, đúng một lần theo topup_id. Chưa thấy ràng buộc 'mã giao dịch ngân hàng duy nhất' (baseline nói riêng điều này; M04-R-07 gọi đó là đề xuất P2) | Owner decision (có cần unique mã ngân hàng không) | B04-08 liên quan |
| M04-R-14 (PARTIAL) | Nhánh yêu cầu PENDING trước CLOSING có. Nhánh đối soát thủ công cho tiền không có yêu cầu (B04-08) không thấy trong ba module đã quét; chưa kết luận MISSING vì chưa quét toàn repo | Owner decision đã có (B04-08); sửa code Phase 8 | B04-08 |
| M05-R-03 (PARTIAL) | Tối đa một mặc định do chỉ mục DB, đổi tuần tự dưới khóa. Code có thêm cờ is_pickup_default/is_delivery_default (mô hình hai mặc định) mà baseline không nhắc | sửa tài liệu (mô tả hai mặc định) | B04 mới |
| M06-R-07 (PARTIAL) | Trễ cộng dồn tối đa 300 s khớp (mặc định DB). Trần 20 chặng chưa thấy bằng dòng cụ thể; pickup/handoff 120/60 s là giá trị mặc định chưa được Owner duyệt (ghi nhận trong migration) | Owner decision (duyệt 120/60 s) | B04 mới |
| M06-R-10 (PARTIAL) | Có hai ngưỡng: 120 s (live) và 600 s (stale). Baseline nói 'quá 120 s' ẩn danh sách/từ chối nhận; chưa xác nhận cổng nào dùng 120 và cổng nào dùng 600 | sửa tài liệu hoặc code (Owner decision về ngưỡng) | B04 mới |
| M07-R-05 (PARTIAL) | UI: không còn lối vào tạo DIRECT trong chế độ quán (màn ShopCallScreen không được nối; xem dead-code candidate). Backend: POST /v1/shop/me/deliveries vẫn tạo DIRECT mới. Baseline nói chỉ giữ bản ghi DIRECT cũ nên API còn mở là lệch nhẹ | sửa code (khóa route hoặc xóa ShopCallScreen) hoặc Owner decision | B04 mới |
| M07-R-15 (PARTIAL) | Cột route_distance_m tồn tại theo spec; nhưng #294 cho thấy số khác nhau giữa các nơi hiển thị. Nguyên nhân chưa chốt (UNKNOWN) | sửa code (Phase 8) | #294 |
| M10-R-01 (PARTIAL) | Giỏ lưu ở máy chủ theo tài khoản, không phải 'giỏ trên máy' như cột STATE của baseline: tốt cho yêu cầu không lộ dữ liệu giữa tài khoản (phía server), nhưng baseline cần sửa mô tả. Gộp cùng món cùng ghi chú và xác nhận thay giỏ chưa đọc ở m10_cart.dart | sửa tài liệu (nơi lưu giỏ) | B04 mới |
| M10-R-06 (PARTIAL) | Quote checkout dùng M14 và có snapshot/thời điểm. #294: hai nơi cho số khác nhau cho cùng cặp điểm; Phase 2 ghi chỉ có một M14RouteClient, nguyên nhân chưa chốt (xem Q3) | sửa code (Phase 8) | #294 |
| M10-R-18 (PARTIAL) | Có luồng xin đổi, bên có quyền quyết định, chặn sau pickup ở hai nơi. 'Không có hai assignment hoạt động' và tính lại phí/xin đồng ý chưa kiểm; baseline nói 'Sau lấy: …' cần đối chiếu khác biệt với CANNOT_CHANGE_AFTER_PICKUP | Owner decision/sửa tài liệu (hành vi sau lấy hàng) | B04 mới |
| M12-R-13 (PARTIAL) | Có kiểm quyền theo hàng quyền hiện tại và ghi actor; chưa thấy một khoá quyền riêng cho 'hủy đơn' tách khỏi quyền xem (kiểm theo quyền app VIEW/review). Có thể lệch C-28 | sửa code hoặc Owner decision | C-28 |
| M14-R-03 (PARTIAL) | Ngưỡng 500 m có. Code coi accuracy null là hợp lệ (đúng 'tạm giữ chính sách hiện tại' của C-19); chưa có đo kiểm Android thật, đúng theo baseline | hoãn (đo kiểm thiết bị) | C-19 |
| M14-R-04 (PARTIAL) | Phiên bị thu hồi thì API từ chối (guard). App có dừng gửi hay không và #295 (UI còn dữ liệu sau đăng xuất): chưa chứng minh | sửa code/test (Phase 8) | #295 |
| M14-R-10 (PARTIAL) | Một client duy nhất, không fallback đường thẳng. Trả đủ distance_m/ETA nhưng chưa thấy geometry/route_version trong mô-đun này (chỉ distanceM, seconds): baseline yêu cầu distance_m, ETA, geometry, route_version | sửa code hoặc sửa tài liệu (Owner decision) | #294; B04 mới |
| M01-R-12 (IMPLEMENTED) | activeWork tách khỏi relatedData; khoá hàng chống TOCTOU. Adapter đọc bảng qua account-record-reader chứ không gọi service M10/M07/M04/M11 như mô tả; vẫn đủ ngữ nghĩa | Sửa tài liệu (mô tả adapter) |  |
| M01-R-20 (IMPLEMENTED) | Khớp: chỉ DELETE_REQUEST, luôn cần OTP proof. 'Không tự kích hoạt lại' không đúng nguyên văn: sau OTP + mật khẩu mới tài khoản chuyển ACTIVE (:263). Chờ Owner xác nhận ý nghĩa | Sửa tài liệu hoặc Owner decision (ACTIVE sau khôi phục) | B04 mới |
| M06-R-06 (IMPLEMENTED) | Tối đa 3 chuyến đang chạy cho EXTERNAL là mặc định trong DB, chỉnh qua tham số (không hard-code). Khớp baseline; nên ghi trong tài liệu rằng đây là tham số | sửa tài liệu (nêu là tham số, mặc định 3) |  |
| M06-R-08 (IMPLEMENTED) | Không thấy lý do chặn nào dựa trên bankVerified; trường còn được truyền nhưng không là điều kiện. Dư thừa: trường chết dùng cho hiển thị | Dọn dẹp (dead field) nếu Owner đồng ý | Phase 4 |
| M07-R-03 (IMPLEMENTED) | Server từ chối 'giao thất bại' ở mọi trạng thái. Route /fail còn tồn tại chỉ để trả lỗi (dead-route candidate cho Phase 4). Sau pickup nút 'nhả' bị chặn: comment :507 | Phase 4 (dọn route) |  |
| M08-R-04 (IMPLEMENTED) | Khớp 5 phút và dừng khi pickup/hủy. Không có số lần tối đa của nhắc lấy hàng (đã ghi ở Phase 3) – cần xác nhận có chủ ý | Owner decision (số lần tối đa nhắc lấy hàng?) | Phase 3 delivery-sweeper |

## 4. Chưa xác định (UNKNOWN) và nguyên nhân

Số dòng UNKNOWN: 31. Nguyên nhân gom theo nhóm (chi tiết ở từng dòng trong bảng đối chiếu):
- **Hành vi giao diện/thiết bị chỉ nằm ở app** (Flutter, GPS nền, camera bản đồ, popup): cần đọc Dart sâu hoặc chạy trên thiết bị; chuyển Phase 6 và Antigravity.
- **Phân quyền/scope nhiều tầng của Admin** (M08-R-12/15, M12-R-07, M04-R-15): cần ma trận quyền; chuyển Phase 5.
- **Dữ liệu/giá trị chỉ có trên VPS hoặc trong cấu hình** (phiên bản điều khoản thực, cờ native gate, APP_ENV): không có trong source.
- **Chi tiết chưa đọc đến dòng** trong module lớn (orders, shop-management, admin-reports).

| Req | Lý do | Chuyển |
|---|---|---|
| M01-R-22 | Không thấy guard dùng origin PHONE_UNVERIFIED để chặn rõ ràng một thao tác nào. Chưa kiểm hết 49 module nên không kết luận MISSING |  |
| M02-R-06 | Yêu cầu thuần UI; ánh xạ CSV chỉ theo tên. Không kết luận |  |
| M02-R-14 | Banner khớp dữ liệu máy chủ là hành vi UI; CSV chỉ theo tên module |  |
| M02-R-16 | Chưa theo dõi toạ độ quán được chụp vào đơn lúc tạo hay đọc lại lúc xem. Không suy ra từ tên |  |
| M02-R-17 | Không thấy kết quả tìm kiếm cho xử lý khu vực ACTIVE thiếu hình học; chưa đọc hàm kiểm ghim |  |
| M03-R-09 | Comment nói lý do đình chỉ được giữ; chưa mở cột lý do/audit thực tế nên không xác nhận |  |
| M04-R-10 | Chưa kiểm 'không gói thuê bao, không ví quán, báo chuyển khoản không cấp quyền'. Không có node trong graph không phải bằng chứng thiếu |  |
| M04-R-15 | Chưa thấy nơi bắt buộc scope DRIVER cho quyền wallet.*. Không suy ra từ tên |  |
| M05-R-06 | Yêu cầu thuần UI (bộ chọn dùng chung, Quay lại không áp dụng, lỗi GPS giữ ghim cũ). #238 và #299 (OOM bản đồ) liên quan; B-03: S-06 BLOCKED | sửa code (Phase 8) |
| M06-R-05 | Chưa thấy khái niệm tip trong file đã mở (grep 'tip' ra 0 kết quả trong agreement.ts); baseline nói tip cộng vào phí thỏa thuận không thêm trường. Chưa quét toàn repo nên chưa kết luận MISSING |  |
| M06-R-09 | Yêu cầu 'bỏ màn M06 giả/trùng' cần so danh sách màn với baseline; không suy ra từ tên file |  |
| M07-R-07 | Yêu cầu nói 'app không can thiệp' (thiếu hành vi); không thể chứng minh bằng việc không thấy mã. Không MISSING |  |
| M07-R-10 | Không thấy route 'bỏ qua đơn' trong danh sách offers. Route fee/skip là bỏ qua đề nghị phí (khác nghĩa), nên chưa thể kết luận khớp hay lệch với 'không có nút Skip'; cần Owner làm rõ ý nghĩa (nút ở UI chưa đọc) | Owner decision (làm rõ 'Skip') |
| M08-R-12 | Có phân quyền SYSTEM/ADMIN theo app nhưng 'scope của ADMIN' (khu vực/quyền) cho bộ đếm chưa chứng minh |  |
| M08-R-13 | Có dấu hiệu chuyển vai trò trong m08_views nhưng chưa đọc luồng; không kết luận |  |
| M08-R-15 | Cùng lý do M08-R-12: cùng scope cho counter/ca hàng/lỗi/chi tiết chưa chứng minh |  |
| M10-R-08 | Chưa tìm thấy hàm đặt giá cuối riêng trong phần đã đọc; chưa quét hết order-shop-service nên không MISSING |  |
| M10-R-14 | Nhãn khách theo bảng §8: chưa đối chiếu từng nhãn |  |
| M10-R-19 | Mã K01-0001, unique, không tái sử dụng chưa kiểm; counter theo quán chưa tìm |  |
| M10-R-23 | Đơn cũ giữ route_distance_m: cột snapshot chưa mở; ví dụ K01-0006 là dữ liệu VPS NOT TESTED |  |
| M11-R-09 | Không thấy xử lý SUSPENDED riêng; chưa kiểm xem đường đọc của shipper có lọc theo trạng thái không. Không kết luận MISSING |  |
| M12-R-02 | Trạng thái loading/empty/error/thiếu quyền/'chưa sẵn sàng' chưa đối chiếu từng màn (CSV chỉ theo thư mục) |  |
| M12-R-07 | Scope báo cáo/audit cho tổng số, danh sách, xem trước, runner, tải xuống chưa đối chiếu |  |
| M12-R-12 | Có kịch bản khôi phục thử và checklist; không có log chạy thật trong repo. Đúng quy tắc baseline: chưa có bằng chứng -> NOT TESTED |  |
| M13-R-06 | Baseline mới: chỉ kiểm phiên bản và mở Play. Còn route app-updates/* phục vụ tải APK? (Phase 3: public-routes.md). Chưa đối chiếu nên không kết luận |  |
| M14-R-01 | Comment cho thấy app chỉ xin quyền foreground + thông báo (chưa xác nhận có GPS nền khi vuốt khỏi gần đây). Phía app là UNKNOWN (đã ghi ở F4) |  |
| M14-R-05 | Thứ tự ưu tiên cảnh báo chỉ ở app, chưa đọc |  |
| M14-R-06 | Camera/cử chỉ chỉ ở app. #299 (OOM bản đồ) liên quan |  |
| M14-R-11 | Backend không trả geometry/route_version ở m14-route-client nên chưa thấy cách polyline 'chính là tuyến đã tính giá'. Có thể geometry đến từ nguồn khác (app vẽ lại?): chưa theo dõi. Không kết luận |  |
| M14-R-12 | Có key home-radius-*; chưa đọc cách vẽ vòng tròn/phủ xám/camera |  |
| M14-R-14 | Comment ngụ ý chưa xin quyền vị trí nền (ACCESS_BACKGROUND_LOCATION). 'Chạy tiếp khi vuốt khỏi gần đây' cần đọc phần native/service Android; không kết luận |  |

## 5. Ứng viên mã chết / legacy (chưa tự quyết xóa/giữ)

| Mục | Bằng chứng | Phân loại | Ghi chú |
|---|---|---|---|
| `NotIntegratedCommissionAdjustmentPort` | `feedback/feedback-finance-port.ts:30`; token luôn bind `WalletCommissionAdjustmentAdapter` (`admin-auth/admin-auth.module.ts:264`) | dead code | open-questions.md Q4; Owner decision xóa |
| `NotIntegratedDriverWalletPort`, bốn `NotIntegrated*Port` của shipping-policy | bind thật khi module nạp (`wallet/wallet.module.ts:34-37`, `shipping-eligibility.module.ts:45-48`); stub chỉ dùng trong test tích hợp | placeholder fail-closed / test-only | không xóa vội; sửa comment lỗi thời `wallet.module.ts:22-27` |
| `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/role/select`, `GET /v1/auth/me` | không client nào trong repo gọi (public-routes.md #7-#8); đường legacy không có `ClientLoginLimiter` | legacy, chưa có client | Owner decision; ứng viên Phase 5 (giới hạn đăng nhập) |
| `POST /v1/deliveries/:id/fail` (shipper) | `delivery-shipper-service.ts:597` luôn ném `SHIPPER_FAIL_NOT_ALLOWED` | route chỉ trả lỗi | Phase 4 |
| `ShopCallScreen` | `m07_shop_views.dart:224`; chỉ dựng trong `m07_views_test.dart` | UI chưa nối (test-only) | liên quan M07-R-05; Owner decision |
| `POST /v1/shop/me/deliveries` (tạo DIRECT) | `delivery-shop.controller.ts:33`; `delivery-shop-service.ts:125-140` | API còn mở trong khi baseline chỉ giữ DIRECT cũ | M07-R-05 |
| `IdempotencyCleanup` | không scheduler, không call site ngoài test (Q7) | lớp có nhưng không chạy | Owner decision (lên lịch) / Phase 5 |
| Trường `bankVerified` trong `shipping-eligibility.ts:34` | truyền vào nhưng không là điều kiện (M06-R-08) | trường thừa | Phase 4 |
| `DiagnosticsView` | không có lối vào trong hai app như đang nối (Q9) | UI không tới được | B04-14 |
| Admin view `finance-view` | `shell-app.ts:76` nhập; nút tiền bị vô hiệu nếu `hooks.wired=false` | có thể trùng `finance-admin-view` / `finance-ops-view` | Phase 4: kiểm nối thật |

## 6. Baseline không còn khớp với code (sửa tài liệu/baseline)

- **M10-R-01** giỏ hàng nay lưu ở máy chủ (`customer_carts`, `create-m10-orders.sql:14`), không phải "giỏ trên máy".
- **M05-R-03** có hai mặc định (`is_pickup_default`, `is_delivery_default`) cạnh `is_default`.
- **M06-R-06/R-07** là tham số lưu DB (mặc định 3 và 300 s); `pickup_service_seconds` 120 s và `handoff_service_seconds` 60 s là giá trị chưa được Owner duyệt.
- **M06-R-10 / M14-R-02** có hai ngưỡng vị trí 120 s (live) và 600 s (stale): baseline chỉ nêu 120 s cho lọc danh sách đơn.
- **M04-R-09** thiếu ba quyền rút tiền `wallet.withdrawal.process|confirm|reconcile`; `wallet.adjustment.post` bị dành trước nên chỉ SYSTEM post được điều chỉnh (`finance-access-constants.ts:24-47`, `admin-feedback-service.ts:795-797`).
- **M01-R-12** adapter đọc thẳng bảng qua `account-record-reader`, không gọi service của M10/M07/M04/M11.
- **M01-R-20** baseline "không tự kích hoạt lại" nhưng khôi phục sau OTP + mật khẩu mới đưa tài khoản về ACTIVE (`account-recovery-service.ts:263`).
- **M07-R-06** mặc định 5 phút nằm ở `order_parameters` (`fee_answer_minutes`), không phải bảng timeout đơn.
- **Baseline thiếu yêu cầu** cho: mức nạp/rút tối thiểu (`shipper_wallet_parameters`), chính sách hoa hồng (`wallet_commission_policies`), ẩn/khôi phục đánh giá (`review_moderations`), đối soát lệch sổ ví, middleware truyền tải admin/client.
