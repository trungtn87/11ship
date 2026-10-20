# M02 — Logo quán, chọn giờ và nhóm món

Owner duyệt ngày 20/10/2026. Bổ sung cho thiết kế M02 đã khóa; tiếp tục PR #143.

- Hồ sơ quán mới và quán đang hoạt động có logo **không bắt buộc**. Chọn ảnh từ điện thoại, kéo cắt vuông, thay hoặc gỡ; chỉ lưu cùng thao tác lưu/hoàn tất hồ sơ. Hủy chọn/cắt giữ nguyên ảnh trước đó. Hồ sơ bị khóa chỉ đọc.
- Trang chủ và kết quả tìm quán hiển thị logo cạnh tên. Quán chưa có logo hoặc tải ảnh lỗi dùng biểu tượng quán mặc định.
- Giờ mở/đóng dùng hai cột cuộn Giờ–Phút theo định dạng 24 giờ, không cần bàn phím. Xong xác nhận vào bản nháp; Hủy không thay đổi. Lịch từng ngày/cả tuần, qua đêm, 24 giờ, giờ đóng trong ngày 24:00, kiểm tra chồng lịch và bước Lưu lịch giữ nguyên.
- Nhóm món dùng dropdown và báo lỗi chưa chọn ngay dưới ô. Một nhóm còn lại vẫn hiển thị dropdown; giữ cách tự chọn nhóm duy nhất và liên kết nhóm ngừng hoạt động của món cũ.

## Lưu trữ và API

- `PUT /v1/onboarding/shop/profile` và `PUT /v1/shop/me/profile` nhận trường tùy chọn `logo: {content_type, data_base64}`. Bỏ qua trường giữ nguyên ảnh, `null` gỡ ảnh; không đổi fingerprint yêu cầu cũ khi trường vắng mặt.
- Logo cùng transaction/expected_version/idempotency của hồ sơ; không có endpoint ghi ảnh công khai. App cắt lại ảnh thành PNG vuông 384 px. Backend giới hạn 1 MiB và kiểm định dạng JPG/PNG/WebP, base64, chữ ký tệp.
- GET hồ sơ trả logo cho đúng chủ quán. Discovery trả URL có phiên bản để tránh ảnh cũ trong cache app. `GET /v1/shops/:shopId/logo` chỉ trả ảnh của quán ACTIVE, khu vực ACTIVE, chủ quán không bị khóa; không trả hồ sơ hay dữ liệu tài khoản.
- Migration `1795046400000_add-shop-logo` thêm cột nullable `app.shops.logo`. Quyền runtime trên bảng hiện có bao phủ cột mới. Down từ chối xóa cột khi đang có logo để tránh mất dữ liệu.
- Backend/migration phải được cập nhật trước khi thử lưu logo bằng APK mới. Việc gộp vào PR không phải xác nhận đã cập nhật VPS hoặc nghiệm thu thiết bị.
