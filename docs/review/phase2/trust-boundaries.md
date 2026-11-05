# G-7 Trust boundaries

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.


## 1. Bản đồ ranh giới

| # | Ranh giới | Bên ngoài → bên trong | Điều khiển thấy ở source | Trạng thái |
|---|---|---|---|---|
| T1 | Internet → API công khai | Khách chưa đăng nhập → 41 route không guard/transport | Xem §3: mỗi nhóm có cơ chế riêng (mode gate, limiter, token trong URL) | Mở source 4/13 nhóm |
| T2 | App (11Food/11Ship) → API | Phiên native → 167 route dùng `SessionAuthGuard` | `auth/session-auth.guard.ts:12-21` (ĐÃ MỞ SOURCE phần đầu): Bearer token mờ; phiên PASSWORD mới **không** cần chứng minh thiết bị, phiên native cũ giữ proof thiết bị (`ClientDeviceProofService`, tùy chọn) cho đến khi đăng nhập lại bằng mật khẩu; chữ ký trên body cần `rawBody` (`app.setup.ts:92,116` nạp `rawBody` theo prefix) | Guard chưa đọc từng dòng |
| T3 | Trình duyệt Admin → API | Cookie phiên + CSRF → khoảng 142 route qua `AdminTransport` trực tiếp hoặc qua hàm trợ giúp (Codex đếm độc lập theo block `@Controller`, 18 controller; script của Lead cho 129 khi chỉ tính handler gọi `transport.*`, và 154 nếu tính mọi route của controller có nhắc `AdminTransport`, gồm cả `BusinessClientController`) | `AdminTransport.read/write` (`admin-shippers/admin-shipper.controller.ts:42`) + service **kiểm quyền lần hai** trong lock (comment `admin-order.controller.ts:13-15`); `noStoreMiddleware` áp bằng `forRoutes(...)` (`admin-auth.module.ts:318-323`) | Một phần |
| T4 | Thiết bị SMS Gateway → API | Bearer 256-bit → 4 route `SmsGatewayController` | `SmsGatewayAuthGuard` (`sms-gateway/sms-gateway-auth.guard.ts:1-30`): chỉ nhận token thiết bị, 401 đồng nhất | ĐÃ MỞ SOURCE (phần đầu) |
| T5 | Backend → SMS Gateway | OTP đi qua hàng đợi, gateway kéo về | `SmsGatewayActivationOtpProvider`, `sms-queue-sweeper.ts` (30 s) | Chưa mở |
| T6 | Backend → Valhalla/M14 | `POST {origin}/route`, 2 điểm, `AbortSignal.timeout(config.timeoutMs)`, ngoài transaction, không fallback | `delivery/m14-route-client.ts:6-8,80-85` | ĐÃ MỞ SOURCE (không thấy xác thực/ TLS riêng: phụ thuộc mạng nội bộ VPS: ghi cho Phase 5) |
| T7 | Backend → PostgreSQL | `pg` pool; có `config.tls` thì `ssl:{ca, rejectUnauthorized:true}`, không có thì **không SSL** (local/CI) | `database/create-pool.ts:12-34` | ĐÃ MỞ SOURCE |
| T8 | Backend → FCM | OAuth JWT service account → `fcm.googleapis.com` | `notifications/push-provider.ts:61,104,152-176` | Một phần; FCM bị hoãn theo `M08-R-11` |
| T9 | Tác vụ nền / runner | 10 "runtime owner" định kỳ trong tiến trình API (xem components.md §3), không có API riêng | Components §3 | ĐÃ MỞ SOURCE |
| T10 | Runner CI/deploy → VPS; script vận hành | `deploy-vps.yml`, `recover-*.yml`, workflow; `scripts/` (ví dụ `admin-auth-init-limit-config.js` tạo HMAC rate limit, `admin-auth-bootstrap-system.js` tạo admin gốc, `sms-gateway-ctl.js`, `db-migrate.js` theo Antigravity) | Không nằm trong graph (YAML, script ngoài `apps`) | **CHƯA LÀM**; thuộc Phase 5. Ghi nhận thêm cổng khởi động `AdminLimitConfigVerifier` (`admin-limit-config-verifier.ts:19-34`): backend từ chối chạy nếu cấu hình HMAC rate limit không khớp DB |
| T11 | Upload (ảnh món, logo, bằng chứng) | Base64 trong JSON, giới hạn 2 MB/3,5 MB/7,5 MB theo route | `app.setup.ts:68-85,98-104` | ĐÃ MỞ SOURCE |

## 2. Phân loại cơ chế xác thực của 412 route (script, `HEURISTIC`)

| Cơ chế | Số route |
|---|---|
| UseGuards(SessionAuthGuard) | 167 |
| AdminTransport (cookie+CSRF) | 129 theo script (**cận dưới**: bỏ route gọi qua hàm trợ giúp như `#run`/`write`); Codex độc lập: 142 |
| trong handler (heuristic) | 71 |
| không thấy cơ chế (public hoặc cơ chế khác) | 41 |
| UseGuards(SmsGatewayAuthGuard) | 4 |

"trong handler (heuristic)" = handler gọi hàm tên có `session/auth/principal/transport…`; đây **không** chứng minh có kiểm quyền. Phase 5 phải đọc từng route. Con số route công khai (41) là cận trên cho "không guard/transport": một số có cơ chế khác (ví dụ token trong URL).

## 3. Route công khai theo nhóm (`ĐÃ MỞ SOURCE` đánh dấu ở ghi chú)

| Controller | Route | Cơ chế / ghi chú |
|---|---|---|
| `AccountRecoveryController` | GET config, POST reset-test, POST otp, POST otp/:verificationId/verify, POST reset, GET locked/config … | `reset-test`: `assertOpen()` trả 503 trừ khi `accountRecoveryMode=DISABLED_TEST` (`account-recovery-service.ts:101-105,373-374`, ĐÃ MỞ SOURCE). Các route OTP: `assertSmsOtpOpen()` + công tắc DB `otp_password_reset_enabled`; **chưa mở** limiter theo SĐT/IP |
| `AdminAccountRecoveryController` | GET config, POST reset-test, POST otp, POST otp/:verificationId/verify, POST reset | như trên nhưng scope ADMIN_WEB; cùng cơ chế gate theo mode. Chưa mở |
| `AuthController` | POST phone-verifications, GET phone-verifications/:verificationId, POST phone-verifications/:verificationId/verify, POST register, POST login | API legacy `/v1/auth/*` (đăng ký/đăng nhập/OTP): công khai. Chưa mở limiter |
| `ClientAuthController` | GET config, POST register, POST login | logout cố ý không guard: guard từ chối phiên đã thu hồi mà logout phải trả 204 để retry; service tự xác thực token (`client-auth.controller.ts:152-166`, ĐÃ MỞ SOURCE). `login`, `register`, `config`: công khai theo thiết kế (chưa mở limiter) |
| `ClientDeviceController` | POST challenges, POST registrations | công khai: thách thức và đăng ký thiết bị (nền của chữ ký thiết bị). Chưa mở |
| `DeliveryTrackingPublicController` | GET public/tracking/:token, GET track/:token | công khai bằng token trong URL (`/track/:token`, `/public/tracking/:token`); có `setInterval` ở `:214`. Chưa mở xác thực token |
| `DiscoveryController` | GET service-areas, GET service-areas/resolve, GET menu-categories, GET discovery/shops, GET discovery/dishes | công khai: khám phá quán/món, khu vực |
| `DiscoveryRouteController` | POST route-distances | công khai; không lưu gì; giới hạn đồng thời `MAX_CONCURRENT_ROUTES`, hàng đợi `MAX_QUEUED_ROUTES`, chỉ trả cho quán `publicVisible` (`discovery-route-service.ts:44-80`, ĐÃ MỞ SOURCE). **Không** có giới hạn theo IP/phiên: ghi nhận cho Phase 5 |
| `HealthController` | GET live, GET ready | công khai: live/ready |
| `MenuPublicController` | GET shops/:shopId, GET menu-images/:imageId | công khai: thực đơn công khai, ảnh món |
| `OpsClientController` | GET app-updates/check, GET app-updates/compatibility, GET app-updates/download/:release_id | công khai: kiểm tra phiên bản app (`M13-R-05` yêu cầu guest được kiểm). `app-updates/download/:release_id` chưa mở |
| `PublicReviewController` | GET shops/:shop_id/reviews | công khai: đánh giá của quán |
| `ShopLogoController` | GET :shopId/logo | công khai: logo quán |

## 3b. T10: workflow GitHub Actions và script vận hành (ĐÃ MỞ phần `on:`/quyền/secrets/checkout; KHÔNG đọc từng bước)

Bổ sung sau review (trước đó ghi CHƯA LÀM). 11 workflow ở `.github/workflows/`:

| Workflow | Kích hoạt | Quyền | Secrets / môi trường | Ghi chú |
|---|---|---|---|---|
| `ci.yml` | PR, push `main`, tay | `contents: read` | không | `ubuntu-24.04`, `windows-2022` |
| `deploy-vps.yml` | **chỉ tay** (`workflow_dispatch`) | `contents: read` | môi trường `vps-production`; `VPS_SSH_PRIVATE_KEY`, `VPS_KNOWN_HOSTS`, `OPS_DEPLOY_INGEST_TOKEN` | job `ci-gate` (`:31,57`) chạy `scripts/deploy/ci-gate.mjs` rồi deploy `needs: ci-gate`, checkout `ref: needs.ci-gate.outputs.sha` (`:60,70`) |
| `diagnose-vps-release.yml` | chỉ tay | `contents: read` | `vps-production`; SSH key | truy cập VPS bằng SSH |
| `ai-governance.yml` | `pull_request_target` | `contents: read`, `pull-requests: read` | không | checkout nhánh mặc định, không chạy mã PR (`:3,20-22`) |
| `update-progress.yml` | PR, `pull_request_target`, `push`, `workflow_run`, tay | `permissions: {}` ở cấp file | `GITHUB_TOKEN` | mọi `checkout` dùng `ref: default_branch` (`:75,108-110,135-137,174-176,219-221`); xử lý nhãn review |
| `no-skip-ci.yml` | PR | `contents: read` | không | chặn marker bỏ qua CI |
| `mobile-apk.yml` | chỉ tay | `contents: read` | keystore Android (4), `FCM_FOOD_API_KEY`, `FCM_SHIP_API_KEY` | phát hành APK |
| `sms-gateway-apk.yml` | tay, PR theo path | `contents: read` | keystore Android (4) | |
| `m14-gps-test.yml` | push `codex/m14-gps-test`, PR theo path | **`contents: write`** | keystore Android (4) | quyền ghi |
| `m14-android-runtime.yml` | push `codex/m14-runtime-check`, tay | **`contents: write`**, `actions: read` | không | quyền ghi |
| `m14-flutter-runtime.yml` | push `codex/m14-gps-test` theo path | `contents: read` | không | |

Quan sát (chưa phải finding; Phase 5 đọc từng bước): (1) hai workflow `pull_request_target` đều checkout nhánh mặc định, phù hợp ghi chú trong file; chưa đọc các bước chạy script; (2) hai workflow M14 có `contents: write`; (3) `deploy-vps.yml` đúng với `AGENTS.md`: ci-gate + môi trường `vps-production`; (4) workflow bản trước ghi trong Phase 0 `recover-vps-*.yml` **không còn** trong thư mục; (5) các workflow chạy APK dùng keystore trong secrets.

Script vận hành `scripts/` (ngoài `apps`, không vào graph), chỉ liệt kê: `admin-auth-init-limit-config.js`, `admin-auth-bootstrap-system.js`, `admin-auth-recover-system.js`, `db-migrate.js`, `db-migrate-remote.js`, `db-remote-target.js`, `ops-ctl.js`, `sms-gateway-ctl.js`, `staging-seed-fixtures.js`, `staging-db-upgrade-from-42.js`, `android-attestation-refresh.mjs`, `deploy/` (gồm `ci-gate.mjs`), `native-gateway*.mjs`, `test-sms-inbox.mjs`. **Chưa đọc nội dung** (đặc biệt `admin-auth-recover-system.js`, `db-migrate-remote.js`, `staging-seed-fixtures.js`).

## 4. Điểm cần Phase 5 xem kỹ (ghi nhận, chưa phải finding)
1. `POST /v1/discovery/route-distances` không xác thực, mỗi lần gọi đến 20 quán × một lần Valhalla; chỉ có hạn mức đồng thời toàn hệ thống (`discovery-route-service.ts`). Chưa thấy hạn mức theo IP.
2. `reset-test` (hai scope) chỉ có một cổng: biến cấu hình `accountRecoveryMode`. Nếu cấu hình sai trên môi trường thật thì đổi mật khẩu không cần OTP. Cần xác nhận cấu hình VPS (không thuộc graph).
3. Cookie Admin + CSRF: `AdminTransport` nằm trong `admin-shipper.controller.ts` nhưng được import bởi nhiều controller khác (ví dụ `admin-order.controller.ts:4`); một thay đổi ở đó ảnh hưởng toàn bộ API Admin.
4. `rawBody` chỉ được nạp cho từng prefix (`app.setup.ts`): route mới ngoài các prefix này mà dùng `SessionAuthGuard` sẽ băm body rỗng và từ chối chữ ký hợp lệ (comment `app.setup.ts:116` mô tả đúng lỗi này: guard băm body rỗng và trả 403 cho chữ ký Android hợp lệ).
