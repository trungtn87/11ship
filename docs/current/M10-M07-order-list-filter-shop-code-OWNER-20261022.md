# 11Food (chủ quán) — Danh sách Đơn món / Giao hàng + mã đơn dễ đọc

**Chốt bởi Owner:** 22/10/2026. **Phạm vi:** 11Food màn `Đơn hàng` của SHOP_OWNER (M10 Đơn món + M07 Giao hàng), định danh hiển thị dùng chung hệ thống. Đây là tài liệu bàn giao để triển khai, **không phải bằng chứng code đã chạy**.

## 1. Bố cục UI đã duyệt (ưu tiên trên ảnh mock)

Hai màn dùng một bố cục và hệ màu, không đổi điều hướng 4 tab dưới cùng:

1. Header **Đơn hàng**.
2. Tab chính **Đơn món | Giao hàng**, giữ vị trí hiện tại, chỉ 1 tab đang chọn.
3. Riêng **Giao hàng**: nút hành động vàng **Gọi shipper** ngay dưới tab, giữ nguyên flow tạo giao hàng trực tiếp (M07).
4. **Một hàng duy nhất:** ô tìm kiếm rộng bên trái, nút biểu tượng phễu **Lọc** bên phải. **Không hiển thị các chip trạng thái ngoài danh sách, không để icon lịch riêng ngoài hàng.**
5. Danh sách thẻ đơn ngay phía dưới; trống thì empty state đúng với bộ lọc đang áp dụng. Thẻ gọn: **mã đơn nổi bật**, thời gian, tên người nhận, trạng thái, số món/giá tiền món hoặc phí giao và hành động theo quyền/trạng thái **đã tồn tại**, không vẽ nút sai nghiệp vụ.
6. Ưu tiên hiển thị đơn mới trước, cuộn và phân trang theo API; sử dụng thiết kế component, typography và spacing hiện hành. Ảnh mock chỉ tham khảo thẩm mỹ; hợp đồng nghiệp vụ/UI trong tài liệu này là nguồn chốt.

### 1.1. Tìm kiếm

- Placeholder chung: `Tìm mã đơn hoặc tên người nhận`.
- Tìm theo mã hiển thị **hoặc mã cũ**, tên người nhận; kết quả theo đúng màn Đơn món/Giao hàng và bộ lọc.
- Nhấn tìm / debounce theo hành vi hiện hành; **giữ từ khóa khi đổi bộ lọc**, xóa từ khóa thì trở lại danh sách tương ứng.
- Nếu đang lọc mà không có kết quả: ghi `Không có đơn phù hợp` và có thao tác `Xóa bộ lọc` (không dùng thông báo `chưa từng có đơn`).

### 1.2. Một menu Lọc cạnh ô tìm kiếm

- Mặc định **Tất cả**, cả Đơn món và Giao hàng, kể cả khi mở lại ứng dụng.
- Menu có nhóm **Trạng thái** và **Ngày** (mặc định: mọi ngày), nút `Áp dụng` và `Đặt lại`; chỉ mở khi người dùng chạm phễu. Khi có lọc đang bật, hiện chấm/chỉ dấu nhỏ trên biểu tượng; **không lặp bộ lọc ở chip bên ngoài**.
- Đơn món: Tất cả; Chờ xác nhận; Đang chuẩn bị; Đơn hẹn; Đang giao; Cần xử lý; Lịch sử. Dùng logic trạng thái M10 đang có, không thay đổi business-state machine.
- Giao hàng: Tất cả; Đang tìm shipper; Shipper đã nhận; Đang giao; Hoàn thành; Không thành công / Đã hủy (tương ứng state M07 đang có). Các trạng thái chi tiết không hiển thị thành tab riêng.
- Ngày là một ngày hoặc khoảng ngày có giới hạn do API xác thực, hiển thị bằng giờ Việt Nam và truyền điều kiện thời gian máy chủ rõ ràng; xóa ngày quay về mọi ngày.
- Hành vi chuyển Đơn món/Giao hàng: 2 màn có bộ lọc độc lập nhưng cùng **mặc định Tất cả**, không mang bộ lọc trạng thái của màn này sang màn khác.
- Không thay các thao tác có quyền / điều kiện hiện hành, không mất cập nhật danh sách sau xác nhận/hủy/gọi shipper.

## 2. Mã hiển thị chung, dễ đọc, dễ nhớ

**Dạng chuẩn:** `K01-0001`, `K01-0002` ... Trong đó `K01` là mã quán cố định, `0001` là số thứ tự nghiệp vụ của quán.

- Hệ thống tự cấp **mã quán duy nhất, không tái sử dụng, không sửa tay**: `K01`, `K02`, ... (số chữ số phần quán có thể tăng theo lượng quán, không giới hạn 99). Cấp cho cả quán cũ theo migration bổ sung an toàn; giữ nguyên `shop_id` UUID.
- Một dãy số thứ tự **dùng chung theo từng quán** cho (a) đơn món khách đặt và (b) yêu cầu giao trực tiếp do quán gọi shipper. Không có xung đột giữa M10 và M07, **không reset theo ngày/năm** và không tái sử dụng số khi đơn bị hủy. Từ 10000 trở đi hiển thị `K01-10000`, không tràn/quay vòng.
- Giao hàng **liên kết với đơn món** dùng **chính mã hiển thị của đơn món** ở cả màn Đơn món và Giao hàng; khi gọi shipper lại vẫn hiển thị mã đơn đó. Delivery/assignment/các lần giao vẫn có `delivery_id` riêng và mã kỹ thuật riêng phục vụ đối soát nội bộ; không tạo thêm số thứ tự mới trên dãy dùng chung cho lần gọi lại của một order.
- Mã này là mã người dùng nhìn thấy / đọc cho quán, khách, shipper và SYSTEM/Admin; hiển thị trong danh sách, chi tiết, thông báo và tìm kiếm **ở nơi UI hiện đã dùng mã đơn/giao hàng**. UUID, foreign key, idempotency, audit, timeline và quyền truy cập hiện tại không đổi.
- **Dữ liệu cũ không bị đổi mã/ID vật lý:** giữ nguyên `orders.code` dạng `DH-...` và `deliveries.code` dạng `G-...` đã cấp. Có thể dùng lớp `display_code`/alias tương thích để hỗ trợ UI và truy vấn; mã cũ vẫn phải tìm được. Nếu muốn backfill mã hiển thị cho lịch sử, cần làm theo migration mapping được kiểm chứng **không mất lịch sử, không đổi identity đang bất biến**, không tự cập nhật trường `code` của đơn cũ.
- Tất cả mã cấp mới phải ổn định sau retry, không trùng khi 2 yêu cầu đồng thời hoặc khi gọi ORDER và DIRECT xen kẽ. **Không dùng `MAX()+1` ngoài khóa**; cấp số qua counter/sequence transactional theo quán kèm constraint DB. Idempotency cùng một thao tác không tạo 2 đơn/2 mã.
- Không đổi route ID sang chuỗi hiển thị: chi tiết, hành động và liên kết dùng UUID như hiện nay. Không làm lộ dữ liệu quán khác khi tìm theo mã.

### 2.1. Ràng buộc triển khai dữ liệu

- **Migration mới bổ sung**, không sửa migration cũ `1794268800000_create-m10-orders.sql` / `1794096000000_create-m07-delivery.sql`; không triển khai migration production cho tới khi được phép.
- Hiện `orders.code` và `deliveries.code` là trường identity bất biến qua trigger. Thiết kế trước khi code để không gây vi phạm trigger hoặc phá dữ liệu cũ.
- Thay đổi bảng, hàm sequence, role grants phải đi cùng nhau, không để lỗi HTTP 500 do thiếu grant (`app` runtime, admin/service roles).
- Đảm bảo API `GET /v1/shop/me/orders` và `GET /v1/shop/me/deliveries` hỗ trợ thực tế bộ lọc, ngày và tìm kiếm trên server, không chỉ lọc 50 phần tử đã tải. API cũ đang có filter `all` bên M10; API giao hàng chỉ `scope=active|history`: **mở rộng backward-compatible** cho `all` / trạng thái / ngày; giữ mặc định API cũ nếu client khác phụ thuộc, app 11Food truyền `all` rõ ràng. Giữ cơ chế giới hạn/pagination.

## 3. Điểm vào code để agent triển khai

- UI Đơn món: `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart` (`_ShopOrderListState`, `_filters`, ô tìm kiếm, nút ngày).
- UI Giao hàng: `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart` (`ShopDeliveryHub`, `_history`, `m07-search`, `m07-call-shipper`).
- Mô hình/mạng: `mobile/packages/n11_shared/lib/src/m10/m10_{models,source,http}.dart`, `src/m07/m07_{models,source,http}.dart`.
- Sinh mã đơn M10: `apps/backend/src/orders/order-rules.ts` (`newOrderCode`), `order-customer-service.ts`, `order-repository.ts`, `order-views.ts`, `order-validation.ts`.
- Sinh mã giao M07: `apps/backend/src/delivery/delivery-rules.ts` (`newDeliveryCode`), `delivery-shop-service.ts`, `delivery-repository.ts`, `delivery-views.ts`, `delivery-validation.ts`.
- Quyền/quán: `apps/backend/src/shop-management/`, migration onboarding shop, schema `app.shops`.
- Test mục tiêu: Flutter `mobile/food/test/` và gói shared, integration `tests/integration/` (M07/M10 và migration rollback/grants).

## 4. Kiểm tra chấp nhận (ngắn, tập trung)

1. Mở 11Food quyền chủ quán → Đơn hàng → **Đơn món**, mọi chip cũ đã biến mất; một hàng tìm kiếm + Lọc; mặc định `Tất cả`; đổi ngày/trạng thái/đặt lại hoạt động; không đơn có empty state chính xác.
2. Chuyển **Giao hàng** → nút Gọi shipper vẫn hoạt động; một hàng tìm kiếm + Lọc; mặc định Tất cả **gồm cả lịch sử**, thay vì chỉ Đang xử lý; tìm mã / tên hoạt động với phân trang.
3. Đơn món mới của quán K01 lần lượt có `K01-0001`, `K01-0002`; giao trực tiếp sau đó `K01-0003`; quán K02 bắt đầu `K02-0001`. Đơn món gọi shipper → giao hàng cùng mã; gọi lại không đổi mã nhìn thấy.
4. Tạo đơn song song, retry idempotency, vượt 9999, hủy/hoàn thành: không trùng, không tái dùng mã. Đơn lịch sử `DH-/G-` vẫn đọc, tìm và thực hiện quyền hiện tại được.
5. M10/M07/API/DB constraints/grants/notification và màn liên quan không hồi quy. CI test đúng phần thay đổi và APK 11Food build theo quy tắc signing/update-in-place; không tự deploy VPS / production migration.

## 5. Bàn giao thực thi

- **Lead coding agent:** Claude Code Cloud (mặc định theo AGENTS.md); 1 agent sở hữu nhánh/PR này. Codex chỉ nhận task riêng nếu Owner điều phối, không làm song song trùng phạm vi.
- **Trạng thái của tài liệu:** UI + quy tắc mã được Owner chốt; **code/migration/tests/APK chưa thực hiện trong commit tài liệu này**. PR phải ở **Draft** đến khi agent đẩy code và có CI phù hợp. Review diff mới rồi sẵn sàng merge; không hiểu mở PR đồng nghĩa đã triển khai.
- Không sửa workflow/deploy, module ngoài phạm vi; các nghiệp vụ M07, M10 hiện tại vẫn áp dụng.
