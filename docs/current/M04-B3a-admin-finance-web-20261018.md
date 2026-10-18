# M04-B3a — Web Admin Tài chính (nạp tiền thật) (2026-10-18)

## Phạm vi
Nối Web Admin với API tài chính đã merge (B2.2a/b): quyền tài chính của phiên, danh sách và chi tiết yêu cầu nạp, xác nhận số tiền thực nhận hoặc từ chối, tài khoản nhận tiền (SYSTEM), cấp/thu hồi từng quyền (SYSTEM). Không đụng ví/ledger B2.2b, không APK (B3b), không màn rút tiền/ví/giao dịch/đối soát/tổng quan (vẫn "chưa nối", không có dữ liệu giả).

## API đọc bổ sung (backend, read-only)
`GET /v1/admin/finance/topup-receiving-accounts` — SYSTEM hoặc ADMIN có `wallet.topup.record` (không đủ nếu chỉ có `wallet.read`). Chỉ trả `account_id, bank_id, account_number_masked (****+4 số cuối), can_receive`; không trả tên chủ tài khoản hay số đầy đủ. Quyền kiểm lại dưới khóa như mọi lệnh, không ghi gì. Admin chọn tài khoản đang bật khi xác nhận; không gọi route SYSTEM-only.

## Ma trận quyền (UI; server quyết định lại mọi lần)
| Phiên | Menu / route | Làm được |
|---|---|---|
| ADMIN không quyền | không có mục Tài chính; URL trực tiếp → "Không có quyền" | — |
| `wallet.read` | Nạp tiền (danh sách, chi tiết) | xem, không có form |
| `wallet.topup.record` không read | không menu; URL → "Cần quyền xem yêu cầu nạp tiền" | không hiển thị dữ liệu |
| read + record | Nạp tiền | xác nhận / từ chối |
| SYSTEM | + Tài khoản nhận tiền, nút "Quản lý" quyền tài chính ở trang Quản trị viên | tất cả |
Quyền lấy từ `GET access/me` khi mount (và đọc lại sau 403), độc lập với quyền ứng dụng (`can_view` Shipper không mở tài chính). 401 → đăng xuất; 403 → đọc lại quyền, nội dung nhạy cảm bị xóa.

## An toàn tiền ở trình duyệt
* Một click = một request (nút khóa, double-click kiểm bằng test), kết quả của trang đã rời bị bỏ.
* `Idempotency-Key` + body của một ý định tạo một lần trong closure; timeout / mất kết nối / 5xx / IDEMPOTENCY_BUSY / CSRF cũ ⇒ "Chưa xác định kết quả": chỉ còn "Kiểm tra trạng thái" (đọc) và "Gửi lại cùng lệnh" (cùng key, cùng body); trang không tự gửi lệnh khác. Test thật: cắt phản hồi sau khi server đã commit → gửi lại cùng lệnh → đúng 1 credit.
* Số thực nhận không điền sẵn theo số đề nghị; `.` chỉ nhận làm dấu nghìn (60.000, không 60000.5); mã giao dịch giữ nguyên hoa/thường và số 0 đầu (chỉ cắt hai đầu như server); thời điểm tiền về bắt buộc nhập, đổi sang ISO có múi giờ, không ở tương lai; tài khoản chỉ chọn trong danh sách đang bật; modal tổng hợp cảnh báo lệch số.
* Từ chối chỉ gửi `reason_code` thuộc allowlist, không có ghi chú tự do.
* Không lưu mã giao dịch/CSRF/số tài khoản ở storage hay URL; nháp bị xóa khi rời trang; DOM dựng bằng textContent.
* Ảnh chuyển khoản, ghi chú, mã tham chiếu, tên/SĐT Shipper: hiển thị "Chưa hỗ trợ"/không có (backend không trả); không có tổng số hay tìm kiếm toàn hệ thống; tab = đúng trạng thái server (một status/lần), phân trang cursor.

## Hạn chế còn lại
Quyền tiền là toàn hệ thống (không theo Shipper/khu vực/hạn mức/hai người duyệt) — xem B2.2b; cảnh báo hiển thị trong hộp thoại cấp quyền. Danh sách chỉ có `driver_id` (không có tên/SĐT). Tiền về muộn cho tài khoản đã tắt: bật lại → đối soát → tắt lại.
