# Phase 3 — Q8: outbox → M08 (đường consumer mà Graphify không thấy)

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Nhãn: **ĐÃ MỞ SOURCE** cho mọi dòng. Runtime NOT TESTED.

| Chặng | Kết luận | Bằng chứng |
|---|---|---|
| Producer | Module nghiệp vụ gọi `OutboxWriter.append(context, event)` **trong transaction của chính thay đổi**: event PENDING, `attempt_count=0`, mốc từ một lần lấy đồng hồ PostgreSQL. Ví dụ `DeliveryRecorder.record` ghi event `delivery.changed.v1` cùng timeline và audit | `outbox/outbox-writer.ts:11-22,32-39,48-65`; `delivery/delivery-recorder.ts:32,70` |
| Persistence | Bảng `app.outbox_events` (status PENDING/PROCESSING/DEAD, `attempt_count`, `locked_at`, `lock_token`, `published_at`, `last_error_code`) | `outbox/outbox-writer.ts:15-21` |
| Dispatcher | `OutboxDispatcher.dispatchOnce()` claim 2 bước bằng `FOR UPDATE SKIP LOCKED`: (1) PENDING đến hạn và PROCESSING hết lease mà hết lượt thử thành `DEAD` (không publish), (2) còn lượt thì thành PROCESSING với `attempt_count+1` và token mới. Ack hoặc fail theo token (fencing) | `outbox/outbox-dispatch-store.ts:59-86`; `outbox/outbox-dispatcher.ts:262-324` |
| Retry/backoff | `min(cap, base*2^(n-1))`, không jitter; giới hạn lượt thử bởi cấu hình `OUTBOX_MAX_ATTEMPTS`, batch `OUTBOX_BATCH_SIZE`; hết lượt thì `DEAD` | `outbox/outbox-backoff.ts:1-16`; `config/app-config.ts:426-439`; `outbox-dispatcher.ts:315-320` |
| Nối vào M08 | `NotificationRuntime` tạo `new OutboxDispatcher(store, new ConsumerPublisher(events, signal), …)` (đây là cạnh tĩnh mà Graphify không dựng được: consumer được truyền qua đối số constructor, không qua DI). `ConsumerPublisher.publish` gọi `NotificationEventService.consume(event)` rồi `signal.changed()` | `notifications/notification-runtime.ts:22-32,75` |
| Scheduler | `setInterval` 2 000 ms trong `NotificationRuntime.onApplicationBootstrap`, **không chạy khi `appEnv==='test'`**; có cờ chống chồng tick; mỗi tick: `dispatchOnce` → `reminders.runOnce` → `pushes.runOnce` → retention mỗi 10 phút (lưu trữ/xóa theo cấu hình Admin, dọn bookkeeping 35 ngày). Shutdown `drain(5 s)` | `notification-runtime.ts:15-19,78-114` |
| Event mapping | `consume` phân nhánh theo `eventType`: `business.finance.updated.v1`, delivery, order, topup, withdrawal, driver-state (profile), complaint, order-chat-message. Event `order.*`/withdrawal khác chưa có consumer được **ack là `NOT_INTEGRATED`** (ghi lại, không bịa). Event cũ hơn `MAX_EVENT_AGE_MS = 24 giờ` được ghi `STALE_EVENT` và không phát lại | `notification-event-service.ts:93-123`; `notification-constants.ts:100` |
| Idempotency của consumer | `claimEvent(eventId, …)` ghi sổ event đã tiêu thụ trong cùng transaction với thông báo; claim thất bại thì dừng (không tạo trùng) | `notification-event-service.ts:148-152` |
| Delivery (M08 → người dùng) | Draft `NOTIFY` ghi vào hộp thư người nhận; `OFFER_ROUND` chọn shipper đủ điều kiện (M06 precheck); nhắc quán/shipper vào bảng reminder rồi `ReminderBatcher` gộp | `notification-event-service.ts:153-181` |
| Push FCM | `PushDispatcher.runOnce`: claim hàng push có lease, quyết định EXPIRE/SKIP/gửi; token bị từ chối thì vô hiệu và bỏ qua; lỗi tạm thời thì retry mũ (mặc định tối đa 5 lượt, gốc 30 s, trần 15 phút) nhưng **không retry vượt hạn của chính push**; kết thúc `FAILED` kèm bằng chứng | `notifications/push-dispatcher.ts:40-85`; `notification-constants.ts:85-88` |
| Ack/retry end-to-end | Consumer ném lỗi thì outbox retry theo backoff rồi `DEAD`; consumer ack bằng cách trả về. Push có vòng retry riêng, độc lập với outbox | `notification-event-service.ts:92` (chú thích hợp đồng); `outbox-dispatcher.ts:299-324` |

## Hệ quả
- "Không có path" của Graphify giữa `OrderRecorder` và `NotificationEventService` là **đúng về cạnh tĩnh**, nhưng liên kết có thật qua outbox. Đã xác nhận bằng source như trên. Verdict liên quan (M08): xem bảng reconciliation.
- Các lớp `NOT_INTEGRATED` là hành vi có chủ ý (ack, không phát), không phải lỗi mất sự kiện. Việc những event type nào chưa có consumer: **UNKNOWN** cho tới khi đối chiếu từng yêu cầu M08.
