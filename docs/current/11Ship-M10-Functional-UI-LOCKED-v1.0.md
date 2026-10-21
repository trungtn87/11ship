# 11Ship — M10: Đặt món và đơn hàng quán

> Bổ sung Owner 21/10/2026: [Thời hạn ba giai đoạn, SYSTEM tự hủy, audit và cài đặt Admin](M10-timeouts-20261021.md) (#153) thay thế các mô tả timeout cũ xung đột.

Phiên bản 1.0 · Ngày 16/10/2026 · Giờ Việt Nam.

**Chức năng: OWNER_APPROVED. UI: OWNER_APPROVED / DESIGN_LOCKED. Triển khai: IMPLEMENTATION_PENDING.**

Owner chốt chức năng bằng “Ok chốt. Thiết kế ui tham khảo”, sau đó duyệt ba bảng UI bằng “Duyệt.lưu dự án đi” ngày 16/10/2026. Các điểm đề xuất trong bản chức năng trước đó đã được chấp thuận theo lần chốt này.

## 1. Phạm vi và phụ thuộc

M10 sở hữu chọn món, giỏ hàng, Order, quán xử lý đơn, đơn hẹn, lịch sử và đặt lại. M09 đã gộp vào M02; không đánh lại số module.

| Module | Trách nhiệm |
|---|---|
| M02 | Quán, giờ hoạt động, thực đơn, khám phá/tìm quán và món |
| M05 | Hồ sơ khách, sổ địa chỉ |
| M06 | Phí ship và điều kiện giao |
| M07 | Delivery, tìm/nhận/giao, xử lý hàng và giao thất bại |
| M08 | Thông báo, nhắc và đồng bộ sự kiện |
| M14 | GPS, bản đồ, tuyến |
| M04 | Ví và hoa hồng shipper, không tiền hàng của khách |

Khách/chủ quán chỉ dùng app 11Food; shipper dùng app 11Ship; quản trị dùng Admin Web. Không tạo web Food/Ship. M10 không làm lại luồng giao của M07, không tạo Order giả cho đơn quán gọi giao trực tiếp.

## 2. Chọn món và giỏ hàng

Bổ sung nút + và số lượng vào thực đơn M02. Chạm món chọn số lượng và ghi chú món. Giỏ hiển thị tên, giá, số lượng, thành tiền; tăng/giảm/xóa; ghi chú chung.

- Cùng món và cùng ghi chú được gộp; khác ghi chú tách dòng.
- Một giỏ thuộc một quán. Thêm món quán khác phải xác nhận trước khi thay giỏ.
- Giữ giỏ khi thoát app; không coi giá/khả dụng trong giỏ là giá đã chốt.
- Chưa có topping, size, combo, tùy chọn cộng tiền, khuyến mãi, voucher, ví khách hay thanh toán online.

## 3. Xác nhận đặt món

Hiển thị quán, món/số lượng/ghi chú, tiền món; người nhận tên/SĐT bắt buộc (có thể khác người đặt); địa chỉ chọn từ M05 hoặc nhập mới; ghim giao có thể chưa có và nối M07 xác nhận sau; giao sớm nhất/hẹn giờ; ghi chú chung; phí dự tính nếu có; thanh toán trực tiếp.

Tiền món và phí ship tách riêng. Chưa xác định phí phải ghi rõ, không hiển thị 0đ, không trình bày tổng như đã đủ tất cả chi phí.

Máy chủ kiểm quán hợp lệ/quyền bán, món đang hiện/chưa xóa, giá hiện tại, lịch hoạt động/giờ hẹn, người nhận và địa chỉ trước khi tạo. Giá đổi/món ẩn hoặc xóa: thông báo thay đổi để khách kiểm tra và gửi lại; không tự đổi rồi gửi ngầm.

## 4. Gửi và chờ xác nhận

Server tạo thành công mới hiện mã và “Chờ quán xác nhận”. M08 báo quán. Khách được hủy trước xác nhận. Quán xem/chỉnh/xác nhận/từ chối. Chưa gọi shipper khi chưa xác nhận.

Mất mạng sau gửi: kiểm kết quả thao tác trước khi gửi lại; retry cùng thao tác không tạo hai Order. Trạng thái chưa biết không được báo thành công hoặc thất bại chắc chắn.

## 5. Quán xác nhận

Chi tiết có người đặt/người nhận, giao hàng, món, tiền ban đầu, thời gian và các chỉnh sửa. Trước xác nhận quán được sửa số lượng, đơn giá hoặc bỏ món.

- Thay đổi nội dung hoặc tăng tiền: quán liên hệ khách thống nhất trước.
- Khi xác nhận đơn có thay đổi, bắt buộc ghi lý do; khách thấy bản ban đầu và bản chốt, nhận thông báo.
- Không thêm vòng duyệt giá riêng trên app bản đầu.
- Không xác nhận đơn rỗng.
- Xác nhận xong khóa món và tiền món trong bản đầu.
- Từ chối phải có lý do và báo khách.

## 6. Chuẩn bị và gọi shipper

Xác nhận chuyển “Đang chuẩn bị”. Hai thao tác độc lập: “Món đã sẵn sàng” ghi nhận chuẩn bị xong; “Gọi shipper” tạo delivery M07. Cho gọi khi đang chuẩn bị, không ép bấm sẵn sàng trước.

Chuyển snapshot quán/điểm lấy, người nhận/địa chỉ/ghim nếu có, món/ghi chú đã chốt, tiền hàng, tiền hàng đã thanh toán, bên trả phí và ghi chú giao sang M07. Một Order tối đa một delivery hoạt động; gọi lại tạo delivery mới, giữ Order và lịch sử các lần giao.

M07 kiểm soát phí, pickup, quyền xem liên hệ/tracking, thời hạn tìm, giữ/trừ/giải phóng hoa hồng. Không thêm nút gọi điện thay cho lệnh tạo yêu cầu giao; icon trong ảnh chỉ minh họa.

## 7. Đơn hẹn

Giờ hẹn là **giờ mong muốn nhận món**; thời gian thực tế phụ thuộc chuẩn bị và tìm shipper. Khách chọn ngày/giờ phù hợp lịch quán, gồm ca qua đêm/24 giờ. Quán thấy nhãn Đơn hẹn và ngày/giờ, xác nhận trước, chủ động chuẩn bị và gọi shipper.

M08 nhắc trước giờ hẹn theo tham số cấu hình; chưa tự gọi shipper theo đồng hồ. Quán đổi lịch sau khi nhận đơn: giữ đơn, cảnh báo quán xử lý, không tự hủy.

## 8. Trạng thái

Lưu trạng thái Order và delivery riêng; UI tổng hợp theo trạng thái server.

| Tình huống | Nhãn khách |
|---|---|
| Vừa gửi | Chờ quán xác nhận |
| Quán nhận | Quán đang chuẩn bị |
| Gọi giao | Đang tìm shipper |
| Có shipper | Shipper đang đến quán |
| Chuẩn bị xong chưa lấy | Món đã sẵn sàng — chờ lấy |
| Đã lấy | Đang giao |
| Giao thành công | Hoàn thành |
| Hết hạn tìm | Chưa tìm được shipper — quán đang xử lý |
| Giao thất bại | Giao thất bại — đang xử lý |
| Hủy/từ chối món | Đã hủy / Quán từ chối |

30 phút ngừng tìm theo M07 không tự hủy Order. Quán gọi lại hoặc xử lý hủy món. Delivery hiện hành completed chuyển Order hoàn thành một lần, không lặp giao dịch khi retry/sự kiện gửi lại.

## 9. Quyền hủy

| Mốc | Khách | Quán | Shipper |
|---|---|---|---|
| Chưa xác nhận | Hủy đơn món | Từ chối | Chưa tham gia |
| Đã xác nhận, chưa pickup | Liên hệ quán | Hủy đơn món, có lý do | Hủy lần nhận theo M07 |
| Đã pickup | Liên hệ xử lý | Không hủy thông thường | Complete/fail theo M07 |

Phân biệt ba hành động:
1. **Hủy đơn món:** kết thúc Order và delivery đang có trước pickup, giải phóng hold tương ứng.
2. **Hủy yêu cầu giao:** chỉ kết thúc delivery, giữ Order.
3. **Shipper hủy nhận:** kết thúc assignment, tìm lại theo thời hạn còn lại, giữ Order.

Server bảo vệ hủy vs pickup, hủy khách vs xác nhận quán; chỉ một chuyển trạng thái hợp lệ thắng. UI không dùng nút Hủy mơ hồ cho các hành động khác nhau.

## 10. Giao thất bại

Không tự hoàn thành/hủy Order. Hiện lý do và tình trạng hàng từ M07. Hàng còn shipper/chưa rõ chặn gọi lại; quán xác nhận hàng về và giao được mới cho gọi lại. Hàng đã xử lý không giao tiếp: đóng Order “Không hoàn tất”, có lý do.

Hàng ở tay ai người đó chịu trách nhiệm; hệ thống ghi nhận. Không tự hoàn tiền/bồi thường/trừ thêm tiền. Ngoại lệ sau kết thúc theo M07/M11 và quyền Admin, không sửa ledger ngầm.

## 11. Tiền và thanh toán

Theo dõi tiền món chốt, đã thanh toán trực tiếp, còn phải thu, phí ship và bên trả, tổng dự kiến khi đủ dữ liệu. “Đã thanh toán” là thông tin người có quyền ghi nhận, không chứng minh ngân hàng đã xác nhận. Thanh toán trực tiếp không buộc chỉ trả lúc nhận; ảnh không giới hạn thỏa thuận ngoài app đã được ghi nhận hợp lệ.

Không giữ tiền hàng/COD, không ví khách/online payment. Tiền nguyên VND. Phí và khóa phí theo M06/M07; chưa có phí không hiển thị bằng 0.

## 12. Danh sách, lịch sử, đặt lại

Khách: Đang xử lý / Đơn hẹn / Lịch sử. Chi tiết món, tiền, người nhận, thời gian, timeline, shipper khi đã nhận theo quyền. Đặt lại đưa món còn bán vào giỏ với giá hiện tại, báo món không còn bán, không sao chép giá cũ.

Quán phân biệt Đơn món (khách đặt app) và Giao hàng (từ M10 hoặc gọi trực tiếp M07). Lọc Chờ xác nhận / Đang chuẩn bị / Đơn hẹn / Đang giao / Cần xử lý / Lịch sử; tìm mã/người nhận, lọc ngày.

## 13. Admin và dữ liệu

Admin theo quyền xem, lọc, chi tiết, chỉnh sửa đã ghi nhận, các lần giao và lý do hủy. Ngoại lệ bắt buộc lý do/nhật ký; không ô sửa status tùy ý.

Snapshot lúc đặt và xác nhận: quán, món, số lượng, giá, ghi chú, người nhận, SĐT, địa chỉ, giờ hẹn, các chỉnh sửa/actor/time, các delivery liên quan. Đổi thực đơn hoặc sổ địa chỉ không đổi đơn cũ. Không xóa vật lý dữ liệu đơn.

## 14. UI được duyệt

| Ảnh | Phạm vi |
|---|---|
| 11Ship-M10-Customer-UI-APPROVED.png | Thực đơn có +, giỏ, xác nhận/hẹn, chi tiết chờ xác nhận/hủy |
| 11Ship-M10-Merchant-UI-APPROVED.png | Danh sách, chỉnh/xác nhận, chuẩn bị/gọi, ngừng tìm/gọi lại |
| 11Ship-M10-Admin-UI-APPROVED.png | Lọc/danh sách, drawer, timeline, các lần giao, ngoại lệ |

Màu vàng #D8AD18, đen #2A2A2E, nền #F2F1EE, thẻ trắng; ưu tiên component/token M01/M02 đã duyệt. Font theo hệ thống brand. Khách 3 tab Trang chủ–Đơn hàng–Tài khoản; chủ quán 4 tab Trang chủ–Đơn hàng–Quán–Tài khoản. Không tab tìm kiếm riêng. Chọn tab theo ngữ cảnh thực tế khi code.

Ảnh là tham khảo bố cục đã duyệt, không phải API/schema. Địa chỉ (có cả địa chỉ ngoài Cao Bằng), thời gian, số điện thoại, tên, ảnh món, giá/counter trong ảnh là dữ liệu giả; không seed vào production. Không thêm mô tả món, yêu thích, giới hạn ghi chú 200 ký tự hoặc chức năng mới chỉ vì chi tiết trang trí ảnh. Nội dung chức năng trong tài liệu ưu tiên nếu ảnh khác. Phí 10.000đ trong ảnh là minh họa, dùng M06 khi triển khai. Lịch sử tìm phải tuân mốc 30 phút server, không lấy timestamp mẫu trong ảnh làm quy tắc.

Các trạng thái cần thể hiện khi triển khai: tải/rỗng/lỗi/thử lại; offline/dữ liệu cũ; đang gửi/kết quả chưa xác định; giá đổi/món ẩn-xóa; giỏ khác quán; quán không khả dụng; giờ hẹn sai; thiếu quyền/hết phiên; conflict; hủy/xác nhận lý do; hết hạn tìm; phí chưa rõ; hàng chưa về. Không suy ra trạng thái từ đồng hồ điện thoại; reconnect lấy trạng thái mới, sự kiện cũ không ghi đè mới.

## 15. Năm gói triển khai

| Gói | Nội dung |
|---|---|
| M10.01 | Chọn món, giỏ, kiểm giá, tạo đơn |
| M10.02 | Quán chỉnh/xác nhận/từ chối, hủy khách/quán |
| M10.03 | Đơn hẹn, chuẩn bị, nhắc |
| M10.04 | Adapter M07, gọi lại, complete/fail/xử lý hàng |
| M10.05 | Lịch sử, đặt lại, Admin/audit |

Ca nghiệm thu: giá đổi lúc gửi; món vừa ẩn/xóa; mất mạng gửi lặp; khách hủy đồng thời quán xác nhận; quán hủy đồng thời pickup; hết 30 phút giữ Order; gọi lại không tạo delivery trùng; fail/hàng chưa về; completed chỉ một lần; snapshot đơn không đổi khi sửa menu/địa chỉ; hẹn qua đêm/24h; sai quyền. Chưa chạy test runtime trong công việc thiết kế.

## 16. Bàn giao và giới hạn ủy quyền

Owner đã duyệt chức năng và UI v1.0. Lần này chỉ lưu thiết kế, chưa triển khai code, DB, merge hay deploy. Giao việc sau phải ghi rõ **UI-only** hoặc **backend/functionality**; không tự triển khai nghiệp vụ từ mockup. Đối chiếu enum/API hiện có trước khi code, không đổi định danh kỹ thuật chỉ để đổi thuật ngữ UI.

## 17. Phụ lục tích hợp M14 — Owner chốt 16/10/2026 (bổ sung chính thức, ưu tiên hơn mô tả map/GPS cũ trong phạm vi này)

Phụ lục này không có trong gói đính kèm ban đầu; nội dung do Owner giao lại ngày 18/10/2026 và lưu nguyên văn ý ở đây.

- **M10-MAP.01 — Checkout:** dùng M05 + lõi M14 để chọn địa chỉ/ghim; lưu snapshot điểm vào Order. Thiếu ghim vẫn được theo luồng đã chốt và ghi “Chưa xác định phí”. Có tuyến thì lấy báo giá M06, không tự tính phí trong app.
- **M10-MAP.02 — Chi tiết đơn:** khách/quán xem bản đồ theo delivery hiện hành của M07, gồm điểm lấy/giao và vị trí shipper mới nhất khi có quyền; hiển thị thời gian cập nhật và tình trạng dữ liệu cũ.
- Khi hủy nhận hoặc gọi lại, theo assignment/delivery hiện hành từ server; không tiếp tục bám shipper cũ.
- Đơn kết thúc chỉ xem snapshot điểm và timeline theo quyền; dừng live tracking. Không lưu chuỗi lịch sử GPS trên điện thoại hoặc server chính thức. Lịch sử GPS/GPX chỉ thuộc app GPS Test.
- Bản đồ offline không đồng nghĩa tính tuyến mới offline. Không giả tọa độ, không dùng đường thẳng thay tuyến lỗi, không coi phí chưa biết là 0đ.
- Không thêm bước “Bắt đầu giao” hoặc tab map riêng. Đặt hộ không tự cấp quyền tracking cho người nhận chỉ từ SĐT.
- **Nghiệm thu:** checkout không GPS; chuyển delivery khi gọi lại; khách không xem đơn người khác; completed/failed không tiếp tục live tracking.
