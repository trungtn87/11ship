# M00 — checklist nền tảng, môi trường local và vận hành
UI_SCOPE: NONE cho runtime/backend; UAT ở đây là chạy công cụ/hướng dẫn và kiểm hạ tầng. UI ứng dụng nằm trong M01/M02.
Trạng thái: phần backend lịch sử đã merge; các gói local/vận hành bên dưới chưa triển khai.

## Đã có
- [x] M00-B1: config, health, PostgreSQL pool, migration, error/log convention — #2.
- [x] Transaction/shared primitives #4, idempotency #6, audit/outbox #9, dispatcher primitive #10.
- [x] Sửa deadline rollback ở #19; CI merge e844276 xanh.
- [x] compose.dev.yml: PostgreSQL dev có volume riêng và test tạm riêng; hướng dẫn Node chạy ngoài container.
- [ ] Bộ chạy local đầy đủ để Owner tái lập, nạp dữ liệu mẫu, kiểm từ Android.
- [ ] Publisher/worker và cleanup có lịch chạy thật; triển khai production.

## M00-LOCAL — nghiệp vụ và kiến trúc
Mục tiêu: máy Windows của Owner làm máy chủ local; Android cùng LAN dùng UI qua địa chỉ local. Chưa thuê host, chưa dùng dữ liệu khách thật. Reuse Node/npm khóa trong repo và PostgreSQL compose hiện có; không đổi stack/ORM.
Backend chạy với development config, API thật, DB dev bền vững. Test tự động chỉ dùng DB test đúng guard, không dùng DB dev hoặc production. Frontend khi có sẽ dùng cùng API/backend này.
Cần khóa trước code RUN: sơ đồ port/bind, cách cấp HTTPS tin cậy cho Android/LAN (GPS trình duyệt cần secure context), proxy/same-origin hoặc CORS allowlist, lệnh start/stop và nơi lưu cấu hình local. Không coi localhost trên Android là máy Windows. Không mở DB ra LAN/Internet.
Cần khóa trước code DATA: seed service area/quán/xế, allowlist số thử, cách đọc OTP test không công khai và quy tắc reset chỉ dataset test. Không thêm bypass vào staging/production. Mật khẩu/token/OTP không vào repo/log/evidence.

### M00-LOCAL-RUN — chạy hệ thống
- [ ] Contract local có sơ đồ backend/DB/frontend, port và HTTPS; Owner duyệt cách cài trên Windows/Android.
- [ ] Preflight kiểm Node/npm/Docker/config; hướng dẫn tiếng Việt; thông báo lỗi thiếu cấu hình rõ ràng.
- [ ] Một quy trình được tài liệu hóa: setup → migrate → start → health; không tự migrate khi boot nếu trái convention hiện có.
- [ ] Start/stop/restart sạch, log không lộ secret, hiển thị release SHA.
- [ ] DB dev và DB test tách credentials/volume; chỉ API/proxy được bind LAN cần thiết.
- [ ] Backend restart giữ dữ liệu; fresh install và update từ bản trước đều chạy.

### M00-LOCAL-DATA — dữ liệu và OTP thử
- [ ] Seed có thể chạy lại không nhân bản: service area active, roleless, Shop nháp/active, Driver PENDING và cùng user Shop+Driver.
- [ ] Các trạng thái lifecycle đặc biệt chỉ tạo bằng fixture test đã giới hạn; không tự thêm API duyệt xế.
- [ ] OTP thử chỉ dành development/test và số cho phép; đường lấy OTP nằm trong công cụ local đã khóa, không response/endpoint public.
- [ ] Ghi rõ dữ liệu giả, cách làm mới; reset cần đúng DB/dataset và xác nhận thao tác, không drop DB tùy URL.
- [ ] Seed, idempotent rerun và negative environment guard có test.

### M00-LOCAL-QA — kiểm chứng vận hành
- [ ] Windows fresh setup theo hướng dẫn; API health/readiness và DB mất/kết nối lại.
- [ ] Android truy cập HTTPS tin cậy; probe geolocation từ secure context độc lập UI M01.
- [ ] Không port DB công khai; origin sai bị từ chối theo policy đã khóa.
- [ ] Nâng cấp migration trên dữ liệu mẫu; backup/restore local vào DB riêng, so sánh dữ liệu.
- [ ] Integration suite chạy trên DB test không làm đổi DB dev; secrets không có trong output.
- [ ] Evidence ghi môi trường/SHA/thao tác/kết quả và giới hạn chưa có UI.

### M00-LOCAL-UAT — Owner chấp nhận môi trường
- [ ] Owner tự khởi động/dừng theo hướng dẫn, xem health và truy cập từ điện thoại.
- [ ] Restart giữ dữ liệu; Owner biết cách lấy log báo lỗi và nhận bản cập nhật.
- [ ] Owner xác nhận đúng SHA/thiết bị; đây chưa phải nghiệm thu UI Auth.
- [ ] Sau UAT môi trường này dùng lại cho M01/M02, không tạo lại DB tùy mỗi module.

## M00-OPS — backlog bắt buộc trước production
Các leaf chưa có design PR; phải thiết kế riêng trước implementation.
- [ ] OPS-WORKER: publisher thực, consumer dedupe, vòng poll/lease/retry/dead-letter, graceful shutdown, kiểm fault/restart.
- [ ] OPS-CLEANUP: lịch chạy idempotency/OTP/session và retention được khóa; batch giới hạn, audit không bị dọn trái policy; kiểm dữ liệu quá hạn và không quá hạn.
- [ ] OPS-RELEASE: môi trường staging/production tách local; migration/release/rollback, secrets, TLS, health/alert, backup và diễn tập restore có evidence.
- [ ] Chọn host/chi phí, SMS thật và quyền admin/2FA đã duyệt trước production.
- [ ] Kiểm vận hành thật và Owner duyệt; không dùng primitive unit test làm bằng chứng worker đang chạy.

Bằng chứng mỗi leaf: docs/evidence/<TASK-ID>.md. Nghiệp vụ/UI ứng dụng không nằm trong task môi trường.
