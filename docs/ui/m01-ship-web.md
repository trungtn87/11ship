# 11Ship — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview`.
Đối chiếu theo mã màn trong `docs/design/system-v2-20261011/03-ui-catalog.md` (PR #48); ảnh duyệt không có trong repo.

| Mã | Màn | Route | Bản thật hiện tại | Nối API |
|---|---|---|---|---|
| S00 | Chào mừng | `/welcome` | có | — |
| S10 / S11 / S18 | Đăng nhập / Đăng ký / OTP | `/login` `/register` `/register/otp` | đăng nhập nối ở local (app `SHIP`, không cấp quyền nhận đơn); đăng ký dùng lại luồng #82 | nối (local) |
| S15 | Quên mật khẩu (bản test không OTP) | `/reset` | **một form** SĐT + mật khẩu mới + nhập lại, cùng luồng với F13; xong hiện “Yêu cầu đã xử lý…” + nút Đăng nhập | đã nối bản test, chờ Owner nghiệm thu |
| S16–S17 | OTP / đặt lại mật khẩu (bản có OTP) | `/reset/otp`, `/reset/password` | không mở ở bản test; giữ nguyên cho dịch vụ OTP thật | chờ M01.16 |
| S01 | Trang chủ (khách; chờ duyệt xem ở preview) | `/` | có; công tắc nhận đơn luôn khóa kèm lý do; banner theo trạng thái hồ sơ shipper do máy chủ báo | nối (local) |
| S02 | Đơn hàng | `/orders` | trạng thái trống | — |
| S03 | Thu nhập | `/income` | "—" (chưa biết ≠ 0), chọn ngày khóa | — |
| S04 | Ví | `/wallet` | "—", nạp/rút khóa | — |
| S05 / S14 | Tài khoản (khách / shipper) | `/account` | tài khoản đã đăng nhập hiện tên/SĐT từ máy chủ; hàng "Hồ sơ shipper" và nhãn trạng thái lấy từ máy chủ (NONE/PENDING/ACTIVE/SUSPENDED/CLOSING/CLOSED), không có role DRIVER giả. Thêm S05 `/account/profile` (xem/sửa tên, cùng form với Food) | nối (local) |
| S19 | Hộp đăng xuất | trong S14 | xác nhận rồi gọi logout như Food | nối (local) |
| S12 | Hồ sơ shipper | `/driver/onboarding` | cần đăng nhập; mở ra thì đọc `GET /v1/driver/me` trước: đã có hồ sơ → sang S13; chưa có → form họ tên (bắt buộc) + biển số (tùy chọn), gửi `POST /v1/onboarding/driver` một lần (mất kết nối giữ nguyên key/body cho "Thử lại"); giữ CUSTOMER, không chọn context | nối (local) |
| S13 | Trạng thái hồ sơ | `/driver/status` | cần đăng nhập; đọc `GET /v1/driver/me` mỗi lần mở (nút Tải lại); hiện đúng enum đã lưu, họ tên, biển số, loại shipper; không có nút sửa/lưu (backend chưa có API sửa) và không bịa lý do xét duyệt | nối (local) |

Quy tắc đã giữ: shipper đã đăng nhập hoặc chờ duyệt **không** tự đủ điều kiện Online; không có số dư, thu nhập, đơn, trạng thái hoạt động giả;
đăng ký xong dẫn tới S12; lý do/yêu cầu bổ sung từ xét duyệt chưa có hợp đồng nên không bịa. Nhãn "Shipper hệ thống" chỉ dùng cho loại PLATFORM, không phải admin.
S06 (chẩn đoán) thuộc M00, không làm lại ở đây. Dữ liệu minh họa nằm ở `apps/client-shared/src/design/samples.ts`, bị xoá khỏi bản thật (có test).

Android (M01-ANDROID, `mobile/ship`): S05, S10, S11, hồ sơ cá nhân và đăng xuất đã nối máy chủ thật bằng phiên có proof thiết bị (đăng ký luôn là CUSTOMER, không tự tạo hồ sơ shipper hay quyền nhận đơn). "Hồ sơ shipper", nhận đơn, ví vẫn khóa với lý do "Chưa nối trên Android". Chưa chạy trên điện thoại thật: xem `mobile/README.md`.
