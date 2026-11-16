> # ⚠️ PREPARED / NOT DEPLOYED (OD-30, Owner 2026-11-08)
>
> Tài liệu này chỉ **soạn** cấu hình và hướng dẫn. **Chưa có gì được áp lên VPS**: không sửa VPS, không reload/restart nginx, không restart backend, không deploy. Không có script hay workflow chạy lên VPS trong PR này.
> **Chưa nghiệm thu runtime.** Cấu hình VPS thật chưa được đọc nên mọi "hiện trạng VPS" bên dưới là **CHƯA XÁC MINH** cho tới khi operator chạy mục 4 và ghi kết quả.
> Mọi thao tác trên VPS cần Owner cho phép rõ ràng và do operator được ủy quyền thực hiện theo [vps-production-update-20261014.md](vps-production-update-20261014.md).
>
> **P5-7d (cùng trạng thái PREPARED / NOT DEPLOYED):** thêm giới hạn tần suất `limit_req` cho đăng nhập, OTP, tracking công khai và route-distances — xem **mục 3.3**. Mẫu `ops/vinahost/nginx-11ship-staging.conf` đã có zone và location; chưa áp lên VPS.

# nginx + trust proxy cho limiter theo IP (P5-7a, OD-30; bổ sung P5-7d)

## 1. Vấn đề

Các limiter theo địa chỉ client (OTP request, xóa tài khoản — IP 20 lần / 10 phút theo `ACCOUNT_DELETE_IP_LIMIT` / `ACCOUNT_DELETE_IP_WINDOW_SECONDS`, và nhóm admin: đăng nhập, kích hoạt, TOTP) chỉ đúng khi backend biết địa chỉ thật của client. Backend phía sau nginx thấy socket từ `127.0.0.1`.

- Chưa cấu hình proxy tin cậy → mọi client dùng chung một địa chỉ (`127.0.0.1`): một client xấu làm cạn quota IP của tất cả; đồng thời quota IP mất tác dụng chống một nguồn.
- Cấu hình tin cậy nhưng nginx **nối thêm** `X-Forwarded-For` (`$proxy_add_x_forwarded_for`) → client tự giả địa chỉ để né limiter.

## 2. Hiện trạng trong repo (đã đọc, KHÔNG suy diễn VPS)

**Backend** ([apps/backend/src/admin-auth/client-ip.ts](../../apps/backend/src/admin-auth/client-ip.ts), [auth/otp-client-ip.ts](../../apps/backend/src/auth/otp-client-ip.ts)):

- `resolveClientIp(socket.remoteAddress, X-Forwarded-For, trusted)`: lấy địa chỉ socket (chuẩn hóa `::ffff:a.b.c.d`). Nếu **không** nằm trong danh sách tin cậy → dùng địa chỉ socket, **không đọc header**. Nếu nằm trong danh sách → bắt buộc **đúng một** giá trị `X-Forwarded-For` là IP literal; thiếu, lặp header, nhiều giá trị hoặc không phải IP → `400`.
- Biến cấu hình: `ADMIN_AUTH_TRUSTED_PROXY_IPS` — mảng JSON các IP literal chính xác (dạng chuẩn), mặc định `[]`, tối đa `MAX_PROXIES`. Không hỗ trợ CIDR hay nhiều tầng proxy (ghi rõ trong code). Tên biến mang tiền tố `ADMIN_AUTH_` nhưng `OtpClientIp` (OTP, khôi phục, xóa tài khoản) dùng **chung** biến này.
- IPv6 được gom theo `/64` (`ipLimiterIdentity`).
- Không có `app.set('trust proxy')` trong `main.ts` / `app.setup.ts`.

**Nơi dùng IP:**

| Nơi | Cơ chế |
| --- | --- |
| OTP request (`auth.controller`), khôi phục tài khoản (`account-recovery.controller`, 3 chỗ), xóa tài khoản (`account-deletion.controller`) | `OtpClientIp.identity()` ← `resolveClientIp` |
| Admin: login, activation, provisioning, account-lock, menu-categories, service-areas, shippers, shipping-policy, otp-policy, system-settings | `resolveClientIp` trực tiếp + `ipLimiterIdentity` |
| Đăng nhập khách (`client-auth`) | **Không dùng IP**: chỉ theo số điện thoại (30/phút) |
| `delivery-tracking-public.controller` (`/public/tracking/:token`, `/track/:token`) | `OtpClientIp.identity()` ← `resolveClientIp`, limiter trong bộ nhớ 60 giây (đã đổi khỏi `req.ip`, đối chiếu main 9a3538e6) |

**Cập nhật P5-7d — tracking đã đúng về mã, nhưng vẫn chung một bucket khi chưa bật tin cậy:** `req.ip` không còn được dùng cho tracking (đã sửa trong main). Tuy nhiên `OtpClientIp` chỉ đọc địa chỉ thật khi socket nằm trong `ADMIN_AUTH_TRUSTED_PROXY_IPS`. Ở trạng thái S0/S2 (chưa tin proxy), **mọi khách truy cập đều dùng chung địa chỉ `127.0.0.1`**, tức một bucket 60 yêu cầu/phút cho cả hệ thống; khi vượt thì mọi khách bị 429 cùng lúc. Bật tin cậy (trạng thái T, mục 5) mới cho mỗi khách một bucket ở lớp backend. Lớp giới hạn nginx ở mục 3.3 khóa theo địa chỉ thật ở edge nên vẫn tách khách với nhau ngay cả khi backend chưa tin proxy, nhưng **không** thay thế bucket của backend. Đây là lỗi độ chính xác, không phải lỗ hổng giả mạo; các trường hợp cần Claude Lead quyết định được ghi ở mục 8.

**Mẫu nginx/env trong repo** (đã có sẵn, được kiểm tĩnh bởi [tests/deploy/ubuntu-vinahost-templates.test.mjs](../../tests/deploy/ubuntu-vinahost-templates.test.mjs)):

- [ops/vinahost/nginx-11ship-staging.conf](../../ops/vinahost/nginx-11ship-staging.conf): cả hai `location` (`= /v1/shop/me/menu/images` và `/`) đã `proxy_set_header X-Forwarded-For $remote_addr;`, `X-Real-IP $remote_addr`, `Forwarded ""`; không có `$proxy_add_x_forwarded_for`; `proxy_pass http://127.0.0.1:3000`.
- [ops/vinahost/production.env.example](../../ops/vinahost/production.env.example) và `staging.env.example`: `ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]`.

⇒ **Cấu hình trust/forwarding đề xuất (3.1, 3.2) = đúng mẫu đã có trong repo, không đổi ở P5-7d.** P5-7d chỉ thêm zone và location giới hạn tần suất (mục 3.3). Nếu mục 4 cho thấy VPS lệch mẫu, áp phần "diff" ở mục 3 cho phần lệch.

## 3. Cấu hình đề xuất

### 3.1 nginx (áp cho **mọi** `location` có `proxy_pass` tới backend)

```nginx
# GHI ĐÈ, không nối: backend tin đúng một mục X-Forwarded-For từ proxy tin cậy.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP       $remote_addr;
proxy_set_header Forwarded       "";
proxy_set_header X-Forwarded-Proto $scheme;
```

Quy tắc:

- Tuyệt đối không dùng `$proxy_add_x_forwarded_for`, không `proxy_set_header X-Forwarded-For $http_x_forwarded_for`.
- nginx là proxy **duy nhất** trước backend và backend chỉ nghe `127.0.0.1:3000`. Nếu sau này đặt CDN/Cloudflare/LB phía trước nginx thì `$remote_addr` là địa chỉ của lớp đó: cấu hình này **không còn đúng** và cần thiết kế riêng (real_ip module + dải tin cậy), không tự bật.
- Mọi `location` mới thêm sau này (ví dụ trang `/delete-account`) phải kế thừa cùng bốn dòng trên; `proxy_set_header` ở cấp `location` thay thế hoàn toàn bộ ở cấp cha, nên không được "kế thừa ngầm".

### 3.2 Backend (`/etc/…` env của service `11ship-staging`, không commit giá trị thật)

```
ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]
```

- Phải đúng dạng chuẩn (IP literal, JSON). Không dùng `"::ffff:127.0.0.1"`, CIDR, tên máy, hay `*`.
- Chỉ đổi khi socket thực tế từ nginx khác `127.0.0.1` (ví dụ `proxy_pass http://[::1]:3000` → `["::1"]`). Hiện `proxy_pass` là `127.0.0.1` nên giữ `["127.0.0.1"]`.
- Backend phải chỉ nghe loopback (`127.0.0.1:3000`); nếu nghe `0.0.0.0` thì client bên ngoài có thể vượt nginx và gửi thẳng, vẫn bị coi là không tin cậy (không phải `127.0.0.1`), nhưng giữ loopback để không mở thêm bề mặt.

### 3.3 Giới hạn tần suất nginx (P5-7d)

Các zone nằm trong mẫu `ops/vinahost/nginx-11ship-staging.conf` (cấp http, qua `sites-enabled`). Mốc backend lấy từ mã nguồn trên main; "backstop" là mốc chọn thêm, backend không có mốc IP tĩnh tương ứng.

| Zone | Location | Rate nginx | Burst | Mốc backend | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| `ship11_tracking` | `~ ^/v1/(public/tracking\|track)/` | 60 r/phút | 20 | `PUBLIC_TRACKING_LIMIT` = 60/phút | khớp |
| `ship11_route_dist` | `= /v1/discovery/route-distances` | 120 r/phút | 40 | `ROUTE_DISTANCES_LIMIT_PER_MINUTE` = 120 | khớp |
| `ship11_admin_login` | `= /v1/admin-auth/login` | 10 r/phút | 5 | `LOGIN_REQUEST_LIMIT` = 10 trong 60 s theo IP | khớp |
| `ship11_client_login` | `= /v1/client-auth/login` | 30 r/phút | 10 | 30/phút **theo số điện thoại**, backend không có mốc IP | **backstop mới** — cần Claude Lead xác nhận |
| `ship11_otp_send` | `~ ^/v1/(auth/phone-verifications\|account-recovery/(locked/)?otp\|admin-recovery/otp)$` | 10 r/phút | 5 | `ip_per_hour` mặc định 10/giờ, **lưu trong DB, admin chỉnh được** | **backstop**, không khớp chính xác |
| `ship11_deletion` | `= /v1/account-deletion/confirm` | 2 r/phút | 20 | `ACCOUNT_DELETE_IP_LIMIT` 20 / `ACCOUNT_DELETE_IP_WINDOW_SECONDS` 600 | xấp xỉ; hai biến môi trường có thể đổi |

Quy tắc:

- Zone khóa theo `$binary_remote_addr`, tức địa chỉ socket của nginx = địa chỉ khách thật vì nginx là edge. Zone vì thế **không** phụ thuộc `ADMIN_AUTH_TRUSTED_PROXY_IPS`: đúng ở S0 lẫn T và không thể bị giả mạo bằng header.
- `limit_req … burst=N nodelay` và `limit_req_status 429`: vượt burst thì trả 429 ngay, không xếp hàng.
- **Backend vẫn là thẩm quyền.** nginx không thay thế các giới hạn của backend (theo số điện thoại, theo IP cấu hình được, khóa đăng nhập…). Nếu đổi `ip_per_hour`, `ACCOUNT_DELETE_IP_LIMIT` hoặc `ACCOUNT_DELETE_IP_WINDOW_SECONDS`, phải đổi zone tương ứng trong mẫu; test tĩnh `tests/deploy/nginx-rate-limits.test.mjs` kiểm các mốc tĩnh (tracking, route-distances, admin login, deletion).
- Mọi location giới hạn lặp đủ bộ header của 3.1. `proxy_set_header` ở cấp location thay thế toàn bộ cấp cha nên thiếu một dòng là mất ghi đè.
- **Không** giới hạn: verify OTP (`.../{id}/verify`; backend đã có `max_wrong_attempts`), TOTP admin, các route khác. Mở rộng cần quyết định riêng.
- Giới hạn đã biết: IPv6 được tính theo từng địa chỉ ở nginx, còn backend gom `/64`. Nhiều người sau cùng một IPv4 (CGNAT) chung một zone, nên đăng nhập/OTP theo IP có thể bị 429 khi một mạng đông người. Sau triển khai, theo dõi log nginx dòng `limiting requests`.
- 429 do nginx trả có **envelope JSON giống backend** (`apps/backend/src/http/error-envelope.ts`): `{"error":{"code":"TOO_MANY_REQUESTS","message":"Too many requests","request_id":…,"details":{}}}`, `Content-Type: application/json`, cùng `X-Request-ID`. `request_id` do nginx tạo (dạng UUID từ `$request_id`), nên nó không xuất hiện trong log của backend. 429 do backend trả đi qua nguyên vẹn. Ứng dụng coi `TOO_MANY_REQUESTS` là "thử lại sau". **NOT TESTED trên máy.**
- Hai backstop **khách 30/phút** và **OTP 10/phút** là số **chỉnh được**. Nếu nhiều người dùng chung một IP (mạng văn phòng, CGNAT), tăng `rate` và `burst` của zone tương ứng trong mẫu, áp lại theo mục 5, và dựa vào dòng `limiting requests` trong log nginx để quyết định.

## 4. Kiểm tra trạng thái VPS **trước** khi đổi (chỉ đọc; do operator được ủy quyền chạy, kết quả ghi vào hồ sơ vận hành)

```bash
# a. nginx đang áp cấu hình nào và đã khớp mẫu chưa
sudo nginx -T 2>/dev/null | grep -n -E "proxy_pass|X-Forwarded-For|X-Real-IP|Forwarded|proxy_add_x_forwarded_for"
diff <(sudo nginx -T 2>/dev/null | sed -n '/server_name 103.9.78.67.sslip.io/,$p') /opt/11ship/current/ops/vinahost/nginx-11ship-staging.conf || true

# b. EnvironmentFile THẬT của service và giá trị trust hiện tại (không in bí mật)
sudo systemctl show 11ship-staging -p Environment -p EnvironmentFiles
sudo grep -n "^ADMIN_AUTH_TRUSTED_PROXY_IPS" <EnvironmentFile-phát-hiện-ở-trên>

# c. backend nghe ở đâu
sudo ss -ltnp | grep -E ":3000\b"
```

Ghi vào hồ sơ vận hành: **đường dẫn đầy đủ của EnvironmentFile** (hoặc dòng `Environment=` nếu đặt trong unit/drop-in) và giá trị `ADMIN_AUTH_TRUSTED_PROXY_IPS` hiện tại. Mọi bước sao lưu/khôi phục env ở mục 5 và 7 dùng đúng tệp này, không dùng đường dẫn đoán.

Phân loại **trạng thái đầu vào** (N = nginx ghi đè `X-Forwarded-For`/`X-Real-IP` bằng `$remote_addr` ở **mọi** `location` proxy; T = backend đang tin proxy, tức danh sách không rỗng):

| Trạng thái | Nginx | Backend | Rủi ro hiện tại | Đường đi |
| --- | --- | --- | --- | --- |
| S0 | chưa N | chưa T | quota IP chung một bucket; không giả mạo được | 5.A (mặc định) |
| **S1** | **chưa N** | **ĐÃ T** | **giả mạo IP né limiter đang xảy ra** | **5.B: bỏ trust TRƯỚC mọi thứ khác** |
| S2 | đã N | chưa T | quota IP chung một bucket; không giả mạo được | 5.A từ bước nginx đã xong, bật trust sau khi chứng minh |
| S3 | đã N | đã T | đúng đích | không deploy; chỉ chạy mục 6 để có bằng chứng |

Nếu không xác định chắc được N hoặc T, **coi là S1** (đường an toàn hơn). Nguyên tắc bất biến cho mọi đường đi: **backend không bao giờ ở trạng thái T khi nginx chưa được chứng minh ghi đè.**

## 5. Deploy từng bước (CHỈ khi Owner cho phép; chưa thực hiện)

Thứ tự bất biến: **(1) gỡ trust nếu đang bật → (2) sửa và chứng minh nginx ghi đè → (3) mới bật trust.** Mỗi lần restart backend phải kiểm `curl -fsS http://127.0.0.1:3000/v1/health/ready` trả `ready` trước khi sang bước sau. Đường dẫn này theo mã nguồn là `GLOBAL_PREFIX = 'v1'` + `@Controller('health')`, **chưa xác nhận trên VPS**: giữ là **backlog #329**. Xác nhận bằng curl chỉ-đọc lúc deploy: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/v1/health/ready` (kỳ vọng 200). Nếu VPS trả 404 thì dừng và đối chiếu build đang chạy, không đoán đường dẫn khác.

**Thứ tự bắt buộc khi áp P5-7d (quyết định Claude Lead):** bật `ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]` **trước hoặc cùng lúc** khi áp zone giới hạn của mục 3.3, trong cùng một cửa sổ bảo trì. Không bao giờ áp zone khi trust còn tắt: khi đó mọi khách dùng chung một bucket tracking 60/phút ở backend, một khách vượt là mọi khách bị 429. Điều kiện an toàn của mục 4–5 vẫn giữ: **trust chỉ được bật sau khi 6A đã PASS** (nginx ghi đè `X-Forwarded-For`), và 6A được chứng minh trên cấu hình **chỉ có ghi đè (mục 3.1), chưa có khối zone**. Trình tự:

1. Áp cấu hình nginx chỉ có ghi đè (mục 3.1, không có khối zone, `limit_req` hay 429 JSON của P5-7d), `nginx -t`, reload, rồi chứng minh 6A trên các location. Nếu 6A FAIL: **dừng**, không bật trust, không áp zone, báo.
2. Nếu 6A PASS: bật trust (5.A bước 5 hoặc 5.B bước 4), restart, kiểm `ready`, rồi 6B–6D.
3. Chỉ sau đó áp khối zone, location giới hạn và 429 JSON của mục 3.3 (bản mẫu `ops/vinahost/nginx-11ship-staging.conf`), `nginx -t`, reload, rồi 6E.

Bước 2 và 3 nằm trong cùng cửa sổ bảo trì. Không được kết thúc cửa sổ với zone đã áp mà trust vẫn tắt. Restart ngắt dịch vụ trong chốc lát: làm ngoài giờ cao điểm, theo [vps-production-update-20261014.md](vps-production-update-20261014.md).

**Sao lưu trước khi đổi bất cứ thứ gì** (cho rollback tái lập được):

```bash
sudo cp -a /etc/nginx/sites-available/11ship-staging.conf /root/11ship-nginx.pre-od30.conf
sudo cp -a <EnvironmentFile-đã-ghi-ở-mục-4> <EnvironmentFile-đã-ghi-ở-mục-4>.pre-od30
```

Ghi lại: đường dẫn hai bản sao, thời điểm, và trạng thái đầu vào (S0–S3). Không in nội dung env (có bí mật).

### 5.A — S0 / S2 (backend chưa tin proxy)

1. nginx: đưa các dòng 3.1 vào mọi `location` còn thiếu (hoặc `install` lại mẫu repo theo [ubuntu-vinahost-staging.md](ubuntu-vinahost-staging.md) §7 nếu lệch chỉ ở phần này). Giữ nguyên SSL, `server_name`, `client_max_body_size`. **Không cài lại toàn bộ mẫu repo ở bước này**: mẫu có khối zone P5-7d, phải áp ở bước 3 của đầu mục 5, sau khi trust đã bật.
2. `sudo nginx -t` phải `syntax is ok` + `test is successful`; lỗi → khôi phục bản sao nginx (bản sao đạt invariant vì backend chưa tin), dừng, báo.
3. `sudo systemctl reload nginx` (reload, không restart).
4. **Chứng minh ghi đè (6A)** — phải PASS trước khi sang bước 5.
5. Đặt `ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]` trong EnvironmentFile đã ghi, restart service, kiểm `ready`.
6. Kiểm 6B–6D, ghi kết quả. Chỉ khi có bằng chứng mới được ghi "đã deploy".

### 5.B — S1 (backend ĐÃ tin proxy, nginx CHƯA ghi đè): fail-safe

1. **Gỡ trust trước:** đặt `ADMIN_AUTH_TRUSTED_PROXY_IPS=[]` (an toàn: backend không đọc header, ghi `[]` tường minh, không xóa dòng) trong EnvironmentFile đã ghi; restart service; kiểm `ready`. Từ đây hệ thống ở trạng thái S0: không giả mạo được.
2. Chỉ sau khi `ready` xác nhận: sửa nginx như 5.A bước 1, `nginx -t`, reload.
3. Chứng minh ghi đè bằng curl với `X-Forwarded-For` giả (6A + 6B ở chế độ trust đang tắt: header giả không được truyền nguyên vẹn tới backend).
4. Chỉ khi 6A PASS: bật trust `["127.0.0.1"]`, restart, kiểm `ready`, rồi 6B–6D.
5. Nếu bất kỳ bước nào ở 2–4 lỗi: **giữ trust ở `[]`** và dừng/báo; không quay lại trạng thái T với nginx chưa chứng minh.


## 6. Kiểm tra sau deploy

Dùng endpoint không phát sinh SMS thật và không tác động tài khoản thật. Ưu tiên endpoint chỉ-đọc có limiter IP hoặc môi trường đã Owner cho phép; **không** dùng số điện thoại thật của người dùng.

**6A — nginx ghi đè (trước khi bật tin cậy):** trên VPS chạy một listener tạm không phải backend (ví dụ `nc -l 127.0.0.1 3999` với `location` thử), hoặc đọc log `$http_x_forwarded_for` ở định dạng log tạm do operator bật. Kỳ vọng: giá trị nhận được **chỉ** là địa chỉ nguồn thật, không chứa `1.2.3.4`.

**6B — giả mạo không được tin:** từ một máy bên ngoài:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-For: 1.2.3.4" https://103.9.78.67.sslip.io/v1/<endpoint-có-limiter-IP>
curl -sk -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-For: 1.2.3.4, 5.6.7.8" https://103.9.78.67.sslip.io/v1/<endpoint-có-limiter-IP>
```

Kỳ vọng: **không** có `400` do header (nginx đã ghi đè thành một giá trị), và limiter đếm theo địa chỉ thật của máy gọi, không theo `1.2.3.4`. Cách chứng minh: gửi liên tiếp vượt ngưỡng của một endpoint đã được Owner chọn, đổi giá trị `X-Forwarded-For` giả mỗi lần; vẫn bị chặn ở cùng ngưỡng. Nếu mỗi giá trị giả được một quota mới ⇒ **FAIL**, rollback.

**6C — hai client khác nhau có bucket khác nhau:** từ hai địa chỉ nguồn khác nhau (ví dụ máy dev và 4G); cạn quota ở một bên không làm bên kia bị chặn.

**6D — truy cập trực tiếp không qua nginx:** từ ngoài VPS, `curl http://103.9.78.67:3000` phải không tới được (cổng đóng/nghe loopback).

**6E — giới hạn tần suất nginx (P5-7d; không gửi SMS, không đăng nhập được, không đổi tài khoản):** từ máy vận hành, không dùng phiên admin đang đăng nhập:

```bash
for i in $(seq 1 12); do curl -sk -o /dev/null -w "%{http_code} " -X POST -H 'Content-Type: application/json' -d '{}' https://103.9.78.67.sslip.io/v1/admin-auth/login; done; echo
```

Kỳ vọng: khoảng 6 yêu cầu đầu không phải 429 (burst 5 + 1), các yêu cầu sau là `429` với body JSON `TOO_MANY_REQUESTS` và header `X-Request-ID` (`curl -sk -i …` để xem). Lặp lại với `X-Forwarded-For` giả khác nhau: vẫn 429, nghĩa là không có quota mới. Với tracking, thay URL bằng `/v1/track/<token-giả-đủ-dài>` (60/phút): token không tồn tại trả mã của backend; khoảng 21 yêu cầu đầu (1 + burst 20) không phải 429, các yêu cầu sau là 429. Sau khi chạy, đợi một phút trước khi đăng nhập admin từ máy đó.

## 7. Rollback

Hướng **ngược** với deploy: bỏ trust backend và xác minh healthy **trước**; chỉ sau đó mới đụng nginx.

1. **Backend trước:** đặt lại `ADMIN_AUTH_TRUSTED_PROXY_IPS=[]` (hoặc giá trị an toàn đã biết) trong **đúng EnvironmentFile đã ghi ở mục 4**; nếu cần khôi phục toàn tệp thì dùng `<EnvironmentFile>.pre-od30` đã sao lưu ở mục 5 **chỉ khi** nội dung sao lưu có trust rỗng hoặc nginx hiện tại đang ghi đè (kiểm `grep ^ADMIN_AUTH_TRUSTED_PROXY_IPS`); nếu bản sao lưu là trạng thái S1 (đã tin proxy) thì **không** khôi phục nguyên tệp, chỉ đặt `[]` thủ công. Restart service, kiểm `ready`. Hệ quả của `[]`: mọi client dùng chung `127.0.0.1`, quota IP kém chính xác nhưng **không bị giả mạo**: đây là trạng thái an toàn.
2. **Chỉ sau khi backend healthy** mới xét nginx. Kiểm bản sao `/root/11ship-nginx.pre-od30.conf` theo invariant: **mọi `location` proxy phải có `proxy_set_header X-Forwarded-For $remote_addr;` và `X-Real-IP $remote_addr;`, không có `$proxy_add_x_forwarded_for` và không có truyền nguyên `$http_x_forwarded_for`** (`grep -n -E "proxy_add_x_forwarded_for|http_x_forwarded_for|X-Forwarded-For|X-Real-IP" <bản sao>`).
   - Đạt invariant: `sudo cp -a /root/11ship-nginx.pre-od30.conf /etc/nginx/sites-available/11ship-staging.conf && sudo nginx -t && sudo systemctl reload nginx`.
   - **Không đạt** (append/passthrough hoặc thiếu ghi đè): **KHÔNG khôi phục.** Giữ cấu hình ghi đè an toàn hiện tại; rollback chỉ ở phía backend (bước 1). Báo lại rằng bản nginx cũ không an toàn.
3. Không bao giờ rollback bằng cách bật `$proxy_add_x_forwarded_for`, truyền nguyên header client, hay nới danh sách tin cậy. Mọi con đường rollback kết thúc ở trạng thái: (nginx ghi đè hoặc backend không tin) — không bao giờ (backend tin + nginx không ghi đè).
4. Dữ liệu limiter (bảng quota) không cần dọn; cửa sổ quota tự hết hạn.
5. Chỉ gỡ giới hạn tần suất P5-7d: khôi phục bản sao nginx trước P5-7d (không có zone/location giới hạn). Các mục 7.2–7.3 về ghi đè vẫn áp dụng cho bản đó; không cần đổi backend.


## 8. Checklist rủi ro

| Rủi ro | Hậu quả | Giảm thiểu |
| --- | --- | --- |
| Bật `TRUSTED_PROXY_IPS` trước khi nginx ghi đè | Client giả IP để né limiter | State machine mục 4–5 (S1 gỡ trust trước); kiểm 6A–6B |
| `location` mới thiếu `proxy_set_header` | Header client đi thẳng hoặc thiếu → `400` hàng loạt trên route đó | Mọi `location` phải có bốn dòng 3.1; `nginx -T` + grep ở mục 4 |
| Danh sách tin cậy sai dạng | Backend không khởi động (cấu hình không hợp lệ) | Chỉ IP literal chuẩn; thử cấu hình ở staging/local trước |
| Thêm CDN/LB phía trước nginx | IP thật bị thay bằng IP lớp đó, tất cả dùng chung một bucket | Không có trong phạm vi; cần thiết kế riêng |
| Restart backend khi deploy | Gián đoạn ngắn | Làm ngoài giờ cao điểm, theo runbook cập nhật |
| Tracking khi backend CHƯA tin proxy (S0/S2) | Mọi khách dùng chung bucket 60/phút ở backend; khi vượt thì mọi khách bị 429 cùng lúc | Bật T cùng cửa sổ với zone, sau khi 6A PASS (mục 5, thứ tự bắt buộc). Zone nginx 3.3 không sửa bucket backend. Không làm PR backend riêng (quyết định Lead) |
| Zone nginx quá chặt với CGNAT/nhiều người sau một IP | Người dùng hợp lệ bị 429 khi đăng nhập hoặc gửi OTP | Các backstop mới (client login 30/phút, OTP 10/phút) cần Claude Lead xác nhận trước khi áp; theo dõi `limiting requests` trong log nginx |
| Mốc nginx lệch cấu hình backend (`ip_per_hour`, `ACCOUNT_DELETE_*`) | Hai nơi cho hai con số | Mục 3.3; đổi cấu hình thì đổi zone tương ứng |
| 429 của nginx lệch envelope backend | App không nhận ra `TOO_MANY_REQUESTS` | Envelope khớp backend (test tĩnh đối chiếu `error-envelope.ts`, kiểm bằng echo upstream); app chưa kiểm trên máy (NOT TESTED) |
| IPv6 | Gom `/64` ở backend; nginx tính từng địa chỉ | Hành vi thiết kế; ghi rõ ở 3.3 |
| NAT nhà mạng (CGNAT) | Nhiều người dùng chung một IPv4 | Lớp theo số điện thoại là lớp chính (xem P5-6a); mục 3.3 ghi rõ giới hạn |

## 9. Phạm vi và giới hạn của PR

- Không đổi mã backend, env, tên miền hay VPS; không APK; không merge/deploy.
- Đổi duy nhất `ops/vinahost/nginx-11ship-staging.conf` (P5-7d: zone và 6 location giới hạn, mục 3.3) và thêm `tests/deploy/nginx-rate-limits.test.mjs` (tĩnh, chạy trong `npm run deploy:test` của CI).
- Kiểm chứng P5-7d: `nginx -t` trên nginx 1.24 (phiên bản Ubuntu 24.04) trong container Docker với chứng chỉ tự ký thử, cộng kiểm hành vi trên một upstream giả; **chưa chạy trên VPS**.
- Việc VPS thật khớp mẫu hay chưa: **CHƯA XÁC MINH**.
