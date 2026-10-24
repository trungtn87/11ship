# Ngày 2 - Khách đặt hàng và chủ quán nhận đơn

Tài liệu này là bản ĐỌC ĐƯỢC của các test case trong file `TESTCASE_11SHIP.csv` (cùng nội dung). Làm lần lượt từ trên xuống dưới vì các test sau dùng dữ liệu của test trước.
Trước khi bắt đầu: đọc `HUONG_DAN_KIEM_THU_11SHIP.md` (nhất là mục chuẩn bị tài khoản, tiền thử nghiệm và cách báo lỗi).

Tổng số test case trong ngày: **73** (P0: 28, P1: 32, P2: 13).

| # | Mã | Tên | Mức | Cần | Sẵn sàng |
|---|---|---|---|---|---|
| 1 | TC-SHOP-001 | Chủ quán A tạo hồ sơ quán, ghim vị trí lấy hàng và hoàn tất hồ sơ | P0 | 1 ĐT | SẴN SÀNG |
| 2 | TC-ADM-015 | Ghi nhận hiện trạng: quán hoạt động ngay khi hồ sơ đủ, không có bước "Admin duyệt quán" | P0 | 1 ĐT | SẴN SÀNG |
| 3 | TC-SHOP-002 | Quán C chưa đủ điều kiện kích hoạt: không hoàn tất được khi thiếu địa chỉ hoặc vị trí ghim | P0 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 4 | TC-ADM-012 | Danh sách người dùng: tìm, lọc "Đang khóa", xem chi tiết | P0 | PC | SẴN SÀNG |
| 5 | TC-SHOP-003 | Lấy vị trí quán khi chưa cấp quyền GPS, GPS tắt hoặc GPS yếu | P1 | 1 ĐT | SẴN SÀNG |
| 6 | TC-SHOP-004 | Vị trí quán nằm ngoài khu vực phục vụ | P1 | 1 ĐT | CẦN XÁC MINH |
| 7 | TC-SHOP-005 | Chủ quán chuyển qua lại giữa chế độ quản lý quán và chế độ khách hàng | P0 | 1 ĐT | SẴN SÀNG |
| 8 | TC-SHOP-006 | Sửa hồ sơ quán đang hoạt động (tên, số điện thoại liên hệ) | P1 | 2 ĐT | SẴN SÀNG |
| 9 | TC-SHOP-007 | Thêm logo quán (không bắt buộc) và gỡ logo | P2 | 1 ĐT | CẦN XÁC MINH |
| 10 | TC-SHOP-008 | Quán chưa cài giờ hoạt động thì bị coi là đóng cửa | P1 | 2 ĐT | SẴN SÀNG |
| 11 | TC-SHOP-009 | Cài giờ hoạt động "Cả tuần 00:00-24:00" để quán luôn mở khi thử | P0 | 1 ĐT | SẴN SÀNG |
| 12 | TC-SHOP-010 | Cài giờ riêng từng ngày, nhiều khoảng giờ và ca qua đêm | P1 | 1 ĐT | SẴN SÀNG |
| 13 | TC-CUS-001 | Trang chủ 11Food: lấy vị trí hiện tại và hiện danh sách quán gần bạn | P0 | 1 ĐT | SẴN SÀNG |
| 14 | TC-SHOP-011 | Dựng "Quán Test B" ngoài giờ hoạt động (đóng cửa theo lịch) | P0 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 15 | TC-CUS-002 | Trang chủ khi GPS (dịch vụ vị trí) của điện thoại đang tắt | P1 | 1 ĐT | SẴN SÀNG |
| 16 | TC-SHOP-012 | Thêm món có ảnh vào thực đơn "Quán Test A" | P0 | 1 ĐT | SẴN SÀNG |
| 17 | TC-CUS-003 | Khách đứng ngoài khu vực phục vụ | P1 | 1 ĐT | CẦN XÁC MINH |
| 18 | TC-SHOP-013 | Thêm món: kiểm tra dữ liệu nhập sai | P1 | 1 ĐT | SẴN SÀNG |
| 19 | TC-CUS-004 | Hiện khoảng cách, điểm đánh giá và trạng thái mở cửa trên thẻ quán | P1 | 1 ĐT | SẴN SÀNG |
| 20 | TC-SHOP-014 | Sửa giá món và khách thấy giá mới | P0 | 2 ĐT | SẴN SÀNG |
| 21 | TC-CUS-005 | Tìm quán theo tên (không cần gõ dấu) | P0 | 1 ĐT | SẴN SÀNG |
| 22 | TC-SHOP-015 | Ẩn món và hiện lại món | P0 | 2 ĐT | SẴN SÀNG |
| 23 | TC-CUS-006 | Tìm quán theo tên món | P1 | 1 ĐT | SẴN SÀNG |
| 24 | TC-SHOP-016 | Tìm và lọc món trong thực đơn của chủ quán | P2 | 1 ĐT | SẴN SÀNG |
| 25 | TC-CUS-007 | Tìm không có kết quả và xóa từ khóa | P2 | 1 ĐT | SẴN SÀNG |
| 26 | TC-SHOP-017 | Xóa món khỏi thực đơn | P1 | 2 ĐT | SẴN SÀNG |
| 27 | TC-CUS-008 | Bộ lọc "Chỉ quán đang mở cửa" và lọc theo nhóm món | P1 | 1 ĐT | SẴN SÀNG |
| 28 | TC-SHOP-018 | Chưa có nhóm món thì không thêm được món | P1 | 1 ĐT | CẦN KỸ THUẬT VIÊN LÀM CÙNG |
| 29 | TC-CUS-009 | Trang chi tiết quán: tên, giờ hoạt động, thực đơn và giá | P0 | 1 ĐT | SẴN SÀNG |
| 30 | TC-CUS-011 | Quán chưa có món nào đang hiện | P2 | 1 ĐT | SẴN SÀNG |
| 31 | TC-SHOP-037 | Thêm một món cho "Quán Test B" (quán ngoài giờ) để thử đặt món khi quán đóng cửa | P0 | 1 ĐT | SẴN SÀNG |
| 32 | TC-SHOP-019 | Xem trước thực đơn "như khách sẽ thấy" | P1 | 1 ĐT | SẴN SÀNG |
| 33 | TC-CUS-010 | Quán đóng cửa (Quán Test B): khách thấy nhưng không đặt được | P0 | 1 ĐT | SẴN SÀNG |
| 34 | TC-SHOP-020 | Thoát màn sửa khi còn thay đổi chưa lưu | P2 | 1 ĐT | SẴN SÀNG |
| 35 | TC-CUS-012 | Tìm món trong một quán | P2 | 1 ĐT | SẴN SÀNG |
| 36 | TC-CUS-013 | Điểm đánh giá của quán khi chưa có đánh giá | P2 | 1 ĐT | SẴN SÀNG |
| 37 | TC-ADM-014 | Danh sách quán trên Web Admin: tìm, lọc theo hồ sơ/lịch, xem chi tiết và xem như khách | P0 | PC | SẴN SÀNG |
| 38 | TC-CUS-015 | Thêm món vào giỏ (số lượng và ghi chú) | P0 | 1 ĐT | SẴN SÀNG |
| 39 | TC-CUS-016 | Thêm cùng món cùng ghi chú thì gộp dòng; khác ghi chú thì tách dòng | P1 | 1 ĐT | SẴN SÀNG |
| 40 | TC-CUS-017 | Tăng, giảm số lượng và xóa món khỏi giỏ | P1 | 1 ĐT | SẴN SÀNG |
| 41 | TC-CUS-018 | Giỏ chỉ đặt từ một quán: đổi quán thì hỏi thay giỏ | P1 | 1 ĐT | SẴN SÀNG |
| 42 | TC-CUS-019 | Xóa toàn bộ giỏ hàng | P2 | 1 ĐT | SẴN SÀNG |
| 43 | TC-CUS-020 | Giỏ hàng được giữ khi thoát ứng dụng và khi đăng nhập lại | P1 | 1 ĐT | SẴN SÀNG |
| 44 | TC-CUS-022 | Thêm địa chỉ giao hàng vào sổ địa chỉ | P0 | 1 ĐT | SẴN SÀNG |
| 45 | TC-CUS-021 | Giỏ hiển thị phí giao dự tính và tổng dự kiến | P0 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 46 | TC-CUS-023 | Sửa, đặt mặc định và xóa địa chỉ trong sổ | P1 | 1 ĐT | SẴN SÀNG |
| 47 | TC-CUS-024 | Địa chỉ giao: kiểm tra dữ liệu sai | P2 | 1 ĐT | SẴN SÀNG |
| 48 | TC-CUS-025 | Gửi đơn đặt món: kiểm tra màn "Xác nhận đơn", tiền và thông báo "Đã gửi đơn" | P0 | 1 ĐT | SẴN SÀNG |
| 49 | TC-SHOP-021 | Quán nhận đơn mới của khách và thấy đủ thông tin | P0 | 2 ĐT | SẴN SÀNG |
| 50 | TC-CUS-026 | Không gửi được đơn khi chưa chọn địa chỉ hoặc thiếu thông tin | P1 | 1 ĐT | SẴN SÀNG |
| 51 | TC-SHOP-022 | Quán xác nhận đơn | P0 | 2 ĐT | SẴN SÀNG |
| 52 | TC-SHOP-023 | Quán từ chối đơn có lý do | P0 | 2 ĐT | SẴN SÀNG |
| 53 | TC-CUS-027 | Dùng vị trí hiện tại làm điểm giao khi đặt đơn | P1 | 1 ĐT | CẦN XÁC MINH |
| 54 | TC-SHOP-024 | Quán chỉnh đơn (đổi số lượng, bỏ món) - bắt buộc ghi lý do | P1 | 2 ĐT | SẴN SÀNG |
| 55 | TC-SHOP-025 | Không xác nhận được đơn đã bị bỏ hết món | P2 | 1 ĐT | SẴN SÀNG |
| 56 | TC-CUS-028 | Đặt hộ: người nhận khác người đặt | P1 | 1 ĐT | SẴN SÀNG |
| 57 | TC-SHOP-026 | Quán hủy đơn món trước khi shipper lấy hàng | P0 | 2 ĐT | SẴN SÀNG |
| 58 | TC-CUS-029 | Đặt đơn hẹn giờ nhận món | P1 | 1 ĐT | SẴN SÀNG |
| 59 | TC-SHOP-028 | Đơn hẹn giờ: quán thấy ở tab "Đơn hẹn" và nhận nhắc trước giờ hẹn | P1 | 2 ĐT | SẴN SÀNG |
| 60 | TC-SHOP-029 | Quán đổi lịch sau khi nhận đơn hẹn: đơn không tự hủy, có cảnh báo | P2 | 1 ĐT | SẴN SÀNG |
| 61 | TC-CUS-030 | Hẹn giờ không hợp lệ: quá gần, quá xa, ngoài giờ mở cửa | P2 | 1 ĐT | SẴN SÀNG |
| 62 | TC-CUS-031 | Đặt món ở quán đang đóng cửa bị từ chối | P0 | 1 ĐT | SẴN SÀNG |
| 63 | TC-CUS-032 | Giá món thay đổi trước khi khách gửi đơn: yêu cầu kiểm tra lại | P1 | 2 ĐT | SẴN SÀNG |
| 64 | TC-CUS-033 | Món bị ẩn trước khi khách gửi đơn: báo "Có món không còn bán" | P1 | 2 ĐT | SẴN SÀNG |
| 65 | TC-CUS-034 | Giới hạn: số lượng tối đa mỗi món và độ dài ghi chú | P2 | 1 ĐT | SẴN SÀNG |
| 66 | TC-CUS-035 | Khách xem danh sách đơn: "Đang xử lý", "Đơn hẹn", "Lịch sử" | P1 | 1 ĐT | SẴN SÀNG |
| 67 | TC-CUS-036 | Khách hủy đơn khi quán chưa xác nhận | P0 | 2 ĐT | SẴN SÀNG |
| 68 | TC-CUS-037 | Khách không hủy được sau khi quán xác nhận (chỉ còn khi shipper đã lấy hàng) | P0 | 2 ĐT | SẴN SÀNG |
| 69 | TC-CUS-038 | Đặt lại đơn cũ ("Đặt lại") với giá hôm nay | P1 | 1 ĐT | SẴN SÀNG |
| 70 | TC-CUS-039 | Khách chỉ thấy đơn của chính mình | P0 | 1 ĐT | SẴN SÀNG |
| 71 | TC-CUS-040 | Chi tiết đơn của khách: trạng thái, người trả phí, lịch sử đơn | P1 | 1 ĐT | SẴN SÀNG |
| 72 | TC-SHOP-027 | Lọc, tìm và xem lịch sử đơn của quán | P1 | 1 ĐT | SẴN SÀNG |
| 73 | TC-ACC-030 | Duyệt xem ứng dụng khi chưa đăng nhập (khách vãng lai) | P1 | 1 ĐT | SẴN SÀNG |

## Từ ngữ dùng trong file này (đọc trước)

| Từ | Nghĩa đơn giản |
|---|---|
| **PASS / FAIL / BLOCKED / NOT READY** | Kết quả bạn ghi: PASS = đúng hết; FAIL = có bước sai; BLOCKED = không làm tiếp được vì thiếu điều kiện; NOT READY = chức năng chưa có trong ứng dụng. |
| **KH-A, CQ-A, SP-A, ADMIN-1, SYSTEM…** | Tên viết tắt tài khoản thử: KH = khách hàng, CQ = chủ quán, SP = shipper (người giao hàng), ADMIN = quản trị viên (quyền được cấp), SYSTEM = quản trị cao nhất (do kỹ thuật viên giữ). Mật khẩu nằm trong "bảng thông tin riêng" của Người phụ trách, không có trong tài liệu. |
| **Điện thoại 1 / 2 / 3** | Điện thoại 1 = máy của khách; 2 = máy của quán; 3 = máy của shipper (xem HUONG_DAN mục 5.3 nếu bạn chỉ có 1-2 máy). |
| **Web Admin** | Trang web quản trị mở bằng trình duyệt trên máy tính (không phải ứng dụng điện thoại). |
| **Số dư, tạm giữ, hoa hồng, khả dụng** | Ví của shipper: Số dư = tổng tiền trong ví; Tạm giữ = phần bị giữ khi nhận đơn (hoa hồng); Khả dụng = số dư trừ tạm giữ; hoa hồng được thu một lần khi giao thành công, trả lại khi đơn hủy. Chỉ dùng TIỀN THỬ NGHIỆM đã được Owner duyệt. |
| **Khu vực phục vụ** | Vòng tròn khoảng 10 km quanh trung tâm TP Cao Bằng; ngoài vòng này không đặt/giao được. |
| **Phiên đăng nhập** | Khoảng thời gian bạn đang đăng nhập. Mỗi tài khoản chỉ có một phiên: đăng nhập nơi khác thì nơi cũ bị đăng xuất. |
| **Kỹ thuật viên / Người phụ trách / Owner** | Kỹ thuật viên = người chuẩn bị hệ thống và giữ tài khoản SYSTEM; Người phụ trách = người điều phối buổi test và giữ bảng thông tin riêng; Owner = chủ dự án, quyết định nghiệp vụ và nghiệm thu. |
| **Cột "Sẵn sàng"** | SẴN SÀNG = bạn tự làm được; CẦN CHUẨN BỊ TRƯỚC = kỹ thuật viên chuẩn bị xong rồi bạn tự làm; CẦN KỸ THUẬT VIÊN LÀM CÙNG = có bước kỹ thuật viên làm, bạn quan sát; CHỈ KỸ THUẬT VIÊN = bạn bỏ qua; CẦN XÁC MINH = còn chờ Owner/kỹ thuật viên trả lời. |

---

### TC-SHOP-001 · Chủ quán A tạo hồ sơ quán, ghim vị trí lấy hàng và hoàn tất hồ sơ

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #48 (trong ngày: 1) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #12**

| Mục | Nội dung |
|---|---|
| Mục đích | Quán chỉ được hoạt động khi hồ sơ đủ tên, số điện thoại, địa chỉ và vị trí lấy hàng (ghim GPS). Test này tạo "Quán Test A". |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-003 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | CQ-A đã đăng ký (TC-ACC-003). Người kiểm thử đang đứng TẠI VỊ TRÍ quán thử, bên trong khu vực phục vụ (khoảng 10 km quanh trung tâm TP Cao Bằng), bật GPS, sẵn sàng cho phép quyền vị trí cho 11Food. |
| Dữ liệu nhập | Tên cửa hàng: "Quán Test A". Số điện thoại liên hệ: số SĐT-CQ-A (hoặc số khác của bạn). Địa chỉ lấy hàng: "Số 1 đường Test, tổ 1, phường Test, thành phố Cao Bằng" (đổi cho đúng nơi bạn đứng nếu muốn). Zalo/Facebook: bỏ trống (không bắt buộc). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 đăng nhập CQ-A. Nếu đang ở màn "Quản lý cửa hàng" thì chạm "Tạo hồ sơ cửa hàng"; nếu không: tab "Quán" > "Tiếp tục hồ sơ", hoặc tab "Tài khoản" > "Đăng ký mở quán" > "Tạo hồ sơ cửa hàng". | Mở màn "Hồ sơ cửa hàng" gồm: mục logo (không bắt buộc), phần "Thông tin liên hệ" (ô "Tên cửa hàng", "Số điện thoại liên hệ"), phần "Vị trí" (hàng "Địa chỉ lấy hàng" đang ghi "Chọn địa chỉ"), ô "Zalo", "Facebook" và nút "Hoàn tất hồ sơ". |
| 2 | Nhập "Tên cửa hàng" và "Số điện thoại liên hệ" như phần Dữ liệu nhập. CHƯA chọn địa chỉ. Chạm "Hoàn tất hồ sơ". | KHÔNG hoàn tất: hàng "Địa chỉ lấy hàng" báo lỗi thiếu địa chỉ/vị trí và có dòng nhắc "Mở địa chỉ và chọn ghim vị trí lấy hàng để hoàn tất hồ sơ." |
| 3 | Chạm hàng "Địa chỉ lấy hàng". Ở màn "Chọn địa chỉ", gõ địa chỉ vào ô "Địa chỉ", rồi chạm "Vị trí hiện tại" và cho phép quyền vị trí khi điện thoại hỏi. | Hiện "Đang lấy vị trí qua GPS và mạng…" rồi "Đã lấy vị trí hiện tại" (kèm độ chính xác nếu có). Ứng dụng lấy đúng MỘT vị trí thật khi bạn bấm; không tự điền vị trí mặc định. |
| 4 | Chạm "Lưu địa chỉ". | Quay về màn "Hồ sơ cửa hàng"; hàng "Địa chỉ lấy hàng" hiện địa chỉ vừa nhập. |
| 5 | Chạm "Hoàn tất hồ sơ". | Hiện thông báo "Đã hoàn tất hồ sơ cửa hàng." và mở màn "Cửa hàng của tôi" với trạng thái hồ sơ đã hoàn tất. Hệ thống tự xác định khu vực phục vụ (không bắt chọn khu vực). |
| 6 | Chạm "Vào quản lý cửa hàng" (hoặc quay lại và mở tab "Quán"). | Vào được khu quản lý quán; ở tab "Tài khoản" thẻ vai trò có thêm nhãn "Chủ quán". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không xóa được hồ sơ bằng ứng dụng. Muốn tạo quán mới cần tài khoản chủ quán khác (CQ-B). Ghi lại tên quán và vị trí đã ghim.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/shop_views.dart (ShopStartScreen, ShopFormScreen, _completeReason); mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart; apps/backend/src/shop`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-onboarding.int.spec.ts; food-shop-onboarding-browser.int.spec.ts; shop-service-areas.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-015 · Ghi nhận hiện trạng: quán hoạt động ngay khi hồ sơ đủ, không có bước "Admin duyệt quán"

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #49 (trong ngày: 2) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Xác nhận bằng mắt thường ứng dụng và Web Admin đang làm gì với hồ sơ quán mới: quán đủ điều kiện hoạt động NGAY, không có hàng chờ duyệt. Test chỉ GHI NHẬN hiện trạng để Owner đối chiếu với câu "Chỉ bán hàng sau khi được duyệt" còn hiện trên màn đăng ký. Bộ test KHÔNG tự quyết quán có cần duyệt hay không. |
| Người thực hiện | ADMIN/SYSTEM + Chủ quán |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Quán Test A vừa hoàn tất hồ sơ (TC-SHOP-001). Bạn đăng nhập Web Admin (ADMIN-1 hoặc SYSTEM) trên máy tính; chủ quán dùng Điện thoại 2. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Hiện trạng theo mã nguồn: chủ quán bấm "Hoàn tất hồ sơ" đủ thông tin thì quán hoạt động ngay; Web Admin chỉ có "Vô hiệu hóa quán"/"Kích hoạt lại quán", không có "Duyệt"/"Từ chối hồ sơ". Trong khi đó màn đăng ký có câu "Chỉ bán hàng sau khi được duyệt" và bảng Tổng quan có thẻ "Hồ sơ quán chờ duyệt". Quyết định nghiệp vụ nằm ở Owner: xem câu hỏi OQ-01 trong CHECKLIST_NGHIEM_THU mục 7. PASS ở đây chỉ nghĩa là "hiện trạng đúng như mô tả bên dưới", KHÔNG nghĩa Owner đã đồng ý nghiệp vụ. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 (chủ quán CQ-A) mở 11Food, vào chế độ quản lý quán, nhìn thẻ trạng thái hồ sơ ở đầu màn hình. | Thẻ trạng thái ghi "Đã hoàn tất" (hoặc tương đương) và KHÔNG có dòng "Đang chờ duyệt". Chụp màn hình. |
| 2 | Trên Web Admin, ở menu bên trái chọn VẬN HÀNH > "Quán", mở chi tiết "Quán Test A" và tìm nút "Duyệt" hoặc "Từ chối hồ sơ". | Quán đã ở trạng thái hoạt động. KHÔNG có nút "Duyệt"/"Từ chối hồ sơ"; chỉ thấy "Vô hiệu hóa quán" (và "Kích hoạt lại quán" khi quán đã bị vô hiệu hóa). Chụp màn hình. |
| 3 | Mở trang Điều hành (Tổng quan) và tìm thẻ "Hồ sơ quán chờ duyệt". | Ghi lại đúng số/chữ đang hiển thị (có thể 0 hoặc không có ý nghĩa) vào Ghi chú kết quả để Owner đối chiếu. Chụp màn hình. |
| 4 | Trên Điện thoại 1 (khách) mở 11Food, tìm "Quán Test A" ở Trang chủ trong giờ mở cửa. | Quán xuất hiện cho khách ngay (không cần ai duyệt). |

**Cách kết luận:** PASS: cả bốn bước đúng như mô tả (xác nhận HIỆN TRẠNG: quán hoạt động ngay, không có bước duyệt). FAIL: có bước khác mô tả - ví dụ xuất hiện nút "Duyệt"/"Từ chối" hoặc quán không hiện cho khách dù đủ điều kiện (ghi rõ bước số mấy, chụp ảnh). Kết luận "có cần duyệt hay không" KHÔNG thuộc người kiểm thử: ghi câu "Chờ Owner trả lời OQ-01" vào Ghi chú kết quả. BLOCKED: không đăng nhập được Web Admin hoặc chưa có Quán Test A. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `docs/current/M02-admin-shops-20261024.md; mobile README (Food - shop profile: shop becomes ACTIVE); account_views.dart (dòng "Chỉ bán hàng sau khi được duyệt")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-onboarding.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-002 · Quán C chưa đủ điều kiện kích hoạt: không hoàn tất được khi thiếu địa chỉ hoặc vị trí ghim

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #50 (trong ngày: 3) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán thiếu thông tin hoặc chưa ghim vị trí KHÔNG được coi là quán đang hoạt động: khách không thấy và hồ sơ chưa được gửi lên máy chủ. |
| Người thực hiện | Chủ quán (CQ-C) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Việc cần chuẩn bị trước | Kỹ thuật viên đã bật máy SMS Gateway, gửi thử SMS tới số điện thoại của bạn thành công trước giờ test, và bảo đảm số của bạn được phép nhận SMS. Bạn có SIM thật của số đó trong tay. Số điện thoại dùng cho test này chưa từng đăng ký 11Food/11Ship (Người phụ trách ghi sẵn trong bảng thông tin riêng). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Có tài khoản CQ-C mới (số điện thoại thứ ba, SIM thật) đăng ký mục đích "Chủ quán" (làm như TC-ACC-003). Nếu không có thêm số điện thoại: ghi BLOCKED. |
| Dữ liệu nhập | Tên cửa hàng "Quán Test C". Số điện thoại liên hệ: số của bạn. Lần 1: để TRỐNG địa chỉ. Lần 2: gõ địa chỉ bằng chữ nhưng KHÔNG chạm "Vị trí hiện tại". |
| Ghi chú đặc biệt | Theo mã nguồn, hồ sơ chỉ được lưu lên máy chủ khi bấm "Hoàn tất hồ sơ" với đủ thông tin và đã ghim vị trí; nếu thiếu thì ứng dụng chặn ngay trên máy và KHÔNG tạo quán nào ở máy chủ. Vì vậy "Quán Test C" sẽ không xuất hiện ở Web Admin. Cần Người phụ trách xác nhận đây là hành vi mong muốn. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập CQ-C, mở "Tạo hồ sơ cửa hàng", nhập "Quán Test C" và số điện thoại, để trống địa chỉ, chạm "Hoàn tất hồ sơ". | KHÔNG hoàn tất; hàng "Địa chỉ lấy hàng" báo lỗi và hiện "Mở địa chỉ và chọn ghim vị trí lấy hàng để hoàn tất hồ sơ." |
| 2 | Chạm hàng "Địa chỉ lấy hàng", gõ địa chỉ bằng chữ vào ô "Địa chỉ" nhưng KHÔNG chạm "Vị trí hiện tại", chạm "Lưu địa chỉ". | Không lưu được: hiện "Chọn vị trí trên bản đồ trước khi lưu." (hoặc tương tự). |
| 3 | Bấm Back để về màn hồ sơ, chạm "Hoàn tất hồ sơ" lần nữa. | Vẫn không hoàn tất; không có thông báo "Đã hoàn tất hồ sơ cửa hàng.". |
| 4 | Trên máy khách (KH-A) tìm "Quán Test C" trong ô "Tìm quán hoặc món". | KHÔNG thấy "Quán Test C" ("Không có kết quả"/"Chưa có quán phù hợp"). |
| 5 | (Nếu có Web Admin) VẬN HÀNH > Quán, gõ "Quán Test C" vào ô tìm. | Không có quán nào tên này (hồ sơ chưa lên máy chủ). Ghi nhận kết quả thực tế. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Để nguyên CQ-C ở trạng thái chưa hoàn tất hồ sơ để dùng lại cho các test sau (không hoàn tất hồ sơ).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/shop_views.dart (shop-complete, _completeReason); mobile/packages/n11_shared/lib/src/flows/shop_controller.dart (fieldErrors, finishProfile); addresses/address_location_picker.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-onboarding.int.spec.ts; shop-onboarding-faults.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-012 · Danh sách người dùng: tìm, lọc "Đang khóa", xem chi tiết

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #51 (trong ngày: 4) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin tìm tài khoản theo tên/số điện thoại và xem trạng thái, vai trò, hồ sơ liên quan. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã đăng nhập Web Admin (SYSTEM hoặc ADMIN-1). Có tài khoản KH-A, CQ-A, SP-A. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: TÀI KHOẢN > Người dùng > "Danh sách". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Gõ số điện thoại của KH-A vào ô "Tìm theo tên hoặc số điện thoại". | Còn đúng tài khoản KH-A ("Khách Test A"). |
| 3 | Mở chi tiết ("Chi tiết người dùng"). | Thấy Họ tên, Số điện thoại, "Vai trò" (Khách hàng), "Trạng thái", "Xác minh số điện thoại", "Hồ sơ khách hàng", "Dữ liệu liên quan", "Lịch sử tài khoản". |
| 4 | Gõ tên hoặc số điện thoại CQ-A vào ô tìm kiếm và mở chi tiết CQ-A; làm tương tự với SP-A. | Có vai trò Chủ quán và "Hồ sơ quán" (tên quán); SP-A có vai trò Shipper và "Hồ sơ shipper". |
| 5 | Chọn menu con "Đang khóa". | Chỉ hiện tài khoản đang bị khóa (nếu không có: "Chưa có người dùng đang khóa"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/accounts-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-account-read.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-003 · Lấy vị trí quán khi chưa cấp quyền GPS, GPS tắt hoặc GPS yếu

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #52 (trong ngày: 5) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu không có vị trí thật thì không ghim được và không hoàn tất hồ sơ; ứng dụng phải nói rõ lý do và cách xử lý. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-003 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Một tài khoản chủ quán chưa hoàn tất hồ sơ (ví dụ CQ-C). Quyền vị trí của 11Food đang "Không cho phép". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Hồ sơ cửa hàng", chạm hàng "Địa chỉ lấy hàng", gõ một địa chỉ, chạm "Vị trí hiện tại". Khi điện thoại hỏi quyền, chọn "Không cho phép". | Hiện thông báo kiểu "Chưa được cấp quyền vị trí. Hãy cho phép trong cài đặt ứng dụng hoặc chạm bản đồ để chọn." Không có vị trí giả nào được điền. |
| 2 | Cấp quyền vị trí cho 11Food nhưng TẮT GPS (Vị trí) của điện thoại, rồi chạm "Vị trí hiện tại" lần nữa. | Hiện "Hãy bật vị trí trên điện thoại hoặc chọn trên bản đồ." |
| 3 | Bật GPS, vào trong nhà kín để GPS yếu, chạm "Vị trí hiện tại" và chờ. | Sau thời gian chờ hiện "Hết thời gian chờ vị trí từ GPS và mạng. Hãy thử ở nơi thoáng hơn hoặc chạm bản đồ để chọn." (hoặc "Điện thoại chưa cung cấp vị trí hợp lệ."). |
| 4 | Ra nơi thoáng, chạm "Vị trí hiện tại" lần nữa. | Lấy được vị trí ("Đã lấy vị trí hiện tại"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Để quyền vị trí bật.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart (thông báo vị trí); flows/location.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/address_location_picker_test.dart; flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-004 · Vị trí quán nằm ngoài khu vực phục vụ

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #53 (trong ngày: 6) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán chỉ được kích hoạt khi vị trí nằm trong khu vực phục vụ đã cấu hình (vòng tròn quanh TP Cao Bằng). |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Việc cần chuẩn bị trước | Người phụ trách xác nhận khu vực phục vụ (bán kính khoảng 10 km quanh TP Cao Bằng) và bạn hoặc người được nhờ đứng đúng vị trí mà test yêu cầu. KHÔNG dùng ứng dụng giả vị trí. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Người kiểm thử đứng ngoài khu vực phục vụ, GPS bật. Có tài khoản chủ quán chưa hoàn tất hồ sơ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần một người đứng ngoài khu vực phục vụ (hơn khoảng 10 km), hoặc kỹ thuật viên tạm đổi vùng phục vụ. KHÔNG dùng ứng dụng giả vị trí. Nếu không có điều kiện, ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Nhập đủ tên, số điện thoại, địa chỉ, lấy vị trí hiện tại. | Lấy được vị trí. |
| 2 | Chạm "Hoàn tất hồ sơ". | Không hoàn tất; hiện "Hệ thống chưa xác định được khu vực phục vụ cho quán. Bấm Hoàn tất hồ sơ để thử xác định lại." (hoặc câu tương tự). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không tạo quán nào; quay về vị trí trong khu vực để làm test khác.

**Căn cứ:** `docs/ops/service-area-gps-154.md; flows/shop_views.dart (invalidServiceArea)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-service-areas.int.spec.ts; mobile/packages/n11_shared/test/m02_gps_area_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-005 · Chủ quán chuyển qua lại giữa chế độ quản lý quán và chế độ khách hàng

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #54 (trong ngày: 7) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Một tài khoản chủ quán dùng chung ứng dụng 11Food và tự chuyển chế độ; chỉ khi bấm mới đổi, không tự đổi. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-A đã hoàn tất hồ sơ quán. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 (máy QUÁN), mở ứng dụng 11Food rồi chạm tab "Tài khoản" ở thanh dưới cùng. | Màn hình "Tài khoản" mở ra, có hai nút "Tạo tài khoản" và "Đăng nhập". |
| 2 | Chạm nút "Đăng nhập". Ở ô "Số điện thoại" gõ số điện thoại của tài khoản CQ-A. Ở ô "Mật khẩu" gõ mật khẩu của tài khoản CQ-A (lấy từ bảng thông tin riêng của Người phụ trách). | Màn hình "Đăng nhập" hiện dòng "Chào mừng trở lại"; hai ô đã có chữ, nút "Đăng nhập" bấm được. |
| 3 | Chạm nút "Đăng nhập". | Đăng nhập thành công, trở về tab "Tài khoản"; thấy tên của CQ-A, số điện thoại đã che bớt và nhãn vai trò "Khách hàng, Chủ quán". |
| 4 | Chạm tab "Quán". | Hiện "Quản lý quán của bạn" - "Bạn đang ở chế độ khách hàng...". KHÔNG tự vào chế độ quán. |
| 5 | Chạm "Vào chế độ quản lý quán". | Chuyển sang chế độ quán: thấy thông tin quán, trạng thái mở/đóng, thực đơn, giờ hoạt động; cuối trang có "Về chế độ khách hàng". |
| 6 | Chạm tab "Đơn hàng". | Có hai nút chia "Đơn món" và "Giao hàng" (giao diện chủ quán). |
| 7 | Quay lại tab "Quán" và chạm "Về chế độ khách hàng". Sang tab "Đơn hàng". | Tab "Đơn hàng" trở lại dạng của khách: "Đang xử lý", "Đơn hẹn", "Lịch sử". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Để ở chế độ quản lý quán nếu test tiếp theo cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/shop_tab.dart; mobile/food/lib/food_tabs.dart (_orders)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-auth-adapter.int.spec.ts; shop-management.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-006 · Sửa hồ sơ quán đang hoạt động (tên, số điện thoại liên hệ)

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #55 (trong ngày: 8) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chủ quán sửa được thông tin quán; thay đổi phải hiện ra cho khách và Admin. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-A đang ở chế độ quản lý quán. |
| Dữ liệu nhập | Tên mới: "Quán Test A Sửa"; sau đó đặt lại "Quán Test A". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong tab "Quán" (chế độ quán), chạm "Hồ sơ quán" > "Sửa hồ sơ". | Màn "Sửa hồ sơ quán" mở ra với dữ liệu hiện tại. |
| 2 | Đổi tên thành "Quán Test A Sửa", chạm "Lưu hồ sơ". | Lưu thành công, không có thông báo lỗi; tên mới hiện ở "Hồ sơ quán". |
| 3 | Trên máy khách tìm "Quán Test A Sửa". | Khách thấy quán với tên mới (có thể cần kéo làm mới). |
| 4 | Chủ quán đổi lại tên "Quán Test A" và lưu. | Lưu thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Đã đổi lại tên cũ ở bước 4.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/shop_manage_views.dart ("Sửa hồ sơ quán", "Lưu hồ sơ"); apps/backend/src/shop-management`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-management.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-007 · Thêm logo quán (không bắt buộc) và gỡ logo

**Mức độ:** P2 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #56 (trong ngày: 9) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Logo giúp khách nhận ra quán; ảnh sai định dạng hoặc quá nhỏ phải bị từ chối rõ ràng. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-A ở chế độ quản lý quán. |
| Dữ liệu nhập | Ảnh logo JPG hoặc PNG kích thước lớn hơn 1 MB không cần, nhưng ảnh phải đủ độ phân giải; một file không phải ảnh (ví dụ file .pdf) để thử lỗi. |
| Ghi chú đặc biệt | Chưa xác định chính xác màn hình có mục "Logo quán · không bắt buộc" (có trong hồ sơ quán). Nếu không tìm thấy, ghi lại màn hình và báo Người phụ trách. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Sửa hồ sơ quán" và tìm mục "Logo quán · không bắt buộc", chạm "Chọn logo". | Mở bộ chọn ảnh của điện thoại. |
| 2 | Chọn một ảnh đúng định dạng, kéo chọn phần ảnh trong khung vuông ("Kéo ảnh để chọn phần logo trong khung vuông."), chạm "Dùng ảnh này", rồi "Lưu hồ sơ". | Logo mới hiện ở hồ sơ quán và ở danh sách quán phía khách. |
| 3 | Thử chọn một file không phải ảnh hoặc ảnh sai định dạng. | Hiện "Ảnh không đúng định dạng. Vui lòng chọn JPG, PNG hoặc WebP." hoặc "Không đọc được ảnh này. Vui lòng chọn ảnh khác." |
| 4 | Chạm "Gỡ logo" rồi lưu. | Logo biến mất, quán dùng biểu tượng mặc định. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Gỡ logo thử nghiệm nếu không muốn giữ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/shop_logo_widgets.dart; tests: shop-logo.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-logo.int.spec.ts; mobile/packages/n11_shared/test/shop_logo_test.dart; shop_logo_recovery_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-008 · Quán chưa cài giờ hoạt động thì bị coi là đóng cửa

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #57 (trong ngày: 10) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán mới tạo chưa có lịch phải hiển thị là đóng, để khách không đặt nhầm. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | "Quán Test A" vừa hoàn tất hồ sơ, CHƯA cài giờ hoạt động. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy chủ quán (chế độ quản lý quán) xem phần trạng thái hoạt động. | Hiện "Chưa cài giờ hoạt động" / "Quán chưa cài giờ hoạt động" và quán được tính là đóng cửa. |
| 2 | Trên máy khách tìm "Quán Test A". | Quán (nếu hiện) mang nhãn "Đã đóng cửa"/"Chưa cài giờ hoạt động"; không đặt được đơn ngay. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Cài giờ ở TC-SHOP-009 để tiếp tục.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/hours_views.dart; mobile/packages/n11_shared/lib/src/m02/preview_views.dart (NO_BUSINESS_HOURS: "Quán chưa cài giờ hoạt động.")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-availability.int.spec.ts; shop-management.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-009 · Cài giờ hoạt động "Cả tuần 00:00-24:00" để quán luôn mở khi thử

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #58 (trong ngày: 11) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #13**

| Mục | Nội dung |
|---|---|
| Mục đích | Cài lịch giúp quán tự mở/đóng; chọn cả ngày để Quán Test A đang mở suốt thời gian kiểm thử. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-A ở chế độ quản lý quán. |
| Dữ liệu nhập | Cả tuần, giờ mở 00:00, giờ đóng 24:00 (hoặc "Cả ngày (00:00-24:00)"). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Quán" > "Cài giờ hoạt động" (hoặc "Giờ hoạt động"). | Màn "Giờ hoạt động" với dòng "Giờ Việt Nam. Quán tự mở và đóng theo lịch này - không cần bật/tắt thủ công." và công cụ "Nhập nhanh"/"Cả tuần". |
| 2 | Chạm "Cả tuần", chọn "Cả ngày" (00:00-24:00), chạm "Áp dụng cho cả tuần". | Hiện "Đã áp dụng cho cả tuần. Chưa lưu - bấm Lưu lịch để ghi." |
| 3 | Chạm "Lưu lịch". | Lưu thành công; trạng thái quán hiện "Đang mở cửa". |
| 4 | Trên máy khách xem quán. | Quán Test A hiển thị "Đang mở cửa". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Có thể giữ lịch cả ngày cho các test sau.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/hours_views.dart (Nhập nhanh, Lưu lịch); mobile/packages/n11_shared/lib/src/m02/schedule.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_hours_views_test.dart; schedule_test.dart; tests/integration/shop-management.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-010 · Cài giờ riêng từng ngày, nhiều khoảng giờ và ca qua đêm

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #59 (trong ngày: 12) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán có thể mở nhiều ca trong ngày và ca qua nửa đêm. Lịch sai (chồng giờ) phải bị chặn. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Mở màn "Giờ hoạt động" của một quán thử. Ghi lại lịch cũ để đặt lại. |
| Dữ liệu nhập | Thứ Hai: 06:00-10:00 và 16:00-22:00. Chủ nhật: ca qua đêm 22:00-02:00 (giờ đóng thuộc ngày hôm sau). Thử thêm một khoảng chồng giờ (ví dụ 09:00-12:00 chồng với 06:00-10:00). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chọn "Tùy chỉnh theo ngày", chọn Thứ Hai, "+ Thêm khoảng" và nhập 06:00-10:00, thêm khoảng thứ hai 16:00-22:00. | Hai khoảng hiện; tổng khoảng giờ trong tuần được đếm ("Tổng … khoảng giờ trong tuần"). |
| 2 | Chọn Chủ nhật, thêm khoảng 22:00-02:00. | Hiện nhãn "Qua đêm" / "Giờ đóng thuộc ngày hôm sau (Thứ Hai)". |
| 3 | Thêm khoảng chồng giờ 09:00-12:00 vào Thứ Hai và chạm "Lưu lịch". | Không lưu; hiện "Lịch chưa hợp lệ. Kiểm tra giờ mở, giờ đóng và các khoảng trùng nhau." |
| 4 | Xóa khoảng chồng giờ ("Xóa khoảng 3"), chạm "Lưu lịch". | Lưu thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Đặt lại "Cả tuần 00:00-24:00" (TC-SHOP-009) để quán mở khi thử.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/hours_views.dart (kMaxIntervalsPerWeek=28, "Ca qua đêm thuộc ngày bắt đầu")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_hours_views_test.dart; schedule_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-001 · Trang chủ 11Food: lấy vị trí hiện tại và hiện danh sách quán gần bạn

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #60 (trong ngày: 13) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách thấy quán gần mình ngay khi mở ứng dụng; ứng dụng tự xác định khu vực phục vụ từ GPS. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-009 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | 11Food mở trên Điện thoại 1, đã cấp quyền vị trí, GPS bật, người thử đứng trong khu vực phục vụ. Quán Test A đang mở. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food, tab "Trang chủ". | Hiện "Đang định vị…" / "Đang xác định khu vực…" rồi dòng "Khu vực: Cao Bằng" (tên khu vực phục vụ). |
| 2 | Cuộn xuống phần "Quán gần bạn". | Có danh sách quán; "Quán Test A" xuất hiện với nhãn "Đang mở cửa". |
| 3 | Chạm nút "Xem tất cả" (nếu có). | Mở màn "Danh sách quán" với cùng các quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart ("Khu vực: …", "Quán gần bạn"); docs/ops/service-area-gps-154.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_discovery_test.dart; m02_gps_area_test.dart; tests/integration/discovery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-011 · Dựng "Quán Test B" ngoài giờ hoạt động (đóng cửa theo lịch)

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #61 (trong ngày: 14) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Cần một quán đã hoàn tất hồ sơ nhưng đang nằm ngoài giờ mở cửa, để thử khách không đặt được món. |
| Người thực hiện | Chủ quán (CQ-B) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Việc cần chuẩn bị trước | Kỹ thuật viên đã bật máy SMS Gateway, gửi thử SMS tới số điện thoại của bạn thành công trước giờ test, và bảo đảm số của bạn được phép nhận SMS. Bạn có SIM thật của số đó trong tay. Số điện thoại dùng cho test này chưa từng đăng ký 11Food/11Ship (Người phụ trách ghi sẵn trong bảng thông tin riêng). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Có tài khoản CQ-B (số điện thoại riêng, SIM thật) đã đăng ký mục đích "Chủ quán". Ghi chú: CQ-B có thể dùng lại số điện thoại của Khách B nếu Người phụ trách cho phép (một số điện thoại = một tài khoản; nên dùng số khác). |
| Dữ liệu nhập | Tên "Quán Test B". Địa chỉ/vị trí: ghim ngay tại chỗ bạn đứng (trong khu vực phục vụ). Giờ hoạt động: chỉ mở khoảng giờ CHẮC CHẮN không chứa giờ hiện tại, ví dụ nếu bây giờ là 14:00 thì đặt mở 03:00-04:00 mỗi ngày. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập CQ-B trên Điện thoại 2, chạm "Tạo hồ sơ cửa hàng"; nhập "Tên cửa hàng" = Quán Test B và "Số điện thoại liên hệ"; chạm hàng "Địa chỉ lấy hàng", gõ địa chỉ vào ô "Địa chỉ", chạm "Vị trí hiện tại" (cho phép quyền vị trí nếu điện thoại hỏi), chạm "Lưu địa chỉ", rồi chạm "Hoàn tất hồ sơ". | Hồ sơ hoàn tất. |
| 2 | Chế độ quản lý quán > "Cài giờ hoạt động": "Tùy chỉnh theo ngày" hoặc "Cả tuần", đặt khoảng giờ ở xa giờ hiện tại (ví dụ 03:00-04:00) và "Lưu lịch". | Lưu thành công. Trạng thái quán hiện "Đã đóng cửa" (ngoài giờ hoạt động). |
| 3 | Trên máy khách tìm "Quán Test B". | Quán hiện nhưng có nhãn "Đã đóng cửa" (hoặc "Ngoài giờ hoạt động đã cài đặt."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Giữ nguyên Quán Test B ở trạng thái ngoài giờ để dùng cho TC-CUS-010 và TC-CUS-031. Khi cần đổi lại thì sửa giờ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/hours_views.dart; mobile/packages/n11_shared/lib/src/m02/preview_views.dart (OUTSIDE_BUSINESS_HOURS)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-availability.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-002 · Trang chủ khi GPS (dịch vụ vị trí) của điện thoại đang tắt

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #62 (trong ngày: 15) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi GPS tắt, ứng dụng nói rõ và cho thử lại; không hiện sai khu vực. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Quyền vị trí đã cấp nhưng GPS (Vị trí) của điện thoại TẮT. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food > "Trang chủ". | Hiện "Vị trí đang tắt. Thử lại" (hoặc thông báo tương tự). Không hiện khu vực sai. |
| 2 | Bật GPS rồi chạm "Thử lại". | Ứng dụng chờ định vị rồi hiện khu vực và danh sách quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Để GPS bật.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart ("Vị trí đang tắt. Thử lại", "Đang chờ GPS. Thử lại")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_gps_area_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-012 · Thêm món có ảnh vào thực đơn "Quán Test A"

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #63 (trong ngày: 16) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #14**

| Mục | Nội dung |
|---|---|
| Mục đích | Chủ quán thêm món (tên, giá, nhóm món, ảnh); món hiển thị cho khách. Để thêm món cần có "Nhóm món" do Admin tạo sẵn. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ADM-020 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Admin đã tạo ít nhất một "Nhóm món" đang bật (TC-ADM-020). CQ-A ở chế độ quản lý quán. |
| Dữ liệu nhập | Món 1: tên "Bún chả Test", giá 45000, nhóm "Món chính" (hoặc nhóm đang có), ảnh bất kỳ. Món 2: "Nem rán Test", 30000. Món 3: "Trà đá Test", 5000, nhóm "Đồ uống". Món 4: "Món ẩn Test", 20000 (sẽ ẩn ở test sau). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Quán" > "Thực đơn" > chạm "+ Thêm món". | Màn "Thêm món" mở ra: "Tên món", "Giá bán (đ)", "Nhóm món", "Ảnh món (không bắt buộc)", công tắc "Hiển thị với khách". |
| 2 | Nhập Tên món, Giá bán 45000, chọn Nhóm món, chạm "Chọn ảnh từ thiết bị" và chọn ảnh, chạm "Lưu món". | Hiện thông báo lưu thành công; món "Bún chả Test" xuất hiện trong danh sách thực đơn kèm giá "45.000 đ" và trạng thái "Đang hiện". |
| 3 | Lặp lại cho "Nem rán Test", "Trà đá Test", "Món ẩn Test". | Cả bốn món có trong thực đơn. |
| 4 | Trên máy khách mở trang Quán Test A. | Khách thấy 4 món (cả "Món ẩn Test" cho đến khi ẩn ở TC-SHOP-015) với giá đúng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Có thể giữ món cho các test sau. Món thử có thể xóa ở TC-SHOP-017.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart (+ Thêm món, Lưu món); apps/backend/src/menu`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/menu.int.spec.ts; mobile/packages/n11_shared/test/m02_menu_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-003 · Khách đứng ngoài khu vực phục vụ

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #64 (trong ngày: 17) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Ngoài vùng phục vụ ứng dụng không được hứa giao hàng và phải hướng dẫn khách. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Việc cần chuẩn bị trước | Người phụ trách xác nhận khu vực phục vụ (bán kính khoảng 10 km quanh TP Cao Bằng) và bạn hoặc người được nhờ đứng đúng vị trí mà test yêu cầu. KHÔNG dùng ứng dụng giả vị trí. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | GPS bật, quyền vị trí đã cấp, người thử ở ngoài khu vực. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần người thật đứng ngoài khu vực phục vụ (cách trung tâm TP Cao Bằng hơn khoảng 10 km) hoặc kỹ thuật viên tạm đổi vùng. Không dùng ứng dụng giả vị trí; nếu không làm được ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food > "Trang chủ". | Hiện "Ngoài khu vực phục vụ" / "Khu vực này chưa được phục vụ" / "Hiện chưa thể giao hàng tới vị trí này." |
| 2 | Đọc phần hướng dẫn bên dưới. | Có gợi ý "Hoặc xem quán theo khu vực tham khảo:" và/hoặc "Thử xác định lại khu vực". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart ("Ngoài khu vực phục vụ")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_gps_area_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-013 · Thêm món: kiểm tra dữ liệu nhập sai

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #65 (trong ngày: 18) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Món thiếu tên, giá không phải số, giá quá lớn hoặc ảnh sai phải bị từ chối bằng thông báo rõ. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Mở màn "Thêm món". |
| Dữ liệu nhập | Lần 1: bỏ trống tên. Lần 2: tên "Món lỗi", giá "abc". Lần 3: giá "0". Lần 4: giá "999999999999". Lần 5: tên 300 ký tự. Lần 6: file ảnh không hợp lệ. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Thử từng dữ liệu ở mục Dữ liệu nhập, chạm "Lưu món" mỗi lần. | Mỗi lần ứng dụng không lưu và báo lỗi cụ thể (ví dụ "Nhập số nguyên, ví dụ 120.000 đ."). Không có món lỗi nào xuất hiện trong thực đơn. |
| 2 | Chọn một ảnh không hợp lệ (không phải ảnh). | Hiện "Ảnh không hợp lệ. Hãy chọn ảnh khác hoặc bỏ ảnh." hoặc "Ảnh chưa dùng được". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Thoát màn hình, nếu có hộp "Bỏ thay đổi chưa lưu?" thì chọn "Bỏ thay đổi".

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart; apps/backend/src/menu (INVALID_MENU_IMAGE)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/menu.int.spec.ts; mobile/packages/n11_shared/test/menu_controller_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-004 · Hiện khoảng cách, điểm đánh giá và trạng thái mở cửa trên thẻ quán

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #66 (trong ngày: 19) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Thẻ quán cho khách biết nhanh quán đóng/mở, xa bao nhiêu và được đánh giá thế nào. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-001 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Điện thoại 1 ở gần Quán Test A (biết khoảng cách thực tế, ví dụ đo bằng bản đồ khác). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Trang chủ" > "Quán gần bạn", xem thẻ "Quán Test A". | Thẻ có tên quán, nhãn "Đang mở cửa", điểm đánh giá (hoặc "Chưa có đánh giá"), khoảng cách. |
| 2 | So khoảng cách hiển thị với khoảng cách thực tế bạn đo (đường chim bay). | Chênh lệch hợp lý (vài chục đến vài trăm mét do sai số GPS). Nếu sai lệch lớn (>1 km) ghi lỗi. |
| 3 | Chạm vào thẻ quán. | Mở trang chi tiết đúng quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart (thẻ quán: rating, distance, chip)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_discovery_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-014 · Sửa giá món và khách thấy giá mới

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #67 (trong ngày: 20) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Giá đổi phải áp dụng cho đơn đặt sau đó, không đổi giá đơn đã đặt. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A có món "Nem rán Test" giá 30.000đ. |
| Dữ liệu nhập | "Nem rán Test": đổi giá từ 30000 thành 35000, sau đó đổi lại 30000. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán: Thực đơn > chạm "Nem rán Test" > "Sửa món", đổi giá thành 35000, chạm "Lưu thay đổi". | Lưu thành công; giá hiện "35.000 đ". |
| 2 | Khách: mở lại trang Quán Test A (kéo làm mới nếu cần). | Giá "Nem rán Test" hiện 35.000đ. |
| 3 | Chủ quán đổi lại 30000 và lưu. | Giá về 30.000đ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Đã đổi lại giá 30.000đ ở bước 3.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart (Sửa món, Lưu thay đổi)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/menu.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-005 · Tìm quán theo tên (không cần gõ dấu)

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #68 (trong ngày: 21) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách tìm quán bằng tên, gõ không dấu vẫn ra. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-009 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A đang mở. |
| Dữ liệu nhập | Từ khóa: "quan test a", sau đó "QUÁN TEST A". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở "Trang chủ" chạm ô "Tìm quán hoặc món" ("Gõ tên quán hoặc tên món. Không cần gõ dấu.") và gõ "quan test a". | Danh sách kết quả hiện "Quán Test A" (và Quán Test B nếu tên chứa "quan test"). |
| 2 | Gõ "QUÁN TEST A" (viết hoa, có dấu). | Vẫn ra cùng kết quả. |
| 3 | Chạm kết quả "Quán Test A". | Mở trang quán "Quán Test A" với tên quán, giờ hoạt động và thực đơn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart (Tìm quán hoặc món)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/discovery.int.spec.ts; mobile/packages/n11_shared/test/m02_discovery_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-015 · Ẩn món và hiện lại món

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #69 (trong ngày: 22) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Món hết hàng có thể ẩn: khách không thấy và không đặt được; hiện lại thì khách thấy lại. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Món "Món ẩn Test" đang hiện. |
| Dữ liệu nhập | Món "Món ẩn Test". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán: mở "Món ẩn Test", chạm "Ẩn món" và xác nhận "Ẩn món này?". | Món chuyển "Đang ẩn" ("Món đang ẩn, khách không thấy."). |
| 2 | Khách mở trang Quán Test A. | KHÔNG thấy "Món ẩn Test" trong thực đơn; tìm tên món cũng không ra. |
| 3 | Chủ quán chạm "Hiện món". | Món trở lại "Đang hiện". |
| 4 | Khách mở lại trang quán. | Thấy lại "Món ẩn Test". Sau đó chủ quán ẩn lại để các test sau không đặt nhầm món này. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Để "Món ẩn Test" ở trạng thái ẩn.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart (Ẩn món, Hiện món)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/menu.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-006 · Tìm quán theo tên món

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #70 (trong ngày: 23) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Gõ tên món thì ra các quán có món đó. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A có món "Bún chả Test", "Nem rán Test". |
| Dữ liệu nhập | Từ khóa: "bun cha", "nem ran test". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Gõ "bun cha" vào ô tìm kiếm. | Kết quả hiện Quán Test A có món "Bún chả Test" (hoặc món được liệt kê dưới quán). |
| 2 | Gõ "nem ran test". | Hiện quán có "Nem rán Test". |
| 3 | Gõ tên món đang ẨN "Món ẩn Test". | KHÔNG ra kết quả (món ẩn không được tìm thấy). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart; tests/integration/discovery.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/discovery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-016 · Tìm và lọc món trong thực đơn của chủ quán

**Mức độ:** P2 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #71 (trong ngày: 24) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Chủ quán tìm món theo tên và lọc theo nhóm khi thực đơn dài. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Thực đơn có 4 món. |
| Dữ liệu nhập | Từ khóa "bun" (không dấu), "xyz" (không có). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong "Thực đơn" gõ "bun" vào ô "Tìm món trong thực đơn". | Hiện "Bún chả Test" (tìm không cần gõ dấu). |
| 2 | Gõ "xyz". | Hiện "Không tìm thấy món phù hợp" và gợi ý "Thử từ khóa hoặc bộ lọc khác." kèm "Xóa bộ lọc". |
| 3 | Chạm "Xóa bộ lọc"/"Xóa nội dung tìm kiếm". | Hiện lại đủ món. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_menu_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-007 · Tìm không có kết quả và xóa từ khóa

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #72 (trong ngày: 25) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Khi không có kết quả ứng dụng phải nói rõ và cho xóa nhanh. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang ở Trang chủ. |
| Dữ liệu nhập | Từ khóa "zzzzqqq". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Gõ "zzzzqqq" vào ô tìm kiếm. | Hiện "Không có kết quả" và gợi ý "Thử tên quán hoặc tên món khác.". |
| 2 | Chạm "Xóa từ khóa" (hoặc biểu tượng X "Xóa nội dung tìm kiếm"). | Ô tìm kiếm trống, trở lại danh sách quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_discovery_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-017 · Xóa món khỏi thực đơn

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #73 (trong ngày: 26) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Món xóa không còn hiện cho khách. Xóa có hộp xác nhận. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Chủ quán đang ở màn Thực đơn. |
| Dữ liệu nhập | Tạo món tạm "Món xóa Test" giá 10000 rồi xóa. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Thêm món "Món xóa Test" giá 10000. | Món có trong danh sách. |
| 2 | Mở món, chạm "Xóa món" > hộp "Xóa món khỏi thực đơn?" > chạm "Xóa món". | Món biến mất khỏi danh sách quản lý ("Món sẽ được đưa khỏi danh sách quản lý và thực đơn của khách."). |
| 3 | Khách mở trang quán. | Không thấy món đã xóa. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần (món tạm đã xóa).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart (Xóa món)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/menu.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-008 · Bộ lọc "Chỉ quán đang mở cửa" và lọc theo nhóm món

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #74 (trong ngày: 27) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách ẩn các quán đóng cửa và lọc theo nhóm món. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-011 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có Quán Test A (đang mở) và Quán Test B (ngoài giờ). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở màn danh sách quán chạm "Bộ lọc". | Mở bảng "Bộ lọc" với "Chỉ quán đang mở cửa" và "Nhóm món". |
| 2 | Bật "Chỉ quán đang mở cửa", chạm "Áp dụng". | Quán Test B (đóng cửa) biến mất; Quán Test A còn. Có nhãn "Bộ lọc đang bật". |
| 3 | Chọn một "Nhóm món" (ví dụ "Đồ uống") rồi "Áp dụng". | Chỉ còn quán có món thuộc nhóm đó. |
| 4 | Chạm "Xóa bộ lọc" / "Đặt lại". | Trở lại đầy đủ danh sách. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart (Bộ lọc, Xóa bộ lọc, Đặt lại)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_discovery_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-018 · Chưa có nhóm món thì không thêm được món

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #75 (trong ngày: 28) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nhóm món do Admin quản lý. Khi không có nhóm nào được bật, chủ quán phải được báo rõ. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần kỹ thuật viên cùng làm |
| Tình trạng sẵn sàng | **CẦN KỸ THUẬT VIÊN LÀM CÙNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Việc cần chuẩn bị trước | Không có việc chuẩn bị thêm ngoài mục "Điều kiện ban đầu". |
| Phân công khi đang test | Kỹ thuật viên/SYSTEM tạm "Ngừng dùng" TẤT CẢ nhóm món TRƯỚC khi bạn làm bước 1, và "Kích hoạt" lại ngay sau bước 2 (TC-ADM-020). Không làm khi đã có món thật đang bán. |
| Nếu thiếu điều kiện | Nếu kỹ thuật viên/SYSTEM chưa có mặt: đánh dấu BLOCKED, ghi "chờ kỹ thuật viên", hẹn giờ rồi chuyển sang test kế tiếp (hầu hết test sau không phụ thuộc test này trừ khi cột "Phụ thuộc" ghi tên nó). |
| Điều kiện ban đầu | Môi trường chưa có nhóm món đang bật (do Admin). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chỉ chạy được nếu có môi trường chưa có nhóm món (hoặc Admin tạm tắt hết nhóm món). Không tắt nhóm món khi đã có món thật đang bán. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập chủ quán, vào chế độ quản lý quán (tab "Quán" > "Vào chế độ quản lý quán"), chạm "Thực đơn". | Màn "Thực đơn" mở ra. |
| 2 | Chạm "+ Thêm món". | Hiện "Chưa có nhóm món nào được bật nên chưa thể thêm món." (hoặc "Chưa có nhóm món để lựa chọn"); không lưu được món nào. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Admin bật lại nhóm món (TC-ADM-020).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart; apps/backend/src/admin-menu-categories`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-menu-categories.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-009 · Trang chi tiết quán: tên, giờ hoạt động, thực đơn và giá

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #76 (trong ngày: 29) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách xem được đầy đủ thông tin quán trước khi đặt. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A mở, có 3 món hiện (Bún chả Test 45.000đ, Nem rán Test 30.000đ, Trà đá Test 5.000đ) và 1 món ẩn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở trang "Quán Test A". | Thấy tên quán, nhãn "Đang mở cửa", mục "Thực đơn". |
| 2 | Chạm "Xem giờ hoạt động ›". | Mở bảng "Giờ hoạt động" (Giờ Việt Nam), có dòng "Hôm nay". |
| 3 | Đối chiếu danh sách món và giá. | Có đúng 3 món hiện, giá đúng (45.000đ, 30.000đ, 5.000đ). Không có "Món ẩn Test". Có thể có "Đã bán n". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart (Thực đơn, Xem giờ hoạt động, Đã bán)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_view_customer_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-011 · Quán chưa có món nào đang hiện

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #77 (trong ngày: 30) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Khách không bị đánh lừa bởi quán trống; ứng dụng báo rõ. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-011 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test B hoàn tất hồ sơ, CHƯA thêm món nào (làm test này TRƯỚC TC-SHOP-037). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên 11Food gõ "Quán Test B" vào ô "Tìm quán hoặc món" và chạm vào kết quả. | Mở trang Quán Test B (nhãn "Đã đóng cửa"). |
| 2 | Nhìn phần thực đơn. | Hiện "Quán chưa có món để hiển thị." và không có nút thêm giỏ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu Quán Test B đã có món thì test này không thực hiện được; ghi NOT RUN.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart ("Quán chưa có món để hiển thị.")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_view_customer_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-037 · Thêm một món cho "Quán Test B" (quán ngoài giờ) để thử đặt món khi quán đóng cửa

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #78 (trong ngày: 31) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán Test B cần có ít nhất một món để các test "đặt món khi quán đóng cửa" làm được. |
| Người thực hiện | Chủ quán (CQ-B) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-011, TC-ADM-020 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-B đang ở chế độ quản lý Quán Test B (đã làm TC-SHOP-011). Có nhóm món (TC-ADM-020). |
| Dữ liệu nhập | Tên món "Món B Test", giá 25000, nhóm "Món chính". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập CQ-B, vào chế độ quản lý quán, tab "Quán" > "Thực đơn" > "+ Thêm món". | Mở màn "Thêm món". |
| 2 | Nhập "Món B Test", giá 25000, chọn nhóm "Món chính", chạm "Lưu món". | Món xuất hiện trong thực đơn của Quán Test B ("Đang hiện"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Giữ món để dùng cho TC-CUS-010 và TC-CUS-031.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart (Thêm món)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/menu.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-019 · Xem trước thực đơn "như khách sẽ thấy"

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #79 (trong ngày: 32) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chủ quán xem trước quán mình trông ra sao với khách, kể cả khi món ẩn. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-A ở chế độ quản lý quán, có món ẩn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Quán" > "Xem trước thực đơn" / "Xem như khách". | Mở bản xem trước có dòng "Đây là bản xem trước dành cho chủ quán. Khách chưa tìm thấy quán này." (nếu quán chưa hiện cho khách) hoặc giao diện giống khách. |
| 2 | Xem danh sách món. | Không có món đang ẩn ("Món đang ẩn không hiển thị trong bản xem trước."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart (Xem trước, Như khách sẽ thấy)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_view_customer_test.dart; m02_shop_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-010 · Quán đóng cửa (Quán Test B): khách thấy nhưng không đặt được

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #80 (trong ngày: 33) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán ngoài giờ phải hiện trạng thái đóng cửa rõ ràng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-011, TC-SHOP-037 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test B hoàn tất hồ sơ, đang ngoài giờ hoạt động và có món "Món B Test" (TC-SHOP-037). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tìm "Quán Test B" và mở trang quán. | Quán hiện nhãn "Đã đóng cửa" và dòng "Ngoài giờ hoạt động đã cài đặt." hoặc tương tự. |
| 2 | Thử thêm một món vào giỏ. | Không đặt được ngay: ứng dụng báo quán chưa nhận đơn lúc này và gợi ý chọn giờ hẹn (xem TC-CUS-031). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart (OUTSIDE_BUSINESS_HOURS); M10C (SHOP_NOT_OPEN)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/shop-availability.int.spec.ts; m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-020 · Thoát màn sửa khi còn thay đổi chưa lưu

**Mức độ:** P2 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #81 (trong ngày: 34) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Tránh mất dữ liệu khi bấm quay lại nhầm: ứng dụng phải hỏi lại. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Mở "Sửa món" một món bất kỳ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đổi tên món nhưng KHÔNG lưu, bấm nút Back. | Hiện hộp "Bỏ thay đổi chưa lưu?" ("Những chỉnh sửa trên màn này sẽ mất.") với "Tiếp tục sửa" và "Bỏ thay đổi". |
| 2 | Chọn "Tiếp tục sửa". | Quay lại màn sửa, nội dung vẫn còn. |
| 3 | Bấm Back lần nữa, chọn "Bỏ thay đổi". | Thoát, món giữ tên cũ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/menu_views.dart; m02_widgets.dart (Bỏ thay đổi chưa lưu?)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_menu_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-012 · Tìm món trong một quán

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #82 (trong ngày: 35) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Khách tìm nhanh món khi thực đơn dài. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang ở trang Quán Test A. |
| Dữ liệu nhập | Từ khóa "tra da", "khong co". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Tìm món trong quán" và gõ "tra da". | Hiện "Trà đá Test". |
| 2 | Gõ "khong co". | Hiện "Không tìm thấy món phù hợp" và gợi ý "Thử từ khóa khác." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_view_customer_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-013 · Điểm đánh giá của quán khi chưa có đánh giá

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #83 (trong ngày: 36) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Quán chưa có ai đánh giá phải hiện "Chưa có đánh giá" chứ không phải điểm giả. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A chưa có đánh giá nào (trước khi chạy TC-FEED). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên 11Food mở trang "Quán Test A". | Trang quán mở ra bình thường. |
| 2 | Xem phần đánh giá của quán (dưới tên quán). | Hiện "Chưa có đánh giá (0 lượt)" - không có số sao tự bịa. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart ("Chưa có đánh giá (0 lượt)")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/shop_rating_summary_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-014 · Danh sách quán trên Web Admin: tìm, lọc theo hồ sơ/lịch, xem chi tiết và xem như khách

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #84 (trong ngày: 37) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin theo dõi các quán, kể cả quán chưa đủ điều kiện (hồ sơ nháp) và quán ngoài giờ. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-011 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Quán Test A (đang mở) và Quán Test B (ngoài giờ) đã hoàn tất hồ sơ. Quán Test C chưa hoàn tất hồ sơ (TC-SHOP-002) nên không có trên máy chủ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Quán". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Đọc danh sách ("Danh sách quán") và các cột Mã quán, Tên quán, Chủ quán, Khu vực, Trạng thái hồ sơ, Theo lịch. | Có Quán Test A và Quán Test B, trạng thái hồ sơ hoàn tất/đang hoạt động; KHÔNG có Quán Test C (chưa được gửi lên máy chủ). Nếu trong danh sách có quán nháp cũ (dữ liệu có từ trước) thì ghi nhận. |
| 3 | Lọc theo trạng thái hồ sơ (ví dụ "chưa hoàn tất") và theo lịch (đang mở/đóng). | Danh sách lọc đúng: lọc "đang mở" có Quán A (nếu lúc đó đang trong giờ); lọc "đóng" có Quán B; lọc "chưa hoàn tất" không có Quán Test C. |
| 4 | Mở chi tiết Quán A, xem các thẻ Hồ sơ, Lịch hoạt động trong tuần, Món, Lịch sử quản lý. | Thông tin khớp với app (tên, số điện thoại, địa chỉ, tọa độ "Tọa độ (vĩ độ, kinh độ)", món hiện/tổng). Chỉ có địa chỉ và tọa độ chữ (chưa có bản đồ web). |
| 5 | Chạm "Xem như khách". | Hiện bản xem trước như khách thấy. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/shops-view.ts; docs/current/M02-admin-shops-20261024.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-shops.int.spec.ts; admin-shops-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-015 · Thêm món vào giỏ (số lượng và ghi chú)

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #85 (trong ngày: 38) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #16**

| Mục | Nội dung |
|---|---|
| Mục đích | Khách thêm món, chọn số lượng, ghi chú; giỏ hiện đúng tên, số lượng và tiền. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đã đăng ký và đang đăng nhập trên Điện thoại 1 (11Food). Quán Test A đang mở, có món (TC-SHOP-009, TC-SHOP-012). |
| Dữ liệu nhập | Món "Bún chả Test" số lượng 2, ghi chú "ít cay, không hành". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở trang Quán Test A, chạm món "Bún chả Test". | Hiện bảng chọn món với số lượng (mặc định 1), ô "Ghi chú cho món" (gợi ý "Ví dụ: ít cay, không hành") và nút "Thêm vào giỏ · 45.000đ". |
| 2 | Tăng số lượng lên 2, gõ ghi chú "ít cay, không hành". | Nút đổi thành "Thêm vào giỏ · 90.000đ". |
| 3 | Chạm "Thêm vào giỏ · 90.000đ". | Thanh dưới cùng hiện "Xem giỏ · … · 90.000đ". |
| 4 | Chạm "Xem giỏ · …". | Màn "Giỏ hàng" có dòng 2× Bún chả Test, ghi chú "Ghi chú: ít cay, không hành", tiền món 90.000đ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ ("Xóa giỏ hàng" > "Xóa giỏ") trước test sau.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (_DishSheet, CartBar, CartScreen); mobile/packages/n11_shared/lib/src/m10/m10_cart.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart; tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-016 · Thêm cùng món cùng ghi chú thì gộp dòng; khác ghi chú thì tách dòng

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #86 (trong ngày: 39) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Giỏ không bị lộn xộn nhưng vẫn giữ đúng yêu cầu khác nhau của từng phần ăn. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ trống, đang ở trang Quán Test A. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Thêm "Nem rán Test" x1 không ghi chú; sau đó thêm lại "Nem rán Test" x1 không ghi chú. | Giỏ chỉ có MỘT dòng "Nem rán Test" số lượng 2 (gộp). |
| 2 | Thêm "Nem rán Test" x1 với ghi chú "chấm tương ớt". | Giỏ có hai dòng: số lượng 2 không ghi chú, và số lượng 1 có ghi chú. |
| 3 | Thêm "Nem rán Test" x1 với ghi chú "Chấm   tương ớt" (viết hoa, thừa dấu cách). | Gộp vào dòng có ghi chú "chấm tương ớt" (số lượng thành 2) vì ghi chú giống nhau sau khi chuẩn hóa. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `docs/current/M10-implementation-20261018.md mục 2 (gộp dòng theo ghi chú)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-017 · Tăng, giảm số lượng và xóa món khỏi giỏ

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #87 (trong ngày: 40) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách sửa giỏ dễ dàng; tổng tiền luôn đúng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ có 2× Bún chả Test (90.000đ) và 1× Trà đá Test (5.000đ). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong giỏ chạm "Thêm Bún chả Test" (nút +). | Số lượng 3; tiền món 140.000đ. |
| 2 | Chạm "Bớt Bún chả Test" (nút -) hai lần. | Số lượng 1; tiền món 50.000đ. |
| 3 | Chạm "Xóa khỏi giỏ" ở dòng Trà đá. | Dòng Trà đá biến mất; tiền món 45.000đ. |
| 4 | Giảm số lượng Bún chả về 0 (hoặc "Xóa khỏi giỏ"). | Giỏ trống: hiện "Giỏ hàng trống" và gợi ý "Chọn món ở trang quán để thêm vào giỏ." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (Bớt, Thêm, Xóa khỏi giỏ)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-018 · Giỏ chỉ đặt từ một quán: đổi quán thì hỏi thay giỏ

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #88 (trong ngày: 41) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Tránh đặt nhầm món của hai quán trong một đơn. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ đang có món của Quán Test A. Có một quán thứ hai đang mở để thêm món (nếu chưa có, ghi BLOCKED hoặc dùng Quán Test B khi nó đang mở). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở trang quán khác và thêm một món. | Hộp "Thay giỏ hàng?" hỏi "Giỏ đang có món của Quán Test A. Mỗi giỏ chỉ đặt từ một quán. Bạn muốn xóa giỏ cũ và bắt đầu giỏ mới ở …?" với nút "Giữ giỏ cũ" và "Thay giỏ". |
| 2 | Chạm "Giữ giỏ cũ". | Giỏ cũ giữ nguyên, món mới không được thêm. |
| 3 | Thêm món lần nữa, chạm "Thay giỏ". | Giỏ chỉ còn món của quán mới. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (Thay giỏ hàng?)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart; tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-019 · Xóa toàn bộ giỏ hàng

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #89 (trong ngày: 42) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Xóa giỏ phải có xác nhận. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ có món. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong màn "Giỏ hàng" chạm "Xóa giỏ hàng". | Hộp "Xóa giỏ hàng?" - "Tất cả món trong giỏ sẽ bị xóa." với "Xóa giỏ" và nút hủy. |
| 2 | Chạm nút hủy. | Hộp thoại đóng; giỏ hàng vẫn còn đủ các món như trước. |
| 3 | Chạm "Xóa giỏ hàng" > "Xóa giỏ". | Giỏ hàng trống, không còn món nào. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-020 · Giỏ hàng được giữ khi thoát ứng dụng và khi đăng nhập lại

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #90 (trong ngày: 43) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Giỏ lưu trên máy chủ nên không mất khi tắt ứng dụng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ có 2× Bún chả Test. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Vuốt tắt hẳn 11Food, mở lại, vào trang quán. | Thanh "Xem giỏ · …" vẫn còn, giỏ giữ đúng 2× Bún chả Test. |
| 2 | Đăng xuất rồi đăng nhập lại KH-A. | Giỏ vẫn còn (lưu theo tài khoản). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `docs/current/M10-implementation-20261018.md (giỏ do máy chủ giữ)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-022 · Thêm địa chỉ giao hàng vào sổ địa chỉ

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #91 (trong ngày: 44) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #15**

| Mục | Nội dung |
|---|---|
| Mục đích | Khách lưu địa chỉ để đặt nhanh; địa chỉ đầu tiên tự thành mặc định. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | KH-A đang đăng nhập, sổ địa chỉ trống ("Chưa có địa chỉ giao hàng"). Đứng tại điểm muốn ghim, GPS bật. |
| Dữ liệu nhập | Tên người nhận "Khách Test A". Số điện thoại SĐT-KH-A. Địa chỉ chi tiết "Số 10 đường Test, tổ 1, phường Test, thành phố Cao Bằng". Ghi chú cho shipper "Gọi khi tới cổng". Dùng "Vị trí hiện tại" để ghim. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > "Sổ địa chỉ" > "+ Thêm địa chỉ mới". (Nếu sổ trống có thể hiện "Thêm địa chỉ để đặt món nhanh hơn. Địa chỉ đầu tiên sẽ là địa chỉ mặc định.") | Mở màn "Thêm địa chỉ" với ô tên, số điện thoại, địa chỉ, ghi chú cho shipper. |
| 2 | Điền dữ liệu như phần Dữ liệu nhập. Chạm "Vị trí hiện tại" để ghim. | Hiện "Đang lấy vị trí qua GPS và mạng…" rồi "Đã lấy vị trí hiện tại" (kèm độ chính xác nếu có). Hoặc "Bản đồ chưa có trong bản cài đặt này." nếu bản này không có bản đồ - ghi lại. |
| 3 | Chạm "Lưu địa chỉ". | Địa chỉ xuất hiện trong sổ, có nhãn "Mặc định". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Có thể xóa địa chỉ thử ở TC-CUS-023.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/addresses/address_views.dart; mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/customers-addresses.int.spec.ts; mobile/packages/n11_shared/test/address_book_test.dart; address_location_picker_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-021 · Giỏ hiển thị phí giao dự tính và tổng dự kiến

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #92 (trong ngày: 45) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #17**

| Mục | Nội dung |
|---|---|
| Mục đích | Khách biết trước tiền món, phí giao và tổng. Phí giao tính theo bảng giá của hệ thống; nếu chưa tính được phải ghi "Chưa xác định phí", không hiện 0đ. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-CUS-015, TC-CUS-022 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng; GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có); Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Việc cần chuẩn bị trước | SYSTEM đã áp dụng bảng "Phí & điều kiện giao" và dịch vụ tính đường đi đang hoạt động (nếu không, phí sẽ hiện "Chưa xác định phí"). Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Giỏ có 2× Bún chả Test + 1× Trà đá Test (tiền món 95.000đ). KH-A đã có địa chỉ có ghim vị trí (TC-CUS-022). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần: (1) SYSTEM đã áp dụng bảng phí (TC-ADM-024); (2) dịch vụ định tuyến bản đồ hoạt động. Thiếu một trong hai thì phí hiện "Chưa xác định phí" - đó là kết quả đúng, ghi lại. Người phụ trách cho biết mức phí chuẩn để đối chiếu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Giỏ hàng". | Có dòng "Phí giao (dự tính)" và "Tổng dự kiến"; có chú thích "Phí giao chỉ là tạm tính, có thể chưa phải giá chính thức." |
| 2 | Đối chiếu "Phí giao (dự tính)" với bảng giá (Web Admin > HỆ THỐNG > "Phí & điều kiện giao") theo khoảng cách từ quán đến điểm giao. | Phí đúng bằng mức của khung khoảng cách tương ứng. Tổng dự kiến = 95.000đ + phí giao. |
| 3 | Chọn địa chỉ KHÔNG có ghim vị trí và xem lại giỏ. | Phí hiện "Chưa xác định phí" (không phải 0đ); "Chưa có phí giao nên chưa tính được tổng tiền." Đơn vẫn gửi được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu phí hiện 0đ khi hệ thống chưa tính được phí. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (Phí giao (dự tính), Chưa xác định phí); docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md; m10_common.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-fee-policy.int.spec.ts; m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-023 · Sửa, đặt mặc định và xóa địa chỉ trong sổ

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #93 (trong ngày: 46) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quản lý nhiều địa chỉ; đơn cũ không bị ảnh hưởng khi sửa/xóa địa chỉ. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-022 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Sổ địa chỉ đã có 1 địa chỉ. |
| Dữ liệu nhập | Địa chỉ thứ hai: tên "Khách Test A (cơ quan)", số điện thoại SĐT-KH-A, địa chỉ "Số 5 đường Test, phường Test". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Thêm địa chỉ thứ hai và lưu. | Có 2 địa chỉ; địa chỉ đầu vẫn "Mặc định". |
| 2 | Chạm "Đặt mặc định" (hoặc "Đặt làm địa chỉ mặc định") ở địa chỉ thứ hai. | Nhãn "Mặc định" chuyển sang địa chỉ thứ hai. |
| 3 | Chạm "Sửa" địa chỉ thứ hai, đổi ghi chú, "Lưu địa chỉ". | Lưu thành công, thông tin mới hiện. |
| 4 | Chạm "Xóa" địa chỉ thứ hai > "Xóa địa chỉ này?" > "Xóa địa chỉ". | Địa chỉ bị xóa (hộp nói "Các đơn đã đặt không bị ảnh hưởng."). Địa chỉ còn lại tự trở thành mặc định. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Giữ lại một địa chỉ đầy đủ cho các test đặt hàng.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/addresses/address_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/customers-addresses.int.spec.ts; mobile/packages/n11_shared/test/address_book_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-024 · Địa chỉ giao: kiểm tra dữ liệu sai

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #94 (trong ngày: 47) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Số điện thoại và địa chỉ bắt buộc đúng định dạng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-022 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Mở "Thêm địa chỉ". |
| Dữ liệu nhập | Số điện thoại "12345"; địa chỉ để trống. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > "Sổ địa chỉ" > "+ Thêm địa chỉ mới". | Màn "Thêm địa chỉ" mở ra. |
| 2 | Nhập số điện thoại "12345", để trống địa chỉ, chạm "Lưu địa chỉ". | Không lưu; báo "Số điện thoại chưa hợp lệ. Nhập số di động Việt Nam, ví dụ 0912 345 678." và "Nhập địa chỉ giao hàng chi tiết." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/addresses/address_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/address_book_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-025 · Gửi đơn đặt món: kiểm tra màn "Xác nhận đơn", tiền và thông báo "Đã gửi đơn"

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #95 (trong ngày: 48) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách đặt đơn thành công; số tiền, người nhận, địa chỉ phải đúng với những gì đã chọn. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-022 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | KH-A đã đăng ký và đang đăng nhập trên Điện thoại 1 (11Food). Quán Test A đang mở, có món (TC-SHOP-009, TC-SHOP-012). Giỏ trống. |
| Dữ liệu nhập | Người nhận "Khách Test A", SĐT-KH-A, địa chỉ nhà KH-A; 2× Bún chả Test, 1× Trà đá Test; ghi chú đơn "Giao giờ hành chính (TEST)". Giao sớm nhất. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 (máy KHÁCH), mở 11Food (đang đăng nhập khách), tab "Trang chủ". Gõ "Quán Test A" vào ô "Tìm quán hoặc món" hoặc chọn quán trong "Quán gần bạn", chạm vào quán. | Trang quán hiện tên quán, giờ hoạt động và danh sách món có giá. |
| 2 | Chạm vào món "Bún chả Test", đặt Số lượng = 2, (có thể ghi chú "ít cay"), rồi chạm "Thêm vào giỏ · 90.000đ". Chạm món "Trà đá Test", số lượng 1, "Thêm vào giỏ · 5.000đ". | Thanh dưới cùng hiện "Xem giỏ · … món · 95.000đ" với tiền món đúng 95.000đ. |
| 3 | Chạm "Xem giỏ · …". | Màn "Giỏ hàng" liệt kê đúng: 2 phần "Bún chả Test" (45.000đ/phần) và 1 phần "Trà đá Test" (5.000đ); có dòng "Phí giao (dự tính)" và "Tổng dự kiến". Tiền món = 95.000đ. |
| 4 | Chạm nút "Tiếp tục · …" ở cuối màn hình giỏ. | Mở màn "Xác nhận đơn" gồm ô "Tên người nhận", "Số điện thoại người nhận", phần "Địa chỉ giao", "Giao sớm nhất"/"Hẹn giờ nhận món", "Ghi chú cho đơn", dòng "Thanh toán trực tiếp". |
| 5 | Điền "Tên người nhận" = Khách Test A, "Số điện thoại người nhận" = SĐT-KH-A. Chạm "Chọn từ sổ địa chỉ" và chọn "địa chỉ nhà KH-A đã lưu ở TC-CUS-022" (nếu chưa có: "Địa chỉ khác" rồi nhập địa chỉ và "Dùng vị trí hiện tại" nếu có). | Các ô đã điền; địa chỉ đã chọn hiện đúng. |
| 6 | Chạm nút "Gửi đơn · …". | Hiện thông báo xanh "Đã gửi đơn" (nội dung "Đơn đang chờ quán xác nhận. Bạn hủy được cho đến khi quán xác nhận."), mở chi tiết đơn có mã đơn (dạng "Đơn …") và trạng thái "Chờ quán xác nhận". Ghi lại mã đơn. |
| 7 | Trong chi tiết đơn đối chiếu: món, số lượng, "Tiền món", "Phí giao (dự tính)", người nhận, địa chỉ, ghi chú. Nhìn kỹ xem có dòng "Đã thanh toán" hoặc "Còn phải thu". | Mọi thông tin khớp với lúc đặt. Dòng "Thanh toán trực tiếp" (nghĩa: khách trả tiền cho quán/shipper, không trả qua ứng dụng). KHÔNG có dòng "Đã thanh toán" hay "Còn phải thu"; KHÔNG hiện "mã tra cứu" hay chuỗi dài 32-36 ký tự gồm chữ và số. |
| 8 | Chạm tab "Đơn hàng" > "Đang xử lý". | Đơn xuất hiện đúng một lần, trạng thái "Chờ quán xác nhận". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (CheckoutScreen, order-sent); docs/current/M07-owner-delivery-flow-20261023.md mục IV (bỏ dòng thanh toán)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart; one_page_order_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-021 · Quán nhận đơn mới của khách và thấy đủ thông tin

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #96 (trong ngày: 49) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn khách đặt phải hiện cho đúng quán với đủ món, tiền và người nhận. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Quán Test A đang mở, có món. KH-A đăng nhập trên Điện thoại 1, CQ-A (chế độ quản lý quán) trên Điện thoại 2. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 (máy KHÁCH), mở 11Food (đang đăng nhập khách), tab "Trang chủ". Gõ "Quán Test A" vào ô "Tìm quán hoặc món" hoặc chọn quán trong "Quán gần bạn", chạm vào quán. | Trang quán hiện tên quán, giờ hoạt động và danh sách món có giá. |
| 2 | Chạm vào món "Bún chả Test", đặt Số lượng = 2, (có thể ghi chú "ít cay"), rồi chạm "Thêm vào giỏ · 90.000đ". Chạm món "Trà đá Test", số lượng 1, "Thêm vào giỏ · 5.000đ". | Thanh dưới cùng hiện "Xem giỏ · … món · 95.000đ" với tiền món đúng 95.000đ. |
| 3 | Chạm "Xem giỏ · …". | Màn "Giỏ hàng" liệt kê đúng: 2 phần "Bún chả Test" (45.000đ/phần) và 1 phần "Trà đá Test" (5.000đ); có dòng "Phí giao (dự tính)" và "Tổng dự kiến". Tiền món = 95.000đ. |
| 4 | Chạm nút "Tiếp tục · …" ở cuối màn hình giỏ. | Mở màn "Xác nhận đơn" gồm ô "Tên người nhận", "Số điện thoại người nhận", phần "Địa chỉ giao", "Giao sớm nhất"/"Hẹn giờ nhận món", "Ghi chú cho đơn", dòng "Thanh toán trực tiếp". |
| 5 | Điền "Tên người nhận" = Khách Test A, "Số điện thoại người nhận" = SĐT-KH-A. Chạm "Chọn từ sổ địa chỉ" và chọn "địa chỉ nhà KH-A đã lưu ở TC-CUS-022" (nếu chưa có: "Địa chỉ khác" rồi nhập địa chỉ và "Dùng vị trí hiện tại" nếu có). | Các ô đã điền; địa chỉ đã chọn hiện đúng. |
| 6 | Chạm nút "Gửi đơn · …". | Hiện thông báo xanh "Đã gửi đơn" (nội dung "Đơn đang chờ quán xác nhận. Bạn hủy được cho đến khi quán xác nhận."), mở chi tiết đơn có mã đơn (dạng "Đơn …") và trạng thái "Chờ quán xác nhận". Ghi lại mã đơn. |
| 7 | Trên Điện thoại 2, mở tab "Đơn hàng" > "Đơn món" (nếu app đang mở sẵn, chờ vài giây hoặc kéo làm mới). | Đơn mới xuất hiện ở trạng thái "Chờ xác nhận" với đúng mã đơn vừa ghi, tên người nhận "Khách Test A". |
| 8 | Chạm vào đơn. | Chi tiết đơn có: "Món đã đặt" (2 x Bún chả Test, 1 x Trà đá Test), "Tiền món" 95.000đ, "Phí giao (dự tính)", người nhận và số điện thoại, địa chỉ, ghi chú. KHÔNG có dòng "Đã thanh toán" hay "Còn phải thu". |
| 9 | Chạm tab lọc "Chờ xác nhận". | Đơn nằm trong danh sách lọc. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart; apps/backend/src/orders (order-shop-service.ts); docs/current/M07-owner-delivery-flow-20261023.md (bỏ dòng thanh toán)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-026 · Không gửi được đơn khi chưa chọn địa chỉ hoặc thiếu thông tin

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #97 (trong ngày: 50) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn thiếu người nhận/số điện thoại/địa chỉ không được gửi. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ có món. Mở màn "Xác nhận đơn". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Để trống "Tên người nhận", "Số điện thoại người nhận" và không chọn địa chỉ. Chạm "Gửi đơn". | Không gửi; các ô báo bắt buộc và hiện "Chọn địa chỉ giao hàng." Không có đơn mới. |
| 2 | Nhập số điện thoại "12345". | Báo "Số điện thoại chưa hợp lệ…". |
| 3 | Nhập đủ đúng và chọn địa chỉ. | Nút "Gửi đơn · …" bấm được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Thoát màn hình, không có đơn nào.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (checkout-name, checkout-phone)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-022 · Quán xác nhận đơn

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #98 (trong ngày: 51) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Xác nhận đơn là cam kết làm món; khách phải được báo và không còn tự hủy được. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có đơn "Chờ xác nhận" của KH-A tại Quán Test A (tạo mới bằng các bước ở TC-SHOP-021). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 (máy QUÁN) (chủ quán, đang ở chế độ quản lý quán), mở tab "Đơn hàng", chọn "Đơn món". Chạm vào đơn có trạng thái "Chờ xác nhận" đúng mã đơn vừa ghi. | Đơn mới hiện ở đầu danh sách; chi tiết đơn có đủ món, số lượng, tiền món, tên và số điện thoại người nhận. |
| 2 | Chạm "Xác nhận đơn". | Đơn chuyển sang "Đang chuẩn bị". Không còn nút "Xác nhận đơn". Có nút "Gọi shipper". |
| 3 | Trên máy khách mở chi tiết đơn (tab "Đơn hàng" > "Đang xử lý"). | Trạng thái đổi sang "Quán đang chuẩn bị". Có dòng "Quán chưa xác nhận nên bạn hủy được. Sau khi quán xác nhận, bạn cần liên hệ quán." nếu bấm hủy; không còn nút "Hủy đơn". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (order-confirm)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-023 · Quán từ chối đơn có lý do

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #99 (trong ngày: 52) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán từ chối thì phải ghi lý do; khách thấy lý do và đơn kết thúc. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có một đơn "Chờ xác nhận" mới (tạo bằng cách làm lại các bước đặt đơn của TC-CUS-025). |
| Dữ liệu nhập | Lý do: "Hết nguyên liệu (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở đơn, chạm "Từ chối đơn". | Hộp "Từ chối đơn?" yêu cầu "Lý do từ chối". |
| 2 | Thử bấm xác nhận khi chưa nhập lý do. | Không cho gửi; báo cần nhập lý do. |
| 3 | Nhập lý do và xác nhận. | Đơn chuyển "Quán từ chối" và nằm trong "Lịch sử". |
| 4 | Khách mở chi tiết đơn. | Thấy trạng thái "Quán từ chối" cùng lý do; đơn nằm trong tab "Lịch sử". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần (đơn đã kết thúc).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (Từ chối đơn, Lý do từ chối); m10_customer_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-027 · Dùng vị trí hiện tại làm điểm giao khi đặt đơn

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #100 (trong ngày: 53) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách đặt hộ hoặc đặt nhanh bằng vị trí hiện tại; nếu từ chối quyền vị trí vẫn đặt được nhưng phí chưa xác định. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Giỏ có món. Mở "Xác nhận đơn". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Phần "ghim trên bản đồ" phụ thuộc bản APK có bật gói bản đồ Cao Bằng (cờ M14). Nếu màn hình ghi "Bản đồ chưa có trong bản cài đặt này." thì chỉ thử phần dùng vị trí hiện tại và ghi lại. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Địa chỉ khác", nhập địa chỉ bằng chữ, chạm "Vị trí hiện tại". | Ứng dụng lấy MỘT vị trí khi bạn bấm; hiện "Đã lấy vị trí hiện tại…". Không theo dõi liên tục. |
| 2 | Nhìn dòng phí giao. | Có ghim: phí giao được máy chủ tính theo bảng giá (hoặc "Chưa xác định phí" nếu thiếu dịch vụ tuyến - không hiện 0đ). |
| 3 | Làm lại nhưng chọn "Không cho phép" khi xin quyền vị trí. | Hiện thông báo "Chưa được cấp quyền vị trí…" và vẫn gửi được đơn; phí "Chưa xác định phí". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ / hủy đơn thử.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart; docs/current/M10-implementation-20261018.md mục 5`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/address_location_picker_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-024 · Quán chỉnh đơn (đổi số lượng, bỏ món) - bắt buộc ghi lý do

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #101 (trong ngày: 54) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Hết món thì quán chỉnh đơn sau khi đã gọi hỏi khách; khách thấy bản gốc, bản chốt và lý do. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một đơn mới ở "Chờ xác nhận" (2 x Bún chả Test, 1 x Trà đá Test), tạo bằng cách làm lại các bước đặt đơn của TC-CUS-025. |
| Dữ liệu nhập | Giảm "Bún chả Test" từ 2 xuống 1; lý do "Hết nguyên liệu, khách đồng ý bớt 1 phần (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở đơn, chạm "Chỉnh đơn". Đọc banner "Liên hệ khách trước khi đổi". | Màn chỉnh hiện số lượng từng món; có nút "Giữ lại"/"Bỏ món" từng dòng. |
| 2 | Giảm số lượng Bún chả xuống 1, chạm "Lưu chỉnh sửa". | Quay về đơn; đơn hiển thị "Đã chỉnh"; nút xác nhận đổi thành "Xác nhận đơn đã chỉnh". |
| 3 | Chạm "Xác nhận đơn đã chỉnh" mà chưa nhập lý do. | Hệ thống bắt nhập "Lý do thay đổi"; không xác nhận khi thiếu lý do. |
| 4 | Nhập lý do và xác nhận. | Đơn "Đang chuẩn bị"; tiền món cập nhật còn 50.000đ (45.000 + 5.000). |
| 5 | Khách mở chi tiết đơn. | Thấy banner "Quán đã chỉnh đơn - Lý do: …" và bản ban đầu ("Ban đầu 2× …"), bản chốt; tiền món đã chốt đúng 50.000đ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (Chỉnh đơn, Xác nhận đơn đã chỉnh); m10_customer_views.dart (order-edited)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-025 · Không xác nhận được đơn đã bị bỏ hết món

**Mức độ:** P2 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #102 (trong ngày: 55) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn rỗng không được xác nhận. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một đơn mới "Chờ xác nhận" có 1 dòng món (đặt 1 phần "Trà đá Test" theo các bước của TC-CUS-025). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở đơn "Chờ xác nhận" và chạm "Chỉnh đơn". | Màn chỉnh hiện các dòng món với nút "Bỏ món"/"Giữ lại". |
| 2 | Chạm "Bỏ món" ở TẤT CẢ các dòng (mỗi dòng hiện "… - sẽ bỏ khỏi đơn"), rồi chạm "Lưu chỉnh sửa". | Ứng dụng không cho lưu đơn rỗng hoặc nói rõ phải giữ ít nhất một món / dùng "Từ chối đơn" thay thế; đơn vẫn giữ nguyên. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Từ chối đơn thử bằng "Từ chối đơn" với lý do để dọn.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart; apps/backend/src/orders (ORDER_EMPTY)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-028 · Đặt hộ: người nhận khác người đặt

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #103 (trong ngày: 56) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách đặt cho người khác; người nhận không được cấp quyền xem đơn qua số điện thoại. |
| Người thực hiện | Khách (KH-A) + KH-B |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-002 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có giỏ món. KH-B là tài khoản đã đăng ký với SĐT-KH-B. |
| Dữ liệu nhập | Người nhận "Người Nhận Test", số điện thoại SĐT-KH-B (số của KH-B). Địa chỉ giao: nhập tay. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | KH-A đặt đơn với "Tên người nhận" = "Người Nhận Test" và số điện thoại = SĐT-KH-B. | Đơn gửi thành công, chi tiết đơn hiện người nhận "Người Nhận Test". |
| 2 | Đăng xuất KH-A, đăng nhập KH-B, mở tab "Đơn hàng". | KH-B KHÔNG thấy đơn này (đơn thuộc tài khoản KH-A, không theo số điện thoại người nhận). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M10-implementation-20261018.md ("đặt hộ không cấp quyền xem vị trí qua SĐT")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-026 · Quán hủy đơn món trước khi shipper lấy hàng

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #104 (trong ngày: 57) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán có thể hủy đơn (có lý do) khi chưa giao; khách được báo; nếu đã gọi shipper thì yêu cầu giao cũng kết thúc và hoa hồng của shipper được giải phóng. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-022 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đơn "Đang chuẩn bị" (chưa gọi shipper): đặt đơn mới theo TC-CUS-025 rồi xác nhận theo TC-SHOP-022. |
| Dữ liệu nhập | Lý do: "Quán hết món (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở đơn, chạm "Hủy đơn món". | Hộp "Hủy đơn món?" nói "Đơn món sẽ kết thúc và khách được báo." và yêu cầu "Lý do hủy". |
| 2 | Nhập lý do, xác nhận. | Đơn chuyển sang "Đã hủy" trong "Lịch sử" của quán. |
| 3 | Khách mở đơn. | Trạng thái "Đã hủy" cùng lý do; khách nhận thông báo (kiểm ở TC-NOTI). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (Hủy đơn món)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-029 · Đặt đơn hẹn giờ nhận món

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #105 (trong ngày: 58) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách chọn giờ muốn nhận món (trong giờ mở cửa, từ 30 phút đến 7 ngày tới). |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đã đăng ký và đang đăng nhập trên Điện thoại 1 (11Food). Quán Test A đang mở, có món (TC-SHOP-009, TC-SHOP-012). Giỏ có món. Mở "Xác nhận đơn". |
| Dữ liệu nhập | Giờ hẹn: bây giờ + 45 phút (làm tròn), trong giờ mở cửa. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở phần "Thời gian nhận món" chạm "Hẹn giờ nhận món" và chọn giờ = bây giờ + 45 phút. | Hiện "Hẹn lúc …" và dòng giải thích "Giờ hẹn là thời gian mong muốn, món có thể đến sớm hoặc muộn hơn." |
| 2 | Chạm "Gửi đơn". | Đơn gửi thành công và nằm ở tab "Đơn hẹn" (không nằm ở "Đang xử lý" thông thường) với dòng "Muốn nhận món lúc …". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (Hẹn giờ nhận món, Đơn hẹn); apps/backend/src/orders (SCHEDULE_MIN_LEAD_MS=30 phút, MAX 7 ngày)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-028 · Đơn hẹn giờ: quán thấy ở tab "Đơn hẹn" và nhận nhắc trước giờ hẹn

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #106 (trong ngày: 59) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách hẹn giờ nhận món thì quán xử lý đúng giờ và được nhắc. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-029 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A mở cả ngày. Khách đặt một đơn hẹn giờ cách hiện tại ít nhất 35 phút (TC-CUS-029). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở "Đơn hàng" > "Đơn món" > nhãn "Đơn hẹn". | Đơn hẹn có nhãn "Đơn hẹn" và dòng "Khách muốn nhận món lúc …" đúng giờ khách chọn. |
| 2 | Xác nhận đơn hẹn. | Xác nhận được (không bị tự hủy vì chờ quá lâu). |
| 3 | Chờ đến khoảng 30 phút trước giờ hẹn. | Chủ quán nhận thông báo nhắc đến giờ hẹn (nếu thông báo đẩy được bật; nếu không, thấy trong hộp thông báo). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `apps/backend/src/orders (SCHEDULE_REMINDER_LEAD_MS=30 phút); m10_shop_views.dart (Đơn hẹn)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-029 · Quán đổi lịch sau khi nhận đơn hẹn: đơn không tự hủy, có cảnh báo

**Mức độ:** P2 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #107 (trong ngày: 60) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Đổi giờ mở cửa không được tự làm mất đơn hẹn đã nhận. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-028 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán đã xác nhận một đơn hẹn ở giờ X. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán sửa giờ hoạt động sao cho giờ X nằm ngoài giờ mở cửa, lưu. | Lưu thành công; lịch giờ hoạt động mới hiện trên màn hình. |
| 2 | Mở lại đơn hẹn. | Đơn VẪN còn, hiện cảnh báo "Giờ hẹn nằm ngoài giờ hoạt động mới - Quán đã đổi lịch sau khi nhận đơn. Đơn vẫn giữ nguyên, không tự hủy - hãy liên hệ khách để xử lý." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Đặt lại giờ cả ngày (TC-SHOP-009).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (order-schedule-conflict); order-views.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-030 · Hẹn giờ không hợp lệ: quá gần, quá xa, ngoài giờ mở cửa

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #108 (trong ngày: 61) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Giờ hẹn phải cách ít nhất 30 phút, tối đa 7 ngày, và nằm trong giờ hoạt động của quán. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-029 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ có món. Mở "Xác nhận đơn". |
| Dữ liệu nhập | Giờ hẹn: bây giờ + 10 phút; bây giờ + 8 ngày; một giờ quán đóng cửa (Quán Test B hoặc đặt lịch Quán Test A có giờ nghỉ). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chọn giờ hẹn bây giờ + 10 phút rồi "Gửi đơn". | Hiện "Giờ hẹn quá gần. Hãy chọn muộn hơn ít nhất 30 phút." |
| 2 | Chọn giờ hẹn sau 8 ngày. | Hiện "Giờ hẹn quá xa. Chỉ hẹn trong 7 ngày tới." |
| 3 | Chọn giờ nằm ngoài giờ hoạt động của quán. | Hiện "Giờ hẹn nằm ngoài giờ hoạt động của quán." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (SCHEDULE_TOO_SOON/TOO_FAR/OUTSIDE_HOURS)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-031 · Đặt món ở quán đang đóng cửa bị từ chối

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #109 (trong ngày: 62) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán đóng cửa thì không nhận đơn "giao sớm nhất"; ứng dụng gợi ý hẹn giờ. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-011, TC-SHOP-037 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test B (ngoài giờ) có món "Món B Test" đang hiện (TC-SHOP-037). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Thêm món của Quán Test B vào giỏ và vào "Xác nhận đơn", chọn "Giao sớm nhất". | Đến được màn xác nhận. |
| 2 | Chạm "Gửi đơn". | Không tạo đơn; hiện lỗi "Quán chưa nhận đơn lúc này. Hãy chọn giờ hẹn hoặc quay lại sau." |
| 3 | Tab "Đơn hàng". | Không có đơn mới do thao tác vừa rồi. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (SHOP_NOT_OPEN)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; shop-availability.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-032 · Giá món thay đổi trước khi khách gửi đơn: yêu cầu kiểm tra lại

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #110 (trong ngày: 63) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách không bị tính giá cũ: nếu quán đổi giá lúc khách đang ở màn xác nhận, hệ thống không tạo đơn mà báo kiểm tra lại. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Khách ở màn "Xác nhận đơn" với "Nem rán Test" (30.000đ). Chủ quán sẵn sàng sửa giá. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách để nguyên màn "Xác nhận đơn", chưa gửi. | Màn hiện tiền theo giá 30.000đ. |
| 2 | Chủ quán đổi giá "Nem rán Test" thành 35.000đ và lưu. | Lưu thành công. |
| 3 | Khách chạm "Gửi đơn". | KHÔNG tạo đơn. Hiện "Giá hoặc món đã thay đổi - Giỏ đã được cập nhật theo giá hiện tại. Hãy kiểm tra lại rồi gửi đơn." |
| 4 | Khách xem lại giỏ rồi gửi lần nữa. | Đơn được tạo với giá mới 35.000đ. |
| 5 | Chủ quán đổi lại giá 30.000đ. | Giá món về lại 30.000đ như ban đầu (đã khôi phục dữ liệu để chạy lại). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ. Đặt lại giá "Nem rán Test" = 30.000đ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (ORDER_CART_CHANGED, checkout-changed)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-033 · Món bị ẩn trước khi khách gửi đơn: báo "Có món không còn bán"

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #111 (trong ngày: 64) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Món đã ẩn/xóa không được đặt. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Khách có giỏ với "Trà đá Test"; chủ quán sẵn sàng ẩn món. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán ẩn "Trà đá Test". | Món "Trà đá Test" đang ở trạng thái ẩn trong thực đơn của quán. |
| 2 | Khách mở "Giỏ hàng". | Hiện "Có món không còn bán" ("Hãy xóa các món đó khỏi giỏ rồi tiếp tục.") và dòng "Không còn bán". |
| 3 | Khách chạm "Xóa khỏi giỏ" ở dòng đó. | Cảnh báo biến mất, tiếp tục đặt được các món còn lại. |
| 4 | Chủ quán hiện lại "Trà đá Test". | Món "Trà đá Test" hiện lại bình thường trong thực đơn quán (đã khôi phục dữ liệu để chạy lại). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Hiện lại món đã ẩn; xóa giỏ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (cart-unavailable)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-034 · Giới hạn: số lượng tối đa mỗi món và độ dài ghi chú

**Mức độ:** P2 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #112 (trong ngày: 65) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Hệ thống chặn nhập quá lớn (tối đa 99 phần mỗi dòng, ghi chú tối đa 200 ký tự). |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang ở bảng chọn món. |
| Dữ liệu nhập | Số lượng cố nhập 100; ghi chú 250 ký tự. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tăng số lượng đến giới hạn tối đa hoặc cố nhập 100. | Không vượt quá 99; có thông báo/giới hạn rõ. |
| 2 | Dán chuỗi 250 ký tự vào "Ghi chú cho món". | Ô chỉ nhận tối đa 200 ký tự. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/backend/src/orders/order-constants.ts (MAX_LINE_QUANTITY=99, MAX_ITEM_NOTE=200)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-035 · Khách xem danh sách đơn: "Đang xử lý", "Đơn hẹn", "Lịch sử"

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #113 (trong ngày: 66) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn nằm đúng nhóm theo trạng thái. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có 1 đơn đang xử lý, 1 đơn hẹn, 1 đơn đã hủy/hoàn thành. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở tab "Đơn hàng". | Có 3 nhãn "Đang xử lý", "Đơn hẹn", "Lịch sử". |
| 2 | Chạm từng nhãn. | Đơn nằm đúng nhóm; nhóm trống hiện "Chưa có đơn đang xử lý" / "Chưa có đơn hẹn" / "Chưa có lịch sử đơn". |
| 3 | Chạm một đơn. | Mở chi tiết đúng đơn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (CustomerOrdersView)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-036 · Khách hủy đơn khi quán chưa xác nhận

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #114 (trong ngày: 67) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách tự hủy được cho đến khi quán xác nhận. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đơn mới ở trạng thái "Chờ quán xác nhận". |
| Dữ liệu nhập | Lý do hủy: "Đặt nhầm (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách mở chi tiết đơn, chạm "Hủy đơn". | Hộp "Hủy đơn?" nói "Quán chưa xác nhận nên bạn hủy được. Sau khi quán xác nhận, bạn cần liên hệ quán." và ô "Lý do hủy". |
| 2 | Nhập lý do, xác nhận hủy. | Đơn chuyển "Đã hủy" và nằm trong "Lịch sử". |
| 3 | Chủ quán xem danh sách đơn. | Đơn bị hủy hiện "Đã hủy" (khách hủy) trong "Lịch sử", không còn ở "Chờ xác nhận". Quán nhận được thông báo. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (Hủy đơn)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-037 · Khách không hủy được sau khi quán xác nhận (chỉ còn khi shipper đã lấy hàng)

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #115 (trong ngày: 68) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Sau khi quán xác nhận, khách phải liên hệ quán; nút "Hủy đơn" biến mất. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-022 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đơn đã được quán xác nhận ("Quán đang chuẩn bị"), chưa gọi shipper. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách mở chi tiết đơn. | Không có nút "Hủy đơn". Có thể có chú thích liên hệ quán ("Liên hệ quán: SĐT quán"). |
| 2 | Tìm cách hủy khác trong màn hình đơn. | Không có cách tự hủy trên 11Food; muốn hủy phải nhờ quán bấm "Hủy đơn món". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart; apps/backend/src/orders/order-rules.ts (customerMayCancel)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-038 · Đặt lại đơn cũ ("Đặt lại") với giá hôm nay

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #116 (trong ngày: 69) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách đặt lại món đã đặt; món hết thì báo, giá lấy theo hôm nay. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-036 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có ít nhất một đơn trong "Lịch sử". Giỏ hiện trống (hoặc có món quán khác để thử hộp thoại thay giỏ). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở một đơn đã kết thúc trong "Lịch sử", chạm "Đặt lại". | Giỏ được tạo lại với các món của đơn đó theo giá hiện tại; nếu món đã hết thì hiện "Món không còn bán, đã bỏ qua: …". |
| 2 | Nếu giỏ đang có món quán khác: hộp "Giỏ đang có món của … Bạn muốn thay bằng món của đơn này?". | Chọn được thay hoặc giữ giỏ cũ. |
| 3 | Chạm "Xem giỏ" ở thanh dưới màn hình để mở giỏ hàng. | Giỏ hiện đúng các món đặt lại; chưa có đơn mới được tạo cho đến khi bấm "Gửi đơn". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Xóa giỏ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (Đặt lại, order-reorder)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-039 · Khách chỉ thấy đơn của chính mình

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #117 (trong ngày: 70) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Riêng tư: người này không xem được đơn của người khác. |
| Người thực hiện | Khách (KH-A, KH-B) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có ít nhất một đơn. KH-B có tài khoản. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập KH-B, mở tab "Đơn hàng", xem cả 3 nhãn. | Không có đơn nào của KH-A. Nếu KH-B chưa có đơn: "Chưa có đơn đang xử lý/Chưa có lịch sử đơn". |
| 2 | Đặt một đơn nhỏ bằng KH-B. | Đơn của KH-B chỉ hiện ở KH-B. |
| 3 | Đăng nhập KH-A. | KH-A không thấy đơn của KH-B. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `apps/backend/src/orders (customer scope); tests/integration/m10-orders.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-040 · Chi tiết đơn của khách: trạng thái, người trả phí, lịch sử đơn

**Mức độ:** P1 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #118 (trong ngày: 71) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách theo dõi được đơn qua từng bước và hiểu mình đang chờ ai. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-022 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đơn đã được quán xác nhận. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn. | Hiện mã đơn, trạng thái "Quán đang chuẩn bị", danh sách món, tiền món, phí giao, người trả phí ("Khách trả phí"/"Quán trả phí") và mốc thời gian (Diễn biến). |
| 2 | Kéo tới phần diễn biến/lịch sử. | Có các dòng "Khách gửi đơn", "Quán xác nhận" kèm giờ. |
| 3 | Tìm thông tin liên hệ quán. | Có "Liên hệ quán: <số điện thoại quán>". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (order detail); m10_models.dart (OrderEvent labels)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-027 · Lọc, tìm và xem lịch sử đơn của quán

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #119 (trong ngày: 72) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán tìm lại đơn theo mã, tên người nhận, trạng thái và ngày. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-023 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đã có vài đơn ở các trạng thái khác nhau (ít nhất 1 đơn bị từ chối, 1 đơn đã hủy). |
| Dữ liệu nhập | Từ khóa là mã đơn đã ghi; từ khóa "khong-co-don". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Đơn hàng" > "Đơn món". Quan sát các nhãn lọc. | Có nhãn "Tất cả", "Chờ xác nhận", "Đang chuẩn bị", "Đơn hẹn", "Đang giao", "Cần xử lý", "Lịch sử". |
| 2 | Chạm "Lịch sử". | Chỉ hiện đơn đã kết thúc (hoàn thành, hủy, từ chối…). |
| 3 | Gõ mã đơn vào ô "Tìm mã đơn hoặc tên người nhận". | Chỉ còn đúng đơn đó. |
| 4 | Gõ "khong-co-don". | Hiện "Không có đơn phù hợp" kèm "Hãy thử tìm kiếm hoặc thay đổi bộ lọc." và nút "Xóa bộ lọc". |
| 5 | Dùng "Lọc trạng thái và ngày" chọn một khoảng ngày hôm nay. | Danh sách chỉ còn đơn trong khoảng ngày. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (bộ lọc, "Trang trước/Trang sau")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-030 · Duyệt xem ứng dụng khi chưa đăng nhập (khách vãng lai)

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #120 (trong ngày: 73) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Người chưa có tài khoản xem được quán và thực đơn, nhưng phải đăng nhập mới được đặt món. |
| Người thực hiện | Khách (chưa đăng nhập) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-009, TC-SHOP-012 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đã đăng xuất. Có ít nhất một quán đang mở (Quán Test A) với món. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food (chưa đăng nhập), tab "Trang chủ". | Thấy danh sách "Quán gần bạn" (nếu đã cấp quyền vị trí). |
| 2 | Chạm vào "Quán Test A", xem thực đơn. | Xem được tên quán, giờ hoạt động và món. |
| 3 | Chạm nút thêm một món vào giỏ. | Hiện lời nhắc "Đăng nhập tài khoản khách để đặt món." (không thêm được/ không đặt được khi chưa đăng nhập). |
| 4 | Tab "Đơn hàng". | Hiện "Đăng nhập để xem đơn hàng của bạn." và "Chưa có đơn hàng". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart ("Đăng nhập tài khoản khách để đặt món."); mobile/food/lib/food_tabs.dart (_orders)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_view_customer_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---
