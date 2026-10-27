# Nhóm 3 — Thanh toán quán, cấp quyền thủ công và chat tài chính

## Trạng thái và người thực hiện
Đã tiếp tục implementation trên đúng nhánh theo Owner ngày 26/10/2026. Kết quả và giới hạn tại `docs/current/G03-shop-finance-chat-20261026.md`; required CI trên SHA mới còn chờ. Không merge PR chỉ có tài liệu giao việc; AI triển khai tiếp tục đúng nhánh/PR này, bổ sung code và thay mô tả bằng kết quả thực tế.

Chủ trì: Codex.

## Issue nguồn
- https://github.com/trungtn87/11ship/issues/198
- https://github.com/trungtn87/11ship/issues/199
Đọc đầy đủ nội dung issue mới nhất, đặc biệt quyết định bổ sung của Owner; không dùng bản thiết kế cũ đã bị thay thế. Đây là bàn giao nhóm được Owner yêu cầu, thay yêu cầu PR riêng từng issue trước đó.

## Kết quả cần đạt
Hoàn thiện phần còn thiếu trên Business Dashboard hiện có: báo chuyển khoản / xác nhận thực nhận / cấp hoặc thu hồi quyền là các bước độc lập, không liên kết payment ID với entitlement; quota 20 món theo chính sách cấu hình; chat đúng quyền xem/gửi, 500 ký tự, sự kiện thật và đóng phòng đúng lifecycle. Không thuê bao, không ví quán, không hardcode 29k, không tự mở quyền. Chưa chốt mức thu hoặc retention thì không bật thu phí/purge. Tận dụng nền finance hiện hữu, không tạo hệ thống song song.

## Điều kiện bắt đầu
Nhóm 2: https://github.com/trungtn87/11ship/pull/224
Chỉ bắt đầu sửa code khi các nhóm tiền nhiệm đã merge; cập nhật nhánh từ main mới nhất, không cherry-pick toàn bộ PR tiền nhiệm.
Nhánh khởi tạo từ main bc730434a8e4dd35747713d7ece3e70f6c4eb411. Phụ thuộc là thứ tự triển khai, không phải các nhóm đã hoàn tất.

## Ranh giới tránh chồng
Một AI chủ trì trên nhánh/PR này. Chỉ sửa phần cần cho issue nguồn; không triển khai issue nhóm khác. Component/API đã có phải tái sử dụng. Trước code, ghi file dự kiến thay đổi và đối chiếu PR đang làm; nếu trùng file với nhóm khác thì chờ nhóm đó merge, không sửa cạnh tranh hoặc tự refactor shell/module dùng chung. Migration có số mới duy nhất và không sửa migration đã chạy.

## Điểm vào để đối chiếu
- `apps/backend/src/business-dashboard/finance-service.ts`
- `apps/backend/src/business-dashboard/finance-repository.ts`
- `mobile/packages/n11_shared/lib/src/finance/`
- `apps/backend/src/menu/`
- `apps/admin-web/src/`
Các thư mục rộng là phạm vi tìm kiếm, không phải quyền sửa toàn bộ; dùng rg xác định file sở hữu thật trên main mới nhất.

## Công việc cũ #198/#199
Owner cho biết nhánh Codex #198 mới được tạo, coi như chưa triển khai. Chưa thấy nhánh Codex #198 từ danh sách nhánh GitHub đã tìm. Có nhánh Claude lịch sử `claude/issues-198-199-payment-8o9wmy` @ 45cc4094e3cede6c8ccaf512abb5ad637b1fe214, ahead 1/behind 24 so với main lúc bàn giao. Giữ nguyên nhánh đó; chỉ tham khảo delta còn phù hợp sau đối chiếu, không merge/cherry-pick nguyên gói cũ vì main đã có nền Business Dashboard. Tiếp tục công việc nhóm mới tại PR này, tránh triển khai trùng.

## Kiểm chứng cần thiết
Khác chủ/thiếu hoặc thu hồi quyền; xác nhận ngân hàng trùng và đồng thời; retry cấp quyền; quota ẩn/hiện đồng thời; gửi-vs-đóng chat; báo nộp không ghi tiền/cấp quyền; xác nhận tiền không tự cấp quyền.
Chạy focused tests phù hợp thay đổi và required CI trên code cuối. Không chạy lặp toàn repo nếu không có rủi ro liên quan. Tài liệu giao việc hiện tại chỉ cần review phạm vi/link/tính nhất quán, không chứng minh hành vi sản phẩm.

## Checklist bàn giao thực thi
- [ ] Đã đọc AGENTS.md, CLAUDE.md và docs/process/11ship-delivery-workflow.md; kiểm tra main và nhánh liên quan.
- [ ] Các nhóm tiền nhiệm đã merge, branch đã cập nhật; file sửa không chồng việc đang chạy.
- [ ] Đủ backend/mobile/Admin và kết nối thật trong phạm vi bị ảnh hưởng.
- [ ] Có bằng chứng kiểm tra tương xứng, required CI phù hợp và cách Owner thử; UI có bằng chứng Android khi cần.
- [ ] Báo code SHA, thay đổi, kiểm tra, blocker và giới hạn thực tế; không coi CI xanh là nghiệm thu thiết bị.
- [ ] Chỉ đổi sang Ready khi có implementation và bằng chứng; không tự merge/deploy hoặc đóng issue khi mới có bản giao việc.

Không có thay đổi code sản phẩm tại thời điểm tạo PR. Các điều kiện nghiệp vụ chưa chốt phải báo cụ thể, tiếp tục phần độc lập không bị chặn.

## Phạm vi thực thi 26/10
PR #224 đã merge. Đã cập nhật main, giữ nhánh Claude cũ làm nguồn tham khảo. Sửa các file finance-service/repository/validation/controller/push của Business Dashboard, finance-access constants/participant, menu-service/repository/module, đăng ký DI tại admin-auth.module; Admin business-view/business-api và danh sách quyền; mobile finance_views và quota menu; migration mới 1796860800000, runtime grants/manifest và tests phụ thuộc. Không sửa shell/router, token UI hay luồng đơn/vận chuyển của các nhóm 4–12. Các PR nhóm sau hiện là bàn giao, chưa có implementation chồng phạm vi.

M08: chỉ bổ sung case mở FINANCE_REQUEST trong food_tabs/ship_tabs, không đổi shell/bố cục. Đã nối M08 qua BusinessFinanceRepository, giữ chủ sở hữu SQL hiện tại.
