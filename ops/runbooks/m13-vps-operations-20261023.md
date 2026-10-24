# M13 — Vận hành trên VPS (runbook)

Phạm vi: bật M13 trên VPS thật. **Chưa có bước nào ở đây được chạy; merge/build không chứng minh VPS đã cập nhật.** Cần quyền triển khai riêng.

## 1. Trước khi triển khai
1. Sao lưu DB theo [database-backup-restore-guidance.md](database-backup-restore-guidance.md).
2. Migration M13 là `1795737600000_create-m13-ops.sql` (15 bảng `ops_*`, thuần thêm mới, không đụng bảng nghiệp vụ). Chạy bằng tài khoản migrator như [vps-production-update-20261014.md](vps-production-update-20261014.md), không dùng tài khoản runtime.
3. Chạy `ops/selfhosted/02-runtime-grants.sql` (đã có quyền `ops_*`) rồi `04-check-runtime-grants.sql` (chỉ đọc) phải báo OK.

## 2. Cấu hình
- Thêm các biến `OPS_*` từ `ops/vinahost/ops.env.example` vào `/etc/11ship/staging.env` (tùy chọn từng biến).
- `OPS_ARTIFACT_DIR`: tạo thư mục, chủ sở hữu là user dịch vụ, quyền đọc; đặt tệp APK vào đó, rồi đăng ký trong Admin Web (Phiên bản & cập nhật) — hệ thống đo kích thước và SHA-256 lúc đăng ký.
- Restart dịch vụ bằng quy trình hiện có. Bộ thu thập chạy cùng tiến trình (tắt bằng `OPS_COLLECTOR=off`).

## 3. Kiểm tra sau khi bật
- Admin Web (SYSTEM) › Vận hành hệ thống › Tổng quan: mỗi ô hiện mức thật hoặc "Chưa có dữ liệu / Chưa cấu hình"; không có ô nào xanh khi chưa đo.
- Cấu hình › Gửi thử Discord (sau khi nhập webhook) phải báo kết quả thật.
- Cấp quyền ADMIN: Cấu hình › Quyền Vận hành (mặc định ADMIN không thấy gì).

## 4. Dữ liệu và lưu giữ
- Nhật ký/metrics có lưu giữ cấu hình được (Cấu hình); tiến trình dọn chạy theo lịch trong dịch vụ, chỉ xóa hàng `ops_*` hết hạn.
- `ops_events` chỉ thêm (trigger chặn UPDATE/TRUNCATE); XÓA chỉ qua lượt dọn.

## 5. Chưa có / không làm
- Không có nút triển khai máy chủ trong Admin Web (quyết định Owner). M13 chỉ **ghi lịch sử triển khai và health check** do quy trình hiện có báo qua `scripts/ops-report.mjs` (xem [m13-backup-deploy-reporter-20261023.md](m13-backup-deploy-reporter-20261023.md)). Thiếu: tự chạy deploy/rollback từ giao diện.
- Số dư SIM không đọc được: luôn "Chưa xác định".
- Firebase/FCM chưa dùng (Owner hoãn).
