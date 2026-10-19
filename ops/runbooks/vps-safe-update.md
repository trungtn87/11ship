# VPS production: chẩn đoán Android 503 và cập nhật giữ trạng thái

Task 19/10/2026: **chỉ chuẩn bị PR; chưa merge, deploy, đổi env, refresh hay migrate production**.
Tài liệu này thay các bước cập nhật/rollback thủ công trong runbook 14/10; giữ nguyên topology hiện tại.

## Bằng chứng và giới hạn nguyên nhân 503

Báo cáo Owner: `POST /v1/client-auth/device/registrations`, `SERVICE_UNAVAILABLE`,
request `76a79b05-3b33-4ae7-b5b0-cb5a9fa25795`, SHA báo cáo `d5fefc69572c7a83c80d9dd8929bcc417df7e011`.
**Chưa xác minh SHA/service/env/file/timer/clock thực tế trên VPS. Chưa kết luận nguyên nhân production.**
Workspace không có SSH identity hay TCP grant tới `103.9.78.67`; proxy không kết nối được. Không thử vượt network policy.
Không có thiết bị Android thật. Không gọi đăng ký/OTP thật và không báo “login đã hoạt động”.

Bằng chứng code đã kiểm:

- `ClientDeviceService` từ chối Android khi thiếu `CLIENT_DEVICE_TRUST`; `currentSnapshot()` trả unavailable khi đọc/parse lỗi, tuổi >24h hoặc timestamp đi trước >5 phút.
- `parseClientDevice()` kiểm hai package cố định `vn.eleven.food.test`, `vn.eleven.ship.test`, cùng signer bền vững, PEM pinned. Không có accept-all/fallback.
- Refresh đã ghi temp + rename, unit trong repo trỏ `/opt/11ship/current/scripts/android-attestation-refresh.mjs`, không pin SHA.
- Repo trước task chưa có lệnh deploy tự động hoặc kiểm snapshot freshness sau deploy. Điều này giải thích vì sao health/Admin 200 **có thể bỏ sót** lỗi; không chứng minh lỗi thực tế là snapshot quá hạn.

Chạy khối **chỉ đọc** dưới đây ở shell VPS từ checkout PR đã review (đường dẫn checkout phải cho `ship11` đọc; không đặt dưới `/root`). Không gửi mật khẩu/env/raw journal vào chat:

```bash
cd /opt/11ship-review
sudo python3 -B scripts/deploy/vps-diagnose.py
```

Chẩn đoán lấy `MainPID`, cwd/RELEASE thực, UTC/NTP, trạng thái/lần chạy timer, metadata snapshot và thử CLI với **env/UID/GID/groups của process đang chạy**. Chỉ in fingerprint chứng thư công khai, tuổi snapshot, đường dẫn và bộ đếm log; không in khóa/URL DB/raw log. Dùng parser/guard của release đang chạy, kể cả release chưa export `currentSnapshot` (kiểm verifier với chain rỗng, chỉ chấp nhận lỗi `DEVICE_PROOF_INVALID` sau freshness guard). Với filesystem namespace riêng, phải chạy kiểm tra thêm trong namespace ứng dụng; updater từ chối RootDirectory/RootImage khác.

Đối chiếu tại VPS: signer fingerprints với artifact `android-signers.json` của APK đang cài; roots với nguồn Google đã pin; kiểm SHA/service/config production đúng. Nếu snapshot hết hạn, xác minh lỗi timer/network/script/permission bằng journal **tại máy**, sửa đúng nguyên nhân rồi refresh bằng nguồn Google; không đổi quy tắc 24h. Ghi kết quả đã che bí mật vào PR trước khi Owner duyệt triển khai. Nếu báo cáo không khớp các nhánh này, tiếp tục theo request ID; không đoán nguyên nhân.

## Trạng thái bền vững

- Code `/opt/11ship/releases/<40-hex-sha>`; `current`/`previous` là symlink nguyên tử.
- Giữ `/etc/11ship/staging.env` (tên lịch sử, APP_ENV phải production), DB CA, trust và FCM hiện có tại `/etc/11ship/`. Không chép `.env.example` đè file thật.
- Giữ `CRYPTO_*` gồm toàn bộ keyring lịch sử, OTP/limiter keys và APK signer. Lệnh cập nhật không sửa env/keys.
- Snapshot hiện có `/etc/11ship/trust/android-attestation-revocation.json` đã ở ngoài release; **giữ vị trí**, không chuyển chỉ để đổi tên. Refresh root:ship11, mode 0640; app chỉ đọc.
- PostgreSQL giữ `ship11_staging`, roles/CA/URLs hiện có. Ảnh menu hiện được lưu qua repository/database; không chuyển DB sang filesystem. Upload khác nếu có phải dùng đường dẫn shared đang vận hành, ngoài release (ví dụ `/var/lib/11ship/`); bổ sung đúng `ReadWritePaths` cho app nếu dùng filesystem dưới ProtectSystem=strict.
- Nếu phát hiện dữ liệu/config nằm trong release: dừng thiết lập, sao chép bằng `cp -a` ra shared, kiểm `cmp`/checksum và quyền đọc bằng user `ship11`, backup env rồi đổi từng đường dẫn. Không xóa bản gốc. Updater không tự di chuyển hay đoán dữ liệu.

## Thiết lập lần đầu — chỉ sau Owner duyệt thực thi riêng

Ubuntu 24.04, Node theo `.node-version`, Python >=3.12, GNU tar, curl, pg_dump/pg_restore cùng major PostgreSQL đang dùng; chạy root. Xác minh service thật trước; updater mặc định **từ chối** topology khác thay vì tự đổi tên.

Sau chẩn đoán, từ checkout/artifact đã xác minh (không chạy đoạn này trong task chuẩn bị PR):

```bash
sudo install -d -m 755 -o root -g root /opt/11ship/tools
sudo install -m 644 scripts/deploy/{vps-update.py,vps-diagnose.py,android-readiness.cjs} /opt/11ship/tools/
sudo install -m 644 ops/vinahost/11ship-attestation-refresh.{service,timer} /etc/systemd/system/
sudo install -m 644 ops/vinahost/11ship-auth-readiness.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 11ship-attestation-refresh.timer 11ship-auth-readiness.timer
```

Unit refresh dùng `current`, monitor dùng tools cố định và đọc module qua `current`; không phụ thuộc release bị dọn.
Monitor chạy mỗi giờ, fail từ 18h để báo sớm qua journal/failed unit; verifier vẫn giữ ngưỡng 24h. Timer calendar + Persistent bắt lịch bị lỡ sau reboot, OnBootSec chạy bổ sung. Nếu có hệ thống cảnh báo vận hành, theo dõi failed unit của hai service này; repo không tự gửi thông báo ra ngoài.
Tools không chứa bí mật. `/root/ship11-secrets/operator.env` tiếp tục là credential migrator riêng, có guard đích/role/TLS của `db-migrate-remote.js`. Nó được systemd đọc trước env runtime; DATABASE_URL/crypto/trust của runtime luôn ưu tiên. Chỉ chấp nhận production SELF_HOSTED, không cho chọn nhầm database bên ngoài. Đối chiếu hai file tại máy trước thiết lập. Không source env vào shell có `set -x`.

## Một lệnh cập nhật thường xuyên

```bash
sudo python3 -B /opt/11ship/tools/vps-update.py update /path/11ship-<SHA>-ubuntu24-amd64.tar.gz <SHA>
```

SHA đầy đủ đã review, archive và `.sha256` cùng thư mục. Dùng artifact CI đã xác minh nguồn; checksum không thay thế việc tin cậy nguồn phát hành.

Lệnh giữ flock; kiểm service/user/envfile, checksum, archive paths/types, dung lượng, RELEASE và mọi manifest checksum; giải nén riêng, không overwrite release. Không nhận symlink/hardlink/special file trong archive. Khởi động refresh/timer; kiểm config thật, Android trust/snapshot (UID ship11), TLS DB của cả code cũ và mới; preflight migration bằng tool hiện có. Sau đó chuyển symlink, restart, kiểm HTTPS health/client-auth config/Admin và CLI nội bộ. Không có migration thì không chạy apply/grants/backup/seed/reset.

Migration pending mặc định **dừng trước backup/apply**. Reviewer phải xác nhận migration không phá tương thích code hiện tại, bảo toàn dữ liệu, rồi ghi tên migration → SHA256 **nội dung file** tại `/etc/11ship/migration-compatibility.json` (root-owned, không app-write). Không có blanket allow. Migration không tương thích phải tách sang kế hoạch maintenance/expand-contract được Owner duyệt, không dùng lệnh này. Với hash hợp lệ: dump `-Fc`, fsync, kiểm TOC và giải nén toàn archive bằng pg_restore, rồi mới apply bằng guard hiện có và cấp grants. Backup quyền 0600 ngoài release. Kiểm archive không phải diễn tập restore; định kỳ thử restore vào DB riêng và sao lưu off-VPS theo chính sách vận hành.

Nếu migration lỗi: dừng, giữ code cũ; không tự down/restore. Nếu restart/health/probe lỗi sau chuyển: tự chuyển lại code cũ, restart và kiểm lại; nếu rollback cũng lỗi thì báo thất bại, không giả báo thành công. Release lỗi vẫn giữ để chẩn đoán; retry dùng artifact/SHA mới hoặc xử lý release chưa chạy tại máy, không overwrite tự động.

## Một lệnh rollback code

```bash
sudo python3 -B /opt/11ship/tools/vps-update.py rollback
```

Chỉ dùng `previous` có record tương thích do updater ghi; kiểm DB còn khớp release hiện tại, kiểm config/snapshot/DB trước rollback và kiểm HTTPS/CLI sau rollback. Không chép env cũ đè env production, không mất keyring lịch sử, không phục hồi DB. Thay đổi schema từ công cụ khác cần đánh giá tương thích riêng. **Restore DB là quyết định khác**, có nguy cơ mất giao dịch mới: phục hồi backup vào DB riêng, đối soát rồi Owner quyết định; updater không có lệnh restore.

Dọn code (tùy chọn, không nằm trong cập nhật): `sudo python3 -B /opt/11ship/tools/vps-update.py prune`. Giữ current/previous, chỉ xét thư mục SHA trực tiếp; từ chối mount, link bên trong, file sửa hoặc file ngoài manifest. Không đụng shared/config/backup. Release cũ tên khác hoặc thiếu manifest giữ nguyên để kiểm thủ công.

## Kiểm thử task

Các regression: thiếu/quá hạn/lệch giờ/gần hết hạn snapshot, sai package, trust disabled; refresh tải lỗi/JSON lỗi/stream quá lớn giữ file cũ, ghi nguyên tử và concurrent refresh; deploy không migration không apply; backup lỗi không migrate; migration chưa duyệt bị chặn; health lỗi rollback và kiểm lại; cleanup giữ shared/current/previous và từ chối uploads trong release; archive traversal/link bị chặn.

Chạy `npm run build`, `npm run deploy:test`, `npm run lint`, `npm run typecheck`; Python regression tự nằm trong deploy:test. Chi tiết kết quả thực và giới hạn sandbox ghi ở PR. Chưa kiểm systemd/HTTPS/DB thật hoặc login trên thiết bị; cần môi trường VPS/Android để nghiệm thu phần đó. Không có migration mới trong PR này.
