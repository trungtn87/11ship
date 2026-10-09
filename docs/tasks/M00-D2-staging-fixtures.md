# M00-D2 — Tài khoản staging không SMS
Ngày: 2026-10-09. Trạng thái: DRAFT DESIGN — chưa triển khai, chưa được coi là design locked.
Phụ thuộc: D1 (#25); CI sau merge 75760bd chưa thấy run tại thời điểm lập thiết kế.
Thẩm quyền: bổ sung có giới hạn cho M01-A1 và M00-D; production vẫn cần SMS thật trước phát hành.

## 1. Căn cứ đã đọc
M01-A1 §5/7/9/10/11; users migration; user-repository.ts; login-service.ts;
session-service.ts; otp-provider-binding.ts và manifest hiện tại.
users.phone_verified_at hiện NOT NULL; insertRegistered lấy verified_at từ proof thật.
Login và bearer hiện chỉ kiểm credentials/session/status. Vì vậy không thể chỉ bỏ OTP binding
rồi seed users với thời gian giả. D2 phải thêm chính sách account origin và kiểm ở đường đọc.

## 2. Schema: migration mới, không sửa migration cũ
Thêm users.account_origin varchar, NOT NULL, default PHONE_VERIFIED:
PHONE_VERIFIED | STAGING_FIXTURE. Giữ phone unique, Argon2id, status và version.
Cho phone_verified_at nullable nhưng thêm CHECK kết hợp:
- PHONE_VERIFIED => phone_verified_at IS NOT NULL;
- STAGING_FIXTURE => phone_verified_at IS NULL.
Backfill users hiện có thành PHONE_VERIFIED (trước migration tất cả có verified_at).
Không sinh OTP challenge/proof, không tự đổi fixture thành PHONE_VERIFIED.
Đăng ký chuẩn luôn ghi PHONE_VERIFIED và lấy timestamp từ proof như hiện tại.
Request không được phép chọn account_origin hay phone_verified_at.
Không thêm vai trò ADMIN/SYSTEM và không thay driver_type.
Migration down chỉ dành DB dùng một lần, phải từ chối khi còn fixture có timestamp NULL;
không xóa fixture để ép down chạy được.

## 3. Config và boundary
AUTH_STAGING_FIXTURES_ENABLED mặc định false; chỉ chấp nhận true/false chính xác.
true chỉ hợp lệ với APP_ENV=staging; production/development/test có true đều lỗi startup.
Unit/integration có thể inject policy staging trong harness, không mở chốt env test.
AUTH_STAGING_ALLOWED_PHONES: secret danh sách JSON các số chuẩn hóa +84;
bắt buộc không rỗng, không trùng, tối đa 20 khi bật; có cấu hình này khi tắt cũng lỗi.
Không đưa SĐT/password vào Blueprint, repo hay log. Báo lỗi chỉ tên biến.
Staging mặc định tiếp tục từ chối startup vì chưa có provider.
Staging bật fixture mode: bind DisabledOtpProvider rõ ràng; tuyệt đối không FakeOtpProvider.
Production tiếp tục chặn startup đến khi adapter SMS thật được duyệt riêng.

Ở fixture mode, request/verify OTP và register bị chặn tại service boundary trước DB/hash/provider;
trả 503 AUTH_REGISTRATION_UNAVAILABLE, envelope request_id như cũ.
Provider disabled nếu bị gọi cũng thất bại; không tạo PENDING có mã dùng được.
Không đổi luồng OTP dev/test, TTL, proof hay register replay ngoài fixture mode.
Staging fixture mode login chỉ nhận fixture trong allowlist; PHONE_VERIFIED không được dùng
trong mode này. Tắt mode => fixture bị từ chối.

## 4. Chính sách fixture trên mọi đường auth
Policy chung: origin PHONE_VERIFIED đi theo auth chuẩn ở môi trường không phải fixture mode;
STAGING_FIXTURE chỉ được phép khi staging + mode bật + phone trong allowlist.
Áp dụng tại:
- login: sau password verify và kiểm lại user dưới lock trước tạo session;
- bearer authenticate: kiểm origin/allowlist bên cạnh status/expiry/revocation;
- SessionAuthorizationParticipant: kiểm lại dưới khóa user/session cho command và /me,
  không chỉ dựa vào principal của guard.
Production từ chối fixture kể cả có credentials đúng hay bearer đã tạo trước đó.
Fixture hết allowlist, mode tắt, disabled đều mất quyền với session cũ; không mint token mới.
Trước password verify không tiết lộ account origin; login bị policy từ chối dùng INVALID_CREDENTIALS.
Bearer bị policy từ chối dùng SESSION_INVALID; không thêm quyền vào principal từ input.
Origin đọc từ DB, không tin client. Trường origin immutable trong D2.
Bổ sung phone_verification_status = VERIFIED | UNVERIFIED_TEST trên login và /me.
Đây là dữ liệu hiển thị, không dùng thay nguồn quyền DB. Không trả thêm password/hash/proof.

## 5. Seed riêng: npm run staging:seed-fixtures
Không HTTP endpoint, không app boot/build seed, không chạy từ Render.
APP_ENV=staging và config bật; target confirm cùng định danh host:port/database/project của D1.
Dùng credential operator riêng (migrator), strict TLS và Session pooler. Runtime không giữ credential.
Dữ liệu đầu vào đọc qua stdin JSON [{phone,password}], tối đa 20, strict keys,
phone phải trong allowlist, password theo validation chuẩn. Không argv password, không log payload.
Chỉ tạo users roleless; không seed profile, membership hay user_roles.
Owner dùng onboarding chuẩn sau login để thử SHOP/DRIVER.
Validate toàn bộ và hash ngoài transaction trước khi ghi; một transaction cho batch,
khóa advisory cố định riêng cho seed, unique phone là chốt cuối.
Tạo user ACTIVE, STAGING_FIXTURE, verified_at NULL, timestamps DB, không tạo session.
Nếu phone đã là PHONE_VERIFIED => rollback toàn batch, không ghi đè.
Nếu fixture đã tồn tại => no-op, không reset password/status, không cấp role, không mở lại account disabled.
Hai seed đồng thời => cùng dữ liệu cuối, không nhân đôi. Lệnh không phải công cụ đổi password.
Audit auth.staging_fixture_created.v1 cùng transaction, chỉ user_id/request_id và nguồn operator
cố định (không gán quyền SYSTEM cho operator); không phát auth.user_registered.v1 giả.
Không lưu payload seed trong idempotency store, không tạo event báo phone verified.
Thành công chỉ báo số created/skipped; lỗi safe code. Rerun có thay đổi password vẫn no-op được
ghi rõ; muốn reset fixture cần thiết kế riêng.
Không seed Supabase thật trong PR triển khai; D4 mới thực hiện remote có kiểm soát.

## 6. UI và phạm vi
Hiển thị "Môi trường thử nghiệm" và "Tài khoản thử nghiệm — chưa xác minh SĐT".
Ẩn/disable đăng ký; thông báo "Đăng ký và xác minh SMS tạm thời chưa mở".
D2 chỉ cung cấp API/config contract; phần UI giao riêng, không tuyên bố Owner đã test.
Session/router/role eligibility, SHOP single-device và DRIVER policy giữ nguyên.
Không thêm customer/admin/wallet/delivery, không dùng Supabase Auth.
Fixture không được chuyển sang production; production DB/keys/accounts tách riêng.

## 7. Checklist bắt buộc
- [ ] Migration clean/upgrade/second up; data PHONE_VERIFIED giữ nguyên; CHECK chặn mọi tổ hợp sai.
- [ ] Origin injection trong register/seed strict keys bị chặn; proof/replay regressions nguyên vẹn.
- [ ] Config fail-closed mọi môi trường; missing/empty/malformed allowlist; logs không chứa secrets.
- [ ] OTP/request/verify/register bị chặn trước mutation khi fixture mode bật.
- [ ] Seed hai lần/concurrent, phone thật collision, batch rollback ở audit failure, disabled không reenable.
- [ ] Login/me fixture ghi UNVERIFIED_TEST; onboarding chuẩn sau restart/redeploy hoạt động.
- [ ] Session cũ bị chặn khi xóa allowlist/tắt mode; production từ chối login/bearer fixture.
- [ ] Recheck policy trong participant dưới lock; race disabled/mode policy không bypass guard.
- [ ] SHOP session replacement, DRIVER eligibility và auth chuẩn vẫn qua test thật PostgreSQL 17.
- [ ] lint/typecheck/build/unit/integration local+CI, deploy/progress tests; final head CI xanh.
- [ ] Evidence tách CI/local và remote; không secret; chưa deploy/Owner acceptance.

## 8. Handoff Claude và dashboard
Nhánh triển khai feat/m00-d2-staging-fixtures từ main sau khi thiết kế này được review và merge.
Đọc ADR-002/003 và inventory SessionAuthorizationParticipant/replay callers trước sửa.
Chỉ D2; giữ Draft PR; không merge/deploy/seed remote. Nếu participant/API invariants không
đáp ứng spec, báo BLOCKED_BY_FOUNDATION với vị trí cụ thể, không bỏ chốt.
Evidence docs/evidence/M00-D2.md; bàn giao exact base/head, CI URL, test counts/limits.
Manifest lá M00-D2 cần design_pr trỏ PR thiết kế này, acceptance trỏ file này,
requires_main_ci_green true; không thay DONE thủ công. Cập nhật tests manifest tương ứng
khi nối gate; schema hiện có hỗ trợ design_pr trên leaf nên không coi gate là ngoài khả năng.
Spec này chưa là quyền bắt đầu code cho đến khi review/merge thiết kế.
