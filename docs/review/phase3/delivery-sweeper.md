# Phase 3 — Delivery sweeper (carry-over G-3/G-5)

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Mọi dòng: **ĐÃ MỞ SOURCE** (đọc toàn bộ `delivery/delivery-sweeper.ts`, các câu SQL liên quan trong `delivery-repository.ts`, hằng số và luật trong `delivery-constants.ts`, `delivery-rules.ts`, và `delivery-recorder.ts`). Runtime NOT TESTED.

## Lifecycle chung
- `DeliverySweeperRunner` đăng ký ở `DeliveryModule` providers (`delivery/delivery.module.ts:33`). `onApplicationBootstrap` tạo một `setInterval` 30 000 ms (`SWEEP_INTERVAL_MS`), `unref()`; **không chạy khi `appEnv==='test'`** (test tự gọi `sweep()`). Có cờ `#running` chống chồng tick; lỗi chỉ ghi log `delivery_sweep_failed` và không ném (`delivery-sweeper.ts:14-15,132-171`).
- Mỗi tick chạy tuần tự `#stopExpired` → `#searchReminders` → `#pickupReminders` → `FeeAnswerExpiry.sweep()`; mỗi bước **một transaction riêng**, batch 50 (`:43-49`, `BATCH=50`).
- Chỉ dùng thời gian lưu trên server (`freshClockMs`, `CLOCK` trong SQL), nên restart hay nhiều instance không đặt lại hoặc nhân đôi mốc (`:25-33`). Không có khóa leader toàn cục: an toàn dựa vào khóa hàng + đọc lại điều kiện.

## `#searchReminders` (nhắc quán ở phút 5 và 15 của một lượt tìm shipper)
| Mục | Nội dung | Bằng chứng |
|---|---|---|
| Trigger | Tick 30 s của runner | `delivery-sweeper.ts:148` |
| Điều kiện chọn ứng viên | `state='waiting_driver'`, `search_expires_at > now`, và (`reminded_5_at IS NULL` và đã qua 5 phút kể từ `search_started_at`) hoặc (`reminded_15_at IS NULL` và đã qua 15 phút). **Không có `FOR UPDATE`/`SKIP LOCKED` ở truy vấn chọn**; hàng được khóa sau bằng `lockById` | `delivery-repository.ts:562-572`; `delivery-sweeper.ts:75` |
| Điều kiện đọc lại dưới khóa | Bỏ qua nếu hàng không còn `waiting_driver` hoặc đã hết hạn (`searchExpired`). Nhắc nào đến hạn và chưa gửi mới được xử lý (`dueSearchReminders`, `REMINDER_MINUTES=[5,15]`) | `:76-84`; `delivery-rules.ts:65-72`; `delivery-constants.ts:23` |
| Dữ liệu đọc | `app.deliveries` (cột trạng thái và mốc `search_started_at`, `search_expires_at`, `reminded_5_at`, `reminded_15_at`) | `delivery-repository.ts:562-572` |
| Dữ liệu ghi | `deliveries.update(... {remindedNow: 5|15})` tăng version; sau đó `DeliveryRecorder.record` ghi 3 thứ cùng transaction: `delivery_events` (type `delivery.search_reminder_5|15`), `audit` (actor `SYSTEM`), `outbox_events` (`delivery.changed.v1`) | `:85-90`; `delivery-recorder.ts:50-70` |
| Side effect | Không gửi thông báo trực tiếp. Event outbox `delivery.changed.v1` là đầu vào cho M08, composer có nhánh `search_reminder_5` và `search_reminder_15` | `delivery-recorder.ts:32,70`; `notifications/notification-composer.ts:147-149`. Đường consumer: xem Q8, **ĐÃ MỞ SOURCE** ở `outbox-m08.md` |
| Failure path | `update` trả `undefined` (version lệch) thì `break` vòng nhắc, hàng tiếp theo vẫn xử lý; ném lỗi thì cả transaction của bước này rollback, tick sau thử lại (mốc chưa lưu nên không mất nhắc) | `:85-88` |

## `#pickupReminders` (nhắc shipper đã nhận mà chưa lấy hàng, mỗi 5 phút)
| Mục | Nội dung | Bằng chứng |
|---|---|---|
| Trigger | Cùng tick 30 s | `:148` |
| Điều kiện chọn | `delivery_assignments.status='ACTIVE'`, `picked_up_at IS NULL`, và `COALESCE(last_pickup_reminder_at, accepted_at) + 5 phút <= now` | `delivery-repository.ts:675-684` |
| Đọc lại dưới khóa | Khóa delivery rồi khóa assignment đang ACTIVE (cùng thứ tự với các đường shipper/quán/Admin). Bỏ qua nếu assignment đã có `pickedUpAt`, hoặc delivery không ở `accepted`/`location_confirmed`; sau đó `pickupReminderDue(now, acceptedAt, lastReminderAt)` (khoảng `PICKUP_REMINDER_MS = 5 phút`) | `delivery-sweeper.ts:103-110`; `delivery-rules.ts:76-77`; `delivery-constants.ts:25` |
| Dữ liệu ghi | `touchAssignment(..., 'reminder')` đặt `last_pickup_reminder_at = now`, version+1 (điều kiện `version=$` và `status='ACTIVE'`); rồi `record` với type `pickup_reminder`, `assignmentId`, `driverId` (events, audit, outbox) | `delivery-repository.ts:664-672`; `delivery-sweeper.ts:111-124` |
| Side effect | Outbox `delivery.changed.v1` cho M08. `push-dispatcher` có `collapseKey 'pickup_reminder'` cho kind `PICKUP_REMINDER` | `notifications/push-dispatcher.ts:160` |
| Vòng đời thực tế | **Không có số lần nhắc tối đa**: lặp mỗi 5 phút tới khi shipper lấy hàng, assignment không còn ACTIVE, hoặc delivery rời `accepted`/`location_confirmed`. Khoảng 5 phút là hằng số mã nguồn; màn cấu hình Admin hiển thị `pickup_reminder_minutes: 5` như giá trị cố định (`DISPLAYED_TIMERS`), không phải tham số chỉnh được | `delivery-constants.ts:25`; `admin-config/admin-config-service.ts:171`; `notifications/notification-constants.ts:117` |
| Failure path | `touchAssignment` trả false (version lệch) thì `continue`; ném lỗi thì rollback cả bước, tick sau thử lại | `:111-113` |

## Điểm rút ra cho đối chiếu baseline
- M07 (search stop 30 phút, nhắc phút 5/15, nhắc nhận hàng mỗi 5 phút) có triển khai và đúng vòng đời mô tả ở comment lớp (`delivery-sweeper.ts:25-33`). Không có test runtime nào được chạy trong Phase 3: **NOT TESTED**.
- Hằng số 30 phút / 5 / 15 / 5 nằm trong `delivery-constants.ts:20-25`; việc có cho phép Admin đổi hay không thuộc yêu cầu cấu hình (M12), sẽ đối chiếu ở bảng reconciliation.
