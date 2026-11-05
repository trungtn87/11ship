# Phase 3 — Script vận hành (carry-over G-7)

SHA phân tích `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Nhãn bằng chứng: **ĐÃ MỞ SOURCE** cho mọi dòng dưới đây (đọc toàn bộ file). Không chạy script nào (NOT TESTED ở runtime).

## 1. `scripts/admin-auth-recover-system.js`

| Mục | Kết luận | Bằng chứng (ĐÃ MỞ SOURCE) |
|---|---|---|
| Mục đích | Đặt lại mật khẩu của tài khoản SYSTEM đã tồn tại. Launcher mỏng: toàn bộ luật nằm trong `apps/backend/dist/admin-auth/cli` (cần `npm run build`). `npm run admin-auth:recover-system` | `scripts/admin-auth-recover-system.js:3-5,9-21`; `package.json` script `admin-auth:recover-system` |
| Điều kiện chạy | Chỉ `APP_ENV=development` hoặc `test`; `DATABASE_URL` host loopback; `HOST` loopback; sau khi kết nối, database VÀ role phải là `ship11_dev`/`ship11_test`, và `session_user` phải bằng role kỳ vọng. Mọi target khác bị từ chối trước khi đọc stdin hay kết nối | `admin-auth/cli/cli-target-guard.ts:315-327`; `system-recovery-cli.ts:35-39,66-76` |
| Tham số | Đúng một cờ `--check` hoặc `--apply`; còn lại exit 2 | `system-recovery-cli.ts:29-33` |
| Quyền | Không có HTTP route; CLI gọi thẳng `SystemRecoveryService`. Không OTP, không đổi TOTP, vai trò, trạng thái, hồ sơ | `system-recovery-service.ts:17-20` |
| Secrets/env | Mật khẩu và số điện thoại chỉ qua **stdin JSON**, không qua argv/env. `--apply` cần đúng 4 khóa `phone`, `password`, `expected_version`, `confirmation` = `RESET_SYSTEM_LOCAL_TEST` | `cli/stdin-input.ts:55,85-95`; `system-recovery-cli.ts:42-54` |
| DB/resource tác động | `--check`: chỉ đọc version (user root + membership). `--apply`: đặt `password_hash`, thu hồi mọi session (user và admin), supersede challenge chưa dùng, ghi audit `systemPasswordRecovered` (`actor_type=SYSTEM`, `execution_context=LOCAL_OPERATOR`) trong **một transaction** | `system-recovery-service.ts:44-80` |
| Destructive | Ghi đè mật khẩu SYSTEM và đăng xuất mọi phiên SYSTEM. Không xóa dữ liệu | `system-recovery-service.ts:56-62` |
| Chống chạy nhầm | (1) allowlist môi trường development/test và loopback, (2) kiểm danh tính DB/role sau kết nối, (3) `confirmation` cố định, (4) `expected_version` (VERSION_CONFLICT nếu lệch), (5) xác minh phone khớp và `account_origin=ADMIN_PROVISIONED` và role `SYSTEM` trên hàng đã khóa, (6) output chỉ mã cố định, không lộ phone/hash, (7) `TRANSACTION_OUTCOME_UNKNOWN` báo "không gửi lại" | `system-recovery-cli.ts:70-76,99-106`; `system-recovery-service.ts:53-55,100-106` |
| Không chạy trên VPS vận hành | Guard từ chối mọi `APP_ENV` khác development/test, nên script này không dùng được trên VPS (staging/production). Đây là thiết kế, không phải lỗi. Đường recovery SYSTEM trên VPS chưa được đánh giá ở mục này. NOT TESTED | `cli-target-guard.ts:316-318` |

## 2. `scripts/db-migrate-remote.js`

| Mục | Kết luận | Bằng chứng (ĐÃ MỞ SOURCE) |
|---|---|---|
| Mục đích | Cách duy nhất được hỗ trợ để migrate DB từ xa (staging/production). Chạy `node-pg-migrate` trên client đã kết nối TLS. Không chạy lúc build/start | `db-migrate-remote.js:3-21,197-213` |
| Điều kiện chạy | `APP_ENV` ∈ {staging, production}; cần `apps/backend/dist` (dùng module TLS đã biên dịch); target qua `DB_REMOTE_TARGET` (`SUPABASE` mặc định hoặc `SELF_HOSTED`); `MIGRATION_CONFIRM_TARGET` phải gõ đúng target | `:43,246-270`; `db-remote-target.js:23-32,91-93` |
| Quyền | `MIGRATION_DATABASE_URL` = role migration, phải KHÁC role runtime (`DATABASE_URL`); SELF_HOSTED: `ship11_migrator` (runtime `ship11_app`), schema `app` phải do role migration sở hữu | `:117-140,307-309`; `db-remote-target.js:29-32` |
| Secrets/env | `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `DB_SSL_CA`/`DB_SSL_CA_FILE`, `MIGRATION_CONFIRM_TARGET`, `APP_ENV`, `DB_REMOTE_TARGET`. Không đọc `.env`; chỉ in tên, số đếm, tên file migration | `:19,260-270` |
| DB/resource tác động | Mặc định **chỉ kiểm** (version, role, pending). `--apply` chạy các migration chưa áp dụng, bảng lịch sử `app.pgmigrations`; giữ advisory lock của node-pg-migrate; `checkOrder: true`; không tạo schema | `:16-18,303-331,197-213` |
| Destructive | `--apply` thay đổi schema theo các file `database/migrations/*.sql` (chỉ `up`, không `down`). Từ chối nếu DB có migration mà checkout không biết (`unknownApplied`) | `:315-317,200-205` |
| Chống chạy nhầm | Mặc định check-only; target confirm gõ tay; SELF_HOSTED xác minh từ **server** (database/role/port/TLS/không role nâng quyền) trước khi đọc gì; PG ≥ 17; từ chối cờ lạ (chỉ `--apply`) | `:240-244,283-291,299-301` |
| **Lệch tài liệu trong chính script** | Header ghi SELF_HOSTED "APP_ENV=staging only" (`:13`; `db-remote-target.js:8` "staging only") nhưng code chấp nhận `production` trên đúng instance này theo quyết định Owner 2026-10-14 (`db-remote-target.js:23-26`; `:43`). Chỉ là comment cũ, hành vi đúng quyết định Owner. Phân loại: **sửa tài liệu/comment** | `db-migrate-remote.js:13,43`; `db-remote-target.js:8,23-26` |

## 3. `scripts/staging-seed-fixtures.js`

| Mục | Kết luận | Bằng chứng (ĐÃ MỞ SOURCE) |
|---|---|---|
| Mục đích | Tạo tài khoản fixture cho staging (M00-D2) từ stdin JSON. Không có HTTP endpoint, không chạy ở build/start | `staging-seed-fixtures.js:3-17` |
| Điều kiện chạy | **`APP_ENV=staging` duy nhất** (không nhận production); `AUTH_STAGING_FIXTURES_ENABLED=true` và `AUTH_STAGING_ALLOWED_PHONES` hợp lệ (cùng parser của ứng dụng); cùng target gates với `db-migrate-remote` (dùng chung `checkRemoteTargets`); `MIGRATION_CONFIRM_TARGET`; cần build | `:100-139` |
| Quyền | Role migration (`MIGRATION_DATABASE_URL`), TLS strict | `:11,129-135` |
| Secrets/env | Dữ liệu `[{phone,password}]` chỉ qua stdin (≤ 64 KiB, ≤ 20 tài khoản, đúng khóa, phone nằm trong allowlist, không trùng); từ chối stdin là terminal; không có đối số | `:28,77-91,100-103,154-157` |
| DB/resource tác động | Bảng `app.users` (tạo user `STAGING_FIXTURE`), audit; một transaction, một advisory lock, `lock_timeout 10s`, `statement_timeout 30s`; yêu cầu ràng buộc `users_account_origin_ck` chấp nhận `STAGING_FIXTURE` | `:14-16,194-216` |
| Destructive | Không xóa, không đổi mật khẩu/role/hồ sơ/session. Fixture đã có thì bỏ qua; tài khoản khác (đã xác minh hoặc admin) làm **rollback cả batch** | `:14-15,221,227-229` |
| Chống chạy nhầm | Như trên + xác minh danh tính server cho SELF_HOSTED, PG ≥ 17, commit không rõ kết quả thì chạy lại an toàn (idempotent) | `:178-185,199-204,230-232` |
| Hệ quả | Script từ chối `APP_ENV=production`, nên không seed được trên instance chạy production (khớp quyết định "không fixture" ở CLAUDE.md, mục VPS). `APP_ENV` thực tế của VPS chưa được kiểm tra trong Phase 3. NOT TESTED | `:104-106`; `CLAUDE.md` (mục VPS = real operating build) |
