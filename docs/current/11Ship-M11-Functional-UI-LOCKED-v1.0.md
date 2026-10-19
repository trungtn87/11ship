# 11Ship — M11 Đánh giá và phản ánh

Phiên bản 1.0 · Ngày 16/10/2026 · Múi giờ Asia/Ho_Chi_Minh.

**OWNER_APPROVED / DESIGN_LOCKED. IMPLEMENTATION_PENDING.**

Owner chốt chức năng bằng “Ok chốt. Thiết kế ui”, sau đó duyệt bộ UI bằng “Duyệt. Lưu vào dự án”. Tài liệu và ba ảnh cuối là bộ thiết kế được duyệt. Chưa code, migration, kiểm thử runtime, merge hoặc deploy từ yêu cầu này.

## 1. Phạm vi và điều kiện đánh giá

M11 sở hữu đánh giá quán/shipper, phản hồi quán, phản ánh đánh giá và kết quả giao, quy trình Admin xác minh/kết luận. Không đổi số module; M09 đã gộp M02. M12 quản trị, M13 giám sát, M14 GPS/bản đồ/định tuyến.

| Người đánh giá | Đối tượng | Điều kiện |
|---|---|---|
| Khách đặt món | Quán | Order đã hoàn thành |
| Khách đặt món | Shipper thực hiện | Delivery thành công, thuộc Order của khách |
| Quán | Shipper thực hiện | Delivery thành công hoặc thất bại |

Chấm 1–5 sao, nhận xét tùy chọn. Mỗi người chỉ đánh giá một lần cho đúng đối tượng trên Order/Delivery. Người nhận hộ không tự có quyền vì trùng SĐT. Đơn ngoài app quán gọi trực tiếp: chỉ quán đánh giá shipper. Shipper hủy nhận trước lấy hàng không nhận đánh giá của lần giao đó; vấn đề phát sinh dùng phản ánh. Không có đánh giá ngược từ shipper cho khách/quán.

Gửi một lần, không sửa/xóa; cần xác nhận trước gửi. Backend kiểm actor, subject, liên kết và điều kiện thật; gửi lặp không tạo nhiều bản ghi.

## 2. Đánh giá quán và phản hồi

Khách mở đơn hoàn thành, chọn Đánh giá quán, chọn sao và nhập nhận xét tùy chọn. Trang quán công khai điểm trung bình, tổng lượt, danh sách mới nhất trước, lọc số sao; tên hiển thị khách, ngày, sao, nhận xét, phản hồi quán. Không công khai SĐT/địa chỉ/chi tiết riêng đơn. Chưa có lượt hiển thị Chưa có đánh giá, không mặc định 5 sao.

Quán có một phản hồi mỗi đánh giá, được cập nhật có lịch sử. Quán không được sửa/xóa đánh giá khách; bản đầu không có nút/API quán báo cáo đánh giá khách.

## 3. Đánh giá shipper

Tách nguồn Khách đánh giá / Quán đánh giá. Shipper xem điểm, lượt, nhận xét về mình; Admin xem nguồn, đơn và lịch sử xử lý. Khách/quán xem điểm tổng hợp trên thẻ shipper sau nhận; không công khai danh tính người viết nhận xét. Không công khai PLATFORM/EXTERNAL. Điểm thấp không tự khóa, hạn chế nhận đơn hay phạt tiền.

Shipper được phản ánh đánh giá của mình vì nhầm đơn/người hoặc nội dung cần xác minh; không tự gỡ trong thời gian chờ.

## 4. Gửi phản ánh

Điểm vào: chi tiết Order/Delivery và Phản ánh của tôi trong Tài khoản; không thêm tab điều hướng. Khách/quán/shipper chỉ gửi về đơn liên quan mình.

Nhóm: Kết quả giao; Hàng hóa; Tiền/phí; Thái độ/phục vụ; Đánh giá shipper; Khác. Ví dụ sai kết quả, thiếu/sai/hỏng hàng hoặc chưa trả hàng, thu khác phí chốt, thái độ, đánh giá nhầm. Nhóm Khác phải mô tả.

Form: mã liên quan tự gắn, nhóm, nội dung bắt buộc, ảnh minh chứng tùy chọn. Tối đa 5 ảnh, 5 MB/ảnh. Không ép ảnh để tiếp nhận. Vấn đề trùng đang mở trên cùng đơn bổ sung vào hồ sơ cũ.

## 5. Quy trình hồ sơ

| Trạng thái | Ý nghĩa |
|---|---|
| Chờ tiếp nhận | Gửi thành công |
| Đang xử lý | Admin tiếp nhận |
| Chờ bổ sung | Chờ thông tin từ một bên |
| Đã giải quyết | Có kết luận và xử lý |
| Đóng không xử lý | Trùng/ngoài phạm vi/không đủ căn cứ; bắt buộc lý do |

Người gửi theo dõi, bổ sung nội dung/ảnh, nhận kết quả. Bên liên quan chỉ thấy phần cần giải trình và kết luận theo quyền. Ghi chú nội bộ tách khỏi nội dung app. Không chat trực tiếp giữa các bên.

Trong 7 ngày sau đóng, người gửi có thể yêu cầu xem xét lại; Admin quyết định mở lại, ghi lý do. Không tự đóng hoặc coi phản ánh đúng vì bên kia chưa trả lời. Danh sách/chi tiết phải khớp trạng thái; chỉ hồ sơ đã đóng còn hạn mới có yêu cầu xem xét lại.

## 6. Admin Web và kiểm duyệt

Hai mục Đánh giá và Phản ánh. Lọc thời gian, trạng thái, nhóm, quán, shipper, người phụ trách; tìm mã hồ sơ/mã đơn. Chi tiết có nội dung/minh chứng/bổ sung, Order/Delivery, lịch sử nhận/hủy/giao, tình trạng hàng, phí chốt, phân công, ghi chú nội bộ, kết luận, hành động và nhật ký.

Admin theo scope/action được tiếp nhận, phân công, yêu cầu bổ sung, kết luận, đóng/mở lại. Quyền phản ánh không tự cấp quyền tiền/khóa tài khoản. Ẩn/khôi phục đánh giá sai hoặc vi phạm phải có lý do, giữ bản gốc và audit. Đánh giá ẩn không tính điểm tổng hợp. Không sửa sao/nhận xét thay người gửi.

## 7. Kết quả giao, hàng và tiền

Phản ánh không tự đổi trạng thái, hoàn hoa hồng hay bồi thường. Delivery terminal không quay về đang giao. Kết luận sai lưu bản điều chỉnh tham chiếu kết quả gốc, hiện trên lịch sử, không replay complete/capture/Order completed. Có lần giao sau phải đối chiếu toàn lịch sử trước áp dụng.

Điều chỉnh hoa hồng qua M04, quyền tiền riêng. Thiếu số dư: Chờ xử lý tài chính, không âm ví/đụng tiền đang giữ. Tiền hàng và phí ship do các bên xử lý trực tiếp; hệ thống ghi nhận, không giữ hoặc tự hoàn tiền.

Hàng ở tay ai người đó chịu trách nhiệm. Đóng phản ánh không tự xác nhận hàng đã về; M07 sở hữu custody và điều kiện gọi lại.

## 8. Liên module và thông báo

| Module | Cung cấp/nhận |
|---|---|
| M07 | Delivery, assignment thực hiện, kết quả, custody |
| M10 | Order, người đặt, quyền đánh giá quán |
| M04 | Adjustment có quyền và tham chiếu |
| M08 | Nhắc đánh giá, báo tiếp nhận/bổ sung/kết quả |
| M12 | Quyền quản trị, báo cáo |
| M13 | Log/sự kiện giám sát |

Nhắc đánh giá một lần khi đủ điều kiện; không popup bắt buộc. Deep link phản ánh kiểm quyền hiện tại. Không hard delete dữ liệu nghiệp vụ. Audit ghi actor/thời điểm/lý do/trước-sau. Server là nguồn trạng thái; retry không nhân đôi, sự kiện cũ không ghi đè mới.

## 9. Bộ UI đã duyệt

| File | Phạm vi |
|---|---|
| 11Ship-M11-Customer-UI-APPROVED.png | Đánh giá quán/shipper, đánh giá quán công khai, gửi phản ánh, chờ bổ sung |
| 11Ship-M11-Merchant-Shipper-UI-APPROVED.png | Quán đánh giá/phản hồi; shipper xem điểm theo nguồn, phản ánh đã đóng/xem xét lại |
| 11Ship-M11-Admin-UI-APPROVED.png | Danh sách/chi tiết, kiểm duyệt, ghi chú nội bộ, kết luận và chuyển tiền theo quyền |

Ảnh quán/shipper dùng bản chỉnh cuối: Quán đánh giá là tab chọn khi thẻ nguồn quán; hồ sơ đã giải quyết trong Đã đóng; bỏ dòng tổng đơn khách và counter giới hạn nhận xét.

Brand vàng #D8AD18, đen #2A2A2E, nền #F2F1EE, thẻ trắng, font theo brand hiện hữu. Food khách 3 tab Trang chủ–Đơn hàng–Tài khoản, chủ quán 4 tab Trang chủ–Đơn hàng–Quán–Tài khoản; Ship giữ shell hiện hành. Form tập trung có thể ẩn nav; không thêm tab. Không tự cấp chức năng ví/thu nhập từ shell.

Tên, ngày, SĐT, sao, số lượng, ảnh, mã, tiền trên mockup là minh họa, không seed production. Văn bản nghiệp vụ ưu tiên khi ảnh lệch. Không suy ra giới hạn 500 ký tự, ảnh trong đánh giá, hồ sơ khách chi tiết, hoặc tính năng mới từ trang trí mockup. Không đưa tên module kỹ thuật M04/M07 vào nhãn sản phẩm khi code; dùng nhãn nghiệp vụ Điều chỉnh tài chính/Xem tình trạng hàng. Ảnh là tham khảo, không phải API/schema.

Khi triển khai cần có loading/rỗng/lỗi/thử lại/offline, đang gửi/kết quả chưa rõ, thiếu quyền/hết phiên, conflict và đã hết hạn xem xét lại. Reconnect lấy trạng thái server, không giả đã gửi khi chưa xác nhận.

## 10. Gói triển khai và nghiệm thu

| Gói | Nội dung |
|---|---|
| M11.01 | Đánh giá quán/shipper, tổng hợp, phản hồi quán |
| M11.02 | Gửi phản ánh, minh chứng, bổ sung/theo dõi |
| M11.03 | Admin, kiểm duyệt, outcome adjustment, nối M04 |

Ca trọng tâm: sai actor/đơn/đối tượng; đơn chưa đủ điều kiện; hai request đánh giá; quán sửa/xóa rating khách bị chặn; cập nhật reply có lịch sử; ẩn/khôi phục cập nhật điểm; phản ánh trùng; quyền đọc minh chứng; thiếu quyền tiền; xem xét lại hết 7 ngày; điều chỉnh không replay complete/capture; thiếu ví giữ chờ; có delivery tiếp theo; đóng hồ sơ không đổi custody; retry/offline không nhân đôi. Chưa chạy runtime test trong công việc thiết kế.

Chỉ lưu thiết kế đã duyệt. Lần giao việc sau ghi rõ UI-only hoặc backend/functionality, không tự code nghiệp vụ từ mockup. Đối chiếu contract/enum hiện có trước migration, không đổi định danh kỹ thuật chỉ để đổi thuật ngữ UI.
