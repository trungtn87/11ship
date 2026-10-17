# M14 — tích hợp Flutter 11Ship để triển khai sau

Owner 16/10/2026: “Test tạm ổn, tích hợp vào dự án 11ship để sau triển khai”. Tiếp tục cùng nhánh `codex/m14-gps-test`, PR [#119](https://github.com/trungtn87/11ship/pull/119). Đã cập nhật từ main `94f950f`; không merge vào main hoặc triển khai production trong gói này.

## Phần đã nối

- `mobile/packages/n11_m14`: Flutter MethodChannel/EventChannel/Android PlatformView dùng trực tiếp cùng nguồn Kotlin map/GPS/routing và gói Cao Bằng v1.3 của app test.
- Ship đã có dependency/plugin Android; `M14_OFFLINE_MAP=true` thay nguồn bản đồ trong khung `home-map` bằng bản đồ Cao Bằng offline. Input tương ứng trong Mobile APK là `m14_offline_map`. Mặc định false giữ bản đồ M01 đã duyệt; không thay luồng online/đơn hàng.
- GPS lõi chỉ giữ một snapshot vị trí mới nhất, bắt đầu sau đồng ý/thao tác rõ ràng, có thông báo/nút dừng và chu kỳ mục tiêu 60 giây. Không có start lúc boot/đăng nhập/mở bản đồ/đọc status. Không có upload vị trí tự động; kết nối vị trí với API shipper/online nghiệp vụ là phần triển khai M14 chính thức sau.
- HistoryStore/GPX/CleanupJob không được biên dịch vào Ship. History sink chuyển vào TestRecorderService và job nằm trong app GPS Test riêng; lịch sử test vẫn mặc định 24 giờ tại máy.
- API tuyến bắt buộc origin HTTPS, kiểm hai điểm/vùng phủ, chỉ tính khi caller gọi rõ ràng; lỗi giữ nguyên, không thay bằng đường thẳng. Tuyến được lưu AtomicFile cục bộ. Không có origin demo tự động hoặc lời hứa tính tuyến offline.
- Food không thêm plugin/quyền hoặc thay UI/nghiệp vụ. Ship giữ app ID/khóa ký/dãy versionCode hiện hữu, tối thiểu Android 8+.

API, mẫu gọi và giới hạn: [README package](../../mobile/packages/n11_m14/README.md). Không cần Owner tự chạy công cụ kỹ thuật để hoàn thành tích hợp; AI có thể bật cấu hình và xuất APK khi chuyển sang đợt triển khai.

## Bằng chứng đúng phạm vi

Mã native/Flutter được kiểm: `dcf598c2660e191f447216e74edec4fdde20cee2`. Thay đổi sau SHA này chỉ cập nhật bản giao/bằng chứng.

- [M14 Flutter integration — Android API 30](https://github.com/trungtn87/11ship/actions/runs/38851689692): **PASS**, native MapLibre PlatformView mở style cục bộ và gọi ready; tuyến thật qua HTTPS Render giữa hai đỉnh đường OSM, km nằm trong 1–3 và shape >2 điểm; đọc cache ra cùng km; khởi tạo/status/map/route không sinh vị trí GPS/ghi nền; không có DB `m14-history.db`; dispose view đạt. Không inject GPS.
- [M14 APK29](https://github.com/trungtn87/11ship/actions/runs/38851693786): **PASS**, release/lint, checksum map, 5 unit tests core, 3 gateway tests, tuyến Render và ký ổn định; metadata `downloads/m14/build-info.json`.
- [Mobile APK — Ship/Food](https://github.com/trungtn87/11ship/actions/runs/38851693748): **PASS**, gồm cả ca Android guest UI hiện hữu trên APK ký. Gồm analyze/test hiện hữu, 3 tests hợp đồng Flutter bridge, native Binder tests, release/signature/allowlist quyền và kiểm Ship có map assets/không có lớp history.
- Runtime app test APK19/21 giữ làm bằng chứng cho phần không đổi, liên kết tại `downloads/m14/DELIVERY.md`; không đổi nhãn bằng chứng đó thành runtime APK29 hoặc bản tích hợp Flutter.

Chưa nghiệm thu GPS vệ tinh, độ chính xác, chu kỳ khi khóa màn hình trên điện thoại thật cho bản tích hợp Flutter. Owner báo app test tạm ổn, chưa có biên bản ca thực địa để khẳng định từng mục; không đóng module/không coi CI là nghiệm thu thiết bị. Bản đồ/tuyến nhúng đã chạy trên Android giả lập, gồm native PlatformView và HTTP thực.

## Đích triển khai sau

Dịch vụ thử hiện có: `https://one1ship-m14-routing.onrender.com` (free), không thay đổi dịch vụ trong lần tích hợp này. Map/GPS/cache tại máy; tuyến mới cần mạng. UI nghiệp vụ sau này phải hiển thị lỗi “Cần mạng để tính tuyến mới” từ API và dùng cờ `fresh` cho mẫu GPS cũ.

VPS: bộ Docker/Compose/resource limits đã có tại [ops/m14](../../ops/m14/README.md), chưa chạy trên production. Khi chuyển cần xác định SSH host/port/tài khoản/cách xác thực, kiểm tài nguyên còn trống và hostname HTTPS routing; không tự nâng gói hoặc thay dịch vụ production. Đổi origin khi nối UI chính thức, không thay bằng API trả phí/demo.

## Bản build 11Ship tích hợp

APK ký ổn định **11Ship 0.1.0 (84)**, application ID `vn.eleven.ship.test`, source `dcf598c2660e191f447216e74edec4fdde20cee2`, SHA-256 `61cc21d3092acdf0f670ef0db44531b3ce664072b5f1b433e9bc32acdc5e9cf9`. [Tải artifact chứa 11Ship-test.apk](https://github.com/trungtn87/11ship/actions/runs/38851693748/artifacts/12025543591). Artifact GitHub cần tài khoản có quyền repo; giải nén và cài cập nhật, không gỡ app. Build này giữ cờ bản đồ mặc định false; không có điều khiển ghi lịch sử trong Ship. Khi triển khai khu vực Cao Bằng, build mới bật `m14_offline_map`; giữ cùng application ID/khóa ký và tăng versionCode.
