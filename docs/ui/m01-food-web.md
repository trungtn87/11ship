# 11Food — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview`.
Ảnh duyệt không có trong repo; đối chiếu theo mã màn trong `docs/design/system-v2-20261011/03-ui-catalog.md` (PR #48).

| Mã | Màn | Route | Bản thật hiện tại | Nối API |
|---|---|---|---|---|
| F00 | Chào mừng | `/welcome` | có | — |
| F10 | Đăng nhập | `/login` | nối ở local: `POST /v1/client-auth/login`, sai mật khẩu là lỗi đăng nhập (không phải hết phiên) | nối (local) |
| F11 | Đăng ký | `/register` | có; hai nội dung chấp thuận thử hiển thị đủ, checkbox mặc định bỏ chọn. Chạy thật **chỉ** trên https://localhost (front local); nơi khác nút vẫn khóa kèm lý do | M01.07: `GET /v1/client-auth/config`; REQUIRED: `POST /v1/auth/phone-verifications`; DISABLED_TEST (chỉ local): nút "Đăng ký" + ghi chú "Bản test: tạm không xác minh số điện thoại", gửi thẳng `POST /v1/client-auth/register` không token rồi vào F01. Không nhận được cấu hình hợp lệ thì khóa nút (không đoán) |
| F12 | OTP đăng ký | `/register/otp` | chỉ vào được qua luồng đăng ký; hạn mã, "Gửi lại mã", lỗi theo máy chủ; xác minh xong tự tạo tài khoản và vào F01 đã đăng nhập (phiên chỉ trong bộ nhớ, F5 là khách) | M01.07: `…/{id}/verify`, `POST /v1/client-auth/register`. **Không mở ở DISABLED_TEST** (không OTP, không đếm ngược, không gửi lại) |
| F13 | Quên mật khẩu (bản test không OTP) | `/reset` | **một form** SĐT + mật khẩu mới + nhập lại, ghi chú “Bản test: đặt lại mật khẩu chưa yêu cầu OTP”; khóa nút tới khi `GET /v1/account-recovery/config` trả `DISABLED_TEST`; xong hiện “Yêu cầu đã xử lý…” + nút Đăng nhập (không tự đăng nhập) | đã nối bản test, chờ Owner nghiệm thu |
| F14–F15 | OTP / đặt lại mật khẩu (bản có OTP) | `/reset/otp`, `/reset/password` | không mở ở bản test; giữ nguyên cho dịch vụ OTP thật | chờ M01.16 |
| F01 | Trang chủ | `/` | có, trạng thái trống, "Sắp có" | — (không có dữ liệu quán); sau đăng ký (REQUIRED hoặc DISABLED_TEST) hiển thị đã đăng nhập bằng danh tính do máy chủ trả |
| F02 | Tìm kiếm | `/search` | có; gõ/xóa được, giữ chữ khi đổi tab/Back, chọn Món/Quán; không có kết quả giả | — (chờ M09) |
| F03 | Đơn hàng | `/orders` | có, trạng thái trống | — |
| F04/F16 | Tài khoản (khách / đã đăng nhập) | `/account` | bản khách có dòng "Quản lý cửa hàng" khóa kèm lý do (F07); sau đăng ký/đăng nhập ở local thì hiện tên/SĐT che từ máy chủ (`GET /v1/client-auth/me`), dòng "Đăng xuất" gọi `POST /v1/client-auth/logout` | nối (local) |
| F17 | Thông tin cá nhân | `/account/profile` | cần đăng nhập → về `/login`; đã đăng nhập đọc `GET /v1/customer/me/profile`, lưu `PUT` với `expected_version`, `VERSION_CONFLICT` tải bản hiện tại và không ghi đè | nối (local) |
| F18 | Hộp đăng xuất | trong F16 | xác nhận rồi gọi logout; offline thì xóa phiên local và không nói máy chủ đã thu hồi | nối (local) |
| F20 | Bán hàng trên 11Food | `/shop/start` | cần đăng nhập; đọc hồ sơ từ máy chủ: chưa có → "Đăng ký cửa hàng", nháp → "Tiếp tục hồ sơ", đã có → "Mở Cửa hàng của tôi" | nối (local): `GET /v1/onboarding/shop/profile` |
| F21 | Hồ sơ cửa hàng | `/shop/onboarding` | cần đăng nhập; lưu nháp (không cần vị trí), tiếp tục nháp, chọn khu vực **từ danh sách máy chủ** (không gõ tay), Hoàn tất chỉ mở khi đã lưu đủ thông tin + vị trí + khu vực (lý do hiện ngay cạnh nút); hồ sơ ACTIVE/DISABLED chỉ đọc; dữ liệu đang gõ giữ khi sang F22 và quay lại, thoát thật có hỏi "Bỏ thay đổi?" | nối (local): `GET/PUT /v1/onboarding/shop/profile`, `GET /v1/onboarding/shop/service-areas`, `POST /v1/onboarding/shop/complete`; hoàn tất xong gọi `GET /v1/client-auth/me` |
| F22 | Vị trí lấy hàng | `/shop/location` | cần đăng nhập; chỉ lấy vị trí khi bấm "Lấy vị trí hiện tại" (geolocation thật của trình duyệt, https local), hiện tọa độ/độ chính xác/thời điểm đo, "Dùng vị trí này" mới đưa vào hồ sơ; từ chối/hết giờ/không có thì không có vị trí; bản đồ chưa nối (không vẽ bản đồ giả) | nối (local): vị trí gửi cùng `PUT /v1/onboarding/shop/profile` |
| F23 | Cửa hàng của tôi | `/shop/home` | cần đăng nhập; trạng thái thật từ máy chủ (hoàn tất / bị khóa / chưa nhận đơn), mục Menu/Đơn/Doanh thu "Sắp có"; vào quản lý chọn context SHOP_OWNER, "Về giao diện khách hàng" chọn lại CUSTOMER (vẫn giữ quyền khách) | nối (local): `GET /v1/onboarding/shop/profile`, `POST /v1/client-auth/context` |

Không có: số dư, doanh thu, đơn hàng, trạng thái hoạt động giả. Dữ liệu minh họa nằm riêng ở
`apps/client-shared/src/design/samples.ts` và bị xoá khỏi bản thật (có test).

Còn chờ backend (xem `docs/design/system-v2-20261011/10-m01-client-contract.md`): đặt lại mật khẩu, hồ sơ shipper. Hình dạng cổng (`ports.ts`) chỉ là đề xuất cũ; phần nối thật dùng `apps/client-shared/src/auth` và `shop-flow.ts`.
Hồ sơ cửa hàng chỉ nối trên https://localhost của 11Food (11Ship không nối); GPS thật trên thiết bị chưa thử, bản đồ chưa nối.
Máy chủ tĩnh cần trả `index.html` cho mọi đường dẫn của app (SPA) — việc của bước triển khai.

Android (M01-ANDROID, `mobile/food`): F04 (khách/đã đăng nhập), F10, F11 (chỉ DISABLED_TEST, không OTP), F16, F17, F18 đã nối máy chủ thật bằng phiên có proof thiết bị; Home/Đơn hàng dùng lời nhắc đăng nhập dẫn tới F10. F07 và mọi mục khác vẫn khóa với lý do "Chưa nối trên Android". Chưa chạy trên điện thoại thật: xem `mobile/README.md`.
