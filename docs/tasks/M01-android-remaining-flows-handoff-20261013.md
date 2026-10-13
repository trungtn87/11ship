# M01-ANDROID — nối hết các luồng còn lại
Ngày 13/10/2026. Owner: “Vậy triển khai hết đi”. Claude code, ChatGPT giao contract và tích hợp.
Cùng nhánh feat/m01-android-account-session / PR #95. Mốc kế thừa 3ffd51000ed8c651e753759be6b39a244769a763: Verify/Launcher/Preview xanh; hai APK compile đã qua, distribution dừng vì 4 signing secrets thiếu. Không chạy lại gói auth từ đầu.

## Kết quả
Hoàn tất code Android còn thiếu trong phạm vi M01 test: Food onboarding quán F20–F23; Ship onboarding xế S12–S13; Food/Ship reset mật khẩu. Làm tuần tự trong cùng nhánh/PR, không dừng xin giao lại sau từng màn.
Không triển khai SMS/email thật, recovery SYSTEM email, order/wallet/GPS vận hành, bản đồ hay module khác. Các phần hoãn vẫn ghi chưa triển khai, không đánh PASS.
Không chờ signing secrets để viết code/test. Thiếu secrets thì không xuất APK, không đổi khóa ký và không nhận là đã chạy trên thiết bị.

## Tài liệu/code dùng lại
Trong phiên Claude hiện tại không đọc lại AGENTS/CLAUDE/quy trình/handoff auth nếu chưa thay đổi; phiên mới đọc một lần.
- docs/current/M01-workstreams-20261012.md: M01-QUAN/XE/RESET/ANDROID và §5.
- docs/tasks/M01-A2-onboarding.md: chỉ phần quán rồi phần xế.
- docs/ui/m01-food-web.md F20–F23; docs/ui/m01-ship-web.md S12–S13 và S15; reset Food F13. UI web là tham chiếu bố cục/trạng thái, không viết lại nghiệp vụ.
- PR #85 head d32d51d: apps/client-shared/src/shop-flow.ts, screens/shop-live.ts, auth/{contract,client}.ts; backend onboarding/shop-onboarding.controller.ts + validation/service hiện có.
- PR #88 head 63faa208: apps/client-shared/src/driver-flow.ts và màn driver live (xác nhận đúng đường dẫn trước đọc); backend onboarding/driver-onboarding.controller.ts, customer-profile/driver-me.controller.ts.
- PR #93 head 5272ceb: apps/client-shared/src/recovery-flow.ts, screens/reset-live.ts; apps/backend/src/account-recovery/account-recovery.controller.ts và config/validation.
- Dùng nền mới #95: mobile/packages/n11_shared/lib/src/account/{api_client,native_auth,models,session_controller,session_factory,account_views}.dart; shell/components; mobile/{food,ship}/lib/*_tabs.dart.
- scripts/native-gateway.mjs; mobile/tool/android-templates/kotlin/ và manifest; test helper native-device-binding.int.spec.ts. Không đọc toàn module/PR.

## Food — hồ sơ quán
1. Tài khoản -> Quản lý cửa hàng; đọc hồ sơ server trước, không tạo nháp ngầm hoặc đoán trạng thái.
2. Nối exact contract có sẵn: GET/PUT /v1/onboarding/shop/profile, GET /v1/onboarding/shop/service-areas, POST /v1/onboarding/shop/complete; tra controller/validation hiện hữu để dùng đúng method/body/version. Không tự đổi endpoint/schema.
3. F20–F23 dùng component Flutter có sẵn, giữ dữ liệu nhập khi chuyển bước; lưu hồ sơ khi chưa có GPS, mở lại tiếp tục từ dữ liệu server.
4. Lấy vị trí THẬT một lần khi user bấm tại quán. Thêm native bridge hoặc thư viện phù hợp để request quyền location foreground; chỉ permission tối thiểu, không background service/tracking. Không tự lấy liên tục, không tọa độ giả/default hay nhập tọa độ tùy ý để vượt gate. Denied/disabled/timeout/unavailable có thông báo và cho lưu nháp, không hoàn tất khi thiếu dữ liệu bắt buộc.
5. Khu vực lấy từ service-areas ACTIVE; không seed, không hardcode UUID/khu vực, không tự suy vùng từ GPS. Rỗng/lỗi -> cho lưu nháp, nói rõ chưa hoàn tất.
6. Complete theo version/idempotency hiện có -> đọc identity/profile hiện tại; cửa hàng ACTIVE, accepting_orders=false; thêm SHOP_OWNER nhưng giữ CUSTOMER. Chỉ chuyển context theo thao tác user, ký POST /v1/client-auth/context. CUSTOMER <-> SHOP_OWNER cùng phiên Food, không revoke Ship.
7. Hồ sơ ACTIVE/DISABLED chỉ xem theo API hiện hữu; không tự thêm API sửa sau hoàn tất. Không giờ mở cửa/nhận đơn/bản đồ.

## Ship — hồ sơ xế
1. Tài khoản -> Hồ sơ xế; GET /v1/driver/me trước. Chưa có -> S12, đã có -> S13, không tạo bản thứ hai.
2. S12 họ tên bắt buộc, biển số tùy chọn; POST /v1/onboarding/driver đúng contract hiện hữu. Không lấy tên customer để điền ngầm.
3. Thành công -> me và driver/me đọc lại; giữ identity hiện có và CUSTOMER, thêm DRIVER từ server; không tự đổi context/cấp quyền nhận đơn.
4. S13 đọc PENDING/ACTIVE/SUSPENDED/CLOSING/CLOSED, tên/biển số/loại xế thực từ server. Mở màn lại đọc mới, có Tải lại. Không sửa, không bịa lý do xét duyệt hoặc dữ liệu ngân hàng/ví.
5. Account/home hiển thị trạng thái server, nhận đơn vẫn khóa. PLATFORM chỉ loại xế, không SYSTEM quyền quản trị.

## Reset Food/Ship
1. Một shared Flutter form dùng bố cục F13/S15: phone/password/confirm ở client.
2. GET /v1/account-recovery/config; chỉ DISABLED_TEST mới mở submit; unknown/UNAVAILABLE/lỗi đóng đúng thông báo. Server config quyết định, không client override.
3. POST /v1/account-recovery/reset-test exact {phone,password} + Idempotency-Key. Đây là route PUBLIC: không gửi token, cookie hay device proof; không bắt login/Keystore/attestation trước reset.
4. Cùng generic 200 {data:{next:LOGIN}} -> “Yêu cầu đã xử lý…” và nút Đăng nhập; không khẳng định số có account, không tự login, không suy quyền/identity từ ack. Nhập lại mật khẩu không gửi backend.
5. Thử lại sau mất phản hồi dùng đúng key/body; không auto retry; đổi intent là key mới. Không OTP giả hoặc proof RESET_PASSWORD giả; REQUIRED SMS/email vẫn hoãn.
6. Nếu phiên hiện tại hết hiệu lực sau reset, dùng cơ chế 401 hiện hữu để xóa token/PII/mọi controller cache; không biến public reset thành endpoint xác thực.

## Hạ tầng chung, không làm lại #95
- Typed adapters/models và controllers quán/xế/reset tách widget, reuse NativeAuthApi.signedCall cho protected routes. Mọi request protected mới có proof/time/nonce/raw bytes đúng #95; retry key/body cũ + nonce mới.
- Với protected onboarding writes/context: kiểm binding/head trong cùng transaction nghiệp vụ, không chỉ guard HTTP. Chỉ bổ sung hook thiếu ở đúng service/participant hiện có; không rebuild backend onboarding/schema.
- Session/logout/401/dispose phải hủy pending views và xóa PII/form cache; response muộn không đổi identity/context hay dựng hồ sơ của phiên khác.
- Native gateway thêm allowlist đúng các route/method nêu trên và reset public; không wildcard/query bất ngờ. Header forwarding phân biệt public reset (không authorization/proof) và protected; web proxy không đổi.
- Permission check trong workflow hiện chặn mọi ACCESS*: sửa thành allowlist chính xác location foreground cần cho Food (FINE/COARSE nếu API dùng cả hai), INTERNET; Ship chưa cần location. Vẫn chặn background location/camera/contacts/storage.
- applicationId/key ký/versionCode/TLS giữ contract #95; không uninstall/clear data/ephemeral signer. Chỉ Food dùng quyền vị trí hồ sơ quán.
- Contract AUTH time/nonce mới đã Owner được thông báo: cập nhật §7–8 tài liệu session-device trên nhánh để khớp literal wire đang chạy; không thêm format thứ ba hoặc đổi code đã xanh vì lý do biên tập.

## Kiểm tra và hoàn tất
- Focused controller/widget cho mỗi luồng vừa nối; không chạy full local backend/client suite. Ca chính: Food save sans GPS -> reload draft -> denied location -> valid location+ACTIVE area -> complete/context giữ CUSTOMER; Ship submit/read saved/PENDING/no duplicate; reset config gate/generic ack/retry -> login.
- Một bộ integration native bổ sung trên backend/DB thật với test key fixture: protected shop/driver/context kiểm proof + transaction binding recheck; reset thu hồi phiên native. Dùng helper #95, không tạo suite server/browser tương đương lần nữa.
- GPS có thể stub trong test tự động nhưng không gọi là GPS hardware PASS. Widget/fixture không chứng nhận điện thoại thật.
- Build/analyze app bị ảnh hưởng, CI bắt buộc hiện hữu; Mobile APK build hai app một lần ở final head. Không rerun chỉ vì signing secrets còn thiếu, không polling vòng lặp.
- Cập nhật mobile/README.md đúng cách thử ba luồng + env/location/trust; PR #95 rewrite mô tả theo phạm vi cuối, một báo cáo ngắn với SHA/bằng chứng/giới hạn. Không tạo nhiều report/PR theo màn, không sửa PROGRESS sinh tự động.
- Commit/push cùng nhánh, không tự merge/deploy/VPS. Xong toàn code connected mới chuyển M01-FINAL để ChatGPT gom finding một lần; sau sửa chỉ delta. Không tự mở audit sâu trong lúc code.
- Owner actual sau có signing secrets + APK: cài Update giữ dữ liệu/key/token, GPS thật tại quán, hai app cùng điện thoại và hai điện thoại replacement. Email/SMS thật vẫn ghi hoãn, không “M01 production ready”.
