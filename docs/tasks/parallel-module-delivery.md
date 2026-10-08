# Kế hoạch song song — bản điều chỉnh 08/10/2026
PR #20 hiện chứa kế hoạch đầy đủ M00–M02, thay thế mô hình R01 ở bản đầu.
- [Quy trình chung: nghiệp vụ → backend/UI → E2E → Owner UAT](module-delivery-workflow.md)
- [M00: nền tảng và môi trường test local](M00-delivery-checklist.md)
- [M01: phần đã có và toàn bộ gói còn thiếu trong kế hoạch](M01-delivery-checklist.md)
- [M02: hồ sơ/lịch tự động và menu](M02-delivery-checklist.md)
- [Dashboard](../PROGRESS.md)

Môi trường local thuộc M00 và dùng chung; UI/test/UAT thuộc từng module. M01 backend đạt mở đồng thời thiết kế M02 và bản thử M01. PR này cập nhật manifest và dashboard ngay; không để việc đó thành yêu cầu giao sau. Không triển khai code ứng dụng hoặc hạ tầng trong PR kế hoạch.
