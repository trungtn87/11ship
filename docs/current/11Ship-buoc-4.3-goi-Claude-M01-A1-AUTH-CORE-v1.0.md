# 11Ship — Bước 4.3
## Gói triển khai Claude — M01-A1-AUTH-CORE v1.0

**Trạng thái:** DESIGN — register replay addendum 07/10/2026 chờ Owner duyệt  
**Phụ thuộc bắt buộc:** Bước 4.1 M00-A + Bước 4.2 M01-A v1.0  
**Package ID:** `M01-A1-AUTH-CORE`  
**Mục tiêu:** giao Claude một gói code nhỏ, khép kín và có test contract rõ ràng; không cho phép tự mở rộng nghiệp vụ sang Shop, Driver, Wallet, Delivery hoặc Admin.


> **Register replay clarification — 07/10/2026, ADR-003 v0.3:** ADR-001/002 khóa stack/session; ADR-003 v0.3 §13 chi phối transactional replay và có ưu tiên với các câu used/expired proof hoặc transaction order bên dưới. New execution phải reject proof used/expired; replay kết quả đã commit không phải consume proof lần hai. Chưa Owner lock revision thì chưa CODE_READY.

---

## 1. Mục tiêu của package

Claude phải triển khai phần Auth Core đủ để hệ thống thực hiện được chuỗi:

`request OTP -> verify OTP -> one-time proof -> register roleless user -> login -> /me -> select role -> enforce SHOP single-device session`

Package này phải chứng minh được:

1. Một số điện thoại chỉ tạo được một `user`.
2. OTP và verification proof chỉ sử dụng một lần.
3. Register không cấp role từ dữ liệu client.
4. User chưa có role vẫn đăng nhập được.
5. Một user có thể có nhiều role được seed/fixture sẵn để test.
6. Client chỉ chọn được role thực sự thuộc user.
7. SHOP chỉ có một SHOP session active trên một thiết bị tại một thời điểm.
8. Revoke SHOP session không làm chết DRIVER session của cùng user.
9. Các quy tắc concurrency/idempotency được test bằng integration test, không chỉ unit test.

---

## 2. Nguồn sự thật và thứ tự ưu tiên

Khi code có mâu thuẫn, Claude phải ưu tiên theo thứ tự:

1. `Bước 4.2 — M01-A v1.0` — contract nghiệp vụ Auth/Onboarding.
2. `Bước 4.1 — M00-A` — quy ước nền, ownership, migration, module boundary.
3. Contract/API/schema đã tồn tại trong repo và không mâu thuẫn với 4.1/4.2.
4. Code cũ.

Claude **không được tự sửa đặc tả nghiệp vụ để phù hợp code cũ**.

Nếu code cũ xung đột với 4.1/4.2, phải ghi rõ trong báo cáo cuối và sửa theo đặc tả mới trong phạm vi package.

---

## 3. Preflight bắt buộc trước khi viết code

Claude phải đọc repo trước và báo ngắn gọn:

- backend hiện dùng framework/runtime nào;
- PostgreSQL đã được cấu hình chưa;
- ORM/query layer/migration tool hiện tại là gì;
- auth/token/session infrastructure hiện tại là gì;
- test runner + integration test setup hiện tại là gì;
- idempotency infrastructure đã có chưa;
- config/secrets pattern hiện tại;
- module/folder convention hiện tại;
- API prefix hiện tại có đúng `/v1` không.

### 3.1 Không được tự chọn nền công nghệ còn thiếu

Hướng nền đã có: modular backend + PostgreSQL, NestJS là hướng backend kế thừa từ M00-A.

Tuy nhiên package này **không được tự quyết định** nếu repo chưa khóa:

- ORM;
- JWT hay opaque token;
- token library;
- test framework;
- migration framework;
- thư viện hash cụ thể;
- SMS/OTP provider production.

Nếu một lựa chọn trong số trên là điều kiện bắt buộc để code nhưng repo chưa có quyết định, Claude trả:

`BLOCKED_BY_FOUNDATION`

kèm đúng các quyết định còn thiếu và không tự dựng kiến trúc thay thế.

Fake OTP provider cho test/dev được phép vì đã nằm trong contract 4.2.

---

## 4. Phạm vi ĐƯỢC code

Chỉ gồm:

1. `phone_verifications`.
2. OTP provider interface.
3. Fake OTP provider dùng cho test/dev được gắn nhãn rõ.
4. Verify OTP -> tạo one-time verification proof.
5. `POST /v1/auth/register`.
6. `POST /v1/auth/login`.
7. `GET /v1/auth/me`.
8. `POST /v1/auth/role/select`.
9. Session infrastructure cần thiết cho các endpoint trên.
10. SHOP single-device session rule.
11. Migrations/schema thay đổi đúng phạm vi M01.
12. Fixtures phục vụ test.
13. Unit test nếu cần cho primitive/security logic.
14. Integration test bắt buộc cho A01 + A02.
15. Config keys cần thiết cho OTP TTL/cooldown/attempt/proof TTL.

---

## 5. Phạm vi CẤM code

Claude không được triển khai trong package này:

- Shop onboarding.
- Driver onboarding.
- `shops`, `shop_members`, `drivers`, `driver_service_areas` business logic.
- Driver approval.
- Driver type management.
- Wallet/top-up/withdrawal.
- Delivery/order.
- Customer ordering.
- Admin provisioning.
- SYSTEM driver provisioning.
- 2FA admin.
- Forgot/change password.
- Change phone.
- Refresh token rotation nếu nền hiện tại chưa có sẵn và package contract chưa yêu cầu.
- Logout all devices/revoke-all flow.
- Notification business logic.
- SMS provider production integration.
- UI/mobile code.

Nếu cần role SHOP/DRIVER để test `role/select`, dùng fixture/seed trực tiếp theo test boundary; không tạo onboarding business flow.

---

## 6. Module ownership

M01 Auth sở hữu trong package này:

- `users`
- `user_roles`
- `phone_verifications`
- `verification_proofs`
- `sessions`

Không ghi trực tiếp vào bảng nghiệp vụ M02/M03.

Role trong `user_roles` chỉ có thể xuất hiện trong package qua:

- fixture/test seed;
- dữ liệu có sẵn;
- service boundary được module owner gọi về sau.

`POST /register` tuyệt đối không tạo SHOP/DRIVER/ADMIN/SYSTEM role.

---

## 7. Logical schema contract

Đây là schema logic. Claude phải map vào ORM/query layer hiện có của repo, không tự đổi ý nghĩa field.

### 7.1 `users`

Tối thiểu cần có:

- `id`
- `phone_normalized` — UNIQUE, NOT NULL
- `password_hash` — NOT NULL
- `phone_verified_at` — NOT NULL với user tạo qua REGISTER flow
- `status` — tối thiểu hỗ trợ `ACTIVE`, `DISABLED`
- `created_at`
- `updated_at`

Không lưu:

- plaintext password;
- OTP;
- role active cố định trên user record.

### 7.2 `user_roles`

Tối thiểu:

- `user_id`
- `role`
- `created_at`

Ràng buộc:

- unique `(user_id, role)`;
- package này cần nhận biết `SHOP`, `DRIVER`;
- không cho client tự tạo row qua register/role-select.

### 7.3 `phone_verifications`

Tối thiểu:

- `id`
- `phone_normalized`
- `purpose`
- OTP ở dạng không thể đọc plaintext từ DB (`otp_hash` hoặc mechanism tương đương của nền hiện có)
- `attempt_count`
- `expires_at`
- `resend_not_before`
- trạng thái/markers đủ phân biệt pending, verified, invalidated/locked
- `verified_at` nullable
- `created_at`

Config MVP:

- OTP 6 digits
- TTL 300 seconds
- resend cooldown 60 seconds
- max wrong attempts 5

Các giá trị này phải đi qua config tập trung.

### 7.4 `verification_proofs`

Tối thiểu:

- `id`
- `verification_id`
- `phone_normalized`
- `purpose`
- token/proof lưu dạng an toàn, không cần plaintext recoverable
- `expires_at`
- `consumed_at` nullable
- `created_at`

Proof TTL mặc định: 600 seconds qua config.

Check + consume phải atomic.

### 7.5 `sessions`

Tối thiểu cần biểu diễn được:

- `id`
- `user_id`
- `device_id`
- `platform`
- `app`
- `active_role` nullable
- `status` hoặc revoke marker
- `revoked_at` nullable
- `created_at`
- `updated_at`/`last_seen_at` nếu nền hiện tại dùng

Token implementation cụ thể theo nền repo, không khóa tại document này.

Session phải đủ để server kiểm tra:

- user hiện tại;
- role context hiện tại;
- session revoked;
- device;
- single-device SHOP invariant.

---

## 8. API contract phải giữ nguyên

### 8.1 Request OTP

`POST /v1/auth/phone-verifications`

Request:

```json
{
  "phone": "0987654321",
  "purpose": "REGISTER"
}
```

Response `201`:

```json
{
  "data": {
    "verification_id": "pv_...",
    "expires_in_seconds": 300,
    "resend_after_seconds": 60
  }
}
```

Bắt buộc:

- normalize phone;
- nếu REGISTER và phone đã tồn tại -> `PHONE_ALREADY_REGISTERED`;
- rate limit theo tối thiểu phone + request context khả dụng (IP/device theo nền hiện có);
- không log OTP plaintext.

### 8.2 Verify OTP

`POST /v1/auth/phone-verifications/{verification_id}/verify`

Request:

```json
{
  "otp": "123456"
}
```

Response `200`:

```json
{
  "data": {
    "verification_token": "vp_...",
    "purpose": "REGISTER",
    "expires_in_seconds": 600
  }
}
```

Không phát proof khi:

- OTP sai;
- OTP hết hạn;
- quá số lần thử;
- verification đã verify/invalidate;
- request vi phạm single-use invariant.

### 8.3 Register

`POST /v1/auth/register`

Header:

`Idempotency-Key: <uuid>`

Request:

```json
{
  "phone": "0987654321",
  "password": "********",
  "verification_token": "vp_...",
  "device": {
    "device_id": "device-uuid",
    "platform": "ANDROID",
    "app": "11SHIP"
  }
}
```

Strictly forbidden input:

- `role`
- `driver_type`
- `is_admin`
- `permissions`

Ưu tiên reject unknown/forbidden security-sensitive fields theo validation convention hiện có của repo; tuyệt đối không được cấp quyền dù client gửi field lạ.

Transaction:

1. lock proof;
2. validate proof chưa consume, đúng phone, đúng `REGISTER`, chưa hết hạn;
3. verify phone chưa tồn tại;
4. create user;
5. consume proof;
6. create roleless session;
7. commit.

Response `201`:

```json
{
  "data": {
    "user_id": "usr_...",
    "phone_normalized": "+84987654321",
    "available_roles": [],
    "active_role": null,
    "onboarding_required": true,
    "access_token": "..."
  }
}
```

### 8.4 Login

`POST /v1/auth/login`

Request:

```json
{
  "phone": "0987654321",
  "password": "********",
  "device": {
    "device_id": "device-uuid",
    "platform": "ANDROID",
    "app": "11SHIP"
  }
}
```

Sai phone hoặc sai password đều trả chung:

`401 INVALID_CREDENTIALS`

Roleless login hợp lệ phải thành công.

Nếu user có nhiều role:

```json
{
  "data": {
    "user_id": "usr_...",
    "available_roles": ["SHOP", "DRIVER"],
    "active_role": null,
    "role_selection_required": true,
    "access_token": "..."
  }
}
```

### 8.5 Select role

`POST /v1/auth/role/select`

Request:

```json
{
  "role": "SHOP"
}
```

Bắt buộc:

- role phải tồn tại trong `user_roles`;
- role phải được hỗ trợ bởi endpoint;
- không cho client chọn ADMIN/SYSTEM;
- session context được cập nhật/phát lại theo mechanism hiện tại.

### 8.6 Me

`GET /v1/auth/me`

Trong package A1 chưa triển khai onboarding business state của M02/M03, vì vậy response phải trả tối thiểu identity + roles + active role/session context theo contract hiện có.

Không được giả lập `COMPLETED/PENDING_APPROVAL` bằng dữ liệu bịa nếu M02/M03 chưa tồn tại. Nếu interface onboarding-state đã có, gọi qua interface; nếu chưa có, để field onboarding theo contract tối thiểu đã thống nhất trong repo hoặc ghi TODO contract cho A2, không tạo bảng Shop/Driver trong A1.

---

## 9. SHOP single-device invariant

Rule áp dụng cho **SHOP role context**, không áp dụng toàn user.

Khi session trên device B chọn SHOP:

1. lock/serialize đủ để bảo vệ invariant;
2. tìm SHOP session active trước của cùng user;
3. revoke SHOP session cũ nếu nằm trên device/session khác;
4. activate SHOP trên session mới;
5. commit;
6. từ request tiếp theo, session cũ phải trả `SESSION_REVOKED`.

Không được revoke DRIVER session của user.

Sau request hoàn tất, không được tồn tại hai SHOP sessions active cho cùng user.

Concurrency test phải chứng minh invariant này.

---

## 10. Password + OTP security requirements

### Password

- min 8 chars;
- max 128 chars theo Bước 4.2;
- adaptive hash qua abstraction của nền hiện có;
- plaintext password không bao giờ lưu DB/log;
- comparison phải dùng password service hiện có/được abstraction hóa.

### OTP

- không lưu plaintext OTP nếu database bị đọc;
- không log OTP ở production path;
- FakeOtpProvider chỉ có thể bật trong test/dev configuration được nhận diện rõ;
- production không fallback im lặng sang fake provider.

### Proof

- proof phải đủ ngẫu nhiên theo secure random primitive của runtime;
- DB không cần lưu token plaintext recoverable;
- consume một lần;
- expired/used proof không được register.

---

## 11. Error contract

Format:

```json
{
  "error": {
    "code": "OTP_INVALID",
    "message": "...",
    "details": {}
  }
}
```

Package A1 phải hỗ trợ tối thiểu:

| HTTP | Code |
|---|---|
| 400 | INVALID_PHONE |
| 400 | OTP_INVALID |
| 400 | OTP_EXPIRED |
| 409 | OTP_ALREADY_USED |
| 429 | OTP_RATE_LIMITED |
| 409 | PHONE_ALREADY_REGISTERED |
| 400 | VERIFICATION_PROOF_INVALID |
| 409 | VERIFICATION_PROOF_USED |
| 400 | VERIFICATION_PURPOSE_MISMATCH |
| 401 | INVALID_CREDENTIALS |
| 403 | ACCOUNT_DISABLED |
| 403 | ROLE_NOT_AVAILABLE |
| 401 | SESSION_REVOKED |

Client branching theo `error.code`, không theo message.

---

## 12. Idempotency + concurrency

### Register idempotency

Cùng `Idempotency-Key` + cùng logical request:

- không tạo user/session lần hai;
- trả lại cùng logical result;
- không consume proof lần hai gây lỗi cho retry hợp lệ.

Nếu repo đã có idempotency infrastructure, bắt buộc reuse.

Nếu chưa có infrastructure và implementation cần một quyết định nền, Claude không tự tạo một hệ thống generic mới ngoài scope; báo blocker rõ ràng.

### Database uniqueness

`users.phone_normalized` UNIQUE là lớp bảo vệ cuối.

Hai request concurrent cùng phone nhưng khác idempotency key:

- tối đa một user tồn tại;
- request còn lại map thành contract error phù hợp, không leak lỗi SQL/raw exception.

### Proof

Read/check/consume proof phải nằm trong cùng transaction/locking strategy phù hợp với persistence layer hiện tại.

---

## 13. Fixtures bắt buộc

- `user_roleless`
- `user_shop`
- `user_driver_pending` — chỉ identity + DRIVER role cần cho Auth Core test; không cần tạo driver business table nếu M03 chưa có
- `user_shop_driver`
- `verification_register_valid`
- `verification_register_expired`
- `verification_proof_used`
- `shop_session_device_A`

Nếu fixture cần profile data mà module owner chưa tồn tại, chỉ seed phần dữ liệu tối thiểu cần cho Auth Core và không giả lập business approval.

---

## 14. Acceptance tests bắt buộc — A01 + A02

Claude phải map **1 test ID = ít nhất 1 assertion path rõ ràng**.

### A01 — OTP/Register

- `A01-01` OTP đúng -> nhận proof.
- `A01-02` OTP sai -> không nhận proof.
- `A01-03` OTP hết hạn -> fail.
- `A01-04` OTP/verification dùng lại -> fail.
- `A01-05` proof sai purpose -> fail.
- `A01-06` proof hết hạn -> fail.
- `A01-07` proof consume rồi dùng lại -> fail.
- `A01-08` hai request register đồng thời cùng phone -> đúng một user.
- `A01-09` retry cùng Idempotency-Key -> cùng logical result, không duplicate.
- `A01-10` client gửi `role=ADMIN` hoặc `driver_type=SYSTEM` -> tuyệt đối không phát sinh quyền.
- `A01-11` register thành công -> login được với `available_roles=[]`.

### A02 — Login/Role/Session

- `A02-12` phone/password đúng -> login thành công.
- `A02-13` sai password -> `INVALID_CREDENTIALS`.
- `A02-14` roleless -> login thành công, onboarding required.
- `A02-15` SHOP+DRIVER -> trả cả hai role, active_role null trước khi chọn.
- `A02-16` chọn role không sở hữu -> 403.
- `A02-17` chọn SHOP trên device B -> SHOP session device A bị revoke.
- `A02-18` DRIVER session cùng user không bị revoke khi SHOP chuyển device.
- `A02-19` request bằng revoked SHOP session -> 401 `SESSION_REVOKED`.

Ngoài 19 test contract trên, Claude được thêm test kỹ thuật, nhưng không thay thế/xóa test contract.

---

## 15. Test evidence bắt buộc khi bàn giao

Claude phải cung cấp:

1. command chạy migration/test;
2. test summary pass/fail;
3. danh sách test ID A01/A02 và file test tương ứng;
4. evidence rằng password/OTP không lưu plaintext;
5. evidence concurrent register chỉ tạo một user;
6. evidence proof single-use;
7. evidence SHOP single-device nhưng DRIVER session còn sống;
8. migration list đã tạo;
9. không sửa migration đã apply trước đó;
10. danh sách file changed.

Không chấp nhận câu “tests should pass”; phải chạy và báo kết quả thực tế nếu môi trường cho phép.

---

## 16. Cấu trúc code mong muốn

Claude **ưu tiên convention đang có trong repo**.

Nếu repo dùng NestJS modular convention, logical decomposition nên tương đương:

```text
apps/backend/
  src/
    modules/
      auth/
        controllers/
        services/
        repositories/
        dto/
        guards/
        providers/
        domain/
        auth.module.*
```

Tên folder/file cụ thể có thể theo convention repo; không tái cấu trúc toàn backend chỉ để giống ví dụ.

Migration nằm ở location đã chuẩn hóa bởi M00-A/repo.

Tests integration nằm theo convention repo; nếu nền M00-A layout đang dùng `tests/integration/`, ưu tiên giữ đúng.

---

## 17. Interface boundaries nên có

Tên cụ thể tùy convention repo, nhưng code phải có separation tương đương:

- `PhoneNormalizer`
- `OtpProvider`
- `PasswordHasher` / password service
- `VerificationService`
- `AuthService`
- `SessionService`
- `RoleContextService`
- persistence repositories/ports theo architecture hiện tại

Mục tiêu là:

- production OTP provider thay được mà không sửa business flow;
- test dùng fake OTP provider;
- hashing/token/persistence không nằm lẫn trong controller;
- controller chỉ parse/validate/dispatch/map response.

Không tạo abstraction thừa nếu repo đã có service tương đương.

---

## 18. Logging / audit / privacy

Không log:

- password;
- password hash;
- OTP;
- full verification token/proof;
- access token.

Có thể log masked phone và event metadata theo logging convention hiện tại.

Security-sensitive events nên có audit/event record nếu nền audit đã tồn tại:

- OTP verification locked/rate-limited;
- register success/failure category;
- account disabled login attempt;
- SHOP session revoked do device switch.

Không dựng audit subsystem mới nếu chưa thuộc foundation.

---

## 19. Điều kiện dừng — Claude không được tự xử lý

Claude phải dừng và báo blocker nếu gặp một trong các trường hợp:

1. repo chưa có backend foundation đủ để xác định framework/runtime;
2. persistence layer chưa có và cần chọn ORM/query stack mới;
3. migration tool chưa có và cần chọn mới;
4. token/session mechanism chưa có nhưng implementation bắt buộc phải chọn kiến trúc token;
5. test infrastructure chưa có và cần chọn framework mới;
6. API prefix/convention trong repo xung đột trực tiếp với M00-A/4.2 và sửa sẽ vượt package;
7. cần thay đổi Shop/Driver/Wallet/Delivery schema để Auth Core chạy;
8. cần quyết định nghiệp vụ không có trong 4.1/4.2.

Báo cáo blocker theo format:

```text
BLOCKED_BY_FOUNDATION
- Missing decision:
- Why required:
- Files/evidence inspected:
- Smallest decision needed from system designer:
```

Không “tự chọn tạm” rồi tiếp tục.

---

## 20. Deliverables Claude phải trả

Bàn giao package phải có đủ:

1. source code hoàn chỉnh trong scope;
2. migration mới;
3. fixtures;
4. integration tests A01/A02;
5. unit tests cần thiết;
6. config keys/documentation;
7. fake OTP provider test/dev;
8. changed-file manifest;
9. command để setup/migrate/test/run;
10. test result thực tế;
11. unresolved issues/blockers;
12. không có file unrelated bị sửa vô cớ.

Không yêu cầu Claude viết tài liệu dài về kiến trúc; ưu tiên code + evidence + diff dễ review.

---

## 21. Definition of Done — M01-A1

Package chỉ được PASS khi đồng thời:

- build/typecheck/lint theo repo pass;
- migration chạy sạch trên test DB;
- A01-01 -> A01-11 pass;
- A02-12 -> A02-19 pass;
- unique phone invariant pass dưới concurrent test;
- proof single-use pass dưới concurrent/retry scenario;
- roleless login pass;
- client không thể tự cấp ADMIN/SYSTEM/driver type;
- SHOP single-device invariant pass;
- DRIVER session không bị revoke nhầm;
- revoked session bị chặn server-side;
- không log/store plaintext secrets;
- không code vượt scope;
- review của ChatGPT không phát hiện contract drift.

---

## 22. Prompt hoàn chỉnh giao Claude

Dùng nguyên khối dưới đây khi giao task cho Claude:

```text
TASK: 11Ship / M01-A1-AUTH-CORE

Bạn đang triển khai một package nhỏ trong hệ thống 11Ship. Không được tự mở rộng phạm vi.

AUTHORITATIVE SPECS:
1. Bước 4.1 M00-A — nền triển khai/module ownership/migration conventions.
2. Bước 4.2 M01-A v1.0 — Auth + onboarding contract.
3. Bước 4.3 M01-A1-AUTH-CORE v1.0 — package implementation contract này.

MỤC TIÊU:
Triển khai:
request OTP -> verify OTP -> one-time verification proof -> generic roleless register -> login -> /me -> role select -> SHOP single-device session enforcement.

PHẠM VI ĐƯỢC LÀM:
- users
- user_roles
- phone_verifications
- verification_proofs
- sessions
- OTP provider interface + fake test/dev provider
- POST /v1/auth/phone-verifications
- POST /v1/auth/phone-verifications/:id/verify
- POST /v1/auth/register
- POST /v1/auth/login
- GET /v1/auth/me
- POST /v1/auth/role/select
- migrations/fixtures/tests/config cần thiết cho package

CẤM:
- shop onboarding
- driver onboarding
- wallet
- delivery/order
- customer order
- admin provisioning/2FA
- driver approval/type management
- production SMS integration
- mobile/UI
- tự tạo role từ /register
- tự chọn ORM/token/test framework nếu repo chưa khóa

BƯỚC 0 — PREFLIGHT TRƯỚC KHI CODE:
Kiểm tra repo và báo ngắn gọn framework/runtime, PostgreSQL, persistence/ORM, migrations, token/session mechanism, test setup, idempotency infrastructure, config pattern, module convention, API prefix.

Nếu implementation đòi hỏi lựa chọn nền chưa tồn tại, DỪNG với BLOCKED_BY_FOUNDATION. Không tự chọn công nghệ mới.

BẮT BUỘC NGHIỆP VỤ:
- phone_normalized unique.
- OTP 6 số, TTL 5 phút, resend 60s, max 5 lần sai — tất cả qua config.
- verified OTP phát one-time proof TTL 10 phút.
- proof gắn phone + purpose và consume atomically khi register.
- password 8..128, adaptive hash, không plaintext.
- /register không nhận/cấp role, driver_type, admin, permissions.
- user roleless vẫn login được.
- role/select chỉ nhận role thực sự thuộc user.
- ADMIN/SYSTEM không chọn qua endpoint này.
- SHOP role context chỉ có một active SHOP session/device cho cùng user.
- switching SHOP device revoke SHOP session cũ nhưng không revoke DRIVER session.
- revoked session phải bị chặn server-side.
- register dùng Idempotency-Key theo infrastructure hiện có.
- concurrent register cùng phone chỉ tạo đúng một user.

TEST CONTRACT:
Phải implement và chạy đủ A01-01..A01-11 + A02-12..A02-19 trong Bước 4.3. Không được thay test integration bằng mô tả hoặc unit test giả lập toàn bộ DB.

KHI BÀN GIAO, TRẢ:
1. tóm tắt preflight;
2. changed files;
3. migrations;
4. implementation summary;
5. test mapping A01/A02 -> test files;
6. command đã chạy;
7. kết quả build/lint/test thực tế;
8. evidence concurrency + single-use + session isolation;
9. blockers/unresolved issues;
10. xác nhận không code vượt scope.

Ưu tiên code nhỏ, rõ, bám convention repo. Không refactor unrelated code.
```

---

## 23. Checklist review của ChatGPT sau khi Claude trả code

### Contract

- [ ] Endpoint đúng đường dẫn/method.
- [ ] Response/error codes đúng contract.
- [ ] Register roleless thật sự.
- [ ] Không role injection.
- [ ] Không SYSTEM/admin privilege leak.

### Database

- [ ] Unique phone ở DB, không chỉ check application.
- [ ] Proof có consume marker và atomic locking.
- [ ] OTP/proof không plaintext recoverable ngoài yêu cầu cần thiết.
- [ ] Migrations mới, không sửa migration đã apply.
- [ ] Không tạo bảng M02/M03 ngoài scope.

### Security

- [ ] Password hash đúng abstraction.
- [ ] Không log secret.
- [ ] Rate-limit có thực thi.
- [ ] Disabled account bị chặn.
- [ ] Revoked session bị check mỗi request bảo vệ.

### Session/role

- [ ] `active_role` thuộc session/context, không phải client tự claim.
- [ ] SHOP device switch revoke đúng SHOP session.
- [ ] DRIVER session không bị ảnh hưởng.
- [ ] Concurrent SHOP select không để hai SHOP sessions active.

### Tests

- [ ] Đủ 19 test contract.
- [ ] Có test database/integration thật.
- [ ] Có concurrent register test.
- [ ] Có proof reuse/concurrency test.
- [ ] Có SHOP/DRIVER session isolation test.
- [ ] Test thật sự chạy pass.

### Scope

- [ ] Không Shop onboarding.
- [ ] Không Driver onboarding.
- [ ] Không Wallet/Delivery.
- [ ] Không production SMS.
- [ ] Không refactor rộng ngoài task.

---

## 24. Kết quả review

ChatGPT chỉ trả một trong bốn trạng thái:

- `PASS` — đủ điều kiện merge.
- `PASS_WITH_FIXES` — lỗi nhỏ, sửa cục bộ không thay design.
- `REWORK` — vi phạm contract/transaction/security/test quan trọng.
- `BLOCKED_BY_FOUNDATION` — thiếu quyết định nền phải xử lý trước.

Không merge code nếu còn `REWORK` hoặc `BLOCKED_BY_FOUNDATION`.

---

## 25. Sau khi M01-A1 PASS

Bước kế tiếp là **4.4 — M01-A2-ONBOARDING**:

- SHOP onboarding adapter với M02;
- DRIVER onboarding adapter với M03;
- grant role sau business transaction thành công;
- A03 acceptance tests 20–30;
- không sửa lại Auth Core trừ khi review phát hiện contract bug thật sự.


## Addendum — Register replay, ADR-003 v0.3

1. Scope cố định: verification_proof / proof.id / auth.register.v1 / canonical Idempotency-Key. Server resolve bằng token digest, phone_normalized và purpose REGISTER; client không cung cấp scope_id.
2. Resolve được proof consumed hoặc tự nhiên hết hạn để lookup idempotency trước. Giữ identity/digest/binding/consume/invalidation markers ít nhất tới dedupe expiry của record liên quan.
3. Logical request gồm phone_normalized, password và verification_token nguyên nghĩa, toàn bộ device fields đã validate. HMAC/key version/encrypted response theo ADR-003; không plaintext secret trong DB/log.
4. Chỉ NEW execution khóa proof, kiểm unused/unexpired/not invalidated, create user + consume proof + session + infrastructure writes cùng transaction. Proof invalid/used không tạo user/session mới.
5. EXISTING same request: replay_guard bind proof_id/user_id/session_id, kiểm proof không invalidated/revoked, user ACTIVE, session đúng binding/chưa revoked/chưa expired. Natural proof expiry không chặn replay đã commit; proof invalidation có chặn.
6. Lấy idempotency lock trước business locks. Replay khóa proof -> user -> session, tương thích revoke/disable; fresh DB clock sau lock và ngay trước decrypt. Không dùng SELECT thường làm bảo đảm chống TOCTOU.
7. Trong replay TTL mặc định 15 phút trả cùng token/logical result; quá replay TTL còn dedupe 7 ngày -> IDEMPOTENCY_REPLAY_EXPIRED, không mutation. Hết dedupe thì new execution vẫn phải qua proof và unique phone invariant.
8. Session revoked -> SESSION_REVOKED (401); expired -> SESSION_EXPIRED (401); disabled user -> ACCOUNT_DISABLED (403); invalidated proof -> VERIFICATION_PROOF_INVALID (400). Không mint token thay thế khi replay deny.
9. A01-06/07 áp dụng new execution (bao gồm khác key); A01-09 phải test response mất, consumed proof, natural proof expiry trong replay TTL, key rotation, current authorization deny và replay TTL expired.
10. Header/error envelope nền phải bảo toàn request_id hiện tại và typed error codes. Idempotency-Key một mình không cấp quyền replay.
11. Khi giao Claude, addendum và ADR-003 §13 là AUTHORITATIVE SPECS bổ sung cho prompt §22 (nếu có); không dùng prompt cũ độc lập. Không đổi token/session architecture ADR-002 và không triển khai ngoài Auth scope.
