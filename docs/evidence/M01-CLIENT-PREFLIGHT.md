# M01-CLIENT-PREFLIGHT — báo cáo preflight read-only gói M01.01

Gói: **M01.01 — Chốt hợp đồng tương thích tài khoản cho hai app**. Loại **CONTRACT** (`PREFLIGHT_ONLY`), handoff 2.0.1.
Người thực hiện: Claude (đọc mã, đối chiếu, báo gaps). **Không có code sản phẩm, migration, API hay test nào bị thay đổi trong gói này.**
Báo cáo này **không** cấp quyền code và **không** phải Owner acceptance. ChatGPT chốt contract/API/DDL; Owner chốt policy D02/D03 (workflow `docs/process/11ship-delivery-workflow.md`).

## 0. Nguồn và SHA (ghi đúng theo đặc tả)

| Mục | Giá trị |
|---|---|
| Base `main` (đọc mã tại đây) | `3d0212f6e4cb0096218e69f29408808ef38b4a6f` |
| Mã đọc lần đầu tại `f90b78a`; `f90b78a..3d0212f` chỉ đổi `docs/PROGRESS.md` (2 dòng) | không ảnh hưởng kết luận mã |
| PR thiết kế #48 (Draft, chưa merge, không sửa) | `docs/three-app-system-design-20261011` @ `80938a32b9b6fdb469346fb1183891e751a4d936` |
| #27 M00-D2 staging fixtures | đóng, **chưa merge**, head `18cb54b6afc524655c075958bb61b84164e43532` (dashboard ghi CANCELLED/IGNORED) |
| #34 admin-auth backend | **đã merge**, head `08910ed92608d102da29d45ae1a8e5afd14dbcd1` |
| #42 staging integration | đóng, **chưa merge**, head `13a596254fed75544bfc1f461d48086c863e4c43` |
| Dependency M00.09 | gói trong #48, **chưa triển khai** (launcher #46 đóng chưa merge, issue #50 mở). Theo đặc tả không chặn preflight độc lập |

**Diff nguồn sau audit.** Thiết kế ghim audit `e5b50e8` / refresh `891a73b` (hai mốc giống nhau trừ `PROGRESS.md`). Từ `891a73b` đến main hiện tại: **7 migration mới, ~190 file mã/test** (103 `apps/backend`, 51 `tests/integration`, 34 `apps/admin-web`, scripts/ops). Đã merge: #34, #35, #36, #41, #43, #44, #45, #47. Hệ quả: các mục thiết kế viết theo "chưa main" nay **đã cũ** (xem §8).

Phạm vi file: đặc tả liệt kê `04-data-api.md` và `06-decisions-and-gates.md`, nhưng hai file này **chỉ có trên nhánh #48**, không có trên main và quy trình cấm code/sửa trên nhánh tài liệu. Vì vậy gói này chỉ thêm file evidence này; các chỉnh sửa đề xuất cho 04/06 nằm ở §8 để ChatGPT áp dụng.

## 1. Kết luận ngắn

1. **Chưa có gì của CUSTOMER trên main.** `register` tạo user không role (`registration-service.ts:36,186-194`), `SUPPORTED_ROLES = ['DRIVER','SHOP']` (`auth-constants.ts:10`), không có `customer_profiles`, `user_consents`, `/client-auth/*`, `GET /driver/me`, và **không có logout cho app**. Toàn bộ M01.02–M01.05 là phần mới, đúng như thiết kế.
2. **Tương thích ngược khả thi theo đọc mã (chưa chứng minh bằng test chạy):** `UserRepository.supportedRoles` lọc `role = ANY('DRIVER','SHOP')` (`user-repository.ts:153-161`), nên một hàng `user_roles = CUSTOMER` sẽ **vô hình** với `/auth/login`, `/auth/me`, `/auth/role/select`. `role/select` với `CUSTOMER` hay `SHOP_OWNER` trả `ROLE_NOT_AVAILABLE` (`isSupportedRole`, `role-context-service.ts:101`). Cần test tích hợp thật trước khi gọi là "safe compatibility".
3. **Loại trừ đặc quyền đã có ràng buộc DB + service:** admin membership chỉ cho `ADMIN_PROVISIONED`; mọi login/session của app từ chối origin khác `PHONE_VERIFIED` (§4).
4. **Chính sách một thiết bị chỉ là "một phiên SHOP-context", không phải một thiết bị vật lý** (§5). `device_id` chỉ là nhãn do client gửi.
5. **BLOCKED / cần quyết định trước khi CODE_READY** (chi tiết §8): backfill phụ thuộc issue #49 (`STAGING_FIXTURE`/`UNVERIFIED_TEST` không tồn tại trên main), quy tắc validate `full_name`, nguồn consent, D02 cho chuyển ngữ cảnh SHOP, allowlist `device.app`, hợp đồng idempotency/event cho đăng ký mới.

## 2. Hiện trạng API thực trên main (đối chiếu spec04 §2/§4)

| Thiết kế đề xuất | Hiện trạng trên main | Ghi chú |
|---|---|---|
| `POST /client-auth/register` | **Không có**. Có `POST /v1/auth/register` | Cũ: body đúng 4 khóa `phone,password,verification_token,device`; không `full_name`/consent (`auth-validation.ts:116-127`) |
| `POST /client-auth/login` | **Không có**. Có `POST /v1/auth/login` | Cũ: `active_role` luôn `null` (`login-service.ts:17-24`) |
| `GET /client-auth/me` | **Không có**. Có `GET /v1/auth/me` | Code trả thêm `onboarding:{shop,driver}` (§8-G14) |
| `POST /client-auth/context` | **Không có**. Có `POST /v1/auth/role/select` | Chỉ `SHOP`/`DRIVER` |
| `POST /client-auth/logout` | **Không có logout cho app**; chỉ `POST /v1/admin-auth/logout` | Không có cả phương thức revoke một phiên trong `SessionRepository` (chỉ `revokeOtherShopSessions`, `setActiveRole`) |
| `GET/PUT /customer/me/profile` | **Không có** | Không có bảng |
| `GET /driver/me` | **Không có** | Chỉ có onboarding driver `POST /onboarding/driver` |
| Admin API "trong PR, chưa main" | **Đã trên main**: `/v1/admin-auth/*`, `/v1/admin/*`, `/v1/admin-activation/*` | Controller: `admin-auth`, `admin-provisioning`, `admin-activation` |

Route app hiện có: `auth/phone-verifications` (201), `…/:id/verify` (200), `register` (201, `Idempotency-Key`), `login`, `role/select`, `me`; `onboarding/shop/{profile,complete}`; `onboarding/driver`; `shop/me`, `shop/me/profile`, `shop/me/business-hours`.

## 3. Ma trận client cũ/mới × origin (kết quả đọc mã)

Origin trên main chỉ có `PHONE_VERIFIED` và `ADMIN_PROVISIONED` (`1791936000000_add-users-account-origin.sql`; CHECK ở dòng 23). Không có "client mới" để thử: cột client mới là **đầu vào hành vi bắt buộc** cho .02–.05.

| Client | Tài khoản | Hành vi trên main (bằng chứng mã) | Test hiện có | Trạng thái |
|---|---|---|---|---|
| Cũ `/auth/*` | `PHONE_VERIFIED`, chưa role | login OK; `available_roles:[]`, `onboarding_required:true` | `auth-register`, `auth-session`, `auth-me-router` | Đúng thiết kế |
| Cũ `/auth/*` | `PHONE_VERIFIED` + hàng `CUSTOMER` (giả định sau backfill) | `supportedRoles` bỏ qua CUSTOMER → phản hồi **không đổi**; `onboarding_required` vẫn tính theo `roles.length===0` (`available-roles.ts:67-68`) | **Chưa có** | Cần test M01.02 |
| Cũ `/auth/*` | `PHONE_VERIFIED` + `SHOP`/`DRIVER` | không đổi; select SHOP cần shop ACTIVE; select DRIVER cần profile ≠ CLOSED | `auth-me-router`, `shop-onboarding`, `driver-onboarding` | Đúng thiết kế |
| Cũ `/auth/*` | `ADMIN_PROVISIONED` | login → `INVALID_CREDENTIALS` (cùng thao tác dummy-hash, `login-service.ts:54-58`); phiên hiện có → `SESSION_INVALID` (`session-service.ts:47`; `session-authorization-participant.ts:132`) | `admin-origin-guard.int.spec.ts` (4 ca) | Đúng thiết kế |
| Mới `/client-auth/*` | mọi origin | không tồn tại | — | Input cho .02–.05 |
| Web Admin `/v1/admin-auth/*` | `ADMIN_PROVISIONED` + membership + TOTP | cookie `__Host`, session admin riêng (`admin_sessions`), **không** dùng `app.sessions` | bộ `admin-*.int.spec.ts` | Không bị ảnh hưởng nếu không đổi bảng admin |

Race đăng ký: UNIQUE `phone_normalized` + khóa hàng proof quyết định thắng thua; có test hai proof cùng phone với key khác nhau (`auth-register.int.spec.ts:514`). **Race cũ-mới chưa có test** (client mới chưa tồn tại).

## 4. Loại trừ đặc quyền (privileged exclusion)

- DB: trigger `admin_membership_origin_guard` (`1792454400000`) từ chối **INSERT** membership nếu user không phải `ADMIN_PROVISIONED`. Trigger chỉ là `BEFORE INSERT`; không kiểm hàng đã tồn tại trước nó.
- Service: `SessionService.authenticate`, `LoginService`, `SessionAuthorizationParticipant.#decide` đều từ chối origin ≠ `PHONE_VERIFIED`.
- Parser: `exactObject` từ chối mọi khóa thừa (`role`, `driver_type`, `permissions`…) bằng `400 BAD_REQUEST`, không echo giá trị (`auth-validation.ts:33-42`).
- Cấp role: `RoleGrantParticipant` giới hạn kiểu `'SHOP' | 'DRIVER'` (`role-grant-participant.ts:11-13`); thêm `CUSTOMER` phải mở rộng có chủ đích, và **không được lưu `SHOP_OWNER`** (storage giữ `SHOP`).
- Khuyến nghị cho backfill (.02): ngoài lọc `account_origin='PHONE_VERIFIED'`, thêm `NOT EXISTS (SELECT 1 FROM app.admin_memberships …)` làm phòng thủ nhiều lớp. Chưa kiểm tra dữ liệu DB thật.

## 5. Phiên một thiết bị / SHOP-context (D02)

- Hiện thực: chọn `SHOP` revoke **mọi phiên SHOP-context khác của cùng user** (`session-repository.ts:176-193`, gọi ở `role-context-service.ts:124-126`); chỉ mục `sessions_active_shop_per_user_uq` là lưới an toàn (`1791504000000…:172-174`).
- `device_id`/`platform`/`app` chỉ được lưu, **không bao giờ so sánh**; comment migration ghi rõ "không phải yếu tố xác thực". Phiên DRIVER và phiên không role không bị giới hạn/revoke.
- Hệ quả khi Food có CUSTOMER + SHOP_OWNER: `/shop/me*` đòi context `SHOP` (`#requireShopContext`, `session-authorization-participant.ts:111-120`) → app phải chuyển context sang SHOP trước, và **việc đó revoke phiên SHOP ở thiết bị khác (kể cả khác app)**. Chưa có định nghĩa cho "hai app cùng số điện thoại"; đúng với D02 chưa quyết. Không đổi policy ở gói này.
- Phân loại tương thích: chuyển CUSTOMER↔SHOP trong cùng phiên an toàn (một cột `active_role`, regex `sessions_active_role_ck` cho phép). Phần "binding thiết bị vật lý" **BLOCKED theo D02/D03** (M01.21).

## 6. Origin/membership #27/#34/#42 — drift schema thật

- Main chọn `1791936000000_add-users-account-origin.sql` (`PHONE_VERIFIED`,`ADMIN_PROVISIONED`) của #34. #27 có `1791849600000_…` cùng `ADD COLUMN account_origin` với CHECK `PHONE_VERIFIED`,`STAGING_FIXTURE`; #42 thêm migration vá bằng cách thay CHECK để có cả ba giá trị. Cả hai chưa merge.
- Nếu DB nào đã áp `1791849600000` (từ #27) thì migration của main `ADD COLUMN` lần hai sẽ **thất bại và rollback nguyên khối** (cố ý, không `IF NOT EXISTS`); chiều ngược lại vi phạm thứ tự migration. Phân tích đầy đủ đã có ở `docs/tasks/M01-D-ADMIN-PROVISIONING-preflight.md` §8 "Rủi ro migration `account_origin` giữa #27 và #34"; báo cáo này chỉ xác nhận lại bằng mã trên main hiện tại.
- **CHƯA KIỂM CHỨNG:** bảng lịch sử migration của staging/remote thực tế (cần Owner/operator chạy truy vấn read-only theo gate trong tài liệu trên). Claude không có truy cập DB đó.
- Issue **#49** (mở) đang là nơi xử lý "reconcile staging fixtures… (#27/#42)". Thiết kế 04 §4.2 backfill nhắc `STAGING_FIXTURE` và `UNVERIFIED_TEST`, **cả hai không biểu diễn được với CHECK trên main**. Gói này không giải quyết (ngoài phạm vi, thuộc #49).

## 7. Parser cũ, grants, migration — điều kiện tiên quyết

Parser cũ (giữ nguyên, đúng "không thêm full_name/consent/CUSTOMER vào register cũ"):
`otp request {phone,purpose:"REGISTER"}`; `otp verify {otp}`; `register` 4 khóa; `login {phone,password,device}`; `role/select {role}` (chuỗi ≤64, service chỉ chấp nhận `DRIVER`/`SHOP`); shop profile: bắt buộc `name,contact_phone,address_text`, tuỳ chọn `zalo,facebook,pickup_lat,pickup_lng,service_area_id,expected_version`; shop complete `{expected_version}`; driver `{full_name, plate_number?}`. `device` đúng `{device_id,platform,app}`; `platform`/`app` là token `^[A-Z0-9_]{1,32}$` **không có allowlist**.

Migration/grants:
- Migration cuối trên main: `1792454400000`. Migration mới phải có timestamp lớn hơn; chỉ thêm (append-only), kiểm tra fresh + upgrade.
- **Migration không chứa `GRANT`.** Quyền runtime được cấp thủ công theo ma trận trong `ops/runbooks/render-supabase-staging.md` (`ship11_app`; `user_roles` đã có `SELECT, INSERT`, đủ cho cấp CUSTOMER lúc runtime; backfill chạy bằng credential migration). Bảng mới cần thêm hàng vào ma trận: đề xuất `customer_profiles` (SELECT, INSERT, UPDATE) và `user_consents` (SELECT, INSERT). Quên bước này gây `42501` lúc chạy.
- Chính runbook ghi ma trận là phân tích tĩnh, **chưa kiểm chứng bằng role bị hạn chế thật** (gate D4). Gói này không kiểm chứng thêm.
- `app.users` không có `full_name`; `drivers.full_name` tồn tại nhưng thiết kế cấm dùng làm tên khách.

## 8. Gaps, mâu thuẫn và câu hỏi giao ChatGPT/Owner (không tự đoán nghiệp vụ)

| # | Vấn đề | Cần ai |
|---|---|---|
| G1 | Thiết kế 04 §3 coi Admin API "chưa main"; nay #34/#35/#41/#44/#45/#47 đã merge. Cần cập nhật 04 §3/§8 và đặc tả M01.01 (liệt kê #27/#34/#42 như PR cần reconcile) | ChatGPT |
| G2 | Backfill dùng `STAGING_FIXTURE`/`UNVERIFIED_TEST` không tồn tại trên main; #27 CANCELLED, #49 mở | ChatGPT/Owner (phụ thuộc #49) |
| G3 | `full_name` đăng ký mới: chưa có quy tắc trim/độ dài tối thiểu/Unicode (chỉ có "varchar 120") | ChatGPT |
| G4 | Nội dung/phiên bản consent chưa có nguồn đã duyệt (thiết kế đã nêu) | Owner |
| G5 | Chuyển context sang SHOP_OWNER revoke phiên SHOP khác (kể cả khác app/thiết bị) — chấp nhận hay đổi? | Owner (D02) |
| G6 | `device.app`/`platform`: có cần allowlist cho Food/Ship? Giá trị nào? Quyền không được suy từ nhãn client | ChatGPT |
| G7 | Register mới: `operation_id`/scope idempotency riêng? Replay chéo endpoint cũ/mới cùng proof ra sao? | ChatGPT |
| G8 | Audit/outbox: giữ `auth.register.v1` + `auth.user_registered.v1` hay version mới khi thêm CUSTOMER/profile/consent? | ChatGPT |
| G9 | Logout app chưa tồn tại: cần thêm revoke một phiên, audit action, hành vi retry đã revoke | ChatGPT (contract) |
| G10 | Hợp đồng lỗi: đủ mã hiện có hay thêm mã mới (registry `common/app-errors.ts`)? Thiết kế chưa liệt kê mã mới cho client-auth | ChatGPT |
| G11 | Runbook grants cần hàng cho bảng mới (đề xuất §7) | ChatGPT duyệt, Claude làm ở .02 |
| G12 | Trạng thái migration remote chưa kiểm chứng (§6) | Owner/operator |
| G13 | Dependency M00.09 chưa triển khai | Theo thứ tự gói |
| G14 | Thiết kế 04 §2 bảng `/auth/me` thiếu đối tượng `onboarding:{shop,driver}` mà code thực sự trả (`role-context-service.ts:35-37,85`; test `auth-session.int.spec.ts:218`, `driver-onboarding.int.spec.ts:139-148`) | ChatGPT (chốt giữ hay bỏ ở `/client-auth/me`) |

## 9. Ví dụ request/response dẫn xuất từ mã (không phải kết quả chạy)

Giá trị là chỗ giữ chỗ; hình dạng lấy từ parser, service và test.

```text
POST /v1/auth/register            Idempotency-Key: <khóa 1 ý định>
{"phone":"<SĐT VN>","password":"<8–128 ký tự>","verification_token":"<43 ký tự base64url>",
 "device":{"device_id":"<ID thiết bị>","platform":"ANDROID","app":"<NHÃN APP>"}}
201 {"data":{"user_id":"<uuid>","phone_normalized":"+84…","available_roles":[],"active_role":null,
            "onboarding_required":true,"access_token":"<opaque>"}}
```
```text
POST /v1/auth/login   {"phone":…,"password":…,"device":{…}}
200 {"data":{"user_id":…,"available_roles":["SHOP"],"active_role":null,
            "onboarding_required":false,"role_selection_required":true,"access_token":"<opaque>"}}
```
```text
GET /v1/auth/me   (Bearer)
200 {"data":{"user_id":…,"phone_normalized":…,"available_roles":[…],"active_role":null|"SHOP"|"DRIVER",
            "onboarding_required":…,"role_selection_required":…,
            "onboarding":{"shop":"NOT_STARTED|INCOMPLETE|COMPLETED",
                          "driver":"NOT_STARTED|PENDING_APPROVAL|ACTIVE|SUSPENDED|CLOSING|CLOSED"}}}
```
```text
POST /v1/auth/role/select {"role":"CUSTOMER"}   ->  403 {"error":{"code":"ROLE_NOT_AVAILABLE",…}}
POST /v1/auth/register    {…, "role":"SHOP"}    ->  400 {"error":{"code":"BAD_REQUEST",…}}
```
Phong bì lỗi: `{error:{code,message,request_id,details:{}}}`, `message` cố định tiếng Anh (đúng `04-data-api.md` §1).

## 10. Kiểm chứng đã làm và CHƯA làm

| Việc | Kết quả |
|---|---|
| Clone `main`, fetch #48/#27/#42, đọc mã, truy vấn PR/issue qua REST | **Đã làm** (nguồn của mọi kết luận ở trên) |
| Diff `891a73b..3d0212f` | **Đã làm** (§0) |
| `npm ci`, lint, typecheck, unit, PostgreSQL 17 integration, browser E2E | **CHƯA CHẠY.** Không cài được dependencies: proxy tổ chức từ chối kết nối tới `registry.npmjs.org`; sandbox cũng dùng Node v22 (repo yêu cầu 24.x) và không có Docker daemon/PG17. Không đánh dấu PASS |
| Mọi khẳng định "không đổi/vô hình/từ chối" ở §3–§5 | **Suy ra từ đọc mã; chưa được chứng minh bằng test chạy trên đúng SHA này**, trừ những chỗ ghi tên test hiện có (cũng chưa chạy lại ở đây) |

## 11. Ma trận từng ứng dụng (đặc tả §8)

| Bề mặt | Phạm vi trong gói | Design/UI | Code/CI/review | Local | Thiết bị thật | Owner accept |
|---|---|---|---|---|---|---|
| Admin Web | Đối chiếu origin/guard (đọc mã) | Chưa ghi quyết định | Chưa kiểm chứng | Chưa chạy | Chưa chạy | Chưa nghiệm thu |
| 11Food — khách | Đối chiếu hợp đồng CUSTOMER (đọc mã) | Chưa ghi quyết định | Chưa kiểm chứng | Chưa chạy | Chưa chạy | Chưa nghiệm thu |
| 11Food — quán | Đối chiếu SHOP→SHOP_OWNER, context (đọc mã) | Chưa ghi quyết định | Chưa kiểm chứng | Chưa chạy | Chưa chạy | Chưa nghiệm thu |
| 11Ship — shipper | Đối chiếu DRIVER, `/driver/me` thiếu (đọc mã) | Chưa ghi quyết định | Chưa kiểm chứng | Chưa chạy | Chưa chạy | Chưa nghiệm thu |
| Liên thông | Ma trận §3 | Chưa ghi quyết định | Chưa kiểm chứng | Chưa chạy | Chưa chạy | Chưa nghiệm thu |

Không có acceptance mới nào được ghi trong gói này. Một gói không kéo module M01 sang DONE/LOCK.
