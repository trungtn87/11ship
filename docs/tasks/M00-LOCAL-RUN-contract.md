# M00-LOCAL-RUN — hợp đồng và gói giao Claude
Ngày 09/10/2026. Trạng thái: thiết kế cụ thể CHỜ OWNER DUYỆT; không phải lệnh bắt đầu code.
Owner đã đồng ý quay lại M00. Chỉ đạo đó xác nhận phạm vi công việc; không tự suy ra duyệt các lựa chọn mới bên dưới.
Base tham chiếu main: ba5b54fc84b22fcbbb4dc05de05b1654870f4dae. Trước triển khai Claude fetch main, ghi base SHA thực tế và đối chiếu thay đổi.
Nguồn: AGENTS.md, docs/process/11ship-delivery-workflow.md, docs/templates/module-delivery-checklist.md, package.json, compose.dev.yml, main.ts, config/app-config.ts, auth/otp-provider-binding.ts, auth/fake-otp-provider.ts; PR #31 head be45bee840945a189668b459427afcd433dc09d8.
Task cha: [M00 local / M01 restart](M00-local-M01-restart.md).

## 1. Phân công, phạm vi và đầu ra
ChatGPT thiết kế/giao việc/review. Claude code/test/build và hướng dẫn Windows. Owner duyệt thiết kế, tự test local, quyết định merge.
Gói đầu tiên chỉ tạo bộ chạy backend + DB local và proxy phục vụ web đã được duyệt sau này. Không viết màn Auth, không tích hợp hoặc merge #31, không SMS/SYSTEM/ADMIN, không staging deploy.
Giao diện vận hành dùng terminal tiếng Việt; chưa xây dashboard hay màn sản phẩm trong gói này. Ảnh UI M01 vẫn là gate riêng trước code UI.
Claude mở PR Draft riêng, không merge/auto-merge và không ghi Owner đã nghiệm thu.

## 2. Contract RUN đề xuất chốt
| Thành phần | Địa chỉ | Mục đích |
|---|---|---|
| Backend | 127.0.0.1:3000 | API thật; HOST được kiểm tra trước start |
| Web/proxy local | 127.0.0.1:5173 | Phục vụ web root được chỉ định rõ; /v1 chuyển tới backend |
| DB Owner/dev | 127.0.0.1:5432, ship11_dev | Dữ liệu bền vững, không reset khi update |
| DB integration | 127.0.0.1:5433, ship11_test | Chỉ test tự động theo guard hiện hữu |

Proxy chỉ chuyển /v1 tới upstream cố định; không nhận upstream tùy request, không proxy công cụ OTP. Giữ method/body/status/envelope và các header Auth/idempotency cần thiết; không ghi request body, bearer hay mật khẩu. Body limit phải khớp app.setup thực tế; Claude đối chiếu và ghi rõ trước code, không âm thầm tăng limit backend.
Static web root phải tường minh; không serve repo root, .env, key/cert hoặc thư mục dữ liệu. Nếu chưa có web được duyệt, proxy chỉ hỗ trợ API; không tạo UI placeholder để báo app đạt.
Không mở LAN trong RUN. Port bận thì báo port và cách xử lý, không kill tiến trình lạ hoặc tự đổi port.
Giữ .env hiện hữu và compose.dev.yml; không đổi engine/package manager hoặc framework frontend.
Backend main.ts hiện bind theo config, default loopback; dev hiện build một lần. RUN thêm cách watch build/restart có kiểm soát cho development, stop sạch và không sinh nhiều process. Không tự migrate khi restart.
Nhận diện version gồm git SHA và dirty flag trong output vận hành; không thêm public API version khi chưa cần.

## 3. Luồng vận hành Windows
Tên dưới đây là contract hành vi; Claude chọn tên script cụ thể và ghi vào runbook.
1. CHECK: kiểm repo/SHA/dirty, Node/npm đúng repo, Docker Compose và daemon, port/config. Chỉ báo tên biến thiếu/sai. Không in DATABASE_URL/key/password.
2. SETUP: cài dependency đúng lockfile và khởi động DB dev; DB test chỉ khởi động cho test. Nếu chưa có .env, tạo từ mẫu bằng bước tường minh; Owner điền secret hoặc công cụ tạo secret lưu local không in giá trị.
3. MIGRATE: lệnh riêng, xác nhận đúng DB dev bằng truy vấn DB/user thực tế; không chỉ tin URL. Có backup trước update schema. Không tự rollback SQL.
4. START: backend và proxy; chỉ báo sẵn sàng khi live + ready đúng envelope. Browser Owner mở địa chỉ được in trong terminal.
5. UPDATE: ghi SHA mới; giữ config/DB; nếu schema thay đổi dừng để backup/migrate riêng. Không tự git reset/pull ghi đè file đang sửa.
6. STOP: dừng đúng process đã start; không docker compose down -v, không xóa volume. STOP không làm mất dữ liệu.
Runbook phải có fresh setup, dùng hằng ngày, cập nhật và xử lý Docker/DB/config/port lỗi; copy-paste được trong PowerShell.

## 4. Các gói tiếp theo — chưa được lẫn vào RUN
### M00-LOCAL-ANDROID/TLS
Đề xuất HTTPS proxy riêng tại host loopback 8443; emulator truy cập https://10.0.2.2:8443, certificate có SAN đúng IP. Đây là phương án phải Claude kiểm chứng trên AVD, không phải kết quả kết nối đã đạt.
CA/private key sinh riêng từng máy, giữ ngoài git/artifact; debug Android trust đúng CA test bằng cấu hình debug-only. Không trust-all, không tắt hostname verification hoặc cho HTTP; release không chứa CA test.
Build origin hiện ở #31 chấp nhận HTTPS/IP; nhưng #31 chưa được chấp nhận, không dùng task môi trường làm quyền tích hợp nó. Claude cần gói review riêng cho mọi chỉnh sửa Android.
Ba package cài đồng thời trên một AVD, test lần lượt. Native thay đổi vẫn phải build/update emulator; web reload nhanh không chứng minh native.
Phải kiểm chứng release loại CA/endpoint local. LAN/điện thoại và DNS/cert là gói sau, không tự mở firewall.
### M00-LOCAL-OTP/DATA
main đang bind FakeOtpProvider in-memory; main process chưa có đường cho Owner đọc OTP. Không cố đọc OTP từ DB vì DB lưu HMAC.
Quyết định Owner ngày 09/10/2026: người test vẫn nhập SĐT; backend kiểm tra/chuẩn hóa SĐT theo contract hiện hành. Chỉ thay kênh gửi SMS bằng hiển thị OTP thử trên bản test. Quyết định này thay đề xuất lấy OTP qua terminal/sidecar ở bản trước.
Backend vẫn sinh OTP ngẫu nhiên; UI không tự sinh mã và không dùng mã cố định. Giữ nguyên validation SĐT, điều kiện tài khoản đã tồn tại, purpose, TTL, resend cooldown, giới hạn lần nhập, kiểm mã, proof, đăng ký, mật khẩu, idempotency và các quy tắc phiên/phân quyền hiện hành. SĐT sai phải bị từ chối trước khi sinh/gửi mã theo luồng hiện có.
Hiển thị “Mã OTP thử: …” là thay thế delivery, không tự điền/xác nhận hộ người dùng; vẫn nhập mã và gọi verify API thật. Kiểm tra đúng/sai/hết hạn/gửi lại và các ca lỗi như bản thật.
SĐT hợp lệ về định dạng không chứng minh sở hữu số hoặc SIM đang hoạt động. Evidence phải ghi dùng delivery thử, không SMS thật.
Test mode/allowlist là giới hạn môi trường delivery thử, không thay validator SĐT. Số hợp lệ nhưng không nằm trong danh sách thử phải có thông báo riêng, không báo “SĐT không hợp lệ”.
Chỉ local hoặc staging test được cho phép tường minh mới hiển thị mã; production không được bật. Không đưa OTP vào log/evidence/artifact. Phải thiết kế contract trả mã test và dấu hiệu môi trường, dữ liệu tài khoản thử và chặn production trước khi giao Claude code; không tự đổi API/schema đã khóa trong gói RUN.
PR #27 hiện đóng OTP/register nên không đáp ứng quyết định này; cần gói điều chỉnh thiết kế staging riêng, không dùng fixture seed thay đăng ký. Chưa coi Owner đã duyệt chi tiết transport/API hoặc UI chỉ từ quyết định nghiệp vụ này.
Seed fixture manifest riêng, không tự cấp SYSTEM/ADMIN, không ghi đè tài khoản đã có, không thay thế test REGISTER. Thiết kế reset/cleanup riêng sau khi đọc schema đầy đủ.
### M00-LOCAL-QA/UAT
Sau RUN + Android/TLS + OTP/DATA được review: Owner xác nhận môi trường đầy đủ. RUN đạt chỉ mở kiểm tra backend/web transport, chưa mở nghiệm thu đầy đủ M01.

## 5. Handoff RUN cho Claude sau Owner duyệt
- Đọc hướng dẫn repo và workflow mới; ghi base SHA, phạm vi, danh sách file dự kiến.
- Chỉ sửa scripts local, runbook, wiring development/watch/proxy cần thiết và tests môi trường; mọi thay đổi backend ngoài môi trường trả về review trước.
- Không sửa nghiệp vụ Auth/schema/API. Không thay FakeOtpProvider trong RUN.
- Đối chiếu app.setup/body limits và lifecycle thật trước chọn công cụ; báo dependency mới, phiên bản và lý do. Không giả vờ đã kiểm Windows từ Linux.
- Không mang nguyên nhánh PR #20/#24/#27/#31 vào main. Không đổi progress generator/plan schema trong gói này.
- Kết thúc cung cấp PR Draft, final head SHA, test summary, runbook PowerShell, danh sách giới hạn và bằng chứng Windows còn thiếu.
Tài liệu này không gửi tin nhắn tới Claude tự động; Owner dùng handoff sau khi duyệt.

## 6. Ca nghiệm thu RUN
| ID | Kiểm tra | Kết quả bắt buộc |
|---|---|---|
| R01 | Fresh setup Windows | Theo runbook chạy được; secret không lộ |
| R02 | Config/tool/port thiếu | Lỗi tiếng Việt có hướng xử lý, không kill process khác |
| R03 | GET live/ready qua backend và proxy | Đúng status/envelope, không cache kết quả health |
| R04 | DB dừng và chạy lại | ready lỗi rồi phục hồi; live đánh giá riêng |
| R05 | Restart/stop/update | Dataset Owner giữ nguyên; process dừng sạch |
| R06 | Proxy auth/idempotency transport | Header/body/status giữ đúng, không ghi secret |
| R07 | Truy cập .env/key/path traversal | Không trả nội dung ngoài web root |
| R08 | Integration guard và tách DB | Test đúng ship11_test, dataset dev không đổi |
| R09 | Watch thay đổi/rebuild thất bại | Chỉ process hợp lệ chạy, lỗi rõ, phục hồi được |
| R10 | Backup/restore trước update | Restore vào DB riêng, có bằng chứng so sánh |

Claude chạy các test liên quan, lint/typecheck/build theo repo khi có wiring backend, CI trên final head; không đổi code chỉ để tests xanh. Windows fresh setup là bằng chứng riêng. Không chạy suite phá dữ liệu trên dev.
Evidence ghi SHA, OS/tool versions, thao tác, expected/actual, PASS/FAIL, người/ngày và lỗi mở. Chưa có ca PASS trong thiết kế này.

## 7. Gate ứng dụng
| Phạm vi | RUN cung cấp | Local ứng dụng / điện thoại / Owner nghiệm thu |
|---|---|---|
| Web quản trị | API/proxy local | Chưa kiểm chứng |
| Khách, Quán, Xế | Backend dùng chung; emulator/TLS ở gói kế tiếp | Chưa kiểm chứng từng app |
| App quản lý | Nền dùng chung, task ứng dụng chưa mở | Chưa kiểm chứng |
| Liên thông | Một DB/API local | Chưa kiểm chứng nghiệp vụ |

RUN không tự ghi N/A hoặc đóng M00/M01. Gate code/review/local cho RUN phải đủ trước chuyển task phụ thuộc; nghiệm thu điện thoại từng ứng dụng vẫn giữ riêng.
