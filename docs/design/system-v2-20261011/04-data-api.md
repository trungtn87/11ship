# Dữ liệu và hợp đồng API

Phiên bản **2.0.0**; **CURRENT_CONTRACT + ADDITIVE_PROPOSALS**. Nguồn: main đã pin, PR Auth Admin và manifest/ADR được ghi ở [07](07-source-index.md). Mỗi nhóm ghi Main/PR/Proposal; không có SQL/migration nào được thực thi trong phiên thiết kế.

## 1. Quy ước giữ nguyên

Base `/v1`; JSON snake_case; success `{data:...}`; error `{error:{code,message,request_id,details:{}}}`. Error main có message cố định tiếng Anh, client map copy tiếng Việt theo code; details hiện rỗng, không tự đưa raw exception vào đó.

UUID canonical; timestamp ISO8601 UTC, UI giờ Asia/Ho_Chi_Minh. Resource version integer≥1 và safe; update/transition nhận expected_version. Một Idempotency-Key cho một ý định/body, mất response giữ key; đổi nội dung dùng key mới. Replay vẫn kiểm quyền hiện hành. Không tự retry callback/COMMIT unknown. Transaction không giữ lock trong lúc gọi SMS/map/push/bank; audit/outbox cùng commit, consumer dedupe event_id.

**Tiền kế thừa ADR004:** API JSON number nguyên, Number.isSafeInteger, trong range0..9007199254740991; mutation amount>0, withdrawal≥10000. DB bigint và application bigint, chuyển JSON sau kiểm bound; CHECK mọi balance/held/amount tương ứng. Không float, không tự đổi API sang string hoặc nhận tổng khách tự tính. UI100.000đ; unknown dùng null, không0.

Lists đề xuất cursor opaque, default20/max100, order stable created_at desc+UUID; `{data:{items:[],next_cursor:null}}`. Date filters [from,to) sau đổi UTC; search server theo quyền, không tải toàn dataset về client. HTTP401 session,403 permission/eligibility,404 restricted existence,409 state/version/idempotency,429 rate,503 dependency/outcome unknown.

## 2. API thực trên main

Các path dưới đây đều có prefix /v1.

| Method/path | Request | data response / status |
|---|---|---|
| GET `/health/live` | Không body |200 {status:"ok"} |
| GET `/health/ready` | Không body |200 {status:"ready"};503 DB unavailable |
| POST `/auth/phone-verifications` | exact {phone,purpose:"REGISTER"} |201 verification_id,expires_in_seconds,resend_after_seconds |
| POST `/auth/phone-verifications/:id/verify` | exact {otp:6digits} |200 verification_token,purpose,expires_in_seconds |
| POST `/auth/register` | exact {phone,password,verification_token,device} + key |201 user_id,phone_normalized,available_roles:[],active_role:null,onboarding_required:true,access_token |
| POST `/auth/login` | exact {phone,password,device} |200 user_id,available_roles,active_role:null,onboarding_required,role_selection_required,access_token |
| GET `/auth/me` | Bearer | user_id,phone_normalized,available_roles,active_role,onboarding_required,role_selection_required |
| POST `/auth/role/select` | Bearer; exact {role:"SHOP" hoặc "DRIVER"} | Me/context result, server eligibility |
| GET `/onboarding/shop/profile` | Bearer | own profile hoặc null |
| PUT `/onboarding/shop/profile` | Bearer/key; required name/contact_phone/address_text; optional zalo/facebook/pickup_lat/pickup_lng/service_area_id/expected_version |201 create/200 update {shop_id,status:"INCOMPLETE",version,role_granted:false} |
| POST `/onboarding/shop/complete` | Bearer/key; exact {expected_version} |200 {shop_id,status:"ACTIVE",accepting_orders:false,role_granted:true,version} |
| POST `/onboarding/driver` | Bearer/key; required full_name, optional plate_number |201 {driver_id,driver_type:"EXTERNAL",status:"PENDING",accepting_deliveries:false,role_granted:true,version:1} |
| GET `/shop/me` | Bearer SHOP active | own full shop/hours/availability, không accepting_orders |
| PUT `/shop/me/profile` | Bearer/key; full replacement required expected_version/name/contact_phone/address_text/pickup_lat/pickup_lng/service_area_id; optional zalo/facebook |200 resource result/version theo service |
| PUT `/shop/me/business-hours` | Bearer/key; exact {expected_version,intervals:[{weekday,start_minute,end_minute,end_day_offset}]} |200 weekly schedule result/version; [] đóng cả tuần |

Device exact `{device_id,platform,app}`: ID1–128 ASCII [A-Za-z0-9._:-], platform/app1–32 uppercase [A-Z0-9_]. Parser từ chối extra fields, type/shape sai400 BAD_REQUEST. Password registration8–128 codepoints, không trim/normalize, Unicode hợp lệ; login không áp lại policy registration cho sai mật khẩu. Phone theo normalizer VN. OTP6 số; defaults300s/resend60s/5wrong; proof600s; session absolute604800s, không refresh.

Shop name120/address500/Zalo160/Facebook300; optional text absent/null cùng logical request; lat/lng cùng có hoặc cùngnull, bounds90/180. Profile active PUT bắt buộc GPS+area. Version positive safe integer. Hours weekday1..7, minutes/offset theo business-hours main, tối đa28 intervals; shape sai BAD_REQUEST, nội dung giờ sai INVALID_BUSINESS_HOURS. Copy cả tuần client mở rộng7days; không weekday0.

GET shop profile fields: shop_id/name/contact_phone/zalo/facebook/address_text/pickup_lat/pickup_lng/service_area_id/status/accepting_orders/version. accepting_orders ở onboarding là legacy, không dùng để đánh giá hoạt động. GET shop/me fields thêm timezone/hours/availability:{online,reason,evaluated_at} và loại bỏ legacy field. Resolver geometry chưa tồn tại trên main.

**Source files phải đọc trước client:** auth/auth-validation.ts; onboarding/shop-onboarding-validation.ts, driver-onboarding-validation.ts; shop-management/shop-management-validation.ts; controllers/services tương ứng. Không tự thêm full_name/consent/CUSTOMER vào old register.

## 3. Admin API trong PR, chưa main

| Nhóm | Contract giữ nguyên | PR |
|---|---|---|
| Admin login/state | POST /admin-auth/login exact phone/password/device WEB/ADMIN_WEB → next_step/expires_at/csrf_token + PREAUTH cookie; GET state → phase/next_step/expiry/csrf | #34/#35 |
| TOTP | POST enrollment{} → secret/otpauth_uri/expires_at; enrollment/verify{code} hoặc totp/verify{code} → user_id/admin_role/expiry/csrf + session cookie | #34 |
| Me/logout | GET me session result; POST logout{}204 clear cookies | #34/#35 |
| Step-up operations | POST /admin/operations {action,payload}; verify{code}; GET operation state | #41 |
| Invitations | POST {operation_id,full_name,phone,permissions,note?}+key; list/detail; reissue{operation_id,expected_version,reason,permissions?}; revoke{operation_id,expected_version,reason} | #41 |
| Activation | /admin-activation: start{token}, restart{}, otp/request{}, otp/verify{code}, password{password}, totp/enrollment{}, complete{code}, GET state | #44/#45 |

Exact route prefixes/response schemas/error registry từ refreshed head, không mix PR stacked. Cookie __Host Secure/HttpOnly/SameSite, exact Origin/JSON/CSRF theo step, no-store. Không tự lặp POST TOTP sau timeout: GET state. Activation cookie riêng, token link không vào referer/log, remove URL secret sau nhập.

Invitation permissions entries exact `{app,can_view,can_review_profile,can_lock}`, app enum CUSTOMER/SHOP/DRIVER. Gộp Food UI không gộp FOOD permission domain. Financial/config quyền chưa có contract Owner duyệt D11.

## 4. M01 — proposal tương thích

### 4.1 Client identity adapter

New namespace /v1/client-auth dành Food/Ship, reuse primitives và transaction. Register atomically consume REGISTER proof + create user + CUSTOMER + profile/consent + session/audit/outbox. Không old register rồi grant role ở transaction2. Old/new phone race chỉ một thành công.

| Proposal | Input | data output |
|---|---|---|
| POST `/client-auth/register` | phone/password/verification_token/device/full_name/consent:{terms_version,privacy_version}, key | user_id/phone_normalized/available_roles:[CUSTOMER]/active_role:CUSTOMER/onboarding_required:false/access_token/profile |
| POST `/client-auth/login` | exact phone/password/device | identity/context/token/profile/capabilities |
| GET `/client-auth/me` | Bearer | identity/context/profile/capabilities, không token |
| POST `/client-auth/context` | {context:CUSTOMER/SHOP_OWNER/DRIVER} | allowed own context/roles/capabilities, không grant |
| POST `/client-auth/logout` | Bearer {} |204 revoke current; known revoked retry không grant/data |
| GET/PUT `/customer/me/profile` | own GET; PUT {full_name,expected_version}+key | user_id/full_name/version |
| GET `/driver/me` | own Bearer | existing driver fields/status/version hoặcnull |

Me proposal canonical fields: user_id:string UUID; phone_normalized:string; available_roles:string[]; active_role:string|null; profile:{full_name:string|null,version:integer|null}; capabilities object boolean; onboarding_required/role_selection_required boolean. Token chỉ login/register. Capability keys customer_access/shop_profile_read/shop_manage/driver_profile_read, do server derive; không true cho receive/money module chưa có. New login context hợp lệ theo profile, không hard-code role theo app. Ship chưa hồ sơ dẫn onboarding; không driver profile thì không nhận đơn.

CUSTOMER/SHOP_OWNER/DRIVER public; **storage SHOP tạm giữ**, adapter SHOP→SHOP_OWNER, old /auth không đổi response/select. CUSTOMER reader mới không dùng supportedRoles legacy chỉ DRIVER/SHOP. Active context per session không thay privilege. Shop disabled có thể đọc own status qua capability riêng, không gọi protected manage với role không selectable.

### 4.2 Schema và backfill

customer_profiles: user_id UUID PK/FK users, full_name varchar120 nullable cho existing user, version bigint≥1, timestamps. New register name required; không invent tên/ép tênxế thành tênkhách. user_consents: UUID PK/user FK/terms_version/privacy_version/accepted_at/client_app immutable; content/version phải có nguồn đã duyệt trước nghiệm thu thật.

Backfill CUSTOMER idempotent cho ordinary PHONE_VERIFIED và STAGING_FIXTURE đã review; loại trừ actual admin membership và ADMIN_PROVISIONED, không suy privilege từ origin. Fixture UNVERIFIED_TEST vẫn phone_verified_at null. Origin schema phải reconcile #27/#34/#42 trước migration; không silent IF EXISTS để giấu drift. CUSTOMER và user creation cùng transaction. Sau loại bỏ legacy client, storage canonicalization là task migration riêng, không bắt buộc M01.

Logout phải revoke phía server; offline xóa local cache không chứng minh revoke remote. Web token memory, F5 phải login lại theo limitation PC; native secure storage chờ D03. D02 chưa approved không đổi policy device_id thành physical proof giả.

### 4.3 Reset proposal

| Endpoint | Request | data output |
|---|---|---|
| POST `/password-resets` | {phone} |202 {reset_id,expires_in_seconds:300,resend_after_seconds:60}, chung mọi phone hợp lệ |
| POST `/password-resets/:id/verify` | {otp} |200 {reset_token,expires_in_seconds}; one-use RESET_PASSWORD |
| POST `/password-resets/:id/complete` | {reset_token,password}+key |200 {password_reset:true,login_required:true}, không session |

Resend qua request cùng phone sau cooldown; lane guard invalidate challenge cũ theo contract, không tạo thuật toán OTP khác. Các defaults reuse Auth; rate-cost/anti-enumeration phải review trước provider thật.

Candidate store password_reset_requests: UUID/user nullable/phone digest/challenge status/attempts/expiry/resend bound; password_reset_grants: request/user/token digest unique/credential_version_at_issue/expiry/consumed. Có thể reuse verification/proof purpose qua contract mở parser nếu có lợi; chọn một store chính sau review, không hai proof source. User null sink lifecycle cho nonexistent/SYSTEM; không response phân biệt role/existence. Phone phục vụ SMS được bảo vệ, không audit/log raw.

Credential version chuyên dụng nếu users.version có cả profile edits. Hash ngoài lock; dưới user root recheck credential epoch/grant expiry/one-use/status, commit password+revoke app sessions/admin sessions/preauth và activation attempts liên quan/outstanding grants/audit atomic. Giữ role/status/TOTP; không autoactivate/login. Replay complete chỉ acknowledgement, không token. Reset concurrent/login race phải chứng minh không tạo session với credentials cũ sau commit.

Proposal errors RESET_INVALID400/RESET_EXPIRED400/RESET_ALREADY_USED409/RESET_RATE_LIMITED429; không code làm lộ USER/ADMIN/SYSTEM. SYSTEM recovery CLI riêng D05; public reset không bypass. Exact schema/grants/error registry được khóa theo slice trước code.

## 5. Resolver/availability proposal

service_areas main chỉ code/name/status. Geometry/version thêm sau D04; validated GeoJSON hoặc spatial storage được duyệt, không auto PostGIS. Server point-in-polygon/ring/boundary/overlap tests. Resolver read-only authenticated shop setup nhận lat/lng → {in_area,service_area_id|null,name|null,geometry_version}; quyền public nếu cần phải contract/rate review.

Shop save/complete resolve lại server và verify version/ACTIVE, không tin area ID/cached result của client. Không tự tạo polygon. Availability theo main: shop/user/area eligibility + weekly schedule, **không manual switch**. Đặt hẹn ngoài giờ hiện tại chờ D14 Order contract, không giải quyết bằng bật switch cũ.

## 6. Schema tương lai và ownership

| Module | Tên kế thừa / bổ sung proposal | Quan hệ và constraints |
|---|---|---|
| M03 | driver_bank_accounts, driver_closure_requests; verification/history cần slice | drivers FK, bank version; one open closure, enum migration riêng so main |
| M04 | driver_wallets, wallet_holds, wallet_ledger_entries, wallet_topups, wallet_bank_transactions, wallet_withdrawals, wallet_adjustments | wallet1:1driver; 0≤held≤balance; ledger immutable; source FK/amount/wallet match; bank identity unique shared IN/OUT |
| M05 | customer_profiles M01 reuse, customer_addresses | user FK; partial unique default; historical Order snapshot không đọc mutable address |
| M06 | shipping_quotes, driver_routing_states, route_evaluations, policy_versions | immutable payload/binding/expiry; driver aggregate/version; baseline ETA không reset |
| M07 | deliveries, delivery_items, delivery_assignments, delivery_events, delivery_incidents | partial current/order và active assignment; fixed deadline; custody assignment FK |
| M08 | driver_location_samples, driver_current_locations, device_bindings, notification_deliveries, reminder_jobs; inbox/archive proposal | server binding/sequence; latest không stale overwrite; scope/time retention |
| M09 | system_categories, shop_categories, menu_items; upload_assets/image relations | shop ownership, active/available/visible/deleted riêng, snapshot lịch sử |
| M10 | orders, order_items, order_events; revisions/link metadata | server totals/recipient snapshot, confirmed immutable, current/latest delivery references |
| M11 | shop_ratings/replies/reply_history; driver_ratings/reports; delivery_outcome_reports/adjustments | unique actor/subject/eligibility, original retained, money qua M04 ports |
| M12 | operational_cases; report_exports/config metadata cần slice | projection từ owner, M01 permission store và M06 policy reuse, không ledger/Order thứhai |

M04 dùng ADR004 lock order: idempotency → user/session/auth → policy/area → driver → bank → wallet → routing → order → delivery/assignment/incident → closure/source/hold → ledger/history/audit/outbox/result. Chỉ lấy groups cần, không đảo thứ tự. Source discovery pre-read không cấp quyền, recheck dưới lock. Callback không tự retry network hoặc unknown commit.

DB constraints source/hold/capture/ledger cần typed FK/deferred constraints theo ADR004; trước M07 không expose COMMISSION path thiếu assignment FK. FK lịch sử RESTRICT; không xóa tiền qua cascade. Future schema chưa là physical DDL CODE_READY; từng slice chốt cột/check/index/grants trước Claude code.

## 7. Error map hiện hành và acceptance

| Main codes/status | UI / hành vi |
|---|---|
| INVALID_PHONE400, BAD_REQUEST400 | Lỗi field/copy hợp lệ, focus first invalid; không echo server raw |
| OTP_INVALID/OTP_EXPIRED400 | Cho nhập lại hoặc gửi lại theo cooldown; không loop verify |
| OTP_ALREADY_USED409, OTP_RATE_LIMITED429 | Đọc flow hiện hành; Retry-After/countdown khi server có |
| VERIFICATION_PROOF_INVALID400/USED409/PURPOSE_MISMATCH400 | Bắt đầu lại proof đúng purpose; không đem REGISTER vào reset |
| PHONE_ALREADY_REGISTERED409 | Đề nghị login/reset, không tự tạo user khác |
| INVALID_CREDENTIALS401 | “Số điện thoại hoặc mật khẩu chưa đúng” |
| SESSION_INVALID/REVOKED/EXPIRED401 | Clear sensitive local state và về login; stale response không phục hồi |
| ACCOUNT_DISABLED/ROLE_NOT_AVAILABLE403 | Hiện trạng thái và chặn action; không tự đổi role |
| SHOP_ONBOARDING_EXISTS409/PROFILE_INCOMPLETE409; DRIVER_PROFILE_EXISTS409/PENDING_APPROVAL403 | Resume own GET/status; không duplicate profile/autoapprove |
| VERSION_CONFLICT409 | Refetch/version diff, yêu cầu xác nhận; không blind overwrite |
| SHOP_NOT_FOUND404/ROLE_REQUIRED403/DISABLED403; INVALID_SERVICE_AREA400/INVALID_BUSINESS_HOURS400 | Đúng field/state; availability server, không giả mở |
| IDEMPOTENCY_KEY_REQUIRED/INVALID400; KEY_REUSED/BUSY/REPLAY_EXPIRED409; KEY_UNAVAILABLE503 | Giữ key cho cùng intent; chỉ retry theo replay contract; expired đọc resource |
| TRANSACTION_OUTCOME_UNKNOWN503/SERVICE_UNAVAILABLE503/INTERNAL_ERROR500 | “Chưa xác định kết quả/Thử lại”, request_id; không tạo key mới hoặc ghi thất bại chắc chắn |

Các suffix viết tắt trong bảng phải dùng full registry identifier tại common/app-errors.ts; ví dụ VERIFICATION_PURPOSE_MISMATCH khác VERIFICATION_PROOF_*. Lỗi proposal không tự có trên main.

Mỗi endpoint proposal trước CODE_READY phải có operation_id, exact request/response/examples, all errors/status, permission/resource scope, version/key/replay, event payload/consumer và tests. M00 đã có health contract đủ; đây không là lệnh code tất cả API tương lai.

## 8. Migration và rollout

Append-only; fresh/upgrade test; runtime grants; backfill counts; prereq schema SHA; lock/index plan; old/new compatibility; fix-forward recovery. Không sửa migration đã apply hoặc đổi enum/field tại chỗ. account_origin #27/#34 trùng cột phải reconcile với schema tích hợp thật, #42 chỉ là nguồn tham khảo đã code.

DEV giữ migration confirmation/target guard; remote apply có authorization riêng, không chạy trong phiên thiết kế. Runtime không DDL/migration credentials. Events version khi meaning đổi, consumer replay/dedupe test. Main SHA không chứng minh deployed runtime; evidence phải ghi frontend/backend/build fingerprint thật.
