# 11Ship — Tài khoản và đổi mật khẩu (2026-10-15)

Owner yêu cầu từ ảnh `1000002969.jpg`: bỏ Trạng thái tài khoản, Chính sách và điều khoản, Chẩn đoán kết nối trên tab Tài khoản; thêm chức năng đổi mật khẩu thật. Giữ Hồ sơ shipper, Thông tin cá nhân, Trợ giúp và Đăng xuất. Các mục không để lại tiêu đề nhóm rỗng. Điều khoản/checkbox lúc đăng ký và xử lý hết phiên vẫn giữ nguyên. Food giữ UI hiện hành.

## Dùng lại

Phần API, transaction, thu hồi phiên, validation, error code, Dart screen và test được tái sử dụng từ PR #115 (`9efdf956fd3e9c5ec3b14f58614f1a3bb5021c11`), chỉ lấy phần đổi mật khẩu. Không lấy đăng ký 3 bước, voucher, menu Food hoặc sửa nhánh PR #115. Mở rộng app guard của API dùng chung để chấp nhận FOOD/SHIP, vẫn từ chối app khác. Khi tích hợp PR #115 sau này cần giữ API hỗ trợ Ship và các thay đổi UI riêng của hai app.

## Contract

Chỉ tài khoản đang đăng nhập mở được Đổi mật khẩu. Nhập mật khẩu hiện tại, mật khẩu mới 8–128 code points theo policy M01, nhập lại khớp. Có hiện/ẩn mật khẩu. Không dùng SMS hoặc luồng Quên mật khẩu cho thao tác này.

`POST /v1/client-auth/change-password` nhận đúng `{current_password,new_password}` với Bearer, native device proof và Idempotency-Key hiện hữu. Không nhận user_id, role hoặc app từ body. Mật khẩu hiện tại sai trả 400 `CURRENT_PASSWORD_INVALID`, không làm mất phiên. Mật khẩu mới được hash bằng hasher Argon2id hiện có; xác minh bên ngoài write lock rồi re-authorize user/session và so hash dưới lock để không ghi đè một reset đồng thời. Giữ phiên hiện tại để retry an toàn; thu hồi các phiên khác của cùng tài khoản; audit không chứa mật khẩu. Mất phản hồi: khóa các trường và gửi lại đúng body/key khi người dùng nhấn Thử lại. Hết phiên: rời màn mật khẩu theo luồng tài khoản hiện có. Thành công: xóa ba ô mật khẩu và hiển thị xác nhận từ phản hồi server.

Không migration hoặc thay đổi bảng, SMS Gateway, OTP, account origin, native attestation hoặc session binding.

## Kiểm tra và phát hành

- Local: typecheck/build test đạt; 105 focused backend unit tests đạt trước bổ sung native integration.
- Coverage bổ sung: Food/Ship HTTP + PostgreSQL (sai mật khẩu, policy, body lạ, thiếu phiên, đổi thật, retry, mật khẩu cũ/mới, thu hồi phiên khác); native Ship (thiếu proof, proof hợp lệ, retry, giữ Ship/thu hồi Food); Dart menu và form (không khớp, sai hiện tại, thành công, unknown-outcome retry, hết phiên).
- Pipeline hiện có sẽ analyze/test/build/ký APK bằng key cố định, app ID cũ và versionCode tăng. Widget renders có thêm tab Tài khoản mới và màn Đổi mật khẩu; dữ liệu fixture được ghi rõ.

**Cần backend mới trên VPS trước khi nghiệm thu đổi mật khẩu ở bản chạy thật.** Main tại lúc bắt đầu chưa có endpoint này; việc thêm nút không thay thế triển khai API. Chưa thực hiện deploy production, migration remote hoặc đổi mật khẩu tài khoản thật. Báo cáo CI/APK/SHA cuối đặt tại PR bàn giao, không đồng nhất với Owner nghiệm thu thiết bị thật.
