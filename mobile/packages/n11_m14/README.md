# M14 tích hợp Flutter — 11Ship/11Food

Package Android dùng trực tiếp mã Kotlin `mobile/gps-test/{map,gps,routing}` và gói Cao Bằng đã kiểm tra. Không sao chép thuật toán, không phụ thuộc `history`, không chứa `HistoryStore`, GPX hoặc job dọn lịch sử. `TestRecorderService` và `CleanupJob` chỉ thuộc app GPS Test riêng.

11Ship đã khai báo dependency. Flutter tự đăng ký plugin; không sửa bridge tài khoản/Binder đang chạy. Android tối thiểu 8.0 (API 26), giữ application ID `vn.eleven.ship.test`, khóa ký và dãy versionCode của workflow Mobile APK.

**Tách bản đồ (M10, 19/10/2026).** Phần hiển thị bản đồ/chọn ghim (`M14OfflineMap`, PlatformView, `OfflineMap`, `MapPinsView`, gói Cao Bằng) nằm ở gói riêng `mobile/packages/n11_m14_map` (không GPS, không foreground service, không định tuyến, không quyền). `n11_m14` phụ thuộc vào gói đó và vẫn re-export `M14OfflineMap`, nên 11Ship không đổi cách dùng. 11Food chỉ phụ thuộc `n11_m14_map`: nó không có `RecorderService`, quyền `FOREGROUND_SERVICE*` hay client định tuyến (CI kiểm dex + danh sách quyền). Vị trí một lần của khách ở thanh toán là kênh `N11LocationChannel` riêng của 11Food, do khách bấm.

## Bật bản đồ khi triển khai khu vực Cao Bằng

Workflow **Mobile APK → Run workflow → m14_offline_map=true**, hoặc:

```sh
flutter build apk --release --dart-define=M14_OFFLINE_MAP=true
```

Cờ mặc định `false` giữ bản đồ/màn hình M01 đã duyệt. Khi bật, chỉ thay nguồn bản đồ ở đúng khung `home-map` bằng MapLibre + gói offline Cao Bằng; không bật online/nhận đơn, không xin vị trí, không tự tính tuyến. Bản đồ mở tại tâm khu vực, không hiển thị tâm này như GPS người dùng. Không thêm màn hình lịch sử vào Ship.

## API cho luồng M14 chính thức

```dart
import 'package:n11_m14/n11_m14.dart';
const client = M14Client();
final snapshot = await client.status(); // không lấy GPS
final cached = await client.savedRoute(); // không dùng mạng
```

Chỉ sau thao tác bắt đầu của shipper, UI giải thích: “Ứng dụng cập nhật vị trí theo chu kỳ mục tiêu 60 giây, kể cả khi khóa màn hình. Chỉ giữ vị trí mới nhất trên điện thoại. Bạn có thể dừng trong thông báo.” Nếu shipper đồng ý, gọi `client.start(consent: true)` khi activity đang hiển thị. Android hỏi vị trí chính xác khi dùng app và thông báo; từ chối trả `PlatformException` tiếng Việt. `client.stop()` hoặc nút Dừng ghi trong thông báo dừng thu thập. Không có start từ constructor, status, stream, bản đồ, đăng nhập, boot hoặc trạng thái online M01. Không upload vị trí từ plugin; luồng cập nhật vị trí server M14 sau này phải theo hợp đồng nghiệp vụ được duyệt.

`client.positions` phát snapshot có `lat`, `lon`, `accuracy`, `time`, `fresh`, `recording`, `gpsEnabled`, `permissionGranted`, `status`. Không coi snapshot `fresh=false` là GPS mới; không tự gọi tính tuyến theo stream. Khi process chết không tự tiếp tục ghi. Chu kỳ/thời gian bắt GPS giữ nguyên app test: lần đầu tối đa 120 giây, sau đó cửa sổ tối đa 25 giây/chu kỳ mục tiêu 60 giây.

`M14OfflineMap(pins: ..., route: ..., onPoint: ...)` dùng tọa độ `[latitude,longitude]`, nhận thay đổi widget và trả chạm/nhấn giữ với `insideCoverage`. Ghim gồm `lat`, `lon`, `label`, `color` ARGB. Hiện attribution bắt buộc. `client.mapPackage()` trả metadata đã kiểm SHA-256, vùng phủ và phiên bản. Luồng chọn điểm phải báo ngoài vùng khi `insideCoverage=false`.

Chỉ gọi `client.calculate(origin: ..., startLat: ..., startLon: ..., endLat: ..., endLon: ...)` khi đủ điểm và người dùng bấm Tính tuyến. `origin` bắt buộc HTTPS, do cấu hình môi trường truyền vào; không có fallback demo/đường thẳng. Trả km tuyến dự tính, endpoints và polyline `[lat,lon]`; cache cục bộ được ghi nguyên tử. Mất mạng báo “Cần mạng để tính tuyến mới”; `savedRoute()` vẫn đọc được. Việc tính không lấy GPS hoặc gửi lịch sử.

Render test hiện tại: `https://one1ship-m14-routing.onrender.com`. Chỉ dùng để thử; VPS tương lai thay origin, không đổi thuật toán/UI. Bộ triển khai và giới hạn tài nguyên: `ops/m14/README.md`; chưa triển khai VPS, không sửa dịch vụ production. Trước deploy cần xác định SSH host/port/tài khoản/cách xác thực, tài nguyên còn trống và hostname HTTPS dành cho routing.

## Kiểm chứng

- `flutter test` trong package: không tự start/tính tuyến khi đọc status/cache, từ chối start thiếu đồng ý, lỗi route không sinh khoảng cách thay thế.
- Mobile APK: analyze/test Flutter, build native, ký ổn định, allowlist quyền, kiểm dex không chứa package lịch sử và APK có gói offline.
- `M14 Flutter integration`: emulator Android 30 chạy PlatformView, kiểm gói dữ liệu, tính tuyến thật Render/cache và xác nhận không có GPS snapshot/ghi tự động hoặc DB lịch sử.
- Bằng chứng app GPS Test cũ vẫn áp dụng cho dữ liệu/thuật toán không đổi; sau khi tách sink, kiểm build lại app test. Không coi build hoặc emulator là kiểm GPS vệ tinh/chu kỳ khóa màn hình trên điện thoại thật. Owner báo “test tạm ổn”, chưa dùng câu đó để đóng module hoặc nghiệm thu production.
