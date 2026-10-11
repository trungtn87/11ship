# M01.01 — bổ sung contract sau preflight #52

Phiên bản 2.0.3, ngày 11/10/2026. ChatGPT thiết kế; Claude code/test; Owner duyệt policy, local/phone, merge/LOCK. Không migration hoặc code sản phẩm nào được chạy bởi tài liệu này.
Nguồn mã: main 3d0212f6e4cb0096218e69f29408808ef38b4a6f; báo cáo #52 head 537d0ebb7ea4d60434b156abc5411bcb39a87e00. Claude phải refresh/diff main trước triển khai.
Ưu tiên tài liệu này so với mô tả mâu thuẫn trong 04 §4. Phạm vi schema M01.02 được chốt kỹ thuật dưới đây; rollout vẫn phải thỏa dependency. Toàn M01.01 chưa CODE_READY: API login/context/native binding còn cần contract riêng.

## 1. Tương thích và backfill (G1/G2/G11/G12/G14)

Admin stack đã có trên main tại mốc audit; không coi #27/#42 đã merge. Origin main tại mốc audit chỉ PHONE_VERIFIED/ADMIN_PROVISIONED. Không thêm enum origin trong M01.02.
CUSTOMER là role storage mới; SHOP giữ nguyên, SHOP_OWNER chỉ public alias API mới. Không thay parser/response/select legacy; GET /auth/me giữ onboarding:{shop,driver}.
Backfill chỉ users account_origin=PHONE_VERIFIED AND phone_verified_at IS NOT NULL, loại mọi user có admin_memberships. Disabled ordinary users vẫn có membership CUSTOMER nhưng quyền truy cập bị guard từ chối; role không có nghĩa ACTIVE.
Tạo customer_profiles cho cùng tập backfill, full_name NULL/version 1; không tạo consent giả. Chạy lại participant/backfill không thêm trùng hoặc thay tên/version đã tồn tại.
Fixture không thuộc tập trên chưa được cấp CUSTOMER. Việc mở hỗ trợ fixture là slice phụ thuộc kết quả #49 và phải cập nhật contract trước; không tự backfill dựa trên enum chưa có. Không sửa migration origin cũ hoặc che drift bằng IF EXISTS.
Migration M01.02 kiểm prerequisite explicit, fail transaction nếu schema sai; remote drift thuộc #49. Không apply remote ở gói schema.

## 2. Physical schema M01.02

Schema app; append-only migration sau timestamp cuối integration base thật, không chỉ sau mốc audit.
customer_profiles:
- user_id UUID PRIMARY KEY REFERENCES app.users(id) ON DELETE RESTRICT.
- full_name varchar(120) NULL.
- version bigint NOT NULL DEFAULT 1 CHECK version BETWEEN 1 AND 9007199254740991.
- created_at/updated_at timestamptz NOT NULL DEFAULT transaction_timestamp().
- CHECK full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 120; CHECK updated_at >= created_at.
- Mọi profile update tăng version đúng 1, kiểm expected_version dưới user/profile lock; không sửa created_at. Normalization thuộc service, không suy CHECK DB đã thực hiện NFC.

user_consents:
- id UUID PRIMARY KEY, UUID do server tạo.
- user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT.
- terms_version/privacy_version varchar(64) NOT NULL, mỗi token dạng [A-Za-z0-9._-], dài 1–64.
- accepted_at timestamptz NOT NULL, thời gian DB tại acceptance.
- client_app varchar(4) NOT NULL CHECK IN ('FOOD','SHIP').
- UNIQUE(user_id,terms_version,privacy_version): một acceptance cho một cặp phiên bản; đổi cặp tạo hàng mới.
- Index(user_id,accepted_at,id) để đọc lịch sử own.
- Không chứa OTP, password, token, IP hoặc tên khách. Không sửa/xóa bằng runtime. Trigger DB reject UPDATE/DELETE, migration-owner fix-forward theo runbook riêng nếu thật sự cần.

user_roles: mở CHECK role để có CUSTOMER và các giá trị hiện có; giữ PK/unique/foreign keys hiện tại. Không tạo constraint mới làm mất giá trị hợp lệ đang có. Không lưu SHOP_OWNER hoặc FOOD.
Runtime grants: customer_profiles SELECT/INSERT/UPDATE; user_consents SELECT/INSERT; không DELETE/DDL. user_roles giữ quyền cũ, không cấp thêm quyền admin. Runbook phải thêm đúng hàng grants và test dưới restricted runtime role; migration credential riêng.

Participant cấp CUSTOMER/profile không tự commit; chạy trên transaction caller, cùng root user lock và lock order hiện hành. Trả lỗi nếu origin/membership privileged không hợp lệ. Transaction rollback phải loại bỏ toàn bộ user/role/profile/consent mới.
M01.02 chỉ chuẩn bị schema/participants/backfill; không thêm endpoint register hoặc đổi policy session.

## 3. Validation client mới (G3/G6)

full_name: valid Unicode scalar string; NFC; trim và collapse Unicode whitespace thành U+0020; từ chối Unicode category Cc/Cf (gồm zero-width), surrogate lẻ; 1–120 Unicode codepoints sau normalize. Không lọc tên theo Latin hoặc buộc hai từ. Tên chỉ là profile khách, không chứng minh danh tính xế/ngân hàng.
device exact {device_id,platform,app}; app FOOD|SHIP, platform WEB|ANDROID cho client-auth mới. device_id giữ grammar legacy. Không nhận role/permission/driver_type.
Password và phone/proof giữ primitives và normalization hiện hành; password không normalize/trim.
Consent exact {terms_version,privacy_version}, dùng token grammar schema và khớp cặp server đang publish; không tin accepted_at do client gửi.
Nhãn app/platform không cấp quyền và không chứng minh thiết bị. Legacy parser giữ nguyên.

## 4. Register/replay/events (G7/G8/G10)

Operation id đề xuất khóa: client.auth.register.v1; scope tách auth.register.v1 cũ, cùng idempotency engine/TTL/lock order. Fingerprint chứa phone normalized, full_name normalized, consent versions và device fields; password/proof dùng cơ chế bảo vệ fingerprint hiện có, không plaintext log/store.
Exact request POST /v1/client-auth/register: {phone,password,verification_token,device,full_name,consent}, header Idempotency-Key.
Một transaction: claim idempotency → proof REGISTER lock/recheck → user creation → CUSTOMER/profile/consent → session → audit/outbox/result. Không gọi network trong lock.
Cùng key/body: replay theo engine, không consume proof lần hai. Khác body cùng key: IDEMPOTENCY_KEY_REUSED409. Proof dùng thành công qua endpoint khác: VERIFICATION_PROOF_USED409; không replay chéo namespace.
Unique phone xử lý race cũ/mới. Hai proof khác nhau cùng phone: đúng một create thành công, ca còn lại PHONE_ALREADY_REGISTERED409; không half-created profile.
Audit action client.auth.register.v1; outbox type client.auth.user_registered.v1, event_id UUID server, occurred_at DB time, payload exact {user_id,client_app,granted_role:"CUSTOMER",terms_version,privacy_version}. Không phone/name/proof/token/password. Producer một event trong commit; consumer dedupe event_id, không thay event legacy.
Success201 data exact: user_id,phone_normalized,available_roles:["CUSTOMER"],active_role:"CUSTOMER",onboarding_required:false,role_selection_required:false,access_token,profile:{full_name,version:1},capabilities:{customer_access:true,shop_profile_read:false,shop_manage:false,driver_profile_read:false},onboarding:{shop:"NOT_STARTED",driver:"NOT_STARTED"}.
New endpoint chưa được phép code cho đến khi session/client-auth contract đầy đủ được chốt.

Errors reuse full registry: BAD_REQUEST400 (HTTP parser), INVALID_PHONE400; VERIFICATION_PROOF_INVALID400, VERIFICATION_PROOF_USED409, VERIFICATION_PURPOSE_MISMATCH400; PHONE_ALREADY_REGISTERED409; IDEMPOTENCY_KEY_REQUIRED400, INVALID_IDEMPOTENCY_KEY400, IDEMPOTENCY_KEY_REUSED409, IDEMPOTENCY_BUSY409, IDEMPOTENCY_REPLAY_EXPIRED409, IDEMPOTENCY_KEY_UNAVAILABLE503, TRANSACTION_OUTCOME_UNKNOWN503; SERVICE_UNAVAILABLE503/INTERNAL_ERROR500 infrastructure envelope.
Add proposal CONSENT_VERSION_UNSUPPORTED409 with fixed message "The consent versions are not supported"; malformed version/name/device uses BAD_REQUEST. Errors never echo inputs. Invalid proof primitive retains current expiry classification; không tự thêm error alias.
Unknown result giữ original key/body; không coi mutation thất bại chắc chắn. Replay phải recheck account/session eligibility, không trả lại usable revoked token; exact rule sẽ chốt ở session contract trước M01.03.

## 5. Logout và D02 (G5/G9)

D02 Owner duyệt 11/10 09:44: hai app trên cùng điện thoại, phiên riêng; đổi CUSTOMER/SHOP trong Food không đăng xuất Ship; thiết bị mới thu hồi phiên app thiết bị cũ.
POST /v1/client-auth/logout exact {} với Bearer: 204 no body, Cache-Control:no-store. Revoke riêng phiên hiện tại trên server. Token của phiên đã revoked/expired nhưng còn record đối chiếu an toàn: 204; unknown/malformed token401 SESSION_INVALID. Không lookup bằng user_id client gửi. Không logout Admin hoặc app kia.
Audit client.auth.logout.v1 một lần khi đổi active→revoked; không event mới mỗi retry. Transaction/retry không phục hồi session. Offline clear local không chứng minh server revoke.
Device binding Android vẫn cần D03/runtime và contract kỹ thuật riêng; không one-session toàn account thay D02, không coi client device_id là physical proof.

## 6. Consent và nghiệm thu

Schema không ghi consent trước acceptance, nên tạo bảng không phụ thuộc nội dung pháp lý cuối cùng. Register/UI phải có nội dung test hiển thị và cặp phiên bản server cấu hình đã duyệt trước code slice tương ứng. Không invent Owner acceptance consent từ câu duyệt D02.
Consent production vẫn chưa duyệt. TEST_INBOX theo revision09 chỉ local; SMS vendor M12.12.

## 7. Bằng chứng bắt buộc M01.02

Fresh và upgrade PG17; backfill repeat không duplicate; chỉ PHONE_VERIFIED có phone_verified_at; loại admin kể cả membership bất thường; preserve names/versions; không consent giả.
Legacy register/login/me/select SHOP/DRIVER không đổi khi có CUSTOMER. Các mã extra role/SHOP_OWNER bị parser/service từ chối đúng contract legacy.
Restricted-role grants: profile read/write thành công; consent append/read thành công; update/delete consent thất bại; runtime không DDL; admin tables không được mở rộng quyền.
Race/backfill/participant rollback; FK/check/version bounds; migration drift fail và rollback; báo counts eligible/inserted/excluded/profile-created, không dump PII.
Claude tạo Draft PR riêng, CI exact SHA, migration/fix-forward notes; không tự merge/apply remote/đóng M01.02 hoặc M01.
ChatGPT review; Owner local/phone/acceptance đều Chưa chạy. Không code UI ở schema slice.

## 8. Trạng thái G1–G14

G1/G2/G3/G6/G7/G8/G9/G10/G11/G14: contract bổ sung như trên; G7/G9 session replay details chưa code-ready toàn API.
G5: policy D02 approved, implementation chưa có. G4: production consent chưa duyệt; test content chưa duyệt. G12: remote migration cần operator/#49 evidence. G13: dependency M00 giữ gate cũ; không waived.
