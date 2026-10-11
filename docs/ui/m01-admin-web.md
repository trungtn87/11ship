# Web quản trị — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview` (mục "Web quản trị").
Chế độ xem thiết kế (`design.html`) luôn mang nhãn **"Dữ liệu minh họa"**, không tạo phiên, không cấp quyền, không gọi máy chủ (CSP `connect-src 'none'`),
và bị xoá khỏi bản thật (`npm run build:admin-web`; build thất bại nếu còn dấu vết; có test trong `tests/admin-web`).

## Màn đã làm (mã theo `docs/design/system-v2-20261011/03-ui-catalog.md`)

| Mã | Màn | Route | Bản thật | Nối API |
|---|---|---|---|---|
| D00 / D01 / D02 | Đăng nhập / TOTP / đăng ký Authenticator | `/` | đã nối sẵn từ trước, giữ nguyên luồng | đã có |
| D03 | Khung quản trị: sidebar 240/64 px, drawer ≤900 px, menu tài khoản | mọi trang sau đăng nhập | có | — |
| D04–D06 | Lời mời Admin: danh sách / tạo / chi tiết | `/invitations…` | giữ luồng cũ trong khung mới | đã có |
| D07 | Kích hoạt | `/activate` | giữ nguyên | đã có |
| D08 | Đặt lại mật khẩu ADMIN | `/reset` | giao diện; nút gửi khóa kèm lý do | chờ M01.16 / M01.19 |
| D09 | Khôi phục SYSTEM (chỉ thông tin) | chỉ preview | không có trang thật | chờ M01.20 |
| D81 | Người dùng — danh sách / đang khóa | `/accounts/users[?status=LOCKED]` | trạng thái "Chưa kết nối máy chủ" | chờ M01.30 / M01.31 |
| D86 | Chi tiết người dùng | `/accounts/users/:id` | như trên | chờ M01.30 |
| D87 / D88 | Hộp khóa / mở khóa | trong D86 | nút xác nhận khóa, không báo "đã khóa" | chờ M01.32 / M01.33 |
| — | Quản trị viên (SYSTEM) | `/accounts/administrators` | "Chưa kết nối" | **thiếu hợp đồng** |
| C01–C10 | Trạng thái chung: tải, trống, lỗi, mất mạng, hết phiên, không có quyền, giới hạn, xung đột phiên bản, kết quả chưa rõ | trong các trang | có | — |

Menu theo đặc tả (Tổng quan; TÀI KHOẢN; VẬN HÀNH; TÀI CHÍNH; HỆ THỐNG). Mục chưa làm hiện nhãn **"Sắp có"** và không điều hướng (không có trang trắng).
Quản trị viên và Lời mời Admin chỉ SYSTEM thấy; ADMIN chỉ thấy mục được cấp.

## Còn thiếu / cần Owner hoặc ChatGPT quyết

- Backend chưa gửi quyền (grants) của ADMIN cho trang → ADMIN thật hiện chỉ thấy "Tổng quan". Persona "ADMIN có quyền mẫu" chỉ có ở preview.
- Trang "Quản trị viên": chưa có mã màn, ảnh duyệt, hợp đồng API đọc danh sách.
- Logo gốc chưa có trong repo: đang dùng chữ "11" tạm; cần tệp logo gốc.
- Hồ sơ cá nhân trong menu tài khoản: "Sắp có". Đặt lại mật khẩu SYSTEM: khóa ("Máy chủ").
- Không có dữ liệu giả ở bản thật; không dùng localStorage cho dữ liệu nghiệp vụ (chỉ nhớ trạng thái thu gọn sidebar, khóa `11admin.sidebar`).

## Kiểm tra

`npm run typecheck`, `npm run lint`, `npm run admin-web:test` (menu/quyền/"Sắp có"/bản thật không chứa dữ liệu minh họa/preview chỉ đọc), `npm run client-shell:test`.
