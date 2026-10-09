# Roadmap tổng thể 11Ship — đề xuất 09/10/2026

Ưu tiên: hoàn thiện Render + Supabase staging và app test đủ M01, Owner nghiệm thu M01 staging (Auth/onboarding, tài khoản/phiên, quyền quản trị; SMS thật khóa) rồi mới code mới M02. Thiết kế/review module sau được chuẩn bị song song. Backend M02-A đã merge #21: giữ lịch sử, kiểm hồi quy trên staging sau gate; không xóa hoặc gọi nó là chưa code.

Kế hoạch gồm **13 module chính (M00–M12), 121 task lá và 13 group**, chưa phải roadmap đã Owner chốt. `roadmap_complete: false` giữ nguyên cho đến khi coverage, nguồn mâu thuẫn và quyết định Owner được đóng bằng PR riêng. Không có cam kết ngày hoàn thành.

- [Bảng module/dependency và 13 checklist](module-table.md)
- [Kiểm kê nguồn, hiện trạng và khoảng trống](source-inventory.md)
- [Milestone, gate, song song và gói giao việc](milestones-and-handoff.md)
- [Decision log cần Owner duyệt](owner-decisions.md)
- [Dashboard từ GitHub](../PROGRESS.md)

## Quy trình bắt buộc

Nghiệp vụ → database/API/state machine → review và khóa thiết kế → giao Claude code → review code → test tự động → app test HTML nối API thật → Owner nghiệm thu → khóa module. Review/test lặp khi cần sửa finding. Không đồng nhất design outline, design locked, code merged, CI pass, deployed, Owner accepted.

Manifest giữ schema v1 và pin PR lịch sử. Trường `phase` tách backend/app_test/automated_test/deployment/owner_acceptance/operations/design; `requires_own_design` chặn kế thừa roadmap tổng quát làm CODE_READY. `start_after` chặn triển khai mới nhưng giữ code đã merge; design_state vẫn hiển thị độc lập. Module hoàn thành chỉ khi tất cả task của nó có bằng chứng, gồm app/test/UAT. CI xanh không là nghiệm thu.

Owner acceptance cần evidence PR đúng head, merged + CI xanh + comment do Owner trungtn87 viết đúng một dòng `OWNER_ACCEPTED <task-id> <40-char-evidence-head-sha>`. Từ chối dùng OWNER_REJECTED; comment mới nhất thắng, push head mới làm xác nhận cũ mất hiệu lực. Không ghi DONE trong YAML, không tự post xác nhận thay Owner. Comment này xác nhận bộ evidence chứa exact backend/client/release SHA và checklist đã test; không phải lời cho phép deploy tự động.

## UI và SMS

HTML/CSS đủ nghiệp vụ và responsive ngay, nhận diện theo brand guideline LOCKED (logo, nền, vàng/than, Plus Jakarta Sans, spacing/radius/touch target), copy tiếng Việt rõ, trạng thái lỗi/loading/empty và thao tác retry/version conflict. Dùng asset Owner đã duyệt; file logo/font còn thiếu phải ghi thiếu nguồn, không sinh logo thay thế. React/TS/Vite ở FE0 #24 vẫn là đề xuất; HTML/CSS không tự khóa framework mới.

Figma hoàn thiện toàn giao diện ở cuối, sau đó triển khai trên 4 app và web quản trị, kiểm hồi quy và Owner test. Gate Figma sớm trong PR14/20/23/24 được thay bởi chỉ dẫn Owner của yêu cầu này cho app test; không chờ quota Figma để làm backend/HTML.

Staging D2: tài khoản thử chưa xác minh, registration/SMS tạm khóa; login/me UNVERIFIED_TEST, verified timestamp NULL. UI ghi “Môi trường thử nghiệm” và “Tài khoản thử nghiệm — chưa xác minh SĐT”, đăng ký báo tạm chưa mở. OTP fake chỉ development/test tự động theo contract; giữ proof/expiry/retry/session regressions. Không đưa endpoint đọc OTP giả vào staging public.

Chuẩn bị hồ sơ/provider SMS sớm được; tích hợp và nghiệm thu SMS ngoài sau UI hoàn thiện, trước production. Test các nhà mạng, limit/rate abuse, retry, timeout, receipt delivery, purpose/proof/expiry và thất bại. Production phải xác minh SĐT, từ chối fixture/bypass trên login/bearer/transaction; DB/key/account test tách production, không đổi fixture thành verified giả.

HTML trên điện thoại 4G chứng minh nghiệp vụ và responsive; native Android/iOS nền, GPS/push, signing/cài đặt phải có gói và test thiết bị riêng trước release. Scope có app khách, quán, xế, quản lý và web quản trị cùng backend; phân phối Shop/Xế chung app theo brand hay 2 package cần Owner chốt, không bỏ một bề mặt khỏi coverage.
