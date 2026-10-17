# Bàn giao M14 — cập nhật tích hợp 16/10/2026

APK hiện tại: `downloads/m14/11Ship-GPS-Test.apk`, Android 8.0+, application ID `vn.eleven.ship.gpstest`, **versionCode 29**, cùng khóa ký cố định. Bản này tách history sink khỏi GPS lõi để tích hợp Flutter; dữ liệu/style/font/thuật toán tuyến giữ nguyên. Bằng chứng cài cập nhật 9 → 19 → 21 bên dưới thuộc các APK trước, không ghi thành nghiệm thu runtime APK29.

Mã nguồn APK29: `dcf598c2660e191f447216e74edec4fdde20cee2`. SHA-256 APK: `d30448efb636e906623882e956ecf25d03ea4c3c5fc332b0036b1916c53d955c`. Metadata chứng thư, URL dịch vụ và phiên bản map: `downloads/m14/build-info.json`. Build/lint/unit/signature/permission/checksum APK29 đạt: https://github.com/trungtn87/11ship/actions/runs/38851693786 .

Map `caobang-v1.3-2026-10-14`, snapshot OSM/Geofabrik 14/10/2026, 11.083 đối tượng, bounds `[106.0,22.43,106.52,22.91]`. Tất cả dữ liệu/style/font/ghim đi kèm APK; gói độc lập `downloads/m14/caobang-offline.tar.gz`. Giữ attribution ODbL và bản quyền/OFL của font. Nhãn địa danh/đường dùng Noto TTF cục bộ qua lớp Canvas dùng chung; nền bản đồ MapLibre dùng GeoJSON cục bộ. Không tải tile công cộng hàng loạt.

Valhalla thật: https://one1ship-m14-routing.onrender.com, gói Render free, region Singapore, source PBF Cao Bằng và buffer. Engine motorcycle tự host, chỉ tính tuyến mới khi có mạng. Free service có thể ngủ, yêu cầu đầu có thể chậm; app báo lỗi tiếng Việt để thử lại. Không dùng máy chủ demo hoặc API trả phí. Khoảng 55 MB RAM sau phép thử tuyến; bộ VPS có giới hạn 512 MB/0,5 CPU. VPS hiện chưa triển khai; xem `ops/m14/README.md` cho thông tin SSH/hostname còn cần khi chuyển sang VPS.

## Bằng chứng

- Build release, lint, 5 unit tests Android cho chia đoạn/giải mã tuyến, 3 tests gateway và kiểm tra checksum/quyền APK đạt: https://github.com/trungtn87/11ship/actions/runs/38802262205
- Android API 30, APK 19 đã ký, đủ ca recorder/history: https://github.com/trungtn87/11ship/actions/runs/38800819834
- Android API 30, APK 21: UI, sửa/đổi/xóa ghim, route cache và cập nhật: https://github.com/trungtn87/11ship/actions/runs/38802501477
- Kết quả máy đọc được: `docs/evidence/m14-gps-test/result.json` (đủ ca APK 19) và `docs/evidence/m14-gps-test/ui-update-result.json` (APK 21); ảnh bản đồ máy bay/tuyến cache và từ chối quyền cùng thư mục.

| Trường hợp | Đã kiểm tra |
|---|---|
| Bản đồ máy bay, nhãn tiếng Việt, hai ghim phân biệt | Android giả lập, ảnh và đếm pixel nội dung thật |
| Chọn hai điểm, tuyến thật qua Render | Android HTTPS client, khoảng 1,56 km trên đường OSM |
| Mất mạng/restart/cài cập nhật vẫn xem tuyến | Android giả lập, bản 9 → 19, cùng chứng thư |
| Từ chối quyền không bắt đầu ghi | Android giả lập, không có RecorderService |
| GPS tắt báo rõ | Android giả lập, không bật/inject GPS |
| Foreground sống qua khóa màn hình và dừng đúng | Android giả lập khi GPS **tắt**, service foreground còn sống; dừng và đợi 65 giây không khởi động lại, không sinh snapshot GPS |
| Lịch sử hết hạn/xóa toàn bộ | SQLite fixtures: điểm 25 giờ xóa, 1 giờ giữ; nút xóa đưa về 0 điểm. Đây không phải phép thử GPS |
| Ngắt đoạn do gap/jump/sai số lớn | Unit tests quy tắc thực tế |
| Ngoài dữ liệu | Gateway từ chối tọa độ ngoài vùng; UI chặn chọn điểm ngoài map |
| GPS vệ tinh thật, độ chính xác, chu kỳ khi khóa màn hình | **Chưa có điện thoại thật để nghiệm thu** |
| GPX trên trình quản lý tệp điện thoại / cập nhật thực địa OSM | Chức năng đã build, cần đối chiếu trên điện thoại thật |

Không có vị trí GPS giả được dùng để báo thành công. Không upload lịch sử. M14 chính thức không biên dịch module lịch sử: GPS lõi chỉ giữ snapshot mới nhất. App test dùng `TestRecorderService` riêng, vẫn cho tắt/xóa lịch sử và chỉ giữ snapshot mới nhất khi tắt. Hướng dẫn ngắn: `downloads/m14/TEST-NHANH.md`; hướng dẫn module/build/giới hạn: `mobile/gps-test/README.md`.

Mã nguồn mobile (gồm module dùng chung, app test, cầu nối Flutter và Ship/Food) cùng bộ Valhalla: `downloads/m14/m14-source.tar.gz`. Không thay luồng 11Food/11Ship, không merge main hoặc thay dịch vụ VPS production. PR nguồn: https://github.com/trungtn87/11ship/pull/119. Nghiệm thu GPS thực địa và đóng module thuộc Owner.


## Tích hợp tiếp theo — 16/10/2026

Owner báo test tạm ổn và yêu cầu tích hợp để triển khai sau. Mã tích hợp tiếp tục trên PR #119: `mobile/packages/n11_m14` nối Flutter Ship với cùng map/GPS/routing, GPS lõi không chứa lịch sử; lịch sử chuyển vào service riêng của app test. Xem README package để bật map Cao Bằng khi build và dùng API vị trí/tuyến. Mặc định không đổi giao diện M01/online/đơn hàng, không tự thu thập hoặc upload GPS. APK29 tại đây vẫn là app GPS Test độc lập; APK 11Ship do workflow Mobile APK build riêng. Gói nguồn đã cập nhật để chứa cả tích hợp Flutter. Bản tích hợp được chạy Android API 30 với bản đồ native, tuyến thật Render/cache và xác nhận không tự ghi GPS/không có DB lịch sử: https://github.com/trungtn87/11ship/actions/runs/38851689692 . Chi tiết phạm vi và các giới hạn: `docs/current/M14-integration-20261016.md`. Không deploy VPS/production hoặc tự merge main.
