# Nhóm 20 — Giám sát VPS, probe độc lập và báo cáo vận hành (#247, #264)

## 1. Trạng thái & Quản trị thực thi

- **PR**: `#274` — nhánh `handoff/g20-ops-monitoring` (base `main`).
- **Issue nguồn**:
  - [#247](https://github.com/trungtn87/11ship/issues/247) — `[M13][Ops] Giám sát tài nguyên VPS thực tế trên Web Admin + cảnh báo Discord`
  - [#264](https://github.com/trungtn87/11ship/issues/264) — `[M13][Review P1/P2][OWNER LOCK] Probe ngoài VPS + Discord là điều kiện nghiệm thu; nối báo cáo deploy, APK và lỗi Android`
- **Tài liệu đối chiếu**:
  - [AGENTS.md](../../AGENTS.md), [docs/ai-governance/README.md](../ai-governance/README.md), [docs/ai-governance/AGENT-EXECUTION-CHECKLIST.md](../ai-governance/AGENT-EXECUTION-CHECKLIST.md)
  - [docs/process/11ship-delivery-workflow.md](../process/11ship-delivery-workflow.md)
  - [docs/current/M13-owner-checklist-20261023.md](../current/M13-owner-checklist-20261023.md)
  - [docs/current/M13-implementation-20261023.md](../current/M13-implementation-20261023.md)
  - [docs/current/M13-apk-backend-compat-20261025.md](../current/M13-apk-backend-compat-20261025.md)
  - [ops/runbooks/m13-external-probe-20261023.md](../../ops/runbooks/m13-external-probe-20261023.md)
  - [ops/runbooks/m13-backup-deploy-reporter-20261023.md](../../ops/runbooks/m13-backup-deploy-reporter-20261023.md)

---

## 2. Nguyên tắc thiết kế lại Nhóm 20

1. **Tái sử dụng trọn vẹn nền tảng M13 đã merge trên `main` (`#190`, `#193`/`#196`)**:
   - Đã có sẵn schema [`database/migrations/1795737600000_create-m13-ops.sql`](../../database/migrations/1795737600000_create-m13-ops.sql) (`app.ops_checks`, `app.ops_metrics`, `app.ops_metrics_hourly`, `app.ops_incidents`, `app.ops_notifications`, `app.ops_ingest_keys`, `app.ops_deploys`, `app.ops_client_error_logs`), bộ thu thập [`OpsCollector`](../../apps/backend/src/ops/ops-collector.ts) và [`NodeSystemProbe`](../../apps/backend/src/ops/ops-system-probe.ts).
   - **Không dựng hệ thống thu thập/cảnh báo thứ hai** hay tạo bảng trùng lặp: mở rộng trực tiếp `NodeSystemProbe` + `OpsCollector` + `OpsRepository` + `OpsAdminService` và nối `recentMetrics()` / `hourlyMetrics()` ra API + giao diện Web Admin.
2. **Tách bạch 4 gói kỹ thuật trong repo/CI (`G20-A` → `G20-D`) và Cổng nghiệm thu Hạ tầng (`G20-Ops`)**:
   - Mọi yêu cầu về code backend, API, UI Web Admin, workflow GitHub Actions và instrumentation lỗi Android được hoàn tất trong PR `#274` qua 4 gói `G20-A`, `G20-B`, `G20-C`, `G20-D`.
   - Các điều kiện cần máy ngoài VPS, Discord webhook độc lập, GitHub secret và thiết bị Android thật được quản lý minh bạch tại `G20-Ops`, hiển thị trạng thái trung thực trên Web Admin (tuyệt đối không giả lập đã cấu hình khi chưa có hạ tầng/secret).

---

## 3. Thiết kế chi tiết 4 gói kỹ thuật (Triển khai trong PR #274)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     NHÓM 20 (#247 + #264) — PR #274                          │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ G20-A (#247)                         │ G20-B (#264 Mục 0 & I)                │
│ Giám sát tài nguyên VPS + Lịch sử    │ Probe độc lập ngoài VPS &             │
│ • Mở rộng NodeSystemProbe (/proc)    │ Trạng thái cấu hình trung thực        │
│ • Tách rõ Backend 11Ship vs Postgres │ • 4 trạng thái: NOT_CONFIGURED,       │
│ • Biểu đồ 1h / 24h / 7d / 30d (gaps) │   WAITING_FIRST_REPORT, ACTIVE, STALE │
│ • Ngưỡng cảnh báo Discord + mất mẫu  │ • Ghi rõ webhook probe lưu ở máy ngoài│
├──────────────────────────────────────┼───────────────────────────────────────┤
│ G20-C (#264 Mục II & III)            │ G20-D (#264 Mục IV)                   │
│ Báo cáo Deploy CI & Rõ nghĩa APK     │ Instrumentation lỗi Android thực tế   │
│ • Nối ops-report.mjs vào deploy-vps  │ • Nối OpsClient.record cho:           │
│ • Hỗ trợ SHA 40 ký tự + idempotent   │   ACTION_ERROR, MAP_ERROR,            │
│ • Bỏ nút "Triển khai (SYSTEM)" bị mờ │   ROUTE_ERROR, GPS_STALE, PUSH_ERROR  │
│ • Tách "Đã phát hành" vs "Đang chạy" │ • Giữ nguyên khử nhạy cảm & chống bão │
└──────────────────────────────────────┴───────────────────────────────────────┘
```

### Gói `G20-A` — Giám sát tài nguyên VPS thực tế & Cảnh báo Discord (#247 tích hợp vào M13)

#### A1. Mở rộng `OpsSystemProbe` & `NodeSystemProbe` (Read-only, không `exec` shell)
- File mục tiêu: [`apps/backend/src/ops/ops-system-probe.ts`](../../apps/backend/src/ops/ops-system-probe.ts)
- Chỉ đọc từ `/proc` (trên Linux VPS) và API chuẩn `node:os` / `node:fs` (`statfsSync`), hoàn toàn không chạy lệnh shell hoặc cho phép tham số từ client:
  - **Host Summary**:
    - `uptime_seconds`: `Math.floor(os.uptime())`.
    - `cpu_percent` (tính từ delta `/proc/stat`), `cpu_cores` (`os.cpus().length`), `load_avg`: `[load1m, load5m, load15m]` từ `/proc/loadavg` / `os.loadavg()`.
    - **Memory & Swap** (từ `/proc/meminfo` + fallback `os.totalmem()`/`os.freemem()`): `total_bytes`, `available_bytes`, `used_bytes`, `used_percent`, `swap_total_bytes`, `swap_used_bytes`, `swap_percent`.
    - **Disk & I/O**: với mỗi mount trong `OPS_DISK_PATHS`, trả `label`, `path`, `total_bytes`, `free_bytes`, `used_bytes`, `used_percent` (qua `statfsSync`) và tổng `io_read_bytes`, `io_write_bytes` (nếu đọc được từ `/proc/diskstats`).
    - **Network**: đọc `/proc/net/dev` (bỏ `lo`), trả `rx_bytes_total`, `tx_bytes_total`, `rx_bytes_per_sec`, `tx_bytes_per_sec` (tính từ delta giữa 2 lần lấy mẫu).
  - **Top Processes theo CPU & RAM (Đã khử thông tin nhạy cảm)**:
    - Quét giới hạn tối đa các thư mục số `/proc/[pid]/stat` và `/proc/[pid]/status` (timeout ngắn, bỏ qua PID đã thoát).
    - Chỉ trích xuất `pid`, `name` (tên thực thi ngắn từ `comm` / `Name:`, tối đa 32 ký tự), `cpu_percent`, `rss_bytes`, `memory_percent`.
    - **Bảo mật bắt buộc**: Tuyệt đối **không đọc** `/proc/[pid]/cmdline` hay `/proc/[pid]/environ` để không bao giờ lộ token, mật khẩu, connection string hoặc tham số nhạy cảm.
  - **Tách riêng trạng thái Backend 11Ship và PostgreSQL**:
    - **Backend 11Ship**: `status` (`OK` / `WARN` / `CRITICAL`), `pid` (`process.pid`), `uptime_seconds` (`Math.floor(process.uptime())`), `rss_bytes`, `heap_used_bytes`, `cpu_percent`, `self_health_latency_ms`.
    - **PostgreSQL**: kiểm tra độc lập qua pool DB: `status` (`OK` / `WARN` / `CRITICAL`), `latency_ms` (`SELECT 1`), `active_connections` (`SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()`), `database_size_bytes` (`SELECT pg_database_size(current_database())::bigint`). Tuyệt đối không trả chuỗi kết nối DB.

#### A2. Chu kỳ lấy mẫu, Lưu trữ & Lịch sử `1h / 24h / 7d / 30d`
- File mục tiêu:
  - [`apps/backend/src/ops/ops-collector.ts`](../../apps/backend/src/ops/ops-collector.ts)
  - [`apps/backend/src/ops/ops-repository.ts`](../../apps/backend/src/ops/ops-repository.ts)
  - [`apps/backend/src/ops/ops-admin-service.ts`](../../apps/backend/src/ops/ops-admin-service.ts)
- **Không làm phình DB nghiệp vụ**:
  - Giữ bộ đệm vòng trong bộ nhớ (in-memory ring buffer tối đa 120 mẫu gần nhất) cho snapshot tức thời và biểu đồ `1h` độ phân giải cao.
  - Mỗi chu kỳ thu thập ghi các metric cốt lõi (`cpu_percent`, `memory_percent`, `swap_percent`, `load_1m`, `disk.<label>`, `net_rx_bps`, `net_tx_bps`, `db_latency_ms`, `db_connections`, `db_size_bytes`, `api_latency_ms`) vào `app.ops_metrics` và tự động gộp mẫu cũ vào `app.ops_metrics_hourly` theo đúng cơ chế retention M13 (`metrics_detail_days = 7`, `metrics_hourly_days = 90`).
  - Hỗ trợ truy vấn lịch sử theo 4 khung:
    - `1h`: lấy từ `app.ops_metrics` (bước kỳ vọng `60s`, hoặc `30s` khi có mẫu).
    - `24h`: lấy từ `app.ops_metrics` gộp theo bucket 15 phút (bước kỳ vọng `900s`).
    - `7d`: lấy từ `app.ops_metrics` / `app.ops_metrics_hourly` theo bucket 1 giờ (bước kỳ vọng `3600s`).
    - `30d`: lấy từ `app.ops_metrics_hourly` theo bucket 6 giờ hoặc 1 giờ (bước kỳ vọng `3600s` / `21600s`).
  - **Hiển thị rõ khoảng trống khi thiếu mẫu**: API trả về danh sách điểm dữ liệu kèm `expected_step_seconds` và `gap_count`; frontend ngắt nét vẽ tại các khoảng trống lớn hơn `2 × expected_step_seconds` và hiển thị rõ trạng thái thiếu mẫu, không tự nội suy đường thẳng giả.

#### A3. Ngưỡng cảnh báo mặc định & Phát hiện mất tín hiệu bộ thu thập
- File mục tiêu:
  - [`apps/backend/src/ops/ops-settings.ts`](../../apps/backend/src/ops/ops-settings.ts)
  - [`apps/backend/src/ops/ops-monitors.ts`](../../apps/backend/src/ops/ops-monitors.ts)
- Chuẩn hóa ngưỡng mặc định theo `#247` (vẫn cho phép `SYSTEM` điều chỉnh trên trang Cấu hình):
  - `server.cpu_percent = 85` (duy trì liên tục 5 phút / `sustained_seconds = 300`).
  - `server.memory_percent = 90` (tương đương RAM khả dụng `< 10%`, duy trì liên tục 5 phút / `sustained_seconds = 300`).
  - `server.disk_warn_percent = 85`, `server.disk_critical_percent = 95`.
  - Backend 11Ship (`api`) hoặc PostgreSQL (`database`) không phản hồi: mở sự cố `CRITICAL` sau 3 nhịp liên tiếp và gửi cảnh báo Discord + thông báo `RESOLVED` khi hồi phục.
  - **Mất mẫu giám sát `> 3 phút` (`180s`)**: đánh dấu `collector_stale: true` (*"Mất tín hiệu bộ thu thập > 3 phút"*), hiển thị cảnh báo rõ trên Web Admin nhưng không tự kết luận VPS sập nếu chưa có tín hiệu từ Probe ngoài VPS.

#### A4. API & Giao diện Web Admin
- File mục tiêu:
  - [`apps/backend/src/ops/ops-admin.controller.ts`](../../apps/backend/src/ops/ops-admin.controller.ts)
  - [`apps/admin-web/src/core/ops.ts`](../../apps/admin-web/src/core/ops.ts)
  - [`apps/admin-web/src/core/ops-api.ts`](../../apps/admin-web/src/core/ops-api.ts)
  - [`apps/admin-web/src/core/routes.ts`](../../apps/admin-web/src/core/routes.ts)
  - [`apps/admin-web/src/core/menu.ts`](../../apps/admin-web/src/core/menu.ts)
  - [`apps/admin-web/src/dom/ops-view.ts`](../../apps/admin-web/src/dom/ops-view.ts)
- **Endpoint**: `GET /v1/admin/ops/vps?range=1h|24h|7d|30d`
  - Chỉ đọc (`GET`), kiểm tra quyền M13 (`SYSTEM` hoặc `ADMIN` có scope `VIEW`/`HANDLE` trên module `M13`; trả `403 ADMIN_FORBIDDEN` cho tài khoản không đủ quyền).
- **UI Web Admin**:
  - Tại **Vận hành hệ thống → Tổng quan** (`/system-ops`): hiển thị thẻ tóm tắt tài nguyên VPS (CPU, RAM, Disk, Uptime, PostgreSQL connections & DB size) kèm nút mở trang chi tiết.
  - Thêm mục menu & route **Vận hành hệ thống → Giám sát VPS** (`/system-ops/vps`):
    - Khối trạng thái tín hiệu thu thập (Đang hoạt động / Mất tín hiệu `> 3 phút`) & thời điểm cập nhật gần nhất.
    - Thẻ chỉ số Host: Uptime, CPU (`%`, số core, Load 1/5/15m), RAM (`used/available/total` + Swap), Disk (`used/free/%` + I/O), Network (`RX/TX rate & total`).
    - Khối tách biệt **Dịch vụ Backend 11Ship** và **Dịch vụ PostgreSQL** (trạng thái, độ trễ, số kết nối active, dung lượng DB).
    - Biểu đồ lịch sử chuyển đổi `1 giờ` / `24 giờ` / `7 ngày` / `30 ngày` có đánh dấu khoảng trống khi mất mẫu.
    - Bảng **Top tiến trình theo CPU & RAM** (chỉ đọc, đã khử thông tin nhạy cảm).

---

### Gói `G20-B` — Probe độc lập ngoài VPS & Trạng thái cấu hình trung thực (#264 Mục 0 & I)

- File mục tiêu:
  - [`ops/external-probe/probe.mjs`](../../ops/external-probe/probe.mjs)
  - [`apps/backend/src/ops/ops-ingest-service.ts`](../../apps/backend/src/ops/ops-ingest-service.ts)
  - [`apps/backend/src/ops/ops-admin-service.ts`](../../apps/backend/src/ops/ops-admin-service.ts)
  - [`apps/admin-web/src/dom/ops-view.ts`](../../apps/admin-web/src/dom/ops-view.ts)
- **Chuẩn hóa trạng thái `external_probe` trên `GET /v1/admin/ops/overview` và `GET /v1/admin/ops/config`**:
  - Đối chiếu thực tế từ bảng `app.ops_ingest_keys` (`key_kind = 'PROBE'`, `revoked_at IS NULL`) và `app.ops_checks` (`CHECK_EXTERNAL_PROBE`, `CHECK_PUBLIC_API`):
    1. `NOT_CONFIGURED`: chưa có khóa `PROBE` nào đang hoạt động.
    2. `WAITING_FIRST_REPORT`: đã tạo khóa `PROBE` nhưng chưa nhận được nhịp báo cáo nào từ máy probe.
    3. `ACTIVE`: có khóa `PROBE` và `last_report_at` trong vòng 15 phút (`<= 900s`).
    4. `STALE`: đã từng nhận báo cáo nhưng quá 15 phút không có nhịp mới.
  - Trả kèm: `active_key_count`, `last_report_at`, `last_key_used_at`, `last_public_api_status`, `last_outage_at`, `runbook_path: 'ops/runbooks/m13-external-probe-20261023.md'`, và `discord_webhook_status: 'EXTERNAL_HOST_ONLY'`.
- **Hiển thị trung thực trên Web Admin**:
  - Trên cả trang **Tổng quan** (`/system-ops`) và **Cấu hình** (`/system-ops/config`), hiển thị rõ 1 trong 4 trạng thái trên kèm thời điểm nhận báo cáo gần nhất, thời điểm ghi nhận sự cố gần nhất và ghi chú rõ:
    *"Webhook Discord của probe được lưu riêng trên máy probe (quyền 0600) để gửi cảnh báo ngay cả khi VPS sập — VPS không lưu và không giả lập trạng thái của webhook này."*

---

### Gói `G20-C` — Nối báo cáo Deploy Pipeline & Làm rõ trạng thái APK (#264 Mục II & III)

- File mục tiêu:
  - [`apps/backend/src/ops/ops-validation.ts`](../../apps/backend/src/ops/ops-validation.ts)
  - [`apps/backend/src/ops/ops-ingest-service.ts`](../../apps/backend/src/ops/ops-ingest-service.ts)
  - [`scripts/ops-report.mjs`](../../scripts/ops-report.mjs)
  - [`.github/workflows/deploy-vps.yml`](../../.github/workflows/deploy-vps.yml)
  - [`apps/admin-web/src/dom/ops-view.ts`](../../apps/admin-web/src/dom/ops-view.ts)
- **Hỗ trợ SHA 40 ký tự & Idempotency cho báo cáo Deploy**:
  - Mở rộng `VERSION_NAME` trong [`ops-validation.ts`](../../apps/backend/src/ops/ops-validation.ts) từ 32 lên 64 ký tự để chấp nhận cả mã phiên bản phát hành (`2026.10.30.1`) lẫn Git commit SHA 40 ký tự.
  - Trong [`ops-ingest-service.ts`](../../apps/backend/src/ops/ops-ingest-service.ts), nếu `deployStart` được gọi lặp lại cho cùng `to_version` đang ở trạng thái `STARTED` trong vòng 30 phút gần nhất thì trả lại chính `id` đang mở thay vì tạo bản ghi trùng lặp.
- **Nối vào workflow [`.github/workflows/deploy-vps.yml`](../../.github/workflows/deploy-vps.yml)**:
  - Thêm bước báo `deploy-start` trước khi chạy cập nhật VPS và bước `deploy-finish` (`if: always()`) sau khi kiểm tra health, truyền đúng trạng thái `SUCCEEDED` / `FAILED` và `health_result` (`PASSED` / `FAILED`).
  - Nếu GitHub Secret `OPS_DEPLOY_INGEST_TOKEN` chưa được cấu hình, ghi thông báo rõ trong GitHub Step Summary mà không làm hỏng bước deploy và tuyệt đối không in secret ra log.
- **Chuẩn hóa giao diện `Phiên bản & cập nhật` (`/system-ops/releases`)**:
  - **Loại bỏ nút `Triển khai (SYSTEM)` (đang disabled)** tại [`ops-view.ts`](../../apps/admin-web/src/dom/ops-view.ts) theo đúng chốt của Owner (*"Không thêm nút Deploy trên Admin Web"*).
  - Tách nhãn rõ ràng giữa **"APK đã phát hành trên máy chủ (`PUBLISHED`)"** và **"Thiết bị đã báo đang chạy (60 ngày qua)"** để không gây hiểu nhầm rằng phát hành APK trên server đồng nghĩa điện thoại người dùng đã cài đặt.

---

### Gói `G20-D` — Nối Instrumentation lỗi Android thực tế (#264 Mục IV)

- File mục tiêu:
  - [`mobile/packages/n11_shared/lib/src/m13/m13_ops.dart`](../../mobile/packages/n11_shared/lib/src/m13/m13_ops.dart)
  - [`mobile/packages/n11_shared/lib/src/m08/m08_push.dart`](../../mobile/packages/n11_shared/lib/src/m08/m08_push.dart)
  - [`mobile/packages/n11_shared/lib/src/flows/location.dart`](../../mobile/packages/n11_shared/lib/src/flows/location.dart)
  - [`mobile/packages/n11_shared/lib/src/addresses/place_search.dart`](../../mobile/packages/n11_shared/lib/src/addresses/place_search.dart)
  - [`mobile/packages/n11_shared/lib/src/m07/m07_http.dart`](../../mobile/packages/n11_shared/lib/src/m07/m07_http.dart)
  - [`mobile/packages/n11_shared/lib/src/m10/m10_http.dart`](../../mobile/packages/n11_shared/lib/src/m10/m10_http.dart)
  - [`mobile/ship/lib/ship_online.dart`](../../mobile/ship/lib/ship_online.dart)
  - [`mobile/packages/n11_shared/test/m13_test.dart`](../../mobile/packages/n11_shared/test/m13_test.dart)
- **Thiết kế kết nối không gây spam và bảo toàn khử nhạy cảm**:
  - Bổ sung cổng tĩnh an toàn `OpsClient.report(...)` trong [`m13_ops.dart`](../../mobile/packages/n11_shared/lib/src/m13/m13_ops.dart) (tự động đi qua `ClientLogQueue` của phiên `OpsClient` hiện hành, khử mọi SĐT/GPS/token/số tiền/query URL qua `redactLogText`, chống trùng lặp trong cửa sổ 10 phút `recentWindow`, giới hạn hàng đợi 100 mục và batch 50 mục).
  - Nối đầy đủ 5 nhóm lỗi nghiệp vụ ngoài `CRASH`:
    1. `ACTION_ERROR`: khi thao tác ghi/chuyển trạng thái đơn hàng hoặc chuyến giao (`POST`/`PATCH`/`PUT`/`DELETE` trong `m07_http.dart`, `m10_http.dart`) gặp lỗi máy chủ hoặc phản hồi sai định dạng (`M07FailureKind.server` / `BAD_RESPONSE`).
    2. `MAP_ERROR`: khi tìm kiếm địa điểm/bản đồ trong `HttpPlaceSearchApi.search` hoặc lấy vị trí một lần (`MethodChannelLocationProvider.currentFix` lỗi `unavailable`/`timeout`) thất bại.
    3. `ROUTE_ERROR`: tiện ích báo lỗi tính tuyến đường / định tuyến (`OpsClient.reportRouteError(...)`) và khi truy vấn lộ trình/ước tính giao hàng gặp lỗi.
    4. `GPS_STALE`: khi `ShipOnline` phát hiện vị trí tài xế bị cũ/ngưng phản hồi quá ngưỡng (`_staleTimer` / `LocationProblem.staleOrStopped`) trong lúc đang bật nhận chuyến hoặc đang giao.
    5. `PUSH_ERROR`: khi đăng ký hoặc đồng bộ push token trong `PushSync._register` gặp lỗi `NotificationFailure`.

---

## 4. Cổng nghiệm thu vận hành `G20-Ops` (Phân định rõ trách nhiệm Code vs Hạ tầng thật)

| Hạng mục nghiệm thu (#247 & #264) | Trạng thái trong PR #274 (Code & Test) | Điều kiện cần khi nghiệm thu Hạ tầng thật (`G20-Ops`) |
| :--- | :--- | :--- |
| **1. Giám sát VPS + Biểu đồ `1h/24h/7d/30d` + Cảnh báo nội bộ (#247)** | Hoàn tất trong `G20-A` (Backend `/proc` probe, API `/v1/admin/ops/vps`, UI `/system-ops/vps`, cảnh báo quá ngưỡng & mất mẫu `> 3 phút`) | Deploy PR `#274` lên VPS; cấu hình Discord webhook nội bộ trên trang Cấu hình M13 (nếu chưa đặt `OPS_INTERNAL_DISCORD_WEBHOOK_URL`) |
| **2. Probe độc lập ngoài VPS + Cảnh báo Discord khi VPS sập (#264 Mục 0 & I)** | Hoàn tất trong `G20-B` (Daemon `ops/external-probe/probe.mjs`, ingest `/v1/ops/ingest/probe`, 4 trạng thái trung thực trên UI) | **Cần hạ tầng ngoài VPS**: cài `11ship-probe.service` trên 1 máy ngoài VinaHost + gắn Discord webhook riêng trên máy đó + tạo khóa `PROBE` trên Web Admin |
| **3. Báo cáo Deploy tự động từ GitHub Actions (#264 Mục II)** | Hoàn tất trong `G20-C` (Nối `scripts/ops-report.mjs` vào `.github/workflows/deploy-vps.yml`, xóa nút Deploy bị mờ trên UI) | Tạo khóa `DEPLOY` trên Web Admin và lưu vào GitHub Environment secret `OPS_DEPLOY_INGEST_TOKEN` |
| **4. Cập nhật APK tại chỗ & Tách nhãn trạng thái APK (#264 Mục III)** | Hoàn tất trong `G20-C` (Giữ nguyên regression `#193`/`#196`, làm rõ nhãn *"Đã phát hành trên máy chủ"* vs *"Thiết bị đã báo đang chạy"*) | Khi phát hành APK thật: cấu hình `OPS_ARTIFACT_DIR` trên VPS và kiểm thử nâng cấp `vN -> vN+1` trên thiết bị Android thật |
| **5. Báo cáo lỗi Android thực tế (#264 Mục IV)** | Hoàn tất trong `G20-D` (Nối đủ `CRASH`, `ACTION_ERROR`, `MAP_ERROR`, `ROUTE_ERROR`, `GPS_STALE`, `PUSH_ERROR` + unit tests) | Có mặt trong bản build APK tiếp theo từ `main` sau khi merge PR `#274` |

---

## 5. Danh mục file dự kiến cập nhật trong PR #274

- **Tài liệu**:
  - `docs/handoffs/20261030-g20-ops-monitoring.md`
- **Backend (`apps/backend`)**:
  - `apps/backend/src/ops/ops-system-probe.ts`
  - `apps/backend/src/ops/ops-collector.ts`
  - `apps/backend/src/ops/ops-settings.ts`
  - `apps/backend/src/ops/ops-monitors.ts`
  - `apps/backend/src/ops/ops-repository.ts`
  - `apps/backend/src/ops/ops-admin-service.ts`
  - `apps/backend/src/ops/ops-admin.controller.ts`
  - `apps/backend/src/ops/ops-validation.ts`
  - `apps/backend/src/ops/ops-ingest-service.ts`
  - `apps/backend/src/ops/ops-views.ts`
  - `apps/backend/src/ops/__tests__/ops-m13.test.ts`
- **CI / Scripts**:
  - `.github/workflows/deploy-vps.yml`
  - `scripts/ops-report.mjs`
- **Admin Web (`apps/admin-web`)**:
  - `apps/admin-web/src/core/routes.ts`
  - `apps/admin-web/src/core/menu.ts`
  - `apps/admin-web/src/core/ops.ts`
  - `apps/admin-web/src/core/ops-api.ts`
  - `apps/admin-web/src/dom/ops-view.ts`
  - `apps/admin-web/src/dom/shell-app.ts`
  - `apps/admin-web/test/ops.test.ts`
- **Mobile (`mobile/`)**:
  - `mobile/packages/n11_shared/lib/src/m13/m13_ops.dart`
  - `mobile/packages/n11_shared/lib/src/m08/m08_push.dart`
  - `mobile/packages/n11_shared/lib/src/flows/location.dart`
  - `mobile/packages/n11_shared/lib/src/addresses/place_search.dart`
  - `mobile/packages/n11_shared/lib/src/m07/m07_http.dart`
  - `mobile/packages/n11_shared/lib/src/m10/m10_http.dart`
  - `mobile/ship/lib/ship_online.dart`
  - `mobile/packages/n11_shared/test/m13_test.dart`

---

## 6. Trạng thái triển khai (Claude Code, 2026-10-31)

| Gói | Trạng thái | Ghi chú |
| :--- | :--- | :--- |
| G20-A | Xong (code + test) | `GET /v1/admin/ops/vps`, `ops-vps.ts`, probe `/proc` chỉ đọc (không đọc `cmdline`/`environ`), trang `/system-ops/vps`, thẻ VPS ở Tổng quan, ngưỡng mặc định CPU 85 / đĩa 85-95, `collector_stale` > 180 s |
| G20-B | Xong | 4 trạng thái `external_probe` ở Tổng quan và Cấu hình, kèm ghi chú webhook chỉ nằm ở máy probe |
| G20-C | Xong phần repo/CI | Bỏ nút Deploy mờ, tách nhãn APK; `deploy-start` idempotent 30 phút; `deploy-vps.yml` nối `ops-report.mjs` (không có secret thì chỉ ghi Step Summary) |
| G20-D | Xong | `OpsClient.report/reportActionFailure/reportRouteError` + 5 điểm nối: ACTION_ERROR, MAP_ERROR, ROUTE_ERROR, GPS_STALE, PUSH_ERROR |
| G20-Ops | **Chưa làm (cần hạ tầng/Owner)** | Máy probe ngoài VPS + webhook riêng, khóa `PROBE`/`DEPLOY`, secret `OPS_DEPLOY_INGEST_TOKEN`, deploy VPS, APK build mới và thử trên máy thật |

### Chênh lệch so với thiết kế (quyết định kỹ thuật, cần ChatGPT/Owner biết)

1. **`VERSION_NAME` giữ 32 ký tự, workflow gửi 12 ký tự đầu của SHA.** Cột `app.ops_deploys.from_version/to_version`, `ops_releases.version_name` và `ops_version_reports.version_name` là `varchar(32)` (kèm CHECK regex `{0,31}`). Nhận SHA đầy đủ 40 ký tự cần migration mở rộng cột, tức là migration lên VPS cần Owner cho phép. Chưa làm; SHA đầy đủ vẫn nằm trong `note` của báo cáo deploy.
2. **Không có ring buffer 120 mẫu trong RAM.** Mẫu mới nhất lưu trong `app.ops_checks` (khóa `vps`) để mọi tiến trình đọc được cùng một số; lịch sử lấy từ `app.ops_metrics` (1 phút/mẫu) và `app.ops_metrics_hourly` (30 ngày), gộp bucket ngay trong SQL.
3. **Tên file test khác thiết kế**: repo dùng `*.spec.ts` (unit) và `tests/integration/m13-*.int.spec.ts`, không có `ops-m13.test.ts` / `apps/admin-web/test/ops.test.ts`.
4. **GPS_STALE** nối vào nhánh "vị trí chia sẻ không còn được máy chủ giữ" của `ShipOnline._onReporter` (repo không có `LocationProblem.staleOrStopped`).
5. Hai danh sách route phía server phải thêm `/system-ops/vps`: `apps/backend/src/http/admin-web-hosting.ts` và `scripts/admin-web-dev.mjs` (trình duyệt thật phát hiện, trước đó trả "Not found").

### Cách Owner nghiệm thu sau khi deploy
Web Admin → Vận hành hệ thống → **Giám sát VPS**: có số CPU/RAM/đĩa/mạng, Backend và PostgreSQL tách riêng, biểu đồ 1h/24h/7d/30d (dải gạch = thiếu mẫu). **Tổng quan** và **Cấu hình** hiện đúng một trong 4 trạng thái probe. **Phiên bản & cập nhật** không còn nút Deploy.
