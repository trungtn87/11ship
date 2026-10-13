# M01-ADMIN — quyền menu và đọc danh sách tài khoản
13/10/2026. ChatGPT chốt contract dưới đây; Claude code. Nhánh feat/m01-admin-account-read từ main sau #89 (merge d420628ac55f61936eab0d6b1b7e5aae453f7aad).

## 1. Đầu ra và phần có sẵn
SYSTEM/Admin login + TOTP, lời mời/kích hoạt đã có (#89 thêm activation không OTP local test). Không làm lại.
D81/D86/D89, core/accounts.ts, AccountsSource, dom/accounts-view.ts, ShellApp và menu.ts đã có; read source vẫn NOT_WIRED. AdminSessionService.me đã validate phiên TOTP nhưng chưa trả grants.
Nối backend + UI cùng gói: ADMIN thấy menu đúng quyền; SYSTEM xem USER và quản trị viên; ADMIN chỉ xem USER/projection trong scope.
Không lock/unlock, cấp/đổi grants, suspend quán/xế, duyệt hồ sơ, audit toàn hệ thống, reset, Android hay VPS. Giữ D87/D88 khóa. D15 quyền khóa identity nhiều role vẫn cần chốt sau; không suy can_lock đã lưu là quyền thực thi mutation.
Không thêm accounts store/schema trùng users, không tạo lại UI hoặc auth.

## 2. Tài liệu/file đúng phạm vi
- docs/current/M01-workstreams-20261012.md: M01-ADMIN.
- docs/ui/m01-admin-web.md D81/D86/D89 và Quyền ADMIN (nhãn thiếu API là hiện trạng cũ).
- docs/design/system-v2-20261011/09-m01-user-admin-test-sms.md §2.1–2.2, §4.1–4.2 tại ref f135f4562513718555d67b605690f296f6455ec8 (PR #48); chưa trên main. Proposal wire ở đó được chốt cụ thể dưới đây; không áp gate preflight/audit/gói cũ hoặc §SMS đã thay đổi.
- Backend admin-auth/admin-session-service.ts, admin-credential-checks.ts, admin-membership-repository.ts; admin-provisioning/admin-system-actor.ts để lấy pattern đầy đủ actor lock; auth/admin-identity-participant.ts; bảng admin_permissions/admin_profiles theo migration hiện hành.
- Client core/accounts.ts, menu.ts, api.ts, controller.ts; dom/shell-app.ts, accounts-view.ts và điểm mount shell hiện hữu; scripts/admin-web-dev.mjs.
- Profile owners: auth/customer-profile-repository.ts, shop/shop-repository.ts, driver/driver-repository.ts. Tra đúng cột/participant, không audit lại toàn repo.
AGENTS/CLAUDE/quy trình đọc một lần lúc đầu. Không lấy UI model làm contract quyền.

## 3. Auth/quyền/projection
Tất cả endpoint mới dùng SESSION cookie Admin đã hoàn tất TOTP, no-store và transport hiện có; PREAUTH và ordinary Bearer không đủ quyền.
Tái kiểm actor ACTIVE, membership/version, factor/current session và DB clock trong transaction đọc, giữ lock order user→membership→factor→session của code. Dùng/refactor participant chung nếu cần, không gọi me một transaction rồi tin quyền ở transaction khác.
SYSTEM có full read của task; ADMIN lấy CURRENT can_view từ app.admin_permissions. CUSTOMER→CUSTOMER, SHOP→public SHOP_OWNER, DRIVER→DRIVER.
USER loại account_origin ADMIN_PROVISIONED và mọi user có admin_memberships kể cả DISABLED. Một user một dòng; SYSTEM xem user legacy chưa role, ADMIN chỉ thấy user có ít nhất một role thuộc domain can_view.
roles_visible/profiles chỉ trong scope actor; không gửi toàn role/hồ sơ rồi nhờ UI che. display_name từ profile được phép đọc: ưu tiên customer full_name khi CUSTOMER view, nếu không thì shop name khi SHOP view, nếu không thì driver full_name khi DRIVER view; không có thì null. Search tên cũng chỉ những nguồn được phép.
Không password/hash/OTP/proof/TOTP/cookie/token/bank/GPS trong response; phone_masked dùng maskPhone hiện hữu, không đưa phone đầy đủ vào browser. Lookup ID ngoài scope và ID không có trả cùng 404 USER_NOT_AVAILABLE.

## 4. API additive exact
Không đổi shape /admin-auth/me, state hoặc response TOTP đang có.
GET /v1/admin-auth/permissions (không query/body) → {data:{admin_role:"SYSTEM"|"ADMIN",permissions:[{app:"CUSTOMER"|"SHOP"|"DRIVER",can_view:boolean,can_review_profile:boolean,can_lock:boolean}]}}.
ADMIN chỉ rows permission thực tế; SYSTEM có 3 scope với quyền true theo role hệ thống. Giá trị này hướng dẫn UI, backend vẫn authorize mỗi read; không mở action review/lock chưa code.
Mapping menu ADMIN: CUSTOMER.can_view→users; SHOP.can_view→users+shops; DRIVER.can_view→users+drivers. Không tự mở orders/finance/audit/... vì chưa có grant contract; mục chưa làm giữ Sắp có. Quản trị viên/Lời mời chỉ SYSTEM. Thiếu/error quyền thì fail closed, không sample grants.

GET /v1/admin/users query q?,role? CUSTOMER|SHOP_OWNER|DRIVER,status? ACTIVE|DISABLED,limit? 1..50 default20,cursor? → {data:{items:[UserSummary],next_cursor:string|null,available_role_filters:[publicRole]}}.
UserSummary exact {user_id,display_name:string|null,phone_masked,roles_visible:[publicRole],account_status:"ACTIVE"|"DISABLED",created_at:ISO}.
q trim ≤120 codepoints, search phone normalized hoặc tên được phép, case/diacritic-insensitive tiếng Việt, literal wildcard escaping, SQL parameterized; Claude chọn kỹ thuật phù hợp không mở extension remote. Chưa thêm date filter UI mới trong task.
ADMIN role filter ngoài scope: ADMIN_FORBIDDEN403; no view403. Không COUNT/total giả.

GET /v1/admin/users/:user_id UUID, không query/body → {data:UserDetail}.
UserDetail exact UserSummary + {updated_at:ISO,version:positive-safe-integer,profiles:{customer?:{full_name:string|null},shop?:{name:string,status:string},driver?:{status:string}},allowed_actions:[]}.
profiles chỉ scope actor và dữ liệu tồn tại. Không timeline sự kiện giả: adapter map events:[] và UI báo chức năng chưa nối khi cần. LOCKED trên UI ánh xạ DISABLED storage; không enum DB mới.
Đăng ký USER_NOT_AVAILABLE404 trong error registry nếu chưa có, fixed message không lộ ID/scope. Validation dùng ADMIN_INPUT_INVALID400; 401 ADMIN_SESSION_INVALID và 403 ADMIN_FORBIDDEN hiện hữu.

GET /v1/admin/administrators (SYSTEM-only) query q?,status? ACTIVE|DISABLED,limit/cursor như USER → {data:{items:[{user_id,full_name:string|null,phone_masked,admin_role:"ADMIN",status:"ACTIVE"|"DISABLED",permissions:[permissionRow],created_at:ISO}],next_cursor}}.
Danh sách chỉ ADMIN đã kích hoạt (admin_memberships + admin_profiles); không SYSTEM, không biến lời mời thành tài khoản PENDING. D89 live bỏ bộ lọc PENDING, hướng người dùng xem Lời mời cho trạng thái chờ kích hoạt. full_name từ admin_profiles; trạng thái effective DISABLED nếu identity hoặc membership disabled. ADMIN gọi thẳng403. Không action sửa/khóa.
UI adapter render permissions thành scopes hiện có; absent name dùng copy chưa có tên, không tên giả.

Cursor keyset created_at,user_id descending; opaque bounded, ràng endpoint/filter/actor + current permission fingerprint/membership version bằng crypto hiện hữu. Filter/quyền đổi từ chối ADMIN_INPUT_INVALID400, UI bỏ cursor và tải trang đầu. Không cursor plain phone/token. Query giới hạn/server projection trước phân trang.
Read không audit/outbox/idempotency; không mutation. Index migration chỉ nếu kiểm query cụ thể cho thấy cần, không mặc định migration cho read.

## 5. UI và runbook
AccountsSource thật thay NOT_WIRED_SOURCE; giữ model/components D81/D86/D89, loading/empty/error/401/403. Gỡ PII khi hết phiên/mất quyền; late response không khôi phục dữ liệu màn đã rời.
Tìm/lọc/pagination dùng server, giữ filter khi Back; nút khóa/mở vẫn không hoạt động, allowedActions rỗng. Không thêm chức năng ngoài read.
Sau login/reload lấy permissions và mount shell với grants server; không lưu business grants/PII vào localStorage.
Proxy chỉ mở đúng route/method trên; giữ Admin cookie/Origin/security rules, không wildcard mới.
Cập nhật đúng dòng UI/API inventory và runbook, không báo module DONE.

## 6. Kiểm tra và điểm dừng
Focused auth/projection/parser tests và một smoke Chrome/front/backend/DB test thật: SYSTEM list/detail USER và ADMIN list; ADMIN giới hạn scope menu/projection, gọi thẳng ngoài quyền bị từ chối; pagination/search; hết phiên xóa PII. Dùng fixture/mask/multirole hiện có.
Owner đã cho tạo 1 ADMIN full grants local/CI khi cần, giữ TOTP; không account/DB VPS, không secrets trong repo/PR/log.
Không full local rồi lặp CI, không audit sâu/race/mutation matrix mới. Local bị chặn thì báo và dùng CI bắt buộc, không polling liên tục hoặc sửa harness ngoài phạm vi.
Trả một Draft PR: SHA, hành vi, check/link, cách chạy, giới hạn. Không tự merge/deploy/đóng M01/sang lock-unlock. Phần khóa sẽ giao sau khi D15 được chốt.
