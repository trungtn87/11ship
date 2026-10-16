# M01 — gói bổ sung cuối: cài đặt OTP, tách phạm vi tài khoản, vòng đời tài khoản (14/10/2026)

**Trạng thái M01: TẠM CHỐT (không phải chứng nhận production hoàn hảo).** Gói này chứa các quyết định Owner 14/10/2026 còn thiếu. Không mở thêm vòng review toàn M01; tính năng mới đưa vào module tương ứng; M02 tiếp tục theo [kế hoạch hiện có](M02-workstreams-20261014.md). Bằng chứng triển khai/chạy thật: xem mục 7 — việc chưa chạy thì ghi **CHƯA KIỂM**, không suy ra.

## 1. Quyết định đã triển khai
| # | Quyết định Owner | Nơi thực hiện |
|---|---|---|
| 1 | **Cài đặt hệ thống (chỉ SYSTEM)**: nhóm “Xác thực số điện thoại” có hai công tắc độc lập `otp_registration_enabled`, `otp_password_reset_enabled`, mặc định **Bật**; lưu database, hiệu lực ngay (đọc mỗi request, không cache, không restart); nút Lưu/Hủy; ghi log đổi (giá trị cũ/mới, người thực hiện, thời gian) | `apps/backend/src/system-settings/`, bảng `app.system_settings`, `app.system_setting_changes`; Admin Web “Cài đặt hệ thống” (`/system/settings`, mã thiết kế D91) |
| 2 | OTP đăng ký **tắt** → đăng ký không OTP, SĐT đánh dấu **chưa xác minh** (`account_origin = PHONE_UNVERIFIED`, `phone_verified_at` NULL). Không cấp quyền nào | `ClientRegistrationService.registerUnverified`; `GET /v1/client-auth/config` trả `NOT_REQUIRED`; yêu cầu OTP đăng ký bị từ chối `PHONE_VERIFICATION_NOT_REQUIRED` (không gửi SMS) |
| 3 | OTP quên mật khẩu **tắt** → khóa tự đặt lại mật khẩu, **không** có đường bỏ qua xác thực | `/v1/account-recovery/otp`, `/verify`, `/reset` đều trả 403 `PASSWORD_RESET_DISABLED`; `GET /config` trả `UNAVAILABLE`; một proof lấy trước đó cũng không dùng được và không bị tiêu thụ |
| 4 | Không ảnh hưởng 2FA SYSTEM/ADMIN; không tắt SMS Gateway; đăng nhập thường không OTP; khôi phục tài khoản khóa **luôn** cần OTP | Công tắc chỉ đọc ở đăng ký/quên mật khẩu của ứng dụng; luồng khôi phục không đọc công tắc nào |
| 5 | **Hai phạm vi định danh**: `ADMIN_WEB` (SYSTEM, ADMIN), `APP_USER` (CUSTOMER, SHOP_OWNER, DRIVER). SĐT duy nhất trong từng phạm vi, được trùng giữa hai phạm vi | Cột `app.users.account_scope` (sinh từ `account_origin`: ADMIN_PROVISIONED→ADMIN_WEB, còn lại→APP_USER; không ai ghi được), `UNIQUE (account_scope, phone_normalized)`; mọi tra cứu SĐT nhận phạm vi bắt buộc từ **đường vào** (module quản trị hay ứng dụng), không từ tham số request |
| 6 | Đăng nhập tách bạch: Admin Web chỉ ADMIN_WEB (giữ 2FA); Food/Ship chỉ APP_USER; SĐT SYSTEM/ADMIN vẫn đăng ký 11Food/11Ship bình thường và tạo tài khoản APP_USER riêng (không thừa quyền quản trị) | `AdminIdentityParticipant` (ADMIN_WEB), `ClientLoginService`/`LoginService` (APP_USER) |
| 7 | Quên mật khẩu theo phạm vi: ứng dụng chỉ đặt lại APP_USER; Admin Web chỉ đặt lại ADMIN (không SYSTEM); OTP/proof gắn **phạm vi + mục đích + thời hạn** | Purpose `RESET_PASSWORD` (APP_USER), `RESET_PASSWORD_ADMIN` (ADMIN_WEB), `RECOVER_ACCOUNT`; route quản trị riêng `/v1/admin-recovery/*` (Admin Web dùng route này) |
| 8 | **Xóa tài khoản** (CUSTOMER/SHOP_OWNER/DRIVER): không có dữ liệu liên quan → xóa vĩnh viễn; có → **không xóa, chuyển khóa** (lý do `DELETE_REQUEST`); không xóa SYSTEM/ADMIN | `POST /v1/admin/users/:id/delete`; hàm DB `app.purge_app_user` (SECURITY DEFINER, runtime không có quyền DELETE trên bảng tài khoản); `AccountActivityRegistry` |
| 9 | **Khóa**: chỉ khi không còn đơn/đơn giao đang xử lý; đơn xong/hủy không cản; ngừng nhận đơn mới; thu hồi phiên; ghi log; phân biệt khóa do yêu cầu xóa / vi phạm / bảo mật | `POST /v1/admin/users/:id/lock` (nhận `lock_reason` = `VIOLATION` mặc định hoặc `SECURITY`), 409 `USER_ACCOUNT_HAS_ACTIVE_WORK`; cột `lock_reason`, `locked_at`; khả dụng của quán đọc `SHOP_DISABLED` khi chủ quán bị khóa |
| 10 | **Xế đã khóa** vẫn xem số dư, lịch sử, gửi yêu cầu rút tiền, theo dõi trạng thái; **không** nhận đơn/dùng chức năng giao hàng; quyền riêng, không mở toàn bộ tài khoản | Đăng nhập 11Ship của xế khóa cho phiên **giới hạn** (`account_status: LOCKED`, `limited_access: WALLET_ONLY`); chỉ `SessionAuthorizationParticipant.lockAuthorizedDriverWalletActor` và `GET /client-auth/me` chấp nhận; mọi lệnh khác trả `ACCOUNT_DISABLED` |
| 11 | **Khôi phục**: đăng ký lại SĐT của tài khoản APP_USER khóa do yêu cầu xóa → nhận diện (`ACCOUNT_RECOVERY_AVAILABLE`) → luồng Khôi phục → **bắt buộc OTP** (kể cả khi OTP đăng ký/quên mật khẩu đang tắt; gateway hỏng thì 503, không bỏ qua) → mật khẩu mới → mở khóa **cùng ID, vai trò, dữ liệu**; chỉ khóa do yêu cầu xóa; khóa vi phạm/bảo mật không tự mở; không tự kích hoạt lại quán/xế; đã xóa vĩnh viễn thì đăng ký lại tạo tài khoản mới | `/v1/account-recovery/locked/{config,otp,otp/:id/verify,recover}`; Flutter: màn “Khôi phục tài khoản” |
| 12 | Admin Web quản lý tài khoản: trạng thái, xóa, khóa, mở khóa, **lý do không thể xóa/khóa**, **dữ liệu liên quan**, lịch sử thao tác; ADMIN không dùng quyền chỉ SYSTEM | Chi tiết người dùng có khối `lifecycle`; nút Xóa/Khóa/Mở khóa theo `allowed_actions` của server; audit `admin.user.{lock,unlock,delete}.v1` |

## 2. Quy ước kỹ thuật đáng biết
- **Quyền**: cài đặt hệ thống chỉ SYSTEM (kiểm lại dưới khóa ở mỗi lần đọc/ghi). Xóa/khóa/mở khóa dùng cùng quyền như khóa hiện hành (SYSTEM mọi tài khoản thường; ADMIN cần Xem + Khóa ở **mọi** lĩnh vực của tài khoản). Cổng `ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED` vẫn là điều kiện cấu hình của VPS (xem profile production): các quy tắc ở đây là phần “tác động nghiệp vụ” đã được rà soát.
- **Dữ liệu liên quan** hiện gồm: quán (có membership) và hồ sơ xế. Phần còn lại của danh sách Owner (đơn, giao hàng, lịch sử ví, giao dịch, đánh giá, tranh chấp) **chưa có bảng** trong repo. `AccountActivityRegistry` là điểm mở rộng: module đưa các dữ liệu đó vào (M03 trở đi) **phải đăng ký** kiểm tra `relatedData`/`activeWork` của mình; chưa đăng ký thì vòng đời tài khoản chưa biết tới chúng. Test dùng một bộ kiểm tra giả để chứng minh đúng hành vi chặn khóa.
- **Xóa vĩnh viễn** xóa phiên + ràng buộc thiết bị + khóa thiết bị không còn liên kết, đồng ý điều khoản, hồ sơ khách, vai trò và dòng `users`. **Giữ**: audit log, outbox, hàng OTP/proof, bản ghi idempotency. Bản ghi đồng ý điều khoản (vốn bất biến) bị xóa cùng tài khoản: quyết định kỹ thuật theo yêu cầu “xóa vĩnh viễn”; nếu pháp lý cần giữ bằng chứng đồng ý thì cần Owner quyết định riêng (ghi ở mục 5).
- **Ví/rút tiền của xế khóa**: repo chưa có API ví. Phần đã làm: nhận diện/phiên giới hạn, cổng `lockAuthorizedDriverWalletActor` (và guard `@AllowLockedDriver()`), màn thông báo trong app. Điều kiện rút (tối thiểu 10.000đ, số dư khả dụng, tiền giữ, giao dịch đang xử lý) thuộc module ví và **không được nới** cho tài khoản khóa; module ví phải dùng đúng cổng trên.
- **Quán của chủ bị khóa** không nhận đơn mới (khả dụng đọc `SHOP_DISABLED`); mở khóa không đổi dòng quán/xế, nên quán/xế chỉ hoạt động lại nếu hồ sơ vẫn đủ điều kiện.

## 3. Migration
`database/migrations/1793059200000_account-scope-lifecycle-settings.sql` (mới, thêm vào cuối; không sửa migration cũ). An toàn dữ liệu: giữ nguyên `user_id`, vai trò, phiên, quan hệ và tài khoản SYSTEM; cột `account_scope` là cột sinh nên mọi dòng cũ tự đúng phạm vi; khóa cũ (`DISABLED`) được ghi `VIOLATION` (bảo thủ: không tự khôi phục). Hàm `app.purge_app_user` không có quyền cho PUBLIC; cấp riêng cho role runtime bằng `ops/selfhosted/03-runtime-function-grants.sql`. Bảng mới thêm vào ma trận grant (`02-runtime-grants.sql`, runbook render-supabase).
**Chưa chạy trên VPS/production.** Quy trình: [ops/runbooks/vps-m01-final-package-20261014.md](../../ops/runbooks/vps-m01-final-package-20261014.md).

## 4. Giao diện đã cập nhật
- **Admin Web**: mục “Cài đặt hệ thống” (chỉ SYSTEM); chi tiết người dùng (xác minh SĐT, lý do khóa, dữ liệu liên quan, việc đang xử lý, lý do không thể xóa/khóa); hộp thoại Xóa (mô tả đúng hệ quả xóa vĩnh viễn hay chuyển khóa) và Khóa (chọn Vi phạm/Bảo mật); trang quên mật khẩu Admin dùng `/v1/admin-recovery`. Mã thiết kế mới: D90 (xóa), D91 (cài đặt).
- **Food/Ship (Flutter, `mobile/packages/n11_shared`)**: đăng ký không OTP khi server báo `NOT_REQUIRED`; màn Khôi phục tài khoản; thông báo “tự đặt lại mật khẩu đang tạm khóa”; thông báo cho xế bị khóa. **APK chưa dựng lại** trong gói này (workflow `Mobile APK`).

## 5. Giới hạn đã biết (không chặn vận hành hiện tại)
1. Chưa có bảng đơn/giao hàng/ví/đánh giá/tranh chấp → chưa thể “chặn khóa khi còn đơn” và “rút tiền khi khóa” trên dữ liệu thật; mới có điểm mở rộng + cổng + test thay thế (mục 2).
2. Xóa vĩnh viễn xóa luôn bản ghi đồng ý điều khoản của tài khoản đó (xem mục 2). Cần Owner quyết nếu phải lưu bằng chứng đồng ý.
3. Chưa có luồng **người dùng tự yêu cầu xóa** trong app; hiện quản trị viên bấm “Xóa tài khoản” thay mặt. Khóa `DELETE_REQUEST` do admin tạo là đường duy nhất tạo ra tài khoản khôi phục được.
4. Web Food/Ship (bản thiết kế/dev trong repo) không được cập nhật theo các thay đổi mới; sản phẩm thật là app điện thoại.
5. Test `staging-db-upgrade-from-42` cần PostgreSQL 17 (CI); chưa chạy được ở máy phát triển có PostgreSQL 16.
6. Dữ liệu thật chưa được kiểm trên VPS/điện thoại thật (xem mục 7).

## 6. Cách Owner thử
1. Đăng nhập Admin Web bằng SYSTEM → menu **Hệ thống → Cài đặt hệ thống** → tắt/bật từng công tắc → Lưu; mở app 11Food/11Ship → màn Đăng ký/Quên mật khẩu đổi ngay.
2. Người dùng → chọn một tài khoản → **Xóa tài khoản** (xem hộp thoại nói rõ xóa vĩnh viễn hay chuyển khóa) hoặc **Khóa tài khoản** (chọn loại).
3. Với tài khoản bị khóa do yêu cầu xóa: trong app, Đăng ký lại bằng số đó → “Khôi phục tài khoản” → nhập mã SMS → mật khẩu mới → đăng nhập.

## 7. Bằng chứng
Cập nhật sau CI: xem PR tích hợp M01 (mô tả PR nêu SHA, kết quả CI, phần chưa kiểm).
