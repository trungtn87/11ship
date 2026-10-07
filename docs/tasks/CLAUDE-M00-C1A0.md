# CLAUDE — M00-C1A0: Transaction lifecycle và shared primitives

Ngày: 07/10/2026. Trạng thái: CODE_READY — Owner đã duyệt ADR-003 v0.3.
Chỉ task A0 này được mở. Không có implementation evidence tại thời điểm handoff.

## 1. Source/base và branch

Repo: trungtn87/11ship.
Code base khóa: main tại 91316a5fe155f7af5ad96491121f5bbee60703c6.
Design content được duyệt: 1cc4f480df146317432fbf154ba7d2ad0692d10d.
Lock/handoff commit: commit chứa file này trên docs/m00-c1-transactional-core; người giao task phải cung cấp SHA chính xác.

PR #3 vẫn chưa merge theo chỉ dẫn Owner. Không merge hoặc sửa branch thiết kế.
Fetch design commit để đọc spec; tạo feat/m00-c1a0-primitives từ code base khóa, không cherry-pick toàn bộ PR thiết kế vào code branch. Ghi design SHA trong PR/evidence. PR code target main; chưa merge code trước khi tài liệu đã được tích hợp hoặc có chỉ dẫn Owner riêng.
Nếu main/branch đã thay đổi, báo SHA thực và đánh giá drift; không reset/force-push hoặc tự chọn base mới.

Đọc trực tiếp tại design SHA:
- docs/current/ADR-001-backend-foundation.md
- docs/current/ADR-002-auth-security-foundation.md
- docs/current/ADR-003-transactional-core.md (đặc biệt §13)
- docs/tasks/M00-C1-transactional-core.md
- task này.
Đọc code foundation tại code base và AGENTS.md nếu có. Spec lock không phải code PASS.

## 2. Scope A0

Triển khai:
1. Explicit TransactionContext/TransactionManager trên pg Pool hiện có: single-client, lifecycle ACTIVE/CLOSED, commit/rollback, dirty-client disposal, bounded deadline và no auto-retry.
2. Config cho transaction/query/server statement/idle timeout với startup validation; không dùng một giá trị bằng nhau cho client query timeout và server statement timeout trái ADR.
3. Typed application error registry + HTTP mapping bảo toàn mã lỗi ADR; unknown exceptions dùng fixed safe fallback. Không leak raw errors.
4. Shared bounded JSON validator/canonical JSON v1; safe metadata mode và encrypted replay mode có policy tách rõ. Không dùng secret denylist để từ chối password/proof trong logical request cần HMAC.
5. Crypto primitives: immutable keyring, HKDF/HMAC, AES-GCM envelope/AAD, random IV, historical-key lookup; chưa gắn DB replay.
6. Deterministic lock tuple hashing/two-int32 derivation và known-answer vectors; chưa viết executor/advisory lock orchestration.
7. Unit/integration tests, test-only Nest HTTP harness, config examples và evidence.

Không code:
- idempotency_records/executor/TTL cleanup (A1);
- audit_logs/outbox_events/writers/dispatcher (B/C);
- Auth/proof/session business tables, Wallet/Driver/Delivery/Order;
- public business endpoints, background worker, Redis/broker/KMS;
- automatic retry, savepoint/nested transaction framework.
A0 không có production migration mới. Migration test harness có thể sửa trong scope chuẩn bị C23, không xóa/nới safety guard.

## 3. Implementation boundaries

- Transaction module không import idempotency/audit/outbox/business modules.
- Coordinator sở hữu manager; participant chỉ nhận context, không pool/manager. Context không expose raw client hoặc transaction-control methods.
- Không coi Promise.race là cancellation của callback. Sau deadline context phải reject query, connection được cleanup/destroy an toàn, late callback không thể COMMIT/mutate trên client đã release.
- Repositories không chạy detached async queries. Không external effects trong callback.
- COMMIT network failure không được kết luận rollback. Unknown outcome -> 503 TRANSACTION_OUTCOME_UNKNOWN, không callback lần hai. Known server rejection giữ lỗi kỹ thuật an toàn.
- Client/server query timeout, transaction deadline và idle timeout phải theo ADR §13.1. Giá trị config mới giữ validation central và không in secret.
- Fixed safe code registry thay regex-only sanitization cho unknown provider errors. HTTP request_id thuộc request hiện tại.
- Canonical writer phải thực sự emit sorted keys, kể cả numeric-looking keys (JSON.stringify(object) tự reorder integer keys); khóa bằng literal vectors.
- Bounded validator kiểm depth/size/node cap, cycles và non-JSON types; không gọi getters/toJSON của input.
- Crypto output chỉ trả sau GCM final success; invalid key/version/tag/IV/RNG fail closed. Không logging canonical request, ciphertext hoặc keys.
- Không thêm config bắt buộc cho outbox worker ở A0. Keyring test do fixture cung cấp, .env.example chỉ placeholder; mọi test process cần key phải inject fixture rõ ràng.
- Các field/error names bổ sung trong phạm vi implementation phải có fixed contract và tests; không đổi ADR hoặc Auth semantics.

## 4. File scope

Cho phép apps/backend/src/transaction/**; shared JSON/crypto primitives theo convention repo; config/**; database/**; http/**; common/safe-error.ts và tests liên quan.
Cho phép test harness/integration support, README/.env.example, CI fixture/config wiring tối thiểu, docs/evidence/M00-C1A0.md.
Không đổi stack/dependency major; ưu tiên node:crypto built-in.
Không sửa tài liệu baseline ADR/Auth trên code branch hoặc migration đã apply.

## 5. Acceptance A0

- C01: cùng PoolClient (có thể chứng minh backend PID), commit/rollback toàn bộ, release, participant boundary.
- C21-A0: total/idle deadline, CLOSED context, BEGIN/ROLLBACK/connection failure, unknown COMMIT, no retry, pool phục hồi, late callback không mutate.
- C22-A0: typed registry qua HTTP harness thực, sáu code idempotency + transaction unknown; arbitrary exception code/message/details không được phản chiếu. Chưa cần executor để throw test errors.
- C25-A0: canonical/HKDF/HMAC/AAD/lock fixed vectors; malformed envelopes/keys; RNG failure; old-key decrypt sau đổi active in separate instances. DB-record rotation thuộc A1.
- C26-A0: UTF-8 byte cap/depth/node cap/cycles/nonfinite/undefined/accessors/custom prototypes, normalized nested secret keys; replay mode cho secret hợp lệ nhưng không log.
- C16-A0/C23-A0: config invalid exit nonzero không leak, migration B1 no-op/regression và test target guard nguyên vẹn. C23 upgrade có bảng C1 chỉ hoàn thành A1, không báo PASS sớm.
- Baseline F01–F09/unit/integration tiếp tục PASS.

Transaction tests dùng PostgreSQL thật. Chỉ fault injection driver/network boundary cho case lỗi khó tái tạo; report rõ phần injected, không thay toàn bộ DB bằng mock.
COMMIT unknown phải cover server đã commit nhưng acknowledgement bị mất; query DB bằng connection khác để chứng minh state. Replay sau đó được kiểm ở A1.
Không dùng long sleep làm barrier concurrency; không forceExit/passWithNoTests để che leak.
Không gọi C01–C30 PASS toàn milestone khi mới xong A0.

## 6. Commands và evidence

Dùng Node/npm đã pin trong repo, npm ci, npm run lint, npm run typecheck, npm run build, npm run db:migrate, npm run test:unit, npm run test:integration.
DB command chỉ chạy sau xác minh disposable test target theo guard hiện có; không in DSN/key.
CI tiếp tục local-mode và CI-mode; bổ sung config test fixtures tối thiểu để child process tests không fail vì thiếu key giả.
Không thay đổi lockfile nếu không cần dependency; nếu có phải giải thích.

Bàn giao:
- actual base/head/design SHA;
- changed-file manifest và lý do;
- API/ownership summary;
- acceptance ID -> test file/assertion mapping, phân biệt A0 với deferred A1;
- commands và kết quả thực chạy, CI URL;
- evidence secrets không DB/log và pool cleanup;
- rủi ro/blockers còn lại.
Mở draft PR code nếu GitHub access cho phép; không merge PR code hoặc PR #3. Không tuyên bố đang chạy/test PASS nếu chưa thực chạy.

## 7. Stop conditions

BLOCKED_BY_FOUNDATION nếu cần thay stack/ADR/session architecture, nới plaintext secrets, tự mở rộng business hoặc scope khác.
Thiếu network/tool/test DB: ghi rõ phần bị chặn; không bịa evidence hoặc đổi baseline để né.
Sau A0 review/merge và main CI xanh mới giao A1. Auth chờ toàn bộ C1.
