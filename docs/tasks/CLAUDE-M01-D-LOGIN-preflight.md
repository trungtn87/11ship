# Prompt giao Claude — M01-D-LOGIN preflight
Repo trungtn87/11ship. Chỉ preflight/review thiết kế trước, chưa code.
Đọc AGENTS.md và docs/process/11ship-delivery-workflow.md main; PR#30 và:
- docs/tasks/M01-D-business-design.md
- docs/tasks/M01-D-auth-UI-v1.md
- docs/tasks/M01-D-login-contract-draft.md
- docs/tasks/M01-D-LOGIN-backend-handoff.md (phụ lục cookie/schema/origin ưu tiên phần draft cũ).
Owner đã chốt SYSTEM duy nhất, login chung, 2FA bắt buộc, TTL5m challenge, 5 mã sai khóa15m, phiên8h, F5 giữ phiên, login thành công máy mới thu hồi admin session cũ. Không hỏi lại các điểm này.
Ghi main base và PR#30 head thực tế. Kiểm schema hiện hữu, API/error envelope, crypto primitives, Auth app guard/participant, migration account-origin xung đột #27, CSRF/session cookie và lock/rate-limit/concurrency.
Báo finding severity + file/section + trigger + tác động + đề xuất. Không tự đổi nghiệp vụ hoặc code khi contract còn finding bắt buộc. Không seed/build/deploy/merge hoặc tiếp M00.
Đầu ra: preflight nguồn/SHA; findings; dependency mới và compatibility; file list implementation dự kiến; mapping test acceptance; kết luận đủ/chưa đủ code backend.
Implementation sẽ tách backend PR Draft sau review thiết kế đạt; UI integration là task riêng. Không lấy #31 làm frontend mặc định, không mở task tạo ADMIN/dashboard/recovery trong gói đăng nhập.
Owner local/device còn chờ M00; CI không đóng module.
