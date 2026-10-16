# Runbook — cập nhật VPS với gói M01 cuối (cài đặt OTP, phạm vi tài khoản, vòng đời tài khoản) — 14/10/2026

**Trạng thái: chuẩn bị, CHƯA thực thi trên VPS.** Làm **sau** [vps-production-update-20261014.md](vps-production-update-20261014.md) (cùng quy trình: gói release từ CI, sao lưu, migrate, grant, đổi release, kiểm tra) — hoặc gộp vào cùng một lần cập nhật. Không migrate production khi chưa có bản sao lưu; **không** có “down” trên production: lùi = khôi phục từ sao lưu. Không gửi mật khẩu, khóa, OTP, token hay `.env` qua chat/PR/log.

## 0. Thay đổi so với release đang chạy
| Hạng mục | Chi tiết |
|---|---|
| Migration mới | `1793059200000_account-scope-lifecycle-settings`: thêm cột sinh `account_scope`; đổi ràng buộc SĐT từ `UNIQUE (phone_normalized)` thành `UNIQUE (account_scope, phone_normalized)`; thêm `lock_reason`, `locked_at`; thêm origin `PHONE_UNVERIFIED`; hai bảng `system_settings`, `system_setting_changes`; hàm `app.purge_app_user(uuid)`. Không xóa/sửa dữ liệu hiện có (khóa cũ → `VIOLATION`). Viết lại cả bảng `users` do cột sinh: khóa bảng ngắn. Nếu còn migration cũ chưa áp, `db-migrate-remote` áp theo thứ tự. |
| Grant runtime | `02-runtime-grants.sql`: thêm `system_settings` (SELECT, INSERT, UPDATE), `system_setting_changes` (SELECT, INSERT). **Mới:** `03-runtime-function-grants.sql` (EXECUTE trên `app.purge_app_user`). Runtime **không** được thêm DELETE trên bảng nào. |
| Env | Không biến mới. Cần `ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED=true` (đã có trong mẫu production) để khóa/xóa/mở khóa hoạt động; `ACCOUNT_RECOVERY_MODE=SMS_OTP` + `SMS_GATEWAY_ENABLED=true` để khôi phục tài khoản khóa và đặt lại mật khẩu có OTP. |
| Không đổi | nginx, chứng chỉ, PostgreSQL, tên service/user/thư mục, khóa ký APK |
| Giá trị mặc định | Không có hàng cài đặt → cả hai công tắc **Bật** (OTP bắt buộc) ngay sau migrate. |

## 1. Sao lưu (bắt buộc)
```bash
sudo -u postgres pg_dump -Fc ship11_staging > /var/backups/11ship/ship11_staging-$(date -u +%Y%m%dT%H%M%SZ).dump
```

## 2. Migrate và grant (từ release MỚI, shell operator — như runbook cập nhật gốc, mục 3)
```bash
set -a; . /root/ship11-secrets/operator.env; set +a
cd /opt/11ship/releases/<sha>
node scripts/db-migrate-remote.js              # chỉ đọc: liệt kê migration pending; phải gồm 1793059200000_account-scope-lifecycle-settings
node scripts/db-migrate-remote.js --apply
sudo -u postgres psql -d ship11_staging -v ON_ERROR_STOP=1 -f ops/selfhosted/02-runtime-grants.sql
sudo -u postgres psql -d ship11_staging -v ON_ERROR_STOP=1 -f ops/selfhosted/03-runtime-function-grants.sql
```
Kiểm tra quyền tối thiểu:
```bash
sudo -u postgres psql -d ship11_staging -c "SELECT has_table_privilege('ship11_app','app.users','DELETE') AS users_delete, has_function_privilege('ship11_app','app.purge_app_user(uuid)','EXECUTE') AS purge_exec, has_function_privilege('public','app.purge_app_user(uuid)','EXECUTE') AS purge_public;"
# phải ra: f | t | f
sudo -u postgres psql -d ship11_staging -c "SELECT account_scope, account_origin, count(*) FROM app.users GROUP BY 1,2 ORDER BY 1,2;"
# SYSTEM/ADMIN → ADMIN_WEB + ADMIN_PROVISIONED; mọi tài khoản ứng dụng → APP_USER
```

## 3. Đổi release và khởi động lại
Như runbook gốc mục 6 (`ln -sfn ... current`, `systemctl restart 11ship-staging`, kiểm `health/ready`).

## 4. Kiểm tra sau triển khai (ghi kết quả thật; mục nào chưa chạy ghi **CHƯA KIỂM**)
```bash
curl -fsS https://103.9.78.67.sslip.io/v1/client-auth/config          # {"data":{"registration_verification":"REQUIRED"}}
curl -fsS https://103.9.78.67.sslip.io/v1/account-recovery/config     # {"data":{"mode":"SMS_OTP"}}
curl -fsS https://103.9.78.67.sslip.io/v1/account-recovery/locked/config   # {"data":{"mode":"SMS_OTP"}}
curl -fsS https://103.9.78.67.sslip.io/v1/admin-recovery/config       # {"data":{"mode":"SMS_OTP"}}
```
Trong Admin Web (SYSTEM): mở **Cài đặt hệ thống**, đổi một công tắc, Lưu, rồi `curl .../v1/client-auth/config` thấy đổi ngay. Đặt lại **Bật** cả hai sau khi thử. ADMIN (không SYSTEM) không thấy mục này.
Thử xóa/khóa bằng **tài khoản thử do Owner chỉ định**, không dùng tài khoản thật; xác nhận hộp thoại nói đúng “xóa vĩnh viễn” hay “chuyển khóa”.

## 5. APK
Gói này đổi `mobile/packages/n11_shared`; cần chạy workflow `Mobile APK` (Food, Ship) để có bản có đăng ký không OTP / khôi phục tài khoản. Giữ khóa ký và `applicationId`; `versionCode` tự tăng.
