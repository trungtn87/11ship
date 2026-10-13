# Web quản trị — giao diện M01 (UI trước)

Trạng thái: **chỉ UI**, chưa tính là xong nghiệp vụ, M01 chưa đóng. Xem thử: `Xem-Giao-Dien.cmd` hoặc `npm run ui:preview` (mục "Web quản trị").
Chế độ xem thiết kế (`design.html`) luôn mang nhãn **"Dữ liệu minh họa"**, không tạo phiên, không cấp quyền, không gọi máy chủ (CSP `connect-src 'none'`),
và bị xoá khỏi bản thật (`npm run build:admin-web`; build thất bại nếu còn dấu vết; có test trong `tests/admin-web`).

## Màn đã làm (mã theo `docs/design/system-v2-20261011/03-ui-catalog.md`)

| Mã | Màn | Route | Bản thật | Nối API |
|---|---|---|---|---|
| D00 / D01 / D02 | Đăng nhập / TOTP / đăng ký Authenticator | `/` | đã nối sẵn từ trước, giữ nguyên luồng | đã có |
| D03 | Khung quản trị: sidebar 240/64 px (thu gọn chỉ ở desktop), drawer ≤900 px luôn đầy đủ gồm mục con “Danh sách / Đang khóa”, menu tài khoản | mọi trang sau đăng nhập | có | — |
| D04–D06 | Lời mời Admin: danh sách / tạo / chi tiết | `/invitations…` | giữ luồng cũ trong khung mới | đã có |
| D07 | Kích hoạt | `/activate` | giữ nguyên | đã có |
| D08 | Đặt lại mật khẩu ADMIN | `/reset` | giao diện; nút gửi khóa kèm lý do | chờ M01.16 / M01.19 |
| D09 | Khôi phục SYSTEM (chỉ thông tin) | chỉ preview | không có trang thật | chờ M01.20 |
| D81 | Người dùng — danh sách / đang khóa | `/accounts/users[?status=LOCKED]` | **đã nối** `GET /v1/admin/users`: tìm kiếm, lọc vai trò/trạng thái, "Tải thêm" phía máy chủ; bộ lọc được giữ khi Back từ chi tiết | đọc xong; khóa chờ M01.32 |
| D86 | Chi tiết người dùng | `/accounts/users/:id` | **đã nối** `GET /v1/admin/users/:id` (hồ sơ trong phạm vi); không có dòng thời gian | khóa chờ M01.32 |
| D87 / D88 | Hộp khóa / mở khóa | trong D86 | nút khóa/mở khóa **không hoạt động** (`allowed_actions` luôn rỗng; chính sách D15 chưa chốt) | chờ D15, M01.32 / M01.33 |
| D89 | Quản trị viên (SYSTEM): danh sách, tìm kiếm, lọc trạng thái, trống/không khớp/tải/lỗi | `/accounts/administrators` | **đã nối** `GET /v1/admin/administrators` (chỉ SYSTEM): ADMIN đã kích hoạt, phạm vi quyền bằng chữ; không có lọc "Chờ kích hoạt" (lời mời đang chờ ở Lời mời Admin) | đọc xong |
| C01–C10 | Trạng thái chung: tải, trống, lỗi, mất mạng, hết phiên, không có quyền, giới hạn, xung đột phiên bản, kết quả chưa rõ | trong các trang | có | — |

Menu theo đặc tả (Tổng quan; TÀI KHOẢN; VẬN HÀNH; TÀI CHÍNH; HỆ THỐNG). Mục chưa làm hiện nhãn **"Sắp có"** và không điều hướng (không có trang trắng).
Quản trị viên và Lời mời Admin chỉ SYSTEM thấy; ADMIN chỉ thấy mục được cấp.

## Quyết định của Owner/ChatGPT (2026-10-11) và phần còn chờ

- **D89**: Owner đã chốt là màn Quản trị viên (SYSTEM-only); dòng D89 đã được thêm vào catalog trên nhánh thiết kế hiện hành `docs/three-app-system-design-20261011` (PR #48). Trước đó là mã đề xuất cho trang Quản trị viên (nhóm Tài khoản, SYSTEM-only). Mã chưa trùng mã nào trong catalog (D00–D09, D14, D15, D18, D20…D88). Catalog nằm ở PR #48, không nằm trong chuỗi PR này. Chưa có API: không có dữ liệu thật, không thao tác nghiệp vụ.
- **Quyền ADMIN**: sau đăng nhập/tải lại, shell đọc `GET /v1/admin-auth/permissions` và dựng menu từ `can_view` HIỆN TẠI: CUSTOMER→Người dùng; SHOP→Người dùng + Quán; DRIVER→Người dùng + Xế (Quán/Xế vẫn "Sắp có"). Quyền duyệt hồ sơ/khóa không mở mục nào. Trong lúc tải hoặc khi lỗi, ADMIN chỉ thấy "Tổng quan" và trang nghiệp vụ hiện trạng thái tải/lỗi (đóng khi lỗi); SYSTEM không cần đọc quyền. 401 ⇒ về đăng nhập; 403 ⇒ đọc lại quyền. Dữ liệu tài khoản đọc được chỉ nằm trong bộ nhớ trang và bị xóa khi mất phiên/rời shell; không lưu localStorage. Persona "ADMIN có quyền mẫu" chỉ có trong chế độ xem thiết kế (có test).
- **Logo gốc** (không chặn bàn giao): Owner đã nêu file `1000002796.jpg` làm nguồn logo hệ 11, nhưng phiên này không truy cập được file đó; giữ placeholder chữ "11" và dùng file ngay khi truy cập được (không vẽ lại wordmark). Trước đó chưa có file logo trong repo hay trong phiên (chỉ có 2 bảng mockup tổng hợp, không dùng cắt ảnh từ mockup vì sẽ mờ và là vẽ lại). Cần Owner cung cấp: `11ship-logo` (11Ship, chữ + biểu tượng "11" nghiêng, vàng/đen) và `11food-logo` (11Food + khẩu hiệu "Thèm là có"), định dạng SVG (ưu tiên) hoặc PNG nền trong suốt ≥ 1024 px chiều rộng; thêm slogan "Gọi là có" cho Ship nếu là một phần của logo. Chữ "11" tạm vẫn dùng đến khi có file; nơi thay: `apps/admin-web/public` (tên quản trị) và `apps/client-shared/src` (Food/Ship), giữ tỷ lệ.
- Hồ sơ cá nhân trong menu tài khoản: "Sắp có". Đặt lại mật khẩu SYSTEM: khóa ("Máy chủ").
- Không có dữ liệu giả ở bản thật; không dùng localStorage cho dữ liệu nghiệp vụ (chỉ nhớ trạng thái thu gọn sidebar, khóa `11admin.sidebar`).

## Kiểm tra

`npm run typecheck`, `npm run lint`, `npm run admin-web:test` (menu/quyền/"Sắp có"/bản thật không chứa dữ liệu minh họa/preview chỉ đọc), `npm run client-shell:test`.

Bằng chứng (ảnh chụp, bảng đối chiếu, phạm vi kiểm tra stub so với CI thật): `docs/evidence/M01-UI/README.md`.
