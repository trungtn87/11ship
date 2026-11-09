> # ⚠️ PREPARED / NOT DEPLOYED (OD-30, Owner 2026-11-08)
>
> Tài liệu này chỉ **soạn** cấu hình và hướng dẫn. **Chưa có gì được áp lên VPS**: không sửa VPS, không reload/restart nginx, không restart backend, không deploy. Không có script hay workflow chạy lên VPS trong PR này.
> **Chưa nghiệm thu runtime.** Cấu hình VPS thật chưa được đọc nên mọi "hiện trạng VPS" bên dưới là **CHƯA XÁC MINH** cho tới khi operator chạy mục 4 và ghi kết quả.
> Mọi thao tác trên VPS cần Owner cho phép rõ ràng và do operator được ủy quyền thực hiện theo [vps-production-update-20261014.md](vps-production-update-20261014.md).

# nginx + trust proxy cho limiter theo IP (P5-7a, OD-30)

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
| `delivery-tracking-public.controller` (`/public/tracking/:token`, `/track/:token`) | `req.ip \|\| socket.remoteAddress`, limiter trong bộ nhớ 60 giây — **không** đi qua `resolveClientIp` |

**Phát hiện (ngoài phạm vi PR này, chuyển Claude Lead):** vì Express không bật `trust proxy`, `req.ip` phía sau nginx luôn là `127.0.0.1` nên limiter tracking công khai dùng **một bucket chung** cho mọi client, kể cả sau khi OD-30 được áp. Đây là lỗi độ chính xác của limiter, không phải lỗ hổng giả mạo. Sửa cần thay đổi mã backend (đổi sang `OtpClientIp`/`resolveClientIp`), phải được giao riêng; PR này là docs-only.

**Mẫu nginx/env trong repo** (đã có sẵn, được kiểm tĩnh bởi [tests/deploy/ubuntu-vinahost-templates.test.mjs](../../tests/deploy/ubuntu-vinahost-templates.test.mjs)):

- [ops/vinahost/nginx-11ship-staging.conf](../../ops/vinahost/nginx-11ship-staging.conf): cả hai `location` (`= /v1/shop/me/menu/images` và `/`) đã `proxy_set_header X-Forwarded-For $remote_addr;`, `X-Real-IP $remote_addr`, `Forwarded ""`; không có `$proxy_add_x_forwarded_for`; `proxy_pass http://127.0.0.1:3000`.
- [ops/vinahost/production.env.example](../../ops/vinahost/production.env.example) và `staging.env.example`: `ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]`.

⇒ **Cấu hình đề xuất = đúng mẫu đã có trong repo.** PR này không đổi mẫu (không có diff mã/cấu hình); giá trị của PR là chuẩn hóa yêu cầu, quy trình kiểm tra, deploy và rollback để đối chiếu VPS thật. Nếu mục 4 cho thấy VPS lệch mẫu, áp phần "diff" ở mục 3 cho phần lệch.

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

## 4. Kiểm tra trạng thái VPS **trước** khi đổi (chỉ đọc; do operator được ủy quyền chạy, kết quả ghi vào hồ sơ vận hành)

```bash
# a. nginx đang áp cấu hình nào và đã khớp mẫu chưa
sudo nginx -T 2>/dev/null | grep -n -E "proxy_pass|X-Forwarded-For|X-Real-IP|Forwarded|proxy_add_x_forwarded_for"
diff <(sudo nginx -T 2>/dev/null | sed -n '/server_name 103.9.78.67.sslip.io/,$p') /opt/11ship/current/ops/vinahost/nginx-11ship-staging.conf || true

# b. backend có biến chưa (chỉ in tên + giá trị không bí mật này)
sudo systemctl show 11ship-staging -p Environment -p EnvironmentFiles
sudo grep -n "^ADMIN_AUTH_TRUSTED_PROXY_IPS" <file-env-của-service>

# c. backend nghe ở đâu
sudo ss -ltnp | grep -E ":3000\b"
```

Kết luận cho từng mục: ĐÚNG MẪU / LỆCH (ghi dòng lệch). Nếu cả nginx và env đã đúng ⇒ không cần deploy; chỉ chạy mục 6 để có bằng chứng.

## 5. Deploy từng bước (CHỈ khi Owner cho phép; chưa thực hiện)

Thứ tự quan trọng: **nginx ghi đè trước, backend tin proxy sau.** Ngược lại (backend tin trước khi nginx ghi đè) tạo khoảng hở giả mạo.

1. Sao lưu: `sudo cp -a /etc/nginx/sites-available/11ship-staging.conf /root/11ship-nginx.pre-od30.conf` và ghi lại env hiện tại (không in bí mật).
2. nginx: đưa các dòng ở 3.1 vào mọi `location` còn thiếu (hoặc `install` lại mẫu repo theo [ubuntu-vinahost-staging.md](ubuntu-vinahost-staging.md) §7 nếu khác biệt chỉ là phần này). Giữ nguyên SSL, `server_name`, `client_max_body_size`.
3. `sudo nginx -t` — phải `syntax is ok` và `test is successful`. Nếu lỗi: khôi phục bản sao lưu, dừng, báo.
4. `sudo systemctl reload nginx` (reload, không restart; không rớt kết nối đang chạy).
5. Kiểm tra mục 6A (nginx ghi đè) — khi backend vẫn chưa tin proxy.
6. Env backend: đặt `ADMIN_AUTH_TRUSTED_PROXY_IPS=["127.0.0.1"]` (nếu chưa có), rồi restart service theo quy trình cập nhật VPS chính thức. Đây là khoảng ngắn dịch vụ khởi động lại: làm ngoài giờ cao điểm.
7. Kiểm tra mục 6B–6D. Ghi kết quả; chỉ khi có bằng chứng mới được ghi "đã deploy".

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

## 7. Rollback

- **nginx:** `sudo cp -a /root/11ship-nginx.pre-od30.conf /etc/nginx/sites-available/11ship-staging.conf && sudo nginx -t && sudo systemctl reload nginx`.
- **Backend:** đưa `ADMIN_AUTH_TRUSTED_PROXY_IPS` về giá trị trước (hoặc `[]`) và restart service. Hệ quả của `[]`: backend không đọc header, mọi client dùng chung `127.0.0.1` — quota IP kém chính xác nhưng **không bị giả mạo**; đây là trạng thái an toàn khi rollback.
- Không bao giờ rollback bằng cách bật `$proxy_add_x_forwarded_for` hoặc nới danh sách tin cậy.
- Dữ liệu limiter (bảng quota) không cần dọn; cửa sổ quota tự hết hạn.

## 8. Checklist rủi ro

| Rủi ro | Hậu quả | Giảm thiểu |
| --- | --- | --- |
| Bật `TRUSTED_PROXY_IPS` trước khi nginx ghi đè | Client giả IP để né limiter | Thứ tự bước 5.2–5.6; kiểm 6B |
| `location` mới thiếu `proxy_set_header` | Header client đi thẳng hoặc thiếu → `400` hàng loạt trên route đó | Mọi `location` phải có bốn dòng 3.1; `nginx -T` + grep ở mục 4 |
| Danh sách tin cậy sai dạng | Backend không khởi động (cấu hình không hợp lệ) | Chỉ IP literal chuẩn; thử cấu hình ở staging/local trước |
| Thêm CDN/LB phía trước nginx | IP thật bị thay bằng IP lớp đó, tất cả dùng chung một bucket | Không có trong phạm vi; cần thiết kế riêng |
| Restart backend khi deploy | Gián đoạn ngắn | Làm ngoài giờ cao điểm, theo runbook cập nhật |
| Tracking công khai dùng `req.ip` | Một bucket chung (mục 2) | Escalate Claude Lead, sửa mã ở PR riêng |
| IPv6 | Gom `/64`; người dùng chung `/64` chia sẻ quota | Hành vi thiết kế, không đổi |
| NAT nhà mạng (CGNAT) | Nhiều người dùng chung một IPv4 | Lớp theo số điện thoại là lớp chính (xem P5-6a); chấp nhận |

## 9. Phạm vi và giới hạn của PR

- Docs-only; **không chạy runtime**, không chạy test sản phẩm, không đọc/đổi VPS, không APK, không merge/deploy.
- Không đổi `ops/vinahost/*` vì mẫu repo đã đúng đề xuất.
- Việc VPS thật khớp mẫu hay chưa: **CHƯA XÁC MINH**.
