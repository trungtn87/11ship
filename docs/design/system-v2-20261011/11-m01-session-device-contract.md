# M01.01 — hợp đồng login/context/replay và binding thiết bị

Phiên bản 2.0.4, 11/10/2026. Thiết kế ChatGPT; Claude code/test; ChatGPT review; Owner test local/phone và LOCK. Owner đã duyệt D02 ngày 11/10 09:44; ủy quyền merge gói nhỏ sau CI/review ngày 11/10 10:59.
Nguồn: contract10, preflight #52, code available-roles.ts/session-repository.ts trên main; schema M01.02 merge 88c3d3d39c96c78a79fa2823a7587eb216c81739.
Tài liệu này ưu tiên contract10 cho login/context/replay/session. Không chứng nhận code đã có hoặc D03 runtime/APK/signing đã được cấu hình.
Trạng thái: CONTRACT_COMPLETE cho các điểm còn thiếu M01.01. CODE_READY_LOCAL cho M01.03/.04 sau dependency và consent test. Native protocol đã thiết kế; runtime/signing/certificate allowlist và chứng cứ thiết bị là gate cấu hình/implementation D03 trước native rollout, không phải câu hỏi nghiệp vụ D02 còn mở.

## 1. Identity và quyền

Không thêm tài khoản/role store thứ hai. Ordinary eligible: PHONE_VERIFIED, phone_verified_at khác NULL, không admin_memberships; enabled để truy cập: users.status ACTIVE.
Public contexts CUSTOMER/SHOP_OWNER/DRIVER; storage SHOP_OWNER→SHOP. Role array thứ tự CUSTOMER,SHOP_OWNER,DRIVER.
available_roles là SELECTABLE contexts, không phải toàn membership. CUSTOMER cần hàng CUSTOMER; SHOP_OWNER giữ eligibility selectable SHOP main (own shop ACTIVE); DRIVER giữ profile not CLOSED và role DRIVER. Stray membership không selectable.
capabilities tính theo identity enabled, membership và own profile hiện hành; không lấy từ app label hay active context:
- customer_access: ordinary enabled + CUSTOMER.
- shop_profile_read: ordinary enabled + own shop tồn tại, kể cả INCOMPLETE/DISABLED; không tự cấp SHOP.
- shop_manage: ordinary enabled + SHOP membership + own shop ACTIVE. Endpoint manage còn đòi active context SHOP.
- driver_profile_read: ordinary enabled + own driver tồn tại, kể cả CLOSED; không có quyền nhận đơn/tiền.
Mọi action phải recheck quyền tại transaction, capability trong response chỉ hướng dẫn UI.

## 2. Exact identity response

Tất cả success JSON {data:...}, no-store; ISO UTC; errors theo registry, không raw exception.
Identity exact fields:
user_id UUID; phone_normalized string; available_roles enum[]; active_role enum|null;
profile:{full_name:string|null,version:positive-safe-integer|null};
capabilities:{customer_access:boolean,shop_profile_read:boolean,shop_manage:boolean,driver_profile_read:boolean};
onboarding:{shop:"NOT_STARTED"|"INCOMPLETE"|"COMPLETED",driver:"NOT_STARTED"|"PENDING_APPROVAL"|"ACTIVE"|"SUSPENDED"|"CLOSING"|"CLOSED"};
onboarding_required:boolean; role_selection_required:boolean.
Không suy status DRIVER API từ enum DB khác: reuse mapper eligibility main.
onboarding_required app-specific: FOOD true khi thiếu CUSTOMER/profile; SHIP true chỉ khi driver onboarding NOT_STARTED. PENDING/SUSPENDED/CLOSED không bắt đăng ký lại. Đây là routing hint, không grant.
role_selection_required true khi active_role null và available_roles không rỗng.
Effective role stale trả null, không tự chuyển CUSTOMER trong GET, không sửa DB để giấu state.
Existing customer profile chưa có tên: profile.full_name null/version hiện có; UI yêu cầu bổ sung riêng, không lấy drivers.full_name.

## 3. Endpoint contracts M01.04

POST /v1/client-auth/login operation client.auth.login.v1; exact {phone,password,device}; Idempotency-Key bắt buộc ở API mới. Register parser giữ contract10.
device exact {device_id,platform,app}; WEB/ANDROID, FOOD/SHIP. ANDROID thêm proof qua headers protocol §7, không thêm arbitrary body field.
Kiểm credentials ngoài lock, dưới user root lock recheck hash/credential epoch và status/origin trước create session; không session bằng password cũ sau reset.
Login FOOD: chọn CUSTOMER nếu selectable, nếu không active null. SHIP: chọn DRIVER nếu selectable, nếu không CUSTOMER nếu selectable, nếu không null. Không tự grant/backfill trong login; eligible legacy account mới tạo sau migration mà thiếu CUSTOMER: null + FOOD onboarding_required, UI không tự onboarding quán. Việc repair CUSTOMER theo participant ở slice migration/login repair riêng cần evidence, không silently auto grant.
Response200 identity + access_token opaque + session:{expires_at ISO}. TTL reuse 604800s absolute, không refresh. Register201 cũng thêm session:{expires_at}; identity đăng ký SHIP onboarding_required true (cần hồ sơ xế), FOOD false. Supersedes register boolean false chung trong contract10.
Login same key/body: không create phiên thứ hai; replay §5. New login key cùng app trên cùng binding thay thế phiên app đó; app kia giữ. Credentials sai/admin/nonordinary→INVALID_CREDENTIALS401 với dummy hash; enabled ordinary credentials đúng nhưng disabled→ACCOUNT_DISABLED403 theo policy main.
GET /v1/client-auth/me: Bearer, không body,200 identity + session:{expires_at}; không token, không mutation/audit.
POST /v1/client-auth/context operation client.auth.context.v1: Bearer, Idempotency-Key, exact {context:enum}.200 same shape me.
Context không grant; USER root lock→session lock→profile/eligibility recheck→active role update/audit cùng transaction.
Không selectable→ROLE_NOT_AVAILABLE403. App FOOD không chọn DRIVER, app SHIP không chọn SHOP_OWNER; CUSTOMER selectable được cả hai. ROLE_NOT_AVAILABLE403 không tiết lộ khác biệt ownership.
Chuyển Food CUSTOMER↔SHOP không revoke Ship. Legacy SHOP uniqueness vẫn giữ: chọn SHOP revoke other SHOP-context legacy sessions theo policy main, không revoke DRIVER/CUSTOMER. Mỗi native app chỉ một current session nên không có hai Food native SHOP cùng binding.
GET /driver/me và customer/profile giữ task riêng, không mở role/manage bằng read capability.
Logout exact contract10, audit một lần; token known expired/revoked204, unknown401; native vẫn cần proof của key bound token, logout không bypass proof.

## 4. Context replay, concurrency và events

Không phục hồi context cũ từ cached response: replay context tái kiểm quyền và trả CURRENT identity (200), không apply lại update. Replay cùng key sau một context change mới không chuyển ngược.
Nếu requested context không còn selectable,403 ROLE_NOT_AVAILABLE; session revoked/expired401. Không ghi audit mới khi replay.
Audit client.auth.context.v1 payload safe {user_id,session_id,from_context,to_context}; no phone/token. No outbox cho context/me/logout: không có consumer nghiệp vụ, không phát event giả.
Login audit client.auth.login.v1 {user_id,session_id,client_app,binding_id|null}; không outbox. Device replacement event §7.
Lock order giữ coordinator: idempotency→user root→binding/head→sessions sorted UUID→profile eligibility→audit/outbox/result. Existing legacy auth chỉ cần bổ sung guard/revocation tại slice D02 rollout, không đảo lock order.

## 5. Register/login replay có token

Scope/key/body như contract10; login scope tách register/legacy. Replay TTL/encryption/secret storage reuse engine đã có; không plaintext token trong DB/audit/outbox.
Sau cache lookup, lấy identity/user/binding/session lock và DB clock, kiểm user ACTIVE/origin ordinary, session chưa revoke/chưa expire, credential epoch khớp, native binding current và key đúng.
Đủ điều kiện: trả original access_token và original expires_at, CURRENT identity (không snapshot roles/capabilities cũ), không create session/proof/consent/event lần hai.
Token unusable:409 AUTH_RESULT_NOT_REPLAYABLE, fixed "The authentication result can no longer be replayed", details:{}; không token/PII, không revoke thêm/khôi phục.
Register đã commit nhưng không replay được: UI hướng dẫn login, không lặp register key mới/proof mới; cached used proof chỉ được đọc trong đúng scope/key/fingerprint kết quả original, không đi lại validation consume path.
Replay window hết: IDEMPOTENCY_REPLAY_EXPIRED409; không recreate bằng same key. Login mới là intent mới do user xác nhận, không transport auto retry.
Invalid credentials business error không thay devices. Unknown commit503 TRANSACTION_OUTCOME_UNKNOWN; giữ key/body, nhận nonce native mới để thử replay; không tự reset proof/binding.
Expiry/logout/reset/replacement phải kiểm trước decrypt/return token; replay và revoke serialize dưới user/session locks. In-flight request đã commit trước revoke giữ kết quả; sau revoke guard không cho business commit.
Cached record subject/key binding đủ để kiểm lại quyền; nếu engine hiện không có hook, Claude bổ sung extension trong scope, không bypass cache guard.

## 6. Web local vs native rollout

LOCAL_WEB mode chỉ khi explicit development/test environment + bind loopback, FOOD/SHIP WEB; token memory, F5 login lại. Không tạo Android binding, không revoke native session, không chứng nhận one-device. Production từ chối platform WEB trên client-auth bằng DEVICE_PROOF_REQUIRED403.
Native proof feature gate: ANDROID không có proof hợp lệ luôn fail closed; không dev-id fallback. Server chưa triển khai verifier→SERVICE_UNAVAILABLE503, không session.
Legacy /auth wire contract giữ nguyên ở local compatibility. Native release D02 chỉ bật sau tất cả ordinary session issuance/guards (kể cả legacy) enforce binding hoặc legacy mobile issuance bị vô hiệu trong release bằng policy đã review. Không để legacy login trở thành đường bỏ qua one-device. Admin sessions độc lập.
M01.03/.04 local không chờ native APK; phải ghi rõ D02 native chưa được chứng minh.

## 7. Binding Android — protocol framework-neutral

Hai package ký cùng release signer, certificate/package allowlist server + native bridge config được pin theo environment. Không trust ANDROID_ID/client device_id/advertising/IMEI. Android user/profile khác là thiết bị đăng nhập khác trong policy; factory reset/clear both apps/reinstall mất khóa coi là new binding.
Mỗi app generate ECDSA P-256 key không export trong Android Keystore, purpose SIGN/SHA-256, random server attestation challenge. Production require attested TEE/StrongBox, verified boot locked, app package/signer allowlist. Kiểm chain/root/revocation/challenge/key/public key/package trên server; roots/revocation snapshot valid tối đa24h, failure→503, không network dưới transaction lock.
Unsupported phone→DEVICE_PROOF_UNSUPPORTED403, không âm thầm software fallback; Owner có thể thiết kế compatibility tier riêng sau actual phone test, không suy waiver.
Attestation chứng minh key/app/platform theo trust model, không chứng minh unique immutable hardware ID. Logical binding có hiệu lực với OS/keystore và official apps không bị compromise; không hứa chống rooted OS/hardware tuyệt đối.

Hai app có bound service explicit component, signature permission, Binder caller UID→package+signer allowlist kiểm TRƯỚC clearCallingIdentity; không trust caller package string/Intent extras. Chỉ expose signing endorsement cho join challenge cụ thể của server; không generic sign arbitrary bytes, không share password/session token/private key.
App A có current binding; app B tạo attested key và lấy challenge JOIN. A kiểm B qua Binder, xác nhận challenge target app/key/server environment và own current binding, ký endorsement. B cũng ký. Server chỉ join nếu A current và hai proofs hợp lệ + B credentials cho same user.
App đơn lẻ FOOD hoặc SHIP tạo binding được; app thứ hai phát hiện service local rồi join. Nếu không có service/key A (A uninstalled/cleared), B đăng nhập như NEW_BINDING và thay binding cũ; A còn offline mất hiệu lực, không pair theo device_id.
Cùng phone khác signing cert/environment không join; debug/test signer riêng không được production allowlist. Không deprecated sharedUserId hoặc shared plaintext file.

Protocol endpoints prefix /v1/client-auth/device:
POST /challenges exact {app:"FOOD"|"SHIP",purpose:"ENROLL"|"JOIN"|"AUTH",key_id:UUID|null};201 {challenge_id:UUID,nonce:base64url32bytes,expires_at}, expiry120s, limit10/minute/key or network bucket, max body64KiB, no user lookup response.
POST /registrations Idempotency-Key, exact {challenge_id,app,certificate_chain:base64DER[],public_key_spki:base64DER,signature:base64DER,join:null|{binding_id,authorizer_key_id,signature}};201 {device_registration_token,expires_at}. Chain1..8 max total48KiB. Temporary token256-bit random digest store,120s, one-use, app/key/join-bound, not account session.
AUTH registered key flow uses same /registrations with stored attested chain key match; no generate fresh key each login.
Login/register ANDROID headers X-Device-Registration:<token>, X-Device-Signature:<sig>; signature message UTF8 canonical lines "11SHIP-AUTH-V1",environment,method,path,SHA256(raw-body bytes),SHA256(Idempotency-Key bytes),SHA256(registration-token bytes). ECDSA DER base64url, server hashes SHA256 and verifies against key in registration record. Never password hash in logs.
Successful auth transaction consumes registration token, verifies same user for JOIN, assigns key/session/binding atomically. On idempotent auth replay token consumed allowed only exact original operation/key/body/session/key; no fresh issuance. Replays still require fresh request proof §8 to avoid arbitrary captured request reuse.
For enrollment new logical binding server-generated UUID, no claimed binding accepted. JOIN not same user403 DEVICE_PROOF_INVALID fixed generic.
Challenge signing format registration: UTF8 lines "11SHIP-REGISTER-KEY-V1",environment,challenge_id,nonce,app,SHA256(SPKI),binding_id-or-empty,authorizer_key_id-or-empty. Join authorizer signs same message prefix "11SHIP-JOIN-KEY-V1". Challenge consumed under row lock; chain validation precomputed, recheck validity/expiry before commit.
Rate/error status: BAD_REQUEST400 shape; DEVICE_PROOF_INVALID403 signature/chain/unknown registration uniform; DEVICE_PROOF_EXPIRED403 challenge/temp grant expired; DEVICE_PROOF_REQUIRED403; DEVICE_PROOF_UNSUPPORTED403; DEVICE_RATE_LIMITED429 fixed message + typed Retry-After; SERVICE_UNAVAILABLE503 verifier snapshot/dependency. No current user/device details on public endpoints.

## 8. Proof từng request và thay thiết bị

Every native authenticated request headers X-Device-Key-Id UUID, X-Device-Time integer unix seconds, X-Device-Nonce base64url32bytes, X-Device-Signature base64urlDER.
Message lines UTF8: "11SHIP-REQUEST-V1",environment,key_id,time,nonce,method-uppercase,exact-relative-URL-including-query,SHA256(raw-body bytes),SHA256(Bearer-token bytes),Idempotency-Key-or-empty. Empty body hash SHA256(empty); URL percent escapes byte-exact, no server reconstruction from parsed params.
Time delta≤60s DB clock. Unique(key_id,nonce), TTL120s; duplicate nonce403 DEVICE_PROOF_INVALID. Retry uses fresh nonce/signature, SAME key/body idempotency. Nonce insertion in independent authentication transaction to survive business rollback; no auto retry broken transaction.
Public login/register replay uses same proof format with registration token in bearer-token-hash position, original temp registration ties to key; expiry temp grant applies first execution only, replay key material still stored, signature/time/nonce checked. No authentication by possession of idempotency key alone.
Binding/session relation rechecked with user root in business transaction. One active binding/user; max1 active session per(binding,app). new login same binding/app revokes only that app old session; JOIN creates only other app session.
New binding auth: user FOR UPDATE; revoke all user ordinary app.sessions (including roleless/legacy) + mark prior binding inactive + create new binding/head generation + session/audit/outbox/result same commit. Does not touch admin_sessions.
Concurrent new-device logins serialize; later commit wins, earlier token becomes unusable. Guard compares binding id + generation/head, never merely session.revoked_at or device_id. Old in-flight mutation waiting on user lock fails after replacement.
Outbox client.auth.device_replaced.v1 exact {user_id,old_binding_id,new_binding_id,generation}; event_id/occurred_at envelope, no model/GPS/phone/token. Consumer notification optional; authorization never waits for push.
Push/GPS future credentials tied generation too; native app on401 clear sensitive UI/token, leave private key for login; show “Tài khoản đã được đăng nhập trên thiết bị khác” only authenticated revoked reason available, otherwise generic login message.

## 9. Binding storage contract

Append-only migration separate from M01.02. Names under app:
client_device_challenges(challenge_id UUID PK, nonce_digest bytea unique, app varchar4 CHECK, purpose CHECK, key_id nullable, expires_at timestamptz, consumed_at nullable, created_at). Auth public challenge metadata only; no phone.
client_device_keys(key_id UUID PK server, public_key_spki bytea unique, app CHECK, signer_sha256 bytea32, package_name varchar200, attestation_level CHECK TEE/STRONGBOX, verified_at, revoked_at nullable). Canonical key/hash duplicate cannot get multiple key_ids.
client_device_registration_grants(grant_id UUID PK,token_digest bytea32 unique,key_id FK,join_binding_id nullable FK,authorizer_key_id nullable FK,expires_at,consumed_at,consumed_operation_id nullable). Join fields both present or bothnull; consumed fields consistent.
client_device_bindings(binding_id UUID PK,user_id FK users(user_id) RESTRICT,generation bigint safe-positive,activated_at,deactivated_at nullable). UNIQUE(user_id,generation); partial unique(user_id) WHERE deactivated_at IS NULL.
client_device_key_links(binding_id FK,key_id FK,user_id FK,app CHECK, PRIMARY KEY(binding_id,app), UNIQUE(key_id)); same-user integrity composite FKs to bindings/users, key app composite FK; registration grants don't link to user until auth.
client_session_bindings(session_id UUID PK/FK sessions RESTRICT,binding_id FK,key_id FK,app CHECK,generation safe-positive,is_current boolean). Composite FK(binding_id,key_id,app)→key links (add unique); unique partial(binding_id,app) WHERE is_current. Generation relation composite FK(binding_id,generation)→bindings. Revoke session atomically sets is_current false. Root user verified from binding and session, no client supplied user.
client_device_request_nonces(key_id FK,nonce_digest bytea32,expires_at,PRIMARY KEY(key_id,nonce_digest)); expire cleanup bounded worker, never accept same nonce during time-valid interval.
Server generates IDs/time/generation. bytea32 CHECK octet_length=32. Challenge/nonce random256bits. All current-state mutations version/check/root lock; runtime SELECT/INSERT/UPDATE for lifecycle tables, links INSERT/SELECT only, no runtime DELETE except dedicated cleanup operator for expired challenges/grants/nonces; separate credential, no business cleanup via account API.
Futures key rotation/reinstall handled new binding, no same-device claim migration. Do not write migration in design.
Physical table migration and integration test slice .21 maps existing table names/indexes; no reuse M08 device_bindings as conflicting second source. These M01 bindings become shared auth owner for GPS/push later.

## 10. Test acceptance và CODE_READY boundary

Local .03/.04: exact parser/errors; legacy response; context eligibility/stale state; Food vs Ship onboarding; all capability truth tables; old/new phone race; transaction rollback; replay expired/revoked/reset/binding-replaced; concurrent login/context/logout/reset and unknown response; no PII/token logs; runtime grants. PG17 and API real.
Native .21: valid/bad/expired/revoked chains, trust root rollover, failed cache, unsupported TEE; challenge/key/app/env substitution; generic signing IPC refused; caller UID/signature spoof; same-phone two apps same device coexist; two physical phones replace; same device app-login only replaces app; clear/reinstall/factory reset/work-profile; replay nonce/body/query tamper; stolen token without key denied; crash/lost response no duplicate issuance; legacy bypass denied; local web unreachable on production.
Phone actual Owner on two phones, both app install orders, Android background/offline recovery; no PC equivalence claim.
G4 test consent content/version remains explicit prerequisite .03; production consent/SMS deferred release. D03 runtime/package/cert values must be selected by native build task before phone code; protocol decisions now exact and framework-neutral. M01.01 contract work complete, no claim app code/local/phone or module LOCK.
