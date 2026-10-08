# Kế hoạch song song: backend module kế tiếp và bản thử module hiện tại

Ngày: 2026-10-08. Thiết kế được Owner yêu cầu; chưa triển khai runtime/UI, chưa nghiệm thu sản phẩm.
Base: c52c39dd0b41c817743d4023d2af5311397ffeff. Backend M01-A1/A2 và sửa M01-R1 đã merge; không gọi toàn bộ M01 hoàn thành.

## Quy tắc xuyên các module

Khi backend một gói đã audit, merge và CI main xanh, mở đồng thời:
1. ChatGPT thiết kế backend gói/module kế tiếp.
2. Thiết kế UI, Claude chuẩn bị runtime và bản dùng thử của gói vừa hoàn thành.
3. Sau UI_LOCKED: Claude triển khai UI, test đầu cuối; ChatGPT review; Owner test và duyệt.

Thiết kế backend mới không chờ Owner test UI cũ. Frontend phải chờ frame/node cụ thể được Owner duyệt. Triển khai backend kế tiếp chỉ cần thiết kế của chính nó được khóa và dependency kỹ thuật đã đạt; lỗi nghiệm thu ảnh hưởng dependency phải sửa trước. Không tự buộc toàn bộ M02 chờ UI M01.

Backend đạt CI và sản phẩm được Owner nghiệm thu là hai mốc khác nhau. Task backend giữ lịch sử DONE; runtime/UI/test/nghiệm thu có task riêng. Tiến độ tính các task đã lập kế hoạch, không đồng nghĩa hoàn thành toàn bộ M01 hoặc sẵn sàng production.

## Hai luồng hiện tại

| Luồng | Công việc | Đầu ra |
|---|---|---|
| Backend kế tiếp | Thiết kế M02-A, PR #18 | Hồ sơ quán ACTIVE, lịch mở cửa và availability tự động; không có nút bật/tắt nhận đơn |
| Bản thử hiện tại | R01: runtime + UI + test M01-A1/A2 | Owner dùng được các luồng Auth/onboarding trên điện thoại |

## R01-ENV — môi trường dùng thử

Claude triển khai theo spec runtime riêng phải được khóa trước. Ưu tiên local có thể tái lập: backend chạy thật, PostgreSQL dev bền vững riêng với DB integration, migration, cấu hình, health, dữ liệu mẫu, start/stop/update và hướng dẫn mở từ điện thoại cùng LAN. Không coi compose chỉ có DB hoặc một CI job là bản triển khai dùng thử.

Bản qua Internet cần URL HTTPS, DB riêng, cấu hình secret, migration/release, log, backup/restore thử và cách rollback. Chưa chọn nhà cung cấp, chưa cam kết chi phí hay tạo hạ tầng. Chốt phương án host sau khảo sát khả năng sẵn có; không mặc định Render hoặc gọi APP_ENV=development công khai là staging.

OTP provider hiện chỉ chạy development/test; staging/production fail closed. Phải thiết kế test provider và cách lấy OTP dành riêng bản thử trước khi code: chỉ dùng tài khoản/số thử được phép, không log token/secret, không thêm endpoint OTP công khai hoặc fallback giả vào production. SMS thật là task riêng, không báo PASS khi chỉ dùng OTP giả.

Nghiệm thu: khởi động từ môi trường sạch theo tài liệu; Owner mở UI trên điện thoại, UI gọi API thật và dữ liệu giữ sau restart; DB test không đụng dữ liệu dùng thử; release hiển thị SHA; giới hạn OTP thử được nêu rõ. Spec runtime chi tiết còn cần hoàn thiện, chưa giao triển khai bằng suy đoán.

## R01-UI — UI Auth và onboarding M01

Tái dùng PR #14 và Figma 11Ship — UI Design System & Auth:
https://www.figma.com/design/VFIs4Hablp9z4KnV19gNzv

Khóa nền nhận diện (logo, màu, font, spacing và control chung) rồi Owner duyệt frame/node trước frontend implementation. Năm màn hiện có là draft, chưa UI_LOCKED: Login, Register phone, OTP, Password, Session router. Bổ sung hồ sơ quán (nháp, GPS khi hoàn tất), hồ sơ xế (full_name, plate_number tùy chọn), trạng thái PENDING và trạng thái không có role khả dụng.

UI dùng API thật; không tự thêm logout/recovery/admin/2FA, không đăng ký vùng/GPS onboarding xế, không nút bật/tắt nhận đơn quán. Backend hiện cho phép cùng user có Shop+Driver; router thể hiện đúng available_roles và effective active_role. Từ ngữ tiếng Việt được Owner duyệt cùng frame; đối chiếu visual QA với Figma sau triển khai.

Task UI phụ thuộc runtime để bàn giao bản dùng được; công việc thiết kế Figma được phép bắt đầu ngay song song với runtime và M02. Manifest dependency biểu diễn gate nghiệm thu/triển khai, không cấm thiết kế song song.

## R01-E2E — kiểm chứng qua UI/API/DB

Sau runtime và UI: test trình duyệt với backend/DB thật, seed tài khoản riêng; kiểm tra đăng ký/OTP/mật khẩu/login, role selection, onboarding quán/xế, lỗi validation, session revoked/expired, stale role, chống double-submit/idempotency và dữ liệu sau reload/restart. Regression concurrency PostgreSQL hiện có vẫn chạy trong CI; E2E không thay thế chúng.

Chứng cứ ghi rõ SHA frontend/backend, cấu hình môi trường, URL, test account, OTP giả/thật và kết quả. Không lưu mật khẩu/token/OTP vào evidence. Không gắn nhãn test SMS thật hoặc GPS thiết bị thật khi chỉ dùng fixture.

## R01-UAT — Owner nghiệm thu trên điện thoại

Claude chuẩn bị bản chạy, hướng dẫn ngắn và danh sách thao tác; Owner kiểm UI/nghiệp vụ trên Android thật. Kiểm cách nhập SĐT/OTP, bàn phím, loading/error, refresh, đổi role, cấp GPS quán qua trình duyệt có secure context, hồ sơ quán/xế và PENDING. Nếu LAN HTTP không cấp GPS, phải cung cấp giải pháp HTTPS dùng thử trước khi nghiệm thu luồng GPS; không thay GPS thật bằng dữ liệu mẫu để báo đạt.

Ghi nhận lỗi, sửa, chạy regression và Owner test lại. Chỉ đóng task nghiệm thu sau khi Owner xác nhận trên đúng bản chạy và bằng chứng ghi rõ hạn chế còn lại. Theo schema hiện hành owner_role vẫn CLAUDE (chuẩn bị và sửa), Owner là người chấp nhận nghiệp vụ; merge implementation/evidence của UAT yêu cầu Owner duyệt. Không thêm status thủ công vào plan, không dùng CI xanh để tự suy ra Owner đã test.

## Handoff theo thứ tự

1. Khóa kế hoạch này; tiếp tục audit/chốt thiết kế M02-A và UI PR #14 song song.
2. Viết spec runtime/provider dùng thử và contract frontend/API chi tiết; khảo sát host nhưng không tự tạo dịch vụ tính phí.
3. Giao Claude R01-ENV; khóa UI; giao R01-UI.
4. E2E, review độc lập, bàn giao Owner UAT.
5. Module sau lặp lại cùng hai luồng. Các task của module sau được thêm khi phạm vi đã có spec, không tạo phần trăm cho roadmap chưa xác định.

Kế hoạch này chỉ sửa tài liệu/manifest; không triển khai server, UI, SMS hoặc production.
