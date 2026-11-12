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

## Thứ tự rollout bắt buộc: gateway trước, kiểm tra xanh, rồi mới backend (P6-1, SỬA-1)

Backend mới đòi `routeVersion` và `trip.legs[0].shape` (xem `apps/backend/src/delivery/m14-route-client.ts`). Gateway cũ không có `route_version`, nên nếu backend mới được nối vào gateway cũ, mọi tuyến bị coi là **không có tuyến** (lý do nội bộ `ROUTE_GATEWAY_OUTDATED`, client chỉ thấy `ROUTE_UNAVAILABLE`). Không có đường thẳng dự phòng: đây là lỗi an toàn, không phải lỗi tuyến.

Thứ tự bắt buộc:
1. **Nâng gateway trước** (`vps.sh load` rồi `vps.sh up`; `up` tự rollback nếu lỗi).
2. **Kiểm tra máy được:** `sudo bash ops/m14/vps.sh check`. Phải in `gateway check OK: ready, routeVersion=...`. Nếu in ERROR (chưa sẵn sàng, thiếu hoặc sai `routeVersion`, không trả lời): **dừng, không nối backend**.
3. **Chỉ sau khi check xanh** mới chạy `sudo bash ops/m14/vps.sh connect` (chạy lại check ngay trong `connect`; lỗi thì không đụng env file).
4. Lần deploy backend mới: nếu backend được nâng trước gateway thì rơi vào trạng thái "không có tuyến" cho đến khi gateway lên. Không nâng backend trước khi check xanh.

Rollback theo cặp:
- **Không rollback riêng gateway** khi backend đang dùng `routeVersion`. Rollback gateway về ảnh cũ thì backend mới báo không có tuyến. Thứ tự: rollback backend trước (`vps.sh restore-env <backup>` hoặc bản backend cũ), rồi mới rollback gateway (`vps.sh rollback`); hoặc làm cả hai cùng lúc.
- Đổi cấu hình profile của gateway (`M14_SHORTEST`, tham số costing): `routeVersion` đổi theo. Backend giữ tuyến đã nhớ trong bộ nhớ tối đa 5 phút; để xóa ngay, **restart backend** (`systemctl restart 11ship-staging`) sau khi đổi gateway. Backend cũng xóa cache khi thấy version mới từ gateway.
- Cờ rollback `M14_SHORTEST=0` là cấu hình gateway (compose); áp dụng theo cặp trên.

Các bước đầu của runbook (`load`, `up`, `connect`) không đổi; chỉ bổ sung kiểm tra `check` ở bước 2.

## Gate trong luồng deploy backend thật, probe khi khởi động, quy tắc phiên bản dữ liệu (P6-1 vòng 2)

**Deploy backend thật** là workflow `deploy-vps` → `scripts/deploy/github-vps-deploy.sh` → `scripts/deploy/vps-update.py update` trên VPS. Khi `M14_ROUTING_ORIGIN` đã cấu hình trong `/etc/11ship/staging.env`:
- `update` chạy **gate gateway** (`ops/m14/gateway-gate.sh`, cùng hàm với `vps.sh check`) ngay sau khi giải nén release, **trước** bật timer, backup, migrate và restart. Gate đỏ → deploy dừng, không có gì thay đổi, thông báo lý do.
- `rollback` (quay về release trước) chạy cùng gate **trước** khi đổi code: cặp backend↔gateway phải hợp lệ trước khi quay về. Gate script lấy từ release đang bị thay thế (mới hơn).
- Khi chưa cấu hình routing, gate không chạy (không đổi hành vi cũ).
- Nếu không có gate trong release (release cũ), `update` dừng: nâng release có gate trước.

**Probe phía backend** (`apps/backend/src/delivery/m14-gateway-probe.ts`): lúc khởi động, backend hỏi `/health` của gateway **không chặn** việc khởi động. Gateway không sẵn sàng hoặc thiếu `routeVersion` hợp lệ → log ERROR một lần (thiếu/sai version) hoặc WARN một lần (chưa sẵn sàng/không tới được). Probe không đổi tuyến; route vẫn "chưa có tuyến" cho đến khi gateway đạt. Không có endpoint readiness nội bộ mới: readiness công khai không phụ thuộc gateway, để gateway tạm tắt không kéo backend ra khỏi luồng.

**Quy tắc phiên bản dữ liệu (routeVersion = engine + profile digest + M14_DATA_VERSION):**
- Bất kỳ thay đổi nào của **image Valhalla**, **configure/build graph** hoặc **PBF** đều **BẮT BUỘC đổi `M14_DATA_VERSION`** trước khi nâng. Nếu không, `routeVersion` giữ nguyên trong khi tuyến đã khác, và backend không phát hiện được.
- `vps.sh check` cảnh báo khi image đổi mà `routeVersion` không đổi (so với lần kiểm tra trước trên máy này). Cảnh báo là cần thiết, không thay thế quy tắc trên.
- Đổi tham số profile (shortest, highways, snapping) tự đổi `routeVersion` nhờ digest; không cần đổi `M14_DATA_VERSION`.

**Backlog (chưa làm):** manifest bất biến băm image digest + cấu hình graph vào `routeVersion`; deploy script riêng cho gateway (hiện nâng gateway bằng `vps.sh`, gate chỉ chặn ở phía backend).

**Giới hạn đã biết:** probe chỉ chạy lúc khởi động (gateway hỏng sau đó được thấy qua route "chưa có tuyến", không có log riêng); cache tuyến của backend tối đa 5 phút, `restart` backend xóa cache ngay sau khi đổi gateway.

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
