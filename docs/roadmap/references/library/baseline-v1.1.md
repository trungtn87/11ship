# 11Ship — Rà soát Bước 1, 2, 3 và chia module triển khai

Phiên bản: 1.1 — bản rà soát thiết kế, ngày 06/10/2026, giờ Việt Nam.

Phạm vi: nghiệp vụ, workflow, dữ liệu, API, phân quyền, module và test nghiệm thu. Người dùng đã giao ChatGPT tự chọn phương án khắc phục cho chỗ sai hoặc chưa chốt và làm theo từng bước. Báo cáo ghi riêng quyết định có sẵn và phương án được chọn trong lần rà soát này. Chưa thay đổi source, database chạy thật, chưa giao việc cho Claude, chưa chạy test phần mềm.

## 0. Kết quả và nguồn chuẩn

Thiết kế có thể tiếp tục phát triển nhưng chưa đủ để giao toàn bộ cho Claude. Vấn đề chính là nhiều bản đặc tả cùng tồn tại: tài liệu đầu ngày 05/10, workflow cuối Bước 2 và danh mục API sáng 06/10 có các điểm khác nhau. Cần một bộ hợp đồng thống nhất trước khi code từng chức năng.

Đã đọc đầy đủ ba tài liệu:

1. `11Ship-ke-hoach-trien-khai-checklist-v1.md`, bản lập kế hoạch ngày 05/10.
2. `11Ship-M0-khoi-dong-v1.md`, hồ sơ khởi động ngày 05/10.
3. `11Ship-goi-ship-nghiep-vu-database-api-v1.md`, tổng hợp đến 08:45 ngày 05/10.

Đã đối chiếu quyết định Bước 2 qua lịch sử dự án và toàn bộ Bước 3 trong cuộc trò chuyện hiện tại, gồm các sửa đổi về tiền thủ công, đặt hộ, loại xế và đánh giá quán.

Chưa tìm thấy một file DDL/migration độc lập chứa đầy đủ DATABASE v1 cuối ngày 05/10. Vì vậy đây là rà soát đặc tả và dựng lại ràng buộc, không phải xác nhận đã kiểm tra schema/code đang chạy. Enum cuối Bước 2 dưới đây được truy hồi từ lịch sử; lúc tạo migration phải đối chiếu bản thực tế nếu repository đã có.

Thứ tự ưu tiên nguồn:

1. Chỉ dẫn cụ thể mới nhất của người dùng.
2. Quyết định đã được chốt, không mâu thuẫn với chỉ dẫn mới hơn.
3. Phương án khắc phục trong báo cáo này, theo ủy quyền rà soát hiện tại.
4. Đề xuất cũ chỉ để tham khảo lịch sử.

Không giao tài liệu M0 cũ như yêu cầu hiện hành: các nội dung “mỗi xế một đơn”, “chưa có ví/hoa hồng/ghép”, “Android trước”, “khách tự sửa đơn” đã được thay thế. Không nhầm các Bước 1–3 của dự án với các mốc triển khai M0–M8 trong kế hoạch cũ.

## 1. Kiểm tra Bước 1 — nghiệp vụ và phạm vi

### 1.1. Quyết định được giữ nguyên

| ID | Quy tắc hiện hành |
|---|---|
| B01 | Bốn app: khách, quán, xế, quản lý; một web quản trị; chung backend/API. Android và iOS được thiết kế, kiểm thử từ đầu. |
| B02 | Làm luồng quán gọi ship trước, sau đó tích hợp khách đặt món; tích hợp sau từng phần. |
| B03 | Khách không trả phí sử dụng app. Tiền hàng/COD và phí ship do quán–xế–khách tự xử lý ngoài hệ thống. |
| B04 | Một SĐT đã xác minh tương ứng một tài khoản; dùng mật khẩu; nhiều vai trò; chưa hỗ trợ Google/Apple. |
| B05 | Quán tự đăng ký; điểm lấy hàng thuộc vùng phục vụ. Quản lý không đăng ký công khai. |
| B06 | Xế nạp tiền kích hoạt 100.000đ và được duyệt thủ công. Tiền này vào chung số dư trả hoa hồng, không có quỹ ký quỹ riêng. |
| B07 | Quản lý nhập tiền thực nhận để nạp; quản lý nhập tiền rút và xác nhận chuyển thủ công. Xế không tự ghi có/ghi nợ. |
| B08 | Hoa hồng hiện tại 1.000đ/delivery giao thành công. Nhận thì giữ; thành công thì trừ; hủy/trả/thất bại thì nhả giữ. |
| B09 | Rút tối thiểu 10.000đ, không vượt khả dụng. Giữ tiền trước khi chuyển, trừ sau khi xác nhận đã chuyển. |
| B10 | `orders` là đơn món; `deliveries` là yêu cầu giao. Chỉ quán tạo delivery, từ order xác nhận hoặc đơn ngoài app. |
| B11 | Khách gửi order xong không có chức năng tự sửa đơn/giờ hẹn trên app. Quán sửa trước xác nhận sau khi trao đổi; xác nhận thì khóa nội dung. |
| B12 | Được đặt hộ, giao cơ quan hoặc địa chỉ bất kỳ. Người đặt và người nhận lưu riêng. Không truy cập danh sách địa chỉ riêng của tài khoản khác. |
| B13 | Địa chỉ giao không bắt buộc GPS. Thêm nhanh được lưu cho người đặt và làm mặc định. |
| B14 | Giờ nhận hẹn phải trong giờ hoạt động. Quán chủ động gọi xế; giờ hẹn không tự tạo delivery hoặc nhắc thiếu xế trước lúc gọi. |
| B15 | Menu có hai lớp: `system_categories` và `shop_categories`; tên giữa hai lớp có thể trùng. Chưa model size/topping; dùng ghi chú. |
| B16 | Quán được sửa số lượng, đơn giá và tổng thỏa thuận trước xác nhận. Backend kiểm tra và lưu lịch sử, không nhận tổng tiền tùy ý từ khách. |
| B17 | Phí theo tuyến quán→điểm giao: 10.000đ + floor(distance_m/5.000) × 5.000đ. Dùng mét gốc, không lấy km đã làm tròn. |
| B18 | Đơn chưa tọa độ/phí chỉ xế trống được nhận. Trước lấy hàng phải có ghim điểm giao và phí thỏa thuận. |
| B19 | Xế hệ thống không giới hạn số delivery, không giới hạn vùng đăng ký khi nhận; xế ngoài mặc định tối đa 3, nhận theo vùng đăng ký. |
| B20 | Cả hai loại xế đều phải đã kích hoạt, bật nhận, đủ số dư, giữ điều kiện ghép bảo vệ mỗi đơn cũ trong 5 phút cộng dồn so với ETA gốc. |
| B21 | App không ép thứ tự giao; không tự hủy đơn đang giữ khi xế tắt nhận. |
| B22 | Quán đánh giá xế thực hiện sau delivery thành công hoặc thất bại, một đánh giá/delivery; điểm thấp không tự phạt. |
| B23 | Khách đánh giá quán chỉ sau order thành công, một đánh giá/order. Quán chỉ phản hồi; không sửa/xóa đánh giá khách. |
| B24 | Theo dõi GPS khi bật nhận hoặc còn delivery; người xem bị giới hạn theo quyền và thời gian. |
| B25 | Nhắc tìm xế sau 5 phút. Workflow cuối Bước 2 có hạn tìm 30 phút tính từ lần tạo delivery; xế nhận/trả không reset mốc gốc. |
| B26 | Không xóa cứng dữ liệu nghiệp vụ hoặc sửa trực tiếp bút toán đã ghi. |

Đối với quyền khách hủy: bản đầu Bước 2 từng có `cancelled_by_customer`; chỉ dẫn muộn hơn “gửi order là hoàn tất thao tác” và API hiện tại không cung cấp khách hủy. Bản rà soát chọn không mở API hủy/sửa phía khách. Có thể giữ enum cũ để đọc lịch sử, không cấp transition công khai.

### 1.2. Phân biệt các đối tượng hay bị trộn

| Đối tượng | Quản lý điều gì | Không dùng thay cho |
|---|---|---|
| User | Đăng nhập, phiên, quyền | Hồ sơ quán/xế/khách |
| Driver type | `SYSTEM` hoặc `EXTERNAL`, điều kiện nhận | Vai trò quản trị `SYSTEM` |
| Order | Món, người đặt/người nhận, giá thỏa thuận, xác nhận quán | Một lần tìm xế |
| Delivery | Một lần quán yêu cầu vận chuyển | Toàn bộ vòng đời order |
| Assignment | Một lần một xế nhận/trả/thực hiện delivery | Delivery hoặc ví |
| Wallet | Tiền nạp/rút/hoa hồng xế | Tiền hàng hoặc ship nhận từ khách |
| Search deadline | Giới hạn tìm xế của một delivery | Giờ khách muốn nhận hoặc thời hạn giao |
| Rating | Đánh giá chất lượng | Report sai kết quả giao hoặc lệnh phạt |

Đặc biệt: `driver_type = SYSTEM` tuyệt đối không suy ra quyền quản trị `role = SYSTEM`. Hai enum phải ở namespace riêng; không dùng chung hàm `isSystem()` để cấp quyền.

### 1.3. Luồng nghiệp vụ sau rà soát

**Khách đặt món:** chọn quán/món → chọn địa chỉ hoặc nhập nhanh → gửi order → quán trao đổi, sửa trước xác nhận nếu cần → quán xác nhận → quán chủ động gọi xế → dùng chung luồng delivery.

**Đơn ngoài app:** quán nhập người nhận, địa chỉ/mô tả, mô tả hàng và giá trị hàng → tạo delivery → dùng chung luồng giao. Không tạo order khách giả để gọi ship.

**Delivery:** tìm xế → nhận → xác định điểm giao/phí khi cần → lấy hàng → đang giao → thành công hoặc thất bại. Trước lấy hàng có thể trả/hủy; tìm quá hạn thì dừng. Delivery kết thúc không hồi sinh; gọi lại tạo một delivery mới có liên kết lịch sử.

**Tiền:** quản lý ghi nạp → số dư khả dụng → nhận delivery giữ hoa hồng → giao thành công trừ; các nhánh hủy/trả/thất bại nhả. Rút có khoản giữ riêng, không dùng chung tiền đó để nhận đơn.

### 1.4. Phương án cho tình huống chưa đủ quy tắc

Các lựa chọn dưới đây là phương án thiết kế được chọn trong lần rà soát này, không ghi giả thành lời người dùng đã chốt trước đây.

| Tình huống | Phương án được chọn |
|---|---|
| Tìm xế quá 30 phút | Dừng delivery đang `waiting_driver`, chuyển `search_stopped`; order vẫn `confirmed`. Quán có thể bấm gọi lại tạo delivery mới. |
| Đến hạn 30 phút nhưng xế đang giữ | Không tự thu hồi assignment. Nếu xế trả sau hạn thì kết thúc lần tìm đó thành `search_stopped`, không phát lại delivery cũ. |
| Delivery bị quán hủy | Hủy yêu cầu vận chuyển, không mặc định hủy order. Hủy order là lệnh riêng và xử lý delivery còn hoạt động cùng giao dịch. |
| Giao thất bại, hàng còn ở xế | Tạo sự cố đang mở. Không tự gọi xế khác đến quán khi hàng chưa về; không tự hoàn tiền hoặc tính là order thành công. |
| Muốn giao lại sau thất bại | Quán xác nhận hàng đã về/đã sẵn sàng tại điểm lấy rồi tạo delivery mới. Nếu không tiếp tục, quán hủy order sau khi hàng được xử lý. Lưu người và lý do xử lý sự cố. |
| Người nhận/đơn cần sửa sau confirm | Không mở khóa order. Nếu chưa pickup: quán hủy order/lần giao liên quan và xử lý lại; đơn thay thế ngoài app có liên kết tham chiếu cũ, không ghi đè snapshot gốc. |
| Mất tuyến đường để tính phí hệ thống | Quote trả lỗi tạm thời, cho thử lại. Order vẫn đã lưu. Không tự chuyển chế độ phí hoặc lấy khoảng cách thẳng thay tuyến. |
| Không có ETA đáng tin cậy | Cho xế trống nhận đơn mô tả theo quy tắc có sẵn; sau pickup nhắc theo thời gian đã lấy hàng. Không cho ghép khi chưa có baseline tuyến hợp lệ. |
| Xế tự chọn thứ tự giao | Kiểm tra ghép là dự báo tại thời điểm nhận, không bảo đảm xế thực đi đúng kế hoạch. Re-evaluate từ GPS/trạng thái mới trước lần nhận tiếp; không reset ETA gốc, không cưỡng ép thứ tự. |
| Ngoài giờ mở cửa hiện tại, đặt hẹn tương lai | Cho phép nếu quán bật nhận order, ngày/giờ nhận thuộc giờ hoạt động và quán không bị khóa. Đơn đặt ngay phải trong giờ mở cửa hiện tại. |
| Khung giờ qua nửa đêm | Chuẩn hóa thành hai đoạn liên tiếp, hỗ trợ mốc hết ngày; kiểm tra chồng lấn sau chuẩn hóa. Dùng múi giờ Việt Nam. |
| Phí thỏa thuận | Số nguyên VND, lớn hơn 0. Khi quá 500.000đ, yêu cầu xác nhận lại và lý do để tránh nhập thêm số 0; không đặt trần cứng khiến đơn xa không thể tạo. |
| Ví không đủ cho điều chỉnh thu thêm | Report ở trạng thái chờ xử lý. Không tạo số dư âm, không dùng tiền đang giữ cho delivery/rút khác. Sau nạp đủ, quản lý thực hiện adjustment một lần. |
| Đóng tài khoản còn dưới 10.000đ | Đóng quyền nhận đơn, giữ ví/lịch sử và quyền vào phần xử lý tiền. Trạng thái `pending_balance_resolution`; không xóa hoặc ghi đã hoàn. |
| Đánh giá quán | Khách gửi một lần, không sửa/xóa trong bản đầu. Quán có một phản hồi có thể cập nhật, có lịch sử. Không có API quán xóa/báo cáo đánh giá khách. |
| Đánh giá xế bị phản ánh | Không tự gỡ. Quản lý có thể ẩn khỏi điểm công khai khi xác minh sai, giữ bản gốc, lý do và audit; không tự phạt tiền. |

Mở sự cố không tự thu phí hay đóng order; nó giúp hiện đơn cần xử lý và ngăn gọi lại khi hàng chưa sẵn sàng. Các bên vẫn giải quyết hàng/tiền ngoài hệ thống.

## 2. Kiểm tra Bước 2 — workflow và database

### 2.1. Bộ trạng thái chuẩn

Giữ tên trạng thái cuối Bước 2, dùng `snake_case`; không dùng đồng thời một bộ uppercase khác trong API mới.

| Tên đã dùng trong danh mục API | Tên chuẩn |
|---|---|
| SEARCHING | `waiting_driver` |
| ASSIGNED | `accepted` |
| DELIVERING | `delivering`; cần giữ mốc `location_confirmed` và `picked_up` |
| DELIVERED | `completed` |
| FAILED | `failed` |
| CANCELLED | `cancelled_by_merchant` |
| Bị bỏ sót | `search_stopped` |

Đây là sửa đặc tả, chưa phải chuyển dữ liệu thật. Nếu repo đã có enum khác, tạo migration/mapping có kiểm thử; không đổi tên trực tiếp làm app cũ không đọc được.

#### Order

| Từ | Hành động | Sang | Ai / điều kiện |
|---|---|---|---|
| Chưa có | Gửi order | `pending_confirmation` | Khách; kiểm món/giá/địa chỉ/giờ |
| `pending_confirmation` | Sửa nội dung | Giữ trạng thái | Quán sau trao đổi; version và audit |
| `pending_confirmation` | Xác nhận | `confirmed` | Quán; khóa nội dung và order_items |
| `pending_confirmation` | Từ chối | `rejected` | Quán; bắt buộc lý do |
| `confirmed` | Gọi xế | Giữ trạng thái | Quán; tạo delivery, không tạo order thứ hai |
| `confirmed` | Hủy order | `cancelled_by_merchant` | Quán; không còn hàng đang được xế vận chuyển; hủy delivery chưa pickup cùng transaction |
| `confirmed` | Delivery liên kết thành công | `completed` | Backend, với đúng delivery hiện hành |

`cancelled_by_customer` là trạng thái lịch sử nếu tồn tại; bản đầu không có API khách chuyển vào đó. Không tự tạo `preparing` hoặc `ready`, đã chốt quán chủ động gọi xế.

Delivery `failed`, `search_stopped` hoặc bị hủy không tự làm order `completed`. Order còn `confirmed` kèm thông tin lần giao hiện hành và cờ cần xử lý. Không để người dùng chỉ thấy “đã xác nhận” mà không biết lần giao thất bại.

#### Delivery

| Từ | Hành động | Sang | Tác động |
|---|---|---|---|
| Chưa có | Quán gọi xế | `waiting_driver` | Snapshot + hạn tìm cố định + outbox |
| `waiting_driver` | Quán sửa | Giữ trạng thái | Chỉ trường vận chuyển được phép; không đổi order đã khóa |
| `waiting_driver` | Xế nhận | `accepted` | Assignment + giữ hoa hồng + snapshot policy |
| `accepted` | Xác định điểm giao | `location_confirmed` | Ghim giao, thông tin phí; không xác nhận đã lấy hàng |
| `accepted` / `location_confirmed` | Xế trả trước pickup | `waiting_driver` hoặc `search_stopped` | Kết thúc assignment, nhả giữ; giữ hạn tìm cũ |
| `waiting_driver` / `accepted` / `location_confirmed` | Quán hủy delivery | `cancelled_by_merchant` | Kết thúc assignment nếu có, nhả giữ |
| `waiting_driver` | Hết hạn tìm | `search_stopped` | Worker; không có assignment active |
| `accepted` / `location_confirmed` | Xác nhận lấy hàng | `picked_up` | Đủ tọa độ/phí; ghi snapshot thanh toán hướng dẫn |
| `picked_up` | Bắt đầu giao | `delivering` | Backend tự thực hiện trong lệnh pickup |
| `delivering` | Giao thành công | `completed` | Capture hoa hồng, kết thúc assignment, đồng bộ order |
| `delivering` | Giao thất bại | `failed` | Nhả giữ, tạo sự cố hàng, thông báo |

Để không thêm nút không cần thiết, một lệnh pickup có thể ghi sự kiện `location_confirmed` khi cần, `picked_up`, rồi `delivering` trong cùng transaction. Response trả trạng thái cuối; lịch sử vẫn có mốc nhận hàng. Không để worker phải chạy mới biến đơn đã lấy thành đang giao.

Các trạng thái `completed`, `failed`, `cancelled_by_merchant`, `search_stopped` là terminal cho lần delivery đó. Điều chỉnh kết quả dùng bản ghi adjustment riêng, không quay delivery về trạng thái đang hoạt động.

#### Assignment

Mỗi lần xế nhận tạo assignment mới. Tối đa một assignment active/delivery. Trả rồi xế khác nhận tạo bản mới; giữ snapshot hoa hồng, loại xế, policy, thời gian và lý do kết thúc của lần cũ.

### 2.2. Quan hệ order–delivery và gọi lại

Một order có 0..n delivery trong lịch sử; tối đa một delivery đang hoạt động. Không đặt UNIQUE toàn bộ `deliveries.order_id`.

Order trả về `active_delivery_id`, `latest_delivery_id` và có API xem lịch sử; không dùng một `delivery_id` mơ hồ cho mọi lần gọi.

Ràng buộc áp dụng cho các trạng thái `waiting_driver`, `accepted`, `location_confirmed`, `picked_up`, `delivering`. Khi `order_id` khác null, dùng unique index có điều kiện hoặc cơ chế tương đương tại database.

Terminal event của delivery cũ chỉ được đồng bộ order nếu quan hệ hiện hành/version phù hợp. Sự kiện cũ đến muộn không được ghi đè lần giao mới. Order đã thành công không được gọi thêm delivery thường.

`delivery_items` cho order app được snapshot từ order đã xác nhận ngay lúc gọi xế: tên món, số lượng, ghi chú để quán–xế đối chiếu. Đơn ngoài app dùng `item_description` ngắn và giá trị hàng; không bắt quán dựng menu/order_items.

### 2.3. Thời gian tìm xế

- `search_started_at` lưu lúc tạo delivery.
- `search_deadline_at = search_started_at + 30 phút`, snapshot cấu hình.
- Nhắc tìm xế sau 5 phút, không reset do xế nhận rồi trả.
- Khi đang `accepted`/`location_confirmed`, hạn tìm không tự cắt assignment. Nếu trả trước pickup mà đã qua hạn, kết thúc delivery thành `search_stopped` ngay.
- Nhận và worker dừng tìm phải kiểm tra thời gian phía server trong transaction. Tại hoặc sau deadline, không nhận mới delivery đang tìm.
- Quán gọi lại tạo delivery mới, deadline mới; có `previous_delivery_id` hoặc quan hệ lịch sử.
- Giờ hẹn khách, ETA giao và hạn tìm là ba dữ liệu riêng.

### 2.4. Những ràng buộc dữ liệu cần bổ sung/đối chiếu

Các tên dưới đây là mô hình logic chuẩn để viết migration; không xác nhận rằng từng cột đang tồn tại trong database.

| Nhóm | Ràng buộc/cột cần có |
|---|---|
| Users | SĐT chuẩn hóa unique; password_hash; verified_at; status; không nhận role quản trị từ register. |
| Roles/scopes | user_roles, admin_scopes theo miền; permission theo thao tác; namespace riêng khỏi driver_type. Chỉ SYSTEM quản trị được cấp quyền. |
| Profiles | customer tối giản; shop_members kiểm quán; driver một hồ sơ/user, loại xế và version. Hồ sơ customer và liên kết role tạo cùng transaction. |
| Driver type | `driver_type` mặc định EXTERNAL; chỉ quản lý đúng quyền sửa; log lý do; type version kiểm lại lúc accept. |
| Bank details | Số tài khoản/tên/ngân hàng; trạng thái kiểm tra, verified_by/at; thay thông tin thì mất xác minh. Withdrawal lưu snapshot đã duyệt. |
| Shops | status, accepting_orders, vị trí lấy; `is_open_now` là giá trị tính, không phải cờ tự nhập. |
| Business hours | Nhiều đoạn/ngày, khoảng nửa mở [bắt đầu,kết thúc), hỗ trợ mốc cuối ngày; timezone Việt Nam; version. |
| Addresses | Thuộc người đặt; mô tả không rỗng; lat/lng cùng null hoặc cùng có; tối đa một mặc định active/khách. |
| Categories | system và shop độc lập; shop_category thuộc đúng shop; ngừng dùng không xóa quan hệ cũ. |
| Menu items | Giá VND nguyên không âm; active khác available; sort_order; version giá; không model size/topping. |
| Orders | Người đặt, recipient snapshot, giờ hẹn, status/version, tổng tính và tổng thỏa thuận, snapshot xác nhận. |
| Order items | Tên/giá/số lượng/ghi chú snapshot; quantity nguyên dương, line_total từ backend. |
| Deliveries | order_id nullable; shop, source, previous_delivery_id; snapshot vận chuyển; thời hạn tìm; version; fee_mode, fee nullable, policy snapshot. |
| Delivery items | Bản đối chiếu hàng cho đơn app; không tự đổi khi menu thay. |
| Assignments | Một active/delivery; version, driver_type/commission policy snapshot, ETA gốc và hạn bảo vệ bất biến. |
| Routing | Driver routing version; các stop chưa hoàn tất; đánh giá dự báo; không dùng thứ tự dự báo để ép xế. |
| Locations | Sample ID chống trùng, captured_at/received_at, accuracy; không để mẫu cũ/future ghi đè. |
| Wallet | Một ví/xế; balance, active holds; khả dụng không âm trong luồng thường; ledger append-only. |
| Holds | Unique theo purpose/reference; ACTIVE/CAPTURED/RELEASED; terminal xử lý một lần. |
| Topups | Quản lý tạo; số thực nhận, bank reference, actor/time; một giao dịch ngân hàng không dùng cho hai khoản nạp. |
| Withdrawals | Quản lý tạo, amount >= 10.000, một hold; snapshot ngân hàng; xử lý/chờ đối soát; không nhả sau chuyển chưa rõ. |
| Incidents/adjustments | Delivery failed, tình trạng hàng và người xử lý; delta hoa hồng một lần; gắn report, không sửa nguồn. |
| Driver ratings | Unique delivery_id; đúng assignment thực hiện; stars 1..5; report/moderation có audit. |
| Shop ratings/replies | Unique order_id; đúng customer/shop; order completed; tối đa một reply hiện hành/rating, lịch sử thay đổi. |
| Events/outbox/jobs | Event ID, resource version, dedupe; reminder có trạng thái; gửi sau commit, cancel job terminal. |
| Idempotency/audit | actor + operation + key, hash request, resource/result; giữ uniqueness nghiệp vụ kể cả khi cache kết quả hết hạn. |

Danh mục bảng cuối Bước 2 từng dùng các tên như wallets/transactions, còn tài liệu cũ dùng wallet_accounts/holds/entries. Đây là cùng ranh giới nghiệp vụ, không tạo cả hai bộ bảng trùng chức năng. Chọn một tên trong schema manifest của task nền tảng rồi dùng xuyên dự án.

### 2.5. Giá quán sửa và tổng thỏa thuận

Ở checkout, chỉ giá server được dùng. Giá khách gửi là `expected_unit_price` để phát hiện thay đổi, không phải giá mới.

Khi quán sửa trước confirm, backend cho đơn giá thỏa thuận theo từng dòng; tính `subtotal_vnd = sum(quantity × unit_price_vnd)`. Nếu quán chốt tổng khác subtotal, lưu `agreed_total_vnd` cùng `adjustment_vnd = agreed_total_vnd - subtotal_vnd` và lý do. Không để trường total tùy ý âm hoặc có hai cách tính mâu thuẫn.

Delivery dùng tổng đã chốt làm giá trị hàng; không cộng/trừ khoản này vào ví. Không xây module thu hộ/COD.

### 2.6. Giao dịch nguyên tử và race condition

| Lệnh | Phải commit cùng nhau |
|---|---|
| Register | Consume verification + user + session; tránh một proof tạo nhiều tài khoản |
| Tạo hồ sơ | Profile + vai trò/link sở hữu tương ứng |
| Gửi order nhập nhanh | Order + items + snapshot + address/default + outbox; lỗi đặt món không tạo order dở |
| Confirm | Kiểm version + nội dung/giá/giờ hợp lệ + khóa snapshot + event |
| Call driver | Kiểm order/shop + ràng buộc một active delivery + snapshot/items + deadline + outbox |
| Accept | Kiểm quyền/type/version/deadline + assignment + hold + tuyến/version + event |
| Return/cancel | State + assignment ended + hold release + route invalidation + job/outbox |
| Pickup | Ghim/phí đủ + status events + money summary snapshot + route invalidation + outbox |
| Complete | Delivery + assignment ended + hold capture + ledger debit + order sync + job/outbox |
| Fail | Delivery failed + assignment ended + hold release + incident + order attention + job/outbox |
| Topup + approve | Bank uniqueness + credit + ledger + activation khi đủ điều kiện + audit |
| Withdrawal create | Request + hold + snapshot ngân hàng |
| Withdrawal paid | State + capture hold + debit + audit; không chuyển tiền qua API này |
| Outcome adjustment | Report + adjustment + ledger delta + hiệu lực kết quả/audit; không replay complete |
| Shop rating | Kiểm order hoàn thành/owner + unique rating; terminal outcome không bị sửa bởi rating |

Không gọi dịch vụ tuyến đường khi đang giữ lock dài. Tính ngoài transaction, rồi kiểm lại version xế/đơn/loại xế/quyền/ví/policy và tuổi kết quả trước commit. Các operation chạm cùng tài nguyên phải theo thứ tự khóa thống nhất, có retry giới hạn khi xung đột.

Khóa routing aggregate của từng driver để hai request nhận hai delivery khác nhau vẫn được tuần tự hóa. Khóa ví chung cho nhận đơn/rút/điều chỉnh. `expected_version` của delivery một mình không bảo vệ được giới hạn số đơn/ví của xế.

PostgreSQL có row lock và unique index có điều kiện phục vụ các ràng buộc này; chúng vẫn cần đúng transaction và test đồng thời. Tài liệu kỹ thuật: [row locks](https://www.postgresql.org/docs/current/explicit-locking.html), [partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html).

## 3. Kiểm tra Bước 3 — API và quyền

### 3.1. Một quy ước chung

- Base path chuẩn của hợp đồng là `/v1`. Deployment có thể đặt gateway prefix, client không tự trộn `/api/v1` vào spec.
- JSON `snake_case`; ID chuỗi bất biến; tiền nguyên VND; khoảng cách mét; timestamp ISO 8601 UTC, UI theo giờ Việt Nam.
- Trường chưa xác định trả `null`, không thay bằng 0; đặc biệt phí, ETA và điểm đánh giá.
- HTTP 201 tạo mới, 200 cập nhật/đọc, 204 cho operation không có body; schema ghi chính xác từng response.
- Error gồm `code`, `message`, `request_id`, `details` có whitelist. 401 chưa xác thực; 403 đúng tài khoản thiếu quyền; 404 khi cần tránh lộ đối tượng; 409 state/version/trùng; 422 dữ liệu nghiệp vụ; 429 rate limit; 503 phụ thuộc tạm lỗi.
- Mutation có Idempotency-Key; cùng actor/operation/key và body trả cùng kết quả; body khác trả 409. GET không tạo tác động.
- Kiểm tra quyền hiện tại trước khi replay kết quả nhạy cảm. Thu hồi phiên/quyền có hiệu lực với API và realtime, không chỉ nút UI.
- Client giữ nguyên key khi mất phản hồi. Khi người dùng sửa nội dung tạo một operation/key mới.
- Actor và phạm vi luôn từ phiên/quyền backend; không tin user_id/driver_id/shop_id trong body để cấp quyền.
- OpenAPI của từng module phải có schema request/response, security, tất cả lỗi, example và operation_id. Danh mục endpoint không phải hợp đồng hoàn chỉnh. Chuẩn tham khảo: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html).

### 3.2. Các thiếu sót API đã xác định và phương án

| ID | Vấn đề | Mức | Phương án |
|---|---|---|---|
| F01 | Hai bộ enum/status khác nhau; thiếu `search_stopped` | P0 | Dùng state machine mục 2.1, mapping legacy riêng. |
| F02 | API không thể hiện hạn tìm 30 phút | P0 | Deadline snapshot, worker dừng khi waiting; accept kiểm deadline. |
| F03 | Hủy delivery bị lẫn hủy order | P0 | Endpoint riêng; cancel order cascade trước pickup nguyên tử. |
| F04 | Một delivery_id không biểu diễn gọi lại | P0 | 0..n lịch sử, tối đa một active; trả active/latest, API history. |
| F05 | Failed có thể bị hiểu completed hoặc gọi lại khi hàng ở xế | P0 | Incident hàng, không đánh giá quán, gọi lại sau sẵn sàng tại điểm lấy. |
| F06 | Nội dung khách sửa/hủy cũ mâu thuẫn chỉ dẫn mới | P1 | Không mở customer edit/cancel; quán sửa trước confirm. |
| F07 | Login app_type chặn tài khoản mới chưa có role, không vào onboarding được | P0 | Cho authenticated onboarding khách/quán/xế; thao tác vận hành vẫn yêu cầu profile/role. App quản lý vẫn cần quyền trước. |
| F08 | Nhầm SYSTEM driver với SYSTEM admin | P0 | Namespace riêng, kiểm quyền độc lập; test chống nâng quyền. |
| F09 | Vừa approve activation vừa topup có thể cộng hai lần | P0 | Một command nạp-và-duyệt, unique bank transaction; normal topup không replay khoản đó. |
| F10 | Xế tạo topup/withdraw trong spec cũ trái tiền thủ công | P0 | Bỏ endpoint xế ghi tiền; quản lý là actor; xế chỉ đọc tiền. |
| F11 | Thiếu trạng thái chuyển tiền chưa rõ | P0 | Withdraw PROCESSING/RECONCILIATION giữ hold, chặn cancel/retry chuyển. |
| F12 | Tên ngân hàng tự nhập bị xem như đã xác minh | P0 | So khớp chuẩn hóa + quản lý xác minh; đổi thì revoke verified; payout snapshot. |
| F13 | Miễn số đơn/vùng cho xế hệ thống dễ bị miễn cả ghép/số dư | P0 | Policy evaluator theo từng điều kiện, không dùng bypass tất cả. |
| F14 | Tuyến tối ưu dự báo bị xem là bảo đảm giao thực tế | P1 | Ghi đây là dự báo, không ép thứ tự; cập nhật đánh giá trước mỗi lần nhận thêm. |
| F15 | Thêm địa chỉ nhanh thiếu hợp đồng inline và chống trùng | P1 | Order nhận address_id hoặc recipient inline, đúng một lựa chọn; transaction chung. |
| F16 | Quán không sửa được đơn giá/tổng như đã chốt | P1 | Chốt subtotal/agreed total và audit trước confirm. |
| F17 | Thiếu `delivery_items` để đối chiếu hàng | P1 | Snapshot từ order khi call; ngoài app dùng item_description. |
| F18 | Các field is_open/status/availability bị dùng lẫn | P1 | Tách rõ và xử lý order hẹn khi hiện tại đóng cửa. |
| F19 | Ngừng category làm món biến mất/không nhóm | P1 | Giữ liên kết; UI có nhóm “Khác” cho món active không thuộc nhóm hiển thị active. Cho quản lý chuyển nhóm. |
| F20 | Chưa có sửa SĐT đăng nhập an toàn | P1 | Endpoint riêng, xác minh SĐT mới + mật khẩu hiện tại; không dùng sửa contact_phone để đổi login. |
| F21 | Ảnh URL có schema nhưng thiếu upload | P1 | Upload API có quyền/loại/dung lượng; object đã upload mới được gắn vào profile/menu. |
| F22 | Khóa user làm xế đang có hàng không xử lý được | P0 | Disable chặn phiên và nhận mới; mở case vận hành ngay. Quản lý xử lý có audit, không giả thành giao xong/nhả trách nhiệm. |
| F23 | Cần lịch sử chi tiết/đơn ngoài app nhưng GET bị thiếu | P1 | Thêm delivery detail role-scoped và events; returned driver dùng projection giới hạn. |
| F24 | Outcome correction không đồng bộ rating/commission | P0 | Effective outcome từ adjustment; rating quán kiểm lại eligibility; giữ record và history, không xóa âm thầm. |
| F25 | Push/logout có thể gửi dữ liệu tài khoản cũ | P0 | Token gắn session/installation/user; kiểm binding lúc gửi; payload tối thiểu, fetch có auth. |
| F26 | Client tự set status, tiền, type hoặc quyền bằng PATCH | P0 | Field whitelist; command riêng cho nghiệp vụ; reject unknown/forbidden fields. |
| F27 | Chưa có contract event/reconnect | P1 | Event ID/resource version/cursor; sau reconnect fetch trạng thái authoritative. |
| F28 | Xế hệ thống nhiều đơn làm thuật toán ghép bùng tổ hợp | P1 | Heuristic tính có ngân sách, không vét toàn bộ hoán vị; chưa chứng minh được tuyến thì trả lỗi tính tuyến, không lén áp giới hạn số đơn. |
| F29 | Quản lý module scope bị hiểu là toàn quyền | P0 | Scope miền + permission thao tác + vùng; SYSTEM quản trị bootstrap qua tooling nội bộ, không public register. |
| F30 | Thiếu endpoint đóng hồ sơ còn tiền/đơn | P1 | Closure request và trạng thái chờ xử lý; không xóa user/wallet hoặc tự hoàn 100.000đ. |

P0: phải xử lý trước khi đưa luồng tương ứng vào pilot. P1: phải hoàn thiện trước nghiệm thu module đó. Đây là lỗi/khoảng trống của đặc tả, chưa phải lỗi được tái hiện trong phần mềm.

### 3.3. Endpoint bổ sung và chuẩn hóa

Danh mục này là phần bù cho 3.1–3.12 đã trao đổi; phải viết schema đầy đủ trong task contract từng module.

| API chuẩn | Mục đích / lưu ý |
|---|---|
| `POST /v1/auth/change-phone` | OTP mục đích CHANGE_PHONE, SĐT mới chưa dùng, mật khẩu hiện tại; cập nhật account/thu hồi phiên khác; giữ user_id. |
| `POST /v1/auth/phone-verifications/{id}/resend` | Cooldown/rate limit, mã mới vô hiệu mã cũ, retry không gửi nhiều OTP. |
| `POST /v1/auth/logout-all` | Thu hồi toàn bộ phiên của chính user. |
| `POST /v1/uploads` | Ảnh avatar/menu; trả upload_id/object_id và hướng dẫn transfer, không nhận URL tùy ý làm ownership. |
| `POST /v1/uploads/{id}/complete` | Backend kiểm object, định dạng/dung lượng/quyền; không coi upload thành công khi chưa có byte. |
| `GET /v1/service-areas` | Vùng active để quán/xế đăng ký. |
| `PUT /v1/drivers/me/bank-account` | Lưu thông tin và chuyển chưa xác minh sau thay đổi. |
| `POST /v1/admin/drivers/{id}/bank-account/verify` | Quản lý ghi đã kiểm đúng tên/thông tin; audit. |
| `POST /v1/admin/drivers/{id}/approve` | Version + khoản nạp mới (amount thực nhận/bank reference) hoặc tham chiếu khoản đã ghi có; credit nếu mới và activate một lần khi đủ điều kiện. Không nạp lần thứ hai. |
| `POST /v1/admin/drivers/{id}/topups` | Quản lý ghi tiền nạp thông thường hoặc nạp thiếu ngưỡng trước kích hoạt; không tự activate. |
| `POST /v1/admin/withdrawals/{id}/start-processing` | Đánh dấu đang xử lý chuyển; hold còn nguyên. |
| `POST /v1/admin/withdrawals/{id}/reconcile` | Xác nhận chưa chuyển, chuyển thành công hoặc tiếp tục chưa rõ; chỉ quyết định đã xác minh, có audit. |
| `GET /v1/merchant/shops/{shop_id}/orders/{id}/deliveries` | Lịch sử gọi xế của order. Customer detail có projection tương ứng. |
| `POST /v1/merchant/shops/{shop_id}/orders/{id}/cancel` | Hủy order khi chưa pickup; cascade delivery chưa pickup, không đánh giá quán. |
| `POST /v1/shipping-quotes` | Quote server tính; bind shop/pickup/destination/policy/version, expires_at. |
| `GET /v1/deliveries/{id}` | Projection theo actor: quán/customer-linked/current driver/returned driver/admin. Không chỉ dựa role global. |
| `GET /v1/deliveries/{id}/events` | Lịch sử được phép xem, không lộ ledger/ngân hàng hay liên hệ assignment khác. |
| `POST /v1/deliveries/{id}/confirm-destination` | Current driver trước pickup, áp dụng phí thỏa thuận; lưu ghim điểm giao/phí. Pickup cũng có thể gửi cùng thông tin nguyên tử. |
| `POST /v1/merchant/shops/{shop_id}/delivery-incidents/{id}/resolve` | Quán xác nhận hàng đã sẵn sàng lại hoặc đã xử lý xong; không tự ghi hoàn tiền. |
| `POST /v1/admin/driver-rating-reports/{id}/resolve` | Xử lý phản ánh đánh giá xế có audit; không liên quan shop rating reply. |
| `POST /v1/drivers/me/closure-requests` | Xin ngừng/đóng hồ sơ, không phải lệnh rút tiền tự động. |
| `POST /v1/admin/closure-requests/{id}/resolve` | Xử lý đơn, giữ tiền/số dư; không xóa dữ liệu. |

PATCH trực tiếp delivery từ order chỉ sửa ghi chú vận chuyển hoặc dữ liệu vận chuyển được quy định, không sửa món/giá/recipient đã khóa của order. Ghim tọa độ xác minh tại pickup được lưu như enrichment của delivery, không ghi đè địa chỉ snapshot order.

### 3.4. Hợp đồng order đặt hộ/địa chỉ nhanh

`POST /v1/orders` có đúng một trong hai lựa chọn:

1. `customer_address_id`: backend kiểm địa chỉ thuộc tài khoản đặt; recipient tại đó có thể là người khác.
2. `recipient`: tên người nhận tùy chọn, contact_phone và address_description bắt buộc, latitude/longitude tùy chọn. Lưu địa chỉ cho người đặt, đặt mặc định, tạo order trong cùng transaction.

Không được gửi cả hai; không nhận customer_id khác để mạo danh người đặt. `items` phải cùng shop, quantity nguyên dương. `scheduled_receive_at` null là đặt ngay. Những field như status, grand_total do khách gửi không được áp dụng.

Sửa địa chỉ/profile sau đặt không đổi snapshot order. Quán sửa recipient trước confirm phải audit và không tự sửa sổ địa chỉ riêng của khách.

### 3.5. Hợp đồng tiền thủ công

**Nạp:** `amount_vnd` nguyên dương, bank reference chuẩn hóa, driver target, note tùy chọn, actor từ phiên quản lý. Reference phải gắn tài khoản nhận/ngân hàng để chống dùng lại, không dựa ảnh chuyển khoản. Quản lý chịu trách nhiệm xác nhận thực nhận; backend không giả có kết nối ngân hàng.

**Kích hoạt:** có thể nhận đủ trong một lần hoặc cộng các khoản hợp lệ đã ghi. Lúc duyệt đầu tiên phải đạt yêu cầu kích hoạt 100.000đ, số dư khả dụng tối thiểu 100.000đ và đủ hồ sơ; khoản nạp và thao tác approve chung một command nếu quản lý chọn “Nạp và duyệt”. Nạp chưa đủ được ghi qua topup thường, không làm active. Nếu đã ghi đủ tiền qua topup trước đó, approve chỉ tham chiếu các khoản đã ghi, không yêu cầu chuyển/nạp thêm hoặc credit lại. Khoản nạp mới và tham chiếu khoản cũ là hai chế độ input loại trừ nhau. Sau active, không bắt giữ nguyên 100.000đ; đây là tiền trả hoa hồng.

**Rút:** quản lý nhập amount >= 10.000, backend kiểm available và ngân hàng đã xác minh. Lưu payout snapshot + hold. Đang xử lý/chưa rõ chuyển có thành công phải giữ tiền. `mark-paid` ghi đúng amount của request và bank ref; không cho sửa số tiền sau khi chuyển bằng PATCH. Nếu thực chuyển lệch số đã giữ, chuyển case đối soát và tạo adjustment phù hợp, không tự giả bằng nhau.

**Sửa sai:** reverse/adjustment tham chiếu bút toán gốc và lý do, có quyền tiền; không PUT amount của ledger entry. Điều chỉnh debit vẫn kiểm available, không lấy tiền đang hold.

Tên chủ tài khoản được chuẩn hóa Unicode/khoảng trắng/case để so khớp, không fuzzy-match tự động bỏ qua sai khác. Trường tự nhập trùng tên không chứng minh ngân hàng sở hữu đúng người: cần quản lý xác minh; sửa tên xế/ngân hàng thì reset verification cho các lệnh rút mới.

### 3.6. Quyền và realtime

| Actor | Phạm vi |
|---|---|
| Customer | Hồ sơ/địa chỉ/order của người đặt; tracking của delivery đang làm order đó; shop rating nếu completed. Người nhận không tự có quyền truy cập chỉ vì trùng SĐT. |
| Merchant | Quán có membership và permission tương ứng; order/delivery/rating của quán đó. |
| Current driver | Delivery của assignment active; chỉ lệnh hợp lệ theo status. |
| Returned driver | Lịch sử chính assignment đã kết thúc; không có GPS/liên hệ mới/quyền mutation delivery. |
| SYSTEM driver | Giống driver, chỉ miễn hai điều kiện count/registered-area; không admin scope hoặc quyền tiền. |
| Admin | Module scope + action permission + vùng dữ liệu được cấp. Quyền đọc bản đồ không suy ra quyền nạp/rút hay sửa chính sách. |
| SYSTEM quản trị | Cấp scope/permission qua quản trị nội bộ; mọi thay đổi ghi log; không tự đăng ký ngoài app. |

Notification/WS event chỉ chứa event_id, loại, resource_id, resource_version và thời gian; không để SĐT/địa chỉ/ngân hàng chi tiết trên payload khóa màn hình. Khi mở thông báo, API kiểm quyền hiện tại và trả trạng thái thật. Đổi tài khoản trên cùng installation thì token phải rebind; worker kiểm binding ngay trước gửi.

Realtime join/subscribe phải được kiểm quyền như GET. Khi mất kết nối, fetch lại hoặc dùng cursor đủ; client bỏ event trùng/cũ. Resource version chỉ so trong cùng resource, không so version order với delivery.

Push là thông báo vận hành, không phải nguồn dữ liệu trạng thái. Cách FCM xử lý notification/data khác nhau theo foreground/background, nên kiểm thử nền trên máy thật là một mốc riêng: [FCM message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type).

## 4. Thông số khởi đầu và phần cần dữ liệu thật

### 4.1. Giá trị có sẵn

| Cấu hình | Giá trị |
|---|---|
| driver_activation_vnd | 100.000 |
| commission_vnd | 1.000 |
| minimum_withdrawal_vnd | 10.000 |
| external_max_active_deliveries | 3 |
| system_max_active_deliveries | null = không giới hạn |
| max_cumulative_batch_delay_seconds | 300 |
| search_reminder_after_seconds | 300 |
| search_timeout_seconds | 1.800 |
| fee_base_vnd / distance_step_m / fee_step_vnd | 10.000 / 5.000 / 5.000 |

### 4.2. Giá trị được chọn để thử trên staging/pilot

Đây là cấu hình khởi đầu để đo và hiệu chỉnh, không phải cam kết chất lượng giao hoặc đặc tính nhà cung cấp. Một version policy hoàn chỉnh phải chứa các giá trị này, không có số rải rác trong code.

| Cấu hình | Giá trị khởi đầu |
|---|---|
| quote_ttl_seconds | 300, chỉ kiểm khi dùng quote để tạo/sửa delivery; phí đã snapshot không hết hạn theo quote |
| location_max_age_for_batch_seconds | 60 |
| location_max_accuracy_for_batch_m | 100 |
| location_allowed_future_skew_seconds | 30; vượt thì loại khỏi dữ liệu tính tuyến |
| route_evaluation_ttl_seconds | 30; phải kiểm lại các resource version |
| pickup_service_seconds / dropoff_service_seconds | 180 / 120 |
| new_delivery_eta_max_seconds | 3.600, chỉ áp dụng khi nhận ghép; đơn xa đầu tiên xế tự quyết định |
| delivery_reminder_interval_seconds | 300 |
| delivery_reminder_max_count | 3; sau đó case chậm vẫn hiện cho quản lý, không tự hoàn thành |
| delivery_overdue_grace_seconds | 0 sau hạn đã snapshot gồm mức bảo vệ 300 giây |
| unknown_eta_reminder_after_pickup_seconds | 1.800; nhắc theo thời gian lấy hàng, hiển thị chưa có ETA |
| GPS gửi khi foreground / background đang làm việc | Mục tiêu 15 / 30 giây; app ghi rõ OS có thể làm chậm, không giả đạt chu kỳ |
| OTP expiry / resend cooldown / max wrong attempts | 300 giây / 60 giây / 5 lần mỗi challenge |
| OTP send limits | 5 lần/giờ/SĐT và 20 lần/ngày/SĐT; giới hạn bổ sung theo IP/device, hiệu chỉnh tránh chặn mạng dùng chung |
| Password length | 8–128 ký tự, không tự trim; không ép quy tắc hoa/thường làm sai mật khẩu |
| Access session / refresh idle / absolute lifetime | 15 phút / 30 ngày / 90 ngày; revoke vẫn kiểm ở backend |
| Idempotency result retention | 7 ngày cho command thường, 90 ngày cho command tiền; uniqueness nghiệp vụ lưu theo lịch sử lâu dài |
| Upload ảnh | Tối đa 5 MiB, JPEG/PNG/WebP, xác minh nội dung thực; ảnh phụ trợ không được mở quyền đối tượng |
| Danh sách | cursor mặc định 20, tối đa 100; không có GET tải toàn bộ lịch sử |
| GPS samples | Dữ liệu raw khởi đầu 30 ngày; log sự kiện nghiệp vụ chỉ giữ thông tin cần thiết theo quy trình dữ liệu riêng |

Baseline ETA của một assignment không được tính lại để nới giới hạn. Đơn chưa tọa độ có baseline null; sau xác nhận tọa độ/tuyến lần đầu ghi baseline một lần. Khi chưa thể ghi baseline, không ghép. Search deadline, reminder deadline và baseline dùng clock server.

Route evaluator không dùng vét cạn với xế SYSTEM nhiều đơn. Dùng heuristic xác định và budget 2 giây cho xử lý nội bộ sau khi có matrix hợp lệ; nếu hết budget trả `ROUTE_EVALUATION_INCONCLUSIVE` và có thể thử lại, không thông báo “vượt số đơn”. Một tuyến feasible chỉ chứng minh khả năng dự báo; không thể chứng minh người lái sẽ chọn đúng thứ tự.

### 4.3. Không thể thay bằng giả định

| Đầu vào thật | Cách xử lý / task |
|---|---|
| Repo/commit 11Ship hiện có | Xác định trong M00; không dùng repo PetServe hoặc Ốc11. Không ghi đã có source/CI nếu chưa xem. |
| Provider OTP, thông tin kết nối và kênh gửi | M01 có adapter fake chỉ staging; hoàn thành tích hợp thật trước test đăng ký pilot. |
| Map/routing provider và địa chỉ Cao Bằng | M06 thử mẫu địa chỉ thực; staging có dữ liệu route giả gắn nhãn, không dùng giả trong live. |
| Polygon vùng pilot và nhóm quán/xế | M02 nhận dữ liệu thật trước phát đơn pilot; không tự tạo ranh giới thành phố. |
| Hạ tầng/domain/push/signing và iPhone test | M00/M08 xác minh trước build/test thiết bị. Android pass không thay iOS pass. |
| Ngân hàng nhận nạp và thông tin rút | M04 do quản lý cấu hình thông tin đúng, không suy ra số tài khoản từ hội thoại. |
| Công nghệ/phiên bản tương thích | Tiếp tục phương án một backend chia module, PostgreSQL, Flutter, web React/NestJS theo kế hoạch; M00 kiểm tra và khóa version cụ thể, không tự chọn “latest” khi chưa build. |

Thiếu đầu vào thật chỉ chặn task phụ thuộc nó. Có thể hoàn thiện contract/migration/test fixtures trước; không dừng toàn bộ thiết kế vì chưa có nhà cung cấp.

## 5. Chia module để triển khai

### 5.1. Nguyên tắc

Một repo, một backend chia module, một bộ contract dùng chung. Không tạo 13 hệ thống độc lập rồi ghép cuối. Mỗi module sở hữu dữ liệu, expose service/command; không cho module khác ghi trực tiếp bảng nghiệp vụ của nó. Workflow coordinator mở transaction dùng chung khi order/delivery/ví cần commit nguyên tử.

Các app là bề mặt triển khai, không có bản sao quy tắc nghiệp vụ riêng. Contract/model được sinh hoặc kiểm tra từ nguồn chung. Mỗi task chỉ nhận tài liệu module, contract, schema phần liên quan, test ID và commit nền.

### 5.2. Danh mục và phụ thuộc

| Module | Sở hữu | Phụ thuộc | Kết quả chạy được |
|---|---|---|---|
| M00 Nền tảng | Repo, môi trường, migration harness, schema manifest, error/idempotency/audit primitives, CI | Không | Backend khởi động, test DB riêng, pipeline, contract checker |
| M01 Tài khoản/quyền | User, roles/scopes, OTP, sessions, onboarding | M00 | Đăng ký/đăng nhập, revoke, bảo vệ API |
| M02 Vùng và quán | Service areas, shops/members, business hours/availability | M01 | Quán đăng ký trong vùng, quản lý hồ sơ và nhận đơn |
| M03 Hồ sơ xế | Driver/type/areas/bank/approval/availability/closure | M01, M02; M04 cho approve có tiền | Hồ sơ, phân loại, ngân hàng, xế đủ điều kiện |
| M04 Số dư và tiền | Ledger/holds/topup/withdrawal/adjustment | M01, driver identity M03-A | Nạp/rút thủ công, reserve/capture/release đúng |
| M05 Khách và địa chỉ | Customer/address/default | M01 | Đặt hộ và địa chỉ nhanh |
| M06 Phí/tuyến/điều kiện nhận | Quotes, route evaluator, GPS eligibility, type policy | M02, M03 | Quote, kiểm ghép, lý do chặn chính xác |
| M07 Delivery/workflow | Delivery/items/assignments/search deadline/incidents/commands | M02–M04, M06; adapter order sau M10 | Quán tạo ngoài app → nhận → pickup → kết thúc |
| M08 GPS/thông báo | Location ingest/tracking, device bindings, outbox delivery, WS, reminders | M01; resource adapters M07/M10 | Push/GPS nền, reconnect, nhắc không sai quyền |
| M09 Thực đơn | System/shop categories, menu/availability, ảnh | M02, upload M00/M01 | Quán quản lý món; khách tìm/browse |
| M10 Order | Checkout, snapshots/price override/confirm/cancel, delivery integration | M05, M09, M07 | Khách order → quán xác nhận → gọi xế |
| M11 Đánh giá/phản ánh | Driver rating/report, shop rating/reply, outcome reports | M07, M10, M04 cho monetary adjustment | Đánh giá đúng đối tượng/trạng thái, xử lý có audit |
| M12 Quản trị/vận hành | App quản lý projections, web cấu hình/scope/dashboard/report/backup runbooks | M01 và từng module cung cấp dữ liệu | Theo dõi/quản trị đúng quyền và khôi phục được |

M03 và M04 không phải vòng phụ thuộc: làm M03-A (identity/profile) trước; M04 sử dụng driver identity; M03-B (approve nạp-và-kích hoạt) tích hợp sau M04. M07 dùng hook order adapter tùy chọn, không chờ M10 mới chạy được đơn ngoài app.

Outbox/audit/idempotency primitives phải ở M00; gửi push thực nằm M08. Không trì hoãn ghi sự kiện bền vững đến khi đã code xong delivery.

### 5.3. Thứ tự triển khai theo phần có thể nghiệm thu

1. **Đợt A — Nền:** M00 → M01 → M02 → M03-A → M04 → M03-B. Tạo được quán/xế, nạp/duyệt, ví đúng; thử onboarding và quyền.
2. **Đợt B — Luồng giao ngoài app:** M06 + lõi M08 → M07 → hoàn thiện tracking/reminders M08 + dashboard M12. Quán gọi xế, hai xế tranh nhận, pickup, complete/fail, quản lý thấy.
3. **Đợt C — Khách đặt món:** M05 → M09 → M10; nối với M07 đã chạy. Kiểm đặt hộ, hẹn giờ, sửa giá trước confirm, gọi lại.
4. **Đợt D — Chất lượng/vận hành:** M11 + phần còn lại M12, backup/restore, test liên thông, pilot.

Ở mỗi đợt mobile, cùng contract và UI cho Android/iOS, có build và test nền tảng tương ứng. Không hoàn thiện Android toàn bộ rồi mới quay lại kiểm tra iOS.

### 5.4. Task nhỏ và tiêu chí xong

| Task | Đầu ra | Test/điều kiện nghiệm thu chính |
|---|---|---|
| M00-A | Chỉ mục, schema manifest, contract conventions, quyết định stack | Một tên/enum/field chuẩn; không lẫn dự án |
| M00-B | Backend + test DB + migration runner + CI | Fresh migrate, rerun migration, rollback/recovery staging |
| M00-C | Idempotency, audit, outbox primitives | Crash sau commit, same-key/different-body, không log secret |
| M01-A | OTP/register/login/onboarding | Proof một lần, phone unique, roleless onboarding, quản lý bị chặn |
| M01-B | Refresh/logout/revoke/password/phone | Reuse/retry, revoke quyền, đổi thiết bị/tài khoản |
| M02-A | Vùng/quán/membership | Điểm đúng ranh giới vùng, không sửa quán khác |
| M02-B | Business hours/availability | Hẹn khi đóng cửa hiện tại, qua nửa đêm, giờ cuối khung |
| M03-A | Driver identity/type/area/bank | SYSTEM driver không admin, ngân hàng đổi mất xác minh |
| M04-A | Ledger + hold services | Đối chiếu balance/held/available, không double spend |
| M04-B | Quản lý topup/activation command | Bank reference không dùng lại, partial topup, credit+approve một lần |
| M04-C | Withdrawal processing/reconcile | Rút 9.999/10.000, mất kết nối sau chuyển, không nhả sai |
| M03-B | Approve/reject/availability/closure | Active khi đủ, tắt vẫn giữ đơn, số dư nhỏ không mất |
| M06-A | Quote + snapshot pricing | 4.999/5.000/9.999/10.000 mét, TTL, provider lỗi |
| M08-A | Location ingress + device binding + push spike | GPS cũ/future, Android/iOS nền, logout token |
| M06-B | Batch evaluator/type policy | 3 rồi 7 phút, hệ thống >3, GPS cũ, không nới baseline |
| M07-A | Tạo/sửa/tìm/stop/cancel | Một active/order, timer 30 phút, gọi lại mới |
| M07-B | Accept/return + hold integration | Hai xế cùng nhận; một xế nhận song song; return không reset |
| M07-C | Destination/pickup/complete/fail | Hủy vs pickup, đủ ghim/phí, không trừ hai lần, hàng thất bại |
| M08-B | Tracking/outbox/reminders/WS | Quyền bị thu hồi, event muộn, khởi động lại worker |
| M05-A | Customer/address/default | Đặt hộ, hai default đồng thời, address inline retry |
| M09-A | Categories/menu/search/upload | Hai lớp tên trùng, category quán khác, ảnh sai ownership |
| M10-A | Checkout/price/schedule snapshot | Giá đổi, quán hết món, không GPS, đặt hẹn |
| M10-B | Merchant edit/confirm/reject/cancel | Tổng thỏa thuận, khóa sau confirm, cancel atomically |
| M10-C | Order→delivery→order integration | Delivery_items, active/latest/history, old event không ghi đè |
| M11-A | Driver/shop rating + shop reply | Chỉ successful order rate shop, quán không xóa, một lượt |
| M11-B | Outcome/driver rating reports | Điều chỉnh không replay complete, thiếu tiền chờ xử lý |
| M12-A | Management map/dashboard + admin config | Scope/action/vùng, snapshot policy không bị đổi |
| M12-B | Quyền/nhật ký/báo cáo/backup runbooks | Không self-escalate, restore balance/holds/jobs, xử lý tài khoản bị khóa |

Đây là task triển khai dự kiến. Chưa task nào được đánh dấu CODE_READY chỉ từ bảng này. Task đầu tiên cần hoàn thiện cụ thể là M00-A; khi contract/schema/test/UI của task đủ và repo/commit được xác định mới phát gói code.

### 5.5. Gói giao Claude tối thiểu

Mỗi gói gồm:

- TASK_ID, mục tiêu và 1 luồng có thể test; phiên bản đặc tả và commit xuất phát.
- File cần đọc, phạm vi sửa, module API/service được phép dùng; không nạp lại toàn bộ hội thoại.
- State/permission/rules, migration và fixtures đúng phần task.
- OpenAPI phần task, event schemas, error, idempotency/version/transaction boundaries.
- UI đã duyệt nếu task có màn; loading/empty/error/offline và quyền bị từ chối.
- Test ID + thao tác + expected result, lệnh chạy, tiêu chí nghiệm thu.
- Bàn giao: commit/diff, migration, log test thực tế, build gắn commit, lỗi còn lại, next task.

Claude không tự đổi enum, miễn điều kiện xế, sửa cách tiền hoặc mở quyền ngoài contract. Thay đổi cần ghi decision/diff; sửa routine trong phạm vi task được làm tiếp. ChatGPT review diff thực; chủ dự án test và duyệt bản có thể thao tác.

Trạng thái thống nhất: `TODO → DESIGN → CODE_READY → CODING → REVIEW → USER_TEST → LOCKED`; `BLOCKED` có nguyên nhân và đầu vào cần. DESIGN_REVIEWED không đồng nghĩa CODE_READY. Không tính % tiến độ dự án từ số endpoint đã kể.

## 6. Bộ test liên thông cần thiết

Tất cả test dưới đây ở trạng thái **CHƯA CHẠY**. Việc rà soát bảng test là kiểm tra đặc tả, không thay cho test ứng dụng. Test concurrency/error injection dùng staging/database riêng.

| ID | Mức | Case | Kết quả cần đạt |
|---|---|---|---|
| A01 | P0 | OTP xác minh dùng hai lần/khác purpose | Một proof một lần, không tạo nhiều user |
| A02 | P0 | Account mới chưa có role mở app quán/xế | Vào onboarding được, không có quyền vận hành |
| A03 | P0 | SYSTEM driver gọi admin/tiền/cấp quyền | Bị chặn |
| A04 | P0 | Admin sai scope/vùng, quyền vừa thu hồi | Chặn REST/WS và replay nhạy cảm |
| A05 | P0 | Logout A/login B cùng thiết bị, token push cũ | Không phát chi tiết A tới B; fetch kiểm lại quyền |
| A06 | P0 | Refresh response mất rồi retry, dùng lại token bị đánh cắp | Retry hợp lệ có chiến lược được test; reuse trái phép thu hồi đúng |
| A07 | P1 | Quán tọa độ trong/ngoài/ranh vùng | Server xác định đúng, giao ngoài vùng vẫn được |
| A08 | P1 | Hẹn khi hiện tại đóng cửa, giờ nhận trong khung | Tạo được khi accepting=true; giờ ngoài khung bị chặn |
| A09 | P1 | Khung giờ qua nửa đêm, đầu/cuối khung | Chuẩn hóa đúng, không chồng, cuối khung không nhận slot mới |
| A10 | P1 | Đặt hộ/địa chỉ cơ quan/không GPS | Hợp lệ; người đặt/nhận riêng |
| A11 | P0 | Thay address_id bằng của khách khác | Không đọc/đặt bằng private record trái quyền |
| A12 | P1 | Order inline recipient retry rồi hai request đặt default | Một order/địa chỉ cho same key; tối đa một default |
| A13 | P0 | Trộn món quán khác, sửa tổng từ client | Chặn/tính lại, không tin tổng giả |
| A14 | P1 | Món đổi giá/hết sau mở giỏ | Không tạo sai; thông báo và xác nhận lại |
| A15 | P1 | Quán sửa giá/tổng trước confirm rồi menu đổi | Snapshot đúng thỏa thuận; không cập nhật đơn cũ |
| A16 | P0 | Sửa đồng thời confirm hoặc gọi API customer edit/cancel | Một kết quả đúng; khách không có mutation đã loại |
| A17 | P0 | Hai request gọi xế cùng order khác key | Tối đa một active delivery, history đúng |
| A18 | P0 | Hủy delivery, gọi lại; hủy order đang accepted | Order không tự hủy bởi cancel delivery; cancel order giải phóng đúng assignment/hold |
| A19 | P0 | Worker stop và accept đúng mốc 30 phút | Không nhận sau hạn; không có hai kết quả thắng |
| A20 | P0 | Nhận lúc phút 29, giữ qua phút 30 rồi trả | Không cắt assignment; trả dẫn search_stopped, không reset tìm |
| A21 | P0 | 20 xế cùng nhận một delivery | Một active assignment/hold; người thua không mất tiền |
| A22 | P0 | Xế ngoài nhận song song đơn thứ 3/4 | Không vượt giới hạn count/ví |
| A23 | P0 | Xế hệ thống nhận đơn thứ 4 ngoài vùng đăng ký | Được nếu mọi điều kiện còn lại đạt |
| A24 | P0 | Xế hệ thống ghép làm A chậm 7 phút/GPS cũ/thiếu tiền | Bị chặn đúng điều kiện; không bypass |
| A25 | P0 | Ghép A chậm 3 phút rồi tổng 7 phút | Lần hai bị chặn; ETA gốc giữ nguyên |
| A26 | P1 | Xế chọn thứ tự khác, nhận thêm, nhiều đơn SYSTEM | Re-evaluate từ hiện tại; không ép thứ tự, không hidden count limit |
| A27 | P0 | Đơn không tọa độ xế đang bận nhận | Bị chặn; xế trống được nhận |
| A28 | P0 | Pickup thiếu pin/phí hoặc sửa phí SYSTEM_DISTANCE | Bị chặn; đủ thông tin thì ghi mốc nguyên tử |
| A29 | P1 | Quote hết TTL/đổi destination/policy, provider lỗi | Không dùng sai quote; đơn đã snapshot phí không đổi theo TTL |
| A30 | P1 | Khoảng cách 4.999/5.000/9.999/10.000 m | 10.000/15.000/15.000/20.000đ |
| A31 | P0 | Quán hủy cùng xế pickup | Một transition thắng; goods/hold/status nhất quán |
| A32 | P0 | Complete/fail song song hoặc complete retry | Một terminal outcome; capture/release một lần |
| A33 | P0 | Failed hàng chưa về rồi gọi lại | Chặn dispatch mới đến quán; incident còn mở |
| A34 | P0 | Delivery cũ gửi event terminal sau lần gọi mới | Không đổi state/order/rating eligibility sai |
| A35 | P0 | Topup+approve lại hoặc bank ref dùng ở API topup khác | Một credit; không dùng hai khoản kích hoạt |
| A36 | P0 | Nạp 60.000 + 40.000, nạp 150.000, duyệt thiếu ngưỡng | Credit đúng thực nhận; activate theo điều kiện; không mất phần tiền dư |
| A37 | P0 | Nhận delivery đồng thời rút/adjustment | Không double spend; available không âm |
| A38 | P0 | Rút 9.999/10.000 và tiền đang hold | Dưới ngưỡng chặn; đủ ngưỡng vẫn kiểm available |
| A39 | P0 | Tiền đã chuyển, mark-paid mất response; cancel/retry | Không chuyển/trừ hai lần; hold không nhả khi chưa rõ |
| A40 | P0 | Sửa số tiền/ngân hàng sau withdrawal processing | Không đổi payout đã snapshot; xử lý đối soát có audit |
| A41 | P0 | Tên ngân hàng sai/sửa tên xế sau verify | Chặn rút mới; verification bị thu hồi |
| A42 | P0 | Điều chỉnh failed→success khi thiếu ví và đã có lần giao khác | Không thu âm/replay completion; xét history, case chờ xử lý |
| A43 | P1 | Xế trả đơn rồi đọc contacts/GPS assignment mới | Không có quyền hiện hành; history giới hạn |
| A44 | P0 | Đổi SYSTEM→EXTERNAL khi đang giữ >3/ngoài vùng | Không hủy đơn cũ; lần nhận mới áp policy mới |
| A45 | P1 | User đóng còn 9.000/đang giữ tiền/đơn | Không xóa tiền; trạng thái chờ giải quyết rõ |
| A46 | P0 | Shop rating với rejected/failed/search_stopped | Chặn; chỉ order completed được đánh giá |
| A47 | P0 | Đánh giá nhầm quán/xế hoặc hai request rating | Actor/subject đúng; tối đa một record |
| A48 | P1 | Quán xóa/sửa shop rating khách, cập nhật reply | Chặn rating mutation; reply của quán được cập nhật có history |
| A49 | P0 | GPS captured cũ/future/mất mạng, nhiều session | Không giả live/ghi đè mẫu mới; batch không dùng dữ liệu không hợp lệ |
| A50 | P0 | Dừng worker sau commit trước push rồi restart | Dữ liệu còn, outbox xử lý lại, không tạo trùng tiền/đơn |
| A51 | P1 | Nhắc 5 phút, stop 30, return, terminal event trễ | Timer đúng lần tìm; job stale không nhắc sai |
| A52 | P0 | Khóa xế đang có hàng hoặc disable vùng đang giao | Không giả hoàn tất/đánh mất trách nhiệm; case quản lý xử lý |
| A53 | P1 | Upload file giả ảnh hoặc object người khác | Chặn loại/quyền/size, không gắn URL tùy ý |
| A54 | P1 | Ngừng nhóm menu có món active, hai lớp tên trùng | Không mất món/history; UI nhóm Khác khi cần |
| A55 | P0 | Android/iOS nền, khóa máy, mất quyền GPS/push | Có bằng chứng từng máy; mở app đồng bộ lại trạng thái server |
| A56 | P0 | Backup/restore order, assignment, ledger, holds, outbox | Đối chiếu số dư đúng, không resend debit hoặc thực chuyển khoản |
| A57 | P0 | Migration/build cập nhật và quay về bản tốt | Có đường phục hồi dữ liệu, app cũ tương thích theo contract |
| A58 | P0 | Một chuyến đầy đủ từ đặt hộ/hẹn → giao → rating | Các bề mặt cùng dữ liệu, đúng người nhận/tiền hướng dẫn/quyền |

Không bê nguyên test cũ: bỏ “khách hủy đồng thời quán confirm” khi bản đầu đã bỏ customer cancel; bỏ “xế chỉ một đơn”; đổi “giao ngoài vùng bị chặn” thành chỉ kiểm điểm lấy hàng. Tiền hàng/ship test chỉ kiểm thông tin hướng dẫn, không kiểm ledger COD không tồn tại.

Mỗi lần chạy lưu design version, commit/build, môi trường, thiết bị/OS, input, expected/actual, PASS/FAIL/BLOCKED, log/ảnh và issue. Test chỉ đọc spec không đánh PASS các case runtime.

## 7. Tiến độ sau rà soát và bước tiếp theo

| Hạng mục | Trạng thái thực tế |
|---|---|
| Bước 1 — tổng hợp nghiệp vụ hiện hành và mâu thuẫn | Đã rà soát thiết kế trong báo cáo này |
| Bước 2 — state machine/quan hệ/ràng buộc cần có | Đã dựng bản chuẩn rà soát; chưa đối chiếu DDL/source thực tế |
| Bước 3 — danh mục API, quyền và thiếu sót | Đã rà soát; hợp đồng OpenAPI chi tiết từng endpoint chưa hoàn tất |
| Chia module/task/phụ thuộc/test | Đã lập kế hoạch triển khai theo đợt và task nhỏ |
| Code/migration/build/thiết bị/pilot | Chưa thực hiện hoặc chưa xác minh trong lần làm việc này |

Làm tiếp theo thứ tự:

1. M00-A: tạo chỉ mục đặc tả hiện hành, quyết định version và schema manifest; ánh xạ các thay đổi Bước 2→bản 1.1. Giữ tài liệu cũ như lịch sử, không gửi làm contract hiện hành.
2. Hoàn thiện gói M01-A: OpenAPI auth/onboarding, schema user/session/OTP, quyền, fixtures và test. Đây là phần nhỏ đầu tiên có thể chuẩn bị độc lập khi chưa có map provider.
3. Xác định repository/commit và các đầu vào thật của M00. Chỉ sau đó giao task code tương ứng; không ghi “Claude đang triển khai” khi chưa có bàn giao.
4. Sau mỗi task: code/test → ChatGPT review → chủ dự án test màn/build → nghiệm thu → tích hợp. Không triển khai toàn bộ 13 module trong một prompt.

Bản này hoàn thành lượt rà soát 1–2–3 và lựa chọn phương án xử lý ở cấp thiết kế. Nó không phải chứng nhận API v1 đã code, database đã migrate hoặc phần mềm đã test thành công.