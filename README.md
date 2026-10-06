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

Trạng thái M00-B1: PR #1 (thiết kế, ADR, task) **đã merge vào `main`**. PR #2 (code M00-B1) đã target `main`, F01–F09 PASS, **chưa merge** và đang chờ final review. M00-C1 chưa bắt đầu; sau M00-B1 sẽ là M00-C1 (transaction context/idempotency/audit/outbox), rồi M01-A1 (Auth Core).

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

### Phạm vi hiện tại

Chỉ có nền backend: health endpoints, cấu hình, pool, migration runner, error contract. Chưa có Auth, Shop, Driver, Wallet, Delivery, frontend, SMS hay triển khai production. Hướng dẫn sao lưu/khôi phục ở [ops/runbooks](ops/runbooks/database-backup-restore-guidance.md) chỉ là hướng dẫn cho tương lai, chưa được kiểm thử.
