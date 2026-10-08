# M02 — checklist quán và thực đơn
Trạng thái: thiết kế; chưa implementation M02-A/B. Onboarding Shop đã có ở M01-A2S.
UI_SCOPE: FIGMA_REQUIRED cho giao diện quán. API slice M02-A trong #18 ghi NONE chỉ có nghĩa PR đó backend-only, không loại bỏ UI khỏi module.

## M02-A — hồ sơ và giờ hoạt động
Design PR #18: https://github.com/trungtn87/11ship/pull/18 .
Nghiệp vụ đã chốt: quán tự ONLINE/OFFLINE theo giờ cài đặt; không có công tắc nhận đơn; chưa có lịch thì OFFLINE.
- [ ] Rebase/đối chiếu contract với M01-R1 sau merge; dùng session participant hiện hành, không copy guard cũ.
- [ ] Owner khóa lựa chọn lịch nhiều khoảng/ngày, qua đêm, timezone Asia/Ho_Chi_Minh, giới hạn 28 khoảng/tuần còn là đề xuất trong #18.
- [ ] Khóa sửa hồ sơ ACTIVE, INCOMPLETE qua onboarding, DISABLED read-only; OWNER, role/session và replay replacement-session rõ.
- [ ] Loại bỏ mâu thuẫn legacy accepting_orders; Auth chọn SHOP không phụ thuộc giờ mở cửa.
- [ ] Backend spec đủ schema/API/errors/ownership/transaction/audit/outbox; duyệt #18 trước code.

### M02-A-BE
- [ ] Migration mới, không sửa applied migration; hours/profile cùng version.
- [ ] GET profile/hours/availability dùng DB clock, snapshot nhất quán.
- [ ] PUT profile/hours strict, version conflict, atomic mutation và replay đúng.
- [ ] Unit, PG integration A01–A16, concurrency/fault/migration, regression A1/A2/R1.
- [ ] CI đúng SHA, ChatGPT audit, Owner merge. Không chờ M01-UAT khi dependency backend đã đạt.

### M02-A-UI
- [ ] Figma: hồ sơ quán, sửa liên hệ/địa chỉ/GPS, lịch tuần/nhiều khoảng/qua đêm, trạng thái ONLINE/OFFLINE và lý do.
- [ ] Không có nút bật/tắt; diễn đạt rõ thay giờ đóng/mở, chưa cài lịch và trạng thái quán bị vô hiệu.
- [ ] Owner duyệt node/frame/copy trước code; tái dùng UI foundation M01.
- [ ] Nối API thật; xử lý conflict version, session revoked, lỗi GPS và ngày chuyển tuần.
- [ ] Visual QA Android/desktop; bản local có SHA và dữ liệu mẫu.

### M02-A-E2E / UAT
- [ ] UI lưu/đọc lại hồ sơ và lịch; restart không mất; concurrent edit báo conflict đúng.
- [ ] Đúng phút mở ONLINE, đúng phút đóng OFFLINE; lịch qua đêm và Chủ nhật→thứ Hai; không phụ thuộc app đang mở.
- [ ] Không có lịch/area inactive/profile disabled luôn thể hiện đúng lý do; không có nút tay.
- [ ] E2E thời gian dùng fixture/test clock được giới hạn; không cho endpoint đổi clock production.
- [ ] Owner test trên điện thoại với lịch gần thời gian thật, xác nhận tự chuyển trạng thái và sửa lịch.
- [ ] Record môi trường/SHA/kết quả/bugs/retest và Owner acceptance.

## M02-B — menu/nhóm món (kế hoạch, chưa khóa thiết kế)
- [ ] Nghiệp vụ tối giản: tên/ảnh/giá, nhóm hệ thống, ẩn món và soft delete; không tự thêm tồn kho/cost/POS của dự án OC11.
- [ ] Khóa quyền quản lý nhóm hệ thống và nhóm quán nếu có; phạm vi media upload/lưu ảnh/quota, thứ tự hiển thị, dữ liệu lịch sử dùng bởi Order.
- [ ] Chốt việc món ẩn/xóa ảnh hưởng giỏ/đơn đang có thế nào ở contract Order; chưa code Order trong M02.
- [ ] Design schema/API/permission/transaction/replay/validation; review và Owner khóa trước backend.
- [ ] B-BE: owner API menu + migration + unit/PG integration/fault/regression.
- [ ] B-UI: Figma danh sách/thêm/sửa/ẩn món/ảnh/nhóm, Owner duyệt rồi nối API.
- [ ] B-E2E: CRUD/giá/ảnh/ẩn/soft delete, lỗi mạng và quyền owner khác, reload/restart.
- [ ] B-UAT: Owner nhập menu thật bằng dữ liệu thử, kiểm trên điện thoại, lỗi/retest/duyệt.

## Dependency và ngoài phạm vi
M02-A dựa M01-R1; M02-B dựa backend M02-A; mỗi UI/E2E cần môi trường M00 và UI nền M01. Không phụ thuộc hoàn thành toàn bộ B/C/D của M01 để bắt đầu backend quán.
Production cần service-area provisioning được thiết kế riêng ở luồng quản trị (data thuộc M02, quyền do Auth/Admin); local dùng seed test. Không mở API admin khu vực khi M01-D chưa đủ quyền/2FA.
Delivery, Driver approval, Wallet và Order không nằm trong M02. Sau khi M02-A hoặc B backend đạt, UI/test của slice đó chạy song song thiết kế module tiếp theo, không chờ cả backend dự án.
