# M01 — nối hồ sơ quán trong 11Food
Ngày 13/10/2026. ChatGPT giao contract; Claude code. Nhánh feat/m01-food-shop-onboarding từ main sau #83 (merge a583a03093a9819e592b78b60669de5ab1140f37).

## 1. Phạm vi / kế thừa
Luồng: Tài khoản khách → Quản lý cửa hàng → tạo/lưu/tiếp tục hồ sơ → lấy vị trí tại quán → hoàn tất → Cửa hàng của tôi; CUSTOMER giữ nguyên; đổi CUSTOMER/SHOP_OWNER bằng client-auth/context khi đủ quyền.
#82 đăng ký không OTP test và #83 tài khoản/phiên đã merge. Dùng shared auth/session/profile/retry/guard hiện có; không làm lại.
F20/F21/F22/F23 đã dựng trong apps/food-web/src/screens.ts nhưng Lưu/Hoàn tất/vị trí còn khóa. Backend onboarding/shop read/save/complete có sẵn. Tài liệu UI ghi chờ backend là nhãn cũ.
PR #84 fix/client-guest-home đang xử lý trang chủ/đăng xuất, không làm lại việc đó. Cập nhật main khi tích hợp nếu #84 đã merge, giữ sửa của #84.
Không làm giờ mở cửa/nhận đơn/menu/doanh thu M02, hồ sơ xế, reset/admin, Android/APK hoặc deploy VPS.

## 2. Điểm vào và tài liệu đúng mục
Code dùng lại:
- apps/food-web/src/screens.ts: shopEntry, F20–F23; không thiết kế lại màn.
- apps/client-shared/src/app.ts, screen.ts, auth/{client,contract,session,transport}.ts; screens/profile-live.ts, leave.ts, components.ts để dùng pattern.
- scripts/client-web-dev.mjs: proxy Food allowlist chính xác.
- apps/backend/src/onboarding/{shop-onboarding.controller,shop-onboarding-validation,shop-onboarding-service,shop-profile-query-service}.ts.
- apps/backend/src/shop/service-area-repository.ts và shop-repository.ts; auth/session-authorization-participant.ts khi cần đối chiếu session TEST_UNVERIFIED.
Chỉ đọc:
- docs/current/M01-workstreams-20261012.md mục luồng Chủ quán và chỉ mục onboarding.
- docs/tasks/M01-A2-onboarding.md §8, §21.1, §24; không áp gate audit/test cũ.
- docs/ui/m01-food-web.md F20–F23.
- docs/design/system-v2-20261011/11-m01-session-device-contract.md §1–5: identity/context/replay.
AGENTS/CLAUDE/quy trình đọc một lần đầu phiên, không kiểm kê toàn M01.

## 3. Wire và hành vi đã có
GET /v1/onboarding/shop/profile → {data:null} hoặc profile own + version (§21.1).
PUT /v1/onboarding/shop/profile + Bearer/Idempotency-Key: bắt buộc name/contact_phone/address_text; tùy chọn zalo/facebook, pickup_lat/pickup_lng, service_area_id, expected_version theo parser hiện có.
Chưa có hồ sơ: expected_version null/absent; có nháp: đúng version hiện tại. Lưu không GPS được, tạo INCOMPLETE/OWNER membership, chưa grant SHOP. Không dùng onboarding endpoint sửa ACTIVE/DISABLED.
POST /v1/onboarding/shop/complete + Bearer/Idempotency-Key, exact {expected_version}: đủ thông tin/vị trí/khu vực ACTIVE mới hoàn tất. Response ACTIVE, accepting_orders=false, version mới, role_granted=true. Không yêu cầu giờ mở cửa.
Hoàn tất không mint token/auto-select: refresh client-auth/me, chuyển SHOP_OWNER qua context khi người dùng vào quản lý; trở lại giao diện khách bằng context CUSTOMER. Không cấp quyền phía UI; CUSTOMER vẫn giữ.
Unknown outcome retry giữ key/body, không auto retry POST; VERSION_CONFLICT tải trạng thái hiện tại và cho người dùng quyết định, không ghi đè. Session hết hạn dùng handling #83.
Proxy Food thêm đúng route/method trên, GET service-areas dưới đây và POST /v1/client-auth/context khi chưa có; forward Bearer/Idempotency-Key đúng nhu cầu, không wildcard/cookie. Ship không nối onboarding quán.

## 4. Phần backend còn thiếu — contract chốt trước code
Repository khu vực hiện chỉ lockShared(id), chưa có route list để UI chọn ID thật.
Bổ sung tối thiểu GET /v1/onboarding/shop/service-areas:
- Bearer, ordinary enabled CUSTOMER theo client session authority hiện có (TEST_UNVERIFIED chỉ khi test mode bật); không query/body, no-store.
- 200 exact {data:[{service_area_id:UUID,name:string}]} chỉ rows ACTIVE, sort name rồi UUID ổn định; chỉ đọc, không audit/outbox/idempotency.
- Dùng table app.service_areas/repository hiện có; không migration, không API quản lý khu vực, không gửi polygon/GPS/định tuyến.
UI chọn khu vực từ danh sách server, không UUID nhập tay/hardcode hay tự suy khu vực từ GPS. Rỗng: báo chưa có khu vực hoạt động, vẫn lưu nháp, khóa hoàn tất đúng lý do.
Không tự seed dữ liệu lên VPS/DB Owner. Kiểm thử dùng area fixture ACTIVE trong DB test sẵn có. Không đánh đồng dữ liệu fixture với dữ liệu vận hành.

## 5. Vị trí và UI cần nối
Dùng geolocation thật của trình duyệt local HTTPS khi người dùng bấm Lấy vị trí; nhận lat/lng/accuracy/time, hiển thị và xác nhận Dùng vị trí này. Không tự lấy khi mở màn, không tọa độ mẫu, không GPS giả khi bị từ chối/timeout/unavailable.
Không bắt bổ sung nhà cung cấp bản đồ ở task này: F22 có thể hiển thị tọa độ/độ chính xác/thời điểm thật và nhãn bản đồ chưa nối, không dựng bản đồ giả. Chức năng lấy/xác nhận vị trí phải chạy.
Giữ form nháp trong bộ nhớ khi F21→F22→F21, không mất tên/địa chỉ/consent/phiên; guard hỏi khi thật sự rời luồng có thay đổi chưa lưu. Lưu nháp xong quay lại đọc được qua API.
F23 hiển thị trạng thái thật; không nhận đơn tự động, các mục M02 vẫn Sắp có. DISABLED không bắt onboarding lại; dữ liệu server quyết định quyền/route. Cập nhật mapping shop trong accountOf từ identity, không shop/role giả.
Logic shared controller/adapter, screen chỉ hiển thị và phát intent. Dùng component/thiết kế đã có; chỉ thêm chọn khu vực và trạng thái cần thiết, không vẽ lại UI.

## 6. Kiểm tra / điểm dừng
Code là chính. Focused check trên phần mới và một smoke với backend/DB test thật: user #82/#83 → lưu không GPS → đọc lại nháp → lưu vị trí + khu vực ACTIVE → complete → refresh identity/context SHOP_OWNER → trở lại CUSTOMER.
Geolocation có thể stub ở automated browser test nhưng API/DB phải thật; ghi Owner GPS thật chưa thử. Kiểm lỗi đã thấy/session invalid/version conflict bằng coverage dùng lại hoặc ca mới thực sự cần.
Không full suite local rồi lặp CI; không thêm audit sâu/ma trận/race/mutation testing mới. Checks bắt buộc vẫn áp dụng.
Local thiếu dependency/Chrome thì ghi giới hạn, dùng CI, không sa vào sửa harness ngoài phạm vi. CI đỏ sửa đúng nguyên nhân; không polling liên tục hoặc retry đến xanh không giải thích.
Trả một Draft PR: code SHA, phần bổ sung, checks/link, lệnh chạy và giới hạn. Không tự merge/deploy/đóng M01 hay chuyển luồng khác. Không rebuild APK cho task web này.
