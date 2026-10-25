# 11Ship — cảnh báo GPS/mạng và minh bạch chia sẻ vị trí (#194, 25/10/2026)

Chỉ đổi lớp hiển thị và tổng hợp trạng thái trên Trang chủ 11Ship. **Không đổi** nút Online (vẫn một nút), `can_receive_orders` của máy chủ, chu kỳ gửi vị trí (~1 phút), mốc M14 100 s (hiển thị) / 120 s (máy chủ), lifecycle dịch vụ định vị. Không thêm quyền Android (`ACCESS_NETWORK_STATE` đã có trong allowlist của Ship).

## Một cảnh báo, đúng nguyên nhân (`ship_alerts.dart`, `computeShipAlert`)

Hiện **một** vùng đỏ đầu Trang chủ (trên bản đồ) khi shipper muốn online, đang bị tạm dừng, hoặc đang có đơn; thứ tự ưu tiên, không chồng:

| Ưu tiên | Điều kiện (nguồn) | Nội dung | Nút |
|---|---|---|---|
| 1 | Chưa cấp quyền vị trí (`LocationProblem.permission`) | “11Ship chưa được cấp quyền vị trí.” | Mở cài đặt ứng dụng · Thử lại |
| 2 | GPS tắt **và** Internet mất | “Mạng và Vị trí chưa sẵn sàng” + 2 điều kiện riêng | Mở cài đặt vị trí · Kiểm tra mạng / Thử lại |
| 3 | GPS tắt | “Vị trí đang tắt. Hãy bật Vị trí để tiếp tục nhận đơn.” | Mở cài đặt vị trí · Thử lại |
| 4 | Thiếu quyền thông báo | nêu riêng | Mở cài đặt thông báo · Thử lại |
| 5 | **Hệ điều hành** báo không có Internet (mạng được xác thực) | “Điện thoại đang mất kết nối Internet.” | Kiểm tra mạng / Thử lại |
| 6 | Máy chủ lỗi/timeout/TLS (health monitor) mà điện thoại không báo mất Internet | “Chưa kết nối được máy chủ. Vui lòng thử lại.” — **không** nói Wi-Fi/dữ liệu đã tắt | Thử lại |
| 7 | Gửi vị trí lỗi / không lấy được tọa độ sau timeout | “Chưa gửi được vị trí.” / “Chưa lấy được vị trí.” | Thử lại |
| 8 | Máy chủ báo tạm dừng (vị trí quá 120 s) và không còn đang dò | “Tạm dừng nhận đơn — chưa có vị trí mới.” | Thử lại |

Đang lấy tọa độ lần đầu: không báo đỏ, chỉ nhãn “Đang lấy vị trí”. Offline chủ động không còn đơn: **không có cảnh báo** (và vẫn dùng banner kết nối thường); bấm Bật online mới kiểm tra và báo lỗi theo nguyên nhân. Phần giải thích gấp/mở bằng “Chi tiết”; cảnh báo không thể ẩn khi nguyên nhân còn. Cảnh báo tự biến mất khi điện thoại báo ổn lại; ý định online giữ nguyên, không tự bật khi shipper đã tắt. Có đơn: ghi “Đơn đang giao không bị hủy”.

Gộp: trên Trang chủ, cảnh báo thay `ConnectionBanner` của shell (tab Home khai `ownsConnectionBanner`, dùng `HealthScope`), dòng `gpsStatus` và `ShipLocationProblemNote`. Màn giao hàng giữ dòng trạng thái nhẹ cũ.

**Nguồn mạng của hệ điều hành**: `M14Plugin.snapshot()` thêm `networkAvailable` (`NET_CAPABILITY_VALIDATED`). `ShipLocationReporter.internetAvailable` (null = không biết, không kết luận). Khi đang chia sẻ, GPS tắt/mất quyền giờ đặt `problem` ngay (trước đây chỉ khi bấm bật) và tự xóa khi điện thoại báo ổn; Home đọc lại trạng thái cục bộ mỗi 15 s (chỉ khi muốn chia sẻ) và khi app quay lại foreground.

## Nhãn vị trí và giải thích (`buildLocationView`)

Nhãn nhỏ luôn thấy trên bản đồ Home: `Đang chia sẻ vị trí` (chỉ khi máy chủ ACK ≤100 s) · `Đang lấy vị trí` · `Chưa gửi được vị trí mới` · `Vị trí lần cuối HH:mm` (quá 100 s: không vẽ dấu shipper như trực tiếp) · `Đã dừng chia sẻ vị trí` (offline, hết đơn). Chạm (i) mở thẻ trung tính ngay dưới bản đồ: tần suất ~1 phút/lần kể cả khi khóa màn hình; có đơn thì người có quyền theo dõi đơn có thể xem; tắt nhận đơn mà còn đơn: “Bạn đã tắt nhận đơn mới nhưng vẫn chia sẻ vị trí cho đơn đang xử lý.”; GPS của máy ≠ vị trí đã lên máy chủ; nút “Về vị trí hiện tại” chỉ dời bản đồ. Dòng dữ kiện chỉ hiện khi có dữ liệu thật: `Máy chủ nhận vị trí lần cuối: HH:mm` (`uploadedAt`, giờ ACK trên máy), `Độ chính xác ước tính: ~N m` (snapshot hợp lệ), `Vị trí trên điện thoại — chưa gửi lên máy chủ` (fix mới hơn ACK >20 s). Pin picker (`AddressLocationPicker`): “Điểm giao đã chọn là vị trí cố định; di chuyển của bạn không tự đổi điểm này.”

## Chưa làm / chưa chứng minh

- Chưa thử trên máy thật Android 12–14, chưa thử với VPS; ảnh trong CI là widget render từ trạng thái giả lập (bản đồ trong test là khung “chưa bật gói bản đồ”, không phải M14 thật). Kotlin `networkAvailable` chỉ được CI biên dịch (`m14-android-runtime`), chưa chạy trên máy.
- `networkAvailable=false` khi mạng kết nối nhưng hệ điều hành chưa xác thực (captive portal) cũng bị coi là “mất Internet”: theo tín hiệu của hệ điều hành, cần xem trên máy thật.
- Nhãn dùng đồng hồ máy (ACK `uploadedAt` là giờ máy lúc nhận ACK); máy sai giờ sẽ hiện giờ sai nhưng không đổi quyền nhận đơn (máy chủ quyết định).
- Banner “đang theo dõi bản đồ giao hàng” (màn bản đồ của đơn) chưa thêm nhãn riêng; vẫn dùng `ShipLocationStatusLine`.
