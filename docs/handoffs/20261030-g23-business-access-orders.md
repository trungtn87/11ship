# Nhóm 23 — Mini Business: truy cập các tab và xử lý ngoại lệ đơn

## Trạng thái
PR nháp giao việc theo yêu cầu Owner ngày 30/10/2026: gom issue cùng nghiệp vụ để triển khai một đợt. **Chỉ có tài liệu phạm vi, chưa triển khai sản phẩm. Không merge PR chỉ có tài liệu này.** Claude local là lead mặc định; chuyển executor chỉ khi Owner giao, một người làm mỗi PR.

## Issue nguồn và kết quả
- https://github.com/trungtn87/11ship/issues/237
- https://github.com/trungtn87/11ship/issues/236

ADMIN đủ grant đọc được các tab; thiếu quyền hiển thị đúng phạm vi; đưa thao tác ngoại lệ sẵn có vào chi tiết đơn qua server can.

Đọc toàn bộ issue nguồn mới nhất và comment trước code; mọi acceptance trong issue vẫn áp dụng. Việc gom nhóm thay chỉ dẫn cũ “PR riêng từng issue”, không thay quyết định nghiệp vụ.

## Phụ thuộc và ranh giới
Sau nhóm 19 và 22 khi chạm báo cáo/projection; giữ auth/reset thuộc nhóm 13. Đối chiếu SHA/cache/quyền thực trước kết luận lỗi.

Base lúc lập nhóm: main@04471c94e2389474eed5a0fd0dd1c6d8257503b4. Trước triển khai cập nhật main, đọc AGENTS.md, CLAUDE.md, docs/ai-governance/README.md, hợp đồng executor, checklist và docs/process/11ship-delivery-workflow.md. Preflight/postflight trong worktree thực, ghi HEAD và sync state. Tại lúc lập tài liệu: LOCAL_UNVERIFIED, không kiểm tra hay thay đổi Windows local.

Dùng đúng nhánh/PR này khi triển khai; không tạo PR mới cho từng issue con. Đối chiếu PR mở và file dự kiến sửa; file chung thì xếp thứ tự, không sửa cạnh tranh. Nhóm có dependency chỉ bắt đầu phần phụ thuộc sau khi predecessor merge; phần độc lập có thể chuẩn bị trước. Không cherry-pick toàn PR tiền nhiệm, không viết lại tính năng đã merge.

## Kiểm chứng
SYSTEM/ADMIN đủ/thiếu/thu hồi grant, 401/403/500/offline; PWA; cancel/close đúng quyền và trước pickup, CSRF/idempotency/version.

Gom sửa đủ các issue trong nhóm rồi chạy focused tests cho phần tác động và CI bắt buộc trên code cuối. Tận dụng evidence còn hiệu lực, không chạy full repo lặp sau từng lỗi hoặc từng issue. Khi có lỗi chỉ kiểm lại ca lỗi và hồi quy liên quan, trừ required CI/tác động dùng chung cần rộng hơn.

## Quy tắc kiểm soát phạm vi
- Lỗi thuộc acceptance hoặc do thay đổi của PR: sửa trong chính PR trước bàn giao.
- Lỗi ngoài phạm vi: kiểm issue trùng, tạo issue ghi bằng chứng và gán vào nhóm nghiệp vụ phù hợp; **không kéo thêm vào PR đang làm**. Rủi ro làm thay đổi hiện tại không thể an toàn thì nêu blocker cụ thể.
- Không tự phát minh phí, ngưỡng, trạng thái, quyền, TTL hay thay quyết định Owner. Chỉ phần cần quyết định mới đánh BLOCKED, tiếp tục phần độc lập.
- Không đóng issue vì đã có PR, không dùng “Closes” tự động. Owner quyết định merge, deploy, migration production, phát hành APK và đóng issue.

## Bàn giao
- [ ] Có code backend/API/UI/DB cần thiết trong phạm vi, không chỉ tài liệu.
- [ ] Acceptance issue nguồn có DONE / TO DO / BLOCKED / NOT TESTED và bằng chứng tương xứng.
- [ ] Report remote HEAD, sync status, focused test/CI link và cách Owner thử; UI Android/PWA ghi rõ bằng chứng thật và giới hạn.
- [ ] Chỉ Ready khi code và evidence đủ; không tự merge/deploy/APK.
