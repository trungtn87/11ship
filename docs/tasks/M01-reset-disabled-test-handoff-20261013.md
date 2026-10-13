# M01-RESET — USER/ADMIN bỏ OTP ở bản test
13/10/2026. Owner chốt lúc 16:39:02 Asia/Ho_Chi_Minh: “Cứ bỏ qua otp vì vẫn là bản test, sau khi có dịch vụ opt sẽ test các case liên quan”.
Quyết định này thay bước OTP trong bản test của USER/ADMIN; production vẫn theo thiết kế reset bằng SMS, SYSTEM vẫn công cụ server riêng. Không OTP giả/proof xác minh giả.
ChatGPT contract; Claude code. Nhánh feat/m01-reset-disabled-test từ main sau #92 (de74819e8a4107124e5effad4554b00fc588e78a).

## 1. Kết quả cần đạt / dùng lại
Food/Ship/Web Admin: Quên mật khẩu → nhập SĐT + mật khẩu mới/xác nhận → reset test → về đăng nhập. Không màn OTP, không gửi mã, không auto login.
Màn reset có sẵn tại apps/client-shared/src/screens/auth.ts và apps/admin-web/src/dom/reset-view.ts; auth/password hasher/repositories/audit/idempotency có sẵn. UI dùng component hiện hữu, logic tách adapter/controller.
Backend reset chưa có: bổ sung coordinator dùng primitives sẵn, không auth stack thứ hai.
Không SYSTEM qua endpoint public, không khôi phục TOTP/email/SYSTEM CLI trong lần giao này. Không đổi mật khẩu riêng trong tài khoản, không account lock/grants/onboarding/Android/VPS hoặc module khác.

## 2. Contract test chốt trước code
ACCOUNT_RECOVERY_MODE=DISABLED_TEST là opt-in; unset/UNAVAILABLE mặc định đóng. Giá trị khác từ chối startup. DISABLED_TEST chỉ APP_ENV development/test + HOST loopback. Staging/production/non-loopback từ chối. Không request/header nào bật mode.
GET /v1/account-recovery/config, no body/query,no-store → {data:{mode:"DISABLED_TEST"|"UNAVAILABLE"}}. UI chưa có config hợp lệ thì khóa submit, không đoán.
POST /v1/account-recovery/reset-test, Idempotency-Key UUID, exact {phone,password}; password confirmation chỉ client; không code/proof/token/role.
Chỉ DISABLED_TEST mới thực thi; mode đóng trả SERVICE_UNAVAILABLE503 trước mutation. Validation phone/password chuẩn hiện hữu, lỗi generic không echo input.
200 exact {data:{next:"LOGIN"}} đồng nhất cho USER thường hợp lệ, ADMIN hợp lệ, số không có hoặc target SYSTEM/ngoài policy. Với số không có/SYSTEM/ngoài policy không đổi gì. UI copy “Yêu cầu đã xử lý. Hãy đăng nhập bằng mật khẩu mới nếu tài khoản thuộc phạm vi bản test.” Không báo đã reset SYSTEM.
USER ordinary gồm PHONE_VERIFIED, TEST_UNVERIFIED đúng policy hiện tại; có trạng thái DISABLED vẫn có thể reset nhưng không mở khóa. ADMIN là ADMIN_PROVISIONED + membership ADMIN (ACTIVE hoặc DISABLED), không SYSTEM. Target có membership bất thường không xử lý như ordinary.
Bản test cho reset trực tiếp theo SĐT là ngoại lệ được Owner duyệt: không giả rằng đã chứng minh sở hữu SĐT. Hiển thị ngắn “Bản test: đặt lại mật khẩu chưa yêu cầu OTP”; tuyệt đối không bật ở production.

## 3. Transaction/phiên
Hash Argon2id ngoài lock như code hiện hữu; không trim/normalize password, không log/store plaintext.
Dùng IdempotencyExecutor, operation account.password.reset_test.v1, namespace riêng, scope ổn định theo phone normalized phía server tương thích engine. Fingerprint toàn input qua HMAC primitives; không random scope mỗi request.
Cùng transaction: claim intent → target user root lock → membership/credential liên quan theo thứ tự chung → recheck target không SYSTEM và mode → update password + users.version/updated_at → revoke mọi app.sessions và admin_sessions, consume/invalidate mọi bước preauth/challenge đang chờ của target, invalidation activation attempt liên quan nếu thực sự thuộc account đang reset → audit/result.
Giữ factor TOTP active, roles, hồ sơ, account/membership status, dữ liệu quỹ/đơn. Pending TOTP enrollment không được trở thành factor active nhờ reset. Login password cũ/pending preauth cũ không được phát hành phiên sau commit; reuse credential binding/recheck hiện hữu.
Không tạo user/profile, không bootstrap SYSTEM, không sửa số điện thoại. SYSTEM public reset không đổi dữ liệu.
Same key/body replay generic acknowledgement, không rehash/update/revoke/audit lần hai; khác body cùng key IDEMPOTENCY_KEY_REUSED. Unknown response giữ key/body cho người dùng bấm Thử lại; không auto retry, không cấp proof giả.
Audit action account.password.reset_test.v1 với IDs/version/chỉ dấu TEST_NO_PHONE_VERIFICATION, không phone/password/token/OTP/TOTP secret. Actor theo enum/schema hiện hữu cho request unauthenticated, không nhận actor_id client. Không event ngoài nhu cầu hiện hữu.
Không schema/migration mới mặc định; helper repo nhỏ khi thiếu. Không làm framework delivery OTP/email ở task này.

## 4. File/tài liệu đúng mục
- docs/tasks/M01-B-RESET-password-recovery-design.md §1–2: giữ ràng buộc phiên/role/trạng thái/TOTP; bước OTP test nhường handoff này. §3 chỉ giữ boundary SYSTEM, không code recovery email/server.
- docs/ui/m01-food-web.md màn reset F13–F15 theo mã thực tế; docs/ui/m01-ship-web.md S15–S17; docs/ui/m01-admin-web.md D08. Không thiết kế lại màn.
- apps/client-shared/src/screens/auth.ts, auth/{client,contract,transport,session}.ts và pattern register-flow.ts; apps/admin-web/src/dom/reset-view.ts, core/api.ts, controller.ts.
- Backend auth/user-repository.ts, session-repository.ts, password-hasher.ts; admin-auth/admin-session-repository.ts, admin-challenge-repository.ts, admin-credential-checks.ts, admin-factor-repository.ts; admin-activation/admin-activation-repository.ts chỉ khi cần invalidate.
- config/app-config.ts, auth.module.ts/app.module.ts; idempotency/audit/transaction primitives.
- scripts/client-web-dev.mjs và scripts/admin-web-dev.mjs: chỉ đúng GET config và POST reset-test, JSON/no-store/timeout/body bounds theo pattern; không wildcard mới. Public flow không gửi Bearer/cookie/CSRF của phiên khác sang backend.
Auth Admin login/TOTP sau reset không đổi; không fake login pass.
AGENTS/CLAUDE/quy trình/workstreams đọc một lần đầu phiên, không kiểm kê toàn module.

## 5. Kiểm tra / trả việc
Focused tests + một smoke thật: USER nhiều phiên Food/Ship reset → password cũ fail/token cũ fail → password mới login; ADMIN reset → admin session/preauth cũ fail → login password mới vẫn bắt TOTP. Giữ status disabled; SYSTEM unchanged; idempotency; config production từ chối.
Case OTP gửi/sai/hết hạn/resend/proof purpose được hoãn tới dịch vụ OTP thật, ghi rõ chưa test, không đánh dấu PASS bằng bỏ step.
Dùng fixtures/harness sẵn, không full local rồi CI lặp, không audit sâu/ma trận mới. CI bắt buộc còn áp dụng; lỗi sửa theo cause, không polling liên tục. Không chạy suite vào DB Owner/VPS.
Cập nhật API/runbook/UI đúng phần đổi; không viết lại evidence cũ. Một Draft PR: SHA, hành vi, check/link, cách thử, giới hạn. Không tự merge/deploy/đóng M01/sang SYSTEM recovery hoặc Android.
