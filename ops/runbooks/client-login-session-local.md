# Thử local đăng nhập, phiên và context (M01.04) — chỉ backend

Phạm vi: `POST /v1/client-auth/login`, `GET /me`, `POST /context`, `POST /logout` trên máy local/TEST. Hướng dẫn thử backend, **không** phải nghiệm thu UI/app, không dùng cho staging/production. Chuẩn bị môi trường và cách có tài khoản CUSTOMER: xem [client-register-local.md](client-register-local.md) (cùng `APP_ENV=development|test`, `HOST=127.0.0.1`, cặp consent test; đăng ký bằng `device.app` FOOD hoặc SHIP đều tạo CUSTOMER).

Mọi response thành công có dạng `{"data": …}` và `Cache-Control: no-store`. Dùng `device` `{"device_id":"web-local-0001","platform":"WEB","app":"FOOD"}` (hoặc `"app":"SHIP"`). `ANDROID` luôn 503; WEB chỉ chạy ở local mode.

## Các bước (ví dụ `curl`, `$B` = `http://127.0.0.1:3000/v1`)
1. Đăng nhập (bắt buộc `Idempotency-Key: <uuid mới>`), body đúng 3 khóa:
   `POST $B/client-auth/login` `{"phone":"0912345678","password":"<mật khẩu>","device":{…}}`
   → 200: danh tính (`available_roles`, `active_role`, `profile`, `capabilities`, `onboarding`, …) + `access_token` + `session.expires_at`.
   FOOD chọn CUSTOMER; SHIP chọn DRIVER nếu có thể chọn, sau đó CUSTOMER. Đăng nhập **không** tự cấp role: tài khoản không có context chọn được nhận `active_role: null`.
2. Xem phiên hiện tại: `GET $B/client-auth/me` với `Authorization: Bearer <access_token>` → danh tính HIỆN TẠI + `session.expires_at`, không có token.
3. Đổi context: `POST $B/client-auth/context`, Bearer, `Idempotency-Key: <uuid mới>`, `{"context":"SHOP_OWNER"}` (hoặc `CUSTOMER`/`DRIVER`) → 200 như `/me`. Chỉ chuyển sang context đang chọn được; FOOD không chọn `DRIVER`, SHIP không chọn `SHOP_OWNER`; khác → 403 `ROLE_NOT_AVAILABLE`. Chọn `SHOP_OWNER` thu hồi các phiên SHOP khác của người đó (không đụng phiên app kia).
4. Đăng xuất: `POST $B/client-auth/logout`, Bearer, body `{}` → 204, chỉ thu hồi phiên này. Gọi lại → vẫn 204; token lạ → 401 `SESSION_INVALID`.
5. Replay: gửi lại đúng request đăng nhập (cùng key, cùng body) → 200 cùng `access_token`/`expires_at`, danh tính là trạng thái hiện tại. Gửi lại request context cũ không chuyển ngược context.

## Kết quả cần nhận biết
| Tình huống | Kết quả |
|---|---|
| Sai mật khẩu, số lạ, tài khoản quản trị | 401 `INVALID_CREDENTIALS` (cùng một thông điệp) |
| Tài khoản bị khóa | 403 `ACCOUNT_DISABLED`, không tạo phiên |
| Thiếu / sai `Idempotency-Key` ở login, context | 400 `IDEMPOTENCY_KEY_REQUIRED` / `INVALID_IDEMPOTENCY_KEY` |
| Replay login khi phiên đã đăng xuất, hết hạn hoặc tài khoản bị khóa | 409 `AUTH_RESULT_NOT_REPLAYABLE`, không trả token |
| Replay context khi context không còn chọn được | 403 `ROLE_NOT_AVAILABLE`; phiên đã thu hồi/hết hạn: 401 |
| Phiên cũ (legacy) với nhãn app khác FOOD/SHIP | 401 `SESSION_INVALID` trên các endpoint client |

Chưa có trong gói này: UI, native binding/Android proof, reset mật khẩu, xác minh/OTP mới, SMS nhà mạng, deploy, migration remote. Kết quả thử tay của Owner ghi theo thực tế, không suy từ CI.
