# 11Ship GPS Test — M14

App Android độc lập `vn.eleven.ship.gpstest`, Android 8.0 trở lên, không dùng tài khoản, OTP, ví hoặc đơn hàng. Không thay đổi 11Food/11Ship. Giao diện native Kotlin dùng cùng nền tảng Android hiện có của dự án; chưa tích hợp giao diện này vào Flutter.

## Thử trên điện thoại

1. Cài `11Ship-GPS-Test.apk`. Cho phép cài từ nguồn tải nếu Android hỏi. Bản sau cùng khóa ký và application ID cài bằng **Cập nhật**, không gỡ app.
2. Bật chế độ máy bay, mở app: bản đồ Cao Bằng phải có đường, sông, tên địa danh; không cần tải gói nào. Mục **Gói bản đồ** cho biết phiên bản/vùng phủ.
3. Ra ngoài trời, bật Vị trí trên điện thoại, bấm **Bắt đầu ghi**. Cho phép **vị trí chính xác khi dùng app** và thông báo. Chỉ lúc này app bắt đầu xin mẫu GPS. Lần bắt tín hiệu đầu khi offline có thể cần tối đa hai phút; các lần sau thử lấy mẫu theo chu kỳ mục tiêu 60 giây. Không coi tọa độ cũ hoặc vị trí giả là một mẫu mới thành công.
4. Xem vĩ độ/kinh độ, sai số thiết bị báo và thời điểm. **Về vị trí của tôi** dùng mẫu mới trong hai phút gần nhất. Khóa màn hình ít nhất 5 phút rồi mở **Lịch sử → Tùy chọn → Xem thời điểm** để đối chiếu chu kỳ mục tiêu 60 giây. Lúc không có tín hiệu, không tạo điểm giả.
5. Chạm/nhấn giữ bản đồ để đặt A/Điểm đầu hoặc B/Điểm cuối. Bấm ô điểm để dùng vị trí hiện tại, ghi chú, xóa hoặc di chuyển ghim bằng lần chạm bản đồ tiếp theo. Có đổi chiều/xóa cả hai điểm.
6. Bật mạng, bấm **Tính tuyến**. Đường xanh dương và số km là tuyến đường dự tính từ Valhalla với `motorcycle`. Chỉ gửi hai điểm chọn cho server; lịch sử di chuyển không được gửi. Không tính lại theo GPS.
7. Tắt mạng, đóng/mở app: vẫn xem tuyến vừa lưu, bản đồ và lịch sử. Tính tuyến mới phải báo **Cần mạng để tính tuyến mới**. Trong Lịch sử có **Xem tuyến đã lưu** để trở về tuyến cũ sau khi đổi điểm.
8. **Dừng ghi** trong app hoặc thông báo. Đợi hơn một phút: không có điểm mới. Thử từ chối quyền, tắt GPS, chạm ngoài vùng phủ và chọn nơi không có đường: phải có thông báo phù hợp.
9. Trong Lịch sử: xuất GPX qua bộ chọn tệp Android, xóa toàn bộ lịch sử hoặc tắt hẳn lưu lịch sử. Đường xanh lá là lịch sử mẫu GPS, tách đoạn khi mất tín hiệu >180 giây, sai số >100 m hoặc bước nhảy không hợp lý. Số km lịch sử chỉ là tổng đoạn hợp lệ giữa các mẫu, có sai số và không thay thế số km tuyến dự tính.

Không có thiết bị thật gắn vào môi trường build. GPS vệ tinh, thời lượng pin, ghi khi khóa màn hình và chính sách tiết kiệm pin của từng hãng phải được xác nhận trên điện thoại thật. Không dùng vị trí giả để nghiệm thu GPS. Nếu Android/nhà sản xuất hủy tiến trình, app không tự khởi động lại ghi vị trí; mở app và bấm Bắt đầu lại. Foreground service không xin quyền vị trí nền hoặc quyền miễn tối ưu pin.

## Gói bản đồ

- GeoJSON cục bộ là nguồn dữ liệu native được MapLibre Android 11.8.0 hỗ trợ. Không phụ thuộc máy chủ tile, localhost hoặc cache đã mở từ trước.
- `app/src/main/assets/caobang`: dữ liệu, style, 256 khoảng glyph PBF Noto Sans và giấy phép; ghim A/B/GPS được vẽ cục bộ bằng Android Canvas, không có URL sprite ngoài.
- Snapshot `caobang-v1.2-2026-10-14`, 11.083 đối tượng OSM, vùng phủ `[106.0,22.43,106.52,22.91]` theo thứ tự tây/nam/đông/bắc. Tâm test `[106.257,22.665]`, bán kính phục vụ tạm 10 km và đệm ít nhất 10 km. Đây là phạm vi test, không sửa phạm vi nghiệp vụ production.
- Dữ liệu từ Geofabrik Vietnam, © OpenStreetMap contributors, ODbL 1.0. Toàn bộ cơ sở dữ liệu dẫn xuất `map.geojson` có trong APK và gói bản đồ riêng, có thể trích xuất/tái phân phối theo ODbL. Không tải hàng loạt tile công cộng.
- Kiểm tra SHA-256 toàn bộ tệp trước khi mở style. Nâng gói bằng APK mới. Gói không phải bản đồ toàn tỉnh hoặc toàn Việt Nam; không bảo đảm mọi hẻm/đường đã được cộng đồng OSM cập nhật.

## Module và tích hợp sau

| Module | Vai trò |
|---|---|
| `map` | Nạp/kiểm tra gói offline, vùng phủ và MapLibre style |
| `gps` | Foreground service chỉ khởi động từ thao tác người dùng; lần đầu cho GPS tối đa 120 giây để bắt tín hiệu offline; sau đó thử lấy mẫu tối đa 25 giây mỗi chu kỳ 60 giây; dừng listener giữa các chu kỳ |
| `history` | SQLite tại máy, giữ 24 giờ, chia đoạn và xuất GPX |
| `routing` | HTTPS client Valhalla, giải mã polyline6, cache tuyến bằng AtomicFile |
| `app` | Màn hình test, xin quyền, các tùy chọn test |

M14 chính thức phải đặt `RecorderService.preferences(context).edit().putBoolean("historyEnabled", false).apply()` **trước khi cho phép ghi**, không cung cấp điều khiển bật lịch sử, và xóa dữ liệu lịch sử test nếu dùng lại cùng sandbox. Khi tắt, GPS chỉ ghi đè snapshot vị trí mới nhất; không append lịch sử. App ID test riêng nên không chia sẻ sandbox với Food/Ship. Việc nối MethodChannel/PlatformView vào Flutter là công việc tích hợp sau; bản này không sửa luồng production.

Giữ lịch sử: xóa khi truy vấn/mở app/mỗi lần append; JobScheduler chạy dọn nền với chu kỳ tối thiểu Android 15 phút. Khi hệ điều hành trì hoãn job hoặc app bị force-stop, dữ liệu hết hạn được dọn ở lần chạy tiếp theo và không xuất hiện trong kết quả truy vấn/GPX. Không có tác vụ nền nào xin vị trí trước khi Bắt đầu.

Chỉ xin vị trí chính xác và thông báo. Các quyền thường: mạng, trạng thái mạng, foreground service/location, wake lock. AndroidX thêm quyền signature nội bộ `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` để bảo vệ receiver, không phải quyền truy cập dữ liệu người dùng. Quyền Wi-Fi thừa từ thư viện đã được loại khỏi manifest. Không xin quyền lưu trữ; xuất GPX qua Storage Access Framework.

## Build và ký

Workflow `.github/workflows/m14-gps-test.yml` chuẩn bị dữ liệu được phép phân phối, kiểm tra checksum, chạy tests/lint, build release và ký bằng bốn Secrets Android cố định hiện có. Không có fallback khóa tạm. `versionCode = github.run_number` của workflow riêng, không reset/xóa workflow để tạo lại dãy số. Build identity ghi trong `build-info.json` cùng SHA APK, SHA mã nguồn, fingerprint chứng thư và phiên bản map.

Build local: JDK 17, SDK 35/build-tools 35.0.0; tại thư mục này chạy `GPS_ROUTING_URL=https://one1ship-m14-routing.onrender.com ./gradlew :history:testDebugUnitTest :routing:testDebugUnitTest :app:assembleRelease :app:lintRelease`. `tools/sign-apk.sh` cần khóa ký có sẵn qua môi trường an toàn. Không phân phối bản debug ký bằng khóa mặc định.

## Trạng thái kiểm tra

Xem báo cáo bàn giao cuối và artifact CI của đúng phiên bản. Build/lint/unit tests không chứng minh GPS thật hoặc ghi khi khóa màn hình. Phép thử Render dùng hai đỉnh đường OSM cố định và kiểm tra điểm ngoài vùng bị từ chối; không dùng lịch sử cá nhân.
