# M13 — Vận hành, cảnh báo & cập nhật hệ thống: triển khai (23/10/2026)

Thiết kế đã duyệt giữ nguyên (không sửa tài liệu thiết kế). Nhãn hàng đợi OTP theo văn bản: **"Đăng ký / Quên mật khẩu"**. Thuật ngữ: "shipper". Tài liệu này ghi **trạng thái triển khai** và **phần chưa kích hoạt**; không khẳng định VPS đã chạy M13.

## 1. Đã làm (code + test)

| Gói | Nội dung | Vị trí chính |
|---|---|---|
| A | Sự kiện/nhật ký append-only, làm sạch dữ liệu nhạy cảm, bản sao audit ADMIN, lưu giữ cấu hình được | `apps/backend/src/ops/*`, migration `1795737600000_create-m13-ops.sql` |
| B | Giám sát Gateway (nhịp, pin, sạc, SIM, kết quả chưa báo, hàng đợi); số dư SIM luôn "Chưa xác định" | `ops-monitors`, `sms-gateway/*` |
| C | Giám sát máy chủ (tiến trình, DB, ổ đĩa, RAM/CPU, HTTPS, backup, M14) | `ops-collector`, `ops-system-probe` |
| D | Sự cố NEW→ACKNOWLEDGED→IN_PROGRESS→RECOVERED→CLOSED, gộp theo fingerprint, leo thang, nhắc, bảo trì theo phạm vi, tạm hoãn; Discord (webhook mã hóa, allowlist host, không mention, retry/429) | `ops-engine`, `ops-discord` |
| E | Probe độc lập (Node thuần), khóa máy (băm, phạm vi PROBE/BACKUP/DEPLOY), `ops:ctl`, `scripts/ops-report.mjs` | `ops/external-probe`, `scripts/` |
| F | Nhận lỗi từ app (≤50 mục/lô, 300/giờ/tài khoản, khử trùng), báo phiên bản | `/v1/ops/client/*` |
| G | Phát hành và cập nhật: kiểm tra, tải, SHA-256; Gateway chỉ cập nhật khi rảnh | `ops-release-repository`, `ops-gateway-update`, `/v1/app-updates/*` |
| H | Admin Web 6 màn: Tổng quan, Sự cố, SMS Gateway, Nhật ký, Phiên bản & cập nhật, Cấu hình | `apps/admin-web/src/dom/ops-view.ts` |
| Mobile | Gateway: telemetry + cập nhật khi rảnh (Kotlin/Flutter). 11Food/11Ship: kiểm tra phiên bản, banner/màn bắt buộc, tải + SHA-256 + trình cài đặt, báo phiên bản, hàng đợi lỗi offline (giới hạn, làm sạch, khử trùng, thử lại có giới hạn) | `mobile/gateway`, `mobile/packages/n11_shared/lib/src/m13`, `mobile/tool/android-templates` |

Quyền: SYSTEM thấy tất cả; ADMIN chỉ khi SYSTEM cấp (xem/xử lý), server quyết định lại mỗi lệnh. Mọi thời gian dùng đồng hồ DB. UNKNOWN/NO_DATA/STALE không bao giờ hiện xanh; câu chữ bằng chứng không nêu nguyên nhân.

## 2. Quyết định kỹ thuật
- Timestamp migration `1795737600000` đặt sau migration mới nhất của main (`1795651200000`); timestamp cũ `1794268800000` trùng `create-m10-orders`. Chưa từng áp dụng ở đâu nên đổi tên an toàn. Không sửa migration đã áp dụng.
- Quyền runtime `ops_*` nằm trong `02-runtime-grants.sql`, `04-check-runtime-grants.sql` và bảng quyền trong runbook (có test đối chiếu).
- Cập nhật Android: ứng dụng KHÔNG cài âm thầm; chỉ mở trình cài đặt Android sau khi kích thước và SHA-256 khớp. Cần quyền `REQUEST_INSTALL_PACKAGES` (đã thêm vào danh sách cho phép kiểm tra APK). applicationId và khóa ký giữ nguyên.
- Shipper đang có đơn: cập nhật BẮT BUỘC chỉ hiện banner; màn chặn chỉ xuất hiện khi không có giao hàng đang chạy (không đọc được = coi là bận).
- Cùng tồn tại với "Nhật ký lỗi" (PR #158, menu Giám sát, SYSTEM): đó là nhật ký lỗi HTTP của server trong RAM/tệp; M13 là hệ sự kiện/sự cố trong DB. Không dùng chung bảng hay route.

## 3. Không làm / chưa kích hoạt
- **Không có nút triển khai máy chủ** (quyết định Owner). Chỉ ghi lịch sử triển khai + health check qua `ops-report.mjs`. Thiếu: chạy/rollback deploy từ giao diện, và chỗ gọi báo cáo trong cron/CI.
- Chưa kích hoạt (cấu hình sau, không chặn PR): webhook Discord, máy probe + webhook probe, `OPS_ARTIFACT_DIR`, khóa PROBE/BACKUP/DEPLOY.
- Firebase/FCM: hoãn theo Owner. Số dư SIM: không đọc.
- Báo lỗi từ app: đã nối CRASH (Flutter/platform); `ACTION_ERROR/PUSH_ERROR/MAP_ERROR/ROUTE_ERROR/GPS_STALE` có API `OpsClient.record(...)` sẵn nhưng **chưa gắn vào từng luồng** (ngoài phạm vi gói này).
- Không merge, không deploy, không chạy migration production.

## 4. Kiểm tra (xem báo cáo bàn giao cho kết quả theo SHA)
Unit (`npm run test:unit`), tích hợp (`npm run test:integration`, PG16 cục bộ; CI dùng PG17/Node 24), Admin Web (`admin-web:test`), probe (`ops-probe:test`), deploy (`deploy:test`). Flutter/Kotlin chỉ chạy được trên CI (máy phát triển không có SDK): `mobile-apk.yml`, `sms-gateway-apk.yml` (gồm `testDebugUnitTest`).

Runbook: `ops/runbooks/m13-vps-operations-20261023.md`, `m13-sms-gateway-20261023.md`, `m13-external-probe-20261023.md`, `m13-backup-deploy-reporter-20261023.md`. Mẫu cấu hình: `ops/vinahost/ops.env.example`. Checklist Owner: `M13-owner-checklist-20261023.md`.
