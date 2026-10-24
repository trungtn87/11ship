# -*- coding: utf-8 -*-
from lib import *

WALV = 'mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart'
FINADM = 'apps/admin-web/src/dom/finance-admin-view.ts'
FINOPS = 'apps/admin-web/src/dom/finance-ops-view.ts'
FINV = 'apps/admin-web/src/dom/finance-view.ts'
DRVV = 'mobile/packages/n11_shared/lib/src/flows/driver_views.dart'

MONEY_NOTE = ('QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản '
              'là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED.')

# =====================================================================================================
# WAL - Ví và tài chính
# =====================================================================================================

T('TC-WAL-001', ngay=3, seq=1, ten='Ví shipper mới: số dư 0đ, chưa có giao dịch',
  muc_dich='Shipper mới đăng ký có ví 0đ; ứng dụng không hiện số tiền giả.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-ACC-004',
  pre='SP-A vừa đăng ký, chưa nạp tiền.',
  steps=[
    ('Trang chủ 11Ship chạm "Ví tiền / Nạp tiền".', 'Màn "Ví của tôi" mở ra.'),
    ('Xem thẻ số dư.', '"Số dư khả dụng" = 0đ; "Tổng số dư" = 0đ; "Tiền tạm giữ" = 0đ. Có chú thích "Tiền tạm giữ là tiền giữ chỗ, chưa bị trừ khỏi sổ giao dịch."'),
    ('Xem phần giao dịch.', 'Hiện "Chưa có giao dịch" ("Các giao dịch của ví sẽ hiển thị ở đây.").'),
    ('Tìm nút rút tiền.', 'Trên màn Ví chỉ có nút "Nạp tiền"; có dòng "Để rút toàn bộ số dư, mở Tài khoản → Dừng hoạt động / Rút tiền." (không có nút "Rút tiền" riêng).'),
  ],
  restore=R_NONE, ref=WALV + ' (WalletHomeScreen, _BalanceCard)', auto='mobile/packages/n11_shared/test/wallet_views_test.dart; wallet_http_views_test.dart; tests/integration/m04-wallet-core.int.spec.ts')

T('TC-WAL-002', ngay=3, seq=2, ten='Nạp tiền: số tiền dưới mức tối thiểu bị từ chối',
  muc_dich='Mỗi lần nạp phải đạt mức tối thiểu (mặc định 100.000đ, SYSTEM chỉnh được).',
  prio='P0', actor='Shipper', dev=('P3',), phones=1, deps='TC-WAL-001',
  data='Thử: để trống, "5000", "abc", "99999", rồi một số ≥ mức tối thiểu.',
  pre='Mở "Ví của tôi" > "Nạp tiền".',
  steps=[
    ('Ở màn "Nhập số tiền nạp" đọc dòng gợi ý.', 'Hiện "Tối thiểu … mỗi lần nạp" đúng bằng mức đang cấu hình (hỏi Người phụ trách/Admin để đối chiếu).'),
    ('Nhập lần lượt "5000", "abc", "99999" rồi bấm tiếp tục.', 'Mỗi lần không đi tiếp và báo "Số tiền nạp tối thiểu …" hoặc lỗi số không hợp lệ; để trống thì báo "Hãy nhập số tiền muốn nạp."'),
    ('Nhập số bằng đúng mức tối thiểu.', 'Đi tiếp được sang màn xác nhận.'),
  ],
  restore='Thoát màn hình.', ref=WALV + ' (TopupAmountScreen); apps/backend/src/wallet-topup (TOPUP_AMOUNT_BELOW_MINIMUM)',
  auto='mobile/packages/n11_shared/test/wallet_views_test.dart; tests/integration/m04-topup-requests.int.spec.ts')

T('TC-WAL-003', ngay=3, seq=3, ten='Tạo yêu cầu nạp tiền: thông tin chuyển khoản và trạng thái "Chờ xử lý" (tiền chưa vào ví)',
  muc_dich='Yêu cầu nạp chỉ là đề nghị; tiền KHÔNG vào ví cho đến khi Admin đối chiếu sao kê và xác nhận.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-WAL-002', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE + ' Cần SYSTEM đã thêm và BẬT ít nhất một "Tài khoản nhận tiền" (Web Admin > Tài chính > Tài khoản nhận tiền); nếu chưa có, ứng dụng báo chưa cấu hình tài khoản nhận.',
  data='Số tiền nạp: đúng mức tối thiểu (mặc định 100000).',
  pre='SP-A đăng nhập, số dư 0đ. SYSTEM đã bật tài khoản nhận tiền thử nghiệm.',
  steps=[
    ('Ví > "Nạp tiền", nhập 100000 (hoặc mức tối thiểu), bấm tiếp tục.', 'Sang màn "Xác nhận nạp tiền" với "Thông tin chuyển khoản": "Ngân hàng", "Số tài khoản", "Chủ tài khoản", "Số tiền", "Nội dung chuyển khoản", nút "Sao chép". Có dòng "Hệ thống chỉ cộng tiền vào ví sau khi Admin kiểm tra và xác nhận giao dịch ngân hàng." và "Mã QR chưa được hỗ trợ ở phiên bản này…".'),
    ('Chạm "Sao chép" ở nội dung chuyển khoản.', 'Hiện "Đã sao chép".'),
    ('(KHÔNG chuyển tiền thật.) Chạm "Tôi đã chuyển tiền" khi Người phụ trách xác nhận đây là tiền thử nghiệm.', 'Tạo yêu cầu; hiện "Đã gửi yêu cầu" / "Bạn đã gửi yêu cầu nạp 100.000đ. Admin sẽ kiểm tra và cộng tiền vào ví sau khi xác minh giao dịch ngân hàng." Trạng thái "Chờ xử lý"/"Chờ xác nhận".'),
    ('Quay về "Ví của tôi".', 'Số dư khả dụng VẪN 0đ ("Tiền chưa được cộng ngay"). Yêu cầu hiện trong "Giao dịch gần đây" hoặc "Xem yêu cầu".'),
    ('Mở "Chi tiết yêu cầu nạp".', 'Thấy mã yêu cầu, ngày tạo, số tiền, trạng thái, nút "Hủy yêu cầu".'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu số dư tăng ngay khi chưa có Admin xác nhận.',
  restore='Hủy yêu cầu thử ("Hủy yêu cầu" > "Hủy yêu cầu nạp?") nếu không dùng tiếp (TC-WAL-007).',
  ref=WALV + ' (TopupConfirmScreen, TopupDetailScreen); docs/current/M04-B2-1-shipper-topup-request-20261018.md',
  auto='tests/integration/m04-topup-requests.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-WAL-004', ngay=3, seq=4, ten='Admin thấy yêu cầu nạp tiền và đối chiếu thông tin',
  muc_dich='Yêu cầu nạp của shipper hiện đúng cho Admin có quyền; Admin không có quyền chỉ xem.',
  prio='P0', actor='ADMIN', dev=('PC',), phones=0, deps='TC-WAL-003', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE,
  pre='Có yêu cầu nạp "Chờ xử lý" của SP-A. ADMIN-1 (hoặc SYSTEM) đăng nhập Web Admin với quyền "Xem yêu cầu nạp tiền" và "Xác nhận / từ chối nạp tiền".',
  steps=admin_login('ADMIN-1') + [
    menu_go('TÀI CHÍNH > Tài chính > "Nạp tiền"'),
    ('Tìm yêu cầu của SP-A trong danh sách (cột "Mã yêu cầu", "Số tiền đề nghị", "Trạng thái").', 'Yêu cầu hiện đúng số tiền, đúng shipper (số điện thoại che bớt), trạng thái "Chờ".'),
    ('Mở "Chi tiết yêu cầu nạp".', 'Thấy số tiền đề nghị, tài khoản nhận, thời gian tạo; có nút "Kiểm tra và xác nhận" và "Từ chối yêu cầu" (nếu ADMIN có quyền).'),
  ],
  restore='Đăng xuất Web Admin.', ref=FINADM + ' (Yêu cầu nạp tiền, Chi tiết yêu cầu nạp)',
  auto='tests/integration/m04-admin-topup.int.spec.ts; admin-finance-browser.int.spec.ts')

T('TC-WAL-005', ngay=3, seq=5, ten='Admin ghi nhận tiền: ví shipper được cộng đúng một lần (nạp cho SP-A bằng tiền thử nghiệm)',
  muc_dich='Sau khi Admin đối chiếu và ghi nhận, ví được cộng đúng số tiền thực nhận, lịch sử có dòng "Nạp tiền", và shipper đủ điều kiện nhận đơn.',
  prio='P0', actor='ADMIN + Shipper', dev=('PC', 'P3'), phones=1, deps='TC-WAL-004', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE + ' Mã giao dịch ngân hàng nhập phải là mã THỬ NGHIỆM duy nhất, ví dụ "TEST-20261025-001", mỗi mã chỉ dùng một lần trên toàn hệ thống.',
  data='Số tiền thực nhận: 100000 (bằng số tiền yêu cầu). Mã giao dịch ngân hàng: "TEST-<ngày>-<số thứ tự>". Thời điểm tiền về: thời điểm hiện tại. Ghi chú ghi rõ TEST.',
  pre='Có yêu cầu nạp "Chờ" của SP-A (TC-WAL-003). Ghi số dư SP-A trước (0đ).',
  steps=[
    ('Admin mở yêu cầu nạp của SP-A, chạm "Kiểm tra và xác nhận".', 'Màn "Xác nhận ghi nhận tiền" hiện ô "Số tiền thực nhận (VND)", "Mã giao dịch ngân hàng", "Thời điểm tiền về" và dòng "Kiểm tra lại với sao kê. Sau khi ghi nhận, số tiền được cộng vào ví và không thể sửa."'),
    ('Nhập số tiền thực nhận 100000, mã giao dịch thử nghiệm, thời điểm; chạm "Xác nhận đã nhận tiền" rồi xác nhận lần cuối.', 'Hiện kết quả thành công, yêu cầu chuyển trạng thái đã xác nhận, có người xử lý và thời gian ("Xử lý lúc").'),
    ('Shipper mở "Ví của tôi" (kéo làm mới).', 'Số dư khả dụng và tổng số dư = 100.000đ; có đúng MỘT dòng "Nạp tiền" +100.000đ; yêu cầu chuyển "Hoàn thành"/"Admin đã xác nhận. Số tiền thực nhận đã được ghi vào ví.".'),
    ('Shipper bật online (TC-DRV-002).', 'Bật được vì ví đủ điều kiện.'),
    ('Admin mở lại yêu cầu và thử bấm xác nhận lần nữa (nếu còn nút).', 'KHÔNG ghi nhận lần hai; số dư vẫn 100.000đ.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu số dư khác 100.000đ hoặc có hai dòng nạp.',
  restore='Tiền thử nghiệm giữ lại trong ví SP-A để chạy các test nhận đơn. Ghi mã giao dịch TEST đã dùng vào ô ghi chú. Không thể hoàn tác ghi nhận.',
  ref=FINADM + ' (Xác nhận ghi nhận tiền); docs/current/M04-B2-2b-admin-topup-posting-20261018.md; M04-C',
  auto='tests/integration/m04-admin-topup.int.spec.ts; m04-wallet-topup-sources.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-WAL-006', ngay=5, seq=1, ten='Admin từ chối yêu cầu nạp: ví không thay đổi',
  muc_dich='Yêu cầu không khớp sao kê bị từ chối, không có tiền nào vào ví và shipper được báo.',
  prio='P0', actor='ADMIN + Shipper', dev=('PC', 'P3'), phones=1, deps='TC-WAL-003', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE,
  data='Lý do từ chối: "Không khớp sao kê (TEST)".',
  pre='SP-B tạo một yêu cầu nạp mới "Chờ xử lý" (làm TC-WAL-003 với SP-B). Ghi số dư SP-B.',
  steps=[
    ('Admin mở yêu cầu nạp của SP-B, chạm "Từ chối yêu cầu".', 'Hộp "Từ chối yêu cầu nạp tiền?" yêu cầu "Lý do".'),
    ('Nhập lý do, xác nhận.', 'Yêu cầu chuyển "Đã từ chối"; có người xử lý và lý do.'),
    ('Shipper mở "Ví của tôi" và chi tiết yêu cầu.', 'Số dư KHÔNG đổi; yêu cầu hiện "Đã từ chối"/"Admin đã từ chối yêu cầu này. Ví không thay đổi." Shipper nhận thông báo "nạp tiền bị từ chối" (hộp thông báo).'),
    ('Shipper tạo một yêu cầu nạp mới.', 'Tạo được yêu cầu mới (yêu cầu cũ đã đóng).'),
  ],
  restore='Hủy yêu cầu mới nếu không dùng.', ref=FINADM + ' (Từ chối yêu cầu nạp tiền?)',
  auto='tests/integration/m04-admin-topup.int.spec.ts', sev='Cao')

T('TC-WAL-007', ngay=5, seq=2, ten='Shipper hủy yêu cầu nạp khi còn "Chờ xử lý"',
  muc_dich='Shipper tự hủy yêu cầu chưa được xử lý; ví không đổi.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1, deps='TC-WAL-003',
  pre='Có yêu cầu nạp "Chờ xử lý" của SP-B.',
  steps=[
    ('Mở "Chi tiết yêu cầu nạp", chạm "Hủy yêu cầu".', 'Hộp "Hủy yêu cầu nạp?" nói "Yêu cầu nạp tiền sẽ bị hủy. Bạn có thể tạo yêu cầu mới sau."'),
    ('Xác nhận hủy.', 'Hiện "Yêu cầu đã được hủy. Ví không thay đổi."; trạng thái "Đã hủy". Không còn nút hủy.'),
    ('Admin xem danh sách "Nạp tiền".', 'Yêu cầu hiện "Đã hủy" (không còn trong nhóm chờ).'),
  ],
  restore=R_NONE, ref=WALV + ' (Hủy yêu cầu nạp?); docs/current/M04-B2-1-shipper-topup-request-20261018.md',
  auto='tests/integration/m04-topup-requests.int.spec.ts')

T('TC-WAL-008', ngay=5, seq=3, ten='Admin không được ghi nhận trùng mã giao dịch ngân hàng',
  muc_dich='Một giao dịch ngân hàng chỉ được cộng tiền một lần trên toàn hệ thống.',
  prio='P0', actor='ADMIN', dev=('PC',), phones=0, deps='TC-WAL-005', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE,
  pre='Mã giao dịch TEST đã dùng ở TC-WAL-005 (ví dụ "TEST-20261025-001"). Có thêm một yêu cầu nạp "Chờ" khác (SP-B).',
  steps=[
    ('Admin mở yêu cầu nạp của SP-B, "Kiểm tra và xác nhận", nhập CÙNG mã giao dịch đã dùng.', 'Máy chủ từ chối: báo mã giao dịch đã được ghi nhận/chiếm chỗ; KHÔNG cộng tiền.'),
    ('Đổi sang mã mới (TEST-…-002) và xác nhận.', 'Ghi nhận được, ví SP-B tăng đúng số tiền.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu chấp nhận trùng mã và cộng tiền hai lần.',
  restore='Ghi lại mã TEST đã dùng.', ref=FINADM + ' (Mã giao dịch ngân hàng); docs/current/M04-B1-topup-source-core-20261017.md',
  auto='tests/integration/m04-wallet-topup-sources.int.spec.ts; m04-admin-topup.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-WAL-009', ngay=5, seq=4, ten='Số tiền thực nhận khác số tiền yêu cầu: ví cộng đúng số thực nhận',
  muc_dich='Nếu khách chuyển thiếu/thừa, Admin nhập số thực nhận theo sao kê; ví cộng đúng số đó (không cộng theo số đề nghị).',
  prio='P1', actor='ADMIN + Shipper', dev=('PC', 'P3'), phones=1, deps='TC-WAL-005', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE,
  data='Yêu cầu 100000; Admin nhập số thực nhận 120000 (hoặc 100000 nếu Người phụ trách quy định); mã giao dịch TEST mới.',
  pre='Một yêu cầu nạp 100.000đ đang "Chờ" (SP-B). Ghi số dư SP-B.',
  steps=[
    ('Admin xác nhận với số tiền thực nhận KHÁC số đề nghị.', 'Hệ thống hiển thị rõ số đề nghị và số thực nhận; cho xác nhận theo số thực nhận (hoặc cảnh báo nếu chính sách yêu cầu).'),
    ('Shipper mở ví.', 'Số dư tăng ĐÚNG số tiền thực nhận Admin đã nhập; lịch sử có một dòng nạp đúng số đó.'),
  ],
  restore='Ghi nhận số dư mới của SP-B.', ref=FINADM + ' (Số tiền thực nhận, Tiền đề nghị)',
  auto='tests/integration/m04-admin-topup.int.spec.ts', sev='Cao')

T('TC-WAL-010', ngay=5, seq=5, ten='Shipper mới phải nạp tối thiểu một lần được xác nhận mới nhận được đơn',
  muc_dich='Shipper mới (chưa có tổng nạp đã xác nhận đạt mức nạp tối thiểu) không nhận được đơn dù có yêu cầu nạp đang chờ.',
  prio='P0', actor='Shipper (SP-B)', dev=('P3',), phones=1, deps='TC-ACC-005',
  pre='SP-B mới đăng ký, ví 0đ; có thể có một yêu cầu nạp "Chờ xử lý" nhưng chưa được Admin xác nhận.',
  steps=[
    ('Trang chủ, đọc lý do dưới trạng thái.', 'Báo rõ chưa đủ điều kiện (ví chưa đủ/ cần nạp).'),
    ('Chạm "Bật online".', 'Không bật được ("Chưa bật được nhận đơn").'),
    ('(Khi Admin đã xác nhận nạp cho SP-B) Quay lại Trang chủ và bật online.', 'Bật được. (Test này gắn với TC-WAL-005/009.)'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu yêu cầu nạp "Chờ" đã được tính như tiền.',
  restore=R_NONE, ref='apps/backend/src/wallet/wallet-driver-port.ts (initialFundingRequired, confirmedTopupVnd); docs/current/M03-simplified-onboarding-20261020.md',
  auto='tests/integration/m03-shipper.int.spec.ts; m04-topup-requests.int.spec.ts', sev='Cao')

T('TC-WAL-011', ngay=5, seq=6, ten='Lịch sử giao dịch: lọc "Nạp tiền", "Hoa hồng", "Tạm giữ"',
  muc_dich='Shipper xem và lọc đầy đủ lịch sử ví; mỗi dòng có số tiền, số dư sau và thời gian.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-FLOW-001',
  pre='SP-A đã có nạp, hoa hồng và tạm giữ/giải phóng (sau TC-FLOW-001 và TC-FLOW-026).',
  steps=[
    ('Ví > "Xem tất cả" ở "Giao dịch gần đây".', 'Màn "Lịch sử giao dịch" với các nhãn lọc "Tất cả", "Nạp tiền", "Rút tiền", "Hoa hồng", "Tạm giữ".'),
    ('Chạm "Nạp tiền".', 'Chỉ hiện các dòng nạp.'),
    ('Chạm "Hoa hồng".', 'Chỉ hiện các dòng hoa hồng, mỗi dòng ứng với một đơn hoàn thành.'),
    ('Chạm "Tạm giữ".', 'Hiện các dòng tạm giữ và giải phóng; có chú thích "Tạm giữ là thông tin giữ chỗ, không phải khoản trừ trong sổ giao dịch."'),
    ('Chạm một dòng giao dịch bất kỳ.', 'Mở "Thông tin giao dịch" với số tiền, loại, thời gian, trạng thái.'),
    ('Cuộn cuối danh sách; chạm "Tải thêm" nếu có.', 'Tải thêm các dòng cũ hơn (mỗi lần 50 dòng); không mất dòng nào.'),
  ],
  restore=R_NONE, ref=WALV + ' (TxnHistoryScreen, txnFilterLabel)', auto='mobile/packages/n11_shared/test/wallet_views_test.dart; wallet_http_test.dart')

T('TC-WAL-012', ngay=5, seq=7, ten='Đối chiếu tay: tổng số dư = tổng các dòng giao dịch',
  muc_dich='Phát hiện tiền "tự nhiên mất hoặc tăng sai": cộng trừ lại sổ giao dịch phải ra đúng số dư hiện tại.',
  prio='P0', actor='Shipper + ADMIN', dev=('P3', 'PC'), phones=1, deps='TC-FLOW-026', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Dùng bảng tính (Excel) do tester tự ghi từ màn hình, không cần truy cập cơ sở dữ liệu.',
  pre='SP-A có ít nhất 3 loại giao dịch (nạp, tạm giữ/giải phóng, hoa hồng). Ghi lại TẤT CẢ dòng giao dịch từ cũ đến mới (loại, số tiền).',
  steps=[
    ('Ở "Lịch sử giao dịch" (lọc "Tất cả") chép lại từng dòng vào bảng tính: thời gian, loại, số tiền (+/-).', 'Có bảng đầy đủ các dòng.'),
    ('Tính: Tổng nạp - tổng hoa hồng - các khoản rút (nếu có).', 'Kết quả = "Tổng số dư" hiện trên màn Ví. (Các dòng "Tạm giữ"/"Giải phóng" chỉ là thông tin, không cộng trừ.)'),
    ('Tính khả dụng: Tổng số dư - tiền đang tạm giữ.', 'Kết quả = "Số dư khả dụng".'),
    ('Admin mở Web Admin > Tài chính > Ví Shipper, tìm SP-A.', 'Số dư B, tạm giữ H và khả dụng A = B - H khớp với app (tên và số điện thoại được che bớt).'),
    ('Admin mở Tài chính > Đối soát > "Chạy kiểm tra và ghi nhận kết quả".', 'Hiện "Đã chạy kiểm tra: không có lệch." Nếu có ví lệch: ghi lỗi NGHIÊM TRỌNG.'),
  ],
  verdict=DEFAULT_VERDICT + ' Mọi chênh lệch dù chỉ 1đ giữa các con số là lỗi NGHIÊM TRỌNG.',
  restore=R_NONE, ref=FINOPS + ' (Đối soát, Ví lệch sổ giao dịch); docs/current/ADR-004-driver-wallet-consistency.md',
  auto='tests/integration/m04-wallet-core.int.spec.ts; m04-withdrawals.int.spec.ts (reconciliation)', sev='NGHIÊM TRỌNG')

T('TC-WAL-013', ngay=5, seq=8, ten='Ví không đủ tiền hoa hồng thì không nhận được đơn mới, nhưng đơn đang giao vẫn hoàn tất',
  muc_dich='Khi số dư khả dụng không còn đủ hoa hồng, shipper không nhận thêm đơn; không bao giờ hủy đơn đang giao vì số dư giảm.',
  prio='P0', actor='Shipper', dev=('P3',), phones=1, deps='TC-FLOW-001',
  note='Cần đưa số dư khả dụng của SP-B về dưới mức hoa hồng (ví dụ 500đ). Cách: SP-B chỉ có dư lại sau khi đã bị trừ hoa hồng nhiều lần; hoặc dùng SP-B với số dư đúng bằng hoa hồng rồi nhận 1 đơn (hold = toàn bộ số dư), khi đó đơn thứ hai không nhận được. Hỏi Người phụ trách cách chuẩn bị an toàn.',
  pre='SP-B số dư khả dụng đúng bằng hoa hồng một đơn (hoặc thấp hơn).',
  steps=[
    ('SP-B nhận đơn thứ nhất (khi còn đủ).', 'Nhận được; khả dụng về 0 (toàn bộ tiền bị tạm giữ).'),
    ('Quán gọi thêm một đơn; SP-B mở "Có thể nhận".', 'Không nhận được đơn thứ hai: thẻ đơn không đủ điều kiện kèm lý do số dư thấp (hoặc không hiện).'),
    ('SP-B tiếp tục lấy hàng và giao thành công đơn thứ nhất.', 'Hoàn tất bình thường dù khả dụng đang 0; hoa hồng thu từ khoản đã tạm giữ; tổng số dư không âm.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu số dư âm hoặc đơn đang giao bị hủy vì thiếu tiền.',
  restore='Nạp thêm tiền thử nghiệm cho SP-B (TC-WAL-005) trước test sau.', ref='apps/backend/src/shipping-policy/shipping-eligibility.ts (BALANCE_TOO_LOW); docs/current/M03-simplified-onboarding-20261020.md ("Không hủy đơn đang giao khi số dư giảm")',
  auto='tests/integration/m06-shipping-eligibility.int.spec.ts; m07-delivery.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-WAL-014', ngay=5, seq=9, ten='Yêu cầu dừng hoạt động của shipper: tắt nhận đơn ngay, đơn đang giao vẫn hoàn tất',
  muc_dich='Shipper muốn nghỉ thì gửi yêu cầu dừng hoạt động; không mất tiền và đơn đang giao vẫn phải hoàn tất.',
  prio='P1', actor='Shipper (SP-B)', dev=('P3',), phones=1, deps='TC-WAL-009',
  pre='SP-B có số dư dương, KHÔNG có đơn đang giao. (Dùng SP-B, không dùng SP-A vì SP-A cần cho test khác.)',
  steps=[
    ('Tab "Tài khoản" > "Dừng hoạt động / Rút tiền".', 'Màn có "Gửi yêu cầu ngừng hoạt động" với nội dung "Bạn sẽ ngừng nhận đơn mới ngay. Các đơn đang giao vẫn phải hoàn tất. Số dư ví của bạn không bị mất. Bạn có thể hủy yêu cầu khi chưa được xử lý."'),
    ('Chạm "Gửi yêu cầu" và xác nhận ("Ngừng hoạt động?").', 'Hiện "Đã gửi yêu cầu ngừng hoạt động"; trạng thái hồ sơ "Đang đóng hồ sơ"/"Bạn đã ngừng nhận đơn mới." Nút bật online không còn dùng được.'),
    ('Nhìn bước kế tiếp.', 'Hiện yêu cầu nhập ngân hàng nhận hoàn tiền ("Nhập ngân hàng nhận hoàn tiền", "Chọn ngân hàng", "Số tài khoản", "Tên chủ tài khoản" - phải khớp họ tên shipper).'),
    ('Chạm "Hủy yêu cầu ngừng hoạt động" (nếu muốn quay lại).', 'Trở lại trạng thái hoạt động; có thể bật online lại khi ví đủ điều kiện.'),
  ],
  restore='Hủy yêu cầu ngừng hoạt động để dùng lại SP-B.', ref=DRVV + ' (Dừng hoạt động / Rút tiền); docs/current/M03-simplified-onboarding-20261020.md',
  auto='tests/integration/m03-shipper.int.spec.ts; m04-withdrawals.int.spec.ts')

T('TC-WAL-015', ngay=5, seq=10, ten='Rút toàn bộ số dư khi dừng hoạt động: Admin nhận xử lý và ghi nhận đã chuyển (tiền thử nghiệm)',
  muc_dich='Đường rút tiền duy nhất hiện nay: shipper đóng tài khoản và rút toàn bộ số dư; Admin chuyển khoản thủ công ngoài hệ thống rồi ghi nhận; ví bị trừ đúng một lần.',
  prio='P0', actor='Shipper + ADMIN', dev=('P3', 'PC'), phones=1, deps='TC-WAL-014', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE + ' TUYỆT ĐỐI không chuyển tiền thật. Dùng tài khoản ngân hàng thử nghiệm đã được Admin xác minh (nếu Người phụ trách cung cấp) và mã giao dịch chuyển đi THỬ NGHIỆM. Nếu Người phụ trách không cho phép ghi nhận chuyển tiền thử nghiệm, test dừng ở bước 3 (Nhận xử lý) và ghi BLOCKED phần còn lại. Quy trình tách người: người nhận xử lý và người đối soát có thể khác nhau.',
  data='Chỉ dùng tài khoản SP-B (tài khoản thử). Ngân hàng: ngân hàng thử do Người phụ trách chỉ định; tên chủ tài khoản trùng họ tên shipper "Shipper Test B".',
  pre='SP-B đã gửi yêu cầu ngừng hoạt động (TC-WAL-014), không có đơn/tiền giữ/yêu cầu nạp chờ. ADMIN có quyền tài chính "xử lý rút tiền".',
  steps=[
    ('Shipper nhập ngân hàng nhận hoàn tiền (ngân hàng thử, số tài khoản thử, tên chủ tài khoản khớp), chạm "Lưu tài khoản ngân hàng".', 'Hiện "Đã lưu tài khoản ngân hàng. Quản trị viên sẽ xác minh." Trạng thái "Chờ xác minh".'),
    ('Admin vào VẬN HÀNH > Shipper > SP-B, chạm "Xác minh ngân hàng" và xác nhận.', 'Ngân hàng chuyển "Đã xác minh".'),
    ('Shipper chạm "Rút toàn bộ số dư ví" (hoặc "Yêu cầu rút tiền"), xác nhận.', 'Hiện "Yêu cầu đã được gửi. Admin sẽ chuyển tiền và xác nhận kết quả."; toàn bộ số dư bị TẠM GIỮ ("Tiền tạm giữ" = số dư), tổng số dư chưa đổi.'),
    ('Admin: TÀI CHÍNH > Rút tiền > mở yêu cầu của SP-B > "Nhận xử lý (tôi sẽ chuyển khoản thủ công)" và xác nhận.', 'Yêu cầu sang "Đang xử lý"; Admin thấy tài khoản nhận đầy đủ (chỉ người nhận xử lý thấy), số tiền yêu cầu.'),
    ('Admin: "Ghi nhận đã chuyển": nhập "Số tiền đã chuyển (VND)" ĐÚNG bằng số yêu cầu, "Mã giao dịch chuyển đi" thử nghiệm, tài khoản hệ thống đã dùng, thời điểm chuyển; xác nhận ("Xác nhận đã chuyển tiền?").', 'Yêu cầu chuyển "Đã chuyển và ghi nhận". Ví shipper: tổng số dư trừ đúng số tiền; tạm giữ về 0; đúng MỘT dòng "Rút tiền".'),
    ('Shipper mở màn yêu cầu rút.', 'Hiện "Admin đã chuyển tiền tới tài khoản nhận của bạn." Số dư ví = 0 (hoặc phần còn lại đúng).'),
    ('Admin bấm xác nhận lần nữa/ghi nhận lần hai (nếu còn nút).', 'Không ghi nhận lần hai; số dư không âm.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu ví bị trừ hai lần, số dư âm hoặc yêu cầu rút ghi nhận khi chưa qua các bước.',
  restore='Tài khoản SP-B ở trạng thái đóng sau test này: dùng tài khoản mới nếu cần tiếp tục thử shipper.',
  ref=FINOPS + ' (Nhận xử lý, Ghi nhận đã chuyển); docs/current/M04-C-withdrawal-completion-20261018.md; M03-simplified-onboarding',
  auto='tests/integration/m04-withdrawals.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-WAL-016', ngay=5, seq=11, ten='Rút tiền: Admin nhập số tiền chuyển khác số yêu cầu thì không kết luận "đã chuyển đủ"',
  muc_dich='Hệ thống không cho coi là hoàn tất khi số tiền chuyển lệch; chuyển một phần chưa được Owner duyệt nên phải để "Cần đối soát".',
  prio='P1', actor='ADMIN', dev=('PC',), phones=0, deps='TC-WAL-015', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE,
  pre='Một yêu cầu rút ở trạng thái "Đang xử lý" do bạn nhận xử lý (làm lại TC-WAL-015 với tài khoản thử khác).',
  steps=[
    ('Chọn "Ghi nhận đã chuyển" và nhập số tiền chuyển KHÁC số yêu cầu.', 'Hiện cảnh báo "Số tiền khác số tiền yêu cầu: không thể kết luận "đã chuyển đủ". Giữ trạng thái cần đối soát." và không cho hoàn tất.'),
    ('Chạm "Chuyển sang cần đối soát" và xác nhận.', 'Yêu cầu sang "Cần đối soát"; tiền vẫn bị giữ ("Yêu cầu giữ nguyên, tiền vẫn bị giữ.").'),
    ('Kiểm tra ví shipper.', 'Số dư chưa bị trừ; tạm giữ vẫn còn.'),
  ],
  restore='Xử lý đối soát theo hướng dẫn của Người phụ trách (chọn kết luận đối soát phù hợp, KHÔNG chuyển tiền thật).',
  ref=FINOPS + ' (Chuyển sang cần đối soát, Đối soát)', auto='tests/integration/m04-withdrawals.int.spec.ts', sev='Cao')

T('TC-WAL-017', ngay=5, seq=12, ten='Shipper hủy yêu cầu rút tiền khi còn "Chờ xử lý": tiền được giải phóng',
  muc_dich='Hủy yêu cầu rút chưa xử lý thì số tiền đang giữ trả lại khả dụng.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1, deps='TC-WAL-014', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='SP (tài khoản thử đang trong trạng thái đóng) đã gửi yêu cầu rút "Chờ xử lý" và Admin CHƯA nhận xử lý.',
  steps=[
    ('Shipper mở chi tiết yêu cầu rút, chạm "Hủy yêu cầu".', 'Hộp "Hủy yêu cầu rút?" nói "Yêu cầu rút tiền sẽ bị hủy và số tiền đang giữ được giải phóng."'),
    ('Chạm nút xác nhận trong hộp thoại hủy yêu cầu.', 'Hiện "Yêu cầu đã được hủy. Số tiền đang giữ đã được giải phóng."; số dư khả dụng trở lại.'),
  ],
  restore='Giữ trạng thái; tạo yêu cầu mới nếu cần.', ref=WALV + ' (WithdrawDetailScreen)', auto='tests/integration/m04-withdrawals.int.spec.ts')

T('TC-WAL-018', ngay=5, seq=13, ten='Tài chính Admin: tổng quan, danh sách ví và giao dịch',
  muc_dich='Admin có quyền thấy tổng số dư, tạm giữ, khả dụng và danh sách giao dịch khớp nhau.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-WAL-005',
  pre='Đã có vài giao dịch thử nghiệm (nạp, hoa hồng).',
  steps=admin_login('SYSTEM') + [
    menu_go('TÀI CHÍNH > Tài chính > "Tổng quan"'),
    ('Đọc các số: "Tổng số dư ví", "Tổng khả dụng", "Tổng hold đang giữ", "Yêu cầu nạp chờ xử lý", "Yêu cầu rút chờ xử lý", "Hoa hồng đã thu".', 'Các số hiển thị (kèm dòng giải thích rằng số liệu đọc trực tiếp tại một thời điểm, không có số liệu giả hoặc ước tính). Tổng khả dụng = Tổng số dư - Tổng hold.'),
    menu_go('TÀI CHÍNH > Tài chính > "Ví Shipper"'),
    ('Trong danh sách ví, gõ tên hoặc số điện thoại SP-A vào ô tìm kiếm và mở dòng của SP-A.', 'Ví SP-A có số dư B, tạm giữ H, khả dụng A đúng như app.'),
    menu_go('TÀI CHÍNH > Tài chính > "Giao dịch"'),
    ('Lọc theo SP-A.', 'Hiện các dòng giao dịch của SP-A khớp với lịch sử trong app (số tiền, loại, thứ tự thời gian).'),
  ],
  restore='Đăng xuất Web Admin.', ref=FINV + '; ' + FINOPS, auto='tests/integration/m04-finance-access.int.spec.ts; admin-finance-browser.int.spec.ts')

T('TC-WAL-019', ngay=5, seq=14, ten='Phân quyền tài chính: ADMIN không có quyền thì không thấy hoặc không thao tác được',
  muc_dich='Quyền tiền cấp riêng từng chức năng và do SYSTEM cấp; quyền xem ứng dụng khác không kéo theo quyền tiền.',
  prio='P0', actor='ADMIN-2 + SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-008',
  pre='ADMIN-2 chỉ có quyền Xem ứng dụng Quán (không có quyền tiền).',
  steps=admin_login('ADMIN-2') + [
    ('Nhìn menu bên trái.', 'KHÔNG thấy mục "TÀI CHÍNH" (hoặc chỉ thấy mục con được cấp).'),
    ('Gõ trực tiếp địa chỉ trang tài chính (ví dụ phần đuôi /finance... theo Người phụ trách) vào thanh địa chỉ.', 'Hiện "Không có quyền" hoặc "Cần quyền xem yêu cầu nạp tiền"; không có dữ liệu tài chính nào hiện ra.'),
    ('SYSTEM cấp cho ADMIN-2 quyền "Xem yêu cầu nạp tiền" (Phân quyền); ADMIN-2 tải lại.', 'ADMIN-2 xem được danh sách nạp nhưng KHÔNG có nút "Kiểm tra và xác nhận" (chỉ có khi được cấp quyền "Xác nhận / từ chối nạp tiền").'),
  ],
  restore='SYSTEM thu hồi quyền vừa cấp cho ADMIN-2 (Phân quyền).', ref='apps/admin-web/src/core/menu.ts; finance-admin-view.ts ("Bạn chỉ có quyền xem…"); apps/backend/src/finance-access',
  auto='tests/integration/m04-finance-access.int.spec.ts; m12-access.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-WAL-020', ngay=5, seq=15, ten='SYSTEM quản lý "Tài khoản nhận tiền" của hệ thống; ADMIN không có quyền',
  muc_dich='Chỉ SYSTEM thêm/bật/tắt tài khoản mà shipper chuyển tiền nạp vào. Số tài khoản hiển thị che bớt.',
  prio='P1', actor='SYSTEM, ADMIN', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE + ' Chỉ thêm tài khoản thử nghiệm do Người phụ trách chỉ định.',
  pre='SYSTEM đăng nhập.',
  steps=[
    menu_go('TÀI CHÍNH > Tài chính > "Tài khoản nhận tiền"'),
    ('Chạm "Thêm tài khoản", nhập tài khoản thử (theo Người phụ trách), lưu.', 'Tài khoản mới ở trạng thái "Đã tắt" ("Tài khoản mới ở trạng thái tắt cho đến khi bạn bật.").'),
    ('Chạm "Bật nhận tiền" và xác nhận ("Bật nhận tiền cho tài khoản này?").', 'Trạng thái "Đang bật"; số tài khoản được che.'),
    ('Chạm "Tắt nhận tiền" > xác nhận.', 'Trạng thái "Đã tắt"; shipper không còn thấy tài khoản này khi nạp (nếu không còn tài khoản nào bật: ứng dụng báo chưa cấu hình).'),
    ('Đăng nhập bằng ADMIN-1 và tìm mục này.', 'ADMIN không thấy/không vào được ("Chỉ SYSTEM xem và quản lý.").'),
  ],
  restore='Tắt hoặc xóa tài khoản thử; bật lại tài khoản thử dùng cho test nạp nếu cần.', ref=FINADM + ' (Tài khoản nhận tiền)',
  auto='tests/integration/m04-finance-access.int.spec.ts')

T('TC-WAL-021', ngay=5, seq=16, ten='SYSTEM đổi mức hoa hồng: chỉ áp dụng cho đơn nhận sau đó',
  muc_dich='Mức hoa hồng đổi không làm thay đổi hoa hồng đã chốt của đơn đang chạy.',
  prio='P1', actor='SYSTEM + Shipper', dev=('PC', 'P3'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Thay đổi cấu hình tài chính thật. Chỉ làm khi Owner cho phép; đặt lại mức cũ sau test.',
  data='Mức mới: 2000 (đ/đơn); sau test đặt lại về mức ban đầu.',
  pre='SYSTEM đăng nhập. SP-A đã nhận một đơn với mức hoa hồng cũ (tạm giữ đã chốt).',
  steps=[
    ('Web Admin > Tài chính > Rút tiền hoặc trang có "Đổi mức hoa hồng", chạm "Đổi mức hoa hồng".', 'Hiện mức "Đang áp dụng: … / đơn".'),
    ('Nhập mức mới 2000, "Kiểm tra và đổi mức hoa hồng", xác nhận.', 'Hiện "Đã đổi mức hoa hồng: máy chủ đã xác nhận. Chỉ áp dụng cho đơn nhận sau thời điểm này."'),
    ('SP-A hoàn thành đơn đã nhận TRƯỚC khi đổi.', 'Hoa hồng thu = mức CŨ đã chốt lúc nhận.'),
    ('SP-A nhận và hoàn thành một đơn mới.', 'Hoa hồng thu = mức MỚI 2000đ.'),
    ('Đặt lại mức hoa hồng về giá trị ban đầu.', 'Mức hiện hành về như cũ.'),
  ],
  restore='Mức hoa hồng phải về như ban đầu.', ref=FINOPS + ' (Đổi mức hoa hồng); docs/current/M04-C-withdrawal-completion-20261018.md',
  auto='tests/integration/m04-withdrawals.int.spec.ts (commission policy)', sev='Cao')

T('TC-WAL-022', ngay=5, seq=17, ten='SYSTEM đổi mức nạp/rút tối thiểu; ADMIN chỉ xem',
  muc_dich='Các tham số ví chỉ SYSTEM sửa; mọi quản trị viên xem được.',
  prio='P1', actor='SYSTEM, ADMIN', dev=('PC',), phones=0,
  data='Mức nạp tối thiểu hiện tại là N; thử đổi thành N + 10000 rồi đặt lại N.',
  pre='SYSTEM và ADMIN-1 đều có tài khoản.',
  steps=[
    ('SYSTEM: HỆ THỐNG > Tham số hệ thống > "Ví Shipper".', 'Thấy "Nạp tối thiểu mỗi yêu cầu" và "Rút tối thiểu mỗi yêu cầu" (có nút sửa).'),
    ('Sửa mức nạp tối thiểu, ghi lý do, xác nhận lưu.', 'Lưu thành công, ghi nhật ký thay đổi.'),
    ('Trên 11Ship: Ví > Nạp tiền.', 'Dòng "Tối thiểu … mỗi lần nạp" hiển thị mức mới.'),
    ('SYSTEM đặt lại mức cũ.', 'Dòng "Tối thiểu … mỗi lần nạp" trên 11Ship hiện lại đúng mức ban đầu (đã khôi phục cấu hình).'),
    ('ADMIN-1 mở cùng trang.', 'Xem được giá trị nhưng không có nút sửa ("Chỉ tài khoản SYSTEM được sửa tham số.").'),
  ],
  restore='Đặt lại mức nạp/rút tối thiểu như ban đầu.', ref='apps/admin-web/src/core/config.ts (topup_min_vnd, withdraw_min_vnd); shipping-policy-view.ts',
  auto='tests/integration/m12-config.int.spec.ts; m04-finance-access.int.spec.ts')

T('TC-WAL-023', ngay=5, seq=18, ten='Admin hoàn tất đóng tài khoản shipper chỉ khi đã tất toán',
  muc_dich='Không đóng được tài khoản khi còn đơn, số dư, tiền giữ, nạp chờ hoặc yêu cầu rút mở.',
  prio='P1', actor='ADMIN + Shipper', dev=('PC', 'P3'), phones=1, deps='TC-WAL-015', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Một shipper thử đang "Đang đóng hồ sơ".',
  steps=[
    ('Admin mở trang shipper đó, chạm "Hoàn tất ngừng hoạt động" khi vẫn còn số dư/ yêu cầu rút mở.', 'Máy chủ từ chối với lý do rõ (còn số dư/đơn/yêu cầu); không đóng.'),
    ('Xử lý hết (rút toàn bộ, không còn tiền giữ) rồi bấm lại.', 'Hồ sơ chuyển "Đã đóng"; shipper mất quyền hoạt động nhưng lịch sử vẫn còn; vẫn đăng nhập như khách hàng.'),
  ],
  restore='Tài khoản thử đã đóng; không dùng lại.', ref=FINOPS + '; apps/admin-web/src/dom/shippers-view.ts (Hoàn tất ngừng hoạt động)',
  auto='tests/integration/m04-withdrawals.int.spec.ts; m03-shipper.int.spec.ts')

T('TC-WAL-024', ngay=5, seq=19, ten='Mất mạng hoặc bấm lặp khi tạo yêu cầu nạp/rút: không tạo trùng, không trừ hai lần',
  muc_dich='Giao dịch tiền phải an toàn khi mạng chập chờn: gửi lại cùng một yêu cầu chỉ có một kết quả.',
  prio='P0', actor='Shipper', dev=('P3',), phones=1, deps='TC-WAL-003', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note=MONEY_NOTE,
  pre='Ở màn "Xác nhận nạp tiền" với số tiền hợp lệ.',
  steps=[
    ('Bấm "Tôi đã chuyển tiền" nhiều lần liên tiếp thật nhanh.', 'Chỉ MỘT yêu cầu nạp được tạo.'),
    ('Làm lại với mạng yếu: bật Chế độ máy bay ngay sau khi bấm "Tôi đã chuyển tiền", rồi tắt.', 'Ứng dụng báo "Chưa gửi được yêu cầu. Vui lòng thử lại." hoặc tương tự; khi thử lại không tạo yêu cầu thứ hai nếu lần đầu đã thành công.'),
    ('Vào danh sách yêu cầu nạp (trong app và Web Admin).', 'Mỗi lần nhấn chỉ tương ứng tối đa MỘT yêu cầu; số dư chưa đổi.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu có hai yêu cầu cho cùng một lần bấm hoặc số dư đổi khi chưa có Admin.',
  restore='Hủy các yêu cầu thử còn "Chờ xử lý".', ref='mobile/packages/n11_shared/lib/src/wallet/wallet_http.dart (giữ Idempotency-Key khi chưa rõ kết quả)',
  auto='tests/integration/m04-topup-requests.int.spec.ts; idempotency-executor.int.spec.ts; mobile/packages/n11_shared/test/wallet_http_test.dart', sev='NGHIÊM TRỌNG')

T('TC-WAL-025', ngay=5, seq=20, ten='Admin điều chỉnh tài chính từ phản ánh (thu thêm / hoàn hoa hồng)',
  muc_dich='Điều chỉnh tiền sau khiếu nại chỉ thực hiện bởi người có quyền tiền riêng; thiếu số dư thì chờ xử lý, không làm ví âm.',
  prio='P1', actor='ADMIN (có quyền điều chỉnh) + Shipper', dev=('PC', 'P3'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN XÁC MINH',
  note=MONEY_NOTE + ' Cần một hồ sơ phản ánh thử gắn với một đơn đã giao (làm sau TC-FEED-003). Quyền điều chỉnh chỉ SYSTEM hoặc ADMIN được cấp riêng.',
  pre='Một hồ sơ phản ánh thử đang mở. ADMIN có quyền "điều chỉnh tài chính".',
  steps=[
    ('Admin mở hồ sơ phản ánh > mục "Điều chỉnh tài chính", chọn hướng "Hoàn cho shipper" hoặc thu thêm, nhập số tiền nhỏ và lý do.', 'Hiện cảnh báo "Cần quyền tiền riêng. Thiếu số dư hoặc chưa thực hiện được thì chờ xử lý tài chính, không âm ví hay dùng tiền đang giữ."'),
    ('Gửi yêu cầu điều chỉnh.', 'Nếu đủ số dư: ghi một dòng điều chỉnh vào ví; nếu thiếu: trạng thái "Chờ xử lý tài chính", ví KHÔNG âm.'),
    ('Shipper xem ví.', 'Số dư thay đổi đúng số điều chỉnh (nếu đã thực hiện) hoặc không đổi (nếu đang chờ); lịch sử hiện dòng tương ứng.'),
  ],
  restore='Ghi nhận mọi điều chỉnh đã làm vào ô ghi chú để đối soát.', ref='apps/admin-web/src/dom/feedback-view.ts (Điều chỉnh tài chính); docs/current/M11-implementation-20261018.md mục 2.7, 3',
  auto='tests/integration/m11-adjustment-real.int.spec.ts; m11-admin-feedback.int.spec.ts', sev='NGHIÊM TRỌNG')

# =====================================================================================================
# ADM - Web Admin
# =====================================================================================================

T('TC-ADM-001', ngay=1, seq=40, ten='Mở Web Admin bằng trình duyệt và thấy trang đăng nhập',
  muc_dich='Người kiểm thử vào được trang quản trị bằng địa chỉ do Người phụ trách cung cấp (kết nối an toàn https).',
  prio='P0', actor='Quản trị', dev=('PC',), phones=0,
  pre='Có địa chỉ Web Admin (Người phụ trách cung cấp; theo cấu hình hiện tại của dự án là https://103.9.78.67.sslip.io). Trình duyệt Chrome/Edge/Firefox bản mới.',
  steps=[
    ('Mở trình duyệt, gõ địa chỉ Web Admin vào thanh địa chỉ, bấm Enter.', 'Hiện trang "Đăng nhập quản trị" (dòng "Dành cho tài khoản được cấp quyền."), có ô "Số điện thoại", "Mật khẩu", nút "Tiếp tục" và liên kết "Quên mật khẩu?". Có biểu tượng ổ khóa/"Bảo mật" trên thanh địa chỉ (không có cảnh báo chứng chỉ).'),
    ('Chạm biểu tượng con mắt cạnh ô mật khẩu ("Hiện mật khẩu").', 'Mật khẩu đang gõ hiện/ẩn được ("Ẩn mật khẩu").'),
    ('Mở cùng địa chỉ trên điện thoại.', 'Trang vẫn dùng được trên màn hình nhỏ (menu thu gọn).'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/view.ts (#mountLogin); apps/backend/src/http/admin-web-hosting.ts',
  auto='tests/integration/admin-web-browser.int.spec.ts; admin-web-hosted-browser.int.spec.ts')

T('TC-ADM-002', ngay=1, seq=41, ten='SYSTEM đăng nhập Web Admin (mật khẩu + mã Authenticator) và đăng xuất',
  muc_dich='Tài khoản quyền cao nhất đăng nhập hai lớp (mật khẩu và mã 6 số đổi liên tục). SYSTEM là tài khoản do kỹ thuật viên tạo; người mới không tự tạo được.',
  prio='P0', actor='SYSTEM', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Kỹ thuật viên/Người phụ trách cung cấp thông tin đăng nhập SYSTEM và đã cài Google Authenticator (hoặc tương đương) cho tài khoản đó trên điện thoại của bạn.',
  steps=admin_login('SYSTEM') + [
    ('Nhìn menu bên trái.', 'Thấy đầy đủ các nhóm: Tổng quan, Điều hành, Báo cáo; TÀI KHOẢN (Người dùng, Quản trị viên, Phân quyền, Lời mời Admin); VẬN HÀNH (Quán, Shipper, Đơn hàng, Giao hàng, Thông báo, Đánh giá, Phản ánh); DANH MỤC; TÀI CHÍNH; VẬN HÀNH HỆ THỐNG; HỆ THỐNG.'),
    ('Chạm tên tài khoản/"Menu tài khoản" ở góc trên, chọn "Đăng xuất".', 'Hiện "Đang đăng xuất…" rồi quay về trang đăng nhập; nút Back của trình duyệt không mở lại được trang quản trị.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/view.ts; apps/admin-web/src/core/menu.ts; docs/current/M01-final-package-20261014.md',
  auto='tests/integration/admin-auth.int.spec.ts; admin-web-browser.int.spec.ts')

T('TC-ADM-003', ngay=1, seq=42, ten='Đăng nhập Web Admin sai mật khẩu hoặc sai mã Authenticator',
  muc_dich='Đăng nhập sai bị từ chối bằng thông báo chung; sai nhiều lần bị khóa tạm thời.',
  prio='P0', actor='Quản trị', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Cẩn thận: sai nhiều lần sẽ khóa tài khoản tạm thời. Chỉ thử vài lần, dùng tài khoản ADMIN-2 (không dùng SYSTEM).',
  data='Mật khẩu sai "SaiHetRoi1"; mã Authenticator sai "000000".',
  pre='ADMIN-2 đã kích hoạt (TC-ADM-006).',
  steps=[
    ('Nhập số điện thoại ADMIN-2 và mật khẩu SAI rồi "Tiếp tục".', 'Báo lỗi chung ("Số điện thoại hoặc mật khẩu không đúng" hoặc tương tự); không vào bước mã.'),
    ('Nhập mật khẩu ĐÚNG; ở bước "Xác thực hai bước" nhập mã "000000".', 'Báo mã không đúng; không vào được.'),
    ('Nhập mã đúng từ Authenticator.', 'Đăng nhập được.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/view.ts; apps/backend/src/admin-auth',
  auto='tests/integration/admin-auth.int.spec.ts; admin-auth-limits.int.spec.ts')

T('TC-ADM-004', ngay=1, seq=43, ten='SYSTEM tạo lời mời ADMIN và phân quyền ban đầu',
  muc_dich='ADMIN không tự đăng ký: chỉ SYSTEM mời. Lời mời có liên kết kích hoạt dùng một lần.',
  prio='P0', actor='SYSTEM', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  data='Họ tên "Admin Test 1", số điện thoại SĐT-ADMIN-1 (SIM thật nhận được SMS). Quyền: Quán - Xem + Quản lý hoạt động quán + Khóa; Shipper - Xem + Duyệt hồ sơ + Khóa; Đơn hàng/Giao hàng theo mặc định; nhóm món (Danh mục); quyền tiền: Xem yêu cầu nạp tiền + Xác nhận/từ chối nạp tiền (nếu cần cho TC-WAL).',
  pre='SYSTEM đăng nhập Web Admin.',
  steps=admin_login('SYSTEM')[:3] + [
    menu_go('TÀI KHOẢN > "Lời mời Admin"'),
    ('Chạm "Tạo lời mời ADMIN".', 'Mở biểu mẫu "Tạo lời mời ADMIN" với "Họ tên", "Số điện thoại", phần "Quyền theo ứng dụng" (Khách hàng/Quán/Shipper: Xem, Duyệt hồ sơ, Khóa/Mở khóa, Nhóm món, Quản lý hoạt động quán).'),
    ('Nhập dữ liệu, chọn quyền, chạm "Tạo lời mời".', 'Hiện "Đã tạo lời mời" cùng "Liên kết kích hoạt" và cảnh báo "Liên kết này là bí mật. Chỉ gửi cho đúng người được mời…". Có nút "Sao chép liên kết".'),
    ('Chạm "Sao chép liên kết" và gửi riêng cho người được mời (ví dụ Zalo cá nhân).', 'Liên kết sao chép được. Trạng thái lời mời "Chờ kích hoạt".'),
  ],
  restore='Thu hồi lời mời ("Thu hồi lời mời") nếu không dùng; nếu đã kích hoạt thì tài khoản ADMIN-1 được dùng tiếp.',
  ref='apps/admin-web/src/dom/provisioning-view.ts; docs/current/M01-final-package-20261014.md',
  auto='tests/integration/admin-provisioning.int.spec.ts; admin-invitations.int.spec.ts')

T('TC-ADM-005', ngay=1, seq=44, ten='Kích hoạt tài khoản ADMIN: mã OTP SMS, đặt mật khẩu, thiết lập Authenticator',
  muc_dich='Người được mời tự kích hoạt trong 3 bước; không ai khác biết mật khẩu hay mã Authenticator.',
  prio='P0', actor='ADMIN-1', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-004',
  pre='Có liên kết kích hoạt chưa dùng của lời mời cho SĐT-ADMIN-1. Điện thoại có ứng dụng Google Authenticator (hoặc Microsoft Authenticator). SMS Gateway đang bật.',
  steps=[
    ('Dán liên kết kích hoạt vào trình duyệt.', 'Hiện trang kích hoạt: "Bước 1/3 · Xác minh số điện thoại" và thông tin lời mời (số che bớt).'),
    ('Chạm "Gửi mã OTP", đợi SMS, nhập "Mã OTP 6 số", "Xác nhận".', 'Chỉ khi tin nhắn đã gửi mới mở ô nhập; xác nhận thành công và sang "Bước 2/3 · Đặt mật khẩu".'),
    ('Nhập mật khẩu 8-128 ký tự ("Tạo mật khẩu mới từ 8 đến 128 ký tự."), nhập lại, "Tiếp tục".', 'Sang "Bước 3/3 · Thiết lập Authenticator" với mã QR và "Hiện khóa thiết lập".'),
    ('Mở Google Authenticator > thêm tài khoản > quét mã QR (hoặc nhập khóa). Nhập mã 6 số đang hiển thị, bấm "Hoàn tất kích hoạt".', 'Kích hoạt thành công; trạng thái lời mời "Đã kích hoạt".'),
    ('Đăng nhập Web Admin bằng ADMIN-1 (số, mật khẩu, mã Authenticator).', 'Vào được; hiện "Vai trò: ADMIN" và chỉ các mục đúng quyền đã cấp.'),
    ('Mở lại liên kết kích hoạt cũ.', 'Không dùng lại được (báo liên kết đã dùng/hết hạn).'),
  ],
  restore='Ghi nhận ADMIN-1 đã sẵn sàng. Mật khẩu/khóa Authenticator giữ riêng, không ghi vào tài liệu.',
  ref='apps/admin-web/src/dom/activation-view.ts; docs/current/M01-production-profile-20261014.md (OTP kích hoạt ADMIN qua SMS Gateway)',
  auto='tests/integration/admin-activation.int.spec.ts; admin-activation-sms-gateway.int.spec.ts')

T('TC-ADM-006', ngay=1, seq=45, ten='Thêm quản trị viên thứ hai (ADMIN-2) chỉ có quyền Xem Quán',
  muc_dich='Cần một ADMIN quyền hạn chế để kiểm thử phân quyền.',
  prio='P0', actor='SYSTEM + ADMIN-2', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-005',
  data='Họ tên "Admin Test 2", SĐT-ADMIN-2. Quyền: CHỈ "Quán - Xem". Không cấp quyền tiền, không cấp quyền khóa.',
  pre='SYSTEM đăng nhập; có số điện thoại thứ hai nhận SMS.',
  steps=[
    ('SYSTEM vào TÀI KHOẢN > "Lời mời Admin" > "Tạo lời mời ADMIN", nhập "Họ tên" và "Số điện thoại" của ADMIN-2, chỉ chọn quyền Xem của ứng dụng Quán, chạm "Tạo lời mời" rồi "Sao chép liên kết" và gửi riêng cho người dùng ADMIN-2.', 'Lời mời được tạo.'),
    ('ADMIN-2 dán liên kết vào trình duyệt, chạm "Gửi mã OTP", nhập mã OTP 6 số trong SMS, đặt mật khẩu 8-128 ký tự hai lần rồi thiết lập Authenticator (nhập mã 6 số) và bấm "Hoàn tất kích hoạt".', 'Kích hoạt thành công.'),
    ('Đăng nhập ADMIN-2 và nhìn menu.', 'Chỉ thấy các mục liên quan đến Quán (ví dụ Người dùng, Quán, Đơn hàng, Giao hàng, Thông báo...). Không thấy Phân quyền, Lời mời Admin, TÀI CHÍNH, Cài đặt hệ thống.'),
  ],
  restore='Giữ ADMIN-2 cho các test phân quyền.', ref='apps/admin-web/src/core/menu.ts (grantsFromPermissions)',
  auto='tests/integration/admin-provisioning.int.spec.ts; m12-access.int.spec.ts')

T('TC-ADM-007', ngay=5, seq=40, ten='Phân biệt quyền ADMIN và SYSTEM: ADMIN không vào được trang chỉ dành cho SYSTEM',
  muc_dich='Quyền chỉ SYSTEM (quản trị viên, phân quyền, lời mời, cài đặt hệ thống, sao lưu) không bị lộ cho ADMIN, kể cả khi gõ địa chỉ trực tiếp.',
  prio='P0', actor='ADMIN-1', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-005',
  pre='Đã đăng nhập ADMIN-1.',
  steps=[
    ('Nhìn danh sách mục ở menu bên trái của Web Admin sau khi đăng nhập ADMIN-1.', 'Không có "Quản trị viên", "Phân quyền", "Lời mời Admin", "Cài đặt hệ thống", "Sao lưu và phục hồi", "Giám sát".'),
    ('Gõ trực tiếp vào thanh địa chỉ phần đuôi /accounts/access rồi Enter (cùng tên miền Web Admin).', 'Hiện trang "Không có quyền" (hoặc quay về trang chủ); KHÔNG thấy dữ liệu phân quyền.'),
    ('Lặp lại với /accounts/administrators, /invitations, /system/settings, /system/backups.', 'Mỗi lần đều bị từ chối như trên.'),
    ('Nếu tải lại trang (F5) ở một trang con báo 404: đó là hạn chế đã biết (xem DOI_CHIEU_CODE_TESTCASE.md), quay về trang chủ rồi đi bằng menu.', 'Ghi nhận hiện tượng nhưng KHÔNG coi là lỗi phân quyền.'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu ADMIN xem hoặc sửa được dữ liệu của trang chỉ dành cho SYSTEM.',
  restore=R_NONE, ref='apps/admin-web/src/core/menu.ts (canOpenRoute); apps/backend/src/admin-access',
  auto='tests/integration/admin-business-decisions.int.spec.ts; m12-access.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-ADM-008', ngay=5, seq=41, ten='ADMIN-2 (chỉ quyền Xem Quán) không thao tác được các hành động cần quyền cao hơn',
  muc_dich='Menu chỉ là tiện ích; máy chủ kiểm quyền lại ở mỗi thao tác. Thử thao tác bị cấm phải bị từ chối.',
  prio='P0', actor='ADMIN-2', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-006',
  pre='ADMIN-2 đăng nhập. Có một quán thử không có đơn đang chạy.',
  steps=[
    ('Mở VẬN HÀNH > Quán, mở chi tiết một quán.', 'Xem được thông tin.'),
    ('Tìm nút "Vô hiệu hóa quán".', 'Không có nút, hoặc nút khóa kèm lý do thiếu quyền ("Quản lý hoạt động quán").'),
    ('Mở Người dùng, tìm nút "Khóa".', 'Không có thao tác khóa/mở khóa ("Bạn không có thao tác khóa, mở khóa hoặc xóa với tài khoản này.").'),
    ('Mở Đơn hàng, tìm "Hủy đơn món" hoặc "Đóng không hoàn tất".', 'Không có hoặc báo thiếu quyền ("Tài khoản này không có quyền thực hiện thao tác này.").'),
  ],
  verdict=DEFAULT_VERDICT + ' FAIL NGHIÊM TRỌNG nếu thao tác cấm thành công.',
  restore=R_NONE, ref='apps/admin-web/src/dom/shops-view.ts; accounts-view.ts; orders-view.ts; apps/backend/src/admin-*',
  auto='tests/integration/admin-shops.int.spec.ts; admin-account-lock.int.spec.ts; m10-admin-orders.int.spec.ts', sev='NGHIÊM TRỌNG')

T('TC-ADM-009', ngay=5, seq=42, ten='SYSTEM cấp và thu hồi quyền của ADMIN; hiệu lực ở thao tác kế tiếp',
  muc_dich='Phân quyền có hiệu lực ngay sau khi lưu; mọi thay đổi được ghi nhật ký.',
  prio='P1', actor='SYSTEM + ADMIN-2', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-006',
  pre='SYSTEM và ADMIN-2 đăng nhập trên hai trình duyệt khác nhau (hoặc cửa sổ ẩn danh).',
  steps=[
    ('SYSTEM: TÀI KHOẢN > "Phân quyền" > chọn ADMIN-2.', 'Thấy các công tắc quyền ứng dụng và quyền chức năng ("Quyền tiền không suy ra từ quyền ứng dụng.").'),
    ('Bật thêm "Quản lý nhóm món" (hoặc "Khóa") cho ADMIN-2, chạm "Xem lại và lưu" rồi "Xác nhận lưu".', 'Hiện "Đã lưu quyền và ghi vào nhật ký."'),
    ('ADMIN-2 tải lại trang.', 'Menu/hành động mới xuất hiện đúng quyền vừa cấp.'),
    ('SYSTEM thu hồi quyền vừa cấp. ADMIN-2 tải lại.', 'Mục/hành động biến mất; thao tác cũ bị từ chối.'),
    ('SYSTEM bấm "Thu hồi phiên" của ADMIN-2.', 'ADMIN-2 bị đăng xuất ở thao tác kế tiếp.'),
  ],
  restore='Trả quyền ADMIN-2 về chỉ "Quán - Xem".', ref='apps/admin-web/src/dom/access-view.ts', auto='tests/integration/m12-access.int.spec.ts')

T('TC-ADM-010', ngay=5, seq=43, ten='SYSTEM khóa và mở khóa tài khoản ADMIN; thu hồi mọi phiên',
  muc_dich='Có cách chặn ngay một quản trị viên (mất điện thoại, nghỉ việc).',
  prio='P1', actor='SYSTEM', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-006',
  data='Lý do: "TEST khóa admin".',
  pre='ADMIN-2 đang đăng nhập trên một trình duyệt khác.',
  steps=[
    ('SYSTEM: "Phân quyền" > ADMIN-2 > "Khóa tài khoản", nhập lý do, xác nhận.', 'Hiện "Đã thực hiện và ghi vào nhật ký."; trạng thái "đang khóa".'),
    ('ADMIN-2 thực hiện một thao tác bất kỳ.', 'Bị đăng xuất/chặn.'),
    ('ADMIN-2 đăng nhập lại.', 'Bị từ chối vì tài khoản bị khóa.'),
    ('SYSTEM "Mở khóa tài khoản ADMIN".', 'Trạng thái "đang hoạt động"; ADMIN-2 đăng nhập lại được.'),
  ],
  restore='Đảm bảo ADMIN-2 đã được mở khóa.', ref='apps/admin-web/src/dom/access-view.ts (Khóa tài khoản ADMIN)', auto='tests/integration/m12-access.int.spec.ts; admin-account-lock.int.spec.ts')

T('TC-ADM-011', ngay=1, seq=46, ten='ADMIN quên mật khẩu: đặt lại bằng SMS (SYSTEM không tự đặt lại trên web)',
  muc_dich='ADMIN tự đặt lại mật khẩu bằng OTP SMS nhưng vẫn cần mã Authenticator sẵn có; SYSTEM chỉ khôi phục bằng công cụ trên máy chủ.',
  prio='P1', actor='ADMIN-2', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-006',
  pre='ADMIN-2 đã kích hoạt, SMS Gateway bật.',
  steps=[
    ('Ở trang đăng nhập bấm "Quên mật khẩu?".', 'Trang "Đặt lại mật khẩu": "Nhập số điện thoại của tài khoản quản trị để nhận mã OTP.", có ghi chú "SYSTEM khôi phục bằng công cụ trên máy chủ".'),
    ('Nhập SĐT-ADMIN-2, "Gửi mã OTP"; nhập mã SMS; đặt mật khẩu mới.', 'Hiện "Đã đặt lại mật khẩu" kèm nội dung "...mọi phiên cũ đã bị đăng xuất. Hãy đăng nhập bằng mật khẩu mới; tài khoản quản trị vẫn cần mã Authenticator hiện có."'),
    ('Đăng nhập bằng mật khẩu mới + mã Authenticator cũ.', 'Đăng nhập thành công; mật khẩu cũ không còn dùng được.'),
  ],
  restore='Cập nhật mật khẩu ADMIN-2 trong bảng riêng.', ref='apps/admin-web/src/dom/reset-view.ts; ops/runbooks/sms-gateway.md',
  auto='tests/integration/admin-reset-sms-browser.int.spec.ts; account-recovery-browser.int.spec.ts')

T('TC-ADM-012', ngay=2, seq=2, ten='Danh sách người dùng: tìm, lọc "Đang khóa", xem chi tiết',
  muc_dich='Admin tìm tài khoản theo tên/số điện thoại và xem trạng thái, vai trò, hồ sơ liên quan.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-ACC-001',
  pre='Đã đăng nhập Web Admin (SYSTEM hoặc ADMIN-1). Có tài khoản KH-A, CQ-A, SP-A.',
  steps=[
    menu_go('TÀI KHOẢN > Người dùng > "Danh sách"'),
    ('Gõ số điện thoại của KH-A vào ô "Tìm theo tên hoặc số điện thoại".', 'Còn đúng tài khoản KH-A ("Khách Test A").'),
    ('Mở chi tiết ("Chi tiết người dùng").', 'Thấy Họ tên, Số điện thoại, "Vai trò" (Khách hàng), "Trạng thái", "Xác minh số điện thoại", "Hồ sơ khách hàng", "Dữ liệu liên quan", "Lịch sử tài khoản".'),
    ('Gõ tên hoặc số điện thoại CQ-A vào ô tìm kiếm và mở chi tiết CQ-A; làm tương tự với SP-A.', 'Có vai trò Chủ quán và "Hồ sơ quán" (tên quán); SP-A có vai trò Shipper và "Hồ sơ shipper".'),
    ('Chọn menu con "Đang khóa".', 'Chỉ hiện tài khoản đang bị khóa (nếu không có: "Chưa có người dùng đang khóa").'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/accounts-view.ts', auto='tests/integration/admin-account-read.int.spec.ts')

T('TC-ADM-013', ngay=4, seq=70, ten='Khóa tài khoản bị chặn khi tài khoản còn đơn đang xử lý',
  muc_dich='Không được khóa người đang có đơn hay yêu cầu giao chưa kết thúc để tránh mất đơn.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-CUS-025',
  pre='KH-A có một đơn đang xử lý (chưa kết thúc).',
  steps=[
    ('Mở chi tiết KH-A trong Người dùng, bấm "Khóa", điền lý do, xác nhận.', 'Không khóa được; hiện "Không thể khóa lúc này: tài khoản còn đơn hàng hoặc đơn giao hàng đang xử lý. Đơn đã hoàn thành hoặc đã hủy không cản trở việc khóa."'),
    ('Hủy/hoàn tất đơn rồi khóa lại.', 'Khóa được (khi hết đơn đang xử lý).'),
    ('Mở lại chi tiết KH-A trên Web Admin, chạm "Mở khóa" và xác nhận.', 'Mở khóa thành công: trạng thái tài khoản về hoạt động (xem thêm TC-ACC-027).'),
  ],
  restore='Đảm bảo KH-A được mở khóa.', ref='apps/admin-web/src/dom/accounts-view.ts; docs/current/M01-production-profile-20261014.md (khóa USER phải duyệt lại khi có đơn/ví)',
  auto='tests/integration/account-lifecycle.int.spec.ts; admin-account-lock.int.spec.ts', sev='Cao')

T('TC-ADM-014', ngay=2, seq=3, ten='Danh sách quán trên Web Admin: tìm, lọc theo hồ sơ/lịch, xem chi tiết và xem như khách',
  muc_dich='Admin theo dõi các quán, kể cả quán chưa đủ điều kiện (hồ sơ nháp) và quán ngoài giờ.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-SHOP-011',
  pre='Quán Test A (đang mở) và Quán Test B (ngoài giờ) đã hoàn tất hồ sơ. Quán Test C chưa hoàn tất hồ sơ (TC-SHOP-002) nên không có trên máy chủ.',
  steps=[
    menu_go('VẬN HÀNH > "Quán"'),
    ('Đọc danh sách ("Danh sách quán") và các cột Mã quán, Tên quán, Chủ quán, Khu vực, Trạng thái hồ sơ, Theo lịch.', 'Có Quán Test A và Quán Test B, trạng thái hồ sơ hoàn tất/đang hoạt động; KHÔNG có Quán Test C (chưa được gửi lên máy chủ). Nếu trong danh sách có quán nháp cũ (dữ liệu có từ trước) thì ghi nhận.'),
    ('Lọc theo trạng thái hồ sơ (ví dụ "chưa hoàn tất") và theo lịch (đang mở/đóng).', 'Danh sách lọc đúng: lọc "đang mở" có Quán A (nếu lúc đó đang trong giờ); lọc "đóng" có Quán B; lọc "chưa hoàn tất" không có Quán Test C.'),
    ('Mở chi tiết Quán A, xem các thẻ Hồ sơ, Lịch hoạt động trong tuần, Món, Lịch sử quản lý.', 'Thông tin khớp với app (tên, số điện thoại, địa chỉ, tọa độ "Tọa độ (vĩ độ, kinh độ)", món hiện/tổng). Chỉ có địa chỉ và tọa độ chữ (chưa có bản đồ web).'),
    ('Chạm "Xem như khách".', 'Hiện bản xem trước như khách thấy.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/shops-view.ts; docs/current/M02-admin-shops-20261024.md',
  auto='tests/integration/admin-shops.int.spec.ts; admin-shops-browser.int.spec.ts')

T('TC-ADM-015', ngay=2, seq=4, ten='Ghi nhận hiện trạng: quán hoạt động ngay khi hồ sơ đủ, không có bước "Admin duyệt quán"',
  muc_dich='Xác nhận bằng mắt thường ứng dụng và Web Admin đang làm gì với hồ sơ quán mới: quán đủ điều kiện hoạt động NGAY, không có hàng chờ duyệt. Test chỉ GHI NHẬN hiện trạng để Owner đối chiếu với câu "Chỉ bán hàng sau khi được duyệt" còn hiện trên màn đăng ký. Bộ test KHÔNG tự quyết quán có cần duyệt hay không.',
  prio='P0', actor='ADMIN/SYSTEM + Chủ quán', dev=('PC', 'P2'), phones=1,
  note='Hiện trạng theo mã nguồn: chủ quán bấm "Hoàn tất hồ sơ" đủ thông tin thì quán hoạt động ngay; Web Admin chỉ có "Vô hiệu hóa quán"/"Kích hoạt lại quán", không có "Duyệt"/"Từ chối hồ sơ". Trong khi đó màn đăng ký có câu "Chỉ bán hàng sau khi được duyệt" và bảng Tổng quan có thẻ "Hồ sơ quán chờ duyệt". Quyết định nghiệp vụ nằm ở Owner: xem câu hỏi OQ-01 trong CHECKLIST_NGHIEM_THU mục 7. PASS ở đây chỉ nghĩa là "hiện trạng đúng như mô tả bên dưới", KHÔNG nghĩa Owner đã đồng ý nghiệp vụ.',
  pre='Quán Test A vừa hoàn tất hồ sơ (TC-SHOP-001). Bạn đăng nhập Web Admin (ADMIN-1 hoặc SYSTEM) trên máy tính; chủ quán dùng Điện thoại 2.',
  steps=[
    ('Trên Điện thoại 2 (chủ quán CQ-A) mở 11Food, vào chế độ quản lý quán, nhìn thẻ trạng thái hồ sơ ở đầu màn hình.', 'Thẻ trạng thái ghi "Đã hoàn tất" (hoặc tương đương) và KHÔNG có dòng "Đang chờ duyệt". Chụp màn hình.'),
    ('Trên Web Admin, ở menu bên trái chọn VẬN HÀNH > "Quán", mở chi tiết "Quán Test A" và tìm nút "Duyệt" hoặc "Từ chối hồ sơ".', 'Quán đã ở trạng thái hoạt động. KHÔNG có nút "Duyệt"/"Từ chối hồ sơ"; chỉ thấy "Vô hiệu hóa quán" (và "Kích hoạt lại quán" khi quán đã bị vô hiệu hóa). Chụp màn hình.'),
    ('Mở trang Điều hành (Tổng quan) và tìm thẻ "Hồ sơ quán chờ duyệt".', 'Ghi lại đúng số/chữ đang hiển thị (có thể 0 hoặc không có ý nghĩa) vào Ghi chú kết quả để Owner đối chiếu. Chụp màn hình.'),
    ('Trên Điện thoại 1 (khách) mở 11Food, tìm "Quán Test A" ở Trang chủ trong giờ mở cửa.', 'Quán xuất hiện cho khách ngay (không cần ai duyệt).'),
  ],
  verdict='PASS: cả bốn bước đúng như mô tả (xác nhận HIỆN TRẠNG: quán hoạt động ngay, không có bước duyệt). FAIL: có bước khác mô tả - ví dụ xuất hiện nút "Duyệt"/"Từ chối" hoặc quán không hiện cho khách dù đủ điều kiện (ghi rõ bước số mấy, chụp ảnh). Kết luận "có cần duyệt hay không" KHÔNG thuộc người kiểm thử: ghi câu "Chờ Owner trả lời OQ-01" vào Ghi chú kết quả. BLOCKED: không đăng nhập được Web Admin hoặc chưa có Quán Test A.',
  restore=R_NONE, ref='docs/current/M02-admin-shops-20261024.md; mobile README (Food - shop profile: shop becomes ACTIVE); account_views.dart (dòng "Chỉ bán hàng sau khi được duyệt")',
  auto='tests/integration/shop-onboarding.int.spec.ts')

T('TC-ADM-016', ngay=4, seq=71, ten='Admin vô hiệu hóa và kích hoạt lại quán',
  muc_dich='Admin có quyền "Quản lý hoạt động quán" dừng quán vi phạm; không dừng được khi quán còn đơn chưa kết thúc.',
  prio='P0', actor='ADMIN (có quyền Quản lý hoạt động quán) / SYSTEM', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-SHOP-011',
  data='Lý do: "TEST vô hiệu hóa quán" (1-500 ký tự).',
  pre='Một quán thử không có đơn đang chạy (Quán Test B). Một quán khác có đơn đang xử lý (Quán Test A, đang có đơn).',
  steps=[
    ('Mở chi tiết quán có đơn đang xử lý, bấm "Vô hiệu hóa quán", nhập lý do, xác nhận.', 'Bị từ chối: quán còn đơn/yêu cầu giao chưa kết thúc (thông báo tiếng Việt nói quán còn việc đang xử lý).'),
    ('Mở chi tiết quán KHÔNG có đơn, "Vô hiệu hóa quán", nhập lý do, xác nhận.', 'Hiện "Đã vô hiệu hóa quán."; trạng thái hồ sơ "Đã bị vô hiệu hóa"; có dòng trong lịch sử quản lý với lý do.'),
    ('Chủ quán mở 11Food, vào quản lý quán.', 'Hiện "Quán đã bị vô hiệu hóa. Bạn không thể chỉnh sửa hồ sơ." / "Quán đã bị vô hiệu hóa nên không thể sửa món."'),
    ('Khách tìm quán (xem TC-CUS-014).', 'Không thấy quán.'),
    ('Admin bấm "Kích hoạt lại quán" và xác nhận.', 'Hiện "Đã kích hoạt lại quán."; quán hoạt động trở lại theo giờ mở cửa.'),
  ],
  restore='Quán phải được kích hoạt lại ở bước 5.', ref='apps/admin-web/src/dom/shops-view.ts; docs/current/M02-admin-shops-20261024.md',
  auto='tests/integration/admin-shops.int.spec.ts', sev='Cao')

T('TC-ADM-017', ngay=3, seq=60, ten='Danh sách và chi tiết shipper trên Web Admin',
  muc_dich='Admin xem thông tin shipper (mã, họ tên, số điện thoại, biển số, ví, trạng thái hoạt động).',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-ACC-004',
  pre='SP-A, SP-B đã đăng ký.',
  steps=[
    menu_go('VẬN HÀNH > "Shipper"'),
    ('Tìm SP-A bằng họ tên hoặc số điện thoại ("Tìm theo họ tên, số điện thoại hoặc mã Shipper").', 'Danh sách chỉ còn đúng SP-A.'),
    ('Mở chi tiết.', 'Thấy trạng thái hoạt động (đang hoạt động), "Nhận đơn" Đang bật/Đang tắt, thông tin ngân hàng ("Chưa có" nếu chưa nhập), biển số, "Đủ điều kiện bật". Số điện thoại hiển thị theo quyền.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/shippers-view.ts', auto='tests/integration/m03-shipper.int.spec.ts; admin-shippers-browser.int.spec.ts')

T('TC-ADM-018', ngay=4, seq=72, ten='Admin "Khóa hoạt động" và "Mở lại" shipper; "Nhận đơn" bị tắt',
  muc_dich='Admin dừng một shipper vi phạm: shipper không nhận đơn mới nhưng đơn đang giao không bị hủy.',
  prio='P1', actor='ADMIN (có quyền Khóa)', dev=('PC', 'P3'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-017',
  data='Lý do: "TEST khóa hoạt động".',
  pre='SP-B (không có đơn đang giao) đang online.',
  steps=[
    ('Chi tiết SP-B > "Khóa hoạt động", nhập lý do, xác nhận ("Khóa hoạt động Shipper").', 'Trạng thái tạm khóa; "Nhận đơn" chuyển "Đang tắt"; ghi lý do.'),
    ('Shipper kiểm tra 11Ship.', 'Không nhận đơn mới; có thông báo về việc bị khóa; đơn đang giao (nếu có) vẫn hoàn tất được ("Đơn đã nhận và số dư ví của bạn không bị ảnh hưởng.").'),
    ('Admin "Mở lại hoạt động".', 'Hiện "Shipper quay lại trạng thái hoạt động với nhận đơn đang tắt." Shipper tự bật online khi đủ điều kiện.'),
  ],
  restore='SP-B được mở lại.', ref='apps/admin-web/src/dom/shippers-view.ts', auto='tests/integration/admin-account-lock.int.spec.ts; m03-shipper.int.spec.ts')

T('TC-ADM-019', ngay=4, seq=73, ten='Hồ sơ shipper chờ duyệt / xác minh ngân hàng cũ: ghi nhận trạng thái thực tế',
  muc_dich='Theo quy định 20/10/2026 shipper không cần Admin duyệt hồ sơ hay ngân hàng để hoạt động; Web Admin vẫn còn nút Xác minh/Từ chối cho dữ liệu cũ và cho ngân hàng hoàn tiền. Cần ghi nhận để Owner xác nhận không gây nhầm lẫn.',
  prio='P1', actor='ADMIN', dev=('PC',), phones=0, ready='CẦN XÁC MINH',
  note='Lệch tài liệu-mã nguồn cần Owner xác nhận: giao diện Admin còn "Xác minh"/"Từ chối" hồ sơ/ngân hàng; Điều hành còn thẻ "Hồ sơ shipper chờ duyệt".',
  pre='SP-A đã đăng ký và đang hoạt động.',
  steps=[
    ('Mở chi tiết SP-A và tìm các nút "Xác minh", "Từ chối", "Xác minh ngân hàng".', 'Ghi nhận nút nào đang hiện và có tác dụng gì với shipper đang hoạt động (không được làm shipper mất khả năng nhận đơn).'),
    ('Thử "Xác minh ngân hàng" cho SP-B sau khi SP-B nhập ngân hàng hoàn tiền (TC-WAL-015).', 'Chỉ để cho phép rút/hoàn tiền; không ảnh hưởng nhận đơn.'),
  ],
  restore=R_NONE, ref='docs/current/M03-simplified-onboarding-20261020.md; apps/admin-web/src/dom/shippers-view.ts; overview-view.ts ("Hồ sơ shipper chờ duyệt")',
  auto='tests/integration/m03-shipper.int.spec.ts')

T('TC-ADM-020', ngay=1, seq=47, ten='Quản lý "Nhóm món" (danh mục) để chủ quán thêm món',
  muc_dich='Nhóm món do Admin tạo; thiếu nhóm thì chủ quán không thêm được món. Test này tạo dữ liệu cần cho Ngày 2.',
  prio='P0', actor='ADMIN/SYSTEM (quyền Nhóm món)', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Nhóm món KHÔNG xóa được, chỉ "Ngừng dùng" và "Kích hoạt lại". Vì vậy chỉ tạo đúng hai nhóm cần thiết; không tạo nhóm tạm.',
  data='Hai nhóm: "Món chính" (thứ tự 1) và "Đồ uống" (thứ tự 2).',
  pre='Đã đăng nhập Web Admin với quyền quản lý nhóm món (SYSTEM hoặc ADMIN-1).',
  steps=[
    menu_go('DANH MỤC > Danh mục > "Nhóm món"'),
    ('Nếu chưa có nhóm nào, trang ghi "Chưa có nhóm món": chạm "+ Thêm nhóm". Ở màn "Thêm nhóm món" nhập "Tên nhóm" = "Món chính", "Thứ tự" = 1, chạm "Lưu".', 'Nhóm "Món chính" xuất hiện trong "Danh sách nhóm món" ở trạng thái đang dùng, cột "Số món" = 0.'),
    ('Chạm "+ Thêm nhóm" lần nữa, nhập "Đồ uống", thứ tự 2, "Lưu".', 'Có hai nhóm trong danh sách.'),
    ('Ở nhóm "Đồ uống" chạm "Sửa", đổi thứ tự thành 3 rồi "Lưu", sau đó sửa lại thành 2.', 'Thứ tự đổi đúng, lưu thành công, không tạo nhóm trùng.'),
    ('Chạm "Ngừng dùng" ở nhóm "Đồ uống" (chỉ khi chưa có quán nào dùng nhóm này) rồi xác nhận "Ngừng dùng nhóm món"; kiểm tra bằng cách chủ quán thử "+ Thêm món".', 'Nhóm "Đồ uống" không còn chọn được khi chủ quán thêm món mới ("Ngừng hoạt động · chỉ giữ liên kết hiện có…").'),
    ('Chạm "Kích hoạt" ("Kích hoạt lại nhóm món") ở nhóm "Đồ uống".', 'Nhóm đang dùng trở lại và chọn được khi thêm món.'),
  ],
  restore='Giữ hai nhóm "Món chính" và "Đồ uống" ở trạng thái ĐANG DÙNG (không có chức năng xóa nhóm).', ref='apps/admin-web/src/dom/catalog-view.ts; apps/backend/src/admin-menu-categories',
  auto='tests/integration/admin-menu-categories.int.spec.ts; admin-menu-categories-browser.int.spec.ts')

T('TC-ADM-021', ngay=3, seq=61, ten='Danh sách và chi tiết "Đơn hàng" trên Web Admin',
  muc_dich='Admin tra cứu mọi đơn món theo mã, người nhận, trạng thái, quán, ngày; chi tiết có bản gốc và bản chốt.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-FLOW-001',
  pre='Có vài đơn ở các trạng thái khác nhau.',
  steps=[
    menu_go('VẬN HÀNH > "Đơn hàng"'),
    ('Gõ mã đơn vào "Tìm theo mã đơn hoặc người nhận", rồi thử lọc "Từ ngày"/"Đến ngày" và trạng thái.', 'Kết quả khớp bộ lọc.'),
    ('Mở "Chi tiết đơn hàng" của đơn từng chỉnh (TC-SHOP-024).', 'Thấy "Tiền món (khách đặt)" và "Tiền món (hiện tại)", món "Quán đã sửa", lý do chỉnh, các lần gọi shipper và diễn biến.'),
    ('Tìm dòng thanh toán.', 'Có thể hiện "Khách đã trả"/"Còn phải thu" trong dữ liệu quản trị (ghi nhận hiện trạng; app khách/quán đã bỏ các dòng này).'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/orders-view.ts; docs/current/M10-implementation-20261018.md',
  auto='tests/integration/m10-admin-orders.int.spec.ts')

T('TC-ADM-022', ngay=4, seq=74, ten='Admin hủy đơn món và đóng "Không hoàn tất" (cần lý do, cần quyền)',
  muc_dich='Hai thao tác xử lý đơn của Admin có lý do bắt buộc, ghi nhật ký, thông báo đúng bên.',
  prio='P1', actor='ADMIN (quyền khóa/duyệt)', dev=('PC', 'P1'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-021',
  data='Lý do: "TEST Admin hủy đơn".',
  pre='Một đơn thử "Đang chuẩn bị" (chưa lấy hàng).',
  steps=[
    ('Mở chi tiết đơn, chạm "Hủy đơn món". Thử xác nhận khi chưa nhập lý do.', 'Báo "Lý do là bắt buộc."'),
    ('Nhập lý do và xác nhận.', 'Đơn chuyển "Đã hủy" (Quản trị hủy); hiện "Đã cập nhật."'),
    ('Khách mở đơn trên 11Food.', 'Hiện đã hủy; có thông báo cho khách.'),
    ('Tìm nút "Hủy đơn món" ở đơn mà shipper ĐÃ lấy hàng.', 'Không có/không dùng được ("Không dùng được sau khi shipper đã lấy hàng.").'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/orders-view.ts; apps/backend/src/admin-orders', auto='tests/integration/m10-admin-orders.int.spec.ts')

T('TC-ADM-023', ngay=3, seq=62, ten='Danh sách và chi tiết "Giao hàng" trên Web Admin (kể cả vị trí shipper)',
  muc_dich='Admin theo dõi toàn bộ yêu cầu giao: trạng thái, người nhận, phí, shipper, vị trí mới nhất kèm độ cũ.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-FLOW-001',
  pre='Có yêu cầu giao ở nhiều trạng thái; một shipper đang giữ đơn và đang bật chia sẻ vị trí.',
  steps=[
    menu_go('VẬN HÀNH > "Giao hàng"'),
    ('Xem bộ đếm "Tổng quan giao hàng" và lọc theo nhóm "Đang tìm", "Đang giao", "Cần xử lý".', 'Các bộ đếm khớp danh sách lọc.'),
    ('Mở "Chi tiết giao hàng" của yêu cầu có shipper giữ đơn.', 'Thấy mã, nguồn (đơn/trực tiếp), quán, người nhận, "Phí giao", "Chế độ phí", "Người trả phí", shipper, "Hoa hồng đã chốt", và phần vị trí với giờ cập nhật; nếu quá cũ có "GPS cũ: vị trí này không còn là trực tiếp".'),
    ('Mở yêu cầu đã kết thúc.', 'Nói rõ "Yêu cầu giao không còn ở giai đoạn đang giao nên không theo dõi vị trí." (không còn vị trí).'),
    ('Với yêu cầu DIRECT: nhìn thông tin người nhận/điện thoại.', 'Hiển thị theo quyền ("Ẩn: tài khoản này không có quyền xem liên hệ" với ADMIN thiếu quyền).'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/deliveries-view.ts', auto='tests/integration/m07-delivery.int.spec.ts (admin); admin-web tests')

T('TC-ADM-024', ngay=1, seq=48, ten='Bảng "Phí & điều kiện giao": xem, thử tính phí; chỉ SYSTEM được sửa',
  muc_dich='Bảng phí 3 khung là nguồn của mọi phí giao. Test này kiểm tra bảng đã được áp dụng và đọc được. Giá trong tài liệu (10k/15k/20k) chỉ là ví dụ, KHÔNG phải giá thật.',
  prio='P0', actor='SYSTEM, ADMIN', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Nếu bảng phí chưa được SYSTEM áp dụng thì mọi phí hiện "Chưa xác định phí" và các luồng đơn phải dùng đường đề xuất phí. Người phụ trách (SYSTEM) phải chốt giá thực tế trước khi chạy Ngày 2-3.',
  pre='Đã đăng nhập Web Admin.',
  steps=[
    menu_go('HỆ THỐNG > "Phí & điều kiện giao"'),
    ('Đọc "Ba khung tính phí" và "Các phiên bản đã áp dụng".', 'Hiện đúng 3 khung với "Đến dưới (km)" và "Phí ship (đ)"; bán kính tìm shipper hiển thị 3 km (chỉ đọc). Nếu chưa có bảng: "Chưa có bảng giá nào được áp dụng: hệ thống chưa tính được phí."'),
    ('Ghi lại ba mức phí và ba ranh giới vào bảng chuẩn (F1, F2, F3; b1, b2, b3).', 'Có bảng chuẩn để đối chiếu mọi test phí.'),
    ('Ở "Thử tính phí" nhập "Quãng đường giao (km)" lần lượt 1, 4, 8 và 15.', 'Phí hiện đúng khung (khung 1 cho 1 km...). Với quãng đường vượt mốc cuối (15 km): "Chưa xác định phí" (KHÔNG phải 0đ).'),
    ('ADMIN-1 mở cùng trang.', 'Chỉ xem và thử tính ("Bạn chỉ có quyền xem và thử tính phí. Chỉ tài khoản SYSTEM được chỉnh sửa bảng giá.").'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/shipping-policy-view.ts; docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md',
  auto='tests/integration/m06-shipping-fee-policy.int.spec.ts; admin-shipping-policy-browser.int.spec.ts')

T('TC-ADM-025', ngay=5, seq=44, ten='SYSTEM đổi bảng phí giao bằng bản nháp rồi áp dụng; đơn cũ không bị tính lại',
  muc_dich='Bảng phí đổi qua nháp -> áp dụng -> tạo phiên bản bất biến; phí đã chốt của đơn cũ không đổi.',
  prio='P1', actor='SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Thay đổi cấu hình thật. Chỉ làm khi Owner cho phép; sau test áp dụng lại bảng phí đúng như ban đầu (sẽ tạo thêm phiên bản mới - đó là bình thường).',
  pre='SYSTEM đăng nhập; ghi bảng giá hiện tại; có một đơn đã chốt phí.',
  steps=[
    ('Ở "Phí & điều kiện giao" đổi mức phí khung 1 thêm 1.000đ, bấm "Lưu bản nháp".', 'Hiện "Đã lưu bản nháp. Bản nháp chưa có hiệu lực cho đến khi bấm "Áp dụng bảng giá"."'),
    ('Kiểm tra giỏ khách mới.', 'Phí giỏ vẫn theo bảng cũ vì chưa áp dụng.'),
    ('Bấm "Áp dụng bảng giá" và xác nhận.', 'Tạo phiên bản mới (đang áp dụng); phiên bản cũ nằm trong lịch sử.'),
    ('Khách tạo giỏ mới.', 'Phí theo bảng mới; đơn cũ đã chốt vẫn giữ phí cũ.'),
    ('Đặt lại mức phí ban đầu và áp dụng.', 'Về giá trị ban đầu.'),
  ],
  restore='Áp dụng lại đúng bảng phí ban đầu.', ref='apps/admin-web/src/dom/shipping-policy-view.ts', auto='tests/integration/m06-shipping-fee-policy.int.spec.ts; admin-shipping-policy-browser.int.spec.ts', sev='Cao')

T('TC-ADM-026', ngay=4, seq=75, ten='Cài đặt "Thời hạn xử lý đơn" và "Thời gian trả lời đề xuất phí": kiểm tra giá trị và quyền',
  muc_dich='Các thời hạn tự hủy/nhắc phải nhập đúng ràng buộc; thay đổi có lịch sử và chỉ áp dụng cho giai đoạn mới.',
  prio='P1', actor='SYSTEM, ADMIN', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  data='Giá trị hợp lệ: số nguyên 1-1440 phút. Thử sai: 0, 1441, "abc"; mốc nhắc lớn hơn mốc hủy.',
  pre='SYSTEM đăng nhập.',
  steps=[
    menu_go('HỆ THỐNG > "Thời hạn xử lý đơn"'),
    ('Đọc 7 ô: "Chờ quán: bắt đầu nhắc / nhắc lại mỗi / tự hủy sau", "Chờ shipper: dừng tìm / tự hủy đơn sau", "Đã nhận: cảnh báo chưa lấy hàng sau / tự hủy khi chưa lấy hàng sau".', 'Giá trị mặc định 15/5/30, 30/60, 30/60 (hoặc giá trị hiện hành); có dòng "Mốc nhắc phải trước mốc hủy; dừng tìm không được sau mốc hủy."'),
    ('Nhập giá trị sai (0, 1441, chữ, nhắc > hủy) rồi "Lưu thời hạn".', 'Không lưu; báo lỗi giá trị cụ thể.'),
    ('Nhập giá trị hợp lệ khác và lưu.', 'Hiện "Đã lưu. Áp dụng cho giai đoạn mới."; có dòng mới trong "Lịch sử thay đổi" (phiên bản, cũ -> mới).'),
    ('Mở "Cấu hình tập trung", tìm dòng "Thời gian trả lời đề xuất phí" và đổi thành 6 phút có lý do; sau đó đặt lại 5.', 'Lưu thành công; ADMIN chỉ xem được.'),
    ('Đặt lại toàn bộ thời hạn về giá trị ban đầu.', 'Các thời hạn về đúng giá trị mặc định ban đầu (đã khôi phục cấu hình).'),
  ],
  restore='Đặt lại mọi thời hạn về giá trị ban đầu.', ref='apps/admin-web/src/dom/order-timeouts-page.ts; apps/admin-web/src/core/config.ts',
  auto='tests/integration/m10-orders.int.spec.ts (timeouts); admin tests (order timeouts; config-orders.spec.ts)')

T('TC-ADM-027', ngay=5, seq=45, ten='"Cấu hình tập trung": mọi quản trị viên xem, chỉ SYSTEM sửa, có lý do và lịch sử',
  muc_dich='Một nơi xem mọi tham số hệ thống; mọi thay đổi có lý do và nhật ký.',
  prio='P1', actor='SYSTEM, ADMIN', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='SYSTEM và ADMIN-1 đăng nhập.',
  steps=[
    menu_go('HỆ THỐNG > "Cấu hình tập trung"'),
    ('SYSTEM xem các nhóm cấu hình (OTP, Ví Shipper, Điều kiện nhận đơn, Đơn hàng, Thông báo).', 'Mỗi nhóm hiển thị tham số và phiên bản; có nút "Sửa".'),
    ('Sửa một tham số vô hại (ví dụ số ngày hiển thị trong hộp thư), nhập lý do bắt buộc, "Xác nhận lưu".', 'Hiện "Đã lưu cấu hình thành phiên bản mới và ghi vào nhật ký."; "Lịch sử thay đổi" có dòng mới.'),
    ('Dùng "Hoàn nguyên giá trị này".', 'Giá trị về như cũ.'),
    ('ADMIN-1 mở cùng trang.', 'Xem được nhưng không có nút sửa ("Mọi quản trị viên được xem, chỉ SYSTEM được sửa.").'),
  ],
  restore='Hoàn nguyên mọi thay đổi thử.', ref='apps/admin-web/src/dom/config-view.ts; apps/backend/src/admin-config', auto='tests/integration/m12-config.int.spec.ts')

T('TC-ADM-028', ngay=5, seq=46, ten='"Nhật ký hoạt động" (audit): xem, lọc, không sửa được, không lộ bí mật',
  muc_dich='Ai làm gì và khi nào được ghi lại; nhật ký chỉ xem; không chứa mật khẩu, OTP, khóa bí mật.',
  prio='P0', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, deps='TC-ADM-016', loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Đã có các thao tác (khóa/mở khóa, vô hiệu hóa quán, đổi cấu hình).',
  steps=[
    menu_go('HỆ THỐNG > "Nhật ký"'),
    ('Lọc "Hôm nay", "Kết quả" = "Thành công", rồi "Bị từ chối".', 'Hiện các bản ghi: Thời gian (giờ Việt Nam), Người thực hiện, Hành động, Đối tượng, Kết quả.'),
    ('Tìm bản ghi của thao tác vừa làm (ví dụ vô hiệu hóa quán) và mở "Chi tiết".', 'Có hành động, người làm, lý do (nếu có), trước/sau. KHÔNG có mật khẩu, mã OTP hay khóa bí mật.'),
    ('Tìm nút sửa/xóa bản ghi.', 'Không có (chỉ xem).'),
    ('Chạm "Tải thêm".', 'Tải thêm bản ghi cũ hơn.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/audit-view.ts; apps/backend/src/audit', auto='tests/integration/m12-audit-backup.int.spec.ts; audit-writer.int.spec.ts')

T('TC-ADM-029', ngay=5, seq=47, ten='"Điều hành" và "Báo cáo": số liệu khớp danh sách và xuất CSV/Excel',
  muc_dich='Mỗi con số bấm vào mở đúng danh sách tạo ra nó; báo cáo xuất được và chỉ người có quyền xuất.',
  prio='P1', actor='ADMIN/SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Có dữ liệu đơn/giao hàng của các ngày test.',
  steps=[
    menu_go('Tổng quan > "Điều hành"'),
    ('Chọn khoảng ngày hôm nay (hoặc kỳ test), "Áp dụng". Đọc "Order phát sinh", "Giao thành công", "Giao thất bại", "Tỷ lệ giao thành công", "Hoa hồng đã thu".', 'Các số hiển thị; không có số "giả". Với mục không có quyền: "Bạn không có quyền xem số này".'),
    ('Chạm một con số ("Mở danh sách").', 'Mở danh sách đã lọc; số dòng khớp con số.'),
    menu_go('Tổng quan > "Báo cáo"'),
    ('Chọn một loại báo cáo, khoảng ngày, chạm "Xuất CSV" (và "Xuất Excel").', 'Hiện "Đã nhận yêu cầu xuất. File được tạo ở nền…"; file xuất hiện trong "File đã xuất" và tải được ("Tải về").'),
    ('Mở file CSV bằng Excel.', 'Tiếng Việt hiển thị đúng; số liệu khớp màn hình.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/overview-view.ts; reports-view.ts', auto='tests/integration/m12-overview.int.spec.ts; m12-reports.int.spec.ts; admin-m12-browser.int.spec.ts')

T('TC-ADM-030', ngay=5, seq=48, ten='"Vận hành hệ thống": sức khỏe, sự cố, SMS Gateway, nhật ký, phiên bản',
  muc_dich='Người phụ trách theo dõi hệ thống (SMS Gateway có sống không, phiên bản đang chạy, sự cố).',
  prio='P1', actor='SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Một số mục cần cấu hình hạ tầng (Discord webhook, máy kiểm tra ngoài, báo cáo từ pipeline). Mục chưa cấu hình phải ghi "Chưa cấu hình"/"Chưa ghi", không hiện số giả.',
  pre='SYSTEM đăng nhập.',
  steps=[
    menu_go('VẬN HÀNH HỆ THỐNG > Vận hành hệ thống > "Tổng quan"'),
    ('Đọc tình trạng các kiểm tra ("Bình thường"/cảnh báo).', 'Mỗi kiểm tra có trạng thái và bằng chứng/giá trị đo; mục chưa có dữ liệu ghi "Chưa có số đo nào".'),
    menu_go('VẬN HÀNH HỆ THỐNG > Vận hành hệ thống > "SMS Gateway"'),
    ('Xem thiết bị ghép cặp (pin, SIM, phiên bản, liên lạc gần nhất) và "Chưa có OTP nào trong hàng đợi".', 'Hiển thị thật; thiết bị offline phải được ghi rõ; số điện thoại người nhận được che bớt.'),
    menu_go('VẬN HÀNH HỆ THỐNG > Vận hành hệ thống > "Phiên bản & cập nhật"'),
    ('Xem "Các bản phát hành" và phiên bản các thiết bị báo lên.', 'Có bảng phiên bản; nếu chưa có bản phát hành: "Chưa có bản phát hành nào".'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/ops-view.ts; docs/current/M13-implementation-20261023.md', auto='tests/integration/m13-ops.int.spec.ts; m13-ops-browser.int.spec.ts')

T('TC-ADM-031', ngay=5, seq=49, ten='"Sao lưu và phục hồi": xem lịch sử sao lưu và yêu cầu sao lưu ngay (chỉ SYSTEM)',
  muc_dich='Dữ liệu có bản sao lưu đã được khôi phục thử thành công. Test này KHÔNG yêu cầu khôi phục thật.',
  prio='P1', actor='SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='TUYỆT ĐỐI không gửi "Yêu cầu khôi phục dữ liệu" trên môi trường đang có dữ liệu thật. Chỉ xem lịch sử và (nếu Người phụ trách cho phép) "Sao lưu ngay".',
  pre='SYSTEM đăng nhập.',
  steps=[
    menu_go('HỆ THỐNG > "Sao lưu và phục hồi"'),
    ('Đọc "Lịch sử sao lưu" (cột Loại, Mã hóa, Kiểm chứng, Ngoài VPS, Kích thước).', 'Có bản sao lưu gần nhất ghi "Đạt"/"Có (đã xác minh)" hoặc "Chưa có bản sao lưu" - trung thực, không số giả.'),
    ('(Nếu được phép) Chạm "Sao lưu ngay".', 'Hiện "Đã xếp lịch sao lưu ngay. Bản sao được tạo ở nền; trang tự cập nhật khi chạy xong."'),
    ('KHÔNG gửi yêu cầu khôi phục. Chỉ đọc phần mô tả.', 'Phần khôi phục nói rõ "Chưa có dữ liệu nào thay đổi" cho đến khi bộ phận vận hành thực hiện.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/backups-view.ts; ops/runbooks/m12-backup-restore-20261023.md', auto='tests/integration/m12-audit-backup.int.spec.ts')

T('TC-ADM-032', ngay=5, seq=50, ten='Nhật ký lỗi hệ thống ("Giám sát > Nhật ký lỗi")',
  muc_dich='Lỗi do ứng dụng báo lên được thu gọn và lưu cho kỹ thuật viên; không chứa dữ liệu nhạy cảm.',
  prio='P2', actor='SYSTEM', dev=('PC',), phones=0, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='SYSTEM đăng nhập.',
  steps=[
    menu_go('HỆ THỐNG > Giám sát > "Nhật ký lỗi"'),
    ('Đọc danh sách lỗi (nếu có).', 'Mỗi dòng có thời gian, loại lỗi, ứng dụng, phiên bản; không có mật khẩu, mã OTP, chuỗi bí mật dài hay số điện thoại đầy đủ.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/monitoring-errors-view.ts; docs/current/M13-error-logs-155.md', auto='apps/admin-web/src/core/monitoring-errors.spec.ts')

T('TC-ADM-033', ngay=5, seq=51, ten='Mục "Vùng hoạt động" ghi "Sắp có"',
  muc_dich='Ghi nhận mục menu chưa làm; phải hiện nhãn "Sắp có" và không dẫn tới trang trống.',
  prio='P2', actor='SYSTEM', dev=('PC',), phones=0, ready='NOT READY',
  note='Chức năng chưa có theo mã nguồn (menu "Vùng hoạt động" ready:false). Khu vực phục vụ hiện được cấu hình bởi kỹ thuật viên.',
  pre='SYSTEM đăng nhập.',
  steps=admin_login('SYSTEM') + [
    ('Trong nhóm HỆ THỐNG ở menu bên trái tìm "Vùng hoạt động" và chạm vào.', 'Mục có nhãn "Sắp có", không mở trang nào (nút bị khóa, không dẫn tới trang trống).'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/core/menu.ts (soon("zones")); docs/ops/service-area-gps-154.md', auto='apps/admin-web/src/core/menu.spec.ts (nếu có)')

T('TC-ADM-034', ngay=5, seq=52, ten='Trang chủ Web Admin sau khi đăng nhập và nội dung hướng dẫn cũ',
  muc_dich='Ghi nhận nội dung chào còn nói "chức năng quản lý dành cho ADMIN sẽ có ở bước sau" dù các chức năng đã có; để Owner quyết định sửa chữ.',
  prio='P2', actor='ADMIN-1', dev=('PC',), phones=0, ready='CẦN XÁC MINH',
  note='Lệch nội dung: trang chủ ghi "Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau." và với SYSTEM ghi "Các mục có nhãn “Sắp có” sẽ được mở ở bước sau." nhưng nhiều mục đã hoạt động.',
  pre='Đăng nhập ADMIN-1.',
  steps=admin_login('ADMIN-1') + [
    ('Đọc nội dung trang chủ ngay sau đăng nhập (tiêu đề "Đăng nhập thành công" và hai dòng bên dưới).', 'Ghi lại nguyên văn; so với các mục thực tế trong menu. Nếu câu chữ gây hiểu nhầm, báo như lỗi mức Thấp.'),
  ],
  restore=R_NONE, ref='apps/admin-web/src/dom/shell-app.ts (#home)', auto='Không có.')

T('TC-ADM-035', ngay=5, seq=53, ten='Xóa tài khoản người dùng: chỉ xóa hẳn khi không có dữ liệu liên quan',
  muc_dich='Tránh mất dữ liệu: tài khoản có đơn/ví chỉ bị khóa; tài khoản chưa có gì mới bị xóa vĩnh viễn.',
  prio='P1', actor='SYSTEM', dev=('PC',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Xóa vĩnh viễn KHÔNG hoàn tác được. Chỉ dùng tài khoản rác tạo riêng cho test này (đăng ký xong chưa làm gì).',
  pre='Một tài khoản rác KH-DEL vừa đăng ký, chưa có đơn/địa chỉ. Một tài khoản có dữ liệu (KH-B đã có đơn).',
  steps=[
    ('Mở chi tiết KH-B (có dữ liệu), bấm "Xóa tài khoản".', 'Hộp thoại nói rõ "Tài khoản có dữ liệu liên quan: "Xóa tài khoản" không xóa mà chuyển sang khóa theo yêu cầu xóa, giữ nguyên mọi dữ liệu."'),
    ('Hủy hộp thoại (không xóa KH-B).', 'Không thay đổi.'),
    ('Mở chi tiết KH-DEL (chưa có dữ liệu), bấm "Xóa tài khoản" > "Xóa tài khoản?" và xác nhận.', 'Tài khoản bị xóa vĩnh viễn; số điện thoại đó đăng ký lại sẽ tạo tài khoản mới.'),
  ],
  restore='Không hoàn tác được; chỉ dùng tài khoản rác.', ref='apps/admin-web/src/dom/accounts-view.ts (Xóa tài khoản); docs/current/M01-final-package-20261014.md mục 8',
  auto='tests/integration/account-lifecycle.int.spec.ts', sev='Cao')

T('TC-ADM-036', ngay=4, seq=72.7, ten='Admin xử lý yêu cầu giao: giải phóng shipper, ghi nhận hàng, điều chỉnh sau lấy hàng, chuyển phản ánh',
  muc_dich='Admin có công cụ xử lý sự cố khi shipper mất liên lạc, hàng bị kẹt hoặc phí/địa chỉ cần sửa sau khi lấy hàng; mọi thao tác phải có lý do và nhật ký.',
  prio='P1', actor='ADMIN (quyền Khóa/Duyệt) / SYSTEM', dev=('PC', 'P3'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ADM-023',
  data='Lý do: "TEST xử lý sự cố". Phí mới: 20000. Địa chỉ mô tả mới: "Số 20 đường Test, tổ 6 (sửa TEST)".',
  pre='Chuẩn bị 3 yêu cầu giao DIRECT thử: (1) SP-A đã nhận, CHƯA lấy hàng; (2) SP-A đã lấy hàng, đang giao; (3) một yêu cầu đã bị hủy sau khi lấy hàng và còn hồ sơ hàng mở (TC-FLOW-020). Admin đăng nhập Web Admin.',
  steps=[
    menu_go('VẬN HÀNH > "Giao hàng"'),
    ('Mở yêu cầu (1), chạm "Giải phóng shipper" (hộp có lời giải thích "Dùng khi tài khoản shipper bị khóa hoặc thiết bị hỏng và đơn chưa lấy hàng…"), thử xác nhận khi chưa nhập lý do.', 'Báo "Lý do là bắt buộc."; không thực hiện.'),
    ('Nhập lý do và xác nhận.', 'Shipper bị gỡ khỏi đơn; yêu cầu quay lại "Đang tìm" (nếu còn thời hạn tìm); hoa hồng của shipper được giải phóng. Trên 11Ship SP-A thấy "Admin đã gỡ bạn khỏi đơn".'),
    ('Mở yêu cầu (2), chạm "Điều chỉnh sau lấy hàng", nhập "Phí mới (đ)" = 20000 và/hoặc "Địa chỉ mới", lý do, xác nhận.', 'Phí/địa chỉ được đổi; trong diễn biến có dòng ghi trước/sau và lý do; shipper và quán thấy phí/địa chỉ mới.'),
    ('Mở yêu cầu (3), chạm "Ghi nhận hàng" > chọn "Hàng đã về quán, sẵn sàng gọi lại" (hoặc "Đã xử lý, không giao tiếp") và nhập lý do.', 'Hồ sơ hàng đóng; hiện chú thích "Đây là ghi nhận, không tự bồi thường hay hoàn tiền."'),
    ('(Nếu có hồ sơ phản ánh) Chạm "Chuyển phản ánh (M11)".', 'Chỉ đánh dấu "Đã chuyển M11" và ghi nhật ký; không tạo phiếu giả.'),
    ('ADMIN-2 (chỉ xem) mở cùng trang.', 'Không có các nút thao tác ("Tài khoản này không có quyền thực hiện thao tác này.").'),
  ],
  restore='Dọn các yêu cầu thử (hủy hoặc hoàn tất).', ref='apps/admin-web/src/dom/deliveries-view.ts; docs/current/M07-implementation-20261018.md (Admin actions)',
  auto='tests/integration/m07-delivery.int.spec.ts (admin actions)', sev='Cao')

