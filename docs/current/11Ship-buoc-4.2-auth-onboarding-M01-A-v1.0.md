# 11Ship — Bước 4.2
## Đặc tả đăng ký, đăng nhập và onboarding — M01-A v1.0

**Trạng thái:** DESIGN — register replay addendum ADR-003 v0.3 được Owner duyệt 07/10/2026; Auth implementation vẫn chờ toàn bộ M00-C1  
**Phụ thuộc:** Bước 4.1 — M00-A  
**Mục tiêu:** khóa contract đủ chi tiết để giao Claude triển khai theo gói nhỏ, không tự diễn giải nghiệp vụ.


> **Register replay clarification — 07/10/2026, ADR-003 v0.3:** ADR-001/002 khóa stack/session; ADR-003 v0.3 §13 chi phối transactional replay và có ưu tiên với các câu used/expired proof hoặc transaction order bên dưới. New execution phải reject proof used/expired; replay kết quả đã commit không phải consume proof lần hai. Owner đã lock revision ADR-003 v0.3; Auth vẫn chưa CODE_READY trước khi toàn bộ M00-C1 hoàn tất.

---

## 1. Phạm vi

Bước 4.2 khóa:

1. Xác minh số điện thoại bằng OTP.
2. Đăng ký một `user` duy nhất theo `phone_normalized`.
3. Đăng nhập bằng số điện thoại + mật khẩu.
4. Cơ chế tài khoản chưa có role (`roleless`) sau đăng ký.
5. Chọn/chuyển role khi một tài khoản có nhiều role.
6. Onboarding SHOP.
7. Onboarding DRIVER.
8. Quy tắc phiên SHOP chỉ hoạt động trên một thiết bị tại một thời điểm.
9. Bộ lỗi, transaction, idempotency và test nghiệm thu tối thiểu.

Không thuộc gói code đầu tiên của 4.2:

- refresh token rotation, logout/revoke toàn bộ session, đổi/quên mật khẩu, đổi số điện thoại — chuyển M01-B;
- admin/SYSTEM provisioning và 2FA — module quản trị triển khai sau;
- duyệt xế, nạp/rút ví và logic nhận đơn — module Driver/Wallet/Delivery;
- Customer ordering — triển khai ở đợt khách đặt món, nhưng M01 không được thiết kế theo cách chặn việc bổ sung role CUSTOMER sau này.

---

## 2. Quy tắc bất biến

### 2.1 User

- Một số điện thoại chuẩn hóa chỉ có một `users` record.
- `phone_normalized` có unique constraint ở database.
- User chỉ ACTIVE sau khi số điện thoại đã được xác minh.
- `POST /register` không nhận `role`, `driver_type`, `admin`, `permission` từ client.
- User mới có thể đăng nhập khi chưa có bất kỳ role nghiệp vụ nào.
- Quyền thực hiện nghiệp vụ luôn kiểm tra server-side từ role/profile/membership thực tế, không tin dữ liệu role do app gửi lên.

### 2.2 Role

- Một user có thể đồng thời có SHOP và DRIVER.
- Role được cấp bởi kết quả onboarding tương ứng, không được cấp trong request đăng ký user.
- SHOP và DRIVER là role nghiệp vụ; `driver_type = PLATFORM` chỉ là phân loại xế, tuyệt đối không phải quyền quản trị.
- Nếu user có nhiều role, app 11Ship hiển thị lựa chọn SHOP/DRIVER khi vào hệ thống và cho phép chuyển role không cần tạo tài khoản khác.

### 2.3 OTP / verification proof

- OTP gắn với `phone_normalized` + `purpose`.
- OTP chỉ dùng một lần.
- Sau khi OTP đúng, server phát hành `verification_token`/proof dùng một lần.
- Proof cũng gắn với `phone_normalized` + `purpose` và phải được consume atomically khi đăng ký.
- Không được dùng proof của purpose khác.
- Không được dùng lại proof sau khi transaction đăng ký thành công.

Default cấu hình MVP:

- OTP: 6 chữ số.
- OTP TTL: 5 phút.
- Resend cooldown: 60 giây.
- Tối đa 5 lần verify sai cho một verification.
- Verification proof TTL: 10 phút.
- Các ngưỡng phải nằm trong config, không hardcode rải rác trong code.

### 2.4 Mật khẩu

- Tối thiểu 8, tối đa 128 ký tự.
- Không lưu plaintext.
- Dùng adaptive password hash qua một abstraction thống nhất; thuật toán cụ thể do stack backend quyết định ở implementation, nhưng test phải chứng minh mật khẩu không thể đọc ngược từ database.

---

## 3. Data ownership dùng trong 4.2

M01 Auth sở hữu:

- `users`
- `user_roles`
- `phone_verifications`
- `verification_proofs`
- `sessions`

M02 Shop sở hữu:

- `shops`
- `shop_members`
- `shop_business_hours`
- `service_areas`

M03 Driver sở hữu:

- `drivers`
- `driver_service_areas`
- `driver_bank_accounts`

M01 không được tự ghi trực tiếp dữ liệu thuộc M02/M03 ngoài orchestration service đã định nghĩa. Onboarding SHOP/DRIVER gọi service của module sở hữu dữ liệu và chỉ ghi role sau khi transaction nghiệp vụ thành công.

---

## 4. Luồng A01 — OTP + đăng ký user

### A01.1 Yêu cầu OTP

`POST /v1/auth/phone-verifications`

Request:

```json
{
  "phone": "0987654321",
  "purpose": "REGISTER"
}
```

Server:

1. Chuẩn hóa sang `phone_normalized`.
2. Rate-limit theo phone + device/IP.
3. Nếu purpose REGISTER và phone đã có user thì trả `PHONE_ALREADY_REGISTERED`.
4. Tạo `phone_verifications`.
5. Gửi OTP qua OTP provider.

Response 201:

```json
{
  "data": {
    "verification_id": "pv_...",
    "expires_in_seconds": 300,
    "resend_after_seconds": 60
  }
}
```

### A01.2 Verify OTP

`POST /v1/auth/phone-verifications/{verification_id}/verify`

Request:

```json
{
  "otp": "123456"
}
```

Response 200:

```json
{
  "data": {
    "verification_token": "vp_...",
    "purpose": "REGISTER",
    "expires_in_seconds": 600
  }
}
```

Bắt buộc chặn:

- OTP sai;
- OTP hết hạn;
- quá số lần thử;
- verification đã verify/đã vô hiệu;
- token/proof dùng sai purpose;
- reuse proof sau khi đã consume.

### A01.3 Register user

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

Không cho phép các field sau trong contract:

- `role`
- `driver_type`
- `is_admin`
- `permissions`

Transaction bắt buộc:

1. Lock proof.
2. Kiểm tra proof hợp lệ, chưa dùng, đúng phone, đúng purpose REGISTER.
3. Kiểm tra `phone_normalized` chưa tồn tại.
4. Tạo `users` với phone đã verified.
5. Mark proof consumed.
6. Tạo session roleless/onboarding.
7. Commit.

Response 201:

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

Retry cùng `Idempotency-Key` phải trả cùng kết quả, không tạo user thứ hai.

---

## 5. Luồng A02 — Login + role context

### A02.1 Login

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

Response mẫu — chưa có role:

```json
{
  "data": {
    "user_id": "usr_...",
    "available_roles": [],
    "active_role": null,
    "onboarding_required": true,
    "access_token": "..."
  }
}
```

Response mẫu — có SHOP + DRIVER:

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

Không trả thông tin phân biệt “phone đúng nhưng password sai”; dùng chung `INVALID_CREDENTIALS`.

### A02.2 Chọn/chuyển role

`POST /v1/auth/role/select`

Request:

```json
{
  "role": "SHOP"
}
```

Server phải:

1. Kiểm tra role thực sự tồn tại trong `user_roles`.
2. Kiểm tra profile/membership tương ứng còn hợp lệ.
3. Ghi `active_role` cho session.
4. Phát access context mới hoặc refresh claims theo cơ chế implementation.

Không được cho client chọn ADMIN/SYSTEM qua endpoint này.

### A02.3 Quy tắc một thiết bị của SHOP

Khi session chọn role SHOP:

- chỉ cho một session SHOP active trên một thiết bị tại một thời điểm;
- chọn SHOP trên thiết bị mới thì revoke session SHOP cũ;
- nếu cùng user có DRIVER, không được vô hiệu session DRIVER chỉ vì SHOP chuyển thiết bị;
- server phải kiểm tra revoke ở mỗi request bảo vệ.

Quy tắc này áp dụng theo role/session context, không biến thành “một user chỉ được dùng một thiết bị cho mọi vai trò”.

### A02.4 `GET /v1/auth/me`

Trả tối thiểu:

```json
{
  "data": {
    "user_id": "usr_...",
    "phone_normalized": "+84987654321",
    "available_roles": ["SHOP", "DRIVER"],
    "active_role": "SHOP",
    "onboarding": {
      "shop": "COMPLETED",
      "driver": "PENDING_APPROVAL"
    }
  }
}
```

---

## 6. Luồng A03 — Onboarding SHOP

`POST /v1/onboarding/shop`

Header:

`Idempotency-Key: <uuid>`

Yêu cầu:

- user đã xác minh SĐT và đăng nhập;
- user chưa sở hữu/membership shop trái với quy tắc một tài khoản merchant cho một shop.

Request logic:

```json
{
  "name": "Tên quán",
  "contact_phone": "0987654321",
  "address_text": "Mô tả địa chỉ",
  "pickup_lat": 22.0,
  "pickup_lng": 106.0,
  "service_area_id": "area_..."
}
```

Điều kiện hoàn tất onboarding SHOP:

- có tên quán;
- có số điện thoại liên hệ;
- có địa chỉ nhập tay;
- có GPS hợp lệ;
- service area hợp lệ/đang active nếu hệ thống dùng phân vùng tại địa điểm đó.

Không yêu cầu phải cấu hình giờ hoạt động trước khi tạo/active shop.

Sau transaction thành công:

1. M02 tạo `shops`.
2. M02 tạo `shop_members` cho user với vai trò owner/merchant theo model đã khóa.
3. M01 cấp `user_roles.SHOP`.
4. Shop có thể `ACTIVE` về mặt hồ sơ.
5. Nếu chưa có giờ hoạt động thì computed availability là OFFLINE, không tự nhận order.

Không có bước admin duyệt shop bổ sung trong 4.2.

---

## 7. Luồng A03 — Onboarding DRIVER

`POST /v1/onboarding/driver`

Header:

`Idempotency-Key: <uuid>`

Quy tắc:

- một user chỉ có một `drivers` profile;
- client không được gửi/chọn `driver_type`;
- tạo mới luôn mặc định `driver_type = EXTERNAL`;
- `PLATFORM` chỉ do luồng quản lý có quyền thay đổi; legacy driver_type SYSTEM bị từ chối;
- xác minh ban đầu chỉ bằng SĐT; không yêu cầu CCCD/KYC, giấy tờ xe;
- không bắt buộc `vehicle_type`;
- biển số nếu có là optional.

Request logic:

```json
{
  "full_name": "Nguyen Van A",
  "plate_number": "11B1-12345",
  "service_area_ids": ["area_..."]
}
```

`full_name` là tên thật dùng làm chuẩn đối chiếu tài khoản ngân hàng về sau.

Sau transaction thành công:

1. M03 tạo `drivers` với `driver_type=EXTERNAL`.
2. M03 tạo `driver_service_areas` theo vùng user đăng ký.
3. `status = PENDING` (nguồn lifecycle duy nhất, không tạo thêm approval_status độc lập).
4. `accepting_deliveries = false` (chỉ driver; shop vẫn dùng accepting_orders).
5. M01 cấp `user_roles.DRIVER` để user vào được giao diện xế.
6. Có role DRIVER không đồng nghĩa được nhận đơn.

### Điều kiện active lần đầu — contract với module quản lý/Wallet

Không thực hiện duyệt trong endpoint onboarding, nhưng phải khóa tiêu chí để module sau dùng đúng:

- hồ sơ driver hợp lệ;
- đã đăng ký ít nhất một vùng hoạt động active;
- đã nộp tổng kích hoạt 100.000đ;
- quản lý kiểm tra giao dịch và duyệt thủ công;
- tại thời điểm duyệt lần đầu, số dư khả dụng đạt tối thiểu 100.000đ;
- sau khi active không bắt duy trì cố định 100.000đ;
- tài khoản ngân hàng không phải điều kiện nhận đơn; ngân hàng đã xác minh là điều kiện xử lý rút tiền.

Driver đang PENDING chỉ được xem/cập nhật phần hồ sơ được phép, xem trạng thái kích hoạt và thực hiện luồng nạp tiền; tuyệt đối chưa được nhận delivery.

---

## 8. Error contract tối thiểu

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

Mã lỗi 4.2:

| HTTP | Code | Ý nghĩa |
|---|---|---|
| 400 | INVALID_PHONE | SĐT không hợp lệ |
| 400 | OTP_INVALID | OTP sai |
| 400 | OTP_EXPIRED | OTP hết hạn |
| 409 | OTP_ALREADY_USED | OTP/verification đã dùng |
| 429 | OTP_RATE_LIMITED | vượt giới hạn gửi/thử OTP |
| 409 | PHONE_ALREADY_REGISTERED | phone đã có user |
| 400 | VERIFICATION_PROOF_INVALID | proof sai/hết hạn |
| 409 | VERIFICATION_PROOF_USED | proof đã consume |
| 400 | VERIFICATION_PURPOSE_MISMATCH | sai purpose |
| 401 | INVALID_CREDENTIALS | login không hợp lệ |
| 403 | ACCOUNT_DISABLED | tài khoản bị khóa/vô hiệu |
| 403 | ROLE_NOT_AVAILABLE | role không thuộc user |
| 409 | SHOP_ONBOARDING_EXISTS | đã có shop/membership không cho tạo trùng |
| 409 | DRIVER_PROFILE_EXISTS | user đã có driver profile |
| 400 | INVALID_SERVICE_AREA | vùng không hợp lệ/inactive |
| 403 | DRIVER_PENDING_APPROVAL | driver chưa được duyệt cho nghiệp vụ yêu cầu active |
| 401 | SESSION_REVOKED | session đã bị server revoke |

Message chỉ phục vụ hiển thị; client branching theo `code`.

---

## 9. Transaction + concurrency bắt buộc

### Register

Unique constraint `users.phone_normalized` là lớp bảo vệ cuối cùng. Hai request đồng thời cùng phone không được tạo hai user.

### Proof consumption

Check + consume proof phải trong cùng transaction/lock. Không thực hiện kiểu “check rồi create user rồi mới mark used” ngoài transaction.

### Shop onboarding

Tạo shop + membership + grant role là một business transaction. Nếu grant role thất bại, không để shop orphan.

### Driver onboarding

Tạo driver + service areas + grant DRIVER role là một business transaction. Không tạo driver thứ hai do retry.

### Session SHOP

Revoke session SHOP cũ + activate session SHOP mới phải xử lý atomically đủ để không tồn tại hai SHOP sessions active sau khi request hoàn tất.

---

## 10. A01–A03 Acceptance Tests

### A01 — OTP/Register

1. OTP đúng -> nhận proof.
2. OTP sai -> không nhận proof.
3. OTP hết hạn -> fail.
4. OTP dùng lại -> fail.
5. Proof sai purpose -> fail.
6. Proof hết hạn -> fail.
7. Proof consume rồi dùng lại -> fail.
8. Hai request register đồng thời cùng phone -> đúng một user.
9. Retry cùng Idempotency-Key -> cùng kết quả, không duplicate.
10. Client gửi `role=ADMIN`, `driver_type=PLATFORM` hoặc legacy `driver_type=SYSTEM` trong register -> reject theo strict schema, tuyệt đối không phát sinh quyền.
11. Register thành công -> user login được dù `available_roles=[]`.

### A02 — Login/Role/Session

12. Phone/password đúng -> login thành công.
13. Sai password -> `INVALID_CREDENTIALS`.
14. User roleless -> login thành công và `onboarding_required=true`.
15. User có SHOP+DRIVER -> trả cả hai role và yêu cầu chọn role.
16. Chọn role không sở hữu -> 403.
17. Chọn SHOP thiết bị B -> SHOP session thiết bị A bị revoke.
18. Nếu user đồng thời có DRIVER session, revoke SHOP cũ không làm DRIVER session chết.
19. Request bằng revoked SHOP session -> 401 `SESSION_REVOKED`.

### A03 — Onboarding

20. Shop thiếu name/contact/address/GPS -> fail validation.
21. Shop đủ dữ liệu, chưa có giờ hoạt động -> onboarding thành công, shop hồ sơ active nhưng availability offline.
22. Retry shop onboarding cùng idempotency key -> không tạo shop thứ hai.
23. Driver self-register -> type luôn EXTERNAL.
24. Client cố gửi PLATFORM hoặc legacy SYSTEM trong driver_type -> reject; không tự chọn phân loại.
25. Driver không CCCD/giấy tờ xe vẫn onboarding được.
26. Driver không vehicle_type vẫn onboarding được.
27. Driver service area invalid/inactive -> fail.
28. Driver onboarding thành công -> role DRIVER có, status PENDING, accepting_deliveries=false.
29. Driver PENDING gọi API nhận đơn -> bị chặn.
30. PLATFORM driver classification không bao giờ tạo admin permission; role SYSTEM quản trị giữ nguyên.

---

## 11. Fixtures tối thiểu cho Claude

- `user_roleless`: verified user, no role.
- `user_shop`: SHOP only.
- `user_driver_pending`: DRIVER role, EXTERNAL, PENDING.
- `user_shop_driver`: both SHOP + DRIVER.
- `service_area_active`.
- `service_area_inactive`.
- `verification_register_valid`.
- `verification_register_expired`.
- `verification_proof_used`.
- `shop_session_device_A` active để test login/role trên device B.

Không dùng fixture ADMIN/SYSTEM trong gói code đầu tiên ngoài negative test “không tự cấp quyền”.

---

## 12. Gói nhỏ đầu tiên giao Claude

### Package `M01-A1-AUTH-CORE`

Chỉ code:

1. `phone_verifications`
2. OTP provider interface + fake provider cho test/dev
3. verify OTP -> one-time proof
4. generic `/v1/auth/register`
5. `/v1/auth/login`
6. `/v1/auth/me`
7. `/v1/auth/role/select`
8. session SHOP single-device rule
9. test A01 + A02

Không cho Claude code shop/driver business tables trong package này.

Sau khi M01-A1 pass review mới giao:

### Package `M01-A2-ONBOARDING`

- SHOP onboarding adapter với M02
- DRIVER onboarding adapter với M03
- test A03

Cách chia này giảm token, giới hạn blast radius và tránh Claude vừa xây Auth vừa tự quyết định nghiệp vụ Shop/Driver.

---

## 13. Definition of Done — Bước 4.2

Bước 4.2 được LOCK khi:

- contract A01/A02/A03 được Owner chấp thuận;
- không còn endpoint đăng ký role-specific tạo user trực tiếp;
- roleless account được hỗ trợ;
- một user có thể có SHOP + DRIVER;
- SHOP single-device rule không làm hỏng DRIVER session;
- driver self-onboarding luôn EXTERNAL/PENDING;
- OTP/proof single-use được bảo vệ transactionally;
- 30 acceptance cases trên trở thành test contract chính thức;
- Claude chỉ được giao package M01-A1 trước, không code vượt module.


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


## Driver/Wallet design patch — 07/10/2026

Đọc `docs/current/ADR-004-driver-wallet-consistency.md` và `docs/tasks/M03-M04-design-patch-plan.md` cho ownership, enum và integration mới. Đây là DESIGN PATCH chờ review/Owner lock, không mở business implementation trong Auth Core hoặc M00. DRIVER role không đồng nghĩa ACTIVE driver; PLATFORM chỉ miễn count và registered service area, không cấp admin. ADR-003 v0.3 replay clarification giữ nguyên. Ví/ledger/hold/withdrawal chỉ M04 mutation; M03-B điều phối approval/closure. Closure finalization chờ M07 responsibility adapter thật, thiếu adapter phải fail closed. Bộ test `docs/current/M03-M04-acceptance-matrix.md` là contract CHƯA CHẠY.
