# M02-A — Hồ sơ quán, giờ hoạt động và trạng thái nhận đơn

Trạng thái: DESIGN READY FOR OWNER REVIEW — chưa LOCK, chưa giao implementation.
Ngày: 2026-10-08.
Base đã đọc: main@87509eb0e866731ed55dc5b55bb2f3960e03b9a0.
UI_SCOPE: NONE (backend/API). Frontend là task riêng, cần frame Figma được Owner duyệt.

## 1. Cơ sở và phạm vi
M01-A1, A2S (#16) và A2D (#17) đã merge. M02 đã có service_areas, shops, shop_members và ShopEligibilityReader.
M02-A hoàn thiện hồ sơ ACTIVE, lịch mở cửa tuần, công tắc nhận đơn và read port availability cho module Order sau này.
Không triển khai menu, Order/Delivery, Driver, Wallet, ADMIN, SMS thật, chuyển quyền sở hữu, tạo quán thứ hai hoặc frontend.
Không thêm vùng hoạt động Driver. PLATFORM/EXTERNAL không phải Auth role.
Dashboard hiện thiếu mapping PR mới; không dùng phần trăm dashboard làm điều kiện triển khai và không sửa dashboard trong task này.

## 2. Quy tắc và điểm cần Owner duyệt
- Mỗi tài khoản OWNER chỉ sở hữu một quán; giữ nguyên constraint onboarding.
- ACTIVE là trạng thái hồ sơ, độc lập với ONLINE/OFFLINE.
- Quán tự bật/tắt accepting_orders. Ngoài giờ luôn OFFLINE theo phép tính tại thời điểm truy vấn; không cần cron cập nhật hàng.
- Không có lịch nghỉ đặc biệt.
- Đề xuất kỹ thuật cần duyệt: múi giờ cố định Asia/Ho_Chi_Minh; lịch tuần có nhiều khoảng mỗi ngày, phút chính xác, cho phép qua nửa đêm; đóng cửa là exclusive.
- accepting_orders=true là ý định duy trì của chủ quán. Qua giờ đóng cửa ý định vẫn true; tới lần mở cửa sau sẽ ONLINE tự động. Nếu Owner muốn phải bật lại mỗi ngày thì phải sửa contract trước code.
- Chưa có lịch: OFFLINE. Cho phép bật ý định trước khi có lịch; response vẫn OFFLINE và nêu reason NO_BUSINESS_HOURS.
- Hồ sơ ACTIVE có thể sửa tên, liên hệ, Zalo, Facebook, địa chỉ, GPS và service area hợp lệ. Sửa không làm mất role hoặc tạo lại onboarding.
- INCOMPLETE tiếp tục dùng endpoint onboarding; DISABLED không được sửa/bật nhận đơn trong slice này.

## 3. Data ownership và schema
M02 sở hữu toàn bộ SQL shops/shop_members/service_areas/shop_business_hours.
Composition shop-management điều phối Auth + M02, tương tự onboarding. M02 không import AuthModule; không forwardRef.
Migration mới, không sửa migration đã áp dụng, không seed nghiệp vụ, không CASCADE.

Bảng app.shop_business_hours:
- shop_id uuid FK shops NOT NULL;
- weekday smallint 1..7 (ISO: thứ Hai=1);
- start_minute smallint 0..1439;
- end_minute smallint 1..1440;
- end_day_offset smallint 0|1;
- PK (shop_id, weekday, start_minute);
- CHECK: offset=0 thì end_minute>start_minute; offset=1 thì end_minute<=start_minute và end_minute<1440.
Mỗi khoảng dài >0 và <=24 giờ. Ví dụ 18:00–02:00: start=1080,end=120,offset=1; 00:00–24:00: 0,1440,0.
Tối đa 28 khoảng/tuần (giới hạn đề xuất cần duyệt).
Chuẩn hóa mỗi khoảng thành đoạn trên vòng tuần 10080 phút; split wrap Chủ nhật→thứ Hai rồi kiểm overlap toàn bộ. Khoảng liền kề hợp lệ; overlap/duplicate bị reject, không tự gộp.
Lịch không có rows = đóng cả tuần.
Dùng shops.version làm version chung cho profile + hours + accepting_orders. Mỗi mutation thành công tăng đúng 1, kể cả gửi giá trị giống hiện tại bằng key mới. updated_at lấy DB clock.

## 4. API
Bearer opaque session A1; session phải active_role=SHOP, user ACTIVE, có role SHOP và OWNER membership thật.
Actor lấy server-side; không nhận user_id/shop_id/status/role từ body.

GET /v1/shop/me
Trả profile, shop_id,status,version, accepting_orders, timezone, hours và availability {online,reason,evaluated_at}.
Không có quán: SHOP_NOT_FOUND 404. DISABLED qua session SHOP còn tồn tại: đọc hồ sơ được, online=false. Roleless/DRIVER: SHOP_ROLE_REQUIRED 403.
Không audit/outbox/idempotency ở read.

PUT /v1/shop/me/profile
Full replacement: expected_version + name/contact_phone/address_text/pickup_lat/pickup_lng/service_area_id; zalo/facebook optional→null.
Dùng giới hạn/normalizer A2S; GPS và ACTIVE area bắt buộc. Không sửa SĐT đăng nhập hoặc quyền Auth.

PUT /v1/shop/me/business-hours
Body {expected_version, intervals:[{weekday,start_minute,end_minute,end_day_offset}]}.
Full replacement, [] đóng cả tuần. Validation strict, integer ASCII JSON numbers, finite/safe values, unknown keys reject.

PUT /v1/shop/me/accepting-orders
Body {expected_version, accepting_orders:boolean}.

Cả ba PUT cần canonical Idempotency-Key. Response 200: shop_id,version và dữ liệu cấu hình đã commit.
Không đưa availability/evaluated_at vào stored mutation response vì đó là giá trị theo thời gian; GET cung cấp trạng thái hiện tại.

## 5. Availability read port
M02 export port nhận TransactionContext và shop_id; không tự mở transaction.
ONLINE iff shop ACTIVE AND accepting_orders=true AND area ACTIVE AND giờ hiện tại thuộc ít nhất một khoảng.
Reason ưu tiên: SHOP_DISABLED / SHOP_INCOMPLETE / SERVICE_AREA_INACTIVE / MANUALLY_PAUSED / NO_BUSINESS_HOURS / OUTSIDE_BUSINESS_HOURS / ONLINE.
Không có shop -> typed SHOP_NOT_FOUND; status không nhận diện -> TechnicalError, không mặc định ONLINE.
Clock duy nhất PostgreSQL clock_timestamp(); chuyển local bằng AT TIME ZONE 'Asia/Ho_Chi_Minh'. Không dùng đồng hồ thiết bị.
Lấy profile, area, lịch và evaluated_at trong một SQL statement/snapshot; read có thể quan sát trạng thái trước hoặc sau concurrent mutation, không ghép hai cấu hình.
Khi Order triển khai, Order phải recheck qua write/lock port trong transaction tạo đơn; GET ONLINE không cấp quyền tạo đơn về sau. Port write cho Order chưa thuộc slice này.
Auth selectable SHOP vẫn dựa ACTIVE profile, không dựa giờ/accepting_orders. Chủ quán phải vào được để sửa lịch khi OFFLINE.

## 6. Transaction, authorization, idempotency
Reuse M00 executor/audit/outbox; không tự viết primitives.
Mutation identity: scope_type=user, scope_id=authenticated user_id; operation_id shop.profile.update.v1 / shop.business_hours.replace.v1 / shop.accepting_orders.set.v1.
Fingerprint gồm toàn bộ body chuẩn hóa và expected_version; hours sort canonical weekday,start,end,offset (array order không có nghĩa).
Replay guard IDs: user_id,session_id,shop_id. Session hiện tại được xác thực, đúng OWNER/shop, active_role SHOP, user/profile ACTIVE trước decrypt; không bypass quyền do replay.
Không yêu cầu session hiện tại giống session ban đầu: cho phép retry bằng session SHOP mới hợp lệ cùng user/shop; session cũ revoked bị deny.
Replay cùng request bỏ qua expected_version hiện tại; trả kết quả cấu hình cũ chính xác, không chạy callback và không tăng version.
Changed logical body same key -> IDEMPOTENCY_KEY_REUSED trước version check. Không đưa thông tin secret vào guard/audit/outbox.
New execution locks: idempotency → M01 user FOR UPDATE → current session FOR UPDATE (recheck user binding, active_role, revoked, expiry bằng DB clock) → OWNER membership → shop → service area nếu profile update.
Dùng M01 narrow participant để recheck session, không SQL Auth từ M02. Cần mở rộng participant khi LockedSession hiện chưa trả active_role; không chỉ tin guard ngoài transaction.
Check current membership/shop/state/version dưới lock. Giữ thứ tự tương thích A2S và role/select. Không transaction lồng nhau, savepoint hoặc tự retry callback.
Hours replace: delete + insert + shop version + audit + outbox + idempotency cùng transaction.
Nếu service-area writer tương lai đổi trạng thái, phải tuân thủ global lock order; slice này không cung cấp admin area writer.

## 7. Audit/events/errors
Một SUCCESS audit/mutation, safe IDs + version + operation; không phone, tên, địa chỉ, GPS hoặc nội dung profile trong audit.
Một outbox event/mutation: shop.profile_updated.v1 / shop.business_hours_updated.v1 / shop.accepting_orders_changed.v1.
resource_type=shop, resource_id=shop_id, resource_version=version mới, schema_version=1.
Payload chính xác {shop_id,version}; accepting event thêm accepting_orders. Không emit tự động khi giờ đóng/mở; availability computed.
Replay không thêm audit/event.
Dùng error envelope/request_id hiện có; reuse SESSION_*, ACCOUNT_DISABLED, INVALID_SERVICE_AREA và version-conflict code hiện có nếu đã định nghĩa.
Thêm SHOP_NOT_FOUND 404, SHOP_ROLE_REQUIRED 403, SHOP_DISABLED 403, SHOP_PROFILE_INCOMPLETE 409, INVALID_BUSINESS_HOURS 400; lỗi schema generic 400 theo convention hiện có.
Không đổi A1/A2 error semantics.

## 8. Acceptance bắt buộc
A01: OWNER ACTIVE GET roundtrip đủ dữ liệu; roleless/DRIVER/không OWNER không truy cập được.
A02: DISABLED đọc được nhưng mọi PUT deny; INCOMPLETE dùng onboarding, PUT deny.
A03: profile update/contact khác phone đăng nhập hợp lệ; GPS/area invalid deny; unknown privileged fields deny.
A04: lịch thường, nhiều khoảng/ngày, [] và 00:00–24:00.
A05: qua đêm, Chủ nhật→thứ Hai; overlap giữa ngày trước và ngày sau bị chặn; adjacency hợp lệ.
A06: đúng phút mở ONLINE, đúng phút đóng OFFLINE; lấy DB clock + múi giờ Việt Nam, không phụ thuộc timezone process.
A07: toggle false luôn OFFLINE; true ngoài giờ OFFLINE, mở cửa lại ONLINE; thiếu lịch OFFLINE.
A08: area INACTIVE/profile DISABLED luôn OFFLINE; giờ không làm thay đổi Auth selectable.
A09: same key replay exact, lost-response retry, reordered interval input same logical replay; changed body/version conflict key.
A10: stale expected_version không ghi gì; hai writer profile/hours/toggle cùng version chỉ một success.
A11: race mutation vs SHOP session replacement: thứ tự user lock chứng minh mutation trước replacement hoặc deny revoked sau replacement; guard ngoài transaction không đủ.
A12: race hours replace vs GET: một snapshot, không mixed rows/version; đọc không mutate.
A13: fault injection delete/insert/version/audit/outbox/idempotency -> rollback toàn bộ, lịch cũ nguyên vẹn.
A14: replay sau revoke/disabled/mất OWNER deny trước decrypt; session mới đúng user/shop được replay; replay không yêu cầu version hiện tại.
A15: migration clean install/upgrade/down-up/second-up/drift, FK và checks thật PostgreSQL; không thay đổi applied migrations.
A16: giữ toàn bộ A1/A2S/A2D tests xanh; negative PLATFORM/admin fields không sinh quyền.
Unit kiểm validation/interval logic; integration PostgreSQL thật và barrier xác định cho concurrency. Không dùng sleep làm race proof.
Clock-boundary unit dùng instant tham số thuần; integration chứng minh DB clock plumbing/timezone, không sửa clock production để test.

## 9. Handoff và gate
Thiết kế cần Owner duyệt các lựa chọn §2/§3 trước implementation.
Sau lock/merge design: Claude branch feat/m02-a-shop-management từ current main; PR DRAFT; không Ready/merge hoặc module tiếp.
Allowed: shop owner code, shop-management composition/controller, Auth narrow session participant, migration mới, errors, tests, docs/evidence/M02-A.md.
Nếu cần đổi ADR-002/003, role/session policy, M00 semantics hoặc ownership: BLOCKED_BY_FOUNDATION.
Checks: npm ci, lockfile unchanged, lint,typecheck,build,migrations smoke, unit,integration local,integration CI và progress tests nếu docs conventions yêu cầu.
Evidence mapping từng A01–A16 đến test name/CI exact head, counts, race/fault proofs.
Production chưa chạy được OTP thật và chưa có service-area provisioning; không tuyên bố app dùng thực tế sau task này.
