# M01-D-LOGIN-UI — chạy web quản trị local qua HTTPS

Tài liệu cho Owner/dev chạy thử trên máy mình. Đây là hướng dẫn, không phải bằng chứng đã test local.
Web quản trị phụ thuộc backend PR #34 (nhánh `feat/m01-d-login-backend`), PR đó chưa merge. Chạy từ nhánh UI là có đủ backend.

## Vì sao phải HTTPS cùng origin
Backend đặt hai cookie `__Host-11admin` (phiên 8 giờ) và `__Host-11admin-pre` (bước xác thực 5 phút).
Cả hai đều `Secure; HttpOnly; SameSite=Strict; Path=/`. Trình duyệt chỉ lưu và gửi chúng qua HTTPS, trên cùng một origin.
Mọi POST còn phải mang header `Origin` khớp đúng một giá trị trong `ADMIN_AUTH_ALLOWED_ORIGINS`.
Vì vậy trang và API phải cùng một origin HTTPS. Không có bước nào ở đây hạ `Secure`/`SameSite`, tắt Origin/CSRF hay tin proxy.

`scripts/admin-web-dev.mjs` là front HTTPS chỉ dùng local (mặc định `https://localhost:8443`):
- Phục vụ trang đã build trong `apps/admin-web/dist`.
- Chuyển tiếp **chỉ** `/v1/admin-auth/*` tới backend qua loopback HTTP.
- Bỏ mọi `X-Forwarded-For`/`Forwarded` do client gửi và không tự thêm header nào. Backend giữ `ADMIN_AUTH_TRUSTED_PROXY_IPS=[]`.
- Hệ quả: mọi request local được tính chung một địa chỉ `127.0.0.1` trong limiter.
- Cookie, Origin và `x-csrf-token` đi qua nguyên vẹn.

## Các bước
Cần Node 24, npm 11, Docker (cho PostgreSQL dev) và `openssl`.

1. Cài dependency và bật database dev như README: `npm ci`, `docker compose -f compose.dev.yml up -d db-dev`, `npm run db:migrate`.
2. Thêm vào `.env`. Chỉ là placeholder; tự sinh khóa bằng `openssl rand -base64 32`; không commit file này.
   ```
   ADMIN_AUTH_ENABLED=true
   ADMIN_AUTH_ALLOWED_ORIGINS=["https://localhost:8443"]
   ADMIN_AUTH_TRUSTED_PROXY_IPS=[]
   ADMIN_RATE_LIMIT_HMAC_KEY=<base64 của 32 byte ngẫu nhiên>
   ADMIN_RATE_LIMIT_KEY_ID=local-limiter-1
   ```
3. Chạy hai lệnh vận hành theo runbook `ops/runbooks/render-supabase-staging.md` mục admin-auth, trên database dev:
   - `npm run admin-auth:init-limit-config`
   - `npm run admin-auth:bootstrap-system < /đường/dẫn/an-toàn.json`, với file `{"phone":"…","password":"…"}`. Xóa file sau khi chạy.
4. Build và chạy backend: `npm run dev` (cổng 3000).
5. Ở terminal khác:
   - `npm run admin-web:cert` (chỉ một lần; tạo chứng chỉ tự ký trong `.local/admin-web-tls/`, đã git-ignore, hạn 30 ngày).
   - `npm run build:admin-web`
   - `npm run admin-web:dev`
6. Mở `https://localhost:8443`. Với chứng chỉ tự ký, trình duyệt cảnh báo một lần.
   - Muốn không bị cảnh báo: dùng chứng chỉ tin cậy local (ví dụ `mkcert localhost 127.0.0.1`).
   - Trỏ tới nó bằng `ADMIN_WEB_TLS_CERT=<file.pem>` và `ADMIN_WEB_TLS_KEY=<file-key.pem>`.

Tùy chọn:
- `ADMIN_WEB_PORT` (mặc định 8443). Đổi cổng thì đổi luôn `ADMIN_AUTH_ALLOWED_ORIGINS` cho khớp.
- `ADMIN_WEB_BACKEND` (mặc định `http://127.0.0.1:3000`; chỉ nhận địa chỉ loopback).
- Sửa code UI: chạy lại `npm run build:admin-web` rồi F5. Front đọc file mới, không cần khởi động lại.
- `ADMIN_WEB_UPSTREAM_TIMEOUT_MS` (mặc định 15000): thời gian front chờ backend cho một request, tính cả lúc nhận body.
  - Quá hạn thì front cắt kết nối tới backend và trả 504 cho trang (hoặc cắt kết nối nếu backend đã bắt đầu trả lời).
  - Trình duyệt ngắt trước thì request tới backend cũng bị hủy.

## Timeout giao tiếp
- Đây chỉ là timeout giao tiếp. Không thay đổi TTL phiên (8 giờ) hay bước xác thực (5 phút); hai TTL đó do backend quyết.
- Trang: mỗi request (kể cả GET /state, GET /me) có hạn 20 giây, tính từ lúc gửi tới khi đọc xong body. Quá hạn thì request bị hủy, trang thoát trạng thái chờ và người dùng có thể thao tác lại.
- Front local: 15 giây cho mỗi request tới backend.
- Timeout không chứng minh backend chưa thực hiện request:
  - Với bước mã Authenticator, trang chỉ đọc GET /state để đối chiếu, không bao giờ tự gửi lại mã.
  - Đăng xuất bị timeout thì trang vẫn ở shell và báo lỗi, không coi là đã đăng xuất.

## Owner kiểm tra gì (sau khi tiếp tục M00)
1. Đăng nhập lần đầu: SĐT/mật khẩu, quét QR bằng Google Authenticator thật, nhập mã, vào shell thấy vai trò.
2. F5 ở từng bước: đăng nhập, thiết lập, xác thực, shell. Trang phải giữ đúng trạng thái và không tự đăng nhập lại.
3. Đăng xuất, đăng nhập lại bằng mã mới.
4. Hai tab.
5. Sai mã nhiều lần tới khi đếm ngược.
6. Phiên hết hạn hoặc bị thu hồi.
7. Điện thoại: chỉ khi được truy cập máy dev qua HTTPS hợp lệ. Front này chỉ nghe `127.0.0.1`. Bản test điện thoại thuộc bước sau, không làm ở đây.

## Giới hạn đã biết
- Logo: repo chưa có file logo chính thức (brand guideline mục 12). Vị trí logo đang hiện chữ "11" làm chỗ giữ. Khi có asset thì thay ở `brand()` trong `apps/admin-web/src/dom/view.ts`.
- Front này không dùng cho staging/production. Cách phục vụ web quản trị khi deploy chưa được thiết kế trong task này.
