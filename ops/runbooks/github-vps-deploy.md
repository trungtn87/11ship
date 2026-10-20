# Deploy VPS từ GitHub Actions

Owner chạy **Actions → Deploy VPS → Run workflow**, chọn **main**. Workflow chỉ chạy
thủ công từ main, chốt main SHA mới nhất lúc checkout, build/verify đúng SHA đó,
lưu gói và checksum trong artifacts, upload qua SSH rồi chạy bộ cập nhật VPS hiện có.
Không cần tải gói về PC hoặc upload bằng tay mỗi lần.

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
  và code rollback của `vps-update.py`. Không ghi thêm migration approval tự động.
- Migration chưa được duyệt dừng trước backup/apply. Review và ghi đúng hash vào
  `/etc/11ship/migration-compatibility.json` theo runbook, sau đó chạy Action lại.
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
