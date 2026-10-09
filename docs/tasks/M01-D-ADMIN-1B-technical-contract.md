# M01-D-ADMIN-1B — hợp đồng kỹ thuật: tạo / cấp lại / thu hồi lời mời ADMIN (DỰ THẢO ĐỂ REVIEW)

Quy trình: [11ship-delivery-workflow](../process/11ship-delivery-workflow.md). Mẫu: [module-delivery-checklist](../templates/module-delivery-checklist.md).
Người soạn: Claude (theo yêu cầu ChatGPT/Owner, 10/10/2026). **Đây là tài liệu thiết kế kỹ thuật, không phải code, không phải bằng chứng test, không phải nghiệm thu.** Chưa có dòng code sản phẩm 1B nào. Claude chỉ code sau khi ChatGPT review đạt và các quyết định ở mục 2 được chốt.
Trạng thái: `DESIGN PROPOSAL — chờ ChatGPT review`. Không dòng nào dưới đây là xác nhận của Owner.

## 0. Nguồn và mốc

| Nguồn | SHA đã đọc (10/10/2026) |
|---|---|
| #37 — gói 1A (schema lời mời + participant), Draft, ChatGPT đã duyệt kỹ thuật | `fa11ee5c0a26f34c22e1ad97caa94857f363b134` |
| #34 — M01-D-LOGIN backend (base của #37) | `4d20660eb3b0656b626a084df6e55d4385ee405a` |
| #35 — UI đăng nhập (không dùng cho 1B) | `7b116c3d4551bf0028fa544278449598acf5991c` |
| #36 — kiểm kê/đề xuất ADMIN | `101daa8a53788b788c835fa53b3668733f1b359b` |
| `main` | `46d21a92e9657bd16e4e64994c4c0023bc80288f` (so với `44ad818` lúc preflight 1A chỉ đổi `docs/PROGRESS.md`; không liên quan) |

Tài liệu này nằm trên nhánh `docs/m01-d-admin-1b-contract` xếp chồng trên #37 (chỉ thêm file `docs/tasks/M01-D-ADMIN-1B-technical-contract.md`). Code 1B sẽ phụ thuộc #37 và #34; chưa tự merge gì. Nguồn nghiệp vụ: Activation Contract v1 + Technical Design 1A + 6 bộ UI do Owner duyệt (đặc biệt UI-06: màn 14 "Lời mời đã tạo", màn 15 "ADMIN chờ kích hoạt", popup xác nhận gồm **lý do bắt buộc + mã 2FA mới của SYSTEM**).

Nguyên tắc không đổi: web quản trị chỉ dành cho ADMIN/SYSTEM; Khách, Quán, Xế chỉ dùng app riêng. 1B **không** có OTP, kích hoạt tài khoản, trang kích hoạt công khai, UI, user/membership ADMIN, khôi phục 2FA hay quản lý Khách/Quán/Xế.

## 1. Phạm vi 1B

Trong phạm vi (backend, không UI):
1. Migration mới: bảng `admin_sensitive_operations` (mục 4).
2. Step-up 2FA của SYSTEM: tạo operation, xác minh bằng TOTP mới, đọc trạng thái operation.
3. Tạo lời mời, cấp lại, thu hồi, đọc một lời mời, liệt kê lời mời.
4. Coordinator (một transaction mỗi route) gọi participant 1A; idempotency, audit, limiter, protocol khóa, mã lỗi, cấu hình TTL/link.
5. Test đồng thời/replay (mục 13).

Ngoài phạm vi (giữ cho 1C hoặc về sau): mọi route `/admin-activation/*`, OTP và kênh operator, `admin_activation_attempts`, `admin_activation_otp_challenges`, `admin_profiles`, `admin_app_permissions`, tạo user/membership/factor/session của ADMIN, composite FK origin, UI. Điểm mở rộng cho 1C đã được nêu ở mục 7.5 (vô hiệu activation attempt khi cấp lại/thu hồi).

## 2. Quyết định cần ChatGPT/Owner chốt trước khi code

Mỗi dòng có **mặc định Claude sẽ làm nếu được duyệt nguyên văn**. Không dòng nào tự mở rộng nghiệp vụ.

| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Cấp lại có cho **đổi quyền** không? Technical Design 1A viết "đổi quyền lời mời bằng cấp lại" nhưng Contract v1 chỉ nêu `expected_version + reason`. | Chỉ **sao chép nguyên snapshot** (họ tên, ghi chú, quyền). Đổi quyền = thu hồi rồi tạo mới. Nếu cần đổi quyền khi cấp lại, thêm trường tùy chọn `permissions` và đưa vào fingerprint (sửa nhỏ, không đổi schema). |
| Q2 | Cấp lại áp dụng cho trạng thái nào? | Chỉ lời mời **PENDING** (kể cả đã quá `expires_at` mà chưa terminal): cũ → `SUPERSEDED` + tạo mới. Lời mời đã `EXPIRED/REVOKED/ACCEPTED/PHONE_CONFLICT` trả `ADMIN_INVITATION_NOT_PENDING`; SYSTEM dùng "tạo lời mời" mới. |
| Q3 | Kiểm tra SĐT đã thuộc một `users` khi tạo/cấp lại? | Có, kiểm **không khóa** ở create-operation (để tránh lãng phí mã 2FA) **và** ở route nghiệp vụ; trả `ADMIN_PHONE_CONFLICT`. Chỉ là chốt sớm; thẩm quyền cuối cùng là giao dịch kích hoạt 1C (PHONE_CONFLICT terminal). |
| Q4 | Tuổi thọ operation "2 phút": tính từ lúc tạo hay từ lúc VERIFIED? | Từ lúc **tạo** (`expires_at = created_at + 120 s`, không gia hạn khi verify). Người dùng phải tạo → nhập TOTP → gửi nghiệp vụ trong 2 phút. |
| Q5 | Bucket sai TOTP của step-up: dùng chung với đăng nhập (`TOTP_USER`)? | **Dùng chung** (một ngân sách sai cho một factor: 5 sai/15 phút → khóa 15 phút, giá trị đã duyệt ở #34). Thêm trần 5 sai/operation. **Không thêm số liệu limiter mới.** |
| Q6 | Quota ingress cho route 1B | Dùng lại `reserveTotpRequest(ip)` (30 request/60 s/IP, đã duyệt ở #34) cho **mọi POST 1B**, đặt trước body/cookie. Không thêm bucket/loại mới nên **không sửa CHECK `kind` của `admin_auth_limits`**. |
| Q7 | Sao lưu `reason` trong audit? | Có, `reason` (1–500 ký tự, SYSTEM nhập) nằm trong `metadata.reason` của audit revoke/reissue; không bao giờ cùng link/token. SĐT và họ tên **không** vào audit (chỉ id). |
| Q8 | `actorType` audit của SYSTEM | `SYSTEM` (đúng Contract v1 mục 8). #34 dùng `USER` cho login. Cần ChatGPT xác nhận có chấp nhận hai giá trị khác nhau trong cùng module hay thống nhất `USER` + `metadata.admin_role`. |
| Q9 | Danh sách lời mời (`GET /admin/invitations`) có thuộc 1B? UI-06 chỉ vẽ màn "Lời mời đã tạo" và "ADMIN chờ kích hoạt", còn "Về danh sách ADMIN" được nhắc. | Có, một endpoint đọc phân trang theo `admin_invitations_list_idx` (đã có ở 1A). Nếu ChatGPT muốn tách sang gói UI thì bỏ mục 5.9. |
| Q10 | Tham số mới: TTL lời mời và gốc link kích hoạt | `ADMIN_INVITATION_TTL_HOURS` (mặc định 72 theo Contract v1, hợp lệ 1–168) và `ADMIN_ACTIVATION_ORIGIN` (phải thuộc `ADMIN_AUTH_ALLOWED_ORIGINS`; link = `<origin>/activate#t=<token>`). Chỉ áp dụng cho lời mời mới. TTL replay của link = 15 phút (Contract v1 mục 7). |
| Q11 | Subkey HMAC mới cho fingerprint operation | Thêm một **mục đích khoá** `adminOperation` vào `Keyring` (không đổi dẫn xuất cũ; cập nhật `admin-purposes.spec`). Phương án thay thế: dùng `KeyVersion.fingerprint()` của idempotency với tuple có tiền tố `admin-operation.v1` (ít thay đổi crypto hơn, tách miền yếu hơn). Claude đề xuất phương án subkey. |

## 3. Cơ sở đã đọc trong code (#34 + #37) — các tiền đề của hợp đồng

Mọi điểm dưới đây Claude đã đọc trực tiếp; chúng quyết định thiết kế.

1. **`IdempotencyExecutor` là coordinator sở hữu transaction** (`idempotency-executor.ts`): advisory lock theo tuple `(scope, scopeId, operationId, key)` → `SELECT … FOR UPDATE` record → đồng hồ DB → replay (với hook `sensitive` khóa dòng quyết định quyền, **trước khi giải mã**) hoặc chạy callback đúng một lần. Callback trả non-2xx → **rollback**, khoá key không bị tiêu thụ. Hệ quả: bước **verify TOTP** (cần *commit* bộ đếm khi sai) **không được** chạy trong executor; nó theo mẫu `AdminTotpService.#verify` (commit đếm, ném lỗi sau commit).
2. **Thứ tự khóa hiện có** (`admin-totp-service.ts`, `admin-session-service.ts`, `admin-login-service.ts`): bucket limiter (tăng dần `bucket_key`) → user → membership → factor → challenge/session. Đọc dùng `FOR SHARE`, ghi `FOR UPDATE`. Hết hạn luôn quyết định bằng `freshClockMs(context)` **sau khóa cuối**.
3. **`AdminCredentialChecks.lockAndCheck`** kiểm user ACTIVE, binding mật khẩu, membership ACTIVE đúng version đã cấp. Phiên cũ bị thu hồi mỗi lần đăng nhập mới (`revokeAllForUser`), nên một operation gắn `actor_session_id` tự vô hiệu khi đăng nhập lại.
4. **TOTP**: `matchTotp(secret, code, now, lastAcceptedStep)` chỉ nhận step **lớn hơn** `last_accepted_step`; đăng nhập đã `advanceStep` ⇒ mã vừa dùng đăng nhập **không dùng lại được** cho step-up (đúng Contract v1 mục 6).
5. **Giá trị limiter đã duyệt** (`admin-auth-constants.ts`): `TOTP_REQUEST_LIMIT=30/60 s/IP`, `TOTP_FAILURE_LIMIT=5`, cửa sổ và khóa 15 phút, `CHALLENGE_ATTEMPT_LIMIT=5`.
6. **Audit** (`audit-writer.ts`, `audit-entry.ts`): participant chỉ nhận `TransactionContext`; entry bị từ chối (không sửa) nếu sai; metadata ≤ 8 KiB, tên khóa giống secret bị chặn. Lỗi audit ⇒ rollback toàn bộ (mutation, idempotency).
7. **Controller mẫu** (`admin-auth.controller.ts`): Origin phải đúng một origin cấu hình, `Content-Type: application/json`, CSRF qua header `x-csrf-token`, `Cache-Control: no-store`, cookie `__Host-11admin`.
8. **1A (#37)**: `AdminInvitationParticipant.create/transition/lock/lockPendingByPhone`; identity bất biến **bằng trigger** (SĐT, generation, digest, `created_by`… không đổi được) ⇒ SĐT đọc từ tiền kiểm không khóa **không thể đổi** trước khi khóa — đơn giản hoá bước khóa advisory theo SĐT (mục 7.2). Cấp lại phải chuyển bản cũ terminal **trước** khi INSERT bản mới (FK `successor_id` deferred).

## 4. Dữ liệu 1B — `admin_sensitive_operations` (đề xuất DDL để review)

Một migration mới `<ts>_create-admin-sensitive-operations.sql` (timestamp chọn khi code, sau `1792108800000`), không IF EXISTS/CASCADE, không seed, có Down thật. Tham chiếu `admin_memberships`, `admin_sessions` (#34), `admin_invitations` (#37).

```sql
CREATE TABLE app.admin_sensitive_operations (
  operation_id        uuid PRIMARY KEY,
  actor_user_id       uuid NOT NULL REFERENCES app.admin_memberships(user_id),
  actor_session_id    uuid NOT NULL REFERENCES app.admin_sessions(session_id),
  factor_id           uuid NOT NULL,
  factor_version      bigint NOT NULL CHECK (factor_version >= 1),
  membership_version  bigint NOT NULL CHECK (membership_version >= 1),
  action              varchar(24) NOT NULL CHECK (action IN ('CREATE_INVITATION','REISSUE_INVITATION','REVOKE_INVITATION')),
  target_id           uuid REFERENCES app.admin_invitations(invitation_id),
  expected_version    bigint CHECK (expected_version >= 1),
  payload_fingerprint char(64) NOT NULL CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  fingerprint_key_id  varchar(64) NOT NULL CHECK (fingerprint_key_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  status              varchar(16) NOT NULL CHECK (status IN ('PENDING','VERIFIED','CONSUMED','INVALIDATED')),
  attempt_count       smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  created_at          timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  verified_at         timestamptz,
  consumed_at         timestamptz,
  invalidated_at      timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((action = 'CREATE_INVITATION' AND target_id IS NULL AND expected_version IS NULL)
      OR (action <> 'CREATE_INVITATION' AND target_id IS NOT NULL AND expected_version IS NOT NULL)),
  CHECK ((status = 'PENDING'     AND verified_at IS NULL     AND consumed_at IS NULL     AND invalidated_at IS NULL)
      OR (status = 'VERIFIED'    AND verified_at IS NOT NULL AND consumed_at IS NULL     AND invalidated_at IS NULL)
      OR (status = 'CONSUMED'    AND verified_at IS NOT NULL AND consumed_at IS NOT NULL AND invalidated_at IS NULL)
      OR (status = 'INVALIDATED' AND consumed_at IS NULL     AND invalidated_at IS NOT NULL))
);
-- Tối đa một operation "đang sống" cho mỗi SYSTEM: tạo mới vô hiệu bản cũ trong cùng transaction.
CREATE UNIQUE INDEX admin_sensitive_operations_live_uq ON app.admin_sensitive_operations(actor_user_id) WHERE status IN ('PENDING','VERIFIED');
```

Trigger `BEFORE UPDATE OR DELETE` (cùng kiểu `admin_invitation_transition_guard` của 1A): xóa bị cấm; cột định danh (mọi cột trừ `status`, `attempt_count`, `verified_at`, `consumed_at`, `invalidated_at`) bất biến; chuyển trạng thái chỉ `PENDING→VERIFIED`, `VERIFIED→CONSUMED`, `PENDING|VERIFIED→INVALIDATED`; `attempt_count` chỉ tăng +1 khi `PENDING`; terminal bất biến. Mọi mốc thời gian là giờ DB.

Không có bảng khác; **không** sửa `admin_auth_limits` (Q5/Q6). Runbook grants thêm `admin_sensitive_operations: SELECT, INSERT, UPDATE` (kiểm khớp bởi `remote-migration-fresh-db`).

## 5. API (prefix `/v1`, controller `admin`, chỉ mount khi `ADMIN_AUTH_ENABLED=true`)

Quy ước chung cho **mọi route 1B**: cookie phiên `__Host-11admin`; header `x-csrf-token` (POST); `Origin` đúng một origin cấu hình; POST bắt buộc `Content-Type: application/json`; JSON **strict** (khóa lạ → `ADMIN_INPUT_INVALID`; cấm `role`, `account_origin`, `user_id`, `status`, `generation_id`, `expires_at`, `token`, `created_by` do client gửi). Response `{ "data": … }`; thời gian ISO-8601 UTC; mọi response `Cache-Control: no-store`. Chỉ phiên **SYSTEM** (membership ACTIVE, `admin_role = 'SYSTEM'`); phiên ADMIN → `ADMIN_FORBIDDEN`; không có cookie/phiên sai → `ADMIN_SESSION_INVALID`. Token của app Khách/Quán/Xế không phải cookie quản trị nên không bao giờ qua được các route này.

Chuẩn hoá đầu vào (một parser dùng chung cho create-operation và route nghiệp vụ, để fingerprint khớp):
- `full_name`: trim hai đầu, 1–120 **code point**; `note`: 0–1000 ký tự, rỗng → `null`; `reason`: trim, 1–500 ký tự.
- `phone`: `normalizeVietnamPhone` phía server (nhận `0912345678` hoặc `+84…`); kết quả phải khớp `^\+84[0-9]{9}$` (ràng buộc DB 1A), nếu không → `ADMIN_INPUT_INVALID`.
- `permissions`: mảng 1–3, `app ∈ {CUSTOMER,SHOP,DRIVER}` không trùng, ba boolean `can_view/can_review_profile/can_lock` bắt buộc; ít nhất một `can_view`; review/lock ⇒ view; CUSTOMER không review. Sắp xếp theo `app` trước khi tính fingerprint.
- `expected_version`: số nguyên an toàn ≥ 1. `Idempotency-Key`: UUID chuẩn (`parseIdempotencyKey`, không tự sinh khi retry).
- SĐT trả về luôn dạng **che**: `phone_masked` = hai số đầu + dấu `•` + ba số cuối (như UI-06: `09•• ••• 101`). SĐT đầy đủ không có trong response, log hay audit.

### 5.1 `POST /admin/operations` — tạo yêu cầu xác nhận 2FA
- Không dùng `Idempotency-Key`. Body: `{ "action": "CREATE_INVITATION", "payload": { "full_name", "phone", "note", "permissions" } }` hoặc `{ "action": "REISSUE_INVITATION"|"REVOKE_INVITATION", "payload": { "invitation_id", "expected_version", "reason" } }`.
- Server chuẩn hoá payload, tính `payload_fingerprint` (mục 6.2), vô hiệu operation sống cũ của SYSTEM, tạo operation `PENDING`. Chỉ kiểm cú pháp, tồn tại/phiên bản mục tiêu (reissue/revoke) và, tuỳ chọn, SĐT (Q3) — đây là kiểm sớm, **không** thay cho kiểm cuối ở route nghiệp vụ.
- `201`: `{ "data": { "operation_id", "action", "status": "PENDING", "expires_at" } }`. Không trả fingerprint.
- Lỗi: 400 `ADMIN_INPUT_INVALID`; 401/403 chung; 404 `ADMIN_INVITATION_NOT_FOUND`; 409 `ADMIN_VERSION_CONFLICT`, `ADMIN_INVITATION_NOT_PENDING`, `ADMIN_INVITATION_PENDING_EXISTS`, `ADMIN_PHONE_CONFLICT`; 429 `ADMIN_AUTH_RATE_LIMITED`.

### 5.2 `POST /admin/operations/:operation_id/verify` — xác minh bằng TOTP mới
- Không dùng `Idempotency-Key` (mã TOTP dùng một lần; thử lại sai mã chỉ tiêu hao ngân sách). Body: `{ "code": "123456" }` (`parseTotpBody`, đúng 6 chữ số).
- Thành công `200`: `{ "data": { "operation_id", "status": "VERIFIED", "expires_at" } }`. Mất response/`TRANSACTION_OUTCOME_UNKNOWN`: gọi 5.3, **không** gửi lại cùng mã.
- Sai mã (`ADMIN_TOTP_INVALID` 400) hoặc bucket bị khóa (`ADMIN_AUTH_RATE_LIMITED` 429 + `Retry-After`): bộ đếm bucket và `attempt_count` **được commit trước khi trả lỗi** (mẫu #34). Đủ 5 sai → operation `INVALIDATED`; SYSTEM tạo operation mới.
- Operation không tồn tại / của người khác / hết hạn / không còn PENDING / không khớp phiên-factor-membership hiện tại / mục tiêu đã đổi version → `ADMIN_STEP_UP_REQUIRED` 403 (một mã, không nói lý do).

### 5.3 `GET /admin/operations/:operation_id`
`{ "data": { "operation_id", "action", "status", "expires_at", "verified_at", "consumed_at" } }` (chỉ của chính SYSTEM đó, không fingerprint/secret). Dùng để biết kết quả khi mất response của 5.2.

### 5.4 `POST /admin/invitations` — tạo lời mời
- Header: `Idempotency-Key`. Body: `{ "operation_id", "full_name", "phone", "note", "permissions" }`.
- `201`: `{ "data": { "invitation": { "invitation_id", "status": "PENDING", "version": 1, "full_name", "phone_masked", "note", "permissions": [{ "app", "can_view", "can_review_profile", "can_lock" }], "created_at", "expires_at" }, "activation_link": "<ADMIN_ACTIVATION_ORIGIN>/activate#t=<token>" } }`.
- `activation_link` chỉ xuất hiện trong response này và trong replay ≤ 15 phút (mục 8). Token = 32 byte CSPRNG (`base64url`), DB chỉ giữ SHA-256 (`digestToken`).
- Lỗi: 400 `ADMIN_INPUT_INVALID`; 400/409 `IDEMPOTENCY_*`; 403 `ADMIN_STEP_UP_REQUIRED`; 409 `ADMIN_INVITATION_PENDING_EXISTS` (SĐT đã có lời mời PENDING còn hạn), `ADMIN_PHONE_CONFLICT`; 429; 503 `TRANSACTION_OUTCOME_UNKNOWN`.

### 5.5 `GET /admin/invitations/:invitation_id`
`{ "data": { "invitation": { …như trên…, "status", "version", "terminal_at", "successor_id", "expired": boolean }, "activation": { "state": "NONE" } } }`. `expired` = `status='PENDING'` và đồng hồ DB ≥ `expires_at` (chỉ đọc, không ghi). Không bao giờ có token, digest, link. `activation.state` luôn `NONE` ở 1B (1C điền tiến trình). 404 `ADMIN_INVITATION_NOT_FOUND`.

### 5.6 `POST /admin/invitations/:invitation_id/reissue`
- Header: `Idempotency-Key`. Body: `{ "operation_id", "expected_version", "reason" }`. Theo Q1/Q2 mặc định, bản mới sao chép snapshot của bản cũ, cùng SĐT.
- `201`: `{ "data": { "invitation": { …bản mới… }, "superseded_invitation_id": "<cũ>", "activation_link": "…" } }`.
- Lỗi: như 5.4, thêm 404 `ADMIN_INVITATION_NOT_FOUND`, 409 `ADMIN_VERSION_CONFLICT` (phiên bản khác `expected_version`), 409 `ADMIN_INVITATION_NOT_PENDING`.

### 5.7 `POST /admin/invitations/:invitation_id/revoke`
Header `Idempotency-Key`. Body `{ "operation_id", "expected_version", "reason" }`. `200`: `{ "data": { "invitation": { …, "status": "REVOKED", "version": <n+1>, "terminal_at" } } }`. Lỗi như 5.6.

### 5.8 (đã gộp) Nhóm lỗi chung xem mục 11.

### 5.9 `GET /admin/invitations` (nếu Q9 được duyệt)
Query `status` (tuỳ chọn, một trong 6 giá trị), `limit` (1–50, mặc định 20), `cursor` (opaque base64url của `(created_at_ms, invitation_id)`, sai định dạng → `ADMIN_INPUT_INVALID`). Sắp xếp `created_at DESC, invitation_id DESC` (đúng `admin_invitations_list_idx`). `{ "data": { "items": [ …tóm tắt như 5.5, không permissions chi tiết… ], "next_cursor": string|null } }`.

## 6. Step-up 2FA

### 6.1 Máy trạng thái
`PENDING → VERIFIED → CONSUMED`; `PENDING|VERIFIED → INVALIDATED`. Nguyên nhân vô hiệu: tạo operation mới của cùng SYSTEM; đủ 5 sai; (kiểm lười khi dùng) lệch phiên/factor/membership/mục tiêu; hết hạn. Hết hạn **không** cần job: quyết định bằng đồng hồ DB sau khóa cuối, dòng quá hạn chỉ được đánh `INVALIDATED` khi một giao dịch ghi chạm tới nó.

### 6.2 Fingerprint và ràng buộc
`payload_fingerprint = HMAC-SHA-256(key_v, JSON(["admin-operation.v1", action, canonicalPayload]))` với `canonicalPayload` = canonical JSON (thuật toán `canonicalJson` của repo) của payload đã chuẩn hoá (mục 5). `fingerprint_key_id` lưu cùng; khi kiểm dùng đúng khoá lịch sử đó, thiếu khoá ⇒ fail-closed `503` (không rơi về khoá hiện tại). Client không bao giờ tự tính hay gửi fingerprint. Route nghiệp vụ **tính lại** fingerprint từ body của chính nó và so sánh hằng thời gian với operation.

### 6.3 Điều kiện tiêu thụ (trong transaction của mutation)
Operation phải: thuộc `actor_user_id` hiện tại; `actor_session_id` = phiên của request; `factor_id/factor_version` = factor ACTIVE hiện tại; `membership_version` = hiện tại; `action` đúng route; `target_id/expected_version` đúng URL/body; fingerprint khớp; `status='VERIFIED'`; chưa hết hạn (đồng hồ DB đọc sau khóa cuối). Thành công ⇒ `CONSUMED` **cùng transaction** với mutation. Mutation thất bại ⇒ rollback ⇒ operation vẫn `VERIFIED` (dùng lại được đến hết 2 phút cho **đúng** payload đó).

### 6.4 Verify TOTP (lock order riêng, mục 7.3)
Giống `AdminTotpService.#verify`: bucket `TOTP_USER` khóa trước, bucket bị khóa ⇒ từ chối trước khi mở secret; sau đó chuỗi actor, đồng hồ DB đọc một lần, kiểm operation hợp lệ **trước** khi giải mã secret, rồi `matchTotp(secret, code, now, last_accepted_step)`. Sai ⇒ `recordFailure` bucket + `attempt_count+1` + audit DENIED, **commit**, rồi ném lỗi. Đúng ⇒ `advanceStep`, operation `VERIFIED`, audit SUCCESS.

## 7. Giao dịch, protocol khóa và chứng minh

### 7.1 Thứ tự khóa toàn cục (mọi transaction 1B phải là chuỗi con **không giảm** của thứ tự này)

| Hạng | Đối tượng | Chế độ | Ai lấy |
|---|---|---|---|
| R0 | Quota ingress theo IP (`reserveTotpRequest`) | transaction ngắn riêng, **trước** coordinator | mọi POST |
| R1 | Advisory + record idempotency (executor) | `pg_advisory_xact_lock(int,int)` + `FOR UPDATE` | route nghiệp vụ 5.4/5.6/5.7 |
| R2 | Bucket limiter `TOTP_USER` (tăng dần `bucket_key`) | `FOR UPDATE` | chỉ verify 5.2 |
| R3 | Advisory SĐT: miền `11ship.admin-provisioning.phone.v1`, khóa `deriveLockKey(domain,[limiterKey.bucketKey('PROVISIONING_PHONE', phone)])` | `pg_advisory_xact_lock(int,int)` | create/reissue/revoke (SĐT của mục tiêu) |
| R4 | `users` của actor | `FOR SHARE` (verify: `FOR UPDATE`) | mọi route |
| R5 | `admin_memberships` của actor | như R4 | mọi route |
| R6 | `admin_totp_factors` của actor | `FOR SHARE` (verify: `FOR UPDATE`, vì `advanceStep`) | mọi route |
| R7 | `admin_sessions` của phiên request | `FOR SHARE` | mọi route |
| R8 | `admin_invitations` mục tiêu / PENDING theo SĐT | `FOR UPDATE` (verify, create-operation: `FOR SHARE`) | reissue, revoke, create (tìm PENDING cùng SĐT) |
| R9 | `admin_invitation_permissions` | trigger 1A khóa dòng lời mời **vừa tạo** của chính giao dịch (không đảo thứ tự) | create, reissue |
| R10 | `admin_sensitive_operations` của actor (sống) / theo id | `FOR UPDATE` | create-operation, verify, route nghiệp vụ |

Khớp #34 (limiter → user → membership → factor → session) và Technical Design 1A (idempotency → limiter → phone advisory → actor → invitation → …→ operation). Ghi chú: R2 và R3 không bao giờ cùng xuất hiện trong một route; R1 và R2 cũng không. Không route nào lấy khóa có hạng thấp hơn sau khi đã giữ khóa có hạng cao hơn.

### 7.2 Các giao dịch coordinator

**Tiền kiểm (ngoài transaction, không khóa, chỉ lọc sớm):** đọc cookie → `sessions.findByDigest` → CSRF so với nonce lưu (`csrfMatches`) → rồi mới `reserveTotpRequest(ip)` vì cần phiên hợp lệ để tránh tạo hàng bucket cho kẻ lạ (IP quota vẫn trước body theo mẫu #34: thứ tự thực tế *quota IP → parse body → tiền kiểm cookie/CSRF*, Claude sẽ giữ đúng mẫu #34 và ghi rõ trong code). Với reissue/revoke: tiền kiểm đọc SĐT của mục tiêu (**bất biến** nhờ trigger 1A) để lấy khóa R3; không tồn tại ⇒ 404.

**5.1 create-operation** (một transaction): R4→R5→R6→R7 (actor SYSTEM, đồng hồ DB sau R7) → R8 (`FOR SHARE`, chỉ reissue/revoke: tồn tại + `status='PENDING'` + `version = expected_version`) → R10 (khóa operation sống của actor, đánh `INVALIDATED`, `INSERT` operation mới) → audit `operation_created` → commit.

**5.2 verify**: R2 → R4(X)→R5(X)→R6(X)→R7 → R8(S, nếu có mục tiêu: còn PENDING và đúng version) → R10 (`operation_id`) → đồng hồ DB một lần → các kiểm tra mục 6.4 → ghi (bucket, `attempt_count`, factor, operation, audit) → commit; lỗi xác minh ném **sau** commit.

**5.4 create**: `executor.execute`: R1 → R3 (SĐT từ body đã chuẩn hoá) → R4..R7 (SYSTEM) → R8 (`lockPendingByPhone`: nếu có, đồng hồ DB; còn hạn ⇒ `ADMIN_INVITATION_PENDING_EXISTS`; quá hạn ⇒ `transition(…,'EXPIRED')` + audit `expired`) → kiểm user SĐT (Q3) → R10 (khóa operation `operation_id`, kiểm 6.3) → `participant.create` (insert + snapshot + seal) → operation `CONSUMED` → audit `created` → executor ghi record idempotency → commit.

**5.6 reissue**: R1 → R3 (SĐT mục tiêu) → R4..R7 → R8 (`lock` mục tiêu: `PENDING`, `version = expected_version`) → kiểm user SĐT → R10 → **`transition(old → SUPERSEDED, successorId = idMới)` TRƯỚC**, rồi `participant.create(new)` (đúng bất biến deferred FK của 1A) → operation `CONSUMED` → audit `reissued` → record → commit.

**5.7 revoke**: R1 → R3 → R4..R7 → R8 → R10 → `transition(old → REVOKED)` → operation `CONSUMED` → audit `revoked` → record → commit.

### 7.3 Phần chứng minh (đề xuất test + phản biện)
- **Không đảo thứ tự giữa các route:** bảng 7.1 là chuỗi tham chiếu; mọi cặp route đều lấy tập con theo cùng thứ tự ⇒ đồ thị chờ không có chu trình. Điểm nhạy cảm đã xét: (a) verify giữ factor `FOR UPDATE` còn route nghiệp vụ giữ `FOR SHARE` — cùng hạng R6, không nâng cấp khóa trong một transaction nên không có deadlock nâng cấp; (b) reissue giữ R3 rồi R8; verify không lấy R3 nhưng chỉ lấy R8 dạng `FOR SHARE` sau R4–R7 — không đảo; (c) đăng nhập #34 lấy user→membership→factor→challenge và **không** lấy invitation/operation — không dependency ngược (đã đọc code); (d) logout lấy user→session.
- **Test chứng minh (mục 13, nhóm TL):** (1) *trace order*: decorator test-only của `TransactionContext` ghi lại mọi câu `FOR UPDATE/FOR SHARE/pg_advisory_xact_lock` gắn hạng theo bảng, khẳng định chuỗi không giảm cho từng route (thất bại nếu ai thêm khóa sai thứ tự); (2) *race ngẫu nhiên có rào*: N=100 lần trộn create/reissue/revoke/verify/login/logout/đổi mật khẩu-thu hồi phiên song song, khẳng định không có `40P01` (deadlock) và bất biến cuối ("≤1 PENDING/SĐT", mỗi operation tối đa 1 lần CONSUMED).
- **Giới hạn:** chưa chạy; đây là đề xuất. Chưa gọi là `LOCK_PROTOCOL_FINAL` cho đến khi toàn bộ call graph ở base kết hợp cuối (kể cả #27 nếu Owner đưa vào sau) được rà.

### 7.4 Hết hạn và đồng hồ
Mọi quyết định hết hạn (phiên, operation, lời mời cho nhánh EXPIRED/`expired`, replay) dùng `freshClockMs(context)` **sau khóa cuối của giao dịch**; không `now()` trong predicate; participant 1A không quyết định hết hạn.

### 7.5 Điểm mở rộng cho 1C
Trong reissue/revoke có một hàm riêng `invalidateActivationFor(context, invitationId)` ở **vị trí R8 sau khi khóa lời mời** (không làm gì ở 1B). 1C thêm vô hiệu `attempt` sống + OTP challenge + factor pending bằng khoá theo UUID tăng dần, sau R8, không đổi thứ tự R1–R8.

## 8. Idempotency và replay

- `scopeType = 'admin_user'`, `scopeId = actor_user_id` (principal đã xác thực, không từ client), `operationId ∈ {'admin.invitation.create.v1','admin.invitation.reissue.v1','admin.invitation.revoke.v1'}`. TTL tuỳ chỉnh: `replaySeconds = 900` (15 phút, link), `dedupeSeconds = 86400` (đề xuất; ≥ replay).
- `logicalRequest` = `{ operation_id, action, payloadChuanHoa, invitation_id?, expected_version? }` (mật khẩu không có ở 1B; link không nằm trong logical request). Cùng key + cùng logical request ⇒ replay; khác ⇒ `IDEMPOTENCY_KEY_REUSED`. Hệ quả: một operation mới (re-verify) cần **Idempotency-Key mới**.
- `replay: { kind: 'sensitive', authorize }`. `replayGuard` = `{ actor_user_id, invitation_id, kind }` (không secret). Hook (cùng context, **chỉ đọc, khóa trước khi đọc**): R4→R5→R6→R7 của phiên request hiện tại; yêu cầu cùng `actor_user_id`, SYSTEM ACTIVE, factor ACTIVE, phiên chưa thu hồi/hết hạn (đồng hồ DB); rồi R8 (`FOR SHARE`): với create/reissue yêu cầu lời mời vẫn `PENDING` (đã thu hồi/hết hạn/được kích hoạt ⇒ từ chối bằng `ADMIN_VERSION_CONFLICT`, **không** giải mã link). Revoke replay chỉ cần kiểm actor. Hook cho phép bằng cách `return true`.
- Replay **không** tiêu thụ operation và không cần TOTP mới (Contract v1 mục 6). Sau 15 phút: `IDEMPOTENCY_REPLAY_EXPIRED` (409), link cũ không lấy lại; SYSTEM cấp lại.
- Lỗi/rollback không tiêu thụ key (mô hình executor): thử lại cùng key được thực thi lại nếu operation còn `VERIFIED` và chưa hết hạn.
- Unknown COMMIT (`TRANSACTION_OUTCOME_UNKNOWN` 503): client thử lại **cùng key**; không retry callback phía server. Reissue mất response ⇒ dùng lại key không sinh thêm generation.
- Replay payload chứa link ⇒ chỉ lưu mã hoá (executor sẵn có, AAD gắn tuple + fingerprint).

## 9. Limiter (không thêm số liệu mới)

| Điểm | Cơ chế | Giá trị (đã duyệt ở #34) |
|---|---|---|
| Ingress mọi POST 1B | `reserveTotpRequest(ip)`, transaction riêng, không hoàn trả khi lỗi sau đó | 30 request / 60 s / IP |
| Sai TOTP step-up | bucket `TOTP_USER` dùng chung đăng nhập; commit trước khi lỗi | 5 sai / 15 phút → khóa 15 phút; 429 + `Retry-After` |
| Sai TOTP trên một operation | `attempt_count` | 5 → `INVALIDATED` |
| Mutation route nghiệp vụ | không bucket riêng (tối đa 1 operation sống × 2 phút × quota IP) | — |

Mọi con số trên đã có trong `admin-auth-constants.ts`; 1B không đổi chúng. Nếu ChatGPT/Owner muốn quota theo SYSTEM riêng cho mutation, cần thêm `kind` vào CHECK của `admin_auth_limits` và thiết kế số liệu — **chưa đề xuất**.

## 10. Audit (cùng transaction với mutation; thất bại ⇒ rollback toàn bộ)

| Action (versioned) | Khi nào | Outcome | Metadata (không secret/PII) |
|---|---|---|---|
| `admin_invitation.operation_created.v1` | 5.1 | SUCCESS | `operation_id`, `action`, `target_id?` |
| `admin_invitation.operation_verified.v1` | 5.2 đúng | SUCCESS | `operation_id` |
| `admin_invitation.operation_verify_denied.v1` | 5.2 sai/khóa (cùng transaction commit bộ đếm) | DENIED, `reasonCode` = `TOTP_INVALID`/`LOCKED` | `operation_id`, `attempt_count` |
| `admin_invitation.created.v1` | 5.4 | SUCCESS | `invitation_id`, `generation_id`, `version`, `operation_id`, danh sách quyền `[app:V/R/L]` |
| `admin_invitation.reissued.v1` | 5.6 | SUCCESS | `invitation_id` (mới), `superseded_invitation_id`, `operation_id`, `reason` |
| `admin_invitation.revoked.v1` | 5.7 | SUCCESS | `invitation_id`, `version`, `operation_id`, `reason` |
| `admin_invitation.expired.v1` | create gặp PENDING quá hạn | SUCCESS | `invitation_id`, `version` |

`actorType` theo Q8; `actorId` = SYSTEM user id từ principal đã kiểm; `requestId` do server tạo; `resourceType='admin_invitation'`, `resourceId`, `resourceVersion`. **Không** ghi mật khẩu, token, link, digest, SĐT, họ tên, ghi chú, cookie, header, mã TOTP. Test quét audit + log chụp được để khẳng định không có chuỗi link/token.

## 11. Mã lỗi (đăng ký trong `APP_ERROR_DEFINITIONS`, thông điệp cố định, không phản chiếu input)

| HTTP | Mã | Ghi chú |
|---|---|---|
| 400 | `ADMIN_INPUT_INVALID` | **mới**; cú pháp/chuẩn hoá/khóa lạ/cursor |
| 400 | `ADMIN_TOTP_INVALID` | đã có (#34) |
| 400/409 | `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_BUSY`, `IDEMPOTENCY_REPLAY_EXPIRED`, `IDEMPOTENCY_KEY_UNAVAILABLE` | đã có |
| 401 | `ADMIN_SESSION_INVALID` | đã có |
| 403 | `ADMIN_FORBIDDEN` | **mới**; phiên hợp lệ nhưng không phải SYSTEM |
| 403 | `ADMIN_CSRF_INVALID` | đã có |
| 403 | `ADMIN_STEP_UP_REQUIRED` | **mới**; operation thiếu/hết hạn/không khớp/đã dùng |
| 404 | `ADMIN_INVITATION_NOT_FOUND` | **mới**, chỉ cho SYSTEM đã xác thực (khác lỗi công khai `ADMIN_INVITATION_UNAVAILABLE` của 1C) |
| 409 | `ADMIN_VERSION_CONFLICT` | **mới** |
| 409 | `ADMIN_INVITATION_NOT_PENDING` | **mới** |
| 409 | `ADMIN_INVITATION_PENDING_EXISTS` | **mới**; SĐT đã có lời mời PENDING còn hạn |
| 409 | `ADMIN_PHONE_CONFLICT` | **mới** (Contract v1 mục 8) |
| 429 | `ADMIN_AUTH_RATE_LIMITED` | đã có; kèm `Retry-After` |
| 503 | `TRANSACTION_OUTCOME_UNKNOWN`, lỗi khoá lịch sử thiếu (503 chung) | đã có |

Cần cập nhật các test registry/HTTP hiện có (`error-registry-http.int.spec.ts` và test liệt kê mã) và kiểm tương thích trước code, theo yêu cầu Contract v1 mục 8.

## 12. Cấu hình (đề xuất)

`ADMIN_INVITATION_TTL_HOURS` (mặc định 72; số nguyên 1–168; sai ⇒ dừng khởi động, chỉ nêu tên biến) và `ADMIN_ACTIVATION_ORIGIN` (HTTPS ở staging/production; phải thuộc `ADMIN_AUTH_ALLOWED_ORIGINS`; sai ⇒ dừng khởi động). Chỉ đọc khi `ADMIN_AUTH_ENABLED=true`. TTL được chụp vào `expires_at` lúc tạo (participant 1A nhận `ttlSeconds`), đổi cấu hình **không** kéo dài lời mời cũ. Cập nhật `.env.example`, README/runbook, test cấu hình.

## 13. Kế hoạch test (đồng thời và replay là trọng tâm)

Unit: parser/chuẩn hoá payload; fingerprint ổn định + nhạy thứ tự quyền + khác action; máy trạng thái operation; mapping lỗi; config. Integration trên PostgreSQL thật qua pipeline Nest thật; rào đồng thời bằng barrier và `waitForBlockedBackends` (không `sleep`).

- **AZ (authorization):** ADMIN-role bị `ADMIN_FORBIDDEN` trên *mọi* route; không cookie / token app Khách-Quán-Xế / cookie sai ⇒ `ADMIN_SESSION_INVALID`; Origin sai/CSRF thiếu ⇒ 403; user bị `DISABLED`, membership `DISABLED`, đổi mật khẩu (binding lệch), phiên thu hồi, phiên hết hạn *trong lúc chờ khóa* (đồng hồ DB sau khóa) ⇒ 401; SYSTEM thứ hai không tồn tại (unique đã có).
- **SU (step-up):** sai mã tăng bộ đếm và **được commit**; 5 sai ⇒ INVALIDATED; bucket khóa ⇒ 429 + `Retry-After` trước khi mở secret; mã vừa dùng đăng nhập bị từ chối; mã step trước/sau cửa sổ; operation hết hạn trong lúc chờ khóa; sai target/body/version/action/operation của người khác; dùng lại sau CONSUMED; đăng nhập lại (phiên mới) / đổi factor / tăng version membership ⇒ operation vô dụng; tạo operation thứ hai ⇒ cái cũ INVALIDATED; verify song song hai request cùng mã ⇒ đúng một thành công.
- **CR (create):** thành công (invitation + snapshot + digest, link không có trong DB/audit/log, một audit, một record idempotency); PENDING còn hạn ⇒ `PENDING_EXISTS`; PENDING quá hạn ⇒ `EXPIRED` + audit rồi tạo mới; SĐT đã là user ⇒ `ADMIN_PHONE_CONFLICT`; **hai create song song cùng SĐT (khác key, khác operation) ⇒ đúng một 201**; audit lỗi ⇒ rollback toàn bộ (không invitation/operation CONSUMED/record); thiếu VIEW/quyền sai ⇒ 400.
- **RI (reissue/revoke):** reissue SUPERSEDED cũ + PENDING mới trong một transaction (đúng thứ tự deferred FK); `expected_version` cũ ⇒ `VERSION_CONFLICT`; mục tiêu terminal ⇒ `NOT_PENDING`; **reissue song song revoke trên cùng mục tiêu ⇒ đúng một thắng**, bên thua `VERSION_CONFLICT`/`NOT_PENDING`; hai reissue song song khác operation ⇒ một thắng; rollback giữ nguyên bản cũ khi bất kỳ bước sau transition lỗi; reissue lời mời PENDING quá hạn thành công.
- **RP (replay):** mất response ⇒ cùng key trả đúng link cũ, không sinh generation thứ hai; khác body ⇒ `KEY_REUSED`; sau 15 phút ⇒ `REPLAY_EXPIRED` và không giải mã; replay sau khi phiên thu hồi / membership vô hiệu / mất SYSTEM ⇒ bị từ chối **trước** giải mã (kiểm bằng record bị làm hỏng ciphertext vẫn nhận lỗi quyền chứ không lỗi crypto); replay khi lời mời đã bị thu hồi ⇒ từ chối; hai request song song cùng key ⇒ một thực thi, một `BUSY`/replay; thiếu khoá lịch sử ⇒ fail-closed 503; **unknown COMMIT** (tiêm lỗi ack COMMIT ở biên client như hạ tầng test hiện có) ⇒ 503, thử lại cùng key ⇒ đúng một lời mời.
- **TL (lock proof):** trace thứ tự khóa theo bảng 7.1 cho từng route (xem 7.3); race ngẫu nhiên N=100, không `40P01`, bất biến cuối giữ; login/logout/verify/create song song không deadlock.
- **AU (audit/secret):** mỗi mutation đúng một audit cùng transaction; verify sai có audit DENIED khi bộ đếm commit; quét log/audit/response không chứa token/link/digest/SĐT trừ link ở response tạo/replay.
- **LM (limiter):** request thứ 31/phút/IP ⇒ 429 + `Retry-After`; bucket `TOTP_USER` dùng chung với đăng nhập (sai ở step-up khoá cả đăng nhập TOTP và ngược lại — test ghi nhận quyết định Q5).
- **MG (migration):** up/down/up chỉ trên DB test có guard; CHECK hình dạng theo action/status; trigger chuyển trạng thái; unique "một operation sống/SYSTEM"; FK NO ACTION; runbook grants khớp.
- **CF (config):** TTL 1–168, thiếu/ngoài khoảng ⇒ dừng khởi động chỉ nêu tên biến; origin link ngoài danh sách ⇒ dừng.
- **Hồi quy:** toàn bộ suite #34/#37 giữ xanh; không route 1B nào đổi hành vi `/admin-auth/*`.

CI phải đạt trên final head; lint, typecheck, build bắt buộc. Môi trường làm việc của Claude không cài được jest (registry bị chặn) ⇒ bằng chứng test chính thức là CI, như ở #34/#37.

## 14. File dự kiến (đổi khi review)

Mới: migration `*_create-admin-sensitive-operations.sql`; `apps/backend/src/admin-provisioning/` (controller, `admin-operation-service`, `admin-invitation-service`, `admin-system-actor` participant dùng `lockAndCheck`, repository operation, validation/chuẩn hoá, `activation-link` builder, hằng số); các spec và `tests/integration/admin-provisioning-*.int.spec.ts` (+ fixtures dùng `createSystem`/`createAdminMember` hiện có).
Sửa: `common/app-errors.ts` (mã mới) và test registry; `crypto/key-version.ts` + `keyring.ts` (mục đích `adminOperation`, Q11) + `admin-purposes.spec.ts`; `config/admin-auth-config.ts` (+spec, `.env.example`); `app.module.ts` (mount có điều kiện); `ops/runbooks/render-supabase-staging.md` (grants + biến mới); test migration/trigger liệt kê migration mới; dọn dữ liệu test (`purgePhone`) cho bảng mới.
Không sửa: migration đã apply, `/admin-auth/*`, bất kỳ route app Khách/Quán/Xế.

## 15. Gate và ma trận từng ứng dụng (theo workflow)

| Giai đoạn | Người | Trạng thái |
|---|---|---|
| Hợp đồng 1B (tài liệu này) | Claude soạn → ChatGPT review → Owner chốt Q1–Q11 | **Chờ review** |
| Code + test 1B | Claude | Chưa bắt đầu; chỉ sau khi review đạt |
| Review diff đúng SHA | ChatGPT | Chưa |
| Test local, Authenticator thật | Owner | Chưa (cần UI SYSTEM — gói riêng) |

| Ứng dụng | Phạm vi 1B | Ghi chú |
|---|---|---|
| Web quản trị | Backend API cho SYSTEM; **không UI** (UI-06 Owner đã duyệt, code UI là gói khác) | Chưa kiểm chứng |
| Khách / Quán / Xế | N/A: chỉ dùng app; không route 1B nào mở cho họ; test âm tính xác nhận | Quyết định N/A thuộc Owner |
| App quản lý | N/A trong 1B | Quyết định Owner |
| Liên thông | Chưa xác định; kích hoạt là 1C | Chưa kiểm chứng |

## 16. Giới hạn và những gì chưa kiểm chứng

- Chưa có code, migration, test hay CI nào cho 1B; mọi mục trên là **thiết kế đề xuất** dựa trên việc đọc code #34/#37.
- Protocol khóa chưa gọi là `LOCK_PROTOCOL_FINAL`: cần rà toàn bộ call graph ở base kết hợp cuối và chạy các test TL.
- Chưa kiểm lịch sử migration DB Owner/staging (không có quyền operator read-only); migration 1B chỉ chạy trên DB test, không deploy.
- Các số liệu limiter/TTL đều là giá trị đã duyệt ở #34 hoặc Contract v1; 1B không đề xuất giá trị limiter mới. `dedupeSeconds = 86400` là điểm duy nhất Claude tự đề xuất (cần xác nhận).
- Chưa có Owner nghiệm thu, chưa đóng M01, chưa deploy.
