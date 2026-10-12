# 11Ship — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview`.
Đối chiếu theo mã màn trong `docs/design/system-v2-20261011/03-ui-catalog.md` (PR #48); ảnh duyệt không có trong repo.

| Mã | Màn | Route | Bản thật hiện tại | Nối API |
|---|---|---|---|---|
| S00 | Chào mừng | `/welcome` | có | — |
| S10 / S11 / S18 | Đăng nhập / Đăng ký / OTP | `/login` `/register` `/register/otp` | đăng nhập nối ở local (app `SHIP`, không cấp quyền nhận đơn); đăng ký dùng lại luồng #82 | nối (local) |
| S15–S17 | Quên / OTP / đặt lại mật khẩu | `/reset…` | có, nút khóa kèm lý do | chờ M01.16 |
| S01 | Trang chủ (khách; chờ duyệt xem ở preview) | `/` | có; công tắc nhận đơn luôn khóa kèm lý do | — |
| S02 | Đơn hàng | `/orders` | trạng thái trống | — |
| S03 | Thu nhập | `/income` | "—" (chưa biết ≠ 0), chọn ngày khóa | — |
| S04 | Ví | `/wallet` | "—", nạp/rút khóa | — |
| S05 / S14 | Tài khoản (khách / xế) | `/account` | tài khoản đã đăng nhập hiện tên/SĐT từ máy chủ; hồ sơ xế chưa nối nên giữ khóa kèm lý do, không có role DRIVER giả. Thêm S05 `/account/profile` (xem/sửa tên, cùng form với Food) | nối (local) |
| S19 | Hộp đăng xuất | trong S14 | xác nhận rồi gọi logout như Food | nối (local) |
| S12 | Hồ sơ xế | `/driver/onboarding` | cần đăng nhập; nút Gửi hồ sơ khóa | chờ M01.10 |
| S13 | Trạng thái hồ sơ | `/driver/status` | cần đăng nhập | chờ M01.10/.05 |

Quy tắc đã giữ: xế đã đăng nhập hoặc chờ duyệt **không** tự đủ điều kiện Online; không có số dư, thu nhập, đơn, trạng thái hoạt động giả;
đăng ký xong dẫn tới S12; lý do/yêu cầu bổ sung từ xét duyệt chưa có hợp đồng nên không bịa. Nhãn "Xế hệ thống" chỉ dùng cho loại PLATFORM, không phải admin.
S06 (chẩn đoán) thuộc M00, không làm lại ở đây. Dữ liệu minh họa nằm ở `apps/client-shared/src/design/samples.ts`, bị xoá khỏi bản thật (có test).
