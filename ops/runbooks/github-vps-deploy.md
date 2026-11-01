# Deploy VPS từ GitHub Actions

Owner chạy **Actions → Deploy VPS → Run workflow**, chọn **main**. Workflow chỉ chạy
thủ công từ main, chốt main SHA mới nhất lúc checkout, build/verify đúng SHA đó,
lưu gói và checksum trong artifacts, upload qua SSH rồi chạy bộ cập nhật VPS hiện có.
Không cần tải gói về PC hoặc upload bằng tay mỗi lần.

## APK và thông báo cập nhật — Owner bổ sung 27/10/2026

Áp dụng cho mọi lần deploy, theo [issue #193](https://github.com/trungtn87/11ship/issues/193)
và cơ chế M13 hiện có. Người điều phối chịu trách nhiệm kiểm tra cả backend và APK;
không để Owner phải nhắc riêng bước đưa APK vào hệ thống cập nhật.

1. **Chốt phạm vi phát hành:** ghi SHA/version backend và APK FOOD/SHIP bị ảnh hưởng.
   Thay đổi app cần APK mới; thay đổi chỉ backend/tài liệu, còn tương thích với APK
   đang dùng, được giữ APK đã phát hành và ghi rõ lý do. Không rebuild mọi app vì
   một commit tài liệu, không coi SHA APK khác server là mất tương thích.
2. **Chuẩn bị APK của đợt phát hành đã được phép:** dùng Mobile APK và khóa ký bền
   vững, đúng applicationId, versionCode tăng. Dùng artifact từ SHA đã xác minh;
   lưu version, SHA nguồn, kích thước, SHA-256 và signer từng app. Artifact GitHub
   build thành công chưa có nghĩa APK đã được công bố cho điện thoại.
3. **Đưa bản cập nhật lên VPS:** kiểm tra OPS_ARTIFACT_DIR và quyền; đưa đúng APK vào
   kho hiện có, đăng ký release và PUBLISHED qua quyền SYSTEM/M13 có audit. Dùng
   quy trình phát hành hiện có, không sửa DB trực tiếp hoặc tạo updater thứ hai.
   Chỉ công bố trong phạm vi phát hành được Owner cho phép; việc sửa tài liệu này
   không tự công bố APK hay cấp quyền mới. Thiếu quyền/công cụ thì báo blocker cụ thể.
4. **Trước promote backend:** chạy preflight tương thích hiện hữu. Nếu tăng minimum,
   APK tương thích phải đã PUBLISHED và tải được trước khi promote; thiếu thì dừng,
   giữ API cũ tương thích trong giai đoạn chuyển tiếp. Cập nhật thường là OPTIONAL;
   chỉ REQUIRED khi bản cũ thật sự không còn được hỗ trợ theo hợp đồng đã review.
   Không tăng minimum chỉ để làm xuất hiện banner.
5. **Sau deploy, kiểm tra từng app phát hành:** gọi
   GET /v1/app-updates/check?component=FOOD|SHIP&version_code=<mã bản đang dùng>
   bằng các request riêng cho FOOD và SHIP. Với bản cũ hơn APK đã publish phải trả
   đúng bản đích và UPDATE_OPTIONAL hoặc UPDATE_REQUIRED theo minimum; bản mới nhất
   không nhắc sai; không đưa nhầm APK giữa hai app. Kiểm download HTTP 200, kích thước
   và SHA-256 khớp release. Thiếu APK thì ghi rõ chưa phát hành, không dựng link giả.
6. **Thử điện thoại:** ghi riêng kết quả mở app cũ → banner/màn cập nhật → tải →
   trình cài đặt → cài đè giữ dữ liệu. Bản APK cũ chưa có cơ chế M13 phải cập nhật
   thủ công một lần; server không thể bổ sung UI vào APK đã cài. Required không
   khóa ngang đơn đang xử lý; áp dụng quy tắc hoãn và chặn công việc mới của #193.

**Điều kiện báo hoàn tất:** phân biệt "backend đã deploy" với "APK đã phát hành và
API cập nhật đã kiểm" và "đã thử trên điện thoại". Khi đợt phát hành có APK mới,
backend xanh nhưng chưa PUBLISHED/tải được hoặc chưa kiểm /check thì phần phát hành
APK vẫn chưa hoàn tất. Nếu không cần APK mới, ghi APK được giữ và bằng chứng tương
thích; không buộc có bản mới cho mọi deploy.

Báo cáo ngắn mỗi lần: SHA/version VPS thực chạy; FOOD/SHIP versionCode và SHA nguồn;
trạng thái PUBLISHED, link tải hợp lệ, kết quả /check của bản cũ/mới, mức optional/
required và kết quả thiết bị hoặc CHƯA KIỂM. Workflow hiện đã có preflight và
post-deploy compatibility; các bước upload/publish và thử thiết bị phải được thực
hiện, ghi bằng chứng riêng cho tới khi có tự động hóa được kiểm chứng. Cập nhật
runbook không có nghĩa pipeline đã tự build/upload/publish APK.

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

## Khôi phục riêng bản 6270be9 (action đã gỡ ngày 2026-11-01)

Action **Recover VPS 6270be9** là thao tác một lần, đã chạy duy nhất ngày 2026-10-21
(thành công) và **đã bị gỡ khỏi `.github/workflows/` ngày 2026-11-01**. Lý do: nó là
đường deploy production (SSH root, environment `vps-production`) không đi qua
`ci-gate`, và chạy lại sẽ đưa VPS về nguồn cũ `6270be9`. Không khôi phục file workflow.

Nếu cần khôi phục/triển khai lại: dùng **Deploy VPS** thường (chỉ chạy trên main,
bắt buộc `ci-gate` xanh trên đúng SHA) và duyệt migration bằng quy trình hiện hành.
`scripts/deploy/recover-6270be9.sh` và `tests/deploy/recover-6270be9.test.*` được giữ
làm lịch sử/bằng chứng; không còn workflow nào gọi chúng.

Ghi nhận lịch sử của lần chạy đó (action không còn tồn tại; không tự duyệt migration
cho những bản tiếp theo):

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
