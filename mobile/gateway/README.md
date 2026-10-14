# 11Ship SMS Gateway — thử trên điện thoại Android

App Android riêng, không tác động hai app M01 hay VPS. Bản 0.1.0 chỉ gửi
**một tin SMS thử cố định theo yêu cầu và xác nhận thủ công của Owner**.

## Tải và cài
GitHub Actions > SMS Gateway APK > chọn run > Artifacts > 11Ship-SMS-Gateway-test.apk.
Tải ZIP, giải nén lấy APK, cài trên điện thoại Android có SIM.

## Test
1. Thử gửi 1 SMS bằng app Tin nhắn mặc định để biết SIM còn gửi được.
2. Nếu máy 2 SIM, đặt SIM gửi SMS mặc định.
3. Mở 11Ship SMS Gateway > Cấp quyền SMS.
4. Nhập số di động Việt Nam của một máy khác > Gửi một SMS thử > Xác nhận.
5. Kiểm tra máy nhận tin. Dòng báo "Đã chuyển lệnh" KHÔNG phải xác nhận máy nhận đã có SMS.
6. Thu hồi quyền SMS, thử lại: nút gửi phải bị khóa.

Không dùng n8n, không nhận yêu cầu từ Internet, không đọc SMS/danh bạ,
chưa tự gửi OTP. Tiếp theo mới xây pairing + queue VPS và giới hạn gửi,
xử lý gửi trùng, chống spam, đồng bộ trạng thái. Cần xác nhận nhà mạng cho
phép SIM gửi OTP tự động trước khi vận hành thật.

APK có applicationId cố định vn.eleven.gateway.test, ký bằng secret ổn định
đã dùng trong repo. VersionCode của GitHub Actions tăng qua mỗi build, để
cài bản mới đè lên bản cũ mà không phải xóa dữ liệu.

CI tạo Android project bằng bash mobile/gateway/tool/prepare.sh rồi chạy
flutter pub get, flutter analyze, flutter test, flutter build apk.

## Bản sửa nhận diện SMS
Một số Android trả về `FEATURE_TELEPHONY_MESSAGING = false` dù có SIM và gửi SMS bằng app Tin nhắn. Đây chỉ là thông tin chẩn đoán, **không được khóa cấp quyền hoặc nút gửi thử**. Quyền `SEND_SMS` và xác nhận bằng tay vẫn bắt buộc. Khi gửi thật, lỗi của Android/SIM được trả ra màn hình; không báo đã giao thành công nếu chưa kiểm máy nhận.
