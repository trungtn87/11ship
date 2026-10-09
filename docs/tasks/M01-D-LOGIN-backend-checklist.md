# M01-D-LOGIN backend - delivery checklist (bản điền theo mẫu)
Mẫu: [module-delivery-checklist](../templates/module-delivery-checklist.md). Quy trình: [11ship-delivery-workflow](../process/11ship-delivery-workflow.md).
Module/task: M01-D-LOGIN (backend); base SHA: `aeaa9c75245233e242112121a559fef8075e60ea`; design/handoff SHA: `77684c643286155f633a01ea7f4f74273831ea59`; giai đoạn: PR Draft, chờ CI và review.
Tài liệu này ghi trạng thái, KHÔNG phải nghiệm thu. Không dòng nào dưới đây là xác nhận của Owner.

## Checklist
- [x] Kiểm kê nguồn và backend thực tế (preflight, đã cập nhật theo handoff 77684c6).
- [x] Nghiệp vụ Q1 (đúng mật khẩu khi TOTP bị khóa: vẫn cấp preauth, verify 429) và Q2 (bucket theo SĐT và IP, khóa 15 phút, lần chạm ngưỡng trả 429) đã được chốt; có test chứng minh. Rủi ro khóa SYSTEM cố ý được chấp nhận, chưa có khôi phục (xem evidence). Đây không phải nghiệm thu của Owner.
- [ ] UI: ngoài phạm vi gói này (không làm UI).
- [x] Gói giao xác định base, scope, giới hạn, hợp đồng, test.
- [x] Sửa theo review: hết hạn quyết định sau khóa, thay thế challenge đúng hợp đồng, test xoay khóa/XFF/đồng thời/mất response (evidence: `docs/evidence/M01-D-LOGIN-review-fixes-2026-10-09.md`).
- [ ] CI trên final head: xem mô tả PR (không ghi SHA/kết quả trong tài liệu này).
- [ ] ChatGPT review đúng SHA.
- [ ] Owner chạy local / thiết bị thật: chưa; chờ M00 và UI.
- [ ] Owner quyết định nghiệm thu/merge/đóng module.

## Ma trận từng ứng dụng
| Ứng dụng | Phạm vi | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|
| Web quản trị | Chỉ backend; không UI | Chưa có kết quả CI | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |
| Khách / Quán / Xế / App quản lý | N/A: gói không đổi app; chỉ thêm kiểm tra `account_origin` trong Auth | Hồi quy qua CI | N/A | N/A | Quyết định Owner |
| Liên thông | Chưa xác định | Chưa kiểm chứng | Chưa kiểm chứng | Chưa kiểm chứng | Chưa |

Giới hạn bằng chứng: môi trường làm việc không cài được jest/PostgreSQL 17 (registry 403), nên bằng chứng test duy nhất là CI trên PR.
