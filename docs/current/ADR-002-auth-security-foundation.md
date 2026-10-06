# ADR-002 — Session và mật khẩu cho Auth Core

Ngày: 06/10/2026. Trạng thái: ACCEPTED DESIGN; thực hiện trong M01-A1, không code Auth ở M00-B1.
Giữ nguyên quy tắc đăng ký roleless và SHOP/DRIVER của tài liệu 4.2–4.3.

## Session

Chọn opaque bearer token do server phát sinh bằng CSPRNG, 32 byte ngẫu nhiên, mã hóa base64url. sessions chỉ lưu SHA-256 của token để tra cứu; không lưu access_token dạng plaintext. Token là dữ liệu ngẫu nhiên entropy cao, không dùng cách hash này cho mật khẩu hoặc OTP 6 số.

- Server kiểm user còn hoạt động, session chưa revoke/chưa hết hạn ở mỗi request bảo vệ.
- active_role nằm trong session, không nằm trong users và không tin role từ client ngoài command chọn role đã kiểm quyền.
- Session A1 có thời hạn tuyệt đối cấu hình, đề xuất mặc định 7 ngày; không sliding renewal và không refresh token ở A1. Hết hạn yêu cầu đăng nhập lại. Đây là quyết định kỹ thuật mới, không phải rule có sẵn trong 4.2.
- Chọn role cập nhật server context; không cần đổi bearer token chỉ để phản ánh role. Với mutation nghiệp vụ, phải kiểm quyền/trạng thái trong transaction phù hợp, không chỉ tại UI.
- SHOP activation phải serialize theo user, thu hồi SHOP session cũ và kích hoạt session mới cùng transaction. Không đụng DRIVER session. Thực hiện ở A1 bằng DB constraint/locking và concurrency tests.
- device_id do client cung cấp là thông tin liên kết, không phải bằng chứng định danh đáng tin. Không dùng nó để cấp quyền hoặc miễn xác thực.
- Client gửi token trong Authorization header qua HTTPS; không query-string/log. Secure storage của mobile được triển khai ở gói client sau.
- Logout/renew/forgot password vẫn thuộc M01-B; không biến phần thiết kế này thành yêu cầu mở rộng A1.

## Password và proof

Chọn Argon2id qua package argon2. Ngưỡng ban đầu: memoryCost=19456 KiB, timeCost=2, parallelism=1; salt ngẫu nhiên do thư viện tạo, lưu PHC hash đầy đủ. Benchmark khi có server mục tiêu; không tự hạ ngưỡng để test nhanh. Password 8–128 ký tự theo contract; không trim/cắt/ngầm chuẩn hóa mật khẩu.

Theo [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), đây là một cấu hình tối thiểu Argon2id. [node-argon2](https://github.com/ranisalt/node-argon2) cung cấp hash/verify; việc cài native dependency cần được kiểm thực tế trong A1.

Proof dùng token ngẫu nhiên đủ mạnh, lưu digest. OTP 6 số phải dùng keyed HMAC với secret ngoài DB và context verification_id/phone/purpose; hash nhanh không có key không đủ bảo vệ không gian 6 số. Rate limit và max attempts vẫn bắt buộc. Không ghi password, hash, token, OTP, proof, Authorization hoặc connection URL vào logs/audit.

## Hạng mục phải hoàn thiện ở M00-C trước khi code A1

Register phải replay cùng logical result theo 4.3; response chứa access_token. sessions chỉ lưu hash không có nghĩa có thể lưu plaintext token trong idempotency cache. Cần contract riêng cho encrypted replay payload, TTL/cleanup, key rotation, request binding và lỗi khi replay hết hạn. Đồng thời request hash phải bảo vệ password/proof bằng keyed digest, không lưu request body.

Không bỏ yêu cầu idempotency, không trả token cho request chỉ biết Idempotency-Key, không replay phiên đã revoke. M00-C phải khóa phương án và tests trước khi mở Auth; không coi ADR-002 là đã giải quyết replay đầy đủ.

M00-B1 không phụ thuộc replay Auth và không cần cài argon2 hoặc tạo sessions. Thứ tự: nền chạy được → cơ chế dùng chung M00-C → Auth Core → onboarding.
