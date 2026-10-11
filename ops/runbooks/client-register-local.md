# Thử local đăng ký CUSTOMER (M01.03) — chỉ backend

Phạm vi: gọi API `POST /v1/client-auth/register` trên máy local/TEST. Đây là hướng dẫn thử backend, **không** phải nghiệm thu UI/app, không dùng cho staging/production.

## 1. Chuẩn bị
- `APP_ENV=development` (hoặc `test`), `HOST=127.0.0.1` (loopback; WEB bị từ chối nếu bind ngoài loopback).
- `OTP_PROVIDER=TEST_INBOX` và công cụ PC `11ship-test-sms.cmd` theo [test-sms-inbox-windows.md](test-sms-inbox-windows.md).
- Cặp consent Owner đã duyệt, cấu hình bằng env (không có trong code):
  `CLIENT_AUTH_TERMS_VERSION=test-terms-20261011-v1`, `CLIENT_AUTH_PRIVACY_VERSION=test-privacy-20261011-v1`.
  Thiếu cặp này endpoint trả 503; đặt ngoài development/test thì backend không khởi động.
- Chỉ dùng DB local (DEV 5432) hoặc TEST (5433); không dùng DB remote.

## 2. Các bước (ví dụ `curl`, thay số điện thoại)
1. Yêu cầu OTP:
   `POST /v1/auth/phone-verifications` body `{"phone":"0912345678","purpose":"REGISTER"}` → nhận `verification_id` (không có mã OTP trong response).
2. Lấy mã bằng công cụ PC (`11ship-test-sms.cmd`): chọn tin REGISTER của số đó, đọc mã 6 số.
3. Xác minh: `POST /v1/auth/phone-verifications/{verification_id}/verify` body `{"otp":"<mã>"}` → nhận `verification_token` (dùng một lần, hết hạn theo `AUTH_PROOF_TTL_SECONDS`).
4. Đăng ký: `POST /v1/client-auth/register`, header `Idempotency-Key: <uuid mới>`, body đúng 6 khóa:
   ```json
   {"phone":"0912345678","password":"<8-128 ký tự>","verification_token":"<token bước 3>",
    "device":{"device_id":"web-local-0001","platform":"WEB","app":"FOOD"},
    "full_name":"Nguyễn Văn An",
    "consent":{"terms_version":"test-terms-20261011-v1","privacy_version":"test-privacy-20261011-v1"}}
   ```
   → `201`, `Cache-Control: no-store`, `{ "data": { user_id, phone_normalized, available_roles:["CUSTOMER"], active_role:"CUSTOMER", profile{full_name,version:1}, capabilities, onboarding, onboarding_required, role_selection_required, access_token, session{expires_at} } }`.
5. Gửi lại đúng request cũ (cùng key, cùng body) → `201` cùng `access_token`/`expires_at`, phần danh tính là trạng thái hiện tại. Đổi body với cùng key → `IDEMPOTENCY_KEY_REUSED`.

## 3. Kết quả cần nhận biết
| Tình huống | Kết quả |
|---|---|
| `platform: "ANDROID"` | 503 `SERVICE_UNAVAILABLE`, không tạo/đốt proof (chưa có bộ xác minh thiết bị) |
| WEB khi không phải development/test hoặc không bind loopback | 403 `DEVICE_PROOF_REQUIRED` |
| Cặp consent khác cặp cấu hình | 409 `CONSENT_VERSION_UNSUPPORTED` |
| Replay khi session đã hết hạn/thu hồi hoặc tài khoản bị khóa | 409 `AUTH_RESULT_NOT_REPLAYABLE` |
| Số đã đăng ký | 409 `PHONE_ALREADY_REGISTERED` |

Trạng thái: chưa có UI, login/me/context/logout mới, reset mật khẩu, onboarding quán/xế, native binding hay SMS nhà mạng trong gói này. Kết quả thử tay của Owner phải ghi theo thực tế, không suy ra từ CI.
