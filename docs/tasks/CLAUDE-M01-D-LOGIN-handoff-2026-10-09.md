# Bàn giao Claude — M01-D-LOGIN
Owner ngày09/10/2026: “Chuyển claude”. Phạm vi hiện tại: preflight backend theo thiết kế được review; chưa implementation/UI/deploy/merge.
Design input SHA: 494fc4aa8dbb0eac9ddf0c363294797a5c961ff5, PR#30.
Reviewed contract tree SHA: 8132c144f0bf0d7d4748f0fd5796953eda4fae2d. Commit494fc4a chỉ thêm final review evidence.
Main tham chiếu tại bàn giao: 487e81184e5bfafa797c36a7f2ee0fb1571257d7; Claude fetch và báo base thực tế, không giả định main đứng yên.

Đọc AGENTS.md/workflow main, prompt docs/tasks/CLAUDE-M01-D-LOGIN-preflight.md và contract docs/tasks/M01-D-LOGIN-backend-handoff.md tại design input SHA.
Đọc docs/evidence/M01-D-LOGIN-final-design-review.md; các finding cũ đã được sửa, không code theo head cũ.
Kiểm tương thích repo/keyring/TOTP, cookie/CSRF, origin guards/migration với #27, lock order và dependency; cung cấp file list + test matrix + findings/kết luận.
Không tự đổi nghiệp vụ đã chốt, không làm UI/tạo ADMIN/scope/recovery/M00, không seed/deploy/merge. Nếu preflight đạt, trả kết quả để ChatGPT hoàn thiện implementation handoff backend theo base đúng.
Không có connector Claude trong phiên ChatGPT; tài liệu chuẩn bị để Owner gửi Claude, chưa xác nhận Claude đã nhận hoặc đang chạy.
