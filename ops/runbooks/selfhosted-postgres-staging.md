# Runbook — PostgreSQL 17 tự lưu trữ trên VPS (staging) — M00-VPS-01, gói A

**Trạng thái: đã chuẩn bị và đã kiểm thử trên PostgreSQL 17 tạm thời trong CI, CHƯA thực thi trên VPS VinaHost.** Mọi bước dưới
đây là hướng dẫn cho người vận hành; chưa có bằng chứng nào từ VPS. Không giá trị bí mật nào được nằm trong tài liệu này, trong
commit, log, evidence hay PR. Mọi `<placeholder>` do người vận hành nhập tại shell.

Phạm vi: **chỉ staging**, **một đích duy nhất** — PostgreSQL 17 chạy cùng máy với dịch vụ. Đường Supabase/Render
(`render-supabase-staging.md`) giữ nguyên và vẫn là mặc định khi không khai báo `DB_REMOTE_TARGET`. Việc cài artifact, nginx,
systemd, HTTPS thuộc gói B (runbook Ubuntu/VinaHost); runbook này chỉ phần cơ sở dữ liệu và các lệnh operator.

## 0. Hợp đồng đích (không có tùy chọn thay đổi)

| Hạng mục | Giá trị cố định |
|---|---|
| Chọn đích | `DB_REMOTE_TARGET=SELF_HOSTED` (không khai báo = `SUPABASE`; giá trị khác bị từ chối trước khi kết nối) |
| `APP_ENV` | `staging` (production bị từ chối) |
| Endpoint | host `localhost` (không dùng IP: chứng chỉ chỉ ghi `localhost`), port `5432` |
| Database | `ship11_staging` |
| Role operator | `ship11_migrator` — sở hữu schema `app` và lịch sử `app.pgmigrations`; **chỉ** nằm trong shell operator |
| Role runtime | `ship11_app` — credential duy nhất của dịch vụ; không DDL, không sở hữu đối tượng |
| Xác nhận đích | `MIGRATION_CONFIRM_TARGET=localhost:5432/ship11_staging` (gõ đúng từng ký tự) |
| TLS | CA riêng; `DB_SSL_CA_FILE` (hoặc `DB_SSL_CA`, đúng một trong hai); chuỗi chứng chỉ và host name đều được xác minh; URL không có query string; `NODE_TLS_REJECT_UNAUTHORIZED=0` bị từ chối |

Sau khi kết nối (đã qua TLS xác minh), **chính server** phải báo: database `ship11_staging`, role `ship11_migrator` (cả
`current_user` và `session_user`), port 5432, phiên đang dùng TLS, và role không có thuộc tính nâng quyền (superuser,
createrole, createdb, replication, bypassrls). Sai một điều là dừng trước khi đọc lịch sử, migrate, seed hay bootstrap.

Các lệnh dưới đây chạy từ thư mục release (`/opt/11ship/current`, nội dung do gói B đóng gói; hiện có thể là một checkout đã
`npm ci && npm run build` ở máy khác). `node scripts/<tên>.js` tương đương `npm run <lệnh>`.

## 1. Ai làm gì, ở đâu

| Bước | Người thao tác | User / thư mục | Dừng khi |
|---|---|---|---|
| 2–4 CA, chứng chỉ, cấu hình PostgreSQL | người vận hành | `root` trên VPS, `/root/ship11-pki`, `/etc/postgresql/17/main` | bất kỳ lệnh nào trả lỗi; **không** reload nếu `pg_hba.conf` mới chưa kiểm tra |
| 5 role/database/schema | người vận hành | `sudo -u postgres psql` | lỗi "already exists" (không chạy lại để "sửa") |
| 6–10 lệnh operator | người vận hành | `root` (hoặc user operator), thư mục release | mọi dòng `refused` / `failed` |

Giữ phiên SSH hiện có mở trong suốt khi sửa `pg_hba.conf`/cấu hình; mở phiên thứ hai để kiểm tra trước khi đóng phiên cũ.
Không mở cổng 5432 trên firewall: PostgreSQL chỉ lắng nghe `localhost`.

## 2. CA riêng và chứng chỉ server

```bash
sudo ./ops/selfhosted/make-pki.sh /root/ship11-pki          # thư mục phải chưa tồn tại; chỉ in fingerprint SHA-256
sudo install -d -o postgres -g postgres -m 750 /etc/postgresql/17/main/tls
sudo install -o postgres -g postgres -m 644 /root/ship11-pki/server.crt /etc/postgresql/17/main/tls/server.crt
sudo install -o postgres -g postgres -m 600 /root/ship11-pki/server.key /etc/postgresql/17/main/tls/server.key
sudo install -d -m 755 /etc/11ship
sudo install -m 644 /root/ship11-pki/ca.crt /etc/11ship/db-ca.crt     # CA công khai; dịch vụ và operator tin CA này
```

- Chứng chỉ server chỉ có SAN `DNS:localhost` (không có IP) nên host `127.0.0.1` bị từ chối khi xác minh — đúng chủ đích.
- Ghi fingerprint do script in vào hồ sơ vận hành (không phải bí mật). `ca.key` cất offline sau bước này; không cần lúc chạy.
- Hạn: CA 3650 ngày, server 825 ngày. Đổi chứng chỉ server: chạy lại script vào thư mục **mới**, thay hai file, reload PostgreSQL
  (cùng CA nên không phải đổi `db-ca.crt`). Đổi CA = thay mọi bản `db-ca.crt`.

## 3. Cấu hình PostgreSQL (loopback, TLS 1.3, SCRAM)

```bash
sudo cp /etc/postgresql/17/main/pg_hba.conf /root/pg_hba.conf.orig          # giữ bản gốc để khôi phục
sudo install -m 644 ops/selfhosted/postgresql-ship11.conf /etc/postgresql/17/main/conf.d/ship11.conf
sudo install -o postgres -g postgres -m 640 ops/selfhosted/pg_hba.conf /etc/postgresql/17/main/pg_hba.conf
sudo systemctl restart postgresql@17-main
```

Kiểm tra (kết quả mong đợi):

```bash
sudo ss -ltn '( sport = :5432 )'                       # chỉ 127.0.0.1:5432 (và [::1]:5432); không có 0.0.0.0
sudo -u postgres psql -Atc "show ssl; show ssl_min_protocol_version; show listen_addresses"   # on / TLSv1.3 / localhost
sudo -u postgres psql -Atc "select count(*) from pg_hba_file_rules where error is not null"   # 0
```

`pg_hba.conf` này chỉ cho: socket cục bộ cho user OS `postgres`; TCP chỉ database `ship11_staging`, chỉ hai role dự án, chỉ từ
loopback, chỉ `hostssl` + `scram-sha-256`; mọi kết nối TCP khác bị `reject`. Nếu `restart` thất bại: khôi phục
`/root/pg_hba.conf.orig` và gỡ `conf.d/ship11.conf`, rồi đọc `/var/log/postgresql/postgresql-17-main.log`.
Cấu hình bộ nhớ (`shared_buffers=128MB`, `max_connections=20`) là giá trị khởi đầu cho VPS ~1 GB, chưa đo trên máy thật.

## 4. Role, database, schema

Sinh mật khẩu vào file riêng, quyền 600 (hex để không cần percent-encode trong URL), không in ra màn hình:

```bash
sudo install -d -m 700 /root/ship11-secrets
( umask 077; openssl rand -hex 24 > /root/ship11-secrets/migrator.pw; openssl rand -hex 24 > /root/ship11-secrets/app.pw )
sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres
```

Trong phiên `psql` vừa mở (mật khẩu không xuất hiện trong argv, history của shell hay file SQL):

```
\set migrator_password `cat /root/ship11-secrets/migrator.pw`
\set app_password      `cat /root/ship11-secrets/app.pw`
\i /opt/11ship/current/ops/selfhosted/01-roles-database.sql
\q
```

Kết quả mong đợi cuối script: `database_name = ship11_staging`, `non_superuser_roles = 2`, `schema_app_owner = ship11_migrator`.
Script cố ý **không idempotent**: chạy lần hai dừng ở `CREATE ROLE` ("already exists") thay vì âm thầm đổi mật khẩu/quyền.

## 5. Shell operator

Operator environment tách khỏi environment của dịch vụ. Tạo file quyền 600, nạp vào shell, xóa/giữ offline sau khi xong:

```bash
( umask 077; cat > /root/ship11-secrets/operator.env <<EOF
APP_ENV=staging
DB_REMOTE_TARGET=SELF_HOSTED
MIGRATION_DATABASE_URL=postgres://ship11_migrator:$(cat /root/ship11-secrets/migrator.pw)@localhost:5432/ship11_staging
DATABASE_URL=postgres://ship11_app:$(cat /root/ship11-secrets/app.pw)@localhost:5432/ship11_staging
MIGRATION_CONFIRM_TARGET=localhost:5432/ship11_staging
DB_SSL_CA_FILE=/etc/11ship/db-ca.crt
EOF
)
set -a; . /root/ship11-secrets/operator.env; set +a
cd /opt/11ship/current
```

`DATABASE_URL` (runtime) **bắt buộc** có mặt: nó chỉ để chứng minh tách role (cùng host/port/database, role khác). Credential
migrator **không** được đưa vào environment của dịch vụ.

## 6. Preflight chỉ-đọc, rồi áp migration

```bash
node scripts/db-migrate-remote.js                 # mặc định chỉ kiểm tra và liệt kê; không thay đổi gì
node scripts/db-migrate-remote.js --apply         # áp đúng các migration còn thiếu
node scripts/db-migrate-remote.js                 # xác nhận: "N applied, 0 pending"
```

Dòng đầu phải là `connected over verified TLS to localhost:5432/ship11_staging as role ship11_migrator`. Các dòng dừng:

| Thông báo | Ý nghĩa | Việc cần làm |
|---|---|---|
| `DB_REMOTE_TARGET must be SUPABASE or SELF_HOSTED` | selector sai (phân biệt hoa/thường, không dấu cách) | sửa biến |
| `... must use the host name localhost` / `port 5432` / `database ship11_staging` / `role ...` | URL lệch đích hoặc đảo role | sửa URL; không "chữa" bằng IP hay role khác |
| `must not carry a query string` | có `?sslmode=...` trong URL | bỏ query string |
| `confirm the target by setting MIGRATION_CONFIRM_TARGET=...` | chưa gõ đúng đích | gõ đúng chuỗi hiển thị |
| `connect failed (code ...)` | lỗi TLS/xác thực: `UNABLE_TO_VERIFY_LEAF_SIGNATURE`/`SELF_SIGNED_CERT_IN_CHAIN` = sai CA; `CERT_HAS_EXPIRED` = hết hạn; `ERR_TLS_CERT_ALTNAME_INVALID` = sai host name | sửa CA/chứng chỉ; không tắt xác minh |
| `refused: the connected role has an elevated attribute ...` | `ship11_migrator` bị cấp thêm quyền | thu hồi (`ALTER ROLE ship11_migrator NOCREATEDB ...`) rồi chạy lại |
| `schema app is not owned by the migration role` | bước 4 chưa đúng | làm lại chuẩn bị; lệnh này không đổi chủ sở hữu |
| `the database has applied migrations this checkout does not know` | release cũ hơn DB | dùng đúng release khớp DB |
| `PostgreSQL 17 or newer is required` | sai phiên bản máy chủ | dừng, báo lại |

Không chạy migration lúc build/start; không có `down`, reset hay drop trên DB này.

## 7. Quyền runtime theo bảng

```bash
PGSSLROOTCERT=/etc/11ship/db-ca.crt PGPASSWORD="$(cat /root/ship11-secrets/migrator.pw)" \
  psql "host=localhost port=5432 dbname=ship11_staging user=ship11_migrator sslmode=verify-full" \
  -v ON_ERROR_STOP=1 -f ops/selfhosted/02-runtime-grants.sql
```

Ma trận trong file này **bằng đúng** bảng ở `render-supabase-staging.md` §3 và đúng tập bảng mà migration tạo (kiểm tra tĩnh
trong `npm run deploy:test`, và kiểm tra quyền hiệu lực thật bằng role runtime trong CI). Không dùng `GRANT ALL`, không
`ALTER DEFAULT PRIVILEGES`; `audit_logs` chỉ INSERT; `admin_auth_limit_config` chỉ SELECT; runtime không đọc `app.pgmigrations`.
Migration mới thêm bảng phải thêm dòng vào **cả hai** nơi trong cùng thay đổi, rồi chạy lại file này.

Kiểm tra bằng chính role runtime (kết quả mong đợi ở cuối mỗi dòng):

```bash
rt() { PGSSLROOTCERT=/etc/11ship/db-ca.crt PGPASSWORD="$(cat /root/ship11-secrets/app.pw)" \
  psql "host=localhost port=5432 dbname=ship11_staging user=ship11_app sslmode=verify-full" -Atc "$1"; }
rt "select count(*) from app.users"                    # chạy được
rt "select 1 from app.pgmigrations"                    # ERROR: permission denied (42501)
rt "select 1 from app.audit_logs"                      # ERROR: permission denied (42501)
rt "create table app.x (id int)"                       # ERROR: permission denied (42501)
```

## 8. Cấu hình limiter, SYSTEM, fixture (operator, đọc bí mật từ stdin)

Khóa limiter dùng **một lần và không đổi**; cùng cặp giá trị phải có trong environment dịch vụ (gói B) khi bật admin auth:

```bash
export ADMIN_RATE_LIMIT_KEY_ID=staging-1
export ADMIN_RATE_LIMIT_HMAC_KEY="$(openssl rand -base64 32)"      # giữ bản sao an toàn cùng khóa mã hóa; không đổi khi restart/deploy
node scripts/admin-auth-init-limit-config.js                        # lần đầu "created"; cùng khóa chạy lại "unchanged"; khóa khác bị từ chối
```

`admin-auth-bootstrap-system.js` (một tài khoản SYSTEM, chỉ sau khi Owner duyệt; **không có đường khôi phục** nếu mất mật khẩu
hoặc authenticator của tài khoản duy nhất này) và `staging-seed-fixtures.js` đọc dữ liệu **chỉ từ stdin**, từ file quyền 600
rồi xóa ngay; không đưa vào argv, log, PR hay evidence:

```bash
node scripts/admin-auth-bootstrap-system.js < /root/ship11-secrets/bootstrap.json      # {"phone": "+84...", "password": "..."}
# fixture: cần AUTH_STAGING_FIXTURES_ENABLED=true và AUTH_STAGING_ALLOWED_PHONES (JSON, tối đa 20 số, bí mật) trong shell
node scripts/staging-seed-fixtures.js < /root/ship11-secrets/fixtures.json              # [{"phone": "...", "password": "..."}]
shred -u /root/ship11-secrets/bootstrap.json /root/ship11-secrets/fixtures.json
```

Số lượng và danh tính fixture/tài khoản bootstrap do Owner chọn qua kênh bí mật phù hợp. Fixture không bao giờ có membership
quản trị; lệnh seed chạy lại cho kết quả `skipped` (không đổi dữ liệu); số điện thoại thuộc tài khoản không phải fixture làm hủy
cả lô.

## 9. Cập nhật, sao lưu, phục hồi (hướng dẫn — CHƯA kiểm thử phục hồi)

1. Trước mỗi lần áp migration trên DB đã có dữ liệu: `sudo -u postgres pg_dump -Fc ship11_staging > /var/backups/11ship/ship11_staging-<UTC>.dump`
   (thư mục quyền 700). Cất kèm khóa mã hóa của dịch vụ và khóa limiter — không có khóa, dữ liệu mã hóa trong bản sao không giải được.
2. Chạy preflight (`node scripts/db-migrate-remote.js`), đọc danh sách pending, rồi mới `--apply`.
3. Schema lỗi sau khi áp → **sửa tiến bằng migration mới**; không tự rollback/`down`. Rollback ứng dụng chỉ khi schema tương thích.
4. Phục hồi: restore vào một database **riêng** (`createdb` + `pg_restore`), kiểm tra, rồi quyết định; không `pg_restore --clean`
   lên `ship11_staging`. Phục hồi từ bản sao chưa từng được thử trên máy này; hồ sơ vận hành phải ghi lần thử đầu tiên.

## 10. Những gì CI đã và chưa chứng minh

CI (job "Self-hosted PostgreSQL 17 over TLS") dựng PostgreSQL 17.11 trong container tạm với đúng `make-pki.sh`, hba mô phỏng
`pg_hba.conf`, `01-roles-database.sql`, rồi chạy thật các lệnh operator: từ chối trước mọi mutation (selector, môi trường, host,
role, database, đích gõ tay, CA sai/host sai/hết hạn/plaintext/tắt xác minh, role bị nâng quyền); check mặc định chỉ đọc;
`--apply` đúng một lần và chạy lại không áp trùng; quyền runtime bằng role thật; limiter/bootstrap/seed giữ tính chất một-lần.
**Chưa được chứng minh:** bất cứ điều gì trên VPS thật (đây là lần đầu), phục hồi từ backup, tải/RAM, reboot, và việc dịch vụ ứng
dụng khởi động với role runtime (thuộc gói B).

Không bao giờ: đặt `APP_ENV=development` để vượt guard; giả username Supabase; tắt xác minh TLS; chạy migration từ máy local vào DB
này; chạy `npm run selfhosted:test` hay `test:integration` trên VPS (bộ test từ chối chạy ngoài GitHub Actions và sẽ phá dữ liệu).
