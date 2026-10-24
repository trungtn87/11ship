# -*- coding: utf-8 -*-
from lib import *

ACCUI = 'mobile/packages/n11_shared/lib/src/account/account_views.dart'
SESS = 'mobile/packages/n11_shared/lib/src/account/session_controller.dart'

# =====================================================================================================
# SET - Cài đặt, thiết bị, phiên bản
# =====================================================================================================

T('TC-SET-001', ngay=1, seq=1, ten='Cài đặt 11Food lần đầu từ file APK',
  muc_dich='Bảo đảm người mới cài được ứng dụng dành cho khách và chủ quán lên điện thoại Android và mở được lần đầu.',
  prio='P0', actor='Người kiểm thử (chưa cần tài khoản)', dev=('P1',), phones=1,
  pre='Có file APK 11Food (tên dạng "11Food-vX.Y.Z.apk") do Người phụ trách gửi. Điện thoại Android 8.0 trở lên, đang có Internet. Chưa cài 11Food (nếu đã cài, gỡ trước ở Cài đặt > Ứng dụng > 11Food > Gỡ cài đặt).',
  data='Không có. Dùng đúng file APK Người phụ trách gửi, không tải từ nơi khác.',
  steps=[
    ('Chép file APK 11Food vào Điện thoại 1 (qua Zalo, Google Drive hoặc cáp USB). Mở ứng dụng "Tệp" (Files) > thư mục "Tải xuống" (Downloads).', 'Thấy file APK 11Food trong danh sách.'),
    ('Chạm vào file APK.', 'Android hiện màn hình cài đặt ứng dụng (hoặc hỏi quyền cài từ nguồn này nếu là lần đầu).'),
    ('Nếu Android hỏi "Cho phép cài ứng dụng không xác định từ nguồn này": chạm "Cài đặt", bật công tắc "Cho phép từ nguồn này", rồi bấm nút quay lại. Nếu Google Play Protect hiện cảnh báo, chỉ chạm "Vẫn cài đặt" khi file do Người phụ trách gửi.', 'Công tắc được bật; quay lại được màn hình cài đặt ứng dụng.'),
    ('Chạm "Cài đặt" (Install) và chờ đến khi xong.', 'Android báo cài thành công, có nút "Mở". Không có thông báo "Ứng dụng chưa được cài đặt".'),
    ('Chạm "Mở".', 'Ứng dụng 11Food mở ra, thanh dưới cùng có các tab "Trang chủ", "Đơn hàng", "Tài khoản". Không hiện thanh báo lỗi kết nối màu đỏ/cam kéo dài (nếu có "Đang kiểm tra…" thì biến mất sau vài giây).'),
    ('Thoát ứng dụng (nút Home) và tìm biểu tượng trên màn hình điện thoại.', 'Có biểu tượng ứng dụng tên "11Food".'),
  ],
  restore='Không bắt buộc. Nếu muốn chạy lại từ đầu: Cài đặt > Ứng dụng > 11Food > Gỡ cài đặt, rồi làm lại từ bước 1.',
  ref='.github/workflows/mobile-apk.yml (tạo APK 11Food); mobile/README.md (mục "Get the APKs"); mobile/tool/prepare-android.sh (nhãn ứng dụng "11Food", minSdk 26)',
  auto='CI workflow "Mobile APK": kiểm chữ ký, quyền, applicationId (không thay thế việc cài tay).')

T('TC-SET-002', ngay=1, seq=2, ten='Cài đặt 11Ship lần đầu từ file APK',
  muc_dich='Bảo đảm shipper cài được ứng dụng giao hàng lên điện thoại Android và mở được lần đầu.',
  prio='P0', actor='Người kiểm thử (chưa cần tài khoản)', dev=('P3',), phones=1,
  pre='Có file APK 11Ship (tên dạng "11Ship-vX.Y.Z.apk") do Người phụ trách gửi. Điện thoại Android 8.0 trở lên có GPS và Internet. Chưa cài 11Ship.',
  data='Không có.',
  steps=[
    ('Chép file APK 11Ship vào Điện thoại 3, mở ứng dụng "Tệp" > "Tải xuống" và chạm vào file APK.', 'Android hiện màn hình cài đặt ứng dụng.'),
    ('Nếu Android hỏi "Cho phép cài ứng dụng không xác định từ nguồn này": chạm "Cài đặt", bật công tắc "Cho phép từ nguồn này" rồi bấm nút quay lại. Sau đó chạm "Cài đặt" (Install) và chờ đến khi xong.', 'Cài thành công, có nút "Mở".'),
    ('Chạm "Mở".', 'Ứng dụng 11Ship mở ra; thanh dưới cùng có các tab "Trang chủ", "Đơn hàng", "Thu nhập", "Thông báo", "Tài khoản".'),
    ('Nhìn trang chủ khi chưa đăng nhập.', 'Hiện lời mời đăng nhập tài khoản shipper (dòng "Đăng nhập tài khoản shipper"). Không hiện số dư, đơn hay doanh thu giả.'),
  ],
  restore='Gỡ cài đặt ở Cài đặt > Ứng dụng > 11Ship nếu cần làm lại.',
  ref='mobile/ship/lib/ship_tabs.dart (5 tab); mobile/ship/lib/ship_home.dart (guest-login); mobile/tool/prepare-android.sh',
  auto='Workflow "Mobile APK" (build + kiểm quyền).')

T('TC-SET-003', ngay=1, seq=3, ten='Cài cả 11Food và 11Ship trên cùng một điện thoại',
  muc_dich='Một số người kiểm thử chỉ có 1-2 điện thoại nên phải cài cả hai ứng dụng trên một máy. Hai ứng dụng không được làm hỏng nhau.',
  prio='P1', actor='Người kiểm thử', dev=('P1',), phones=1,
  pre='Có cả hai file APK. Chưa cài ứng dụng nào trên máy này.',
  steps=[
    ('Chép file APK 11Food vào điện thoại, mở ứng dụng "Tệp" > "Tải xuống", chạm vào file APK. Nếu Android hỏi "Cho phép cài ứng dụng không xác định từ nguồn này": chạm "Cài đặt", bật công tắc "Cho phép từ nguồn này" rồi bấm nút quay lại. Sau đó chạm "Cài đặt" (Install) và chờ đến khi xong. Rồi chạm "Mở".', '11Food cài và mở được.'),
    ('Làm tương tự với file APK 11Ship trên cùng điện thoại: mở ứng dụng "Tệp" > "Tải xuống", chạm vào file APK 11Ship, chạm "Cài đặt" (Install) và chờ xong, rồi chạm "Mở".', '11Ship cài và mở được. Không có thông báo xung đột; 11Food vẫn còn trên máy.'),
    ('Mở lần lượt từng ứng dụng, chạm tab "Tài khoản" ở mỗi ứng dụng.', 'Mỗi ứng dụng hiện màn hình Tài khoản của riêng mình (11Food: "Tạo tài khoản"/"Đăng nhập"; 11Ship: màn Tài khoản của shipper).'),
    ('Dùng nút nhiều nhiệm (Recent apps) chuyển qua lại giữa hai ứng dụng 3 lần.', 'Chuyển qua lại bình thường, không tự thoát, không báo lỗi.'),
  ],
  restore='Không cần.',
  ref='mobile/tool/prepare-android.sh (hai applicationId riêng, cùng khóa ký); docs/current/M01-password-sessions-20261023.md (bản mới không còn ghép đôi/JOIN giữa hai app)',
  auto='Workflow "Mobile APK" (build hai app).')

T('TC-SET-004', ngay=1, seq=4, ten='Cấp quyền vị trí (GPS) cho 11Food lần đầu',
  muc_dich='Khách cần cho phép ứng dụng biết vị trí để thấy quán gần mình. Kiểm tra cả hai lựa chọn "Cho phép" và "Không cho phép".',
  prio='P1', actor='Khách', dev=('P1',), phones=1,
  pre='11Food mới cài (hoặc đã xóa quyền vị trí: Cài đặt > Ứng dụng > 11Food > Quyền > Vị trí > Không cho phép). Bật GPS (Vị trí) của điện thoại. Người kiểm thử đang ở trong khu vực phục vụ (TP Cao Bằng, bán kính khoảng 10 km tính từ trung tâm).',
  steps=[
    ('Mở 11Food, ở tab "Trang chủ" làm theo lời nhắc xin quyền vị trí. Chọn "Không cho phép".', 'Trang chủ báo chưa có vị trí: có dòng "Chưa được cấp quyền vị trí. Thử lại". Ứng dụng không bị thoát.'),
    ('Vào Cài đặt điện thoại > Ứng dụng > 11Food > Quyền > Vị trí, chọn "Chỉ cho phép khi dùng ứng dụng".', 'Quyền được bật.'),
    ('Quay lại 11Food, chạm "Thử lại".', 'Ứng dụng chờ định vị ("Đang định vị…" / "Đang xác định khu vực…") rồi hiện khu vực và danh sách "Quán gần bạn".'),
  ],
  restore='Có thể để quyền bật. Muốn chạy lại: Cài đặt > Ứng dụng > 11Food > Quyền > Vị trí > Không cho phép.',
  ref='mobile/packages/n11_shared/lib/src/m02/discovery_views.dart ("Chưa được cấp quyền vị trí. Thử lại", "Đang định vị…")',
  auto='mobile/packages/n11_shared/test/m02_discovery_test.dart; m02_gps_area_test.dart')

T('TC-SET-005', ngay=1, seq=5, ten='Cấp quyền thông báo và vị trí cho 11Ship',
  muc_dich='Shipper cần vị trí và thông báo để nhận đơn gần mình. Kiểm tra ứng dụng hướng dẫn rõ khi thiếu quyền.',
  prio='P1', actor='Shipper', dev=('P3',), phones=1,
  pre='11Ship mới cài và đã đăng nhập SP-A (làm TC-ACC-004 trước). Android 13 trở lên sẽ hỏi quyền thông báo; Android thấp hơn tự bật.',
  deps='TC-ACC-004',
  steps=[
    ('Mở 11Ship, ở Trang chủ chạm "Bật online". Khi điện thoại hỏi quyền vị trí chọn "Không cho phép".', 'Ứng dụng không bật được online; có hướng dẫn bằng chữ và nút "Mở cài đặt vị trí" hoặc "Thử lại". Không hiện mã lỗi kỹ thuật.'),
    ('Chạm "Mở cài đặt vị trí", bật quyền vị trí "Chỉ cho phép khi dùng ứng dụng" rồi quay lại ứng dụng.', 'Quay lại được ứng dụng.'),
    ('Nếu điện thoại Android 13+ chưa cấp quyền thông báo: chạm "Bật online" lại, chọn "Không cho phép" ở hộp hỏi quyền thông báo.', 'Ứng dụng hiện hướng dẫn "Hãy bật thông báo của 11Ship để vị trí được chia sẻ khi bạn dùng ứng dụng khác." cùng nút "Mở cài đặt thông báo".'),
    ('Chạm "Mở cài đặt thông báo", bật thông báo, quay lại và chạm "Thử lại".', 'Trạng thái chuyển sang "Đang lấy vị trí…" rồi "Đang chia sẻ vị trí" (nếu ví đủ điều kiện).'),
  ],
  restore='Tắt online (nút "Tắt online") sau khi xong. Quyền có thể để bật.',
  ref='mobile/ship/lib/ship_online.dart (các thông báo hướng dẫn quyền); docs/current/M14-online-location-20261024.md',
  auto='mobile/ship/test (ship_online_test); m07_location_test.')

T('TC-SET-006', ngay=1, seq=6, ten='Xem số phiên bản của ứng dụng để ghi vào báo cáo',
  muc_dich='Mỗi báo cáo lỗi và mỗi dòng kết quả phải ghi đúng phiên bản APK đang thử. Test này chỉ cách tìm số phiên bản qua Cài đặt của Android (đủ dùng, không cần màn hình riêng trong ứng dụng).',
  prio='P0', actor='Người kiểm thử', dev=('P1', 'P3'), phones=1,
  pre='Đã cài 11Food và/hoặc 11Ship. Có tên file APK do Người phụ trách gửi (ví dụ ghi trong tin nhắn gửi file).',
  note='ĐÃ GIẢI QUYẾT (không cần Owner để chạy test): trong mã hiện tại ứng dụng KHÔNG có chỗ hiện số phiên bản cho người dùng (màn "Chẩn đoán kết nối" có dòng "Phiên bản" nhưng không có đường vào từ tab Tài khoản). Vì vậy dùng cách xem qua Cài đặt Android bên dưới; tên mục có thể khác chút tùy hãng điện thoại. Việc có nên thêm chỗ hiện phiên bản trong ứng dụng là câu hỏi OQ-04 cho Owner, KHÔNG chặn test.',
  steps=[
    ('Cách 1: trên màn hình chính, nhấn giữ biểu tượng 11Food rồi chạm biểu tượng "i" / "Thông tin ứng dụng". Cách 2 (nếu không thấy): mở Cài đặt > Ứng dụng > chọn 11Food. Kéo xuống cuối màn hình thông tin ứng dụng (mục có thể tên "Thông tin ứng dụng" hoặc "Về ứng dụng").', 'Thấy dòng "Phiên bản" (ví dụ 1.0.x). Ghi số này vào cột "Phiên bản APK hoặc bản triển khai" của file kết quả. Nếu không tìm thấy dòng "Phiên bản" sau khi thử cả hai cách: ghi BLOCKED và nhờ Người phụ trách chỉ đúng mục trên hãng máy của bạn.'),
    ('Làm tương tự cho 11Ship.', 'Thấy "Phiên bản" của 11Ship. Ghi lại.'),
    ('Đối chiếu với tên file APK do Người phụ trách gửi (ví dụ 11Food-v1.0.5.apk).', 'Số phiên bản trên máy khớp với tên file. Nếu khác, báo Người phụ trách trước khi thử tiếp (có thể bạn đang cài nhầm bản).'),
    ('(Tùy chọn - chỉ khi có kỹ thuật viên) Nhờ kỹ thuật viên mở Web Admin > Vận hành hệ thống > "Phiên bản & cập nhật" và đối chiếu phiên bản thiết bị báo lên.', 'Phiên bản thiết bị báo lên khớp với phiên bản trên máy. Bước này không bắt buộc; bỏ qua nếu không có kỹ thuật viên và ghi "bỏ qua bước 4".'),
  ],
  verdict='PASS: bước 1-3 đúng (đọc được và ghi lại số phiên bản của từng ứng dụng, khớp tên file APK). FAIL: số phiên bản trên máy KHÁC tên file APK mà không có giải thích. BLOCKED: không tìm được dòng "Phiên bản" trên máy. Bước 4 là tùy chọn, không ảnh hưởng PASS/FAIL.',
  restore=R_NONE,
  ref='docs/process/release-versioning-20261019.md (phiên bản gắn với APK); account_views.dart:212 (showDiagnostics); mobile/ship/lib/ship_tabs.dart (showDiagnostics:false)',
  auto='mobile/packages/n11_shared/test/health_test.dart (màn chẩn đoán, không có đường vào từ Tài khoản).')

T('TC-SET-007', ngay=1, seq=7, ten='Cập nhật đè bản mới của 11Food (không gỡ app)',
  muc_dich='Khi có bản mới, người dùng cài đè lên bản cũ mà không mất đăng nhập, giỏ hàng và dữ liệu.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  deps='TC-ACC-001',
  pre='Có HAI file APK 11Food: bản cũ (A) và bản mới hơn (B), cùng do Người phụ trách cấp (cùng chữ ký, số hiệu bản dựng của B lớn hơn A). Máy đang cài bản A và đã đăng nhập KH-A, có 1 món trong giỏ.',
  steps=[
    ('Trên 11Food bản A, chụp màn hình tab "Tài khoản" (thấy tên KH-A) và giỏ hàng (có 1 món).', 'Có ảnh chụp "trước khi cập nhật".'),
    ('Chép file APK bản B vào điện thoại, chạm vào file, chọn "Cập nhật" / "Cài đặt".', 'Android báo "Bạn có muốn cập nhật ứng dụng này không?" và cài thành công. KHÔNG phải gỡ ứng dụng trước.'),
    ('Mở 11Food sau khi cài xong.', 'Ứng dụng mở bình thường.'),
    ('Chạm tab "Tài khoản".', 'Vẫn đăng nhập KH-A, không bị hỏi đăng nhập lại. NGOẠI LỆ ĐÚNG THIẾT KẾ: nếu Người phụ trách cho biết bản A là bản CŨ trước ngày 23/10 (phiên gắn với thiết bị), ứng dụng đòi đăng nhập lại bằng mật khẩu đúng một lần (Owner 23/10); đăng nhập xong thấy lại đúng tài khoản KH-A với dữ liệu nguyên vẹn.'),
    ('Mở giỏ hàng.', 'Món trong giỏ vẫn còn đúng như trước.'),
    ('Ghi phiên bản mới (cách xem ở TC-SET-006).', 'Phiên bản mới lớn hơn phiên bản cũ.'),
  ],
  verdict=DEFAULT_VERDICT + ' Nếu Android báo "Ứng dụng chưa được cài đặt vì xung đột với gói hiện có" thì FAIL nghiêm trọng (chữ ký hoặc số hiệu bản dựng sai).',
  restore='Không cần. Muốn thử lại cần có thêm một bản cũ hơn (không thể hạ phiên bản ngay; phải gỡ app rồi cài bản cũ).',
  ref='AGENTS.md (mục "Android test updates"); mobile/README.md; .github/workflows/mobile-apk.yml (versionCode tăng dần, khóa ký bền vững)',
  auto='Workflow "Mobile APK": bước kiểm chữ ký và versionCode.')

T('TC-SET-008', ngay=1, seq=8, ten='Cập nhật đè bản mới của 11Ship khi đang đăng nhập',
  muc_dich='Shipper cập nhật app không bị mất phiên đăng nhập và không mất trạng thái hoạt động.',
  prio='P0', actor='Shipper', dev=('P3',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  deps='TC-ACC-004',
  pre='Có hai file APK 11Ship (bản cũ A, bản mới B). Máy đang cài bản A, đã đăng nhập SP-A, đang TẮT online, không có đơn đang giao.',
  steps=[
    ('Trên 11Ship bản A, vào tab "Tài khoản" và chụp màn hình (thấy tên SP-A).', 'Có ảnh chụp trước khi cập nhật.'),
    ('Cài đè file APK bản B (không gỡ bản cũ).', 'Cài thành công, báo cập nhật.'),
    ('Mở 11Ship.', 'Mở bình thường.'),
    ('Chạm tab "Tài khoản".', 'Vẫn đăng nhập SP-A. NGOẠI LỆ ĐÚNG THIẾT KẾ: nếu bản A là bản CŨ trước ngày 23/10, ứng dụng đòi đăng nhập lại bằng mật khẩu một lần; đăng nhập xong thấy lại SP-A, ví và lịch sử đơn nguyên vẹn.'),
    ('Chạm tab "Trang chủ".', 'Hiện "Bạn đang offline" (đúng trạng thái trước khi cập nhật). Không tự bật online khi shipper chưa bấm.'),
  ],
  restore='Không cần.',
  ref='AGENTS.md (cập nhật đè giữ dữ liệu); mobile/ship/lib/ship_online.dart (không tự bật online khi chưa có ý định)',
  auto='Workflow "Mobile APK".')

T('TC-SET-009', ngay=5, seq=60, ten='Ứng dụng báo "Có bản mới" và cập nhật ngay trong ứng dụng',
  muc_dich='Kiểm tra cơ chế tự báo bản mới (tải, kiểm tra mã an toàn, mở trình cài đặt Android).',
  prio='P1', actor='Khách hoặc Shipper', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Kỹ thuật viên (tài khoản SYSTEM) đã đăng ký một bản phát hành mới trong Web Admin > Vận hành hệ thống > "Phiên bản & cập nhật" và điện thoại đang chạy bản cũ hơn. Chưa có bản nào được đăng ký thì test này BLOCKED.',
  steps=[
    ('Mở ứng dụng bản cũ, đăng nhập và ở yên trên Trang chủ vài giây.', 'Hiện thông báo "Có bản mới X.Y.Z" với nút "Cập nhật (… MB)" và "Để sau".'),
    ('Chạm "Để sau".', 'Thông báo ẩn đi, ứng dụng dùng bình thường.'),
    ('Đóng và mở lại ứng dụng. Chạm "Cập nhật".', 'Hiện "Đang tải..." rồi Android mở trình cài đặt. Nếu Android hỏi cho phép cài ứng dụng thì chọn cho phép rồi bấm "Cập nhật" lại.'),
    ('Xác nhận cài trong màn hình của Android.', 'Cài xong, ứng dụng mở lại ở phiên bản mới.'),
  ],
  restore='Nhờ kỹ thuật viên đặt lại điều kiện phát hành nếu muốn thử lại.',
  ref='mobile/packages/n11_shared/lib/src/m13/m13_views.dart, m13_update.dart; docs/current/M13-implementation-20261023.md',
  auto='mobile/packages/n11_shared/test/m13_test.dart; tests/integration/m13-ops.int.spec.ts')

T('TC-SET-010', ngay=5, seq=61, ten='Bản bắt buộc cập nhật: ứng dụng bản cũ bị chặn',
  muc_dich='Khi bản cũ không còn dùng được, ứng dụng phải nói rõ phải cập nhật, và không cho mất đơn đang giao.',
  prio='P1', actor='Khách hoặc Shipper', dev=('P3',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Kỹ thuật viên đã đánh dấu "Bắt buộc cập nhật" cho một bản phát hành mới hơn bản đang cài (Web Admin > Vận hành hệ thống > "Phiên bản & cập nhật").',
  steps=[
    ('Mở ứng dụng bản cũ khi KHÔNG có đơn đang giao.', 'Hiện thông báo "Cần cập nhật ứng dụng" hoặc "Cần cập nhật lên X.Y.Z" và dòng "Bản hiện tại không còn dùng được. Cập nhật lên … để tiếp tục."'),
    ('(Chỉ với shipper) Lặp lại khi shipper đang có một đơn đã nhận.', 'Hiện "Cần cập nhật X.Y.Z sau khi xong đơn": shipper vẫn hoàn tất được đơn đang giao trước khi cập nhật.'),
  ],
  restore='Kỹ thuật viên gỡ cờ "Bắt buộc" hoặc phát hành bản mới.',
  ref='mobile/packages/n11_shared/lib/src/m13/m13_views.dart (dòng "Cần cập nhật … sau khi xong đơn")',
  auto='mobile/packages/n11_shared/test/m13_test.dart')

T('TC-SET-011', ngay=1, seq=9, ten='Điện thoại thường (không cần chip bảo mật đặc biệt) vẫn đăng nhập bằng mật khẩu được, không bị chặn vì "xác thực phần cứng"',
  muc_dich='Theo quyết định của Owner ngày 23/10 (PR #170), bản 11Food/11Ship mới KHÔNG còn bắt điện thoại phải chứng minh phần cứng khi đăng ký/đăng nhập bằng mật khẩu. Kiểm tra bản APK đang thử không còn chặn máy phổ thông bằng thông báo "xác thực phần cứng".',
  prio='P2', actor='Người kiểm thử', dev=('P1',), phones=1, deps='TC-ACC-014',
  note='Bản cũ của ứng dụng (trước 23/10) từng chặn máy đã root/mở khóa bootloader/máy ảo bằng thông báo "DEVICE_PROOF_UNSUPPORTED". Tài liệu mobile/README.md còn ghi như vậy nhưng ĐÃ LỖI THỜI. KHÔNG tự root hay mở khóa bootloader điện thoại để thử. Bước 3 chỉ làm nếu Người phụ trách đưa sẵn một máy cũ/máy ảo/máy đã mở khóa; nếu không có thì bỏ qua bước 3 và vẫn kết luận theo bước 1-2. Thông báo "xác thực phần cứng" vẫn còn trong mã chỉ để phục vụ các APK cũ còn phiên cũ.',
  pre='Đã cài 11Food bản mới do Người phụ trách gửi (kiểm tra số phiên bản theo TC-SET-006, phải đúng bản đang thử). Đã có tài khoản KH-A (TC-ACC-001). Đang đăng xuất.',
  steps=[
    ('Mở 11Food, chạm tab "Tài khoản", chạm "Đăng nhập", nhập số điện thoại và mật khẩu của KH-A, chạm "Đăng nhập".', 'Đăng nhập thành công, thấy tên KH-A. KHÔNG hiện thông báo "Thiết bị này chưa hỗ trợ xác thực phần cứng…", KHÔNG hiện "DEVICE_PROOF_UNSUPPORTED", KHÔNG hiện "Máy chủ chưa xác nhận được thiết bị".'),
    ('Chạm "Đăng xuất" rồi đăng nhập lại KH-A một lần nữa.', 'Vẫn đăng nhập thành công, cũng không có thông báo về thiết bị/phần cứng.'),
    ('(Chỉ khi Người phụ trách đưa sẵn máy cũ, máy ảo hoặc máy đã mở khóa) Cài cùng bản 11Food lên máy đó và đăng nhập KH-A.', 'Đăng nhập thành công như bước 1; không bị chặn riêng vì loại thiết bị. (Không có máy như vậy thì ghi "bỏ qua bước 3" ở Ghi chú kết quả.)'),
  ],
  verdict='PASS: các bước đã làm đều đúng. FAIL: bản APK đang thử (đã xác nhận là bản mới) vẫn chặn đăng nhập bằng thông báo về thiết bị/xác thực phần cứng - chụp màn hình, ghi số phiên bản và báo lỗi mức Cao. BLOCKED: nếu số phiên bản là bản cũ trước 23/10 thì KHÔNG báo lỗi; ghi "đang cài nhầm bản cũ" và xin bản mới. Không ghi PASS/FAIL cho bước 3 nếu không có máy phù hợp.',
  restore='Đăng xuất. Nếu đã cài thử lên máy mượn thì gỡ ứng dụng khỏi máy đó.',
  ref='docs/current/M01-password-sessions-20261023.md (quyết định Owner 23/10, PR #170: không còn attestation bắt buộc cho đăng ký/đăng nhập thường); mobile/packages/n11_shared/lib/src/account/native_auth.dart (Keystore chỉ mã hóa token); mobile/README.md mục "Device proof" ĐÃ LỖI THỜI',
  auto='tests/integration/client-auth-session.int.spec.ts (đăng nhập PASSWORD); mobile/packages/n11_shared/test (đăng nhập/đăng ký không cần phần cứng)')

T('TC-SET-012', ngay=1, seq=10, ten='Gỡ ứng dụng rồi cài lại: phải đăng nhập lại, dữ liệu trên máy chủ còn nguyên',
  muc_dich='Dữ liệu thật (tài khoản, đơn, ví) nằm trên máy chủ, không nằm trên điện thoại. Gỡ app không làm mất tài khoản.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-ACC-001',
  pre='KH-A đã đăng ký và đã từng đăng nhập trên máy này.',
  steps=[
    ('Gỡ cài đặt 11Food (Cài đặt > Ứng dụng > 11Food > Gỡ cài đặt).', 'Ứng dụng biến mất khỏi máy.'),
    ('Cài lại 11Food từ file APK và mở ứng dụng.', 'Mở ra ở trạng thái chưa đăng nhập.'),
    ('Đăng nhập lại bằng KH-A.', 'Đăng nhập được (hoặc, nếu máy chủ yêu cầu xác minh thiết bị mới, ứng dụng nói rõ lý do). Tên, địa chỉ đã lưu của KH-A vẫn còn.'),
  ],
  restore=R_LOGOUT,
  ref='mobile/README.md (Storage: token mã hóa trong kho không sao lưu); session_controller.dart',
  auto='mobile/packages/n11_shared/test/session_controller_test.dart')

# =====================================================================================================
# ACC - Tài khoản
# =====================================================================================================

T('TC-ACC-001', ngay=1, seq=10, ten='Đăng ký tài khoản khách hàng KH-A trên 11Food (có mã OTP)',
  muc_dich='Một người hoàn toàn mới tạo được tài khoản khách để đặt món. OTP là mã 6 số gửi qua tin nhắn SMS để chứng minh số điện thoại là của bạn.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='11Food đã cài. Số điện thoại SĐT-KH-A là số có SIM thật, nhận được SMS, CHƯA từng đăng ký 11Food/11Ship. Hệ thống gửi SMS (máy "SMS Gateway") đang bật và số này được phép nhận SMS (nếu hệ thống đang giới hạn danh sách số thì Người phụ trách phải thêm sẵn). Có Internet.',
  data='Họ và tên: "Khách Test A". Mật khẩu: 8-128 ký tự do bạn tự đặt và ghi vào bảng riêng (ví dụ 1 chữ hoa, 1 chữ số). Nhập lại mật khẩu: giống hệt. Số điện thoại: SĐT-KH-A (10 số, bắt đầu bằng 0, ví dụ 0912345678). Mục đích sử dụng: "Khách hàng".',
  steps=[
    ('Mở 11Food > tab "Tài khoản" > chạm "Tạo tài khoản".', 'Màn hình "Đăng ký · 1/3" với tiêu đề "Tạo tài khoản", có ô "Họ và tên", "Mật khẩu", "Nhập lại mật khẩu", khung điều khoản và ô tích đồng ý.'),
    ('Nhập Họ và tên "Khách Test A", Mật khẩu, Nhập lại mật khẩu. Kéo đọc khung điều khoản. Tích ô "Tôi đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư." rồi chạm "Tiếp tục".', 'Sang màn "Đăng ký · 2/3" tiêu đề "Mục đích sử dụng", có hai lựa chọn "Khách hàng" và "Chủ quán".'),
    ('Chọn "Khách hàng" rồi chạm "Tiếp tục".', 'Sang màn "Đăng ký · 3/3" tiêu đề "Số điện thoại & OTP", có ô "Số điện thoại". Có dòng "Xác minh số điện thoại: Mã gồm 6 số được gửi bằng tin nhắn SMS đến số điện thoại đăng ký."'),
    ('Nhập số điện thoại SĐT-KH-A, chạm "Gửi mã xác minh".', 'Hiện "Đang gửi tin nhắn…" và nút/đồng hồ "Gửi lại sau … giây". Ô "Mã xác minh" chỉ nhập được sau khi tin nhắn đã được gửi đi.'),
    ('Chờ tin nhắn SMS đến điện thoại (có thể chậm vài chục giây). Gõ 6 số trong tin nhắn vào ô "Mã xác minh" rồi chạm "Xác nhận mã".', 'Hiện thông báo xanh "Đã xác minh số điện thoại".'),
    ('Chạm "Hoàn tất đăng ký".', 'Hiện "Đăng ký thành công." và ứng dụng trở về, đã đăng nhập: tab "Tài khoản" hiện "Khách Test A", số điện thoại che bớt, nhãn "Khách hàng".'),
  ],
  restore='Không xóa được tài khoản bằng ứng dụng. Muốn chạy lại cần số điện thoại khác, hoặc nhờ Admin (SYSTEM) dùng "Xóa tài khoản" ở Web Admin (chỉ xóa hẳn khi tài khoản chưa có dữ liệu). Ghi lại KH-A là tài khoản dùng cho các ngày sau.',
  ref=ACCUI + ' (RegisterScreen/_foodForm, 3 bước); apps/backend/src/client-auth; ops/runbooks/sms-gateway.md',
  auto='tests/integration/client-auth-register.int.spec.ts; native-required-register.int.spec.ts; mobile/packages/n11_shared/test/otp_flows_test.dart')

T('TC-ACC-002', ngay=1, seq=11, ten='Đăng ký tài khoản khách hàng thứ hai KH-B',
  muc_dich='Cần hai khách khác nhau để thử việc người này không được thấy đơn của người kia.',
  prio='P0', actor='Khách (KH-B)', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ACC-001',
  pre='Đã đăng xuất khỏi KH-A trên máy. Có số SĐT-KH-B (SIM thật, chưa đăng ký) nhận được SMS.',
  data='Họ và tên "Khách Test B"; mật khẩu tự đặt; mục đích "Khách hàng"; số SĐT-KH-B.',
  steps=logout_food('P1') + [
    ('Chạm "Tạo tài khoản"; nhập Họ và tên "Khách Test B", Mật khẩu, Nhập lại mật khẩu, tích ô đồng ý điều khoản, chạm "Tiếp tục"; chọn "Khách hàng", chạm "Tiếp tục"; nhập số SĐT-KH-B, chạm "Gửi mã xác minh", gõ 6 số trong tin nhắn SMS vào ô "Mã xác minh", chạm "Xác nhận mã", rồi chạm "Hoàn tất đăng ký".', 'Đăng ký thành công, tab "Tài khoản" hiện "Khách Test B".'),
    ('Đăng xuất rồi đăng nhập lại bằng KH-A.', 'Vào đúng tài khoản "Khách Test A", không lẫn thông tin của KH-B.'),
  ],
  restore='Như TC-ACC-001.',
  ref=ACCUI, auto='tests/integration/client-auth-register.int.spec.ts')

T('TC-ACC-003', ngay=1, seq=12, ten='Đăng ký với mục đích "Chủ quán" (CQ-A) và chuyển thẳng sang tạo hồ sơ quán',
  muc_dich='Chủ quán đăng ký bằng chính ứng dụng 11Food, chọn mục đích "Chủ quán" thì được dẫn sang tạo hồ sơ quán.',
  prio='P0', actor='Chủ quán (CQ-A)', dev=('P2',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='11Food cài trên Điện thoại 2. Số SĐT-CQ-A (SIM thật, chưa đăng ký).',
  data='Họ và tên "Chủ quán Test A"; mật khẩu tự đặt; mục đích "Chủ quán"; số SĐT-CQ-A.',
  steps=[
    ('Trên Điện thoại 2 mở 11Food > "Tài khoản" > "Tạo tài khoản". Nhập "Chủ quán Test A", mật khẩu, nhập lại mật khẩu, tích đồng ý, "Tiếp tục".', 'Sang màn "Đăng ký · 2/3".'),
    ('Chọn "Chủ quán" (dòng phụ: "Gửi hồ sơ đăng ký quán sau khi xác minh. Chỉ bán hàng sau khi được duyệt.") rồi "Tiếp tục".', 'Sang màn nhập số điện thoại và OTP.'),
    ('Nhập SĐT-CQ-A, "Gửi mã xác minh", nhập mã SMS, "Xác nhận mã", "Hoàn tất đăng ký".', 'Hiện "Đăng ký thành công." rồi tự mở màn "Quản lý cửa hàng" (hồ sơ quán).'),
    ('Đọc màn hình đang mở.', 'Có nội dung "Bạn chưa có hồ sơ cửa hàng" và nút "Tạo hồ sơ cửa hàng". (Việc điền hồ sơ làm ở TC-SHOP-001.)'),
  ],
  note='Câu chữ "Chỉ bán hàng sau khi được duyệt" còn xuất hiện trên màn đăng ký, nhưng theo mã nguồn quán được kích hoạt ngay khi hồ sơ đủ điều kiện (không có bước Admin duyệt). Ghi nhận trong DOI_CHIEU_CODE_TESTCASE.md.',
  restore='Như TC-ACC-001.',
  ref=ACCUI + ' (_leaveWhenSignedIn mở ShopStartScreen); mobile/packages/n11_shared/lib/src/flows/shop_views.dart',
  auto='tests/integration/food-register-browser.int.spec.ts; shop-onboarding.int.spec.ts')

T('TC-ACC-004', ngay=1, seq=13, ten='Đăng ký tài khoản shipper SP-A trên 11Ship (có mã OTP)',
  muc_dich='Shipper mới tạo được tài khoản; theo quy định hiện hành tài khoản shipper được kích hoạt ngay, không chờ Admin duyệt, ví khởi tạo 0 đồng.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='11Ship cài trên Điện thoại 3. Số SĐT-SP-A (SIM thật, chưa đăng ký). Hệ thống SMS đang bật.',
  data='Họ và tên "Shipper Test A"; mật khẩu tự đặt; số SĐT-SP-A.',
  steps=[
    ('Mở 11Ship > tab "Tài khoản" > chạm nút "Tạo tài khoản".', 'Màn hình "Đăng ký" với tiêu đề "Đăng ký shipper" và các ô "Số điện thoại", "Họ và tên", "Mật khẩu", "Nhập lại mật khẩu", ô tích đồng ý điều khoản.'),
    ('Nhập số SĐT-SP-A, "Shipper Test A", mật khẩu, nhập lại mật khẩu; tích "Tôi đã đọc và đồng ý với Điều khoản sử dụng và Chính sách bảo mật"; chạm "Tiếp tục".', 'Sang màn "Xác thực số điện thoại" với dòng "Bước 2/2 · Nhập mã OTP gồm 6 số được gửi qua SMS đến" và số điện thoại bạn vừa nhập.'),
    ('Chạm "Gửi mã xác minh", chờ SMS, nhập 6 số vào ô "Mã xác minh", chạm "Xác nhận mã".', 'Hiện "Đã xác minh số điện thoại".'),
    ('Chạm "Hoàn tất đăng ký".', 'Đăng ký thành công, đã đăng nhập; tab "Tài khoản" có nhãn "Shipper".'),
    ('Sang tab "Trang chủ".', 'Hiện "Bạn đang offline" và các lựa chọn ví ("Ví tiền / Nạp tiền"). Chưa nhận được đơn vì chưa nạp tiền (sẽ kiểm ở nhóm Ví).'),
  ],
  restore='Như TC-ACC-001.',
  ref=ACCUI + ' (nhánh _ship, _otpPage); docs/current/M03-simplified-onboarding-20261020.md (đăng ký shipper = ACTIVE ngay, ví 0đ)',
  auto='tests/integration/m03-shipper.int.spec.ts; driver-onboarding.int.spec.ts')

T('TC-ACC-005', ngay=1, seq=14, ten='Đăng ký tài khoản shipper thứ hai SP-B',
  muc_dich='Cần hai shipper khác nhau: SP-A có tiền trong ví, SP-B không đủ tiền.',
  prio='P0', actor='Shipper (SP-B)', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-SET-003',
  pre='11Ship cài trên Điện thoại 1 (hoặc Điện thoại 3 sau khi đăng xuất SP-A). Có số SĐT-SP-B (SIM thật, chưa đăng ký).',
  data='Họ và tên "Shipper Test B"; mật khẩu tự đặt; số SĐT-SP-B.',
  steps=[
    ('Mở 11Ship > tab "Tài khoản" > "Tạo tài khoản"; nhập số SĐT-SP-B, Họ và tên "Shipper Test B", mật khẩu, nhập lại mật khẩu, tích ô đồng ý điều khoản, chạm "Tiếp tục"; chạm "Gửi mã xác minh", gõ 6 số SMS vào "Mã xác minh", chạm "Xác nhận mã", rồi chạm "Hoàn tất đăng ký".', 'Đăng ký thành công; tab "Tài khoản" hiện "Shipper Test B", nhãn "Shipper".'),
    ('Vào "Ví tiền / Nạp tiền" từ Trang chủ hoặc mục "Ví" ở tab Tài khoản.', 'Ví hiện số dư 0đ (hoặc "0 đ"), chưa có giao dịch ("Chưa có giao dịch").'),
  ],
  restore='Như TC-ACC-001.',
  ref=ACCUI + '; mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart',
  auto='tests/integration/m03-shipper.int.spec.ts')

T('TC-ACC-006', ngay=1, seq=15, ten='Đăng ký bị chặn khi nhập thiếu hoặc sai thông tin (màn 1/3)',
  muc_dich='Ứng dụng phải nói rõ lỗi bằng tiếng Việt khi bạn bỏ trống, đặt mật khẩu quá ngắn, nhập lại sai hoặc quên tích đồng ý, và không đi tiếp.',
  prio='P1', actor='Khách', dev=('P1',), phones=1,
  pre='11Food ở trạng thái chưa đăng nhập. Mở "Tài khoản" > "Tạo tài khoản".',
  data='Lần 1: để trống tất cả. Lần 2: Họ tên "Khách Lỗi", mật khẩu "abc12" (5 ký tự), nhập lại "abc12". Lần 3: mật khẩu "matkhau123", nhập lại "matkhau124". Lần 4: nhập đúng nhưng KHÔNG tích đồng ý.',
  steps=[
    ('Không nhập gì, chạm "Tiếp tục".', 'Không sang bước 2; các ô báo lỗi (ví dụ họ tên, mật khẩu, "Nhập lại mật khẩu.") và dòng "Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật.".'),
    ('Nhập dữ liệu lần 2 (mật khẩu 5 ký tự), tích đồng ý, "Tiếp tục".', 'Không đi tiếp; ô mật khẩu báo lỗi mật khẩu phải từ 8 đến 128 ký tự (gợi ý "Dùng từ 8 đến 128 ký tự.").'),
    ('Nhập dữ liệu lần 3 (hai mật khẩu khác nhau).', 'Ô nhập lại báo "Mật khẩu chưa khớp." / "Mật khẩu nhập lại chưa khớp."; không đi tiếp.'),
    ('Nhập dữ liệu lần 4 (đủ, đúng, bỏ ô đồng ý).', 'Không đi tiếp; hiện lỗi cần đồng ý điều khoản.'),
    ('Tích đồng ý và chạm "Tiếp tục".', 'Đi tiếp sang "Đăng ký · 2/3".'),
  ],
  restore='Thoát màn đăng ký bằng nút quay lại; không có gì được tạo.',
  ref=ACCUI + ' (_detailsErrors, passwordError, textError)',
  auto='mobile/packages/n11_shared/test/flows_test.dart; form_feedback_test.dart')

T('TC-ACC-007', ngay=1, seq=16, ten='Số điện thoại sai định dạng khi đăng ký và đăng nhập',
  muc_dich='Số điện thoại Việt Nam có 10 số và bắt đầu bằng 0. Ứng dụng phải từ chối số sai ngay trên màn hình.',
  prio='P1', actor='Khách', dev=('P1',), phones=1,
  data='Thử lần lượt: "12345", "09123456", "abcdefghij", "0912 345 67x", "+84912345678" (số này hợp lệ theo mẫu nhưng ghi nhận kết quả thực tế), 25 chữ số.',
  pre='11Food chưa đăng nhập. Mở màn "Đăng nhập" (không cần tài khoản thật).',
  steps=[
    ('Ở màn "Đăng nhập", nhập vào ô "Số điện thoại" từng giá trị trong mục Dữ liệu nhập và nhập mật khẩu bất kỳ, chạm "Đăng nhập".', 'Với số rõ ràng sai ("12345", "09123456", "abcdefghij", có chữ): ô báo lỗi số điện thoại, KHÔNG gửi lên máy chủ. Ghi lại kết quả cho số "+84912345678".'),
    ('Nhập 25 chữ số liên tiếp.', 'Ô không nhận quá 20 ký tự (giới hạn của ô) hoặc báo lỗi; ứng dụng không bị treo.'),
    ('Lặp lại một vài giá trị ở màn đăng ký bước 3/3 (cần đi qua bước 1-2).', 'Báo lỗi tương tự, nút "Gửi mã xác minh" không gửi mã với số sai.'),
  ],
  restore=R_NONE,
  ref=ACCUI + ' (phoneError); mobile/packages/n11_shared/lib/src/account/models.dart',
  auto='mobile/packages/n11_shared/test/flows_test.dart')

T('TC-ACC-008', ngay=1, seq=17, ten='Đăng ký lại bằng số điện thoại đã có tài khoản',
  muc_dich='Một số điện thoại chỉ được một tài khoản. Ứng dụng phải báo rõ và hướng dẫn đăng nhập.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ACC-001',
  data='Số SĐT-KH-A (đã đăng ký), Họ và tên "Khách Trùng", mật khẩu tự đặt.',
  pre='Đã đăng xuất. KH-A đã tồn tại.',
  steps=[
    ('Mở "Tạo tài khoản", nhập "Khách Trùng", mật khẩu, tích đồng ý, chọn "Khách hàng", đến màn 3/3.', 'Hiện màn nhập số điện thoại.'),
    ('Nhập SĐT-KH-A, chạm "Gửi mã xác minh", nhập mã SMS (nếu nhận được), "Xác nhận mã", "Hoàn tất đăng ký".', 'Đăng ký không thành công; hiện thông báo "Số điện thoại này đã có tài khoản." hoặc "Số điện thoại này đã đăng ký. Hãy đăng nhập." Không tạo tài khoản thứ hai.'),
    ('Đăng nhập bằng KH-A và mật khẩu cũ.', 'Đăng nhập được, tên vẫn là "Khách Test A" (không bị đổi thành "Khách Trùng").'),
  ],
  restore=R_LOGOUT,
  ref=ACCUI + ' (phoneRegistered); apps/backend/src/client-auth',
  auto='tests/integration/client-auth-register.int.spec.ts; auth-register.int.spec.ts')

T('TC-ACC-009', ngay=1, seq=18, ten='Nhập sai mã OTP khi đăng ký',
  muc_dich='Mã OTP sai không được cho đăng ký. Kiểm tra thông báo và việc bị khóa sau nhiều lần sai.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Đã đến màn đăng ký 3/3, số điện thoại mới hợp lệ (số SĐT-KH-B chưa đăng ký nếu chưa chạy TC-ACC-002, hoặc một số dự phòng).',
  steps=[
    ('Chạm "Gửi mã xác minh", chờ SMS đến.', 'Ô "Mã xác minh" mở nhập được.'),
    ('Nhập mã sai "000000", chạm "Xác nhận mã".', 'Hiện lỗi "Mã xác minh chưa đúng, hoặc tin nhắn chưa được gửi đi. Kiểm tra lại mã trong tin nhắn." Nút "Hoàn tất đăng ký" vẫn chưa bấm được.'),
    ('Nhập sai thêm vài lần liên tiếp (tối đa 5 lần).', 'Sau một số lần sai, hiện "Mã xác minh này đã được dùng hoặc bị khóa. Hãy gửi mã mới." hoặc "Mã này không dùng được nữa. Hãy gửi mã mới."'),
    ('Chạm "Gửi lại mã" (khi hết thời gian chờ), nhập đúng mã mới.', 'Hiện "Đã xác minh số điện thoại"; đăng ký tiếp tục được.'),
  ],
  restore='Thoát màn đăng ký nếu không muốn tạo tài khoản.',
  ref=ACCUI + ' (_otpSection, failureMessage); apps/backend/src/auth (AUTH_OTP_MAX_ATTEMPTS)',
  auto='tests/integration/auth-otp.int.spec.ts; mobile/packages/n11_shared/test/otp_flows_test.dart')

T('TC-ACC-010', ngay=1, seq=19, ten='Mã OTP hết hạn và nút "Gửi lại mã"',
  muc_dich='Mã OTP chỉ dùng được trong thời gian ngắn. Kiểm tra mã hết hạn bị từ chối và gửi lại được sau thời gian chờ.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Đang ở màn đăng ký 3/3 sau khi đã chạm "Gửi mã xác minh". Hỏi Người phụ trách thời hạn hiệu lực OTP đang cấu hình (ghi vào ô ghi chú).',
  steps=[
    ('Ngay sau khi gửi, quan sát nút gửi lại.', 'Có dòng đếm ngược "Gửi lại sau … giây"; không bấm gửi lại được trong lúc đếm.'),
    ('Chờ đếm ngược về 0.', 'Nút "Gửi lại mã" bấm được.'),
    ('Chờ tiếp cho đến khi quá thời hạn hiệu lực OTP rồi nhập mã SMS cũ.', 'Hiện "Mã xác minh đã hết hạn. Hãy gửi mã mới." (hoặc "Mã đã hết hạn hoặc chưa gửi được. Hãy gửi lại mã.").'),
    ('Chạm "Gửi lại mã", nhập mã mới.', 'Xác nhận thành công.'),
  ],
  restore='Thoát màn đăng ký.',
  ref=ACCUI + ' (otp-resend-countdown); auth-otp (AUTH_OTP_TTL_SECONDS, AUTH_OTP_RESEND_SECONDS)',
  auto='tests/integration/auth-otp.int.spec.ts')

T('TC-ACC-011', ngay=1, seq=20, ten='Xin mã OTP quá nhiều lần bị giới hạn',
  muc_dich='Hệ thống chặn việc xin mã liên tục (chống lạm dụng, tốn tiền SMS). Ứng dụng phải báo rõ, không treo.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Mỗi lần xin mã tốn một tin nhắn SMS thật. Chỉ chạy khi Người phụ trách cho phép. Giới hạn mặc định theo tài liệu: 3 lần/giờ và 5 lần/ngày cho mỗi số, 30 lần/ngày toàn hệ thống.',
  pre='Người phụ trách đồng ý chạy test. Dùng một số điện thoại thử riêng (không dùng SĐT-KH-A).',
  steps=[
    ('Ở màn đăng ký 3/3 xin mã, chờ đếm ngược, bấm "Gửi lại mã"; lặp lại đến khi bị chặn (tối đa 4-5 lần).', 'Đến một lúc hiện thông báo "Thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại." hoặc tương tự; không có thêm tin nhắn nào được gửi.'),
    ('Chụp màn hình thông báo. Đợi đủ thời gian (theo giới hạn) rồi thử lại, hoặc hỏi Người phụ trách.', 'Sau khi hết giới hạn xin được mã mới.'),
  ],
  restore='Chờ hết giới hạn giờ/ngày. Không dùng lại số này cho test khác trong ngày.',
  ref='ops/runbooks/sms-gateway.md (SMS_GATEWAY_LIMIT_*); account_views.dart (Thử quá nhiều lần)',
  auto='tests/integration/sms-gateway.int.spec.ts')

T('TC-ACC-012', ngay=1, seq=21, ten='Không gửi được SMS: ứng dụng phải báo thật, không giả thành công',
  muc_dich='Khi máy gửi SMS (SMS Gateway) tắt hoặc mất mạng, ứng dụng phải nói thật là chưa gửi được mã, không cho nhập mã giả.',
  prio='P1', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Kỹ thuật viên tạm tắt máy SMS Gateway (hoặc tạm dừng gửi) theo hướng dẫn ops/runbooks/sms-gateway.md, và sẽ bật lại sau test. Không tự tắt.',
  steps=[
    ('Ở màn đăng ký 3/3 nhập số hợp lệ và chạm "Gửi mã xác minh".', 'Hiện thông báo lỗi trung thực, ví dụ "Không gửi được tin nhắn. Hãy gửi lại mã." hoặc "Máy chủ chưa gửi được mã SMS...". KHÔNG hiện "Đã xác minh". Ô nhập mã không cho xác nhận.'),
    ('Thử nhập một mã bất kỳ.', 'Không xác nhận được; nút "Hoàn tất đăng ký" vẫn khóa.'),
    ('Nhờ kỹ thuật viên bật lại SMS Gateway rồi chạm "Gửi lại mã".', 'Lần này gửi được, nhận SMS.'),
  ],
  restore='Kỹ thuật viên bật lại SMS Gateway; kiểm tra TC-ACC-001 chạy lại được.',
  ref='ops/runbooks/sms-gateway.md; docs/current/M01-production-profile-20261014.md (OTP chỉ qua SMS Gateway, hỏng thì báo thật)',
  auto='tests/integration/sms-gateway.int.spec.ts; admin-activation-sms-gateway.int.spec.ts')

T('TC-ACC-013', ngay=1, seq=22, ten='Sửa số điện thoại giữa chừng khi đang xác minh OTP',
  muc_dich='Gõ nhầm số điện thoại thì sửa được, mã OTP cũ không dùng được cho số mới.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Đang ở màn đăng ký 3/3, đã chạm "Gửi mã xác minh" cho số A và đã nhận SMS.',
  steps=[
    ('Chạm "Đổi số điện thoại".', 'Ô số điện thoại mở nhập lại được, ô mã OTP bị xóa/khóa.'),
    ('Nhập số khác (số B) và chạm "Gửi mã xác minh". Nhập mã SMS của SỐ A vào ô mã.', 'Không xác nhận được (mã của số A không dùng cho số B).'),
    ('Nhập đúng mã SMS gửi cho số B.', 'Xác nhận thành công.'),
  ],
  restore='Thoát màn đăng ký nếu không muốn tạo tài khoản.',
  ref=ACCUI + ' (otp-change-phone)',
  auto='mobile/packages/n11_shared/test/otp_flows_test.dart')

T('TC-ACC-014', ngay=1, seq=23, ten='Đăng nhập thành công bằng KH-A',
  muc_dich='Khách đã đăng ký đăng nhập lại được bằng số điện thoại và mật khẩu.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-ACC-001',
  pre='KH-A đã đăng ký. Đang đăng xuất trên Điện thoại 1.',
  steps=food_login('P1', 'KH-A') + [
    ('Chạm tab "Trang chủ" rồi quay lại tab "Tài khoản".', 'Vẫn đăng nhập; tên và số điện thoại giữ nguyên.'),
  ],
  restore=R_LOGOUT,
  ref=ACCUI + ' (LoginScreen); session_controller.dart',
  auto='tests/integration/client-auth-session.int.spec.ts; mobile/packages/n11_shared/test/session_controller_test.dart')

T('TC-ACC-015', ngay=1, seq=24, ten='Đăng nhập sai mật khẩu và sai số điện thoại',
  muc_dich='Đăng nhập sai phải bị từ chối với thông báo chung, không tiết lộ số nào đã có tài khoản.',
  prio='P0', actor='Khách', dev=('P1',), phones=1, deps='TC-ACC-001',
  data='Lần 1: số SĐT-KH-A, mật khẩu sai "SaiMatKhau123". Lần 2: số chưa đăng ký (số bất kỳ hợp lệ khác), mật khẩu bất kỳ. Lần 3: bỏ trống mật khẩu.',
  pre='Đã đăng xuất. Mở màn "Đăng nhập" của 11Food.',
  steps=[
    ('Nhập dữ liệu lần 1, chạm "Đăng nhập".', 'Hiện lỗi "Số điện thoại hoặc mật khẩu không đúng. Vui lòng thử lại."; không vào được ứng dụng.'),
    ('Nhập dữ liệu lần 2, chạm "Đăng nhập".', 'Hiện CÙNG thông báo như lần 1 (không phân biệt "số chưa đăng ký" với "sai mật khẩu").'),
    ('Nhập số hợp lệ nhưng bỏ trống mật khẩu.', 'Ô mật khẩu báo bắt buộc nhập; không gửi đi.'),
    ('Nhập sai mật khẩu liên tiếp nhiều lần (khoảng 6-10 lần).', 'Có thể hiện "Thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại."; ứng dụng không treo. Ghi lại số lần sai trước khi bị chặn.'),
    ('Đợi một lát (hoặc hỏi Người phụ trách), nhập đúng mật khẩu.', 'Đăng nhập được (nếu còn bị chặn, ghi nhận thời gian chặn).'),
  ],
  restore=R_LOGOUT,
  ref=ACCUI + ' (invalidCredentials); apps/backend/src/client-auth',
  auto='tests/integration/client-auth-session.int.spec.ts; admin-auth-limits.int.spec.ts')

T('TC-ACC-016', ngay=1, seq=25, ten='Đăng nhập shipper SP-A trên 11Ship',
  muc_dich='Shipper đăng nhập lại được; ứng dụng 11Ship chỉ cho tài khoản shipper dùng chức năng giao hàng.',
  prio='P0', actor='Shipper (SP-A)', dev=('P3',), phones=1, deps='TC-ACC-004',
  pre='Đã đăng xuất 11Ship.',
  steps=ship_login('P3', 'SP-A') + [
    ('Chạm tab "Trang chủ".', 'Thấy trạng thái "Bạn đang offline" và nút "Bật online"; có "Ví tiền / Nạp tiền".'),
  ],
  restore=R_LOGOUT,
  ref='mobile/ship/lib/ship_home.dart; account_views.dart',
  auto='tests/integration/native-device-binding.int.spec.ts; ship-driver-profile-browser.int.spec.ts')

T('TC-ACC-017', ngay=1, seq=26, ten='Đăng xuất có hộp xác nhận',
  muc_dich='Đăng xuất phải hỏi lại để tránh bấm nhầm, và sau khi đăng xuất không còn xem được dữ liệu cá nhân.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-ACC-014',
  pre='Đang đăng nhập KH-A trên 11Food, giỏ hàng có thể có món.',
  steps=[
    ('Mở tab "Tài khoản", kéo xuống cuối, chạm "Đăng xuất".', 'Hộp thoại "Đăng xuất?" với nội dung "Bạn sẽ cần đăng nhập lại để dùng tài khoản. Phiên trên máy chủ sẽ được thu hồi khi có kết nối." và nút "Huỷ", "Đăng xuất".'),
    ('Chạm "Huỷ".', 'Hộp thoại đóng, vẫn đăng nhập.'),
    ('Chạm "Đăng xuất" lần nữa rồi chạm "Đăng xuất" trong hộp thoại.', 'Quay về màn hình chưa đăng nhập, có "Tạo tài khoản" và "Đăng nhập".'),
    ('Chạm tab "Đơn hàng".', 'Không hiện đơn hàng của KH-A; có lời mời "Đăng nhập để xem đơn hàng của bạn."'),
    ('Nhấn nút Back của Android nhiều lần.', 'Không quay lại được màn hình có dữ liệu của KH-A.'),
  ],
  restore='Đăng nhập lại nếu cần cho test sau.',
  ref=ACCUI + ' (confirmLogout)',
  auto='mobile/packages/n11_shared/test/session_controller_test.dart; tests/integration/client-auth-session.int.spec.ts')

T('TC-ACC-018', ngay=1, seq=27, ten='Tắt hẳn rồi mở lại ứng dụng: vẫn đăng nhập',
  muc_dich='Người dùng không phải đăng nhập lại mỗi lần mở app (phiên còn hạn).',
  prio='P0', actor='Khách / Shipper', dev=('P1', 'P3'), phones=1, deps='TC-ACC-014',
  pre='Đang đăng nhập KH-A trên 11Food.',
  steps=[
    ('Trong danh sách ứng dụng gần đây (Recent apps), vuốt tắt hẳn 11Food.', '11Food biến mất khỏi danh sách.'),
    ('Mở lại 11Food, chạm tab "Tài khoản".', 'Hiện "Đang kiểm tra phiên đăng nhập…" ít giây rồi vẫn đăng nhập KH-A (không bị đẩy ra màn đăng nhập).'),
    ('Lặp lại với 11Ship và SP-A (nếu đang đăng nhập).', 'Vẫn đăng nhập SP-A.'),
  ],
  restore=R_LOGOUT,
  ref='mobile/packages/n11_shared/lib/src/account/session_controller.dart (khôi phục phiên khi khởi động)',
  auto='mobile/packages/n11_shared/test/session_controller_test.dart; tests/integration/client-runtime.int.spec.ts')

T('TC-ACC-019', ngay=1, seq=28, ten='Khởi động lại điện thoại: vẫn đăng nhập',
  muc_dich='Sau khi điện thoại tắt nguồn và bật lại, tài khoản vẫn dùng được trong thời hạn phiên.',
  prio='P1', actor='Khách / Shipper', dev=('P1',), phones=1, deps='TC-ACC-014',
  pre='Đang đăng nhập KH-A (và SP-A nếu có 11Ship).',
  steps=[
    ('Tắt nguồn điện thoại, đợi 10 giây, bật lại và mở khóa.', 'Điện thoại khởi động bình thường.'),
    ('Mở 11Food, vào tab "Tài khoản".', 'Vẫn đăng nhập KH-A (hoặc nếu phiên đã hết hạn thì có thông báo "Phiên đăng nhập đã kết thúc" rõ ràng; ghi lại thời gian đã trôi qua).'),
    ('Mở 11Ship (nếu đã đăng nhập SP-A).', 'Vẫn đăng nhập; shipper nếu đang bật online thì ứng dụng tự khôi phục chia sẻ vị trí khi mở lại hoặc báo hướng dẫn cần mở.'),
  ],
  restore=R_LOGOUT,
  ref='docs/current/M14-online-location-20261024.md (khởi động lại: dịch vụ vị trí chỉ dựng lại khi còn ý định online)',
  auto='mobile/ship/test/ship_online_test.dart')

T('TC-ACC-020', ngay=1, seq=29, ten='Quên mật khẩu: đặt lại bằng mã OTP qua SMS',
  muc_dich='Người dùng quên mật khẩu tự đặt lại được bằng mã SMS, và đăng nhập được bằng mật khẩu mới (mật khẩu cũ hết tác dụng).',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ACC-001',
  data='Số SĐT-KH-A. Mật khẩu mới: tự đặt 8-128 ký tự, khác mật khẩu cũ; nhập lại giống hệt.',
  pre='Đã đăng xuất. Hệ thống SMS đang bật.',
  steps=[
    ('Mở "Tài khoản" > "Đăng nhập" > chạm "Quên mật khẩu?".', 'Màn "Quên mật khẩu" với dòng "Nhập số điện thoại đã đăng ký, mã xác minh nhận qua SMS, rồi đặt mật khẩu mới."'),
    ('Nhập SĐT-KH-A, chạm "Gửi mã xác minh".', 'Hiện "Nếu số điện thoại đã đăng ký, bạn sẽ nhận tin nhắn SMS chứa mã xác minh trong ít phút. Nhập mã vào ô bên dưới."'),
    ('Nhập mã SMS vào "Mã xác minh", chạm "Xác nhận mã".', 'Hiện "Đã xác minh mã"; xuất hiện ô "Mật khẩu mới" và "Nhập lại mật khẩu mới".'),
    ('Nhập mật khẩu mới, nhập lại, chạm "Đặt lại mật khẩu".', 'Hiện "Đã xử lý yêu cầu"/"Yêu cầu đã xử lý" kèm câu "Nếu số điện thoại hợp lệ, hãy đăng nhập bằng mật khẩu mới. Ứng dụng không tự đăng nhập cho bạn."'),
    ('Chạm "Đăng nhập", thử đăng nhập bằng MẬT KHẨU CŨ.', 'Bị từ chối "Số điện thoại hoặc mật khẩu không đúng."'),
    ('Đăng nhập bằng mật khẩu MỚI.', 'Đăng nhập thành công. Ghi mật khẩu mới vào bảng riêng (không ghi vào tài liệu này).'),
  ],
  restore='Dùng mật khẩu mới cho các test sau; cập nhật bảng thông tin riêng.',
  ref='mobile/packages/n11_shared/lib/src/flows/reset_views.dart, reset_controller.dart; docs/tasks/M01-B-RESET-password-recovery-design.md; ops/runbooks/sms-gateway.md (Password reset by SMS)',
  auto='tests/integration/account-recovery-*.int.spec.ts; client-password.int.spec.ts')

T('TC-ACC-021', ngay=1, seq=30, ten='Quên mật khẩu: mã sai, hết hạn và số chưa đăng ký',
  muc_dich='Kiểm tra các nhánh lỗi: mã sai bị từ chối; số chưa đăng ký nhận cùng thông báo chung (không lộ số nào có tài khoản).',
  prio='P1', actor='Khách', dev=('P1',), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  data='Số chưa đăng ký (số bất kỳ, chú ý chỉ số được phép nhận SMS mới nhận được mã); mã sai "111111".',
  pre='Đã đăng xuất, mở màn "Quên mật khẩu".',
  steps=[
    ('Nhập một số chưa từng đăng ký, chạm "Gửi mã xác minh".', 'Vẫn hiện đúng câu chung "Nếu số điện thoại đã đăng ký, bạn sẽ nhận tin nhắn SMS…" (không nói số không tồn tại).'),
    ('Nhập mã bất kỳ "111111", chạm "Xác nhận mã".', 'Không qua được; hiện lỗi mã không đúng/không dùng được.'),
    ('Đổi sang SĐT-KH-A, gửi mã, nhập mã sai, rồi nhập đúng mã sau khi chờ.', 'Mã sai bị từ chối; mã đúng được chấp nhận (nếu chưa bị khóa quá số lần).'),
  ],
  restore=R_NONE,
  ref='reset_views.dart; apps/backend/src/account-recovery',
  auto='tests/integration/account-recovery-reset-test.int.spec.ts; mobile/packages/n11_shared/test/lifecycle_flows_test.dart')

T('TC-ACC-022', ngay=1, seq=31, ten='Sau khi đặt lại mật khẩu, các phiên đăng nhập cũ bị đăng xuất',
  muc_dich='Nếu ai đó đang dùng tài khoản của bạn trên máy khác thì đặt lại mật khẩu phải đuổi họ ra.',
  prio='P1', actor='Khách (KH-A)', dev=('P1', 'P2'), phones=2, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT', deps='TC-ACC-020',
  pre='KH-A đang đăng nhập trên Điện thoại 2 (11Food). Điện thoại 1 sẽ đặt lại mật khẩu.',
  steps=[
    ('Trên Điện thoại 2 đăng nhập KH-A và để ở tab "Tài khoản".', 'Đang đăng nhập.'),
    ('Trên Điện thoại 1: tab "Tài khoản" > "Đăng nhập" > "Quên mật khẩu?"; nhập SĐT-KH-A, chạm "Gửi mã xác minh"; gõ mã SMS vào "Mã xác minh", chạm "Xác nhận mã"; nhập mật khẩu mới hai lần rồi chạm "Đặt lại mật khẩu".', 'Đặt lại thành công.'),
    ('Trên Điện thoại 2 chạm vào tab "Đơn hàng" rồi "Tài khoản".', 'Bị đăng xuất: hiện "Phiên đăng nhập đã kết thúc" cùng dòng "Tài khoản có thể đã đăng nhập trên thiết bị khác hoặc phiên đã hết hạn. Vì an toàn, vui lòng đăng nhập lại." và nút "Đăng nhập lại".'),
  ],
  restore='Dùng mật khẩu mới ở các test sau.',
  ref='ops/runbooks/sms-gateway.md ("revokes every app / admin session"); account_views.dart (session-ended)',
  auto='tests/integration/account-recovery-reset-test.int.spec.ts')

T('TC-ACC-023', ngay=1, seq=32, ten='Đổi mật khẩu khi đang đăng nhập',
  muc_dich='Đổi mật khẩu đúng cách; mật khẩu cũ sai bị từ chối; các máy khác bị đăng xuất.',
  prio='P0', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-ACC-014',
  data='Mật khẩu hiện tại: mật khẩu đang dùng. Mật khẩu mới: tự đặt, khác mật khẩu cũ. Lần thử sai: mật khẩu hiện tại "SaiHetRoi1".',
  pre='Đang đăng nhập KH-A.',
  steps=[
    ('Tab "Tài khoản" > chạm "Đổi mật khẩu".', 'Màn "Đổi mật khẩu" với các ô "Mật khẩu hiện tại", "Mật khẩu mới", "Nhập lại mật khẩu mới" và gợi ý "Dùng từ 8 đến 128 ký tự. Sau khi đổi, các phiên khác sẽ được đăng xuất."'),
    ('Nhập mật khẩu hiện tại SAI, mật khẩu mới hợp lệ, nhập lại đúng; chạm "Đổi mật khẩu".', 'Hiện lỗi "Chưa đổi được mật khẩu" + "Mật khẩu hiện tại không đúng."'),
    ('Sửa mật khẩu hiện tại thành đúng, chạm "Đổi mật khẩu".', 'Hiện thông báo thành công "Đã đổi mật khẩu — Bạn có thể dùng mật khẩu mới để đăng nhập."'),
    ('Đăng xuất rồi đăng nhập bằng mật khẩu CŨ.', 'Bị từ chối với thông báo "Số điện thoại hoặc mật khẩu không đúng."'),
    ('Đăng nhập bằng mật khẩu MỚI.', 'Đăng nhập thành công; tab "Tài khoản" hiện tên tài khoản.'),
  ],
  restore='Có thể đổi lại về mật khẩu cũ bằng chính chức năng này (nhớ cập nhật bảng thông tin riêng).',
  ref=ACCUI + ' (ChangePasswordScreen); tests: client-password.int.spec.ts',
  auto='tests/integration/client-password.int.spec.ts; mobile/packages/n11_shared/test/session_controller_test.dart')

T('TC-ACC-024', ngay=1, seq=33, ten='Đổi mật khẩu: mật khẩu mới không hợp lệ hoặc nhập lại không khớp',
  muc_dich='Mật khẩu mới phải từ 8 đến 128 ký tự và nhập lại phải khớp.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, deps='TC-ACC-014',
  data='Mật khẩu mới "abc12" (quá ngắn); sau đó mật khẩu mới "matkhaumoi1" nhưng nhập lại "matkhaumoi2".',
  pre='Đang đăng nhập KH-A, mở màn "Đổi mật khẩu".',
  steps=[
    ('Nhập mật khẩu hiện tại đúng, mật khẩu mới "abc12", nhập lại "abc12".', 'Ô mật khẩu mới báo lỗi độ dài; nút đổi không gửi.'),
    ('Nhập mật khẩu mới "matkhaumoi1", nhập lại "matkhaumoi2".', 'Hiện "Mật khẩu chưa khớp."; không đổi.'),
  ],
  restore='Thoát màn hình, không có gì thay đổi.',
  ref=ACCUI + ' (passwordError, confirmPasswordError)',
  auto='mobile/packages/n11_shared/test/flows_test.dart')

T('TC-ACC-025', ngay=1, seq=34, ten='Đăng nhập cùng một tài khoản trên điện thoại thứ hai: máy cũ bị đăng xuất',
  muc_dich='Mỗi tài khoản chỉ có MỘT phiên đăng nhập đang dùng tại một thời điểm (kể cả khi chuyển qua lại giữa 11Food và 11Ship trên cùng máy). Đăng nhập máy mới phải làm máy cũ hết phiên, tránh hai người cùng thao tác.',
  prio='P0', actor='Khách (KH-A)', dev=('P1', 'P2'), phones=2, deps='TC-ACC-014',
  pre='Điện thoại 1 đang đăng nhập KH-A. Điện thoại 2 đã cài 11Food, chưa đăng nhập.',
  steps=[
    ('Trên Điện thoại 1 mở 11Food, tab "Tài khoản" - đang đăng nhập KH-A.', 'Thấy "Khách Test A".'),
    ('Trên Điện thoại 2 đăng nhập KH-A.', 'Đăng nhập thành công trên Điện thoại 2.'),
    ('Trên Điện thoại 1 chạm tab "Đơn hàng", rồi tab "Tài khoản".', 'Điện thoại 1 bị đăng xuất: hiện "Phiên đăng nhập đã kết thúc - Tài khoản có thể đã đăng nhập trên thiết bị khác…" và nút "Đăng nhập lại".'),
    ('Trên Điện thoại 2 chạm tab "Tài khoản".', 'Điện thoại 2 vẫn đăng nhập bình thường.'),
  ],
  restore='Đăng xuất Điện thoại 2 (và Điện thoại 1 nếu cần).',
  ref='docs/current/M01-password-sessions-20261023.md (đăng nhập mới thu hồi mọi phiên cũ của tài khoản); account_views.dart (session-ended)',
  auto='tests/integration/native-device-binding.int.spec.ts; client-auth-session.int.spec.ts')

T('TC-ACC-026', ngay=4, seq=60, ten='Đăng nhập lại khi đang có đơn đang giao: đơn không mất',
  muc_dich='Đăng xuất/đăng nhập (hoặc bị đăng xuất) giữa lúc có đơn đang chạy không được làm mất đơn hay đổi trạng thái đơn.',
  prio='P0', actor='Khách + Quán + Shipper', dev=('P1', 'P2', 'P3'), phones=3, deps='TC-FLOW-001',
  pre='Có một đơn đang ở trạng thái "Đang giao" (shipper đã bấm "Đã nhận hàng"), chuẩn bị theo TC-FLOW-001 đến bước shipper đã lấy hàng.',
  steps=[
    ('Trên máy Khách đăng xuất rồi đăng nhập lại KH-A, mở tab "Đơn hàng".', 'Đơn vẫn nằm ở "Đang xử lý", trạng thái "Đang giao", đúng mã đơn.'),
    ('Trên máy Quán đăng xuất rồi đăng nhập lại CQ-A, mở tab "Đơn hàng".', 'Đơn vẫn có ở danh sách "Đang giao" với đúng mã.'),
    ('Trên máy Shipper đăng xuất rồi đăng nhập lại SP-A, mở tab "Đơn hàng" > "Đang thực hiện".', 'Đơn vẫn còn, vẫn có nút "Giao thành công". Trạng thái chia sẻ vị trí được khôi phục (hoặc có hướng dẫn rõ để bật).'),
    ('Shipper bấm "Giao thành công" và xác nhận.', 'Đơn kết thúc đúng một lần; khách và quán thấy "Hoàn thành".'),
  ],
  restore=R_ORDER,
  ref='mobile/ship/lib/ship_online.dart; docs/current/M14-online-location-20261024.md (còn đơn thì vẫn chia sẻ vị trí); apps/backend/src/delivery',
  auto='tests/integration/m07-delivery.int.spec.ts; mobile/ship/test/ship_online_test.dart')

T('TC-ACC-027', ngay=4, seq=61, ten='Phiên bị thu hồi khi Admin khóa tài khoản đang đăng nhập',
  muc_dich='Khi quản trị khóa tài khoản, người đó phải bị đăng xuất và không đăng nhập lại được cho đến khi mở khóa.',
  prio='P0', actor='Khách + ADMIN', dev=('P1', 'PC'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  pre='Một tài khoản khách phụ (ví dụ KH-B) đang đăng nhập trên Điện thoại 1 và KHÔNG có đơn đang xử lý. ADMIN/SYSTEM có quyền "Khóa tài khoản" đăng nhập Web Admin trên máy tính.',
  data='Lý do khóa: chọn loại "Vi phạm" hoặc "Bảo mật" như giao diện cho phép, ghi chú "TEST khóa tài khoản".',
  steps=[
    ('Trên máy tính, vào Web Admin > TÀI KHOẢN > Người dùng > Danh sách, tìm số điện thoại của KH-B và mở chi tiết.', 'Thấy chi tiết người dùng KH-B, trạng thái đang hoạt động.'),
    ('Bấm "Khóa", chọn loại khóa, nhập lý do, xác nhận ("Khóa tài khoản?" > "Khóa").', 'Trạng thái đổi thành đã khóa; có dòng mới trong "Lịch sử tài khoản".'),
    ('Trên Điện thoại 1, bấm vào tab "Đơn hàng" và "Tài khoản".', 'KH-B bị đăng xuất ("Phiên đăng nhập đã kết thúc").'),
    ('Thử đăng nhập lại KH-B.', 'Bị từ chối bằng thông báo tài khoản đã khóa (ví dụ "Tài khoản này đang bị khóa…").'),
    ('Admin bấm "Mở khóa" > xác nhận ("Mở khóa tài khoản?").', 'Trạng thái về hoạt động.'),
    ('Đăng nhập lại KH-B trên Điện thoại 1.', 'Đăng nhập thành công.'),
  ],
  restore='Đảm bảo tài khoản đã được MỞ KHÓA trước khi kết thúc test.',
  ref='apps/admin-web/src/dom/accounts-view.ts; apps/backend/src/admin-account-lock; docs/current/M01-final-package-20261014.md (khóa/mở khóa)',
  auto='tests/integration/admin-account-lock.int.spec.ts; account-lifecycle.int.spec.ts')

T('TC-ACC-028', ngay=1, seq=35, ten='Xem và sửa họ tên của tài khoản',
  muc_dich='Người dùng xem và sửa được họ tên hiển thị; số điện thoại chỉ xem (được che bớt).',
  prio='P1', actor='Khách (KH-A)', dev=('P1',), phones=1, deps='TC-ACC-014',
  data='Họ tên mới: "Khách Test A Sửa". Sau đó đổi lại "Khách Test A".',
  pre='Đang đăng nhập KH-A.',
  steps=[
    ('Tab "Tài khoản" > chạm vào thẻ thông tin cá nhân (mục "Thông tin cá nhân" / "Xem và sửa họ tên").', 'Màn hồ sơ có ô "Họ và tên" và dòng "Số điện thoại: …" (che bớt).'),
    ('Đổi họ tên thành "Khách Test A Sửa", chạm lưu.', 'Hiện "Đã lưu họ tên." Quay lại tab Tài khoản thấy tên mới.'),
    ('Xóa trống họ tên rồi lưu.', 'Báo lỗi bắt buộc nhập; không lưu tên trống.'),
    ('Đổi lại thành "Khách Test A" và lưu.', 'Lưu thành công.'),
  ],
  restore='Đã đổi lại tên cũ ở bước 4.',
  ref=ACCUI + ' (ProfileScreen)',
  auto='tests/integration/client-profile.int.spec.ts')

T('TC-ACC-029', ngay=1, seq=36, ten='Xem Điều khoản sử dụng và Chính sách quyền riêng tư',
  muc_dich='Người dùng đọc được điều khoản và chính sách trong ứng dụng.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, ready='CẦN XÁC MINH',
  note='Chưa xác định chắc chắn mục vào "Chính sách và điều khoản" trong tab Tài khoản (có màn PolicyScreen trong mã). Tài liệu điều khoản còn ghi "chờ Owner duyệt nội dung" (docs/current/M01-terms-privacy-20261014.md).',
  pre='11Food mở.',
  steps=[
    ('Mở "Tài khoản" > "Tạo tài khoản" và đọc khung điều khoản ở màn 1/3 (kéo trong khung).', 'Hiện đầy đủ hai phần "Điều khoản sử dụng" và "Chính sách quyền riêng tư" bằng tiếng Việt.'),
    ('Nếu trong tab "Tài khoản" có mục "Chính sách và điều khoản", chạm vào.', 'Mở màn hình có cùng nội dung. Nếu không có mục này thì ghi "không có mục" vào ghi chú (không phải lỗi nếu đọc được ở bước 1).'),
    ('Đối chiếu nội dung điều khoản với bản đã được Owner duyệt (Người phụ trách cung cấp).', 'Nội dung khớp bản đã duyệt.'),
    ('Đọc kỹ câu mô tả chức năng trong "Điều khoản sử dụng" và so với những gì ứng dụng đang làm được (đặt món, giao hàng, ví).', 'Ghi lại nguyên văn. Hiện trong mã nguồn, Điều khoản ghi "đặt món, giao hàng, ví và doanh thu chưa hoạt động" và "quyền chỉ có sau khi hồ sơ được duyệt", trong khi các chức năng này đã hoạt động: nếu câu này còn hiện, báo mức CAO (nội dung pháp lý sai so với thực tế) để Owner quyết định sửa và đổi phiên bản điều khoản.'),
  ],
  restore=R_NONE,
  ref=ACCUI + ' (PolicyScreen, kTermsText); docs/current/M01-terms-privacy-20261014.md',
  auto='mobile/packages/n11_shared/test/flows_test.dart')

T('TC-ACC-030', ngay=1, seq=37, ten='Duyệt xem ứng dụng khi chưa đăng nhập (khách vãng lai)',
  muc_dich='Người chưa có tài khoản xem được quán và thực đơn, nhưng phải đăng nhập mới được đặt món.',
  prio='P1', actor='Khách (chưa đăng nhập)', dev=('P1',), phones=1, deps='TC-SHOP-009, TC-SHOP-012',
  pre='Đã đăng xuất. Có ít nhất một quán đang mở (Quán Test A) với món.',
  steps=[
    ('Mở 11Food (chưa đăng nhập), tab "Trang chủ".', 'Thấy danh sách "Quán gần bạn" (nếu đã cấp quyền vị trí).'),
    ('Chạm vào "Quán Test A", xem thực đơn.', 'Xem được tên quán, giờ hoạt động và món.'),
    ('Chạm nút thêm một món vào giỏ.', 'Hiện lời nhắc "Đăng nhập tài khoản khách để đặt món." (không thêm được/ không đặt được khi chưa đăng nhập).'),
    ('Tab "Đơn hàng".', 'Hiện "Đăng nhập để xem đơn hàng của bạn." và "Chưa có đơn hàng".'),
  ],
  restore=R_NONE,
  ref='mobile/packages/n11_shared/lib/src/m02/preview_views.dart ("Đăng nhập tài khoản khách để đặt món."); mobile/food/lib/food_tabs.dart (_orders)',
  auto='mobile/packages/n11_shared/test/m02_view_customer_test.dart')

T('TC-ACC-031', ngay=4, seq=62, ten='Khôi phục tài khoản đã bị khóa theo yêu cầu xóa',
  muc_dich='Tài khoản bị "Xóa tài khoản" nhưng còn dữ liệu sẽ được khóa; chủ tài khoản đăng ký lại bằng số cũ thì khôi phục bằng OTP, không mất dữ liệu.',
  prio='P2', actor='Khách + SYSTEM', dev=('P1', 'PC'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Dùng một tài khoản phụ có dữ liệu liên quan (ví dụ đã có từng đặt đơn), KHÔNG dùng tài khoản chính. Cần quyền SYSTEM.',
  pre='Tài khoản phụ KH-X đã có dữ liệu (từng đặt đơn đã hoàn thành). SYSTEM đăng nhập Web Admin.',
  steps=[
    ('Web Admin > Người dùng > mở KH-X > "Xóa tài khoản" > xác nhận.', 'Hộp thoại nói rõ tài khoản có dữ liệu thì không xóa mà chuyển sang khóa theo yêu cầu xóa; sau xác nhận trạng thái hiện đã khóa.'),
    ('Trên điện thoại, đăng nhập bằng KH-X.', 'Bị chặn với thông báo tài khoản đã khóa theo yêu cầu xóa.'),
    ('Chọn "Tạo tài khoản" bằng đúng số KH-X.', 'Hiện cảnh báo "Tài khoản này đã khóa theo yêu cầu xóa" cùng nút "Khôi phục tài khoản".'),
    ('Chạm "Khôi phục tài khoản", xác minh bằng mã SMS và đặt mật khẩu mới.', 'Hiện "Đã khôi phục tài khoản" / "Tài khoản đã được mở khóa với mật khẩu mới…".'),
    ('Đăng nhập bằng mật khẩu mới và mở "Đơn hàng".', 'Lịch sử đơn cũ của KH-X vẫn còn.'),
  ],
  restore='Không cần (tài khoản phụ).',
  ref='account_views.dart (recover-account); docs/current/M01-final-package-20261014.md mục 8; reset_views.dart (Khôi phục tài khoản)',
  auto='tests/integration/account-lifecycle.int.spec.ts; account-recovery-reset-test.int.spec.ts')

T('TC-ACC-032', ngay=5, seq=62, ten='SYSTEM tắt/bật bắt buộc OTP khi đăng ký (công tắc hệ thống)',
  muc_dich='Công tắc này quyết định đăng ký có bắt buộc mã OTP hay không. Phải thử cả hai trạng thái và luôn trả về Bật.',
  prio='P2', actor='SYSTEM + Khách', dev=('PC', 'P1'), phones=1, loai='Cần hỗ trợ kỹ thuật', ready='CẦN HỖ TRỢ KỸ THUẬT',
  note='Thay đổi cấu hình thật của hệ thống. Chỉ làm khi Owner cho phép bằng văn bản; bắt buộc bật lại ngay sau test.',
  pre='Owner đồng ý. SYSTEM đăng nhập Web Admin.',
  steps=[
    ('Web Admin > HỆ THỐNG > "Cài đặt hệ thống". Quan sát nhóm "Xác thực số điện thoại".', 'Có hai công tắc "OTP khi đăng ký" và "OTP khi quên mật khẩu" (mặc định Bật) cùng "Lịch sử thay đổi".'),
    ('Tắt "OTP khi đăng ký", lưu.', 'Hiện "Đã lưu. Thay đổi có hiệu lực ngay, không cần khởi động lại máy chủ."'),
    ('Trên điện thoại mở màn đăng ký bước 3/3.', 'Hiện thông báo "Đăng ký không cần mã xác minh - Số điện thoại sẽ ở trạng thái chưa xác minh…". Không có ô OTP.'),
    ('Bật lại "OTP khi đăng ký", lưu.', 'Đã lưu; đăng ký lại cần OTP như cũ.'),
    ('Kiểm tra "Lịch sử thay đổi".', 'Có hai dòng thay đổi (tắt rồi bật), ghi người thực hiện và thời gian.'),
  ],
  verdict=DEFAULT_VERDICT + ' Nếu sau test công tắc không về Bật thì ghi lỗi nghiêm trọng và bật lại ngay.',
  restore='Công tắc "OTP khi đăng ký" và "OTP khi quên mật khẩu" phải ở trạng thái Bật.',
  ref='apps/admin-web/src/dom/settings-view.ts; docs/current/M01-final-package-20261014.md (mục 1, 4)',
  auto='tests/integration/auth-config-process.int.spec.ts; admin-activation-phone-mode.int.spec.ts', sev='Cao')

T('TC-ACC-033', ngay=1, seq=38, ten='Mục Voucher trong 11Food báo rõ chưa hỗ trợ',
  muc_dich='Chức năng voucher chưa làm. Màn hình phải nói thật là chưa hỗ trợ, không giả vờ có mã giảm giá.',
  prio='P2', actor='Khách', dev=('P1',), phones=1, ready='NOT READY', deps='TC-ACC-014',
  note='Chức năng chưa có theo mã nguồn: màn Voucher chỉ hiện "Tính năng voucher chưa được hỗ trợ.". Test này kiểm chứng việc báo trung thực.',
  pre='Đang đăng nhập KH-A.',
  steps=[
    ('Tab "Tài khoản" > mục "Ưu đãi" > "Voucher của tôi".', 'Màn hình voucher mở ra, có dòng "Tính năng voucher chưa được hỗ trợ. Chưa thể nhập hoặc áp mã." Các thẻ "Chưa có voucher", "Chưa có voucher đã dùng", "Chưa có voucher hết hạn".'),
    ('Thử nhập mã vào bất cứ ô nào (nếu có).', 'Không có chỗ nhập mã giảm giá có tác dụng.'),
  ],
  restore=R_NONE,
  ref=ACCUI + ' (VoucherScreen)',
  auto='mobile/packages/n11_shared/test/flows_test.dart')
