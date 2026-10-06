# ADR-003 — Transactional Core: transaction context, idempotency, audit và outbox

Ngày: 07/10/2026. Phiên bản: 0.2. Trạng thái: REVIEWED — READY FOR OWNER LOCK; chưa CODE_READY cho implementation.
Phạm vi: M00-C1. Phụ thuộc: M00-B1 đã FOUNDATION READY trên `main` tại merge SHA `91316a5fe155f7af5ad96491121f5bbee60703c6`.

## 1. Mục tiêu

M00-C1 tạo nền dùng chung cho các mutation sau này (Auth, Wallet, Delivery, Order) để:
- nhiều service cùng tham gia một PostgreSQL transaction thật;
- retry cùng một logical request không tạo side effect lặp;
- mutation quan trọng có audit record;
- business event được ghi cùng transaction và phát theo mô hình outbox at-least-once;
- Auth register có thể replay cùng logical result chứa `access_token` mà không lưu token plaintext.

Không thêm Redis, broker, ORM, microservice hoặc business table.

## 2. Transaction context

Chọn explicit transaction context, không dùng AsyncLocalStorage làm nguồn đúng/sai của transaction.

- `TransactionManager.withTransaction(work)` lấy đúng một `PoolClient`, BEGIN/COMMIT/ROLLBACK và release trong finally.
- Callback nhận `TransactionContext`; repository/service mutation nhận context này và dùng cùng client.
- Service con không tự mở transaction mới khi đang tham gia command của coordinator.
- Controller không gọi `pg` trực tiếp.
- Default isolation là PostgreSQL READ COMMITTED.
- External network/provider call không chạy trong DB transaction. Kết quả external phải lấy trước, sau đó khi vào transaction phải re-check state/version/policy cần thiết trước commit.
- M00-C1 **không tự retry transaction**. SQLSTATE `40001`/`40P01` được surface thành lỗi kỹ thuật đã sanitize; module coordinator sau này chỉ được thêm bounded retry khi callback được chứng minh retry-safe. C1 không cung cấp helper tự chạy callback lần hai, tránh vô tình lặp external side effect.

## 3. Idempotency model

### 3.1 Scope

Unique logical key:

`(scope_type, scope_id, operation_id, idempotency_key)`

- `scope_type/scope_id` luôn do server suy ra, không nhận raw actor scope từ client.
- Authenticated mutation thường dùng user/session-derived scope.
- Register có thể dùng verified proof record làm scope sau khi token proof được xác thực.
- `operation_id` là tên ổn định của command, không dùng URL tự do.
- `Idempotency-Key` dùng UUID canonical 36 ký tự, normalize chữ hex về lowercase; nil UUID bị từ chối. Client nên phát UUID ngẫu nhiên (v4 là mặc định phù hợp). Invalid -> `INVALID_IDEMPOTENCY_KEY`.
- Endpoint contract nào yêu cầu key mà thiếu -> `IDEMPOTENCY_KEY_REQUIRED`.
- Idempotency không thay thế unique constraint/business invariant. Hết `dedupe_expires_at`, key có thể bắt đầu một idempotency window mới; các nghiệp vụ tiền/đơn vẫn phải có invariant riêng để chống duplicate dài hạn.

### 3.2 Serialize concurrent same-key bằng advisory transaction lock

Không commit record trạng thái "in progress".

Flow trong cùng transaction:
1. canonicalize exact tuple scope + operation + idempotency key và SHA-256 nó; lấy 8 byte đầu thành **hai signed int32** để gọi advisory-lock API 2-key, tránh sai số JavaScript khi biểu diễn bigint 64-bit;
2. trong transaction, đặt `SET LOCAL lock_timeout` theo idempotency wait bound rồi lấy `pg_advisory_xact_lock(int,int)`; wait bound phải nhỏ hơn DB query timeout. Chỉ lock-timeout ở bước này được map thành `IDEMPOTENCY_BUSY`;
3. SELECT exact idempotency record `FOR UPDATE`;
4. nếu đã có: so request fingerprint rồi replay hoặc conflict;
5. nếu chưa có: chạy business callback, audit/outbox cần thiết, ghi completed idempotency record, commit.

Transaction-level advisory lock tự nhả khi transaction kết thúc. Collision hash chỉ làm serialize dư, không làm sai correctness vì record vẫn có UNIQUE exact tuple. Không dùng session-level advisory lock.

Nếu bounded wait hết hạn: rollback transaction, không chạy business callback; trả error retryable `IDEMPOTENCY_BUSY` (409) với message chung. Không biến query timeout/DB outage chung thành `IDEMPOTENCY_BUSY`.

### 3.3 Request fingerprint

Không lưu request body.

- Logical request là object **do operation adapter khai báo rõ** sau validate/normalize; generic layer không tự chọn field để bỏ qua. Field ảnh hưởng side effect hoặc response phải nằm trong logical request.
- Canonical JSON ổn định: object key sort, array giữ thứ tự, JSON primitive; reject undefined/non-finite. Canonicalizer **không trim/Unicode-normalize nội dung string**; password/proof giữ đúng semantics của endpoint.
- Fingerprint dùng HMAC-SHA-256 bằng subkey bí mật, không dùng SHA-256 trần. Mục tiêu là không biến fingerprint của password/proof/OTP thành oracle brute-force offline nếu DB bị lộ.
- DB chỉ lưu fingerprint hex + `crypto_key_id`.
- Với record đã tồn tại, incoming request phải được fingerprint lại bằng **HMAC subkey của chính `record.crypto_key_id`**, không dùng active key hiện tại. Vì vậy rotation active key không làm cùng request biến thành conflict.
- Same key + same logical request -> replay.
- Same key + different logical request -> 409 `IDEMPOTENCY_KEY_REUSED`, tuyệt đối không chạy mutation lại.
- Không log canonical request hoặc HMAC key.
- Mặc định chỉ **committed replayable success (HTTP 2xx)** mới tạo idempotency record. Validation/authorization/business failure hoặc transaction rollback không consume key và không được cache trừ khi một operation sau này có contract riêng được review.

## 4. Encrypted replay payload cho response có secret

ADR-002 yêu cầu register trả `access_token`, trong khi `sessions` chỉ lưu SHA-256 token. Vì vậy M00-C1 phải có encrypted replay payload.

### 4.1 Crypto

Dùng Node.js built-in `node:crypto`, không thêm crypto package:
- master key mỗi version: 32 random bytes;
- HKDF-SHA-256 domain separation tạo 2 subkey: request-HMAC và replay-encryption;
- replay encryption: AES-256-GCM;
- IV: random 12 bytes cho mỗi record;
- auth tag: 16 bytes; khi tạo cipher/decipher phải chỉ rõ `authTagLength=16`;
- AAD bind immutable record identity bằng encoding không mơ hồ (canonical JSON array hoặc length-prefixed UTF-8): replay_format_version + record_id + scope + operation + idempotency_key + request_fingerprint + crypto_key_id.

Không hard-code key. Key provider đọc keyring từ secret/config injection. `.env.example` chỉ placeholder. Production sau này phải đưa key bằng secret manager/secret injection; DB không chứa master key.

### 4.2 Rotation

- Config có `active_key_id` và keyring chứa active + historical key còn hiệu lực.
- New record luôn dùng active key.
- Existing record luôn fingerprint/verify/decrypt bằng `crypto_key_id` đã lưu.
- Rotate = add key mới, đổi active id, giữ key cũ ít nhất đến khi mọi record dùng key đó hết `dedupe_expires_at` và cleanup đã chạy.
- Missing historical key khi record còn sống -> fail closed `IDEMPOTENCY_KEY_UNAVAILABLE` (503), không re-execute mutation.

### 4.3 Replay authorization

`Idempotency-Key` một mình không đủ để nhận secret replay.

Record có `replay_guard` JSON nhỏ, plaintext nhưng chỉ chứa non-secret identifiers cần check quyền (ví dụ session_id/user_id/resource id), không chứa token/password/proof. Sensitive replay hook nhận cùng `TransactionContext`, kiểm state/quyền hiện hành **trong transaction trước decrypt**; module sau quyết định row lock cụ thể để tránh TOCTOU.

Khi record đã tồn tại:
1. compare request fingerprint;
2. endpoint/module chạy current authorization/replay-guard check;
3. chỉ khi check pass mới decrypt replay payload;
4. nếu session đã revoke/expire thì không trả access token cũ.

M00-C1 cung cấp hook bắt buộc cho sensitive replay; M01 sẽ implement session-specific check.

**Register integration rule:** verification token phải có cách resolve ra proof identity mà chưa consume. Sau một register thành công, retry cùng key vẫn phải resolve được proof record đã `used` để tìm idempotency record trước; chỉ callback của một **new** request mới enforce `proof unused` và consume nó. Nếu Auth kiểm `proof unused` trước idempotency lookup thì A01-09 sẽ bị phá.

## 5. TTL và cleanup

Hai mốc riêng:
- `replay_expires_at`: mặc định 15 phút; sau mốc này không decrypt/trả secret.
- `dedupe_expires_at`: mặc định 7 ngày; giữ tombstone để không chạy mutation lại.

Nếu cùng key/request đến sau replay expiry nhưng trước dedupe expiry:
- không chạy business callback;
- trả 409 `IDEMPOTENCY_REPLAY_EXPIRED`.

Persisted expiry/lease decisions dùng PostgreSQL time (`CURRENT_TIMESTAMP`) để tránh clock skew giữa process.

Cleanup có 2 pha và claim row bằng `FOR UPDATE SKIP LOCKED`:
1. null ciphertext/IV/tag của record quá replay TTL nhưng giữ fingerprint/tombstone;
2. delete record quá dedupe TTL.

Executor không phụ thuộc cleanup chạy đúng giờ: nếu exact record đã `dedupe_expires_at <= CURRENT_TIMESTAMP`, executor xóa record hết hạn trong cùng locked transaction rồi xử lý request như idempotency window mới. Nếu quá replay TTL nhưng chưa quá dedupe TTL thì vẫn trả `IDEMPOTENCY_REPLAY_EXPIRED` và không re-execute.

Có thể override TTL theo operation nhưng `replay_ttl <= dedupe_ttl` và bị bound bằng config. C1 không tạo scheduler production; chỉ cung cấp cleanup primitive + test.

## 6. Bảng idempotency_records

Trong schema `app`, tối thiểu:
- `record_id uuid PK`
- `scope_type`, `scope_id`, `operation_id`, `idempotency_key`
- `request_fingerprint char(64)`
- `crypto_key_id`
- `response_status` (chỉ 200..299 trong C1)
- `replay_format_version smallint` (bắt đầu 1)
- `replay_guard jsonb`
- `replay_ciphertext bytea`, `replay_iv bytea`, `replay_tag bytea` nullable cùng nhau
- `created_at`, `replay_expires_at`, `dedupe_expires_at`
- UNIQUE exact tuple scope/operation/key
- CHECK TTL ordering và replay fields all-null/all-present.

Không lưu plaintext request, Authorization, password, OTP, proof hoặc access token.

## 7. Audit

Bảng `app.audit_logs` append-only.

Tối thiểu:
- `audit_id uuid PK`
- `occurred_at`
- `request_id`
- actor type/id do server suy ra
- `action`
- resource type/id/version khi có
- `outcome` = SUCCESS / DENIED / FAILURE
- `reason_code` ngắn, không raw exception
- `metadata jsonb` nhỏ, whitelist/safe JSON.

Quy tắc:
- successful business mutation cần audit thì append trong cùng transaction;
- rollback business transaction -> audit success record cũng rollback;
- security denial/failure không có business commit có thể ghi bằng standalone short transaction;
- không lưu raw request/response, token, password, OTP, proof, DB URL, Authorization, cookie;
- repository không expose update/delete; migration tạo trigger chặn UPDATE/DELETE/TRUNCATE để append-only ở application path.
- audit SUCCESS là một phần correctness của mutation: insert audit thất bại -> mutation rollback. Audit DENIED/FAILURE standalone là best-effort observability: nếu audit store lỗi thì vẫn giữ nguyên response denial/failure gốc và chỉ log lỗi audit đã sanitize.

## 8. Outbox

Bảng `app.outbox_events` là kênh chuyển event, không thay business history.

Envelope:
- `event_id uuid PK`
- `event_type`
- `event_schema_version >= 1`
- `resource_type`, `resource_id`, `resource_version`
- `occurred_at`
- `payload jsonb` đã kiểm safe/non-secret.

Delivery fields:
- status PENDING / PROCESSING / PUBLISHED / DEAD
- `available_at`
- `attempt_count` (tăng khi một publish attempt được claim; stale unknown-outcome reclaim sẽ tạo attempt mới)
- `locked_at`, `lock_token`
- `published_at`
- `last_error_code` sanitized.

Write path:
- event insert bằng chính TransactionContext của business mutation;
- business rollback -> event rollback.

Dispatch engine:
- claim batch bằng `FOR UPDATE SKIP LOCKED`;
- mark PROCESSING + lease token rồi commit;
- gọi publisher bên ngoài DB transaction;
- success -> conditional ack theo lock_token;
- failure -> PENDING + bounded exponential backoff; quá max attempts -> DEAD;
- stale PROCESSING lease được reclaim theo PostgreSQL time. Ack/fail luôn conditional theo `lock_token`; worker giữ lease cũ không thể overwrite state của worker đã reclaim.

Delivery semantics: at-least-once. Crash sau publish nhưng trước ack có thể publish lại cùng `event_id`. Consumer bắt buộc dedupe theo event_id. Không tuyên bố exactly-once.

M00-C1 chỉ tạo publisher interface + dispatcher engine + fake publisher cho integration test; chưa kết nối broker/push/WS thật và không bắt background worker tự chạy production.

## 9. Size/privacy bounds

Hard caps ở C1 (tính theo UTF-8 serialized bytes trước DB write):
- replay plaintext JSON: 64 KiB;
- outbox payload: 64 KiB;
- audit metadata: 8 KiB;
- replay_guard: 4 KiB;
- JSON nesting depth: tối đa 8.

Module có thể đặt cap nhỏ hơn, không lớn hơn nếu chưa sửa ADR. Audit metadata cần action-specific allowlist ở module; generic writer chỉ là lớp chặn secret/size cuối cùng. Không coi denylist secret là cơ chế PII governance đầy đủ.

## 10. Error contract mới

Các code nền có thể dùng:
- `IDEMPOTENCY_KEY_REQUIRED` — 400
- `INVALID_IDEMPOTENCY_KEY` — 400
- `IDEMPOTENCY_KEY_REUSED` — 409
- `IDEMPOTENCY_BUSY` — 409
- `IDEMPOTENCY_REPLAY_EXPIRED` — 409
- `IDEMPOTENCY_KEY_UNAVAILABLE` — 503
- lỗi crypto/tamper ngoài dự kiến phải fail closed, response chung, không leak ciphertext/key id/raw crypto error.

M00-C1 không tạo public business endpoint. Integration test dùng test-only Nest module/harness.

## 11. Không thuộc M00-C1

- Auth/users/sessions/proof schema.
- Shop/Driver/Wallet/Order/Delivery business tables.
- Lock order cụ thể của wallet/driver aggregates.
- Redis/message broker.
- Push/WS provider.
- Production KMS provisioning.
- Full audit retention/compliance policy.
- Outbox consumer của từng business module.
- Exactly-once delivery.

## 12. Nguồn kỹ thuật

- PostgreSQL 17 advisory transaction locks: `pg_advisory_xact_lock`; lock transaction tự nhả khi transaction kết thúc.
- PostgreSQL `FOR UPDATE SKIP LOCKED` cho claim worker concurrent.
- Node 24 `node:crypto`: AES-GCM, random IV, auth tag.
- OWASP Cryptographic Storage/Key Management: authenticated encryption, không hard-code key, hỗ trợ rotation và tách key khỏi data.

