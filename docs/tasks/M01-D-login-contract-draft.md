# M01-D-LOGIN — gói đăng nhập quản trị
Ngày 09/10/2026. DRAFT CONTRACT, chưa READY_FOR_CLAUDE.
Nguồn: workflow/ADR-002 main; main login-service.ts, session-repository.ts, auth.controller.ts; quyết định Owner SYSTEM duy nhất, form chung và 2FA bắt buộc.
ChatGPT thiết kế/handoff/review; Claude code/tests/build; Owner duyệt/test/merge. M00 tạm dừng; nghiệm thu local chưa mở.

## Trạng thái duyệt
Owner ngày 09/10/2026 nói “Ok. Chốt màn login”: ghi nhận duyệt màn login chung đã trình bày, không tự mở rộng thành duyệt mọi màn/trạng thái/recovery hoặc toàn bộ API/schema.
SYSTEM duy nhất khởi tạo sẵn, ADMIN chỉ do SYSTEM tạo, tất cả quản trị phải qua 2FA là nghiệp vụ đã chốt.
Các tham số và endpoint dưới đây là đề xuất cần duyệt/review kỹ thuật.

## Kết quả kiểm kê
AuthController hiện /auth/login trả access_token sau mật khẩu; LoginService tạo session roleless và đọc eligibility SHOP/DRIVER. SessionRepository chưa có bằng chứng 2FA trong session view.
Không dùng token app hoặc role/select để nhận quyền quản trị. Cần API quản trị riêng dù UI login SYSTEM/ADMIN chung.
Không thay semantics /auth/login và /auth/role/select cũ trong gói này. Một thiết bị toàn tài khoản giữa các app vẫn cần task M01-B riêng; gói này chỉ quản lý phiên quản trị, không tuyên bố invariant toàn hệ đã đạt.

## Phạm vi
Bootstrap SYSTEM; mật khẩu → enroll/challenge TOTP → phiên quản trị; /me và logout quản trị; UI xác thực đã được duyệt trong phạm vi tương ứng.
Không tạo ADMIN trong gói 1; không dashboard nghiệp vụ, recovery/reset 2FA, đổi mật khẩu/phone hay SMS thử. ADMIN flow được test bằng fixture integration riêng, không seed ADMIN qua public API.
Frontend chưa thống nhất #24/#29/#31: phải chọn/tích hợp nền UI được review trước code UI; backend có thể tách PR trước. Không dùng gói này làm quyền merge các PR đó.

## Luồng và tham số đề xuất
1. Bootstrap operator nhập SĐT chuẩn hóa hợp lệ và mật khẩu theo validator hiện hành, không credential trong git/log. Chạy lại cùng SYSTEM là no-op, số khác từ chối; không ghi đè mật khẩu. Transaction + singleton DB constraint; nếu SĐT đã thuộc user hiện có thì từ chối và yêu cầu thiết kế xử lý riêng, không tự nâng quyền.
2. Login kiểm user/password và membership quản trị còn active; dummy hash cho số không tồn tại. Trước 2FA chỉ cấp pre-auth token ngẫu nhiên 32 byte, digest trong DB, TTL 5 phút. Không cấp access_token quản trị.
3. Chưa enroll: pre-auth cho phép start enrollment. Secret ngẫu nhiên riêng user, lưu mã hóa bằng keyring AEAD có context user/factor; không hash secret TOTP vì verifier cần sử dụng. Secret pending không trở thành active trước verify thành công; không ghi vào idempotency plaintext/cache/log.
4. Đã enroll: pre-auth chỉ được verify challenge, không được đọc lại secret hoặc bắt đầu enrollment để thay factor.
5. TOTP đề xuất 6 số, SHA-1, period30s theo profile tương thích Authenticator; cửa sổ current và previous step, không future step. Truy vấn giờ DB sau khóa; lưu last accepted step toàn factor, chặn dùng lại ngay cả giữa hai challenge.
6. Verify/enroll tối đa5 lần mỗi pre-auth; hết lượt token hết hiệu lực. Thêm budget theo user để tạo challenge mới không reset khả năng brute force: đề xuất5 mã sai/15 phút, khóa tạm15 phút; mật khẩu đề xuất10 lỗi/15 phút theo normalized phone và IP. Counter dùng storage chung, không in-memory nếu nhiều instance; hành vi IP/proxy cần khóa deployment trước code.
7. Verify thành công consume pre-auth, recheck password version/user/member/factor và cấp opaque admin session trong cùng transaction; revoke admin session cũ cùng user. Login mật khẩu thất bại hoặc challenge mới chưa thành công không được đá phiên đang hoạt động.
8. Phiên quản trị TTL tuyệt đối8 giờ, không refresh/sliding; web dùng session cookie HttpOnly/Secure/SameSite với thời hạn khớp phiên server; tải lại trang gọi /me để phục hồi phiên/quyền, không nhập lại mật khẩu/2FA khi phiên còn hợp lệ. Cookie không kéo dài TTL khi reload. Đây là sửa đề xuất theo phản hồi Owner, chi tiết CSRF/origin/deployment cần khóa trước code. /me trả quyền từ backend hiện tại, không secret.
9. Logout revoke server, gọi lại an toàn; UI clear token. Mất phản hồi verify không replay bearer bằng challenge đã consumed: đăng nhập lại và dùng mã mới, UI nói rõ; không auto-retry mutation cấp phiên.
10. Member/role khóa hoặc factor/password đổi vô hiệu hóa pre-auth và session liên quan. Mutation quản trị recheck trạng thái dưới transaction khóa, không chỉ guard.
Không thay tất cả giá trị config auth cũ; tham số quản trị riêng. Các giá trị này chưa được Owner chốt.

TOTP tham chiếu: https://www.rfc-editor.org/rfc/rfc6238.html — period và không chấp nhận lại mã đã xác nhận. Tham số TTL/rate limit/session trên là đề xuất dự án, không coi RFC đã chỉ định.

## API boundary đề xuất (prefix /v1/admin-auth)
| Method/path | Credential | Kết quả |
|---|---|---|
| POST /login | phone/password/device | preauth_token + next_step ENROLL_TOTP hoặc VERIFY_TOTP + expires_at; chưa access_token |
| POST /totp/enrollment | pre-auth bearer | secret/otpauth_uri pending; Cache-Control:no-store; chỉ chưa enroll |
| POST /totp/enrollment/verify | pre-auth bearer + code | consume challenge, activate factor, cấp admin session |
| POST /totp/verify | pre-auth bearer + code | consume challenge, cấp admin session |
| GET /me | admin bearer đã 2FA | user_id, admin_role, scopes, expires_at |
| POST /logout | admin bearer | thu hồi phiên; 204 hoặc error envelope theo contract final |
Token pre-auth và admin có audience/type tách biệt; không dùng lẫn, kể cả gửi vào endpoint app. Không secret/token trong URL. Với web, phiên admin dùng cookie HttpOnly/Secure, không trả bearer vào JavaScript/localStorage; cập nhật bảng API credential admin thành cookie trong contract final. Mutation cookie bắt buộc CSRF protection và kiểm origin; chốt same-origin routing trước code. Pre-auth transport cũng phải khóa riêng, không mặc định cookie session cấp quyền trước 2FA.
Các body/schema/error enums/HTTP codes cuối phải đóng trong phụ lục trước handoff, không giao Claude tự đoán.

## Dữ liệu logical đề xuất
- admin_memberships: user FK, SYSTEM/ADMIN, trạng thái; SYSTEM singleton.
- admin_totp_factors: user FK, pending/active, encrypted secret/key_id/nonce/tag, factor version và last accepted step.
- admin_auth_challenges: digest/type, user/password version/factor version/device, TTL/attempts/consumed.
- admin_sessions: digest/user/device/admin membership version/factor version, MFA completed, expiry/revoked.
- admin_auth_limits: shared window/lockout cho login và verify.
Tách privilege khỏi SHOP/DRIVER role enum cũ. Đây là mô hình logical, chưa SQL migration locked.
Lock ordering user → member → factor → challenge → sessions; rate-limit lock thứ tự riêng phải thiết kế nhất quán để không deadlock.
Audit success cùng transaction; denied sau rollback theo primitive hiện hữu; không secret/code/hash/token/phone plaintext trong metadata.
Phải có migration forward/backfill không cấp quyền cho user cũ; rollback/recovery runbook trước deploy. Không mất secret key rồi tự reset yếu tố.

## Acceptance bắt buộc
- Singleton bootstrap: concurrent/rerun/conflict, không thay mật khẩu, không nâng user cũ.
- Sai phone/password/no admin membership; không có privileged session trước2FA.
- Enroll pending/đã active, QR không public, mã sai/hết hạn/replay/window.
- Verify concurrency chỉ một thành công; last step dùng chung, budget qua challenge mới.
- Challenge/phiên expired hoặc revoked; user/member/password/factor đổi khi chờ khóa.
- App token/preauth/admin token dùng sai audience đều bị từ chối.
- Login admin mới thành công revoke admin cũ; login thất bại không đá cũ.
- Logout thật; loss-response không tạo replay bypass hoặc UI auto retry.
- Key rotation/key unavailable/ciphertext lỗi fail closed, không secret leak.
- Hồi quy REGISTER/login/me/role/select/onboarding SHOP/DRIVER cũ.
- Browser normal/loading/error/focus/reload/expiry với API/DB thật; TOTP Google Authenticator thật trên điện thoại sau M00 local đạt.
Evidence đúng final SHA; CI không thay Owner acceptance.

## Việc cần làm trước giao code
- [ ] Owner chốt TTL/cửa sổ/rate-limit và phạm vi gói; reload giữ phiên theo phản hồi, transport cookie/CSRF cần review.
- [ ] Review kỹ thuật schema/API lỗi/idempotency/audience/lock order/migration và dependency TOTP.
- [ ] Chốt frontend tích hợp và đủ UI state duyệt; login đã duyệt không thay toàn gate UI.
- [ ] Tạo handoff Claude final có base SHA, files, test matrix, PR Draft và điều kiện chuyển.
- [ ] Claude code; ChatGPT review; Owner local rồi thiết bị; merge/đóng theo quyết định.
Web quản trị đang thiết kế; các app khác hồi quy có dependency nhưng chưa nghiệm thu. Không N/A/đóng M01.
