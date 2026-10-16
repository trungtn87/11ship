# M01.03 — đăng ký CUSTOMER, gói backend local

Ngày 11/10/2026; revision 2.0.7. CONSENT_TEST_APPROVED / CODE_READY_LOCAL.
Base kiểm kê mới: main 56986d85ee7ffff4e78ae38594ce078a0a4ee25a.
Base lịch sử revision 2.0.6: 9eff7c538e8bd04a15aa4eef53d76826e1a54bee; chưa có M01.22 tại thời điểm đó.
ChatGPT thiết kế/review; Claude code/test/build; Owner duyệt nội dung test, local/phone và nghiệm thu.
Áp dụng [quy trình](../process/11ship-delivery-workflow.md), [mẫu gate](../templates/module-delivery-checklist.md).
Đây là tài liệu thiết kế/giao việc, không có product code, test thực thi mới, deploy hoặc DB remote.

## 1. Nguồn và phạm vi

Nguồn chính trên main:
- [Contract10](../design/system-v2-20261011/10-m01-client-contract.md), [contract11](../design/system-v2-20261011/11-m01-session-device-contract.md). Contract11 ưu tiên về session/replay/onboarding.
- [Bàn giao M01.01](../evidence/M01-01-CONTRACT-HANDOFF.md): CLOSED CONTRACT, không đóng M01.
- M01.02 PR #53 merge 88c3d3d39c96c78a79fa2823a7587eb216c81739.
- registration-service.ts, customer-provisioning-participant.ts, customer-profile-repository.ts, otp-provider-binding.ts đã đọc lại tại base mới. Legacy register vẫn roleless; participant vẫn tạo profile NULL/version1; TEST_INBOX đã được wiring riêng.
- M01.22 PR #64 đã merge bằng b4877d9deadcad45c6eb60d2b898513e0df5f3e5; final head 72555763d36f34e76e0b88c65620b2049701828b được review PASS và [CI success](https://github.com/trungtn87/11ship/actions/runs/38148533896). Compare merge commit tới base mới: behind_by=0, merge_base đúng b4877d9; phần thay đổi sau merge chỉ docs/PROGRESS.md.
- [Evidence M01.22](../evidence/M01-22.md), [runbook lấy OTP trên PC](../../ops/runbooks/test-sms-inbox-windows.md) và workflow CI hiện hành đã đọc. Owner PC/phone acceptance của .22 vẫn CHƯA CHẠY, không suy từ CI/merge.
Nguồn phụ trên PR thiết kế #48, snapshot eedb55d366b4b066529502ce268f76c7fd2addb4:
[task .03](https://github.com/trungtn87/11ship/blob/eedb55d366b4b066529502ce268f76c7fd2addb4/docs/design/system-v2-20261011/claude-tasks/M01.03.md),
[task .22](https://github.com/trungtn87/11ship/blob/eedb55d366b4b066529502ce268f76c7fd2addb4/docs/design/system-v2-20261011/claude-tasks/M01.22.md).
Không kéo cả PR #48 vào implementation. Claude refresh main và diff dependency trước code.

| Đã có | Chưa có ở base đọc |
|---|---|
| OTP REGISTER/proof, legacy register, idempotency, transaction/audit/outbox, session | client-auth/register |
| CUSTOMER participant, profile/consent schema, restricted grants tests | parser/register coordinator/identity/replay cho client mới |
| FakeOtpProvider dev/test, staging DisabledOtpProvider; TEST_INBOX và công cụ PC .22 đã merge | Integration TEST_INBOX với endpoint client-auth/register mới |
| Contract D02 | Verifier/binding Android .21 và bằng chứng hai điện thoại |

Scope: backend đăng ký mới cho FOOD/SHIP; reuse OTP request/verify cũ. Không code UI, login/me/context/logout .04, reset .16, shop/driver onboarding, SMS vendor, native verifier hoặc apply migration remote. Không cấp SHOP/DRIVER/ADMIN/SYSTEM khi đăng ký.

## 2. Dependencies và thứ tự giao

1. M01.01 contract đã tích hợp; M01.02 đã tích hợp.
2. M01.22 đã có PR riêng #64, CI/review đúng final SHA và merge vào main (nguồn §1). Dependency kỹ thuật đã đạt cho integration đăng ký bằng inbox. Không viết lại inbox hoặc công cụ PC trong PR .03; R14 vẫn phải chạy trên endpoint client-auth/register mới.
3. Owner đã duyệt nội dung/cặp consent test ở §3 ngày 11/10/2026 13:47 Asia/Ho_Chi_Minh bằng phản hồi “Ok” trực tiếp cho yêu cầu duyệt mục 3 của PR #62. Gate consent test đã đạt. Chỉ đạo “tiếp m01.03” ngày 11/10/2026 cho phép tiếp tục giao triển khai đúng backend local đã thiết kế; không đổi nội dung consent hoặc mở rộng sang UI/native.
4. M01.03 implementation branch riêng từ main sau dependencies hoặc integration candidate được duyệt. Không làm lại migration schema .02.
5. Sau CI/review hết blocker, ChatGPT được merge gói nhỏ theo ủy quyền 11/10. Local/phone/đóng toàn M01 vẫn chưa đạt.

Backend local .03 không bị native .21 hoặc SMS production chặn. ANDROID fail closed theo contract11; không giả one-device bằng device_id.

## 3. Nội dung chấp thuận dùng thử — OWNER ĐÃ DUYỆT

Cặp cấu hình server được duyệt cho local dev/test:
- terms_version: test-terms-20261011-v1
- privacy_version: test-privacy-20261011-v1

Nội dung điều khoản test:
> Đây là bản thử nghiệm 11Ship/11Food để kiểm tra đăng ký, đăng nhập và quản lý tài khoản. Chỉ sử dụng dữ liệu thử. Mã OTP được lấy từ công cụ SMS test trên máy tính, chưa gửi SMS đến điện thoại. Việc tạo tài khoản chưa kích hoạt cửa hàng hoặc quyền nhận đơn của shipper.

Nội dung thông tin dữ liệu test:
> Bản thử nghiệm lưu số điện thoại, tên bạn nhập, mật khẩu ở dạng băm, phiên đăng nhập và thời điểm/cặp phiên bản bạn chấp thuận để kiểm tra chức năng tài khoản. Không nhập thông tin nhạy cảm hoặc dùng mật khẩu đang dùng ở dịch vụ khác. Nội dung này chỉ dùng cho môi trường thử nghiệm, chưa phải chính sách phát hành chính thức.

Nhãn checkbox đề xuất cho task UI nối sau:
> Tôi đồng ý với Điều khoản dùng thử và Thông tin dữ liệu thử nghiệm.

Checkbox mặc định bỏ chọn; hai nội dung đọc được trước khi gửi. Không giả Owner đã duyệt UI từ đề xuất nhãn này. Backend chỉ nhận cặp phiên bản, không nhận accepted_at hoặc accepted_by. Version mapping từ config server, không hard-code bypass. Thiếu config hợp lệ phải fail closed trước tạo tài khoản; mapping startup/service error theo config/error conventions hiện hành. Đổi cặp server: request cũ chưa commit trả CONSENT_VERSION_UNSUPPORTED; replay đã commit theo §6 vẫn dựa acceptance lịch sử.
Không dùng cặp test trên staging/production; policy môi trường là gate local contract11. Không thêm endpoint public consent trong gói .03; UI task sau phải có nguồn hiển thị khớp cặp server được duyệt.
Owner approval: ĐÃ DUYỆT nội dung điều khoản test, thông tin dữ liệu test và cặp phiên bản trên; nguồn là phản hồi “Ok” ngày 11/10/2026 13:47 Asia/Ho_Chi_Minh, trả lời câu hỏi duyệt mục 3 của PR #62. Không suy ra duyệt bố cục UI, nghiệm thu local/phone hoặc production. Production consent: CHƯA DUYỆT.

## 4. API và validation

Reuse POST /v1/auth/phone-verifications và POST /v1/auth/phone-verifications/:id/verify, purpose REGISTER, parser/error/TTL/rate/proof giữ nguyên.
Thêm POST /v1/client-auth/register, Idempotency-Key bắt buộc, success201 {data:...}, Cache-Control:no-store.
Exact body sáu khóa: phone,password,verification_token,device,full_name,consent.
device exact {device_id,platform,app}; app FOOD|SHIP; platform WEB|ANDROID; device_id grammar legacy.
consent exact {terms_version,privacy_version}; grammar [A-Za-z0-9._-] 1–64, khớp đúng cặp cấu hình.
full_name Unicode scalar hợp lệ, NFC, trim/collapse Unicode whitespace thành space; reject Cc/Cf và surrogate lẻ theo contract10; 1–120 codepoints sau normalize. Tên không buộc hai từ/Latin; không dùng drivers.full_name.
Password giữ primitive: 8–128 Unicode codepoints, không trim/normalize. Phone/proof dùng primitives hiện hành.
Extra fields tại mọi cấp → BAD_REQUEST, gồm role/permissions/driver_type/accepted_at; không echo inputs.

LOCAL_WEB: explicit dev/test + server bind loopback; WEB FOOD/SHIP. Không dựa X-Forwarded-For hoặc nhãn app để cho phép remote. Token memory/F5 login lại thuộc UI slice.
Production WEB → DEVICE_PROOF_REQUIRED403. ANDROID chưa verifier → SERVICE_UNAVAILABLE503; không tạo user/session/consume proof. Không triển khai partial native proof trong .03.

Success identity:
user_id,phone_normalized,available_roles:["CUSTOMER"],active_role:"CUSTOMER";
profile:{full_name normalized,version:1};
capabilities:{customer_access:true,shop_profile_read:false,shop_manage:false,driver_profile_read:false};
onboarding:{shop:"NOT_STARTED",driver:"NOT_STARTED"};
role_selection_required:false;
onboarding_required:false cho FOOD, true cho SHIP;
access_token opaque và session:{expires_at ISO UTC}, TTL main 604800s absolute.
SHIP đăng ký vẫn có CUSTOMER; onboarding_required chỉ dẫn sang hồ sơ shipper ở task UI sau, không cấp DRIVER.

## 5. Transaction và file mapping

Không network trong lock; Argon2 ngoài transaction. Reuse IdempotencyExecutor, không tự viết cache/transaction engine.
operation client.auth.register.v1, namespace tách legacy; scope proof identity như primitives và tách operation/namespace đúng contract10.
Fingerprint validated logical intent: normalized phone/name, password không đổi, proof canonical, device, consent. Chỉ HMAC/protection của engine, không plaintext secrets logs/DB.

Một transaction:
claim idempotency → lock/recheck REGISTER proof (purpose/phone/one-use/expiry/invalidated, DB clock sau lock) → create ordinary PHONE_VERIFIED user → consume proof → CUSTOMER/profile/name/consent → session CUSTOMER → audit/outbox/encrypted result.
User uniqueness quyết định race. CustomerProvisioningParticipant chạy caller TransactionContext. Legacy coordinator không tự grant CUSTOMER; response legacy giữ nguyên.
Hiện participant tạo profile NULL/version1. Claude bổ sung path initialization chỉ cho profile mới của register mới: ghi normalized name với version1 ngay transaction; không biến thành update profile version2, không overwrite profile cũ hay thay semantics participant idempotent. Mapping cụ thể do preflight code, không thêm endpoint profile.
Session creation mới cho active CUSTOMER phải có chủ đích; không đổi default roleless session của legacy. Reuse storage session active_role CUSTOMER đã hỗ trợ.

Audit client.auth.register.v1, safe metadata; outbox client.auth.user_registered.v1 exact payload {user_id,client_app,granted_role:"CUSTOMER",terms_version,privacy_version}; envelope event_id UUID và occurred_at DB time. Một event/commit, không phone/name/proof/password/token. Không thay legacy event.

Dự kiến file mapping:
- apps/backend/src/client-auth/: controller, strict validation, local policy, registration coordinator và identity reader.
- apps/backend/src/auth/: proof/user/session/customer repositories/participant extensions tối thiểu; legacy parser/wire semantics giữ nguyên.
- config/common error registry/module composition: chỉ wiring/pair config/errors cần thiết.
- tests/integration/: API/DB/replay/race/restricted-role; unit tại layer thay đổi.
Không sửa dashboard/PROGRESS/plan.yml, launcher, UI, admin business, schema customer đã merge. Nếu thật sự thiếu DDL prerequisite: báo finding cho ChatGPT trước, không tự mở migration scope.

## 6. Replay và lỗi

Same key/validated logical body → original token/expires_at + CURRENT identity, không consume/create/consent/event lần hai.
Khác logical body cùng key → IDEMPOTENCY_KEY_REUSED409. Không replay qua namespace cũ/mới.
Lookup proof identity không từ chối consumed trước lookup cache: committed original replay phải tới fingerprint/replay guard.
Proof hết TTL sau commit không tự chặn hợp lệ; invalidated proof và user/session eligibility kiểm theo contract11/primitives.
Dưới locks/DB clock kiểm ordinary ACTIVE, session đúng user, không revoked/expired, credential epoch nếu model có; native current binding khi native slice hiện hữu. Engine guard phải chạy trước decrypt/return token.
Token unusable → AUTH_RESULT_NOT_REPLAYABLE409, fixed "The authentication result can no longer be replayed", details:{}; không phục hồi phiên. Identity reader có thể dùng chung cho .04 nhưng không mở endpoint .04.
Replay consent cũ đã commit không tạo acceptance mới hoặc áp cặp cấu hình mới ngược lịch sử.
Không tái kiểm current consent pair trước engine khiến committed replay thất bại sai semantics; first execution vẫn kiểm cặp đã duyệt trước acceptance.
Rollback không để user/role/profile/consent/session/audit/outbox hoặc consumed proof tồn tại nửa chừng.

Errors: BAD_REQUEST400, INVALID_PHONE400, VERIFICATION_PROOF_INVALID400, VERIFICATION_PURPOSE_MISMATCH400, VERIFICATION_PROOF_USED409, PHONE_ALREADY_REGISTERED409; idempotency registry hiện hành; CONSENT_VERSION_UNSUPPORTED409 fixed "The consent versions are not supported"; AUTH_RESULT_NOT_REPLAYABLE409; infrastructure envelopes main.
503 TRANSACTION_OUTCOME_UNKNOWN: giữ original key/body, không key/proof mới tự động. Error không raw exception/PII/token.
Context/login/logout/reset tests chưa endpoint phải ghi chưa triển khai; có thể kiểm replay bằng DB state fixture trong TEST, ghi rõ đây là replay integration chứ không end-to-end reset/logout.

## 7. Acceptance matrix cho Claude

| ID | Ca | PASS bắt buộc |
|---|---|---|
| R01 | FOOD/SHIP register bằng OTP core | user CUSTOMER/name v1/consent DB time/session, identity đúng app |
| R02 | Sai/expired/invalidated/wrong-phone/purpose/used proof | đúng error, không partial rows |
| R03 | Strict parser/name/password boundaries | normalization chính xác; password giữ nguyên; extra keys reject |
| R04 | Missing/malformed key; đổi body/key retry | registry đúng, không duplicate |
| R05 | Concurrent same intent/key và lost response | một commit/token/event/consent, replay đúng |
| R06 | Hai proof cùng phone; legacy vs new | đúng một user thắng, loser không partial state/proof consume |
| R07 | Fault sau mỗi participant/session/audit/outbox | transaction rollback toàn bộ |
| R08 | Replay sau expiry/revoke/disable/credentials change | không trả unusable token, CURRENT identity khi hợp lệ |
| R09 | Grant/shop/driver injection/admin/fixture origins | không đặc quyền, origin guard đúng |
| R10 | Restricted runtime role PG17 | register thành công; consent update/delete/DDL thất bại |
| R11 | Consent mismatch/config drift/replay old accepted pair | first execution reject mismatch; committed replay không rewrite consent |
| R12 | Legacy register/login/me/role select, Admin regression | wire response/namespace/policy cũ không đổi |
| R13 | WEB remote/staging/production; ANDROID no verifier | fail closed trước mutation, không native bypass |
| R14 | REGISTER→inbox .22→verify→register API/DB thật | OTP không public/logged; không fixed/auto-verify |
| R15 | Replay identity khi profile/roles đổi sau register | CURRENT fields dưới consistent transaction; không stale cached quyền |

Lint/typecheck/build/unit và PG17 integration/CI mode phù hợp phải PASS exact final SHA. Target guard DEV5432/TEST5433; destructive suite chỉ TEST. Không chạy trên Owner data/remote.
Báo evidence base/dependency/final SHAs, commands/results/CI, changed files, rollback/race proof, restricted grants và gaps. Không sửa tests chỉ để xanh.
Nội dung/cặp consent test đã được Owner duyệt; R01/R14 Owner acceptance chức năng chưa chạy. CI không nghiệm thu app/module.

## 8. Gói giao Claude

§3 đã được Owner duyệt; dependency kỹ thuật .01/.02/.22 đã tích hợp tại base kiểm kê mới. **Giao Claude triển khai M01.03 backend local**, không còn preflight-only do thiếu .22. Claude vẫn phải refresh main và báo mapping/gaps trước code; nếu không có gap contract thực sự thì tiếp tục triển khai trong cùng task.

> Triển khai duy nhất M01.03 — backend đăng ký CUSTOMER local — trong trungtn87/11ship. Đọc AGENTS.md, CLAUDE.md, docs/process/11ship-delivery-workflow.md, docs/templates/module-delivery-checklist.md, tài liệu này và contract10/11 trên main. Fetch main mới nhất; kiểm dependency .01/.02 và .22 (#64, merge b4877d9deadcad45c6eb60d2b898513e0df5f3e5, CI final 72555763d36f34e76e0b88c65620b2049701828b); báo base/dependency/source SHAs, mapping file thật và gaps. Tạo implementation branch riêng từ main. Nếu tài liệu này chưa merge, mang đúng một file handoff vào nhánh; không kéo cả PR #48 hoặc viết code trên nhánh tài liệu #62.
>
> Thêm POST /v1/client-auth/register theo exact parser/identity/error ở §4–6. Reuse OTP request/verify và TEST_INBOX .22; không OTP cố định, auto-verify hoặc trả OTP qua API sản phẩm. Atomic REGISTER proof/user PHONE_VERIFIED/CUSTOMER/profile tên normalized version1/consent DB time/session CUSTOMER/audit/outbox/encrypted result. Reuse idempotency engine, giữ namespace legacy tách biệt, sensitive replay original token/expires_at và CURRENT identity; unusable token trả AUTH_RESULT_NOT_REPLAYABLE409 trước decrypt/return. Không thay legacy wire response hoặc roleless session mặc định.
>
> Cặp consent local đã được Owner duyệt: test-terms-20261011-v1 / test-privacy-20261011-v1. Wiring cấu hình server hợp lệ theo §3, không bypass/hard-code acceptance. WEB chỉ explicit local dev/test + bind loopback; ANDROID chưa verifier phải fail closed theo contract11. Không triển khai .04/login/me/context/logout, UI, reset, onboarding quán/shipper, native binding, SMS vendor, inbox hoặc launcher mới. Không làm lại migration .02; thiếu DDL prerequisite phải báo finding trước.
>
> Chạy R01–R15 với API/PG17 thật và restricted runtime role; lint/typecheck/build/unit/integration local+CI mode và các hồi quy workflow phù hợp phải xanh trên exact final SHA. Suite phá dữ liệu chỉ dùng TEST, không Owner DEV data hoặc DB remote. Nếu môi trường local thiếu toolchain/dependency, ghi rõ chưa chạy và dùng CI để cung cấp bằng chứng, không giả PASS. Trả Draft PR riêng, evidence base/dependency/final SHAs, commands/results/CI, mapping endpoint, rollback/race/replay/grants và runbook local request OTP → công cụ PC → verify → register. Runbook là hướng dẫn thử backend, không phải nghiệm thu UI/app.
>
> ChatGPT review và giao sửa finding; sau CI/review hết blocker sẽ merge gói nhỏ theo ủy quyền hiện hành. Claude không tự merge/deploy/apply migration remote/auto-merge/đóng M01 hoặc tự sang gói tiếp theo.

CODE_READY_LOCAL là trạng thái **gói thiết kế có thể giao code**, không chứng nhận endpoint đã triển khai, Owner đã chạy PC/phone, D02 native đã đạt hoặc M01 đã hoàn thành.
ChatGPT review đúng final SHA; mọi finding code do Claude sửa; merge gói nhỏ theo workflow hiện hành sau PASS.

## 9. Gate từng app

| Bề mặt | Vai trò gói | UI | Code/CI/review | Owner local | Phone | Nghiệm thu |
|---|---|---|---|---|---|---|
| Web Admin | Hồi quy auth độc lập | Không sửa trong gói | Chưa chạy gói mới | Chưa chạy | Chưa chạy | Chưa |
| 11Food khách | Registration API/consent | Nối UI task sau | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |
| 11Food quán | CUSTOMER trước onboarding shop | Không cấp SHOP ở đây | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |
| 11Ship shipper | CUSTOMER trước hồ sơ shipper | Không cấp DRIVER ở đây | Chưa triển khai | Chưa chạy | Chưa chạy | Chưa |
| Liên thông | phone uniqueness/proof/legacy/new | Backend scope | Chưa chạy | Chưa chạy | Chưa chạy | Chưa |

Backend-only không thêm ảnh màn hình; không miễn UI/local/phone của module. Ngày 11/10/2026 đã inspect ba ảnh Owner đính kèm: 1000002801(1).jpg (bảng nhận diện/slogan), 1000002790.jpg (bảng nhận diện và màu), 1000002796.jpg (logo 11). Đây là nguồn nhận diện cho các task UI sau, không phải ảnh màn hình M01.03 hoặc bằng chứng test chức năng. Giữ guideline đã chốt trên main; không dùng mô tả phân chia app/slogan cũ trong ảnh để thay kiến trúc hiện hành 11Food khách + quán / 11Ship shipper.
