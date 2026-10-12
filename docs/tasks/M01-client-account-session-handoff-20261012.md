# M01 — nối tài khoản khách và phiên Food/Ship
Owner giao tiếp sau #82 ngày 12/10/2026. Nhánh: feat/m01-client-account-session, base d8c6be9fffe14bb9ef2480f5c6eb170ebd8e73db. ChatGPT giao contract; Claude code.

## Đã có / cần làm
#82 đã merge: Food đăng ký thật và DISABLED_TEST không OTP; backend register/login/me/context/logout và GET/PUT customer/me/profile có sẵn. Shared auth đã có login/me/logout, session và bảo vệ retry/response muộn. Ship có màn auth/account nhưng chưa nối.
Hoàn thiện đúng một luồng tài khoản khách trên web local Food/Ship: đăng ký → đăng nhập → xem/sửa tên hồ sơ cá nhân → đăng xuất, xử lý hết phiên. Dùng đăng ký #82 cho Ship, không viết lại OTP engine/backend. UI tiếp tục theo màn có sẵn, logic ở shared controller/adapter.
Không triển khai onboarding quán/xế, reset, quản trị, native binding, APK, deploy hoặc module khác. Đăng nhập Ship không cấp quyền nhận đơn; màn onboarding chưa nối giữ khóa/lý do đúng.

## File dùng lại
- apps/client-shared/src/auth/{client,contract,session,transport}.ts; register-flow.ts; screens/auth.ts; app.ts; screen.ts; ports.ts.
- apps/food-web/src/screens.ts: F10, F04/F16, F17 và logout; apps/ship-web/src/screens.ts: S10/S11/S18, S05/S14/S19. Dùng shared profile component nếu Ship chưa có màn riêng, giữ style/layout hiện hữu.
- scripts/client-web-dev.mjs: mở đúng allowlist cần cho Food/Ship, không wildcard.
- Backend client-auth/client-auth.controller.ts, customer-profile/customer-profile.controller.ts và customer-profile-validation.ts để đối chiếu wire; backend không cần dựng lại. Chỉ sửa backend nếu gặp lỗi thực tế của luồng đã giao.

## Contract cần nối
Login POST /v1/client-auth/login exact {phone,password,device}, Idempotency-Key; app FOOD/SHIP đúng nguồn app. GET /v1/client-auth/me Bearer. POST /v1/client-auth/logout exact {}, Bearer, 204 xác nhận revoke.
Profile GET /v1/customer/me/profile không body/query; PUT cùng route exact {full_name,expected_version}, Bearer + Idempotency-Key. Response {data:{user_id,full_name,version}} hoặc GET {data:null}. VERSION_CONFLICT: tải bản hiện tại/cho người dùng sửa lại; không tự ghi đè. Sau lưu, cập nhật tên hiển thị từ kết quả server.
Dùng lại normalization/name, errors, idempotency và session generation; không thêm store quyền/identity. Unknown outcome giữ key/body cho người dùng thử lại, không auto retry POST. Token/password chỉ memory, F5 đăng nhập lại; không đưa token vào URL/storage/log.
Sai mật khẩu hiển thị lỗi login, không coi là phiên hết hạn. Phiên invalid/revoked/expired xóa dữ liệu nhạy cảm và về đăng nhập. Logout offline xóa local nhưng không nói server đã revoke.
Food/Ship web local không chứng minh policy cùng điện thoại native; không sửa gate ANDROID/production để nối web.
DISABLED_TEST giữ nguyên #82: lấy config từ server, không OTP/proof giả. Dùng lại controller đăng ký cho Ship; routing theo identity/server hint, hồ sơ xế chưa nối thì nói rõ, không tạo hồ sơ/role DRIVER giả.
Proxy chỉ forward route/method trên, Bearer/Idempotency-Key khi cần; không forward cookie/headers tùy ý. Các route OTP chỉ theo đăng ký đang có.
Giữ test build local HTTPS hiện hữu; không mở VPS trong task này.

## Chỉ mục đọc
Sau AGENTS/CLAUDE/quy trình/workstreams một lần lúc đầu, chỉ đọc:
- docs/design/system-v2-20261011/11-m01-session-device-contract.md §1–5, §6 để giữ boundary web/native.
- docs/design/system-v2-20261011/10-m01-client-contract.md §5.
- docs/ui/m01-food-web.md đúng F10/F04/F16/F17; docs/ui/m01-ship-web.md đúng S10/S11/S18/S05/S14/S19.
- Handoff #82 §2 khi cần đối chiếu test mode: docs/tasks/M01-food-register-disabled-test-handoff-20261012.md.
Không đọc lại toàn backend/PR/tài liệu M01. Nhãn chờ backend trong UI đã cũ: endpoint có sẵn, cập nhật đúng dòng khi nối.

## Kiểm tra và điểm dừng
Code là chính. Dùng test/harness sẵn có; focused check cho login → đọc/sửa tên → logout và session invalid; một smoke liên thông phần mới trên Food/Ship, dùng đăng ký #82 làm đầu vào. Không nhân bản cả ma trận cho hai app.
Không full suite local rồi lặp ở CI; checks bắt buộc hiện hữu vẫn áp dụng. Nếu dependency/Chrome local không chạy được, ghi giới hạn và dùng CI; không loay hoay sửa bộ chạy test ngoài phạm vi. Lỗi chức năng đã thấy hoặc CI bắt buộc đỏ vẫn phải sửa đúng nguyên nhân.
Không polling liên tục, không rerun CI xanh, không thêm audit sâu/báo cáo trùng. Sau push kiểm trạng thái vào mốc cần thiết; CI còn chạy thì báo link và trạng thái trung thực, không giữ phiên chỉ để hỏi lại liên tục.
Trả một Draft PR nhất quán: code SHA, hành vi bổ sung, kiểm tra/link, cách chạy, giới hạn. Không tự merge/deploy/đóng M01 hoặc sang luồng khác.

## Quyền tài khoản test Owner đã chốt
Được tạo một ADMIN đầy đủ grants trong phạm vi ADMIN khi cần kiểm thử local/CI, bằng cơ chế hiện có, giữ TOTP và origin ADMIN_PROVISIONED; không SYSTEM, không bypass. Không tạo/sửa tài khoản này trên VPS, không ghi mật khẩu/TOTP secret vào repo/log/PR. Không kéo việc tạo tài khoản quản trị vào luồng khách này khi không cần.
