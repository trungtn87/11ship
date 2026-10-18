# 11SHIP AUTO DEPLOY — Windows PowerShell

Tiếp tục PR #122. Điểm vào mới duy nhất là `deploy-11ship.ps1` ở gốc repo; đường dẫn cũ gọi cùng công cụ. Owner chạy lần đầu sau khi PR được merge và artifact main đã xanh. Công cụ không tự merge, không deploy production trong CI.

## Sử dụng (tối đa 3 bước)

1. Mở Windows PowerShell tại thư mục chứa file `deploy-11ship.ps1` đã tải từ repo.
2. Chạy `./deploy-11ship.ps1`.
3. Nếu được hỏi, dán mật khẩu SSH một lần. Những lần sau dùng khóa deploy riêng, không hỏi lại mật khẩu.

Không nhập SHA, artifact, đường dẫn hoặc SQL. Tiến trình và kết quả được báo bằng tiếng Việt; không có câu hỏi xác nhận deploy/migration thông thường.

## Điều kiện tài khoản bắt buộc — không thể tự cấp quyền thay Owner

- Windows OpenSSH Client (`ssh`, `scp`, `ssh-keygen`) và `tar` phải có. Windows 10/11 thường đã có; thiếu thì dừng với tên công cụ, không tự sửa chính sách máy/đòi quyền Administrator.
- Host key VPS phải đã được xác minh trong Windows OpenSSH `known_hosts`. Owner đã kết nối VPS từ PowerShell; công cụ dùng lại bản ghi này và `StrictHostKeyChecking=yes`. Không tự tin host key lạ hoặc thay thế.
- GitHub Actions artifact yêu cầu quyền đọc GitHub ngay cả khi repository công khai. Tự dùng `GH_TOKEN`, `GITHUB_TOKEN`, hoặc phiên `gh auth` đã có; chỉ giữ token trong bộ nhớ. Nếu chưa có quyền thì dừng trước khi deploy. Đăng nhập tài khoản GitHub một lần qua GitHub CLI là bước cấp quyền tài khoản riêng, công cụ không thể tự phê duyệt thay Owner. Không nhập token vào script hoặc chat. Token cần đọc repo, Actions và rules/protection; không cần quyền ghi repo.
- VPS phải giữ môi trường production, Node 24, PostgreSQL có sẵn, operator env `/root/ship11-secrets/operator.env` hợp lệ, systemd và các chương trình trong runbook gốc. Không tạo lại DB, role, env, trust hoặc gateway nếu thiếu.

## Xác thực SSH một lần

Ưu tiên khóa riêng đã cài hoặc ssh-agent hiện có. Nếu chưa đăng nhập được bằng khóa: tạo Ed25519 riêng tại `%LOCALAPPDATA%/11Ship/ssh/deploy_ed25519`, thư mục chỉ tài khoản Windows hiện tại có quyền; dùng đúng một lần xác thực mật khẩu do OpenSSH quản lý để **thêm** khóa công khai vào `/root/.ssh/authorized_keys`. Không đọc/giữ/lưu mật khẩu; không dùng `-pw`, askpass hoặc plaintext. Nếu đăng nhập bằng khóa bị VPS cấm, dừng; không tự sửa sshd/firewall. Muốn thu hồi quyền deploy, xóa đúng public key đó khỏi authorized_keys và xóa file khóa local. Khóa riêng là thông tin bí mật, không đưa vào repo/chat/log.

## Artifact và CI

- Đọc main tại thời điểm chạy, chỉ đi qua commit progress-bot đúng mẫu `[skip ci]` chỉ sửa `docs/PROGRESS.md` (quy tắc AGENTS hiện hữu). Hiển thị SHA mã triển khai, giữ nguồn gốc tới main HEAD; không lùi sang một commit mã cũ chỉ vì CI của bản mới đỏ.
- CI `ci.yml` push trên main của đúng SHA phải hoàn tất thành công; kiểm tra status/checks và các check bắt buộc từ branch protection/rulesets. Không đủ quyền đọc quy tắc thì dừng.
- Chỉ lấy artifact `11ship-<sha>-ubuntu24-amd64` từ chính run đó, còn hạn, có digest. Tải ZIP qua redirect HTTPS không mang Authorization sang storage; kiểm digest ZIP, checksum tar, RELEASE.sourceSha và hash helper trong manifest. Kiểm lại main trước khi khởi chạy tác vụ production.
- Trên VPS: chặn tar traversal/link/device trước giải nén; kiểm manifest toàn bộ và dùng lại `verify-ubuntu-artifact.mjs` (module/native Argon2/Admin build). Không chạy npm install trên VPS.

## Triển khai, backup và migration

Dùng helper từ chính artifact, chạy trong transient systemd unit `11ship-deploy-<job>`, có `flock` toàn VPS. Mất cửa sổ PowerShell/SSH không giết ngang migration. Receipt chỉ chứa SHA/stage/service/rollback ở `/var/lib/11ship-deploy`; chạy lại một lệnh sẽ theo dõi job trước nếu vẫn chạy. Không bao giờ báo thành công khi chưa biết kết quả. Hai phiên không thể thay đổi DB/release đồng thời.

Nếu SHA đang chạy đúng bản mới nhất: chỉ kiểm health + Admin + database; không backup/migration/restart/upload. Với bản mới: preflight bằng runner hiện có, kiểm policy, pg_dump custom của **ship11_staging** (exit code, file không rỗng, pg_restore --list, SHA256), backup env chỉ tại VPS; backup lưu riêng ở `/var/backups/11ship/<timestamp-job>/` mode 700/600. Không tự xóa backup hoặc release cũ; cần theo dõi dung lượng và sao lưu ngoài VPS theo runbook gốc.

`migration-policy.json` pin hash từng migration đã có trong main. Chỉ migration đã được phép mới tự apply qua `db-migrate-remote.js --apply`; hash lạ, migration chưa có policy, history bị sửa, hoặc migration có backfill/chuyển đổi ngữ nghĩa chưa duyệt thì dừng **trước mutation**. Các migration hiện được đánh dấu cần review riêng: activation verification mode (dynamic DDL), account-scope lifecycle, shipper management backfill, M06 v1.1 pricing semantic conversion. Đây không phải yêu cầu Owner chạy SQL: agent phải review/bổ sung policy hoặc chuẩn bị gói migration thích hợp. Runner vẫn giữ khóa/guard/TLS/role vốn có. Không down/reset/drop/seed. Grants chỉ dùng hai file hiện có, kiểm cú pháp forward GRANT cho role ship11_app rồi chạy khi khác bản cũ hoặc có migration.

Sau đó chuyển symlink atomic, restart `11ship-staging`, kiểm readiness nội bộ + HTTPS (readiness gọi DatabaseService), HTML Web Admin khớp chính build mới, và kết nối đúng DB. Không sửa nginx/TLS/firewall, .env/OTP/khóa, unit backend hoặc attestation timer. Công cụ này không tự sửa lỗi revocation quá hạn đã phát hiện trên VPS; cần xử lý cấu hình timer theo gói đã duyệt riêng.

## Lỗi và rollback

- Trước đổi symlink: giữ mã cũ, thông báo bước/mã lỗi; migration có thể đã áp một phần khi runner lỗi, không tự restore/down. Backup và log chi tiết chỉ ở thư mục root trên VPS, không đẩy lên chat/console/journal.
- Sau đổi symlink: chỉ tự rollback **mã** khi không có migration pending và hai grants không đổi. Lùi atomic về đúng release trước, restart, kiểm lại health/Admin/DB. Không coi rollback thành công nếu health cũ không đạt.
- Có thay đổi schema/grants: không tự lùi mã hoặc restore DB. Báo `unsafe-schema-changed`, service và job id; cần agent kiểm tra tương thích trước hành động tiếp theo.
- Mất SSH: báo kết quả chưa xác định, job vẫn chạy; chạy lại script sẽ xem receipt. Không bắt Owner đăng nhập VPS/SQL để tiếp tục thông thường.

## Kiểm chứng

Các job `One-click deploy` trong workflow CI hiện có: parser và hành vi offline trên Windows PowerShell 5.1/PowerShell 7; state machine Bash và policy trên Ubuntu với filesystem thật và doubles của OS/DB/network. Bao phủ no-op, CI đỏ, required check thiếu, artifact sai SHA, checksum/manifest sai, mất SSH, backup lỗi, migration lỗi, service/health lỗi, rollback. CI artifact hiện hữu kiểm bundle/native module. Không có kiểm thử production hoặc nghiệm thu bằng máy Windows của Owner trước khi chạy thật; không dùng mock để tuyên bố đã deploy.
