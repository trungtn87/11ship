# M12 — Trạng thái triển khai thực tế (Web Admin: quản trị, điều hành, báo cáo)

Đặc tả: [M12-spec-20261016.md](M12-spec-20261016.md). Tài liệu này ghi **những gì thực sự đã làm và đã kiểm chứng**, và những gì **chưa**. Có giao diện không có nghĩa là có chức năng; từng gói ghi rõ số liệu lấy từ đâu.

**Ảnh UI thiết kế M12 không có trong repo** → giao diện làm theo shell/brand hiện có và bố cục trong đặc tả. **Chưa đối chiếu được ảnh; không tự nhận khớp ảnh.** Ảnh chụp màn hình thật (Chrome thật, 1440×900 và 390 rộng) nằm ở `docs/evidence/m12/`.

Phạm vi bàn giao này: **chưa merge, chưa deploy, chưa chạy migration trên production, chưa đổi cấu hình production, không restore production.**

## 1. Trạng thái theo gói

| Gói | Trạng thái | Ghi chú trung thực |
|---|---|---|
| A Tổng quan | Làm xong, có test | Số liệu: Order (M10), delivery (M07), ví/hoa hồng/nạp/rút (M04), phản ánh chưa xử lý (M11), shipper/quán. Từng số có trạng thái OK / FORBIDDEN / NOT_READY / ERROR, lỗi đọc **không bao giờ hiện là 0**. Duy nhất còn `NOT_READY`: "hồ sơ quán chờ duyệt" (M02 không có bước duyệt hồ sơ quán; ghi rõ lý do trên màn). |
| B Điều hành | **Chưa hoàn tất bản đồ.** Danh sách + chi tiết delivery xong | Danh sách/lọc/tìm/phân trang/drawer chi tiết dùng dữ liệu M07 thật. **Bản đồ: chỉ là sơ đồ tọa độ tạm** (SVG các tọa độ thật `shipper_latest_locations`). Repo không có thành phần nền bản đồ web (M14 là Android); **không tính là đã xong bản đồ điều hành**. Trạng thái "GPS cũ / chưa có vị trí" tách bạch. |
| C ADMIN & phân quyền | Làm xong, có test | Ma trận Xem/Xử lý/Xuất; SYSTEM đổi quyền (CAS theo fingerprint), khóa/mở, thu hồi phiên; ADMIN không tự nâng quyền. Quyền rút tiền (`wallet.withdrawal.*`) có trong ma trận. |
| D Cấu hình tập trung | Làm xong, có test | Đọc từ module sở hữu; ghi chỉ qua route của module sở hữu (thêm `reason` tùy chọn); lịch sử lấy từ audit; hoàn nguyên = thay đổi mới. Hoa hồng hiển thị theo chính sách có phiên bản (sửa ở Tài chính). Nhóm "Lưu trữ và sao lưu" hiện quy tắc cố định. |
| E Báo cáo + xuất | **Làm xong** (backend + màn hình web + test) | 5 báo cáo (giao hàng, quán, shipper, chất lượng, tiền & đối soát); mốc thời gian ghi rõ; tỷ lệ ghi tử/mẫu; Order tính riêng delivery; tiền hàng/phí ship/nạp ví **không** là doanh thu nền tảng; hoa hồng/hoàn/điều chỉnh/rút từ sổ cái M04. Xuất CSV/XLSX bằng job nền, tạo bằng POST, kiểm quyền lúc tạo/chạy/tải, chỉ người tạo tải, hạn 24 giờ, chống công thức bảng tính, giới hạn 3 job mở và 20 000 dòng (vượt thì job FAILED, không trả file thiếu). |
| F Nhật ký, sao lưu, phục hồi | **Phần ứng dụng + script + diễn tập cục bộ xong; chưa chạy trên VPS** | Xem mục 4. Chưa có lịch sao lưu trên VPS, chưa có kho ngoài VPS, chưa restore production (không được phép). |

## 2. Thay đổi theo chỉ đạo Owner

- **OTP nhập sai tối đa 3 lần** (Owner chốt): mặc định trong `auth-config.ts`, `.env.example`, `docs/tasks/M01-A1-auth-core.md`, fixture test và các test liên quan được đồng bộ. **Không đổi cấu hình production**: máy chủ đang chạy với giá trị trong `.env` của nó; muốn áp dụng 3 lần phải đặt/kiểm `AUTH_OTP_MAX_ATTEMPTS=3` ở đó (việc của người triển khai).
- **Đồng bộ main mới nhất**: đã merge `main` (M10 đơn hàng, M11 đánh giá/phản ánh, M04-C rút tiền, chính sách hoa hồng có phiên bản, timeout đơn, giám sát lỗi, phiên mật khẩu). Đã kiểm tra thay vì kết luận "chưa có": tổng quan và báo cáo **dùng số liệu thật** của Order, rút tiền và phản ánh.
- **Bốn lỗi `deploy:test`** (attestation Android, parity DB từ xa, env template, production env template): đã tái hiện trên mã gốc khi chạy Node 22. Chạy lại bằng **Node 24.21.0** (đúng `.nvmrc`/`engines`) sau `npm run build`: **240/240 pass**. Ghi nhận riêng: lỗi do môi trường (sai phiên bản Node, thiếu bản build), không do M12.

## 3. Migration (chưa chạy trên production)

Cả hai chỉ thêm bảng mới, không sửa/xóa gì đã có:

1. `1795910400000_create-m12-report-exports.sql` — `report_export_jobs`, `report_export_files` (job không bao giờ bị xóa: trigger).
2. `1795996800000_create-m12-backup-restore.sql` — `backup_records` (ứng dụng chỉ đọc), `restore_requests` (không bao giờ bị xóa; tối đa một yêu cầu mở nhờ unique index).

Quyền runtime: `ops/selfhosted/02-runtime-grants.sql` (+ `04-check-runtime-grants.sql` và bảng trong `render-supabase-staging.md`, được `tests/deploy/selfhosted-grants.test.mjs` đối chiếu). `audit_logs` được cấp thêm `SELECT` (nhật ký chỉ đọc; vẫn không UPDATE/DELETE). **Trước khi chạy ứng dụng mới trên VPS**: chạy migration bằng quy trình cập nhật VPS hiện có, rồi áp dụng `02-runtime-grants.sql` và kiểm bằng `04-check-runtime-grants.sql`. Chưa làm bước nào trong số đó.

## 4. Gói F — chi tiết

- **Nhật ký** (`/system/audit`, quyền `audit.read`, SYSTEM luôn có): chỉ đọc; lọc theo kỳ (tối đa 92 ngày, giờ Việt Nam), hành động (tiền tố), người thực hiện, đối tượng, kết quả, request id; phân trang bằng cursor; giá trị của khóa trông như bí mật (`password`, `token`, `otp`, `secret`, `key`, `account_number`...) bị che dù ghi nhật ký đã chặn trước; không có route sửa/xóa (POST/PUT/DELETE trả 404; bảng không có UPDATE/DELETE).
- **Sao lưu** (`/system/backups`, chỉ SYSTEM): chính sách cố định (hằng ngày, 7 ngày + 4 tuần, thêm bản trước migration, ngoài VPS, mã hóa); lịch sử đọc từ `backup_records`; **tình trạng trung thực**: `NONE` (chưa có bản đã kiểm chứng), `NOT_OFFSITE` (chỉ nằm trên VPS), `STALE` (quá 26 giờ), `OK` chỉ khi có bản ngoài VPS, đã mã hóa, đã kiểm chứng, còn mới. Database từ chối ghi `SUCCEEDED` nếu thiếu kiểm chứng/mã hóa/kích thước/checksum.
- **Phục hồi**: SYSTEM gửi **yêu cầu** (chọn bản dùng được, xem phạm vi mất dữ liệu, nhập lý do ≥ 10 ký tự, xác nhận); chỉ một yêu cầu mở; idempotent; ghi nhật ký; có thể hủy. **Ứng dụng không bao giờ tự restore**: người vận hành làm theo [runbook](../../ops/runbooks/m12-backup-restore-20261023.md) (khóa ghi → sao lưu trước → diễn tập → khôi phục sang DB mới → migrate → đối chiếu ví/hold/đơn/giao dịch → không phát lại thanh toán/thông báo → mở lại).
- **Script**: `ops/backup/backup.sh` (dump → mã hóa → khôi phục thử vào DB tạm → kiểm tra → ghi kết quả), `restore-rehearsal.sh` (chỉ tạo DB `ship11_restore_*`/`ship11_verify_*` mới, từ chối tên production/staging/test hoặc DB đã tồn tại), `verify.sql`.
- **Diễn tập khôi phục trên DB test** (máy cục bộ, PostgreSQL 16, bản sao DB test + dữ liệu mẫu): [`docs/evidence/m12/restore-rehearsal-20261023.txt`](../evidence/m12/restore-rehearsal-20261023.txt) — sao lưu + khôi phục bản đã mã hóa thành công (audit 500, sổ cái 20, chênh lệch ví–sổ cái 0); từ chối tên production/test/DB đã có; sai passphrase thất bại; nguồn có ví lệch sổ cái bị ghi `FAILED` và không để lại file dùng được. **Chưa chứng minh**: DB thật trên VPS, khối lượng/thời gian thật, kho ngoài VPS, lịch chạy, lưu giữ passphrase, và toàn vẹn tham chiếu của dữ liệu thật (dữ liệu mẫu không có shipper thật phía sau ví).

## 4b. Sao lưu tự động lên Google Drive (24/10/2026)

Owner chốt **Google Drive + rclone, mã hóa trước khi tải lên**. Đã làm (tái sử dụng `ops/backup`, trang sao lưu, runbook và M13; không viết lại): `backup.sh` đóng gói `database.dump` (+ tệp thêm nếu có) + manifest (thời gian, release/commit, schema, thành phần, checksum; không secret) → mã hóa openssl hiện có → khôi phục thử → rclone lên thư mục `11Ship-Backup` → kiểm kích thước + MD5 trên Drive → dọn bản cũ (7 ngày, 4 tuần, 1 bản trước deploy, chỉ tệp đúng mẫu tên, sau khi bản mới đã xác minh) → ghi `backup_records` (các bước `LOCAL/UPLOADED/VERIFIED` tách riêng) → báo M13 (Discord: lỗi một lần, không lặp, quá 26 giờ, phục hồi). Lịch `systemd` 03:00 Asia/Ho_Chi_Minh (`Persistent`, timeout, `flock` chống chạy chồng), bản trước deploy nối vào `vps-update.py` (bắt buộc khi đã cấu hình, cảnh báo rõ khi chưa), job "Sao lưu ngay" (SYSTEM, một job một lúc, `backup-trigger.sh`), diễn tập khôi phục hằng tuần từ Drive, spool giới hạn dung lượng và số lần thử lại. Ảnh quán/món/phản ánh nằm **trong database** (đã kiểm), nên nằm trong dump; không có thư mục upload. Quyền Google, cài đặt, phục hồi từng bước, giới hạn nhất quán: [`ops/runbooks/m12-drive-backup-20261024.md`](../../ops/runbooks/m12-drive-backup-20261024.md). Sửa kèm: test CI "Self-hosted PostgreSQL 17" của PR #180 (`audit_logs` nay được `SELECT` nhưng vẫn cấm UPDATE/DELETE/TRUNCATE).

**Đã kiểm bằng Drive GIẢ (thư mục cục bộ):** logic xác minh, retention không đụng tệp ngoài mẫu, lỗi tải lên không xóa bản tốt, thử lại có giới hạn, chạy chồng, token/passphrase không vào log, quyền SYSTEM/API, cảnh báo không lặp, diễn tập phục hồi từ bản mã hóa vào DB test. **CHƯA kiểm chứng:** tải lên/tải xuống Google Drive thật, quota/hết quyền thật, lịch systemd trên VPS, `systemd-creds` trên VPS, khóa M13 thật, deploy có migration thật. Cần Owner kết nối Drive rồi chạy một vòng upload → tải lại → giải mã → phục hồi DB test (runbook mục 9).

## 5. Kiểm tra đã chạy (Node 24.21.0, PostgreSQL 16 cục bộ)

Mã được kiểm: xem SHA cuối trong báo cáo bàn giao/PR. Đã chạy: `npm run lint`, `npm run typecheck`, `npm run test:unit` (198 suite, 2975 test), `npm run admin-web:test` (24), `npm run deploy:test` sau `npm run build` (240), và `npm run test:integration` đầy đủ sau merge main/M13: 157 suite; các suite lỗi ban đầu (đã sửa và chạy lại đạt) là test cũ lệch theo OTP 3 lần, quyền rút tiền, tổng mã lỗi và danh sách migration. **Còn lại một suite không chạy được cục bộ: `staging-db-upgrade-from-42`**, vì công cụ yêu cầu PostgreSQL ≥ 17 (`SERVER_VERSION`) còn máy cục bộ là 16.15; suite này phải do CI (PostgreSQL 17) xác nhận. Test mới của M12: `m12-overview`, `m12-operations`, `m12-access`, `m12-config`, `m12-reports` (9), `m12-audit-backup` (5), `admin-m12-browser` (6, Chrome thật), `backup-scripts.test.mjs`, unit `report-format`, `vietnam-time`, `overview-api`, `access-api`, `admin-operations-service`. Test E và F được chứng minh phát hiện lỗi cũ bằng đột biến cục bộ (tắt chống công thức, bỏ kiểm quyền tải, bỏ che bí mật, bỏ kiểm SYSTEM → test đỏ). `selfhosted:test` chỉ chạy trong job CI chuẩn bị DB dùng một lần (script từ chối chạy cục bộ), nên chưa chạy cục bộ.

## 6. Cách Owner chạy thử cục bộ

`npm run admin-web:dev` (hoặc đường chạy Web Admin hiện có) với backend kết nối DB test đã migrate; đăng nhập SYSTEM → menu **Tổng quan › Báo cáo**, **Hệ thống › Nhật ký**, **Hệ thống › Sao lưu và phục hồi**, **Cài đặt › Cấu hình tập trung**, **Tài khoản › Phân quyền**. Backup/restore rehearsal: xem runbook, mục "Backup run" (cần `BACKUP_*` và một server tạo được DB tạm).

## 7. Còn thiếu / giới hạn / việc tiếp theo

1. **Bản đồ điều hành** chưa xong (chỉ sơ đồ tọa độ tạm); cần quyết định thành phần nền bản đồ web (M14).
2. **Kho sao lưu ngoài VPS và thông tin truy cập**, **nơi lưu passphrase ngoài VPS**, **lịch chạy** (cron/systemd) và bước `PRE_MIGRATION` trong quy trình cập nhật VPS: cần Owner cung cấp. Đến lúc đó trang sao lưu sẽ báo "Chưa có bản sao lưu" hoặc "Chưa có bản ngoài VPS".
3. "Hồ sơ quán chờ duyệt" vẫn `NOT_READY` vì M02 chưa có bước duyệt.
4. Chưa đối chiếu ảnh thiết kế (không có ảnh).
5. Migration + grants + biến `AUTH_OTP_MAX_ATTEMPTS=3` chưa áp dụng trên VPS; cần phê duyệt triển khai riêng.
6. Chưa có thao tác restore production nào được thực hiện hay cho phép.
