# M01-XE — nối hồ sơ xế trong Ship
13/10/2026. ChatGPT giao contract; Claude code. Nhánh feat/m01-ship-driver-profile từ main sau #85 (merge a701849894cee1b5d329655fd4b07d5857893ddc).

## Đã có / còn thiếu
#82/#83 có đăng ký CUSTOMER và tài khoản/phiên Food/Ship. #85 đã nối hồ sơ quán, không làm lại.
Backend POST onboarding/driver và GET driver/me đã có. Ship S12/S13 đã dựng nhưng chưa nối; dùng lại.
Kết quả cần đạt: đăng ký/đăng nhập → Tài khoản → Hồ sơ xế → gửi → xem trạng thái thật, mở lại/đăng nhập lại vẫn đọc được. Không tạo user khác cho xế; tài khoản và CUSTOMER giữ nguyên.
Chỉ web local HTTPS Ship. Không Food onboarding quán, bank/wallet/approval/CCCD/nhận đơn/GPS vận hành, native/APK/VPS hoặc module khác. Không dựng lại backend/schema khi code có sẵn.

## File và mục đọc
- apps/ship-web/src/screens.ts: S12/S13, S05/S14 và route sau đăng ký.
- apps/client-shared/src/auth/{client,contract,session,transport}.ts; app.ts, screen.ts; shop-flow.ts và screens/shop-live.ts chỉ lấy pattern, không nhân bản toàn bộ.
- scripts/client-web-dev.mjs: allowlist đúng method/path cho Ship.
- apps/backend/src/onboarding/driver-onboarding.controller.ts, driver-onboarding-validation.ts, driver-onboarding-service.ts.
- apps/backend/src/customer-profile/driver-me.controller.ts, driver-me-service.ts.
- docs/ui/m01-ship-web.md chỉ S12/S13/S05/S14/S01.
- docs/tasks/M01-A2-onboarding.md §22, §24 và response driver ở §9 khi cần; §22 đã bỏ khu vực/GPS đăng ký xế, không áp yêu cầu cũ.
- docs/design/system-v2-20261011/11-m01-session-device-contract.md §1–5.
Đọc AGENTS/CLAUDE/quy trình/workstreams một lần đầu phiên. Không kiểm kê lại toàn M01 hay đọc mọi PR.

## Contract giữ nguyên
POST /v1/onboarding/driver, Bearer + Idempotency-Key: full_name bắt buộc, plate_number tùy chọn/null. Validation dùng parser hiện hữu; tên xế là trường riêng, không sửa customer profile; không tự coi tên khách là tên theo giấy tờ đã xác nhận.
201 data exact {driver_id,driver_type:"EXTERNAL",status:"PENDING",accepting_deliveries:false,role_granted:true,version:1}. Backend cấp DRIVER, vẫn giữ CUSTOMER; không tự ACTIVE/online.
GET /v1/driver/me, Bearer, không body/query: data null hoặc exact 8 field {driver_id,user_id,full_name,plate_number,driver_type,status,accepting_deliveries,version}. Không cần context DRIVER để đọc; không user_id client.
Sau gửi: refresh me và đọc driver/me; S13 dùng enum DB PENDING/ACTIVE/SUSPENDED/CLOSING/CLOSED đúng mapping hiện hữu, không hardcode luôn chờ duyệt. PLATFORM chỉ là loại xế, không quyền admin.
Hồ sơ đã tồn tại thì đọc/xem trạng thái, không gọi create lại hay bắt CLOSED đăng ký lại. Chưa có API sửa hồ sơ: không mở nút sửa/lưu giả. DRIVER_ONBOARDING_EXISTS dùng error thực tế của backend và reload own profile.
Retry unknown outcome giữ nguyên key/body; không auto retry POST. Chống bấm đúp, hủy/rời màn bỏ phản hồi muộn, session invalid dùng handling #83. Không token/password trong storage/URL/log.
DISABLED_TEST kế thừa #82, không OTP/proof giả và không đổi gate ANDROID/production.
Proxy Ship bổ sung đúng POST /v1/onboarding/driver và GET /v1/driver/me, forward Bearer/Idempotency-Key cần thiết; không wildcard. Chỉ mở Food driver read nếu đã có lý do trong code hiện hữu, không triển khai màn xế trong Food.
S01 công tắc nhận đơn vẫn khóa: đăng nhập/có role/ACTIVE chưa chứng minh đủ điều kiện vận hành của module sau. Không số dư/đơn/thu nhập/lý do xét duyệt giả.

## Làm và kiểm tra
Nối adapter/controller → S12 submit → S13 đọc thật → account/home mapping. Dùng component/thiết kế có sẵn; UI không sở hữu policy.
Focused check phần mới và một smoke Chrome/front/backend/DB test thật: CUSTOMER → gửi hồ sơ → PENDING/EXTERNAL/offline + DRIVER và CUSTOMER → tải lại profile qua phiên đăng nhập mới. Dùng harness/fixture hiện có; không ma trận/race/mutation testing hoặc audit sâu mới.
Local dependency/Chrome bị chặn thì ghi giới hạn và dùng CI; không sửa harness ngoài phạm vi hay full suite local rồi lặp CI. CI bắt buộc áp dụng; lỗi thật/CI đỏ sửa đúng nguyên nhân, không retry đến xanh không giải thích, không polling liên tục.
Cập nhật đúng dòng UI/runbook, không thêm báo cáo trùng. Trả một Draft PR với SHA, kiểm tra/link, cách chạy và giới hạn. Không tự merge/deploy/đóng M01 hay chuyển luồng tiếp.
