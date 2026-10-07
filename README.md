# 11ship
11 food &amp; ship

## Tiến độ hiện tại

Nền backend M00-B1 (NestJS bootstrap, cấu hình, pool PostgreSQL, migration, health endpoints, error/log contract, test và CI) đã **nghiệm thu PASS F01–F09** trên Node 24.21.0, npm 11.9.0 và PostgreSQL 17.11. CI xác nhận 54 unit test + 28 integration test đều PASS; `package-lock.json` thật đã được commit và `npm ci` không làm thay đổi lockfile. Xem [docs/evidence/M00-B1.md](docs/evidence/M00-B1.md). Chưa có migration nghiệp vụ và chưa có bản app cho Owner test.

- [Quyết định nền backend](docs/current/ADR-001-backend-foundation.md)
- [Quyết định session và password](docs/current/ADR-002-auth-security-foundation.md)
- [Task M00-B1 — phạm vi và nghiệm thu](docs/tasks/M00-B1-foundation.md)
- [Prompt giao Claude](docs/tasks/CLAUDE-M00-B1.md)
- [Bằng chứng nghiệm thu M00-B1](docs/evidence/M00-B1.md)
- [Metadata thư viện đã kiểm tra](docs/evidence/M00-B1-dependency-metadata.json)
- [Preflight bước 5.1](docs/current/11Ship-buoc-5.1-repository-preflight.md)

## Cách làm việc

ChatGPT thiết kế, chia task và review. Claude code từng task. Owner test nghiệp vụ và duyệt. Mỗi gói dùng nhánh riêng, giữ base/head commit và bằng chứng test. Chưa merge khi chưa PASS.

Trạng thái: M00-B1 và M00-C1A0 đã merge vào `main`. M00-C1A1 (idempotency executor/replay/TTL/cleanup) đang triển khai trên draft PR #5. Audit/outbox/dispatcher thuộc C1B/C; M01-A1 chỉ mở sau khi toàn bộ M00-C1 hoàn tất.

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
# Mở .env và thay DATABASE_URL/mật khẩu placeholder, đồng thời tạo CRYPTO_KEYRING 32-byte thật cho môi trường local.
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
$env:CRYPTO_ACTIVE_KEY_ID = "k1"
$env:CRYPTO_KEYRING = "k1:<base64-of-32-test-bytes>"
npm run test:integration
```

```bash
APP_ENV=test DATABASE_URL="postgres://ship11_test:<TEST_DB_PASSWORD>@127.0.0.1:5433/ship11_test" CRYPTO_ACTIVE_KEY_ID="k1" CRYPTO_KEYRING="k1:<base64-of-32-test-bytes>" npm run test:integration
```

Không có DB thì test thất bại, không bị bỏ qua. Migration integration chỉ được phép reset schema `app` sau khi target guard đã xác minh chính xác DB/user test dùng một lần; migration-history schema vẫn dùng tên ngẫu nhiên. Không có cờ bỏ qua target guard.

**Chế độ local và chế độ CI.** Chỉ cần database `ship11_test` như trên; không cần tài khoản admin hay `PGPASSWORD`. Ở chế độ này bài test F06 "wrong user trên PostgreSQL thật" được đánh dấu *skipped* (đúng 1 test), còn test logic thuần cho user sai, test database sai trên PostgreSQL thật và mọi test khác vẫn chạy. CI chạy thêm lần thứ hai với `TEST_WRONG_USER_DATABASE_URL` trỏ tới một role phụ `ship11_wrong_user` (đăng nhập được vào `ship11_test` nhưng không phải user được phép); khi đó test này phải PASS và không test nào được skip. Biến này chỉ là fixture âm tính cho test, không nới allowlist và không phải cờ ghi đè.


### Cấu hình

Xem [.env.example](.env.example). Thiếu hoặc sai biến thì tiến trình thoát với mã khác 0 và chỉ in tên biến, không in giá trị. `APP_ENV`, `DATABASE_URL`, `CRYPTO_ACTIVE_KEY_ID` và `CRYPTO_KEYRING` bắt buộc từ M00-C1A1. Không có fallback cho khóa crypto; giá trị thật phải được inject bằng secret/config ngoài repo.

### Nền giao dịch (M00-C1A0)

- A0: `DB_STATEMENT_TIMEOUT_MS` (800), `DB_TRANSACTION_TIMEOUT_MS` (5000), `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` (2000), mỗi biến trong 100..30000. Ràng buộc: query timeout phía client > statement timeout phía server; transaction deadline > statement timeout.
- `TransactionManager` (apps/backend/src/transaction) do coordinator sở hữu. Participant chỉ nhận `TransactionContext` (`query`, `isActive`), không có pool, client thô hay lệnh BEGIN/COMMIT. Không tự retry, không giao dịch lồng nhau, không savepoint.
- COMMIT không nhận được phản hồi trả `503 TRANSACTION_OUTCOME_UNKNOWN`; callback không bao giờ chạy lần hai.
- Primitive dùng chung: JSON canonical v1 + validator có giới hạn, keyring/HKDF/HMAC/AES-GCM, khóa advisory hai int32.

### Idempotency (M00-C1A1 — draft PR #5)

- `CRYPTO_ACTIVE_KEY_ID` và `CRYPTO_KEYRING` (`id:base64,id:base64`, mỗi master key đúng 32 byte) là bắt buộc. `.env.example` chỉ chứa placeholder; thay bằng khóa riêng trước khi chạy app.
- `IDEMPOTENCY_ADVISORY_WAIT_MS` mặc định 250ms và `DB_BUSINESS_LOCK_TIMEOUT_MS` mặc định 500ms; cả hai phải nhỏ hơn `DB_STATEMENT_TIMEOUT_MS`.
- `IDEMPOTENCY_REPLAY_TTL_SECONDS` mặc định 900s, `IDEMPOTENCY_DEDUPE_TTL_SECONDS` mặc định 604800s; bắt buộc `1 <= replay <= dedupe <= 604800`.
- A1 tạo `app.idempotency_records`, executor exact-key, encrypted replay, historical-key rotation, replay authorization hook và cleanup primitive. TTL override chỉ lấy từ `IdempotencyOperationRegistry` bất biến phía server, không nhận TTL từ request. Không có scheduler production; audit/outbox vẫn thuộc C1B/C.
- Test: `npm run test:unit` không cần DB; `npm run test:integration` cần PostgreSQL test đúng guard hiện có (xem trên).

### Phạm vi hiện tại

Chỉ có nền backend: health endpoints, cấu hình, pool, migration runner, error contract. Chưa có Auth, Shop, Driver, Wallet, Delivery, frontend, SMS hay triển khai production. Hướng dẫn sao lưu/khôi phục ở [ops/runbooks](ops/runbooks/database-backup-restore-guidance.md) chỉ là hướng dẫn cho tương lai, chưa được kiểm thử.
