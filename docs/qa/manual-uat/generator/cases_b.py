# -*- coding: utf-8 -*-
from lib import *

DISC = 'mobile/packages/n11_shared/lib/src/m02/discovery_views.dart'
PREV = 'mobile/packages/n11_shared/lib/src/m02/preview_views.dart'
M10C = 'mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart'
M10S = 'mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart'
SHOPV = 'mobile/packages/n11_shared/lib/src/flows/shop_views.dart'
HOURS = 'mobile/packages/n11_shared/lib/src/m02/hours_views.dart'
MENUV = 'mobile/packages/n11_shared/lib/src/m02/menu_views.dart'
SHOPMNG = 'mobile/packages/n11_shared/lib/src/m02/shop_manage_views.dart'
ADDRV = 'mobile/packages/n11_shared/lib/src/addresses/address_views.dart'

# =====================================================================================================
# SHOP (phần chuẩn bị quán) - Ngày 2 đầu
# =====================================================================================================

T('TC-SHOP-001', ngay=2, seq=1, ten='Chủ quán A tạo hồ sơ quán, ghim vị trí lấy hàng và hoàn tất hồ sơ',
  muc_dich='Quán chỉ được hoạt động khi hồ sơ đủ tên, số điện thoại, địa chỉ và vị trí lấy hàng (ghim GPS). Test này tạo "Quán Test A".',
  prio='P0', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, deps='TC-ACC-003',
  pre='CQ-A đã đăng ký (TC-ACC-003). Người kiểm thử đang đứng TẠI VỊ TRÍ quán thử, bên trong khu vực phục vụ (khoảng 10 km quanh trung tâm TP Cao Bằng), bật GPS, sẵn sàng cho phép quyền vị trí cho 11Food.',
  data='Tên cửa hàng: "Quán Test A". Số điện thoại liên hệ: số SĐT-CQ-A (hoặc số khác của bạn). Địa chỉ lấy hàng: "Số 1 đường Test, tổ 1, phường Test, thành phố Cao Bằng" (đổi cho đúng nơi bạn đứng nếu muốn). Zalo/Facebook: bỏ trống (không bắt buộc).',
  steps=[
    ('Trên Điện thoại 2 đăng nhập CQ-A. Nếu đang ở màn "Quản lý cửa hàng" thì chạm "Tạo hồ sơ cửa hàng"; nếu không: tab "Quán" > "Tiếp tục hồ sơ", hoặc tab "Tài khoản" > "Đăng ký mở quán" > "Tạo hồ sơ cửa hàng".', 'Mở màn "Hồ sơ cửa hàng" gồm: mục logo (không bắt buộc), phần "Thông tin liên hệ" (ô "Tên cửa hàng", "Số điện thoại liên hệ"), phần "Vị trí" (hàng "Địa chỉ lấy hàng" đang ghi "Chọn địa chỉ"), ô "Zalo", "Facebook" và nút "Hoàn tất hồ sơ".'),
    ('Nhập "Tên cửa hàng" và "Số điện thoại liên hệ" như phần Dữ liệu nhập. CHƯA chọn địa chỉ. Chạm "Hoàn tất hồ sơ".', 'KHÔNG hoàn tất: hàng "Địa chỉ lấy hàng" báo lỗi thiếu địa chỉ/vị trí và có dòng nhắc "Mở địa chỉ và chọn ghim vị trí lấy hàng để hoàn tất hồ sơ."'),
    ('Chạm hàng "Địa chỉ lấy hàng". Ở màn "Chọn địa chỉ", gõ địa chỉ vào ô "Địa chỉ", rồi chạm "Vị trí hiện tại" và cho phép quyền vị trí khi điện thoại hỏi.', 'Hiện "Đang lấy vị trí qua GPS và mạng…" rồi "Đã lấy vị trí hiện tại" (kèm độ chính xác nếu có). Ứng dụng lấy đúng MỘT vị trí thật khi bạn bấm; không tự điền vị trí mặc định.'),
    ('Chạm "Lưu địa chỉ".', 'Quay về màn "Hồ sơ cửa hàng"; hàng "Địa chỉ lấy hàng" hiện địa chỉ vừa nhập.'),
    ('Chạm "Hoàn tất hồ sơ".', 'Hiện thông báo "Đã hoàn tất hồ sơ cửa hàng." và mở màn "Cửa hàng của tôi" với trạng thái hồ sơ đã hoàn tất. Hệ thống tự xác định khu vực phục vụ (không bắt chọn khu vực).'),
    ('Chạm "Vào quản lý cửa hàng" (hoặc quay lại và mở tab "Quán").', 'Vào được khu quản lý quán; ở tab "Tài khoản" thẻ vai trò có thêm nhãn "Chủ quán".'),
  ],
  restore='Không xóa được hồ sơ bằng ứng dụng. Muốn tạo quán mới cần tài khoản chủ quán khác (CQ-B). Ghi lại tên quán và vị trí đã ghim.',
  ref=SHOPV + ' (ShopStartScreen, ShopFormScreen, _completeReason); mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart; apps/backend/src/shop',
  auto='tests/integration/shop-onboarding.int.spec.ts; food-shop-onboarding-browser.int.spec.ts; shop-service-areas.int.spec.ts')

T('TC-SHOP-002', ngay=2, seq=2, ten='Quán C chưa đủ điều kiện kích hoạt: không hoàn tất được khi thiếu địa chỉ hoặc vị trí ghim',
  muc_dich='Quán thiếu thông tin hoặc chưa ghim vị trí KHÔNG được coi là quán đang hoạt động: khách không thấy và hồ sơ chưa được gửi lên máy chủ.',
  prio='P0', actor='Chủ quán (CQ-C)', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Có tài khoản CQ-C mới (số điện thoại thứ ba, SIM thật) đăng ký mục đích "Chủ quán" (làm như TC-ACC-003). Nếu không có thêm số điện thoại: ghi BLOCKED.',
  note='Theo mã nguồn, hồ sơ chỉ được lưu lên máy chủ khi bấm "Hoàn tất hồ sơ" với đủ thông tin và đã ghim vị trí; nếu thiếu thì ứng dụng chặn ngay trên máy và KHÔNG tạo quán nào ở máy chủ. Vì vậy "Quán Test C" sẽ không xuất hiện ở Web Admin. Cần Người phụ trách xác nhận đây là hành vi mong muốn.',
  data='Tên cửa hàng "Quán Test C". Số điện thoại liên hệ: số của bạn. Lần 1: để TRỐNG địa chỉ. Lần 2: gõ địa chỉ bằng chữ nhưng KHÔNG chạm "Vị trí hiện tại".',
  steps=[
    ('Đăng nhập CQ-C, mở "Tạo hồ sơ cửa hàng", nhập "Quán Test C" và số điện thoại, để trống địa chỉ, chạm "Hoàn tất hồ sơ".', 'KHÔNG hoàn tất; hàng "Địa chỉ lấy hàng" báo lỗi và hiện "Mở địa chỉ và chọn ghim vị trí lấy hàng để hoàn tất hồ sơ."'),
    ('Chạm hàng "Địa chỉ lấy hàng", gõ địa chỉ bằng chữ vào ô "Địa chỉ" nhưng KHÔNG chạm "Vị trí hiện tại", chạm "Lưu địa chỉ".', 'Không lưu được: hiện "Chọn vị trí trên bản đồ trước khi lưu." (hoặc tương tự).'),
    ('Bấm Back để về màn hồ sơ, chạm "Hoàn tất hồ sơ" lần nữa.', 'Vẫn không hoàn tất; không có thông báo "Đã hoàn tất hồ sơ cửa hàng.".'),
    ('Trên máy khách (KH-A) tìm "Quán Test C" trong ô "Tìm quán hoặc món".', 'KHÔNG thấy "Quán Test C" ("Không có kết quả"/"Chưa có quán phù hợp").'),
    ('(Nếu có Web Admin) VẬN HÀNH > Quán, gõ "Quán Test C" vào ô tìm.', 'Không có quán nào tên này (hồ sơ chưa lên máy chủ). Ghi nhận kết quả thực tế.'),
  ],
  restore='Để nguyên CQ-C ở trạng thái chưa hoàn tất hồ sơ để dùng lại cho các test sau (không hoàn tất hồ sơ).',
  ref=SHOPV + ' (shop-complete, _completeReason); mobile/packages/n11_shared/lib/src/flows/shop_controller.dart (fieldErrors, finishProfile); addresses/address_location_picker.dart',
  auto='tests/integration/shop-onboarding.int.spec.ts; shop-onboarding-faults.int.spec.ts')

T('TC-SHOP-003', ngay=2, seq=3, ten='Lấy vị trí quán khi chưa cấp quyền GPS, GPS tắt hoặc GPS yếu',
  muc_dich='Nếu không có vị trí thật thì không ghim được và không hoàn tất hồ sơ; ứng dụng phải nói rõ lý do và cách xử lý.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-ACC-003',
  pre='Một tài khoản chủ quán chưa hoàn tất hồ sơ (ví dụ CQ-C). Quyền vị trí của 11Food đang "Không cho phép".',
  steps=[
    ('Mở "Hồ sơ cửa hàng", chạm hàng "Địa chỉ lấy hàng", gõ một địa chỉ, chạm "Vị trí hiện tại". Khi điện thoại hỏi quyền, chọn "Không cho phép".', 'Hiện thông báo kiểu "Chưa được cấp quyền vị trí. Hãy cho phép trong cài đặt ứng dụng hoặc chạm bản đồ để chọn." Không có vị trí giả nào được điền.'),
    ('Cấp quyền vị trí cho 11Food nhưng TẮT GPS (Vị trí) của điện thoại, rồi chạm "Vị trí hiện tại" lần nữa.', 'Hiện "Hãy bật vị trí trên điện thoại hoặc chọn trên bản đồ."'),
    ('Bật GPS, vào trong nhà kín để GPS yếu, chạm "Vị trí hiện tại" và chờ.', 'Sau thời gian chờ hiện "Hết thời gian chờ vị trí từ GPS và mạng. Hãy thử ở nơi thoáng hơn hoặc chạm bản đồ để chọn." (hoặc "Điện thoại chưa cung cấp vị trí hợp lệ.").'),
    ('Ra nơi thoáng, chạm "Vị trí hiện tại" lần nữa.', 'Lấy được vị trí ("Đã lấy vị trí hiện tại").'),
  ],
  restore='Để quyền vị trí bật.',
  ref='mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart (thông báo vị trí); flows/location.dart',
  auto='mobile/packages/n11_shared/test/address_location_picker_test.dart; flows_test.dart')

T('TC-SHOP-004', ngay=2, seq=4, ten='Vị trí quán nằm ngoài khu vực phục vụ',
  muc_dich='Quán chỉ được kích hoạt khi vị trí nằm trong khu vực phục vụ đã cấu hình (vòng tròn quanh TP Cao Bằng).',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note='Cần một người đứng ngoài khu vực phục vụ (hơn khoảng 10 km), hoặc kỹ thuật viên tạm đổi vùng phục vụ. KHÔNG dùng ứng dụng giả vị trí. Nếu không có điều kiện, ghi BLOCKED.',
  pre='Người kiểm thử đứng ngoài khu vực phục vụ, GPS bật. Có tài khoản chủ quán chưa hoàn tất hồ sơ.',
  steps=[
    ('Nhập đủ tên, số điện thoại, địa chỉ, lấy vị trí hiện tại.', 'Lấy được vị trí.'),
    ('Chạm "Hoàn tất hồ sơ".', 'Không hoàn tất; hiện "Hệ thống chưa xác định được khu vực phục vụ cho quán. Bấm Hoàn tất hồ sơ để thử xác định lại." (hoặc câu tương tự).'),
  ],
  restore='Không tạo quán nào; quay về vị trí trong khu vực để làm test khác.',
  ref='docs/ops/service-area-gps-154.md; flows/shop_views.dart (invalidServiceArea)',
  auto='tests/integration/shop-service-areas.int.spec.ts; mobile/packages/n11_shared/test/m02_gps_area_test.dart')

T('TC-SHOP-005', ngay=2, seq=5, ten='Chủ quán chuyển qua lại giữa chế độ quản lý quán và chế độ khách hàng',
  muc_dich='Một tài khoản chủ quán dùng chung ứng dụng 11Food và tự chuyển chế độ; chỉ khi bấm mới đổi, không tự đổi.',
  prio='P0', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, deps='TC-SHOP-001',
  pre='CQ-A đã hoàn tất hồ sơ quán.',
  steps=food_login('P2', 'CQ-A', 'Khách hàng, Chủ quán') + [
    ('Chạm tab "Quán".', 'Hiện "Quản lý quán của bạn" - "Bạn đang ở chế độ khách hàng...". KHÔNG tự vào chế độ quán.'),
    ('Chạm "Vào chế độ quản lý quán".', 'Chuyển sang chế độ quán: thấy thông tin quán, trạng thái mở/đóng, thực đơn, giờ hoạt động; cuối trang có "Về chế độ khách hàng".'),
    ('Chạm tab "Đơn hàng".', 'Có hai nút chia "Đơn món" và "Giao hàng" (giao diện chủ quán).'),
    ('Quay lại tab "Quán" và chạm "Về chế độ khách hàng". Sang tab "Đơn hàng".', 'Tab "Đơn hàng" trở lại dạng của khách: "Đang xử lý", "Đơn hẹn", "Lịch sử".'),
  ],
  restore='Để ở chế độ quản lý quán nếu test tiếp theo cần.',
  ref='mobile/packages/n11_shared/lib/src/m02/shop_tab.dart; mobile/food/lib/food_tabs.dart (_orders)',
  auto='tests/integration/client-auth-adapter.int.spec.ts; shop-management.int.spec.ts')

T('TC-SHOP-006', ngay=2, seq=6, ten='Sửa hồ sơ quán đang hoạt động (tên, số điện thoại liên hệ)',
  muc_dich='Chủ quán sửa được thông tin quán; thay đổi phải hiện ra cho khách và Admin.',
  prio='P1', actor='Chủ quán (CQ-A)', dev=('P2', 'P1'), phones=2, deps='TC-SHOP-001',
  data='Tên mới: "Quán Test A Sửa"; sau đó đặt lại "Quán Test A".',
  pre='CQ-A đang ở chế độ quản lý quán.',
  steps=[
    ('Trong tab "Quán" (chế độ quán), chạm "Hồ sơ quán" > "Sửa hồ sơ".', 'Màn "Sửa hồ sơ quán" mở ra với dữ liệu hiện tại.'),
    ('Đổi tên thành "Quán Test A Sửa", chạm "Lưu hồ sơ".', 'Lưu thành công, không có thông báo lỗi; tên mới hiện ở "Hồ sơ quán".'),
    ('Trên máy khách tìm "Quán Test A Sửa".', 'Khách thấy quán với tên mới (có thể cần kéo làm mới).'),
    ('Chủ quán đổi lại tên "Quán Test A" và lưu.', 'Lưu thành công.'),
  ],
  restore='Đã đổi lại tên cũ ở bước 4.',
  ref=SHOPMNG + ' ("Sửa hồ sơ quán", "Lưu hồ sơ"); apps/backend/src/shop-management',
  auto='tests/integration/shop-management.int.spec.ts')

T('TC-SHOP-007', ngay=2, seq=7, ten='Thêm logo quán (không bắt buộc) và gỡ logo',
  muc_dich='Logo giúp khách nhận ra quán; ảnh sai định dạng hoặc quá nhỏ phải bị từ chối rõ ràng.',
  prio='P2', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, deps='TC-SHOP-001', ready='CẦN XÁC MINH',
  note='Chưa xác định chính xác màn hình có mục "Logo quán · không bắt buộc" (có trong hồ sơ quán). Nếu không tìm thấy, ghi lại màn hình và báo Người phụ trách.',
  data='Ảnh logo JPG hoặc PNG kích thước lớn hơn 1 MB không cần, nhưng ảnh phải đủ độ phân giải; một file không phải ảnh (ví dụ file .pdf) để thử lỗi.',
  pre='CQ-A ở chế độ quản lý quán.',
  steps=[
    ('Mở "Sửa hồ sơ quán" và tìm mục "Logo quán · không bắt buộc", chạm "Chọn logo".', 'Mở bộ chọn ảnh của điện thoại.'),
    ('Chọn một ảnh đúng định dạng, kéo chọn phần ảnh trong khung vuông ("Kéo ảnh để chọn phần logo trong khung vuông."), chạm "Dùng ảnh này", rồi "Lưu hồ sơ".', 'Logo mới hiện ở hồ sơ quán và ở danh sách quán phía khách.'),
    ('Thử chọn một file không phải ảnh hoặc ảnh sai định dạng.', 'Hiện "Ảnh không đúng định dạng. Vui lòng chọn JPG, PNG hoặc WebP." hoặc "Không đọc được ảnh này. Vui lòng chọn ảnh khác."'),
    ('Chạm "Gỡ logo" rồi lưu.', 'Logo biến mất, quán dùng biểu tượng mặc định.'),
  ],
  restore='Gỡ logo thử nghiệm nếu không muốn giữ.',
  ref='mobile/packages/n11_shared/lib/src/flows/shop_logo_widgets.dart; tests: shop-logo.int.spec.ts',
  auto='tests/integration/shop-logo.int.spec.ts; mobile/packages/n11_shared/test/shop_logo_test.dart; shop_logo_recovery_test.dart')

# ----- giờ hoạt động

T('TC-SHOP-008', ngay=2, seq=8, ten='Quán chưa cài giờ hoạt động thì bị coi là đóng cửa',
  muc_dich='Quán mới tạo chưa có lịch phải hiển thị là đóng, để khách không đặt nhầm.',
  prio='P1', actor='Chủ quán + Khách', dev=('P2', 'P1'), phones=2, deps='TC-SHOP-001',
  pre='"Quán Test A" vừa hoàn tất hồ sơ, CHƯA cài giờ hoạt động.',
  steps=[
    ('Trên máy chủ quán (chế độ quản lý quán) xem phần trạng thái hoạt động.', 'Hiện "Chưa cài giờ hoạt động" / "Quán chưa cài giờ hoạt động" và quán được tính là đóng cửa.'),
    ('Trên máy khách tìm "Quán Test A".', 'Quán (nếu hiện) mang nhãn "Đã đóng cửa"/"Chưa cài giờ hoạt động"; không đặt được đơn ngay.'),
  ],
  restore='Cài giờ ở TC-SHOP-009 để tiếp tục.',
  ref=HOURS + '; ' + PREV + ' (NO_BUSINESS_HOURS: "Quán chưa cài giờ hoạt động.")',
  auto='tests/integration/shop-availability.int.spec.ts; shop-management.int.spec.ts')

T('TC-SHOP-009', ngay=2, seq=9, ten='Cài giờ hoạt động "Cả tuần 00:00-24:00" để quán luôn mở khi thử',
  muc_dich='Cài lịch giúp quán tự mở/đóng; chọn cả ngày để Quán Test A đang mở suốt thời gian kiểm thử.',
  prio='P0', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, deps='TC-SHOP-001',
  data='Cả tuần, giờ mở 00:00, giờ đóng 24:00 (hoặc "Cả ngày (00:00-24:00)").',
  pre='CQ-A ở chế độ quản lý quán.',
  steps=[
    ('Tab "Quán" > "Cài giờ hoạt động" (hoặc "Giờ hoạt động").', 'Màn "Giờ hoạt động" với dòng "Giờ Việt Nam. Quán tự mở và đóng theo lịch này - không cần bật/tắt thủ công." và công cụ "Nhập nhanh"/"Cả tuần".'),
    ('Chạm "Cả tuần", chọn "Cả ngày" (00:00-24:00), chạm "Áp dụng cho cả tuần".', 'Hiện "Đã áp dụng cho cả tuần. Chưa lưu - bấm Lưu lịch để ghi."'),
    ('Chạm "Lưu lịch".', 'Lưu thành công; trạng thái quán hiện "Đang mở cửa".'),
    ('Trên máy khách xem quán.', 'Quán Test A hiển thị "Đang mở cửa".'),
  ],
  restore='Có thể giữ lịch cả ngày cho các test sau.',
  ref=HOURS + ' (Nhập nhanh, Lưu lịch); mobile/packages/n11_shared/lib/src/m02/schedule.dart',
  auto='mobile/packages/n11_shared/test/m02_hours_views_test.dart; schedule_test.dart; tests/integration/shop-management.int.spec.ts')

T('TC-SHOP-010', ngay=2, seq=10, ten='Cài giờ riêng từng ngày, nhiều khoảng giờ và ca qua đêm',
  muc_dich='Quán có thể mở nhiều ca trong ngày và ca qua nửa đêm. Lịch sai (chồng giờ) phải bị chặn.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-001',
  data='Thứ Hai: 06:00-10:00 và 16:00-22:00. Chủ nhật: ca qua đêm 22:00-02:00 (giờ đóng thuộc ngày hôm sau). Thử thêm một khoảng chồng giờ (ví dụ 09:00-12:00 chồng với 06:00-10:00).',
  pre='Mở màn "Giờ hoạt động" của một quán thử. Ghi lại lịch cũ để đặt lại.',
  steps=[
    ('Chọn "Tùy chỉnh theo ngày", chọn Thứ Hai, "+ Thêm khoảng" và nhập 06:00-10:00, thêm khoảng thứ hai 16:00-22:00.', 'Hai khoảng hiện; tổng khoảng giờ trong tuần được đếm ("Tổng … khoảng giờ trong tuần").'),
    ('Chọn Chủ nhật, thêm khoảng 22:00-02:00.', 'Hiện nhãn "Qua đêm" / "Giờ đóng thuộc ngày hôm sau (Thứ Hai)".'),
    ('Thêm khoảng chồng giờ 09:00-12:00 vào Thứ Hai và chạm "Lưu lịch".', 'Không lưu; hiện "Lịch chưa hợp lệ. Kiểm tra giờ mở, giờ đóng và các khoảng trùng nhau."'),
    ('Xóa khoảng chồng giờ ("Xóa khoảng 3"), chạm "Lưu lịch".', 'Lưu thành công.'),
  ],
  restore='Đặt lại "Cả tuần 00:00-24:00" (TC-SHOP-009) để quán mở khi thử.',
  ref=HOURS + ' (kMaxIntervalsPerWeek=28, "Ca qua đêm thuộc ngày bắt đầu")',
  auto='mobile/packages/n11_shared/test/m02_hours_views_test.dart; schedule_test.dart')

T('TC-SHOP-011', ngay=2, seq=11, ten='Dựng "Quán Test B" ngoài giờ hoạt động (đóng cửa theo lịch)',
  muc_dich='Cần một quán đã hoàn tất hồ sơ nhưng đang nằm ngoài giờ mở cửa, để thử khách không đặt được món.',
  prio='P0', actor='Chủ quán (CQ-B)', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Có tài khoản CQ-B (số điện thoại riêng, SIM thật) đã đăng ký mục đích "Chủ quán". Ghi chú: CQ-B có thể dùng lại số điện thoại của Khách B nếu Người phụ trách cho phép (một số điện thoại = một tài khoản; nên dùng số khác).',
  data='Tên "Quán Test B". Địa chỉ/vị trí: ghim ngay tại chỗ bạn đứng (trong khu vực phục vụ). Giờ hoạt động: chỉ mở khoảng giờ CHẮC CHẮN không chứa giờ hiện tại, ví dụ nếu bây giờ là 14:00 thì đặt mở 03:00-04:00 mỗi ngày.',
  steps=[
    ('Đăng nhập CQ-B trên Điện thoại 2, chạm "Tạo hồ sơ cửa hàng"; nhập "Tên cửa hàng" = Quán Test B và "Số điện thoại liên hệ"; chạm hàng "Địa chỉ lấy hàng", gõ địa chỉ vào ô "Địa chỉ", chạm "Vị trí hiện tại" (cho phép quyền vị trí nếu điện thoại hỏi), chạm "Lưu địa chỉ", rồi chạm "Hoàn tất hồ sơ".', 'Hồ sơ hoàn tất.'),
    ('Chế độ quản lý quán > "Cài giờ hoạt động": "Tùy chỉnh theo ngày" hoặc "Cả tuần", đặt khoảng giờ ở xa giờ hiện tại (ví dụ 03:00-04:00) và "Lưu lịch".', 'Lưu thành công. Trạng thái quán hiện "Đã đóng cửa" (ngoài giờ hoạt động).'),
    ('Trên máy khách tìm "Quán Test B".', 'Quán hiện nhưng có nhãn "Đã đóng cửa" (hoặc "Ngoài giờ hoạt động đã cài đặt.").'),
  ],
  restore='Giữ nguyên Quán Test B ở trạng thái ngoài giờ để dùng cho TC-CUS-010 và TC-CUS-031. Khi cần đổi lại thì sửa giờ.',
  ref=HOURS + '; ' + PREV + ' (OUTSIDE_BUSINESS_HOURS)',
  auto='tests/integration/shop-availability.int.spec.ts')

# ----- thực đơn

T('TC-SHOP-012', ngay=2, seq=12, ten='Thêm món có ảnh vào thực đơn "Quán Test A"',
  muc_dich='Chủ quán thêm món (tên, giá, nhóm món, ảnh); món hiển thị cho khách. Để thêm món cần có "Nhóm món" do Admin tạo sẵn.',
  prio='P0', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, deps='TC-ADM-020',
  data='Món 1: tên "Bún chả Test", giá 45000, nhóm "Món chính" (hoặc nhóm đang có), ảnh bất kỳ. Món 2: "Nem rán Test", 30000. Món 3: "Trà đá Test", 5000, nhóm "Đồ uống". Món 4: "Món ẩn Test", 20000 (sẽ ẩn ở test sau).',
  pre='Admin đã tạo ít nhất một "Nhóm món" đang bật (TC-ADM-020). CQ-A ở chế độ quản lý quán.',
  steps=[
    ('Tab "Quán" > "Thực đơn" > chạm "+ Thêm món".', 'Màn "Thêm món" mở ra: "Tên món", "Giá bán (đ)", "Nhóm món", "Ảnh món (không bắt buộc)", công tắc "Hiển thị với khách".'),
    ('Nhập Tên món, Giá bán 45000, chọn Nhóm món, chạm "Chọn ảnh từ thiết bị" và chọn ảnh, chạm "Lưu món".', 'Hiện thông báo lưu thành công; món "Bún chả Test" xuất hiện trong danh sách thực đơn kèm giá "45.000 đ" và trạng thái "Đang hiện".'),
    ('Lặp lại cho "Nem rán Test", "Trà đá Test", "Món ẩn Test".', 'Cả bốn món có trong thực đơn.'),
    ('Trên máy khách mở trang Quán Test A.', 'Khách thấy 4 món (cả "Món ẩn Test" cho đến khi ẩn ở TC-SHOP-015) với giá đúng.'),
  ],
  restore='Có thể giữ món cho các test sau. Món thử có thể xóa ở TC-SHOP-017.',
  ref=MENUV + ' (+ Thêm món, Lưu món); apps/backend/src/menu',
  auto='tests/integration/menu.int.spec.ts; mobile/packages/n11_shared/test/m02_menu_views_test.dart')

T('TC-SHOP-013', ngay=2, seq=13, ten='Thêm món: kiểm tra dữ liệu nhập sai',
  muc_dich='Món thiếu tên, giá không phải số, giá quá lớn hoặc ảnh sai phải bị từ chối bằng thông báo rõ.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-012',
  data='Lần 1: bỏ trống tên. Lần 2: tên "Món lỗi", giá "abc". Lần 3: giá "0". Lần 4: giá "999999999999". Lần 5: tên 300 ký tự. Lần 6: file ảnh không hợp lệ.',
  pre='Mở màn "Thêm món".',
  steps=[
    ('Thử từng dữ liệu ở mục Dữ liệu nhập, chạm "Lưu món" mỗi lần.', 'Mỗi lần ứng dụng không lưu và báo lỗi cụ thể (ví dụ "Nhập số nguyên, ví dụ 120.000 đ."). Không có món lỗi nào xuất hiện trong thực đơn.'),
    ('Chọn một ảnh không hợp lệ (không phải ảnh).', 'Hiện "Ảnh không hợp lệ. Hãy chọn ảnh khác hoặc bỏ ảnh." hoặc "Ảnh chưa dùng được".'),
  ],
  restore='Thoát màn hình, nếu có hộp "Bỏ thay đổi chưa lưu?" thì chọn "Bỏ thay đổi".',
  ref=MENUV + '; apps/backend/src/menu (INVALID_MENU_IMAGE)',
  auto='tests/integration/menu.int.spec.ts; mobile/packages/n11_shared/test/menu_controller_test.dart')

T('TC-SHOP-014', ngay=2, seq=14, ten='Sửa giá món và khách thấy giá mới',
  muc_dich='Giá đổi phải áp dụng cho đơn đặt sau đó, không đổi giá đơn đã đặt.',
  prio='P0', actor='Chủ quán + Khách', dev=('P2', 'P1'), phones=2, deps='TC-SHOP-012',
  data='"Nem rán Test": đổi giá từ 30000 thành 35000, sau đó đổi lại 30000.',
  pre='Quán Test A có món "Nem rán Test" giá 30.000đ.',
  steps=[
    ('Chủ quán: Thực đơn > chạm "Nem rán Test" > "Sửa món", đổi giá thành 35000, chạm "Lưu thay đổi".', 'Lưu thành công; giá hiện "35.000 đ".'),
    ('Khách: mở lại trang Quán Test A (kéo làm mới nếu cần).', 'Giá "Nem rán Test" hiện 35.000đ.'),
    ('Chủ quán đổi lại 30000 và lưu.', 'Giá về 30.000đ.'),
  ],
  restore='Đã đổi lại giá 30.000đ ở bước 3.',
  ref=MENUV + ' (Sửa món, Lưu thay đổi)',
  auto='tests/integration/menu.int.spec.ts')

T('TC-SHOP-015', ngay=2, seq=15, ten='Ẩn món và hiện lại món',
  muc_dich='Món hết hàng có thể ẩn: khách không thấy và không đặt được; hiện lại thì khách thấy lại.',
  prio='P0', actor='Chủ quán + Khách', dev=('P2', 'P1'), phones=2, deps='TC-SHOP-012',
  data='Món "Món ẩn Test".',
  pre='Món "Món ẩn Test" đang hiện.',
  steps=[
    ('Chủ quán: mở "Món ẩn Test", chạm "Ẩn món" và xác nhận "Ẩn món này?".', 'Món chuyển "Đang ẩn" ("Món đang ẩn, khách không thấy.").'),
    ('Khách mở trang Quán Test A.', 'KHÔNG thấy "Món ẩn Test" trong thực đơn; tìm tên món cũng không ra.'),
    ('Chủ quán chạm "Hiện món".', 'Món trở lại "Đang hiện".'),
    ('Khách mở lại trang quán.', 'Thấy lại "Món ẩn Test". Sau đó chủ quán ẩn lại để các test sau không đặt nhầm món này.'),
  ],
  restore='Để "Món ẩn Test" ở trạng thái ẩn.',
  ref=MENUV + ' (Ẩn món, Hiện món)',
  auto='tests/integration/menu.int.spec.ts')

T('TC-SHOP-016', ngay=2, seq=16, ten='Tìm và lọc món trong thực đơn của chủ quán',
  muc_dich='Chủ quán tìm món theo tên và lọc theo nhóm khi thực đơn dài.',
  prio='P2', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-012',
  data='Từ khóa "bun" (không dấu), "xyz" (không có).',
  pre='Thực đơn có 4 món.',
  steps=[
    ('Trong "Thực đơn" gõ "bun" vào ô "Tìm món trong thực đơn".', 'Hiện "Bún chả Test" (tìm không cần gõ dấu).'),
    ('Gõ "xyz".', 'Hiện "Không tìm thấy món phù hợp" và gợi ý "Thử từ khóa hoặc bộ lọc khác." kèm "Xóa bộ lọc".'),
    ('Chạm "Xóa bộ lọc"/"Xóa nội dung tìm kiếm".', 'Hiện lại đủ món.'),
  ],
  restore=R_NONE,
  ref=MENUV,
  auto='mobile/packages/n11_shared/test/m02_menu_views_test.dart')

T('TC-SHOP-017', ngay=2, seq=17, ten='Xóa món khỏi thực đơn',
  muc_dich='Món xóa không còn hiện cho khách. Xóa có hộp xác nhận.',
  prio='P1', actor='Chủ quán', dev=('P2', 'P1'), phones=2, deps='TC-SHOP-012',
  data='Tạo món tạm "Món xóa Test" giá 10000 rồi xóa.',
  pre='Chủ quán đang ở màn Thực đơn.',
  steps=[
    ('Thêm món "Món xóa Test" giá 10000.', 'Món có trong danh sách.'),
    ('Mở món, chạm "Xóa món" > hộp "Xóa món khỏi thực đơn?" > chạm "Xóa món".', 'Món biến mất khỏi danh sách quản lý ("Món sẽ được đưa khỏi danh sách quản lý và thực đơn của khách.").'),
    ('Khách mở trang quán.', 'Không thấy món đã xóa.'),
  ],
  restore='Không cần (món tạm đã xóa).',
  ref=MENUV + ' (Xóa món)',
  auto='tests/integration/menu.int.spec.ts')

T('TC-SHOP-018', ngay=2, seq=18, ten='Chưa có nhóm món thì không thêm được món',
  muc_dich='Nhóm món do Admin quản lý. Khi không có nhóm nào được bật, chủ quán phải được báo rõ.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Chỉ chạy được nếu có môi trường chưa có nhóm món (hoặc Admin tạm tắt hết nhóm món). Không tắt nhóm món khi đã có món thật đang bán.',
  pre='Môi trường chưa có nhóm món đang bật (do Admin).',
  steps=[
    ('Đăng nhập chủ quán, vào chế độ quản lý quán (tab "Quán" > "Vào chế độ quản lý quán"), chạm "Thực đơn".', 'Màn "Thực đơn" mở ra.'),
    ('Chạm "+ Thêm món".', 'Hiện "Chưa có nhóm món nào được bật nên chưa thể thêm món." (hoặc "Chưa có nhóm món để lựa chọn"); không lưu được món nào.'),
  ],
  restore='Admin bật lại nhóm món (TC-ADM-020).',
  ref=MENUV + '; apps/backend/src/admin-menu-categories',
  auto='tests/integration/admin-menu-categories.int.spec.ts')

T('TC-SHOP-019', ngay=2, seq=19, ten='Xem trước thực đơn "như khách sẽ thấy"',
  muc_dich='Chủ quán xem trước quán mình trông ra sao với khách, kể cả khi món ẩn.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-012',
  pre='CQ-A ở chế độ quản lý quán, có món ẩn.',
  steps=[
    ('Tab "Quán" > "Xem trước thực đơn" / "Xem như khách".', 'Mở bản xem trước có dòng "Đây là bản xem trước dành cho chủ quán. Khách chưa tìm thấy quán này." (nếu quán chưa hiện cho khách) hoặc giao diện giống khách.'),
    ('Xem danh sách món.', 'Không có món đang ẩn ("Món đang ẩn không hiển thị trong bản xem trước.").'),
  ],
  restore=R_NONE,
  ref=PREV + ' (Xem trước, Như khách sẽ thấy)',
  auto='mobile/packages/n11_shared/test/m02_view_customer_test.dart; m02_shop_views_test.dart')

T('TC-SHOP-020', ngay=2, seq=20, ten='Thoát màn sửa khi còn thay đổi chưa lưu',
  muc_dich='Tránh mất dữ liệu khi bấm quay lại nhầm: ứng dụng phải hỏi lại.',
  prio='P2', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-012',
  pre='Mở "Sửa món" một món bất kỳ.',
  steps=[
    ('Đổi tên món nhưng KHÔNG lưu, bấm nút Back.', 'Hiện hộp "Bỏ thay đổi chưa lưu?" ("Những chỉnh sửa trên màn này sẽ mất.") với "Tiếp tục sửa" và "Bỏ thay đổi".'),
    ('Chọn "Tiếp tục sửa".', 'Quay lại màn sửa, nội dung vẫn còn.'),
    ('Bấm Back lần nữa, chọn "Bỏ thay đổi".', 'Thoát, món giữ tên cũ.'),
  ],
  restore=R_NONE,
  ref=MENUV + '; m02_widgets.dart (Bỏ thay đổi chưa lưu?)',
  auto='mobile/packages/n11_shared/test/m02_menu_views_test.dart')

# ----- đơn hàng quán

T('TC-SHOP-021', ngay=2, seq=30, ten='Quán nhận đơn mới của khách và thấy đủ thông tin',
  muc_dich='Đơn khách đặt phải hiện cho đúng quán với đủ món, tiền và người nhận.',
  prio='P0', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-025',
  pre='Quán Test A đang mở, có món. KH-A đăng nhập trên Điện thoại 1, CQ-A (chế độ quản lý quán) trên Điện thoại 2.',
  steps=customer_place_order() + [
    ('Trên Điện thoại 2, mở tab "Đơn hàng" > "Đơn món" (nếu app đang mở sẵn, chờ vài giây hoặc kéo làm mới).', 'Đơn mới xuất hiện ở trạng thái "Chờ xác nhận" với đúng mã đơn vừa ghi, tên người nhận "Khách Test A".'),
    ('Chạm vào đơn.', 'Chi tiết đơn có: "Món đã đặt" (2 x Bún chả Test, 1 x Trà đá Test), "Tiền món" 95.000đ, "Phí giao (dự tính)", người nhận và số điện thoại, địa chỉ, ghi chú. KHÔNG có dòng "Đã thanh toán" hay "Còn phải thu".'),
    ('Chạm tab lọc "Chờ xác nhận".', 'Đơn nằm trong danh sách lọc.'),
  ],
  restore=R_ORDER,
  ref=M10S + '; apps/backend/src/orders (order-shop-service.ts); docs/current/M07-owner-delivery-flow-20261023.md (bỏ dòng thanh toán)',
  auto='tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-SHOP-022', ngay=2, seq=31, ten='Quán xác nhận đơn',
  muc_dich='Xác nhận đơn là cam kết làm món; khách phải được báo và không còn tự hủy được.',
  prio='P0', actor='Chủ quán + Khách', dev=('P1', 'P2'), phones=2, deps='TC-SHOP-021',
  pre='Có đơn "Chờ xác nhận" của KH-A tại Quán Test A (tạo mới bằng các bước ở TC-SHOP-021).',
  steps=shop_confirm_order() + [
    ('Trên máy khách mở chi tiết đơn (tab "Đơn hàng" > "Đang xử lý").', 'Trạng thái đổi sang "Quán đang chuẩn bị". Có dòng "Quán chưa xác nhận nên bạn hủy được. Sau khi quán xác nhận, bạn cần liên hệ quán." nếu bấm hủy; không còn nút "Hủy đơn".'),
  ],
  restore=R_ORDER,
  ref=M10S + ' (order-confirm)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-023', ngay=2, seq=32, ten='Quán từ chối đơn có lý do',
  muc_dich='Quán từ chối thì phải ghi lý do; khách thấy lý do và đơn kết thúc.',
  prio='P0', actor='Chủ quán + Khách', dev=('P1', 'P2'), phones=2, deps='TC-SHOP-021',
  data='Lý do: "Hết nguyên liệu (TEST)".',
  pre='Có một đơn "Chờ xác nhận" mới (tạo bằng cách làm lại các bước đặt đơn của TC-CUS-025).',
  steps=[
    ('Chủ quán mở đơn, chạm "Từ chối đơn".', 'Hộp "Từ chối đơn?" yêu cầu "Lý do từ chối".'),
    ('Thử bấm xác nhận khi chưa nhập lý do.', 'Không cho gửi; báo cần nhập lý do.'),
    ('Nhập lý do và xác nhận.', 'Đơn chuyển "Quán từ chối" và nằm trong "Lịch sử".'),
    ('Khách mở chi tiết đơn.', 'Thấy trạng thái "Quán từ chối" cùng lý do; đơn nằm trong tab "Lịch sử".'),
  ],
  restore='Không cần (đơn đã kết thúc).',
  ref=M10S + ' (Từ chối đơn, Lý do từ chối); m10_customer_views.dart',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-024', ngay=2, seq=33, ten='Quán chỉnh đơn (đổi số lượng, bỏ món) - bắt buộc ghi lý do',
  muc_dich='Hết món thì quán chỉnh đơn sau khi đã gọi hỏi khách; khách thấy bản gốc, bản chốt và lý do.',
  prio='P1', actor='Chủ quán + Khách', dev=('P1', 'P2'), phones=2, deps='TC-SHOP-021',
  data='Giảm "Bún chả Test" từ 2 xuống 1; lý do "Hết nguyên liệu, khách đồng ý bớt 1 phần (TEST)".',
  pre='Một đơn mới ở "Chờ xác nhận" (2 x Bún chả Test, 1 x Trà đá Test), tạo bằng cách làm lại các bước đặt đơn của TC-CUS-025.',
  steps=[
    ('Chủ quán mở đơn, chạm "Chỉnh đơn". Đọc banner "Liên hệ khách trước khi đổi".', 'Màn chỉnh hiện số lượng từng món; có nút "Giữ lại"/"Bỏ món" từng dòng.'),
    ('Giảm số lượng Bún chả xuống 1, chạm "Lưu chỉnh sửa".', 'Quay về đơn; đơn hiển thị "Đã chỉnh"; nút xác nhận đổi thành "Xác nhận đơn đã chỉnh".'),
    ('Chạm "Xác nhận đơn đã chỉnh" mà chưa nhập lý do.', 'Hệ thống bắt nhập "Lý do thay đổi"; không xác nhận khi thiếu lý do.'),
    ('Nhập lý do và xác nhận.', 'Đơn "Đang chuẩn bị"; tiền món cập nhật còn 50.000đ (45.000 + 5.000).'),
    ('Khách mở chi tiết đơn.', 'Thấy banner "Quán đã chỉnh đơn - Lý do: …" và bản ban đầu ("Ban đầu 2× …"), bản chốt; tiền món đã chốt đúng 50.000đ.'),
  ],
  restore=R_ORDER,
  ref=M10S + ' (Chỉnh đơn, Xác nhận đơn đã chỉnh); m10_customer_views.dart (order-edited)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-025', ngay=2, seq=34, ten='Không xác nhận được đơn đã bị bỏ hết món',
  muc_dich='Đơn rỗng không được xác nhận.',
  prio='P2', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-021',
  pre='Một đơn mới "Chờ xác nhận" có 1 dòng món (đặt 1 phần "Trà đá Test" theo các bước của TC-CUS-025).',
  steps=[
    ('Chủ quán mở đơn "Chờ xác nhận" và chạm "Chỉnh đơn".', 'Màn chỉnh hiện các dòng món với nút "Bỏ món"/"Giữ lại".'),
    ('Chạm "Bỏ món" ở TẤT CẢ các dòng (mỗi dòng hiện "… - sẽ bỏ khỏi đơn"), rồi chạm "Lưu chỉnh sửa".', 'Ứng dụng không cho lưu đơn rỗng hoặc nói rõ phải giữ ít nhất một món / dùng "Từ chối đơn" thay thế; đơn vẫn giữ nguyên.'),
  ],
  restore='Từ chối đơn thử bằng "Từ chối đơn" với lý do để dọn.',
  ref=M10S + '; apps/backend/src/orders (ORDER_EMPTY)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-026', ngay=2, seq=35, ten='Quán hủy đơn món trước khi shipper lấy hàng',
  muc_dich='Quán có thể hủy đơn (có lý do) khi chưa giao; khách được báo; nếu đã gọi shipper thì yêu cầu giao cũng kết thúc và hoa hồng của shipper được giải phóng.',
  prio='P0', actor='Chủ quán + Khách', dev=('P1', 'P2'), phones=2, deps='TC-SHOP-022',
  data='Lý do: "Quán hết món (TEST)".',
  pre='Đơn "Đang chuẩn bị" (chưa gọi shipper): đặt đơn mới theo TC-CUS-025 rồi xác nhận theo TC-SHOP-022.',
  steps=[
    ('Chủ quán mở đơn, chạm "Hủy đơn món".', 'Hộp "Hủy đơn món?" nói "Đơn món sẽ kết thúc và khách được báo." và yêu cầu "Lý do hủy".'),
    ('Nhập lý do, xác nhận.', 'Đơn chuyển sang "Đã hủy" trong "Lịch sử" của quán.'),
    ('Khách mở đơn.', 'Trạng thái "Đã hủy" cùng lý do; khách nhận thông báo (kiểm ở TC-NOTI).'),
  ],
  restore='Không cần.',
  ref=M10S + ' (Hủy đơn món)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-027', ngay=2, seq=36, ten='Lọc, tìm và xem lịch sử đơn của quán',
  muc_dich='Quán tìm lại đơn theo mã, tên người nhận, trạng thái và ngày.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-023',
  data='Từ khóa là mã đơn đã ghi; từ khóa "khong-co-don".',
  pre='Đã có vài đơn ở các trạng thái khác nhau (ít nhất 1 đơn bị từ chối, 1 đơn đã hủy).',
  steps=[
    ('Tab "Đơn hàng" > "Đơn món". Quan sát các nhãn lọc.', 'Có nhãn "Tất cả", "Chờ xác nhận", "Đang chuẩn bị", "Đơn hẹn", "Đang giao", "Cần xử lý", "Lịch sử".'),
    ('Chạm "Lịch sử".', 'Chỉ hiện đơn đã kết thúc (hoàn thành, hủy, từ chối…).'),
    ('Gõ mã đơn vào ô "Tìm mã đơn hoặc tên người nhận".', 'Chỉ còn đúng đơn đó.'),
    ('Gõ "khong-co-don".', 'Hiện "Không có đơn phù hợp" kèm "Hãy thử tìm kiếm hoặc thay đổi bộ lọc." và nút "Xóa bộ lọc".'),
    ('Dùng "Lọc trạng thái và ngày" chọn một khoảng ngày hôm nay.', 'Danh sách chỉ còn đơn trong khoảng ngày.'),
  ],
  restore=R_NONE,
  ref=M10S + ' (bộ lọc, "Trang trước/Trang sau")',
  auto='tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-SHOP-028', ngay=2, seq=37, ten='Đơn hẹn giờ: quán thấy ở tab "Đơn hẹn" và nhận nhắc trước giờ hẹn',
  muc_dich='Khách hẹn giờ nhận món thì quán xử lý đúng giờ và được nhắc.',
  prio='P1', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-029',
  pre='Quán Test A mở cả ngày. Khách đặt một đơn hẹn giờ cách hiện tại ít nhất 35 phút (TC-CUS-029).',
  steps=[
    ('Chủ quán mở "Đơn hàng" > "Đơn món" > nhãn "Đơn hẹn".', 'Đơn hẹn có nhãn "Đơn hẹn" và dòng "Khách muốn nhận món lúc …" đúng giờ khách chọn.'),
    ('Xác nhận đơn hẹn.', 'Xác nhận được (không bị tự hủy vì chờ quá lâu).'),
    ('Chờ đến khoảng 30 phút trước giờ hẹn.', 'Chủ quán nhận thông báo nhắc đến giờ hẹn (nếu thông báo đẩy được bật; nếu không, thấy trong hộp thông báo).'),
  ],
  restore=R_ORDER,
  ref='apps/backend/src/orders (SCHEDULE_REMINDER_LEAD_MS=30 phút); m10_shop_views.dart (Đơn hẹn)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-029', ngay=2, seq=38, ten='Quán đổi lịch sau khi nhận đơn hẹn: đơn không tự hủy, có cảnh báo',
  muc_dich='Đổi giờ mở cửa không được tự làm mất đơn hẹn đã nhận.',
  prio='P2', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-028',
  pre='Quán đã xác nhận một đơn hẹn ở giờ X.',
  steps=[
    ('Chủ quán sửa giờ hoạt động sao cho giờ X nằm ngoài giờ mở cửa, lưu.', 'Lưu thành công; lịch giờ hoạt động mới hiện trên màn hình.'),
    ('Mở lại đơn hẹn.', 'Đơn VẪN còn, hiện cảnh báo "Giờ hẹn nằm ngoài giờ hoạt động mới - Quán đã đổi lịch sau khi nhận đơn. Đơn vẫn giữ nguyên, không tự hủy - hãy liên hệ khách để xử lý."'),
  ],
  restore='Đặt lại giờ cả ngày (TC-SHOP-009).',
  ref=M10S + ' (order-schedule-conflict); order-views.ts',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-SHOP-030', ngay=3, seq=40, ten='Xem hộp thông báo và cài đặt thông báo của chủ quán',
  muc_dich='Chủ quán xem được thông báo đơn mới và chỉnh âm thanh/nhóm thông báo.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-021',
  pre='Đã có vài thông báo (đơn mới, nhắc…).',
  steps=[
    ('Trên Trang chủ 11Food chạm biểu tượng chuông "Thông báo".', 'Mở hộp thông báo, có nhãn "Tất cả" và "Chưa đọc (n)".'),
    ('Chạm một thông báo về đơn.', 'Mở đúng đơn đó (đúng mã đơn), không mở đơn khác.'),
    ('Chạm "Đánh dấu tất cả đã đọc".', 'Số chưa đọc về 0; hiện "Bạn đã đọc hết thông báo." hoặc "Không có thông báo chưa đọc".'),
    ('Vào Tài khoản > "Cài đặt thông báo".', 'Màn có nhóm "Nhận thông báo về" (ví dụ "Đơn hàng và giao hàng") và mục "Âm thanh".'),
  ],
  restore=R_NONE,
  ref='mobile/packages/n11_shared/lib/src/m08/m08_views.dart; mobile/food/lib/food_tabs.dart (foodNotificationRouter)',
  auto='tests/integration/m08-notifications.int.spec.ts; mobile/packages/n11_shared/test/m08_test.dart')

# ----- giao trực tiếp (quán chủ động gọi shipper) - phần tạo yêu cầu

T('TC-SHOP-031', ngay=3, seq=41, ten='Quán tạo yêu cầu giao hàng trực tiếp (DIRECT) - nhập đủ thông tin',
  muc_dich='Quán chủ động gọi shipper cho một đơn không đặt qua 11Food: chỉ cần địa chỉ mô tả, tên và số điện thoại người nhận, mô tả hàng, không cần ghim bản đồ điểm giao.',
  prio='P0', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, deps='TC-SHOP-001',
  data='Tên người nhận "Người Nhận Test". Số điện thoại người nhận: SĐT-NHẬN (10 số, bắt đầu bằng 0, là số của một người trong nhóm test). Địa chỉ giao (mô tả): "Số 20 đường Test, tổ 5, phường Test - cạnh cửa hàng tạp hóa". Mô tả hàng "1 hộp bánh Test". Giá trị hàng 100000. Ai trả phí: "Quán trả". Cách tính phí: "Theo bảng giá" > chọn mốc quãng đường ước tính (khung 1). Ghi chú: "Gọi trước khi đến (TEST)".',
  pre='CQ-A ở chế độ quản lý quán. Bảng phí giao hàng đã được SYSTEM áp dụng (TC-ADM-024).',
  steps=[
    ('Tab "Đơn hàng" > chạm nút "Giao hàng" (khác với "Đơn món"). Chạm "Gọi shipper".', 'Mở màn tạo yêu cầu giao với các ô "Tên người nhận", "Số điện thoại người nhận", "Địa chỉ giao (mô tả)" (gợi ý "Ghi rõ để shipper tìm được. Không cần ghim bản đồ."), "Mô tả hàng", "Giá trị hàng (đ)", "Ghi chú", mục "Người trả phí" và cách tính phí.'),
    ('Nhập dữ liệu như phần Dữ liệu nhập. Chọn "Quán trả". Ở phần phí chọn "Theo bảng giá" rồi chọn một mốc ở "Chọn mốc quãng đường ước tính".', 'Hiện mức phí của mốc đã chọn và dòng "Đây là phí ước tính theo mốc bạn chọn, không phải quãng đường đo trên bản đồ. Shipper có thể đề xuất mức khác và bên trả phí quyết định." Ghi lại mức phí.'),
    ('Chạm "Gọi shipper" ở cuối màn hình, rồi xác nhận "Gọi shipper?".', 'Yêu cầu giao được tạo, hiện trong danh sách "Giao hàng" với mã dạng "G-…" và trạng thái "Đang tìm shipper"; hiện bộ đếm thời gian tìm (tối đa 30 phút).'),
    ('Mở yêu cầu vừa tạo.', 'Chi tiết có người nhận, địa chỉ mô tả, hàng, phí giao và người trả phí đúng như đã nhập. KHÔNG có bản đồ theo dõi vị trí điểm giao.'),
  ],
  restore='Hủy yêu cầu giao bằng nút "Hủy yêu cầu giao" (TC-SHOP-034) nếu chưa có shipper nhận.',
  ref='mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (form tạo yêu cầu); docs/current/M07-owner-delivery-flow-20261023.md mục III',
  auto='tests/integration/m07-delivery.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart')

T('TC-SHOP-032', ngay=3, seq=42, ten='Tạo yêu cầu giao trực tiếp: kiểm tra dữ liệu nhập sai',
  muc_dich='Thiếu thông tin hoặc số điện thoại sai thì không gọi được shipper.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-031',
  data='Lần 1: để trống tên/địa chỉ/mô tả hàng. Lần 2: số điện thoại "12345". Lần 3: giá trị hàng "abc". Lần 4: ghi chú "Gọi số 0912345678" (có số điện thoại trong ghi chú). Lần 5: không chọn mốc phí.',
  pre='Đang ở màn tạo yêu cầu giao.',
  steps=[
    ('Chủ quán: tab "Đơn hàng" > "Giao hàng" > "Gọi shipper" để mở màn tạo yêu cầu giao.', 'Màn tạo yêu cầu giao mở ra với các ô trống.'),
    ('Thử từng dữ liệu ở mục Dữ liệu nhập rồi chạm "Gọi shipper".', 'Mỗi lần không gửi được và báo lỗi cụ thể: "Hãy nhập tên người nhận, địa chỉ và mô tả hàng."; "Số điện thoại người nhận chưa đúng (10 số, bắt đầu bằng 0)."; "Hãy nhập giá trị hàng (số nguyên, có thể là 0)."; "Ghi chú cho shipper không được chứa số điện thoại."; "Hãy chọn mốc phí giao, hoặc chọn "Thỏa thuận" và nhập mức phí đề xuất."'),
  ],
  restore='Thoát màn hình, không có yêu cầu nào được tạo.',
  ref='mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (các thông báo lỗi); m07_widgets.dart',
  auto='mobile/packages/n11_shared/test/m07_views_test.dart')

T('TC-SHOP-033', ngay=3, seq=43, ten='Tạo yêu cầu giao trực tiếp với phí "Thỏa thuận" (ngoài bảng giá)',
  muc_dich='Khi phí không tính được theo bảng, quán đề xuất mức phí và lý do; shipper đồng ý hoặc đề xuất lại.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-031',
  data='Cách tính phí "Thỏa thuận". Mức phí đề xuất 30000. Lý do: "Thời tiết xấu" (hoặc "Gấp", "Cồng kềnh", "Khác" kèm ghi chú).',
  pre='Đang ở màn tạo yêu cầu giao, đã nhập đủ thông tin người nhận.',
  steps=[
    ('Chạm "Thỏa thuận". Nhập "Mức phí đề xuất (đ)" = 30000. Chọn lý do "Thời tiết xấu".', 'Hiện ô nhập phí và lý do; hiện mức đề xuất 30.000đ.'),
    ('Chọn lý do "Khác" mà bỏ trống ghi chú.', 'Báo "Lý do Khác cần có ghi chú."; không gửi.'),
    ('Nhập phí "-5" hoặc "15000000".', 'Báo "Nhập phí là số nguyên từ 0 đến 10.000.000đ."'),
    ('Sửa lại phí hợp lệ, chạm "Gọi shipper".', 'Yêu cầu được tạo với "Phí thỏa thuận" 30.000đ ở trạng thái "Đang tìm shipper".'),
  ],
  restore='Hủy yêu cầu giao nếu chưa có shipper nhận.',
  ref='mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (Thỏa thuận, lý do); docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md',
  auto='tests/integration/m06-shipping-fee-agreement.int.spec.ts; m07-delivery.int.spec.ts')

T('TC-SHOP-034', ngay=3, seq=44, ten='Quán hủy yêu cầu giao khi chưa có shipper nhận',
  muc_dich='Hủy yêu cầu giao phải có lý do và dừng việc tìm shipper; không ảnh hưởng đơn món (nếu có).',
  prio='P0', actor='Chủ quán', dev=('P2', 'P3'), phones=2, deps='TC-SHOP-031',
  data='Lý do: "Khách đổi ý (TEST)".',
  pre='Có một yêu cầu giao đang "Đang tìm shipper"; Điện thoại 3 có SP-A online (nếu đủ điều kiện) để kiểm tra thẻ biến mất.',
  steps=[
    ('Chủ quán mở yêu cầu giao, chạm "Hủy yêu cầu giao".', 'Hộp "Hủy yêu cầu giao?" nói "Yêu cầu giao sẽ kết thúc, shipper (nếu đã nhận) được giải phóng và hệ thống ngừng tìm. Không tự hủy đơn món." và yêu cầu "Lý do hủy".'),
    ('Nhập lý do, chạm "Xác nhận hủy".', 'Yêu cầu chuyển sang "Đã hủy yêu cầu giao" trong nhóm "Không thành công / Đã hủy".'),
    ('Trên máy shipper mở "Đơn hàng" > "Có thể nhận".', 'Thẻ đơn đã biến mất (không còn nhận được); không có shipper nào bị giữ tiền.'),
  ],
  restore='Không cần.',
  ref='mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (m07-cancel); apps/backend/src/delivery/delivery-cancel.ts',
  auto='tests/integration/m07-delivery.int.spec.ts')

T('TC-SHOP-035', ngay=3, seq=45, ten='Danh sách "Giao hàng" của quán: lọc theo trạng thái và tìm theo mã',
  muc_dich='Quán theo dõi yêu cầu giao theo nhóm trạng thái.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-031',
  pre='Quán đã có vài yêu cầu giao ở trạng thái khác nhau.',
  steps=[
    ('Tab "Đơn hàng" > "Giao hàng".', 'Có các nhãn "Tất cả", "Đang tìm shipper", "Shipper đã nhận", "Đang giao", "Hoàn thành", "Không thành công / Đã hủy".'),
    ('Chạm từng nhãn.', 'Danh sách chỉ hiện yêu cầu thuộc nhóm đó; mỗi thẻ có mã G-…, tên người nhận, hàng, phí giao và người trả phí.'),
    ('Gõ một mã giao vào ô tìm kiếm.', 'Chỉ còn đúng yêu cầu đó.'),
  ],
  restore=R_NONE,
  ref='mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (nhãn lọc dòng 55-60)',
  auto='mobile/packages/n11_shared/test/m07_views_test.dart')

T('TC-SHOP-036', ngay=4, seq=46, ten='Quán xác nhận hàng đã về / đã xử lý sau khi hủy giao đã lấy hàng',
  muc_dich='Sau khi bị hủy lúc shipper đã cầm hàng, quán phải xác nhận hàng đã về quán hoặc đã xử lý trước khi gọi lại shipper.',
  prio='P0', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-FLOW-020',
  pre='Một yêu cầu giao đã bị hủy sau khi shipper lấy hàng (TC-FLOW-020), có hồ sơ xử lý hàng đang mở.',
  steps=[
    ('Mở yêu cầu giao đó.', 'Thấy phần "Xử lý hàng" / "Hàng hiện ở": "Hàng đang ở shipper hoặc chưa rõ", kèm lời giải thích "Hàng ở tay ai người đó chịu trách nhiệm...". Chưa có nút "Gọi lại shipper".'),
    ('Chạm "Xác nhận hàng đã về quán" (nếu hàng đã về), hoặc "Đã xử lý, không giao tiếp" (nếu hàng đã được xử lý). Nhập ghi chú nếu hỏi.', 'Hồ sơ chuyển "Đã đóng"; "Hàng hiện ở" đổi thành "Hàng đã về quán" hoặc "Đã xử lý, không giao tiếp". Với đơn món: xuất hiện lại nút "Gọi lại shipper" khi hàng đã về.'),
  ],
  restore=R_ORDER,
  ref='m07_shop_views.dart (m07-custody-returned, m07-custody-handled); docs/current/M07-owner-delivery-flow-20261023.md (custody)',
  auto='tests/integration/m07-delivery.int.spec.ts')

T('TC-SHOP-037', ngay=2, seq=18.6, ten='Thêm một món cho "Quán Test B" (quán ngoài giờ) để thử đặt món khi quán đóng cửa',
  muc_dich='Quán Test B cần có ít nhất một món để các test "đặt món khi quán đóng cửa" làm được.',
  prio='P0', actor='Chủ quán (CQ-B)', dev=('P2',), phones=1, deps='TC-SHOP-011, TC-ADM-020',
  data='Tên món "Món B Test", giá 25000, nhóm "Món chính".',
  pre='CQ-B đang ở chế độ quản lý Quán Test B (đã làm TC-SHOP-011). Có nhóm món (TC-ADM-020).',
  steps=[
    ('Đăng nhập CQ-B, vào chế độ quản lý quán, tab "Quán" > "Thực đơn" > "+ Thêm món".', 'Mở màn "Thêm món".'),
    ('Nhập "Món B Test", giá 25000, chọn nhóm "Món chính", chạm "Lưu món".', 'Món xuất hiện trong thực đơn của Quán Test B ("Đang hiện").'),
  ],
  restore='Giữ món để dùng cho TC-CUS-010 và TC-CUS-031.',
  ref=MENUV + ' (Thêm món)', auto='tests/integration/menu.int.spec.ts')
