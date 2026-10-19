# M10 — Đặt món và đơn hàng quán: triển khai và hợp đồng (18–19/10/2026)

Nguồn thiết kế đã khóa: [11Ship-M10-Functional-UI-LOCKED-v1.0.md](11Ship-M10-Functional-UI-LOCKED-v1.0.md) (kèm §17 phụ lục M14 do Owner chốt 16/10/2026) và 3 ảnh UI đã duyệt ở `docs/ui/m10/`. Nhánh `claude/m10-order-delivery-hfy75r`. Chưa merge, chưa deploy, chưa chạy migration production.

## 1. Gói công việc (checklist task nhỏ)

| Gói | Phạm vi | Trạng thái |
|---|---|---|
| M10.01 | Giỏ (server giữ), kiểm giá, tạo đơn có `client_ref` chống gửi đôi, snapshot món/giá/địa chỉ/phí | Đã code + test tích hợp |
| M10.02 | Quán sửa/xác nhận/từ chối, khách/quán hủy, khóa thanh toán khi đang giao | Đã code + test tích hợp |
| M10.03 | Đơn hẹn (kể cả qua nửa đêm/quán 24h), "Món đã sẵn sàng", "Gọi shipper" độc lập, nhắc hẹn qua M08 | Đã code + test tích hợp |
| M10.04 | Nối M07 qua `OrderDeliveryPort`: gọi lại, hủy đơn món trước lấy hàng, hoàn thành đúng một lần, giao thất bại + xử lý hàng | Đã code + test tích hợp |
| M10.05 | Lịch sử/lọc/đặt lại, Admin Web "Vận hành › Đơn hàng", audit, thông báo M08 | Đã code + test tích hợp |

Test và kết quả trên SHA cuối: xem báo cáo bàn giao (mục "Kiểm tra"). Mốc code đã kiểm thử cục bộ: m10-orders 30/30, m10-admin-orders 3/3, Flutter n11_shared (m10) 22 test, Admin Web (spec orders + 24 kiểm tra đóng gói).

## 2. Quyết định kỹ thuật (không đổi nghiệp vụ)

- **Giỏ do server giữ** (`customer_carts`, một giỏ/khách, một quán/giỏ): giỏ còn khi thoát app; đổi quán thì app hỏi trước rồi thay cả giỏ. Cùng món + cùng ghi chú (đã chuẩn hóa khoảng trắng/hoa thường) gộp dòng, ghi chú khác tách dòng.
- **Gửi đơn idempotent**: `client_ref` (duy nhất theo khách) + `Idempotency-Key`. Mất kết quả → app KHÔNG báo "đã gửi/thất bại" mà tra lại `GET /customers/me/orders/lookup?client_ref=…`; gửi lại cùng `client_ref` không tạo đơn thứ hai.
- **Kiểm lại khi gửi**: quyền bán, trạng thái món, giá, giờ mở cửa/đơn hẹn, tổng tiền. Đổi giá/món hết → 409 `ORDER_CART_CHANGED`, không tạo gì; khách kiểm tra rồi gửi lại.
- **Snapshot**: tên/giá món, ghi chú, người nhận, địa chỉ + điểm ghim, phí ước tính được chốt trong đơn; sửa thực đơn/sổ địa chỉ sau đó không đổi đơn. Dòng quán sửa giữ `orig_*` bất biến để đối chiếu.
- **Phí giao**: M06 (`ShippingFeeAgreementService.estimate`); thiếu ghim → "Chưa xác định phí", không bao giờ 0đ; app không tự tính phí. Tiền món / phí / đã trả / còn phải thu tách riêng, VND nguyên; thanh toán trực tiếp (không ví/COD/online).
- **Khóa thứ tự**: bản ghi → user → session hiện tại → quán → shipper → delivery → ORDER. Ràng buộc cuối ở DB (trigger bảo vệ + deferred constraint trigger): tổng = dòng; đơn kết thúc không còn delivery hoạt động; COMPLETED cần đúng một delivery hoàn thành; delivery chỉ cho đơn đã xác nhận cùng quán.
- **Nối M07**: M07 chỉ phụ thuộc port (`delivery-order-port.ts`); `OrderDeliveryAdapter` (OrdersCoreModule) quyết định cho gọi/gọi lại (chặn khi còn delivery hoạt động hoặc hàng chưa về) và hoàn thành đơn đúng một lần (actor SYSTEM). Hủy đơn món trước lấy hàng kết thúc delivery + giải phóng hoa hồng; hủy delivery chỉ kết thúc delivery; sau lấy hàng không hủy thường.
- **Thanh toán sau xác nhận bị khóa khi đang có delivery hoạt động** (`ORDER_PAYMENT_LOCKED`) để không lệch với delivery đang chạy.
- **M08**: 13 loại `ORDER_*` (đặt, xác nhận, từ chối, hủy, sẵn sàng, shipper nhận/đang giao/thất bại, hoàn thành, không hoàn tất, nhắc hẹn); thêm đối tượng CUSTOMER cho thông báo; không thêm yêu cầu FCM mới.
- **Admin**: `/v1/admin/orders` (danh sách/chi tiết, quyền xem SHOP hoặc DRIVER) và 2 thao tác `cancel-order` (quyền khóa DRIVER) / `close-not-completed` (quyền duyệt DRIVER); lý do bắt buộc (≤300), `expected_version`, Idempotency-Key, audit. Không có route đặt trạng thái tùy ý.

## 3. API (envelope `{ "data": … }`; lệnh ghi có `Idempotency-Key`)

Khách (`Bearer`, app 11Food): `GET/PUT/DELETE /customers/me/cart` · `POST /customers/me/orders/preview` · `POST /customers/me/orders` · `GET /customers/me/orders/lookup` · `GET /customers/me/orders` · `GET /customers/me/orders/:id` · `POST …/:id/cancel` · `POST …/:id/reorder`.

Quán: `GET /shop/me/orders[/:id]` · `POST /shop/me/orders/:id/{edit,confirm,reject,ready,payment,call-shipper,cancel,close-not-completed}`.

Admin (cookie + CSRF): `GET /admin/orders[/:id]` · `POST /admin/orders/:id/actions/{cancel-order,close-not-completed}`.

Mã lỗi mới: `ORDER_NOT_FOUND`, `ORDER_STATE_CONFLICT`, `ORDER_CART_CHANGED`, `ORDER_CART_OTHER_SHOP`, `ORDER_SHOP_NOT_OPEN`, `ORDER_SCHEDULE_INVALID`, `ORDER_ADDRESS_INVALID`, `ORDER_EMPTY`, `ORDER_CHANGE_REASON_REQUIRED`, `ORDER_PAYMENT_LOCKED`, `ORDER_PAYMENT_INVALID`, `ORDER_INPUT_INVALID`. (Đã bỏ `ORDER_MODULE_NOT_READY`.)

## 4. Dữ liệu

Migration `database/migrations/1794268800000_create-m10-orders.sql`: `customer_carts`, `orders`, `order_items`, `order_events` (chỉ thêm), trigger bảo vệ và constraint trigger hoãn, FK `deliveries_order_fk`. Phần Down có chốt an toàn `M10_DOWN_REFUSED` khi đã có đơn. **Chưa chạy trên production**; áp dụng khi triển khai theo quy trình hiện hành.

## 5. Phụ lục bản đồ M14 (Owner chốt 16/10/2026) — đã áp dụng thế nào

- **M10-MAP.01 (thanh toán)**: địa chỉ từ M05, điểm ghim theo lõi M14 khi có; điểm được snapshot vào Order; thiếu ghim vẫn gửi được, phí "Chưa xác định phí"; có tuyến thì dùng báo giá M06.
- **M10-MAP.02 (chi tiết đơn)**: chi tiết khách/quán theo delivery/assignment hiện hành của M07 (điểm lấy/giao + vị trí shipper mới nhất kèm thời điểm và trạng thái cũ/mất kết nối); khi shipper hủy nhận/quán gọi lại thì theo assignment/delivery mới; đơn kết thúc chỉ còn snapshot điểm + timeline và dừng theo dõi; không lưu lịch sử GPS; bản đồ ngoại tuyến ≠ chỉ đường ngoại tuyến; không tọa độ giả/đường thẳng/0đ giả; không bước "Bắt đầu giao" hay tab bản đồ; đặt hộ không cấp quyền xem vị trí qua SĐT.
- **Giới hạn đã biết — cần quyết định**: 11Food chưa tích hợp plugin bản đồ M14 (chỉ 11Ship có). Trong 11Food các seam `mapBuilder`/`pinPicker` để trống: màn hình hiển thị điểm bằng chữ + vị trí shipper (tọa độ/thời điểm/độ mới), thanh toán đi **không có ghim** → phí "Chưa xác định phí" cho tới khi M14 được nối vào 11Food. Đây là việc theo dõi riêng, không giả lập.

## 6. Giao diện

- **11Food** (`mobile/packages/n11_shared/lib/src/m10`, nối ở `mobile/food/lib/food_tabs.dart`): khách 3 tab (Đang xử lý / Đơn hẹn / Lịch sử) + giỏ + xác nhận đơn + chi tiết/đặt lại; quán 4 tab với bộ chọn "Đơn món | Giao hàng" tách hai khái niệm, lọc/tìm/ngày, chi tiết với sửa đơn (lý do bắt buộc), xác nhận/từ chối, sẵn sàng, gọi shipper, thanh toán, hủy, đóng "Không hoàn tất". Trạng thái lỗi/offline/xung đột/không rõ kết quả có đủ.
- **Admin Web**: Vận hành › Đơn hàng (`/operations/orders`), bộ lọc mã/người nhận/trạng thái/quán/ngày, ngăn chi tiết (món kèm bản gốc, tiền, các lần gọi shipper, timeline), hai thao tác có lý do.
- Dữ liệu minh họa (`SampleOrderStore`) chỉ bật khi `kM10UiPreview`; production không có dữ liệu mẫu. Ảnh chụp widget (dữ liệu mẫu, **không phải nghiệm thu thiết bị**): `docs/ui/m10/screens/` và artifact CI `11Food-m10-ui-widget-renders`.

## 7. Chưa kiểm chứng

- Chạy trên thiết bị thật / VPS; SMS; FCM đẩy thật cho `ORDER_*`.
- Bản đồ trong 11Food (xem §5).
- Quán đổi lịch sau khi nhận đơn hẹn: hệ thống giữ đơn và cảnh báo (không tự hủy) — đã test, chưa thử trên thiết bị.
