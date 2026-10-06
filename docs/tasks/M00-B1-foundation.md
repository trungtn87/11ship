# M00-B1 — Backend foundation
Trạng thái: DESIGN. Chưa gửi Claude, chưa code, chưa chạy test.
Đọc trước: docs/current/11Ship-buoc-5.1-repository-preflight.md và tài liệu 4.1.
Gói Auth 4.3 chỉ đọc khi thiết kế interface phụ thuộc; chưa thực hiện trong task này.

## Kết quả cần có
1. ADR quyết định runtime + phiên bản NestJS/PostgreSQL, query layer, migration runner, test runner, package manager.
2. ADR session/token/password hash cho Auth; không triển khai endpoint Auth ở gói này.
3. Kiểm phiên bản bằng nguồn chính thức; ghi link và ngày kiểm. Chỉ ghi LOCKED sau kiểm tương thích.
4. Backend khởi động local, /v1/health/live kiểm process, /v1/health/ready kiểm DB; ready trả 503 khi DB không sẵn sàng, không trả secret.
5. Cấu hình DEV/TEST rõ; .env.example chỉ placeholder; thiếu cấu hình bắt buộc phải fail fast.
6. PostgreSQL dev/test riêng; migration runner, test fixtures và lệnh reset chỉ cho test DB có guard. Không reset database tùy ý.
7. Một integration test với PostgreSQL thật chứng minh commit và rollback; không tạo bảng nghiệp vụ Auth/Shop/Driver.
8. CI install từ lockfile → lint/typecheck/build → migration DB test sạch → integration test.
9. README hướng dẫn setup/migrate/run/test. Có lệnh và kết quả thực tế trong báo cáo bàn giao.

## Phạm vi
apps/backend/, database/migrations/, database/fixtures/, tests/integration/, ops/runbooks/, docs/current/, cấu hình root và .github/workflows/.
Không tạo app Flutter/web, ví, giao hàng, OTP thật, tài khoản admin, tài nguyên trả phí hoặc production deployment.

## Điều kiện nghiệm thu
- F01: cài từ lockfile trên môi trường sạch; build thành công.
- F02: live=200; ready=200 khi DB hoạt động và 503 khi DB mất.
- F03: migration trên DB trống thành công; chạy lại không áp trùng.
- F04: rollback transaction không để dữ liệu dở dang.
- F05: thiếu config bắt buộc không khởi động giả thành công.
- F06: reset test bị chặn với target ngoài test.
- F07: CI thực chạy; lưu commit, lệnh, exit code, PASS/FAIL và lỗi còn lại.
Chưa chạy test thì ghi NOT_RUN, không ghi PASS.

## Sau M00-B1
M00-C1 triển khai transaction context + idempotency/audit/outbox và test concurrency/retry riêng.
M00-C1 phải giải quyết replay secret của register và ma trận mutation trước khi mở M01-A1.
Chỉ giao Auth khi nền thực sự PASS; không bắt Claude làm toàn hệ thống trong một prompt.

## Bàn giao
Base/head commit, changed-file list, ADR, phiên bản khóa, migration, test mapping F01–F07, lệnh/kết quả thật, blockers. ChatGPT review rồi Owner nghiệm thu phần phù hợp.
