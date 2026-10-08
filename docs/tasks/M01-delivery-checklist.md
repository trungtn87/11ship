# M01 — checklist Auth, onboarding và phần còn thiếu
Phạm vi đã code là M01-A1/A2, không phải toàn bộ vòng đời tài khoản/quản trị.
UI_SCOPE: FIGMA_REQUIRED cho mọi màn người dùng/quản trị. Các adapter SMS thuần backend ghi NONE, nhưng trải nghiệm OTP vẫn có visual QA/UAT.

## Lịch sử backend đã đạt
- [x] A1 #12: OTP test, register, login, me, role selection và session SHOP.
- [x] A2S #16: hồ sơ quán nháp/hoàn tất và cấp role.
- [x] A2D #17: hồ sơ xế không vùng hoạt động; full_name, plate_number tùy chọn; EXTERNAL/PENDING.
- [x] R1 #19: xác thực session trong transaction/replay, rollback có deadline, router role hiện hành.
- [ ] UI, E2E qua UI, Owner UAT.
- [ ] Logout/recovery/change phone, SMS thật, ADMIN/SYSTEM/2FA.

## Nghiệp vụ/contract A1/A2 trước frontend
- [ ] Đối chiếu API hiện hành sau R1; bảng endpoint → màn hình → lỗi tiếng Việt; không dùng ví dụ legacy đã bị addendum thay thế.
- [ ] Khóa web responsive dùng thử trên Windows/Android, framework/client state, lưu session và retry/idempotency trong ADR frontend trước code; chưa quyết định ứng dụng native.
- [ ] Xác định hành vi refresh/back/offline/double click/session hết hạn, roleless và không còn role khả dụng.
- [ ] Backend SHOP single-active-session hiện có phải được UI thể hiện đúng; không tự áp quy tắc một thiết bị cho mọi role.
- [ ] Scope bản đầu không có logout giả: nếu backend logout chưa có, ghi rõ hạn chế và không đưa nút giả vờ đã revoke server.

## M01-UI — Figma và implementation
Dùng PR #14, Figma https://www.figma.com/design/VFIs4Hablp9z4KnV19gNzv .
PR #14 đang thiết kế; merge workflow chung không thay cho Owner duyệt frame/node từng màn.
- [ ] Khóa logo/màu/font/khoảng cách/control chung theo brand guideline repo.
- [ ] Khóa copy tiếng Việt, required/optional, lỗi/empty/loading/disabled và accessibility cơ bản.
- [ ] UI-AUTH: Login → SĐT đăng ký → OTP → mật khẩu → session router; Owner duyệt frame/node/version.
- [ ] UI-ONBOARD: Shop nháp/hoàn tất/GPS/service area; Driver tên/biển số/PENDING; trường hợp có cả hai role hoặc không có role khả dụng.
- [ ] Không Driver service_area_ids/GPS onboarding; không ví/bank/duyệt xế giả; không nút bật/tắt quán.
- [ ] Claude nối endpoint thật, xử lý idempotency/lost response; token không xuất hiện trong URL/log.
- [ ] Visual QA so với frame đã khóa trên desktop và Android; API contract test giữ tương thích.
- [ ] Mỗi leaf UI có bản chạy, SHA, hướng dẫn và evidence; cần M00-LOCAL-DATA để bàn giao.

## M01-E2E và M01-UAT — bản đầu A1/A2
Design test plan riêng trên group M01-TEST trước code E2E, không gán PR kế hoạch làm bằng chứng đã test.
- [ ] OTP đúng/sai/hết hạn/resend, register retry, phone trùng, mật khẩu sai.
- [ ] Roleless → onboarding; Shop+Driver chuyển vai trò; revoked/expired/stale-role.
- [ ] Shop nháp thiếu dữ liệu, cấp/từ chối GPS thật, hoàn tất; Driver PENDING không nhận đơn.
- [ ] Reload/restart, lỗi mạng, double submit không nhân hồ sơ; DB thật phản ánh đúng.
- [ ] Test hai thiết bị/thẻ trình duyệt cho SHOP replacement; concurrency chuyên sâu giữ ở PG integration.
- [ ] M01-E2E: browser/API/DB thật, phân biệt OTP test và SMS thật; lưu kết quả CI và SHA.
- [ ] M01-UAT: Owner thao tác trên Android thật, xác nhận nội dung/luồng; lỗi được sửa và retest; ghi rõ bản đầu chưa có B/C/D.
- [ ] UI không đủ để xác nhận GPS nếu dùng tọa độ fixture; SMS thật không được báo đạt từ provider giả.

## M01-B — vòng đời tài khoản/phiên (cần design mới)
- [ ] Nghiệp vụ: phạm vi logout hiện tại/toàn bộ phiên; đổi mật khẩu/quên mật khẩu/đổi SĐT; proof purpose, rate-limit, thông báo không lộ tài khoản, thu hồi session sau thay đổi.
- [ ] Chốt session TTL/re-auth. Refresh-token rotation chỉ triển khai nếu được duyệt bằng ADR riêng; kế hoạch không tự thay opaque-session absolute TTL hiện hành.
- [ ] B-LOGOUT: API revoke và replay/race với mutation; không coi xóa token client là logout server.
- [ ] B-PASSWORD: verify/recovery proof một lần, atomic credential update/revoke, test replay/expiry/race.
- [ ] B-PHONE: xác minh số mới, uniqueness, ownership, rollback và đổi phiên; không sửa contact_phone quán nhầm thành phone Auth.
- [ ] B-UI: frame cài đặt tài khoản/logout/password/phone được duyệt rồi nối API.
- [ ] B-E2E: test qua UI với session cũ/mới, OTP sai/hết hạn và quyền bị thu hồi.
- [ ] B-UAT: Owner kiểm bản chạy và duyệt; SMS giả/thật nêu rõ theo C.

## M01-C — SMS thật và chống lạm dụng (cần design mới)
- [ ] Chọn provider, chi phí/quota/số thử được Owner duyệt; secret/server adapter; không gửi SMS thật khi chưa có cho phép.
- [ ] Chốt rate limit phone/IP/device, resend/retry, timeout/provider outage, observability không lộ OTP.
- [ ] C-SMS: staging/production không có fallback test provider; tích hợp adapter và test lỗi.
- [ ] Rà lại UI OTP/copy/cooldown/error khi dùng SMS thật, khóa thay đổi frame nếu có.
- [ ] C-E2E: tin nhắn thật đến số được phép; delivery chậm, resend, code sai/hết hạn; test provider giả không thay thế.
- [ ] C-UAT: Owner nhận SMS thật, kiểm trải nghiệm/chi phí và xác nhận.

## M01-D — ADMIN/SYSTEM/2FA (cần design mới)
- [ ] Nghiệp vụ: SYSTEM duy nhất, bootstrap an toàn, chỉ SYSTEM cấp ADMIN, scope quản trị, phục hồi quyền và audit.
- [ ] D-ACCESS: quyền server-side, không tự nâng quyền qua register/role selection.
- [ ] D-2FA: enroll/verify/replay/time skew/rate limit/recovery; không cho bypass do client flag.
- [ ] D-UI: frame login/enroll/challenge/recovery/admin provisioning được Owner duyệt.
- [ ] D-E2E: từ chối sai role/scope/OTP; lifecycle mất thiết bị/recovery có test.
- [ ] D-UAT: Owner dùng authenticator thật và duyệt quy trình phục hồi.
- [ ] PLATFORM chỉ là loại xế; không mang quyền SYSTEM/ADMIN.

Customer onboarding/role sẽ được thiết kế khi module khách hàng được mở; không tự thêm trong bản test này. Chỉ gọi M01 hoàn thành trong phạm vi kế hoạch đã khóa sau khi các gói tương ứng có UI/test/UAT, không chỉ khi A1/A2 DONE.
