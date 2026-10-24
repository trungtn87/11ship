# -*- coding: utf-8 -*-
from lib import *

DISC = 'mobile/packages/n11_shared/lib/src/m02/discovery_views.dart'
PREV = 'mobile/packages/n11_shared/lib/src/m02/preview_views.dart'
M10C = 'mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart'
ADDRV = 'mobile/packages/n11_shared/lib/src/addresses/address_views.dart'
M10CART = 'mobile/packages/n11_shared/lib/src/m10/m10_cart.dart'

KH_LOGIN_PRE = 'KH-A đã đăng ký và đang đăng nhập trên Điện thoại 1 (11Food). Quán Test A đang mở, có món (TC-SHOP-009, TC-SHOP-012).'

# =====================================================================================================
# CUS - Khách hàng
# =====================================================================================================

T('TC-CUS-001', ngay=2, seq=10, ten='Trang chủ 11Food: lấy vị trí hiện tại và hiện danh sách quán gần bạn',
  muc_dich='Khách thấy quán gần mình ngay khi mở ứng dụng; ứng dụng tự xác định khu vực phục vụ từ GPS.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-SHOP-009',
  pre='11Food mở trên Điện thoại 1, đã cấp quyền vị trí, GPS bật, người thử đứng trong khu vực phục vụ. Quán Test A đang mở.',
  steps=[
    ('Mở 11Food, tab "Trang chủ".', 'Hiện "Đang định vị…" / "Đang xác định khu vực…" rồi dòng "Khu vực: Cao Bằng" (tên khu vực phục vụ).'),
    ('Cuộn xuống phần "Quán gần bạn".', 'Có danh sách quán; "Quán Test A" xuất hiện với nhãn "Đang mở cửa".'),
    ('Chạm nút "Xem tất cả" (nếu có).', 'Mở màn "Danh sách quán" với cùng các quán.'),
  ],
  restore=R_NONE,
  ref=DISC + ' ("Khu vực: …", "Quán gần bạn"); docs/ops/service-area-gps-154.md',
  auto='mobile/packages/n11_shared/test/m02_discovery_test.dart; m02_gps_area_test.dart; tests/integration/discovery.int.spec.ts')

T('TC-CUS-002', ngay=2, seq=11, ten='Trang chủ khi GPS (dịch vụ vị trí) của điện thoại đang tắt',
  muc_dich='Khi GPS tắt, ứng dụng nói rõ và cho thử lại; không hiện sai khu vực.',
  prio='P1', actor='Khách', dev=('P1',), phones=1,
  pre='Quyền vị trí đã cấp nhưng GPS (Vị trí) của điện thoại TẮT.',
  steps=[
    ('Mở 11Food > "Trang chủ".', 'Hiện "Vị trí đang tắt. Thử lại" (hoặc thông báo tương tự). Không hiện khu vực sai.'),
    ('Bật GPS rồi chạm "Thử lại".', 'Ứng dụng chờ định vị rồi hiện khu vực và danh sách quán.'),
  ],
  restore='Để GPS bật.',
  ref=DISC + ' ("Vị trí đang tắt. Thử lại", "Đang chờ GPS. Thử lại")',
  auto='mobile/packages/n11_shared/test/m02_gps_area_test.dart')

T('TC-CUS-003', ngay=2, seq=12, ten='Khách đứng ngoài khu vực phục vụ',
  muc_dich='Ngoài vùng phục vụ ứng dụng không được hứa giao hàng và phải hướng dẫn khách.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note='Cần người thật đứng ngoài khu vực phục vụ (cách trung tâm TP Cao Bằng hơn khoảng 10 km) hoặc kỹ thuật viên tạm đổi vùng. Không dùng ứng dụng giả vị trí; nếu không làm được ghi BLOCKED.',
  pre='GPS bật, quyền vị trí đã cấp, người thử ở ngoài khu vực.',
  steps=[
    ('Mở 11Food > "Trang chủ".', 'Hiện "Ngoài khu vực phục vụ" / "Khu vực này chưa được phục vụ" / "Hiện chưa thể giao hàng tới vị trí này."'),
    ('Đọc phần hướng dẫn bên dưới.', 'Có gợi ý "Hoặc xem quán theo khu vực tham khảo:" và/hoặc "Thử xác định lại khu vực".'),
  ],
  restore=R_NONE,
  ref=DISC + ' ("Ngoài khu vực phục vụ")',
  auto='mobile/packages/n11_shared/test/m02_gps_area_test.dart')

T('TC-CUS-004', ngay=2, seq=13, ten='Hiện khoảng cách, điểm đánh giá và trạng thái mở cửa trên thẻ quán',
  muc_dich='Thẻ quán cho khách biết nhanh quán đóng/mở, xa bao nhiêu và được đánh giá thế nào.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-001',
  pre='Điện thoại 1 ở gần Quán Test A (biết khoảng cách thực tế, ví dụ đo bằng bản đồ khác).',
  steps=[
    ('Mở "Trang chủ" > "Quán gần bạn", xem thẻ "Quán Test A".', 'Thẻ có tên quán, nhãn "Đang mở cửa", điểm đánh giá (hoặc "Chưa có đánh giá"), khoảng cách.'),
    ('So khoảng cách hiển thị với khoảng cách thực tế bạn đo (đường chim bay).', 'Chênh lệch hợp lý (vài chục đến vài trăm mét do sai số GPS). Nếu sai lệch lớn (>1 km) ghi lỗi.'),
    ('Chạm vào thẻ quán.', 'Mở trang chi tiết đúng quán.'),
  ],
  restore=R_NONE,
  ref=DISC + ' (thẻ quán: rating, distance, chip)',
  auto='mobile/packages/n11_shared/test/m02_discovery_test.dart')

T('TC-CUS-005', ngay=2, seq=14, ten='Tìm quán theo tên (không cần gõ dấu)',
  muc_dich='Khách tìm quán bằng tên, gõ không dấu vẫn ra.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-009',
  data='Từ khóa: "quan test a", sau đó "QUÁN TEST A".',
  pre='Quán Test A đang mở.',
  steps=[
    ('Ở "Trang chủ" chạm ô "Tìm quán hoặc món" ("Gõ tên quán hoặc tên món. Không cần gõ dấu.") và gõ "quan test a".', 'Danh sách kết quả hiện "Quán Test A" (và Quán Test B nếu tên chứa "quan test").'),
    ('Gõ "QUÁN TEST A" (viết hoa, có dấu).', 'Vẫn ra cùng kết quả.'),
    ('Chạm kết quả "Quán Test A".', 'Mở trang quán "Quán Test A" với tên quán, giờ hoạt động và thực đơn.'),
  ],
  restore=R_NONE,
  ref=DISC + ' (Tìm quán hoặc món)',
  auto='tests/integration/discovery.int.spec.ts; mobile/packages/n11_shared/test/m02_discovery_test.dart')

T('TC-CUS-006', ngay=2, seq=15, ten='Tìm quán theo tên món',
  muc_dich='Gõ tên món thì ra các quán có món đó.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-012',
  data='Từ khóa: "bun cha", "nem ran test".',
  pre='Quán Test A có món "Bún chả Test", "Nem rán Test".',
  steps=[
    ('Gõ "bun cha" vào ô tìm kiếm.', 'Kết quả hiện Quán Test A có món "Bún chả Test" (hoặc món được liệt kê dưới quán).'),
    ('Gõ "nem ran test".', 'Hiện quán có "Nem rán Test".'),
    ('Gõ tên món đang ẨN "Món ẩn Test".', 'KHÔNG ra kết quả (món ẩn không được tìm thấy).'),
  ],
  restore=R_NONE,
  ref=DISC + '; tests/integration/discovery.int.spec.ts',
  auto='tests/integration/discovery.int.spec.ts')

T('TC-CUS-007', ngay=2, seq=16, ten='Tìm không có kết quả và xóa từ khóa',
  muc_dich='Khi không có kết quả ứng dụng phải nói rõ và cho xóa nhanh.',
  prio='P2', actor='Khách', dev=('P1',), phones=1,
  data='Từ khóa "zzzzqqq".',
  pre='Đang ở Trang chủ.',
  steps=[
    ('Gõ "zzzzqqq" vào ô tìm kiếm.', 'Hiện "Không có kết quả" và gợi ý "Thử tên quán hoặc tên món khác.".'),
    ('Chạm "Xóa từ khóa" (hoặc biểu tượng X "Xóa nội dung tìm kiếm").', 'Ô tìm kiếm trống, trở lại danh sách quán.'),
  ],
  restore=R_NONE, ref=DISC, auto='mobile/packages/n11_shared/test/m02_discovery_test.dart')

T('TC-CUS-008', ngay=2, seq=17, ten='Bộ lọc "Chỉ quán đang mở cửa" và lọc theo nhóm món',
  muc_dich='Khách ẩn các quán đóng cửa và lọc theo nhóm món.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-011',
  pre='Có Quán Test A (đang mở) và Quán Test B (ngoài giờ).',
  steps=[
    ('Ở màn danh sách quán chạm "Bộ lọc".', 'Mở bảng "Bộ lọc" với "Chỉ quán đang mở cửa" và "Nhóm món".'),
    ('Bật "Chỉ quán đang mở cửa", chạm "Áp dụng".', 'Quán Test B (đóng cửa) biến mất; Quán Test A còn. Có nhãn "Bộ lọc đang bật".'),
    ('Chọn một "Nhóm món" (ví dụ "Đồ uống") rồi "Áp dụng".', 'Chỉ còn quán có món thuộc nhóm đó.'),
    ('Chạm "Xóa bộ lọc" / "Đặt lại".', 'Trở lại đầy đủ danh sách.'),
  ],
  restore=R_NONE, ref=DISC + ' (Bộ lọc, Xóa bộ lọc, Đặt lại)',
  auto='mobile/packages/n11_shared/test/m02_discovery_test.dart')

T('TC-CUS-009', ngay=2, seq=18, ten='Trang chi tiết quán: tên, giờ hoạt động, thực đơn và giá',
  muc_dich='Khách xem được đầy đủ thông tin quán trước khi đặt.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-012',
  pre='Quán Test A mở, có 3 món hiện (Bún chả Test 45.000đ, Nem rán Test 30.000đ, Trà đá Test 5.000đ) và 1 món ẩn.',
  steps=[
    ('Mở trang "Quán Test A".', 'Thấy tên quán, nhãn "Đang mở cửa", mục "Thực đơn".'),
    ('Chạm "Xem giờ hoạt động ›".', 'Mở bảng "Giờ hoạt động" (Giờ Việt Nam), có dòng "Hôm nay".'),
    ('Đối chiếu danh sách món và giá.', 'Có đúng 3 món hiện, giá đúng (45.000đ, 30.000đ, 5.000đ). Không có "Món ẩn Test". Có thể có "Đã bán n".'),
  ],
  restore=R_NONE, ref=PREV + ' (Thực đơn, Xem giờ hoạt động, Đã bán)',
  auto='mobile/packages/n11_shared/test/m02_view_customer_test.dart')

T('TC-CUS-010', ngay=2, seq=19, ten='Quán đóng cửa (Quán Test B): khách thấy nhưng không đặt được',
  muc_dich='Quán ngoài giờ phải hiện trạng thái đóng cửa rõ ràng.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-011, TC-SHOP-037',
  pre='Quán Test B hoàn tất hồ sơ, đang ngoài giờ hoạt động và có món "Món B Test" (TC-SHOP-037).',
  steps=[
    ('Tìm "Quán Test B" và mở trang quán.', 'Quán hiện nhãn "Đã đóng cửa" và dòng "Ngoài giờ hoạt động đã cài đặt." hoặc tương tự.'),
    ('Thử thêm một món vào giỏ.', 'Không đặt được ngay: ứng dụng báo quán chưa nhận đơn lúc này và gợi ý chọn giờ hẹn (xem TC-CUS-031).'),
  ],
  restore=R_NONE, ref=PREV + ' (OUTSIDE_BUSINESS_HOURS); M10C (SHOP_NOT_OPEN)',
  auto='tests/integration/shop-availability.int.spec.ts; m10-orders.int.spec.ts')

T('TC-CUS-011', ngay=2, seq=20, ten='Quán chưa có món nào đang hiện',
  muc_dich='Khách không bị đánh lừa bởi quán trống; ứng dụng báo rõ.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-011',
  pre='Quán Test B hoàn tất hồ sơ, CHƯA thêm món nào (làm test này TRƯỚC TC-SHOP-037).',
  steps=[
    ('Trên 11Food gõ "Quán Test B" vào ô "Tìm quán hoặc món" và chạm vào kết quả.', 'Mở trang Quán Test B (nhãn "Đã đóng cửa").'),
    ('Nhìn phần thực đơn.', 'Hiện "Quán chưa có món để hiển thị." và không có nút thêm giỏ.'),
  ],
  restore='Nếu Quán Test B đã có món thì test này không thực hiện được; ghi NOT RUN.',
  ref=PREV + ' ("Quán chưa có món để hiển thị.")', auto='mobile/packages/n11_shared/test/m02_view_customer_test.dart')

T('TC-CUS-012', ngay=2, seq=21, ten='Tìm món trong một quán',
  muc_dich='Khách tìm nhanh món khi thực đơn dài.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-012',
  data='Từ khóa "tra da", "khong co".',
  pre='Đang ở trang Quán Test A.',
  steps=[
    ('Chạm "Tìm món trong quán" và gõ "tra da".', 'Hiện "Trà đá Test".'),
    ('Gõ "khong co".', 'Hiện "Không tìm thấy món phù hợp" và gợi ý "Thử từ khóa khác."'),
  ],
  restore=R_NONE, ref=PREV, auto='mobile/packages/n11_shared/test/m02_view_customer_test.dart')

T('TC-CUS-013', ngay=2, seq=22, ten='Điểm đánh giá của quán khi chưa có đánh giá',
  muc_dich='Quán chưa có ai đánh giá phải hiện "Chưa có đánh giá" chứ không phải điểm giả.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-012',
  pre='Quán Test A chưa có đánh giá nào (trước khi chạy TC-FEED).',
  steps=[
    ('Trên 11Food mở trang "Quán Test A".', 'Trang quán mở ra bình thường.'),
    ('Xem phần đánh giá của quán (dưới tên quán).', 'Hiện "Chưa có đánh giá (0 lượt)" - không có số sao tự bịa.'),
  ],
  restore=R_NONE, ref=PREV + ' ("Chưa có đánh giá (0 lượt)")', auto='mobile/packages/n11_shared/test/shop_rating_summary_test.dart')

T('TC-CUS-014', ngay=4, seq=76, ten='Quán bị Admin vô hiệu hóa không còn hiện cho khách',
  muc_dich='Quán bị vô hiệu hóa không được nhận đơn và khách không thấy.',
  prio='P0', actor='Khách + ADMIN', dev=('P1', 'PC'), phones=1, deps='TC-ADM-016',
  pre='Quán Test C hoặc quán thử đã hoàn tất hồ sơ, không có đơn đang chạy.',
  steps=[
    ('Khách tìm thấy quán thử trong "Quán gần bạn".', 'Quán hiện bình thường.'),
    ('Admin vô hiệu hóa quán (TC-ADM-016 bước 2-3).', 'Quán được ghi trạng thái "Đã vô hiệu hóa".'),
    ('Khách kéo làm mới danh sách và tìm lại quán.', 'Không còn thấy quán trong danh sách và kết quả tìm.'),
    ('Nếu khách đang ở trang quán đó và thử thêm món/đặt đơn.', 'Báo quán không khả dụng ("Quán hiện không khả dụng" / "Quán hiện chưa hiển thị cho khách").'),
    ('Admin kích hoạt lại quán.', 'Quán hiện lại cho khách.'),
  ],
  restore='Quán phải được kích hoạt lại ở bước 5.',
  ref='apps/backend/src/admin-shops; preview_views.dart ("Quán hiện không khả dụng")',
  auto='tests/integration/admin-shops.int.spec.ts; discovery.int.spec.ts')

# --- giỏ hàng

T('TC-CUS-015', ngay=2, seq=24, ten='Thêm món vào giỏ (số lượng và ghi chú)',
  muc_dich='Khách thêm món, chọn số lượng, ghi chú; giỏ hiện đúng tên, số lượng và tiền.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-SHOP-012',
  data='Món "Bún chả Test" số lượng 2, ghi chú "ít cay, không hành".',
  pre=KH_LOGIN_PRE,
  steps=[
    ('Mở trang Quán Test A, chạm món "Bún chả Test".', 'Hiện bảng chọn món với số lượng (mặc định 1), ô "Ghi chú cho món" (gợi ý "Ví dụ: ít cay, không hành") và nút "Thêm vào giỏ · 45.000đ".'),
    ('Tăng số lượng lên 2, gõ ghi chú "ít cay, không hành".', 'Nút đổi thành "Thêm vào giỏ · 90.000đ".'),
    ('Chạm "Thêm vào giỏ · 90.000đ".', 'Thanh dưới cùng hiện "Xem giỏ · … · 90.000đ".'),
    ('Chạm "Xem giỏ · …".', 'Màn "Giỏ hàng" có dòng 2× Bún chả Test, ghi chú "Ghi chú: ít cay, không hành", tiền món 90.000đ.'),
  ],
  restore='Xóa giỏ ("Xóa giỏ hàng" > "Xóa giỏ") trước test sau.',
  ref=M10C + ' (_DishSheet, CartBar, CartScreen); ' + M10CART,
  auto='mobile/packages/n11_shared/test/m10_orders_test.dart; tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-016', ngay=2, seq=25, ten='Thêm cùng món cùng ghi chú thì gộp dòng; khác ghi chú thì tách dòng',
  muc_dich='Giỏ không bị lộn xộn nhưng vẫn giữ đúng yêu cầu khác nhau của từng phần ăn.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='Giỏ trống, đang ở trang Quán Test A.',
  steps=[
    ('Thêm "Nem rán Test" x1 không ghi chú; sau đó thêm lại "Nem rán Test" x1 không ghi chú.', 'Giỏ chỉ có MỘT dòng "Nem rán Test" số lượng 2 (gộp).'),
    ('Thêm "Nem rán Test" x1 với ghi chú "chấm tương ớt".', 'Giỏ có hai dòng: số lượng 2 không ghi chú, và số lượng 1 có ghi chú.'),
    ('Thêm "Nem rán Test" x1 với ghi chú "Chấm   tương ớt" (viết hoa, thừa dấu cách).', 'Gộp vào dòng có ghi chú "chấm tương ớt" (số lượng thành 2) vì ghi chú giống nhau sau khi chuẩn hóa.'),
  ],
  restore='Xóa giỏ.', ref='docs/current/M10-implementation-20261018.md mục 2 (gộp dòng theo ghi chú)',
  auto='tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-CUS-017', ngay=2, seq=26, ten='Tăng, giảm số lượng và xóa món khỏi giỏ',
  muc_dich='Khách sửa giỏ dễ dàng; tổng tiền luôn đúng.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='Giỏ có 2× Bún chả Test (90.000đ) và 1× Trà đá Test (5.000đ).',
  steps=[
    ('Trong giỏ chạm "Thêm Bún chả Test" (nút +).', 'Số lượng 3; tiền món 140.000đ.'),
    ('Chạm "Bớt Bún chả Test" (nút -) hai lần.', 'Số lượng 1; tiền món 50.000đ.'),
    ('Chạm "Xóa khỏi giỏ" ở dòng Trà đá.', 'Dòng Trà đá biến mất; tiền món 45.000đ.'),
    ('Giảm số lượng Bún chả về 0 (hoặc "Xóa khỏi giỏ").', 'Giỏ trống: hiện "Giỏ hàng trống" và gợi ý "Chọn món ở trang quán để thêm vào giỏ."'),
  ],
  restore=R_NONE, ref=M10C + ' (Bớt, Thêm, Xóa khỏi giỏ)',
  auto='mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-CUS-018', ngay=2, seq=27, ten='Giỏ chỉ đặt từ một quán: đổi quán thì hỏi thay giỏ',
  muc_dich='Tránh đặt nhầm món của hai quán trong một đơn.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='Giỏ đang có món của Quán Test A. Có một quán thứ hai đang mở để thêm món (nếu chưa có, ghi BLOCKED hoặc dùng Quán Test B khi nó đang mở).',
  steps=[
    ('Mở trang quán khác và thêm một món.', 'Hộp "Thay giỏ hàng?" hỏi "Giỏ đang có món của Quán Test A. Mỗi giỏ chỉ đặt từ một quán. Bạn muốn xóa giỏ cũ và bắt đầu giỏ mới ở …?" với nút "Giữ giỏ cũ" và "Thay giỏ".'),
    ('Chạm "Giữ giỏ cũ".', 'Giỏ cũ giữ nguyên, món mới không được thêm.'),
    ('Thêm món lần nữa, chạm "Thay giỏ".', 'Giỏ chỉ còn món của quán mới.'),
  ],
  restore='Xóa giỏ.', ref=M10C + ' (Thay giỏ hàng?)',
  auto='mobile/packages/n11_shared/test/m10_orders_test.dart; tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-019', ngay=2, seq=28, ten='Xóa toàn bộ giỏ hàng',
  muc_dich='Xóa giỏ phải có xác nhận.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='Giỏ có món.',
  steps=[
    ('Trong màn "Giỏ hàng" chạm "Xóa giỏ hàng".', 'Hộp "Xóa giỏ hàng?" - "Tất cả món trong giỏ sẽ bị xóa." với "Xóa giỏ" và nút hủy.'),
    ('Chạm nút hủy.', 'Hộp thoại đóng; giỏ hàng vẫn còn đủ các món như trước.'),
    ('Chạm "Xóa giỏ hàng" > "Xóa giỏ".', 'Giỏ hàng trống, không còn món nào.'),
  ],
  restore=R_NONE, ref=M10C, auto='mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-CUS-020', ngay=2, seq=29, ten='Giỏ hàng được giữ khi thoát ứng dụng và khi đăng nhập lại',
  muc_dich='Giỏ lưu trên máy chủ nên không mất khi tắt ứng dụng.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='Giỏ có 2× Bún chả Test.',
  steps=[
    ('Vuốt tắt hẳn 11Food, mở lại, vào trang quán.', 'Thanh "Xem giỏ · …" vẫn còn, giỏ giữ đúng 2× Bún chả Test.'),
    ('Đăng xuất rồi đăng nhập lại KH-A.', 'Giỏ vẫn còn (lưu theo tài khoản).'),
  ],
  restore='Xóa giỏ.', ref='docs/current/M10-implementation-20261018.md (giỏ do máy chủ giữ)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-021', ngay=2, seq=30, ten='Giỏ hiển thị phí giao dự tính và tổng dự kiến',
  muc_dich='Khách biết trước tiền món, phí giao và tổng. Phí giao tính theo bảng giá của hệ thống; nếu chưa tính được phải ghi "Chưa xác định phí", không hiện 0đ.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-CUS-015, TC-CUS-022',
  note='Cần: (1) SYSTEM đã áp dụng bảng phí (TC-ADM-024); (2) dịch vụ định tuyến bản đồ hoạt động. Thiếu một trong hai thì phí hiện "Chưa xác định phí" - đó là kết quả đúng, ghi lại. Người phụ trách cho biết mức phí chuẩn để đối chiếu.',
  pre='Giỏ có 2× Bún chả Test + 1× Trà đá Test (tiền món 95.000đ). KH-A đã có địa chỉ có ghim vị trí (TC-CUS-022).',
  steps=[
    ('Mở "Giỏ hàng".', 'Có dòng "Phí giao (dự tính)" và "Tổng dự kiến"; có chú thích "Phí giao chỉ là tạm tính, có thể chưa phải giá chính thức."'),
    ('Đối chiếu "Phí giao (dự tính)" với bảng giá (Web Admin > HỆ THỐNG > "Phí & điều kiện giao") theo khoảng cách từ quán đến điểm giao.', 'Phí đúng bằng mức của khung khoảng cách tương ứng. Tổng dự kiến = 95.000đ + phí giao.'),
    ('Chọn địa chỉ KHÔNG có ghim vị trí và xem lại giỏ.', 'Phí hiện "Chưa xác định phí" (không phải 0đ); "Chưa có phí giao nên chưa tính được tổng tiền." Đơn vẫn gửi được.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu phí hiện 0đ khi hệ thống chưa tính được phí.',
  restore='Xóa giỏ.', ref=M10C + ' (Phí giao (dự tính), Chưa xác định phí); docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md; m10_common.dart',
  auto='tests/integration/m06-shipping-fee-policy.int.spec.ts; m10-orders.int.spec.ts', sev='Cao')

# --- sổ địa chỉ

T('TC-CUS-022', ngay=2, seq=31, ten='Thêm địa chỉ giao hàng vào sổ địa chỉ',
  muc_dich='Khách lưu địa chỉ để đặt nhanh; địa chỉ đầu tiên tự thành mặc định.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-ACC-001',
  data='Tên người nhận "Khách Test A". Số điện thoại SĐT-KH-A. Địa chỉ chi tiết "Số 10 đường Test, tổ 1, phường Test, thành phố Cao Bằng". Ghi chú cho shipper "Gọi khi tới cổng". Dùng "Vị trí hiện tại" để ghim.',
  pre='KH-A đang đăng nhập, sổ địa chỉ trống ("Chưa có địa chỉ giao hàng"). Đứng tại điểm muốn ghim, GPS bật.',
  steps=[
    ('Tab "Tài khoản" > "Sổ địa chỉ" > "+ Thêm địa chỉ mới". (Nếu sổ trống có thể hiện "Thêm địa chỉ để đặt món nhanh hơn. Địa chỉ đầu tiên sẽ là địa chỉ mặc định.")', 'Mở màn "Thêm địa chỉ" với ô tên, số điện thoại, địa chỉ, ghi chú cho shipper.'),
    ('Điền dữ liệu như phần Dữ liệu nhập. Chạm "Vị trí hiện tại" để ghim.', 'Hiện "Đang lấy vị trí qua GPS và mạng…" rồi "Đã lấy vị trí hiện tại" (kèm độ chính xác nếu có). Hoặc "Bản đồ chưa có trong bản cài đặt này." nếu bản này không có bản đồ - ghi lại.'),
    ('Chạm "Lưu địa chỉ".', 'Địa chỉ xuất hiện trong sổ, có nhãn "Mặc định".'),
  ],
  restore='Có thể xóa địa chỉ thử ở TC-CUS-023.',
  ref=ADDRV + '; mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart',
  auto='tests/integration/customers-addresses.int.spec.ts; mobile/packages/n11_shared/test/address_book_test.dart; address_location_picker_test.dart')

T('TC-CUS-023', ngay=2, seq=32, ten='Sửa, đặt mặc định và xóa địa chỉ trong sổ',
  muc_dich='Quản lý nhiều địa chỉ; đơn cũ không bị ảnh hưởng khi sửa/xóa địa chỉ.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-022',
  data='Địa chỉ thứ hai: tên "Khách Test A (cơ quan)", số điện thoại SĐT-KH-A, địa chỉ "Số 5 đường Test, phường Test".',
  pre='Sổ địa chỉ đã có 1 địa chỉ.',
  steps=[
    ('Thêm địa chỉ thứ hai và lưu.', 'Có 2 địa chỉ; địa chỉ đầu vẫn "Mặc định".'),
    ('Chạm "Đặt mặc định" (hoặc "Đặt làm địa chỉ mặc định") ở địa chỉ thứ hai.', 'Nhãn "Mặc định" chuyển sang địa chỉ thứ hai.'),
    ('Chạm "Sửa" địa chỉ thứ hai, đổi ghi chú, "Lưu địa chỉ".', 'Lưu thành công, thông tin mới hiện.'),
    ('Chạm "Xóa" địa chỉ thứ hai > "Xóa địa chỉ này?" > "Xóa địa chỉ".', 'Địa chỉ bị xóa (hộp nói "Các đơn đã đặt không bị ảnh hưởng."). Địa chỉ còn lại tự trở thành mặc định.'),
  ],
  restore='Giữ lại một địa chỉ đầy đủ cho các test đặt hàng.',
  ref=ADDRV, auto='tests/integration/customers-addresses.int.spec.ts; mobile/packages/n11_shared/test/address_book_test.dart')

T('TC-CUS-024', ngay=2, seq=33, ten='Địa chỉ giao: kiểm tra dữ liệu sai',
  muc_dich='Số điện thoại và địa chỉ bắt buộc đúng định dạng.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-022',
  data='Số điện thoại "12345"; địa chỉ để trống.',
  pre='Mở "Thêm địa chỉ".',
  steps=[
    ('Tab "Tài khoản" > "Sổ địa chỉ" > "+ Thêm địa chỉ mới".', 'Màn "Thêm địa chỉ" mở ra.'),
    ('Nhập số điện thoại "12345", để trống địa chỉ, chạm "Lưu địa chỉ".', 'Không lưu; báo "Số điện thoại chưa hợp lệ. Nhập số di động Việt Nam, ví dụ 0912 345 678." và "Nhập địa chỉ giao hàng chi tiết."'),
  ],
  restore=R_NONE, ref=ADDRV, auto='mobile/packages/n11_shared/test/address_book_test.dart')

# --- đặt hàng

T('TC-CUS-025', ngay=2, seq=34, ten='Gửi đơn đặt món: kiểm tra màn "Xác nhận đơn", tiền và thông báo "Đã gửi đơn"',
  muc_dich='Khách đặt đơn thành công; số tiền, người nhận, địa chỉ phải đúng với những gì đã chọn.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-CUS-022',
  data='Người nhận "Khách Test A", SĐT-KH-A, địa chỉ nhà KH-A; 2× Bún chả Test, 1× Trà đá Test; ghi chú đơn "Giao giờ hành chính (TEST)". Giao sớm nhất.',
  pre=KH_LOGIN_PRE + ' Giỏ trống.',
  steps=customer_place_order() + [
    ('Trong chi tiết đơn đối chiếu: món, số lượng, "Tiền món", "Phí giao (dự tính)", người nhận, địa chỉ, ghi chú. Nhìn kỹ xem có dòng "Đã thanh toán" hoặc "Còn phải thu".', 'Mọi thông tin khớp với lúc đặt. Dòng "Thanh toán trực tiếp" (nghĩa: khách trả tiền cho quán/shipper, không trả qua ứng dụng). KHÔNG có dòng "Đã thanh toán" hay "Còn phải thu"; KHÔNG hiện "mã tra cứu" hay chuỗi dài 32-36 ký tự gồm chữ và số.'),
    ('Chạm tab "Đơn hàng" > "Đang xử lý".', 'Đơn xuất hiện đúng một lần, trạng thái "Chờ quán xác nhận".'),
  ],
  restore=R_ORDER,
  ref=M10C + ' (CheckoutScreen, order-sent); docs/current/M07-owner-delivery-flow-20261023.md mục IV (bỏ dòng thanh toán)',
  auto='tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart; one_page_order_test.dart')

T('TC-CUS-026', ngay=2, seq=35, ten='Không gửi được đơn khi chưa chọn địa chỉ hoặc thiếu thông tin',
  muc_dich='Đơn thiếu người nhận/số điện thoại/địa chỉ không được gửi.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='Giỏ có món. Mở màn "Xác nhận đơn".',
  steps=[
    ('Để trống "Tên người nhận", "Số điện thoại người nhận" và không chọn địa chỉ. Chạm "Gửi đơn".', 'Không gửi; các ô báo bắt buộc và hiện "Chọn địa chỉ giao hàng." Không có đơn mới.'),
    ('Nhập số điện thoại "12345".', 'Báo "Số điện thoại chưa hợp lệ…".'),
    ('Nhập đủ đúng và chọn địa chỉ.', 'Nút "Gửi đơn · …" bấm được.'),
  ],
  restore='Thoát màn hình, không có đơn nào.', ref=M10C + ' (checkout-name, checkout-phone)',
  auto='mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-CUS-027', ngay=2, seq=36, ten='Dùng vị trí hiện tại làm điểm giao khi đặt đơn',
  muc_dich='Khách đặt hộ hoặc đặt nhanh bằng vị trí hiện tại; nếu từ chối quyền vị trí vẫn đặt được nhưng phí chưa xác định.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015', ready='CẦN XÁC MINH',
  note='Phần "ghim trên bản đồ" phụ thuộc bản APK có bật gói bản đồ Cao Bằng (cờ M14). Nếu màn hình ghi "Bản đồ chưa có trong bản cài đặt này." thì chỉ thử phần dùng vị trí hiện tại và ghi lại.',
  pre='Giỏ có món. Mở "Xác nhận đơn".',
  steps=[
    ('Chạm "Địa chỉ khác", nhập địa chỉ bằng chữ, chạm "Vị trí hiện tại".', 'Ứng dụng lấy MỘT vị trí khi bạn bấm; hiện "Đã lấy vị trí hiện tại…". Không theo dõi liên tục.'),
    ('Nhìn dòng phí giao.', 'Có ghim: phí giao được máy chủ tính theo bảng giá (hoặc "Chưa xác định phí" nếu thiếu dịch vụ tuyến - không hiện 0đ).'),
    ('Làm lại nhưng chọn "Không cho phép" khi xin quyền vị trí.', 'Hiện thông báo "Chưa được cấp quyền vị trí…" và vẫn gửi được đơn; phí "Chưa xác định phí".'),
  ],
  restore='Xóa giỏ / hủy đơn thử.', ref='mobile/packages/n11_shared/lib/src/addresses/address_location_picker.dart; docs/current/M10-implementation-20261018.md mục 5',
  auto='mobile/packages/n11_shared/test/address_location_picker_test.dart')

T('TC-CUS-028', ngay=2, seq=37, ten='Đặt hộ: người nhận khác người đặt',
  muc_dich='Khách đặt cho người khác; người nhận không được cấp quyền xem đơn qua số điện thoại.',
  prio='P1', actor='Khách (KH-A) + KH-B', dev=('P1',), phones=1, deps='TC-ACC-002',
  data='Người nhận "Người Nhận Test", số điện thoại SĐT-KH-B (số của KH-B). Địa chỉ giao: nhập tay.',
  pre='KH-A có giỏ món. KH-B là tài khoản đã đăng ký với SĐT-KH-B.',
  steps=[
    ('KH-A đặt đơn với "Tên người nhận" = "Người Nhận Test" và số điện thoại = SĐT-KH-B.', 'Đơn gửi thành công, chi tiết đơn hiện người nhận "Người Nhận Test".'),
    ('Đăng xuất KH-A, đăng nhập KH-B, mở tab "Đơn hàng".', 'KH-B KHÔNG thấy đơn này (đơn thuộc tài khoản KH-A, không theo số điện thoại người nhận).'),
  ],
  restore=R_ORDER, ref='docs/current/M10-implementation-20261018.md ("đặt hộ không cấp quyền xem vị trí qua SĐT")',
  auto='tests/integration/m10-orders.int.spec.ts', sev='Cao')

T('TC-CUS-029', ngay=2, seq=38, ten='Đặt đơn hẹn giờ nhận món',
  muc_dich='Khách chọn giờ muốn nhận món (trong giờ mở cửa, từ 30 phút đến 7 ngày tới).',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-025',
  data='Giờ hẹn: bây giờ + 45 phút (làm tròn), trong giờ mở cửa.',
  pre=KH_LOGIN_PRE + ' Giỏ có món. Mở "Xác nhận đơn".',
  steps=[
    ('Ở phần "Thời gian nhận món" chạm "Hẹn giờ nhận món" và chọn giờ = bây giờ + 45 phút.', 'Hiện "Hẹn lúc …" và dòng giải thích "Giờ hẹn là thời gian mong muốn, món có thể đến sớm hoặc muộn hơn."'),
    ('Chạm "Gửi đơn".', 'Đơn gửi thành công và nằm ở tab "Đơn hẹn" (không nằm ở "Đang xử lý" thông thường) với dòng "Muốn nhận món lúc …".'),
  ],
  restore=R_ORDER, ref=M10C + ' (Hẹn giờ nhận món, Đơn hẹn); apps/backend/src/orders (SCHEDULE_MIN_LEAD_MS=30 phút, MAX 7 ngày)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-030', ngay=2, seq=39, ten='Hẹn giờ không hợp lệ: quá gần, quá xa, ngoài giờ mở cửa',
  muc_dich='Giờ hẹn phải cách ít nhất 30 phút, tối đa 7 ngày, và nằm trong giờ hoạt động của quán.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-029',
  data='Giờ hẹn: bây giờ + 10 phút; bây giờ + 8 ngày; một giờ quán đóng cửa (Quán Test B hoặc đặt lịch Quán Test A có giờ nghỉ).',
  pre='Giỏ có món. Mở "Xác nhận đơn".',
  steps=[
    ('Chọn giờ hẹn bây giờ + 10 phút rồi "Gửi đơn".', 'Hiện "Giờ hẹn quá gần. Hãy chọn muộn hơn ít nhất 30 phút."'),
    ('Chọn giờ hẹn sau 8 ngày.', 'Hiện "Giờ hẹn quá xa. Chỉ hẹn trong 7 ngày tới."'),
    ('Chọn giờ nằm ngoài giờ hoạt động của quán.', 'Hiện "Giờ hẹn nằm ngoài giờ hoạt động của quán."'),
  ],
  restore='Xóa giỏ.', ref=M10C + ' (SCHEDULE_TOO_SOON/TOO_FAR/OUTSIDE_HOURS)', auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-031', ngay=2, seq=40, ten='Đặt món ở quán đang đóng cửa bị từ chối',
  muc_dich='Quán đóng cửa thì không nhận đơn "giao sớm nhất"; ứng dụng gợi ý hẹn giờ.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-011, TC-SHOP-037',
  pre='Quán Test B (ngoài giờ) có món "Món B Test" đang hiện (TC-SHOP-037).',
  steps=[
    ('Thêm món của Quán Test B vào giỏ và vào "Xác nhận đơn", chọn "Giao sớm nhất".', 'Đến được màn xác nhận.'),
    ('Chạm "Gửi đơn".', 'Không tạo đơn; hiện lỗi "Quán chưa nhận đơn lúc này. Hãy chọn giờ hẹn hoặc quay lại sau."'),
    ('Tab "Đơn hàng".', 'Không có đơn mới do thao tác vừa rồi.'),
  ],
  restore='Xóa giỏ.', ref=M10C + ' (SHOP_NOT_OPEN)', auto='tests/integration/m10-orders.int.spec.ts; shop-availability.int.spec.ts')

T('TC-CUS-032', ngay=2, seq=41, ten='Giá món thay đổi trước khi khách gửi đơn: yêu cầu kiểm tra lại',
  muc_dich='Khách không bị tính giá cũ: nếu quán đổi giá lúc khách đang ở màn xác nhận, hệ thống không tạo đơn mà báo kiểm tra lại.',
  prio='P1', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-025',
  pre='Khách ở màn "Xác nhận đơn" với "Nem rán Test" (30.000đ). Chủ quán sẵn sàng sửa giá.',
  steps=[
    ('Khách để nguyên màn "Xác nhận đơn", chưa gửi.', 'Màn hiện tiền theo giá 30.000đ.'),
    ('Chủ quán đổi giá "Nem rán Test" thành 35.000đ và lưu.', 'Lưu thành công.'),
    ('Khách chạm "Gửi đơn".', 'KHÔNG tạo đơn. Hiện "Giá hoặc món đã thay đổi - Giỏ đã được cập nhật theo giá hiện tại. Hãy kiểm tra lại rồi gửi đơn."'),
    ('Khách xem lại giỏ rồi gửi lần nữa.', 'Đơn được tạo với giá mới 35.000đ.'),
    ('Chủ quán đổi lại giá 30.000đ.', 'Giá món về lại 30.000đ như ban đầu (đã khôi phục dữ liệu để chạy lại).'),
  ],
  restore=R_ORDER + ' Đặt lại giá "Nem rán Test" = 30.000đ.',
  ref=M10C + ' (ORDER_CART_CHANGED, checkout-changed)', auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-033', ngay=2, seq=42, ten='Món bị ẩn trước khi khách gửi đơn: báo "Có món không còn bán"',
  muc_dich='Món đã ẩn/xóa không được đặt.',
  prio='P1', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-025',
  pre='Khách có giỏ với "Trà đá Test"; chủ quán sẵn sàng ẩn món.',
  steps=[
    ('Chủ quán ẩn "Trà đá Test".', 'Món "Trà đá Test" đang ở trạng thái ẩn trong thực đơn của quán.'),
    ('Khách mở "Giỏ hàng".', 'Hiện "Có món không còn bán" ("Hãy xóa các món đó khỏi giỏ rồi tiếp tục.") và dòng "Không còn bán".'),
    ('Khách chạm "Xóa khỏi giỏ" ở dòng đó.', 'Cảnh báo biến mất, tiếp tục đặt được các món còn lại.'),
    ('Chủ quán hiện lại "Trà đá Test".', 'Món "Trà đá Test" hiện lại bình thường trong thực đơn quán (đã khôi phục dữ liệu để chạy lại).'),
  ],
  restore='Hiện lại món đã ẩn; xóa giỏ.', ref=M10C + ' (cart-unavailable)', auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-034', ngay=2, seq=43, ten='Giới hạn: số lượng tối đa mỗi món và độ dài ghi chú',
  muc_dich='Hệ thống chặn nhập quá lớn (tối đa 99 phần mỗi dòng, ghi chú tối đa 200 ký tự).',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  data='Số lượng cố nhập 100; ghi chú 250 ký tự.',
  pre='Đang ở bảng chọn món.',
  steps=[
    ('Tăng số lượng đến giới hạn tối đa hoặc cố nhập 100.', 'Không vượt quá 99; có thông báo/giới hạn rõ.'),
    ('Dán chuỗi 250 ký tự vào "Ghi chú cho món".', 'Ô chỉ nhận tối đa 200 ký tự.'),
  ],
  restore=R_NONE, ref='apps/backend/src/orders/order-constants.ts (MAX_LINE_QUANTITY=99, MAX_ITEM_NOTE=200)',
  auto='tests/integration/m10-orders.int.spec.ts')

# --- theo dõi

T('TC-CUS-035', ngay=2, seq=44, ten='Khách xem danh sách đơn: "Đang xử lý", "Đơn hẹn", "Lịch sử"',
  muc_dich='Đơn nằm đúng nhóm theo trạng thái.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-025',
  pre='KH-A có 1 đơn đang xử lý, 1 đơn hẹn, 1 đơn đã hủy/hoàn thành.',
  steps=[
    ('Mở tab "Đơn hàng".', 'Có 3 nhãn "Đang xử lý", "Đơn hẹn", "Lịch sử".'),
    ('Chạm từng nhãn.', 'Đơn nằm đúng nhóm; nhóm trống hiện "Chưa có đơn đang xử lý" / "Chưa có đơn hẹn" / "Chưa có lịch sử đơn".'),
    ('Chạm một đơn.', 'Mở chi tiết đúng đơn.'),
  ],
  restore=R_NONE, ref=M10C + ' (CustomerOrdersView)', auto='mobile/packages/n11_shared/test/m10_orders_test.dart')

T('TC-CUS-036', ngay=2, seq=45, ten='Khách hủy đơn khi quán chưa xác nhận',
  muc_dich='Khách tự hủy được cho đến khi quán xác nhận.',
  prio='P0', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-025',
  data='Lý do hủy: "Đặt nhầm (TEST)".',
  pre='Đơn mới ở trạng thái "Chờ quán xác nhận".',
  steps=[
    ('Khách mở chi tiết đơn, chạm "Hủy đơn".', 'Hộp "Hủy đơn?" nói "Quán chưa xác nhận nên bạn hủy được. Sau khi quán xác nhận, bạn cần liên hệ quán." và ô "Lý do hủy".'),
    ('Nhập lý do, xác nhận hủy.', 'Đơn chuyển "Đã hủy" và nằm trong "Lịch sử".'),
    ('Chủ quán xem danh sách đơn.', 'Đơn bị hủy hiện "Đã hủy" (khách hủy) trong "Lịch sử", không còn ở "Chờ xác nhận". Quán nhận được thông báo.'),
  ],
  restore='Không cần.', ref=M10C + ' (Hủy đơn)', auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-037', ngay=2, seq=46, ten='Khách không hủy được sau khi quán xác nhận (chỉ còn khi shipper đã lấy hàng)',
  muc_dich='Sau khi quán xác nhận, khách phải liên hệ quán; nút "Hủy đơn" biến mất.',
  prio='P0', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-SHOP-022',
  pre='Đơn đã được quán xác nhận ("Quán đang chuẩn bị"), chưa gọi shipper.',
  steps=[
    ('Khách mở chi tiết đơn.', 'Không có nút "Hủy đơn". Có thể có chú thích liên hệ quán ("Liên hệ quán: SĐT quán").'),
    ('Tìm cách hủy khác trong màn hình đơn.', 'Không có cách tự hủy trên 11Food; muốn hủy phải nhờ quán bấm "Hủy đơn món".'),
  ],
  restore=R_ORDER, ref=M10C + '; apps/backend/src/orders/order-rules.ts (customerMayCancel)',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-038', ngay=2, seq=47, ten='Đặt lại đơn cũ ("Đặt lại") với giá hôm nay',
  muc_dich='Khách đặt lại món đã đặt; món hết thì báo, giá lấy theo hôm nay.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-036',
  pre='KH-A có ít nhất một đơn trong "Lịch sử". Giỏ hiện trống (hoặc có món quán khác để thử hộp thoại thay giỏ).',
  steps=[
    ('Mở một đơn đã kết thúc trong "Lịch sử", chạm "Đặt lại".', 'Giỏ được tạo lại với các món của đơn đó theo giá hiện tại; nếu món đã hết thì hiện "Món không còn bán, đã bỏ qua: …".'),
    ('Nếu giỏ đang có món quán khác: hộp "Giỏ đang có món của … Bạn muốn thay bằng món của đơn này?".', 'Chọn được thay hoặc giữ giỏ cũ.'),
    ('Chạm "Xem giỏ" ở thanh dưới màn hình để mở giỏ hàng.', 'Giỏ hiện đúng các món đặt lại; chưa có đơn mới được tạo cho đến khi bấm "Gửi đơn".'),
  ],
  restore='Xóa giỏ.', ref=M10C + ' (Đặt lại, order-reorder)', auto='tests/integration/m10-orders.int.spec.ts')

T('TC-CUS-039', ngay=2, seq=48, ten='Khách chỉ thấy đơn của chính mình',
  muc_dich='Riêng tư: người này không xem được đơn của người khác.',
  prio='P0', actor='Khách (KH-A, KH-B)', dev=('P1',), phones=1, deps='TC-CUS-025',
  pre='KH-A có ít nhất một đơn. KH-B có tài khoản.',
  steps=[
    ('Đăng nhập KH-B, mở tab "Đơn hàng", xem cả 3 nhãn.', 'Không có đơn nào của KH-A. Nếu KH-B chưa có đơn: "Chưa có đơn đang xử lý/Chưa có lịch sử đơn".'),
    ('Đặt một đơn nhỏ bằng KH-B.', 'Đơn của KH-B chỉ hiện ở KH-B.'),
    ('Đăng nhập KH-A.', 'KH-A không thấy đơn của KH-B.'),
  ],
  restore=R_ORDER, ref='apps/backend/src/orders (customer scope); tests/integration/m10-orders.int.spec.ts',
  auto='tests/integration/m10-orders.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-CUS-040', ngay=2, seq=49, ten='Chi tiết đơn của khách: trạng thái, người trả phí, lịch sử đơn',
  muc_dich='Khách theo dõi được đơn qua từng bước và hiểu mình đang chờ ai.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-SHOP-022',
  pre='Đơn đã được quán xác nhận.',
  steps=[
    ('Mở chi tiết đơn.', 'Hiện mã đơn, trạng thái "Quán đang chuẩn bị", danh sách món, tiền món, phí giao, người trả phí ("Khách trả phí"/"Quán trả phí") và mốc thời gian (Diễn biến).'),
    ('Kéo tới phần diễn biến/lịch sử.', 'Có các dòng "Khách gửi đơn", "Quán xác nhận" kèm giờ.'),
    ('Tìm thông tin liên hệ quán.', 'Có "Liên hệ quán: <số điện thoại quán>".'),
  ],
  restore=R_NONE, ref=M10C + ' (order detail); m10_models.dart (OrderEvent labels)',
  auto='mobile/packages/n11_shared/test/m10_orders_test.dart')
