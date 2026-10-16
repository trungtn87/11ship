# 11Ship — M04 UI V1 (OWNER APPROVED)

- Ngày duyệt: 15/10/2026 (Asia/Bangkok, cùng giờ Việt Nam).
- Trạng thái: **UI APPROVED / UI LOCKED FOR REFERENCE**.
- Người duyệt: Owner (xác nhận trong cuộc trao đổi thiết kế M04).
- Loại: **Thiết kế tham khảo được duyệt**, không phải implementation, không phải bằng chứng chạy sản phẩm.
- Phạm vi: **App Shipper** và **Admin Web — Tài chính**.
- Không bao gồm: code/API/database/migration/deploy. Không cho Claude hoặc Codex tự code khi chỉ nhận nhiệm vụ UI; muốn triển khai cần task riêng quy định đúng scope.
- Từ ngữ UI thống nhất: **Shipper**, không dùng "xế" trong nhãn giao diện mới.

## 1. Cơ sở chốt

Owner đã duyệt bản tham khảo hình ảnh M04 gồm hai bộ bố cục, ngày 15/10/2026:
1. **App Shipper**: Ví của tôi, nạp tiền, xác nhận đã chuyển, rút tiền, chi tiết yêu cầu rút, lịch sử giao dịch.
2. **Admin Web**: tổng quan tài chính, danh sách ví, danh sách/yêu cầu nạp, chi tiết xác nhận nạp, danh sách/xử lý rút, giao dịch/đối soát, cấu hình tham số trong admin.

Bản hình ảnh là mockup tham khảo (dữ liệu, mã giao dịch, tài khoản ngân hàng, số liệu ví, logo ngân hàng, biển số/chứng từ minh họa là giả). Không dùng những giá trị đó làm dữ liệu production. Khi implementation phải lấy lại logo/brand assets chính thức từ docs/brand/README.md; không dùng giả logo hoặc màu ngoài brand làm chuẩn mới.

**Vị trí ảnh được Owner duyệt:** hai ảnh ở cuộc trò chuyện "Thiết kế ui tham khảo cho m04" ngày 15/10/2026. Bản đóng gói để bàn giao được cung cấp kèm trong cuộc trò chuyện "Ok duyệt. Lưu vào dự án đi". Tài liệu GitHub này là bản chốt chức năng/màn hình; bản ảnh chat/ZIP là tài liệu hình trực quan. Chưa tuyên bố 2 file ảnh đã có trong repository.

## 2. Nguyên tắc giao diện chung

- Bám nhận diện 11Ship: nền sáng, các bề mặt trắng, nút chính vàng, chữ xám than/đen, trạng thái rõ; đơn giản, thẻ bo góc và khoảng trắng hợp lý.
- Ưu tiên điện thoại Android; kích thước phù hợp màn hình thực, không tràn ngang. Web admin ưu tiên bảng và sidebar desktop.
- Tiền: VND nguyên, định dạng nhóm nghìn theo Việt Nam (ví dụ 100.000đ).
- Trên App Shipper không hiển thị phân loại Shipper hệ thống/ngoài và không có chức năng cấu hình hệ thống.
- Tham số cấu hình chỉ có **Admin Web**. Không đưa vào giao diện mobile.
- Tình huống đang tải/trống/mất mạng/lỗi xác minh/không đủ số dư phải có thông báo rõ; không mô phỏng trạng thái thành công khi API chưa hoàn tất.
- Số dư ví và trạng thái giao dịch là dữ liệu thật từ backend; không suy ra từ animation hoặc local cache.
- Dữ liệu/hình ảnh mockup được phép tinh chỉnh chính tả, bố cục responsive và thay placeholder theo dữ liệu thật, nhưng **không được thay đổi luồng và cấu trúc UI đã duyệt** nếu không được Owner đồng ý.

## 3. App Shipper — catalog đã chốt

| Mã UI | Màn | Thành phần chính | Thao tác |
| --- | --- | --- | --- |
| M04-S01 | Ví của tôi | Số dư khả dụng nổi bật; tổng số dư; tiền tạm giữ; 2 nút Nạp/Rút; giao dịch gần đây | Sang nạp, rút, chi tiết giao dịch, xem tất cả |
| M04-S02 | Nạp tiền: nhập số tiền | Ô số tiền; ghi chú mức tối thiểu; thông tin nhận tiền của hệ thống, số TK, tên chủ TK, nội dung, QR; nút sao chép | Tiếp tục/đã chuyển |
| M04-S03 | Nạp tiền: xác nhận | Tổng tiền yêu cầu; ảnh chuyển khoản tùy chọn; thông báo tiền chỉ cộng khi Admin xác minh | Gửi yêu cầu |
| M04-S04 | Chi tiết yêu cầu nạp | Mã, số tiền, thời gian, trạng thái; chờ xác nhận/đã xác nhận/từ chối/đã hủy; thông báo thời gian | Xem tiến trình, hủy khi cho phép |
| M04-S05 | Rút tiền | Số dư khả dụng; ô số tiền; tối thiểu rút; tài khoản ngân hàng đã xác minh; nút yêu cầu | Gửi yêu cầu rút |
| M04-S06 | Chi tiết yêu cầu rút | Mã, tiền, tài khoản nhận che bớt, trạng thái và tiến trình, nút hủy chỉ khi còn PENDING | Theo dõi/hủy khi hợp lệ |
| M04-S07 | Lịch sử giao dịch | Bộ lọc Tất cả/Nạp/Rút/Hoa hồng/Tạm giữ; danh sách có thời gian, số tiền, trạng thái | Xem giao dịch và liên kết đơn nếu có |

- Trạng thái rút nên trình bày nhãn tiếng Việt thân thiện: Chờ xử lý / Đang xử lý / Cần đối soát / Hoàn thành / Đã hủy; không giấu nhánh cần đối soát.
- Trạng thái nạp: Chờ xác nhận / Thành công / Từ chối / Đã hủy.
- Tiền đang giữ là thông tin hold, **không phải khoản trừ ledger**. Giải phóng hold không được ngụy tạo như giao dịch nạp +tiền. Đây là quy tắc hiển thị tài chính phải đúng dù ảnh mockup diễn giải đơn giản.
- Điều hướng phải kế thừa app 11Ship hiện có. Nếu tab Ví chưa xuất hiện trong điều hướng chính đã chốt, chỉ thêm theo task UI rõ ràng; không làm đổi bất ngờ các tab của M01/M03.

## 4. Admin Web — catalog đã chốt

| Mã UI | Màn | Thành phần chính |
| --- | --- | --- |
| M04-A01 | Tổng quan tài chính | Thẻ KPI tổng số dư, tiền giữ, yêu cầu nạp/rút chờ, hoa hồng đã thu; lọc thời gian và biểu đồ |
| M04-A02 | Danh sách ví Shipper | Tìm theo tên/SĐT/mã; bảng tổng số dư, tạm giữ, khả dụng, trạng thái; mở chi tiết ví |
| M04-A03 | Danh sách yêu cầu nạp | Tab Chờ xác nhận/Đã xử lý/Tất cả; bảng theo Shipper, số tiền, thời điểm, trạng thái |
| M04-A04 | Chi tiết nạp tiền | Thông tin yêu cầu và ảnh đính kèm; khối xác minh số tiền ngân hàng thực nhận và mã giao dịch chuẩn; xác nhận/từ chối theo quyền |
| M04-A05 | Danh sách, chi tiết rút | Bộ lọc chờ/đang xử lý/đã hoàn thành/cần đối soát; snapshot tài khoản nhận; các bước nhận xử lý, xác nhận đã chuyển, đối soát |
| M04-A06 | Lịch sử & đối soát | Lọc ngày, Shipper, loại tiền, trạng thái; bảng ledger/hold, so tổng số dư, chỉ ra chênh lệch; export theo quyền |
| M04-A07 | Cài đặt tham số ví | Nạp tối thiểu, rút tối thiểu, hoa hồng mỗi đơn; chỉ Admin Web, có quyền thao tác và log thay đổi |

Sidebar nhóm Tài chính: Tổng quan / Ví Shipper / Nạp tiền / Rút tiền / Giao dịch / Đối soát. Phần **tham số** nằm trong **Cài đặt → Tham số hệ thống → Ví Shipper**, không nằm trên App Shipper.

## 5. Các quy tắc nghiệp vụ mà UI phải tuân thủ

- Mỗi Shipper một ví; tổng số dư B, tiền giữ H, khả dụng A=B-H.
- Mức mặc định theo quyết định Owner gần nhất: nạp tối thiểu **100.000đ/lần**; rút tối thiểu **10.000đ/lần**; hoa hồng **1.000đ/đơn giao thành công**; đều cấu hình trong Admin Web cho giao dịch mới.
- Chỉ Admin được ghi nhận tiền nạp thực nhận sau đối soát giao dịch ngân hàng; nút "Tôi đã chuyển tiền" không trực tiếp cộng ví.
- Shipper **được tạo yêu cầu nạp và rút trên ứng dụng**; Admin xử lý nạp/rút qua Web. Đây là scope UI Owner duyệt ngày 15/10. Tài liệu ADR-004 draft 07/10 trước đây nêu withdrawal create bởi Admin: cần đồng bộ lại API/authorization spec với UI đã chốt trước khi code. Không tự code theo bản draft mâu thuẫn.
- Tạm giữ hoa hồng khi nhận đơn; capture/debit khi completed; release khi hủy/thất bại. Mỗi assignment đúng một lần.
- Khi rút, reserve ngay; chỉ PAID mới capture/debit. Chưa biết kết quả chuyển khoản thì giữ hold, không chuyển lại hoặc giải phóng tự động.
- Shipper SUSPENDED/CLOSING vẫn có quyền yêu cầu rút tiền theo quy định; người dùng không truy cập được cần có kênh xử lý qua Admin xác minh.
- Đổi ngân hàng sau khi tạo yêu cầu không được âm thầm đổi đích đã chốt của yêu cầu đang xử lý.
- Không xóa ledger/giao dịch đã post, không sửa thẳng balance; sai lệch phải có quy trình adjustment có quyền và lý do.
- M03 sở hữu hồ sơ/kích hoạt/tài khoản ngân hàng; M04 sở hữu ví, hold, ledger, nạp/rút; M07 sau này tích hợp luồng đơn.
- Tham khảo contract an toàn: docs/current/ADR-004-driver-wallet-consistency.md trong PR #7 (DRAFT, không tự coi là đã merge/Owner lock).

## 6. Tiêu chí triển khai giao diện sau này

1. Triển khai **UI only** khi giao task UI; dùng mock data gắn nhãn rõ trong bản preview, không viết CRUD, API, migration, nghiệp vụ tiền, không sửa role/OTP/M03/M07.
2. So sánh trực quan với ảnh tham khảo đã duyệt và catalog trên từng màn hình; test kích thước Android và desktop.
3. Nếu một chức năng chưa nối backend, hiển thị disabled/có giải thích; không bịa giao dịch thành công hoặc số dư.
4. Sau Owner nghiệm thu UI mới mở task code tích hợp riêng theo module/slice, có acceptance test tiền và permission.
5. Không merge code UI cùng với nghiệp vụ ngoài phạm vi khi chưa có chỉ đạo.

## 7. Hồ sơ thay đổi

- 15/10/2026: Owner xác nhận "Ok duyệt. Lưu vào dự án đi". Chốt **UI tham khảo M04 V1**; không đồng nghĩa duyệt triển khai backend/code/merge sản phẩm.
