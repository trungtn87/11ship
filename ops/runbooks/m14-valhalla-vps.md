# M14 Valhalla trên VPS VinaHost: định tuyến đường bộ cho phí giao (#239)

Owner chốt 31/10/2026: triển khai Valhalla M14 trên **VPS 1 GB hiện tại**, môi trường phát triển/kiểm thử; chạy thật và đo giới hạn. **Owner tự chạy lệnh qua Remote-SSH; Claude không SSH.** Không quay về đường chim bay: khi routing hỏng, backend vẫn trả "chưa có tuyến" (không phí giả).

## Đã biết / chưa biết
- Đã biết (từ repo): dữ liệu `ops/m14/data/caobang.osm.pbf` (3,3 MB, bbox 105.85–106.70 × 22.25–23.08), `Dockerfile` pin Valhalla 3.9.1 build graph lúc build image, cổng `127.0.0.1:18014`, giới hạn runtime 512 MB / 0,5 CPU. Cổng gateway chỉ nhận điểm trong 106.0–106.52 × 22.43–22.91 (vùng bản đồ hiện có).
- **Chưa biết** (đo trên VPS): RAM/disk thực tế còn trống, Docker đã cài chưa, thời gian và RAM đỉnh khi build graph, độ trễ/đồng thời thực tế. Báo số đo thật, không hứa trước.

## Thay đổi code đi kèm (PR này)
- Backend `M14_ROUTING_ORIGIN` chấp nhận `http://` **chỉ** cho loopback (`localhost`, `127.0.0.1`, `[::1]`) ở mọi môi trường kể cả production; host khác vẫn bắt buộc https (có test). Routing không mở ra Internet.
- `ops/m14/server.py`: giới hạn đọc từ env (`M14_RATE_PER_MIN` mặc định 20, `M14_MAX_CONCURRENT` mặc định 2). Backend là **một** client nên 20 yêu cầu/phút và 2 song song sẽ làm danh sách quán/ma trận nhận 429 (= "không có tuyến"). `vps.sh` đặt 600/phút và 4 song song (khớp `MAX_CONCURRENT_ROUTES = 4` của backend); service Render thử nghiệm giữ mặc định cũ.
- `ops/m14/vps.sh` (preflight, build/load, up + health + smoke + tự rollback, connect backend + tự khôi phục env, status, load-test, rollback) và `ops/m14/load-test.py`.

## Các bước Owner chạy (Remote-SSH, root, từ checkout đã review, không đặt dưới /root)
```bash
cd /opt/11ship-review && git fetch && git checkout <nhánh feat/239-m14-vps-routing hoặc SHA đã duyệt>
sudo bash ops/m14/vps.sh preflight          # chỉ đọc; gửi lại kết quả (RAM, đĩa, container hiện có)
```
Nếu RAM trống >= 700 MB và đĩa >= 3 GB:
```bash
sudo bash ops/m14/vps.sh build              # build tại chỗ (nice), có thể vài phút
```
Nếu không đủ (ưu tiên theo yêu cầu Owner): build ở máy khác (Linux/WSL có Docker):
```bash
docker build -f ops/m14/Dockerfile -t 11ship-m14-routing:current .
docker save 11ship-m14-routing:current | gzip > m14-image.tar.gz && sha256sum m14-image.tar.gz > m14-image.tar.gz.sha256
# copy cả hai tệp lên VPS, rồi:
sudo bash ops/m14/vps.sh load /đường/dẫn/m14-image.tar.gz
```
Sau đó:
```bash
sudo bash ops/m14/vps.sh up                 # start, chờ /health, chạy smoke.py (tuyến thật Pác Bó -> Tân An, điểm ngoài vùng bị từ chối); lỗi thì tự rollback
sudo bash ops/m14/vps.sh status             # container, RAM/CPU, health
sudo bash ops/m14/vps.sh load-test 40 4     # 40 tuyến, 4 song song: p50/p95, mã trạng thái, tài nguyên
sudo bash ops/m14/vps.sh connect            # ghi M14_ROUTING_ORIGIN=http://127.0.0.1:18014 vào /etc/11ship/staging.env (có backup), restart 11ship-staging, kiểm ready; lỗi thì tự khôi phục
```
Mỗi bước dừng khi lỗi và in nguyên nhân. Gửi lại đầu ra của `preflight`, `up`, `status`, `load-test` (không chứa bí mật) để Claude đối chiếu.

## Kiểm tra sau khi nối backend (cùng Owner)
1. Phí M06: đặt một đơn thử có quán và điểm giao đều có tọa độ trong vùng: quãng đường đường bộ và phí phải theo bảng M06 (không 10.000đ mặc định, không "chưa xác định"). Đối chiếu km với `load-test`/smoke.
2. Trang chủ khách: danh sách quán hiện khoảng cách đường bộ.
3. PostgreSQL/backend: so `free -m`, `docker stats`, `systemctl status 11ship-staging` và độ trễ API trước/sau; nếu RAM thấp (<150 MB trống) hoặc backend chậm rõ rệt, chạy `rollback`.

## Rollback
- Routing: `sudo bash ops/m14/vps.sh rollback` (ảnh `:previous` hoặc dừng container; backend khi đó báo "chưa có tuyến").
- Backend env: `sudo bash ops/m14/vps.sh restore-env /etc/11ship/staging.env.m14-backup.<thời điểm>`.
- Gỡ hẳn: xóa dòng `M14_ROUTING_ORIGIN` rồi restart `11ship-staging`; `docker compose -p m14 -f ops/m14/compose.yaml down`.

## Giới hạn đã biết
- Vùng phục vụ của gateway chỉ là vùng bản đồ hiện có; điểm ngoài vùng bị từ chối (400), backend coi là không có tuyến.
- Cấu hình xe máy dựa trên quyền tiếp cận OSM, không phải dẫn đường rẽ/biển cấm thực tế.
- 1 GB RAM dùng chung với backend và PostgreSQL: số đo thật quyết định có giữ routing cùng máy hay chuyển máy khác (chi phí cần Owner duyệt riêng).
