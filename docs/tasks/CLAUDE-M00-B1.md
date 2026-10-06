# Prompt giao Claude — M00-B1

Dán nội dung khối dưới vào Claude đã có quyền đọc/ghi repository. Đây là bàn giao do Owner thực hiện; ChatGPT chưa gửi hoặc khởi chạy Claude.

```text
Triển khai task M00-B1 cho repo https://github.com/trungtn87/11ship.

1. Fetch nhánh docs/step-5-foundation. Kiểm tra có docs/tasks/M00-B1-foundation.md phiên bản 1.1 và ADR-001/ADR-002. Ghi SHA thực đã đọc. Tạo nhánh feat/m00-b1-foundation từ commit đó; không code trực tiếp main.
2. Đọc docs/tasks/M00-B1-foundation.md, docs/current/ADR-001-backend-foundation.md và tài liệu Bước 4.1 trong docs/current. ADR-002 chỉ là nền thiết kế cho Auth, chưa code nó.
3. Stack đã được quyết định: Node 24 LTS, NestJS 11 Express, TypeScript 5 strict/CommonJS, PostgreSQL 17, pg 8, node-pg-migrate 8, npm 11, Jest 30 và ESLint 9. Được khóa patch/minor ổn định tương thích trong đúng major; commit package-lock.json thực. Không đổi major hoặc ORM và không dùng --force/--legacy-peer-deps để vượt lỗi dependency.
4. Chỉ dựng backend bootstrap, config, database pool, migration runner, health endpoints, test và CI theo task. Thực hiện đủ HTTP/error contract và các case F01–F09.
5. Không tạo Auth/Shop/Driver/Wallet/Delivery, không triển khai frontend, SMS hay production. Không thêm task khác để tận dụng context.
6. Chạy các lệnh nghiệm thu thực tế. Không có DB/CI thì báo BLOCKED cho case tương ứng; không giả PASS, không skip để xanh. Thiếu hạ tầng không làm thay đổi business contract.
7. Bàn giao branch/head SHA, changed files, exact versions, lệnh setup/build/migration/test, mapping F01–F09 và bằng chứng, lỗi còn lại. Ghi vào docs/evidence/M00-B1.md và tạo draft PR; không tự merge.

PR code tạm target docs/step-5-foundation để diff chỉ chứa code. Sau khi PR thiết kế #1 được merge, rebase/retarget PR code về main và kiểm lại CI. Giữ nguyên commit nguồn của thiết kế khi bàn giao.
```
