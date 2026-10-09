# M01-D-LOGIN-UI — implementation handoff
Ngày 09/10/2026. Owner yêu cầu triển khai UI sau review backend.
Phân công: ChatGPT thiết kế/handoff/review; Claude viết code/test; Owner test local và thiết bị, quyết định merge/nghiệm thu.
Nguồn visual: docs/tasks/M01-D-auth-UI-v1.md (Owner đã chốt màn login trong hội thoại). Tài liệu này bổ sung hành vi theo backend, không tuyên bố các trạng thái mới đã được Owner nghiệm thu.
Backend đã review: PR #34, SHA 27d3fd702125ac920a055f89e0c36a161892a925; CI xanh. PR chưa merge. M00 chờ Owner.

## Phạm vi
Web login chung SYSTEM/ADMIN: login, enrollment Authenticator, verify, khôi phục trạng thái khi reload, shell sau xác thực và logout.
Chưa có tạo ADMIN, phân quyền nghiệp vụ, recovery, dashboard dữ liệu, app Android. Shell chỉ chứng minh login và role backend; không tự cấp quyền module cho ADMIN.
Không viết lại backend/migration. Finding nhỏ test concurrency PR #34: kiểm trực tiếp challenge đã consumed có attempt_count=5, tránh assertion trên tập rỗng; xử lý riêng với evidence.

## Preflight và base
Fetch main, PR #30 và #34; đọc quy trình repo, handoff backend, preflight-decisions, UI v1 và tài liệu thương hiệu. Báo exact base/head.
UI cần backend PR #34 chưa merge: lập nhánh UI riêng trên head backend đã fetch; ghi stacked dependency, không kéo PR #30 docs vào code bằng merge tùy tiện. Nếu backend đổi, đọc diff và cập nhật dependency.
Repo hiện mới có workspace backend. Claude đề xuất vị trí workspace frontend, stack, script và dependency tối thiểu trong preflight; bám khuôn repo nếu đã có. Ghi lý do trước khi triển khai; không đổi công nghệ backend.
Xác định cách chạy frontend/backend cùng origin qua HTTPS local để Secure __Host cookies thực sự hoạt động. Không hạ cookie Secure/SameSite, không tắt Origin/CSRF, không tin tất cả proxy để chạy demo. Nếu M00 chưa cung cấp HTTPS thì vẫn code/test phần độc lập, ghi rõ browser integration đang chờ môi trường; không tuyên bố local đã đạt.

## Visual
Vàng #D8AD18, than #2A2A2E, trắng #FFFFFF, nền #F2F1EE; Plus Jakarta Sans với fallback sans-serif. Logo 11 từ asset thương hiệu repo, không tự vẽ/thay brand.
Card radius16; input/button12; target>=44px; body14–16px; heading24–28px.
Desktop card giữa trang, mobile một cột không cuộn ngang. Label thật, focus visible, lỗi aria-live, keyboard Enter submit.
Không thay thiết kế màn login đã chốt. Gửi ảnh desktop/mobile từ UI thật để ChatGPT/Owner review.

## Luồng/API
Dùng bảy route /v1/admin-auth hiện hữu. Cookie qua credentials; không bearer và không lưu credential/secret/CSRF trong localStorage/sessionStorage.
POST gửi JSON, Origin do browser, x-csrf-token trên mutation sau login. Không cố tự đặt Origin bằng JS.
Server quyết định role, next_step và expires_at; không lấy role từ URL hoặc dữ liệu client để cấp quyền.
- Khi mở/reload: GET /state. SESSION -> GET /me -> shell; PREAUTH -> ENROLL_TOTP hoặc VERIFY_TOTP; 401 -> login. Loading trung tính trong lúc kiểm tra, không nháy shell trước xác thực.
- Login: phone/password/device đúng parser backend; device_id không mang quyền và không lưu mật khẩu. SĐT validate đồng nhất backend; form một link, không chọn role, không đăng ký.
- POST /login thành công: lấy next_step/expires_at/csrf_token trong memory; xóa password; cookie backend quản lý.
- Enrollment: POST /totp/enrollment {} bằng preauth CSRF; render QR trực tiếp từ otpauth_uri bằng thư viện local, không gửi URI tới dịch vụ QR bên ngoài. Khóa thiết lập ẩn mặc định, hiện theo thao tác; không log/telemetry/cache secret.
- Verify: một input string 6 ASCII digits, giữ leading zero, inputmode numeric, paste, không tự submit. Gọi đúng endpoint enrollment/verify hoặc totp/verify.
- MFA thành công: xóa secret/preauth CSRF khỏi memory, GET /me và vào shell.
- Shell: “Đăng nhập thành công”, role SYSTEM/ADMIN, nút Đăng xuất; không hiển thị dữ liệu/CTA nghiệp vụ chưa xây dựng.
- Logout: POST /logout {} với session CSRF; 204 -> clear UI memory/login; không tự coi logout thành công nếu request mất hoặc lỗi.

## Trạng thái và nội dung
| Tình huống | Hành vi |
|---|---|
| SĐT sai | “Số điện thoại không hợp lệ.” dưới field |
| INVALID_CREDENTIALS | “Thông tin đăng nhập không đúng.” |
| ADMIN_TOTP_INVALID | “Mã không đúng hoặc đã hết hiệu lực.”; giữ bước còn hợp lệ |
| ADMIN_PREAUTH_INVALID | Clear secret/CSRF, login; “Phiên xác thực không còn hợp lệ. Vui lòng đăng nhập lại.” |
| ADMIN_SESSION_INVALID | Clear shell/memory, login |
| ADMIN_AUTH_RATE_LIMITED | Countdown theo Retry-After; không tự retry/submit; hết countdown chỉ mở CTA |
| ADMIN_CSRF_INVALID | Không tự lặp mutation; đọc lại state, báo bước đã thay đổi và cho người dùng chủ động tiếp tục |
| SERVICE_UNAVAILABLE / network | Giữ thông tin không nhạy cảm; “Chưa thể kết nối. Vui lòng thử lại.”; không giả lập thành công |
| Pending request | Disable submit, chống bấm lặp; không khóa navigation vô thời hạn |

Countdown chỉ trợ giúp UI, backend là thẩm quyền. Q1: đúng password có thể cấp preauth khi TOTP_USER khóa; verify vẫn429. UI không suy diễn login thành công là đã mở khóa.
Q2: giữ failure bucket phone/IP và khóa15m hiện hành; không đổi chính sách.
Mất response MFA: thử GET /state để nhận SESSION nếu browser đã nhận cookie; nếu preauth đã consumed và không có cookie thì quay login. Hướng dẫn “Đăng nhập lại và dùng mã mới trong Authenticator.” Không tự gửi lại mã để dò trạng thái.
Reload không tự đăng nhập lại nếu session còn hợp lệ. Secret enrollment chỉ tải lại qua endpoint được bảo vệ và challenge còn hợp lệ.
Hai tab dùng cookie chung: state mới là nguồn sự thật; xử lý CSRF/challenge thay đổi bằng thông báo và thao tác người dùng, không vòng lặp retry.
Không SMS/test OTP/recovery giả trong web admin.

## Kiểm thử/delivery
Frontend test tập trung mapping API/errors, leading-zero/paste, chống duplicate submit, reload SESSION/PREAUTH, no privilege before MFA, 429 countdown, mất response và cleanup secret.
Browser integration thật khi có HTTPS: enrollment QR, CSRF/Origin/cookies, F5 giữ session8h, logout, session bị revoke, hai tab. Không gọi mocked API là integration.
Unit/CI phù hợp frontend cùng các check repo. Không tuyên bố đạt từ typecheck hoặc screenshot.
Delivery: Draft PR UI riêng, exact base/head/backend dependency, file list, scripts chạy, env placeholders, CI đúng SHA, ảnh desktop/mobile thật, checklist kết quả/chờ và hướng dẫn Owner test.
Không sửa tay PROGRESS/plan trái workflow. Không deploy, merge, mark Ready hay đóng M01.
Owner test local -> chỉnh sửa -> test điện thoại/Google Authenticator thật -> nghiệm thu sau M00.
