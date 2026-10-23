# M13 — SMS Gateway: giám sát và cập nhật

## Điện thoại báo gì
Mỗi nhịp (60 giây) máy gửi: phiên bản (`app_version`, `app_version_code`), pin %, đang sạc hay không, trạng thái SIM (`READY|ABSENT|LOCKED|UNKNOWN`, đọc qua `TelephonyManager`, không cần thêm quyền), số kết quả SMS chưa báo (`pending_reports`), việc đang làm (`IDLE|SENDING|REPORTING`) và mã lỗi gần nhất. Giá trị máy không cung cấp thì bỏ trống, không đoán. **Số dư SIM không đọc và không báo** (Admin Web ghi "Chưa xác định"; ghi chú nạp tiền do SYSTEM nhập tay).

## Cảnh báo
Mất nhịp, pin thấp khi không sạc, SIM vắng/khóa, hàng đợi OTP kẹt, kết quả chưa báo kéo dài → sự cố trong Admin Web › Sự cố và tin Discord (nếu đã cấu hình). Hàng đợi hiển thị nhãn "Đăng ký / Quên mật khẩu".

## Cập nhật Gateway
1. SYSTEM đăng ký bản phát hành `GATEWAY` (tệp APK trong `OPS_ARTIFACT_DIR`) và Phát hành.
2. Điều kiện **máy chủ** coi là sẵn sàng: telemetry mới, không còn kết quả chưa báo, `current_task=IDLE`, `paused=true`, không job đang CLAIMED.
3. Trên điện thoại: tắt gateway → bấm **Kiểm tra bản cập nhật** → nếu "Có bản mới" bấm **Tải và cài**. Ứng dụng tải bằng thông tin xác thực thiết bị, kiểm tra kích thước và SHA-256 khớp thông báo của máy chủ (sai thì xóa tệp, không cài), rồi mở trình cài đặt Android để người dùng xác nhận. Lần đầu Android yêu cầu cho phép "cài ứng dụng không rõ nguồn" cho 11Ship SMS Gateway.
4. Giữ nguyên applicationId (`vn.eleven.gateway.test`) và khóa ký; versionCode tăng theo lượt CI.
Khi đang chạy gateway chỉ hiện gợi ý "VPS có bản mới"; không cập nhật khi còn việc hoặc kết quả chưa báo.
