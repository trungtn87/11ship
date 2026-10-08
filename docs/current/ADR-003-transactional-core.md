# ADR-003 — Transactional Core: transaction context, idempotency, audit và outbox

Ngày: 07/10/2026. Phiên bản: 0.3. Trạng thái: OWNER LOCKED DESIGN — 07/10/2026; chỉ C1A0 được mở qua task riêng.
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
- Register dùng scope_type=verification_proof, scope_id=proof.id, operation_id=auth.register.v1 sau khi xác minh token digest và binding phone/purpose.
- `operation_id` là tên ổn định của command, không dùng URL tự do.
- `Idempotency-Key` dùng UUID canonical 36 ký tự, normalize chữ hex về lowercase; nil UUID bị từ chối. Client nên phát UUID ngẫu nhiên (v4 là mặc định phù hợp). Invalid -> `INVALID_IDEMPOTENCY_KEY`.
- Endpoint contract nào yêu cầu key mà thiếu -> `IDEMPOTENCY_KEY_REQUIRED`.
- Idempotency không thay thế unique constraint/business invariant. Hết `dedupe_expires_at`, key có thể bắt đầu một idempotency window mới; các nghiệp vụ tiền/đơn vẫn phải có invariant riêng để chống duplicate dài hạn.

### 3.2 Serialize concurrent same-key bằng advisory transaction lock

Không commit record trạng thái "in progress".

Flow trong cùng transaction:
1. encode canonical JSON array ["11ship.idempotency.lock.v1", scope_type, scope_id, operation_id, idempotency_key] và SHA-256 nó; đọc byte 0..3 và 4..7 thành **hai signed int32 big-endian** để gọi advisory-lock API 2-key, tránh sai số JavaScript khi biểu diễn bigint 64-bit;
2. trong transaction, đặt `SET LOCAL lock_timeout` theo idempotency wait bound rồi lấy `pg_advisory_xact_lock(int,int)`; wait bound phải nhỏ hơn DB query timeout. Chỉ lock-timeout ở bước này được map thành `IDEMPOTENCY_BUSY`;
3. restore lock_timeout về business lock budget đã cấu hình, rồi SELECT exact idempotency record `FOR UPDATE`;
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
- AAD bind immutable record identity bằng encoding không mơ hồ (canonical JSON array hoặc length-prefixed UTF-8): replay_format_version + record_id + scope + operation + idempotency_key + request_fingerprint + crypto_key_id + canonical replay_guard + response_status + replay_expires_at. Encoding cụ thể ở §13.

Không hard-code key. Key provider đọc keyring từ secret/config injection. `.env.example` chỉ placeholder. Production sau này phải đưa key bằng secret manager/secret injection; DB không chứa master key.

### 4.2 Rotation

- Config có `active_key_id` và keyring chứa active + historical key còn hiệu lực.
- New record luôn dùng active key.
- Existing record luôn fingerprint/verify/decrypt bằng `crypto_key_id` đã lưu.
- Rotate = add key mới, đổi active id, giữ key cũ ít nhất đến khi mọi record dùng key đó hết `dedupe_expires_at` và cleanup đã chạy.
- Missing historical key khi record còn sống -> fail closed `IDEMPOTENCY_KEY_UNAVAILABLE` (503), không re-execute mutation.

### 4.3 Replay authorization

`Idempotency-Key` một mình không đủ để nhận secret replay.

Record có `replay_guard` JSON nhỏ, plaintext nhưng chỉ chứa non-secret identifiers cần check quyền (ví dụ session_id/user_id/resource id), không chứa token/password/proof. Sensitive replay hook nhận cùng `TransactionContext`, kiểm state/quyền hiện hành **trong transaction trước decrypt**; hook phải khóa các row quyết định quyền bằng protocol tương thích với revoke/disable; SELECT thường trong cùng transaction không đủ. Hook read-only, giữ khóa tới transaction end. Register protocol ở §13.

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

Persisted expiry/lease decisions dùng fresh PostgreSQL clock_timestamp() sau khi lấy lock cần thiết. Không dùng CURRENT_TIMESTAMP/now() (cố định tại BEGIN) để quyết định expiry sau thời gian chờ. Kiểm replay và session expiry lần cuối ngay trước decrypt; tại equality coi là expired. TTL record mới tính từ thời điểm hoàn thiện record gần commit; lease tính tại lúc mark PROCESSING. Không hứa token còn hạn đến lúc mạng giao response.

Cleanup có 2 pha và claim row bằng `FOR UPDATE SKIP LOCKED`:
1. null ciphertext/IV/tag của record quá replay TTL nhưng giữ fingerprint/tombstone;
2. delete record quá dedupe TTL.

Executor không phụ thuộc cleanup chạy đúng giờ: nếu exact record đã `dedupe_expires_at <= fresh DB decision time`, executor xóa record hết hạn trong cùng locked transaction rồi xử lý request như idempotency window mới. Nếu quá replay TTL nhưng chưa quá dedupe TTL thì vẫn trả `IDEMPOTENCY_REPLAY_EXPIRED` và không re-execute.

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

Delivery semantics: at-least-once attempt/retry, có thể duplicate; retry hữu hạn có thể kết thúc DEAD, nên không bảo đảm eventual successful delivery nếu chưa có recovery. Crash sau publish nhưng trước ack có thể publish lại cùng `event_id`. Consumer bắt buộc dedupe theo event_id. Không tuyên bố exactly-once.

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



## 13. Audit revision v0.3 — normative implementation contracts

Các điều khoản này bổ sung/chi tiết hóa §2–10; không phải implementation evidence.

### 13.1 Transaction lifecycle và lỗi

- TransactionContext là query capability gắn một client và trạng thái ACTIVE/CLOSED; không expose BEGIN/COMMIT/release cho repository. Query sau CLOSED bị reject trước khi chạm client.
- Chỉ outer coordinator sở hữu TransactionManager; participant chỉ nhận context, không inject manager để mở transaction riêng. Không cung cấp savepoint/nested transaction feature.
- Có transaction deadline và idle-in-transaction timeout trên PostgreSQL 17; defaults đề xuất 5s tổng, 2s idle, mỗi giá trị cấu hình trong 100ms..30s. Transaction timeout phải lớn hơn statement timeout. Query timeout phía client phải lớn hơn server statement timeout để ưu tiên nhận kết quả hủy từ server. Validate quan hệ config tại startup.
- Advisory wait default 250ms, bound 1ms..5s và nhỏ hơn statement timeout; business lock budget default 500ms, cũng nhỏ hơn statement timeout. Restore budget sau advisory acquisition. Chỉ SQLSTATE 55P03 phát sinh tại acquisition đó map BUSY.
- Không dùng Promise.race rồi release một client mà callback còn chạy. Khi deadline/cancel, context bị đóng; cleanup client phải xử lý query đang chạy và destroy connection nếu trạng thái không xác định. Callback không được giữ reference client hoặc chạy detached query.
- COMMIT mất acknowledgement là UNKNOWN outcome, không được kết luận rollback. Trả 503 TRANSACTION_OUTCOME_UNKNOWN với message cố định, không tự retry callback. Client retry cùng key; DB record/lock quyết định replay hay execution.
- ROLLBACK/connection failure: destroy client, không đưa client không sạch vào pool; giữ nguyên lỗi gốc đã sanitize. Release/destroy chỉ một lần. BEGIN failure cũng cleanup.
- 40001/40P01 rollback và surface lỗi kỹ thuật an toàn; tuyệt đối không helper auto-retry. Callback có thể được chạy lại bởi request mới sau rollback, không có bảo đảm callback once-ever.
- READ COMMITTED đủ cho protocol exact-key này; module nghiệp vụ vẫn phải có unique/version/aggregate locks riêng. Không external call, Argon2 computation dài hoặc publisher trong transaction; chuẩn bị ngoài transaction và recheck state dưới lock.
- Error registry nội bộ ánh xạ code/status/message cố định; unknown exception không được tự cung cấp code/message/details. Bổ sung HTTP filter để bảo toàn các code §10. Không trả raw SQL/crypto errors.

### 13.2 Register proof và replay authorization

- Resolve token -> digest -> proof identity kiểm cryptographic token match, normalized phone và purpose REGISTER. Không coi consumed hoặc natural expiry là lý do chặn lookup kết quả đã commit.
- Logical request register gồm phone_normalized, password nguyên nghĩa, verification_token nguyên nghĩa và toàn bộ device fields đã validate; không dùng password hash ngẫu nhiên làm fingerprint.
- Giữ proof identity/digest/binding/consume/invalidation markers ít nhất tới dedupe_expires_at của idempotency record liên quan; proof cleanup không được phá lookup đang còn dedupe. M01 sở hữu implementation, C1 chỉ dùng test fixture.
- Không có live idempotency record: callback khóa proof và kiểm unused, unexpired, not invalidated/revoked, đúng phone/purpose; mới được consume + create user/session.
- Có record: fingerprint khớp, proof không invalidated/revoked, user ACTIVE, session đúng user/proof/result và chưa revoked/expired. Natural proof expiry không cấm replay đã commit; proof invalidation/revocation có cấm.
- replay_guard register chứa proof_id, user_id, session_id; bind guard vào AAD. Identifier plaintext không phải credential.
- Register replay khóa proof rồi user rồi session bằng row lock xung đột với UPDATE/DELETE, đọc state sau lock. New register cũng lấy idempotency lock trước proof lock. Revoke/disable flow phải tuân thứ tự tương thích, không lấy idempotency lock sau business row lock.
- Guard chạy trước decrypt; fresh clock kiểm session/replay expiry ngay trước decrypt. Nếu revoke commit trước guard lock thì deny; nếu replay giữ lock trước thì revoke đợi. Không hứa cấm thu hồi sau replay commit hoặc trước khi network giao token.
- Deny bằng contract Auth an toàn: proof invalidation -> VERIFICATION_PROOF_INVALID; disabled user -> ACCOUNT_DISABLED; revoked session -> SESSION_REVOKED; expired session -> SESSION_EXPIRED (401). Không mint token mới khi replay bị deny.
- A01-06/07 kiểm new execution; A01-09 kiểm replay trong replay window và authorization hiện hành. Hết replay window nhưng còn dedupe -> REPLAY_EXPIRED, không callback; hết dedupe -> new execution vẫn phải vượt proof/business invariant.
- Đây là clarification có ưu tiên so với câu “used/expired proof không được register” ở 4.2/4.3; không đổi opaque token architecture ADR-002.

### 13.3 Crypto format v1 và rotation

- Keyring immutable cho lifetime process; rollout add historical/new key trước, sau đó chuyển active trên tất cả writer, cuối cùng mới remove key cũ khi không còn record phụ thuộc và cleanup hoàn tất. Không cần hot reload.
- key_id là ASCII [A-Za-z0-9_-]{1,64}; mapping ID -> 32-byte master bất biến, không gán lại ID cho material khác. Master encode canonical base64; reject malformed/noncanonical encoding/duplicate key IDs, không log value.
- HKDF-SHA-256: salt=UTF-8("11ship.transactional-core.v1"); info=UTF-8("request-hmac.v1") hoặc UTF-8("replay-aes-gcm.v1"); mỗi output 32 bytes. Không dùng active key để verify record cũ.
- Capture một key version cho cả HMAC/encryption của new record. Historical key phải tồn tại để compare fingerprint tới hết dedupe, không chỉ hết replay.
- Canonical JSON v1: JSON thuần; object own enumerable keys sort theo UTF-16 code unit order, arrays giữ thứ tự; primitives dùng JSON.stringify semantics; reject undefined, nonfinite, sparse arrays, cycles, accessors/custom prototypes/toJSON. Không Unicode-normalize/trim. Với -0, normalize về 0 và adapter không được gán nghĩa khác.
- AAD là UTF-8 canonical JSON array: [1, record_id, scope_type, scope_id, operation_id, idempotency_key, request_fingerprint, crypto_key_id, replay_guard, response_status, replay_expiry_epoch_ms_string].
- replay expiry được persist ở millisecond precision; đọc epoch milliseconds từ DB chính xác, không round khác nhau giữa encrypt/decrypt. Request fingerprint lowercase hex 64 ký tự, compare fixed-length decoded bytes bằng timingSafeEqual.
- IV = randomBytes(12) mới cho mỗi lần encrypt, kể cả lần encrypt sau rollback. Không derive IV từ request/key/UUID và không reuse IV khi re-encrypt. RNG error -> fail closed. Random nonce có xác suất collision không bằng zero; không tuyên bố uniqueness toán học hoặc thêm counter phân tán.
- Explicit authTagLength=16; reject sai IV/tag length, unknown format/version và malformed envelope. setAAD trước update; không parse/use/return plaintext trước final thành công.
- Bind guard/status/replay expiry trong AAD giúp phát hiện thay đổi envelope; không bảo vệ trước DB administrator xóa record hoặc sửa toàn bộ authorization DB. Dedupe không phải anti-tamper ledger.
- Ciphertext, IV/tag, canonical request, key material và token đều không log. Crypto failure không xóa record hoặc chuyển sang new execution; generic safe error.
- Known-answer vectors cho canonical JSON, HKDF/HMAC/AAD và lock derivation phải commit cùng implementation. Không thêm crypto package/KMS.

### 13.4 TTL, cleanup và bounds

- Tuple identity columns NOT NULL, có bounded length; UNIQUE không thay thế non-null constraints. DB CHECK status 200..299, TTL ordering, format version, IV/tag lengths, replay fields all-null/all-present.
- Sau advisory lock và SELECT FOR UPDATE: lấy fresh time; dedupe expired được xóa và mở window mới trước historical-key lookup. Record còn sống mà thiếu key -> 503, tuyệt đối không rerun.
- Replay expired vẫn là tombstone; fingerprint compare bằng historical key, không decrypt. Same request -> REPLAY_EXPIRED; different request -> KEY_REUSED. Guard deny không bao giờ cho decrypt.
- Cleanup batch bounded, row locks SKIP LOCKED, recheck eligibility trong locked transaction; không lấy advisory lock sau row lock. Executor dùng cùng row lock nên cleanup không null/delete row đang replay.
- Ciphertext all-null trong replay window là corrupted record -> fail closed, không execution mới.
- Replay default 900s, dedupe default 604800s. Operation override chỉ từ registry server, 1s <= replay <= dedupe <= 604800s; không nhận TTL từ client.
- Bounded JSON primitive có từ C1A0, dùng chung cho guard/audit/outbox; check depth/node traversal trước stringify, tối đa 8 depth và tối đa 65536 visited nodes, reject invalid JSON types. Size caps §9 giữ nguyên.
- Same key sau dedupe có thể tạo mutation mới: Wallet/Order task bắt buộc nêu business invariant dài hạn cụ thể trước CODE_READY.

### 13.5 Audit failure và privacy

- SUCCESS audit failure rollback toàn bộ mutation, outbox và idempotency record.
- Standalone DENIED/FAILURE chỉ chạy sau rollback/release outer transaction, budget tối đa 500ms; audit/log sink failure không thay response gốc. Không mở standalone audit transaction từ bên trong business callback đang giữ pool client.
- Log error code từ fixed allowlist; regex chỉ kiểm hình dạng, không chứng minh an toàn. Unknown error -> fixed UNKNOWN, không stringify Error/request/config.
- Metadata action-specific allowlist ở module; generic secret-key denylist không bảo đảm PII-safe. Không truncate/sanitize âm thầm metadata SUCCESS rồi coi forensic đầy đủ: reject invalid payload và rollback.
- Trigger chặn UPDATE/DELETE và statement-level TRUNCATE; application role không có DDL/disable-trigger quyền ở deployment. Không hứa chống superuser/table-owner bypass. Production role provisioning nằm runbook triển khai sau; C1 test cả ba operation.
- DENIED/FAILURE là best-effort và có thể mất record khi storage lỗi; không tuyên bố forensic completeness.

### 13.6 Outbox transition, progress và publisher contract

Defaults: max_attempts=5 (1..20), batch_size=10 (1..100), publish_concurrency=10 (1..100), publish_timeout=5s, lease=30s; timeout/lease bound 100ms..300s, lease > publish_timeout + ack budget 2s. Claim tối đa số slot đang trống, không prefetch batch chờ xử lý nối đuôi.

| Source | Condition | Transition |
|---|---|---|
| PENDING | available_at <= fresh DB time; attempts < max | PROCESSING, attempts+1, fresh unique token/locked_at |
| PROCESSING | lease stale; attempts < max | PROCESSING, attempts+1, token mới/locked_at mới |
| PENDING hoặc stale PROCESSING | attempts >= max | DEAD, clear lease, giữ event/payload |
| PROCESSING | publisher success + matching token/status | PUBLISHED, published_at fresh, clear lease |
| PROCESSING | publisher fail/timeout + matching token/status; attempts < max | PENDING, available_at=DB time+backoff, clear lease |
| PROCESSING | publisher fail/timeout + matching token/status; attempts >= max | DEAD, clear lease |
| Bất kỳ | stale/duplicate ack/fail không match | no-op; không overwrite |

- Claim/mark/attempt increment cùng short transaction bằng SKIP LOCKED. Publisher chỉ chạy sau COMMIT được xác nhận; claim commit unknown -> không publish batch đó, để recovery phân xử.
- Ack/fail WHERE event_id AND status=PROCESSING AND lock_token. Lease stale đơn thuần không chứng minh publish chưa xảy ra. Token fencing bảo vệ DB state, không ngăn external duplicate.
- Timeout là unknown publish outcome; AbortSignal/timeout được truyền cho adapter nhưng không giả định cancel luôn ngăn side effect. Bound concurrent unresolved calls; không tiếp tục claim vô hạn nếu publisher bỏ qua cancellation. Engine shutdown ngừng claim, drain có deadline.
- Backoff xác định: min(60s, 1s * 2^(attempt_count-1)); config base/cap có bound 100ms..300s, base<=cap. Không thêm jitter framework trong C1.
- DEAD có thể chưa publish lần nào nếu crash sau claim; giữ nguyên để điều tra/redrive. Không tự xóa DEAD. Production alert/redrive command hoãn; runbook ghi recovery phải có quyền/audit, giữ event_id và có reset attempt policy rõ ràng trước production.
- Consumer cần atomic dedupe(event_id)+business effect, không chỉ check-then-act. Consumer implementation thuộc module sau.
- Không có bảo đảm global ordering; resource_version để consumer nhận diện stale event. Event id/envelope/payload bất biến qua retry.
- Acceptance phải cover crash trước/sau claim commit, trước publish, sau publish/trước ack, ack unknown, fail transition unknown và attempt cuối.

## 14. Audit disposition

v0.3 xử lý B01–B02, H01–H05, M01–M03 ở mức contract; task chứa C17–C30 để chứng minh khi implementation. Đây không phải tuyên bố runtime PASS. Owner duyệt tiếp tục ngày 07/10/2026 sau bản sửa 1cc4f480df146317432fbf154ba7d2ad0692d10d. DESIGN LOCKED, không phải runtime PASS. Chỉ mở C1A0 theo task handoff riêng; không tự merge PR #3.

## 15. Post-merge repair addendum (2026-10-08)

Bổ sung cho §13.1; không viết lại evidence lịch sử. Khi khác §13.1, mục này thắng. Chi tiết và acceptance: [M00-M01-post-merge-repairs](../tasks/M00-M01-post-merge-repairs.md), bằng chứng: [evidence](../evidence/M00-M01-post-merge-repairs.md).

- ROLLBACK và disposition của connection dùng **cùng một** deadline của TransactionManager. Hết budget, còn query đang chạy, trạng thái dirty hoặc lỗi connection thì destroy connection đúng một lần và **không gửi ROLLBACK**. Ngược lại ROLLBACK chạy đua với phần deadline còn lại; hết hạn thì destroy.
- Lỗi gốc của callback được capture/translate **trước** cleanup; cleanup không đổi được nó. Quy tắc COMMIT-unknown giữ nguyên.
- Ngân sách <=500 ms của StandaloneAuditRecorder đã gồm cả cleanup.
- Participant mở session authorization trong transaction (SessionAuthorizationParticipant) theo thứ tự user FOR UPDATE rồi session FOR UPDATE, đọc đồng hồ PostgreSQL sau mọi lock wait; `expiresAt <= now` là hết hạn. Thứ tự lỗi: SESSION_REVOKED, SESSION_EXPIRED, ACCOUNT_DISABLED; session thiếu hoặc không khớp user là SESSION_INVALID.
