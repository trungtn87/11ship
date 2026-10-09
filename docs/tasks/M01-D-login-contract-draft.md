# M01-D-LOGIN — gói đăng nhập quản trị
Ngày 09/10/2026. DRAFT CONTRACT, chưa READY_FOR_CLAUDE.
Nguồn: workflow/ADR-002 main; main login-service.ts, session-repository.ts, auth.controller.ts; quyết định Owner SYSTEM duy nhất, form chung và 2FA bắt buộc.
ChatGPT thiết kế/handoff/review; Claude code/tests/build; Owner duyệt/test/merge. M00 tạm dừng; nghiệm thu local chưa mở.

## Quyết định Owner chốt ngày 09/10/2026
Nguồn: Owner nói “Chốt các điểm còn lại” sau bảng tham số đăng nhập và sửa reload.
- Hoàn tất bước 2FA trong 5 phút.
- Tối đa 5 lần sai mỗi challenge; budget 5 mã sai/15 phút theo user, khóa tạm15 phút để challenge mới không reset budget.
- Phiên quản trị TTL tuyệt đối8 giờ; tải lại trang giữ phiên, không kéo dài TTL.
- Chỉ sau login +2FA thành công trên máy mới mới thu hồi phiên quản trị cũ; thất bại không đá phiên cũ.
- Cookie web bảo mật HttpOnly/Secure; backend kiểm phiên/quyền sau reload. Không giữ bearer trong localStorage.
Các lựa chọn kỹ thuật đã trình bày trong luồng (TOTP 6 số/30s, cửa sổ current/previous, budget mật khẩu10 lỗi/15 phút) được ghi nhận cùng đề xuất còn lại; không suy rộng sang scope tạo ADMIN/recovery hoặc invariant một thiết bị toàn hệ.
Màn login chung đã được Owner duyệt; không tự xác nhận toàn bộ UI state/recovery.
Gói này đã chốt tham số nghiệp vụ đăng nhập; vẫn DRAFT kỹ thuật: cần final API/error/schema/migration/CSRF và frontend integration trước READY_FOR_CLAUDE. Không code/merge/deploy từ quyết định này.

## Trạng thái duyệt
Owner ngày 09/10/2026 nói “Ok. Chốt màn login”: ghi nhận duyệt màn login chung đã trình bày, không tự mở rộng thành duyệt mọi màn/trạng thái/recovery hoặc toàn bộ API/schema.
SYSTEM duy nhất khởi tạo sẵn, ADMIN chỉ do SYSTEM tạo, tất cả quản trị phải qua 2FA là nghiệp vụ đã chốt.
Các tham số và endpoint dưới đây là đề xuất cần duyệt/review kỹ thuật.

## Kết quả kiểm kê
AuthController hiện /auth/login trả access_token sau mật khẩu; LoginService tạo session roleless và đọc eligibility SHOP/DRIVER. SessionRepository chưa có bằng chứng 2FA trong session view.
Không dùng token app hoặc role/select để nhận quyền quản trị. Cần API quản trị riêng dù UI login SYSTEM/ADMIN chung.
Không thay semantics /auth/login và /auth/role/select cũ trong gói này. Một thiết bị toàn tài khoản giữa các app vẫn cần task M01-B riêng; gói này chỉ quản lý phiên quản trị, không tuyên bố invariant toàn hệ đã đạt.

## Phạm vi
Bootstrap SYSTEM; mật khẩu → enroll/challenge TOTP → phiên quản trị; /me và logout quản trị; UI xác thực đã được duyệt trong phạm vi tương ứng.
Không tạo ADMIN trong gói 1; không dashboard nghiệp vụ, recovery/reset 2FA, đổi mật khẩu/phone hay SMS thử. ADMIN flow được test bằng fixture integration riêng, không seed ADMIN qua public API.
Frontend chưa thống nhất #24/#29/#31: phải chọn/tích hợp nền UI được review trước code UI; backend có thể tách PR trước. Không dùng gói này làm quyền merge các PR đó.

## Contract kỹ thuật hiện hành
Đọc [backend handoff](M01-D-LOGIN-backend-handoff.md) cho API/schema/cookie/CSRF và các sửa F01–F06. Tài liệu này chỉ lưu quyết định nghiệp vụ và phạm vi; không duy trì bảng bearer/schema tạm thứ hai.
Web dùng HttpOnly/Secure cookie; /state và /me trả CSRF ổn định theo credential, F5 không đăng nhập lại.
Gói login trả admin_role, chưa trả scopes; ADMIN chưa có quyền module. Scope sẽ thiết kế ở task tạo ADMIN.
## Acceptance bắt buộc
- Singleton bootstrap: concurrent/rerun/conflict, không thay mật khẩu, không nâng user cũ.
- Sai phone/password/no admin membership; không có privileged session trước2FA.
- Enroll pending/đã active, QR không public, mã sai/hết hạn/replay/window.
- Verify concurrency chỉ một thành công; last step dùng chung, budget qua challenge mới.
- Challenge/phiên expired hoặc revoked; user/member/password/factor đổi khi chờ khóa.
- App token/preauth/admin token dùng sai audience đều bị từ chối.
- Login admin mới thành công revoke admin cũ; login thất bại không đá cũ.
- Logout thật; loss-response không tạo replay bypass hoặc UI auto retry.
- Key rotation/key unavailable/ciphertext lỗi fail closed, không secret leak.
- Hồi quy REGISTER/login/me/role/select/onboarding SHOP/DRIVER cũ.
- Browser normal/loading/error/focus/reload/expiry với API/DB thật; TOTP Google Authenticator thật trên điện thoại sau M00 local đạt.
Evidence đúng final SHA; CI không thay Owner acceptance.

## Việc cần làm trước giao code
- [x] Owner chốt các tham số đăng nhập còn lại ngày09/10/2026; reload giữ phiên.
- [ ] Khóa chi tiết cookie/CSRF, API/schema và phạm vi frontend trước code.
- [ ] Review kỹ thuật schema/API lỗi/idempotency/audience/lock order/migration và dependency TOTP.
- [ ] Chốt frontend tích hợp và đủ UI state duyệt; login đã duyệt không thay toàn gate UI.
- [ ] Tạo handoff Claude final có base SHA, files, test matrix, PR Draft và điều kiện chuyển.
- [ ] Claude code; ChatGPT review; Owner local rồi thiết bị; merge/đóng theo quyết định.
Web quản trị đang thiết kế; các app khác hồi quy có dependency nhưng chưa nghiệm thu. Không N/A/đóng M01.
