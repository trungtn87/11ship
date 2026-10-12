# Chạy Web Admin / 11Food / 11Ship bằng HTTPS local (M00.05, M00.08)

Dành cho Owner chạy thử bản PC trên máy mình, kết nối backend thật ở `127.0.0.1:3000`. Không dùng cho VPS/production.

## Cổng và địa chỉ

| Ứng dụng | Địa chỉ | Trạng thái |
|---|---|---|
| Web Admin | https://localhost:8443 | Mở được (M00.08); cần thêm cấu hình Admin trong `.env`, xem mục Web Admin |
| 11Food | https://localhost:8444 | Mở được (M00.05) |
| 11Ship | https://localhost:8445 | Mở được (M00.05) |

Máy chủ 11Food/11Ship chỉ lắng nghe `127.0.0.1`, từ chối Host lạ (421) và chỉ phục vụ: file tĩnh của app (kèm SPA fallback), `GET /__11ship/runtime`, `GET /v1/health/live`, `GET /v1/health/ready`. Mọi đường dẫn `/v1/*` khác trả 404; không có proxy tổng quát. Máy chủ Web Admin cũng chỉ nghe `127.0.0.1` và chỉ chuyển tiếp `/v1/admin-auth/*`, `/v1/admin-activation/*`, `/v1/admin/*` (xem mục Web Admin).

## Chứng chỉ: làm một lần

Launcher **không** tự cài CA vào hệ thống và **không** tắt kiểm tra TLS. Chứng chỉ phải nằm ở `.local/admin-web-tls/cert.pem` và `key.pem` (đã bị git bỏ qua) và phải có SAN `localhost` và `127.0.0.1`.

Cách 1 (khuyên dùng): dùng `mkcert` của chính Owner, tạo `cert.pem`/`key.pem` cho `localhost 127.0.0.1` rồi chép vào thư mục trên. Việc tin cậy CA của mkcert là quyết định của Owner trên máy mình.

Cách 2: `npm run admin-web:cert` (cần `openssl`) tạo chứng chỉ tự ký 30 ngày. Trình duyệt sẽ cảnh báo một lần; Owner tự quyết định chấp nhận cho `localhost`.

Có thể đặt chỗ khác bằng `CLIENT_WEB_TLS_CERT` và `CLIENT_WEB_TLS_KEY`. Kiểm tra nhanh: `npm run client-web:check -- cert`.

## Chạy

1. Chạy `tools\local\11Ship-Update.cmd` để lấy mã mới (các app chưa tự cập nhật Git), rồi `11Ship-Food.cmd`, `11Ship-Ship.cmd` hoặc `11Ship-Admin.cmd`. Launcher: kiểm tra chứng chỉ, lấy khóa, bật backend/database nếu cần, build đúng commit, chạy máy chủ, chứng minh, mở trình duyệt.
2. Xem trạng thái: `11Ship-Status.cmd`. Dừng: `11Ship-Stop.cmd` (chỉ dừng tiến trình đã chứng minh là của launcher).
3. Không muốn mở trình duyệt: đặt `SHIP11_NO_BROWSER=1`.
4. Chạy tay không qua launcher: `npm run build:food-web` rồi `npm run food-web:dev` (tương tự `ship-web`). Kiểm tra: `npm run client-web:check -- probe --app food-web --port 8444`.

`/__11ship/runtime` trả `app_id`, `source_sha`, `build_fingerprint`, `design_version`, `environment`; không có secret. Máy chủ từ chối khởi động nếu manifest build không khớp nội dung thư mục build.

## Web Admin (https://localhost:8443)

Dùng lại đăng nhập, Authenticator (TOTP) và máy chủ Admin đã có; launcher chỉ thêm phần chuẩn bị và chứng minh. `11Ship-Admin.cmd` làm theo thứ tự: kiểm tra `.env` và chứng chỉ → bật database → build backend và áp migration → **khởi tạo cấu hình giới hạn đăng nhập** → bật backend → build Web Admin → chạy máy chủ → chứng minh → mở trình duyệt.

**`.env` (Owner thêm một lần; launcher không tự ghi `.env`, không commit file này):**

```
ADMIN_AUTH_ENABLED=true
ADMIN_AUTH_ALLOWED_ORIGINS=["https://localhost:8443"]
ADMIN_AUTH_TRUSTED_PROXY_IPS=[]
ADMIN_RATE_LIMIT_HMAC_KEY=<base64 của 32 byte ngẫu nhiên>
ADMIN_RATE_LIMIT_KEY_ID=local-limiter-1
```

Sinh khóa: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Launcher từ chối chạy (`ADMIN_ENV_INVALID`, chưa làm gì) nếu origin không đúng một giá trị `https://localhost:8443`, nếu có proxy tin cậy, hoặc khóa/ID thiếu. Cookie `__Host-11admin*` luôn `Secure; HttpOnly; SameSite=Strict` do backend đặt; máy chủ Admin để nguyên cookie, `Origin` và `x-csrf-token`, bỏ `X-Forwarded-For`/`Forwarded` của trình duyệt.

**Tài khoản SYSTEM:** nếu DB DEV đã có thì giữ nguyên (không tạo lại, không đổi mật khẩu). Nếu chưa có, launcher hỏi trong cửa sổ: xác nhận, số điện thoại, mật khẩu hai lần (không hiện khi gõ). Thông tin này đi qua standard input tới lệnh `admin-auth:bootstrap-system` hiện có; không nằm trong tham số, biến môi trường, tệp hay log. Chạy bằng bấm đúp (cửa sổ thường), không chuyển hướng đầu vào. Cấu hình giới hạn (`admin-auth:init-limit-config`) chạy lại mỗi lần và là idempotent (`created`/`unchanged`).

**Đăng nhập:** SĐT + mật khẩu → bước Authenticator (lần đầu quét QR, lần sau nhập mã) → trang quản trị → Đăng xuất. F5 giữ đúng bước. Nếu mất phản hồi ở bước mã, trang chỉ đọc `GET /v1/admin-auth/state`, không gửi lại mã.

**Chứng minh:** ngoài định danh `/__11ship/runtime`, launcher gọi một `GET /v1/admin-auth/state` không cookie qua máy chủ Admin và yêu cầu backend tự trả `401 ADMIN_SESSION_INVALID`. Nếu backend đang chạy được bật trước khi `.env` có cấu hình Admin, kết quả là `ADMIN_AUTH_UNAVAILABLE`: chạy `11Ship-Stop.cmd` rồi `11Ship-Admin.cmd`.

## Mã lỗi thường gặp

| Mã | Ý nghĩa | Việc cần làm |
|---|---|---|
| `APP_CERT_MISSING` | Thiếu cert/key | Làm theo mục chứng chỉ |
| `APP_CERT_EXPIRED` | Chứng chỉ hết hạn | Tạo lại |
| `APP_CERT_SAN_MISMATCH` | Thiếu SAN `localhost`/`127.0.0.1` | Tạo lại đúng SAN |
| `APP_CERT_INVALID` | Key không khớp, chưa hiệu lực hoặc không đọc được | Tạo lại cặp |
| `PORT_IN_USE` | Cổng bị tiến trình lạ giữ | Tự đóng tiến trình đó; launcher không dừng giúp |
| `APP_TLS_MISMATCH` / `APP_IDENTITY_MISMATCH` | Cổng không trả đúng chứng chỉ/định danh | Không dùng; báo lại |
| `BACKEND_NOT_READY` | Backend sống nhưng chưa sẵn sàng (thường database) | Chạy lại Start, xem log backend |
| `APP_HEALTH_FAILED` / `APP_START_FAILED` | Health proxy hoặc máy chủ không lên | Xem log trong `.11ship-local` |
| `APP_BUILD_FAILED` | Build lỗi hoặc manifest không khớp commit | Xem log build |
| `ADMIN_ENV_INVALID` | `.env` chưa có cấu hình Admin đúng cho `https://localhost:8443` | Thêm các dòng ở mục Web Admin |
| `ADMIN_LIMIT_CONFIG_FAILED` | Không khởi tạo được cấu hình giới hạn | Khóa/ID trong `.env` đổi sau lần khởi tạo đầu: dùng lại khóa cũ |
| `ADMIN_SYSTEM_MISSING` / `ADMIN_SYSTEM_INPUT_INVALID` / `ADMIN_SYSTEM_BOOTSTRAP_FAILED` | Chưa có SYSTEM và chưa tạo được | Chạy lại bằng cửa sổ thường, nhập đủ và đúng |
| `ADMIN_AUTH_UNAVAILABLE` | Backend đang chạy chưa bật đăng nhập Admin | `11Ship-Stop.cmd` rồi `11Ship-Admin.cmd` |

Khi backend không tới được, proxy trả 502/504; client M00.04 hiển thị "phản hồi chưa đúng" thay vì "offline". Đây là điểm cần ChatGPT/Owner xem lại.

## Giới hạn của gói này

Food/Ship chưa có đăng nhập/nghiệp vụ; chưa có lời mời hay đặt lại mật khẩu mới ở Admin (ngoài phần đã có), chưa deploy VPS. Update không khởi động lại front đang chạy; lần mở app kế tiếp sẽ build lại và khởi động lại nếu artifact đổi.
