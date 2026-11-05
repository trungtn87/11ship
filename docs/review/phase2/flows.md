# G-3 Luồng entry point → service → DB/ngoại vi

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Giới hạn:** chỉ các bước ghi `ĐÃ MỞ SOURCE` đã được đọc. Phần còn lại chỉ là bảng route tách từ decorator (`HEURISTIC`) và **không** được dùng làm bằng chứng. 11 luồng, trong đó F2, F3, F8, F9 đọc sâu; còn lại mới đến mức entry point.


**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.

## F1 Đăng ký, OTP, đăng nhập, quên mật khẩu

**Yêu cầu liên quan:** M01-R-02..10, M01-R-18..20

**Entry point (từ decorator):**
- `POST /v1/auth/phone-verifications` → `AuthController.requestOtp` (`auth/auth.controller.ts:42`)
- `GET /v1/auth/phone-verifications/:verificationId` → `AuthController.deliveryStatus` (`auth/auth.controller.ts:49`)
- `POST /v1/auth/phone-verifications/:verificationId/verify` → `AuthController.verifyOtp` (`auth/auth.controller.ts:55`)
- `POST /v1/auth/register` → `AuthController.register` (`auth/auth.controller.ts:67`)
- `POST /v1/auth/login` → `AuthController.loginUser` (`auth/auth.controller.ts:81`)
- `POST /v1/auth/role/select` → `AuthController.selectRole` (`auth/auth.controller.ts:88`)
- `GET /v1/auth/me` → `AuthController.me` (`auth/auth.controller.ts:96`)
- `GET /v1/client-auth/config` → `ClientAuthController.config` (`client-auth/client-auth.controller.ts:61`)
- … và 22 route khác (xem `nest.json`)

**ĐÃ MỞ SOURCE:** `reset-test` bị chặn bởi `assertOpen()` (503 trừ khi `accountRecoveryMode=DISABLED_TEST`, `account-recovery-service.ts:101-105`); đường OTP đi qua `assertSmsOtpOpen()` + công tắc DB `otp_password_reset_enabled` (`:108-122`); `effectiveAppMode()` báo cho client (`:125-131`). Tồn tại **hai** controller API đăng ký/đăng nhập: `AuthController` (`/v1/auth/*`, legacy) và `ClientAuthController` (`/v1/client-auth/*`); app dùng `/v1/client-auth/logout` (Dart `session_controller.dart:502+`). Phase 3 cần xác định `AuthController` còn client nào gọi không (**CHỈ TỪ GRAPH/chưa kiểm**).
**Nối động:** OTP đi qua `SmsGatewayModule` → thiết bị SMS Gateway kéo hàng đợi (`sms-queue-sweeper.ts`, 30 s). **Chưa mở**: chuỗi gửi OTP, limiter.

## F2 Đặt đơn, sửa đơn, hủy đơn (khách → quán)

**Yêu cầu liên quan:** M10-R-01..26

**Entry point (từ decorator):**
- `GET /v1/shop/me/orders` → `OrderShopController.list` (`orders/order-shop.controller.ts:30`)
- `GET /v1/shop/me/orders/:order_id` → `OrderShopController.read` (`orders/order-shop.controller.ts:35`)
- `POST /v1/shop/me/orders/:order_id/edit` → `OrderShopController.edit` (`orders/order-shop.controller.ts:41`)
- `POST /v1/shop/me/orders/:order_id/confirm` → `OrderShopController.confirm` (`orders/order-shop.controller.ts:48`)
- `POST /v1/shop/me/orders/:order_id/ready` → `OrderShopController.ready` (`orders/order-shop.controller.ts:55`)
- `POST /v1/shop/me/orders/:order_id/reject` → `OrderShopController.reject` (`orders/order-shop.controller.ts:63`)
- `POST /v1/shop/me/orders/:order_id/payment` → `OrderShopController.payment` (`orders/order-shop.controller.ts:70`)
- `POST /v1/shop/me/orders/:order_id/call-shipper` → `OrderShopController.callShipper` (`orders/order-shop.controller.ts:77`)
- … và 19 route khác (xem `nest.json`)

**ĐÃ MỞ SOURCE (`orders/order-customer-service.ts:341-386`):** `place()` → `#prepare()` + `#route()` (hỏi M14 **ngoài** transaction, `:342-343,208`) → `executor.execute()` (idempotency theo `principal.userId` + `ORDER_OPERATIONS.place`) → trong transaction: `#customer(...)` (kiểm lại quyền khách), `findByClientRef` (đặt lại cùng `client_ref` trả đơn cũ), `lockShopShared` (khóa quán FOR SHARE) rồi khóa món theo thứ tự id. Tại lúc commit `#samePoint()` so lại pickup và điểm giao với bản đã dùng để báo giá (`:242-251,410-413,658-661`), lệch thì `unavailable`.
**Ghi chú #294:** phí/khoảng cách ở đơn dùng `M14RouteClient.routeResult()`; màn Home dùng `route-distances` → `M14RouteClient.route()`; hai hàm cùng gọi `POST /route` (xem F8).
**Ranh giới (bổ sung theo review Antigravity, ĐÃ MỞ SOURCE):** `place()` chỉ tạo bản ghi `orders`; **không** tạo chuyến giao. Chuyến giao chỉ được tạo khi quán gọi shipper: `POST /v1/shop/me/orders/:order_id/call-shipper` (`order-shop.controller.ts:78`) → `order-shop-service.ts:256 deliveryShop.createForOrder(context, …)`.
**Chưa mở:** sửa đơn (M10-R-09), hủy đơn, `address-change/` (đổi địa chỉ sau tạo đơn).

## F3 Giao đơn cho shipper: nhận, hold hoa hồng, giao xong

**Yêu cầu liên quan:** M06-R-*, M07-R-*, M04-R-03

**Entry point (từ decorator):**
- `GET /v1/driver/deliveries/offers` → `DeliveryShipperController.offers` (`delivery/delivery-shipper.controller.ts:31`)
- `GET /v1/driver/deliveries/mine` → `DeliveryShipperController.mine` (`delivery/delivery-shipper.controller.ts:37`)
- `GET /v1/driver/deliveries/:delivery_id` → `DeliveryShipperController.read` (`delivery/delivery-shipper.controller.ts:44`)
- `POST /v1/driver/deliveries/:delivery_id/accept` → `DeliveryShipperController.accept` (`delivery/delivery-shipper.controller.ts:50`)
- `POST /v1/driver/deliveries/:delivery_id/release` → `DeliveryShipperController.release` (`delivery/delivery-shipper.controller.ts:58`)
- `POST /v1/driver/deliveries/:delivery_id/fee/agree` → `DeliveryShipperController.feeAgree` (`delivery/delivery-shipper.controller.ts:65`)
- `POST /v1/driver/deliveries/:delivery_id/fee/skip` → `DeliveryShipperController.feeSkip` (`delivery/delivery-shipper.controller.ts:73`)
- `POST /v1/driver/deliveries/:delivery_id/fee/counter` → `DeliveryShipperController.feeCounter` (`delivery/delivery-shipper.controller.ts:81`)
- … và 29 route khác (xem `nest.json`)

**ĐÃ MỞ SOURCE (`delivery/delivery-shipper-service.ts:173-250`, `accept`):** hỏi M14 ngoài transaction (`:173-177`) → `executor.execute` → `deliveries.lockById` → kiểm trạng thái `waiting_driver` và hạn tìm → xử lý thỏa thuận phí (`agreements.act` DRIVER_ACCEPT; `feeAllowsAssignment`) → `eligibility.confirm` (**M06**) → giới hạn đơn mở → `policies.current()` (hoa hồng hiện hành được chụp vào assignment) → `insertAssignment` → `commission.reserveCommission` (**M04 hold**, nếu `insufficient` thì `DELIVERY_NOT_ELIGIBLE`) → `#update(state: 'accepted')` → `addressChanges.expirePendingForDelivery` → `recorder.record(...)` (ghi sự kiện, outbox).
Tức là một lần "nhận đơn" đi qua M06, M04, M10 (address-change), M07 trong **cùng một transaction**, khớp M00-R-08.
**Hiệu chỉnh theo review Antigravity (ĐÃ MỞ SOURCE):** (a) trước bước M14 có một transaction **đọc riêng** (`withTransaction`, `delivery-shipper-service.ts:162-171`: actor, delivery, assignment đang giữ, vị trí, tham số), tức là "một lần nhận đơn" gồm một giao dịch đọc ngắn + M14 ngoài giao dịch + một giao dịch ghi; nhận định "cùng một transaction" chỉ đúng cho phần ghi (khóa, hold, assignment, trạng thái, sự kiện). (b) Giao xong **đã đọc**: `complete()` (`:559-591`) trong một `executor.execute`: `commission.captureCommission` (`:568`) + `orders.deliveryCompleted` (`:573`) + cập nhật trạng thái; báo cáo bản trước ghi "chưa mở" là thiếu.
**Chưa mở:** `release`, hủy, `delivery-sweeper.ts` (30 s).

## F4 Shipper online và GPS

**Yêu cầu liên quan:** M03-R-07,08, M14-R-01..04,08,13..15

**Entry point (từ decorator):**
- `GET /v1/driver/me` → `ShipperSelfController.read` (`shipper-self/shipper-self.controller.ts:25`)
- `GET /v1/driver/banks` → `ShipperSelfController.banks` (`shipper-self/shipper-self.controller.ts:32`)
- `GET /v1/driver/wallet-limits` → `ShipperSelfController.walletLimits` (`shipper-self/shipper-self.controller.ts:39`)
- `PUT /v1/driver/me/profile` → `ShipperSelfController.updateProfile` (`shipper-self/shipper-self.controller.ts:45`)
- `PUT /v1/driver/me/bank` → `ShipperSelfController.saveBank` (`shipper-self/shipper-self.controller.ts:50`)
- `POST /v1/driver/me/submit` → `ShipperSelfController.submit` (`shipper-self/shipper-self.controller.ts:55`)
- `POST /v1/driver/me/accepting` → `ShipperSelfController.accepting` (`shipper-self/shipper-self.controller.ts:61`)
- `POST /v1/driver/me/closure-request` → `ShipperSelfController.requestClosure` (`shipper-self/shipper-self.controller.ts:67`)
- … và 1 route khác (xem `nest.json`)

**Chưa mở source.** Phía server: `delivery/shipper-location.ts` (+ `shipper-location.module.ts`); phía app: `mobile/packages/n11_m14` (foreground service Android). Phía GPS thử nghiệm `mobile/gps-test` là dự án Kotlin riêng (301 file, 259 `.pbf`).

## F5 Ví, nạp tiền, rút tiền, hoa hồng, đối soát

**Yêu cầu liên quan:** M04-R-*, M03-R-04..06,10

**Entry point (từ decorator):**
- `GET /v1/admin/finance/access/me` → `FinanceAccessController.mine` (`finance-access/finance-access.controller.ts:29`)
- `GET /v1/admin/finance/access/admins/:user_id` → `FinanceAccessController.ofAdmin` (`finance-access/finance-access.controller.ts:36`)
- `POST /v1/admin/finance/access/admins/:user_id/grant` → `FinanceAccessController.grant` (`finance-access/finance-access.controller.ts:43`)
- `POST /v1/admin/finance/access/admins/:user_id/revoke` → `FinanceAccessController.revoke` (`finance-access/finance-access.controller.ts:49`)
- `GET /v1/admin/finance/bank-accounts` → `FinanceAccessController.listAccounts` (`finance-access/finance-access.controller.ts:55`)
- `GET /v1/admin/finance/bank-accounts/:account_id` → `FinanceAccessController.account` (`finance-access/finance-access.controller.ts:62`)
- `POST /v1/admin/finance/bank-accounts` → `FinanceAccessController.createAccount` (`finance-access/finance-access.controller.ts:69`)
- `POST /v1/admin/finance/bank-accounts/:account_id/receiving` → `FinanceAccessController.receiving` (`finance-access/finance-access.controller.ts:79`)
- … và 33 route khác (xem `nest.json`)

**ĐÃ MỞ SOURCE:** hold hoa hồng ở F3. Admin xác nhận nạp: `POST /v1/admin/finance/topup-requests/:request_id/confirm` (`admin-topups/admin-topup.controller.ts:48`). Phía ví có `wallet/topup-posting-service.ts`, `topup-settlement-repository.ts`, `withdrawal-money-service.ts`, `wallet-adjustment-service.ts`, `wallet-commission-adjustment.adapter.ts`.
**Cầu nối nối động (ĐÃ MỞ SOURCE):** M11 → M04 qua cổng `COMMISSION_ADJUSTMENT_PORT` (Symbol), bind `useExisting: WalletCommissionAdjustmentAdapter` ở `admin-auth.module.ts:264`. Graph chỉ thấy import `feedback-finance-port.ts`; cạnh tới `wallet/` chỉ xuất hiện qua adapter.
**Chuỗi tiên quyết mobile ↔ Admin Web (bổ sung theo review Antigravity; phần ĐÃ MỞ SOURCE):** shipper nộp hồ sơ `POST /v1/driver/me/submit` (`shipper-self.controller.ts:56`) và tạo yêu cầu nạp trên mobile; Admin xác nhận nạp trên Web; chỉ khi đó Admin duyệt shipper: `admin-shipper-service.ts:222-223` ném `DRIVER_FUNDING_REQUIRED` nếu `wallet.fundingForActivation(...).funded` sai. Ngưỡng cụ thể (Antigravity ghi 100.000 đ) **chưa được Lead kiểm**. `fundingForActivation` đi qua cổng `DRIVER_WALLET_PORT` (`driver/driver-wallet-port.ts`): `DelegatingDriverWalletPort` mặc định trỏ `NotIntegratedDriverWalletPort` rồi được `WalletModule.onModuleInit()` gắn thật bằng `this.port.bind(this.wallet)` (`wallet/wallet.module.ts:34-36`): graph không thấy cạnh này.
**Chưa mở:** thân hàm confirm, đối soát tiền đến muộn (M04-R-14), luồng rút tiền, cô lập quyền ví theo scope DRIVER (M04-R-15).

## F6 Thông báo

**Yêu cầu liên quan:** M08-R-*

**Entry point (từ decorator):**
- `GET /v1/admin/notifications/work-queue` → `AdminNotificationController.workQueue` (`notifications/admin-notification.controller.ts:27`)
- `GET /v1/admin/notifications/config` → `AdminNotificationController.config` (`notifications/admin-notification.controller.ts:34`)
- `POST /v1/admin/notifications/config` → `AdminNotificationController.updateConfig` (`notifications/admin-notification.controller.ts:41`)
- `GET /v1/admin/notifications` → `AdminNotificationController.search` (`notifications/admin-notification.controller.ts:51`)
- `GET /v1/admin/notifications/:notification_id` → `AdminNotificationController.detail` (`notifications/admin-notification.controller.ts:57`)
- `GET /v1/notifications` → `NotificationController.list` (`notifications/notification.controller.ts:18`)
- `GET /v1/notifications/changes` → `NotificationController.changes` (`notifications/notification.controller.ts:23`)
- `GET /v1/notifications/unread-count` → `NotificationController.unread` (`notifications/notification.controller.ts:30`)
- … và 7 route khác (xem `nest.json`)

**ĐÃ MỞ SOURCE:** không có producer nào gọi `NotificationEventService` trực tiếp; mọi sự kiện đi qua outbox: producer ghi `outbox_events` → `OutboxDispatcher` (tick 2 s) → `ConsumerPublisher` → `NotificationEventService` (`notifications/notification-runtime.ts:22-28,56,75`). `graphify path OrderRecorder NotificationEventService` = không có đường: **Graphify mù với luồng này**.
Push FCM: `push-provider.ts` (OAuth JWT → `messages:send`); trạng thái hoãn theo M08-R-11.

## F7 Quản trị: duyệt shipper, khóa, hủy đơn, tài chính

**Yêu cầu liên quan:** M12-R-*, M03-R-06, M07-R-09, M13-R-13

**Entry point (từ decorator):**
- `GET /v1/admin/shippers` → `AdminShipperController.list` (`admin-shippers/admin-shipper.controller.ts:94`)
- `GET /v1/admin/shippers/:driver_id` → `AdminShipperController.detail` (`admin-shippers/admin-shipper.controller.ts:100`)
- `POST /v1/admin/shippers/:driver_id/approve` → `AdminShipperController.approve` (`admin-shippers/admin-shipper.controller.ts:107`)
- `POST /v1/admin/shippers/:driver_id/reject` → `AdminShipperController.reject` (`admin-shippers/admin-shipper.controller.ts:113`)
- `POST /v1/admin/shippers/:driver_id/lock` → `AdminShipperController.lock` (`admin-shippers/admin-shipper.controller.ts:119`)
- `POST /v1/admin/shippers/:driver_id/unlock` → `AdminShipperController.unlock` (`admin-shippers/admin-shipper.controller.ts:125`)
- `POST /v1/admin/shippers/:driver_id/classification` → `AdminShipperController.classify` (`admin-shippers/admin-shipper.controller.ts:131`)
- `POST /v1/admin/shippers/:driver_id/bank/verify` → `AdminShipperController.bankVerify` (`admin-shippers/admin-shipper.controller.ts:137`)
- … và 34 route khác (xem `nest.json`)

**ĐÃ MỞ SOURCE (`admin-orders/admin-order.controller.ts`):** mỗi route đi `AdminTransport.read/write` (cookie + CSRF) → service **kiểm quyền lại dưới khóa**; `act` nhận hành động từ đường dẫn, chỉ lấy `expectedVersion` + `reason` từ body; không có route đặt trạng thái trực tiếp (comment `:13-15`).
**Chưa mở:** các controller admin khác (mỗi cái có `#ingress`/`#readGuard` riêng: `admin-service-area.controller.ts:47,69`).

## F8 Định tuyến và khoảng cách (liên quan #294, #299)

**Yêu cầu liên quan:** M02-R-12, M10-R-06, M14-R-10..12, M07-R-15

**Entry point (từ decorator):**
- `POST /v1/discovery/route-distances` → `DiscoveryRouteController.distances` (`discovery-route/discovery-route.controller.ts:12`)
- `GET /v1/service-areas` → `DiscoveryController.areas` (`menu/menu.controller.ts:132`)
- `GET /v1/service-areas/resolve` → `DiscoveryController.resolveArea` (`menu/menu.controller.ts:138`)
- `GET /v1/menu-categories` → `DiscoveryController.categories` (`menu/menu.controller.ts:145`)
- `GET /v1/discovery/shops` → `DiscoveryController.shops` (`menu/menu.controller.ts:151`)
- `GET /v1/discovery/dishes` → `DiscoveryController.dishes` (`menu/menu.controller.ts:158`)

**ĐÃ MỞ SOURCE:** chỉ có **một** client định tuyến phía backend: `delivery/m14-route-client.ts` (`POST {origin}/route`, hai điểm, motorcycle, không fallback, làm tròn mét tại `:43`). Người gọi: `discovery-route-service` (`route`), `order-customer-service` (`routeResult`), `delivery-customer/shop/shipper-service`, `address-change-service`, và cổng `ROUTE_MATRIX_PORT` (`shipping-eligibility.module.ts:48`). Cả hai đường Home và đặt đơn lấy pickup từ cùng `pickupLat/Lng` của snapshot quán (`discovery-route-service.ts:48-54`, `order-customer-service.ts:202`).
**Hệ quả cho #294 (617 m ≠ 720 m):** phía backend **không** có hai thuật toán khác nhau. Chênh lệch phải đến từ (a) điểm xuất phát khác nhau (GPS thiết bị so với địa chỉ đã lưu), (b) cache/điều kiện Valhalla, hoặc (c) client Dart. Phase 3 tập trung vào (a) và (c). Phía Dart: `m02/route_distance.dart:129` gọi `routeDistances(fix.latitude, fix.longitude, …)` bằng vị trí GPS; luồng đặt đơn của m10 chưa mở.
**#299 (OOM bản đồ):** nằm ở `mobile/packages/n11_m14_map` / `address_location_picker` phía Flutter; chưa mở.

## F9 Đăng xuất và xóa tài khoản (liên quan #295)

**Yêu cầu liên quan:** M01-R-11,15,16, M04-R-13

**Entry point (từ decorator):**
- `GET /v1/client-auth/config` → `ClientAuthController.config` (`client-auth/client-auth.controller.ts:61`)
- `POST /v1/client-auth/register` → `ClientAuthController.register` (`client-auth/client-auth.controller.ts:76`)
- `POST /v1/client-auth/login` → `ClientAuthController.loginUser` (`client-auth/client-auth.controller.ts:98`)
- `GET /v1/client-auth/me` → `ClientAuthController.me` (`client-auth/client-auth.controller.ts:112`)
- `POST /v1/client-auth/change-password` → `ClientAuthController.changePassword` (`client-auth/client-auth.controller.ts:122`)
- `POST /v1/client-auth/context` → `ClientAuthController.selectContext` (`client-auth/client-auth.controller.ts:133`)
- `POST /v1/client-auth/logout` → `ClientAuthController.logout` (`client-auth/client-auth.controller.ts:151`)

**ĐÃ MỞ SOURCE (server):** `POST /v1/client-auth/logout` **cố ý không guard**, service tự xác thực token để retry sau thu hồi vẫn trả 204 (`client-auth.controller.ts:152-166`).
**ĐÃ MỞ SOURCE (client):** `SessionController.logout()` (`n11_shared/.../session_controller.dart:502-540`) tăng `_epoch`, xóa token, `_toGuest()` (xóa `_identity`, `_profile`, `_pending`, `:227-233`) rồi mới gọi server.
**Dẫn mối cho #295 (ĐÃ MỞ SOURCE, chưa chạy app):** `mobile/ship/lib/ship_tabs.dart:201` dựng `WalletListItem(...)` **không điều kiện** theo `session.status`, trong khi dòng 202-203 ngay bên dưới chỉ hiện "Trao đổi nạp tiền" và "Dừng hoạt động / Rút tiền" khi `signedIn`; `ship_tabs.dart:141` cũng dựng `WalletEntry(session: session)` không điều kiện. Đây là **ứng viên nguyên nhân #295**, cần Phase 3 xác nhận bằng chạy app hoặc test. NOT TESTED.
**Xóa tài khoản:** thư mục `account-lifecycle/` (server). `ĐÃ MỞ SOURCE`: `account-lifecycle/` chỉ có `account-activity-registry.ts` và `account-record-reader.ts` (không controller); trong 412 route chỉ có 4 `@Delete` (`cart`, `addresses/:addressId`, `addresses/:addressId/defaults/:kind`, `push-token`), không route nào là yêu cầu xóa tài khoản. Khớp lead Phase 3/4 "không có xóa tài khoản trong app" (phía server); chưa kiểm phía Admin Web (`M01-R-11` nói Admin thực thi).

## F10 Tác vụ nền theo lịch

**Yêu cầu liên quan:** M07-R-13, M10-R-11, M08-R-09, M11-R-10, M10-R-22

Xem components.md §3 (10 runtime owner, mọi cái là `setInterval`, không `@Cron`). Chưa mở thân từng tác vụ; chạy trong tiến trình API (không phải worker riêng). Outbox an toàn khi nhiều instance (`FOR UPDATE SKIP LOCKED`, `outbox/outbox-dispatcher.ts:116`, `outbox-dispatch-store.ts:76,102`, ĐÃ MỞ SOURCE). Sweeper (đã đối chiếu review Antigravity và tự kiểm lại các dòng khóa, KHÔNG chạy thử, NOT TESTED): không có leader election / `pg_try_advisory_lock` cho tác vụ nền (grep `advisory` chỉ ra `shared/lock-key.ts` và khóa ghi theo nghiệp vụ), nhưng an toàn dữ liệu nhờ khóa hàng: `orders/order-repository.ts:540` (`claimScheduleReminders`, `FOR UPDATE SKIP LOCKED`), `order-timeouts/order-timeout-sweeper.ts:16,54,110` (`SKIP LOCKED` + khóa hàng), `delivery/delivery-repository.ts:555` (`#stopExpired`, `SKIP LOCKED`), `sms-gateway/sms-gateway-repository.ts:250` (`claimNext`, `SKIP LOCKED`). Antigravity nêu thêm `#searchReminders`/`#pickupReminders` ở delivery chọn ứng viên **không** `SKIP LOCKED` nhưng khóa lại bằng `lockById` + kiểm version nên không lặp tác dụng phụ, chỉ có thể chờ khóa/tải DB khi chạy nhiều instance (Lead chưa mở hai hàm này). Hệ quả: không phải lỗi, là chi phí khi scale ngang.

## F11 Theo dõi công khai (token trong URL)

**Yêu cầu liên quan:** M14-R-09

**Entry point (từ decorator):**
- `GET /v1/public/tracking/:token` → `DeliveryTrackingPublicController.getStatus` (`delivery/delivery-tracking-public.controller.ts:60`)
- `GET /v1/track/:token` → `DeliveryTrackingPublicController.renderHtml` (`delivery/delivery-tracking-public.controller.ts:74`)

Chưa mở. Có hai prefix: `/track/:token` và `/public/tracking/:token` được `app.setup.ts` viết lại URL sang `/v1/...` (PR #231, `app.setup.ts` đoạn trước `setGlobalPrefix`), nên route thật nằm ngoài prefix chung.

