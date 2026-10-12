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

Trạng thái của mục 1–3 (API): chưa có UI, login/me/context/logout mới, reset mật khẩu, onboarding quán/xế, native binding hay SMS nhà mạng trong gói này. Kết quả thử tay của Owner phải ghi theo thực tế, không suy ra từ CI.

## 4. Thử bằng giao diện 11Food (M01.07, local)

Luồng thật: F11 (họ tên, SĐT, mật khẩu, nhập lại, đồng ý) → F12 (mã OTP) → tài khoản được tạo → F01 đã đăng nhập bằng phiên/danh tính do máy chủ trả. Chỉ chạy ở local; **không** mở trên VPS test (xác minh OTP ở VPS vẫn đóng).

1. `.env` local có `OTP_PROVIDER=TEST_INBOX`, cặp `CLIENT_AUTH_TERMS_VERSION` / `CLIENT_AUTH_PRIVACY_VERSION` ở mục 1, `APP_ENV=development`, `HOST=127.0.0.1`; backend chạy trên DB local.
2. Chạy `tools\local\11Ship-Update.cmd`, rồi `11Ship-Food.cmd` (mở https://localhost:8444; chứng chỉ theo [local-https-runtime.md](local-https-runtime.md)).
3. Mở **Tài khoản → Đăng ký**, đọc hai nội dung chấp thuận thử, nhập thông tin, tick đồng ý, bấm **Tiếp tục**.
4. Lấy mã: chạy `tools\local\11ship-test-sms.cmd`, chọn tin REGISTER của số vừa nhập (màn hình không hiện mã). Nhập mã vào F12, bấm **Xác minh**.
5. Thành công: về trang chủ với tên bạn nhập. F5 trả về khách (phiên chỉ nằm trong bộ nhớ trang).

Nếu mất phản hồi ở bước tạo tài khoản, F12 hiện **Thử lại**: gửi lại đúng yêu cầu cũ (cùng `Idempotency-Key`), không cần mã mới. Rời màn hình (Quay lại/Đổi số) sẽ hỏi "Bỏ thay đổi?" rồi xóa mật khẩu, mã và bằng chứng xác minh khỏi bộ nhớ.
