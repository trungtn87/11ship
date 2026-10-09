# M01-D-LOGIN backend - review fixes (2026-10-09)

Phạm vi: PR #34 (Draft), nhánh `feat/m01-d-login-backend`. Head đã review: `84e39587e82dacc6107ae10079091ac9c475751a`. Base ghi trong checklist: `aeaa9c75245233e242112121a559fef8075e60ea`; `main` chỉ đi thêm 9 commit `chore(progress)` của bot, không đụng migration hay mã Auth/admin (đã so sánh `compare` base...main).
Tài liệu này là bằng chứng kỹ thuật, KHÔNG phải nghiệm thu của Owner. Kết quả CI nằm ở head cuối ghi trong mô tả PR; tài liệu này không tự khẳng định kết quả CI của SHA nào khác.

## 1. Hết hạn phải được quyết định sau khi giữ đủ khóa
Phát hiện tái hiện được. Bằng chứng PostgreSQL (PG16 cục bộ, `SELECT ... FOR UPDATE/SHARE`): biểu thức trong target list được tính TRƯỚC khi LockRows chờ xong; nếu bên giữ khóa không UPDATE hàng thì không có EvalPlanQual tính lại, nên cột `expired` tính trong SELECT khóa có thể sai sau thời gian chờ. Tái hiện ở mức dịch vụ: 6 test đỏ trên CI tại `f951465` (commit chỉ có test).
Sửa:
- SELECT khóa (`challenges.lock`, `lockShared`, `sessions.lockShared`) không còn trả cờ `expired`; truy vấn tra cứu không khóa trả `expired_at_lookup` chỉ dùng để lọc sớm.
- Sau khi giữ khóa cuối, dịch vụ đọc `freshClockMs` (clock_timestamp) rồi so bằng `isExpiredAt(expiresAtMs, nowMs)` (`admin-expiry.ts`; bằng nhau = hết hạn): enrollment, enrollment verify, verify, GET /state (session và preauth), GET /me. Mã TOTP cũng tính theo `nowMs` này.
- Test: `admin-expiry-after-locks.int.spec.ts` (9 test: giữ khóa hàng credential hoặc hàng user, gửi request khi credential còn hạn, để hết hạn, nhả khóa; yêu cầu bị từ chối, không kích hoạt factor, không tạo session) và `admin-expiry.spec.ts` (biên).

## 2. Thay thế challenge đúng hợp đồng
- Factor chưa ACTIVE: login mới thay challenge cũ và xóa generation PENDING cũ (QR cũ vô hiệu).
- Factor ACTIVE: login mới KHÔNG hủy các bước đang sống khác (hai tab); mã TOTP replay qua challenge bị chặn bởi `last_accepted_step`; chỉ MFA thành công mới thu hồi session cũ; login/mã sai không đụng session.
- Test: `admin-supersession.int.spec.ts` (4 test).

## 3. Hai quyết định nghiệp vụ
- Q1: mật khẩu đúng khi TOTP_USER đang khóa vẫn cấp preauth; verify trả `ADMIN_AUTH_RATE_LIMITED` + `Retry-After`; hàng bucket không đổi một byte (kể cả `updated_at`) qua login; ngân sách không reset khi login hay khi mã đúng.
- Q2: bucket mật khẩu giữ theo SĐT và theo IP (không phải SĐT+IP); khóa 15 phút; lần sai chạm ngưỡng trả 429.
- Test: `admin-business-decisions.int.spec.ts`.
- RỦI RO ĐÃ CHẤP NHẬN (ghi rõ): ai biết SĐT của SYSTEM có thể cố ý khóa tài khoản đó bằng khoảng 10 request sai mỗi 15 phút, từ bất kỳ IP nào. Chưa có cơ chế khôi phục trong task này; cần quyết định riêng nếu muốn (ví dụ lệnh vận hành mở khóa).

## 4. Kiểm thử bổ sung
| Nhóm | File | Nội dung |
|---|---|---|
| Xoay khóa CRYPTO | `admin-crypto-rotation.int.spec.ts` | factor/challenge/session cũ chạy sau khi k2 thành khóa active; credential mới gắn k2; bucket và khóa limiter không đổi (limiter dùng HMAC key riêng); thiếu khóa lịch sử → 503 `SERVICE_UNAVAILABLE`, không rơi về khóa mới, không tạo/ tính phí gì |
| XFF / proxy tin cậy | `admin-client-ip.int.spec.ts` | allowlist chính xác `127.0.0.1`: 1 IPv4/IPv6(/64) hợp lệ được tin; nhiều địa chỉ, `unknown`, hostname, port, zone id, rỗng, thiếu header → 400 trước limiter (0 hàng limiter); allowlist `127.0.0.2` hoặc rỗng: header bị bỏ qua hoàn toàn |
| Đồng thời | `admin-concurrency.int.spec.ts` | 14 sai mật khẩu song song: 9×401 + 5×429, `failure_count`=10; 8 sai mã song song: 4×400 + 4×429, challenge của loạt đó có đúng `attempt_count`=5 (kiểm trực tiếp trên hàng đó, không assert trên tập có thể rỗng); bước dùng hết 5 lần thử thì chết, login mới vẫn cấp bước, verify bị khóa trả 429, `failure_count`=5; loạt thứ hai không đổi hàng khóa; double-submit verify và enrollment verify: 1×200, còn lại 401, đúng 1 session |
| Mất response sau commit | `admin-lost-response.int.spec.ts` | retry cùng request: 401 `ADMIN_PREAUTH_INVALID`, không thêm session/audit, factor không kích hoạt lại (cùng generation/version); đồng hồ thật chờ sang bước TOTP kế |

Người dùng tiếp tục sau khi mất response (đúng hợp đồng): đăng nhập lại bằng mật khẩu để nhận bước mới; mã của bước 30 giây đã dùng bị từ chối (replay guard) cho tới bước kế tiếp; session mà người dùng không nhận được cookie bị thu hồi khi MFA thành công kế tiếp. Với enrollment, authenticator đã giữ secret nên người dùng chỉ cần đăng nhập lại và nhập mã.

## 5. Giới hạn môi trường
Môi trường làm việc không chạy được jest/PG17 (npm 403). Đã làm: kiểm tra cú pháp và typecheck bằng shim (chỉ lỗi do shim thiếu kiểu thư viện, không lỗi logic trong file đã sửa). Typecheck/lint/build/unit/integration chính thức PG17 lấy từ CI tại head cuối của PR.
