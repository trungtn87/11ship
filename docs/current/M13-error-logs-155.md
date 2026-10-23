# M13 — Nhật ký lỗi dễ đọc, bổ sung PR #158

Owner duyệt 21/10/2026. Chỉ SYSTEM được đọc API và menu, ADMIN không được cấp quyền này.

- Bảng chính: giờ Việt Nam, ứng dụng, nội dung tiếng Việt, mức độ, số lần lặp. Mặc định 24 giờ gần nhất, lọc khoảng thời gian/ứng dụng/mức độ/mã tra cứu; “Lọc thêm” chứa phân hệ, HTTP và mã lỗi.
- Gộp sau khi lọc theo ứng dụng, phân hệ, method, route mẫu, mã lỗi, HTTP, mức độ, loại lỗi. Giữ mã tra cứu từng lần; tìm mã cụ thể trả đúng lần đó. Lỗi cũ chưa có route vẫn tra được nhưng không suy đoán API.
- Chi tiết: thao tác/kết quả/nguyên nhân theo bảng mã cố định; mã lạ hoặc INTERNAL_ERROR ghi “Chưa xác định nguyên nhân”. Thông tin kỹ thuật thu gọn: mã lỗi, HTTP, phân hệ, route mẫu, loại lỗi, UTC. Các lần xảy ra có phân trang và sao chép mã.
- Tự cập nhật 30 giây khi trang mở, có checkbox tắt; tạm dừng khi đang đọc chi tiết. Bộ chọn thời gian dùng giờ thiết bị và ghi rõ; thời gian log luôn Asia/Ho_Chi_Minh, UTC chỉ trong phần kỹ thuật.
- Mobile: thông báo lỗi chung của tài khoản, ví, đơn hàng/giao hàng trên 11Food/11Ship mang UUID tra cứu đã kiểm tra định dạng. Giữ nguyên phân loại kết quả chưa rõ và khóa chống gửi trùng; không đưa message/stack từ server ra UI.
- Route lấy từ route.path đã đăng ký trong server, không lấy URL thật/query/body. Không lưu SQL/password/token/OTP/số tài khoản/ảnh/địa chỉ khách.

Lưu trữ: mặc định 7 ngày, tối đa 1200 bản ghi trong bộ nhớ và file 1 MiB; cấu hình máy chủ qua M13_ERROR_LOG_RETENTION_DAYS (1–30), M13_ERROR_LOG_MAX_ENTRIES (1–10000), M13_ERROR_LOG_MAX_BYTES (1024–4194304). Bộ nhớ và file đều có giới hạn; khi chạm giới hạn có thể mất log sớm hơn số ngày lưu. File nén lại khi khởi động, hết dung lượng hoặc có log mới sau khi bản cũ hết hạn; không phải hệ thống xóa dữ liệu đúng từng giây. File lỗi thì tiếp tục trong RAM, giao diện báo rõ. Không phục hồi lỗi xảy ra trước khi tính năng được chạy.

Triển khai: dùng cấu hình StateDirectory và M13_ERROR_LOG_PATH trong unit của PR. Cập nhật mã nguồn đơn thuần khi unit VPS chưa được cập nhật sẽ chỉ lưu RAM. Merge/build không chứng minh VPS đã cập nhật unit hoặc Owner đã thử thật. Không migration, không sửa số dư; deploy VPS cần quyền triển khai riêng.
