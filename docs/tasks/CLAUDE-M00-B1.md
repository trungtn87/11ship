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

## Quy trình và phân công giai đoạn — Owner chốt 09/10/2026

Áp dụng [quy trình bắt buộc](../process/11ship-delivery-workflow.md), [AGENTS.md](../../AGENTS.md) và [mẫu module](../templates/module-delivery-checklist.md). Mục này điều chỉnh phân công/gate; giữ nguyên phạm vi kỹ thuật và evidence lịch sử ở trên.

| Giai đoạn | Thực hiện | Gate chuyển |
|---|---|---|
| Nghiệp vụ/API/dữ liệu | ChatGPT thiết kế | Owner duyệt |
| Ảnh UI chi tiết và trạng thái liên quan | ChatGPT thiết kế | Owner duyệt UI; backend-only ghi N/A có lý do |
| Gói giao task | ChatGPT | Scope/base/hợp đồng/checklist đã rõ |
| Code/build/test/CI và sửa finding | Claude | CI đúng final head + ChatGPT review đạt |
| Test local, phản hồi/sửa | Owner test; ChatGPT phân tích; Claude sửa | Owner xác nhận local đạt |
| Bản web/điện thoại test | Claude chuẩn bị | Local đạt, bản/SHA hiện tại review đạt |
| Test thiết bị thật và liên thông | Owner | Từng app liên quan đạt |
| Nghiệm thu/merge/đóng | Owner quyết định | Đủ gate và bằng chứng; không suy từ backend DONE |

Checklist gate mới (chưa kiểm chứng, không phủ nhận kết quả test kỹ thuật lịch sử):
- [ ] Xác định task con và ứng dụng liên quan; điền ma trận theo mẫu.
- [ ] Ghi link Owner duyệt nghiệp vụ/UI, hoặc N/A có lý do.
- [ ] Claude cung cấp bản local, hướng dẫn và bằng chứng đúng SHA; ChatGPT review.
- [ ] Owner test local, sửa phản hồi và xác nhận đạt.
- [ ] Owner test thiết bị thật riêng từng app và liên thông, xác nhận đạt.
- [ ] Owner quyết định phạm vi nghiệm thu, merge và đóng M00 khi đủ các task liên quan.

M00 phải tách môi trường Owner test local khỏi DB test tự động; bổ sung task local và gói giao Claude trước triển khai. Cấu hình staging hoặc CI đạt không thay nghiệm thu local/thiết bị.
