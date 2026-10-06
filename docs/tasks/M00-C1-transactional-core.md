# M00-C1 — Transactional Core

Phiên bản 0.2, ngày 07/10/2026.
Trạng thái: DESIGN REVIEWED — READY FOR OWNER LOCK; chưa giao Claude code.

## 1. Base và nguồn

Repo: `trungtn87/11ship`.
Base bắt buộc: `main` sau M00-B1, merge SHA `91316a5fe155f7af5ad96491121f5bbee60703c6`.

Đọc:
1. `docs/current/ADR-001-backend-foundation.md`
2. `docs/current/ADR-002-auth-security-foundation.md`
3. `docs/current/ADR-003-transactional-core.md`
4. `docs/current/11Ship-buoc-4.1-nen-trien-khai-M00-A-v1.0.md`
5. task này.

M00-C1 không được sửa business contract để làm implementation dễ hơn.

## 2. Mục tiêu code

M00-C1 là **một milestone nhưng không giao Claude trong một prompt lớn**. Triển khai theo 3 slice tuần tự, mỗi slice có branch/PR/CI riêng và chỉ bắt đầu slice sau khi slice trước đã review/merge:
- `M00-C1A`: TransactionContext + idempotency + crypto/TTL/cleanup — C01..C10.
- `M00-C1B`: safe JSON + audit + transactional outbox writer — C11..C12.
- `M00-C1C`: outbox dispatcher/lease/retry/recovery + final integration — C13..C16.

Auth vẫn chờ **toàn bộ M00-C1** hoàn tất.

Tạo reusable M00 infrastructure:
1. explicit TransactionContext/TransactionManager;
2. idempotency executor có concurrency serialization + HMAC request fingerprint;
3. AES-256-GCM encrypted replay payload + key rotation/TTL/cleanup;
4. append-only audit writer;
5. transactional outbox writer + claim/retry/lease dispatcher;
6. migration + config + unit/integration tests + evidence.

Không có public business endpoint.

## 3. File scope dự kiến

Được tạo/sửa:
- `apps/backend/src/transaction/**`
- `apps/backend/src/idempotency/**`
- `apps/backend/src/audit/**`
- `apps/backend/src/outbox/**`
- config module hiện có để thêm M00-C1 config
- `database/migrations/**`
- `tests/integration/**`
- `scripts/**` nếu cần test/cleanup utility
- `.env.example`, README cho config/runbook
- `.github/workflows/ci.yml` chỉ khi cần tạo fixture/test mới
- `docs/evidence/M00-C1.md`.

Không sửa ADR/source baseline trong code branch.

## 4. Schema bắt buộc

Toàn milestone M00-C1 tạo đúng 3 bảng chuẩn (có thể chia thành migration theo slice, không bắt buộc một migration duy nhất):
- `app.idempotency_records`
- `app.audit_logs`
- `app.outbox_events`.

Không tạo users/sessions/wallet/orders/deliveries.

DDL phải có PK, UNIQUE/CHECK/index cần thiết theo ADR-003, timestamp `timestamptz`, không dùng ORM auto-sync.

`audit_logs` có append-only protection cho application path.
`outbox_events` có index claim pending/reclaim lease.
`idempotency_records` có unique exact tuple scope/operation/key và TTL checks.

## 5. Transaction API contract

Tối thiểu:
- một outer helper acquire/release `PoolClient`;
- callback nhận `TransactionContext`;
- repository có thể query qua transaction context mà không mở connection khác;
- rollback/release luôn chạy đúng;
- không silent nested independent transaction; C1 không hỗ trợ nested `withTransaction`/savepoint như một feature;
- external publisher không chạy khi transaction business còn mở;
- C1 không tự retry callback khi gặp `40001`/`40P01`; chỉ surface lỗi đã sanitize.

Không dùng `pool.query` rời rạc cho các statement phải atomic.

## 6. Idempotency executor contract

Input tối thiểu:
- server-derived scope type/id;
- operation_id;
- Idempotency-Key UUID canonical;
- normalized logical request;
- replay TTL + dedupe TTL trong bound;
- business callback nhận TransactionContext;
- replay authorization hook cho sensitive result.

New request:
- transaction advisory lock;
- không có existing record -> execute callback đúng một lần;
- callback trả status + replay_guard + logical replay payload;
- encrypt payload, insert completed idempotency row cùng transaction;
- commit.

Existing same fingerprint:
- fingerprint incoming bằng key version của existing record, không bằng active key hiện tại;
- không chạy callback;
- sensitive authorization hook chạy trong cùng TransactionContext trước decrypt;
- còn replay TTL -> decrypt + trả same logical result;
- hết replay TTL nhưng tombstone còn -> `IDEMPOTENCY_REPLAY_EXPIRED`.

Existing different fingerprint:
- `IDEMPOTENCY_KEY_REUSED`.

Rollback/failure:
- không để completed idempotency record;
- mặc định chỉ 2xx committed success được persist để replay;
- validation/authorization/business failure không consume key;
- retry sau rollback có thể trở thành owner mới.

Không lưu plaintext request/secret.

## 7. Crypto/config contract

Dùng built-in `node:crypto`.
- AES-256-GCM, 12-byte random IV, 16-byte tag và explicit `authTagLength=16` khi encrypt/decrypt.
- HMAC-SHA-256 request fingerprint.
- subkeys derive từ versioned 32-byte master bằng HKDF-SHA-256/domain separation.
- AAD bind immutable record identity bằng encoding không mơ hồ và có `replay_format_version=1`.
- active key id phải tồn tại trong keyring.
- key material sai length/encoding -> startup/config fail, chỉ nêu tên config, không in value.
- old key vẫn fingerprint/decrypt/verify old record sau active-key rotation.
- missing required historical key -> 503 safe error, không rerun mutation.

Tên config cụ thể có thể chốt khi code nhưng phải có:
- active key id;
- versioned keyring secret;
- default replay TTL;
- default dedupe TTL;
- bounded idempotency wait timeout;
- outbox lease/batch/retry bounds.

`.env.example` chỉ placeholder, không commit real key.

## 8. Safe JSON contract

Audit metadata, replay_guard và outbox payload:
- có size/depth bound;
- reject known secret-key names: password, token/access_token, authorization, cookie, otp, verification_token/proof, database_url và tương đương normalization;
- không tự stringify Error/raw request;
- replay encrypted payload là ngoại lệ duy nhất được phép chứa secret cần replay, nhưng ciphertext mới được persist/loggable; plaintext chỉ tồn tại trong memory của request.
- hard cap: replay plaintext/outbox payload 64 KiB, audit metadata 8 KiB, replay_guard 4 KiB, JSON depth 8.

## 9. Outbox dispatcher contract

Writer:
- insert cùng business transaction.

Claim:
- batch bằng PostgreSQL row locking + SKIP LOCKED;
- hai dispatcher concurrent không claim cùng active lease;
- mark PROCESSING + unique lock_token.

Publish:
- publisher interface được gọi sau commit của claim transaction;
- success conditional ack -> PUBLISHED;
- failure sanitize error -> retry PENDING với bounded backoff;
- quá max -> DEAD;
- stale lease reclaim.

At-least-once:
- test phải chứng minh duplicate delivery có thể xảy ra nếu publish success nhưng ack không hoàn tất;
- duplicate giữ nguyên event_id;
- không thêm exactly-once claim.

## 10. Audit contract

- success audit của mutation nằm cùng transaction;
- rollback -> success audit không tồn tại;
- standalone security DENIED/FAILURE được ghi bằng helper short transaction;
- update/delete audit row bị từ chối;
- secret marker không xuất hiện trong DB hoặc logs.

## 11. Acceptance tests

### C01 — Transaction context
- commit trên cùng client -> data tồn tại;
- forced error -> rollback toàn bộ;
- client release sạch;
- inner repository nhận đúng context; không mở transaction độc lập.

### C02 — Sequential idempotency
Same scope/operation/key + same logical body chạy callback một lần và lần 2 replay cùng logical result.

### C03 — Concurrent idempotency
Hai request concurrent cùng key/body -> chỉ một callback/business insert; request còn lại replay, không duplicate. Advisory-lock derivation phải dùng deterministic two-int32 representation; không dùng JS Number cho arbitrary 64-bit bigint.

### C04 — Key reuse conflict
Same scope/operation/key + body khác -> 409 `IDEMPOTENCY_KEY_REUSED`; không mutation lần 2.

### C05 — Rollback/retry
Owner request rollback trước commit -> không idempotency record completed; retry sau đó chạy thành công đúng một lần.

### C06 — Scope/operation isolation
Cùng key nhưng khác scope hoặc operation không đụng nhau.

### C07 — Fingerprint privacy/rotation
Password/proof marker có trong logical request nhưng không xuất hiện plaintext trong DB/log; same normalized request có same fingerprint dưới same key version, changed request khác fingerprint; string canonicalization không trim/Unicode-normalize. Record v1 vẫn nhận ra same request sau active key chuyển v2 bằng cách dùng record key v1.

### C08 — Encrypted replay
- DB không chứa plaintext secret marker;
- replay plaintext >64 KiB bị reject trước persist;
- decrypt đúng trả original logical payload;
- tamper ciphertext/tag/AAD -> fail closed;
- replay authorization hook bị deny -> không trả/decrypt payload cho caller;
- missing historical key -> 503, không callback business.

### C09 — Rotation
Record tạo bằng key v1 replay được sau khi active chuyển v2 nếu v1 còn keyring; new record dùng v2.

### C10 — Replay TTL/tombstone
- hết replay TTL nhưng chưa dedupe TTL -> 409 REPLAY_EXPIRED, không re-execute;
- cleanup pha 1 xóa ciphertext nhưng giữ tombstone;
- cleanup dùng row locking/SKIP LOCKED để không race replay;
- record quá dedupe TTL dù cleanup chưa chạy phải được executor xóa trong locked transaction và xử lý như idempotency window mới;
- quá dedupe TTL cleanup xóa record.

### C11 — Audit atomicity/privacy
- business commit + audit cùng tồn tại;
- business rollback -> success audit không có;
- standalone DENIED audit tồn tại;
- UPDATE/DELETE/TRUNCATE audit bị chặn;
- secret metadata bị reject/sanitized theo contract;
- audit SUCCESS insert fail -> business rollback;
- standalone DENIED audit fail không đổi denial response gốc.

### C12 — Outbox atomicity
Business mutation + outbox commit cùng tồn tại; rollback -> cả hai không tồn tại.

### C13 — Outbox concurrency/lease
Hai dispatcher concurrent claim disjoint; stale lease được reclaim; active lease không bị worker khác lấy; old worker ack bằng stale lock_token không được overwrite state mới. Lease/available time dùng DB time.

### C14 — Outbox retry
Publish fail -> attempt tăng + retry/backoff; quá max -> DEAD; raw error/secret không persist.

### C15 — At-least-once proof
Mô phỏng publish thành công nhưng ack thất bại/lease hết -> event được publish lại cùng event_id; tài liệu/test không gọi đây là exactly-once.

### C16 — Migration/config/CI
- migration up trên DB sạch và up lần hai không duplicate;
- config keyring/TTL invalid fail nonzero, không leak secret;
- npm ci/lockfile/lint/typecheck/build/unit/integration đều PASS trong CI thật;
- test process thoát sạch.

## 12. Register replay integration invariant

M01-A1 phải resolve verification token -> proof identity mà chưa consume và chưa reject chỉ vì proof đã `used`. Retry sau register success dùng proof identity để tìm idempotency record trước; chỉ new-owner callback mới lock/enforce `proof unused` rồi consume. Đây là điều kiện để A01-09 thật sự replay được access_token đã mã hóa.

## 13. Definition of Done

M00-C1 chỉ PASS khi:
- C01–C16 có evidence thật;
- no plaintext secret trong idempotency/audit/outbox/log;
- same-key concurrency callback đúng một lần;
- replay secret có encryption + request binding + current authorization hook + TTL;
- key rotation test pass;
- audit/outbox atomic với business transaction;
- outbox dispatcher at-least-once và lease recovery pass;
- không có business schema ngoài scope;
- CI trên commit bàn giao xanh;
- ChatGPT review diff không phát hiện contract drift.

## 14. Điều kiện dừng

Claude phải STOP và báo `BLOCKED_BY_FOUNDATION` nếu implementation đòi:
- đổi query stack/PostgreSQL major/framework;
- thêm Redis/broker/KMS provider thật;
- đổi token/session architecture ADR-002;
- nới lưu plaintext token để làm replay;
- bỏ current authorization check trước sensitive replay;
- thay business contract module khác;
- dùng exactly-once claim không có thiết kế mới.


## 15. Slice handoff policy

### M00-C1A — Transaction + Idempotency
Chỉ giao transaction/idempotency/crypto/config và migration `idempotency_records`. PASS C01–C10 + CI trước khi merge. Không code audit/outbox dispatcher trong prompt A.

### M00-C1B — Audit + Outbox Write
Base là `main` sau C1A. Tạo `audit_logs`, `outbox_events`, safe-json validator, audit writer và outbox writer. PASS C11–C12 + regression C01–C10. Không code publisher worker ngoài minimal interface.

### M00-C1C — Dispatcher + Final
Base là `main` sau C1B. Code claim/lease/retry/dead/reclaim dispatcher + fake publisher + C13–C16. Chạy regression toàn C01–C16. Chỉ khi C1C merge và main CI xanh mới ghi `M00-C1 — TRANSACTIONAL CORE READY` và mở M01-A1.
