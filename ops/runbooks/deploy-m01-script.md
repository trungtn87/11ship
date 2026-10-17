# Script `scripts/deploy/deploy-m01.ps1` — triển khai M01 lên VPS từ Windows PowerShell

Tự động hóa các mục 1, 2, 3 và 6 của [vps-production-update-20261014.md](vps-production-update-20261014.md) qua `ssh`/`scp` của Windows (không cần console VinaHost). **Chưa chạy trên VPS thật** (CHƯA KIỂM); chạy `-DryRun` trước.

## Chuẩn bị
- Windows 10/11 có OpenSSH Client; đã `ssh root@103.9.78.67` thủ công ít nhất một lần để lưu host key. Mặc định script dùng `BatchMode` (cần khóa SSH); nếu chưa có khóa thêm `-AllowPassword` (sẽ hỏi mật khẩu nhiều lần).
- Tải artifact CI `11ship-<sha>-ubuntu24-amd64.tar.gz` và `.sha256` về cùng thư mục.
- Những việc **script không làm** (làm trước, theo runbook): sửa `/etc/11ship/staging.env` sang `APP_ENV=production` (mục 5), đặt 3 file tin cậy Android trong `/etc/11ship/trust/` (mục 4), đổi `APP_ENV` trong `/root/ship11-secrets/operator.env` (mục 3), ghép cặp SMS Gateway (mục 7), phát hành APK (mục 10). Thiếu những thứ này, bước kiểm tra trước sẽ dừng và nói rõ thiếu gì.

## Chạy
```powershell
# 1) Chỉ kiểm tra, không đổi gì trên VPS
.\scripts\deploy\deploy-m01.ps1 -Package .\11ship-<sha>-ubuntu24-amd64.tar.gz -DryRun

# 2) Tải lên + sao lưu + migrate/grant + đổi release + restart + health check
.\scripts\deploy\deploy-m01.ps1 -Package .\11ship-<sha>-ubuntu24-amd64.tar.gz -Migrate
```
Tham số: `-VpsHost`, `-User`, `-Port`, `-IdentityFile`, `-Origin` (mặc định `https://103.9.78.67.sslip.io`), `-ExpectedSha`, `-Migrate`, `-DryRun`, `-AllowPassword`, `-Yes` (bỏ câu hỏi xác nhận).

## Các bước và điểm dừng
1. Local: tên gói đúng mẫu, khớp `.sha256`. VPS (chỉ đọc): root, node, `pg_dump`, `current` là symlink, còn ≥ 1 GB, `staging.env` có `APP_ENV=production`, đủ 3 file tin cậy, (với `-Migrate`) `operator.env` có `APP_ENV=production`. Chỉ kiểm tra tên/tồn tại, không đọc giá trị bí mật.
2. Tải lên `/root/11ship-upload`, `sha256sum -c`, giải nén vào `/opt/11ship/releases/<sha>`, so `RELEASE.json`.sha. `current` chưa đổi.
3. Sao lưu `pg_dump -Fc` và `staging.env` vào `/var/backups/11ship` (quyền 600). Hãy chép ra ngoài VPS.
4. Chỉ với `-Migrate`: liệt kê migration pending → **hỏi xác nhận** → `--apply` → grant (`02`, và `03` nếu có). Lỗi thì dừng, không tự reset.
5. **Hỏi xác nhận** → đổi `current` nguyên tử, `systemctl restart 11ship-staging`, thăm dò `127.0.0.1:3000/v1/health/ready` tối đa ~30 giây. Thất bại: in 40 dòng log, **tự quay lại release trước** (chỉ mã; schema đã migrate không được hoàn lại — xem runbook mục 9).
6. Kiểm tra công khai `/v1/health/ready`, `/v1/client-auth/config`, `/v1/account-recovery/config` từ máy Windows.

Release cũ vẫn nằm trong `/opt/11ship/releases`; script không dọn.
