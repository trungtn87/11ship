# Runbook — cập nhật VPS từ release `75a0a29` lên bản vận hành thật (production) — 14/10/2026

**Trạng thái: chuẩn bị, CHƯA thực thi trên VPS.** Quyết định: [M01-production-profile-20261014.md](../../docs/current/M01-production-profile-20261014.md). Người vận hành là Owner hoặc người Owner chỉ định, chạy tại shell VPS.
**Không gửi mật khẩu, khóa, OTP, token hay file `.env` qua chat/PR/log.** Không reset/drop/down, không đổi tên database, không ghi đè khóa hiện có.

## 0. Phạm vi thay đổi so với release đang chạy
| Hạng mục | Chi tiết |
|---|---|
| Release hiện tại | `75a0a2938dc89418970dc4e1bbf16f8094a1c586` (`APP_ENV=staging`, `GET /v1/client-auth/config` → 404 vì release cũ hơn các route client-auth) |
| Migration pending (4) | `1792713600000_allow-test-unverified-account-origin`, `1792800000000_add-admin-activation-phone-verification-mode`, `1792886400000_create-client-device-binding`, `1792972800000_create-sms-gateway`. Chỉ thêm/đổi ràng buộc và bảng mới; không xóa dữ liệu. Dữ liệu fixture cũ vẫn hợp lệ trong DB nhưng **tài khoản fixture không đăng nhập được** ở production (đúng thiết kế); không xóa — Owner quyết định dọn sau. |
| Grant runtime mới (10 bảng) | `client_device_keys`, `client_device_challenges`, `client_device_registration_grants`, `client_device_bindings`, `client_device_key_links`, `client_session_bindings`, `client_device_request_nonces`, `sms_gateway_devices`, `sms_gateway_control`, `sms_jobs` (đã nằm trong `ops/selfhosted/02-runtime-grants.sql`; chạy lại file này là idempotent) |
| Env | mẫu `ops/vinahost/production.env.example`: đổi `APP_ENV=production`; **xóa** `AUTH_STAGING_FIXTURES_ENABLED`, `AUTH_STAGING_ALLOWED_PHONES`; đặt `ADMIN_ACTIVATION_ENABLED=true`, `ADMIN_ACTIVATION_OTP_MODE=SMS`, `ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED=true`, `SMS_GATEWAY_*`, `ACCOUNT_RECOVERY_MODE=SMS_OTP`, `CLIENT_AUTH_*_VERSION`, `CLIENT_AUTH_ANDROID_ENABLED=true` + `CLIENT_DEVICE_*`. **Giữ nguyên** `DATABASE_URL`, `CRYPTO_*`, `AUTH_OTP_HMAC_SECRET`, `ADMIN_RATE_LIMIT_*` đang có. |
| File tin cậy mới | `/etc/11ship/trust/` (root:ship11, 0750): `android-signers.json`, `android-attestation-roots.pem`, `android-attestation-revocation.json` (mục 4) |
| Tự động | timer `11ship-attestation-refresh` làm mới snapshot revocation mỗi 6 giờ (server từ chối snapshot > 24 giờ) |
| Không đổi | nginx, chứng chỉ, PostgreSQL, tên service `11ship-staging`, unit systemd, user, thư mục |

## 1. Lấy và kiểm tra gói
Artifact CI của PR (`11ship-<sha>-ubuntu24-amd64.tar.gz` + `.sha256` + `RELEASE.json`/`MANIFEST.sha256` bên trong). Kiểm tra:
```bash
sha256sum -c 11ship-<sha>-ubuntu24-amd64.tar.gz.sha256
mkdir -p /opt/11ship/releases && tar -xzf 11ship-<sha>-ubuntu24-amd64.tar.gz -C /opt/11ship/releases   # ra /opt/11ship/releases/<sha>
cat /opt/11ship/releases/<sha>/RELEASE.json   # "sha" phải đúng SHA đã được review
```
`current` **chưa đổi**; release `75a0a29` còn nguyên để rollback.

## 2. Sao lưu (bắt buộc trước migrate)
```bash
install -d -m 700 /var/backups/11ship
sudo -u postgres pg_dump -Fc ship11_staging > /var/backups/11ship/ship11_staging-$(date -u +%Y%m%dT%H%M%SZ).dump
cp -a /etc/11ship/staging.env /var/backups/11ship/staging.env.$(date -u +%Y%m%dT%H%M%SZ)   # chứa bí mật: giữ quyền 600, ngoài repo
```
Chép bản sao ra ngoài VPS. Cất kèm `CRYPTO_KEYRING` và khóa limiter (mất khóa = dữ liệu mã hóa không đọc được).

## 3. Preflight và migrate (từ release MỚI, shell operator — mục 5 `selfhosted-postgres-staging.md`)
Trong `/root/ship11-secrets/operator.env` đổi **chỉ** dòng `APP_ENV=staging` → `APP_ENV=production` (giữ `DB_REMOTE_TARGET=SELF_HOSTED`, đích `localhost:5432/ship11_staging`, hai role khác nhau, `MIGRATION_CONFIRM_TARGET` gõ đúng).
```bash
set -a; . /root/ship11-secrets/operator.env; set +a
cd /opt/11ship/releases/<sha>
node scripts/db-migrate-remote.js            # chỉ đọc: phải liệt kê đúng 4 migration pending ở mục 0; dừng nếu khác
node scripts/db-migrate-remote.js --apply    # áp dụng; dừng ngay nếu báo lỗi, KHÔNG chạy lại bằng cách xóa/reset
sudo -u postgres psql -d ship11_staging -v ON_ERROR_STOP=1 -f /opt/11ship/releases/<sha>/ops/selfhosted/02-runtime-grants.sql
```
Kiểm tra quyền tối thiểu: `sudo -u postgres psql -d ship11_staging -c "\dp app.sms_jobs app.client_device_keys"` → `ship11_app` chỉ có các quyền đã liệt kê (không DELETE/TRUNCATE).

## 4. File tin cậy Android (thật, không fixture)
```bash
install -d -m 750 -o root -g ship11 /etc/11ship/trust
```
- **Signer cố định**: artifact `android-signers.json` của workflow **Mobile APK** (SHA-256 chứng chỉ ký của khóa bền vững; không chứa bí mật). Lấy từ lần chạy dùng để phát hành APK; đặt `install -m 640 -o root -g ship11 android-signers.json /etc/11ship/trust/`. Hai package: `vn.eleven.food.test`, `vn.eleven.ship.test`, cùng một signer.
- **Attestation roots**: PEM các root Android Key Attestation do **Owner/vận hành tự pin** từ nguồn chính thức của Google (tài liệu Android “Verify hardware-backed key pairs with key attestation”). Đối chiếu dấu vân tay với nguồn chính thức trước khi dùng; server không bao giờ dùng kho tin cậy của hệ điều hành cho việc này. `install -m 640 -o root -g ship11 roots.pem /etc/11ship/trust/android-attestation-roots.pem`. **Repo không chứa roots thật; thiếu file này thì dịch vụ từ chối khởi động (đúng thiết kế).**
- **Revocation**: tạo lần đầu và đặt timer làm mới:
```bash
node /opt/11ship/releases/<sha>/scripts/android-attestation-refresh.mjs /etc/11ship/trust/android-attestation-revocation.json
install -m 644 /opt/11ship/releases/<sha>/ops/vinahost/11ship-attestation-refresh.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now 11ship-attestation-refresh.timer
stat -c '%a %U:%G %n' /etc/11ship/trust/*     # 640 root:ship11
```
Nếu lệnh làm mới lỗi (mạng/định dạng) file cũ giữ nguyên; sau 24 giờ server trả 503 cho xác minh thiết bị — đó là kết quả trung thực, không có fallback.

## 5. Cập nhật env dịch vụ (tại chỗ)
Mở `/etc/11ship/staging.env` và đối chiếu từng dòng với `ops/vinahost/production.env.example` (không dán giá trị vào chat). Sau khi sửa: `stat -c '%a %U:%G' /etc/11ship/staging.env` → `640 root:ship11`.
`SMS_GATEWAY_ALLOWLIST`: các số do Owner chọn (dữ liệu cá nhân). `SMS_GATEWAY_RECIPIENT_MODE` để `ALLOWLIST`; chỉ chuyển `OPEN` khi Owner xác nhận điều khoản SIM/nhà mạng — khi đó khách thật mới đăng ký được.

## 6. Đổi release và khởi động lại
```bash
ln -sfn /opt/11ship/releases/<sha> /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
systemctl restart 11ship-staging && sleep 3
journalctl -u 11ship-staging -n 40 --no-pager      # phải có dòng khởi động; lỗi cấu hình chỉ nêu TÊN biến
curl -fsS http://127.0.0.1:3000/v1/health/ready
```
Dịch vụ không khởi động được: sửa đúng biến được nêu tên rồi `systemctl reset-failed 11ship-staging` (xem runbook gốc mục 6). Nếu cần quay lại ngay: mục 9.

## 7. SMS Gateway
Dùng đúng `ops/runbooks/sms-gateway.md` (ghép cặp một lần bằng `npm run sms-gateway:ctl -- pair --label <tên>`, `enable`, kiểm tra heartbeat). Công cụ này dùng shell operator (mục 3). Cài APK Gateway mới (`SMS Gateway APK`) đè bản cũ; ô địa chỉ VPS được điền sẵn từ `config/endpoints.json`. Gateway chưa online → API trả 503 trung thực, không bypass OTP.

## 8. Kiểm tra sau triển khai (ghi lại kết quả thật; mục nào chưa chạy ghi **CHƯA KIỂM**)
```bash
curl -fsS https://103.9.78.67.sslip.io/v1/health/ready
curl -fsS https://103.9.78.67.sslip.io/v1/client-auth/config      # phải 200 {"data":{"registration_verification":"REQUIRED"}}; trước đây 404
curl -fsS https://103.9.78.67.sslip.io/v1/account-recovery/config # {"data":{"mode":"SMS_OTP"}}
curl -sI https://103.9.78.67.sslip.io/ | head -3
journalctl -u 11ship-staging --since '10 min ago' --no-pager | grep -ciE 'password|secret|token'   # nên là 0
```
Thử thật (cần người và máy thật): đăng ký bằng SMS OTP (số trong allowlist) từ APK Food/Ship mới; đăng nhập SĐT+mật khẩu (không gửi OTP); quên mật khẩu USER và ADMIN bằng OTP; Admin đăng nhập + TOTP; tạo lời mời → kích hoạt có OTP qua Gateway; hồ sơ cá nhân; khóa/mở USER. Admin/SYSTEM giữ TOTP; SYSTEM khôi phục theo công cụ riêng trên máy chủ.

## 9. Rollback (chỉ mã, khi schema tương thích)
```bash
ln -sfn /opt/11ship/releases/75a0a2938dc89418970dc4e1bbf16f8094a1c586 /opt/11ship/current.new && mv -T /opt/11ship/current.new /opt/11ship/current
cp /var/backups/11ship/staging.env.<thời-điểm> /etc/11ship/staging.env     # chỉ khi cần quay lại cấu hình staging cũ
systemctl restart 11ship-staging && curl -fsS http://127.0.0.1:3000/v1/health/ready
```
Release cũ không biết 4 migration mới: operator cũ sẽ từ chối “migration lạ”, nhưng dịch vụ cũ vẫn đọc được các bảng cũ (các thay đổi chỉ thêm bảng/nới CHECK). Schema lỗi → **sửa tiến bằng migration mới**, không `down`. Phục hồi dữ liệu: restore bản `pg_dump` vào database riêng, kiểm tra, rồi mới quyết định (chưa từng thử trên máy này).

## 10. APK
Workflow **Mobile APK** (cần 4 secret khóa ký bền vững; thiếu thì dừng, không khóa tạm) tạo `11Food-test.apk`, `11Ship-test.apk` với `API_BASE_URL` từ `config/endpoints.json`, `versionCode` = số lần chạy (tăng). Cài đè lên bản đang có (cùng applicationId + cùng khóa ký → giữ dữ liệu, không gỡ app). Chỉ phát hành sau khi Owner duyệt điều khoản.
