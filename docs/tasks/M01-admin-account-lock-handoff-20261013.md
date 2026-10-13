# M01-ADMIN — khóa/mở USER, D15 đã chốt
13/10/2026. Owner duyệt đề xuất D15 lúc 14:56:59 Asia/Ho_Chi_Minh bằng “Ok”, sau phần read #90 merge 91cc3db39dba156e28be9b8b6c48964f9761c5f7. ChatGPT contract; Claude code. Nhánh feat/m01-admin-account-lock.

## 1. Quyết định D15 — nguồn hiện hành
- SYSTEM khóa/mở mọi USER thường, không target ADMIN/SYSTEM.
- ADMIN cần can_view + can_lock cho TẤT CẢ domain/role của target: CUSTOMER, SHOP (public SHOP_OWNER), DRIVER. Có CUSTOMER+DRIVER phải đủ cả hai; không suy từ role đang chọn. USER chưa role chỉ SYSTEM được thao tác.
- Khóa toàn identity trên Food/Ship, thu hồi mọi phiên thường của target.
- Mở cho đăng nhập lại, giữ roles/trạng thái hồ sơ quán/xế; không phục hồi phiên cũ.
- Lý do bắt buộc và log mỗi lần thay đổi. M01 không hủy đơn, xử lý tiền hoặc nghĩa vụ giao hàng.
Quyết định này thay D15 “chờ duyệt” trong tài liệu lịch sử; không cần duyệt lại. Phạm vi nghiệm thu hiện tại là M01 local/CI isolated, không VPS/production hay rollout trên nghiệp vụ đang chạy.

## 2. Có sẵn / cần bổ sung
#90 có Admin account read, permissions, D81/D86/D89 và AccountsSource thật. D87/D88/dialog/model đã có nhưng allowed_actions rỗng. Auth TOTP/cookie/Origin/CSRF, IdempotencyExecutor, audit/outbox, users/status/version và sessions đã có.
Nối khóa/mở backend + UI trong cùng task; tái sử dụng toàn bộ các phần trên. Không dựng user store/auth thứ hai.
Để chưa mở mutation trên staging/production khi impact nghiệp vụ chưa triển khai: ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED mặc định false; true chỉ APP_ENV development/test + HOST loopback + ADMIN_AUTH_ENABLED. Giá trị lạ hoặc bật ngoài môi trường đó từ chối startup. UI không được tự bật.
Nếu phát hiện nghiệp vụ active/impact không xác định ở đích test, không cancel/sửa tiền để làm test; từ chối USER_ACCOUNT_IMPACT_REVIEW_REQUIRED. Không viết framework impact hay đọc toàn module ngoài M01. Rollout impact thực tế thuộc module đã chốt về sau.
Không sửa admin memberships/grants, không lock ADMIN, không reset/password, approval, Android/native binding/VPS hoặc module khác.

## 3. Contract API
POST /v1/admin/users/:user_id/lock và /unlock, SESSION cookie Admin đã TOTP, exact Origin hợp lệ, JSON, x-csrf-token SESSION, Idempotency-Key UUID.
Exact body {expected_version:positive-safe-integer,reason:string 1..500 Unicode codepoints sau trim}; không status/roles/actor do client.
200 {data:{command_id:UUID server,user_id,account_status:"ACTIVE"|"DISABLED",version:positive-safe-integer,changed_at:ISO}}. acknowledgement là kết quả intent, không hứa trạng thái vẫn còn hiện tại khi replay.
404 USER_NOT_AVAILABLE cho target không có, privileged hoặc không đọc được; 403 ADMIN_FORBIDDEN khi target nhìn được nhưng thiếu toàn-domain lock quyền. 409 USER_ACCOUNT_VERSION_CONFLICT khi version lệch; USER_ACCOUNT_ALREADY_IN_STATE khi version đúng nhưng trạng thái đích đã có; USER_ACCOUNT_IMPACT_REVIEW_REQUIRED khi gate/impact chưa cho phép. Reuse error/idempotency/session/CSRF hiện có; đăng ký mã mới nếu chưa có, fixed copy không echo reason/ID.
Chỉ target ordinary account origin được policy server hiện tại chấp nhận, luôn loại ADMIN_PROVISIONED và mọi admin_memberships kể cả DISABLED. Fixture ngoài policy không trở thành ordinary bởi status.
GET detail #90 trả allowed_actions:["LOCK"] cho ACTIVE hoặc ["UNLOCK"] cho DISABLED đúng quyền/gate hiện hành; thiếu quyền/gate → []. Đây là UI hint, mutation luôn tái kiểm.

## 4. Transaction/replay
Dùng executor hiện hữu. Operation admin.user.lock.v1 / admin.user.unlock.v1, scope riêng theo actor (scopeId actor UUID) và fingerprint chứa target user_id, expected_version, reason normalized. Không store/log cookie/password/token; không record command store mới chỉ để báo kết quả.
Thứ tự: idempotency → actor user/membership/factor/session theo AdminSystemActor → target ordinary user FOR UPDATE → role/eligibility → target sessions theo UUID → user update/revoke → audit/outbox/result. Giữ thứ tự chung, không chọn actor từ body. Actor/target có admin membership phải từ chối; không đảo lock actor/target để che vấn đề.
Dưới lock lấy clock mới, kiểm actor/CSRF/permission hiện tại, target version/status/full role set và gate; đọc privileges không dựa projection roles_visible.
Lock: users ACTIVE→DISABLED, version+1, updated_at DB time; revoke TẤT CẢ app.sessions chưa revoked của target (Food/Ship/legacy), cùng commit. Giữ TTL/history, không xóa session, không đụng admin_sessions.
Unlock: DISABLED→ACTIVE, version+1; không grant role/sửa hồ sơ/bank/nhận đơn hoặc reset/revive session.
Audit admin.user.lock.v1 / unlock.v1 safe actor/target/from/to/version + reason (đúng một lần). Outbox user.account.locked.v1 / unlocked.v1 payload {user_id,account_status,version}, schema1, nếu dùng event trong namespace repo; không phone/token/reason.
Same key/body replay trả acknowledgement gốc; trước replay tái kiểm CURRENT actor/session/quyền/target ordinary/full roles. Không chạy version check first-execution để cấm replay hợp lệ; không update/revoke/audit lần hai. Khác body same key → IDEMPOTENCY_KEY_REUSED.
Unknown outcome giữ nguyên key/body, người dùng bấm Thử lại; không auto retry mutation. Không coi GET detail chứng minh intent cũ commit: chỉ replay acknowledgement xác nhận intent.
Không schema/migration mới mặc định; thêm repository helpers nhỏ cho version update/revoke nếu thiếu, dùng SQL parameterized và same TransactionContext.

## 5. File/tài liệu đúng mục
- apps/backend/src/admin-accounts/admin-account-read-{service,repository,controller,validation}.ts; bổ sung mutation service/controller riêng nếu phù hợp.
- admin-provisioning/admin-system-actor.ts, admin-auth/admin-crypto.ts, admin-credential-checks.ts; config/app-config.ts và AdminAuth module để wiring.
- auth/user-repository.ts, session-repository.ts; idempotency/audit/outbox primitives đã có.
- apps/admin-web/src/core/accounts.ts, accounts-api.ts; dom/accounts-view.ts, shell-app.ts; states/messages/components dialog hiện có.
- scripts/admin-web-dev.mjs: route mới đúng method/path theo proxy hiện hữu, không wildcard mới.
- docs/ui/m01-admin-web.md D86–D88; docs/current/M01-workstreams-20261012.md M01-ADMIN; handoff này là contract D15 hiện hành.
AGENTS/CLAUDE/quy trình đọc một lần đầu phiên. Tài liệu USER lịch sử §4.3 chỉ tham chiếu, không dựng command store/API timeline cũ ngoài scope.

## 6. UI, kiểm tra và điểm dừng
D87/D88 cần lý do + xác nhận, disable khi gửi; không sửa badge lạc quan. Unknown outcome giữ action/body/key; retry cùng intent, không phát key mới. Version conflict reload detail; quyền đổi xóa PII theo #90. Sau ack refetch CURRENT detail, không lấy trạng thái replay cũ ghi đè. Không Enter tự xác nhận destructive dialog.
Focused tests quyền multi-role/atomic revoke/replay/version và một smoke Chrome/front/backend/DB test thật: SYSTEM lock→token Food/Ship cũ không dùng được→unlock→login mới; ADMIN thiếu một scope không khóa được target multi-role. Kiểm hồi quy target privileged bị từ chối. Dùng fixtures/harness có sẵn, không full-suite local rồi CI lặp, không audit sâu/matrix mới.
Local dependencies bị chặn thì ghi giới hạn và dùng CI bắt buộc, không harness/polling/retry liên tục. Không chạy suite phá DB Owner/VPS.
Cập nhật API inventory/UI/runbook và D15 hiện hành bằng dẫn chiếu handoff; không sửa cả kho docs lịch sử. Một Draft PR: SHA, hành vi, checks/link, cách thử, giới hạn. Không tự merge/deploy/đóng M01/sang module khác.
