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
| Ngưỡng quá hạn | **Máy chủ quyết định**, tái sử dụng `LOCATION_LIVE_SECONDS = 120` (M07/M14, `delivery-constants.ts`): chu kỳ 60 giây nên trễ một lần không bị chặn, trễ hai lần thì tạm dừng. Mốc **100 giây** trong app chỉ để hiển thị dòng trạng thái và chủ động đọc lại hồ sơ (25 giây sau mốc đó); "đủ điều kiện nhận đơn" luôn là `presence.can_receive_orders` do máy chủ trả, không phải đồng hồ trong app. |
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

## Dịch vụ nền Android (gửi vị trí độc lập với Flutter)

`ShipLocationService` (foreground service loại `location`) **vừa lấy vừa gửi** vị trí (`LocationReporter`, `HttpsReportTransport`). App Flutter chỉ bật/tắt dịch vụ và đọc trạng thái dịch vụ báo lại; **app không bao giờ tự gửi vị trí**, nên không có gửi trùng.

- **Chạy tiếp** khi chuyển app, khóa màn hình và vuốt khỏi danh sách gần đây (tiến trình còn sống nhờ foreground service); mở lại app thì nhận lại dịch vụ đang chạy, không bật lần hai.
- **Phiên**: dịch vụ đọc token từ kho mã hóa của app (`N11DeviceStore`, qua `ShipSessionLink` do `N11Application` đăng ký) **cho từng lần gửi**; không lưu, không ghi log, không đưa vào thông báo. Chỉ lưu dấu vân tay một chiều của token (để biết phiên còn là phiên cũ) và địa chỉ máy chủ. Không có cơ chế làm mới: hết hạn/thu hồi = `401`.
- **Tự dừng và quên liên kết** khi: app tắt online mà hết đơn (app dừng); máy chủ trả `should_share_location=false` (sau 90 giây ân hạn kể từ lúc bật, để không tự dừng giữa lúc đang bật online); `401`; không còn token; token là của tài khoản khác. Đăng xuất: app gọi dừng, xóa liên kết, hủy request đang chờ; request trả về muộn bị bỏ.
- **Offline nhưng còn đơn** (kể cả hàng còn ở shipper): máy chủ báo `should_share_location=true` nên dịch vụ chạy tiếp; đơn kết thúc thì lần báo kế tiếp trả `false` và dịch vụ tự dừng.
- **Khởi động lại**: nếu Android giết tiến trình, dịch vụ chỉ được hệ thống dựng lại (`START_STICKY`) khi liên kết còn đánh dấu "đang cần"; mọi lần dừng đều xóa đánh dấu nên sau offline + hết đơn không tự chạy lại.
- Chỉ giữ **vị trí mới nhất**: đang gửi dở mà có vị trí mới thì chỉ gửi cái mới nhất; lỗi mạng thử lại một lần sau 10 giây (nếu còn dưới 2 phút) rồi chờ vị trí kế tiếp. Chỉ gửi https; kiểm tra lại tọa độ/độ chính xác/tuổi như app.
- `403/409` (tài khoản bị khóa…): dịch vụ báo `REFUSED`, app đọc lại hồ sơ rồi quyết định; không vòng lặp tự khởi động.
- Giới hạn của Android vẫn áp dụng: **force-stop**, tiết kiệm pin/hạn chế nền của nhà sản xuất, người dùng gỡ quyền vị trí hoặc tắt thông báo có thể dừng dịch vụ — không cam kết vượt qua.

## Bằng chứng kiểm thử

**Tự động (đã chạy):**
- Luật gửi của dịch vụ (JVM, `LocationReporterTest`, 16 ca): chỉ gửi vị trí hợp lệ, token chỉ ở header, không gửi trùng/cũ, chỉ vị trí mới nhất khi đang gửi dở, `401`/mất token/tài khoản khác → kết thúc và không gửi nữa, `403` tiếp tục, thử lại một lần, tự dừng khi máy chủ báo không cần (có ân hạn), dừng/khởi động lại không để request cũ trả lời hoặc gửi.
- App (Flutter, `m07_location_test`, `ship_online_test`): bật/tắt, các lỗi quyền/GPS/thông báo/không có vị trí/gửi lỗi/API lỗi/mất câu trả lời, bấm lặp, mở lại app nhận lại dịch vụ đang chạy, dịch vụ tự dừng thì không bật lại, phiên bị thu hồi.
- Máy chủ (integration, PostgreSQL): vị trí quá hạn chặn danh sách đơn, nhận đơn qua API, bật online và phân phối; phiên đăng xuất/thu hồi/hết hạn không báo vị trí, không bật online, không xem/nhận đơn, không được phân phối đơn.

**Chưa chạy trên máy thật — không suy ra từ build/test:** dịch vụ khi khóa màn hình lâu, chuyển app, vuốt khỏi gần đây, Android tự giết tiến trình rồi dựng lại, force-stop, tiết kiệm pin; quyền "không hỏi lại"; tắt GPS/thông báo; Android 8/12/13/14; xác nhận trên server thật rằng vị trí đều đặn ~1 phút khi khóa màn hình. CI biên dịch Kotlin và chạy unit test JVM nhưng không chứng minh dịch vụ chạy ổn trên thiết bị.

**Cách Owner thử:** bật online, khóa màn hình ≥ 5 phút, xem Admin/shop thấy vị trí cập nhật ~1 phút/lần; vuốt app khỏi gần đây, đợi 3 phút, kiểm tra vị trí vẫn cập nhật; tắt online lúc có đơn (vẫn chia sẻ) rồi hoàn tất đơn (thông báo biến mất); đăng xuất (thông báo biến mất, không còn cập nhật).
