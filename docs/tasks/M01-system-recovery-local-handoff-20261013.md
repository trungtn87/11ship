# M01-RESET — SYSTEM recovery local/CI
Ngày giao: 13/10/2026. ChatGPT chốt contract/giao việc; Claude code. Nhánh: feat/m01-system-recovery-local.

## Kết quả và mốc kế thừa
USER/ADMIN reset test đã merge PR #93, head 5272ceb5396fb596985eee17ac2687bc899356d0, merge 91a08489879d7c3716d7dd1257aab52729680a76. Không sửa/làm lại form hay endpoint đó.
SYSTEM bị loại khỏi public reset đúng chủ đích. Phần thiếu tiếp theo: CLI riêng khôi phục mật khẩu của SYSTEM hiện có trên DB local/CI, thu hồi phiên/preauth, giữ factor TOTP.
Chưa triển khai recovery email hoặc emergency mất email. Không tuyên bố hoàn thành toàn SYSTEM recovery/M01.

## Đọc đúng phạm vi
Đầu phiên đọc AGENTS.md, CLAUDE.md, docs/process/11ship-delivery-workflow.md và handoff này một lần; sau đó chỉ đúng code cần sửa.
- docs/current/M01-workstreams-20261012.md: hàng M01-RESET và §5.
- docs/tasks/M01-B-RESET-password-recovery-design.md §3; §2 chỉ phần thu hồi phiên/giữ TOTP.
- scripts/admin-auth-bootstrap-system.js; apps/backend/src/admin-auth/cli/admin-auth-cli.ts, cli-target-guard.ts, stdin-input.ts: pattern launcher/stdin/guard/error.
- apps/backend/src/admin-auth/admin-bootstrap-service.ts, admin-membership-repository.ts: tìm SYSTEM và thứ tự khóa.
- apps/backend/src/auth/user-repository.ts: lockResetTarget/setPasswordHash từ #93; auth/password-hasher.ts, admin-password-verifier.ts.
- apps/backend/src/admin-auth/admin-session-repository.ts, admin-challenge-repository.ts; auth/session-repository.ts; audit/audit-writer.ts; transaction/transaction-manager.ts.
- tests/integration/admin-auth-cli.int.spec.ts và account-recovery-reset-test.int.spec.ts: helper/fixture/revocation. Không đọc lại toàn suite.

## Contract môi trường test
1. CLI mới npm run admin-auth:recover-system, launcher scripts/admin-auth-recover-system.js. Không controller, không public API, không route proxy/UI.
2. Bản này chỉ APP_ENV=development|test, HOST loopback và DATABASE_URL host loopback cho CẢ development/test. Từ chối staging/production/host remote/env thiếu trước kết nối và trước đọc password. Reuse resolveCliTarget + kiểm DB thật: database/current_user/session_user đều ship11_dev hoặc ship11_test theo môi trường. Guard thêm chỉ thuộc lệnh mới, không đổi phạm vi các CLI cũ.
3. Quyền vận hành bản local = quyền OS chạy công cụ và credential DB local được xác nhận; không dùng cookie ADMIN, không self-service, không cấp quyền SYSTEM cho ADMIN. Đây không phải contract vận hành production/VPS.
4. Không dùng ACCOUNT_RECOVERY_MODE để mở SYSTEM công khai. Không OTP SMS/email giả, không gán verified_at. TOTP SYSTEM bắt buộc như cũ. Chưa có email recovery schema/provider; gói này không tạo. Khi triển khai email đã xác minh, CLI recovery phải được bổ sung gate email trước mở ở môi trường đó; không coi bản local này là bypass email cho remote.
5. Không kết nối VPS/DB Owner, không chạy recovery trên tài khoản thật. Chỉ fixture SYSTEM local/CI.

## CLI và mutation
- Hai chế độ: --check (read-only) và --apply. Thiếu/sai mode hoặc argument lạ -> exit 2; không mutation. Không nhận password từ argv/env/file path.
- --check: stdin một JSON exact {phone}; chuẩn hóa phone theo primitive có sẵn. Chỉ khi tìm đúng SYSTEM hiện có/origin ADMIN_PROVISIONED mới xuất fixed outcome + version hiện tại (không phone/user_id). Không tạo khi thiếu. Kết quả check không phải quyền apply.
- --apply: stdin JSON exact {phone,password,expected_version,confirmation}; confirmation literal RESET_SYSTEM_LOCAL_TEST. expected_version positive safe integer lấy từ check. Password reuse policy/Argon2id; bounded stdin reuse parser primitives, không echo/log input.
- Hash ngoài transaction. Trong transaction: tìm SYSTEM id không lock, user root lock -> membership lock; recheck same normalized phone, origin ADMIN_PROVISIONED, admin_role SYSTEM và expected_version. Thiếu/sai target hoặc version lệch thì fixed refusal, không thay đổi gì. Không chọn target bằng role do caller gửi.
- Dùng setPasswordHash: version + 1; revoke toàn app.sessions và admin_sessions; supersede mọi admin preauth chưa consumed; audit cùng transaction. Không chạm activation invitation attempts.
- Giữ user/membership status (DISABLED vẫn khóa), roles, hồ sơ, permissions và TOTP kể cả trạng thái pending; không activate/reseed/delete factor. Không bootstrap lại, không tạo SYSTEM thứ hai, không sửa bootstrap behavior.
- Audit action admin.auth.system_password_recovered.v1, actor_type SYSTEM nhưng không giả là phiên SYSTEM đã xác thực: actor_id để null theo schema; metadata {execution_context:LOCAL_OPERATOR, target_user_id, version, verification:LOCAL_SERVER_OPERATOR_TEST}. Không password/hash/phone/OTP/TOTP/DB URL/credential trong log/audit.
- Audit fail -> rollback password và revocation. Hai apply cùng expected_version serialize dưới user root: tối đa một thành công, còn lại version conflict. Không auto retry. Kết quả commit chưa rõ -> báo fixed outcome unknown, không tự gửi lại; hướng dẫn check version và thử đăng nhập. Gửi lại expected_version cũ không đổi password lần hai.
- Exit 0 khi check/apply thành công; 1 fixed refusal/failure; 2 usage. Chỉ output fixed codes/version, không dump exception/config/SQL/raw DB errors. Import service CLI trực tiếp; không đưa service vào HTTP module nếu không cần.

## Kiểm tra vừa đủ và giao kết quả
- Focused guard/parser: remote/staging/production/missing confirmation/bad version/extra fields bị từ chối, không đọc secret/kết nối/mutate tương ứng.
- Một spec integration DB thật: fixture SYSTEM + active TOTP và phiên/preauth; check read-only; apply -> old password/session/preauth fail, new password login vẫn VERIFY_TOTP, same factor/status/identity. ADMIN/USER/wrong phone/missing SYSTEM không đổi.
- Kiểm version stale/concurrent apply và rollback khi audit lỗi bằng helper hiện có; không mở ma trận security audit mới.
- Không tạo browser smoke vì không có UI mới. Không chạy lại toàn local unit/client/browser rồi CI. Chạy focused spec/build cần thiết, dùng CI bắt buộc hiện hữu làm gate tích hợp.
- Lỗi đã thấy sửa đúng delta. CI lỗi ngoài scope: xem log một lần; chỉ rerun một lần khi bằng chứng cho thấy flaky, không poll vòng lặp.
- Cập nhật runbook riêng ops/runbooks/system-recovery-local.md (input an toàn, --check/--apply, không đưa secret vào shell history, xử lý outcome unknown), package.json script và dòng trạng thái liên quan trong design. Không sửa dashboard tự sinh.
- Commit/push đúng nhánh, mở Draft PR, báo ngắn: SHA, phần thêm, focused check + link CI, giới hạn email/VPS. Không merge/deploy, không tự chuyển Android hay luồng khác.
