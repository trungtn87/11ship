# M02-A — delivery brief và gói giao Claude

Status: PREPARED, chưa CODE_READY. PR #18 chưa merge/LOCK. Không chạy prompt implementation trước design gate.
Authority: M02-A-shop-management.md (gồm §10), M01-R1 repair, ADR-002/003; kế hoạch song song PR #20 đang Draft.
Owner đã chốt auto-hours; các lựa chọn lịch nhiều khoảng/qua đêm/giới hạn 28 còn chờ khóa thiết kế.

## 1. Backend — M02-A-BE
Sau khi Owner lock/merge #18 và CI dependency xanh:
1. Fetch current main, ghi base SHA; đọc AGENTS.md nếu có, các authoritative specs và code mới từ base thiết kế. Không reset/force-push thay đổi của người khác.
2. Branch feat/m02-a-shop-management; reuse M01 SessionAuthorizationParticipant, M00 executor/TransactionContext/audit/outbox. Không copy primitives.
3. Migration shop_business_hours mới → interval validator/canonicalization → M02 owner repository/availability → Auth locked-role participant → composition GET/PUT → tests/evidence.
4. Read và mutation kiểm current session/role trong transaction. Replay guard chỉ user_id/shop_id; replacement-session hợp lệ được replay. Giữ A2 onboarding roleless.
5. Quán ONLINE hoàn toàn theo lịch/ACTIVE profile/ACTIVE area. Không tạo endpoint/nút accepting-orders, không dùng cột legacy làm điều kiện.
6. PR DRAFT; không Ready/merge/next-module. Không frontend/menu/Wallet/Driver/Order/admin/SMS/dependency mới hoặc applied migration edits.
7. Chạy npm ci, lockfile check, lint/typecheck/build, migration smoke, unit, PG integration local/CI; evidence M02-A.md có A01–A18 → test name, exact head/check URL/counts, concurrency barriers và fault matrix.
8. Nếu cần đổi Auth policy/M00 semantics/ownership, báo BLOCKED_BY_FOUNDATION. Không dùng guard precheck thay authorization trong transaction.

Deliverable: code head, final head, base, CI URL/counts, changed existing tests/reasons, migration proof, regressions A1/A2/R1. Không báo hoàn thành UI/UAT.

## 2. UI brief — M02-A-UI (Figma trước, frontend sau)
UI_SCOPE: FIGMA_REQUIRED. Thiết kế ngay trong khi BE/local chuẩn bị; tái dùng brand foundation và UI M01. Brief này chưa phải frame Figma hay UI_LOCKED.
Ba màn/frame cần tạo:
- Hồ sơ quán: tên/SĐT liên hệ/Zalo/Facebook/địa chỉ/vị trí lấy hàng/vùng; sửa và lưu; thông tin đọc được khi DISABLED.
- Giờ hoạt động: lịch thứ Hai→Chủ nhật, nhiều khoảng/ngày, thêm/xóa khoảng, hỗ trợ qua đêm, cả ngày, ngày đóng; preview lịch tuần trước lưu.
- Trạng thái quán: chip Đang mở cửa/Đã đóng cửa/Chưa cài giờ hoạt động/Quán bị vô hiệu/Vùng chưa hoạt động; giải thích theo lịch, không có công tắc.

Copy đề xuất:
“Quán tự nhận đơn trong giờ hoạt động đã cài đặt.”
“Ngoài giờ hoạt động, quán tự ngừng nhận đơn.”
“Chưa cài giờ hoạt động. Thêm giờ mở cửa để quán tự hoạt động.”
“Giờ đóng cửa thuộc ngày hôm sau.” (khoảng qua đêm)
“Thông tin đã thay đổi trên thiết bị khác. Tải lại để tiếp tục.” (VERSION_CONFLICT)

State bắt buộc: loading/empty/no-hours/saving/success/validation/conflict/session expired-revoked/disabled/read-only/error/retry.
Lưu thất bại giữ input; retry outcome unknown dùng cùng key/body; người dùng sửa nội dung là request mới/key mới. Reload version trước khi chủ động sửa conflict.
GET sau save phản ánh availability hiện tại; không dùng response replay cũ làm current state.
UI đang mở tự refresh GET khi tới mốc lịch và khi app foreground; server luôn authoritative. Refresh cadence chi tiết khóa ở frontend task, không dùng polling làm cơ chế mở/đóng quán.
Owner duyệt frame/node và wording trước frontend code. Visual QA Android/desktop; nối API thật, không mock-only nghiệm thu.

## 3. E2E — M02-A-E2E
Cần backend đã merge + UI_LOCKED/implemented + local M00/dữ liệu thử và UI nền M01 theo kế hoạch.
- Login→select SHOP→đọc/sửa hồ sơ→reload; không lộ profile quán khác.
- Cài nhiều khoảng và qua đêm→đọc lại→restart còn nguyên.
- Boundary mở/đóng, Chủ nhật→thứ Hai, no-hours/disabled/inactive-area; legacy accepting_orders=false không chặn auto-online.
- Sửa đồng thời hai phiên/editor→VERSION_CONFLICT; revoked session→deny; retry lost response không tăng version lần hai.
- UI chỉ phản ánh availability server; không có nút tay; app đóng không ngăn tự mở/đóng.
- Time fixtures thuần/test harness giới hạn; không thêm clock override endpoint production.
- Evidence exact SHA/môi trường/test case/bug/retest, không suy PASS từ BE CI.

## 4. Owner UAT — M02-A-UAT
Bản local được chuẩn bị từ luồng M00, truy cập Windows/điện thoại theo contract môi trường được duyệt:
- Owner nhập hồ sơ và lịch quán bằng dữ liệu thử.
- Đặt khoảng gần giờ thật, quan sát tự mở/đóng; đóng app rồi mở lại thấy trạng thái đúng.
- Test lịch qua đêm và ngày nghỉ theo lịch tuần; chưa có giờ thì ngừng nhận đơn.
- Sửa lịch/hồ sơ, reload và khởi động lại; kiểm wording và cách nhập trên điện thoại.
Ghi Owner acceptance thực tế, SHA/bản test/bug/retest. Không tự tick nghiệm thu bằng CI.
Module M02-A có bốn mốc riêng BE/UI/E2E/UAT; menu M02-B thiết kế riêng.
