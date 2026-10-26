# Nhóm 2 — Thông tin quán và mô tả món

## Trạng thái và người thực hiện
PR nháp giao việc theo yêu cầu Owner ngày 26/10/2026. Hiện chỉ có tài liệu phạm vi, chưa triển khai tính năng, chưa có bằng chứng kiểm thử sản phẩm. Không merge PR chỉ có tài liệu giao việc; AI triển khai tiếp tục đúng nhánh/PR này, bổ sung code và thay mô tả bằng kết quả thực tế.

Chủ trì: Claude (mặc định theo AGENTS.md; chỉ chuyển người khi Owner giao rõ).

## Issue nguồn
- https://github.com/trungtn87/11ship/issues/204
- https://github.com/trungtn87/11ship/issues/207
Đọc đầy đủ nội dung issue mới nhất, đặc biệt quyết định bổ sung của Owner; không dùng bản thiết kế cũ đã bị thay thế. Đây là bàn giao nhóm được Owner yêu cầu, thay yêu cầu PR riêng từng issue trước đó.

## Kết quả cần đạt
Tự cập nhật trạng thái mở/đóng theo giờ thực và chặn đặt đơn đúng thời điểm; mô tả món tùy chọn tối đa 300 ký tự, tạo/sửa/hiển thị nhất quán.

## Điều kiện bắt đầu
Nhóm 1: https://github.com/trungtn87/11ship/pull/208
Chỉ bắt đầu sửa code khi các nhóm tiền nhiệm đã merge; cập nhật nhánh từ main mới nhất, không cherry-pick toàn bộ PR tiền nhiệm.
Nhánh khởi tạo từ main bc730434a8e4dd35747713d7ece3e70f6c4eb411. Phụ thuộc là thứ tự triển khai, không phải các nhóm đã hoàn tất.

## Ranh giới tránh chồng
Một AI chủ trì trên nhánh/PR này. Chỉ sửa phần cần cho issue nguồn; không triển khai issue nhóm khác. Component/API đã có phải tái sử dụng. Trước code, ghi file dự kiến thay đổi và đối chiếu PR đang làm; nếu trùng file với nhóm khác thì chờ nhóm đó merge, không sửa cạnh tranh hoặc tự refactor shell/module dùng chung. Migration có số mới duy nhất và không sửa migration đã chạy.

## Điểm vào để đối chiếu
- `apps/backend/src/shop/`
- `apps/backend/src/menu/`
- `mobile/packages/n11_shared/lib/src/m02/`
Các thư mục rộng là phạm vi tìm kiếm, không phải quyền sửa toàn bộ; dùng rg xác định file sở hữu thật trên main mới nhất.

## Kiểm chứng cần thiết
Qua mốc đóng/mở cửa khi app đang mở; đặt đơn tại ranh giới giờ; lưu/hiển thị mô tả rỗng, Unicode, giới hạn 300 ký tự.
Chạy focused tests phù hợp thay đổi và required CI trên code cuối. Không chạy lặp toàn repo nếu không có rủi ro liên quan. Tài liệu giao việc hiện tại chỉ cần review phạm vi/link/tính nhất quán, không chứng minh hành vi sản phẩm.

## Checklist bàn giao thực thi
- [ ] Đã đọc AGENTS.md, CLAUDE.md và docs/process/11ship-delivery-workflow.md; kiểm tra main và nhánh liên quan.
- [ ] Các nhóm tiền nhiệm đã merge, branch đã cập nhật; file sửa không chồng việc đang chạy.
- [ ] Đủ backend/mobile/Admin và kết nối thật trong phạm vi bị ảnh hưởng.
- [ ] Có bằng chứng kiểm tra tương xứng, required CI phù hợp và cách Owner thử; UI có bằng chứng Android khi cần.
- [ ] Báo code SHA, thay đổi, kiểm tra, blocker và giới hạn thực tế; không coi CI xanh là nghiệm thu thiết bị.
- [ ] Chỉ đổi sang Ready khi có implementation và bằng chứng; không tự merge/deploy hoặc đóng issue khi mới có bản giao việc.

Không có thay đổi code sản phẩm tại thời điểm tạo PR. Các điều kiện nghiệp vụ chưa chốt phải báo cụ thể, tiếp tục phần độc lập không bị chặn.
