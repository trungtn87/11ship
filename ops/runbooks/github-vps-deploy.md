# Deploy VPS từ GitHub Actions

Owner chạy **Actions → Deploy VPS → Run workflow**, chọn **main**. Workflow chỉ chạy
thủ công từ main, chốt main SHA mới nhất lúc checkout, build/verify đúng SHA đó,
lưu gói và checksum trong artifacts, upload qua SSH rồi chạy bộ cập nhật VPS hiện có.
Không cần tải gói về PC hoặc upload bằng tay mỗi lần.

## Migration đã review — quy trình dùng cho các lần sau

Khi chạy **Run workflow**, giữ bật **Import exact migration hashes reviewed in main**
(`approve_reviewed_migrations`, mặc định bật). Updater chỉ nhập hash SQL đã được
review trong `ops/selfhosted/reviewed-migrations.json` của chính gói release đã verify.
Tắt lựa chọn này để chỉ dùng policy có sẵn trên VPS (không ghi thêm approval).

Với mỗi PR có migration mới, người triển khai/reviewer phải:

1. Review phần Up so với code đang vận hành và đường rollback: giữ dữ liệu, writes
   của code cũ và các guard tiền/identity. SQL không tương thích cần kế hoạch
   maintenance/expand-contract riêng, không đưa vào danh sách này.
2. Thêm tên migration không có `.sql`, SHA-256 của **toàn bộ file SQL** và ghi chú
   tương thích cụ thể vào manifest. Không tự sinh approval từ mọi file trong thư mục.
   Không sửa migration đã áp dụng; dùng migration mới để sửa tiến.
3. Chạy `python3 -B scripts/deploy/vps-update.py validate-reviewed .` và
   `npm run deploy:test`; review manifest cùng PR trước merge.
4. Deploy main như bình thường. Updater kiểm toàn bộ pending set trước khi ghi
   policy: migration không có review/hash, SQL thay đổi hoặc policy xung đột đều
   dừng trước backup/migrate/switch. Bổ sung đúng review trong PR, không bypass.

Approval được ghi dưới deploy lock hiện hữu, nguyên tử, root-only; giữ bản policy
trước thay đổi và mọi approval cũ. Chỉ nhập những migration đang pending. Không
migration thì không backup/migrate/grants. Sau approval vẫn phải qua dump/verify,
backup offsite khi đã cấu hình, migrate/grants, đổi code và health/readiness; lỗi
restart/health vẫn rollback code, không down/restore DB.

Lần bổ sung 24/10/2026 ghim đúng năm migration M13/M12/M07 tại manifest; các hash
đã duyệt trước đó trên VPS được giữ nguyên. Hai checkbox cũ cho M02 GPS và
M01/shop-code vẫn giữ tương thích, không cần chọn lại cho DB đã triển khai chúng.

## Cấu hình một lần

Tạo GitHub environment `vps-production`, giới hạn deployment branch chỉ `main`.
Trong environment thêm hai secrets (không gửi private key vào chat hoặc commit):

| Secret | Nội dung |
| --- | --- |
| `VPS_SSH_PRIVATE_KEY` | Private key SSH dành cho deploy; public key tương ứng đã được thêm vào `/root/.ssh/authorized_keys` trên VPS |
| `VPS_KNOWN_HOSTS` | Dòng known_hosts của `103.9.78.67`, lấy từ host public key qua terminal VPS tin cậy |

Đích cố định của dự án: root@103.9.78.67, SSH port 22. Không dùng mật khẩu root trong
Actions, không tự `ssh-keyscan` rồi tin kết quả, không tắt host-key verification.
Trên terminal VPS đã đăng nhập tin cậy, lấy dòng public host key (không phải secret):

```bash
awk '{print "103.9.78.67 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

VPS phải có cài đặt hiện hữu `/opt/11ship/current`, service `11ship-staging`, Node,
PostgreSQL, công cụ runtime, env/operator/trust và timer theo `vps-safe-update.md`.
Workflow không cài mới server, đổi env hoặc tạo/cấp quyền khóa SSH.

## Hành vi và xử lý lỗi

- Một deploy tại một thời điểm; không tự hủy deploy đang chạy khi có yêu cầu mới.
- Dùng lại backup, migration hash policy, runtime grants, HTTPS/API/Admin/readiness
  và code rollback của `vps-update.py`. Chỉ ghi thêm exact approval có review trong release khi tùy chọn mới được bật.
- Migration chưa được duyệt dừng trước backup/apply. Bổ sung review/hash vào manifest
  qua PR, hoặc operator duyệt chính xác trên VPS theo runbook; sau đó chạy Action lại.
- Updater chấp nhận wrapper refresh đã dùng thực tế nếu đúng nội dung, root sở hữu,
  không cho group/other ghi; không thay service refresh hoặc quyền trust.
- Chạy lại dùng được release đã giải nén khi toàn bộ file khớp gói được xác minh;
  không ghi đè release khác. Nếu đã chạy đúng SHA, kiểm tra health và giữ previous.
- Workflow cài updater từ cùng checkout; giữ bản updater trước trong thư mục upload
  `/root/11ship-actions/<SHA>/vps-update.before.py`. Không xóa release/backup cũ.
- Xem job summary để biết SHA đã deploy; failure không được coi là deploy thành công.
  Mất SSH/timeout có thể làm kết quả chưa xác định: kiểm tra VPS trước khi kết luận.
- Gói vẫn dùng tên SHA hiện hữu theo quy ước phiên bản cho đến khi pipeline version
  được đồng bộ; không tự gắn nhãn v1.x cho artifact chưa có tag tương ứng.

Không tự deploy sau mỗi merge, không gửi Discord, không bật Firebase. Không coi
health check là nghiệm thu trên điện thoại. M13 có thể gọi/dùng lại workflow này
khi tích hợp điều khiển phát hành; không tạo hệ thống version/deploy riêng.

## Khôi phục riêng bản 6270be9 khi Owner không có terminal VPS

Action **Recover VPS 6270be9** là thao tác operator thủ công, chỉ trên main và
environment/SSH/concurrency hiện có. Phải chọn `approve_reviewed_hashes`; mặc định
tắt. Nó không tự duyệt migration trong **Deploy VPS** hay cho những bản tiếp theo.

Nguồn ứng dụng cố định `6270be903e7c94b5155b3db9a353a7761b864722`, cùng APK build 210.
Gói đã verify/upload/extract bởi Deploy VPS run `39636197294`, bị dừng trước apply.
Lần deploy thành công trước đã xác minh nguồn `aadde62d08a9a7bc500ff1a50fe84fd2acbd2e74`
(run `39520731414`). Recovery từ chối nếu current đã chuyển sang bản khác.

Hai nội dung SQL được review cho lần triển khai Owner đã yêu cầu:

| Migration | SHA256 nội dung |
| --- | --- |
| `1795305600000_service-area-coverage` | `1d78c9b015340412dfea60fcb0a073f32684e664caf8b0d640d585915b2a1e78` |
| `1795392000000_order-stage-timeouts` | `e3b281687b13f74591a91c39aeb827ac7153efe8973317bf42c0ca2209278f77` |

Coverage thêm ba cột nullable/check, không đoán vị trí hay sửa dữ liệu cũ. Timeout
thêm bảng/cột/trigger và mở rộng trạng thái; giữ snapshot NULL của giai đoạn cũ,
giữ guard tiền/identity và không xóa lịch sử. Bằng chứng integration của PR #157
đã xanh trước merge. Không chạy Down Migration. Quyền runtime do updater cấp sau
apply như quy trình hiện có; backup và rollback code vẫn thuộc updater.

Recovery kiểm đúng SQL và updater, giữ approval khác, sao lưu policy và ghi nguyên
tử dưới deploy lock; không cho conflict hoặc app-write policy. Sau đó updater tự
verify lại gói, backup DB, apply/grants và health/readiness. Migration khác chưa có
hash tiếp tục bị chặn. Chạy `python3 tests/deploy/recover-6270be9.test.py` để kiểm
những nhánh từ chối bằng filesystem tạm, không gọi SSH/DB/systemd.
