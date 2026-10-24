# M12-F — Sao lưu tự động lên Google Drive (rclone) — 24/10/2026

**Trạng thái: mã, cấu hình mẫu, timer/service và runbook đã xong; kiểm tra tự động và diễn tập cục bộ dùng Drive GIẢ.** Chưa kết nối Google Drive thật, chưa cài gì trên VPS, chưa bật lịch chạy thật. **Chưa kiểm chứng việc tải lên/tải xuống Google Drive thực tế**; làm đúng mục 9 sau khi Owner kết nối để có bằng chứng thật. Nguyên tắc Owner: Google Drive + rclone, **mã hóa trước khi tải lên**, không gửi mật khẩu Google, token hay passphrase qua chat.

Liên quan: [runbook sao lưu/phục hồi M12-F](m12-backup-restore-20261023.md) (trang Web Admin, quy trình yêu cầu khôi phục), [cập nhật VPS an toàn](vps-safe-update.md), M13 (cảnh báo Discord). Bằng chứng diễn tập: [`docs/evidence/m12/drive-backup-rehearsal-20261024.txt`](../../docs/evidence/m12/drive-backup-rehearsal-20261024.txt).

## 1. Cái gì được sao lưu, và dữ liệu đang nằm ở đâu

Đã kiểm tra mã nguồn thay vì giả định: **không có thư mục upload trên VPS**. Ảnh món (`app.menu_images.data bytea`), logo quán (`app.shops.logo jsonb`, base64) và ảnh bằng chứng phản ánh (`app.complaint_attachments.data bytea`) nằm **trong PostgreSQL**; bản `pg_dump` đã chứa chúng. Backend chỉ ghi tệp cho nhật ký lỗi (`json-logger`), không phải dữ liệu cần phục hồi. Nếu sau này có thư mục ảnh thật, đặt `BACKUP_EXTRA_PATHS` (đường dẫn tuyệt đối, cách nhau bằng dấu cách): tệp được đóng tar vào cùng gói, có checksum trong manifest, không cần đổi gì khác. `manifest.json` ghi `storage` cho từng loại ảnh ("database") và danh sách thư mục thêm.

Mỗi gói mã hóa gồm: `database.dump` (pg_dump `-Fc`, **không bao giờ sao chép thư mục dữ liệu PostgreSQL đang chạy**), `files.tar` (nếu có), `manifest.json` (thời điểm, loại, nguồn kích hoạt, release/commit từ `RELEASE.json`, phiên bản schema = migration mới nhất, phiên bản `pg_dump`/server, danh sách thành phần + SHA-256, ghi chú nhất quán). Manifest **không chứa secret** hay dữ liệu khách. Cạnh gói trên Drive có `<tên>.manifest.json` (không mã hóa: tên, loại, kích thước, SHA-256 của gói) để liệt kê/kiểm tra mà không cần passphrase.

**Giới hạn nhất quán (ghi thẳng):** `pg_dump` là một ảnh chụp nhất quán của cả database, kể cả ảnh nằm trong DB. Tệp ngoài DB (`files.tar`) được chép **sau** dump nên không đồng thời tuyệt đối với DB; trong lúc chạy, không chạy tác vụ dọn/xóa ảnh (hiện không có tác vụ nào như vậy). Bản sao không bao gồm `/etc/11ship/*.env`, khóa `CRYPTO_*`, TLS, khóa ký Android: đó là secret, **Owner phải giữ bản riêng** (khóa mã hóa dữ liệu bị mất thì dữ liệu mã hóa trong DB không đọc được dù có bản sao).

`pg_dump` phải **cùng hoặc mới hơn** major của server (PostgreSQL 17 trên VPS → công cụ 17); nếu cũ hơn, lần chạy dừng với `PG_TOOL_OLD` thay vì tạo bản sao không tin cậy.

## 2. Quyền Google thực sự được xin (đọc kỹ)

- Khuyến nghị: scope **`drive.file`** — rclone chỉ thấy/sửa **tệp do chính ứng dụng OAuth này tạo**; thư mục `11Ship-Backup` do rclone tạo nên nằm trong phạm vi. Token **không** đọc được tệp Drive khác của Owner. Đây là giới hạn do Google áp dụng cho scope, không chỉ do tên thư mục.
- Nếu Owner chọn scope **`drive`** (toàn quyền), token đọc/sửa/xóa **mọi** tệp trong Drive; khi đó **thư mục `11Ship-Backup` KHÔNG phải là ranh giới bảo mật**, chỉ là thói quen đặt tên. Việc dọn bản cũ vẫn chỉ xóa đúng tên tệp do tác vụ này tạo (mục 6), nhưng token mất thì kẻ cầm token làm được nhiều hơn thế.
- Dùng **OAuth client riêng** của Owner (Google Cloud Console → bật Drive API → màn hình đồng ý OAuth → *Publish to production*, loại "Desktop app"). Với `drive.file` (scope không nhạy cảm) không cần Google xác minh ứng dụng. **Bắt buộc Publish**: ở trạng thái *Testing*, refresh token hết hạn sau 7 ngày và sao lưu sẽ báo `DRIVE_AUTH` mà không ai biết đến lúc cần. Client ID dùng chung mặc định của rclone hoạt động nhưng bị giới hạn tốc độ và không khuyến nghị.
- Bản sao đã mã hóa trước khi rời VPS (AES-256 qua `openssl enc -pbkdf2`, cơ chế đã dùng từ trước): Google chỉ thấy dữ liệu mã hóa, không thấy nội dung; mất quyền Drive không làm lộ dữ liệu, mất passphrase thì **mất luôn bản sao**.

## 3. Việc Owner cần làm (không gửi gì qua chat)

1. Trên máy của Owner: tạo OAuth client như mục 2; sinh **passphrase dài ngẫu nhiên** bằng trình quản lý mật khẩu của Owner; **lưu một bản ngoài VPS** (trình quản lý mật khẩu + bản in/giấy cất riêng). Không dán passphrase, token hay Client Secret vào chat/PR/log.
2. SSH vào VPS (terminal của Owner) và kết nối Drive bằng `rclone config` (mục 4). VPS không có trình duyệt: rclone sẽ in ra **một lệnh `rclone authorize "drive" "…"`** để chạy trên máy Owner có trình duyệt; đăng nhập Google và cấp quyền ở trình duyệt đó, rồi dán **kết quả (token) vào cửa sổ SSH**. Dùng đúng lệnh rclone in ra (nó mang đúng client ID và scope), đừng tự chế cờ.
3. Dán passphrase vào VPS đúng một lần bằng `systemd-creds` (mục 4). Báo cho Claude/ChatGPT chỉ **"đã xong"**, không gửi giá trị.

## 4. Cài đặt trên VPS (chỉ sau khi Owner duyệt riêng; chưa làm)

```bash
# 1. công cụ (không chứa secret) và thư mục
sudo apt-get install -y rclone                       # hoặc bản chính thức của rclone; cần >= 1.60
sudo install -d -m 755 /opt/11ship/tools/backup
sudo install -m 755 ops/backup/{backup.sh,restore-rehearsal.sh,restore-fetch.sh,restore-drill.sh,backup-trigger.sh} /opt/11ship/tools/backup/
sudo install -m 644 ops/backup/{lib.sh,verify.sql,restore-checklist.sql} /opt/11ship/tools/backup/
sudo install -m 755 ops/backup/backup_tools.py /opt/11ship/tools/backup/
sudo install -d -m 700 /etc/11ship/backup /var/backups/11ship /var/backups/11ship/spool

# 2. cấu hình không bí mật
sudo install -m 600 ops/backup/backup.env.example /etc/11ship/backup/backup.env      # rồi sửa các dòng BACKUP_*

# 3. Google Drive: tạo remote tên "gdrive", scope drive.file, client ID riêng; làm theo lời nhắc "remote machine / authorize"
sudo RCLONE_CONFIG=/etc/11ship/backup/rclone.conf rclone config
sudo chmod 600 /etc/11ship/backup/rclone.conf && sudo chown root:root /etc/11ship/backup/rclone.conf
sudo RCLONE_CONFIG=/etc/11ship/backup/rclone.conf rclone mkdir gdrive:11Ship-Backup && sudo RCLONE_CONFIG=/etc/11ship/backup/rclone.conf rclone about gdrive:

# 4. passphrase và khóa báo cáo M13 thành credential của systemd (mã hóa bằng khóa máy; gõ/dán tại terminal, KHÔNG đặt trong lệnh)
read -rs -p 'passphrase: ' P; printf '%s' "$P" | sudo systemd-creds encrypt --name=backup-passphrase - /etc/11ship/backup/passphrase.cred; unset P
# khóa BACKUP của M13 (in một lần): npm run ops:ctl -- ingest-key create --label "Sao luu Drive" --scope BACKUP
read -rs -p 'ingest key: ' K; printf '%s' "$K" | sudo systemd-creds encrypt --name=ops-ingest-key - /etc/11ship/backup/ops-ingest-key.cred; unset K
sudo chmod 600 /etc/11ship/backup/*.cred

# 5. timer/service
sudo install -m 644 ops/vinahost/11ship-backup{,-trigger,-predeploy}.service ops/vinahost/11ship-backup{,-trigger}.timer ops/vinahost/11ship-restore-drill.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start 11ship-backup.service && journalctl -u 11ship-backup.service -n 30   # chạy thử MỘT lần có người xem
sudo systemctl enable --now 11ship-backup.timer 11ship-backup-trigger.timer 11ship-restore-drill.timer
```

Quyền file: `rclone.conf` (chứa token) `root:root 0600`; `*.cred` 0600; thư mục `/etc/11ship/backup` 0700; spool 0700, từng bản 0600. Các `.cred` được mã hóa bằng khóa máy của systemd (`/var/lib/systemd/credential.secret`, chỉ root): ai lấy được file `.cred` mà không có khóa máy không đọc được, nhưng khóa máy cũng nằm trên VPS, vì vậy **bản passphrase của Owner ngoài VPS là bản duy nhất cứu được dữ liệu khi mất VPS**. Dịch vụ nhận credential qua `LoadCredentialEncrypted` (chỉ tiến trình đó thấy, không nằm trong biến môi trường). Thêm `.gitignore`: `rclone.conf`, `*.cred`, `backup.env`.

Cơ chế lịch: `11ship-backup.timer` `OnCalendar=*-*-* 03:00:00 Asia/Ho_Chi_Minh` (đúng 03:00 giờ Việt Nam bất kể múi giờ VPS; kiểm bằng `systemd-analyze calendar`), `Persistent=true` (bù lần bị lỡ khi VPS tắt), `TimeoutStartSec=4h`. **Chống chạy chồng:** systemd không khởi chạy lần thứ hai khi unit đang chạy; `backup.sh` còn giữ `flock` trong spool nên lần chạy tay, job "Sao lưu ngay" và deploy cũng không đè nhau (lần sau thoát mã 75, không tạo bản ghi). Bản trước deploy chạy bằng `11ship-backup-predeploy.service`, nối vào `vps-update.py`: khi `/etc/11ship/backup/backup.env` đã có, **bản trước migration lên Drive và xác minh là bắt buộc**, lỗi thì cập nhật dừng trước khi migrate; chưa cấu hình thì in `WARNING` rõ ràng (chỉ còn bản dump cục bộ) và không chặn.

## 5. Mỗi lần chạy làm gì, và khi nào mới gọi là thành công

`dump → gói + manifest → mã hóa → khôi phục thử bản MÃ HÓA vào DB tạm ship11_verify_* và kiểm tra (schema, số dòng nhật ký/sổ cái, ví = sổ cái) → tải lên Drive → kiểm chứng bản trên Drive → dọn bản cũ → ghi nhận → báo M13`. Năm trạng thái được phân biệt trên trang **Hệ thống › Sao lưu và phục hồi**: *đã tạo bản trên VPS* (`LOCAL`), *đã tải lên* (`UPLOADED`), *đã xác minh ngoài VPS* (`VERIFIED`), **thành công** (chỉ khi `VERIFIED`; hiện "Thành công ngoài VPS"), **thất bại** (kèm bước dừng và nguyên nhân bằng lời). Cơ sở dữ liệu từ chối ghi `offsite` khi chưa `VERIFIED`.

**"Kiểm chứng" nghĩa là gì:** sau khi tải lên, rclone liệt kê thư mục Drive; **kích thước và MD5 do Drive tự tính** phải khớp bản cục bộ (cả gói lẫn manifest). Không tải lại toàn bộ gói mỗi lần. Để chứng minh *dùng được*, `11ship-restore-drill.timer` chạy **diễn tập khôi phục hằng tuần** (`restore-drill.sh`): tải bản mới nhất từ Drive, kiểm checksum (MD5 Drive, SHA-256 manifest ngoài, SHA-256 từng thành phần trong manifest trong), giải mã, khôi phục vào DB tạm, chạy kiểm tra, báo `RESTORE_TEST` cho M13.

Mã lỗi (hiện trên Web Admin bằng lời; chi tiết kỹ thuật ở `journalctl -u 11ship-backup`, **đã lọc token**): `DRIVE_NOT_CONFIGURED`, `DRIVE_AUTH` (hết quyền/token bị thu hồi/hết hạn), `DRIVE_QUOTA` (Drive đầy; kiểm trước khi tải lên), `UPLOAD_FAILED`, `UPLOAD_VERIFY` (bản trên Drive khác bản gốc), `ENCRYPT_FAILED`, `DUMP_FAILED`, `PG_TOOL_OLD`, `VERIFY_*` (khôi phục thử không khớp), `SPOOL_FULL`, `DISK_LOW`, `PASSPHRASE_MISSING`, `FILES_FAILED`, `INTERRUPTED`. Thiếu cấu hình Drive: bản cục bộ vẫn được tạo và kiểm tra nhưng lần chạy ghi **thất bại `DRIVE_NOT_CONFIGURED`** và báo Discord; không bao giờ là "thành công".

## 6. Lưu giữ

- Trên Drive (chỉ tệp đúng mẫu `ship11-<KIND>-<yyyymmddThhmmssZ>-<8 hex>.tar.enc|.manifest.json`): **7 bản ngày** (`DAILY`), **4 bản tuần** (`WEEKLY`; lần chạy 03:00 Chủ nhật giờ VN còn được sao chép phía Drive thành bản tuần, có kiểm tra), **1 bản trước deploy gần nhất** (`PRE_MIGRATION`, chuỗi riêng: một lần deploy không đẩy bản ngày/tuần ra ngoài), 2 bản trước khi khôi phục, 3 bản chạy tay/Sao lưu ngay. Số bản trong mỗi loại tính theo bản **đủ bộ** (có cả gói lẫn manifest).
- **Chỉ dọn sau khi có bản mới đã xác minh** (bản của chính lần chạy đó được bảo vệ). Xóa từng tệp bằng `rclone deletefile <đúng tên>`; **không dùng `sync`, `purge`, ký tự đại diện**; tên không đúng mẫu, thư mục con, tệp lạ của Owner không bao giờ bị liệt kê để xóa; một lần chạy xóa tối đa 24 tệp (vượt thì từ chối, tránh lỗi chính sách làm trống thư mục); liệt kê Drive lỗi thì bỏ qua dọn.
- Trên VPS (spool `BACKUP_DIR`): bản đã lên Drive và xác minh chỉ giữ `BACKUP_KEEP_LOCAL_VERIFIED` (mặc định 2) bản mới nhất. **Tải lên lỗi: giữ bản mã hóa cục bộ để thử lại**, nhưng có giới hạn: tối đa `BACKUP_UPLOAD_ATTEMPTS` (5) lần/bản, sau đó dừng thử lại (vẫn giữ file, có cảnh báo trong log và M13 vì các lần chạy tiếp theo cũng báo lỗi); tổng spool tối đa `BACKUP_SPOOL_MAX_MB` (4096) — vượt thì bỏ **bản cũ nhất chưa gửi** (không bao giờ bản mới nhất, không bao giờ bản đã gửi) và ghi log; cảnh báo ở `BACKUP_SPOOL_WARN_PERCENT` (80%); dưới `BACKUP_MIN_FREE_MB` dung lượng trống, hoặc không đủ chỗ cho bản mới, lần chạy dừng với `DISK_LOW`/`SPOOL_FULL` (M13 còn có cảnh báo dung lượng đĩa riêng).

## 7. Cảnh báo (M13 → Discord)

Mỗi lần chạy gọi `POST /v1/ops/ingest/backup` (khóa máy phạm vi `BACKUP`, truyền qua header, không lên dòng lệnh/log). M13 giữ **một sự cố cho mỗi kiểm tra**: lỗi lặp lại **không gửi trùng**; có bản sao ngoài VPS đã xác minh thì **báo phục hồi một lần**; **quá 26 giờ** (`server.backup_max_age_hours`) chưa có bản ngoài VPS thành công thì báo "Quá 26 giờ chưa có bản sao lưu ngoài VPS thành công" (kể cả khi timer chết, vì M13 tự so thời gian). Nội dung gửi Discord chỉ là tiêu đề mã lỗi bằng lời (ví dụ "Google Drive đã đầy dung lượng"), không chứa token, passphrase, đường dẫn, URL hay dữ liệu khách. Khi nguyên nhân đổi trong lúc sự cố còn mở, tiêu đề cập nhật nhưng **không gửi lại** (chống trùng).

## 8. Phục hồi từ Google Drive — từng bước

Không bao giờ phục hồi production từ một lần bấm: quy trình yêu cầu của SYSTEM trên Web Admin và người vận hành xem [runbook M12-F](m12-backup-restore-20261023.md). Các bước kỹ thuật:

1. **Chọn bản:** `rclone lsjson gdrive:11Ship-Backup` hoặc xem manifest ngoài. Chọn bản và ghi lại thời điểm của nó (mọi thứ sau thời điểm đó **không có** trong bản).
2. **Lấy về, kiểm tra checksum, giải mã, giải gói** (môi trường riêng, thư mục mới, không bị ghi đè):
   `BACKUP_RCLONE_CONFIG=… BACKUP_REMOTE=gdrive:11Ship-Backup BACKUP_PASSPHRASE_FILE=<tệp passphrase của Owner> ops/backup/restore-fetch.sh <tên-bản|latest> /var/restore/<tên>`
   Script kiểm theo thứ tự: kích thước+MD5 Drive → SHA-256 gói theo manifest ngoài → giải mã → SHA-256 từng thành phần theo manifest trong; sai một bước là dừng, không để lại kết quả trông như hợp lệ. Nếu VPS đã mất, chạy trên máy khác với `rclone.conf` mới (kết nối Drive lại) và passphrase từ bản của Owner.
3. **Phục hồi DB vào môi trường riêng** (không phải production): `ops/backup/restore-rehearsal.sh <gói.tar.enc> <passphrase> <url admin của server thử> ship11_restore_<tên> --keep` (chỉ tạo DB mới tên `ship11_restore_*`/`ship11_verify_*`; từ chối tên production/staging/test hoặc DB đã tồn tại). Ảnh nằm trong dump; nếu có `files.tar` thì giải vào thư mục thử, không phải thư mục thật.
4. **Kiểm tra** (chỉ SQL, **không khởi động backend** trên bản thử): `psql -d ship11_restore_<tên> -f ops/backup/restore-checklist.sql` — in thời điểm bản sao dừng, chênh lệch ví–sổ cái (phải 0), **ví/hold** (số tiền đang giữ), **đơn/giao hàng** chưa kết thúc, rút/nạp đang dở, và các **tác vụ nền** còn chờ (SMS, push, outbox, Discord). Rồi `neutralize-restored-db.sql` (tắt Discord và xóa webhook trong bản thử).
5. **Không phát lại và không làm gì ra ngoài trong diễn tập:** không khởi động backend/worker, không có SMS Gateway, FCM, ngân hàng hay Discord nào nối vào DB thử; không chạy lệnh tiền thật. Mã OTP/SMS cũ đã hết hạn, push cũ không gửi lại, thanh toán cũ không gọi lại.
6. **Trước khi phục hồi production — đối chiếu phần xảy ra SAU thời điểm bản sao** (Owner/kế toán làm, có bằng chứng ngoài hệ thống): sao kê ngân hàng từ thời điểm đó (tiền nạp đã vào; nhập lại qua luồng nạp tiền thường nếu thiếu); mọi yêu cầu **rút tiền** đang `PROCESSING`/`UNKNOWN_OUTCOME` (ngân hàng quyết định, không phải dòng trong bản sao); hold ví và đơn/giao hàng đang dở theo `restore-checklist.sql` đối chiếu với thực tế (shop/shipper); tài khoản đăng ký, thay đổi quyền, phản ánh mới sau thời điểm; ghi lại danh sách chênh lệch để xử lý thủ công trước khi mở lại.
7. **Phục hồi production** (cần Owner duyệt riêng, ngoài phạm vi tài liệu này): theo mục "Restore" của runbook M12-F — khóa ghi, bản `PRE_RESTORE`, khôi phục vào DB mới, `db:migrate`, đối chiếu lần nữa, mới mở lại; giữ Discord tắt đến khi xong.

## 9. Kết nối xong — chứng minh một vòng thật (làm sau khi Owner kết nối)

Trên VPS (hoặc máy có rclone đã kết nối): `systemctl start 11ship-backup.service` → xem `Sao lưu thành công ngoài VPS` trên Web Admin → `restore-drill.sh` (tải lại từ Drive, giải mã, khôi phục DB test) → lưu **đầu ra** (không chứa dữ liệu nhạy cảm; đã có dòng đếm, không có tên/số điện thoại) vào `docs/evidence/m12/` cùng ngày giờ và SHA release. Cho đến khi có bằng chứng này, mọi tuyên bố "sao lưu lên Google Drive hoạt động" là **chưa kiểm chứng**.
