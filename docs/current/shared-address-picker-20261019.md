# Chọn địa chỉ dùng chung — Owner chốt 19/10/2026

Áp dụng cho hồ sơ quán (tạo mới và sửa), sổ địa chỉ khách hàng và địa chỉ giao khi đặt đơn.

- Bên ngoài chỉ hiện dòng địa chỉ; bấm vào để chọn/sửa. Bỏ phần GPS, tọa độ, độ chính xác và bộ chọn khu vực khỏi hồ sơ quán.
- Màn chọn có ô nhập địa chỉ và bản đồ Cao Bằng hiện có. Chạm bản đồ để đặt/chuyển ghim; nút Vị trí hiện tại nằm trong bản đồ và chỉ lấy một lần khi bấm.
- Lưu trả về địa chỉ chữ và điểm đã chọn cùng nhau. Quay lại không áp dụng chỉnh sửa. Lỗi/quyền GPS không làm mất ghim cũ; vẫn chọn trên bản đồ được.
- Hồ sơ quán dùng nút Hoàn tất hồ sơ theo điều chỉnh bên dưới. Kiểm tra khu vực trên server, idempotency và version được giữ.
- Địa chỉ cũ không có ghim và đặt đơn bằng địa chỉ chữ vẫn theo contract hiện có (phí chưa xác định). Không tạo tọa độ giả từ địa chỉ chữ. Thêm/sửa trong sổ địa chỉ dùng điểm được chọn trong màn chọn.

## Cấu hình khu vực hiện tại

API hiện có chỉ trả ID/tên khu vực ACTIVE, chưa có hình học để suy ra khu vực từ tọa độ. App giữ ID hợp lệ hiện có; nếu chỉ có một khu vực ACTIVE thì tự dùng khu vực đó. Không chọn đại khi có nhiều khu vực và không nới kiểm tra server. Đây là bỏ thao tác chọn khu vực ở UI, không phải triển khai geocoding hay geofence mới.

Không migration, không deploy VPS trong thay đổi này. Các bản APK vẫn giữ applicationId, khóa ký và versionCode tăng theo pipeline hiện có.

## Owner điều chỉnh sau khi thử APK — 19/10/2026, 23:58

- Ô nhập địa chỉ nền trắng, có viền và khoảng đệm rõ.
- Hồ sơ quán bỏ nút Lưu nháp. Chỉ còn Hoàn tất hồ sơ: app lưu thông tin, đọc lại version trên server, rồi hoàn tất. Không chuyển màn thành công nếu chưa xác nhận hồ sơ ACTIVE.
- Các bản nháp cũ trên server vẫn tiếp tục được. Mỗi bước giữ Idempotency-Key riêng; lỗi đọc lại hoặc kết quả chưa xác định giữ nội dung và ghim, không tự kích hoạt.
- Ảnh lỗi lưu chỉ có thông báo chung; chưa có log VPS để kết luận nguyên nhân production. Bổ sung endpoint/HTTP/code/request_id an toàn khi có lỗi để đối chiếu; không ghi thông tin cá nhân hay token.


## Thông báo từng ô và kiểm tra lỗi lưu — Owner giao tiếp 19/10/2026

Lỗi xuất hiện dưới đúng ô khi bấm Tiếp tục/Hoàn tất; sửa nội dung thì cập nhật ngay. Tự cuộn và đưa con trỏ tới ô sai đầu tiên. Nút vẫn cho bấm để biết lý do thiếu/sai, nhưng không gửi API khi dữ liệu chưa hợp lệ. Chỉ khóa khi đang xử lý, chờ xác minh OTP hoặc chưa biết cấu hình đăng ký.

| Ô | Kiểm tra/thông báo |
| --- | --- |
| Họ tên, tên quán | Bắt buộc, tối đa 120 ký tự theo API |
| Số điện thoại | Đúng contract Việt Nam: 0 + 9 số, hoặc 84/+84 + 9 số, không có khoảng trắng bên trong |
| Mật khẩu/nhập lại | 8–128 ký tự; bắt buộc nhập lại trùng khớp |
| Điều khoản | Báo cần đồng ý trước khi tiếp tục |
| Mục đích sử dụng | Báo chọn Khách hàng/Chủ quán nếu chưa chọn |
| Địa chỉ | Nội dung bắt buộc ngay dưới ô; ghim bắt buộc được báo riêng |
| Zalo/Facebook | Không bắt buộc; giữ giới hạn 160/300, không tự thêm quy tắc URL/số điện thoại mà API không yêu cầu |

Đăng ký và hoàn tất hồ sơ thành công có thông báo rõ. Lỗi lưu quán dùng nội dung riêng, không còn nhắc mật khẩu trong lỗi hồ sơ quán. Lỗi 5xx/kết quả đọc lại chưa hợp lệ không bị mô tả đơn thuần là mất mạng; giữ thông tin, ghim và ý định ghi để kiểm tra lại an toàn.

Kiểm tra code: PUT hồ sơ và POST hoàn tất dùng transaction riêng với membership/audit/idempotency; hoàn tất còn yêu cầu tọa độ và khu vực ACTIVE. Đăng ký ghi thành công chứng minh API/DB hoạt động ở luồng tài khoản, chưa chứng minh các bước riêng của quán thành công. Request fields, normalized phone, optional empty omission, numeric coordinates, expected_version và payload GET đã đối chiếu giữa mobile/backend. Không thấy lỗi backend xác định được từ code trong phạm vi này; chưa có log production để khẳng định nguyên nhân VPS. Không thay schema, quyền DB hay deploy.

Phát hiện bổ sung: parser hồ sơ mobile ép kiểu trực tiếp các trường optional. Nếu server trả sai kiểu, lỗi cast thoát khỏi xử lý AuthFailure và có thể để trạng thái tải/ghi không kết thúc. Đã đổi sang từ chối response có kiểm soát, giữ ý định ghi và ghim; có ca kiểm tra. Đây là lỗi xác định trong code, chưa phải bằng chứng đó là lỗi Owner gặp trên VPS.


## Nguyên nhân VPS đã xác định — 20/10/2026, 00:59

Owner đối chiếu request_id `d5ed27f7-12db-4f12-8c09-615078624f38`: PostgreSQL báo `permission denied for table shop_members`. Cấu hình cấp quyền runtime chỉ có SELECT/INSERT trên bảng này, trong khi `ShopRepository.lockOwnedShop` chạy SELECT FOR UPDATE trước khi lưu. PostgreSQL cần UPDATE cho khóa dòng, kể cả không có dòng khớp; vì vậy tài khoản mới cũng không tạo được hồ sơ. Đăng ký thành công không vướng bảng này.

Sửa đúng quyền thiếu, không nới role hay bỏ khóa: bổ sung UPDATE trên app.shop_members cho ship11_app trong runtime grants và đồng bộ ma trận runbook. Bổ sung regression ở bộ CI với runtime role bị giới hạn: SELECT FOR UPDATE trên OWNER chưa tồn tại phải chạy được, DELETE vẫn bị từ chối.

Khắc phục VPS hiện tại (Owner chạy):

```bash
sudo -u postgres psql -d ship11_staging -v ON_ERROR_STOP=1 -c "GRANT UPDATE ON app.shop_members TO ship11_app;"
```

Không thay dữ liệu/schema, không cần restart hay APK mới. Sau GRANT, Owner bấm Thử lại trên cùng hồ sơ để kiểm tra. Chưa coi là production đã khắc phục trước khi có kết quả thực tế từ Owner.


## Kiểm tra các bảng còn lại — 20/10/2026, 01:01

Đối chiếu 90 bảng trong runtime grants với tham chiếu SQL của backend hiện tại: SELECT/INSERT/UPDATE/DELETE, 7 UPSERT và các khóa FOR UPDATE/FOR SHARE (kể cả khóa có điều kiện và query dùng hằng SELECT). Ngoài shop_members đã sửa, chưa tìm thấy thiếu quyền cùng loại trong phạm vi code hiện tại. Ba hàm runtime gọi được đối chiếu với 03-runtime-function-grants.sql. Không cấp UPDATE đại trà cho bảng chỉ ghi thêm; không cấp DELETE rộng để né lỗi.

Hai ngoại lệ có chủ đích: ClientDeviceRepository.purgeExpired dành cho cleanup credential, hiện không có caller runtime; AdminLimitConfigRepository.insert chỉ được CLI khởi tạo limiter gọi bằng tài khoản vận hành. Không thêm các quyền này cho ship11_app.

Bổ sung ops/selfhosted/04-check-runtime-grants.sql: transaction READ ONLY, kiểm tra quyền thực tế trên toàn bộ 90 bảng, 3 hàm, schema và database; chỉ in số lượng đạt và tên object/quyền thiếu. Không đọc nội dung người dùng, không sửa quyền/dữ liệu. Có test đồng bộ danh sách với ma trận GRANT để tránh bỏ sót bảng khi dự án mở rộng. Kiểm tra static hiện đạt; quyền thực tế VPS còn cần Owner chạy script vì môi trường hiện tại không truy cập SSH được.
