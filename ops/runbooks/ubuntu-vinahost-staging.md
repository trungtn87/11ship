# Runbook — triển khai staging lên Ubuntu 24.04 / VinaHost VPS — M00-VPS-01, gói B

**Trạng thái: đã chuẩn bị, CHƯA thực thi trên VPS.** Artifact được dựng và kiểm tra trong CI (giải nén, tải module, băm/verify
Argon2 native, checksum, manifest); mọi bước dưới đây là hướng dẫn cho **người vận hành** (Owner hoặc người Owner chỉ định).
Chưa có bằng chứng nào từ VPS, nên chưa được ghi là "đã triển khai". Không giá trị bí mật nào nằm trong tài liệu này, trong
artifact, commit, log, evidence hay PR; mọi `<placeholder>` do người vận hành nhập tại shell trên VPS. **Không gửi mật khẩu,
khóa riêng hay file `.env` qua chat/PR/issue.**

Phạm vi: **chỉ staging**, một VPS (1 vCPU, ~1 GB RAM), một hostname `103.9.78.67.sslip.io`, một dịch vụ Node + PostgreSQL 17 cùng
máy + nginx. Phần cơ sở dữ liệu (CA, `pg_hba.conf`, role, grant, lệnh operator) nằm ở
[`selfhosted-postgres-staging.md`](selfhosted-postgres-staging.md) (gói A); runbook này nối nó vào quy trình cài đặt và vận hành.

## 0. Hợp đồng

| Hạng mục | Giá trị |
|---|---|
| Hostname | `103.9.78.67.sslip.io` (DNS đã được Owner kiểm tra trỏ đúng IP; **người vận hành kiểm tra lại ở bước 2**) |
| Môi trường | `APP_ENV=staging`, `NODE_ENV=production`; production bị từ chối |
| Node | đúng `.node-version` (24.21.0), cài sẵn trên VPS |
| User dịch vụ | `ship11` (nologin, không sudo, không sở hữu file release) |
| Thư mục | `/opt/11ship/releases/<sha>` (bất biến, `root:root`), `/opt/11ship/current` → release đang chạy, `/etc/11ship` (cấu hình), `/var/backups/11ship` |
| Backend | `127.0.0.1:3000`, `DB_POOL_MAX=2`; chỉ nginx nghe công khai (80/443) |
| Cùng một origin | Admin web + API cùng `https://103.9.78.67.sslip.io` (cookie quản trị là `__Host-`) |
| Đóng | `ADMIN_ACTIVATION_ENABLED=false`; không có provider OTP `TEST_INBOX`; OTP/đăng ký đóng (chế độ fixture) |
| Cổng | Chỉ mở SSH, 80, 443. PostgreSQL 5432 **không** mở ra ngoài |

## 1. Artifact và cách kiểm tra

CI (job "Ubuntu/VinaHost artifact") tạo, từ đúng một commit:

- `11ship-<sha>-ubuntu24-amd64.tar.gz` và `11ship-<sha>-ubuntu24-amd64.tar.gz.sha256`;
- bên trong, một thư mục gốc `11ship-<sha>-ubuntu24-amd64/` gồm: `apps/backend/dist` (đã biên dịch, không source map),
  `apps/admin-web/dist` (bản thật, không design preview), `database/migrations`, các lệnh operator trong `scripts/`, `ops/`
  (mẫu cấu hình + runbook), `node_modules` (chỉ phụ thuộc runtime + `node-pg-migrate`; Argon2 prebuilt linux-x64),
  `RELEASE.json` (SHA nguồn, phiên bản Node) và `MANIFEST.sha256` (băm từng file);
- không có `.env`, secret, khóa, source map, TypeScript/Jest/ESLint, mã nguồn app.

Lấy artifact từ trang GitHub Actions của đúng commit (Owner/người vận hành tải về máy riêng), rồi đưa lên VPS bằng `scp` qua SSH
của chính người vận hành. Trên VPS:

```bash
cd /root/ship11-incoming                                  # thư mục tạm, quyền 700, chứa file vừa upload
SHA=<40 ký tự hex của commit đã được review>
sha256sum -c "11ship-${SHA}-ubuntu24-amd64.tar.gz.sha256"   # phải in: ...tar.gz: OK
```

**Đối chiếu SHA256 với giá trị Claude/ChatGPT/CI công bố qua kênh khác** (không chỉ file `.sha256` đi kèm). Sai một ký tự là dừng,
không giải nén.

## 2. Chuẩn bị máy (một lần, người vận hành, `root`)

Giữ phiên SSH hiện có mở trong suốt bước firewall; mở phiên thứ hai để kiểm tra trước khi đóng phiên cũ.

```bash
node -v                                                   # phải đúng v24.21.0 (so với .node-version)
getent hosts 103.9.78.67.sslip.io                         # phải ra 103.9.78.67
apt-get update && apt-get install -y nginx certbot
id ship11 >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin ship11
install -d -m 755 /opt/11ship /opt/11ship/releases
install -d -m 750 -o root -g ship11 /etc/11ship           # nếu gói A đã tạo /etc/11ship (755), đổi: chmod 750 + chgrp ship11; db-ca.crt vẫn đọc được (644)
install -d -m 700 /var/backups/11ship /root/ship11-secrets
install -d -m 755 /var/www/11ship-acme
rm -f /etc/nginx/sites-enabled/default                    # trang mặc định của nginx
```

Firewall (bỏ qua nếu VinaHost đã có firewall mạng; vẫn nên có ở host):

```bash
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw status verbose                                        # kiểm tra thấy OpenSSH TRƯỚC khi chạy "ufw enable"
ufw enable
```

## 3. Cài release

```bash
cd /root/ship11-incoming
tar -xzf "11ship-${SHA}-ubuntu24-amd64.tar.gz"
test -f "11ship-${SHA}-ubuntu24-amd64/RELEASE.json" && grep -q "\"sourceSha\": \"${SHA}\"" "11ship-${SHA}-ubuntu24-amd64/RELEASE.json"
( cd "11ship-${SHA}-ubuntu24-amd64" && sha256sum -c --quiet MANIFEST.sha256 )      # không in gì = đủ và đúng
test ! -e "/opt/11ship/releases/${SHA}"                                              # release đã cài không bị ghi đè
mv "11ship-${SHA}-ubuntu24-amd64" "/opt/11ship/releases/${SHA}"
chown -R root:root "/opt/11ship/releases/${SHA}" && chmod -R go-w "/opt/11ship/releases/${SHA}"
```

`current` chỉ được trỏ sau khi cơ sở dữ liệu đã sẵn sàng (bước 4–5). Lần đầu:

```bash
ln -sfn "/opt/11ship/releases/${SHA}" /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
```

## 4. Cơ sở dữ liệu (gói A)

Làm đúng [`selfhosted-postgres-staging.md`](selfhosted-postgres-staging.md) các mục 2–8 từ `/opt/11ship/current` (CA — `make-pki.sh new`; cấu hình
PostgreSQL; role/database — **chỉ** bằng `sudo ./ops/selfhosted/run-roles-database.sh`; gia hạn chứng chỉ giữ CA/xoay CA ở mục 2a/2b; operator env, preflight → `--apply`, grant runtime, kiểm tra quyền, limiter, tài khoản SYSTEM nếu Owner
đã duyệt). Quy tắc giữ nguyên: không reset/drop/down, không migration từ máy local, không tắt xác minh TLS, mật khẩu/số điện thoại
chỉ qua stdin hoặc file quyền 600 rồi xóa. **Dịch vụ chưa được khởi động ở bước này.**

## 5. Cấu hình dịch vụ (người vận hành tạo, không commit)

Lấy mẫu từ `ops/vinahost/staging.env.example`, điền giá trị thật tại shell, không echo ra màn hình:

```bash
install -m 640 -o root -g ship11 /opt/11ship/current/ops/vinahost/staging.env.example /etc/11ship/staging.env
${EDITOR:-nano} /etc/11ship/staging.env
```

Điền thế các `<placeholder>`:

- `DATABASE_URL`: role `ship11_app`, host `localhost`, mật khẩu từ `/root/ship11-secrets/app.pw` (hex, không cần percent-encode). Không
  query string. **Không** đặt credential `ship11_migrator` vào file này.
- `AUTH_OTP_HMAC_SECRET`, `ADMIN_RATE_LIMIT_HMAC_KEY`, `CRYPTO_KEYRING`: `openssl rand -base64 32` (đúng 32 byte). Cặp
  `ADMIN_RATE_LIMIT_KEY_ID` / `ADMIN_RATE_LIMIT_HMAC_KEY` **trùng đúng** giá trị đã dùng cho `admin-auth:init-limit-config` (đổi là
  dịch vụ bị từ chối khởi động). Sao lưu khóa mã hóa + khóa limiter ngoài VPS: mất khóa = dữ liệu mã hóa không giải được.
- `AUTH_STAGING_ALLOWED_PHONES`: do Owner chọn (dữ liệu cá nhân); tối đa 20 số.
- `ADMIN_AUTH_ALLOWED_ORIGINS` / `ADMIN_ACTIVATION_ORIGIN`: đúng một origin HTTPS `https://103.9.78.67.sslip.io` (không đường dẫn,
  không `/` cuối); `ADMIN_ACTIVATION_ORIGIN` phải nằm trong danh sách trên. Giữ `ADMIN_ACTIVATION_ENABLED=false`.
- Không thêm `OTP_PROVIDER`, `ADMIN_ACTIVATION_OTP_MODE`, `APP_ENV=development`, hay `NODE_TLS_REJECT_UNAUTHORIZED`.

```bash
stat -c '%a %U:%G %n' /etc/11ship/staging.env /etc/11ship/db-ca.crt       # 640 root:ship11 / 644 root:root
```

## 6. systemd

```bash
install -m 644 /opt/11ship/current/ops/vinahost/11ship-staging.service /etc/systemd/system/11ship-staging.service
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/11ship-staging.service
systemctl enable --now 11ship-staging
sleep 3; systemctl --no-pager status 11ship-staging
journalctl -u 11ship-staging -n 40 --no-pager                             # đọc: phải có dòng khởi động, không có stack trace
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/v1/health/ready   # 200 khi DB trả lời, 503 nếu không
```

Dịch vụ từ chối khởi động nếu cấu hình sai và chỉ nêu **tên biến** sai, không in giá trị.
`WorkingDirectory=/opt/11ship/current` là bắt buộc: Admin web được tìm theo `apps/admin-web/dist` tương đối.

### Vòng restart có giới hạn và cách phục hồi

Unit tự đặt `Restart=on-failure`, `RestartSec=5`, `StartLimitIntervalSec=300`, `StartLimitBurst=5` (không phụ thuộc cấu hình
systemd của nhà cung cấp): dịch vụ lỗi ngay khi khởi động chỉ được thử tối đa 5 lần trong 300 giây (~25 giây), sau đó dừng ở trạng
thái `failed` (journal ghi `Start request repeated too quickly`; tùy bản systemd, `Result` hiện `start-limit-hit` hoặc `exit-code`) và **không tự chạy lại**. Đây là chủ đích: sửa cấu hình, không để vòng lỗi chạy mãi.

```bash
systemctl status 11ship-staging --no-pager              # "failed" + journal "Start request repeated too quickly" = đã chạm giới hạn
journalctl -u 11ship-staging -n 60 --no-pager           # dòng "invalid or missing configuration. Check environment variable(s): <TÊN>"
${EDITOR:-nano} /etc/11ship/staging.env                 # sửa đúng biến được nêu tên (không dán giá trị vào chat/log)
systemctl reset-failed 11ship-staging                   # xóa trạng thái failed và bộ đếm giới hạn
systemctl start 11ship-staging && sleep 3 && curl -fsS http://127.0.0.1:3000/v1/health/ready
```

`systemctl start`/`restart` khi vẫn đang bị giới hạn khởi động bị từ chối ("Start request repeated too quickly"): phải `reset-failed` trước.
Chỉ khi `/v1/health/ready` trả 200 mới coi là phục hồi; 503 nghĩa là ứng dụng chạy nhưng chưa nối được cơ sở dữ liệu (xem gói A).

## 7. nginx và HTTPS

Giai đoạn A — chỉ HTTP, để certbot xác thực:

```bash
install -m 644 /opt/11ship/current/ops/vinahost/nginx-11ship-staging-bootstrap.conf /etc/nginx/sites-available/11ship-staging.conf
ln -sfn /etc/nginx/sites-available/11ship-staging.conf /etc/nginx/sites-enabled/11ship-staging.conf
nginx -t && systemctl reload nginx
certbot certonly --webroot -w /var/www/11ship-acme -d 103.9.78.67.sslip.io --agree-tos -m <email-người-vận-hành> --no-eff-email
```

`sslip.io` là tên miền dùng chung: nếu Let's Encrypt trả `rateLimited` hoặc lỗi xác thực, **dừng, đừng thử lặp**, báo lại Owner để chọn
tên miền riêng. Giai đoạn B — site đầy đủ (chỉ sau khi `/etc/letsencrypt/live/103.9.78.67.sslip.io/` tồn tại):

```bash
install -m 644 /opt/11ship/current/ops/vinahost/nginx-11ship-staging.conf /etc/nginx/sites-available/11ship-staging.conf
nginx -t && systemctl reload nginx
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx && chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
certbot renew --dry-run                                                   # gia hạn tự động chạy qua certbot.timer
```

nginx **ghi đè** `X-Forwarded-For` bằng đúng một địa chỉ client (`$remote_addr`) và xóa `Forwarded`; vì vậy
`ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]` an toàn. Không đổi thành `$proxy_add_x_forwarded_for`.

## 8. Kiểm tra sau triển khai (ghi kết quả vào hồ sơ vận hành)

```bash
curl -sI https://103.9.78.67.sslip.io/ | head -5                          # 200 + Strict-Transport-Security; HTTP/2
curl -s  https://103.9.78.67.sslip.io/v1/health/ready                     # trạng thái DB ready
curl -sI http://103.9.78.67.sslip.io/ | head -3                           # 301 -> https
curl -sI -H 'Host: other.example' https://103.9.78.67.sslip.io/ -k | head -2   # kết nối bị đóng (444)
ss -ltn                                                                   # 3000 chỉ trên 127.0.0.1; 5432 chỉ trên loopback; 80/443 công khai
journalctl -u 11ship-staging --since '10 min ago' --no-pager | grep -ciE 'password|secret|token' # nên là 0
```

Từ trình duyệt: mở trang quản trị, kiểm tra đăng nhập bằng tài khoản mà Owner đã tạo qua kênh an toàn. **Chỉ khi các lệnh trên
thực sự chạy trên VPS và log được lưu lại mới được ghi "đã triển khai".**

## 9. Cập nhật

1. Lấy artifact mới (bước 1), kiểm tra checksum và SHA đã được review.
2. Cài vào `/opt/11ship/releases/<sha-mới>` (bước 3) — **chưa** đổi `current`.
3. Sao lưu: `sudo -u postgres pg_dump -Fc ship11_staging > /var/backups/11ship/ship11_staging-$(date -u +%Y%m%dT%H%M%SZ).dump`
   (thư mục 700). Cất kèm khóa mã hóa/limiter.
4. Preflight từ release **mới**: nạp operator env, `cd /opt/11ship/releases/<sha-mới>`, chạy `node scripts/db-migrate-remote.js`
   (chỉ đọc), xem danh sách pending, rồi `--apply` nếu có. Cập nhật grant runtime (`02-runtime-grants.sql`) nếu release thêm bảng.
5. Đổi `current` và khởi động lại:
   ```bash
   ln -sfn /opt/11ship/releases/<sha-mới> /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
   systemctl restart 11ship-staging && sleep 3 && curl -fsS http://127.0.0.1:3000/v1/health/ready
   ```
6. Giữ ít nhất release trước đó và một release nữa; xóa các release cũ hơn bằng tay sau khi ổn định.

## 10. Rollback

Rollback chỉ đổi **mã ứng dụng**, không đổi cơ sở dữ liệu:

```bash
ln -sfn /opt/11ship/releases/<sha-trước> /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
systemctl restart 11ship-staging && curl -fsS http://127.0.0.1:3000/v1/health/ready
```

Chỉ khi schema hiện tại tương thích với release cũ. Release cũ gặp migration lạ sẽ bị operator từ chối (đúng thiết kế). Schema lỗi →
**sửa tiến bằng migration mới**; không `down`, không reset, không `DROP`. Phục hồi dữ liệu: restore vào database riêng (`createdb`
+ `pg_restore`), kiểm tra, rồi quyết định (xem gói A mục 9); chưa từng thử trên máy này.

## 11. Sao lưu và những gì cần cất ngoài VPS

- `pg_dump -Fc` trước mỗi lần migrate (mục 9) và định kỳ do Owner quyết định; chép ra ngoài VPS.
- Khóa mã hóa (`CRYPTO_KEYRING`), khóa limiter, `ca.key` của CA riêng: cất offline, mất = không phục hồi được.
- Chưa có lịch sao lưu tự động trong gói này; lần phục hồi thử đầu tiên phải được ghi vào hồ sơ vận hành.

## 12. CI đã và chưa chứng minh

**Đã (trong CI, trên runner Ubuntu 24.04):** unit systemd thật, nguyên văn, trên một bản release giả: lỗi ngay → số lần thử hữu hạn → `failed`
("Start request repeated too quickly") → sửa env + `reset-failed` + `start` phục hồi; chạy bằng `ship11` tại thư mục release, giới hạn heap, SIGTERM dừng sạch;
dựng artifact từ commit; checksum khớp; cây thư mục đúng một gốc theo SHA; manifest khớp
từng file; không source map/`.env`/khóa/design preview; ứng dụng đã biên dịch và các công cụ operator tải được từ cây đã giải nén;
Argon2 native băm và xác minh được; các lệnh operator từ chối (mã 1) khi thiếu đích; mẫu systemd/nginx/env qua kiểm tra tĩnh
(loopback, `User=ship11`, ghi đè `X-Forwarded-For`, không bí mật, không TEST_INBOX, cờ kích hoạt tắt).

**Chưa:** mọi thứ trên VPS thật — cài đặt, `systemd` khởi động thật (CI đã thử unit trên runner, không phải VPS), nginx `-t` với bản 1.24 của Ubuntu, Let's Encrypt cho `sslip.io`,
HTTP/2/HSTS, tải/RAM trên 1 vCPU ~1 GB, reboot, sao lưu/phục hồi. ChatGPT review đúng SHA cuối và Owner nghiệm thu là các bước còn lại;
không có gì ở đây được merge hay tuyên bố đã nghiệm thu.
