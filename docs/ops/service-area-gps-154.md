# GPS → khu vực phục vụ (#154)

Backend dùng vùng tròn đã cấu hình trong `app.service_areas`: `coverage_lat`,
`coverage_lng` (WGS84) và `coverage_radius_m` (mét). Chỉ vùng ACTIVE được resolve.
Không dùng geocoder, PostGIS hay dịch vụ trả phí. Khoảng cách great-circle dùng
bán kính Trái Đất trung bình 6.371.008,8 m. Biên vùng được tính là bên trong;
nếu vùng chồng nhau, vùng có bán kính nhỏ nhất ưu tiên, sau đó ID tăng dần.
Đây là vùng tròn vận hành, không phải ranh giới hành chính.

## Cấu hình trước khi đưa lên bản chạy

Migration `1795305600000_service-area-coverage.sql` chỉ thêm cột nullable và CHECK;
không đổi ID, tên, trạng thái, liên kết quán hoặc tự đoán tọa độ dữ liệu hiện có.
**Cập nhật theo quyết định Owner ngày 22/10/2026:** migration mới
`1795478400000_bootstrap-cao-bang-gps-coverage.sql` cấu hình *một lần*
vùng `ACTIVE` tên chính xác `Cao Bằng`, chỉ khi ba trường coverage đang
`NULL`: tâm tham chiếu TP Cao Bằng **22.66667 N, 106.25833 E**, bán kính
**10.000 m**. Đây là hình tròn vận hành, không phải địa giới hành chính
hoặc khoảng cách đi theo đường. Dữ liệu tọa độ được tham chiếu từ thành phố
Cao Bằng (Wikipedia/Wikidata) và cần đối chiếu thực địa trước khi mở rộng
mô hình ra nhiều vùng. Không tự tạo bản ghi mới, không sửa giá trị đã được
quản trị viên thiết lập hoặc các vùng khác. Nếu có nhiều bản ghi `ACTIVE`
trùng tên thì migration từ chối và cần xử lý thủ công để tránh chọn nhầm.

**Điều kiện vận hành:** deployment lên VPS phải áp dụng cả migration schema
`1795305600000` và migration khởi tạo trên (nếu chưa có).
`vps-update.py` chỉ chạy migration đã có SHA256 được phê duyệt trong
`/etc/11ship/migration-compatibility.json`; tuyệt đối không bypass.
Sau khi áp dụng, kiểm tra API
`/v1/service-areas/resolve?latitude=22.66667&longitude=106.25833`
trả vùng `Cao Bằng`, thử điểm ngoài vùng trả `null`. Nếu bản ghi khu vực
không tồn tại, bị INACTIVE hoặc đã có cấu hình khác, script không tự ý ghi
đè; phải kiểm tra dữ liệu thực tế. Các vùng khác vẫn phải cấu hình thủ công
bằng ID xác minh. App Home không còn ép người dùng chọn khu vực; khi chưa
khớp GPS sẽ báo trạng thái và có thử lại.

Sau khi được ủy quyền deploy/migration, người quản trị dùng credential migration
hiện có và câu lệnh tham số hóa dưới đây (tham số được truyền qua công cụ SQL tin cậy):

```sql
UPDATE app.service_areas
SET coverage_lat = $2::double precision,
    coverage_lng = $3::double precision,
    coverage_radius_m = $4::integer
WHERE service_area_id = $1::uuid;
```

Phải kiểm tra đúng một hàng được cập nhật. Cả ba giá trị phải được cấu hình cùng
lúc; latitude [-90, 90], longitude [-180, 180], radius [1, 100000] mét.
Xóa cấu hình bằng cách đặt cả ba cột NULL. Không tự đổi trạng thái vùng.
Hiện chưa có màn quản lý khu vực trên Web Admin; các thay đổi ngoài khởi tạo Cao Bằng
vẫn là thao tác SQL của người quản trị, không cấp quyền ghi cho API công khai.

GET `/v1/service-areas/resolve?latitude=...&longitude=...` trả `{data: {service_area_id,
name}}` hoặc `{data: null}` nếu không có vùng chứa điểm. Không có fallback gần nhất.
Không cache; query sai/thiếu/trùng/thừa tham số trả 400. Không ghi vị trí vào DB.

## App và kiểm chứng

Home tự lấy một fix foreground, chia sẻ fix/vùng với tìm kiếm. Mở lại tab dùng lại
fix còn mới; resume lấy lại nếu lần thành công trước đã hơn 5 phút. GPS lỗi không
xin quyền tự động lại; người dùng chọn “Thử lại”. Không đăng ký GPS nền, không sửa
địa chỉ khách hay điểm giao. Ngoài vùng xóa kết quả vùng cũ và báo chưa phục vụ;
đầu trang chỉ hiển thị vùng GPS; không cần chọn vùng thủ công. Khi chỉ có một
vùng và GPS chưa xác minh, app có thể hiển thị danh sách **tham khảo**, không
nhận vùng đó là vị trí hiện tại. Cùng vùng không reload quán.

Chạy unit `area-resolution`, integration `discovery.int.spec.ts` (DB test đã migrate),
và Flutter `m02_gps_area_test`, `m02_discovery_test`, `m02_view_customer_test`,
`http_m02_api_test`, `food_app_test`. Thử trên điện thoại: cấp/từ chối quyền,
GPS tắt, ngoài vùng, hai vùng khác nhau, resume sau 5 phút, mở tìm kiếm khi đổi vùng.
Migration down xóa ba cột cấu hình, cần giữ bản sao cấu hình trước rollback;
không xóa dữ liệu quán/khách/đơn. Không chạy migration/deploy từ issue này.
