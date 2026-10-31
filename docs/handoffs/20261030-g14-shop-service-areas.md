# Nhóm 14 — Ghim quán, điều kiện công khai và quản lý vùng

## Trạng thái
PR giao việc theo yêu cầu Owner ngày 30/10/2026: gom issue cùng nghiệp vụ để triển khai một đợt. **Đã triển khai code #252 + #253 (Claude local, 31/10/2026); xem mục "Đã làm / quyết định kỹ thuật" cuối tài liệu.** Không merge/deploy/đóng issue khi chưa có Owner duyệt. Claude local là lead mặc định; chuyển executor chỉ khi Owner giao, một người làm mỗi PR.

## Issue nguồn và kết quả
- https://github.com/trungtn87/11ship/issues/252
- https://github.com/trungtn87/11ship/issues/253

Quán được ghim không cần GPS tại chỗ; kiểm pin theo geometry cấu hình; đồng bộ setup/public; bổ sung quản lý vùng Admin. Không đổi snapshot đơn cũ.

Đọc toàn bộ issue nguồn mới nhất và comment trước code; mọi acceptance trong issue vẫn áp dụng. Việc gom nhóm thay chỉ dẫn cũ “PR riêng từng issue”, không thay quyết định nghiệp vụ.

## Phụ thuộc và ranh giới
Làm #252 và #253 trong cùng PR; kiểm tương thích vùng cũ chưa geometry trước bật guard. Không tự đặt radius mới.

Base lúc lập nhóm: main@04471c94e2389474eed5a0fd0dd1c6d8257503b4. Trước triển khai cập nhật main, đọc AGENTS.md, CLAUDE.md, docs/ai-governance/README.md, hợp đồng executor, checklist và docs/process/11ship-delivery-workflow.md. Preflight/postflight trong worktree thực, ghi HEAD và sync state. Tại lúc lập tài liệu: LOCAL_UNVERIFIED, không kiểm tra hay thay đổi Windows local.

Dùng đúng nhánh/PR này khi triển khai; không tạo PR mới cho từng issue con. Đối chiếu PR mở và file dự kiến sửa; file chung thì xếp thứ tự, không sửa cạnh tranh. Nhóm có dependency chỉ bắt đầu phần phụ thuộc sau khi predecessor merge; phần độc lập có thể chuẩn bị trước. Không cherry-pick toàn PR tiền nhiệm, không viết lại tính năng đã merge.

## Kiểm chứng
Pin trong/ngoài/sai vùng, ranh giới, thiếu geometry; ADMIN request-info sau kích hoạt; quyền quản lý vùng và snapshot đơn cũ.

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

## Đã làm / quyết định kỹ thuật (31/10/2026)
**#252** — `assertPinInArea` (ServiceAreaRepository.lockShared giờ trả cả hình tròn) chạy khi lưu nháp, hoàn tất hồ sơ và sửa hồ sơ quán: ghim ngoài vòng/vùng B nhưng chọn vùng A → `400 PICKUP_OUTSIDE_SERVICE_AREA`, không lưu, không đổi vùng. Công thức khoảng cách dùng chung với `resolve` (haversine); bản SQL (`pinInAreaSql`) dùng cho đọc công khai.
- **Vùng ACTIVE chưa có geometry**: giữ hành vi cũ (chấp nhận ghim, vẫn công khai theo các điều kiện khác), KHÔNG coi là đã xác thực và Admin hiển thị "Chưa cấu hình GPS". Không phát minh bán kính. *Đây là chính sách tương thích do Claude chọn để không vô hiệu hàng loạt quán cũ — ChatGPT/Owner xác nhận hoặc yêu cầu chặt hơn.*
- **Công khai nhất quán**: bước LOCATION chỉ đạt khi có ghim VÀ ghim nằm trong vòng (mã thiếu mới `PICKUP_OUTSIDE_AREA`; availability dùng lại `NO_PICKUP_POINT`). Áp dụng cho snapshot/ShopSetupGate (detail, menu, logo, route, preview/đặt đơn), ShopDiscoveryReader (list/search/dishes), đếm online và danh sách Admin. Ghim bị lọt ra ngoài do SYSTEM đổi vòng → quán ẩn, NEEDS_REVIEW, trở lại khi chủ quán ghim lại hoặc vòng được trả, không phát `shop.activated` lần hai.
- **M02-ADMIN-REQUEST-01**: `ShopActivation.reconcile` với quán đã từng kích hoạt: khi đủ 4/4, không khóa và còn `setup_request_note` thì xóa yêu cầu, ghi audit `shop.setup_request_auto_cleared.v1` (SYSTEM) + outbox `shop.setup_request_cleared.v1`; không đụng `activated_at`, không `shop.activated`. `request-info` đã chỉ cho phép khi chưa đủ 4/4 nên mọi yêu cầu tồn tại đều là loại "thiếu setup" (không có yêu cầu kiểm tra thủ công ngoài 4 điều kiện).
- **Snapshot đơn cũ**: giao hàng lưu pickup riêng (`app.deliveries.pickup_lat/lng`, trigger bất biến); sửa ghim/địa chỉ quán không chạm vào đó (test).
- Flutter 11Food: nhãn "Chọn vị trí lấy hàng trên bản đồ", hiện "Ghim đã chọn: lat, lng" trước khi lưu, lỗi vùng hiện ngay dưới bộ chọn, giữ dữ liệu đã nhập; GPS chỉ là tùy chọn.

**#253** — `/v1/admin/service-areas` (danh sách, chi tiết, `GET :id/impact`, `POST` tạo/sửa/`:id/status`): SYSTEM ghi, mọi ADMIN đọc (không dùng `can_manage_shops`/`can_lock`); CSRF + session, `expected_version`, `Idempotency-Key`, audit có lý do, outbox. Không có thao tác xóa. Tạo mới luôn INACTIVE, không geometry mặc định; vòng phủ không thể bị xóa (chỉ thay). Tắt vùng hoặc đổi vòng làm quán công khai rơi ra ngoài phải xác nhận (`confirm_impact`, server đếm lại dưới khóa → `409 SERVICE_AREA_IMPACT_CONFIRM_REQUIRED`). Admin Web: `/system/zones`, `/system/zones/:id` (menu Hệ thống → Vùng hoạt động).
- **Giới hạn bản đồ**: CSP của Admin Web là `img-src 'self'`, không có tile bản đồ nào sẵn có và không mở rộng CSP; trang dùng nhập tọa độ WGS84 + bán kính + hình phác SVG (`circleSketch`), không gọi bên thứ ba, không URL ngoài (Owner đã chốt 31/10/2026).
