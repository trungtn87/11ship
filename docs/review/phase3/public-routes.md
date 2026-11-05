# Phase 3 — 41 route "không guard/transport" (carry-over G-7) và Q1

SHA `549572696efb4bbc18af3c362b7f56a5fcd335e6`. Danh sách 41 tách bằng `nest.py` (Phase 2, `HEURISTIC` về phạm vi), mỗi controller sau đó được **mở source** như bảng dưới. Thuật ngữ: "công khai có chủ ý" = comment trong source hoặc hợp đồng nói rõ và không có dữ liệu cá nhân trong câu trả lời. Không kết luận "không được bảo vệ" chỉ vì thiếu `SessionAuthGuard`. Runtime NOT TESTED.

Danh mục cơ chế (viết tắt dùng trong bảng): **[OTP-Q]** hạn mức OTP: cooldown chung, 2 cửa sổ theo số điện thoại (giờ, ngày), cửa sổ IP theo giờ, đặt trong transaction có khóa theo số điện thoại (`auth/verification-service.ts:224-257`); **[LOGIN-Q]** `ClientLoginLimiter` 30 lần/phút/số điện thoại, bền vững qua bảng `client_login_limits` (`client-auth/client-login-limiter.ts:7-30`); **[MODE]** cổng cấu hình `accountRecoveryMode`; **[TOKEN]** token trong URL băm sha256; **[RO]** công khai chỉ đọc có chủ ý.

| # | Route | Cơ chế bảo vệ/giới hạn (ĐÃ MỞ SOURCE) | Phân loại | Nhận xét |
|---|---|---|---|---|
| 1 | GET `/v1/app-updates/check` | [RO]; validate `component`, `version_code` (`ops-client.controller.ts:62-66`) | công khai có chủ ý | không có limiter trong code |
| 2 | GET `/v1/app-updates/compatibility` | [RO] (`:68-72`) | công khai có chủ ý | như trên |
| 3 | GET `/v1/app-updates/download/:release_id` | chỉ release `PUBLISHED` Android; UUID; kiểm đường dẫn/symlink/kích thước (`ops-ingest-service.ts:318-340`) | công khai có chủ ý | xem `ops-client-ingest.md` |
| 4 | POST `/v1/auth/phone-verifications` | [OTP-Q] (`auth.controller.ts:43-48`, `verification-service.ts:224`) | public có giới hạn; **đang được app dùng** (Dart `phone_verification.dart:130`, Web `client-shared/src/auth/contract.ts:34`) | route "legacy" nhưng ACTIVE |
| 5 | GET `/v1/auth/phone-verifications/:id` | trạng thái gửi SMS của OTP REGISTER; UUID (`auth.controller.ts:50-54`) | public; đang được dùng (`phone_verification.dart:181`) | hạn mức: không riêng; id không đoán được (UUID, chưa kiểm sinh) |
| 6 | POST `/v1/auth/phone-verifications/:id/verify` | OTP đúng/sai có đếm; challenge đóng sau quá nhiều lần sai (`verification-service.ts:319` comment) | public; đang được dùng (`phone_verification.dart:235`) | |
| 7 | POST `/v1/auth/register` | `assertLegacyDeviceAllowed`: khi cổng native bật thì luôn `DEVICE_PROOF_REQUIRED` (`auth-validation.ts:72-76`; `registration-service.ts:74`) | legacy/compat; **không có client trong repo gọi** (grep `mobile`, `apps`, `tools`, `scripts`, `config`); nhiều integration test | cổng native bật hay không phụ thuộc cấu hình (UNKNOWN trên VPS) |
| 8 | POST `/v1/auth/login` | như #7 (`login-service.ts:65`). Không có `ClientLoginLimiter` trong `login-service.ts` (đã đọc 55-120) | legacy/compat; không client gọi | khi cổng native tắt: không thấy giới hạn tần suất đăng nhập ở đường legacy. **Ứng viên Phase 5**, chưa xác nhận lỗ hổng. NOT TESTED |
| 9 | GET `/v1/public/tracking/:token` | [TOKEN] sha256, regex `^[A-Za-z0-9_-]{20,80}$`, link bị thu hồi/hết hạn trả `EXPIRED`; limiter trong RAM 60 req/phút/IP (`delivery-tracking-public.controller.ts:25-49,60-71`; `delivery-customer-service.ts:543-549`) | công khai bằng token | limiter theo tiến trình, khóa `req.ip` (`delivery-tracking-public.controller.ts:63,78`); không đặt `trust proxy` trong `apps/backend/src` (grep). `ops/vinahost/nginx-11ship-staging.conf:69-80` proxy tới `127.0.0.1:3000` và ghi đè `X-Forwarded-For`, không có `limit_req`. **Suy luận tĩnh (chưa chạy, cấu hình triển khai thật NOT TESTED):** nếu app chạy sau nginx này, `req.ip` có thể là `127.0.0.1` cho mọi client, nên 60 req/phút có thể là một xô chung toàn hệ thống. Phase 5 chứng minh bằng thử thực tế |
| 10 | GET `/v1/track/:token` | như #9, trả HTML; chuỗi hiển thị được `escapeHtml` (`:13-20,74-`) | như #9 | |
| 11 | GET `/v1/shops/:shop_id/reviews` | [RO], `Cache-Control: no-store`, comment "nothing personal" (`review.controller.ts:117-127`) | công khai có chủ ý | phạm vi dữ liệu trong `publicShopReviews` chưa mở: UNKNOWN |
| 12 | GET `/v1/shops/:shopId/logo` | comment: chỉ quán ACTIVE, khu vực ACTIVE, chủ không bị khóa (`shop-logo.controller.ts:5`) | công khai có chủ ý | điều kiện nằm trong `ShopLogoService.read`, chưa mở: UNKNOWN |
| 13 | GET `/v1/client-auth/config` | không query/body; chỉ trả chế độ xác minh đăng ký (`client-auth.controller.ts:61-69`) | công khai có chủ ý | |
| 14 | POST `/v1/client-auth/register` | thân theo mode **của server**, không theo client; [OTP]: cần `verification_token` ở mode REQUIRED; Idempotency-Key (`:76-95`) | public có kiểm soát | |
| 15 | POST `/v1/client-auth/login` | [LOGIN-Q]; bằng chứng thiết bị tùy mode; `Idempotency-Key` (`:98-110`; `client-login-limiter.ts`) | public có giới hạn | |
| 16 | POST `/v1/discovery/route-distances` | không lưu gì; giới hạn đồng thời toàn hệ thống (Phase 2, `discovery-route-service.ts:44-80`); không giới hạn theo IP | công khai có chủ ý | **ứng viên Phase 5** (chi phí Valhalla), không phải kết luận |
| 17 | GET `/v1/shops/:shopId` | [RO] "nothing personal"; `no-store` (`menu.controller.ts:98-107`) | công khai có chủ ý | |
| 18 | GET `/v1/menu-images/:imageId` | id bất biến không đoán được; CSP `default-src 'none'; sandbox`, `nosniff`, cache immutable (`:110-120`) | công khai có chủ ý | |
| 19 | GET `/v1/service-areas` | [RO] (`:132-137`) | công khai có chủ ý | |
| 20 | GET `/v1/service-areas/resolve` | `parseAreaPosition(query)` (`:138-143`) | công khai có chủ ý | |
| 21 | GET `/v1/menu-categories` | [RO] (`:145-149`) | công khai có chủ ý | |
| 22 | GET `/v1/discovery/shops` | `parseDiscoveryQuery` (`:151-156`) | công khai có chủ ý | |
| 23 | GET `/v1/discovery/dishes` | như #22 (`:158-163`) | công khai có chủ ý | |
| 24 | GET `/v1/health/live` | không chạm DB (`health.controller.ts:11-14`) | công khai có chủ ý | |
| 25 | GET `/v1/health/ready` | kiểm DB, 503 khi không sẵn sàng (`:16-21`) | công khai có chủ ý | |
| 26 | GET `/v1/account-recovery/config` | không input; trả mode hiệu lực (`account-recovery.controller.ts:27-31`) | công khai có chủ ý | |
| 27 | POST `/v1/account-recovery/reset-test` | **[MODE]**: `assertOpen()` trả 503 trừ khi mode = `DISABLED_TEST` (`account-recovery-service.ts:101-105`); `DISABLED_TEST` chỉ hợp lệ khi `isLocalWebMode` (development/test + loopback), nếu không thì **khởi động thất bại** (`config/account-recovery-config.ts:41-50`) | đóng ở môi trường không phải local | lo ngại Phase 2 (§4.2: cấu hình sai trên môi trường thật) **được giảm**: cấu hình sai làm dừng khởi động, không mở route. NOT TESTED |
| 28 | POST `/v1/account-recovery/otp` | `assertSmsOtpOpen` (mode `SMS_OTP`, cần SMS gateway thật hoặc không khởi động được) + công tắc DB `otp_password_reset_enabled`; [OTP-Q]; phản hồi chung cho mọi số (`account-recovery-service.ts:108-122,135-140`) | public có giới hạn | |
| 29 | POST `/v1/account-recovery/otp/:id/verify` | như #28 | public có giới hạn | |
| 30 | POST `/v1/account-recovery/reset` | như #28 + bằng chứng OTP (`resetWithProof`); Idempotency-Key | public có kiểm soát | |
| 31 | GET `/v1/account-recovery/locked/config` | chỉ phụ thuộc mode server (`:80-84`) | công khai có chủ ý | |
| 32 | POST `/v1/account-recovery/locked/otp` | `assertSmsOtpOpen`; luôn cần OTP, không phụ thuộc công tắc (`:87-95`) | public có giới hạn | |
| 33 | POST `/v1/account-recovery/locked/otp/:id/verify` | như #32 | public có giới hạn | |
| 34 | POST `/v1/account-recovery/locked/recover` | `assertSmsOtpOpen` + bằng chứng OTP (`:108-115`) | public có kiểm soát | |
| 35 | GET `/v1/admin-recovery/config` | không input | công khai có chủ ý | |
| 36 | POST `/v1/admin-recovery/reset-test` | `assertOpen()` như #27 (`:139-`) | đóng ở môi trường không local | |
| 37 | POST `/v1/admin-recovery/otp` | `assertSmsOtpOpen`; phạm vi ADMIN_WEB cố định theo route; không áp công tắc app (comment `assertAppResetEnabled`) | public có giới hạn | |
| 38 | POST `/v1/admin-recovery/otp/:id/verify` | như #37 | public có giới hạn | |
| 39 | POST `/v1/admin-recovery/reset` | như #37 + bằng chứng | public có kiểm soát | |
| 40 | POST `/v1/client-auth/device/challenges` | cần `CLIENT_DEVICE_TRUST` (`#requireTrust`); đếm challenge gần đây, vượt thì `DeviceRateLimitedError(60)` (`client-device-service.ts:133-148`) | public có giới hạn | khóa đếm theo `input` (đối số), không phải IP: ai kiểm soát được `device_id` thì đổi được; **UNKNOWN** chi tiết `countRecentChallenges` |
| 41 | POST `/v1/client-auth/device/registrations` | attestation Android được kiểm trước transaction, chuỗi chứng chỉ giới hạn kích thước (`client-device-service.ts:30-33,87-110,180-212`) | public có kiểm soát | |

## Tổng kết 41 route
- Công khai có chủ ý, chỉ đọc hoặc không dữ liệu cá nhân: #1-3, #11-13, #16-26 (trừ #27), #31, #35 (cộng #16 ghi chú Phase 5).
- Có giới hạn tần suất/quota đã đọc: #4-6, #8 *(không)*, #9-10, #15, #28-30, #32-34, #37-39, #40.
- Đóng bằng cấu hình (mode): #27, #36, và nhóm OTP khi `accountRecoveryMode != SMS_OTP`.
- Legacy: #7, #8 (không client trong repo gọi); #4-6 là legacy theo tên nhưng đang được dùng.
- Không route nào trong 41 được phân loại là "không bảo vệ" mà không có cơ chế. Hai điểm cần Phase 5 chứng minh: #8 (không thấy limiter ở đường legacy khi cổng native tắt) và #16 (không theo IP).

## Q1 — `AuthController` vs `ClientAuthController`
| Câu hỏi | Kết luận (ĐÃ MỞ SOURCE) |
|---|---|
| Module nào expose? | Cả hai (cùng `ClientDeviceController`) nằm trong `controllers` của **một** `AuthModule` (`auth/auth.module.ts:101`) |
| Client nào gọi route nào | Dart (`session_controller.dart:165,262,293,308,445,472,524`) và Web (`client-shared/src/auth/contract.ts:34-45`) dùng `/v1/client-auth/{config,register,login,me,context,logout}` **và** `/v1/auth/phone-verifications{,/:id,/:id/verify}` cho OTP đăng ký. Không client nào trong `mobile`, `apps`, `tools`, `scripts`, `config` gọi `/v1/auth/{register,login,role/select,me}` (grep; phủ định = **HEURISTIC**, không phải chứng minh tuyệt đối) |
| Active/legacy/dead | `/v1/auth/phone-verifications*`: **ACTIVE** (dùng thật). `/v1/auth/register|login|role/select|me`: **legacy/compatibility**, vẫn reachable qua HTTP, có test hồi quy riêng (`customer-legacy-compat.int.spec.ts` header "legacy regression"); khi cổng native bật, `register` và `login` luôn từ chối (`DEVICE_PROOF_REQUIRED`). **Không phải dead code** |
| Quyết định cần Owner | Có giữ hay gỡ 4 route legacy (`register`, `login`, `role/select`, `me`) hay không: phân loại **Owner decision** (không tự quyết) |
