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

Trạng thái của mục 1–3 (API): chưa có UI (xem mục 6 cho đăng nhập/hồ sơ/đăng xuất), context mới, reset mật khẩu, onboarding quán/xế, native binding hay SMS nhà mạng trong gói này. Kết quả thử tay của Owner phải ghi theo thực tế, không suy ra từ CI.

## 4. Thử bằng giao diện 11Food (M01.07, local) — chế độ REQUIRED (có OTP)

Luồng thật: F11 (họ tên, SĐT, mật khẩu, nhập lại, đồng ý) → F12 (mã OTP) → tài khoản được tạo → F01 đã đăng nhập bằng phiên/danh tính do máy chủ trả. Chỉ chạy ở local; **không** mở trên VPS test (xác minh OTP ở VPS vẫn đóng).

1. `.env` local có `OTP_PROVIDER=TEST_INBOX`, cặp `CLIENT_AUTH_TERMS_VERSION` / `CLIENT_AUTH_PRIVACY_VERSION` ở mục 1, `APP_ENV=development`, `HOST=127.0.0.1`; backend chạy trên DB local.
2. Chạy `tools\local\11Ship-Update.cmd`, rồi `11Ship-Food.cmd` (mở https://localhost:8444; chứng chỉ theo [local-https-runtime.md](local-https-runtime.md)).
3. Mở **Tài khoản → Đăng ký**, đọc hai nội dung chấp thuận thử, nhập thông tin, tick đồng ý, bấm **Tiếp tục**.
4. Lấy mã: chạy `tools\local\11ship-test-sms.cmd`, chọn tin REGISTER của số vừa nhập (màn hình không hiện mã). Nhập mã vào F12, bấm **Xác minh**.
5. Thành công: về trang chủ với tên bạn nhập. F5 trả về khách (phiên chỉ nằm trong bộ nhớ trang).

Nếu mất phản hồi ở bước tạo tài khoản, F12 hiện **Thử lại**: gửi lại đúng yêu cầu cũ (cùng `Idempotency-Key`), không cần mã mới. Rời màn hình (Quay lại/Đổi số) sẽ hỏi "Bỏ thay đổi?" rồi xóa mật khẩu, mã và bằng chứng xác minh khỏi bộ nhớ.

## 5. Thử bằng giao diện 11Food không OTP (DISABLED_TEST, chỉ local)

Dùng khi chưa có SMS nhà mạng. Tài khoản tạo ra có `account_origin = TEST_UNVERIFIED`, `phone_verified_at` rỗng, hiển thị là **chưa xác minh (test)** — không bao giờ là "đã xác minh", không có quyền quản trị (ADMIN/SYSTEM vẫn cần TOTP) và gate thiết bị Android vẫn đóng.

1. `.env` local như mục 4 nhưng **không** cần `OTP_PROVIDER=TEST_INBOX`; thêm `CLIENT_AUTH_PHONE_VERIFICATION_MODE=DISABLED_TEST`. Bắt buộc `APP_ENV=development` (hoặc `test`) và `HOST=127.0.0.1`; giá trị khác, hoặc staging/production/host không loopback, làm backend từ chối khởi động.
2. Chạy `tools\local\11Ship-Update.cmd`, rồi `11Ship-Food.cmd` (https://localhost:8444). F11 hỏi `GET /v1/client-auth/config`; nếu không nhận được câu trả lời hợp lệ, nút đăng ký bị khóa kèm "Thử lại".
3. Mở **Tài khoản → Đăng ký**: nút là **Đăng ký**, kèm ghi chú "Bản test: tạm không xác minh số điện thoại". Nhập thông tin, tick đồng ý, bấm **Đăng ký**: về F01 đã đăng nhập, không có F12, không đếm ngược, không gửi lại mã.
4. Mất phản hồi: màn hình hiện **Thử lại**, gửi lại đúng yêu cầu cũ (cùng `Idempotency-Key`), không tạo thêm tài khoản. Tắt chế độ hoặc thu hồi/hết hạn phiên thì replay không trả token nữa.
5. Tắt chế độ (bỏ biến, chạy lại backend) quay về REQUIRED: tài khoản test không đăng nhập được và token cũ bị từ chối.

Gọi API trực tiếp: `POST /v1/client-auth/register` nhận đúng `{phone,password,device,full_name,consent}`; có `verification_token`, `role`, `permission` hay `accepted_at` là 400.

## 6. Đăng nhập, xem/sửa tên, đăng xuất (Food 8444, Ship 8445; chỉ local)

Dùng tài khoản vừa đăng ký ở mục 4 hoặc 5 (cả Ship dùng lại đăng ký này). Phiên chỉ nằm trong bộ nhớ trang: F5 là đăng nhập lại; mật khẩu và token không vào URL, storage hay log.

1. Chạy `tools\local\11Ship-Update.cmd`, rồi `11Ship-Food.cmd` (https://localhost:8444) hoặc `11Ship-Ship.cmd` (https://localhost:8445).
2. **Tài khoản → Đăng nhập**: SĐT + mật khẩu. Sai mật khẩu hiện lỗi đăng nhập (không phải "phiên hết hạn"). Đăng nhập Ship không cấp quyền nhận đơn; hồ sơ xế vẫn khóa kèm lý do.
3. **Tài khoản → Thông tin cá nhân** (Food F17, Ship S05 `/account/profile`): đổi họ tên rồi **Lưu thay đổi**; tên hiển thị lấy từ kết quả máy chủ. Nếu hồ sơ đã đổi ở nơi khác (`VERSION_CONFLICT`), màn hình tải bản hiện tại để bạn sửa lại, không tự ghi đè. Mất phản hồi: **Thử lại** gửi lại đúng yêu cầu cũ (cùng `Idempotency-Key`).
4. **Đăng xuất**: có hộp xác nhận. Máy chủ trả 204 thì báo đã đăng xuất; offline thì chỉ báo đã xóa phiên trên máy này, chưa xác nhận với máy chủ.
5. Phiên bị thu hồi/hết hạn (kể cả thu hồi từ nơi khác): lần gọi tiếp theo xóa dữ liệu nhạy cảm và về màn đăng nhập.

Proxy local chỉ chuyển các route đã liệt kê (OTP/đăng ký, config, login, me, logout, `GET|PUT /v1/customer/me/profile`), chỉ kèm Bearer/Idempotency-Key khi cần, không cookie. Gate Android/production không đổi; chạy web local không chứng minh chính sách trên điện thoại.

## 6. Quên mật khẩu không OTP (bản test, chỉ local) — M01-RESET

Handoff: [`docs/tasks/M01-reset-disabled-test-handoff-20261013.md`](../../docs/tasks/M01-reset-disabled-test-handoff-20261013.md). Owner đã duyệt bỏ OTP ở bản test: **không gửi mã, không chứng minh sở hữu SĐT**.

1. `.env` local: thêm `ACCOUNT_RECOVERY_MODE=DISABLED_TEST` (mặc định/không đặt/`UNAVAILABLE` = đóng, endpoint trả 503). Bắt buộc `APP_ENV=development|test` và `HOST=127.0.0.1`; giá trị khác, staging/production hoặc host không loopback làm backend từ chối khởi động (chỉ in tên biến). Không request/header nào bật được.
2. Chạy backend và các front như mục 5 (và Web Admin `npm run build:admin-web && npm run admin-web:dev`).
3. Food/Ship: **Đăng nhập → Quên mật khẩu** (`/reset`) → SĐT + mật khẩu mới + nhập lại → “Yêu cầu đã xử lý…” → **Đăng nhập** bằng mật khẩu mới. Web Admin: `https://localhost:8443/reset` cùng luồng; đăng nhập xong vẫn qua mã Authenticator.
4. API: `GET /v1/account-recovery/config` → `{data:{mode}}`; `POST /v1/account-recovery/reset-test` (`Idempotency-Key`, body đúng `{phone,password}`) → `200 {data:{next:"LOGIN"}}` **giống hệt** cho tài khoản đã reset, số không có, SYSTEM và tài khoản ngoài phạm vi (các trường hợp sau không đổi gì).
5. Reset thu hồi mọi phiên Food/Ship/Admin và bước đăng nhập đang chờ của tài khoản; giữ vai trò, trạng thái (tài khoản đang khóa vẫn khóa), hồ sơ và TOTP. Audit `account.password.reset_test.v1` (ID, version, `TEST_NO_PHONE_VERIFICATION`; không SĐT/mật khẩu).
6. **Chưa test, hoãn đến khi có dịch vụ OTP thật:** gửi OTP, OTP sai/hết hạn, gửi lại, proof RESET_PASSWORD, email/SYSTEM recovery.
