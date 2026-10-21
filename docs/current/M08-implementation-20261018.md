# M08 — Thông báo, nhắc việc và đồng bộ trạng thái: triển khai (18/10/2026)

> Bổ sung Owner 21/10/2026: [Thời hạn ba giai đoạn, SYSTEM tự hủy, audit và cài đặt Admin](M10-timeouts-20261021.md) (#153) thay thế các mô tả timeout cũ xung đột.

Nguồn thiết kế: `11Ship-M08-Functional-UI-LOCKED-v1.0.md` (OWNER_APPROVED / DESIGN_LOCKED 16/10/2026), hai ảnh `11Ship-M08-App-UI.png`, `11Ship-M08-Admin-Web-UI.png`; bản sao trong `docs/ui/m08/` và `docs/current/11Ship-M08-Functional-UI-LOCKED-v1.0.md`. Văn bản ưu tiên hơn chữ/dữ liệu trong ảnh. Nhánh `ccr-4d66d3bf-hsc7li`, base `main@999122d`. Không merge, không deploy.

## 1. Gói và nơi làm

| Gói | Nội dung | Code |
|---|---|---|
| M08.01 | Token push gắn **session** (kéo theo tài khoản, app, thiết bị M01); trigger DB vô hiệu token khi session bị thu hồi (logout, đăng nhập máy khác, thu hồi); token trùng của tài khoản khác bị thay (REPLACED) | `database/migrations/1794182400000_create-m08-notifications.sql`, `notifications/notification-repository.ts`, `notification-inbox-service.ts` (`/v1/notifications/push-token`), `mobile/.../m08_push.dart`, Kotlin `N11PushChannel` |
| M08.02 | Consumer của outbox (`delivery.changed.v1`, `wallet.topup_request.changed.v1`, `driver.state_changed.v1`), chống trùng theo `event_id` trong **cùng giao dịch**, một mục hộp thư/sự kiện/người nhận, retry có giới hạn, TTL gửi độc lập thời gian lưu, FCM HTTP v1 | `notification-event-service.ts`, `notification-composer.ts`, `push-dispatcher.ts`, `push-provider.ts`, `notification-runtime.ts` |
| M08.03 | Hộp thư (Tất cả/Chưa đọc, nhóm ngày, đánh dấu từng mục/tất cả, số chưa đọc), mở đối tượng: server kiểm lại quyền + trạng thái mỗi lần mở | `notification-inbox-service.ts`, `notification.controller.ts`, `m08_views.dart` |
| M08.04 | Nhắc tìm 5/15 phút và nhắc lấy hàng mỗi 5 phút: **mốc do M07 quyết định** (sweeper có sẵn), M08 gom, kiểm lại, bỏ mốc lỗi thời | `reminder-batcher.ts`, bảng `notification_reminders` |
| M08.05 | Cập nhật trực tiếp (long-poll `GET /v1/notifications/changes`), mở lại/reconnect/chạm push đều đọc lại server, trạng thái "Mất kết nối" | `NotificationController`, `shell.dart` |
| M08.06 | Admin Web "Vận hành › Thông báo" (Việc cần xử lý / Tra cứu / Cấu hình), cấu hình SYSTEM, lưu trữ 90/365 ngày | `admin-notification-*`, `apps/admin-web/src/dom/notifications-view.ts`, `notification-runtime.ts` (`NotificationRetention`) |

## 2. Quyết định kỹ thuật (không đổi nghiệp vụ đã duyệt)

1. **Một consumer outbox.** Bản này chưa có consumer nào khác; `NotificationRuntime` chạy `OutboxDispatcher` với một publisher: sự kiện không thuộc M08 được ghi nhận và bỏ qua. Khi M13 (hoặc module khác) cần đọc outbox, cần thêm fan-out ở publisher này — chưa làm vì chưa có nhu cầu.
2. **Sự kiện cũ > 24 giờ không bao giờ được phát** (outbox tồn đọng sau sự cố, hoặc từ trước khi có M08): ghi `STALE_EVENT`, không tạo thông báo. Mục hộp thư lấy thời gian của **sự kiện**, hạn gửi push tính từ lúc sự kiện xảy ra.
3. **Mốc nhắc không nằm trong M08.** `delivery.search_reminder_5/15`, `search_stopped`, `pickup_reminder` là sự kiện M07 đã lưu mốc trong DB (restart không reset). M08 chỉ biến chúng thành thông báo sau khi kiểm lại trạng thái/assignment/quyền/hạn, và bỏ mốc quá cửa sổ (nhắc tìm 9 phút, nhắc lấy 5 phút) — không phát dồn.
4. **Thẻ "Có đơn giao hàng mới"**: đúng một dòng hộp thư mỗi shipper (cập nhật tại chỗ: chưa đọc lại, seq mới, hạn mới). Không có lịch sử riêng từng đơn. Push tối đa 1/shipper/delivery/đợt (`notification_offer_rounds` + `push_key = offer:<delivery>:<version>`); đợt mới khi tạo, gọi lại, hoặc shipper/Admin trả đơn về `waiting_driver`; **không đụng `search_expires_at`**. Người vừa hủy nhận không bị báo lại. Chọn người nhận: M06 `precheck` (đủ điều kiện, bán kính, ví…), chỉ tối đa 100 ứng viên gần nhất. Push này kiểm lại trước khi gửi (đơn đã bị nhận/hết hạn → `NO_LONGER_AVAILABLE`).
5. **Nội dung push khóa màn hình** cố định trong `notification-composer.ts` (chỉ mã giao hàng; không OTP/SĐT/địa chỉ/ngân hàng/loại PLATFORM-EXTERNAL) — có unit test chặn.
6. **Cài đặt**: tắt một nhóm vẫn giữ mục hộp thư, chỉ không gửi push (`SETTING_OFF`); tắt âm thanh chỉ đổi kênh Android (`n11_qv`…), không tắt push. Timer nghiệp vụ không chỉnh được.
7. **"Đã gửi" = nhà cung cấp push đã nhận.** Mỗi thông báo luôn có một dòng push với lý do thật (`NO_TOKEN`, `TOKEN_ENDED`, `SETTING_OFF`, `CHANNEL_OFF`, `PROVIDER_NOT_CONFIGURED`, `NO_LONGER_AVAILABLE`, `STALE`, `TOKEN_REJECTED`, `STALE_EVENT`) để Admin không phải đoán.
8. **Ranh giới module**: M08 không viết SQL vào bảng shop/driver/wallet; dùng repository của chủ sở hữu (thêm 3 hàm đọc nhỏ: `ShopRepository.ownerUserIdOfShop/isOwnerOfShop`, `DriverRepository.listAcceptingAmong`, `ShipperLocationRepository.driversNear`; `feeOpenTo` của M07 được export). Test ranh giới hiện có vẫn xanh.
9. **Admin scope**: SYSTEM thấy cả hai app; ADMIN chỉ thấy app mà quyền VIEW hiện tại cho phép (DRIVER → 11Ship, SHOP → 11Food), kiểm lại mỗi lần đọc. Chỉ SYSTEM sửa cấu hình. Không có route gửi/phát lại/phát hàng loạt.

## 3. Việc chưa nối (adapter/hook rõ ràng, không dữ liệu giả)

| Phần | Lý do | Dấu hiệu trong code |
|---|---|---|
| Đơn món mới, quán xác nhận/từ chối/hủy Order, thông báo cho khách đặt | M10 (Order) chưa có | `order.*` được ghi `NOT_INTEGRATED`; `TargetType.order` đã có trong schema; khách chỉ nhận khi M10 phát sự kiện với tài khoản đặt đơn (không suy từ SĐT) |
| Rút tiền có kết quả | M04-C chưa có | `wallet.withdrawal*` → `NOT_INTEGRATED` |
| "Hàng cần xử lý" tới Admin theo quyền | không có sự kiện riêng; Admin thấy trong **Việc cần xử lý** (ca hàng mở) | `NotificationRepository.openGoodsCases` |
| Push thật trên điện thoại | cần cấu hình Firebase + khóa dịch vụ (mục 4) và thử trên thiết bị | `PUSH_FCM_*`, `FCM_*` |
| Thông báo vị trí M14, cảnh báo M13 | ngoài phạm vi | không có |

## 4. Cấu hình còn cần để có push thật

**Trạng thái:** phần kỹ thuật đã hoàn thiện đầu cuối (máy chủ FCM, APK có đường build push, quyền thông báo, kênh âm thanh/rung, biểu tượng, chạm mở đúng màn). **APK bàn giao hiện chưa có push** vì dự án Firebase của Owner và khóa chưa được cung cấp; M08 **chưa** được coi là xong cho đến khi Owner làm các bước dưới đây và máy thật đạt. Hướng dẫn từng bước, lệnh và bài thử điện thoại: [ops/runbooks/m08-push-deploy-20261018.md](../../ops/runbooks/m08-push-deploy-20261018.md).

**Máy chủ (VPS)** — thiếu thì push ghi `PROVIDER_NOT_CONFIGURED`, hộp thư/đồng bộ vẫn chạy:

```
PUSH_FCM_PROJECT_ID=<id dự án Firebase>
PUSH_FCM_SERVICE_ACCOUNT_FILE=/etc/11ship/fcm/service-account.json   # service account JSON, 640 root:ship11 trong thư mục 750; KHÔNG đưa vào repo/log/APK
```
Service account có vai trò *Firebase Cloud Messaging API Admin*. Kiểm tra trước khi khởi động lại: `npm run push:check` (xác thực khóa, dự án và quyền FCM qua `validate_only`, không gửi gì; mã lỗi cố định; `-- --token <token>` gửi thử một thông báo thật).

**APK (GitHub)** — biến/secret của repository, đủ cả 4 cho từng app, thiếu hết = APK không có push (CI cảnh báo), thiếu một phần = build dừng:

| Tên | Loại | Ghi chú |
|---|---|---|
| `FCM_PROJECT_ID`, `FCM_SENDER_ID` | variable | chung |
| `FCM_SHIP_APP_ID`, `FCM_FOOD_APP_ID` | variable | `1:<sender>:android:<hex>` của từng app Android (applicationId `vn.eleven.ship.test` / `vn.eleven.food.test`) |
| `FCM_SHIP_API_KEY`, `FCM_FOOD_API_KEY` | secret | khóa API Android của từng app (định danh client, có trong mọi APK; không phải khóa máy chủ) |

**Đã kiểm tự động:** client FCM với máy chủ Google giả (`push-provider.spec.ts`); token theo phiên, dừng khi đăng xuất/đổi tài khoản, gom thẻ, nhắc 5/15 phút và nhắc lấy hàng, **nhắc lấy hàng bị bỏ khi pickup / shop hủy / shipper trả đơn** (`m08-notifications.int.spec.ts`); xin quyền một lần sau đăng nhập, đăng ký token, chạm → định tuyến (Dart); job CI *push build compiles* biên dịch bản có Firebase bằng định danh giả và kiểm tra manifest + quyền.
**Chưa kiểm (chỉ máy thật mới chứng minh):** Google nhận khóa thật, FCM giao tới máy, thông báo hiện/chạm mở đúng màn trên Android, kênh âm thanh/rung. Bài thử: mục D của runbook.

## 5. Kiểm thử đã chạy (cục bộ, PG 16)

- `tests/integration/m08-notifications.int.spec.ts` (15): thẻ gom một lần + không lộ SĐT/địa chỉ; redelivery/vòng mới không nhân đôi; hủy nhận → đợt mới, hạn không đổi, người vừa hủy không bị báo; đơn bị nhận trước khi push → bỏ; logout/đổi tài khoản trên cùng token → vô hiệu; riêng tư theo tài khoản + app; retry/backoff, token chết, TTL; cài đặt nhóm & âm thanh; kết quả cho quán + mở kiểm lại quyền; nhắc lấy gom 2 đơn, dừng khi pickup, không phát lại; nhắc tìm chỉ khi đang tìm, mốc quá hạn bị bỏ; lưu trữ/xóa không đụng delivery; không thiết bị → `NO_TOKEN`; sự kiện cũ; hồ sơ + Order/withdrawal "chưa nối". FCM là **máy chủ HTTP cục bộ thật** (OAuth + `messages:send`), không phải giả lập trong tiến trình.
- `tests/integration/m08-admin-notifications.int.spec.ts` (6): phạm vi SYSTEM/ADMIN, tìm kiếm, chi tiết + bằng chứng, hàng đợi, cấu hình (quyền, phiên bản, giới hạn, audit), không có route gửi/phát lại.
- Migration specs hiện có cập nhật (Up/Down thứ tự mới); unit: composer, cấu hình push, registry lỗi, ranh giới module; Admin Web (core + build); Flutter: `n11_shared` 335 + m08 16, `ship` 21 (4 mới), `food` 19.
- **Chưa kiểm chứng:** Android thật (emulator hay máy), nhận push FCM thật, build Kotlin (không có Android SDK trong môi trường phát triển — CI *Mobile APK* biên dịch), giao diện Admin Web trong trình duyệt thật, PG 17 cho spec `staging-db-upgrade-from-42` (cần PG 17, CI chạy).


## Owner decision — 18/10/2026: defer FCM activation

Owner approved merging M08 with the in-app inbox, notification bell and live/reconnect synchronization. Firebase/FCM production configuration and real background-push acceptance are deferred until preparation for the Google Play release. Keep the implemented FCM integration for later activation. Missing Firebase credentials do not block this merge. This decision does not authorize VPS deployment or remote migrations.
