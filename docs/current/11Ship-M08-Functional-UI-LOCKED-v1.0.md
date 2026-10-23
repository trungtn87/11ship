# 11Ship — M08 Thông báo, nhắc việc và đồng bộ trạng thái

> Bổ sung Owner 21/10/2026: [Thời hạn ba giai đoạn, SYSTEM tự hủy, audit và cài đặt Admin](M10-timeouts-20261021.md) (#153) thay thế các mô tả timeout cũ xung đột.

Phiên bản v1.0 · Ngày 16/10/2026 · Asia/Ho_Chi_Minh.

**Chức năng và UI: OWNER_APPROVED / DESIGN_LOCKED. Triển khai: IMPLEMENTATION_PENDING.**

Owner chốt chức năng bằng “Ok. Chốt”, duyệt hai bảng UI bằng “Ok duyệt. Lưu dự án” trong hội thoại ngày 16/10/2026. Bản này ghi nhận quyết định đã duyệt, không phải lệnh triển khai code, migration, merge hay deploy.

## 1. Phạm vi và ranh giới

M08 sở hữu thông báo trong app, push nền, hộp thông báo, nhắc việc và đồng bộ sự kiện trực tiếp. Bề mặt: app 11Food khách/chủ quán, app 11Ship shipper và Admin Web. Không có web khách/quán/shipper.

M01 sở hữu tài khoản, session, quyền; M03 hồ sơ/availability shipper; M04 ví và giao dịch; M06 điều kiện nhận/ghép; M07 delivery/assignment/deadline/transition; M10 Order; M14 GPS, bản đồ, tuyến và quyền xem vị trí; M13 giám sát và cảnh báo sự cố hệ thống.

M08 không tự xác nhận/nhận/hủy/hoàn thành đơn, trừ tiền hoặc cấp quyền. Có thể vận chuyển sự kiện vị trí M14, nhưng không sở hữu dữ liệu, tần suất GPS hay chính sách tracking. SMS OTP thuộc M01; không dùng SMS dự phòng cho push giao hàng. Cảnh báo Gateway, pin/nguồn, SIM, VPS, API/DB thuộc M13; M08 để sẵn kênh gửi.

## 2. Các kênh

| Kênh | Hành vi |
|---|---|
| Cập nhật trực tiếp | App mở cập nhật danh sách/trạng thái; thông báo ngắn khi cần |
| Push điện thoại | Báo khi nền/khóa màn hình tùy quyền và điều kiện thiết bị |
| Hộp thông báo | Lưu thông báo phù hợp, đánh dấu đọc và mở đúng đối tượng |

Một sự kiện qua nhiều kênh chỉ có một mục trong hộp thông báo. Push không chứng minh thao tác nghiệp vụ thành công. Server xác nhận thao tác mới là nguồn chuẩn.

## 3. Danh mục sự kiện và người nhận

| Sự kiện | Người nhận | Điểm mở |
|---|---|---|
| Đơn món mới | Quán | Chi tiết Order cần xác nhận |
| Quán xác nhận Order | Khách đặt | Chi tiết Order |
| Quán từ chối/hủy Order | Khách đặt | Chi tiết Order, lý do trong app |
| Có delivery phù hợp | Shipper đủ điều kiện | Danh sách đơn có thể nhận |
| Đang tìm sau 5 phút | Quán | Chi tiết delivery |
| Đang tìm sau 15 phút | Quán | Chi tiết delivery |
| Hết 30 phút tìm | Quán | Ngừng tìm, Gọi lại/Hủy yêu cầu giao |
| Shipper nhận đơn | Quán; khách đặt nếu liên kết Order | Chi tiết |
| Shipper hủy nhận trước pickup | Quán | Tìm lại theo hạn cũ hoặc ngừng tìm |
| Quán hủy delivery | Shipper hiện tại; khách đặt nếu liên kết Order | Chi tiết, không tự hủy Order |
| Nhắc chưa lấy hàng | Shipper hiện tại | Đơn cần lấy |
| Shipper đã lấy hàng | Quán; khách đặt nếu liên kết Order | Chi tiết đang giao |
| Giao thành công | Quán; khách đặt nếu liên kết Order | Kết quả/lịch sử |
| Giao thất bại | Quán; khách đặt nếu liên kết Order; Admin đúng quyền | Kết quả, hướng xử lý theo quyền |
| Hàng cần xử lý sau failed | Quán; Admin đúng quyền | Hồ sơ xử lý hàng |
| Hồ sơ quán/shipper duyệt hoặc từ chối | Chủ tài khoản | Hồ sơ và kết quả |
| Nạp/rút tiền có kết quả | Shipper liên quan | Giao dịch ví |

Người nhận nhập tay không tự trở thành người nhận thông báo app. Đặt hộ gửi đến tài khoản đặt đơn; không suy tài khoản từ SĐT người nhận. Sự kiện M10 chỉ hoạt động khi Order triển khai. Không mở rộng chức năng module khác từ danh mục này.

## 4. Báo đơn mới cho shipper

- Chỉ gửi cho shipper đang bật nhận và đủ điều kiện M06 tại lúc xét gửi; không công khai PLATFORM/EXTERNAL.
- Không đưa SĐT khách, địa chỉ giao chi tiết hoặc bản đồ điểm giao vào thông báo trước nhận.
- Chạm thông báo tải lại danh sách. Đơn hết khả dụng hiển thị “Đơn này không còn có thể nhận”. Bấm Nhận vẫn qua M07 kiểm lại toàn bộ điều kiện.
- Mỗi shipper tối đa một push/delivery/đợt tìm. Khi shipper khác hủy nhận có thể báo lại người đủ điều kiện theo đợt mới, nhưng không reset deadline 30 phút của delivery.
- Không lưu một mục lịch sử cho từng đơn mới ở hộp shipper; gom thành thẻ “Có đơn giao hàng mới” mở danh sách hiện tại.

## 5. Nhắc tự động

### Tìm shipper

Mốc tính từ thời gian tạo delivery trên server: 5 phút nhắc lần một, 15 phút lần hai, 30 phút M07 ngừng tìm và M08 báo kết quả. Chỉ nhắc khi đang tìm. Hủy nhận giữ mốc cũ. Gọi lại tạo delivery mới có mốc mới. Shipper đã nhận trước hạn không tự bị thu hồi lúc phút 30.

Restart/khôi phục không reset timer. Không gửi dồn mốc lỗi thời: đã quá phút 30 chỉ báo kết quả ngừng tìm còn phù hợp, không phát cả nhắc 5/15.

### Chờ lấy hàng

Nhắc mỗi 5 phút từ lúc nhận assignment, chỉ khi assignment hiện tại còn chờ lấy. Dừng khi pickup, hủy nhận, quán hủy hoặc assignment kết thúc. Nhiều đơn cùng đến hạn gom “Bạn còn 2 đơn chưa lấy hàng”. Không bắt xác nhận đã đọc. Không thêm nhắc theo giờ hẹn trước gọi ship; không tự thêm quy tắc giao quá giờ.

## 6. Hộp thông báo và hành vi app

Chuông ở đầu màn hình, giữ thanh điều hướng hiện hành. Bộ lọc Tất cả/Chưa đọc; nhóm Hôm nay/Hôm qua/Trước đó. Dòng gồm icon, tiêu đề, nội dung ngắn, thời gian, dấu chưa đọc. Có Đánh dấu tất cả đã đọc. Chạm mở đúng Order/delivery/giao dịch/hồ sơ; mở từ hộp thì đánh dấu đọc. Chỉ hiển thị push trên thanh trạng thái không được tính là đọc.

Đối tượng kết thúc mở lịch sử. Mất quyền hiển thị “Bạn không còn quyền xem nội dung này”, bỏ nội dung nhạy cảm. Empty có lời nhắn chưa có thông báo; lỗi cho thử lại; loading không nhân đôi dòng.

## 7. Cài đặt thông báo

Tài khoản → Cài đặt thông báo. Mặc định bật: Đơn hàng và giao hàng, Nhắc việc, Ví và hồ sơ, Âm thanh, Rung. Riêng shipper thêm Đơn có thể nhận. Tắt âm thanh không tắt nhận đơn. Không đưa timer nghiệp vụ vào cài đặt người dùng.

Thiếu quyền hệ điều hành hiện hướng dẫn ngắn và nút mở cài đặt điện thoại. Mở app vẫn đồng bộ trạng thái. Không cam kết push luôn đến trong mọi trạng thái Android/mạng.

## 8. Đồng bộ, mất mạng và chống trùng

App mở nhận sự kiện cập nhật. Mở lại, reconnect hoặc chạm push đều fetch trạng thái server. Event cũ không đè version mới. Retry cùng event không tạo nhiều notification hoặc lặp âm thanh. Mất mạng hiển thị “Mất kết nối — dữ liệu có thể chưa cập nhật”. Không hiện đã nhận/lấy/giao khi server chưa xác nhận.

## 9. Thiết bị, session và dữ liệu riêng tư

Một tài khoản một thiết bị online theo M01. Đăng nhập máy mới thu hồi liên kết gửi của phiên cũ. Logout ngừng gửi riêng; đổi tài khoản trên cùng máy tách dữ liệu và thông báo. Hủy nhận thì dừng cập nhật riêng assignment và thu hồi quyền liên hệ theo M07. Mọi lần mở đều kiểm quyền hiện tại.

Push khóa màn hình dùng nội dung gọn, không OTP/mật khẩu/SĐT/địa chỉ chi tiết/ngân hàng. Chi tiết tải sau khi vào app đúng tài khoản.

## 10. Admin Web

| Mục | Nội dung |
|---|---|
| Việc cần xử lý | Sự kiện nghiệp vụ trong scope Admin |
| Tra cứu thông báo | Lọc thời gian/loại/tài khoản/mã đơn/trạng thái gửi |
| Chi tiết gửi | Tạo lúc, kênh, số lần thử, lỗi, thời hạn và mở đối tượng |
| Cấu hình | Bật/tắt kênh, âm thanh mặc định, thời gian lưu và giới hạn retry |

Mốc nhắc tìm 5/15, stop 30, nhắc lấy mỗi 5 phút chỉ đọc theo quyết định chốt. Không phát lại hàng loạt thông báo cũ; không gửi quảng cáo/toàn hệ thống tùy ý trong bản đầu. Không đưa GPS config hoặc giám sát VPS/SMS M13 vào M08.

“Đã gửi” không đồng nghĩa người dùng đã đọc hoặc thiết bị chắc chắn hiển thị. Nội dung lỗi thiết bị trong ảnh là dữ liệu giả; triển khai chỉ hiển thị nguyên nhân có bằng chứng, không suy đoán mất kết nối từ việc chưa nhận push.

## 11. TTL, lưu trữ, retry

| Loại | Thời hạn hiệu lực/lưu |
|---|---|
| Báo đơn có thể nhận | Hết hiệu lực khi không còn có thể nhận |
| Nhắc lấy | Hết hiệu lực khi assignment không còn chờ lấy |
| Kết quả đơn/ví/hồ sơ | Hộp thông báo 90 ngày; chuyển lưu trữ sau đó; xóa sau tổng cộng 365 ngày |

TTL gửi và thời gian lưu lịch sử độc lập: còn lịch sử không có nghĩa được phát push. Sự kiện lưu cùng giao dịch nghiệp vụ, gửi nền sau commit. Retry có giới hạn, kiểm TTL và quyền mỗi lần. Restart không phát nhắc lỗi thời. Xóa thông báo không xóa lịch sử nghiệp vụ Order/delivery/ví/audit của module sở hữu.

## 12. UI được duyệt

Brand vàng #D8AD18, đen #2A2A2E, trắng #FFFFFF, nền #F2F1EE; font Plus Jakarta Sans theo dự án; dùng “shipper”. Giữ shell và điều hướng đã duyệt.

**11Ship-M08-App-UI.png:** bốn màn khách hàng/chủ quán/shipper/cài đặt. Unread nền vàng nhạt và chấm; trạng thái có chữ và màu; quán có thông báo mới/đang tìm/ngừng tìm/cần xử lý hàng; shipper có thẻ gom đơn mới, nhắc lấy, hủy giao và ví. Push minh họa nội dung chung. Màn hộp thông báo là trang mở từ chuông, không thêm tab dưới.

**11Ship-M08-Admin-Web-UI.png:** sidebar Thông báo, tabs Việc cần xử lý/Tra cứu/Cấu hình; bộ lọc; bảng gửi; drawer chi tiết; quy tắc nhắc chỉ đọc và lưu trữ. Ảnh thể hiện tab tra cứu; các tab còn lại triển khai theo mô tả chức năng, không suy ra chức năng mới từ trang trí.

Tên, mã đơn, giờ và trạng thái gửi trong ảnh đều giả. Nhãn “UI tham khảo/Chưa triển khai” là nhãn thời điểm tạo ảnh; quyết định Owner hiện tại đã duyệt chức năng và UI. Nếu ảnh có chữ sai hoặc nội dung lệch, văn bản nghiệp vụ đã chốt ưu tiên.

## 13. Gói triển khai và nghiệm thu

M08.01 thiết bị/session/push binding; .02 sự kiện/gửi/chống trùng; .03 hộp thông báo/unread/deep link; .04 nhắc tìm/lấy; .05 trực tiếp/offline/reconnect; .06 Admin/cấu hình/lưu trữ.

Ca trọng tâm: đổi thiết bị/tài khoản không lộ thông báo; đơn hết khả dụng không nhận được; hủy nhận không reset hạn; pickup dừng nhắc; restart không phát dồn; duplicate không tạo trùng; push mở fetch quyền và trạng thái mới; revoke không rò contact; lưu trữ không kéo dài TTL gửi. Đây là thiết kế, chưa chạy test runtime.

## 14. Bàn giao

Chức năng + UI đã duyệt, DESIGN_LOCKED / IMPLEMENTATION_PENDING. Khi giao triển khai phải ghi rõ UI-only hoặc functionality/backend, không tự code nghiệp vụ từ mockup. Gói đi kèm hai PNG và tài liệu này. Không thay đổi API, DB, production hoặc merge từ lệnh lưu dự án.
