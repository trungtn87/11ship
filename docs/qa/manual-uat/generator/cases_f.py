# -*- coding: utf-8 -*-
from lib import *

OWNER = 'docs/current/M07-owner-delivery-flow-20261023.md'
M08V = 'mobile/packages/n11_shared/lib/src/m08/m08_views.dart'
M11V = 'mobile/packages/n11_shared/lib/src/m11'
HEALTH = 'mobile/packages/n11_shared/lib/src/errors.dart (healthCopy)'

# =====================================================================================================
# ABN - Bất thường
# =====================================================================================================

T('TC-ABN-001', ngay=4, seq=80, ten='Mất Internet khi đang xem quán và giỏ hàng (khách)',
  muc_dich='Khi mất mạng ứng dụng phải báo rõ, không hiển thị dữ liệu cũ như thể mới, và tự phục hồi khi có mạng.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-015',
  pre='KH-A đăng nhập, đang ở trang Quán Test A có giỏ hàng.',
  steps=[
    ('Bật Chế độ máy bay (hoặc tắt Wi-Fi và dữ liệu di động). Đợi 10-20 giây.', 'Xuất hiện thanh thông báo "Không có kết nối mạng - Vui lòng kiểm tra kết nối internet và thử lại." kèm nút "Thử lại" và dòng "Lần kiểm tra gần nhất: …".'),
    ('Chạm tab "Đơn hàng" rồi trở lại trang quán.', 'Nội dung đã tải trước đó có thể vẫn hiện nhưng có nhãn "Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất." Không có số liệu mới nào được bịa ra.'),
    ('Thử thêm một món vào giỏ và "Gửi đơn" khi đang mất mạng.', 'Không tạo đơn; báo lỗi mất kết nối hoặc "Chưa lưu được giỏ"/"Giỏ trên máy có thể mới hơn giỏ trên máy chủ. Sẽ lưu lại khi có mạng." (xem TC-FLOW-025 về nhánh chưa biết kết quả).'),
    ('Tắt Chế độ máy bay và chạm "Thử lại".', 'Thanh lỗi biến mất; dữ liệu cập nhật; giỏ còn đúng.'),
  ],
  restore='Tắt Chế độ máy bay.', ref=HEALTH + '; mobile/packages/n11_shared/lib/src/widgets/connection_banner.dart',
  auto='mobile/packages/n11_shared/test/health_test.dart; m10_orders_test.dart')

T('TC-ABN-002', ngay=4, seq=81, ten='Shipper mất Internet lúc bấm "Giao thành công" hoặc "Đã nhận hàng"',
  muc_dich='Trạng thái giao hàng không được lệch: nếu chưa chắc đã ghi nhận thì ứng dụng phải nói thật và cho kiểm tra lại, không trừ tiền hai lần.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-DRV-013',
  pre='SP-A có một đơn đã nhận (trước lấy hàng); sau đó có thêm một đơn đang giao. Ghi số dư trước.',
  steps=[
    ('Ở chi tiết đơn đã nhận, bấm "Đã nhận hàng" rồi xác nhận, và NGAY LẬP TỨC bật Chế độ máy bay.', 'Ứng dụng báo chưa xác nhận được kết quả ("Chưa xác nhận được") hoặc báo mất kết nối; không tự giả định thành công.'),
    ('Tắt Chế độ máy bay, mở lại chi tiết đơn (kéo làm mới/ "Tải lại").', 'Trạng thái hiện đúng thực tế trên máy chủ (đã lấy hàng hoặc chưa). Nếu chưa, bấm lại được; nếu rồi, chỉ còn "Giao thành công".'),
    ('Với đơn đang giao: bấm "Giao thành công", xác nhận, và bật Chế độ máy bay ngay.', 'Ứng dụng báo chưa xác nhận được kết quả ("Chưa xác nhận được") hoặc báo mất kết nối; không tự giả định đơn đã hoàn thành.'),
    ('Tắt Chế độ máy bay, kiểm tra trạng thái và ví.', 'Đơn hoàn thành đúng một lần hoặc chưa hoàn thành (cả hai đều chấp nhận được nếu ứng dụng nói đúng); hoa hồng thu tối đa MỘT lần; nếu đơn chưa hoàn thành thì bấm lại được và vẫn chỉ thu một lần.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu hoa hồng bị thu hai lần hoặc trạng thái đơn hiển thị sai so với thực tế.',
  restore=R_ORDER, ref='mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart (act, "Chưa xác nhận được"); apps/backend/src/idempotency',
  auto='tests/integration/m07-delivery.int.spec.ts; idempotency-commit-unknown.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart', sev='NGHIÊM TRỌNG')

T('TC-ABN-003', ngay=4, seq=82, ten='Quán mất mạng lúc bấm "Xác nhận đơn" hoặc "Gọi shipper"',
  muc_dich='Quán không bị tạo đôi/mất thao tác khi mạng chập chờn.',
  prio='P0', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-SHOP-021',
  pre='Có một đơn "Chờ xác nhận".',
  steps=[
    ('Bấm "Xác nhận đơn" rồi bật Chế độ máy bay ngay.', 'Thông báo chưa xác nhận được kết quả hoặc mất kết nối.'),
    ('Tắt Chế độ máy bay và làm mới danh sách.', 'Đơn ở trạng thái thật ("Đang chuẩn bị" hoặc vẫn "Chờ xác nhận"); không có đơn trùng.'),
    ('Với đơn "Đang chuẩn bị": bấm "Gọi shipper" > chọn người trả phí, bật Chế độ máy bay ngay, rồi tắt.', 'Sau khi có mạng chỉ MỘT yêu cầu giao tồn tại (xem phần giao hàng của đơn), không có lần gọi thứ hai ngoài ý muốn.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu có hai yêu cầu giao cho một đơn.',
  restore=R_ORDER, ref='mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart; docs/current/M10-implementation-20261018.md',
  auto='tests/integration/m10-orders.int.spec.ts; idempotency-executor.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-ABN-004', ngay=4, seq=83, ten='Tắt đột ngột ứng dụng 11Ship khi đang giao: đơn không mất, vị trí tiếp tục được chia sẻ',
  muc_dich='Vuốt tắt ứng dụng không được làm mất đơn; dịch vụ chia sẻ vị trí vẫn chạy khi còn đơn.',
  prio='P0', actor='Shipper + Chủ quán', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-003',
  pre='SP-A đang online, có một đơn "Đang giao" (đã lấy hàng). Quán đang xem đơn.',
  steps=[
    ('Trên Điện thoại 3 mở nhiều nhiệm (Recent apps) và vuốt TẮT HẲN 11Ship.', 'Ứng dụng đóng; thanh thông báo vẫn còn thông báo thường trực chia sẻ vị trí (nếu điện thoại không chặn).'),
    ('Đợi 3-4 phút. Quán xem đơn (phần vị trí, nếu đơn là ORDER).', 'Vị trí shipper vẫn cập nhật (giờ cập nhật mới) ở đơn ORDER; hoặc hiện "Vị trí đã cũ" nếu điện thoại giết dịch vụ (ghi nhận hãng máy, Android).'),
    ('Mở lại 11Ship.', 'Vào thẳng tài khoản SP-A; đơn vẫn "Đang thực hiện" ở trạng thái "Đang giao"; có nút "Giao thành công".'),
    ('Bấm "Giao thành công".', 'Hoàn thành bình thường, một lần.'),
  ],
  note='Một số hãng điện thoại (Xiaomi, Oppo, Vivo…) tự giết ứng dụng nền; đó là giới hạn của Android/hãng máy (xem tài liệu M14), không cam kết vượt qua. Ghi lại hãng máy và Android khi kết quả khác kỳ vọng.',
  restore=R_ORDER, ref='docs/current/M14-online-location-20261024.md (Dịch vụ nền Android)',
  auto='mobile/gateway/test; mobile/ship (LocationReporterTest JVM)', sev='Cao')

T('TC-ABN-005', ngay=4, seq=84, ten='Khởi động lại điện thoại shipper khi đang online hoặc đang có đơn',
  muc_dich='Sau khi điện thoại tắt/bật, shipper vẫn giữ đơn và (nếu còn lý do) được hướng dẫn bật lại chia sẻ vị trí; không tự online khi đã tắt.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1, deps='TC-DRV-009',
  pre='SP-A có một đơn đang thực hiện và đang online.',
  steps=[
    ('Khởi động lại Điện thoại 3.', 'Điện thoại bật lên bình thường.'),
    ('Mở 11Ship.', 'Vẫn đăng nhập; đơn vẫn có trong "Đang thực hiện".'),
    ('Nhìn dòng trạng thái vị trí ở Trang chủ.', 'Dịch vụ vị trí được khôi phục ("Đang lấy vị trí…"/"Đang chia sẻ vị trí") hoặc hiện hướng dẫn rõ vì sao chưa chạy (quyền, GPS) cùng nút "Thử lại".'),
    ('Hoàn tất đơn rồi bấm "Tắt online"; khởi động lại điện thoại lần nữa.', 'Sau khởi động KHÔNG tự bật online và không còn chia sẻ vị trí.'),
  ],
  restore=R_ORDER, ref='docs/current/M14-online-location-20261024.md (Khởi động lại)', auto='mobile/ship/test/ship_online_test.dart')

T('TC-ABN-006', ngay=4, seq=85, ten='GPS tắt giữa lúc shipper đang giữ đơn',
  muc_dich='Nếu GPS tắt khi có đơn, ứng dụng phải báo rõ; đơn không bị hủy; quán thấy vị trí cũ/mất kết nối chứ không thấy vị trí giả.',
  prio='P0', actor='Shipper + Chủ quán', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-001',
  pre='SP-A đang giữ đơn ORDER, đã lấy hàng, đang chia sẻ vị trí. Quán mở chi tiết đơn.',
  steps=[
    ('Shipper tắt GPS (Vị trí) trong thanh cài đặt nhanh của điện thoại.', 'Trên 11Ship hiện "Đang giao đơn · Chưa có vị trí" và hướng dẫn "GPS đang tắt. Hãy bật Vị trí trên điện thoại rồi thử lại." với nút "Mở cài đặt vị trí". Đơn vẫn còn, vẫn có "Giao thành công".'),
    ('Đợi 2-3 phút; quán làm mới chi tiết đơn.', 'Phần vị trí shipper hiện cũ/mất kết nối: "Vị trí cũ"/"Vị trí đã cũ. Có thể shipper đã di chuyển." hoặc "Mất kết nối vị trí". Không hiện vị trí mới giả.'),
    ('Shipper bật lại GPS và chạm "Thử lại".', 'Vị trí được chia sẻ lại; quán thấy giờ cập nhật mới và trạng thái mới.'),
  ],
  restore=R_ORDER, ref=OWNER + '; mobile/ship/lib/ship_online.dart; mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart (freshness)',
  auto='mobile/ship/test/ship_online_test.dart; tests/integration/m07-delivery.int.spec.ts (location freshness)', sev='Cao')

T('TC-ABN-007', ngay=4, seq=86, ten='GPS yếu (trong nhà / dưới hầm): không có vị trí nhưng ứng dụng không treo',
  muc_dich='Không lấy được vị trí trong thời gian chờ thì phải báo và cho thử lại.',
  prio='P1', actor='Shipper / Khách', dev=('P3', 'P1'), phones=1,
  pre='Người thử đứng trong nhà kín/tầng hầm. Quyền vị trí đã cấp, GPS bật.',
  steps=[
    ('Shipper bấm "Bật online" trong nhà kín.', 'Sau thời gian chờ hiện "Chưa lấy được vị trí. Hãy ra nơi thoáng hơn rồi thử lại." Không bật online.'),
    ('Khách mở "Trang chủ" 11Food trong nhà kín.', 'Hiện "Chưa xác định được khu vực theo GPS… Hãy thử định vị lại" và nút "Thử xác định lại khu vực"; ứng dụng không treo.'),
    ('Ra nơi thoáng và thử lại.', 'Lấy được vị trí.'),
  ],
  restore=R_NONE, ref='mobile/ship/lib/ship_online.dart; mobile/packages/n11_shared/lib/src/flows/location.dart', auto='mobile/ship/test/ship_online_test.dart')

T('TC-ABN-008', ngay=4, seq=87, ten='Vị trí giả (ứng dụng giả GPS) bị từ chối',
  muc_dich='Vị trí giả không được dùng để lấy khu vực/ghim quán hoặc làm vị trí shipper.',
  prio='P2', actor='Kỹ thuật viên / Người kiểm thử có kinh nghiệm', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Chỉ thực hiện trên máy thử và khi Người phụ trách cho phép (cần bật "Tùy chọn nhà phát triển" và một ứng dụng giả vị trí). Không bắt buộc với người mới.',
  pre='Điện thoại thử bật "Chọn ứng dụng vị trí giả" với một ứng dụng giả vị trí.',
  steps=[
    ('Mở 11Food với tài khoản chủ quán chưa hoàn tất hồ sơ, vào "Hồ sơ cửa hàng", chạm hàng "Địa chỉ lấy hàng" (đang ghi "Chọn địa chỉ"), gõ một địa chỉ vào ô "Địa chỉ" rồi chạm "Vị trí hiện tại".', 'Ứng dụng KHÔNG nhận vị trí giả: không hiện "Đã lấy vị trí hiện tại" và không ghim vị trí. Hiện thông báo lấy vị trí không thành công bằng tiếng Việt; nếu là thông báo mẫu trong ứng dụng thì có câu "Không lấy được vị trí thật từ điện thoại". Ghi lại nguyên văn thông báo thật vào Ghi chú kết quả (chữ chính xác chưa xác nhận trên máy thật).'),
    ('Tắt ứng dụng giả vị trí trên máy (kỹ thuật viên làm), quay lại ứng dụng và chạm "Vị trí hiện tại" lần nữa.', 'Hiện "Đã lấy vị trí hiện tại" với vị trí thật của điện thoại.'),
  ],
  restore='Tắt tùy chọn vị trí giả.', ref='mobile/packages/n11_shared/lib/src/flows/location.dart; mobile/packages/n11_shared/lib/src/flows/location.dart (từ chối vị trí giả)', auto='mobile/packages/n11_shared/test/flows_test.dart')

T('TC-ABN-009', ngay=4, seq=88, ten='Máy chủ phản hồi chậm hoặc không sẵn sàng',
  muc_dich='Khi máy chủ chậm/bảo trì ứng dụng phải báo thật và không treo.',
  prio='P1', actor='Khách / Shipper', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Cần kỹ thuật viên làm chậm/dừng máy chủ thử trong thời gian ngắn theo quy trình vps-safe-update, hoặc dùng mạng rất yếu (3G yếu). KHÔNG dừng máy chủ khi đang có người dùng thật.',
  pre='Kỹ thuật viên sẵn sàng làm máy chủ chậm/không phản hồi.',
  steps=[
    ('Khi máy chủ chậm, thực hiện một thao tác đọc (mở tab "Đơn hàng").', 'Hiện trạng thái chờ rồi báo "Máy chủ phản hồi quá lâu - Chưa nhận được phản hồi. Vui lòng thử lại." (không treo vô hạn).'),
    ('Khi máy chủ báo chưa sẵn sàng.', 'Hiện "Máy chủ chưa sẵn sàng - Máy chủ đã phản hồi nhưng chưa sẵn sàng phục vụ. Vui lòng thử lại sau ít phút."'),
    ('Thử một thao tác ghi (ví dụ gửi đơn) trong lúc này.', 'Không tạo đơn hoặc báo "Chưa biết đơn đã gửi chưa" và cho kiểm tra lại; không tạo đơn trùng.'),
    ('Khi máy chủ trở lại bình thường, chạm "Thử lại".', 'Mọi thứ phục hồi.'),
  ],
  restore='Kỹ thuật viên khôi phục máy chủ.', ref=HEALTH, auto='mobile/packages/n11_shared/test/health_test.dart')

T('TC-ABN-010', ngay=4, seq=89, ten='Hai người cùng thao tác một đơn: quán hủy trong lúc shipper bấm "Nhận đơn"',
  muc_dich='Hai thao tác xung đột cùng lúc chỉ có một thao tác thắng; trạng thái cuối cùng nhất quán cho mọi bên.',
  prio='P0', actor='Quán + Shipper', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-001',
  note='Cần phối hợp hai người, đếm 1-2-3 và bấm cùng lúc. Lặp lại 3 lần với đơn mới mỗi lần; ghi kết quả từng lần.',
  pre='Một đơn "Đang tìm shipper"; shipper đang thấy thẻ đơn; quán đang ở màn hình có nút "Hủy yêu cầu giao".',
  steps=[
    ('Hai người cùng bấm: quán "Hủy yêu cầu giao" (xác nhận) và shipper "Nhận đơn".', 'Chỉ có MỘT kết quả: hoặc yêu cầu bị hủy và shipper không nhận (báo đơn không còn nhận được), hoặc shipper nhận trước rồi yêu cầu bị hủy sau (shipper thấy "Quán đã hủy yêu cầu giao" và hoa hồng được giải phóng).'),
    ('Kiểm tra ví shipper.', 'Không có hoa hồng bị thu; không có tiền tạm giữ treo vĩnh viễn.'),
    ('Kiểm tra màn hình quán và shipper.', 'Hai bên cùng thấy một trạng thái cuối nhất quán.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu hai bên thấy hai trạng thái khác nhau hoặc tiền tạm giữ bị treo.',
  restore=R_ORDER, ref=OWNER + ' mục V ("race giữa hủy/nhận/lấy/hoàn thành"); apps/backend/src/delivery',
  auto='tests/integration/m07-delivery.int.spec.ts (đua giữa các lệnh)', sev='NGHIÊM TRỌNG')

T('TC-ABN-011', ngay=4, seq=90, ten='Khách hủy đơn trong lúc quán bấm "Xác nhận đơn"',
  muc_dich='Hai thao tác xung đột chỉ một thắng; không có đơn "vừa hủy vừa xác nhận".',
  prio='P0', actor='Khách + Chủ quán', dev=('P1', 'P2'), phones=2, deps='TC-CUS-036',
  note='Đếm 1-2-3 và bấm cùng lúc; lặp lại vài lần với đơn mới.',
  pre='Một đơn "Chờ xác nhận"; khách đang ở hộp thoại hủy; quán đang ở chi tiết đơn.',
  steps=[
    ('Khách xác nhận hủy và quán bấm "Xác nhận đơn" cùng lúc.', 'Chỉ có một kết quả: đơn "Đã hủy" HOẶC đơn "Đang chuẩn bị". Bên thua nhận thông báo/báo lỗi rõ ràng ("Đơn vừa được thay đổi ở nơi khác…").'),
    ('Đối chiếu màn hình khách, quán.', 'Hai bên thấy cùng một trạng thái cuối.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu hai bên thấy hai trạng thái khác nhau.',
  restore=R_ORDER, ref='apps/backend/src/orders (order rules, version); docs/current/M10-implementation-20261018.md mục 2',
  auto='tests/integration/m10-orders.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-ABN-012', ngay=4, seq=91, ten='Hai quản trị viên cùng sửa một dữ liệu: người sau nhận cảnh báo "đã thay đổi ở nơi khác"',
  muc_dich='Không ghi đè mù quáng; bên thua phải tải lại rồi quyết định.',
  prio='P1', actor='SYSTEM + ADMIN', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Hai trình duyệt đăng nhập hai tài khoản (SYSTEM và ADMIN-1 có quyền) cùng mở chi tiết một quán thử.',
  steps=[
    ('Trình duyệt 1: mở chi tiết quán thử, chạm "Vô hiệu hóa quán", nhập lý do và xác nhận.', 'Hiện "Đã vô hiệu hóa quán."; trạng thái quán là "Đã bị vô hiệu hóa".'),
    ('Trình duyệt 2 (chưa tải lại): cũng bấm "Vô hiệu hóa quán" và xác nhận.', 'Báo "Trạng thái quán đã thay đổi nên thao tác này không còn phù hợp. Đóng hộp thoại để xem trạng thái hiện tại." Không ghi trùng.'),
    ('Trình duyệt 1 "Kích hoạt lại quán".', 'Quán hoạt động lại.'),
  ],
  restore='Quán được kích hoạt lại.', ref='apps/admin-web/src/dom/shops-view.ts; tests: admin-shops.int.spec.ts', auto='tests/integration/admin-shops.int.spec.ts; admin-concurrency.int.spec.ts')

T('TC-ABN-013', ngay=4, seq=92, ten='Bấm nhiều lần liên tiếp vào các nút quan trọng ("Nhận đơn", "Đã nhận hàng", "Giao thành công", "Xác nhận đơn")',
  muc_dich='Mỗi thao tác chỉ tác động một lần dù bấm dồn; ví và đơn không bị lặp.',
  prio='P0', actor='Shipper + Chủ quán', dev=('P2', 'P3'), phones=2, deps='TC-FLOW-003',
  pre='Một yêu cầu giao DIRECT mới; ghi số dư ví SP-A (B0).',
  steps=[
    ('Shipper bấm "Nhận đơn" 5 lần thật nhanh.', 'Chỉ nhận một lần; ví chỉ tạm giữ một lần hoa hồng.'),
    ('Bấm "Đã nhận hàng" > ở hộp xác nhận bấm nút xác nhận 5 lần liên tiếp.', 'Chỉ chuyển trạng thái một lần.'),
    ('Bấm "Giao thành công" > nút xác nhận 5 lần liên tiếp.', 'Chỉ hoàn thành một lần; có đúng MỘT dòng "Hoa hồng".'),
    ('Kiểm tra ví.', 'Tổng số dư = B0 - hoa hồng (đúng một lần).'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu có hơn một dòng hoa hồng.',
  restore='Không cần.', ref='mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart (M07Actions.act chặn bấm lặp); apps/backend/src/idempotency',
  auto='tests/integration/m07-delivery.int.spec.ts; idempotency-executor.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-ABN-014', ngay=4, seq=93, ten='Chuyển ứng dụng 11Ship sang chạy nền và khóa màn hình: vẫn nhận đơn và chia sẻ vị trí',
  muc_dich='Shipper không phải mở app mới nhận đơn; vị trí được gửi đều khoảng 1 phút một lần khi màn hình khóa.',
  prio='P0', actor='Shipper + Chủ quán', dev=('P2', 'P3'), phones=2, deps='TC-DRV-002',
  note='Thông báo đẩy khi màn hình khóa cần Firebase đã cấu hình (TC-NOTI-001). Nếu chưa có, đơn mới chỉ thấy khi mở app; ghi nhận.',
  pre='SP-A online, đủ điều kiện, trong 3 km quanh quán.',
  steps=[
    ('Shipper bấm Home để đưa 11Ship xuống nền, dùng một ứng dụng khác (ví dụ Chrome) 5 phút.', 'Thông báo chia sẻ vị trí của 11Ship vẫn hiển thị.'),
    ('Khóa màn hình điện thoại, đợi 5 phút. Quán tạo yêu cầu giao mới.', 'Shipper nhận thông báo "Có đơn giao hàng mới" trên màn hình khóa (nếu push đã cấu hình); thông báo chỉ có nội dung ngắn, không có số điện thoại/địa chỉ.'),
    ('Mở khóa, chạm thông báo.', 'Mở đúng danh sách/đơn "Có thể nhận".'),
    ('Admin xem vị trí shipper (nếu đang giữ đơn) hoặc quán xem vị trí.', 'Vị trí được cập nhật liên tục khoảng 1 phút một lần trong thời gian khóa màn hình (ghi nhận số lần cập nhật).'),
  ],
  restore='Tắt online.', ref='docs/current/M14-online-location-20261024.md (Cách Owner thử)', auto='mobile/ship (LocationReporterTest); tests/integration/m07-delivery.int.spec.ts', sev='Cao')

T('TC-ABN-015', ngay=4, seq=94, ten='Bật chế độ tiết kiệm pin: vị trí và thông báo vẫn hoạt động (hoặc báo rõ giới hạn)',
  muc_dich='Chế độ tiết kiệm pin có thể làm hệ điều hành dừng dịch vụ; ghi nhận ảnh hưởng thực tế theo từng hãng máy.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1,
  note='Đây là giới hạn của Android/hãng máy; không phải lỗi nếu ứng dụng phát hiện và hướng dẫn. Ghi hãng máy, đời Android.',
  pre='SP-A online với một đơn đang giữ.',
  steps=[
    ('Bật "Tiết kiệm pin" của điện thoại, khóa màn hình 5 phút.', 'Ghi nhận: vị trí có còn cập nhật? Thông báo có còn đến?'),
    ('Mở 11Ship.', 'Đơn còn; nếu vị trí bị gián đoạn có hướng dẫn "Thử lại"/"Mở cài đặt"; không có số liệu sai.'),
  ],
  restore='Tắt tiết kiệm pin.', ref='docs/current/M14-online-location-20261024.md (Giới hạn của Android)', auto='Không có (không thể tự động hóa).')

T('TC-ABN-016', ngay=4, seq=95, ten='Nhập ký tự đặc biệt, rất dài hoặc kiểu "mã độc" vào các ô văn bản',
  muc_dich='Ô văn bản phải hiển thị nguyên văn như chữ thường, không làm hỏng giao diện, không thực thi gì.',
  prio='P1', actor='Khách + Chủ quán + Admin', dev=('P1', 'P2', 'PC'), phones=2, deps='TC-CUS-025',
  data='Ghi chú đơn: "<b>đậm</b> <script>alert(1)</script> \' OR 1=1 -- 😀 Nguyễn Văn Ở". Tên người nhận: "Ng@#$%^&*()". Ghi chú 200 ký tự toàn chữ "a".',
  pre='KH-A có giỏ món.',
  steps=[
    ('Khách đặt đơn với ghi chú và tên người nhận như Dữ liệu nhập.', 'Gửi được hoặc báo lỗi rõ ràng nếu vượt giới hạn; không crash.'),
    ('Quán mở đơn và đọc ghi chú.', 'Hiện NGUYÊN VĂN từng ký tự như chữ thường (không in đậm, không chạy script, emoji hiển thị hoặc ô vuông).'),
    ('Admin mở đơn ở Web Admin > Đơn hàng.', 'Cũng hiện nguyên văn, không có cửa sổ cảnh báo lạ nào hiện ra.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu có cửa sổ cảnh báo của script hoặc giao diện bị vỡ do nội dung nhập.',
  restore=R_ORDER, ref='apps/admin-web/src/dom/dom.ts (h() tạo nút DOM an toàn); apps/backend (validators)',
  auto='tests/integration/m10-orders.int.spec.ts; admin-web unit tests', sev='Cao')

T('TC-ABN-017', ngay=4, seq=96, ten='Điện thoại có giờ sai (đồng hồ lệch nhiều)',
  muc_dich='Giờ điện thoại sai nhiều có thể làm kết nối bảo mật tới máy chủ bị từ chối. Kiểm tra ứng dụng không đăng nhập sai/không treo, báo lỗi dễ hiểu, và dùng lại bình thường sau khi chỉnh giờ đúng.',
  prio='P1', actor='Khách / Shipper', dev=('P1',), phones=1, ready='CẦN XÁC MINH',
  note='Từ bản 23/10 đăng nhập chỉ dùng số điện thoại + mật khẩu, nên lỗi "kiểm tra giờ của điện thoại" của cơ chế xác thực thiết bị cũ không còn là kết quả chuẩn. Kết quả thực tế khi giờ sai chưa được xác nhận: có thể báo lỗi chứng chỉ bảo mật ("Chứng chỉ bảo mật của máy chủ không hợp lệ…"), lỗi kết nối, hoặc vẫn đăng nhập được. Test này CHỈ GHI NHẬN thông báo thực tế (chụp màn hình) để Người phụ trách đối chiếu; mọi kết quả đều chấp nhận trừ các trường hợp FAIL nêu ở cột "Cách kết luận".',
  pre='Đăng xuất. Tắt "Ngày và giờ tự động" (Cài đặt > Hệ thống > Ngày và giờ) và chỉnh ngày điện thoại lệch hơn 1 ngày so với hôm nay.',
  steps=[
    ('Mở 11Food, tab "Tài khoản" > "Đăng nhập", nhập số điện thoại và mật khẩu KH-A rồi chạm "Đăng nhập".', 'Một trong hai kết quả đều chấp nhận: (a) đăng nhập thành công; (b) hiện thông báo lỗi bằng tiếng Việt dễ hiểu (ví dụ về chứng chỉ bảo mật hoặc kết nối) và vẫn ở màn đăng nhập. Chụp màn hình và chép nguyên văn thông báo vào Ghi chú kết quả.'),
    ('Bật lại "Ngày và giờ tự động", chờ 10 giây, quay lại ứng dụng và chạm "Đăng nhập" (hoặc "Thử lại") lần nữa.', 'Đăng nhập thành công, vào được tab "Tài khoản" với tên KH-A.'),
  ],
  verdict='PASS: bước 2 đăng nhập thành công, và ở bước 1 không có hiện tượng nào nêu ở FAIL. FAIL: ứng dụng treo/tắt đột ngột, hiện chữ lỗi kỹ thuật tiếng Anh/mã lỗi viết hoa, đăng nhập vào nhầm tài khoản, hoặc sau khi chỉnh giờ đúng vẫn không đăng nhập được. BLOCKED: không chỉnh được giờ điện thoại.',
  restore='Bật lại "Ngày và giờ tự động" và kiểm tra giờ đúng.', ref='docs/current/M01-password-sessions-20261023.md (đăng nhập chỉ cần mật khẩu); mobile/packages/n11_shared/lib/src/account/account_views.dart (thông báo chứng chỉ bảo mật/kết nối)',
  auto='mobile/packages/n11_shared/test (lỗi TLS/kết nối); không có test tự động cho giờ điện thoại sai')

T('TC-ABN-018', ngay=4, seq=97, ten='Chạy trên các phiên bản Android khác nhau (8, 10, 12, 13, 14)',
  muc_dich='Ứng dụng hỗ trợ từ Android 8.0; mỗi đời máy có cách hỏi quyền khác nhau (vị trí, thông báo, cài APK).',
  prio='P1', actor='Người kiểm thử', dev=('P1', 'P3'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note='Chỉ làm với các điện thoại thật có sẵn; mỗi máy một dòng kết quả. Không bắt buộc có đủ 5 đời máy. Ghi rõ hãng + đời Android.',
  pre='Một điện thoại thật Android 8.0+ (ghi hãng, model, đời Android).',
  steps=[
    ('Cài 11Food và 11Ship, đăng nhập KH-A / SP-A.', 'Cài và đăng nhập được.'),
    ('Kiểm tra hộp xin quyền vị trí, quyền thông báo (Android 13+), quyền cài đặt từ nguồn lạ.', 'Mỗi hộp hiện đúng và ứng dụng hướng dẫn nếu từ chối.'),
    ('Thực hiện một vòng ngắn: tìm quán, thêm giỏ (khách); bật online (shipper).', 'Chạy được; không có màn trắng, không crash.'),
    ('Chụp màn hình các màn chính.', 'Chữ không bị cắt, nút bấm được.'),
  ],
  restore=R_LOGOUT, ref='mobile/tool/prepare-android.sh (minSdk 26); mobile/tool/check-apk-permissions.sh', auto='Workflow "Mobile APK" (build); không kiểm trên máy thật')

T('TC-ABN-019', ngay=4, seq=98, ten='Màn hình nhỏ, cỡ chữ lớn và xoay ngang',
  muc_dich='Nội dung vẫn đọc và bấm được khi người dùng chỉnh cỡ chữ lớn hoặc xoay màn hình.',
  prio='P2', actor='Người kiểm thử', dev=('P1',), phones=1,
  pre='Cài đặt > Màn hình > Cỡ chữ: lớn nhất.',
  steps=[
    ('Mở 11Food, duyệt Trang chủ, quán, giỏ và màn "Xác nhận đơn".', 'Chữ không bị cắt khuất nút "Gửi đơn"; vẫn cuộn được.'),
    ('Xoay ngang điện thoại ở màn "Giỏ hàng".', 'Không mất dữ liệu đã nhập; không crash.'),
  ],
  restore='Đặt lại cỡ chữ.', ref='mobile/packages/n11_shared/lib/src/tokens.dart (kTapMin)', auto='mobile/packages/n11_shared/test (widget tests)')

T('TC-ABN-020', ngay=4, seq=99, ten='Chủ quán đăng nhập trên điện thoại khác: phiên cũ kết thúc, quán không mất đơn',
  muc_dich='Chuyển điện thoại quản lý quán không làm mất đơn; chỉ một thiết bị quản lý quán tại một thời điểm.',
  prio='P1', actor='Chủ quán', dev=('P2', 'P1'), phones=2, deps='TC-SHOP-021',
  pre='CQ-A đang ở chế độ quản lý quán trên Điện thoại 2; có một đơn "Đang chuẩn bị".',
  steps=[
    ('Đăng nhập CQ-A trên Điện thoại 1 và vào chế độ quản lý quán.', 'Vào được; thấy cùng đơn "Đang chuẩn bị".'),
    ('Trên Điện thoại 2 thao tác bất kỳ (ví dụ làm mới danh sách).', 'Bị đăng xuất ("Phiên đăng nhập đã kết thúc").'),
    ('Trên Điện thoại 1 tiếp tục "Gọi shipper".', 'Thành công, không mất dữ liệu đơn.'),
  ],
  restore=R_ORDER, ref='docs/current/M01-password-sessions-20261023.md (đăng nhập mới thu hồi phiên cũ); apps/backend/src/client-auth',
  auto='tests/integration/native-device-binding.int.spec.ts; client-auth-session.int.spec.ts')

T('TC-ABN-021', ngay=4, seq=100, ten='Hai màn hình mở cùng một đơn: thao tác trên màn đã cũ bị yêu cầu tải lại',
  muc_dich='Nếu dữ liệu đã đổi ở nơi khác, ứng dụng không ghi đè mà yêu cầu tải lại.',
  prio='P1', actor='Chủ quán', dev=('P2', 'P1'), phones=2, deps='TC-ABN-020',
  note='Dùng hai điện thoại nhưng cùng tài khoản là không thể (xem TC-ABN-020). Cách thay thế: một điện thoại quán + Web Admin cùng thao tác trên một đơn.',
  pre='Quán mở chi tiết một đơn "Chờ xác nhận" trên Điện thoại 2; Admin có quyền mở cùng đơn trên Web Admin.',
  steps=[
    ('Admin hủy đơn món trên Web Admin (có lý do).', 'Đơn chuyển sang trạng thái "Đã hủy" trên Web Admin.'),
    ('Quán (màn chưa làm mới) bấm "Xác nhận đơn".', 'Không xác nhận được; hiện thông báo dữ liệu đã thay đổi và tải lại; đơn hiển thị "Đã hủy".'),
  ],
  restore=R_NONE, ref='mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart ("Dữ liệu đã thay đổi"); orders-view.ts', auto='tests/integration/m10-admin-orders.int.spec.ts')

T('TC-ABN-022', ngay=4, seq=101, ten='Nút Back và đóng hộp thoại giữa chừng không làm mất hoặc gửi nhầm thao tác',
  muc_dich='Người dùng thoát ngang khi gửi đơn/hủy đơn thì không có thao tác ngoài ý muốn.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-025',
  pre='Giỏ có món, đang ở "Xác nhận đơn".',
  steps=[
    ('Nhấn Back khi đang ở màn "Xác nhận đơn".', 'Quay về giỏ; chưa có đơn nào được tạo.'),
    ('Mở hộp "Hủy đơn?" của một đơn đang chờ rồi bấm ra ngoài/Back.', 'Hộp đóng, đơn KHÔNG bị hủy.'),
  ],
  restore=R_ORDER, ref='mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart', auto='mobile/packages/n11_shared/test/m10_orders_test.dart')

# =====================================================================================================
# NOTI - Thông báo
# =====================================================================================================

T('TC-NOTI-001', ngay=4, seq=40, ten='Thông báo đẩy (push) tới điện thoại khi tắt màn hình',
  muc_dich='Người dùng nhận thông báo kể cả khi không mở ứng dụng. Chức năng này cần cấu hình dịch vụ Firebase phía máy chủ và bản APK có hỗ trợ push.',
  prio='P1', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note='Tài liệu ghi nhận "APK bàn giao hiện chưa có push vì dự án Firebase của Owner và khóa chưa được cung cấp" (M08). Cần Người phụ trách xác nhận push đã bật trên bản đang thử. Nếu chưa, ghi BLOCKED và dùng TC-NOTI-002 (hộp thư trong app). Web Admin > Thông báo > Cấu hình hiển thị cảnh báo "Máy chủ chưa cấu hình dịch vụ đẩy thông báo" nếu chưa bật.',
  pre='Push đã được kỹ thuật viên cấu hình (có thể xem Web Admin > Thông báo > "Cấu hình" không còn cảnh báo). Điện thoại đã cho phép thông báo. Cả ba máy đăng nhập.',
  steps=[
    ('Khóa màn hình cả ba điện thoại. Khách gửi đơn.', 'Điện thoại quán sáng/nhận thông báo đơn mới (có âm thanh theo cài đặt).'),
    ('Quán xác nhận và gọi shipper (từ điện thoại quán đã mở khóa rồi khóa lại).', 'Khách nhận thông báo "quán xác nhận"; shipper (online, đủ điều kiện) nhận "đơn giao hàng mới".'),
    ('Chạm thông báo trên màn hình khóa.', 'Ứng dụng mở đúng đơn/đúng danh sách.'),
    ('Đọc nội dung thông báo.', 'Chỉ có nội dung ngắn (mã giao hàng/loại sự kiện); KHÔNG có số điện thoại, địa chỉ, thông tin ngân hàng hay mã OTP.'),
  ],
  restore=R_ORDER, ref='docs/current/M08-implementation-20261018.md mục 4; ops/runbooks/m08-push-deploy-20261018.md',
  auto='tests/integration/m08-notifications.int.spec.ts (nhà cung cấp push giả); không kiểm được push thật tự động')

T('TC-NOTI-002', ngay=4, seq=41, ten='Hộp thông báo trong ứng dụng đồng bộ khi mở lại và cập nhật trực tiếp',
  muc_dich='Dù không có push, hộp thông báo luôn đúng khi mở ứng dụng; có trạng thái "Mất kết nối" khi mất mạng.',
  prio='P0', actor='Khách + Chủ quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  pre='Cả ba đã tham gia ít nhất một đơn (đã có thông báo).',
  steps=[
    ('Trên mỗi máy mở chuông "Thông báo" (khách/quán: Trang chủ; shipper: tab "Thông báo").', 'Có danh sách theo nhóm ngày ("Hôm nay", "Hôm qua"), dấu chưa đọc, số "Chưa đọc (n)".'),
    ('Khi mở sẵn hộp thông báo, nhờ người khác tạo sự kiện mới (ví dụ quán xác nhận đơn).', 'Thông báo mới xuất hiện trong vài giây mà không cần thoát ra vào (cập nhật trực tiếp).'),
    ('Bật Chế độ máy bay.', 'Hiện cảnh báo "Mất kết nối — dữ liệu có thể chưa cập nhật".'),
    ('Tắt Chế độ máy bay.', 'Danh sách tự cập nhật.'),
    ('Chạm "Đánh dấu tất cả đã đọc".', 'Số chưa đọc về 0.'),
  ],
  restore=R_NONE, ref=M08V + '; docs/current/M08-implementation-20261018.md (long-poll changes)',
  auto='tests/integration/m08-notifications.int.spec.ts; mobile/packages/n11_shared/test/m08_test.dart')

T('TC-NOTI-003', ngay=4, seq=42, ten='Tắt nhóm thông báo: thông báo vẫn vào hộp thư nhưng không đẩy',
  muc_dich='Cài đặt thông báo theo nhóm; timer nghiệp vụ không bị ảnh hưởng.',
  prio='P1', actor='Khách', dev=('P1',), phones=1,
  pre='KH-A đăng nhập.',
  steps=[
    ('Tab "Tài khoản" > "Cài đặt thông báo".', 'Hiện nhóm "Đơn hàng và giao hàng", "Ví và hồ sơ" (và "Đơn có thể nhận" chỉ ở 11Ship) với công tắc, mục "Âm thanh".'),
    ('Tắt nhóm "Đơn hàng và giao hàng".', 'Lưu thành công (hoặc báo "Chưa lưu được. Hãy thử lại." nếu lỗi mạng).'),
    ('Khách có một sự kiện đơn (ví dụ quán xác nhận).', 'Thông báo vẫn nằm trong hộp thông báo; không có thông báo đẩy.'),
    ('Bật lại nhóm.', 'Trở lại bình thường.'),
  ],
  restore='Bật lại mọi nhóm.', ref=M08V + ' (NotificationSettingsScreen)', auto='tests/integration/m08-notifications.int.spec.ts')

T('TC-NOTI-004', ngay=4, seq=43, ten='Quyền thông báo của điện thoại bị tắt: ứng dụng hướng dẫn bật',
  muc_dich='Khi Android chặn thông báo, ứng dụng phải nói rõ và vẫn cập nhật khi mở app.',
  prio='P1', actor='Khách', dev=('P1',), phones=1,
  pre='Cài đặt > Ứng dụng > 11Food > Thông báo: TẮT.',
  steps=[
    ('Mở Tài khoản > "Cài đặt thông báo".', 'Hiện "Thông báo đẩy chưa sẵn sàng"/"Chưa cấp" kèm hướng dẫn "Mở Cài đặt điện thoại › Thông báo và bật thông báo cho ứng dụng. Mở ứng dụng vẫn cập nhật trạng thái." và "Thông báo vẫn vào hộp thông báo khi bạn mở ứng dụng."'),
    ('Bật thông báo trong cài đặt điện thoại và quay lại ứng dụng.', 'Trạng thái đổi thành "Đang bật"/"Đã cấp".'),
  ],
  restore='Để thông báo bật.', ref=M08V + ' ("Chưa nhận được thông báo khi tắt màn hình")', auto='mobile/packages/n11_shared/test/m08_test.dart')

T('TC-NOTI-005', ngay=4, seq=44, ten='Sau khi đăng xuất, máy không còn nhận thông báo của tài khoản cũ',
  muc_dich='Riêng tư: người dùng máy khác không nhận thông báo tài khoản đã đăng xuất.',
  prio='P0', actor='Khách', dev=('P1', 'P2'), phones=2, deps='TC-FLOW-001',
  pre='KH-A đăng nhập Điện thoại 1 và có đơn đang chạy.',
  steps=[
    ('Đăng xuất KH-A trên Điện thoại 1.', 'Đăng xuất thành công.'),
    ('Quán xác nhận/xử lý đơn của KH-A.', 'Điện thoại 1 KHÔNG nhận thông báo nào về đơn đó (kể cả trên màn hình khóa).'),
    ('Đăng nhập KH-A trên Điện thoại 1 lại.', 'Hộp thông báo hiển thị đầy đủ thông báo đã bỏ lỡ.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu máy đã đăng xuất vẫn nhận thông báo riêng tư.',
  restore=R_ORDER, ref='docs/current/M08-implementation-20261018.md (token push gắn session, vô hiệu khi đăng xuất)',
  auto='tests/integration/m08-notifications.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-NOTI-006', ngay=5, seq=60, ten='Web Admin > Thông báo: tra cứu, "Việc cần xử lý" và cấu hình (chỉ SYSTEM sửa)',
  muc_dich='Admin xem thông báo gửi lỗi và hàng cần xử lý; chỉ SYSTEM đổi cấu hình kênh/lưu trữ.',
  prio='P1', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Đã có thông báo từ các test trước.',
  steps=[
    menu_go('VẬN HÀNH > "Thông báo"'),
    ('Mở thẻ "Việc cần xử lý".', 'Hiện "Gửi lỗi" và "Hàng cần xử lý" (sau giao thất bại); nếu không có: "Không có việc cần xử lý".'),
    ('Mở thẻ tra cứu, tìm theo mã đơn.', 'Hiện các thông báo của đơn đó: loại, người nhận (che bớt), kênh ("App (hộp thông báo)", "Push điện thoại"), trạng thái, "Lý do chưa gửi được" nếu có.'),
    ('Mở thẻ "Cấu hình".', 'SYSTEM sửa được "Bật thông báo đẩy", số ngày hiển thị, số lần thử lại; ADMIN chỉ xem ("Chỉ tài khoản SYSTEM được thay đổi cấu hình.").'),
  ],
  restore='Hoàn nguyên mọi thay đổi cấu hình thử.', ref='apps/admin-web/src/dom/notifications-view.ts; docs/current/M08-implementation-20261018.md (M08.06)',
  auto='tests/integration/m08-admin-notifications.int.spec.ts')

T('TC-NOTI-007', ngay=4, seq=45, ten='Thông báo dừng tìm shipper và nhắc 5/15 phút tới quán',
  muc_dich='Quán được nhắc khi chưa có shipper nhận và được báo khi hệ thống ngừng tìm.',
  prio='P1', actor='Chủ quán + Khách', dev=('P1', 'P2'), phones=2, deps='TC-FLOW-005',
  pre='Một yêu cầu giao không có shipper nhận (TC-FLOW-005).',
  steps=[
    ('Quán mở hộp thông báo ở phút 5 và phút 15.', 'Có thông báo nhắc tìm (loại "Nhắc việc"/"Đang tìm") cho đúng đơn.'),
    ('Khi ngừng tìm, quán và khách mở hộp thông báo.', 'Cả hai nhận thông báo "ngừng tìm shipper" cho đúng đơn; nội dung khách không có thông tin dành riêng cho quán.'),
  ],
  restore=R_ORDER, ref='docs/current/M08-implementation-20261018.md (M08.04)', auto='tests/integration/m08-notifications.int.spec.ts')

# =====================================================================================================
# FEED - Đánh giá và phản ánh
# =====================================================================================================

T('TC-FEED-001', ngay=5, seq=10, ten='Khách đánh giá quán và shipper sau khi đơn hoàn thành',
  muc_dich='Chỉ khách đặt đơn đã hoàn thành mới đánh giá; gửi một lần, không sửa/xóa.',
  prio='P1', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-FLOW-001',
  data='Quán: 5 sao, nhận xét "Món ngon (TEST)". Shipper: 4 sao, nhận xét "Giao nhanh (TEST)".',
  pre='KH-A có một đơn "Hoàn thành" (TC-FLOW-001), chưa đánh giá.',
  steps=[
    ('Mở chi tiết đơn đã hoàn thành.', 'Có thẻ "Đánh giá và phản ánh" với "Đánh giá quán" và "Đánh giá shipper".'),
    ('Chạm "Đánh giá quán", chạm 5 sao, nhập nhận xét, chạm "Gửi đánh giá".', 'Hộp "Gửi đánh giá?" nói "Bạn chọn 5 sao cho … Đánh giá chỉ gửi một lần và không sửa hoặc xóa được." Xác nhận.'),
    ('Làm tương tự cho shipper (4 sao).', 'Gửi thành công; hiện "Đã đánh giá".'),
    ('Mở lại đơn, thử đánh giá lần nữa.', 'Không đánh giá lại được (đã đánh giá).'),
    ('Xem trang Quán Test A.', 'Điểm đánh giá của quán đã hiện (5 sao, 1 lượt) cùng nhận xét của khách.'),
  ],
  restore='Không hoàn tác được; ghi lại.', ref=M11V + '/m11_rating_views.dart; docs/current/M11-implementation-20261018.md',
  auto='tests/integration/m11-feedback.int.spec.ts; m11-orders-real.int.spec.ts; mobile/packages/n11_shared/test/m11_test.dart')

T('TC-FEED-002', ngay=5, seq=11, ten='Không đánh giá được khi đơn chưa hoàn thành hoặc khi không phải đơn của mình',
  muc_dich='Quyền đánh giá chặt chẽ: chỉ khách của đơn hoàn thành, chỉ shipper đã giao thành công.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-CUS-025',
  pre='KH-A có một đơn chưa hoàn thành (đang chuẩn bị) và KH-B không có đơn đó.',
  steps=[
    ('Mở chi tiết đơn chưa hoàn thành.', 'Không có nút đánh giá, hoặc hiện "Đơn hoàn thành rồi bạn mới đánh giá được quán." / "Giao thành công rồi bạn mới đánh giá được shipper."'),
    ('Với đơn bị hủy/chưa có shipper: tìm phần đánh giá shipper.', 'Hiện "Đơn này chưa có shipper giao hoặc không giao qua shipper nên không có phần đánh giá shipper."'),
  ],
  restore=R_NONE, ref=M11V + '/m11_rating_views.dart', auto='tests/integration/m11-feedback.int.spec.ts')

T('TC-FEED-003', ngay=5, seq=12, ten='Khách gửi phản ánh về một đơn (có ảnh minh chứng)',
  muc_dich='Phản ánh có nhóm vấn đề, mô tả và tối đa 5 ảnh (mỗi ảnh ≤ 5 MB, JPEG/PNG/WebP).',
  prio='P1', actor='Khách', dev=('P1',), phones=1, deps='TC-FLOW-001',
  data='Nhóm vấn đề: chọn một nhóm trong danh sách (ví dụ nhóm liên quan món ăn); mô tả "Thiếu 1 phần trà đá (TEST)"; 1 ảnh JPEG nhỏ.',
  pre='KH-A có đơn hoàn thành.',
  steps=[
    ('Chi tiết đơn > "Gửi phản ánh về đơn này".', 'Màn "Gửi phản ánh" với "Nhóm vấn đề", "Mô tả điều đã xảy ra", "Ảnh minh chứng · không bắt buộc" ("Tối đa 5 ảnh, mỗi ảnh 5 MB.").'),
    ('Chọn nhóm bỏ trống mô tả rồi chạm "Gửi phản ánh".', 'Báo "Hãy chọn nhóm vấn đề." hoặc "Hãy nhập nội dung phản ánh."'),
    ('Chọn nhóm, nhập mô tả, thêm 1 ảnh ("Thêm ảnh"), chạm "Gửi phản ánh".', 'Hiện "Đã gửi phản ánh. Chúng tôi sẽ cập nhật trạng thái ngay trong ứng dụng." Hồ sơ nằm trong Tài khoản > "Phản ánh của tôi" > "Đang mở" với trạng thái "Đã tiếp nhận"/"Chờ tiếp nhận".'),
    ('Gửi thêm phản ánh cùng vấn đề khi đã có hồ sơ mở.', 'Nội dung được bổ sung vào hồ sơ đang mở ("Vấn đề này đang có hồ sơ mở nên nội dung của bạn đã được bổ sung vào hồ sơ đó.").'),
  ],
  restore='Admin đóng hồ sơ thử (TC-FEED-006).', ref=M11V + '/m11_complaint_views.dart', auto='tests/integration/m11-feedback.int.spec.ts; mobile/packages/n11_shared/test/m11_test.dart')

T('TC-FEED-004', ngay=5, seq=13, ten='Chủ quán đánh giá shipper và phản hồi đánh giá của khách',
  muc_dich='Quán đánh giá shipper sau khi giao (thành công hoặc không); quán phản hồi nhưng không sửa/xóa được đánh giá của khách.',
  prio='P1', actor='Chủ quán', dev=('P2',), phones=1, deps='TC-FEED-001',
  data='Đánh giá shipper 5 sao "Đúng giờ (TEST)". Phản hồi khách "Cảm ơn bạn (TEST)".',
  pre='Có đơn hoàn thành mà khách đã đánh giá quán.',
  steps=[
    ('Quán mở chi tiết yêu cầu giao đã hoàn thành, chạm "Đánh giá shipper", chọn sao, "Gửi đánh giá".', 'Gửi thành công một lần.'),
    ('Vào Tài khoản > "Đánh giá của tôi" > "Khách đánh giá", mở đánh giá của khách, chạm "Phản hồi đánh giá", nhập, "Lưu phản hồi".', 'Phản hồi được lưu và hiện dưới đánh giá ("Phản hồi của quán").'),
    ('Tìm nút sửa/xóa đánh giá của khách.', 'Không có ("Quán không sửa hoặc xóa được đánh giá của khách."). Có "Sửa phản hồi" cho phản hồi của chính quán.'),
  ],
  restore=R_NONE, ref=M11V + '/m11_rating_views.dart', auto='tests/integration/m11-feedback.int.spec.ts')

T('TC-FEED-005', ngay=5, seq=14, ten='Admin ẩn và khôi phục một đánh giá',
  muc_dich='Đánh giá vi phạm bị ẩn khỏi điểm tổng hợp; bản gốc được giữ và có nhật ký.',
  prio='P1', actor='ADMIN (quyền Duyệt)', dev=('PC',), phones=0, deps='TC-FEED-001', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  data='Lý do ẩn: "TEST vi phạm".',
  pre='Có đánh giá 5 sao của quán (TC-FEED-001).',
  steps=[
    menu_go('VẬN HÀNH > "Đánh giá"'),
    ('Mở "Chi tiết đánh giá" của đánh giá thử; chạm "Ẩn" (nếu có quyền), chọn lý do và xác nhận.', 'Đánh giá ghi "đã ẩn"; điểm tổng hợp của quán không còn tính đánh giá đó; có nhật ký.'),
    ('Khách xem trang quán.', 'Đánh giá không còn hiển thị.'),
    ('Admin chạm "Khôi phục đánh giá".', 'Đánh giá hiển thị lại và tính lại điểm.'),
    ('Tìm cách sửa số sao/nhận xét thay người gửi.', 'Không có ("Admin không sửa sao hay nhận xét thay người gửi.").'),
  ],
  restore='Khôi phục đánh giá (bước 4).', ref='apps/admin-web/src/dom/feedback-view.ts', auto='tests/integration/m11-admin-feedback.int.spec.ts')

T('TC-FEED-006', ngay=5, seq=15, ten='Admin xử lý phản ánh: tiếp nhận, yêu cầu bổ sung, kết luận, đóng',
  muc_dich='Vòng đời hồ sơ phản ánh đi đúng thứ tự; người gửi và bên liên quan thấy đúng phần được phép.',
  prio='P1', actor='ADMIN (quyền Duyệt) + Khách + Quán/Shipper', dev=('PC', 'P1'), phones=1, deps='TC-FEED-003', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Có hồ sơ phản ánh "Chờ tiếp nhận" (TC-FEED-003).',
  steps=[
    menu_go('VẬN HÀNH > "Phản ánh"'),
    ('Mở "Chi tiết phản ánh", tiếp nhận hồ sơ (gán cho mình: "Của tôi").', 'Trạng thái "Đã tiếp nhận"; khách nhận thông báo.'),
    ('Ghi "Ghi chú nội bộ" và gửi "Yêu cầu bổ sung" cho người gửi.', 'Trạng thái "Chờ bổ sung"; khách thấy "Yêu cầu bổ sung" và nút "Bổ sung hồ sơ". KHÔNG thấy ghi chú nội bộ.'),
    ('Khách bổ sung thông tin.', 'Admin thấy "Bạn bổ sung" trong hồ sơ.'),
    ('Admin nhập "Kết luận" và đóng hồ sơ.', 'Trạng thái "Đã đóng"; khách thấy kết luận và hạn xem xét lại trong 7 ngày.'),
  ],
  restore='Không cần.', ref='apps/admin-web/src/dom/feedback-view.ts; ' + M11V + '/m11_complaint_views.dart', auto='tests/integration/m11-admin-feedback.int.spec.ts')

T('TC-FEED-007', ngay=5, seq=16, ten='Bên liên quan giải trình và khách yêu cầu xem xét lại (trong 7 ngày, một lần)',
  muc_dich='Bên bị phản ánh được nói ý kiến; người gửi được xin xem xét lại một lần cho mỗi lần đóng.',
  prio='P2', actor='Khách + Quán/Shipper + ADMIN', dev=('P1', 'P2', 'PC'), phones=2, deps='TC-FEED-006', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Hồ sơ phản ánh đã đóng trong vòng 7 ngày; Admin đã gửi yêu cầu giải trình cho quán/shipper liên quan.',
  steps=[
    ('Quán/shipper mở Tài khoản > "Phản ánh của tôi" > "Liên quan đến tôi", mở hồ sơ, nhập "Nội dung giải trình", gửi.', 'Hiện "Bạn giải trình"; người gửi KHÔNG thấy nội dung phản ánh gốc của ai khác ngoài phần được phép.'),
    ('Khách chạm "Yêu cầu xem xét lại", nhập lý do, "Gửi yêu cầu".', 'Hiện "Đã gửi yêu cầu"; trạng thái "đang chờ quyết định"; không gửi lại được lần nữa cho lần đóng đó.'),
    ('Admin quyết định ("Quyết định xem xét lại").', 'Khách nhận kết quả "đã mở lại hồ sơ" hoặc từ chối kèm lý do.'),
  ],
  restore='Không cần.', ref=M11V + '/m11_complaint_views.dart; docs/current/M11-implementation-20261018.md mục 2.5', auto='tests/integration/m11-feedback.int.spec.ts')

T('TC-FEED-008', ngay=5, seq=17, ten='Ảnh minh chứng phản ánh: giới hạn số lượng, dung lượng và định dạng',
  muc_dich='Hệ thống chỉ nhận ảnh JPEG/PNG/WebP ≤ 5 MB, tối đa 5 ảnh, kiểm tra nội dung tệp.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-FEED-003',
  data='6 ảnh nhỏ; 1 ảnh lớn hơn 5 MB; 1 file không phải ảnh đổi đuôi thành .jpg.',
  pre='Đang ở màn "Gửi phản ánh".',
  steps=[
    ('Thêm 6 ảnh.', 'Chỉ nhận tối đa 5 ảnh ("Tối đa 5 ảnh, mỗi ảnh 5 MB.").'),
    ('Thêm ảnh lớn hơn 5 MB.', 'Bị từ chối kèm thông báo; không treo ứng dụng.'),
    ('Chọn file giả ảnh.', 'Hiện "Không đọc được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP khác."'),
    ('Chạm "Bỏ ảnh cuối".', 'Số ảnh đã chọn giảm đi 1.'),
  ],
  restore='Thoát màn hình không gửi.', ref=M11V + '/m11_complaint_views.dart (kMaxEvidence=5)', auto='tests/integration/m11-feedback.int.spec.ts')

# =====================================================================================================
# SEC - Quyền, riêng tư, an toàn
# =====================================================================================================

T('TC-SEC-001', ngay=4, seq=110, ten='Quán này không thấy đơn và yêu cầu giao của quán khác',
  muc_dich='Mỗi chủ quán chỉ thấy đơn của quán mình.',
  prio='P0', actor='Chủ quán A + Chủ quán B', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-SHOP-011',
  pre='Quán Test A có ít nhất một đơn. CQ-B đã hoàn tất hồ sơ Quán Test B.',
  steps=[
    ('Đăng nhập CQ-B, vào chế độ quản lý quán, mở "Đơn hàng" > "Đơn món" và "Giao hàng".', 'KHÔNG thấy bất kỳ đơn hay yêu cầu giao nào của Quán Test A.'),
    ('Tìm bằng mã một đơn của Quán Test A trong ô tìm.', '"Không có đơn phù hợp".'),
    ('Đăng nhập CQ-A.', 'Thấy đầy đủ đơn của Quán Test A.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu lộ đơn của quán khác.',
  restore=R_LOGOUT, ref='apps/backend/src/orders/order-shop.controller.ts; tests: m10-orders.int.spec.ts', auto='tests/integration/m10-orders.int.spec.ts; shop-management.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-SEC-002', ngay=4, seq=111, ten='Shipper này không thấy đơn đang giữ của shipper khác',
  muc_dich='Đơn đã được người khác nhận không hiện trong "Đang thực hiện" của shipper khác.',
  prio='P0', actor='Shipper A + Shipper B', dev=('P1', 'P3'), phones=2, deps='TC-DRV-009',
  pre='SP-A đang giữ một đơn; SP-B online.',
  steps=[
    ('SP-B mở "Đơn hàng" > "Đang thực hiện" và "Có thể nhận".', 'Không thấy đơn của SP-A; đơn đã bị nhận không còn trong "Có thể nhận".'),
    ('SP-B thử mở trực tiếp đơn của SP-A (nếu có đường dẫn từ thông báo cũ).', 'Bị từ chối hoặc báo không còn quyền xem ("Bạn không còn quyền xem nội dung này").'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu SP-B thấy thông tin khách của đơn SP-A.',
  restore=R_ORDER, ref=M08V + ' ("Bạn không còn quyền xem nội dung này"); apps/backend/src/delivery', auto='tests/integration/m07-delivery.int.spec.ts; m08-notifications.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-SEC-003', ngay=4, seq=112, ten='Người dùng không thấy mã tra cứu/UUID/mã kỹ thuật trên màn hình',
  muc_dich='Theo yêu cầu của Owner, thông báo lỗi không hiện "mã tra cứu"/request ID cho người dùng; thông tin này chỉ ở nhật ký máy chủ.',
  prio='P1', actor='Khách + Quán + Shipper', dev=('P1', 'P2', 'P3'), phones=1,
  pre='Dùng các màn đơn hàng/giao hàng khi gặp một lỗi (ví dụ thao tác khi mất mạng).',
  steps=[
    ('Gây một lỗi bất kỳ ở màn đơn hàng/giao hàng (ví dụ bật máy bay rồi bấm thao tác).', 'Thông báo lỗi bằng tiếng Việt đơn giản.'),
    ('Đọc kỹ toàn bộ thông báo lỗi.', 'KHÔNG có "Mã tra cứu", chuỗi dài 32-36 ký tự gồm chữ và số (mã nội bộ), hay tên lỗi tiếng Anh viết hoa nối bằng dấu gạch dưới (ví dụ FEE_LOCKED).'),
  ],
  restore=R_NONE, ref=OWNER + ' mục IV (không hiển thị mã tra cứu/request ID/UUID)', auto='mobile/packages/n11_shared/test/m07_views_test.dart; error_request_trace_test.dart')

T('TC-SEC-004', ngay=4, seq=113, ten='Mật khẩu luôn bị ẩn và không hiện trong thông báo hay chẩn đoán',
  muc_dich='Mật khẩu không lộ trên màn hình/ảnh chụp.',
  prio='P1', actor='Người kiểm thử', dev=('P1', 'PC'), phones=1,
  pre='Mở màn Đăng nhập/Đăng ký/Đổi mật khẩu.',
  steps=[
    ('Gõ mật khẩu ở các màn hình.', 'Ký tự hiển thị dạng chấm (ẩn); ở Web Admin chỉ hiện khi chủ động bấm biểu tượng con mắt.'),
    ('Gây lỗi đăng nhập và đọc thông báo.', 'Thông báo không in lại mật khẩu hay số điện thoại đầy đủ.'),
    ('Đọc mọi màn hình có chữ "Phiên bản" hoặc "Mã nguồn" nếu có (ví dụ trang Phiên bản & cập nhật của Web Admin).', 'Không có mật khẩu, mã OTP hay chuỗi bí mật dài (mã phiên đăng nhập).'),
  ],
  restore=R_NONE, ref='mobile/packages/n11_shared/lib/src/errors.dart (sanitizeDiagnosticText)', auto='mobile/packages/n11_shared/test/config_errors_test.dart')

T('TC-SEC-005', ngay=5, seq=70, ten='Phiên Web Admin hết hạn khi bỏ không và sau khi đăng xuất',
  muc_dich='Phiên quản trị không tồn tại vĩnh viễn; đăng xuất xong không dùng lại được bằng nút Back.',
  prio='P1', actor='ADMIN', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note='Thời hạn phiên quản trị do cấu hình; hỏi Người phụ trách để biết thời gian chờ.',
  pre='ADMIN-1 đang đăng nhập.',
  steps=[
    ('Đăng xuất, rồi bấm nút Back của trình duyệt.', 'Không xem được dữ liệu quản trị; quay về đăng nhập.'),
    ('Đăng nhập lại, để yên không thao tác trong thời gian phiên cho phép rồi thao tác.', 'Bị yêu cầu đăng nhập lại.'),
  ],
  restore=R_NONE, ref='apps/backend/src/admin-auth; docs/current/ADR-002-auth-security-foundation.md', auto='tests/integration/admin-auth.int.spec.ts; admin-expiry-after-locks.int.spec.ts')

T('TC-SEC-006', ngay=5, seq=71, ten='Số điện thoại và tài khoản ngân hàng được che bớt ở Web Admin',
  muc_dich='Giảm lộ thông tin cá nhân; chỉ người có quyền xử lý mới thấy đầy đủ.',
  prio='P1', actor='ADMIN', dev=('PC',), phones=0, deps='TC-ADM-012',
  pre='ADMIN-2 (không có quyền xem liên hệ) đăng nhập.',
  steps=[
    ('Mở danh sách người dùng, quán, shipper, yêu cầu nạp/rút.', 'Số điện thoại hiển thị dạng che bớt; số tài khoản ngân hàng che bớt ("Số tài khoản được che.").'),
    ('Mở chi tiết giao hàng DIRECT.', 'Liên hệ người nhận hiện "Ẩn: tài khoản này không có quyền xem liên hệ".'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom (finance-ops-view.ts, deliveries-view.ts)', auto='tests/integration/m12-access.int.spec.ts')

# =====================================================================================================
# AUTO - đối chiếu kiểm thử tự động (kỹ thuật viên)
# =====================================================================================================

def _auto(id, ten, muc_dich, spec_list, risk_text, seq):
    T(id, ngay=5, seq=seq, ten=ten, muc_dich=muc_dich, prio='P1', actor='Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới)', dev=('PC',), phones=0,
      loai='Tự động đã có (đối chiếu)', ready='CẦN HỖ TRỢ KỸ THUẬT',
      note='Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu.',
      pre='Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử.',
      steps=[
        ('Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi).', 'Lần chạy có mã commit trùng với bản đang thử.'),
        ('Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: %s.' % spec_list, 'Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README.'),
        ('Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng".', 'Có đường dẫn bằng chứng.'),
        ('Đối chiếu rủi ro: %s' % risk_text, 'Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng.'),
      ],
      verdict='PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.',
      restore=R_NONE, ref='.github/workflows/ci.yml; ' + spec_list, auto=spec_list, sev='Cao')

_auto('TC-AUTO-001', 'Đối chiếu CI: nhận đơn đồng thời, hủy/nhận/lấy hàng/hoàn thành xung đột',
      'Rủi ro "hai người cùng thao tác" khó tái hiện chính xác bằng tay.',
      'tests/integration/m07-delivery.int.spec.ts, m10-orders.int.spec.ts', 'hai shipper nhận cùng đơn; hủy và nhận cùng lúc; hoàn thành hai lần.', 120)
_auto('TC-AUTO-002', 'Đối chiếu CI: chống xử lý lặp (idempotency) và mất phản hồi',
      'Bấm lặp, gửi lại khi mất phản hồi không tạo bản ghi trùng.',
      'tests/integration/idempotency-executor.int.spec.ts, idempotency-replay-guard.int.spec.ts, idempotency-commit-unknown.int.spec.ts, admin-lost-response.int.spec.ts', 'đơn trùng, yêu cầu giao trùng, hoa hồng trùng, nạp/rút trùng.', 121)
_auto('TC-AUTO-003', 'Đối chiếu CI: sổ cái ví, tạm giữ, nạp, rút và đối soát',
      'Sai số dư/tiền tự tăng giảm không được xảy ra.',
      'tests/integration/m04-wallet-core.int.spec.ts, m04-wallet-holds.int.spec.ts, m04-wallet-topup-sources.int.spec.ts, m04-topup-requests.int.spec.ts, m04-admin-topup.int.spec.ts, m04-withdrawals.int.spec.ts, m11-adjustment-real.int.spec.ts', 'số dư âm, hoa hồng hai lần, nạp hai lần, rút hai lần, lệch sổ.', 122)
_auto('TC-AUTO-004', 'Đối chiếu CI: quyền người dùng và quyền quản trị',
      'Sai quyền (xem/sửa dữ liệu không được phép).',
      'tests/integration/m12-access.int.spec.ts, m04-finance-access.int.spec.ts, admin-business-decisions.int.spec.ts, admin-account-lock.int.spec.ts, admin-shops.int.spec.ts', 'ADMIN vượt quyền SYSTEM; thao tác tiền không có quyền riêng.', 123)
_auto('TC-AUTO-005', 'Đối chiếu CI: giao nhận sự kiện (outbox) và thông báo không mất, không trùng',
      'Thông báo gửi nhầm/trùng/mất khi hệ thống lỗi giữa chừng.',
      'tests/integration/outbox-dispatch-at-least-once.int.spec.ts, outbox-dispatch-crash-matrix.int.spec.ts, m08-notifications.int.spec.ts, m08-admin-notifications.int.spec.ts', 'sự kiện bị mất/nhân đôi; thông báo sai người.', 124)
_auto('TC-AUTO-006', 'Đối chiếu CI: nâng cấp cơ sở dữ liệu giữ nguyên dữ liệu',
      'Cập nhật phần mềm không làm mất dữ liệu đã có.',
      'tests/integration/migration.int.spec.ts, staging-db-upgrade-from-42.int.spec.ts, remote-migration-runner.int.spec.ts, m07-topup-upgrade.int.spec.ts', 'mất/đổi dữ liệu khi nâng cấp.', 125)
_auto('TC-AUTO-007', 'Đối chiếu CI: sao lưu, nhật ký (audit) không sửa/xóa được',
      'Nhật ký chỉ thêm, bản sao lưu kiểm chứng được.',
      'tests/integration/m12-audit-backup.int.spec.ts, audit-writer.int.spec.ts, audit-outbox-atomicity.int.spec.ts', 'sửa/xóa nhật ký; thao tác không có nhật ký.', 126)

T('TC-SEC-007', ngay=5, seq=72, ten='Chính sách quyền riêng tư nói "không theo dõi vị trí nền" nhưng 11Ship chia sẻ vị trí khi online',
  muc_dich='Nội dung chính sách phải đúng với hành vi thật: shipper đang online gửi vị trí khoảng 1 phút một lần, kể cả khi khóa màn hình. Cần Owner xác nhận chính sách đã bao quát việc này.',
  prio='P1', actor='Shipper + Người phụ trách', dev=('P3',), phones=1, ready='CẦN XÁC MINH',
  note='Lệch tài liệu-mã nguồn: kPrivacyText ghi "ứng dụng không theo dõi vị trí nền" (nói về hồ sơ quán), còn 11Ship có dịch vụ chia sẻ vị trí nền khi bật online (M14). Chỉ ghi nhận, không phải lỗi người kiểm thử.',
  pre='SP-A đăng nhập 11Ship.',
  steps=[
    ('Trong màn đăng ký hoặc "Chính sách và điều khoản" đọc đoạn "Chính sách quyền riêng tư" liên quan đến vị trí.', 'Ghi lại nguyên văn câu nói về vị trí.'),
    ('Trên Trang chủ 11Ship đọc lời giải thích dưới nút "Bật online" và chạm "Bật online".', 'Có thông báo "Bật online sẽ chia sẻ vị trí của bạn khoảng 1 phút một lần, kể cả khi khóa màn hình…" (shipper được báo trước khi bật). Sau khi bật hiện thông báo thường trực của dịch vụ vị trí.'),
    ('Đối chiếu hai nội dung và ghi nhận có mâu thuẫn hay không.', 'Nếu chính sách nói không theo dõi vị trí nền mà app vẫn chia sẻ nền: báo CÂU HỎI mức CAO cho Owner; shipper vẫn được báo trước khi bật.'),
  ],
  restore='Tắt online.', ref='mobile/packages/n11_shared/lib/src/account/account_views.dart (kPrivacyText); mobile/ship/lib/ship_home.dart (home-online-disclosure); docs/current/M14-online-location-20261024.md',
  auto='Không có.')

