# Điều khoản sử dụng và Chính sách quyền riêng tư — bản phát hành M01 (DỰ THẢO CHỜ OWNER DUYỆT)

Phiên bản gửi lên máy chủ khi đăng ký: `terms-20261014-v1` và `privacy-20261017-v1` (M03, 17/10/2026: chỉ đổi câu về hồ sơ Shipper để nêu đúng dữ liệu ngân hàng; điều khoản không đổi; bản cũ `privacy-20261014-v1` đã được thay). Văn bản này **giống từng chữ** hằng số `kTermsText` / `kPrivacyText` trong `mobile/packages/n11_shared/lib/src/account/account_views.dart`. Sửa chữ nào cũng phải đổi phiên bản ở app **và** ở `CLIENT_AUTH_TERMS_VERSION` / `CLIENT_AUTH_PRIVACY_VERSION` trên máy chủ. Chỉ mô tả hành vi **đang chạy**; không hứa điều chưa làm.

## Điều khoản sử dụng
Bạn dùng 11Food/11Ship đúng pháp luật, cung cấp thông tin đúng sự thật và tự giữ bí mật mật khẩu. Tài khoản gắn với số điện thoại bạn xác minh bằng mã SMS. Hiện ứng dụng có đăng ký, đăng nhập, hồ sơ cá nhân và gửi hồ sơ quán hoặc hồ sơ shipper; đặt món, giao hàng, ví và doanh thu chưa hoạt động. Tạo tài khoản hoặc gửi hồ sơ chưa mở quyền bán hàng hay nhận đơn: quyền đó chỉ có sau khi hồ sơ được duyệt. 11Ship có thể khóa tài khoản khi phát hiện gian lận hoặc vi phạm điều khoản.

## Chính sách quyền riêng tư
11Ship lưu số điện thoại, họ tên, mật khẩu ở dạng mã hóa một chiều, phiên đăng nhập, thông tin xác thực thiết bị Android để bảo vệ tài khoản, và thời điểm cùng phiên bản bạn đã chấp thuận. Mã xác minh được gửi bằng tin nhắn SMS tới số bạn nhập. Khi bạn tạo hồ sơ quán, ứng dụng chỉ lấy vị trí một lần lúc bạn bấm nút để ghi vị trí quán; ứng dụng không theo dõi vị trí nền. Hồ sơ Shipper có thể bao gồm họ tên, số điện thoại, biển số xe và thông tin tài khoản ngân hàng. Thông tin ngân hàng được sử dụng để xác minh chủ tài khoản và phục vụ các nghiệp vụ thanh toán liên quan. Thông tin này không được công khai cho khách hàng, chủ quán hoặc Shipper khác. Dữ liệu dùng để vận hành, bảo mật và hỗ trợ tài khoản.

## Owner cần quyết định (chưa có trong văn bản vì không phải hành vi của code)
1. Tên pháp nhân/đơn vị vận hành, kênh liên hệ, thời hạn lưu dữ liệu, quyền xóa/xuất dữ liệu: nếu muốn nêu trong điều khoản, cần nội dung do Owner (hoặc tư vấn pháp lý) cung cấp.
2. Điều khoản SIM/nhà mạng cho việc gửi OTP bằng máy Gateway (quyết định chuyển `SMS_GATEWAY_RECIPIENT_MODE` sang `OPEN`).
3. Chấp thuận bản này để phát hành app. Nếu sửa chữ → phiên bản mới.
