# M00 bổ sung môi trường và khởi động lại M01 theo quy trình mới
Ngày: 09/10/2026. Trạng thái: ĐỀ XUẤT THIẾT KẾ, chờ Owner duyệt; chưa giao code.
Nguồn chỉ đạo: Owner yêu cầu triển khai M01 theo quy trình mới, thiếu môi trường quay lại M00.
Base tham chiếu: main ba5b54fc84b22fcbbb4dc05de05b1654870f4dae.
Quy trình bắt buộc: [workflow](../process/11ship-delivery-workflow.md), [checklist](../templates/module-delivery-checklist.md).

## Phân công và gate
ChatGPT kiểm kê, thiết kế nghiệp vụ/UI với ảnh từng màn hình, giao task và review đúng SHA.
Claude viết code, migration, cấu hình/build/deploy, test và sửa finding.
Owner duyệt thiết kế; test local rồi điện thoại; quyết định merge/nghiệm thu/đóng.
Chỉ tài liệu trong gói này. Chưa có quyết định Owner chấp nhận thiết kế dưới đây.
M00 bổ sung trước vòng test M01; thiết kế UI M01 có thể tiếp tục trong lúc chờ môi trường.
Không sửa tay PROGRESS.md hoặc thêm field dashboard không được hỗ trợ.

## Kiểm kê có nguồn
| Nguồn | Kết quả |
|---|---|
| main AGENTS.md, workflow, template | Quy trình mới đã có trên main; không cho ChatGPT code thay Claude |
| main package.json | Chỉ workspace backend; dev build rồi chạy một lần, chưa hỗ trợ vòng cập nhật nhanh |
| main compose.dev.yml | DB dev bền vững riêng, DB integration tạm riêng; cả hai bind loopback |
| main README | Hướng dẫn backend; chưa phải bộ Owner test đầy đủ; nội dung trạng thái có thể cũ |
| PR #20 head 78cb31984ba6c225a73185d3475ef43905e0e09a | Checklist môi trường local còn Draft; không phải runtime đã có |
| PR #24 head ef297175004b0fa4b99413ccba52d8e40bf8764a | Đề xuất nền frontend chưa khóa |
| PR #27 head c8b410ef7e8a96737e898f95d33d52a26c0a9681 | Staging fixture còn Draft; đóng OTP/register, không chứng minh luồng đăng ký |
| PR #30 head bd213e5ca0b8756c2e858b434679cf0db1eeb7b5 | Roadmap SYSTEM/ADMIN/2FA còn Draft; chưa khóa API/schema |
| PR #31 head be45bee840945a189668b459427afcd433dc09d8 | Web HTML và Android Java native riêng, shell health; chưa Auth, chưa Owner nghiệm thu |

Ảnh thương hiệu Owner gửi đã xem: logo 11, vàng/xám/trắng và bộ slogan mới “Cần là có / Thèm là có / Gọi là có”. Không dùng slogan cũ trong ảnh 1000002790.jpg. Màu/font cuối cùng phải đối chiếu guideline repo trước ảnh UI. Không xem ảnh nhận diện là Owner duyệt UI chức năng.

## M00-LOCAL: đề xuất hợp đồng môi trường
### LOCAL-RUN — Windows, backend và DB
Giữ Node/npm và PostgreSQL đã khóa trong repo. Dùng DB dev bền vững cho Owner, không dùng ship11_test. Backend/API thật; không tài khoản/phiên giả ở UI.
Đề xuất backend 127.0.0.1:3000; web test 127.0.0.1:5173 có proxy /v1 tới backend (same-origin). DB giữ cổng 5432/5433 loopback hiện tại. Claude phải kiểm tra bind/config thực tế, xung đột port và khả năng proxy trước code; nếu không khớp trả finding.
Cần lệnh setup/check/start/stop/update tiếng Việt và reload nhanh khi đổi UI; migration là bước riêng, không tự chạy khi server boot. Không đổi .env/credentials của Owner khi cập nhật.
Preflight kiểm Node/npm/Docker/DB/cổng/config; thiếu thành phần thì chỉ rõ cách khắc phục. Trang hoặc console hỗ trợ phải chỉ ra SHA phiên bản và live/ready riêng; live OK chưa phải DB ready.
Hướng dẫn backup và phục hồi vào DB riêng trước migration; không mặc định có rollback schema an toàn.

### LOCAL-ANDROID — kiểm tra mã Android thật
Vì #31 là native Java, bản browser không tương đương runtime Android. Đề xuất Android Studio/SDK và AVD trên Windows; ba package Khách/Quán/Xế cài đồng thời, mở/test lần lượt để giảm tải.
HTML có thể reload nhanh; Java/native phải build và cập nhật emulator khi thay đổi. Không cam kết native hot reload. Chưa chọn chuyển framework hoặc viết lại #31.
Android hiện cấm cleartext và yêu cầu HTTPS: Claude phải đề xuất endpoint HTTPS local qua proxy và CA test được debug build tin cậy, gồm ánh xạ host emulator, trước triển khai. Không tắt kiểm TLS/hostname, không đưa trust CA test vào release. Chưa khóa hostname/cert/port Android; đây là dependency cần thiết kế kỹ thuật được review.
Không yêu cầu mở PostgreSQL ra LAN. HTTPS điện thoại/LAN thuộc gói M00 remote/device riêng sau local đạt; chứng minh certificate, origin, mạng và GPS khi tới onboarding.

### LOCAL-DATA — dữ liệu và OTP
Đề xuất dùng development với provider thử giới hạn local để test REGISTER/OTP API thật. OTP chỉ lấy bằng công cụ operator local theo số thử được phép; không đưa OTP vào response public hoặc log/evidence.
Provider in-memory trong main chưa đủ bằng chứng Owner lấy OTP được: Claude thiết kế adapter/công cụ truy xuất được giới hạn môi trường và số thử, không tự tạo bypass staging/production.
Seed có manifest riêng và chạy lại an toàn: tài khoản chưa có role; quán thiếu hồ sơ/chưa có tọa độ; xế PENDING; dữ liệu vùng theo contract hiện hữu. Không seed ADMIN/SYSTEM trước contract M01 được duyệt. Seed không thay thế test đăng ký.
Reset chỉ dataset thử được nhận diện, đúng DB Owner local, cần xác nhận thao tác; không drop DB theo URL tùy ý. DB integration vẫn theo guard hiện có.
Fixture staging #27 chỉ kiểm phần được hỗ trợ; đăng ký/OTP đóng phải ghi “chưa kiểm được”, không PASS hoặc N/A.

### LOCAL-QA/UAT — điều kiện mở vòng test M01
- [ ] Claude cung cấp hướng dẫn fresh setup và update trên Windows, phiên bản/SHA.
- [ ] API live và ready đạt; DB mất thì ready thất bại; restart giữ dữ liệu.
- [ ] Web và ba app emulator gọi đúng backend/DB local; port/origin/TLS đúng.
- [ ] OTP/register local chạy thật qua API; công cụ OTP giới hạn như thiết kế.
- [ ] Integration test chỉ DB test, không làm đổi dataset Owner.
- [ ] Backup/restore vào DB riêng được kiểm chứng.
- [ ] Owner tự start/stop/update và xác nhận môi trường local đạt.
Chưa mục nào được coi đã PASS trong tài liệu này.

## Thứ tự triển khai M01 sau preflight
1. Review lại #31 theo workflow mới: code trước chỉ đạo mới không tự được chấp nhận; giữ Draft, cần ảnh UI và Owner duyệt. Không merge #20/#24/#27/#30/#31 chỉ vì CI xanh.
2. Chốt nghiệp vụ SYSTEM/ADMIN/2FA và cách bootstrap SYSTEM, rồi ảnh UI web quản trị. Không cấp ADMIN từ đăng ký công khai hoặc nhận diện app. API/schema chưa có thì mở task backend M01 cho Claude sau duyệt.
3. Claude triển khai phần đã duyệt; ChatGPT review; Owner test local web quản trị trước. Web shell hiện tại chưa chứng minh quyền SYSTEM/ADMIN.
4. Theo từng bước Auth, mở lần lượt Khách → Quán → Xế; mỗi app có nghiệp vụ/ảnh UI/giao Claude/review/local riêng và kiểm liên thông.
5. Bao phủ đăng ký/OTP, login, role/session, quên/đổi mật khẩu và logout, onboarding, quyền quản trị/2FA theo API thực tế. Thiếu endpoint quay lại thiết kế M01, thiếu runtime/cert/data quay lại M00.
6. Sau local đạt trên head được review: Claude build/deploy bản điện thoại, Owner test từng app và hồi quy liên thông.
Không chuyển bước vì ảnh đẹp hoặc backend CI đạt; không đóng M01 trước đủ gate được áp dụng.

## Ma trận gate hiện tại
| Ứng dụng | Phạm vi | Nghiệp vụ/UI | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|---|
| Web quản trị | SYSTEM/ADMIN, Auth | Chưa duyệt trong gói này | Shell Draft; Auth quản trị chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| Khách | REGISTER/login/session/password | Chưa duyệt trong gói này | Shell Draft, chưa Auth | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| Quán | Auth + onboarding SHOP | Chưa duyệt trong gói này | Backend lịch sử; UI shell Draft | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| Xế | Auth + onboarding DRIVER | Chưa duyệt trong gói này | Backend lịch sử; UI shell Draft | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| App quản lý | Theo roadmap sau | Chưa xác định task chi tiết | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| Liên thông | Phiên/role/API chung | Chưa khóa bộ ca hoàn chỉnh | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |

App quản lý không bị loại khỏi M01; chưa nằm trong đợt web + 3 Android theo chỉ đạo hiện tại. Không ghi N/A khi chưa có Owner duyệt.
Evidence bắt buộc: task, version/head SHA, môi trường, ca test/kết quả, người test/ngày, lỗi còn mở, phạm vi test lại và link quyết định Owner.

## Bước tiếp theo và giới hạn handoff
Gói này chờ duyệt lựa chọn local Windows + web proxy + native emulator. Chưa đủ điều kiện giao Claude code TLS/OTP hoặc UI vì còn contract kỹ thuật và ảnh màn hình cần hoàn thiện.
ChatGPT tiếp tục thiết kế chi tiết M00 local (TLS/OTP/khởi động) và ảnh màn hình bước 1 M01; Owner duyệt đầu ra cụ thể trước code.
Đây là kế hoạch quay lại M00 có nguồn, không phải evidence môi trường đã triển khai hay xác nhận M01 đã hoàn tất.
