# M02 — Bổ sung khám phá, tìm quán/món và bộ lọc
Ngày: 16/10/2026, Asia/Ho_Chi_Minh.
Trạng thái: OWNER_APPROVED / DESIGN_UI_LOCKED cho phạm vi bổ sung.
Owner duyệt UI và yêu cầu bổ sung vào M02 lúc 12:49 ngày 16/10/2026.

## 1. Quyết định và thứ tự ưu tiên
- Gộp toàn bộ phạm vi M09 Thực đơn vào M02. M09 ghi MERGED_INTO_M02, không triển khai độc lập; không đánh lại số module phía sau.
- M02 gồm hồ sơ quán, giờ hoạt động, quản lý món/nhóm, khách xem thực đơn, Trang chủ khám phá, tìm quán/món và bộ lọc.
- Giữ nguyên thiết kế M02 v3 đã duyệt; chỉ bổ sung các màn/luồng trong tài liệu này.
- Phụ lục này thay quy định cũ loại tìm quán/tìm kiếm công khai khỏi M02. Không áp dụng lại hai lớp nhóm theo kế hoạch module cũ: bản đầu dùng nhóm hệ thống M02, chưa thêm nhóm riêng của quán.
- M10 dùng dữ liệu thực đơn M02; giữ giỏ hàng, đặt món, xác nhận đơn và nối giao hàng ở M10.
- Duyệt thiết kế không đồng nghĩa đã code, đã triển khai hoặc nghiệm thu đóng M02. Yêu cầu hiện tại chỉ lưu thiết kế.

## 2. Phạm vi chức năng đã duyệt
### Trang chủ khám phá
- App 11Food điện thoại. Không bổ sung màn trên app 11Ship hoặc web khách/quán.
- Khu vực phục vụ chọn thủ công từ danh sách hệ thống; không bắt buộc GPS để xem.
- Ô “Tìm quán hoặc món”, nhóm món hệ thống đang hoạt động, danh sách quán và nút bộ lọc.
- Thẻ quán: tên, địa chỉ ngắn, trạng thái mở/đóng; chạm để mở thực đơn.
- Chỉ công khai quán có hồ sơ hợp lệ, được hoạt động và thuộc khu vực đang phục vụ.
- Quán đóng cửa vẫn xem được, xếp sau quán đang mở; sau trạng thái sắp theo tên.
- Quán chưa có món công khai không xuất hiện trong khám phá. Liên kết trực tiếp vẫn mở được với thông báo thực đơn trống.
- Không thêm sao, số đơn bán, phí ship, khoảng cách, quảng cáo hoặc xếp hạng phổ biến khi chưa thuộc phạm vi/dữ liệu được duyệt.

### Tìm kiếm
- Tìm theo tên quán/tên món, không phân biệt hoa thường, hỗ trợ không dấu, bỏ khoảng trắng thừa.
- Hai mục kết quả “Quán” và “Món”; tìm trong khu vực đang chọn và toàn bộ dữ liệu phù hợp, không chỉ trang đã tải.
- Quán: tên, địa chỉ ngắn, trạng thái; chạm mở thực đơn.
- Món: ảnh hoặc ảnh thay thế, tên, giá, tên quán, trạng thái quán; chạm mở đúng quán và đưa tới món.
- Không trả món ẩn/xóa hoặc món của quán không khả dụng.
- Không có kết quả: giữ từ khóa, cho xóa từ khóa/đổi bộ lọc.

### Nhóm và bộ lọc
- Chọn một nhóm hệ thống; lọc “Chỉ quán đang mở cửa”; xóa bộ lọc.
- Chọn nhóm chỉ trả quán có ít nhất một món công khai phù hợp.
- Admin theo quyền được thêm/đổi tên/sắp xếp/bật tắt nhóm.
- Ngừng nhóm: bỏ khỏi khám phá, không chọn cho món mới; giữ món đã liên kết và vẫn xem được trong thực đơn quán.
- Không xóa vật lý nhóm, không tự chuyển nhóm món.

### Thực đơn và quản lý món
- Dùng lại quản lý món và thực đơn M02: tên, giá VND nguyên >0, một nhóm hệ thống, ảnh tùy chọn, hiện/ẩn/xóa mềm, xem trước.
- Không tạo màn quản lý thứ hai; chủ quán chỉ sửa món của quán mình.
- Món không ảnh dùng placeholder; tên dài xuống dòng, giá luôn đọc rõ.
- Quán ngoài giờ vẫn xem được thực đơn; đặt ngay/đặt hẹn do M10 quyết định.
- Đổi tên/giá/ảnh/xóa món không sửa đơn cũ. M10 lưu snapshot và kiểm lại giá/trạng thái/quyền bán khi gửi đơn.
- Chưa thêm topping, size, combo, tồn kho, khuyến mãi, voucher, giỏ hàng hoặc thanh toán.

## 3. UI tham khảo đã duyệt
Ảnh: 11Food-M02-Discovery-Search-Filter-UI-APPROVED-20261016.png, kèm trong gói thiết kế.
Ảnh là tham khảo bố cục, dữ liệu minh họa; hành vi theo tài liệu. Không tạo thêm nghiệp vụ từ ảnh.

| ID | Màn | Nội dung và điều hướng |
|---|---|---|
| M02-KP01 | Trang chủ | Khu vực Cao Bằng; chuông thông báo dùng M08; tìm quán/món; chips nhóm; danh sách quán; mở bộ lọc; chạm quán mở thực đơn |
| M02-KP02 | Tìm quán/món | Ô từ khóa, xóa từ khóa, Hủy quay lại; tab Quán/Món; kết quả có tên quán/giá/trạng thái; chạm món mở quán và đưa tới món |
| M02-KP03 | Bộ lọc | Bottom sheet trên Trang chủ, chọn khu vực, chips nhóm, công tắc chỉ quán mở; Đặt lại xóa lựa chọn nhóm/công tắc và giữ khu vực hiện tại; Áp dụng cập nhật kết quả; đóng không áp dụng draft |
| M02-KP04 | Xem thực đơn | Dùng lại màn M02; tên, địa chỉ, trạng thái, xem giờ hoạt động; tìm món trong quán, nhóm, ảnh/tên/giá |

- Khách: 3 tab chia đều Trang chủ – Đơn hàng – Tài khoản; chủ quán giữ 4 tab đã chốt với Quán.
- Không thêm tab Tìm kiếm riêng.
- Vàng #D8AD18, chữ #2A2A2E, nền #F2F1EE, thẻ trắng; font và component ưu tiên bộ M01/M02 đã duyệt, không thay toàn bộ giao diện cũ.
- Nội dung mẫu Ốc 11, Ốc hương hấp 120.000đ, Ngao hấp 60.000đ, Mực nướng 150.000đ chỉ để tham khảo.
- Không thêm nút cộng, số lượng, giỏ hàng, thanh toán trong phần này; M10 bổ sung sau.
- Ảnh quán/món và địa chỉ minh họa không phải dữ liệu thật; ảnh bìa trong mockup không tạo trường bắt buộc mới cho quán.

## 4. Đồng bộ và trạng thái
- Tải khi mở màn/kéo làm mới; dữ liệu đã lưu của quán được dùng cho các lượt tải tiếp.
- Món vừa bị ẩn/xóa được loại khi tải lại; mở liên kết cũ phải xử lý món không còn khả dụng.
- Mất mạng giữ dữ liệu đã tải kèm “Chưa cập nhật”; lỗi tải có Thử lại, không báo thành rỗng.
- Ảnh lỗi vẫn đọc tên và giá.
- Quán bị vô hiệu: ngừng công khai; liên kết cũ báo “Quán hiện không khả dụng”.
- Có loading/empty/no-results/error/offline; tìm kiếm không chớp kết quả của từ khóa cũ lên từ khóa mới.
- Không thay backend state, phiên đăng nhập hoặc quy tắc giờ hoạt động bằng suy đoán từ điện thoại.

## 5. Ca nghiệm thu khi triển khai (chưa chạy)
1. Tìm có dấu/không dấu ra đúng quán và món.
2. Chọn nhóm chỉ hiện quán có món phù hợp.
3. Lọc mở cửa loại đúng quán ngoài giờ.
4. Món ẩn/xóa không có trong tìm kiếm/thực đơn công khai.
5. Ngừng nhóm không làm mất món đang liên kết.
6. Chạm kết quả món mở đúng quán và đưa tới món.
7. Chủ quán không sửa món của quán khác.
8. Đổi giá/xóa món không thay đơn cũ.
9. Mất mạng/lỗi ảnh/thực đơn trống có thông báo đúng.

## 6. Giao triển khai sau
Chỉ triển khai khi được giao nhiệm vụ riêng; dùng lại workstream/code M02 hiện hữu.
Không code nghiệp vụ M10 từ mockup này. Không mở lại UI M02 đã duyệt.
M09 không có task riêng; phụ thuộc menu của M10 trỏ về M02.
