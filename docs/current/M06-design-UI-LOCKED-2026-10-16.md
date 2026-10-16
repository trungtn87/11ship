# 11Ship — M06 Phí giao hàng, điều kiện nhận/ghép đơn & UI

**Phiên bản:** v1.0 — **OWNER APPROVED / DESIGN_LOCKED**  
**Ngày duyệt:** 16/10/2026 (Asia/Ho_Chi_Minh)  
**Trạng thái triển khai:** **IMPLEMENTATION_PENDING — CHƯA CODE / CHƯA DEPLOY**  
**Phạm vi:** UI & nghiệp vụ M06; quyết định tách GPS/bản đồ/tuyến thành module riêng M14.  
**Nguồn quyết định:** Owner duyệt bảng giá linh hoạt M06.02, yêu cầu tách GPS; sau khi xem bộ UI M06/HTML/ảnh tham khảo, Owner xác nhận: “Ok duyệt thiết kế m06, lưu vào dự án 11ship đi”.

> **Quy tắc triển khai:** Đây là thiết kế đã duyệt, **không phải lệnh code**. Khi giao Claude/Codex phải nêu rõ **UI-only** hay **backend/functionality**. Không tự phát triển API/DB, màn GPS hoặc triển khai production chỉ vì có mockup. Không tự đổi tên cột/API/tài liệu cũ theo từ ngữ giao diện. Từ hiển thị là **shipper**, không dùng “xế”.

## 1. Phạm vi chốt của M06

M06 chỉ làm: (1) chính sách và tính **phí giao hàng**, (2) **điều kiện shipper được xem/nhận đơn**, (3) **đánh giá ghép đơn và bảo vệ ETA**, (4) báo giá/policy snapshot & version.

| Module | Ranh giới sở hữu | Ghi chú |
|---|---|---|
| M06 | `shipping_quotes`, `driver_routing_states`, `route_evaluations`, `policy_versions` cho pricing/eligibility/batching; trả kết quả đủ điều kiện/không đủ điều kiện và lý do | Không tự chuyển trạng thái delivery, không tự trừ/giữ tiền |
| M07 | Gọi ship, tìm và nhận/trả đơn, assignment, pickup/complete/fail, lưu `original_eta` bất biến của assignment | Gọi M06 lúc đánh giá và kiểm lại khi commit |
| M04 | Số dư ví khả dụng, hold/capture/release hoa hồng | Không nhét tiền hàng/COD/ship vào ví |
| M08 | Push/WS/thông báo/nhắc và đồng bộ sự kiện | Được điều chỉnh phạm vi để **không sở hữu GPS/tracking** |
| M13 | Giám sát hệ thống và cảnh báo sự cố | Nhận sự kiện lỗi GPS/bản đồ/route |
| **M14 — module độc lập** | GPS nền, current location/sample, quyền xem vị trí, bản đồ OSM/MapLibre, routing engine tự lưu trữ (ưu tiên Valhalla) và route/matrix/ETA | M14 mới chỉ **chốt ranh giới tách**; thiết kế/POC/test triển khai M14 ở bước riêng, không code kèm M06 |

**Giữ một repository, backend API và database dùng chung, phân chia ownership theo module**; “module độc lập” không đồng nghĩa thêm VPS riêng/microservice. M06 lấy dữ liệu tuyến/vị trí hợp lệ từ interface M14, không gọi Google Routes API làm đường tính phí mặc định.

## 2. M06.02 — Bảng giá ship linh hoạt đã duyệt

- Trong **Admin Web → Cài đặt → Phí giao hàng**, Admin được phân quyền có thể **thêm/sửa/xóa mốc**, đặt giá riêng cho từng mốc và cấu hình cách tính sau mốc cuối; **không khóa công thức “thêm 5 km tăng 5.000đ”**.
- Form bảng giá: `Từ (km)` / `Đến dưới (km)` / `Phí (VND)` / `Sửa` / `Xóa`; tính bằng **mét gốc** từ M14, không dùng số km làm tròn hiển thị để tính tiền.
- Các khoảng phải **liên tục, không chồng lấn, không hở mốc**, bắt đầu từ 0; ngưỡng chính xác thuộc bậc tiếp theo theo khoảng nửa mở `[from, to)`. Không có phí âm; cảnh báo lỗi ngay khi nhập và chặn lưu khi vi phạm.
- Sau mốc cuối, cho cấu hình công thức nối tiếp rõ ràng (phí nền, mỗi X km, cộng Y đồng), và preview trước khi áp dụng; phần này phải liên tục về khoảng cách và có kết quả xác định cho mọi quãng đường.
- UI gồm **“Thêm mốc giá”**, **“Lưu bản nháp”**, **“Áp dụng bảng giá”**, **“Thử tính phí”**, và **Lịch sử phiên bản**. Cần xác nhận khi áp dụng bản mới, audit actor/thời điểm/thay đổi.
- Mỗi lần áp dụng tạo **policy version bất biến**, không hồi tố phí/quote đã được gắn snapshot vào đơn. Quote chưa chốt và hết TTL/đổi địa điểm hoặc chính sách cần tính lại đúng quy tắc.
- `SYSTEM_DISTANCE`: phí M06 tính dựa trên tuyến hợp lệ M14; quán/shipper không được sửa phí sau khi chốt.
- `PICKUP_AGREEMENT`: khi không có tọa độ giao, đơn có phí `null` (khác 0), shipper đủ điều kiện phải xác nhận điểm giao và phí thỏa thuận trước khi pickup, thuộc workflow M07; không tự chuyển chế độ vì dịch vụ tuyến lỗi.
- Bên trả phí: khách hoặc quán; app trình bày chỉ dẫn thanh toán theo tiền hàng, tiền đã thanh toán và phí; không tạo ví COD/trung gian tiền hàng.

## 3. M06.03 — Điều kiện nhận đơn

- Trước khi M07 cho nhận: kiểm tài khoản đang active/đã duyệt, bật nhận đơn, GPS hợp lệ từ M14, vị trí theo chính sách, ví khả dụng do M04 cấp, số lượng assignment đang mở, delivery còn đang tìm và chưa quá hạn, ghép tuyến hợp lệ nếu shipper đang có đơn.
- **Bán kính tìm shipper thông thường là 5 km CỐ ĐỊNH**, tính đường chim bay từ tọa độ quán đến current GPS shipper, không đưa nút chỉnh bán kính lên Admin Web. Không áp dụng điều kiện khu vực đăng ký shipper đã bỏ ở M03.
- `EXTERNAL` mặc định tối đa **3 delivery hoạt động**; loại `PLATFORM` **không giới hạn số đơn** và có ngoại lệ về phạm vi nhận theo chính sách nội bộ, nhưng **không được bỏ kiểm GPS/ví/ETA**. Phân loại chỉ Admin được thấy, không hiển thị công khai trên app shipper.
- Không hiển thị map/SĐT khách và địa chỉ chi tiết trước khi nhận. Trước nhận chỉ hiện khu vực/mô tả phù hợp quyền, khoảng cách dự kiến, tiền hàng, phí nếu đã xác định; sau nhận M07 cho xem thông tin cần thiết.
- Việc preview đủ điều kiện từ M06 **không đồng nghĩa đã nhận đơn**. M07 phải kiểm lại trạng thái/version/loại shipper/policy/tuyến/ví và commit assignment+hold+event một lần an toàn dưới đồng bộ hóa aggregate; không cho vượt số đơn/ví khi nhận đồng thời.

## 4. M06.04 — Quy tắc ghép đơn

- ETA gốc của từng assignment lưu bất biến; bất kỳ lần ghép nào cũng bảo vệ **mỗi đơn cũ không chậm thêm quá 300 giây cộng dồn**. Ví dụ A gốc 18:30, ghép B dự kiến 18:33: hợp lệ; ghép tiếp C khiến A 18:37: từ chối, không reset ETA gốc thành 18:33.
- M06 lấy current GPS có độ mới/độ chính xác đạt ngưỡng và ma trận thời gian/quãng đường từ **M14**, thử phương án chèn các điểm lấy và giao còn lại, luôn tuân thủ pickup trước dropoff, gồm thời gian nhận hàng/bàn giao.
- `EXTERNAL` vẫn bị giới hạn count; `PLATFORM` được miễn count nhưng không được nới giới hạn chậm ETA; thuật toán phải có ngân sách tính, không âm thầm giới hạn số đơn để né độ phức tạp.
- Shipper tự chọn thứ tự giao; tuyến ghép chỉ là đánh giá tại lúc nhận, không cưỡng ép hướng đi hay tự động đổi ETA gốc.
- Đơn thiếu tọa độ/ETA không được ghép; **shipper trống** có thể nhận đơn chưa có GPS giao, sau khi ghim+phí trước pickup và có tuyến hợp lệ mới đủ điều kiện đánh giá ghép tiếp.
- Route/GPS lỗi hoặc dữ liệu không đáng tin cậy: trả lý do `ROUTE_DATA_UNAVAILABLE` / `LOCATION_STALE` / `BATCH_DELAY_EXCEEDED` tương đương contract; **không tự cho ghép**.

## 5. UI đã duyệt — phạm vi từng ứng dụng

### Admin Web — M06

1. **Bảng giá linh hoạt:** bảng mốc khoảng cách và số tiền, nút sửa/xóa/thêm, phần sau mốc cuối, preview số km → phí, lưu nháp/áp dụng.
2. **Điều kiện nhận và ghép:** giới hạn EXTERNAL (mặc định 3), `PLATFORM` không giới hạn, trễ tối đa 5 phút và tham số nghiệp vụ thời gian lấy/giao; bán kính 5 km **khóa chỉ đọc**.
3. **Lịch sử/chính sách:** version, actor, thời gian và so sánh đổi cấu hình; không sửa phiên bản cũ.
4. **Không có** bảng cài đặt GPS, sai số, GPS sample, cập nhật dữ liệu OSM, trạng thái Valhalla ở M06 — các mục đó thuộc **M14** sau này.

### 11Food — vai trò quán

- Ở luồng gọi ship của M07, hiển thị điểm lấy theo quán M02, điểm giao từ thông tin đơn, khoảng cách/tuyến hợp lệ, phí dự kiến theo M06 và người trả phí.
- Thiếu tọa độ: hiển thị **“Chưa xác định phí”**; không hiển thị phí 0đ, không vô tình chặn tạo yêu cầu giao vì địa chỉ chỉ có mô tả.
- Không thêm tab mới, không sửa M01/M02/M05/luồng checkout M10.

### 11Ship — vai trò shipper

- Thẻ xem đơn trước nhận chỉ hiện thông tin được phép, số tiền hàng/ship nếu có, không lộ SĐT hoặc vị trí giao chi tiết trên bản đồ trước nhận.
- Kết quả đánh giá nhận/ghép hiển thị **“Đủ điều kiện”** hoặc **“Không thể ghép”** với lý do ngắn, không tự bấm nhận thay shipper.
- Các thao tác nhận, đã nhận hàng, giao xong do **M07**; bản đồ/định vị/tracking chỉ thuộc **M14**. Không dựng thêm navigation toàn app.

### Quy chuẩn giao diện

- Nhận diện #D8AD18 (vàng), #2A2A2E (đen), #FFFFFF, #F2F1EE; font Plus Jakarta Sans theo guideline dự án; slogan shipper **“Gọi là có”**.
- Ảnh mockup và bản HTML minh họa bố cục, có thể chứa địa chỉ/giá/placeholder giả hoặc nút demo; **tài liệu nghiệp vụ này ưu tiên hơn nội dung minh họa nếu có xung đột**.

## 6. Phụ thuộc kỹ thuật & dữ liệu M14 (chỉ ghi ranh giới, KHÔNG triển khai ở M06)

- M14 xuất: `current_location(driver_id)` (tọa độ, timestamp, accuracy, trạng thái hợp lệ), `compute_route(origin,destination,profile)` (distance_m, duration_s, route_version), `route_matrix(points,profile)`; báo lỗi rõ khi không tính được.
- Tạm ưu tiên **OSM + Valhalla tự host trên VPS**, có thể dùng MapLibre hiển thị, tránh phí theo lượt Google Routes; cần thử thực địa Cao Bằng/xe máy, độ đầy đủ ngõ và tải máy chủ trước khi khóa lựa chọn triển khai.
- Dịch vụ tuyến gọi ngoài transaction DB; lúc ghi nhận phải kiểm lại version và TTL.
- M14 phục vụ theo dõi vị trí cho quán/khách/Admin theo quyền, cập nhật GPS nền; lịch sử có thời hạn; M08 chỉ phụ trách thông báo/push/WS. Không coi “GPS hoàn toàn chính xác” hoặc “cập nhật đúng 60 giây trong mọi điều kiện Android” là cam kết.
- Tài khoản và quyền thuộc M01; M13 chỉ giám sát/cảnh báo sự cố; không xây bộ quyền thứ hai.

## 7. Hợp đồng dữ liệu/API dự kiến và nghiệm thu

- M06 sở hữu các bảng logic `shipping_quotes`, `driver_routing_states`, `route_evaluations`, `policy_versions` với policy snapshot/TTL/version/audit; M14 sẽ sở hữu `driver_current_locations`, `driver_location_samples` và dữ liệu bản đồ/tuyến (đối chiếu với manifest cũ trước migration).
- `/v1/shipping-quotes`, endpoint internal/role-scoped kiểm điều kiện nhận/ghép và endpoint Admin policy là tên **dự kiến**, phải lập OpenAPI/permission/errors/idempotency trước khi CODE_READY.
- Nghiệm thu bắt buộc: mốc biên phí chính xác; cấu hình mốc không chồng/hở; đổi giá không thay đơn cũ; quote hết hạn; thiếu GPS vẫn lưu địa chỉ/đơn với phí null; không tự đoán tuyến nếu router lỗi; EXTERNAL/PLATFORM đúng giới hạn; ETA chậm cộng dồn; hai request nhận đồng thời không vượt count/ví; quyền Admin chặn sửa trái scope; UI không lộ số điện thoại/vị trí trước nhận.

## 8. Tệp UI tham khảo thuộc bản phê duyệt

- `11Ship-M06-Admin-Web-UI.png` — bảng giá và preview phí.
- `11Ship-M06-Admin-Policy-UI.png` — điều kiện nhận/ghép và chính sách.
- `11Ship-M06-App-UI.png` — thông tin phí trên app quán, nhận/ghép trên app shipper.
- `11Ship-M06-UI-Reference.html` — HTML **demo tham khảo**, không phải UI chức năng đang chạy.
- `11Ship-M06-UI-Approved-v1.0.zip` — gói lưu trữ gồm toàn bộ ảnh + HTML + bản này.

**Kết luận:** Owner đã DUYỆT phạm vi chức năng và UI M06; **tách M14 độc lập đã được duyệt ở cấp ranh giới module**, thiết kế chi tiết M14/POC vẫn để sau. Tình trạng **DESIGN_LOCKED / IMPLEMENTATION_PENDING**; **không tự code, merge ứng dụng, deploy hoặc thay đổi database** từ quyết định lưu thiết kế này.