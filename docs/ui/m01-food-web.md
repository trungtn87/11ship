# 11Food — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview`.
Ảnh duyệt không có trong repo; đối chiếu theo mã màn trong `docs/design/system-v2-20261011/03-ui-catalog.md` (PR #48).

| Mã | Màn | Route | Bản thật hiện tại | Nối API |
|---|---|---|---|---|
| F00 | Chào mừng | `/welcome` | có | — |
| F10 | Đăng nhập | `/login` | có, nút Đăng nhập khóa kèm lý do | chờ M01.04 |
| F11 | Đăng ký | `/register` | có, nút khóa kèm lý do | chờ M01.03 |
| F12 | OTP đăng ký | `/register/otp` | chỉ vào được qua luồng đăng ký | chờ M01.03 |
| F13–F15 | Quên / OTP / đặt lại mật khẩu | `/reset…` | có, nút khóa kèm lý do | chờ M01.16 |
| F01 | Trang chủ | `/` | có, trạng thái trống, "Sắp có" | — (không có dữ liệu quán) |
| F02 | Tìm kiếm | `/search` | có; gõ/xóa được, giữ chữ khi đổi tab/Back, chọn Món/Quán; không có kết quả giả | — (chờ M09) |
| F03 | Đơn hàng | `/orders` | có, trạng thái trống | — |
| F04/F16 | Tài khoản (khách / đã đăng nhập) | `/account` | chỉ bản khách, có dòng "Quản lý cửa hàng" khóa kèm lý do (F07); bản đã đăng nhập xem ở preview | chờ M01.04/.05 |
| F17 | Thông tin cá nhân | `/account/profile` | cần đăng nhập → về `/login` | chờ M01.05 |
| F18 | Hộp đăng xuất | trong F16 | preview | chờ M01.04 |
| F20 | Bán hàng trên 11Food | `/shop/start` | cần đăng nhập | chờ M01.11 |
| F21 | Hồ sơ cửa hàng | `/shop/onboarding` | cần đăng nhập; Lưu/Hoàn tất khóa | chờ M01.11/.12 |
| F22 | Vị trí lấy hàng | `/shop/location` | cần đăng nhập; không có bản đồ giả | chờ M01.12 |
| F23 | Cửa hàng của tôi | `/shop/home` | cần đăng nhập; mục nghiệp vụ "Sắp có" | chờ M01.12 |

Không có: số dư, doanh thu, đơn hàng, trạng thái hoạt động giả. Dữ liệu minh họa nằm riêng ở
`apps/client-shared/src/design/samples.ts` và bị xoá khỏi bản thật (có test).

Chưa có hợp đồng backend (xem `docs/design/system-v2-20261011/10-m01-client-contract.md`): client-auth (đăng ký/OTP/đăng nhập/đặt lại),
đọc/lưu hồ sơ khách, hồ sơ cửa hàng nháp/hoàn tất, xác nhận vị trí. Hình dạng cổng (`ports.ts`) chỉ là đề xuất.
Máy chủ tĩnh cần trả `index.html` cho mọi đường dẫn của app (SPA) — việc của bước triển khai.
