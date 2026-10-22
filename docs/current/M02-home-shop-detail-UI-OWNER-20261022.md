# M02 — Chốt lại UI Trang chủ & Chi tiết quán (11Food, 22/10/2026)

**Quyết định:** Owner duyệt hai bản UI minh họa trong hội thoại ngày 22/10/2026. **UI: OWNER_APPROVED / DESIGN_LOCKED**. PR này **chỉ** cho M02 giao diện khách và trang thực đơn công khai (11Food); **không chứa** thay đổi Đơn món/Giao hàng/mã `K01-0001` của PR #165.

> Bản commit tài liệu này là **handoff cho coding agent, chưa phải code sản phẩm**. Tôn trọng hiện trạng backend M02/M05/M06/M10/M11, GPS service-area đã cập nhật và UI hiện có.

## 1. Trang chủ 11Food — M02-KP01

**Luồng chính (trên xuống):**

1. Logo thương hiệu **11Food** ở góc trái, chuông thông báo có số chưa đọc bên phải (M08), không thay đổi điều hướng.
2. Vùng vị trí GPS hiện tại ở bên dưới header; giữ logic tự lấy GPS khi mở/resume theo phần code đã tồn tại, hiển thị tên khu vực hợp lệ và nhãn “tham khảo” khi đúng chế độ tham khảo. **Không bắt người dùng chọn khu vực thủ công khi GPS hoạt động**; không giả lập GPS thành công. Giữ đường thử lại trên lỗi vị trí/quyền GPS.
3. **Hàng chip nhóm món cuộn ngang** (Tất cả, Cơm, Phở – Bún – Mì – Miến...), chọn nhóm giữ điều kiện lọc hiện có.
4. **Một hàng “Quán gần bạn” + ô tìm kiếm ngay bên phải**. Thay đúng chữ **“Quán quanh bạn”** thành **“Quán gần bạn”**. Tìm kiếm dạng ô nhỏ gọn có icon kính lúp/placeholder “Tìm quán hoặc món”, chạm mở `SearchScreen` tìm cả quán và món toàn bộ dữ liệu server phù hợp (không bị giới hạn theo nhóm chip ngoài trang chủ). Trên màn hẹp không che cụt tiêu đề hoặc làm ô tìm kiếm không chạm được; có thể rút placeholder thành “Tìm kiếm”.
5. Danh sách card quán ngay dưới hàng trên, cuộn/refresh/xem thêm theo dữ liệu thực. **Logo/ảnh đại diện vuông bên trái chiếm khoảng 35% chiều rộng card** (tính theo phần nội dung card), căn giữa và `BoxFit.cover` không méo hình; phần chữ bên phải ~65% trừ padding/gap. Logo dùng `shop.logoUrl` thật đã cung cấp, nếu quán chưa có logo hoặc lỗi tải ảnh thì hiển thị icon placeholder có cùng khung, **không dùng ảnh mock làm logo thật**.
6. Cột chữ card: tên quán nổi bật, địa chỉ ngắn 1–2 dòng tối đa, số sao + số lượt đánh giá (hoặc “Chưa có đánh giá”), khoảng cách từ GPS thật có nhãn **“đường chim bay”** nếu chưa có tuyến chính xác, badge đang mở/đóng theo API, chevron mở chi tiết. Không tự chế ETA/đánh giá/khoảng cách.
7. **Bỏ dòng “Khu vực này chưa được phục vụ” trên đầu trang**, tránh khoảng trống/cảnh báo chen giữa header và danh sách. Nếu GPS ở ngoài vùng phục vụ, trạng thái không phục vụ phải **được giải thích ở phần danh sách bên dưới** (empty state / trạng thái các quán nếu backend cung cấp hợp lệ), không giấu việc chưa giao được, không tạo đơn ở ngoài vùng; vẫn cho người dùng tham khảo danh sách khi nguồn dữ liệu cho phép, có nhãn rõ “tham khảo/ngoài khu vực phục vụ”. Nếu không có quán hợp lệ, hiện empty state trong vùng danh sách chứ không chặn toàn bộ giao diện.
8. Giữ khả năng **lọc hiện có M02-KP03** (nhóm, chỉ quán mở, đặt lại): nếu bỏ icon filter ngoài trang chủ như mock, chuyển entry-point vào ô tìm kiếm cạnh tiêu đề hoặc màn SearchScreen mà không làm mất chức năng lọc. **Không hiển thị nút lịch hoặc lọc cồng kềnh trên đầu.**
9. Thứ tự các vùng như bản UI đã duyệt: header → khu vực GPS → chip nhóm → hàng **Quán gần bạn + Tìm kiếm** → card quán. Không còn ô tìm kiếm toàn chiều ngang phía trên nhóm.

**Yêu cầu bất biến:** Chủ quán mở/đóng, lọc theo khu vực phục vụ, vị trí/GPS, quyền truy cập và sắp xếp hiện có do backend xác nhận. Ảnh/UI không chứng minh dữ liệu hoặc người dùng ở vị trí Cao Bằng thật; chỉ dùng dữ liệu thực trong app.

## 2. Chi tiết quán / thực đơn công khai — M02-K01

**Header thu gọn tối đa, không bỏ nghiệp vụ:**

1. Navigation bar trên cùng: quay lại + tên quán.
2. Ngay dưới là **một card thông tin quán nằm ngang** cao vừa đủ, chia hai vùng:
   - Trái: **logo quán vuông, khoảng 30–35% chiều rộng card** (nếu chưa có dùng placeholder hiện hành; không dùng logo ứng dụng 11Food thay cho logo quán).
   - Phải: **tên quán** rõ nhất; địa chỉ gọn; badge Đang mở cửa/Đã đóng cửa; link **Xem giờ hoạt động ›**; hàng đánh giá sao + số lượt, mở trang đánh giá M11.
   - Nội dung co giãn để text, nút và badge không chồng nhau trên Android màn nhỏ; chiều cao không để khoảng trắng dư như UI hiện tại.
3. Sau card: ô **Tìm món trong quán**, rồi danh sách theo **nhóm món** và số món; mỗi món có ảnh (hoặc icon placeholder), tên, giá, “Đã bán N” khi server cung cấp, điều khiển tăng/giảm và chạm xem món như cũ.
4. Giữ giỏ vàng sticky ở đáy (**Xem giỏ · số món · tổng tiền**) và hành vi cập nhật giỏ M10; không thay đổi điều kiện đặt món/giá/stock/phí ship.
5. **Phải nối logo dữ liệu thật**: hiện `ShopCardData.logoUrl` đã có cho danh sách, nhưng `ShopMenuView` / `HttpPublicShopApi.load` chưa có trường logo. Kiểm tra `GET /v1/shops/:id` có `logo_url` chưa; nếu thiếu thì mở rộng projection public API một cách tương thích, đưa URL ảnh đã được phép công khai vào model; không thay quy trình upload/lưu logo M02 và không tự sinh placeholder server giả. Đồng bộ màn chủ quán **Xem trước thực đơn** để logo thể hiện đúng theo dữ liệu đã lưu khi có.
6. Giữ các chức năng xem giờ hoạt động, chạm đánh giá M11, mở món, ghi chú món và giỏ hàng. Khi dữ liệu thiếu/lỗi/offline, UI có placeholder/trạng thái rõ, không giả định quán mở.

## 3. Điểm vào code (đã đối chiếu main ngày 22/10)

- **Trang chủ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart`
  - `DiscoveryHome._ready`: hiện có `_FakeField` toàn chiều ngang trước nhóm + `Quán quanh bạn`; có banner `home-outside-coverage` ở đầu; cần đổi thứ tự và chuyển cảnh báo xuống vùng danh sách.
  - `ShopCard`: logo 48×48 đang quá nhỏ, dùng `shop.logoUrl`; tăng lên tỷ lệ ~35% responsive và sắp thông tin.
  - `DiscoveryHome._openSearch` / `FilterSheet` / `SearchScreen`: giữ behavior và entry-point.
- **GPS vùng:** `mobile/packages/n11_shared/lib/src/m02/discovery_controller.dart`; ưu tiên dùng flow hiện tại (đã xử lý GPS/coverage), không tạo nguồn “đang phục vụ” giả hoặc chọn khu vực thủ công mặc định.
- **Chi tiết quán:** `mobile/packages/n11_shared/lib/src/m02/preview_views.dart` (`ShopMenuContent`, `ShopPublicScreen`, `PreviewScreen`, `_ShopRatingLink`).
- **Public model/API:** `mobile/packages/n11_shared/lib/src/m02/menu_models.dart` (`ShopMenuView`, `previewOf`); `mobile/packages/n11_shared/lib/src/m02/http_m02_api.dart` (`HttpPublicShopApi.load`). Backend public M02 shop detail cần kiểm tra/điền `logo_url` hợp lệ theo quyền đã có.
- **Đặt món / giỏ:** hiện nối ở `mobile/packages/n11_shared/lib/src/m10/`, **không viết lại M10**.
- 11Food tab: `mobile/food/lib/food_tabs.dart`. Không sửa 11Ship hay Admin Web nếu không cần hỗ trợ logo API công khai.

## 4. Tiêu chí nghiệm thu

- [ ] Trang chủ hiển thị **Quán gần bạn** cạnh ô tìm kiếm; không còn thanh tìm kiếm ở vị trí cũ. Tìm kiếm mở đúng màn KP02, tìm quán/món xuyên nhóm chip; bộ lọc KP03 vẫn dùng được.
- [ ] Header không hiện banner “Khu vực này chưa được phục vụ”. Khi ngoài vùng giao: khu danh sách có thông báo phù hợp, không hiển thị sai trạng thái phục vụ; GPS lỗi có thể thử lại, vẫn xem dữ liệu tham khảo hợp lệ.
- [ ] Card quán: logo vuông khoảng **35% ngang**, ảnh thật/fallback, tên/đánh giá/khoảng cách/trạng thái đọc được ở màn nhỏ; không overflow, không sai khoảng cách.
- [ ] Chi tiết quán: 1 card ngang gọn logo trái + dữ liệu phải, không khoảng trắng dư, link giờ hoạt động và đánh giá hoạt động; logo từ nguồn public shop detail thật hoặc fallback.
- [ ] Tìm món, nhóm món, số món, giỏ, thêm/bớt, bản chủ quán xem trước, thông báo lỗi/offline và điều hướng không bị hỏng.
- [ ] Chỉ chạy focused Flutter/widget/integration kiểm các vùng UI + public logo projection nếu thay API, CI hiện hành của phần bị sửa; build APK 11Food theo ký/cập nhật tại chỗ khi tới giai đoạn test. Không deploy VPS/production migration nếu chưa được phép.

## 5. Ranh giới thực hiện / quyền

- PR #165 **chỉ** dành cho Đơn món/Giao hàng và mã `K01-0001`. PR này **chỉ** dành cho 11Food M02 Trang chủ/Chi tiết quán, tránh xung đột hai nhánh.
- **Lead coding agent:** Claude Code Cloud theo `AGENTS.md`; Codex làm khi Owner giao riêng. Coding agent bổ sung code+tests trên nhánh PR này, sử dụng main mới nhất, báo code SHA/CI/build/blocker ngắn gọn.
- Tài liệu này là **đặc tả được Owner chốt**, chưa phải code sản phẩm. PR để **Draft** tới khi code đúng phạm vi và CI phù hợp.
