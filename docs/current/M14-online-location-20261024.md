# M03/M06/M14 — Online và chia sẻ vị trí là một (Owner duyệt 24/10/2026)

Shipper chỉ còn **một nút online**. Bật online tự bật chia sẻ vị trí; không có trạng thái "nhận được đơn nhưng chưa có vị trí".

## Vì sao trước đây tách rời

- `accepting_deliveries` (M03) và vị trí (M14) là hai thứ độc lập: nút "Bật chia sẻ vị trí" nằm riêng trong màn Đơn hàng, vòng đời gắn vào màn hình.
- Máy chủ đã chặn nhận đơn khi vị trí cũ (M06: `LOCATION_STALE`), nhưng app vẫn hiện "đang online", và `POST /driver/me/accepting` bật được khi chưa từng có vị trí.
- Phân phối đơn (`driversNear`) không xét độ mới của vị trí.

## Quy tắc (máy chủ quyết định, app chỉ sắp thứ tự bước)

| Việc | Cách làm |
|---|---|
| Ý định online | Vẫn là `accepting_deliveries`. Chỉ shipper, khóa tài khoản hoặc yêu cầu ngừng hoạt động đổi nó. **Không có migration.** |
| Đủ điều kiện nhận đơn thực tế | Dẫn xuất khi đọc: ý định bật **và** điều kiện hiện có (hồ sơ, ví…) **và** vị trí còn mới. Không lưu cột nào. |
| Ngưỡng quá hạn | **Tái sử dụng** `LOCATION_LIVE_SECONDS = 120` (M07/M14, `delivery-constants.ts`): chu kỳ 60 giây nên trễ một lần không bị chặn, trễ hai lần thì tạm dừng. App coi "máy chủ đã có vị trí" trong 100 giây. |
| Bật online | `POST /driver/me/accepting {accepting:true}` thêm điều kiện: có vị trí hợp lệ, còn mới → nếu không `409 DRIVER_LOCATION_NOT_READY`. App gửi vị trí **trước** rồi mới gọi. |
| Vị trí quá hạn | Danh sách đơn ẩn (`LOCATION_STALE`), nhận đơn bị từ chối `DELIVERY_NOT_ELIGIBLE` (kiểm lại trong giao dịch nhận), phân phối đơn bỏ qua shipper đó. Đơn đang giao không bị hủy. Vị trí về lại thì nhận đơn **tự khôi phục** nếu ý định còn bật; shipper đã tắt thì không bao giờ tự bật lại. |
| Tắt online | Luôn được (M03 không chặn vì còn đơn; "đóng tài khoản" là yêu cầu riêng và vẫn bị `DRIVER_HAS_ACTIVE_WORK`/`DRIVER_WALLET_NOT_SETTLED` bảo vệ). Ngừng nhận đơn mới ngay. |
| "Còn đơn đang thực hiện" | Một định nghĩa duy nhất (`ShipperSettlementReader.hasActiveWork`): assignment `ACTIVE` **hoặc** sự cố giữ hàng còn mở (hủy/thất bại sau lấy hàng, hàng còn ở shipper). Cũng chính là điều kiện đóng tài khoản. |
| Cần chia sẻ | `should_share_location = (ý định bật và ACTIVE) hoặc còn đơn`. Có trong `GET /driver/me` (`presence`) và **trong câu trả lời của mỗi lần `PUT /driver/location`**, nên app tự dừng khi shipper đã offline và hết đơn. |
| Phiên | Báo vị trí và nhận đơn đều khóa phiên hiện tại: đăng xuất/thu hồi thì phiên cũ không báo và không nhận đơn được. App dừng dịch vụ và không gửi bằng token cũ. |

`GET /driver/me` thêm khối `presence` (`intent_online`, `location_ready`, `can_receive_orders`, `paused_reason`, `has_active_work`, `should_share_location`). Mã lỗi mới: `DRIVER_LOCATION_NOT_READY` (409).

## App 11Ship

- `ShipOnline` (`ship_online.dart`) sống theo phiên, không theo màn hình; Home, màn giao hàng và công tắc ở hồ sơ dùng cùng nguồn (công tắc hồ sơ đi qua cùng `acceptingHandler`).
- Bật: bắt đầu chia sẻ → chờ vị trí hợp lệ đã **đến máy chủ** → mới gọi bật. Lỗi ở bước nào cũng dọn: dừng dịch vụ vừa bật nếu không còn lý do; nếu câu trả lời bị mất thì đọc lại máy chủ rồi quyết định (không đoán). Bấm lặp chỉ chạy một lần.
- Mở lại app/đăng nhập: đọc máy chủ, tự khôi phục nếu còn ý định online hoặc còn đơn; thiếu quyền thì hiện hướng dẫn, không hỏi lặp cho tới khi shipper bấm "Thử lại" hoặc quay lại app.
- Giao diện: một dòng nhỏ ("Đang chia sẻ vị trí", "Đang lấy vị trí…", "Đang giao đơn · Vẫn chia sẻ vị trí", "Chưa có vị trí · Tạm dừng nhận đơn"); hướng dẫn + nút ("Thử lại", "Mở cài đặt", "Mở cài đặt vị trí", "Mở cài đặt thông báo") chỉ khi có vấn đề. Không hiện mã/ID; `request_id` vẫn nằm trong log.
- Android: `ShipLocationService` (foreground service loại `location`, thông báo thường trực, không có nút dừng riêng). Manifest/quyền không đổi so với trước (đã có `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`); chỉ khởi động khi app đang hiển thị (đúng giới hạn Android 12+).

## Giới hạn Android — chưa thử trên máy thật

Vị trí được **gửi bởi app Flutter**, dịch vụ nền chỉ thu thập. Vì vậy:

- **Vuốt app khỏi danh sách gần đây**: engine Flutter bị hủy nên không còn gửi được. Dịch vụ dừng thu thập (không tốn pin vô ích) và để lại một thông báo "Mở lại 11Ship để tiếp tục nhận đơn"; mở lại app tự khôi phục. Máy chủ tự dừng cấp đơn mới sau 2 phút. Muốn gửi tiếp được khi bị vuốt cần bộ gửi vị trí viết bằng native dùng token/bằng chứng thiết bị — cần Owner quyết định riêng.
- Force-stop, tiết kiệm pin/hạn chế nền của nhà sản xuất: không cam kết.

Các mục dưới đây **chưa kiểm trên điện thoại thật** (CI/unit test không thay thế): khóa màn hình ≥ 5 phút vẫn gửi mỗi ~1 phút; chuyển app; vuốt khỏi gần đây (thông báo + khôi phục); force-stop; chế độ tiết kiệm pin; từ chối quyền ("không hỏi lại") → "Mở cài đặt"; tắt GPS → "Mở cài đặt vị trí"; tắt thông báo; Android 8, 12, 13, 14.
