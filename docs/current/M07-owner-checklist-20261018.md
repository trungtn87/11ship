# M07 — Checklist nghiệm thu của Owner (18/10/2026)

Mã nguồn: PR #133, nhánh `ccr-20044309-7dr277`. Bản APK (11Food / 11Ship), versionCode và SHA256: xem mục "APK" cuối tệp (điền sau khi workflow Mobile APK kết thúc).

## Trước khi thử — các điều kiện bắt buộc

| Cần có | Vì sao | Trạng thái |
|---|---|---|
| Bảng phí giao hàng đã áp dụng (M06, Admin → Phí giao hàng) | Không có bảng phí thì phí hiện "Chưa xác định phí" và không lấy hàng được | Phải làm trên môi trường thử |
| Một quán ACTIVE có toạ độ lấy hàng, đăng nhập 11Food bằng tài khoản chủ quán | Điểm lấy hàng = toạ độ quán | Có sẵn nếu M02 đã dùng |
| Một shipper ACTIVE, đã duyệt, **ngân hàng đã xác minh**, bật "Nhận đơn", đăng nhập 11Ship, mở màn hình đơn để app gửi vị trí | Điều kiện nhận đơn của M03/M06 | Cần làm |
| **Số dư ví shipper ≥ hoa hồng (1.000đ) + ngưỡng M06** | Nhận đơn giữ hoa hồng | Dùng đường nạp thật của M04-B2.2b: shipper tạo yêu cầu nạp (11Ship → Ví), Admin có quyền ghi nạp (`wallet.topup.record`) xác nhận theo sao kê và có tài khoản nhận đang bật. UI Admin tài chính (M04-B3) và rút tiền (M04-C) chưa có |
| Dịch vụ định tuyến M14 (`M14_ROUTING_ORIGIN`) | Tính phí/khoảng cách; không có thì phí "Chưa xác định" | Cần cấu hình |

## Luồng thử (quán gọi → shipper nhận → lấy hàng → kết quả)

1. **Quán gọi shipper**: 11Food → tab Đơn → "Gọi shipper". Nhập người nhận, SĐT, địa chỉ, ghim điểm giao (hoặc bỏ trống), hàng, tiền hàng/đã trả, ai trả phí. Kỳ vọng: trạng thái "Đang tìm shipper", đồng hồ 30 phút theo giờ máy chủ, phí hiện đúng hoặc "Chưa xác định phí" (không phải 0đ).
2. **Shipper xem đơn**: 11Ship → "Có thể nhận". Kỳ vọng: **không** có SĐT người nhận, địa chỉ chi tiết, bản đồ trước khi nhận.
3. **Nhận đơn**: bấm Nhận. Kỳ vọng: hiện SĐT/địa chỉ/điểm lấy; ví giữ 1.000đ; hai shipper bấm cùng lúc chỉ một người nhận được, người kia không bị giữ tiền.
4. **Đơn thiếu điểm giao/phí**: shipper ghim điểm giao và xác nhận phí đã thỏa thuận → mới bấm được "Đã nhận hàng". Điểm này không ghi vào sổ địa chỉ khách.
5. **Nhắc**: quán được nhắc phút 5 và 15 khi chưa có người nhận; hết phút 30 → "Dừng tìm", đơn Order không bị hủy; shipper đã nhận mà chưa lấy hàng được nhắc mỗi 5 phút. *Việc đẩy thông báo thật thuộc M08, chưa nối; hiện chỉ có sự kiện trong hệ thống/hàng đợi.*
6. **Hủy trước lấy hàng** (phải có lý do): quán "Hủy yêu cầu giao" → hoàn hoa hồng, Order không bị hủy; shipper "Hủy nhận đơn" → hoàn hoa hồng, quay về tìm nếu còn thời gian (không reset 30 phút), hết giờ thì "Dừng tìm".
7. **Đã nhận hàng**: một lệnh, vào thẳng "Đang giao". Sau bước này không còn nút hủy thường; phí/thông tin bị khóa.
8. **Thành công**: bấm Hoàn thành → thu hoa hồng đúng một lần, ví trừ 1.000đ.
9. **Thất bại**: chọn lý do + tình trạng hàng → hoàn hoa hồng, mở sự cố giữ hàng; quán không gọi lại được cho tới khi xác nhận hàng đã về (hoặc xử lý). Đơn không tự hoàn thành.
10. **Vị trí**: quán thấy vị trí mới nhất của shipper cùng thời điểm cập nhật và trạng thái mới/cũ/mất; sau khi hủy hoặc kết thúc thì không thấy nữa. Quán khác không xem được.
11. **Admin**: Vận hành → Giao hàng: danh sách, bộ đếm, chi tiết, xử lý giữ hàng, chỉnh phí/địa chỉ sau lấy hàng (bắt buộc lý do, có nhật ký), gỡ shipper khỏi đơn.

## Chưa chạy thật được (thiếu phụ thuộc hoặc chưa kiểm chứng)

- **Nạp ví**: đường nạp thật (yêu cầu của shipper + Admin xác nhận qua API) đã được kiểm thử tích hợp cùng M07, nhưng **chưa thử trên thiết bị và chưa có UI Admin tài chính (M04-B3)**; rút tiền (M04-C) chưa có.
- **Đơn từ M10 (Order)**, **thông báo M08**, **tranh chấp M11**: chưa nối; chỉ luồng gọi trực tiếp từ quán chạy thật.
- **Tính lại phí theo yêu cầu quán (reprice)**: chưa làm; gọi lại tạo giao mới và tính phí lại.
- **GPS/thiết bị thật**, **bản đồ trong 11Food** (không có bản đồ), **bản đồ Admin** (chỉ toạ độ), **ghép đơn ở quy mô lớn** (cần `/matrix` của M14): chưa kiểm chứng.
- **Kiểm thử cơ sở dữ liệu**: chạy cục bộ trên PostgreSQL 18.4 (không cài được 17 trong môi trường làm việc). 3 kiểm thử cũ khác biệt do hành vi PostgreSQL 18, không do M07; CI dùng PostgreSQL 17.11 là cổng chính thức.

## Quyết định cần Owner xác nhận

- Bán kính tìm shipper: tài liệu có chỗ ghi 3 km, chỗ 5 km; đang dùng **3 km** (khớp M06).
- Quán chuyển lời đồng ý của khách về điểm giao (shipper ghim điểm).
- Hoa hồng 1.000đ/đơn thành công (ADR-004), chốt tại thời điểm nhận đơn.

## APK

(điền sau khi workflow Mobile APK hoàn tất: applicationId giữ nguyên, ký bằng khóa cố định, versionCode tăng)
