# M10 — Checklist nghiệm thu của Owner (19/10/2026)

Mã nguồn: nhánh `claude/m10-order-delivery-hfy75r` (PR: xem báo cáo bàn giao). APK 11Food: artifact của workflow **Mobile APK** (cùng applicationId `vn.eleven.food.test`, cùng khóa ký cố định); số liệu run/SHA điền ở báo cáo bàn giao sau khi CI kết thúc.

## Điều kiện cần có

| Cần có | Ghi chú |
|---|---|
| Migration M10 đã áp dụng trên môi trường thử | Chưa chạy production |
| Bảng phí giao hàng M06 đã áp dụng + dịch vụ M14 (`M14_ROUTING_ORIGIN`) | Thiếu thì phí "Chưa xác định phí" |
| Quán ACTIVE có thực đơn, đang mở cửa; tài khoản khách; shipper ACTIVE đủ điều kiện nhận đơn và ví đủ (như M07) | |

## Luồng thử

1. **Giỏ**: khách thêm món ở màn quán → thanh giỏ; thêm cùng món cùng ghi chú gộp dòng, ghi chú khác tách dòng; thêm món quán khác → app hỏi trước khi thay giỏ; thoát app mở lại giỏ còn.
2. **Gửi đơn**: xác nhận đơn (tên, SĐT, địa chỉ từ sổ hoặc nhập tay; nhập tay có nút "Dùng vị trí hiện tại làm điểm giao" — từ chối quyền vị trí vẫn gửi được). Không ghim → phí "Chưa xác định phí" (không 0đ), vẫn gửi được. Quán đổi giá/ẩn món trước khi gửi → báo kiểm tra lại, không tạo đơn. Tắt mạng đúng lúc gửi → app nói chưa rõ kết quả và tra lại, không tạo đơn thứ hai.
3. **Quán xử lý**: tab Đơn → "Đơn món" → đơn "Chờ xác nhận": sửa số lượng/giá/bỏ dòng (phải có lý do khi xác nhận đơn đã sửa, không xác nhận đơn rỗng), xác nhận hoặc từ chối (lý do). Khách chỉ hủy được trước khi quán xác nhận.
4. **Chuẩn bị / gọi shipper**: "Món đã sẵn sàng" và "Gọi shipper" độc lập; gọi shipper được khi đang chuẩn bị. Đơn hẹn: chọn giờ nhận mong muốn (cả qua nửa đêm với quán mở khuya); quán nhận nhắc trước giờ hẹn.
5. **Giao**: chi tiết đơn của khách theo shipper hiện hành (nhận đơn / lấy hàng / giao); vị trí shipper mới nhất kèm thời điểm; shipper hủy nhận hoặc quán gọi lại → chi tiết theo delivery mới. Dừng tìm 30 phút không hủy đơn.
6. **Hủy đơn món** trước lấy hàng (quán/Admin): kết thúc delivery đang chạy, hoàn hoa hồng. Sau lấy hàng không còn nút hủy thường.
7. **Kết thúc**: hoàn thành đúng một lần; giao thất bại không tự hoàn thành/hủy; hàng ở shipper/chưa rõ → không gọi lại; hàng đã về + xác nhận → gọi lại được; hàng đã xử lý → đóng "Không hoàn tất" kèm lý do. Đơn kết thúc không còn vị trí trực tiếp.
8. **Lịch sử / đặt lại**: tab Lịch sử, lọc/tìm; "Đặt lại" tạo giỏ với giá hôm nay, món hết thì báo.
9. **Quyền riêng tư**: khách không thấy đơn của người khác; đặt hộ không cấp xem vị trí theo SĐT.
10. **Admin**: Vận hành › Đơn hàng: danh sách, chi tiết, hủy đơn món (cần quyền khóa) / đóng "Không hoàn tất" (cần quyền duyệt), lý do bắt buộc, có nhật ký.

## Chưa chạy / giới hạn

- Bản đồ và ghim điểm **trên bản đồ chưa có trong 11Food**: bị chặn bởi M14 (gói chỉ-bản-đồ, allowlist quyền, gói bản đồ ngoại tuyến — xem `M10-implementation-20261018.md` §5). Hiện có: nút "Dùng vị trí hiện tại làm điểm giao" (một lần, do khách bấm); không ghim thì phí "Chưa xác định phí". Vì vậy **M10 chưa hoàn tất**.
- Chưa thử trên thiết bị thật; chưa thử FCM đẩy thật cho thông báo đơn.
- Merge/CI không tự chứng minh nghiệm thu: Owner quyết định đóng module.
