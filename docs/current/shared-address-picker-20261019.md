# Chọn địa chỉ dùng chung — Owner chốt 19/10/2026

Áp dụng cho hồ sơ quán (tạo mới và sửa), sổ địa chỉ khách hàng và địa chỉ giao khi đặt đơn.

- Bên ngoài chỉ hiện dòng địa chỉ; bấm vào để chọn/sửa. Bỏ phần GPS, tọa độ, độ chính xác và bộ chọn khu vực khỏi hồ sơ quán.
- Màn chọn có ô nhập địa chỉ và bản đồ Cao Bằng hiện có. Chạm bản đồ để đặt/chuyển ghim; nút Vị trí hiện tại nằm trong bản đồ và chỉ lấy một lần khi bấm.
- Lưu trả về địa chỉ chữ và điểm đã chọn cùng nhau. Quay lại không áp dụng chỉnh sửa. Lỗi/quyền GPS không làm mất ghim cũ; vẫn chọn trên bản đồ được.
- Hồ sơ quán vẫn cho lưu nháp trước khi có ghim. Điều kiện hoàn tất, kiểm tra khu vực trên server, idempotency và version được giữ.
- Địa chỉ cũ không có ghim và đặt đơn bằng địa chỉ chữ vẫn theo contract hiện có (phí chưa xác định). Không tạo tọa độ giả từ địa chỉ chữ. Thêm/sửa trong sổ địa chỉ dùng điểm được chọn trong màn chọn.

## Cấu hình khu vực hiện tại

API hiện có chỉ trả ID/tên khu vực ACTIVE, chưa có hình học để suy ra khu vực từ tọa độ. App giữ ID hợp lệ hiện có; nếu chỉ có một khu vực ACTIVE thì tự dùng khu vực đó. Không chọn đại khi có nhiều khu vực và không nới kiểm tra server. Đây là bỏ thao tác chọn khu vực ở UI, không phải triển khai geocoding hay geofence mới.

Không migration, không deploy VPS trong thay đổi này. Các bản APK vẫn giữ applicationId, khóa ký và versionCode tăng theo pipeline hiện có.

## Owner điều chỉnh sau khi thử APK — 19/10/2026, 23:58

- Ô nhập địa chỉ nền trắng, có viền và khoảng đệm rõ.
- Hồ sơ quán bỏ nút Lưu nháp. Chỉ còn Hoàn tất hồ sơ: app lưu thông tin, đọc lại version trên server, rồi hoàn tất. Không chuyển màn thành công nếu chưa xác nhận hồ sơ ACTIVE.
- Các bản nháp cũ trên server vẫn tiếp tục được. Mỗi bước giữ Idempotency-Key riêng; lỗi đọc lại hoặc kết quả chưa xác định giữ nội dung và ghim, không tự kích hoạt.
- Ảnh lỗi lưu chỉ có thông báo chung; chưa có log VPS để kết luận nguyên nhân production. Bổ sung endpoint/HTTP/code/request_id an toàn khi có lỗi để đối chiếu; không ghi thông tin cá nhân hay token.
