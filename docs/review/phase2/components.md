# G-2 Bảng component và phụ thuộc

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.


Nguồn: script `nest.py` đọc **49 file `*.module.ts`**, **69 controller**, **412 route** ở `apps/backend/src` (đối chiếu: đếm decorator `@Get/@Post/@Put/@Patch/@Delete` bằng grep = 412, khớp) và đồ thị import file của Graphify/`imports.py`. `AppModule.register()` ghép module theo điều kiện (`auth` có truyền thì mới mount Onboarding, Orders, Delivery, Wallet…; `AdminAuthModule` chỉ mount khi `ADMIN_AUTH_ENABLED=true`). **Hệ quả:** có route tồn tại trong code nhưng không mount ở mọi cấu hình. `ĐÃ MỞ SOURCE: apps/backend/src/app.module.ts:60-93`.

## 1. Module NestJS (49)

| Module | File | Controller | Route | Provider | Import module (tối đa 8) |
|---|---|---|---|---|---|
| `AccountRecoveryModule` | `account-recovery/account-recovery.module.ts` | 2 | 14 | 4 | AuditModule, IdempotencyModule, OutboxModule, TransactionModule |
| `AddressChangeModule` | `address-change/address-change.module.ts` | 0 | 0 | 2 | AddressChangeReadModule, DeliveryCoreModule, DriverModule, IdempotencyModule, M14RoutingModule, OrdersCoreModule, ShippingEligibilityModule, ShopModule … |
| `AddressChangeReadModule` | `address-change/address-change-read.module.ts` | 0 | 0 | 1 | — |
| `AdminAuthModule` | `admin-auth/admin-auth.module.ts` | 33 | 204 | 88 | AuditModule, DeliveryCoreModule, DriverModule, FeedbackReadModule, IdempotencyModule, NotificationsReadModule, OpsCoreModule, OrderChatServiceModule … |
| `AppModule` | `app.module.ts` | 0 | 0 | 0 | AccountRecoveryModule, AdminAuthModule, ConfigModule, CustomerProfileModule, CustomersModule, DatabaseModule, DiscoveryRouteModule, DriverWalletModule … |
| `AuditModule` | `audit/audit.module.ts` | 0 | 0 | 4 | — |
| `AuthModule` | `auth/auth.module.ts` | 3 | 16 | 39 | AuditModule, DriverModule, IdempotencyModule, OutboxModule, ShopModule, SmsGatewayModule, TransactionModule, WalletModule |
| `ConfigModule` | `config/config.module.ts` | 0 | 0 | 0 | — |
| `CustomerProfileModule` | `customer-profile/customer-profile.module.ts` | 1 | 2 | 1 | AuditModule, DriverModule, IdempotencyModule, TransactionModule |
| `CustomersModule` | `customers/customers.module.ts` | 1 | 9 | 3 | AuditModule, IdempotencyModule, TransactionModule |
| `DatabaseModule` | `database/database.module.ts` | 0 | 0 | 3 | — |
| `DeliveryCoreModule` | `delivery/delivery-core.module.ts` | 0 | 0 | 6 | AddressChangeReadModule, AuditModule, DeliveryReadModule, DriverModule, IdempotencyModule, OutboxModule, ShipperLocationModule, ShippingEligibilityModule … |
| `DeliveryModule` | `delivery/delivery.module.ts` | 4 | 39 | 6 | AddressChangeModule, DeliveryCoreModule, DriverModule, IdempotencyModule, M14RoutingModule, OrdersCoreModule, ShipperSettlementModule, TransactionModule |
| `DeliveryReadModule` | `delivery/delivery-read.module.ts` | 0 | 0 | 4 | WalletModule |
| `DiscoveryRouteModule` | `discovery-route/discovery-route.module.ts` | 1 | 1 | 1 | M14RoutingModule, ShopModule, ShopSetupCoreModule, TransactionModule |
| `DriverModule` | `driver/driver.module.ts` | 0 | 0 | 10 | — |
| `DriverWalletModule` | `driver-wallet/driver-wallet.module.ts` | 1 | 8 | 3 | AuditModule, DriverModule, IdempotencyModule, OutboxModule, ShipperSettlementModule, TransactionModule, WalletModule |
| `FeedbackModule` | `feedback/feedback.module.ts` | 3 | 20 | 6 | DeliveryCoreModule, DriverModule, FeedbackReadModule, IdempotencyModule, OrdersCoreModule, ShopModule, ShopSetupCoreModule, TransactionModule |
| `FeedbackReadModule` | `feedback/feedback-read.module.ts` | 0 | 0 | 4 | AuditModule, OutboxModule |
| `HealthModule` | `health/health.module.ts` | 1 | 2 | 0 | — |
| `IdempotencyModule` | `idempotency/idempotency.module.ts` | 0 | 0 | 4 | TransactionModule |
| `LoggingModule` | `logging/logging.module.ts` | 0 | 0 | 0 | — |
| `M14RoutingModule` | `delivery/m14-routing.module.ts` | 0 | 0 | 2 | — |
| `MenuModule` | `menu/menu.module.ts` | 3 | 14 | 4 | AuditModule, FeedbackReadModule, IdempotencyModule, MenuReadinessModule, OrdersCoreModule, OutboxModule, ShopModule, ShopSetupCoreModule … |
| `MenuReadinessModule` | `menu/menu-readiness.module.ts` | 0 | 0 | 1 | — |
| `NotificationsModule` | `notifications/notifications.module.ts` | 1 | 10 | 10 | DeliveryReadModule, DriverModule, FeedbackReadModule, NotificationsReadModule, OrderChatCoreModule, OrdersCoreModule, OutboxModule, ShipperLocationModule … |
| `NotificationsReadModule` | `notifications/notifications-read.module.ts` | 0 | 0 | 4 | — |
| `OnboardingModule` | `onboarding/onboarding.module.ts` | 2 | 5 | 4 | AuditModule, DriverModule, IdempotencyModule, OutboxModule, ShopModule, ShopSetupCoreModule, TransactionModule, WalletModule |
| `OpsCoreModule` | `ops/ops-core.module.ts` | 0 | 0 | 11 | TransactionModule |
| `OpsModule` | `ops/ops.module.ts` | 1 | 8 | 5 | NotificationsReadModule, OpsCoreModule, TransactionModule |
| `OrderChatCoreModule` | `order-chat/order-chat-core.module.ts` | 0 | 0 | 2 | DeliveryReadModule, DriverModule, OrdersCoreModule, ShopModule |
| `OrderChatModule` | `order-chat/order-chat.module.ts` | 4 | 10 | 0 | OrderChatServiceModule |
| `OrderChatServiceModule` | `order-chat/order-chat-service.module.ts` | 0 | 0 | 3 | DeliveryCoreModule, OpsCoreModule, OrderChatCoreModule, OrdersCoreModule, OutboxModule, TransactionModule |
| `OrdersCoreModule` | `orders/orders-core.module.ts` | 0 | 0 | 7 | AuditModule, OutboxModule |
| `OrdersModule` | `orders/orders.module.ts` | 2 | 27 | 7 | AddressChangeModule, CustomersModule, DeliveryCoreModule, DriverModule, IdempotencyModule, M14RoutingModule, MenuModule, OrdersCoreModule … |
| `OutboxModule` | `outbox/outbox.module.ts` | 0 | 0 | 1 | — |
| `ShipperLocationModule` | `delivery/shipper-location.module.ts` | 0 | 0 | 2 | — |
| `ShipperSelfModule` | `shipper-self/shipper-self.module.ts` | 1 | 9 | 1 | AuditModule, DriverModule, IdempotencyModule, OutboxModule, ShipperLocationModule, ShipperSettlementModule, TransactionModule, WalletModule |
| `ShipperSettlementModule` | `shipper-settlement/shipper-settlement.module.ts` | 0 | 0 | 1 | DeliveryReadModule, FeedbackReadModule |
| `ShippingEligibilityModule` | `shipping-policy/shipping-eligibility.module.ts` | 0 | 0 | 13 | DeliveryReadModule, DriverModule, M14RoutingModule, ShipperLocationModule, TransactionModule, WalletModule |
| `ShopManagementModule` | `shop-management/shop-management.module.ts` | 2 | 4 | 2 | AuditModule, IdempotencyModule, OutboxModule, ShopModule, ShopSetupCoreModule, TransactionModule |
| `ShopModule` | `shop/shop.module.ts` | 0 | 0 | 6 | — |
| `ShopSetupCoreModule` | `shop-setup/shop-setup-core.module.ts` | 0 | 0 | 2 | AuditModule, MenuReadinessModule, OutboxModule, ShopModule |
| `ShopSetupModule` | `shop-setup/shop-setup.module.ts` | 1 | 1 | 1 | ShopModule, ShopSetupCoreModule, TransactionModule |
| `SmsGatewayModule` | `sms-gateway/sms-gateway.module.ts` | 1 | 4 | 9 | OpsCoreModule, TransactionModule |
| `TestSmsModule` | `test-sms/test-sms.module.ts` | 0 | 0 | 1 | — |
| `TransactionModule` | `transaction/transaction.module.ts` | 0 | 0 | 3 | — |
| `WalletModule` | `wallet/wallet.module.ts` | 0 | 0 | 17 | DriverModule |
| `WalletTopupModule` | `wallet-topup/wallet-topup.module.ts` | 1 | 5 | 1 | AuditModule, DriverModule, IdempotencyModule, OutboxModule, TransactionModule, WalletModule |

**Quan sát (HEURISTIC, đã kiểm một phần):**
- Không có vòng phụ thuộc ở cấp module NestJS (SCC = 0) và không có `forwardRef`. Chỉ `DatabaseModule` là `@Global`.
- `AdminAuthModule` (323 dòng) là điểm tập trung: nó khai báo gần như mọi controller `admin/*`, cả `BusinessClientController` (`finance/me`, API của quán, không phải Admin) và `ShipperSettlementModule`. Đây là tập trung theo cấu hình (một cờ bật/tắt toàn bộ), cần Phase 3 xem có chủ ý hay không. `ĐÃ MỞ SOURCE: admin-auth/admin-auth.module.ts:160-199, 318-323`.
- `COMMISSION_ADJUSTMENT_PORT` chỉ được bind trong `AdminAuthModule` (`admin-auth.module.ts:264`). `AdminFeedbackService` (khai báo ở `admin-auth.module.ts:262`) chỉ tồn tại khi `AdminAuthModule` được mount, tức `ADMIN_AUTH_ENABLED=true`; không phát hiện lỗi, chỉ ghi nhận cách nối.

## 2. Các khu vực ngoài NestJS (số file theo `git ls-files`)

| Khu vực | File | Ghi chú |
|---|---|---|
| `apps/backend` | 811 | NestJS 49 module |
| `apps/admin-web` | 164 | TypeScript, DOM thuần (`src/core` logic, `src/dom` view, `business-main.ts` cho Mini Business PWA) |
| `apps/client-shared`, `food-web`, `ship-web`, `ui-foundation` | 50, 6, 6, 3 | Web dùng chung, giao diện thiết kế |
| `mobile/packages` | 207 | `n11_shared` (UI + controller dùng chung hai app), `n11_m14`, `n11_m14_map` |
| `mobile/food`, `ship`, `gateway` | 40, 44, 17 | Ba app Flutter: 11Food, 11Ship, SMS Gateway Android |
| `mobile/gps-test` | 301 | Dự án Kotlin thử GPS (259 file là `.pbf` bị bỏ) |
| `mobile/tool` | 31 | Công cụ sinh thư mục `android/` (`prepare-android.sh`) |
| `database` | 68 | 67 migration + fixtures |
| `ops`, `scripts`, `tools`, `config` | 81, 61, 12, 3 | Hạ tầng VPS/systemd/nginx (hầu hết **không** vào graph), script CLI |
| `.github/workflows` | 11 | CI, deploy, APK, M14 |
| `tests` | 308 | Không tính code sản phẩm |

## 3. Tác vụ nền (không có `@Cron`/`@Interval`/`@OnEvent` nào trong `apps/backend/src`)

`ĐÃ MỞ SOURCE` (grep decorator = 0 kết quả; `setInterval` trong từng file bên dưới). Tất cả là `setInterval` khởi tạo trong `onApplicationBootstrap`. **Hệ quả cho G-5:** các lớp này không có cạnh "gọi" từ ai ngoài module khai báo; graph sẽ coi như không ai dùng. Loại trừ khỏi ứng viên mã chết.

| Tác vụ | File (`apps/backend/src/…`) | Nhịp | Khởi động |
|---|---|---|---|
| Order sweeper (hết hạn đơn) | `orders/order-sweeper.ts` | setInterval 30 s | onApplicationBootstrap |
| Delivery sweeper (hạn tìm shipper/phí) | `delivery/delivery-sweeper.ts` | setInterval 30 s | onApplicationBootstrap |
| SMS queue sweeper | `sms-gateway/sms-queue-sweeper.ts` | setInterval 30 s | start() gọi trong constructor/khởi tạo |
| Outbox → M08 consumer | `notifications/notification-runtime.ts + outbox/outbox-dispatcher.ts` | tick 2 s | onApplicationBootstrap |
| Retention thông báo | `notifications/notification-runtime.ts` | 10 phút | onApplicationBootstrap |
| Export báo cáo Admin | `admin-reports/report-export-runner.ts` | 5 s | onApplicationBootstrap |
| Retention chat đơn | `order-chat/order-chat-retention.ts` | 30 phút | onApplicationBootstrap |
| Dọn ảnh phản ánh mồ côi | `feedback/attachment-janitor.ts` | 60 phút | onApplicationBootstrap |
| Ops runtime (thu thập, retention) | `ops/ops-runtime.ts` | tick 15 s; thu thập 60 s; retention 30 phút | onApplicationBootstrap |
| Ops analytics (snapshot, phát hiện) | `ops-analytics/ops-analytics-runtime.ts` | 15 phút; 60 phút | onApplicationBootstrap |
| Mini Business push | `business-dashboard/business-push-service.ts` | 10 s (bỏ qua khi appEnv=test) | onApplicationBootstrap |

**Hiệu chỉnh theo review Antigravity (đã tự kiểm lại ở source):**
- `IdempotencyCleanup` **không được khởi động ở đâu**: chỉ là provider (`idempotency/idempotency.module.ts:33-38`, `useFactory`), không có `setInterval`/cron/script nào gọi (grep toàn `apps` và `scripts`); `README.md:120` xác nhận *"primitive gọi tay (chưa có scheduler)"*. Hệ quả: bảng `app.idempotency_records` chỉ được dọn nếu có người gọi tay; ghi nhận cho Phase 3/6 (chưa phải finding).
- Cổng khởi động: `AdminLimitConfigVerifier.onApplicationBootstrap()` (`admin-auth/admin-limit-config-verifier.ts:19-34`) ném `StartupConfigError(['ADMIN_RATE_LIMIT_HMAC_KEY','ADMIN_RATE_LIMIT_KEY_ID'])` nếu bảng cấu hình không đọc được hoặc không khớp: backend từ chối khởi động. Báo cáo bản trước bỏ sót.
- Gắn lúc khởi động: `WalletModule.onModuleInit()` (`wallet/wallet.module.ts:34-36`) gắn `DelegatingDriverWalletPort` vào `WalletDriverPort`.
- Hook: 10 lớp `OnApplicationBootstrap` + 2 `OnModuleInit` (bản trước đếm 24 lần xuất hiện của mọi hook kể cả shutdown, gây hiểu nhầm).
- `NotificationSignal` (`notifications/notification-signal.ts`) dùng `EventEmitter` trong tiến trình để đánh thức long-poll; không có cạnh trong graph.
- Chưa mở: `audit/standalone-audit-recorder.ts`, `transaction/transaction-manager.ts` (`setTimeout` nội bộ, không phải tác vụ định kỳ).

## 3b. Token DI (`provide: <TOKEN>`) trong các `*.module.ts` (grep, ĐÃ MỞ SOURCE)
24 token khác nhau, Graphify không thấy cạnh từ người dùng token tới lớp bind: `OTP_PROVIDER` (2), `ACTIVATION_OTP_PROVIDER` (2), `CLIENT_DEVICE_TRUST` (2), `ACCOUNT_ORIGIN_POLICY` (2), `DRIVER_WALLET_PORT`, `ORDER_DELIVERY_PORT`, `FEEDBACK_ORDER_PORT`, `DELIVERY_OFFER_PORT`, `SHIPPER_WORK_PORT`, `SHIPPER_LOCATION_PORT`, `ROUTE_MATRIX_PORT`, `COMMISSION_ADJUSTMENT_PORT`, `AVAILABLE_BALANCE_PORT`, `PUSH_PROVIDER`, `PASSWORD_HASHER`, `OPS_SYSTEM_PROBE`, `OPS_DISCORD_CLIENT`, `M14_ROUTING`, `DATABASE_POOL`, `APP_CONFIG`, `APP_LOGGER`, `APP_COMPAT_MATRIX`, `CLIENT_AUTH_SETTINGS`, `ADMIN_LIMITER_KEY`, `TEST_SMS_LIFECYCLE`. (Antigravity đếm 16 cổng nghiệp vụ; con số 24 gồm cả token cấu hình/hạ tầng.)

## 4. Luồng sự kiện: outbox

`ĐÃ MỞ SOURCE`: producer ghi `outbox_events` cùng transaction (ví dụ `orders/order-recorder.ts`, `delivery/delivery-recorder.ts`, `feedback/feedback-recorder.ts`, `auth/registration-service.ts`, các service admin) → `OutboxDispatcher` (`notifications/notification-runtime.ts:75`) → `ConsumerPublisher.publish()` (`:22-28`) → `NotificationEventService`. Chú thích trong file: *"The outbox has one outbound consumer in this build: M08"* (`:56`).
`CHỈ TỪ GRAPH / giới hạn`: `graphify path "OrderRecorder" "NotificationEventService"` → **không có đường có hướng**. Đường này là nối động qua bảng DB nên graph không thể thấy; mọi phân tích tác động theo import sẽ bỏ sót toàn bộ M08.
