# Chạy 11Food / 11Ship bằng HTTPS local (M00.05)

Dành cho Owner chạy thử bản PC trên máy mình, kết nối backend thật ở `127.0.0.1:3000`. Không dùng cho VPS/production.

## Cổng và địa chỉ

| Ứng dụng | Địa chỉ | Trạng thái |
|---|---|---|
| Web Admin | https://localhost:8443 | Chưa mở qua launcher, chờ gói M00.08 |
| 11Food | https://localhost:8444 | Mở được (M00.05) |
| 11Ship | https://localhost:8445 | Mở được (M00.05) |

Máy chủ chỉ lắng nghe `127.0.0.1`, từ chối Host lạ (421) và chỉ phục vụ: file tĩnh của app (kèm SPA fallback), `GET /__11ship/runtime`, `GET /v1/health/live`, `GET /v1/health/ready`. Mọi đường dẫn `/v1/*` khác trả 404; không có proxy tổng quát.

## Chứng chỉ: làm một lần

Launcher **không** tự cài CA vào hệ thống và **không** tắt kiểm tra TLS. Chứng chỉ phải nằm ở `.local/admin-web-tls/cert.pem` và `key.pem` (đã bị git bỏ qua) và phải có SAN `localhost` và `127.0.0.1`.

Cách 1 (khuyên dùng): dùng `mkcert` của chính Owner, tạo `cert.pem`/`key.pem` cho `localhost 127.0.0.1` rồi chép vào thư mục trên. Việc tin cậy CA của mkcert là quyết định của Owner trên máy mình.

Cách 2: `npm run admin-web:cert` (cần `openssl`) tạo chứng chỉ tự ký 30 ngày. Trình duyệt sẽ cảnh báo một lần; Owner tự quyết định chấp nhận cho `localhost`.

Có thể đặt chỗ khác bằng `CLIENT_WEB_TLS_CERT` và `CLIENT_WEB_TLS_KEY`. Kiểm tra nhanh: `npm run client-web:check -- cert`.

## Chạy

1. Chạy `tools\local\11Ship-Food.cmd` (hoặc `11Ship-Ship.cmd`). Launcher: kiểm tra chứng chỉ, lấy khóa, bật backend/database nếu cần, build đúng commit, chạy máy chủ, chứng minh, mở trình duyệt.
2. Xem trạng thái: `11Ship-Status.cmd`. Dừng: `11Ship-Stop.cmd` (chỉ dừng tiến trình đã chứng minh là của launcher).
3. Không muốn mở trình duyệt: đặt `SHIP11_NO_BROWSER=1`.
4. Chạy tay không qua launcher: `npm run build:food-web` rồi `npm run food-web:dev` (tương tự `ship-web`). Kiểm tra: `npm run client-web:check -- probe --app food-web --port 8444`.

`/__11ship/runtime` trả `app_id`, `source_sha`, `build_fingerprint`, `design_version`, `environment`; không có secret. Máy chủ từ chối khởi động nếu manifest build không khớp nội dung thư mục build.

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
| `APP_LAUNCH_PACKAGE_MISSING` | Admin chờ gói M00.08 | Chưa dùng được |

Khi backend không tới được, proxy trả 502/504; client M00.04 hiển thị "phản hồi chưa đúng" thay vì "offline". Đây là điểm cần ChatGPT/Owner xem lại.

## Giới hạn của gói này

Chưa có đăng nhập/nghiệp vụ, chưa mở Admin qua launcher (M00.08), chưa deploy VPS. Update không khởi động lại front đang chạy; lần mở app kế tiếp sẽ build lại và khởi động lại nếu artifact đổi.
