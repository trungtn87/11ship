# M01 — Roadmap đầy đủ: tài khoản, phân quyền và các ứng dụng

Ngày: 2026-10-09. Trạng thái: DRAFT ROADMAP, không phải contract API/schema đã khóa.
Owner yêu cầu sửa tuyên bố “M01 thiết kế xong”: chỉ Auth A1/A2 và các sửa lỗi tương ứng đã có thiết kế/code; không suy ra cả module đã hoàn thành.

## 1. Nguồn và phạm vi

Đối chiếu main docs/progress/plan.yml, PR #20 head 78cb31984ba6c225a73185d3475ef43905e0e09a và docs/tasks/M01-delivery-checklist.md trên head đó; PR #27 (fixture), PR #29 (UI).
PR #20 đã liệt kê B/C/D, nhưng ghi rõ cần thiết kế mới. Không gọi chúng là thiếu hoàn toàn, và không gọi backlog là thiết kế đã khóa.
Giữ lịch sử M01-A1, M01-A2S/A2D, M01-R1 và mọi bằng chứng đã có. PR #29 là UI thử quán/xế, không phải web SYSTEM/ADMIN hay toàn bộ M01.
Không kết luận trạng thái hiện tại của các PR từ số thứ tự hoặc checklist này; dùng GitHub head/check/merged_at thực tế.

M01 sở hữu danh tính, session, 2FA, cấp/thu hồi quyền, onboarding tài khoản và UI liên quan trên web quản trị, app quản lý, quán, xế, khách.
Backend thực thi nghiệp vụ và bảo mật; client chỉ hiển thị/thao tác, không cấp quyền.
Không gộp thực đơn, ví, giao hàng hoặc quản lý hình học vùng vào Auth.
HTML/CSS/JS chức năng làm ngay; Figma hoàn chỉnh ở cuối dự án. Giữ brand cơ bản từ đầu.

## 2. Hai mốc riêng, không đánh tráo DONE

**M01-STAGING-ACCEPTED**: SYSTEM/ADMIN có 2FA thật; các client Auth thuộc phạm vi đã khóa chạy với API/DB thật, fixture ghi rõ chưa xác minh SĐT; Owner nghiệm thu. Đăng ký/OTP/recovery cần SMS chưa khả dụng phải đóng rõ. Đây là cổng bắt đầu code M02.
**M01-PRODUCTION-ACCEPTED**: thêm SMS thật, đăng ký/xác minh/recovery/đổi SĐT, kiểm bảo mật và nghiệm thu trên bản production candidate. Không công bố M01 đầy đủ DONE trước mốc này.
Thiết kế M02 có thể song song. Giữ code M02 đã tồn tại, kiểm kê và review; không xóa lịch sử để ép thứ tự mới.

## 3. Thứ tự và task chức năng

Mỗi hàng có thiết kế chi tiết riêng trước code. ID lịch sử giữ nguyên; ID mới dưới đây là đề xuất để tránh gộp các app trong một PR.

| Task | Deliverable và dependency | Tiêu chí nghiệm thu chính |
|---|---|---|
| M01-D-DESIGN | Khóa mô hình SYSTEM/ADMIN, scope, 2FA, bootstrap/recovery; sau R1 | Ma trận endpoint/quyền và state machine được review, không có quyền từ client |
| M01-D-BOOTSTRAP | Bootstrap SYSTEM; sau D-DESIGN | Đúng một SYSTEM dưới concurrency; không public signup; secret không vào repo/log; quy trình phục hồi độc lập SMS |
| M01-D-2FA | Backend enroll/challenge/recovery; sau D-BOOTSTRAP | SYSTEM dùng Google Authenticator; ADMIN bắt buộc 2FA; chưa qua challenge không có quyền quản trị; kiểm replay/expiry/rate limit |
| M01-D-SYSTEM-LOGIN | Web SYSTEM login/enroll/challenge/recovery; sau D-2FA | Authenticator thật; lỗi/loading; không đưa secret/QR vào telemetry; recovery theo contract đã khóa |
| M01-D-ADMIN-API | SYSTEM tạo/khóa ADMIN, cấp/thu hồi scope; sau D-2FA | ADMIN không tự đăng ký; mỗi thay đổi có audit; revoke có hiệu lực với session cũ và mutation đang chờ |
| M01-D-SYSTEM-ADMIN | Web SYSTEM quản lý ADMIN; sau SYSTEM-LOGIN và ADMIN-API | Danh sách/chi tiết/tạo/khóa/scope; không cấp quyền từ frontend; double submit an toàn |
| M01-D-ADMIN-WEB | Web ADMIN đăng nhập, 2FA, shell quyền; sau ADMIN-API | Chỉ thấy thao tác được cấp; gọi API vượt scope vẫn bị backend từ chối |
| M01-D-MANAGER-AUTH | App quản lý: Auth/2FA/router quyền; sau ADMIN-WEB | HTML shell riêng ứng dụng; quyền đọc từ API; không mặc định app quản lý có quyền SYSTEM |
| M01-D-E2E | E2E quản trị; sau các UI quản trị | Browser + API + PG17 thật; sai role/scope/2FA, thu hồi quyền, replay/race, recovery |
| M01-D-UAT | Owner nghiệm thu quản trị; sau D-E2E | Owner tự bootstrap/enroll, tạo ADMIN, kiểm giới hạn quyền và khóa; ghi SHA và kết quả |
| M01-B-DESIGN | Khóa vòng đời tài khoản/phiên; sau R1 | Chốt một thiết bị áp cho role nào, logout, re-auth, đổi password/phone và recovery; không tự đổi opaque session sang refresh token |
| M01-B-LOGOUT | API logout/revoke; sau B-DESIGN | Thu hồi trên server; race/replay; xóa token client không được gọi là logout server |
| M01-B-CHANGE-PASSWORD | Đổi mật khẩu có xác thực lại; sau B-LOGOUT | Atomic update/revoke theo contract; session cũ không tiếp tục khi phải revoke |
| M01-B-RECOVERY | Quên mật khẩu; sau B-DESIGN | Proof một lần, không lộ tồn tại SĐT, test fake riêng; UI staging đóng nếu không có provider |
| M01-B-PHONE | Đổi SĐT; sau B-DESIGN | Xác minh số mới, uniqueness, revoke; không nhầm contact_phone quán với login phone |
| M01-B-UI | UI tài khoản/phiên dùng chung; sau backend tương ứng | Logout thật, đổi password; recovery/phone chỉ bật khi backend khả dụng |
| M01-CLIENT-DESIGN | Khóa identity/app/router/customer contract; sau R1 | Không suy ra role CUSTOMER đã tồn tại; xác định flow 4 app + web và các lỗi/API rõ ràng |
| M01-CLIENT-SHOP | Auth + onboarding app quán; sau CLIENT-DESIGN, backend A2S | Login/me/router, lưu/đọc/hoàn tất hồ sơ; không nhập UUID vùng |
| M01-CLIENT-DRIVER | Auth + onboarding app xế; sau CLIENT-DESIGN, A2D | Tên/biển số và trạng thái đúng contract; không tự thêm GPS/ví/bank hay duyệt giả vào M01 |
| M01-CLIENT-CUSTOMER-API | Backend identity/role khách nếu còn thiếu; sau CLIENT-DESIGN | Không tự cấp SHOP/DRIVER/ADMIN; account/role/session theo contract được khóa |
| M01-CLIENT-CUSTOMER | Auth shell app đặt hàng; sau CUSTOMER-API | Login/me/router/tài khoản; menu/đặt đơn thuộc module khác |
| M01-CLIENT-QA | E2E các app và tài khoản; sau các client, B-UI | API/DB thật, stale response, refresh/restart, lost response, idempotency, session/role revoked |
| M01-STAGING-UAT | Owner nghiệm thu M01 staging; sau D-UAT, CLIENT-QA, môi trường M00 được nghiệm thu | PC + điện thoại HTTPS/4G, không stub, từng ứng dụng có checklist, blocked features công khai |
| M01-C-DESIGN | Khóa provider SMS/chống lạm dụng; chuẩn bị sớm | Quota/chi phí/provider contract và test số được phép; không gửi SMS trong thiết kế |
| M01-C-SMS | Adapter SMS thật; giai đoạn cuối dự án sau C-DESIGN | Không fallback fake ở production, timeout/resend/quota và log không lộ OTP |
| M01-C-CLIENT | Mở UI OTP/register/recovery/phone trên các app; sau C-SMS và backend tương ứng | Flow hoàn chỉnh; không fixture bypass; UI chức năng không chờ redesign Figma |
| M01-C-E2E | SMS thật + kiểm bảo mật xuyên app; sau C-CLIENT | Nhận SMS thật, expiry/replay/delivery delay/outage/rate limit; số và chi phí được cho phép |
| M01-C-UAT | Owner nghiệm thu SMS/production Auth; sau C-E2E | Authenticator + SMS thật, thu hồi/recovery, fixture bị từ chối production |
| M01-FINAL-LOCK | Khóa M01 production; sau C-UAT, regression UI cuối | Không task bắt buộc còn thiếu; đủ artifact/test/Owner evidence; không dùng CI thay UAT |

Không áp danh sách tuyến tính một cách máy móc: B và chuẩn bị client có thể song song D, nhưng ưu tiên hoàn thành web SYSTEM/ADMIN trước việc mở rộng app để nghiệm thu.
Các client dùng chung transport/session/components; shell, app identity và checklist vẫn riêng. Không phải viết lại bốn bộ Auth backend.

## 4. Vùng hoạt động — dependency bên ngoài M01

Admin có quyền quản lý vùng hoạt động (tên, ranh giới, bật/tắt) ở một chức năng nghiệp vụ riêng, sau D-ADMIN-WEB. Contract hình học/biên/chồng lấn/chính sách cập nhật vùng phải thiết kế trước code.
Quán gửi tọa độ lấy hàng đã lưu; backend tự đối chiếu vùng ACTIVE và trả tên/kết quả. Không cho client quyết định service_area_id, không ô UUID.
Ngoài vùng/vùng tắt: vẫn giữ hồ sơ nhưng không được hoạt động/nhận đơn. Phải kiểm điều kiện tại backend cho hoạt động tương ứng, không chỉ ở UI.
Nếu cấu hình vùng đổi, phải thiết kế xử lý hồ sơ đang ACTIVE, lệnh đang chạy và delivery hiện hữu trước rollout; roadmap không tự hủy delivery.
Dùng tọa độ quán, không yêu cầu GPS thiết bị mỗi lần tạo đơn. Không tự thêm vùng/GPS vào onboarding xế A2D.
PLATFORM/EXTERNAL là loại xế, không quyền quản trị; chính sách vùng xế có contract riêng. Vùng hoạt động tách bán kính tìm xế 5 km.
Dependency này phải đạt trước nghiệm thu hoàn tất quán; không giấu bằng nhập mã vận hành vào màn Owner.

## 5. Checklist bắt buộc cho mỗi task

- [ ] Nghiệp vụ, quyền, trạng thái, lỗi, giới hạn phạm vi.
- [ ] Contract schema/API/migration/rollback nếu có; review và khóa trước code.
- [ ] Màn hình HTML/copy/loading/error/empty/disabled và brand cơ bản được duyệt nếu có UI.
- [ ] Claude implementation Draft PR, head SHA, dependency đúng.
- [ ] ChatGPT review; CI đúng head, tests có kiểm chứng âm/race phù hợp.
- [ ] Chạy ứng dụng với API/DB thật; stub chỉ là test bổ sung.
- [ ] Bản staging có URL/cách chạy và dữ liệu thử đúng nguồn.
- [ ] Owner nghiệm thu task UAT, sửa và retest lỗi; evidence không chứa secret.
- [ ] Merge theo thứ tự; không suy ra đã deploy từ merge.

Bootstrap privilege, TTL 2FA, phương thức recovery ADMIN, chi tiết phạm vi quyền, chính sách một thiết bị và contract khách vẫn cần thiết kế chi tiết. Roadmap này không cho phép Claude tự quyết các invariant bảo mật chưa khóa.
Không trì hoãn 2FA đến SMS: 2FA quản trị phải thật ngay khi web SYSTEM/ADMIN dùng được.

## 6. Dashboard và tích hợp kế hoạch

Main manifest hiện chỉ có M01-A1/A2/R1. Giữ DONE lịch sử ở leaf đúng phạm vi; module tổng không được suy ra hoàn thành từ các leaf này.
PR #20 là kế hoạch Draft cũ: tích hợp/rebase có review, không merge nguyên trạng; thay FIGMA_REQUIRED bằng HTML chức năng và bỏ cổng M02 code trước M01-STAGING-UAT. Không tạo lịch sử DONE cho task mới.
Map nhóm D/B/C lịch sử kế hoạch #20 vào ID tương ứng ở đây; tách D-UI thành SYSTEM-LOGIN/SYSTEM-ADMIN/ADMIN-WEB/MANAGER-AUTH, B-PASSWORD thành CHANGE-PASSWORD/RECOVERY; không dùng một PR UI quán/xế để đánh dấu mọi app DONE.
PR #29 giữ là deliverable UI thử quán/xế; sửa findings, gắn chính xác leaf tương ứng sau thiết kế/tách PR, không để một PR tự hoàn thành nhiều leaf bằng nhãn.
Schema dashboard v1 không có design-not-yet-written gate hoàn chỉnh. Trước khi gắn task mới vào manifest, phải có gate thể hiện chưa khóa thiết kế; không để acceptance-only task xuất hiện READY_FOR_CLAUDE.
Cần một task tích hợp dashboard riêng: main + #20 + roadmap tổng thể đang soạn, cập nhật manifest/resolver/tests và giữ M00-D hiện có. Không thay manifest bằng bản #20 cũ làm mất staging.
Hiện PR này chỉ cập nhật tài liệu roadmap; chưa đổi manifest/resolver/PROGRESS.md và chưa triển khai code.
Không đặt roadmap_complete:true từ việc khóa riêng M01. Tiến độ thiết kế/code/CI/deploy/UAT/SMS production phải hiển thị riêng.
