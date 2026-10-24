# -*- coding: utf-8 -*-
from lib import *

M07SHIP = 'mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart'
M07SHOP = 'mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart'
HOME = 'mobile/ship/lib/ship_home.dart'
ONLINE = 'mobile/ship/lib/ship_online.dart'
DRVV = 'mobile/packages/n11_shared/lib/src/flows/driver_views.dart'
DELIV = 'apps/backend/src/delivery'
OWNER = 'docs/current/M07-owner-delivery-flow-20261023.md'

SP_READY = 'SP-A đã đăng nhập 11Ship trên Điện thoại 3, ví ĐỦ TIỀN (đã nạp xác nhận ít nhất mức nạp tối thiểu và số dư khả dụng lớn hơn hoa hồng một đơn; xem TC-WAL-005), đứng trong bán kính 3 km quanh Quán Test A, GPS bật.'

# =====================================================================================================
# DRV - Shipper
# =====================================================================================================

T('TC-DRV-001', ngay=3, seq=10, ten='Trang chủ 11Ship khi chưa bật online: trạng thái, ví và điều kiện nhận đơn',
  muc_dich='Shipper thấy rõ mình đang online hay offline, ví có đủ điều kiện không và vì sao chưa nhận được đơn.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-ACC-004',
  pre='SP-A đăng nhập trên Điện thoại 3, chưa bật online.',
  steps=[
    ('Mở 11Ship, tab "Trang chủ".', 'Thấy bản đồ Cao Bằng (nếu bản cài có gói bản đồ; nếu không thấy "Bản cài này chưa bật gói bản đồ Cao Bằng..." - ghi nhận), dòng "Bạn đang offline" và nút "Bật online".'),
    ('Đọc dòng lý do dưới trạng thái.', 'Nói rõ điều kiện ví: "Ví đủ điều kiện. Bạn có thể bật hoạt động." hoặc "Số dư ví chưa đủ điều kiện" (SP-B) / các lý do khác bằng tiếng Việt, không hiện mã kỹ thuật.'),
    ('Đọc lời giải thích phía dưới nút.', 'Có "Bật online sẽ chia sẻ vị trí của bạn khoảng 1 phút một lần, kể cả khi khóa màn hình, để nhận đơn gần bạn và cho quán biết bạn đang tới. Tắt online để ngừng nhận đơn mới."'),
    ('Chạm "Ví tiền / Nạp tiền".', 'Mở màn "Ví của tôi" với "Số dư khả dụng", "Tổng số dư".'),
  ],
  restore=R_NONE, ref=HOME + ' (home-activity-status, home-online-reason, home-online-disclosure)',
  auto='mobile/ship/test/ship_home_test.dart (nếu có); mobile/packages/n11_shared/test/driver_m03_test.dart')

T('TC-DRV-002', ngay=3, seq=11, ten='Bật online thành công khi ví đủ điều kiện và GPS tốt',
  muc_dich='Shipper đủ điều kiện bật online; vị trí được chia sẻ để nhận đơn gần.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-WAL-005',
  pre=SP_READY,
  steps=[
    ('Trên Trang chủ chạm "Bật online". Cho phép quyền vị trí/thông báo nếu hỏi.', 'Nút hiện "Đang xử lý…" rồi đổi thành "Tắt online". Trạng thái "Bạn đang online".'),
    ('Đọc dòng nhỏ về vị trí.', 'Hiện "Đang lấy vị trí…" rồi "Đang chia sẻ vị trí".'),
    ('Kéo thanh thông báo của Android xuống.', 'Có thông báo thường trực của 11Ship (dịch vụ chia sẻ vị trí đang chạy).'),
    ('Mở Web Admin > Vận hành > Shipper > SP-A (nếu có quyền).', 'Admin thấy shipper đang bật nhận đơn.'),
  ],
  restore='Chạm "Tắt online" khi xong test.', ref=ONLINE + '; docs/current/M14-online-location-20261024.md',
  auto='mobile/ship/test/ship_online_test.dart; tests/integration/m07-delivery.int.spec.ts')

T('TC-DRV-003', ngay=3, seq=12, ten='Shipper không đủ tiền trong ví (SP-B) không bật online / không nhận được đơn',
  muc_dich='Ví không đủ thì không nhận đơn, để hoa hồng luôn thu được. Ứng dụng phải nói rõ lý do.',
  prio='P0', actor='Shipper (SP-B)', dev=('P3',), phones=1, deps='TC-ACC-005',
  pre='SP-B đăng nhập, ví 0đ (hoặc dưới mức tối thiểu), chưa nạp tiền. Có một đơn đang "Đang tìm shipper" để thử.',
  steps=[
    ('Trên Trang chủ đọc dòng lý do dưới trạng thái.', 'Có lý do rõ ràng như "Số dư ví chưa đủ điều kiện" hoặc "Ví chưa đủ điều kiện nhận đơn nên chưa bật nhận đơn được." (có thể gồm cả hướng dẫn nạp tiền).'),
    ('Chạm "Bật online".', 'KHÔNG bật được: hiện "Chưa bật được nhận đơn" kèm lý do; trạng thái vẫn "Bạn đang offline".'),
    ('Mở tab "Đơn hàng" > "Có thể nhận".', 'Không có đơn nhận được, hoặc thẻ đơn hiện không đủ điều kiện (nút "Nhận đơn" bị khóa) kèm lý do (ví dụ số dư thấp).'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu shipper ví 0đ nhận được đơn.',
  restore=R_NONE, ref=HOME + '; mobile/packages/n11_shared/lib/src/flows/driver_controller.dart (BALANCE_TOO_LOW); apps/backend/src/wallet/wallet-driver-port.ts',
  auto='tests/integration/m06-shipping-eligibility.int.spec.ts; m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-DRV-004', ngay=3, seq=13, ten='Bật online khi GPS của điện thoại đang tắt',
  muc_dich='Không có vị trí thì không nhận đơn; ứng dụng phải hướng dẫn bật GPS.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-WAL-005',
  pre=SP_READY + ' Tắt GPS (Vị trí) của điện thoại.',
  steps=[
    ('Chạm "Bật online".', 'Không bật được; hiện "GPS đang tắt. Hãy bật Vị trí trên điện thoại rồi thử lại." và nút "Mở cài đặt vị trí".'),
    ('Chạm "Mở cài đặt vị trí", bật GPS, quay lại, chạm "Thử lại".', 'Bật online thành công.'),
  ],
  restore='Tắt online.', ref=ONLINE + ' (GPS đang tắt…)', auto='mobile/ship/test/ship_online_test.dart')

T('TC-DRV-005', ngay=3, seq=14, ten='Tắt online',
  muc_dich='Shipper ngừng nhận đơn mới bất cứ lúc nào; việc tắt không hủy đơn đang giao.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-002',
  pre='SP-A đang online, chưa có đơn.',
  steps=[
    ('Trang chủ chạm "Tắt online".', 'Trạng thái đổi sang "Bạn đang offline"; nút lại là "Bật online".'),
    ('Kéo thanh thông báo Android xuống.', 'Thông báo thường trực chia sẻ vị trí biến mất (vì không còn đơn).'),
    ('Chạm tab "Đơn hàng" > "Có thể nhận".', 'Không còn đơn mới nào được đề xuất.'),
  ],
  restore=R_NONE, ref=ONLINE + '; docs/current/M14-online-location-20261024.md (Tắt online luôn được)',
  auto='mobile/ship/test/ship_online_test.dart')

T('TC-DRV-006', ngay=3, seq=15, ten='Trạng thái online được giữ khi mở lại ứng dụng',
  muc_dich='Shipper không phải bật lại mỗi lần mở app nếu chưa tắt.',
  prio='P1', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-002',
  pre='SP-A đang online.',
  steps=[
    ('Vuốt tắt hẳn 11Ship rồi mở lại.', 'Mở lại; ứng dụng đọc trạng thái từ máy chủ.'),
    ('Nhìn Trang chủ.', 'Vẫn "Bạn đang online" và tiếp tục "Đang chia sẻ vị trí" (hoặc có hướng dẫn rõ nếu thiếu quyền). Không tự bật online khi shipper đã tắt trước đó.'),
  ],
  restore='Tắt online.', ref=ONLINE, auto='mobile/ship/test/ship_online_test.dart')

T('TC-DRV-007', ngay=3, seq=16, ten='Danh sách "Có thể nhận": thông tin thấy và không thấy trước khi nhận đơn',
  muc_dich='Bảo vệ riêng tư của khách: trước khi nhận, shipper chỉ biết khu vực, quán, phí; không biết số điện thoại và địa chỉ chi tiết.',
  prio='P0', actor='Shipper + Quán', dev=('P2', 'P3'), phones=2, deps='TC-SHOP-031, TC-WAL-005',
  pre='SP-A online, đủ điều kiện. Quán gọi shipper cho một đơn (ORDER hoặc DIRECT) và đơn đang "Đang tìm shipper".',
  steps=ship_open_offers() + [
    ('Đọc thẻ đơn.', 'Có: tên quán, "Khu vực lấy hàng", "Khu vực giao", khoảng cách đến quán, giá trị hàng, "Phí giao", "Người trả phí" ("Quán trả ship"/"Khách trả ship"), đồng hồ "Còn … phút". KHÔNG có số điện thoại người nhận, KHÔNG có địa chỉ giao chi tiết, KHÔNG có bản đồ theo dõi.'),
    ('Chạm vào thẻ (nếu mở được chi tiết).', 'Chi tiết trước khi nhận vẫn không lộ số điện thoại/địa chỉ chi tiết.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu thấy số điện thoại hoặc địa chỉ chi tiết của khách trước khi nhận đơn.',
  restore='Quán hủy yêu cầu giao nếu không dùng tiếp.', ref=M07SHIP + '; docs/current/M07-implementation-20261018.md mục 5 (offer)',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-DRV-008', ngay=3, seq=17, ten='Chỉ nhận được đơn trong bán kính 3 km quanh quán',
  muc_dich='Shipper ở xa quán hơn 3 km (đường chim bay) không thấy/không nhận được đơn.',
  prio='P1', actor='Shipper + Quán', dev=('P2', 'P3'), phones=2, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note='Cần shipper thật đứng cách quán >3 km nhưng vẫn trong thành phố. Không dùng ứng dụng giả vị trí (ứng dụng cũng từ chối vị trí giả). Nếu không đứng xa được thì ghi BLOCKED. Chú ý: quy tắc 3 km do máy chủ kiểm.',
  pre='Quán Test A gọi shipper cho một đơn. SP-A đủ tiền, online, đang cách quán khoảng 4-5 km (đo bằng bản đồ khác).',
  steps=[
    ('Shipper mở "Đơn hàng" > "Có thể nhận".', 'Không thấy đơn của Quán Test A (hoặc thấy nhưng không đủ điều kiện, nút "Nhận đơn" khóa kèm lý do ngoài vùng).'),
    ('Shipper di chuyển vào trong bán kính 3 km quanh quán, chờ khoảng 1-2 phút để vị trí cập nhật rồi mở lại danh sách.', 'Đơn hiện ra, nhận được.'),
  ],
  restore='Quán hủy yêu cầu giao.', ref='docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md mục 1; apps/backend/src/shipping-policy/shipping-eligibility.ts',
  auto='tests/integration/m06-shipping-eligibility.int.spec.ts')

T('TC-DRV-009', ngay=3, seq=18, ten='Shipper nhận đơn',
  muc_dich='Nhận đơn là shipper nhận việc (chưa cầm hàng): thông tin đầy đủ hiện ra, hoa hồng được giữ chỗ trong ví.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-007',
  pre='Có thẻ đơn trong "Có thể nhận". Ghi lại số dư ví khả dụng TRƯỚC khi nhận (B0).',
  steps=[
    ('Chạm "Nhận đơn".', 'Đơn chuyển sang "Đang thực hiện" với trạng thái "Đã nhận đơn"/"Shipper đã nhận". Hiện "Quán lấy hàng" (tên, địa chỉ, số điện thoại quán), "Người nhận", "Địa chỉ", "Điện thoại", "Phí giao".'),
    ('Mở "Ví của tôi".', '"Số dư khả dụng" giảm đúng bằng hoa hồng một đơn (mặc định 1.000đ) vì tiền được "tạm giữ" ("Tiền tạm giữ"), "Tổng số dư" chưa đổi.'),
    ('Đọc nút trong chi tiết đơn.', 'Có "Đã nhận hàng", "Hủy nhận đơn"; có "Đề xuất mức phí khác" nếu phí chưa khóa. KHÔNG có nút "Giao thất bại".'),
  ],
  restore='Hủy nhận đơn nếu muốn trả lại (TC-DRV-012).', ref=M07SHIP + '; ' + OWNER + ' mục I',
  auto='tests/integration/m07-delivery.int.spec.ts; m04-wallet-holds.int.spec.ts')

T('TC-DRV-010', ngay=3, seq=19, ten='Hai shipper bấm nhận cùng một đơn: chỉ một người nhận được',
  muc_dich='Không giao trùng một đơn cho hai shipper; người thua không bị giữ tiền.',
  prio='P0', actor='Hai shipper (SP-A, SP-B)', dev=('P1', 'P3'), phones=2, deps='TC-WAL-005',
  note='SP-B cần đã được nạp tiền (sau khi xong các test "không đủ tiền"). Cần hai điện thoại: bấm "Nhận đơn" gần như cùng lúc (đếm 1-2-3).',
  pre='SP-A (Điện thoại 3) và SP-B (Điện thoại 1, 11Ship) đều đủ tiền, online, trong 3 km. Một đơn đang tìm shipper. Ghi số dư khả dụng của cả hai trước test.',
  steps=[
    ('Cả hai mở "Đơn hàng" > "Có thể nhận" và thấy cùng thẻ đơn.', 'Hai máy cùng thấy thẻ đơn.'),
    ('Hai người cùng đếm "1-2-3" và bấm "Nhận đơn" cùng lúc.', 'Chỉ MỘT máy nhận được ("Đang thực hiện"). Máy kia báo đơn không còn nhận được: "Đơn này không còn có thể nhận" (hoặc thẻ biến mất).'),
    ('Kiểm tra ví hai người.', 'Chỉ người nhận được bị tạm giữ hoa hồng; người không nhận được KHÔNG bị tạm giữ, số dư khả dụng không đổi.'),
    ('Quán xem đơn.', 'Chỉ hiện MỘT shipper (đúng người nhận được).'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu cả hai cùng được ghi nhận nhận đơn hoặc người thua bị giữ tiền.',
  restore=R_ORDER, ref=DELIV + ' (accept dưới khóa); docs/current/M07-implementation-20261018.md',
  auto='tests/integration/m07-delivery.int.spec.ts (đua nhận đơn)', sev='NGHIÊM TRỌNG')

T('TC-DRV-011', ngay=3, seq=20, ten='Đơn có phí thương lượng: nút "Đồng ý", "Đề xuất mức khác", "Bỏ qua" trên thẻ đơn',
  muc_dich='Khi quán đề xuất mức phí (phí thỏa thuận), shipper chọn đồng ý, đề xuất mức khác hoặc bỏ qua.',
  prio='P1', actor='Shipper + Quán', dev=('P2', 'P3'), phones=2, deps='TC-SHOP-033',
  pre='Quán tạo yêu cầu giao DIRECT với phí "Thỏa thuận" 30.000đ (TC-SHOP-033). SP-A online đủ điều kiện.',
  steps=ship_open_offers() + [
    ('Đọc thẻ đơn.', 'Thấy "Phí đề xuất 30.000đ", lý do (ví dụ "Thời tiết xấu"), và ba nút "Đồng ý", "Đề xuất mức khác", "Bỏ qua". Nút "Nhận đơn" chưa dùng được cho đến khi phí chốt ("Phí chưa chốt nên chưa nhận đơn được. Hãy đồng ý mức phí hoặc đề xuất mức khác.").'),
    ('Chạm "Bỏ qua".', 'Thẻ đơn ẩn khỏi danh sách của shipper này (đơn vẫn tìm shipper khác).'),
  ],
  restore='Quán hủy yêu cầu giao.', ref=M07SHIP + ' (m07-fee-agree, m07-fee-counter, m07-fee-skip)',
  auto='tests/integration/m06-shipping-fee-agreement.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart')

T('TC-DRV-012', ngay=3, seq=21, ten='Shipper hủy nhận đơn trước khi lấy hàng (có lý do)',
  muc_dich='Nếu không đi được, shipper trả đơn; chỉ hủy lượt nhận của mình, đơn gốc và hoa hồng không bị mất.',
  prio='P0', actor='Shipper (SP-A) + Quán', dev=('P2', 'P3'), phones=2, deps='TC-DRV-009',
  data='Lý do: chọn "Thời tiết xấu" hoặc lý do khác trong danh sách; nếu chọn "Khác" phải ghi ghi chú.',
  pre='SP-A đã nhận đơn nhưng CHƯA bấm "Đã nhận hàng". Ghi số dư khả dụng hiện tại (đang bị tạm giữ).',
  steps=[
    ('Trong chi tiết đơn chạm "Hủy nhận đơn".', 'Hộp "Hủy nhận đơn?" nói "Bạn sẽ không còn giữ đơn này. Hệ thống tìm shipper khác theo thời hạn còn lại." và yêu cầu chọn lý do.'),
    ('Chọn lý do rồi chạm "Xác nhận hủy".', 'Đơn rời khỏi "Đang thực hiện"; trong "Lịch sử" ghi "Bạn đã hủy nhận".'),
    ('Mở "Ví của tôi".', 'Số tiền tạm giữ được giải phóng; số dư khả dụng trở về như trước khi nhận. Tổng số dư KHÔNG đổi.'),
    ('Quán xem đơn.', 'Đơn quay về "Đang tìm shipper" (không bị hủy), không còn tên SP-A.'),
    ('Shipper khác (hoặc chính SP-A) mở "Có thể nhận".', 'Đơn nhận lại được (trong thời hạn tìm còn lại, đồng hồ 30 phút KHÔNG bị tính lại).'),
  ],
  restore=R_ORDER, ref=M07SHIP + ' (Hủy nhận đơn); ' + DELIV + '/delivery-handback.ts; ' + OWNER + ' mục I',
  auto='tests/integration/m07-delivery.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart')

T('TC-DRV-013', ngay=3, seq=22, ten='Shipper bấm "Đã nhận hàng": một bước xác nhận, phí bị khóa',
  muc_dich='Đã nhận hàng nghĩa là shipper đã cầm hàng ở quán: từ đây phí khóa, không hủy nhận được.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-009',
  pre='SP-A đã nhận đơn, phí đã chốt (theo bảng giá). Quán đã chuẩn bị hàng.',
  steps=ship_pickup() + [
    ('Xem phần phí trong chi tiết đơn.', 'Phí hiển thị là "Phí đã khóa"; không còn nút "Đề xuất mức phí khác".'),
    ('Nhìn danh sách nút.', 'Chỉ còn "Giao thành công" (và gọi/liên hệ quán, người nhận). KHÔNG còn "Hủy nhận đơn", KHÔNG có "Giao thất bại".'),
  ],
  restore=R_ORDER, ref=M07SHIP + ' (m07-pickup, m07-complete); ' + OWNER,
  auto='tests/integration/m07-delivery.int.spec.ts')

T('TC-DRV-014', ngay=3, seq=23, ten='Shipper giao thành công: hoa hồng thu đúng một lần',
  muc_dich='Hoàn thành đơn thì ví bị trừ đúng hoa hồng một lần, đơn kết thúc và vào lịch sử.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-013',
  pre='Đơn đang "Đang giao". Ghi: Tổng số dư B1 và số dư khả dụng A1 trước khi bấm.',
  steps=ship_complete() + [
    ('Mở "Ví của tôi" > "Lịch sử giao dịch".', 'Có đúng MỘT dòng "Hoa hồng" mới, số tiền = hoa hồng đang áp dụng (mặc định 1.000đ). Tổng số dư = B1 - hoa hồng. Tiền tạm giữ của đơn này về 0.'),
    ('Mở tab "Đơn hàng" > "Lịch sử".', 'Đơn hiện ở lịch sử, trạng thái hoàn thành.'),
    ('Thử mở lại đơn và tìm nút bấm.', 'Không còn nút nào để hoàn thành lần nữa.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu hoa hồng bị trừ 0 lần hoặc nhiều hơn 1 lần.',
  restore=R_ORDER, ref=M07SHIP + '; docs/current/ADR-004-driver-wallet-consistency.md; ' + DELIV,
  auto='tests/integration/m07-delivery.int.spec.ts; m04-wallet-holds.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-DRV-015', ngay=3, seq=24, ten='Sau khi đã lấy hàng shipper không có nút hủy hoặc "Giao thất bại"',
  muc_dich='Quy tắc của Owner: sau khi lấy hàng, shipper chỉ có thể hoàn thành giao hàng; không giao được thì gọi quán thống nhất, chỉ người tạo đơn mới hủy.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-013',
  pre='Một đơn ở trạng thái "Đang giao".',
  steps=[
    ('Mở chi tiết đơn, xem hết màn hình (cuộn xuống cuối).', 'Chỉ có nút "Giao thành công". KHÔNG có "Hủy nhận đơn", "Hủy đơn", "Giao thất bại", "Bỏ đơn".'),
    ('Đọc dòng hướng dẫn.', 'Có câu "Chỉ cần bấm "Giao thành công" khi đã giao xong. Nếu không giao được, hãy gọi quán để thống nhất; chỉ người tạo đơn mới hủy được."'),
    ('[CHỈ KỸ THUẬT VIÊN - người mới bỏ qua] Kỹ thuật viên thử gửi trực tiếp lệnh hủy/giao thất bại của shipper tới máy chủ.', 'Máy chủ từ chối lệnh (kỹ thuật viên ghi mã lỗi vào Ghi chú kết quả). Nếu không có kỹ thuật viên: bỏ bước này, ghi "bỏ qua bước 3"; không ảnh hưởng PASS/FAIL.'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục I, VII; ' + M07SHIP + ' (kReleaseExplain)',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='Cao')

T('TC-DRV-016', ngay=3, seq=25, ten='Lịch sử đơn của shipper',
  muc_dich='Shipper xem lại đơn đã giao, đã hủy nhận, bị admin gỡ…',
  prio='P1', actor='Shipper', dev=('P3',), phones=1, deps='TC-DRV-014',
  pre='SP-A có ít nhất 1 đơn hoàn thành và 1 đơn đã hủy nhận.',
  steps=[
    ('Tab "Đơn hàng" > "Lịch sử".', 'Danh sách đơn đã kết thúc, mỗi dòng có kết quả: hoàn thành / "Bạn đã hủy nhận" / "Quán đã hủy yêu cầu giao" / "Admin đã gỡ bạn khỏi đơn" / "Hệ thống hủy quá hạn" / "Phí không được đồng ý".'),
    ('Mở một đơn đã hoàn thành.', 'Chi tiết có địa chỉ, phí, "Hoa hồng đã được thu theo quy định ví. Tiền hàng và phí giao do các bên giao nhận trực tiếp."'),
  ],
  restore=R_NONE, ref=M07SHIP + ' (own_outcome chips)', auto='mobile/packages/n11_shared/test/m07_views_test.dart')

T('TC-DRV-017', ngay=3, seq=26, ten='Đơn DIRECT: shipper giao theo địa chỉ mô tả, không cần ghim điểm giao',
  muc_dich='Với đơn quán tự gọi, shipper dùng địa chỉ mô tả và liên hệ người nhận; không bị bắt ghim bản đồ.',
  prio='P0', actor='Shipper', dev=('P3',), phones=1, deps='TC-SHOP-031',
  pre='Đơn DIRECT đã được SP-A nhận.',
  steps=[
    ('Mở chi tiết đơn trong "Đang thực hiện".', 'Có dòng "Giao theo địa chỉ mô tả, không cần ghim điểm giao." và hiện địa chỉ mô tả, tên và số điện thoại người nhận.'),
    ('Chạm "Đã nhận hàng" (không có bước ghim điểm giao).', 'Chỉ một bước xác nhận như đơn thường; không bị yêu cầu "Xác nhận điểm giao và phí".'),
  ],
  restore=R_ORDER, ref=M07SHIP + '; ' + OWNER + ' mục III, IV',
  auto='tests/integration/m07-delivery.int.spec.ts')

T('TC-DRV-018', ngay=3, seq=27, ten='Xem vị trí quán/người nhận trên bản đồ của shipper',
  muc_dich='Shipper xem được điểm quán (và điểm giao nếu đơn có ghim) trên bản đồ offline Cao Bằng.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1, ready='CẦN XÁC MINH',
  note='Chỉ có khi APK 11Ship được build kèm gói bản đồ Cao Bằng (cờ M14_OFFLINE_MAP). Hãy hỏi Người phụ trách. Không có bản đồ thì ghi NOT READY/BLOCKED, không phải lỗi nếu ứng dụng nói rõ "Bản cài này chưa bật gói bản đồ".',
  pre='SP-A đã nhận một đơn ORDER có ghim điểm giao.',
  steps=[
    ('Mở chi tiết đơn, tìm phần bản đồ ("Bản đồ giao hàng").', 'Có bản đồ với ghim "Quán" và "Giao" (nếu đơn có ghim); hoặc dòng "Chưa có ghim điểm giao nên chưa vẽ được bản đồ."'),
    ('Ở Trang chủ chạm "Về vị trí hiện tại".', 'Bản đồ về vị trí của shipper (chấm "Vị trí của bạn").'),
  ],
  restore=R_NONE, ref=HOME + ' (home-recenter, M14OfflineMap); mobile/ship/lib/ship_m07.dart (kM14Map)',
  auto='mobile/packages/n11_m14_map/test/m14_map_test.dart')

T('TC-DRV-019', ngay=3, seq=28, ten='Chỉ đường từng bước (dẫn đường) cho shipper',
  muc_dich='Ghi nhận rõ ràng rằng ứng dụng hiện KHÔNG có chức năng chỉ đường từng bước; chỉ có bản đồ offline hiển thị điểm.',
  prio='P2', actor='Shipper', dev=('P3',), phones=1, ready='NOT READY',
  note='Không tìm thấy mã nguồn chỉ đường/dẫn đường trong 11Ship (chỉ có bản đồ offline và ghim điểm). Test này ghi nhận hiện trạng để Owner quyết định; không phải lỗi nếu không có nút chỉ đường. Shipper dùng ứng dụng bản đồ khác khi cần.',
  pre='SP-A đã nhận đơn.',
  steps=[
    ('Trên 11Ship mở chi tiết đơn đã nhận (tab "Đơn hàng" > "Đang thực hiện" > chạm đơn).', 'Chi tiết đơn mở ra với địa chỉ quán, người nhận, phí.'),
    ('Tìm trong chi tiết đơn và trong phần bản đồ (nếu có) nút "Chỉ đường"/"Dẫn đường".', 'Ghi nhận: không có nút chỉ đường. Nếu CÓ, mô tả nút và kết quả bấm (ghi vào ghi chú và đổi trạng thái test).'),
  ],
  restore=R_NONE, ref='Tìm trong mobile/ship/lib và mobile/packages/n11_shared/lib/src/m07: không có chỉ đường; docs/current/M14-integration-20261016.md',
  auto='Không có.')

T('TC-DRV-020', ngay=3, seq=29, ten='Hồ sơ shipper: xem và sửa thông tin cá nhân',
  muc_dich='Shipper xem hồ sơ (mã shipper, họ tên, biển số) và cập nhật biển số.',
  prio='P1', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-ACC-004',
  data='Biển số xe "11A-123.45" (ví dụ).',
  pre='SP-A đăng nhập.',
  steps=[
    ('Tab "Tài khoản" > "Hồ sơ shipper".', 'Màn "Hồ sơ shipper" hiện "Thông tin shipper": "Mã shipper", "Họ tên", "Số điện thoại", "Biển số xe", trạng thái "Đang hoạt động".'),
    ('Nhập "Biển số" = "11A-123.45", chạm "Lưu thông tin".', 'Hiện "Đã lưu thông tin hồ sơ."'),
    ('Quay lại rồi mở lại hồ sơ.', 'Biển số vẫn là giá trị vừa lưu.'),
    ('Thử xóa trống "Họ và tên" rồi lưu.', 'Báo lỗi hoặc không cho lưu tên trống.'),
  ],
  restore='Có thể xóa biển số thử.', ref=DRVV + ' (Hồ sơ shipper, Lưu thông tin)',
  auto='tests/integration/m03-shipper.int.spec.ts; mobile/packages/n11_shared/test/driver_m03_test.dart')

T('TC-DRV-021', ngay=3, seq=30, ten='Shipper bị Admin khóa: không nhận đơn mới nhưng vẫn xem ví',
  muc_dich='Khóa shipper dừng nhận đơn; vẫn cho xem ví và gửi yêu cầu rút theo quy định.',
  prio='P1', actor='Shipper + ADMIN', dev=('P3', 'PC'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-018',
  pre='Một tài khoản shipper phụ (SP-B), không có đơn đang giao. Admin có quyền khóa.',
  steps=[
    ('Admin khóa tài khoản SP-B (Người dùng > chi tiết > "Khóa", hoặc "Khóa hoạt động" ở trang Shipper).', 'Trạng thái đã khóa.'),
    ('Trên 11Ship (đăng nhập lại SP-B nếu bị đăng xuất).', 'Hiện "Tài khoản đã khóa - Bạn không nhận đơn mới và không dùng các chức năng giao hàng. Bạn vẫn xem được số dư ví, lịch sử giao dịch và gửi yêu cầu rút tiền theo điều kiện hiện hành." (đối với khóa kiểu chỉ giữ ví).'),
    ('Thử "Bật online".', 'Không bật được ("Tài khoản đang bị tạm khóa").'),
    ('Admin mở khóa.', 'Shipper bật lại online được khi ví đủ điều kiện.'),
  ],
  restore='Đảm bảo SP-B được mở khóa.', ref='account_views.dart (locked-wallet-only); driver_controller.dart (ACCOUNT_SUSPENDED)',
  auto='tests/integration/admin-account-lock.int.spec.ts; m03-shipper.int.spec.ts')

T('TC-DRV-022', ngay=3, seq=31, ten='Tab "Thu nhập" của shipper',
  muc_dich='Ghi nhận hiện trạng: tab Thu nhập chưa có số liệu thật và phải ghi rõ chưa có, không hiện 0đ giả.',
  prio='P2', actor='Shipper', dev=('P3',), phones=1, ready='NOT READY',
  note='Theo mã nguồn tab "Thu nhập" hiện chỉ có khung "Chưa có dữ liệu thu nhập" và "Tổng thu nhập: —" ("— nghĩa là chưa biết, không phải 0 đồng"). Chức năng thu nhập CHƯA có.',
  pre='SP-A đăng nhập.',
  steps=[
    ('Mở 11Ship (đã đăng nhập SP-A).', 'Thấy thanh dưới cùng có tab "Thu nhập".'),
    ('Chạm tab "Thu nhập".', 'Hiện "Tổng thu nhập" = "—" kèm chú thích "Chưa có dữ liệu. "—" nghĩa là chưa biết, không phải 0 đồng." và "Chưa có dữ liệu thu nhập". Nút "Chọn khoảng ngày" bị khóa kèm lý do.'),
  ],
  restore=R_NONE, ref='mobile/ship/lib/ship_tabs.dart (_income)', auto='mobile/ship/test')

T('TC-DRV-023', ngay=3, seq=32, ten='Thông báo trong 11Ship và cài đặt "Đơn có thể nhận"',
  muc_dich='Shipper xem hộp thông báo và tắt/bật nhóm thông báo, âm thanh.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1, deps='TC-ACC-004',
  pre='SP-A đăng nhập, có vài thông báo.',
  steps=[
    ('Chạm tab "Thông báo".', 'Hiện danh sách; nếu trống: "Chưa có thông báo". Có "Tất cả"/"Chưa đọc".'),
    ('Tab "Tài khoản" > "Cài đặt thông báo".', 'Màn có "Đơn có thể nhận" (nhóm "Dành cho shipper"), "Đơn hàng và giao hàng", "Ví và hồ sơ", công tắc "Âm thanh". Có lời "Tắt âm thanh không làm tắt nhận đơn."'),
    ('Tắt nhóm "Đơn có thể nhận" rồi lưu.', 'Lưu thành công; ghi nhận: thông báo vẫn vào hộp thư nhưng không đẩy lên màn hình khóa.'),
    ('Bật lại nhóm đó.', 'Lưu thành công; nhóm "Đơn có thể nhận" đang bật như ban đầu.'),
  ],
  restore='Bật lại nhóm "Đơn có thể nhận".', ref='mobile/packages/n11_shared/lib/src/m08/m08_views.dart',
  auto='tests/integration/m08-notifications.int.spec.ts; mobile/packages/n11_shared/test/m08_test.dart')

T('TC-DRV-024', ngay=3, seq=33, ten='Đề xuất mức phí khác: nhập sai (không phải số, quá lớn, âm)',
  muc_dich='Mức phí đề xuất phải là số nguyên từ 0 đến 10.000.000đ.',
  prio='P2', actor='Shipper', dev=('P3',), phones=1, deps='TC-DRV-011',
  data='"abc", "-5", "10000001", "12.5", "20000".',
  pre='Có thẻ đơn có nút "Đề xuất mức phí khác" (dùng yêu cầu giao đang tìm shipper ở TC-DRV-011).',
  steps=[
    ('Chạm "Đề xuất mức phí khác" và nhập lần lượt "abc", "-5", "10000001", "12.5", rồi chạm "Gửi đề xuất".', 'Với mỗi giá trị sai: báo "Nhập phí là số nguyên từ 0 đến 10.000.000đ."; không gửi.'),
    ('Nhập "20000", chạm "Gửi đề xuất".', 'Gửi được (hộp đóng, thẻ hiện "Bạn đã đề xuất 20.000đ…" - tiếp nối TC-FLOW-007). Nếu không muốn tiếp tục, chạm "Quay lại" ở bước trước.'),
  ],
  restore='Quán từ chối đề xuất hoặc hủy yêu cầu giao.', ref=M07SHIP + ' (_FeeProposalDialog)',
  auto='mobile/packages/n11_shared/test/m07_views_test.dart; tests/integration/m06-shipping-fee-agreement.int.spec.ts')

T('TC-DRV-025', ngay=4, seq=60, ten='Shipper nhắc "chưa lấy hàng" sau khi nhận đơn',
  muc_dich='Hệ thống nhắc shipper mỗi 5 phút nếu đã nhận đơn mà chưa bấm "Đã nhận hàng".',
  prio='P2', actor='Shipper', dev=('P3',), phones=1, deps='TC-DRV-009',
  note='Cần chờ khoảng 5-10 phút. Thông báo đẩy cần cấu hình Firebase (xem TC-NOTI-001); nếu chưa có thì nhắc chỉ hiện trong hộp thông báo.',
  pre='SP-A đã nhận đơn, KHÔNG bấm "Đã nhận hàng".',
  steps=[
    ('Chờ khoảng 5 phút rồi mở tab "Thông báo".', 'Có thông báo nhắc lấy hàng cho đúng đơn (dạng nhắc "chưa lấy hàng").'),
    ('Chờ thêm 5 phút.', 'Có thêm một nhắc nữa (mỗi 5 phút một lần), không nhắc dồn nhiều lần cùng lúc.'),
  ],
  restore='Hủy nhận đơn hoặc hoàn tất đơn.', ref='docs/current/M07-implementation-20261018.md mục 4; docs/current/M08-implementation-20261018.md (PICKUP_REMINDER)',
  auto='tests/integration/m07-delivery.int.spec.ts; m08-notifications.int.spec.ts')

# =====================================================================================================
# FLOW - Luồng liên thông
# =====================================================================================================

def _order_flow(payer_button, payer_text, ten, muc_dich, tcid, seq, extra_after_confirm=None):
    steps = []
    steps += customer_place_order()
    steps += shop_confirm_order()
    steps += shop_call_shipper(payer_button=payer_button)
    steps += [
        ('Trên Điện thoại 3 (SP-A) chạm "Bật online" nếu chưa bật; ghi lại Tổng số dư và Số dư khả dụng trong "Ví của tôi" (B0, A0).', 'SP-A online, đang chia sẻ vị trí. Ghi B0 và A0.'),
        ('Trên Điện thoại 3 chạm tab "Đơn hàng" > "Có thể nhận".', 'Thấy thẻ đơn của Quán Test A: phí giao theo bảng giá và "%s". KHÔNG thấy số điện thoại và địa chỉ chi tiết của KH-A.' % payer_text),
        ('Chạm "Nhận đơn".', 'Đơn sang "Đang thực hiện"; hiện địa chỉ và số điện thoại quán, thông tin người nhận. Ví: số dư khả dụng giảm đúng hoa hồng (tạm giữ), Tổng số dư vẫn B0.'),
        ('Trên máy khách mở chi tiết đơn; trên máy quán mở chi tiết đơn.', 'Cả hai thấy shipper đã nhận (khách: "Shipper đang đến quán"; quán: "Shipper đã nhận") kèm tên shipper và biển số/số điện thoại. KHÔNG có bước "Món đã sẵn sàng".'),
        ('Trên Điện thoại 3 mở đơn, chạm "Đã nhận hàng" rồi xác nhận.', 'Đơn sang "Đã lấy hàng/Đang giao"; chỉ còn nút "Giao thành công". Khách thấy "Đang giao"; quán thấy "Đang giao".'),
        ('Trên Điện thoại 3 chạm "Giao thành công" rồi xác nhận.', 'Đơn kết thúc. Khách thấy "Hoàn thành"; quán thấy đơn "Hoàn thành" trong lịch sử.'),
        ('Trên Điện thoại 3 mở "Ví của tôi".', 'Tổng số dư = B0 - hoa hồng (mặc định 1.000đ); số dư khả dụng = A0 - hoa hồng; có đúng MỘT dòng "Hoa hồng" mới; không còn tiền tạm giữ của đơn này.'),
        ('Trên máy khách kiểm tra mục đánh giá trong chi tiết đơn đã hoàn thành.', 'Có thẻ "Đánh giá và phản ánh" (đánh giá quán, đánh giá shipper, gửi phản ánh).'),
    ]
    return steps


T('TC-FLOW-001', ngay=3, seq=40, ten='Đơn khách đặt qua 11Food - quán TRẢ phí giao - giao thành công (luồng chuẩn)',
  muc_dich='Kiểm tra trọn vẹn hành trình quan trọng nhất: khách đặt món -> quán xác nhận -> quán gọi shipper -> shipper nhận, lấy hàng, giao -> ví shipper trừ hoa hồng đúng một lần.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-SHOP-009, TC-SHOP-012, TC-WAL-005',
  pre='Quán Test A đang mở, có món và phí giao tính được (bảng phí đã áp dụng). KH-A có địa chỉ đã lưu (có ghim). ' + SP_READY + ' Ba điện thoại đã đăng nhập đúng tài khoản; CQ-A ở chế độ quản lý quán.',
  data='Đơn: 2 phần "Bún chả Test" + 1 phần "Trà đá Test" (tiền món 95.000đ). Người trả phí: "Quán trả phí".',
  steps=_order_flow('Quán trả phí', 'Quán trả ship', '', '', 'TC-FLOW-001', 40),
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu: đơn bị tạo trùng; hoa hồng trừ sai số lần/số tiền; thông báo sai người; shipper nhận được thông tin chi tiết của khách trước khi nhận.',
  restore=R_ORDER + ' Đơn đã hoàn thành nên không cần hủy. Nạp thêm tiền cho SP-A nếu số dư khả dụng xuống dưới mức nhận đơn.',
  ref=OWNER + ' mục II; apps/backend/src/orders, apps/backend/src/delivery; mobile m10/m07 views',
  auto='tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts; m04-wallet-holds.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-002', ngay=3, seq=41, ten='Đơn khách đặt qua 11Food - KHÁCH trả phí giao - giao thành công',
  muc_dich='Khi khách trả phí, phí tính theo bảng giá thì không cần ai đồng ý thêm; thông tin người trả phí hiện đúng cho cả ba bên.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  pre='Như TC-FLOW-001.',
  data='Giống TC-FLOW-001 nhưng chọn "Khách trả phí" khi gọi shipper.',
  steps=_order_flow('Khách trả phí', 'Khách trả ship', '', '', 'TC-FLOW-002', 41),
  restore=R_ORDER, ref=OWNER + ' mục II; ' + M07SHOP,
  auto='tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-003', ngay=3, seq=42, ten='Quán chủ động gọi shipper (DIRECT) - quán trả phí - giao thành công',
  muc_dich='Luồng thứ hai: quán gọi shipper giao một món không qua 11Food; không cần GPS điểm giao, không theo dõi hành trình.',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-SHOP-031, TC-WAL-005',
  pre='CQ-A ở chế độ quản lý quán. ' + SP_READY,
  data='Như TC-SHOP-031: người nhận "Người Nhận Test", SĐT-NHẬN, địa chỉ mô tả, hàng "1 hộp bánh Test", giá trị hàng 100000, "Quán trả", "Theo bảng giá" + một mốc quãng đường.',
  steps=[
    ('Chủ quán: tab "Đơn hàng" > "Giao hàng" > "Gọi shipper", nhập "Tên người nhận" = Người Nhận Test, số điện thoại người nhận SĐT-NHẬN, địa chỉ giao (mô tả) "Số 20 đường Test, tổ 5, phường Test - cạnh cửa hàng tạp hóa", mô tả hàng "1 hộp bánh Test", giá trị hàng 100000, chọn "Quán trả", "Theo bảng giá" và một mốc ở "Chọn mốc quãng đường ước tính", chạm "Gọi shipper" và xác nhận "Gọi shipper?".', 'Yêu cầu giao tạo thành công ("Đang tìm shipper"), có mã "G-…" và phí đúng mốc đã chọn.'),
    ('Shipper: ghi B0, A0 trong ví; chạm "Bật online" (nếu chưa), vào "Đơn hàng" > "Có thể nhận".', 'Thấy thẻ đơn: tên quán, khu vực giao (mô tả), phí giao, "Quán trả ship". Không thấy số điện thoại/địa chỉ chi tiết.'),
    ('Shipper chạm "Nhận đơn".', 'Sang "Đang thực hiện"; thấy địa chỉ mô tả, tên, số điện thoại người nhận; có dòng "Giao theo địa chỉ mô tả, không cần ghim điểm giao.". Hoa hồng được tạm giữ.'),
    ('Chủ quán mở yêu cầu giao.', 'Thấy "Shipper đã nhận" cùng tên, số điện thoại, biển số shipper. KHÔNG có bản đồ theo dõi hành trình (quán chỉ theo dõi trạng thái).'),
    ('Shipper chạm "Đã nhận hàng", xác nhận.', 'Trạng thái "Đang giao"; quán thấy "Đang giao".'),
    ('Shipper chạm "Giao thành công", xác nhận.', 'Quán thấy "Hoàn thành". Shipper thấy đơn trong "Lịch sử".'),
    ('Shipper mở "Ví của tôi".', 'Tổng số dư = B0 - hoa hồng; đúng MỘT dòng "Hoa hồng" mới.'),
  ],
  restore='Không cần (đơn đã hoàn thành). Nếu dừng giữa chừng: quán "Hủy yêu cầu giao" (trước lấy hàng).',
  ref=OWNER + ' mục III; ' + M07SHOP + '; ' + M07SHIP,
  auto='tests/integration/m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-004', ngay=3, seq=43, ten='Quán gọi shipper (DIRECT) - KHÁCH trả phí (khách không có tài khoản 11Food) - giao thành công',
  muc_dich='Khi người nhận không dùng 11Food nhưng là người trả phí, mức phí theo bảng giá vẫn đi tiếp bình thường; shipper thấy "Khách trả ship".',
  prio='P1', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-003',
  pre='Như TC-FLOW-003.',
  data='Như TC-FLOW-003 nhưng chọn "Khách trả" và "Theo bảng giá".',
  steps=[
    ('Chủ quán tạo yêu cầu giao DIRECT với "Khách trả", "Theo bảng giá" + mốc, chạm "Gọi shipper".', 'Tạo thành công; hiện "Khách trả ship". Không yêu cầu ai xác nhận thêm vì phí đúng bảng giá.'),
    ('Shipper mở "Có thể nhận".', 'Thẻ hiện "Khách trả ship" và nút "Nhận đơn" bấm được.'),
    ('Shipper nhận, lấy hàng, giao thành công.', 'Các trạng thái chuyển đúng như TC-FLOW-003; hoa hồng thu một lần.'),
  ],
  restore='Không cần.', ref=OWNER + ' mục III.5; ' + M07SHOP,
  auto='tests/integration/m07-delivery.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts')

T('TC-FLOW-005', ngay=4, seq=10, ten='Không có shipper nhận: sau 30 phút hệ thống ngừng tìm, đơn món không bị hủy',
  muc_dich='Đơn không ai nhận thì dừng tìm và báo quán, khách; quán quyết định gọi lại hay hủy; đơn món chưa tự hủy ở mốc này.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-SHOP-022',
  note='Mặc định dừng tìm sau 30 phút. Để rút ngắn: SYSTEM vào Web Admin > "Thời hạn xử lý đơn" đặt "Chờ shipper: dừng tìm / cảnh báo (phút)" nhỏ (ví dụ 3) và "Chờ shipper: tự hủy đơn sau (phút)" lớn hơn (ví dụ 10) - xong test PHẢI đặt lại 30/60. Giai đoạn đang chạy giữ cấu hình lúc bắt đầu, nên đặt TRƯỚC khi gọi shipper.',
  pre='Đơn đã được quán xác nhận ("Đang chuẩn bị"). TẤT CẢ shipper đang OFFLINE (SP-A tắt online). Ghi giờ bắt đầu.',
  steps=shop_call_shipper(payer_button='Quán trả phí') + [
    ('Khách và quán mở chi tiết đơn, ghi giờ. Chờ đến khoảng phút thứ 5 và 15 (nếu dùng thời gian mặc định) rồi mở hộp "Thông báo" của quán.', 'Quán nhận nhắc "đang tìm shipper" ở phút 5 và phút 15 (nếu dùng cấu hình rút ngắn thì các mốc nhắc tương ứng).'),
    ('Chờ đến mốc dừng tìm (30 phút hoặc mốc đã rút ngắn).', 'Yêu cầu giao chuyển "Đã ngừng tìm shipper". Quán thấy "Chưa tìm được shipper - Đơn món vẫn còn. Bạn có thể gọi lại shipper hoặc hủy đơn món." Khách thấy "Chưa tìm được shipper — quán đang xử lý."'),
    ('Kiểm tra trạng thái đơn món.', 'Đơn món KHÔNG bị hủy: vẫn "Đang chuẩn bị" (hoặc hiển thị chưa tìm được shipper).'),
    ('Bật online SP-A rồi mở "Có thể nhận".', 'Không thấy đơn đã ngừng tìm.'),
  ],
  restore='Đặt lại cấu hình thời hạn về 30/60 phút (nếu đã sửa). Quán "Hủy đơn món" hoặc làm tiếp TC-FLOW-006.',
  ref='docs/current/M10-timeouts-20261021.md; docs/current/M07-implementation-20261018.md mục 4; apps/backend/src/delivery (sweeper)',
  auto='tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts', sev='Cao')

T('TC-FLOW-006', ngay=4, seq=11, ten='Sau khi ngừng tìm, quán gọi lại shipper và có người nhận',
  muc_dich='Quán bấm "Gọi lại shipper" để tạo lần tìm mới; lần tìm cũ vẫn nằm trong lịch sử.',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-005',
  pre='Đơn món ở trạng thái "Chưa tìm được shipper" (kết quả TC-FLOW-005). SP-A đủ điều kiện, sẽ online ở bước 2.',
  steps=[
    ('Chủ quán mở đơn, chạm "Gọi lại shipper", chọn người trả phí.', 'Tạo lần tìm mới: "Lần gọi shipper thứ 2", trạng thái "Đang tìm shipper"; lần gọi trước vẫn hiện trong lịch sử gọi. Chỉ một yêu cầu giao đang hoạt động.'),
    ('SP-A bật online, mở "Có thể nhận", chạm "Nhận đơn".', 'Nhận được đơn (chỉ một thẻ, không trùng).'),
    ('Trên Điện thoại 3 mở đơn trong "Đang thực hiện", chạm "Đã nhận hàng" và xác nhận; sau đó chạm "Giao thành công" và xác nhận trong hộp thoại.', 'Đơn hoàn thành đúng một lần.'),
  ],
  restore=R_ORDER, ref='mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (Gọi lại shipper); apps/backend/src/orders/order-delivery-adapter.ts',
  auto='tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts')

T('TC-FLOW-007', ngay=4, seq=12, ten='Đơn khách đặt, QUÁN trả phí: shipper đề xuất phí mới và quán ĐỒNG Ý',
  muc_dich='Shipper không đồng ý phí theo bảng, đề xuất phí khác; người trả phí (quán) đồng ý thì phí của đơn đổi và shipper tiếp tục.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  data='Shipper đề xuất mức phí cao hơn phí bảng 5.000đ (ví dụ phí bảng 15.000đ thì đề xuất 20000).',
  pre='Quán đã gọi shipper cho một đơn ORDER với "Quán trả phí" (làm các bước 1-3 của TC-FLOW-001 xong tới "Đang tìm shipper"). SP-A online đủ điều kiện.',
  steps=[
    ('Shipper: "Đơn hàng" > "Có thể nhận", trên thẻ đơn chạm "Đề xuất mức phí khác", nhập mức phí đề xuất, chạm "Gửi đề xuất".', 'Hiện "Bạn đã đề xuất … (phí hiện tại …), đang chờ Quán (người trả phí) trả lời." Đơn được giữ cho riêng shipper này trong lúc chờ (shipper khác không nhận được).'),
    ('Quán mở đơn.', 'Hiện thẻ "Shipper đề xuất đổi phí giao" với mức đề xuất, mức hiện tại, hạn trả lời, nút "Đồng ý" và "Từ chối".'),
    ('Khách mở đơn.', 'Khách chỉ được báo tiến độ (không phải người quyết định vì quán trả phí).'),
    ('Quán chạm "Đồng ý".', 'Phí của đơn đổi đúng bằng mức đề xuất; thẻ đề xuất biến mất.'),
    ('Shipper kiểm tra thẻ đơn.', 'Phí giao đã là mức mới; nút "Nhận đơn" bấm được. Chạm "Nhận đơn".'),
    ('Trên Điện thoại 3 chạm "Đã nhận hàng" và xác nhận; sau đó chạm "Giao thành công" và xác nhận trong hộp thoại.', 'Hoàn thành; phí giao hiển thị ở khách/quán/shipper đều bằng mức đã đồng ý; hoa hồng thu một lần.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu phí cuối cùng khác mức đã đồng ý, hoặc hai shipper cùng nhận.',
  restore=R_ORDER, ref=OWNER + ' mục II (nhánh đề xuất phí), Addendum 2026-10-24; ' + M07SHOP + ' (Shipper đề xuất đổi phí giao)',
  auto='tests/integration/m07-delivery.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-008', ngay=4, seq=13, ten='Đơn khách đặt, QUÁN trả phí: quán TỪ CHỐI đề xuất phí của shipper',
  muc_dich='Từ chối thì giữ phí cũ, shipper đề xuất không còn giữ đơn, đơn tiếp tục tìm shipper khác, KHÔNG hủy đơn món và KHÔNG tính lại 30 phút.',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-007',
  pre='Như bước 1-2 của TC-FLOW-007: SP-A đã gửi đề xuất, quán đang thấy thẻ "Shipper đề xuất đổi phí giao".',
  steps=[
    ('Quán chạm "Từ chối" (và xác nhận nếu có hộp thoại).', 'Thẻ đề xuất biến mất; phí đơn vẫn là mức cũ; đơn vẫn "Đang tìm shipper".'),
    ('Shipper kiểm tra.', 'Thẻ đơn không còn do SP-A giữ; hiện ở lịch sử "Phí không được đồng ý". SP-A nhận được thông báo kết quả bị từ chối.'),
    ('Kiểm tra đồng hồ tìm shipper của đơn.', 'Thời gian tìm KHÔNG được tính lại (vẫn đếm theo lần gọi ban đầu).'),
    ('Một shipper khác (SP-B đã nạp tiền, hoặc SP-A) nhận lại đơn ở mức phí cũ.', 'Nhận được với phí cũ.'),
  ],
  restore=R_ORDER, ref=OWNER + ' Addendum (2) mục 1; ' + DELIV + '/delivery-handback.ts',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='Cao')

T('TC-FLOW-009', ngay=4, seq=14, ten='Đơn khách đặt, KHÁCH trả phí: khách ĐỒNG Ý đề xuất phí trong 11Food',
  muc_dich='Người trả phí là khách thì khách (không phải quán) quyết định đề xuất phí của shipper, ngay trong 11Food.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-002',
  data='Shipper đề xuất phí cao hơn bảng 5.000đ.',
  pre='Quán đã gọi shipper cho đơn ORDER với "Khách trả phí" (đang "Đang tìm shipper"). SP-A online.',
  steps=[
    ('Shipper chạm "Đề xuất mức phí khác" trên thẻ đơn, nhập mức, "Gửi đề xuất".', 'Hiện "đang chờ Khách (người trả phí) trả lời."'),
    ('Khách mở chi tiết đơn.', 'Hiện thẻ "Shipper muốn lấy phí giao … " / "Phí giao … đang chờ bạn đồng ý" với nút "Đồng ý" và "Từ chối", và nội dung "Bạn là người trả phí nên cần bạn đồng ý để shipper nhận đơn."'),
    ('Quán mở đơn.', 'Quán KHÔNG có nút trả lời (chỉ thông báo chờ khách); nếu cố thao tác sẽ bị từ chối.'),
    ('Khách chạm "Đồng ý".', 'Phí đơn đổi theo mức đề xuất. Shipper nhận được thông báo và nhận đơn được.'),
    ('Trên Điện thoại 3 chạm "Đã nhận hàng" và xác nhận; sau đó chạm "Giao thành công" và xác nhận trong hộp thoại.', 'Hoàn thành, phí hiển thị mức đã đồng ý ở cả ba bên.'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục VII (decision khách trong 11Food, customers/me/orders/:id/delivery/fee); ' + 'mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (fee-accept)',
  auto='tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-010', ngay=4, seq=15, ten='Đơn khách đặt, KHÁCH trả phí: khách TỪ CHỐI đề xuất phí',
  muc_dich='Khách từ chối thì giữ phí cũ, shipper bị gỡ khỏi đơn, đơn tìm shipper khác, đơn món vẫn còn.',
  prio='P0', actor='Khách + Shipper', dev=('P1', 'P3'), phones=2, deps='TC-FLOW-009',
  pre='Như bước 1-2 của TC-FLOW-009.',
  steps=[
    ('Khách chạm "Từ chối".', 'Thẻ biến mất; khách vẫn thấy đơn "Đang tìm shipper". Dòng giải thích: "Nếu từ chối, đơn món vẫn giữ nguyên, phí giữ mức cũ và hệ thống tìm shipper khác."'),
    ('Shipper kiểm tra.', 'SP-A không còn giữ đơn; lịch sử ghi "Phí không được đồng ý".'),
    ('Khách xem lại đơn món.', 'Đơn món KHÔNG bị hủy.'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục II, VII', auto='tests/integration/m10-orders.int.spec.ts')

T('TC-FLOW-011', ngay=4, seq=16, ten='Quán không được trả lời thay khi KHÁCH là người trả phí của đơn khách đặt',
  muc_dich='Quyền quyết định thuộc đúng người trả phí; quán không thể chấp nhận tiền phát sinh thay khách của đơn đặt qua 11Food.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-FLOW-009',
  pre='Đề xuất phí của shipper đang chờ KHÁCH trả lời (bước 1 của TC-FLOW-009).',
  steps=[
    ('Quán mở đơn, tìm nút "Đồng ý"/"Từ chối" cho đề xuất phí.', 'KHÔNG có nút trả lời; quán chỉ thấy dòng "Khách là người trả phí nên khách quyết định mức này trong 11Food. Bạn chỉ cần chờ."'),
    ('[CHỈ KỸ THUẬT VIÊN - người mới bỏ qua] Kỹ thuật viên thử gửi lệnh "quán trả lời thay khách" tới máy chủ.', 'Máy chủ từ chối thao tác (kỹ thuật viên ghi mã lỗi vào Ghi chú kết quả). Bước này CHỈ do kỹ thuật viên làm; người mới bỏ qua và ghi "bỏ qua bước 2".'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục VII dòng "Phí shipper đề xuất"; ' + M07SHOP,
  auto='tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts', sev='Cao')

T('TC-FLOW-012', ngay=4, seq=17, ten='Đề xuất phí quá hạn trả lời: giữ phí cũ, shipper bị gỡ, không hủy đơn',
  muc_dich='Nếu người trả phí không trả lời kịp (mặc định 5 phút) thì đề xuất tự hết hạn.',
  prio='P1', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-007',
  note='Thời gian trả lời mặc định 5 phút (SYSTEM chỉnh ở Web Admin > Hệ thống > "Cấu hình tập trung", dòng "Thời gian trả lời đề xuất phí"; tối thiểu 1 phút). Hạn trả lời không bao giờ vượt hạn tìm shipper.',
  pre='SP-A gửi đề xuất phí, quán KHÔNG trả lời. Ghi giờ gửi.',
  steps=[
    ('Chờ quá thời gian trả lời (5 phút).', 'Thẻ đề xuất biến mất khỏi màn quán; phí vẫn mức cũ.'),
    ('Quán thử bấm "Đồng ý" ở thẻ cũ nếu còn hiện (làm mới màn hình trước).', 'Không cho trả lời muộn: báo đề xuất đã hết hạn (ví dụ chữ "Đã hết hạn").'),
    ('Shipper kiểm tra.', 'Không còn giữ đơn; lịch sử "Phí không được đồng ý"/hết hạn; đơn tiếp tục tìm shipper.'),
  ],
  restore=R_ORDER + ' Nếu đã sửa cấu hình thời gian trả lời, đặt lại 5 phút.',
  ref=OWNER + ' Addendum 2026-10-24 mục 1-3; apps/admin-web/src/core/config.ts (fee_answer_minutes)',
  auto='tests/integration/m07-delivery.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts')

T('TC-FLOW-013', ngay=4, seq=18, ten='Quán gọi shipper (DIRECT), QUÁN trả phí: shipper đề xuất, quán đồng ý rồi từ chối',
  muc_dich='Nhánh thương lượng của luồng quán chủ động gọi. Đồng ý đổi phí; từ chối giữ phí cũ và tìm shipper khác nhưng KHÔNG hủy yêu cầu giao.',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-003',
  data='Lần 1: shipper đề xuất 25000, quán ĐỒNG Ý. Lần 2 (đơn khác): shipper đề xuất 40000, quán TỪ CHỐI.',
  pre='Quán tạo yêu cầu giao DIRECT, "Quán trả", "Theo bảng giá" + mốc (phí P). SP-A online.',
  steps=[
    ('SP-A đề xuất 25000 ở thẻ đơn.', 'Hiện "đang chờ Quán (người trả phí) trả lời."'),
    ('Quán mở yêu cầu giao.', 'Thấy "Shipper đề xuất đổi phí giao" 25.000đ với "Đồng ý"/"Từ chối".'),
    ('Quán chạm "Đồng ý".', 'Phí đổi thành 25.000đ; SP-A nhận được và có thể "Nhận đơn".'),
    ('Tạo yêu cầu giao DIRECT mới và để SP-A đề xuất 40000; quán chạm "Từ chối".', 'Phí giữ như ban đầu; yêu cầu giao KHÔNG bị hủy ("Đang tìm shipper"); SP-A không còn giữ.'),
    ('Quán hủy yêu cầu giao thử của lần 2 ("Hủy yêu cầu giao").', 'Yêu cầu giao thử của lần 2 chuyển sang "Đã hủy"; không còn yêu cầu giao nào đang mở (đã dọn dữ liệu).'),
  ],
  restore='Đã hủy yêu cầu thử ở bước 5.', ref=OWNER + ' mục III.4',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='Cao')

T('TC-FLOW-014', ngay=4, seq=19, ten='Quán gọi shipper (DIRECT), KHÁCH trả phí nhưng không có tài khoản: quán xác nhận thay khách',
  muc_dich='Khi khách không dùng 11Food, quán liên hệ khách ngoài ứng dụng rồi xác nhận thay; hệ thống ghi rõ là "quán xác nhận thay khách".',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-004',
  pre='Yêu cầu giao DIRECT với "Khách trả" đang tìm shipper; SP-A online.',
  steps=[
    ('Trên Điện thoại 3, SP-A mở thẻ đơn vừa tạo, chạm "Đề xuất mức khác", nhập 40000 và gửi.', 'Đề xuất được gửi đi; thẻ đơn của SP-A hiện đang chờ phản hồi.'),
    ('Quán mở yêu cầu giao.', 'Thấy nội dung "Khách trả ship: hãy liên hệ khách trước. Bấm Đồng ý nghĩa là quán xác nhận thay khách, hệ thống sẽ ghi lại như vậy." cùng "Đồng ý"/"Từ chối".'),
    ('Quán gọi điện cho người nhận (người trong nhóm test) để xin đồng ý, rồi chạm "Đồng ý".', 'Phí đổi; trong lịch sử/diễn biến của yêu cầu ghi nhận do quán xác nhận thay khách.'),
    ('Làm lại với đề xuất khác và chạm "Từ chối".', 'Phí giữ nguyên; shipper không còn giữ đơn; yêu cầu vẫn tìm shipper khác.'),
  ],
  restore='Hủy yêu cầu giao thử.', ref=OWNER + ' mục III.5, VII; m07_shop_views.dart (quán xác nhận thay khách)',
  auto='tests/integration/m07-delivery.int.spec.ts')

T('TC-FLOW-015', ngay=4, seq=20, ten='Shipper đề xuất phí SAU khi nhận đơn, trước khi lấy hàng: chưa lấy hàng được cho đến khi có trả lời',
  muc_dich='Phí hiện hành không đổi khi chờ; trong lúc chờ shipper chưa bấm được "Đã nhận hàng"; sau lấy hàng thì khóa.',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-DRV-009',
  pre='SP-A đã nhận một đơn (phí theo bảng), chưa lấy hàng.',
  steps=[
    ('Shipper mở chi tiết đơn, chạm "Đề xuất mức phí khác", nhập mức, "Gửi đề xuất".', 'Hiện "Đang chờ trả lời mức phí" và "Bạn đã đề xuất … Chưa nhận hàng được cho đến khi … đồng ý. Nếu không được đồng ý hoặc quá hạn, bạn không còn giữ đơn này và đơn tiếp tục tìm shipper khác."'),
    ('Shipper thử tìm nút "Đã nhận hàng".', 'KHÔNG bấm được/không có nút trong lúc chờ.'),
    ('Quán chạm "Từ chối" đề xuất.', 'Shipper không còn giữ đơn (kết thúc lượt nhận), hoa hồng được giải phóng, đơn tìm shipper khác với phí cũ.'),
    ('Làm lại bước 1 với đơn khác và để quán "Đồng ý"; shipper bấm "Đã nhận hàng" rồi xác nhận.', 'Phí chốt theo mức mới; sau "Đã nhận hàng" nút đề xuất phí biến mất ("Phí đã khóa").'),
  ],
  restore=R_ORDER, ref=OWNER + ' Addendum (2) mục 2; ' + M07SHIP + ' (m07-propose-fee, "Chưa nhận hàng được cho đến khi")',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='Cao')

T('TC-FLOW-016', ngay=4, seq=21, ten='Shipper bỏ lượt nhận (hủy nhận) rồi shipper khác nhận; đồng hồ tìm không bị tính lại',
  muc_dich='Hủy nhận chỉ kết thúc lượt nhận của shipper đó; đơn và đồng hồ tìm tiếp tục; hoa hồng giải phóng đúng một lần.',
  prio='P0', actor='Hai shipper + Quán', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-DRV-012, TC-WAL-005',
  pre='Một đơn đang tìm shipper. SP-A và SP-B đều đủ tiền, online. Ghi số dư khả dụng của SP-A và SP-B.',
  steps=[
    ('SP-A nhận đơn.', 'SP-A giữ đơn; hoa hồng tạm giữ.'),
    ('SP-A chạm "Hủy nhận đơn", chọn lý do, "Xác nhận hủy".', 'Đơn quay lại "Đang tìm shipper"; SP-A thấy "Bạn đã hủy nhận"; hoa hồng của SP-A được giải phóng (khả dụng trở lại).'),
    ('Kiểm tra: SP-A có tự thấy lại đơn vừa bỏ không?', 'Người vừa hủy nhận KHÔNG bị báo đơn đó lại ngay (không nhận lại ngay lập tức).'),
    ('SP-B mở "Có thể nhận" và nhận đơn.', 'SP-B nhận được; hoa hồng của SP-B tạm giữ; quán thấy tên SP-B.'),
    ('Quán kiểm tra đồng hồ tìm shipper của đơn.', 'Đồng hồ vẫn tính từ lần gọi ban đầu (không đặt lại 30 phút).'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục I và Addendum (2) mục 1; docs/current/M07-implementation-20261018.md mục 4',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='Cao')

T('TC-FLOW-017', ngay=4, seq=22, ten='Quán hủy yêu cầu giao khi shipper đã nhận nhưng chưa lấy hàng (đơn ORDER vẫn còn)',
  muc_dich='Hủy yêu cầu giao chỉ dừng việc giao, không hủy đơn món; shipper được giải phóng; có thể gọi lại.',
  prio='P0', actor='Chủ quán + Shipper + Khách', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  data='Lý do hủy: "Gọi nhầm (TEST)".',
  pre='Đơn ORDER ở trạng thái shipper (SP-A) đã nhận, CHƯA lấy hàng.',
  steps=[
    ('Quán mở phần giao hàng của đơn, chạm "Hủy yêu cầu giao", nhập lý do, "Xác nhận hủy".', 'Yêu cầu giao chuyển "Đã hủy yêu cầu giao". Đơn món vẫn "Đang chuẩn bị" (không bị hủy).'),
    ('Shipper kiểm tra.', 'Đơn rời "Đang thực hiện"; lịch sử ghi "Quán đã hủy yêu cầu giao". Hoa hồng tạm giữ được giải phóng.'),
    ('Khách mở đơn.', 'Đơn vẫn còn; cập nhật trạng thái phù hợp (quán đang xử lý).'),
    ('Quán chạm "Gọi lại shipper".', 'Tạo lần gọi mới; không bị chặn (vì hàng chưa rời quán).'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục I; ' + DELIV + '/delivery-cancel.ts',
  auto='tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts', sev='Cao')

T('TC-FLOW-018', ngay=4, seq=23, ten='Quán hủy đơn món khi shipper đã nhận nhưng chưa lấy hàng',
  muc_dich='Hủy đơn món thì cả yêu cầu giao kết thúc, hoa hồng giải phóng, mọi bên được báo.',
  prio='P0', actor='Chủ quán + Shipper + Khách', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  data='Lý do: "Quán hết món (TEST)".',
  pre='Đơn ORDER, SP-A đã nhận, chưa lấy hàng. Ghi khả dụng của SP-A.',
  steps=[
    ('Quán mở đơn, chạm "Hủy đơn món". Đọc hộp thoại.', 'Hộp "Hủy đơn món?" nói rõ đơn món và yêu cầu giao đang chờ lấy sẽ cùng kết thúc, hoa hồng shipper được giải phóng.'),
    ('Nhập lý do, xác nhận.', 'Đơn món "Đã hủy".'),
    ('Shipper kiểm tra.', 'Đơn không còn trong "Đang thực hiện"; thông báo báo đơn bị hủy; hoa hồng được giải phóng (khả dụng như cũ).'),
    ('Khách mở đơn.', 'Hiện "Đã hủy" cùng lý do của quán.'),
  ],
  restore='Không cần.', ref='docs/current/M10-implementation-20261018.md (hủy đơn món trước lấy hàng); ' + M07SHOP,
  auto='tests/integration/m10-orders.int.spec.ts', sev='Cao')

T('TC-FLOW-019', ngay=4, seq=24, ten='Khách hủy đơn SAU khi shipper đã lấy hàng (đơn ORDER)',
  muc_dich='Quyền hủy sau lấy hàng thuộc người tạo đơn (khách). Hủy phải có lý do; hoa hồng giải phóng (không thu); hàng ở shipper cho đến khi quán xác nhận.',
  prio='P0', actor='Khách + Shipper + Chủ quán', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  data='Lý do hủy: "Khách không nhận được (TEST)".',
  pre='Đơn ORDER: SP-A đã bấm "Đã nhận hàng" (đang "Đang giao"). Ghi tổng số dư B và khả dụng A của SP-A.',
  steps=[
    ('Khách mở chi tiết đơn, chạm "Hủy đơn (shipper đã lấy hàng)".', 'Hộp "Hủy đơn khi shipper đã lấy hàng?" nói "Shipper đã lấy món và đang giao. Nếu hủy bây giờ, đơn kết thúc và shipper sẽ gọi quán để trả lại món. Ứng dụng không tự hoàn tiền hay bồi thường." và yêu cầu "Lý do hủy".'),
    ('Nhập lý do, xác nhận.', 'Đơn của khách chuyển "Đã hủy". Không tự chuyển thành "Giao thành công".'),
    ('Quán mở đơn.', 'Thấy đơn đã hủy bởi khách; có hồ sơ xử lý hàng ("Hàng đang ở shipper hoặc chưa rõ") và chưa gọi lại shipper được.'),
    ('Shipper kiểm tra.', 'Đơn kết thúc, nhận thông báo hủy; ví: hoa hồng được giải phóng, KHÔNG bị trừ; Tổng số dư vẫn B.'),
    ('Quán thực hiện TC-SHOP-036 (xác nhận hàng đã về).', 'Hồ sơ hàng đóng.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu hoa hồng bị thu khi đơn bị hủy sau lấy hàng, hoặc đơn bị chuyển thành giao thành công.',
  restore='Không cần.', ref=OWNER + ' mục I, VII ("Hủy sau lấy hàng"); ' + 'mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (order-cancel-after-pickup)',
  auto='tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-020', ngay=4, seq=25, ten='Quán hủy yêu cầu giao (DIRECT) SAU khi shipper đã lấy hàng, rồi xử lý hàng',
  muc_dich='Với đơn do quán tạo, quán là người hủy sau lấy hàng; hoa hồng không thu; hàng chưa về quán thì chưa gọi lại được.',
  prio='P0', actor='Chủ quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-003',
  data='Lý do: "Người nhận từ chối nhận (TEST)".',
  pre='Yêu cầu giao DIRECT: SP-A đã "Đã nhận hàng" (đang "Đang giao"). Ghi B, A của SP-A.',
  steps=[
    ('Quán mở yêu cầu giao, chạm "Hủy giao (shipper đã lấy hàng)".', 'Hộp "Hủy giao khi shipper đã lấy hàng?" nói "Hủy bây giờ thì yêu cầu giao kết thúc, hoa hồng của shipper không bị thu, và hàng vẫn ở shipper cho tới khi bạn xác nhận đã nhận lại hoặc đã xử lý."'),
    ('Nhập lý do, "Xác nhận hủy".', 'Yêu cầu giao kết thúc "Đã hủy yêu cầu giao"; hiện "Hàng hiện ở: Hàng đang ở shipper hoặc chưa rõ".'),
    ('Quán thử gọi lại shipper.', 'Chưa gọi lại được cho đến khi xác nhận hàng đã về hoặc đã xử lý.'),
    ('Shipper kiểm tra.', 'Chỉ còn thông báo hủy; ví không bị trừ hoa hồng; có dòng hồ sơ hàng "Hồ sơ xử lý hàng đang mở…".'),
    ('Quán chạm "Xác nhận hàng đã về quán" (sau khi shipper trả hàng).', 'Hồ sơ đóng; gọi lại được.'),
  ],
  restore='Không cần.', ref=OWNER + ' mục III, VII; ' + M07SHOP + ' (Hủy giao khi shipper đã lấy hàng)',
  auto='tests/integration/m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-021', ngay=4, seq=26, ten='Chủ quán KHÔNG hủy được đơn khách đặt sau khi shipper đã lấy hàng',
  muc_dich='Quyền hủy sau lấy hàng của đơn ORDER thuộc khách, không thuộc quán; kiểm tra phía giao diện quán.',
  prio='P0', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-FLOW-001',
  pre='Đơn ORDER ở "Đang giao" (đã lấy hàng).',
  steps=[
    ('Quán mở đơn, tìm nút hủy.', 'KHÔNG có "Hủy đơn món" và không có "Hủy giao". Có banner "Shipper đã lấy hàng - Đơn này do khách đặt nên chỉ khách mới hủy được. Nếu shipper báo không giao được, hãy gọi khách và shipper để thống nhất."'),
    ('[CHỈ KỸ THUẬT VIÊN - người mới bỏ qua] Kỹ thuật viên thử gửi lệnh hủy sau lấy hàng của quán tới máy chủ.', 'Máy chủ từ chối lệnh (kỹ thuật viên ghi mã lỗi vào Ghi chú kết quả). Người mới bỏ qua, ghi "bỏ qua bước 2"; không ảnh hưởng PASS/FAIL.'),
  ],
  restore=R_ORDER, ref=OWNER + ' mục VII; ' + M07SHOP + '; mobile m10_shop_views.dart (order-delivering-note)',
  auto='tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts', sev='Cao')

T('TC-FLOW-022', ngay=4, seq=27, ten='Hàng sau khi đơn bị hủy: "Đã xử lý, không giao tiếp" và Admin đóng "Không hoàn tất"',
  muc_dich='Nếu hàng không thể trả về (đã xử lý) thì quán ghi nhận và đơn được đóng là "Không hoàn tất"; hệ thống không tự bồi thường hay hoàn tiền.',
  prio='P1', actor='Chủ quán + ADMIN', dev=('P2', 'PC'), phones=1, deps='TC-FLOW-019',
  pre='Đơn có hồ sơ xử lý hàng đang mở sau khi bị hủy lúc đã lấy hàng.',
  steps=[
    ('Quán mở yêu cầu giao, chạm "Đã xử lý, không giao tiếp" và xác nhận ("Đã xử lý, không giao tiếp?").', 'Hồ sơ hàng đóng với "Hàng hiện ở: Đã xử lý, không giao tiếp". Có chú thích "Hệ thống chỉ ghi nhận, không tự hoàn tiền hay bồi thường."'),
    ('Với đơn món: quán chạm "Đóng đơn "Không hoàn tất"" và nhập lý do.', 'Đơn chuyển "Không hoàn tất".'),
    ('Admin (có quyền duyệt) mở Web Admin > VẬN HÀNH > Đơn hàng, tìm đơn.', 'Thấy trạng thái "Không hoàn tất" và nhật ký thao tác.'),
  ],
  restore='Không cần.', ref=M07SHOP + ' (m07-custody-handled); m10_shop_views.dart (order-close); apps/admin-web/src/dom/orders-view.ts',
  auto='tests/integration/m10-orders.int.spec.ts; m10-admin-orders.int.spec.ts')

T('TC-FLOW-023', ngay=4, seq=28, ten='Thông báo đến đúng người, đúng đơn, đúng nội dung trong cả luồng',
  muc_dich='Mỗi sự kiện chỉ báo cho đúng bên liên quan; chạm thông báo mở đúng đơn; không lộ thông tin nhạy cảm trên màn hình khóa.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  note='Thông báo đẩy khi tắt màn hình cần Firebase đã cấu hình (xem TC-NOTI-001). Không có push thì kiểm bằng hộp thông báo trong ứng dụng.',
  pre='Cả ba điện thoại đăng nhập, bật thông báo. Chuẩn bị bảng ghi: sự kiện - ai phải nhận - ai KHÔNG được nhận.',
  steps=[
    ('Khách gửi đơn.', 'Quán nhận thông báo "đơn mới". Shipper KHÔNG nhận. (Khách: ghi nhận có hay không; tài liệu không bắt buộc.)'),
    ('Quán xác nhận đơn.', 'Khách nhận thông báo "quán xác nhận". Shipper KHÔNG nhận.'),
    ('Quán gọi shipper.', 'Shipper (đủ điều kiện, trong 3 km) nhận thông báo "có đơn giao hàng mới". Khách KHÔNG nhận thông báo dành riêng cho shipper (ghi nhận nếu khách nhận thông báo khác).'),
    ('Shipper nhận đơn.', 'Quán nhận thông báo "shipper đã nhận đơn, đang đến lấy". Khách: ghi nhận có/không nhận thông báo; khi mở đơn trạng thái phải là "Shipper đang đến quán".'),
    ('Shipper bấm "Đã nhận hàng".', 'Quán và khách nhận thông báo "shipper đã lấy hàng/đang giao" (hoặc ít nhất trạng thái đơn cập nhật đúng khi mở app).'),
    ('Shipper bấm "Giao thành công".', 'Quán và khách nhận thông báo "đã giao thành công" (hoặc ít nhất trạng thái cập nhật đúng); khách còn nhận nhắc đánh giá một lần.'),
    ('Chạm từng thông báo trên mỗi máy.', 'Mỗi thông báo mở ĐÚNG đơn đó (mã đơn khớp). Thông báo của đơn đã kết thúc mở ở dạng lịch sử ("Nội dung này đã kết thúc. Bạn đang xem ở lịch sử.").'),
    ('Nhìn nội dung thông báo hiện trên màn hình khóa (nếu có push).', 'Chỉ có mã giao hàng/nội dung ngắn, KHÔNG có số điện thoại, địa chỉ, ngân hàng hay mã OTP.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu thông báo gửi nhầm cho người không liên quan hoặc mở sai đơn.',
  restore=R_ORDER, ref='docs/current/M08-implementation-20261018.md mục 2 (nội dung push cố định); mobile m08_views.dart; food_tabs.dart (foodNotificationRouter)',
  auto='tests/integration/m08-notifications.int.spec.ts; m08-admin-notifications.int.spec.ts', sev='Cao')

T('TC-FLOW-024', ngay=4, seq=29, ten='Không tạo trùng đơn / trùng yêu cầu giao khi bấm nhiều lần',
  muc_dich='Bấm "Gửi đơn" hoặc "Gọi shipper" nhiều lần liên tiếp chỉ tạo đúng một đơn/một yêu cầu.',
  prio='P0', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-025',
  pre='Giỏ khách có món, đang ở màn "Xác nhận đơn". Một đơn đã xác nhận sẵn ở quán để thử "Gọi shipper".',
  steps=[
    ('Khách bấm "Gửi đơn" 5-6 lần thật nhanh liên tiếp.', 'Ứng dụng chỉ gửi một lần (nút chuyển trạng thái chờ). Trong "Đang xử lý" chỉ có MỘT đơn mới. Quán cũng chỉ thấy MỘT đơn.'),
    ('Quán bấm "Gọi shipper" rồi chọn người trả phí; ngay sau đó bấm lặp nút trong hộp thoại nhiều lần.', 'Chỉ tạo MỘT yêu cầu giao ("Lần gọi shipper thứ 1"). Không có yêu cầu thứ hai.'),
    ('Đóng và mở lại cả hai ứng dụng.', 'Vẫn chỉ MỘT đơn và MỘT yêu cầu giao.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu có hai đơn/hai yêu cầu giao.',
  restore=R_ORDER, ref='docs/current/M10-implementation-20261018.md mục 2 (client_ref + Idempotency-Key); mobile m10/m07 sources (act/idempotency)',
  auto='tests/integration/m10-orders.int.spec.ts; idempotency-executor.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-025', ngay=4, seq=30, ten='Mất mạng đúng lúc khách gửi đơn: ứng dụng báo "chưa biết đơn đã gửi chưa" và không tạo đơn thứ hai',
  muc_dich='Khi không chắc đơn đã gửi, ứng dụng phải cho khách kiểm tra kết quả thay vì gửi lại mù quáng.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-025',
  note='Khó tái hiện chính xác thời điểm mất mạng. Thử vài lần: bật Chế độ máy bay ngay sau khi bấm "Gửi đơn". Kết quả có thể là "đơn đã gửi" hoặc "chưa gửi" - cả hai đều đúng nếu ứng dụng nói đúng sự thật; điều không được phép là tạo hai đơn.',
  pre='Giỏ có món, ở màn "Xác nhận đơn".',
  steps=[
    ('Bấm "Gửi đơn" rồi bật ngay Chế độ máy bay.', 'Ứng dụng báo "Chưa biết đơn đã gửi chưa" / "Mất kết nối khi gửi. Đơn có thể đã được tạo. Hãy kiểm tra kết quả trước khi gửi lại để không bị đặt hai lần." với nút "Kiểm tra kết quả" và "Gửi lại". (Nếu app báo "Chưa gửi được đơn" ngay, ghi lại và thử lại.)'),
    ('Tắt Chế độ máy bay, chạm "Kiểm tra kết quả".', 'Ứng dụng cho biết đơn đã tạo hay chưa dựa trên máy chủ.'),
    ('Nếu báo chưa tạo: chạm "Gửi lại". Sau đó đếm số đơn trong "Đang xử lý".', 'Tổng cộng đúng MỘT đơn cho lần đặt này.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu có hai đơn cho cùng một lần đặt.',
  restore=R_ORDER, ref='mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (checkout-lookup, checkout-resend); docs/current/M10-implementation-20261018.md (lookup client_ref)',
  auto='tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart', sev='NGHIÊM TRỌNG')

T('TC-FLOW-026', ngay=4, seq=31, ten='Hoa hồng của shipper: giữ chỗ khi nhận, trả lại khi hủy, thu đúng một lần khi hoàn thành',
  muc_dich='Kiểm tra bằng số liệu thật rằng tiền ví shipper luôn khớp với các biến cố nhận/hủy/hoàn thành.',
  prio='P0', actor='Shipper + Quán', dev=('P2', 'P3'), phones=2, deps='TC-WAL-005',
  data='Dùng 3 đơn DIRECT liên tiếp: (1) nhận rồi hủy nhận, (2) nhận rồi quán hủy trước lấy hàng, (3) nhận, lấy hàng, giao thành công.',
  pre='SP-A online đủ tiền. Ghi Tổng số dư B0 và khả dụng A0. Hoa hồng đang áp dụng = H (mặc định 1.000đ).',
  steps=[
    ('Đơn 1: SP-A nhận, xem ví; sau đó SP-A "Hủy nhận đơn".', 'Sau khi nhận: khả dụng = A0 - H, tổng B0. Sau khi hủy nhận: khả dụng = A0, tổng B0.'),
    ('Đơn 2: SP-A nhận; quán "Hủy yêu cầu giao".', 'Sau khi quán hủy: khả dụng = A0, tổng B0 (hoa hồng giải phóng, không thu).'),
    ('Đơn 3: SP-A nhận, "Đã nhận hàng", "Giao thành công".', 'Cuối cùng: tổng = B0 - H; khả dụng = A0 - H; đúng MỘT dòng "Hoa hồng" cho đơn 3 và KHÔNG có dòng hoa hồng cho đơn 1, 2.'),
    ('Mở "Lịch sử giao dịch" và cộng/trừ lại các dòng.', 'Tổng số dư hiện tại = B0 + các dòng nạp - các dòng hoa hồng. Khớp đến từng đồng.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG với bất kỳ sai lệch số dư nào (kể cả 1đ).',
  restore='Không cần (tiền đã hạch toán đúng).', ref='docs/current/ADR-004-driver-wallet-consistency.md; ' + OWNER + ' mục I',
  auto='tests/integration/m04-wallet-holds.int.spec.ts; m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-FLOW-027', ngay=4, seq=32, ten='Đơn hẹn giờ chạy trọn luồng: đặt, quán xác nhận, gọi shipper, giao',
  muc_dich='Đơn hẹn vẫn đi qua đủ các bước và không bị tự hủy vì chờ quán xác nhận (đơn hẹn không áp thời hạn chờ xác nhận mới).',
  prio='P1', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-CUS-029',
  pre='Đơn hẹn giờ cách hiện tại ~40 phút đã được khách đặt (TC-CUS-029).',
  steps=[
    ('Quán xác nhận đơn hẹn ngay.', 'Đơn "Đang chuẩn bị" nhưng vẫn là "Đơn hẹn".'),
    ('Đến sát giờ hẹn, quán gọi shipper.', 'Tạo yêu cầu giao bình thường.'),
    ('Shipper nhận, lấy hàng, giao.', 'Hoàn thành; khách thấy đơn trong "Lịch sử".'),
  ],
  restore=R_ORDER, ref='docs/current/M10-timeouts-20261021.md ("Đơn hẹn không áp timeout chờ xác nhận mới")',
  auto='tests/integration/m10-orders.int.spec.ts')

T('TC-FLOW-028', ngay=4, seq=33, ten='Đơn ORDER chưa tính được phí giao (thiếu ghim/tuyến): quán phải đề xuất phí để gọi được shipper',
  muc_dich='Không có đơn "không ai nhận được": nếu phí chưa tính được, hệ thống yêu cầu quán đề xuất phí.',
  prio='P1', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-CUS-021',
  data='Khách đặt đơn với địa chỉ KHÔNG ghim vị trí. Quán đề xuất phí 25000, lý do chọn một lý do trong danh sách.',
  pre='Quán Test A mở. Khách đặt đơn bằng địa chỉ không có ghim; quán xác nhận.',
  steps=[
    ('Quán chạm "Gọi shipper" và chọn người trả phí.', 'Hệ thống KHÔNG tạo yêu cầu giao ngay mà mở màn "Đề xuất phí giao" kèm lời "Hệ thống chưa tính được phí giao tự động cho đơn này. Hãy đề xuất một mức phí; shipper đồng ý hoặc đề xuất mức khác, và người trả phí quyết định."'),
    ('Nhập mức 25000, chọn lý do, gửi.', 'Tạo yêu cầu giao với phí thỏa thuận 25.000đ ("Đang tìm shipper"). Nếu khách là người trả phí và mức khác bảng giá, có dòng "Khách trả phí: mức khác bảng giá cần khách đồng ý trong ứng dụng 11Food."'),
    ('Shipper xem thẻ đơn.', 'Thấy "Phí đề xuất 25.000đ" với "Đồng ý", "Đề xuất mức khác", "Bỏ qua".'),
    ('Hoàn tất theo các luồng thương lượng ở trên.', 'Đi được đến hoàn thành; phí hiển thị đúng.'),
  ],
  restore=R_ORDER, ref='mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (_callWith, FEE_REQUIRED); ' + OWNER + ' mục VII',
  auto='tests/integration/m10-orders.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts')

T('TC-FLOW-029', ngay=4, seq=34, ten='SYSTEM tự hủy đơn: chờ quán quá lâu và chờ shipper quá lâu',
  muc_dich='Đơn bị bỏ quên không để vô hạn: hệ thống nhắc rồi tự hủy, báo đúng người, hoa hồng giải phóng.',
  prio='P1', actor='Khách + Chủ quán + SYSTEM', dev=('P1', 'P2', 'PC'), phones=2, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Mặc định: chờ quán nhắc ở phút 15, 20, 25 và hủy ở phút 30; chờ shipper dừng tìm phút 30, hủy phút 60; đã nhận chưa lấy hàng cảnh báo phút 30, hủy phút 60. Để thử nhanh SYSTEM rút ngắn các mốc ở Web Admin > HỆ THỐNG > "Thời hạn xử lý đơn" (giá trị 1-1440 phút, mốc nhắc phải trước mốc hủy) rồi đặt lại. Không tự hủy đơn đã lấy hàng.',
  pre='SYSTEM đã đặt "Chờ quán: tự hủy sau (phút)" = 6, "Chờ quán: bắt đầu nhắc" = 2, "nhắc lại mỗi" = 2 (ví dụ). Ghi giờ.',
  steps=[
    ('Khách gửi một đơn mới, quán KHÔNG xác nhận.', 'Đơn "Chờ quán xác nhận".'),
    ('Chờ đến mốc nhắc.', 'Quán nhận các thông báo nhắc xác nhận đơn.'),
    ('Chờ quá mốc tự hủy.', 'Đơn chuyển "Hệ thống hủy quá hạn"; khách nhận thông báo; quán thấy đơn đã hủy.'),
    ('Kiểm tra đơn trong Web Admin > Đơn hàng.', 'Trạng thái hủy do hệ thống (SYSTEM), có nhật ký.'),
    ('Đặt lại các thời hạn về mặc định.', 'Giá trị về 15/5/30, 30/60, 30/60.'),
  ],
  restore='Đặt lại thời hạn mặc định.', ref='docs/current/M10-timeouts-20261021.md; apps/admin-web/src/dom/order-timeouts-page.ts',
  auto='tests/integration/m10-orders.int.spec.ts (timeouts); admin tests', sev='Cao')

T('TC-FLOW-030', ngay=4, seq=35, ten='Shipper đang giữ một đơn nhận thêm đơn thứ hai (giới hạn số đơn cùng lúc)',
  muc_dich='Ghi nhận giới hạn số đơn mỗi shipper được giữ cùng lúc (mặc định 3 đơn cho shipper ngoài) và quy tắc ghép đơn.',
  prio='P2', actor='Shipper + Chủ quán', dev=('P2', 'P3'), phones=2, ready='CẦN XÁC MINH',
  note='Quy tắc ghép đơn phụ thuộc dịch vụ tính tuyến và cấu hình ("Số đơn tối đa shipper ngoài giữ cùng lúc", "Chậm tối đa khi ghép đơn"). Kết quả mong đợi chính xác cần Người phụ trách xác nhận trước khi chạy.',
  pre='SP-A đang giữ một đơn đã nhận. Quán tạo thêm một yêu cầu giao DIRECT.',
  steps=[
    ('Shipper mở "Có thể nhận".', 'Ghi nhận: đơn thứ hai hiện hay không, nút "Nhận đơn" bấm được hay bị khóa kèm lý do (ví dụ đã đạt giới hạn hoặc ghép đơn làm chậm đơn đầu).'),
    ('Nếu nhận được đơn thứ hai, hoàn tất hai đơn lần lượt.', 'Hai đơn hoàn thành độc lập; hoa hồng thu mỗi đơn đúng một lần.'),
  ],
  restore=R_ORDER, ref='apps/admin-web/src/core/config.ts (external_max_deliveries); docs/current/M06-BC-eligibility-batching-20261017.md',
  auto='tests/integration/m06-shipping-eligibility.int.spec.ts')
