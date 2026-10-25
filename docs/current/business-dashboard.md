# 11Ship Business Dashboard

Mở `https://<cùng-origin-Web-Admin>/business/`, đăng nhập SYSTEM/ADMIN theo luồng Web Admin đang có. Phiên, TOTP, CSRF và quyền tài chính được dùng chung. Android: menu trình duyệt → Cài ứng dụng. iPhone: Safari → Chia sẻ → Thêm vào màn hình chính; bật thông báo từ PWA đã cài trên iOS hỗ trợ Web Push.

- Báo cáo M12, bộ lọc ngày/tháng, kỳ trước theo cùng khoảng thời gian đã trôi qua; làm mới khoảng 30 giây khi màn hình đang mở. Giao dịch = Order + lần gọi DIRECT đầu tiên; không cộng Delivery của Order hay gọi lại. Tiền hàng là giá trị giao dịch tạo trong kỳ, gồm cả đơn hủy; phí ship là tiền của các bên, nạp ví là ký quỹ, hoa hồng theo sổ cái. Tiền quán ghi riêng theo ngày xác nhận, không tự gộp vào doanh thu hoa hồng.
- Mỗi yêu cầu có chat và lịch sử hệ thống riêng. Chỉ người sở hữu và quản trị có `wallet.read` được xem/chat; hồ sơ kết thúc chỉ đọc. Giữ lịch sử tài chính, không tự xóa. Bản này chỉ gửi văn bản; chưa nhận ảnh chứng từ.
- Nạp shipper dùng nguyên API ghi sổ M04. Thanh toán quán xác nhận thủ công với `wallet.topup.record`, không tạo ví, thuê bao, quyền hay kích hoạt quán. Mã giao dịch ngân hàng dùng chung registry chống trùng với nạp/rút ví; idempotency và audit nằm trong cùng transaction.
- 11Ship: chi tiết nạp tiền → Trao đổi với quản trị; hoặc Tài khoản → Trao đổi nạp tiền. 11Food trong vai trò quán: Tài khoản → Thanh toán và trao đổi.
- Thông báo tài chính/chưa đọc luôn có trong PWA. Nhắc một lần sau 30 phút chờ. Web Push chỉ hiển thị “Có cập nhật mới cần kiểm tra”, mở đúng chat; từ chối quyền hoặc lỗi push không làm mất yêu cầu. Subscription bị ràng buộc phiên và kiểm lại tài khoản/TOTP/quyền trước khi gửi. Không lưu API response, tài chính, chat hoặc credential vào bộ nhớ offline.

## Cấu hình khi được phép phát hành

Chưa chạy trên VPS. Khi có ủy quyền merge/deploy/migration riêng, áp dụng migration `1796688000000_business-dashboard` và quyền mới trong `ops/selfhosted/02-runtime-grants.sql` và `03-runtime-function-grants.sql`, build backend và admin-web cùng SHA theo quy trình hiện hành. Không chạy down khi đã có dữ liệu tài chính (migration có chốt chặn).

Web Push tùy chọn, không cấu hình vẫn có danh sách chờ/thông báo:

- `BUSINESS_PUSH_PUBLIC_KEY`: khóa công khai VAPID P-256 dạng base64url.
- `BUSINESS_PUSH_PRIVATE_KEY`: khóa riêng tương ứng, chỉ ở server.
- `BUSINESS_PUSH_SUBJECT`: `mailto:` của người vận hành hoặc URL HTTPS liên hệ.

Tạo một cặp khóa bằng `node -e "console.log(require('web-push').generateVAPIDKeys())"` ở môi trường vận hành riêng; giữ khóa ổn định, không commit khóa. Khai báo cả ba biến hoặc để trống cả ba; cấu hình thiếu/sai sẽ từ chối khởi động. Cần HTTPS và outbound HTTPS đến FCM/Mozilla/Apple Web Push. Không dùng FCM Android credential làm VAPID.

Thiết bị chưa hỗ trợ/cấp quyền push vẫn sử dụng danh sách và chat online. Push có thể trùng khi mạng mất đúng lúc provider đã nhận; không bao giờ làm trùng thao tác tài chính. Chưa kiểm nghiệm thu trên điện thoại thật.
