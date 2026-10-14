# 11Ship SMS Gateway — Android (giai đoạn 2, issue #102)

App Android riêng (package `vn.eleven.gateway.test`, không đổi để **cài đè** bản 0.1): máy cũ có SIM kết nối **ra** VPS qua HTTPS, nhận từng việc
gửi OTP và gửi SMS bằng SIM của máy. Backend là nơi duy nhất tạo OTP và soạn nội dung; hướng dẫn vận hành đầy đủ ở
[`ops/runbooks/sms-gateway.md`](../../ops/runbooks/sms-gateway.md).

## Cài đè bản cũ
GitHub Actions > SMS Gateway APK > chọn run > Artifacts > `11Ship-SMS-Gateway-test.apk` (ZIP, giải nén lấy APK). Cùng applicationId, cùng khóa ký ổn định
(secret của repo), `versionCode` = số run tăng dần, nên Android cài đè và giữ dữ liệu. Thiếu secret ký thì workflow dừng, không dùng khóa tạm.

## Dùng
1. Owner tạo mã ghép cặp trên server: `npm run sms-gateway:ctl -- pair --label "Android cu"` (mã 43 ký tự, chỉ hiện một lần).
2. Mở app: nhập địa chỉ VPS `https://...` và mã ghép cặp > **Ghép cặp** (app hỏi VPS trước, chỉ lưu khi VPS chấp nhận; mã được niêm bằng khóa Android Keystore).
3. **Cấp quyền SMS và thông báo**, **Cho phép chạy nền (tắt tối ưu pin)**, rồi **Bật gateway**. Nên cắm sạc; app chạy bằng dịch vụ nền có thông báo (không chứa mã).
4. Màn hình hiện: trạng thái VPS, quyền SIM/SMS, lần kết nối cuối, trạng thái ghép cặp, SMS hôm nay (đã gửi / lỗi), nút Bật/Tạm dừng, Hủy ghép cặp, và mục **Gửi thử thủ công** (tin cố định, không phải OTP) như bản 0.1.

## An toàn
* Chỉ chấp nhận số `+84` + 9 chữ số và đúng 2 mẫu tin OTP của 11Ship, bất kể server gửi gì.
* Mỗi việc được nhận **một lần**. Kết quả: SENT (radio nhận), FAILED (chưa gửi), UNKNOWN (không chắc). App ghi "đang gửi" xuống máy **trước** khi gọi SmsManager; nếu app chết giữa chừng, lần mở sau báo UNKNOWN và **không gửi lại**.
  `SmsManager` trả về không có nghĩa là đã gửi: kết quả lấy từ sent-intent.
* Không lưu, không log, không hiện OTP hay số đầy đủ; thông báo nền không chứa mã. TLS dùng mặc định hệ thống (không tắt kiểm tra chứng chỉ, không cleartext, không theo redirect).
* Chỉ xin quyền SEND_SMS (không READ/RECEIVE SMS, danh bạ, trạng thái điện thoại); CI kiểm tra bằng `aapt2 dump badging`.
* Không hứa Android luôn sống nền: tắt màn hình/đổi mạng/khởi động lại cần được thử trên máy thật (checklist trong runbook). Máy hai SIM dùng SIM SMS mặc định của Android.

## Build
CI tạo project Android bằng `bash mobile/gateway/tool/prepare.sh` (thêm quyền, dịch vụ nền, receiver, minSdk 24 và chép các file Kotlin trong `tool/`),
rồi `flutter pub get`, `flutter analyze`, `flutter test`, `flutter build apk`, ký bằng secret ổn định và kiểm tra package, versionCode, quyền.
