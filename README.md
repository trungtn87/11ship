# 11ship
11 food &amp; ship

## Tiến độ hiện tại

Đã kiểm tra repository và hoàn thiện gói thiết kế nền M00-B1. Chưa có backend/app chạy, chưa có migration nghiệp vụ hoặc kết quả CI phần mềm.

- [Quyết định nền backend](docs/current/ADR-001-backend-foundation.md)
- [Quyết định session và password](docs/current/ADR-002-auth-security-foundation.md)
- [Task M00-B1 — phạm vi và nghiệm thu](docs/tasks/M00-B1-foundation.md)
- [Prompt giao Claude](docs/tasks/CLAUDE-M00-B1.md)
- [Metadata thư viện đã kiểm tra](docs/evidence/M00-B1-dependency-metadata.json)
- [Preflight bước 5.1](docs/current/11Ship-buoc-5.1-repository-preflight.md)

## Cách làm việc

ChatGPT thiết kế, chia task và review. Claude code từng task. Owner test nghiệp vụ và duyệt. Mỗi gói dùng nhánh riêng, giữ base/head commit và bằng chứng test. Chưa merge khi chưa PASS.

Task tiếp theo giao Claude: M00-B1. Sau khi nền PASS mới làm M00-C1 (transaction context/idempotency/audit/outbox), rồi M01-A1 (Auth Core). Không giao gói Auth trước để tránh bị chặn vì nền chưa có.

Thiết kế đang ở nhánh docs/step-5-foundation, PR #1. Main chưa chứa bộ tài liệu này trước khi PR được merge. Hướng dẫn chạy npm/app chỉ bổ sung sau khi code tồn tại.
