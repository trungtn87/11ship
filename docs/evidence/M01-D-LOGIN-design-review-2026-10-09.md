# Review thiết kế M01-D-LOGIN — 09/10/2026
Reviewed head PR#30: f4960b041e25315d9fc77694cd7b79db8b319497. Review này áp dụng tree trước commit báo cáo, không tự nghiệm thu head sau.
Kết luận: CHƯA PASS / CHƯA READY_FOR_CLAUDE CODE.
Chỉ review tài liệu và đối chiếu code/schema main; chưa chạy test hoặc review implementation.
Nguồn đã đọc: backend handoff, draft contract, prompt preflight; AuthController, LoginService, SessionRepository, UserRepository, SessionAuthorizationParticipant, SessionAuthGuard, auth-validation, app.setup/error registry và migration Auth Core.
Không đổi nghiệp vụ Owner đã chốt. Findings dưới đây là thiếu/mâu thuẫn hợp đồng kỹ thuật.

## Findings bắt buộc
### F01 — P1: rate-limit counter chưa serialize với verify
File M01-D-LOGIN-backend-handoff.md, Transaction và rate limits.
Trigger: nhiều challenge/request cùng user qua precheck khi failure_count=4, rồi cùng verify mã sai. Contract cho phép kiểm bucket trong transaction riêng trước business nhưng ghi failures độc lập sau kết quả, chưa có reserve/serialize xuyên quyết định.
Impact: có thể thực hiện hơn5 attempts trước lock, trái budget đã chốt; counters và challenge attempts có thể lệch khi crash giữa transactions.
Fix: chốt một thuật toán atomic. Serialize TOTP budget và challenge/factor quyết định trong cùng transaction với locks thứ tự thống nhất; lỗi nghiệp vụ được trả sau commit counters (không throw làm rollback). Giữ rate-limit request/IP riêng trước Argon2 nhưng không lấy precheck làm quyết định cuối. Với password failures chốt atomic update/check và giới hạn request concurrent.
Tests: concurrent failures từ count4, hai challenge, crash/rollback/error outcome; không vượt decision budget đã khóa.

### F02 — P1: không đủ session data để thu hồi khi mật khẩu đổi
File handoff, schema admin_sessions và Transaction.
Trigger: password_hash thay đổi sau login; user vẫn ACTIVE, membership/factor version không đổi. Session chỉ lưu membership_version/factor_version; /me theo contract vẫn đủ điều kiện.
Impact: tuyên bố password đổi vô hiệu hóa session chưa thực hiện được theo schema.
Fix: thêm password/auth credential version binding vào admin session và kiểm dưới user lock, hoặc invariant mọi writer password bắt buộc revoke/version bump atomic. Chọn một contract đầy đủ, kể cả preauth, key rotation của password_binding và tương lai M01-B; không giao Claude đoán.
Tests: password đổi lúc /me/mutation đang chờ khóa; old challenge/session từ chối.

### F03 — P1: pending factor không có lifecycle cho concurrent enrollment
File handoff, admin_totp_factors/enrollment.
Trigger: hai lần login trước enroll tạo challengeA/B; factor user PK chỉ có một pending_challenge_id. A start rồi B start; pending hết hạn hoặc verify thua cuộc.
Impact: chưa biết B có thay secret của A, reuse secret hay từ chối; FK/version/AAD và trạng thái challenge không xác định. Có thể làm QR trên tab đầu mất tác dụng hoặc giữ pending factor không phục hồi được.
Fix: chốt một pending enrollment sống/user, challenge ownership, expiry/cancel/supersession và factor version; quy tắc chạy lại cùng challenge ổn định; challenge khác không tự thay secret. Định nghĩa login/state next_step khi enrollment đã có; clear/reissue chỉ khi expiry đúng dưới lock.
Tests: hai tab, hai device, pending hết hạn, double verify, retry sau loss response, active factor không bị overwrite.

### F04 — P1: migration origin chưa bảo đảm registration cũ
File handoff, phụ lục origin; main UserRepository.insertRegistered.
Trigger: migration thêm account_origin NOT NULL mà không có default, còn insertRegistered cũ không gửi cột này.
Impact: đăng ký app cũ có thể lỗi ngay; mức nullable/type/default cũng chưa được khóa. Scope đầu tài liệu “không sửa Auth app cũ” mâu thuẫn guard additive bắt buộc ở phụ lục.
Fix: định nghĩa account_origin NOT NULL DEFAULT PHONE_VERIFIED + CHECK pairing và backfill; bootstrap explicit ADMIN_PROVISIONED. Sửa scope handoff thành cho phép origin guard/repository shape cần thiết, giữ behavior verified. Ghi rõ files/participant/session-service phải recheck origin. Reconcile #27 nếu base thay đổi, không bỏ STAGING_FIXTURE.
Tests: chạy migration trên dữ liệu cũ và REGISTER API hiện tại; origin admin từ chối app token/commands sau lock.

### F05 — P1: API trả scopes nhưng không có schema lưu scopes
File handoff API và admin_memberships table.
Trigger: ADMIN /me/login response yêu cầu scopes từ membership nhưng schema chỉ có role/status/version.
Impact: không có nguồn quyền được định nghĩa; Claude có thể hardcode, coi empty là full access hoặc invent schema.
Fix: thêm bảng admin_scopes với vocabulary và invariant, hoặc gói login chỉ trả admin_role và hoãn scopes API cho task tạo ADMIN. SYSTEM full access phải dựa role, ADMIN empty không có quyền nghiệp vụ. Không dùng fixture để tự chốt scope sản phẩm.
Tests: SYSTEM/ADMIN empty scope, reject role elevation, current scope/revoke khi future task tích hợp.

### F06 — P2: GET rotate CSRF gây xung đột tab/request
File handoff Cookie/CSRF và GET/state/me.
Trigger: tabA có token, tabB GET/me rotate digest; tabA submit bị403. GET song song response reorder có thể giữ token đã vô hiệu.
Impact: F5 và nhiều tab không ổn định dù session hợp lệ; UI phải fetch lại nhưng vẫn có thể tiếp tục race.
Fix: dùng CSRF secret/token ổn định theo lifetime credential, rotate khi preauth→session/logout/new login; hoặc chốt bounded multi-token strategy. Nếu chỉ lưu digest và GET phải trả lại token, cần thiết kế derive/HMAC hoặc encryption phù hợp, không thể khôi phục plaintext từ digest.
Tests: hai tab, parallel /me, reload rồi submit, không kéo dài TTL; cross-origin từ chối.

## Tài liệu cần đồng bộ
Draft vẫn bảng preauth/admin bearer và câu “các giá trị chưa Owner chốt”; handoff có đoạn blocker origin cũ rồi phụ lục supersede; checklist chứa literal \n.
Handoff ban đầu cấm sửa Auth app cũ trong khi origin guard bắt buộc sửa. Gộp thành contract nhất quán trước code; không chỉ thêm nhiều phụ lục ưu tiên.
Màn login đã Owner duyệt, chưa tự nâng mọi màn/states hoặc recovery thành duyệt.
Một thiết bị toàn tài khoản còn task riêng; không ghi gói admin session đã đáp ứng toàn hệ.

## Sau review
ChatGPT sửa tài liệu thiết kế F01–F06, re-review head mới rồi mới tạo implementation handoff. Claude hiện chỉ được preflight/review, chưa code.
Không merge/deploy hoặc đóng M01. M00 vẫn tạm dừng; local/device chưa kiểm chứng.
