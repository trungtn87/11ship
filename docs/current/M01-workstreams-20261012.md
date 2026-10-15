# M01 — kế hoạch theo luồng và tài liệu tham chiếu
Ngày: 12/10/2026. Owner yêu cầu chia lại M01, tách giao diện khỏi nghiệp vụ, tránh đọc/làm lại phần đã có; kiểm tra tìm lỗi toàn module một lần sau khi hoàn thành.

## 1. Quy tắc áp dụng
Đây là đầu mối giao việc M01 hiện hành. Thay thế cách chia việc và yêu cầu review/test lặp trong handoff cũ; không thay nghiệp vụ/schema/API đã duyệt. Các ID M01.02/.03/... và M01-A/D cũ giữ nguyên để tra PR/bằng chứng; các nhóm dưới đây là luồng giao việc, không tạo một bộ ID implementation hay dashboard trùng.
Không khởi động lại các gói đã có, đổi tên lịch sử hoặc đánh dấu nghiệm thu bằng việc chia lại. Không sửa tay PROGRESS.md. Manifest progress hiện chỉ có một phần task lịch sử, không dùng nó làm danh sách đầy đủ của M01.

Mỗi lần giao chỉ gồm: kết quả cần đạt; đã có (đường dẫn + PR/SHA biết được); còn thiếu; đúng tài liệu/mục cần đọc; kiểm tra chạy được. Đọc AGENTS/CLAUDE/quy trình lúc bắt đầu phiên; trong cùng phiên chỉ đọc lại khi đổi. Không đọc cả kho tài liệu, toàn bộ code hay mọi PR ở mỗi phần việc. Từ mốc đã biết chỉ đối chiếu file/dependency liên quan thay đổi; nếu chưa có mốc thì kiểm kê giới hạn đúng luồng một lần.
Không có bằng chứng đủ thì ghi “chưa xác nhận”, không suy ra “chưa có” rồi xây lại. Phần có sẵn chưa đạt yêu cầu thì bổ sung/sửa tại chỗ. Chỉ mở phần tiếp theo khi được giao; helper tối thiểu dùng chung không phải giấy phép tự làm gói khác.

## 2. Các nhóm công việc
Tên gọi ngắn dưới đây được Owner chốt ngày 13/10/2026 để theo dõi các luồng nhỏ trong M01. Đây chỉ là nhãn giao việc, không phải bộ ID implementation mới; giữ nguyên các mã gói/PR/bằng chứng lịch sử. Không đổi tên, phạm vi hoặc thứ tự các module lớn khác. Báo cáo tiến độ dùng tên luồng này và dẫn PR hiện có, không tạo dashboard/manifest trùng.

| Nhóm | Kết quả và ranh giới | Dùng lại / phần cần bổ sung |
|---|---|---|
| M01-UI — Giao diện | Thiết kế/dựng màn hình, component, bố cục, trạng thái hiển thị và chuyển màn. Không viết nghiệp vụ, API, schema hoặc cấp quyền | Dùng nhận diện, shell, màn web và Flutter có sẵn; chỉ dựng màn/trạng thái còn thiếu. Trang chủ trong M01 là shell phù hợp giai đoạn, không thêm đơn/ví/doanh thu |
| M01-TK — Tài khoản và phiên | Đăng ký → đăng nhập → xem/sửa hồ sơ cá nhân → đăng xuất; xử lý hết phiên. Backend và kết nối UI trong cùng luồng giao việc, UI dùng thiết kế riêng | Dùng client-auth, customer-profile, shared auth; bổ sung các chỗ chưa nối ở Food/Ship. Không làm lại schema CUSTOMER hay OTP engine |
| M01-QUAN — Hồ sơ quán | Tài khoản khách → Quản lý cửa hàng → hồ sơ/vị trí → trạng thái hoàn tất; giữ CUSTOMER | Dùng onboarding/shop và màn Food có sẵn; chỉ bổ sung contract/kết nối còn thiếu. Quản lý hoạt động/giờ mở cửa thuộc M02, không kéo vào M01 |
| M01-XE — Hồ sơ shipper | Tài khoản → hồ sơ shipper → gửi hồ sơ → xem trạng thái | Dùng onboarding/driver, GET driver/me, màn Ship. Đăng nhập không tự đủ điều kiện nhận đơn; ví/đơn/GPS vận hành thuộc module sau |
| M01-ADMIN — Quản trị tài khoản | SYSTEM/Admin đăng nhập + TOTP; tạo/xem lời mời → mở link → kích hoạt; danh sách/chi tiết và khóa/mở tài khoản theo quyền đã chốt | Dùng admin-auth/provisioning/activation và khung admin-web. API danh sách quản trị viên/quyền menu còn thiếu hợp đồng theo tài liệu UI phải chốt đúng phần đó, không dựng lại auth/invitation. Khóa/mở USER theo D15 đã chốt: [handoff 2026-10-13](../tasks/M01-admin-account-lock-handoff-20261013.md) (backend + dialog D87/D88; gate local `ADMIN_USER_ACCOUNT_MUTATIONS_ENABLED`) |
| M01-RESET — Khôi phục tài khoản | USER/Admin reset chung; SYSTEM khôi phục qua server và email phụ theo thiết kế | Dùng màn reset và primitive auth. Chốt hợp đồng kỹ thuật còn mở trước bổ sung backend; không thêm chức năng đổi mật khẩu riêng |
| M01-ANDROID — Kết nối Android | Nối các luồng trên vào Food/Ship Flutter; phiên/thiết bị đúng contract; APK cập nhật đè giữ dữ liệu | Dùng mobile shell/shared và backend đã có. Binding/session/signing dùng chung làm một lần; không triển khai lại backend theo từng app |
| M01-FINAL — Kiểm tra và nghiệm thu | Một đợt review tìm lỗi toàn module, kiểm tra liên thông và bản chạy Owner nghiệm thu | Một danh sách lỗi, một bộ bằng chứng; sửa và kiểm lại đúng phần lỗi, không mở vòng audit toàn module mới sau mỗi fix |

Các nhóm là phạm vi đủ để giao việc, không bắt tạo một PR cho từng màn/endpoint. Backend còn thiếu làm trước, kết nối vào UI đã có tiếp theo; giữ cùng phiên/nhánh khi phạm vi tương thích. Nếu cần tách PR vì dependency hoặc công việc đang dở thì giữ lịch sử và dẫn chiếu, không làm lại. Không mặc định tạo thêm gói preflight, audit hoặc báo cáo riêng cho mỗi bước.

## 3. Chỉ mục đọc theo việc
| Việc | Tài liệu/mục cần đọc | Code điểm vào đã có |
|---|---|---|
| UI Food/Ship/Admin | docs/ui/m01-food-web.md, m01-ship-web.md hoặc m01-admin-web.md: đúng dòng mã màn; docs/current/11-brand-guideline-v1.0.md khi thay nhận diện | apps/client-shared/src/components.ts, screens/; apps/food-web/src/screens.ts; apps/ship-web/src/screens.ts; apps/admin-web/src/dom/; mobile/packages/n11_shared/lib/ |
| Đăng ký | docs/design/system-v2-20261011/10-m01-client-contract.md §2–4; 11-m01-session-device-contract.md §2, §5; docs/tasks/M01-03-customer-register-local-handoff.md §3–6 cho contract local hiện hữu | apps/backend/src/client-auth/client-auth.controller.ts, client-registration-service.ts; apps/client-shared/src/auth/ |
| Đăng nhập/phiên/context/logout | 11-m01-session-device-contract.md §1–5; 10-m01-client-contract.md §5 | apps/backend/src/client-auth/client-login-service.ts, client-session-service.ts; apps/client-shared/src/auth/session.ts |
| Hồ sơ cá nhân | Contract identity ở 11-m01-session-device-contract.md §1–2; controller/validation profile hiện hữu để đối chiếu wire contract | apps/backend/src/customer-profile/customer-profile.controller.ts, customer-profile-validation.ts; driver-me.controller.ts chỉ đọc own driver |
| Onboarding quán/shipper | docs/tasks/M01-A2-onboarding.md: chỉ mục quán hoặc shipper tương ứng; docs/ui/m01-food-web.md F20–F23 hoặc m01-ship-web.md S12–S13; contract identity §1–2 | apps/backend/src/onboarding/shop-onboarding.controller.ts hoặc driver-onboarding.controller.ts |
| Admin login | docs/tasks/M01-D-LOGIN-backend-checklist.md và M01-D-LOGIN-UI-checklist.md: phần API/luồng liên quan, không lặp gate cũ | apps/backend/src/admin-auth/; apps/admin-web/src/core/api.ts |
| Lời mời/kích hoạt | docs/tasks/M01-D-ADMIN-WEB-api-inventory.md: endpoint liên quan; contract 1B/1C chỉ tra đúng operation/schema khi thiếu thông tin | apps/backend/src/admin-provisioning/, admin-activation/; apps/admin-web/src/core/provisioning-api.ts, activation-api.ts |
| Danh sách/khóa tài khoản | docs/ui/m01-admin-web.md D81–D89, quyền ADMIN; API inventory cho phần có contract | apps/admin-web/src/core/accounts.ts và dom/accounts-view.ts; phần chưa có API cần contract cụ thể |
| Reset | docs/tasks/M01-B-RESET-password-recovery-design.md §1–3; chỉ tra §4 khi triển khai bảo vệ tương ứng | apps/admin-web/src/dom/reset-view.ts; apps/client-shared/src/screens/auth.ts |
| Android | 11-m01-session-device-contract.md §7 (native protocol); mobile/README.md: update-in-place | mobile/food/lib/, mobile/ship/lib/, mobile/packages/n11_shared/lib/ |

Đường dẫn ngắn trong bảng contract dùng tiền tố docs/design/system-v2-20261011/. Chỉ mục UI đã có là điểm vào; catalog/ảnh duyệt được tài liệu UI dẫn tới có thể ở nhánh thiết kế, chưa có trên main: dùng đúng ref/PR đã được duyệt, không tự đoán đường dẫn tồn tại hoặc thiết kế lại.
Tài liệu UI chỉ sở hữu trình bày/mã màn/thành phần/trạng thái hiển thị. Quyền, validation nghiệp vụ, chuyển trạng thái dữ liệu và API nằm trong contract luồng. Dẫn chiếu quy tắc gốc, không chép toàn bộ nghiệp vụ vào UI. Khi tài liệu UI ghi trạng thái cũ, đối chiếu điểm vào code đúng luồng và cập nhật dòng đó, không audit lại toàn kho.

## 4. Hiện trạng để kế thừa
Kiểm kê giới hạn cây file main 44ee7d65e0b1440634117261da96091293bb398d (không phải SHA nghiệm thu code):
- Có controller client-auth: register, login, me, context, logout; có GET/PUT customer/me/profile và GET driver/me. Đây là bằng chứng tồn tại code, không chứng nhận vận hành trên VPS/Android hoặc toàn luồng đã nối.
- Có backend onboarding quán/shipper, admin auth/lời mời/kích hoạt; có UI web/shared auth và Flutter shell/shared. Tái sử dụng đúng điểm vào bảng trên.
- Tài liệu UI còn dòng “chờ M01.03/.04/.05” dù endpoint đã có; không dùng nhãn chờ cũ để triển khai lại backend.
- Reset có nghiệp vụ đã duyệt, còn chi tiết kỹ thuật cần chốt; tài liệu UI ghi API danh sách quản trị viên/grants còn thiếu. Xác nhận đúng phần khi giao, không tuyên bố hoàn thành từ UI.
- **Cập nhật 14/10/2026 — thay thế dòng kế tiếp cho VPS:** VPS là bản vận hành thật, OTP thật qua SMS Gateway, không `DISABLED_TEST`: xem [M01-production-profile-20261014.md](M01-production-profile-20261014.md). Chế độ `DISABLED_TEST` chỉ còn cho dev/test cục bộ.
- Quyết định Owner 12/10 (chỉ còn đúng cho dev/test cục bộ): bản test tạm đóng xác minh tài khoản, không cần OTP giả lập. Các handoff TEST_INBOX cũ không được giao lại mặc định. Contract test thay đổi cần được ghi riêng cho đúng môi trường trước Claude sửa; không tự mở bypass production hoặc bỏ TOTP Admin/SYSTEM. Đây là quyết định phải triển khai, không xác nhận code đã sửa.

## 5. Kiểm tra và review một lần cuối module
Trong triển khai: Claude build/typecheck phần thay đổi khi cần và kiểm tra luồng vừa làm chạy được, test ca lỗi vừa sửa nếu có. Không yêu cầu đợt tìm lỗi độc lập, ma trận nghiệm thu mọi app, full local suite rồi chạy lại bằng CI và ChatGPT cho mỗi phần nhỏ.
Trước tích hợp: kiểm đúng phạm vi/dependency và required checks hiện hữu; không audit sâu mỗi gói. Lỗi đã thấy phải sửa ngay, không để cuối module. CI hiện hữu vẫn tự chạy cho đến khi cấu hình được tối ưu; không yêu cầu chạy thêm bản sao thủ công.
Sau các luồng M01 được triển khai và nối thành bản chạy: ChatGPT review tìm lỗi tổng thể một đợt; Claude dùng test/CI còn hiệu lực và chỉ bổ sung kiểm tra các khoảng trống thực sự; Owner thử PC/Android liên quan. Bao phủ đăng ký/login/profile/logout, Food chuyển khách/quán, onboarding shipper, lời mời/kích hoạt/quyền admin, reset và phiên giữa hai app/thiết bị trong phạm vi triển khai.
Gom finding một danh sách. Sau sửa chỉ review delta và kiểm lại ca lỗi/phần ảnh hưởng; không bắt đầu audit toàn module lần hai. Vấn đề mới phát sinh thì xử lý đúng tác động. Một đợt review không có nghĩa phải đóng module dù vẫn còn lỗi.
Một báo cáo cuối: bản chạy/SHA, bằng chứng liên kết, phần chưa chạy/lỗi còn mở và hướng dẫn thử. Owner quyết định nghiệm thu/đóng M01.
