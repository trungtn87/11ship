# 11Food — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview`.
Ảnh duyệt không có trong repo; đối chiếu theo mã màn trong `docs/design/system-v2-20261011/03-ui-catalog.md` (PR #48).

| Mã | Màn | Route | Bản thật hiện tại | Nối API |
|---|---|---|---|---|
| F00 | Chào mừng | `/welcome` | có | — |
| F10 | Đăng nhập | `/login` | nối ở local: `POST /v1/client-auth/login`, sai mật khẩu là lỗi đăng nhập (không phải hết phiên) | nối (local) |
| F11 | Đăng ký | `/register` | có; hai nội dung chấp thuận thử hiển thị đủ, checkbox mặc định bỏ chọn. Chạy thật **chỉ** trên https://localhost (front local); nơi khác nút vẫn khóa kèm lý do | M01.07: `GET /v1/client-auth/config`; REQUIRED: `POST /v1/auth/phone-verifications`; DISABLED_TEST (chỉ local): nút "Đăng ký" + ghi chú "Bản test: tạm không xác minh số điện thoại", gửi thẳng `POST /v1/client-auth/register` không token rồi vào F01. Không nhận được cấu hình hợp lệ thì khóa nút (không đoán) |
| F12 | OTP đăng ký | `/register/otp` | chỉ vào được qua luồng đăng ký; hạn mã, "Gửi lại mã", lỗi theo máy chủ; xác minh xong tự tạo tài khoản và vào F01 đã đăng nhập (phiên chỉ trong bộ nhớ, F5 là khách) | M01.07: `…/{id}/verify`, `POST /v1/client-auth/register`. **Không mở ở DISABLED_TEST** (không OTP, không đếm ngược, không gửi lại) |
| F13–F15 | Quên / OTP / đặt lại mật khẩu | `/reset…` | có, nút khóa kèm lý do | chờ M01.16 |
| F01 | Trang chủ | `/` | có, trạng thái trống, "Sắp có" | — (không có dữ liệu quán); sau đăng ký (REQUIRED hoặc DISABLED_TEST) hiển thị đã đăng nhập bằng danh tính do máy chủ trả |
| F02 | Tìm kiếm | `/search` | có; gõ/xóa được, giữ chữ khi đổi tab/Back, chọn Món/Quán; không có kết quả giả | — (chờ M09) |
| F03 | Đơn hàng | `/orders` | có, trạng thái trống | — |
| F04/F16 | Tài khoản (khách / đã đăng nhập) | `/account` | bản khách có dòng "Quản lý cửa hàng" khóa kèm lý do (F07); sau đăng ký/đăng nhập ở local thì hiện tên/SĐT che từ máy chủ (`GET /v1/client-auth/me`), dòng "Đăng xuất" gọi `POST /v1/client-auth/logout` | nối (local) |
| F17 | Thông tin cá nhân | `/account/profile` | cần đăng nhập → về `/login`; đã đăng nhập đọc `GET /v1/customer/me/profile`, lưu `PUT` với `expected_version`, `VERSION_CONFLICT` tải bản hiện tại và không ghi đè | nối (local) |
| F18 | Hộp đăng xuất | trong F16 | xác nhận rồi gọi logout; offline thì xóa phiên local và không nói máy chủ đã thu hồi | nối (local) |
| F20 | Bán hàng trên 11Food | `/shop/start` | cần đăng nhập | chờ M01.11 |
| F21 | Hồ sơ cửa hàng | `/shop/onboarding` | cần đăng nhập; Lưu/Hoàn tất khóa | chờ M01.11/.12 |
| F22 | Vị trí lấy hàng | `/shop/location` | cần đăng nhập; không có bản đồ giả | chờ M01.12 |
| F23 | Cửa hàng của tôi | `/shop/home` | cần đăng nhập; mục nghiệp vụ "Sắp có" | chờ M01.12 |

Không có: số dư, doanh thu, đơn hàng, trạng thái hoạt động giả. Dữ liệu minh họa nằm riêng ở
`apps/client-shared/src/design/samples.ts` và bị xoá khỏi bản thật (có test).

Chưa có hợp đồng backend (xem `docs/design/system-v2-20261011/10-m01-client-contract.md`): client-auth (đăng ký/OTP/đăng nhập/đặt lại),
đọc/lưu hồ sơ khách, hồ sơ cửa hàng nháp/hoàn tất, xác nhận vị trí. Hình dạng cổng (`ports.ts`) chỉ là đề xuất.
Máy chủ tĩnh cần trả `index.html` cho mọi đường dẫn của app (SPA) — việc của bước triển khai.
