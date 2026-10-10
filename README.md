# 11ship
11 food &amp; ship

## Project Progress

👉 [Open live project progress](docs/PROGRESS.md)

🎨 [Brand Guideline v1.0 — 11 / 11Food / 11Ship](docs/current/11-brand-guideline-v1.0.md)

## Tiến độ hiện tại

Đã triển khai và merge: nền backend M00-B1, lõi giao dịch M00-C1 (transaction, idempotency, audit + outbox ghi, outbox dispatcher), Auth Core M01-A1, và onboarding M01-A2 (A2S quán, A2D tài xế). Gói sửa sau merge M00/M01 ([PR #19](docs/tasks/M00-M01-post-merge-repairs.md)) đang ở trạng thái **DRAFT**, chưa merge; xem trạng thái thật ở [docs/PROGRESS.md](docs/PROGRESS.md), không ở file này.

Chưa có (cố ý hoãn): logout và khôi phục tài khoản, ADMIN/SYSTEM/2FA, SMS production, publisher/worker chạy thật cho outbox, và dọn dẹp theo lịch (scheduled cleanup). Chưa có bản app cho Owner test.

Bằng chứng: [M00-B1](docs/evidence/M00-B1.md), [M01-A1](docs/evidence/M01-A1.md), [M01-A2S](docs/evidence/M01-A2S.md), [M01-A2D](docs/evidence/M01-A2D.md).

- [Quyết định nền backend](docs/current/ADR-001-backend-foundation.md)
- [Quyết định session và password](docs/current/ADR-002-auth-security-foundation.md)
- [Task M00-B1 — phạm vi và nghiệm thu](docs/tasks/M00-B1-foundation.md)
- [Prompt giao Claude](docs/tasks/CLAUDE-M00-B1.md)
- [Bằng chứng nghiệm thu M00-B1](docs/evidence/M00-B1.md)
- [Metadata thư viện đã kiểm tra](docs/evidence/M00-B1-dependency-metadata.json)
- [Preflight bước 5.1](docs/current/11Ship-buoc-5.1-repository-preflight.md)

## Staging (Render + Supabase) — cấu hình, chưa triển khai

M00-D1 chỉ chuẩn bị cấu hình: `render.yaml` (một web service Render Free, không tự deploy), kết nối PostgreSQL qua TLS xác minh đầy đủ (`DB_SSL_CA` hoặc `DB_SSL_CA_FILE`; staging/production không khởi động nếu thiếu) và lệnh migration từ xa riêng `npm run db:migrate:remote`. **Chưa deploy, chưa migrate Supabase thật**, và staging chỉ có thể khởi động với cấu hình fixture M00-D2 được bật rõ ràng (OTP bị vô hiệu hóa). Hướng dẫn: [runbook](ops/runbooks/render-supabase-staging.md), bằng chứng: [M00-D1](docs/evidence/M00-D1.md).

## Cách làm việc

Quy trình bắt buộc: [phân công và gate nghiệm thu](docs/process/11ship-delivery-workflow.md), [hướng dẫn agent](AGENTS.md), [mẫu checklist từng module](docs/templates/module-delivery-checklist.md).

Nghiệp vụ + ảnh UI (ChatGPT, Owner duyệt) → code/test (Claude) → review (ChatGPT) → Owner test local và sửa → test điện thoại thật → Owner nghiệm thu, duyệt merge/đóng module. Backend merge/CI xanh chưa phải module hoàn tất.


ChatGPT thiết kế, chia task và review. Claude code từng task. Owner test nghiệp vụ và duyệt. Mỗi gói dùng nhánh riêng, giữ base/head commit và bằng chứng test. Chưa merge khi chưa PASS.


## Chạy backend ở máy phát triển

### Yêu cầu

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 24.21.0 (`.node-version`) | Node 24 LTS |
| npm | 11.9.0 (`packageManager`) | |
| PostgreSQL | 17, chạy bằng Docker | Docker Desktop trên Windows |

Trên Windows: cài Docker Desktop cho PostgreSQL, còn Node và npm chạy trực tiếp trên máy (không chạy app trong container ở bước này). Các lệnh dưới đây dùng được trong PowerShell; chỗ khác nhau giữa PowerShell và bash được ghi rõ.

### Cài đặt lần đầu

```powershell
Copy-Item .env.example .env        # bash: cp .env.example .env
# Mở .env và đổi các mật khẩu placeholder (DEV_DB_PASSWORD, TEST_DB_PASSWORD) và DATABASE_URL cho khớp.
docker compose -f compose.dev.yml up -d db-dev db-test
npm ci
npm run db:migrate
npm run dev
```

Sau đó kiểm tra:

- `http://127.0.0.1:3000/v1/health/live` trả `{"data":{"status":"ok"}}`.
- `http://127.0.0.1:3000/v1/health/ready` trả `{"data":{"status":"ready"}}` khi DB chạy, và 503 khi DB mất.

`package-lock.json` đã có trong repo. Dùng `npm ci` để cài đúng dependency đã khóa; không cần chạy `npm install` chỉ để tạo lockfile nữa.

Hai database tách riêng: `db-dev` (cổng 5432, user/DB `ship11_dev`) và `db-test` (cổng 5433, user/DB `ship11_test`, dữ liệu mất khi dừng container). Cả hai chỉ lắng nghe trên 127.0.0.1.

### Lệnh từ thư mục gốc

| Lệnh | Việc làm |
|---|---|
| `npm ci` | Cài đúng theo lockfile |
| `npm run lint` | ESLint 9, không tự sửa file |
| `npm run typecheck` | `tsc --noEmit` cho mã nguồn và test |
| `npm run build` | Biên dịch backend vào `apps/backend/dist` |
| `npm run db:migrate` | Áp dụng migration SQL (`node-pg-migrate up`); không chạy tự động khi server khởi động |
| `npm run test:unit` | Unit test (config, làm sạch lỗi, log) |
| `npm run test:integration` | Test với PostgreSQL thật; chỉ chạy được khi trỏ đúng DB test |
| `npm run dev` | Build rồi chạy server một lần (không tự reload); đọc `.env` nếu có |

### Chạy integration test

Test integration chỉ chấp nhận `APP_ENV=test` và database `ship11_test` với user `ship11_test`, được kiểm bằng truy vấn tới server trước mọi DDL. Sai đích thì dừng ngay, không có cờ ghi đè.

```powershell
$env:APP_ENV = "test"
$env:DATABASE_URL = "postgres://ship11_test:<TEST_DB_PASSWORD>@127.0.0.1:5433/ship11_test"
npm run test:integration
```

```bash
APP_ENV=test DATABASE_URL="postgres://ship11_test:<TEST_DB_PASSWORD>@127.0.0.1:5433/ship11_test" npm run test:integration
```

Không có DB thì test thất bại, không bị bỏ qua. Test dọn dẹp chỉ trong schema tạm có tên ngẫu nhiên do chính test tạo; không có lệnh reset dữ liệu.

**Chế độ local và chế độ CI.** Chỉ cần database `ship11_test` như trên; không cần tài khoản admin hay `PGPASSWORD`. Ở chế độ này bài test F06 "wrong user trên PostgreSQL thật" được đánh dấu *skipped* (đúng 1 test), còn test logic thuần cho user sai, test database sai trên PostgreSQL thật và mọi test khác vẫn chạy. CI chạy thêm lần thứ hai với `TEST_WRONG_USER_DATABASE_URL` trỏ tới một role phụ `ship11_wrong_user` (đăng nhập được vào `ship11_test` nhưng không phải user được phép); khi đó test này phải PASS và không test nào được skip. Biến này chỉ là fixture âm tính cho test, không nới allowlist và không phải cờ ghi đè.


### Cấu hình

Xem [.env.example](.env.example). Thiếu hoặc sai biến thì tiến trình thoát với mã khác 0 và chỉ in tên biến, không in giá trị. `APP_ENV` và `DATABASE_URL` bắt buộc ở mọi môi trường, không có giá trị dự phòng.

### Nền giao dịch (M00-C1A0)

- Biến mới: `DB_STATEMENT_TIMEOUT_MS` (800), `DB_TRANSACTION_TIMEOUT_MS` (5000), `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` (2000), mỗi biến trong 100..30000. Ràng buộc: query timeout phía client > statement timeout phía server; transaction deadline > statement timeout. `CRYPTO_ACTIVE_KEY_ID` và `CRYPTO_KEYRING` (`id:base64,id:base64`, mỗi khóa 32 byte) là tùy chọn nhưng phải đặt cùng nhau; `.env.example` chỉ có placeholder.
- `TransactionManager` (apps/backend/src/transaction) do coordinator sở hữu. Participant chỉ nhận `TransactionContext` (`query`, `isActive`), không có pool, client thô hay lệnh BEGIN/COMMIT. Không tự retry, không giao dịch lồng nhau, không savepoint.
- COMMIT không nhận được phản hồi trả `503 TRANSACTION_OUTCOME_UNKNOWN`; callback không bao giờ chạy lần hai.
- Primitive dùng chung: JSON canonical v1 + validator có giới hạn, keyring/HKDF/HMAC/AES-GCM, khóa advisory hai int32. Chưa có bảng idempotency, audit hay outbox (thuộc A1/B/C).
- Test: `npm run test:unit` không cần DB; `npm run test:integration` cần PostgreSQL test đúng guard hiện có (xem trên).

### Idempotency (M00-C1A1)

- Bảng `app.idempotency_records` (migration `1791331200000_create-idempotency-records`) lưu khóa chính xác `(scope_type, scope_id, operation_id, idempotency_key)`, fingerprint HMAC, id khóa mã hóa, guard không bí mật và replay đã mã hóa AES-256-GCM (ciphertext/IV/tag). Không có plaintext secret. Chưa có audit, outbox, Auth.
- `IdempotencyExecutor` (apps/backend/src/idempotency) điều phối toàn bộ giao dịch qua `TransactionManager`: advisory lock hai int32 → khôi phục `lock_timeout` → `SELECT ... FOR UPDATE` đúng hàng → giờ mới `clock_timestamp()`. Replay dùng khóa lịch sử của chính record; thiếu khóa → `503 IDEMPOTENCY_KEY_UNAVAILABLE`, không chạy lại. Replay nhạy cảm gọi hook xác thực cùng `TransactionContext` trước khi giải mã. Chỉ kết quả 2xx được lưu; callback chạy đúng một lần cho record mới.
- `IdempotencyCleanup` là primitive gọi tay (chưa có scheduler): pha 1 xóa ciphertext nhưng giữ tombstone, pha 2 xóa record quá dedupe TTL; `FOR UPDATE SKIP LOCKED`, có giới hạn lô, kiểm tra lại điều kiện.
- Biến mới: `IDEMPOTENCY_ADVISORY_WAIT_MS` (250, 1..5000, nhỏ hơn `DB_STATEMENT_TIMEOUT_MS`), `IDEMPOTENCY_BUSINESS_LOCK_TIMEOUT_MS` (500, 1..30000, nhỏ hơn `DB_STATEMENT_TIMEOUT_MS`), `IDEMPOTENCY_REPLAY_TTL_SECONDS` (900) và `IDEMPOTENCY_DEDUPE_TTL_SECONDS` (604800) với `1 <= replay <= dedupe <= 604800`. Module idempotency yêu cầu `CRYPTO_KEYRING` + `CRYPTO_ACTIVE_KEY_ID`; thiếu thì tiến trình thoát khác 0 và chỉ in tên hai biến. Module chưa được `AppModule` import (chưa có consumer); M01 sẽ import `IdempotencyModule`.
- Test integration cần migration mới nhất; bộ test migration (C23) reset schema `app` của chính database `ship11_test` (sau khi guard xác nhận) rồi luôn migrate lại về bản mới nhất.

### Audit và Outbox ghi (M00-C1B)

- Bảng `app.audit_logs` (migration `1791417600000_create-audit-outbox`) chỉ-thêm: trigger mức câu lệnh chặn UPDATE, DELETE và TRUNCATE (SQLSTATE `23001`) kể cả khi không khớp hàng nào. Bảng `app.outbox_events` có đủ cột trạng thái giao nhận (status, attempt_count, available_at, lease, published_at, last_error_code) nhưng C1B chỉ ghi trạng thái đầu `PENDING` / 0 / `available_at = occurred_at`. Không có dispatcher, claim, ack, retry hay publisher (thuộc M00-C1C).
- `AuditWriter.append(context, entry)` và `OutboxWriter.append(context, event)` (apps/backend/src/audit, apps/backend/src/outbox) chỉ chạy trong giao dịch của coordinator: không pool, không BEGIN/COMMIT, lỗi luôn được ném để giao dịch rollback cùng nghiệp vụ. Dữ liệu được kiểm tra trọn vẹn trước khi chạm DB (metadata audit tối đa 8 KiB, payload outbox tối đa 64 KiB, cùng validator JSON an toàn của A0, cấm khóa bí mật); không bao giờ cắt hay sửa. `occurred_at` lấy từ đồng hồ PostgreSQL; `OutboxWriter` trả `EventId` và dùng một mẫu đồng hồ cho cả `occurred_at` lẫn `available_at`.
- `StandaloneAuditRecorder.recordBestEffort(entry)` chỉ ghi `DENIED`/`FAILURE`, trong giao dịch riêng sau khi giao dịch nghiệp vụ đã rollback và trả kết nối. Tổng ngân sách cố định 500 ms cho acquire + BEGIN + INSERT + COMMIT; client đến muộn được trả ngay và không bao giờ ghi muộn; mọi lỗi bị nuốt sau một dòng log cố định (`audit_standalone_failed` + mã). Không gọi từ bên trong callback nghiệp vụ.
- `AuditModule` và `OutboxModule` chưa được `AppModule` import (chưa có consumer) và không import `TransactionModule`. Không có biến cấu hình mới.
- Test: C11, C12, C27, C28 và phần mở rộng C23 trong `tests/integration` (cần PostgreSQL test); unit test không cần DB. Bằng chứng: [docs/evidence/M00-C1B.md](docs/evidence/M00-C1B.md).

### Outbox dispatcher (M00-C1C)

- `OutboxDispatcher` + `OutboxDispatchStore` (`apps/backend/src/outbox`) giao sự kiện outbox theo at-least-once: claim ngắn (`FOR UPDATE SKIP LOCKED`, giờ DB) → publish ngoài transaction → ack/fail có fencing theo `lock_token`. Retry backoff mũ không jitter, hết `OUTBOX_MAX_ATTEMPTS` thì `DEAD`. Cùng `event_id` qua mọi lần giao; consumer phải dedupe.
- Không tự khởi động (không worker/poll loop, không broker thật). `drain(deadlineMs)` là primitive tắt có giới hạn. Publisher thật chưa có; chỉ có fake trong test.
- Biến cấu hình (xem `.env.example`): `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_BATCH_SIZE`, `OUTBOX_PUBLISH_CONCURRENCY`, `OUTBOX_PUBLISH_TIMEOUT_MS`, `OUTBOX_LEASE_MS` (phải > timeout + 2000), `OUTBOX_BACKOFF_BASE_MS` (<= cap), `OUTBOX_BACKOFF_CAP_MS`. Cấu hình sai chỉ log tên biến, không log giá trị.
- Test: C13, C14, C15, C16, C24. Bằng chứng: [docs/evidence/M00-C1C.md](docs/evidence/M00-C1C.md).

### Auth Core (M01-A1)

- Migration `1791504000000_create-auth-core`: `app.users`, `app.user_roles`, `app.phone_verifications`, `app.verification_proofs`, `app.sessions`. Mật khẩu là chuỗi PHC Argon2id (memory 19456 KiB, timeCost 2, parallelism 1); OTP lưu dưới dạng HMAC-SHA-256; proof và access token chỉ lưu SHA-256 digest. Index duy nhất một phần `sessions_active_shop_per_user_uq` là chốt cuối cho quy tắc một session SHOP đang hoạt động.
- Endpoint (`/v1/auth`): `POST phone-verifications`, `POST phone-verifications/:id/verify`, `POST register` (không role, dùng `IdempotencyExecutor`), `POST login`, `POST role/select` và `GET me` (bearer session mờ, TTL tuyệt đối, không refresh).
- Biến cấu hình: `AUTH_OTP_HMAC_SECRET` (bắt buộc, base64 của đúng 32 byte), `AUTH_OTP_TTL_SECONDS`, `AUTH_OTP_RESEND_SECONDS`, `AUTH_OTP_MAX_ATTEMPTS`, `AUTH_PROOF_TTL_SECONDS`, `AUTH_SESSION_TTL_SECONDS` (xem `.env.example`). Server cũng cần `CRYPTO_KEYRING` + `CRYPTO_ACTIVE_KEY_ID` vì register dùng idempotency. Cấu hình sai chỉ in tên biến.
- OTP provider giả (in-memory) chỉ dành cho `APP_ENV=development|test`; `staging` chỉ khởi động khi bật chế độ fixture của M00-D2 (xem mục dưới), `production` luôn từ chối (chỉ in `OTP_PROVIDER`) cho đến khi có adapter SMS thật. Chưa có onboarding SHOP/DRIVER, ví, đơn, SMS production.
- M00-D2 (tài khoản staging không SMS): cột `app.users.account_origin` (`PHONE_VERIFIED` | `STAGING_FIXTURE`; fixture có `phone_verified_at=NULL`, CHECK chặn tổ hợp sai). Chế độ fixture chỉ bật được với `APP_ENV=staging` (`AUTH_STAGING_FIXTURES_ENABLED=true` + allowlist bí mật `AUTH_STAGING_ALLOWED_PHONES`); khi bật, OTP request/verify và register trả `503 AUTH_REGISTRATION_UNAVAILABLE` và OTP provider là `DisabledOtpProvider`. Tài khoản fixture do lệnh vận hành `npm run staging:seed-fixtures` tạo (stdin, TLS nghiêm ngặt, xác nhận target như D1). Login và `/auth/me` trả `phone_verification_status` (`VERIFIED` | `UNVERIFIED_TEST`). Production, chế độ đã tắt hoặc SĐT bị bỏ khỏi allowlist đều từ chối fixture, kể cả bearer/session cũ. Chi tiết: [runbook](ops/runbooks/render-supabase-staging.md) mục 8 và [evidence M00-D2](docs/evidence/M00-D2.md).
- Test: unit trong `apps/backend/src/auth`, integration `tests/integration/auth-*.int.spec.ts`. Bằng chứng: [docs/evidence/M01-A1.md](docs/evidence/M01-A1.md).

### Phạm vi hiện tại

Backend gồm nền M00 (health, cấu hình, pool, migration, error contract, transaction, idempotency, audit/outbox), Auth Core (M01-A1) và onboarding Shop/Driver (M01-A2). Chưa có Wallet, Delivery, frontend, SMS hay triển khai production, và các mục hoãn nêu ở phần Tiến độ hiện tại. Hướng dẫn sao lưu/khôi phục ở [ops/runbooks](ops/runbooks/database-backup-restore-guidance.md) chỉ là hướng dẫn cho tương lai, chưa được kiểm thử.
