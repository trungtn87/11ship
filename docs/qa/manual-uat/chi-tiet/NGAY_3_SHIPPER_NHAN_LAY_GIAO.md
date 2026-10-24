# Ngày 3 - Shipper nhận, lấy và giao hàng (kèm nạp ví thử nghiệm)

Tài liệu này là bản ĐỌC ĐƯỢC của các test case trong file `TESTCASE_11SHIP.csv` (cùng nội dung). Làm lần lượt từ trên xuống dưới vì các test sau dùng dữ liệu của test trước.
Trước khi bắt đầu: đọc `HUONG_DAN_KIEM_THU_11SHIP.md` (nhất là mục chuẩn bị tài khoản, tiền thử nghiệm và cách báo lỗi).

Tổng số test case trong ngày: **47** (P0: 29, P1: 15, P2: 3).

| # | Mã | Tên | Mức | Cần | Sẵn sàng |
|---|---|---|---|---|---|
| 1 | TC-WAL-020 | SYSTEM quản lý "Tài khoản nhận tiền" của hệ thống; ADMIN không có quyền | P1 | PC | CẦN KỸ THUẬT VIÊN LÀM CÙNG |
| 2 | TC-WAL-001 | Ví shipper mới: số dư 0đ, chưa có giao dịch | P0 | 1 ĐT | SẴN SÀNG |
| 3 | TC-WAL-002 | Nạp tiền: số tiền dưới mức tối thiểu bị từ chối | P0 | 1 ĐT | SẴN SÀNG |
| 4 | TC-WAL-003 | Tạo yêu cầu nạp tiền: thông tin chuyển khoản và trạng thái "Chờ xử lý" (tiền chưa vào ví) | P0 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 5 | TC-WAL-004 | Admin thấy yêu cầu nạp tiền và đối chiếu thông tin | P0 | PC | CẦN CHUẨN BỊ TRƯỚC |
| 6 | TC-WAL-005 | Admin ghi nhận tiền: ví shipper được cộng đúng một lần (nạp cho SP-A bằng tiền thử nghiệm) | P0 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 7 | TC-DRV-003 | Shipper không đủ tiền trong ví (SP-B) không bật online / không nhận được đơn | P0 | 1 ĐT | SẴN SÀNG |
| 8 | TC-WAL-010 | Shipper mới phải nạp tối thiểu một lần được xác nhận mới nhận được đơn | P0 | 1 ĐT | SẴN SÀNG |
| 9 | TC-WAL-006 | Admin từ chối yêu cầu nạp: ví không thay đổi | P0 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 10 | TC-WAL-007 | Shipper hủy yêu cầu nạp khi còn "Chờ xử lý" | P1 | 1 ĐT | SẴN SÀNG |
| 11 | TC-WAL-008 | Admin không được ghi nhận trùng mã giao dịch ngân hàng | P0 | PC | CẦN CHUẨN BỊ TRƯỚC |
| 12 | TC-WAL-009 | Số tiền thực nhận khác số tiền yêu cầu: ví cộng đúng số thực nhận | P1 | 1 ĐT | CẦN CHUẨN BỊ TRƯỚC |
| 13 | TC-DRV-001 | Trang chủ 11Ship khi chưa bật online: trạng thái, ví và điều kiện nhận đơn | P0 | 1 ĐT | SẴN SÀNG |
| 14 | TC-DRV-002 | Bật online thành công khi ví đủ điều kiện và GPS tốt | P0 | 1 ĐT | SẴN SÀNG |
| 15 | TC-DRV-004 | Bật online khi GPS của điện thoại đang tắt | P0 | 1 ĐT | SẴN SÀNG |
| 16 | TC-DRV-005 | Tắt online | P0 | 1 ĐT | SẴN SÀNG |
| 17 | TC-DRV-006 | Trạng thái online được giữ khi mở lại ứng dụng | P1 | 1 ĐT | SẴN SÀNG |
| 18 | TC-DRV-020 | Hồ sơ shipper: xem và sửa thông tin cá nhân | P1 | 1 ĐT | SẴN SÀNG |
| 19 | TC-DRV-022 | Tab "Thu nhập" của shipper | P2 | 1 ĐT | NOT READY |
| 20 | TC-DRV-019 | Chỉ đường từng bước (dẫn đường) cho shipper | P2 | 1 ĐT | NOT READY |
| 21 | TC-SHOP-031 | Quán tạo yêu cầu giao hàng trực tiếp (DIRECT) - nhập đủ thông tin | P0 | 1 ĐT | SẴN SÀNG |
| 22 | TC-SHOP-032 | Tạo yêu cầu giao trực tiếp: kiểm tra dữ liệu nhập sai | P1 | 1 ĐT | SẴN SÀNG |
| 23 | TC-SHOP-033 | Tạo yêu cầu giao trực tiếp với phí "Thỏa thuận" (ngoài bảng giá) | P1 | 1 ĐT | SẴN SÀNG |
| 24 | TC-DRV-011 | Đơn có phí thương lượng: nút "Đồng ý", "Đề xuất mức khác", "Bỏ qua" trên thẻ đơn | P1 | 2 ĐT | SẴN SÀNG |
| 25 | TC-DRV-024 | Đề xuất mức phí khác: nhập sai (không phải số, quá lớn, âm) | P2 | 1 ĐT | SẴN SÀNG |
| 26 | TC-SHOP-034 | Quán hủy yêu cầu giao khi chưa có shipper nhận | P0 | 2 ĐT | SẴN SÀNG |
| 27 | TC-SHOP-035 | Danh sách "Giao hàng" của quán: lọc theo trạng thái và tìm theo mã | P1 | 1 ĐT | SẴN SÀNG |
| 28 | TC-DRV-007 | Danh sách "Có thể nhận": thông tin thấy và không thấy trước khi nhận đơn | P0 | 2 ĐT | SẴN SÀNG |
| 29 | TC-DRV-008 | Chỉ nhận được đơn trong bán kính 3 km quanh quán | P1 | 2 ĐT | CẦN XÁC MINH |
| 30 | TC-DRV-009 | Shipper nhận đơn | P0 | 1 ĐT | SẴN SÀNG |
| 31 | TC-DRV-017 | Đơn DIRECT: shipper giao theo địa chỉ mô tả, không cần ghim điểm giao | P0 | 1 ĐT | SẴN SÀNG |
| 32 | TC-DRV-018 | Xem vị trí quán/người nhận trên bản đồ của shipper | P1 | 1 ĐT | CẦN XÁC MINH |
| 33 | TC-DRV-012 | Shipper hủy nhận đơn trước khi lấy hàng (có lý do) | P0 | 2 ĐT | SẴN SÀNG |
| 34 | TC-DRV-013 | Shipper bấm "Đã nhận hàng": một bước xác nhận, phí bị khóa | P0 | 1 ĐT | SẴN SÀNG |
| 35 | TC-DRV-015 | Sau khi đã lấy hàng shipper không có nút hủy hoặc "Giao thất bại" | P0 | 1 ĐT | SẴN SÀNG |
| 36 | TC-DRV-014 | Shipper giao thành công: hoa hồng thu đúng một lần | P0 | 1 ĐT | SẴN SÀNG |
| 37 | TC-DRV-016 | Lịch sử đơn của shipper | P1 | 1 ĐT | SẴN SÀNG |
| 38 | TC-DRV-010 | Hai shipper bấm nhận cùng một đơn: chỉ một người nhận được | P0 | 2 ĐT | SẴN SÀNG |
| 39 | TC-FLOW-001 | Đơn khách đặt qua 11Food - quán TRẢ phí giao - giao thành công (luồng chuẩn) | P0 | 3 ĐT | SẴN SÀNG |
| 40 | TC-FLOW-002 | Đơn khách đặt qua 11Food - KHÁCH trả phí giao - giao thành công | P0 | 3 ĐT | SẴN SÀNG |
| 41 | TC-FLOW-003 | Quán chủ động gọi shipper (DIRECT) - quán trả phí - giao thành công | P0 | 2 ĐT | SẴN SÀNG |
| 42 | TC-FLOW-004 | Quán gọi shipper (DIRECT) - KHÁCH trả phí (khách không có tài khoản 11Food) - giao thành công | P1 | 2 ĐT | SẴN SÀNG |
| 43 | TC-SHOP-030 | Xem hộp thông báo và cài đặt thông báo của chủ quán | P1 | 1 ĐT | SẴN SÀNG |
| 44 | TC-DRV-023 | Thông báo trong 11Ship và cài đặt "Đơn có thể nhận" | P1 | 1 ĐT | SẴN SÀNG |
| 45 | TC-ADM-021 | Danh sách và chi tiết "Đơn hàng" trên Web Admin | P0 | PC | SẴN SÀNG |
| 46 | TC-ADM-023 | Danh sách và chi tiết "Giao hàng" trên Web Admin (kể cả vị trí shipper) | P0 | PC | SẴN SÀNG |
| 47 | TC-ADM-017 | Danh sách và chi tiết shipper trên Web Admin | P0 | PC | SẴN SÀNG |

## Từ ngữ dùng trong file này (đọc trước)

| Từ | Nghĩa đơn giản |
|---|---|
| **PASS / FAIL / BLOCKED / NOT READY** | Kết quả bạn ghi: PASS = đúng hết; FAIL = có bước sai; BLOCKED = không làm tiếp được vì thiếu điều kiện; NOT READY = chức năng chưa có trong ứng dụng. |
| **KH-A, CQ-A, SP-A, ADMIN-1, SYSTEM…** | Tên viết tắt tài khoản thử: KH = khách hàng, CQ = chủ quán, SP = shipper (người giao hàng), ADMIN = quản trị viên (quyền được cấp), SYSTEM = quản trị cao nhất (do kỹ thuật viên giữ). Mật khẩu nằm trong "bảng thông tin riêng" của Người phụ trách, không có trong tài liệu. |
| **Điện thoại 1 / 2 / 3** | Điện thoại 1 = máy của khách; 2 = máy của quán; 3 = máy của shipper (xem HUONG_DAN mục 5.3 nếu bạn chỉ có 1-2 máy). |
| **Web Admin** | Trang web quản trị mở bằng trình duyệt trên máy tính (không phải ứng dụng điện thoại). |
| **Authenticator** | Ứng dụng trên điện thoại tạo mã 6 số đổi liên tục để đăng nhập Web Admin. |
| **Đơn món / Yêu cầu giao (ORDER, DIRECT)** | Đơn món = khách đặt món trong 11Food. Yêu cầu giao = việc nhờ shipper giao (mã dạng G-…). ORDER = giao cho đơn món của khách; DIRECT = quán tự gọi shipper, không qua khách. |
| **Số dư, tạm giữ, hoa hồng, khả dụng** | Ví của shipper: Số dư = tổng tiền trong ví; Tạm giữ = phần bị giữ khi nhận đơn (hoa hồng); Khả dụng = số dư trừ tạm giữ; hoa hồng được thu một lần khi giao thành công, trả lại khi đơn hủy. Chỉ dùng TIỀN THỬ NGHIỆM đã được Owner duyệt. |
| **Kỹ thuật viên / Người phụ trách / Owner** | Kỹ thuật viên = người chuẩn bị hệ thống và giữ tài khoản SYSTEM; Người phụ trách = người điều phối buổi test và giữ bảng thông tin riêng; Owner = chủ dự án, quyết định nghiệp vụ và nghiệm thu. |
| **Cột "Sẵn sàng"** | SẴN SÀNG = bạn tự làm được; CẦN CHUẨN BỊ TRƯỚC = kỹ thuật viên chuẩn bị xong rồi bạn tự làm; CẦN KỸ THUẬT VIÊN LÀM CÙNG = có bước kỹ thuật viên làm, bạn quan sát; CHỈ KỸ THUẬT VIÊN = bạn bỏ qua; CẦN XÁC MINH = còn chờ Owner/kỹ thuật viên trả lời. |

---

### TC-WAL-020 · SYSTEM quản lý "Tài khoản nhận tiền" của hệ thống; ADMIN không có quyền

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #121 (trong ngày: 1) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chỉ SYSTEM thêm/bật/tắt tài khoản mà shipper chuyển tiền nạp vào. Số tài khoản hiển thị che bớt. |
| Người thực hiện | SYSTEM, ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần kỹ thuật viên cùng làm |
| Tình trạng sẵn sàng | **CẦN KỸ THUẬT VIÊN LÀM CÙNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| **Có thể chặn thử nghiệm bên ngoài** | Sai quyền (xem/làm việc không được phép): Một lỗi phân quyền cho phép người này thấy/sửa dữ liệu hoặc tiền của người khác - lỗi NGHIÊM TRỌNG, dừng pilot. |
| Việc cần chuẩn bị trước | SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn. Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. |
| Phân công khi đang test | Kỹ thuật viên/SYSTEM làm bước 1, 2, 3, 4. SYSTEM làm bước 1-4 (cấu hình tài khoản nhận tiền thử nghiệm). Bạn làm bước 5 bằng tài khoản ADMIN-1. |
| Nếu thiếu điều kiện | Nếu kỹ thuật viên/SYSTEM chưa có mặt: đánh dấu BLOCKED, ghi "chờ kỹ thuật viên", hẹn giờ rồi chuyển sang test kế tiếp (hầu hết test sau không phụ thuộc test này trừ khi cột "Phụ thuộc" ghi tên nó). |
| Điều kiện ban đầu | SYSTEM đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. Chỉ thêm tài khoản thử nghiệm do Người phụ trách chỉ định. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | [KỸ THUẬT VIÊN/SYSTEM làm, bạn quan sát và chụp màn hình] Ở menu bên trái của Web Admin, chọn: TÀI CHÍNH > Tài chính > "Tài khoản nhận tiền". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | [KỸ THUẬT VIÊN/SYSTEM làm, bạn quan sát và chụp màn hình] Chạm "Thêm tài khoản", nhập tài khoản thử (theo Người phụ trách), lưu. | Tài khoản mới ở trạng thái "Đã tắt" ("Tài khoản mới ở trạng thái tắt cho đến khi bạn bật."). |
| 3 | [KỸ THUẬT VIÊN/SYSTEM làm, bạn quan sát và chụp màn hình] Chạm "Bật nhận tiền" và xác nhận ("Bật nhận tiền cho tài khoản này?"). | Trạng thái "Đang bật"; số tài khoản được che. |
| 4 | [KỸ THUẬT VIÊN/SYSTEM làm, bạn quan sát và chụp màn hình] Chạm "Tắt nhận tiền" > xác nhận. | Trạng thái "Đã tắt"; shipper không còn thấy tài khoản này khi nạp (nếu không còn tài khoản nào bật: ứng dụng báo chưa cấu hình). |
| 5 | Đăng nhập bằng ADMIN-1 và tìm mục này. | ADMIN không thấy/không vào được ("Chỉ SYSTEM xem và quản lý."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Tắt hoặc xóa tài khoản thử; bật lại tài khoản thử dùng cho test nạp nếu cần.

**Căn cứ:** `apps/admin-web/src/dom/finance-admin-view.ts (Tài khoản nhận tiền)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-finance-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-001 · Ví shipper mới: số dư 0đ, chưa có giao dịch

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #122 (trong ngày: 2) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #18**

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper mới đăng ký có ví 0đ; ứng dụng không hiện số tiền giả. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A vừa đăng ký, chưa nạp tiền. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trang chủ 11Ship chạm "Ví tiền / Nạp tiền". | Màn "Ví của tôi" mở ra. |
| 2 | Xem thẻ số dư. | "Số dư khả dụng" = 0đ; "Tổng số dư" = 0đ; "Tiền tạm giữ" = 0đ. Có chú thích "Tiền tạm giữ là tiền giữ chỗ, chưa bị trừ khỏi sổ giao dịch." |
| 3 | Xem phần giao dịch. | Hiện "Chưa có giao dịch" ("Các giao dịch của ví sẽ hiển thị ở đây."). |
| 4 | Tìm nút rút tiền. | Trên màn Ví chỉ có nút "Nạp tiền"; có dòng "Để rút toàn bộ số dư, mở Tài khoản → Dừng hoạt động / Rút tiền." (không có nút "Rút tiền" riêng). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart (WalletHomeScreen, _BalanceCard)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/wallet_views_test.dart; wallet_http_views_test.dart; tests/integration/m04-wallet-core.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-002 · Nạp tiền: số tiền dưới mức tối thiểu bị từ chối

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #123 (trong ngày: 3) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #19**

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi lần nạp phải đạt mức tối thiểu (mặc định 100.000đ, SYSTEM chỉnh được). |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Mở "Ví của tôi" > "Nạp tiền". |
| Dữ liệu nhập | Thử: để trống, "5000", "abc", "99999", rồi một số ≥ mức tối thiểu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở màn "Nhập số tiền nạp" đọc dòng gợi ý. | Hiện "Tối thiểu … mỗi lần nạp" đúng bằng mức đang cấu hình (hỏi Người phụ trách/Admin để đối chiếu). |
| 2 | Nhập lần lượt "5000", "abc", "99999" rồi bấm tiếp tục. | Mỗi lần không đi tiếp và báo "Số tiền nạp tối thiểu …" hoặc lỗi số không hợp lệ; để trống thì báo "Hãy nhập số tiền muốn nạp." |
| 3 | Nhập số bằng đúng mức tối thiểu. | Đi tiếp được sang màn xác nhận. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Thoát màn hình.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart (TopupAmountScreen); apps/backend/src/wallet-topup (TOPUP_AMOUNT_BELOW_MINIMUM)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/wallet_views_test.dart; tests/integration/m04-topup-requests.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-003 · Tạo yêu cầu nạp tiền: thông tin chuyển khoản và trạng thái "Chờ xử lý" (tiền chưa vào ví)

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #124 (trong ngày: 4) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG · **Smoke #20**

| Mục | Nội dung |
|---|---|
| Mục đích | Yêu cầu nạp chỉ là đề nghị; tiền KHÔNG vào ví cho đến khi Admin đối chiếu sao kê và xác nhận. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-WAL-002 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Việc cần chuẩn bị trước | Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | SP-A đăng nhập, số dư 0đ. SYSTEM đã bật tài khoản nhận tiền thử nghiệm. |
| Dữ liệu nhập | Số tiền nạp: đúng mức tối thiểu (mặc định 100000). |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. Cần SYSTEM đã thêm và BẬT ít nhất một "Tài khoản nhận tiền" (Web Admin > Tài chính > Tài khoản nhận tiền); nếu chưa có, ứng dụng báo chưa cấu hình tài khoản nhận. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ví > "Nạp tiền", nhập 100000 (hoặc mức tối thiểu), bấm tiếp tục. | Sang màn "Xác nhận nạp tiền" với "Thông tin chuyển khoản": "Ngân hàng", "Số tài khoản", "Chủ tài khoản", "Số tiền", "Nội dung chuyển khoản", nút "Sao chép". Có dòng "Hệ thống chỉ cộng tiền vào ví sau khi Admin kiểm tra và xác nhận giao dịch ngân hàng." và "Mã QR chưa được hỗ trợ ở phiên bản này…". |
| 2 | Chạm "Sao chép" ở nội dung chuyển khoản. | Hiện "Đã sao chép". |
| 3 | (KHÔNG chuyển tiền thật.) Chạm "Tôi đã chuyển tiền" khi Người phụ trách xác nhận đây là tiền thử nghiệm. | Tạo yêu cầu; hiện "Đã gửi yêu cầu" / "Bạn đã gửi yêu cầu nạp 100.000đ. Admin sẽ kiểm tra và cộng tiền vào ví sau khi xác minh giao dịch ngân hàng." Trạng thái "Chờ xử lý"/"Chờ xác nhận". |
| 4 | Quay về "Ví của tôi". | Số dư khả dụng VẪN 0đ ("Tiền chưa được cộng ngay"). Yêu cầu hiện trong "Giao dịch gần đây" hoặc "Xem yêu cầu". |
| 5 | Mở "Chi tiết yêu cầu nạp". | Thấy mã yêu cầu, ngày tạo, số tiền, trạng thái, nút "Hủy yêu cầu". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu số dư tăng ngay khi chưa có Admin xác nhận. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Hủy yêu cầu thử ("Hủy yêu cầu" > "Hủy yêu cầu nạp?") nếu không dùng tiếp (TC-WAL-007).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart (TopupConfirmScreen, TopupDetailScreen); docs/current/M04-B2-1-shipper-topup-request-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-topup-requests.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-004 · Admin thấy yêu cầu nạp tiền và đối chiếu thông tin

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #125 (trong ngày: 5) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #21**

| Mục | Nội dung |
|---|---|
| Mục đích | Yêu cầu nạp của shipper hiện đúng cho Admin có quyền; Admin không có quyền chỉ xem. |
| Người thực hiện | ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-WAL-003 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Việc cần chuẩn bị trước | SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn. Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Có yêu cầu nạp "Chờ xử lý" của SP-A. ADMIN-1 (hoặc SYSTEM) đăng nhập Web Admin với quyền "Xem yêu cầu nạp tiền" và "Xác nhận / từ chối nạp tiền". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của ADMIN-1 rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: ADMIN". |
| 4 | Ở menu bên trái của Web Admin, chọn: TÀI CHÍNH > Tài chính > "Nạp tiền". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 5 | Tìm yêu cầu của SP-A trong danh sách (cột "Mã yêu cầu", "Số tiền đề nghị", "Trạng thái"). | Yêu cầu hiện đúng số tiền, đúng shipper (số điện thoại che bớt), trạng thái "Chờ". |
| 6 | Mở "Chi tiết yêu cầu nạp". | Thấy số tiền đề nghị, tài khoản nhận, thời gian tạo; có nút "Kiểm tra và xác nhận" và "Từ chối yêu cầu" (nếu ADMIN có quyền). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Đăng xuất Web Admin.

**Căn cứ:** `apps/admin-web/src/dom/finance-admin-view.ts (Yêu cầu nạp tiền, Chi tiết yêu cầu nạp)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-admin-topup.int.spec.ts; admin-finance-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-005 · Admin ghi nhận tiền: ví shipper được cộng đúng một lần (nạp cho SP-A bằng tiền thử nghiệm)

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #126 (trong ngày: 6) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG · **Smoke #22**

| Mục | Nội dung |
|---|---|
| Mục đích | Sau khi Admin đối chiếu và ghi nhận, ví được cộng đúng số tiền thực nhận, lịch sử có dòng "Nạp tiền", và shipper đủ điều kiện nhận đơn. |
| Người thực hiện | ADMIN + Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-WAL-004 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Việc cần chuẩn bị trước | SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn. Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Có yêu cầu nạp "Chờ" của SP-A (TC-WAL-003). Ghi số dư SP-A trước (0đ). |
| Dữ liệu nhập | Số tiền thực nhận: 100000 (bằng số tiền yêu cầu). Mã giao dịch ngân hàng: "TEST-<ngày>-<số thứ tự>". Thời điểm tiền về: thời điểm hiện tại. Ghi chú ghi rõ TEST. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. Mã giao dịch ngân hàng nhập phải là mã THỬ NGHIỆM duy nhất, ví dụ "TEST-20261025-001", mỗi mã chỉ dùng một lần trên toàn hệ thống. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin mở yêu cầu nạp của SP-A, chạm "Kiểm tra và xác nhận". | Màn "Xác nhận ghi nhận tiền" hiện ô "Số tiền thực nhận (VND)", "Mã giao dịch ngân hàng", "Thời điểm tiền về" và dòng "Kiểm tra lại với sao kê. Sau khi ghi nhận, số tiền được cộng vào ví và không thể sửa." |
| 2 | Nhập số tiền thực nhận 100000, mã giao dịch thử nghiệm, thời điểm; chạm "Xác nhận đã nhận tiền" rồi xác nhận lần cuối. | Hiện kết quả thành công, yêu cầu chuyển trạng thái đã xác nhận, có người xử lý và thời gian ("Xử lý lúc"). |
| 3 | Shipper mở "Ví của tôi" (kéo làm mới). | Số dư khả dụng và tổng số dư = 100.000đ; có đúng MỘT dòng "Nạp tiền" +100.000đ; yêu cầu chuyển "Hoàn thành"/"Admin đã xác nhận. Số tiền thực nhận đã được ghi vào ví.". |
| 4 | Shipper bật online (TC-DRV-002). | Bật được vì ví đủ điều kiện. |
| 5 | Admin mở lại yêu cầu và thử bấm xác nhận lần nữa (nếu còn nút). | KHÔNG ghi nhận lần hai; số dư vẫn 100.000đ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu số dư khác 100.000đ hoặc có hai dòng nạp. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Tiền thử nghiệm giữ lại trong ví SP-A để chạy các test nhận đơn. Ghi mã giao dịch TEST đã dùng vào ô ghi chú. Không thể hoàn tác ghi nhận.

**Căn cứ:** `apps/admin-web/src/dom/finance-admin-view.ts (Xác nhận ghi nhận tiền); docs/current/M04-B2-2b-admin-topup-posting-20261018.md; M04-C`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-admin-topup.int.spec.ts; m04-wallet-topup-sources.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-003 · Shipper không đủ tiền trong ví (SP-B) không bật online / không nhận được đơn

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #127 (trong ngày: 7) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Ví không đủ thì không nhận đơn, để hoa hồng luôn thu được. Ứng dụng phải nói rõ lý do. |
| Người thực hiện | Shipper (SP-B) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-005 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Điều kiện ban đầu | SP-B đăng nhập, ví 0đ (hoặc dưới mức tối thiểu), chưa nạp tiền. Có một đơn đang "Đang tìm shipper" để thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Trang chủ đọc dòng lý do dưới trạng thái. | Có lý do rõ ràng như "Số dư ví chưa đủ điều kiện" hoặc "Ví chưa đủ điều kiện nhận đơn nên chưa bật nhận đơn được." (có thể gồm cả hướng dẫn nạp tiền). |
| 2 | Chạm "Bật online". | KHÔNG bật được: hiện "Chưa bật được nhận đơn" kèm lý do; trạng thái vẫn "Bạn đang offline". |
| 3 | Mở tab "Đơn hàng" > "Có thể nhận". | Không có đơn nhận được, hoặc thẻ đơn hiện không đủ điều kiện (nút "Nhận đơn" bị khóa) kèm lý do (ví dụ số dư thấp). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu shipper ví 0đ nhận được đơn. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/ship/lib/ship_home.dart; mobile/packages/n11_shared/lib/src/flows/driver_controller.dart (BALANCE_TOO_LOW); apps/backend/src/wallet/wallet-driver-port.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-eligibility.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-010 · Shipper mới phải nạp tối thiểu một lần được xác nhận mới nhận được đơn

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #128 (trong ngày: 8) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper mới (chưa có tổng nạp đã xác nhận đạt mức nạp tối thiểu) không nhận được đơn dù có yêu cầu nạp đang chờ. |
| Người thực hiện | Shipper (SP-B) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-005 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | SP-B mới đăng ký, ví 0đ; có thể có một yêu cầu nạp "Chờ xử lý" nhưng chưa được Admin xác nhận. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trang chủ, đọc lý do dưới trạng thái. | Báo rõ chưa đủ điều kiện (ví chưa đủ/ cần nạp). |
| 2 | Chạm "Bật online". | Không bật được ("Chưa bật được nhận đơn"). |
| 3 | (Khi Admin đã xác nhận nạp cho SP-B) Quay lại Trang chủ và bật online. | Bật được. (Test này gắn với TC-WAL-005/009.) |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu yêu cầu nạp "Chờ" đã được tính như tiền. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/backend/src/wallet/wallet-driver-port.ts (initialFundingRequired, confirmedTopupVnd); docs/current/M03-simplified-onboarding-20261020.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts; m04-topup-requests.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-006 · Admin từ chối yêu cầu nạp: ví không thay đổi

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #129 (trong ngày: 9) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Yêu cầu không khớp sao kê bị từ chối, không có tiền nào vào ví và shipper được báo. |
| Người thực hiện | ADMIN + Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-WAL-003 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Việc cần chuẩn bị trước | SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn. Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | SP-B tạo một yêu cầu nạp mới "Chờ xử lý" (làm TC-WAL-003 với SP-B). Ghi số dư SP-B. |
| Dữ liệu nhập | Lý do từ chối: "Không khớp sao kê (TEST)". |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin mở yêu cầu nạp của SP-B, chạm "Từ chối yêu cầu". | Hộp "Từ chối yêu cầu nạp tiền?" yêu cầu "Lý do". |
| 2 | Nhập lý do, xác nhận. | Yêu cầu chuyển "Đã từ chối"; có người xử lý và lý do. |
| 3 | Shipper mở "Ví của tôi" và chi tiết yêu cầu. | Số dư KHÔNG đổi; yêu cầu hiện "Đã từ chối"/"Admin đã từ chối yêu cầu này. Ví không thay đổi." Shipper nhận thông báo "nạp tiền bị từ chối" (hộp thông báo). |
| 4 | Shipper tạo một yêu cầu nạp mới. | Tạo được yêu cầu mới (yêu cầu cũ đã đóng). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Hủy yêu cầu mới nếu không dùng.

**Căn cứ:** `apps/admin-web/src/dom/finance-admin-view.ts (Từ chối yêu cầu nạp tiền?)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-admin-topup.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-007 · Shipper hủy yêu cầu nạp khi còn "Chờ xử lý"

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #130 (trong ngày: 10) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper tự hủy yêu cầu chưa được xử lý; ví không đổi. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-003 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có yêu cầu nạp "Chờ xử lý" của SP-B. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Chi tiết yêu cầu nạp", chạm "Hủy yêu cầu". | Hộp "Hủy yêu cầu nạp?" nói "Yêu cầu nạp tiền sẽ bị hủy. Bạn có thể tạo yêu cầu mới sau." |
| 2 | Xác nhận hủy. | Hiện "Yêu cầu đã được hủy. Ví không thay đổi."; trạng thái "Đã hủy". Không còn nút hủy. |
| 3 | Admin xem danh sách "Nạp tiền". | Yêu cầu hiện "Đã hủy" (không còn trong nhóm chờ). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart (Hủy yêu cầu nạp?); docs/current/M04-B2-1-shipper-topup-request-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-topup-requests.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-008 · Admin không được ghi nhận trùng mã giao dịch ngân hàng

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #131 (trong ngày: 11) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Một giao dịch ngân hàng chỉ được cộng tiền một lần trên toàn hệ thống. |
| Người thực hiện | ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Việc cần chuẩn bị trước | SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn. Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Mã giao dịch TEST đã dùng ở TC-WAL-005 (ví dụ "TEST-20261025-001"). Có thêm một yêu cầu nạp "Chờ" khác (SP-B). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin mở yêu cầu nạp của SP-B, "Kiểm tra và xác nhận", nhập CÙNG mã giao dịch đã dùng. | Máy chủ từ chối: báo mã giao dịch đã được ghi nhận/chiếm chỗ; KHÔNG cộng tiền. |
| 2 | Đổi sang mã mới (TEST-…-002) và xác nhận. | Ghi nhận được, ví SP-B tăng đúng số tiền. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu chấp nhận trùng mã và cộng tiền hai lần. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Ghi lại mã TEST đã dùng.

**Căn cứ:** `apps/admin-web/src/dom/finance-admin-view.ts (Mã giao dịch ngân hàng); docs/current/M04-B1-topup-source-core-20261017.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-wallet-topup-sources.int.spec.ts; m04-admin-topup.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-009 · Số tiền thực nhận khác số tiền yêu cầu: ví cộng đúng số thực nhận

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #132 (trong ngày: 12) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu khách chuyển thiếu/thừa, Admin nhập số thực nhận theo sao kê; ví cộng đúng số đó (không cộng theo số đề nghị). |
| Người thực hiện | ADMIN + Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN CHUẨN BỊ TRƯỚC** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Việc cần chuẩn bị trước | SYSTEM đã tạo và kích hoạt sẵn tài khoản ADMIN-1 (và ADMIN-2 nếu test cần) với đúng các quyền test yêu cầu, rồi đưa bạn số điện thoại/mật khẩu qua kênh riêng. Ứng dụng Authenticator đã cài trên điện thoại của bạn. Owner đã duyệt bằng văn bản "Quy tắc tiền thử nghiệm" (HUONG_DAN mục 7) và SYSTEM đã bật sẵn một "Tài khoản nhận tiền" thử nghiệm. Nếu CHƯA có duyệt: ghi BLOCKED, KHÔNG chuyển tiền thật. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Một yêu cầu nạp 100.000đ đang "Chờ" (SP-B). Ghi số dư SP-B. |
| Dữ liệu nhập | Yêu cầu 100000; Admin nhập số thực nhận 120000 (hoặc 100000 nếu Người phụ trách quy định); mã giao dịch TEST mới. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin xác nhận với số tiền thực nhận KHÁC số đề nghị. | Hệ thống hiển thị rõ số đề nghị và số thực nhận; cho xác nhận theo số thực nhận (hoặc cảnh báo nếu chính sách yêu cầu). |
| 2 | Shipper mở ví. | Số dư tăng ĐÚNG số tiền thực nhận Admin đã nhập; lịch sử có một dòng nạp đúng số đó. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Ghi nhận số dư mới của SP-B.

**Căn cứ:** `apps/admin-web/src/dom/finance-admin-view.ts (Số tiền thực nhận, Tiền đề nghị)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-admin-topup.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-001 · Trang chủ 11Ship khi chưa bật online: trạng thái, ví và điều kiện nhận đơn

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #133 (trong ngày: 13) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper thấy rõ mình đang online hay offline, ví có đủ điều kiện không và vì sao chưa nhận được đơn. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | SP-A đăng nhập trên Điện thoại 3, chưa bật online. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Ship, tab "Trang chủ". | Thấy bản đồ Cao Bằng (nếu bản cài có gói bản đồ; nếu không thấy "Bản cài này chưa bật gói bản đồ Cao Bằng..." - ghi nhận), dòng "Bạn đang offline" và nút "Bật online". |
| 2 | Đọc dòng lý do dưới trạng thái. | Nói rõ điều kiện ví: "Ví đủ điều kiện. Bạn có thể bật hoạt động." hoặc "Số dư ví chưa đủ điều kiện" (SP-B) / các lý do khác bằng tiếng Việt, không hiện mã kỹ thuật. |
| 3 | Đọc lời giải thích phía dưới nút. | Có "Bật online sẽ chia sẻ vị trí của bạn khoảng 1 phút một lần, kể cả khi khóa màn hình, để nhận đơn gần bạn và cho quán biết bạn đang tới. Tắt online để ngừng nhận đơn mới." |
| 4 | Chạm "Ví tiền / Nạp tiền". | Mở màn "Ví của tôi" với "Số dư khả dụng", "Tổng số dư". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/ship/lib/ship_home.dart (home-activity-status, home-online-reason, home-online-disclosure)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_home_test.dart (nếu có); mobile/packages/n11_shared/test/driver_m03_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-002 · Bật online thành công khi ví đủ điều kiện và GPS tốt

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #134 (trong ngày: 14) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper đủ điều kiện bật online; vị trí được chia sẻ để nhận đơn gần. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tiền thử nghiệm trong ví shipper (Owner duyệt); GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| **Có thể chặn thử nghiệm bên ngoài** | Thông báo/đồng ý về vị trí nền: Shipper online chia sẻ vị trí cả khi tắt màn hình; phải có thông báo/đồng ý rõ ràng trước khi để shipper ngoài dùng. |
| Điều kiện ban đầu | SP-A đã đăng nhập 11Ship trên Điện thoại 3, ví ĐỦ TIỀN (đã nạp xác nhận ít nhất mức nạp tối thiểu và số dư khả dụng lớn hơn hoa hồng một đơn; xem TC-WAL-005), đứng trong bán kính 3 km quanh Quán Test A, GPS bật. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Trang chủ chạm "Bật online". Cho phép quyền vị trí/thông báo nếu hỏi. | Nút hiện "Đang xử lý…" rồi đổi thành "Tắt online". Trạng thái "Bạn đang online". |
| 2 | Đọc dòng nhỏ về vị trí. | Hiện "Đang lấy vị trí…" rồi "Đang chia sẻ vị trí". |
| 3 | Kéo thanh thông báo của Android xuống. | Có thông báo thường trực của 11Ship (dịch vụ chia sẻ vị trí đang chạy). |
| 4 | Mở Web Admin > Vận hành > Shipper > SP-A (nếu có quyền). | Admin thấy shipper đang bật nhận đơn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Chạm "Tắt online" khi xong test.

**Căn cứ:** `mobile/ship/lib/ship_online.dart; docs/current/M14-online-location-20261024.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart; tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-004 · Bật online khi GPS của điện thoại đang tắt

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #135 (trong ngày: 15) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Không có vị trí thì không nhận đơn; ứng dụng phải hướng dẫn bật GPS. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt); GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | SP-A đã đăng nhập 11Ship trên Điện thoại 3, ví ĐỦ TIỀN (đã nạp xác nhận ít nhất mức nạp tối thiểu và số dư khả dụng lớn hơn hoa hồng một đơn; xem TC-WAL-005), đứng trong bán kính 3 km quanh Quán Test A, GPS bật. Tắt GPS (Vị trí) của điện thoại. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Bật online". | Không bật được; hiện "GPS đang tắt. Hãy bật Vị trí trên điện thoại rồi thử lại." và nút "Mở cài đặt vị trí". |
| 2 | Chạm "Mở cài đặt vị trí", bật GPS, quay lại, chạm "Thử lại". | Bật online thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Tắt online.

**Căn cứ:** `mobile/ship/lib/ship_online.dart (GPS đang tắt…)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-005 · Tắt online

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #136 (trong ngày: 16) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper ngừng nhận đơn mới bất cứ lúc nào; việc tắt không hủy đơn đang giao. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-002 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đang online, chưa có đơn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trang chủ chạm "Tắt online". | Trạng thái đổi sang "Bạn đang offline"; nút lại là "Bật online". |
| 2 | Kéo thanh thông báo Android xuống. | Thông báo thường trực chia sẻ vị trí biến mất (vì không còn đơn). |
| 3 | Chạm tab "Đơn hàng" > "Có thể nhận". | Không còn đơn mới nào được đề xuất. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/ship/lib/ship_online.dart; docs/current/M14-online-location-20261024.md (Tắt online luôn được)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-006 · Trạng thái online được giữ khi mở lại ứng dụng

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #137 (trong ngày: 17) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper không phải bật lại mỗi lần mở app nếu chưa tắt. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-002 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đang online. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Vuốt tắt hẳn 11Ship rồi mở lại. | Mở lại; ứng dụng đọc trạng thái từ máy chủ. |
| 2 | Nhìn Trang chủ. | Vẫn "Bạn đang online" và tiếp tục "Đang chia sẻ vị trí" (hoặc có hướng dẫn rõ nếu thiếu quyền). Không tự bật online khi shipper đã tắt trước đó. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Tắt online.

**Căn cứ:** `mobile/ship/lib/ship_online.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-020 · Hồ sơ shipper: xem và sửa thông tin cá nhân

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #138 (trong ngày: 18) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper xem hồ sơ (mã shipper, họ tên, biển số) và cập nhật biển số. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đăng nhập. |
| Dữ liệu nhập | Biển số xe "11A-123.45" (ví dụ). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > "Hồ sơ shipper". | Màn "Hồ sơ shipper" hiện "Thông tin shipper": "Mã shipper", "Họ tên", "Số điện thoại", "Biển số xe", trạng thái "Đang hoạt động". |
| 2 | Nhập "Biển số" = "11A-123.45", chạm "Lưu thông tin". | Hiện "Đã lưu thông tin hồ sơ." |
| 3 | Quay lại rồi mở lại hồ sơ. | Biển số vẫn là giá trị vừa lưu. |
| 4 | Thử xóa trống "Họ và tên" rồi lưu. | Báo lỗi hoặc không cho lưu tên trống. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Có thể xóa biển số thử.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/driver_views.dart (Hồ sơ shipper, Lưu thông tin)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts; mobile/packages/n11_shared/test/driver_m03_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-022 · Tab "Thu nhập" của shipper

**Mức độ:** P2 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #139 (trong ngày: 19) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Ghi nhận hiện trạng: tab Thu nhập chưa có số liệu thật và phải ghi rõ chưa có, không hiện 0đ giả. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **NOT READY** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Theo mã nguồn tab "Thu nhập" hiện chỉ có khung "Chưa có dữ liệu thu nhập" và "Tổng thu nhập: —" ("— nghĩa là chưa biết, không phải 0 đồng"). Chức năng thu nhập CHƯA có. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Ship (đã đăng nhập SP-A). | Thấy thanh dưới cùng có tab "Thu nhập". |
| 2 | Chạm tab "Thu nhập". | Hiện "Tổng thu nhập" = "—" kèm chú thích "Chưa có dữ liệu. "—" nghĩa là chưa biết, không phải 0 đồng." và "Chưa có dữ liệu thu nhập". Nút "Chọn khoảng ngày" bị khóa kèm lý do. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/ship/lib/ship_tabs.dart (_income)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-019 · Chỉ đường từng bước (dẫn đường) cho shipper

**Mức độ:** P2 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #140 (trong ngày: 20) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Ghi nhận rõ ràng rằng ứng dụng hiện KHÔNG có chức năng chỉ đường từng bước; chỉ có bản đồ offline hiển thị điểm. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **NOT READY** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | SP-A đã nhận đơn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Không tìm thấy mã nguồn chỉ đường/dẫn đường trong 11Ship (chỉ có bản đồ offline và ghim điểm). Test này ghi nhận hiện trạng để Owner quyết định; không phải lỗi nếu không có nút chỉ đường. Shipper dùng ứng dụng bản đồ khác khi cần. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên 11Ship mở chi tiết đơn đã nhận (tab "Đơn hàng" > "Đang thực hiện" > chạm đơn). | Chi tiết đơn mở ra với địa chỉ quán, người nhận, phí. |
| 2 | Tìm trong chi tiết đơn và trong phần bản đồ (nếu có) nút "Chỉ đường"/"Dẫn đường". | Ghi nhận: không có nút chỉ đường. Nếu CÓ, mô tả nút và kết quả bấm (ghi vào ghi chú và đổi trạng thái test). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `Tìm trong mobile/ship/lib và mobile/packages/n11_shared/lib/src/m07: không có chỉ đường; docs/current/M14-integration-20261016.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Không có.

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-031 · Quán tạo yêu cầu giao hàng trực tiếp (DIRECT) - nhập đủ thông tin

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #141 (trong ngày: 21) · **Mức nghiêm trọng nếu FAIL:** Cao · **Smoke #24**

| Mục | Nội dung |
|---|---|
| Mục đích | Quán chủ động gọi shipper cho một đơn không đặt qua 11Food: chỉ cần địa chỉ mô tả, tên và số điện thoại người nhận, mô tả hàng, không cần ghim bản đồ điểm giao. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có); Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | CQ-A ở chế độ quản lý quán. Bảng phí giao hàng đã được SYSTEM áp dụng (TC-ADM-024). |
| Dữ liệu nhập | Tên người nhận "Người Nhận Test". Số điện thoại người nhận: SĐT-NHẬN (10 số, bắt đầu bằng 0, là số của một người trong nhóm test). Địa chỉ giao (mô tả): "Số 20 đường Test, tổ 5, phường Test - cạnh cửa hàng tạp hóa". Mô tả hàng "1 hộp bánh Test". Giá trị hàng 100000. Ai trả phí: "Quán trả". Cách tính phí: "Theo bảng giá" > chọn mốc quãng đường ước tính (khung 1). Ghi chú: "Gọi trước khi đến (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Đơn hàng" > chạm nút "Giao hàng" (khác với "Đơn món"). Chạm "Gọi shipper". | Mở màn tạo yêu cầu giao với các ô "Tên người nhận", "Số điện thoại người nhận", "Địa chỉ giao (mô tả)" (gợi ý "Ghi rõ để shipper tìm được. Không cần ghim bản đồ."), "Mô tả hàng", "Giá trị hàng (đ)", "Ghi chú", mục "Người trả phí" và cách tính phí. |
| 2 | Nhập dữ liệu như phần Dữ liệu nhập. Chọn "Quán trả". Ở phần phí chọn "Theo bảng giá" rồi chọn một mốc ở "Chọn mốc quãng đường ước tính". | Hiện mức phí của mốc đã chọn và dòng "Đây là phí ước tính theo mốc bạn chọn, không phải quãng đường đo trên bản đồ. Shipper có thể đề xuất mức khác và bên trả phí quyết định." Ghi lại mức phí. |
| 3 | Chạm "Gọi shipper" ở cuối màn hình, rồi xác nhận "Gọi shipper?". | Yêu cầu giao được tạo, hiện trong danh sách "Giao hàng" với mã dạng "G-…" và trạng thái "Đang tìm shipper"; hiện bộ đếm thời gian tìm (tối đa 30 phút). |
| 4 | Mở yêu cầu vừa tạo. | Chi tiết có người nhận, địa chỉ mô tả, hàng, phí giao và người trả phí đúng như đã nhập. KHÔNG có bản đồ theo dõi vị trí điểm giao. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Hủy yêu cầu giao bằng nút "Hủy yêu cầu giao" (TC-SHOP-034) nếu chưa có shipper nhận.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (form tạo yêu cầu); docs/current/M07-owner-delivery-flow-20261023.md mục III`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-032 · Tạo yêu cầu giao trực tiếp: kiểm tra dữ liệu nhập sai

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #142 (trong ngày: 22) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Thiếu thông tin hoặc số điện thoại sai thì không gọi được shipper. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đang ở màn tạo yêu cầu giao. |
| Dữ liệu nhập | Lần 1: để trống tên/địa chỉ/mô tả hàng. Lần 2: số điện thoại "12345". Lần 3: giá trị hàng "abc". Lần 4: ghi chú "Gọi số 0912345678" (có số điện thoại trong ghi chú). Lần 5: không chọn mốc phí. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán: tab "Đơn hàng" > "Giao hàng" > "Gọi shipper" để mở màn tạo yêu cầu giao. | Màn tạo yêu cầu giao mở ra với các ô trống. |
| 2 | Thử từng dữ liệu ở mục Dữ liệu nhập rồi chạm "Gọi shipper". | Mỗi lần không gửi được và báo lỗi cụ thể: "Hãy nhập tên người nhận, địa chỉ và mô tả hàng."; "Số điện thoại người nhận chưa đúng (10 số, bắt đầu bằng 0)."; "Hãy nhập giá trị hàng (số nguyên, có thể là 0)."; "Ghi chú cho shipper không được chứa số điện thoại."; "Hãy chọn mốc phí giao, hoặc chọn "Thỏa thuận" và nhập mức phí đề xuất." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Thoát màn hình, không có yêu cầu nào được tạo.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (các thông báo lỗi); m07_widgets.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-033 · Tạo yêu cầu giao trực tiếp với phí "Thỏa thuận" (ngoài bảng giá)

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #143 (trong ngày: 23) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi phí không tính được theo bảng, quán đề xuất mức phí và lý do; shipper đồng ý hoặc đề xuất lại. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đang ở màn tạo yêu cầu giao, đã nhập đủ thông tin người nhận. |
| Dữ liệu nhập | Cách tính phí "Thỏa thuận". Mức phí đề xuất 30000. Lý do: "Thời tiết xấu" (hoặc "Gấp", "Cồng kềnh", "Khác" kèm ghi chú). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Thỏa thuận". Nhập "Mức phí đề xuất (đ)" = 30000. Chọn lý do "Thời tiết xấu". | Hiện ô nhập phí và lý do; hiện mức đề xuất 30.000đ. |
| 2 | Chọn lý do "Khác" mà bỏ trống ghi chú. | Báo "Lý do Khác cần có ghi chú."; không gửi. |
| 3 | Nhập phí "-5" hoặc "15000000". | Báo "Nhập phí là số nguyên từ 0 đến 10.000.000đ." |
| 4 | Sửa lại phí hợp lệ, chạm "Gọi shipper". | Yêu cầu được tạo với "Phí thỏa thuận" 30.000đ ở trạng thái "Đang tìm shipper". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Hủy yêu cầu giao nếu chưa có shipper nhận.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (Thỏa thuận, lý do); docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-fee-agreement.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-011 · Đơn có phí thương lượng: nút "Đồng ý", "Đề xuất mức khác", "Bỏ qua" trên thẻ đơn

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #144 (trong ngày: 24) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi quán đề xuất mức phí (phí thỏa thuận), shipper chọn đồng ý, đề xuất mức khác hoặc bỏ qua. |
| Người thực hiện | Shipper + Quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-033 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán tạo yêu cầu giao DIRECT với phí "Thỏa thuận" 30.000đ (TC-SHOP-033). SP-A online đủ điều kiện. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 3 (máy SHIPPER) chạm tab "Đơn hàng" rồi chạm "Có thể nhận". | Thấy thẻ đơn mới của quán: tên quán, khu vực lấy/giao, phí giao, người trả phí và nút "Nhận đơn". KHÔNG thấy số điện thoại người nhận và địa chỉ chi tiết. |
| 2 | Đọc thẻ đơn. | Thấy "Phí đề xuất 30.000đ", lý do (ví dụ "Thời tiết xấu"), và ba nút "Đồng ý", "Đề xuất mức khác", "Bỏ qua". Nút "Nhận đơn" chưa dùng được cho đến khi phí chốt ("Phí chưa chốt nên chưa nhận đơn được. Hãy đồng ý mức phí hoặc đề xuất mức khác."). |
| 3 | Chạm "Bỏ qua". | Thẻ đơn ẩn khỏi danh sách của shipper này (đơn vẫn tìm shipper khác). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Quán hủy yêu cầu giao.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (m07-fee-agree, m07-fee-counter, m07-fee-skip)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-fee-agreement.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-024 · Đề xuất mức phí khác: nhập sai (không phải số, quá lớn, âm)

**Mức độ:** P2 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #145 (trong ngày: 25) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Mức phí đề xuất phải là số nguyên từ 0 đến 10.000.000đ. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-011 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có thẻ đơn có nút "Đề xuất mức phí khác" (dùng yêu cầu giao đang tìm shipper ở TC-DRV-011). |
| Dữ liệu nhập | "abc", "-5", "10000001", "12.5", "20000". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Đề xuất mức phí khác" và nhập lần lượt "abc", "-5", "10000001", "12.5", rồi chạm "Gửi đề xuất". | Với mỗi giá trị sai: báo "Nhập phí là số nguyên từ 0 đến 10.000.000đ."; không gửi. |
| 2 | Nhập "20000", chạm "Gửi đề xuất". | Gửi được (hộp đóng, thẻ hiện "Bạn đã đề xuất 20.000đ…" - tiếp nối TC-FLOW-007). Nếu không muốn tiếp tục, chạm "Quay lại" ở bước trước. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Quán từ chối đề xuất hoặc hủy yêu cầu giao.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (_FeeProposalDialog)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m07_views_test.dart; tests/integration/m06-shipping-fee-agreement.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-034 · Quán hủy yêu cầu giao khi chưa có shipper nhận

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #146 (trong ngày: 26) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Hủy yêu cầu giao phải có lý do và dừng việc tìm shipper; không ảnh hưởng đơn món (nếu có). |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có một yêu cầu giao đang "Đang tìm shipper"; Điện thoại 3 có SP-A online (nếu đủ điều kiện) để kiểm tra thẻ biến mất. |
| Dữ liệu nhập | Lý do: "Khách đổi ý (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở yêu cầu giao, chạm "Hủy yêu cầu giao". | Hộp "Hủy yêu cầu giao?" nói "Yêu cầu giao sẽ kết thúc, shipper (nếu đã nhận) được giải phóng và hệ thống ngừng tìm. Không tự hủy đơn món." và yêu cầu "Lý do hủy". |
| 2 | Nhập lý do, chạm "Xác nhận hủy". | Yêu cầu chuyển sang "Đã hủy yêu cầu giao" trong nhóm "Không thành công / Đã hủy". |
| 3 | Trên máy shipper mở "Đơn hàng" > "Có thể nhận". | Thẻ đơn đã biến mất (không còn nhận được); không có shipper nào bị giữ tiền. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (m07-cancel); apps/backend/src/delivery/delivery-cancel.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-035 · Danh sách "Giao hàng" của quán: lọc theo trạng thái và tìm theo mã

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #147 (trong ngày: 27) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán theo dõi yêu cầu giao theo nhóm trạng thái. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán đã có vài yêu cầu giao ở trạng thái khác nhau. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Đơn hàng" > "Giao hàng". | Có các nhãn "Tất cả", "Đang tìm shipper", "Shipper đã nhận", "Đang giao", "Hoàn thành", "Không thành công / Đã hủy". |
| 2 | Chạm từng nhãn. | Danh sách chỉ hiện yêu cầu thuộc nhóm đó; mỗi thẻ có mã G-…, tên người nhận, hàng, phí giao và người trả phí. |
| 3 | Gõ một mã giao vào ô tìm kiếm. | Chỉ còn đúng yêu cầu đó. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (nhãn lọc dòng 55-60)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-007 · Danh sách "Có thể nhận": thông tin thấy và không thấy trước khi nhận đơn

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #148 (trong ngày: 28) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Bảo vệ riêng tư của khách: trước khi nhận, shipper chỉ biết khu vực, quán, phí; không biết số điện thoại và địa chỉ chi tiết. |
| Người thực hiện | Shipper + Quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031, TC-WAL-005 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt); GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | SP-A online, đủ điều kiện. Quán gọi shipper cho một đơn (ORDER hoặc DIRECT) và đơn đang "Đang tìm shipper". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 3 (máy SHIPPER) chạm tab "Đơn hàng" rồi chạm "Có thể nhận". | Thấy thẻ đơn mới của quán: tên quán, khu vực lấy/giao, phí giao, người trả phí và nút "Nhận đơn". KHÔNG thấy số điện thoại người nhận và địa chỉ chi tiết. |
| 2 | Đọc thẻ đơn. | Có: tên quán, "Khu vực lấy hàng", "Khu vực giao", khoảng cách đến quán, giá trị hàng, "Phí giao", "Người trả phí" ("Quán trả ship"/"Khách trả ship"), đồng hồ "Còn … phút". KHÔNG có số điện thoại người nhận, KHÔNG có địa chỉ giao chi tiết, KHÔNG có bản đồ theo dõi. |
| 3 | Chạm vào thẻ (nếu mở được chi tiết). | Chi tiết trước khi nhận vẫn không lộ số điện thoại/địa chỉ chi tiết. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu thấy số điện thoại hoặc địa chỉ chi tiết của khách trước khi nhận đơn. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Quán hủy yêu cầu giao nếu không dùng tiếp.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart; docs/current/M07-implementation-20261018.md mục 5 (offer)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-008 · Chỉ nhận được đơn trong bán kính 3 km quanh quán

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #149 (trong ngày: 29) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper ở xa quán hơn 3 km (đường chim bay) không thấy/không nhận được đơn. |
| Người thực hiện | Shipper + Quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Chuẩn bị trước, người mới tự làm |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt); GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Việc cần chuẩn bị trước | Người phụ trách xác nhận khu vực phục vụ (bán kính khoảng 10 km quanh TP Cao Bằng) và bạn hoặc người được nhờ đứng đúng vị trí mà test yêu cầu. KHÔNG dùng ứng dụng giả vị trí. Bạn đã làm xong các test ghi ở cột "Phụ thuộc" (dữ liệu từ test trước còn đó). |
| Phân công khi đang test | Sau khi chuẩn bị xong, người mới tự làm toàn bộ các bước. |
| Nếu thiếu điều kiện | Nếu phần chuẩn bị ở trên CHƯA xong: đánh dấu BLOCKED, ghi điều kiện còn thiếu vào Ghi chú kết quả, báo Người phụ trách và chuyển sang test kế tiếp. Không tự làm thay phần của kỹ thuật viên. |
| Điều kiện ban đầu | Quán Test A gọi shipper cho một đơn. SP-A đủ tiền, online, đang cách quán khoảng 4-5 km (đo bằng bản đồ khác). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần shipper thật đứng cách quán >3 km nhưng vẫn trong thành phố. Không dùng ứng dụng giả vị trí (ứng dụng cũng từ chối vị trí giả). Nếu không đứng xa được thì ghi BLOCKED. Chú ý: quy tắc 3 km do máy chủ kiểm. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper mở "Đơn hàng" > "Có thể nhận". | Không thấy đơn của Quán Test A (hoặc thấy nhưng không đủ điều kiện, nút "Nhận đơn" khóa kèm lý do ngoài vùng). |
| 2 | Shipper di chuyển vào trong bán kính 3 km quanh quán, chờ khoảng 1-2 phút để vị trí cập nhật rồi mở lại danh sách. | Đơn hiện ra, nhận được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Quán hủy yêu cầu giao.

**Căn cứ:** `docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md mục 1; apps/backend/src/shipping-policy/shipping-eligibility.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-eligibility.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-009 · Shipper nhận đơn

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #150 (trong ngày: 30) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nhận đơn là shipper nhận việc (chưa cầm hàng): thông tin đầy đủ hiện ra, hoa hồng được giữ chỗ trong ví. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-007 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có thẻ đơn trong "Có thể nhận". Ghi lại số dư ví khả dụng TRƯỚC khi nhận (B0). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Nhận đơn". | Đơn chuyển sang "Đang thực hiện" với trạng thái "Đã nhận đơn"/"Shipper đã nhận". Hiện "Quán lấy hàng" (tên, địa chỉ, số điện thoại quán), "Người nhận", "Địa chỉ", "Điện thoại", "Phí giao". |
| 2 | Mở "Ví của tôi". | "Số dư khả dụng" giảm đúng bằng hoa hồng một đơn (mặc định 1.000đ) vì tiền được "tạm giữ" ("Tiền tạm giữ"), "Tổng số dư" chưa đổi. |
| 3 | Đọc nút trong chi tiết đơn. | Có "Đã nhận hàng", "Hủy nhận đơn"; có "Đề xuất mức phí khác" nếu phí chưa khóa. KHÔNG có nút "Giao thất bại". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Hủy nhận đơn nếu muốn trả lại (TC-DRV-012).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart; docs/current/M07-owner-delivery-flow-20261023.md mục I`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m04-wallet-holds.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-017 · Đơn DIRECT: shipper giao theo địa chỉ mô tả, không cần ghim điểm giao

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #151 (trong ngày: 31) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Với đơn quán tự gọi, shipper dùng địa chỉ mô tả và liên hệ người nhận; không bị bắt ghim bản đồ. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031 |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Đơn DIRECT đã được SP-A nhận. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn trong "Đang thực hiện". | Có dòng "Giao theo địa chỉ mô tả, không cần ghim điểm giao." và hiện địa chỉ mô tả, tên và số điện thoại người nhận. |
| 2 | Chạm "Đã nhận hàng" (không có bước ghim điểm giao). | Chỉ một bước xác nhận như đơn thường; không bị yêu cầu "Xác nhận điểm giao và phí". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart; docs/current/M07-owner-delivery-flow-20261023.md mục III, IV`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-018 · Xem vị trí quán/người nhận trên bản đồ của shipper

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #152 (trong ngày: 32) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper xem được điểm quán (và điểm giao nếu đơn có ghim) trên bản đồ offline Cao Bằng. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | SP-A đã nhận một đơn ORDER có ghim điểm giao. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chỉ có khi APK 11Ship được build kèm gói bản đồ Cao Bằng (cờ M14_OFFLINE_MAP). Hãy hỏi Người phụ trách. Không có bản đồ thì ghi NOT READY/BLOCKED, không phải lỗi nếu ứng dụng nói rõ "Bản cài này chưa bật gói bản đồ". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn, tìm phần bản đồ ("Bản đồ giao hàng"). | Có bản đồ với ghim "Quán" và "Giao" (nếu đơn có ghim); hoặc dòng "Chưa có ghim điểm giao nên chưa vẽ được bản đồ." |
| 2 | Ở Trang chủ chạm "Về vị trí hiện tại". | Bản đồ về vị trí của shipper (chấm "Vị trí của bạn"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/ship/lib/ship_home.dart (home-recenter, M14OfflineMap); mobile/ship/lib/ship_m07.dart (kM14Map)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_m14_map/test/m14_map_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-012 · Shipper hủy nhận đơn trước khi lấy hàng (có lý do)

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #153 (trong ngày: 33) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu không đi được, shipper trả đơn; chỉ hủy lượt nhận của mình, đơn gốc và hoa hồng không bị mất. |
| Người thực hiện | Shipper (SP-A) + Quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-009 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đã nhận đơn nhưng CHƯA bấm "Đã nhận hàng". Ghi số dư khả dụng hiện tại (đang bị tạm giữ). |
| Dữ liệu nhập | Lý do: chọn "Thời tiết xấu" hoặc lý do khác trong danh sách; nếu chọn "Khác" phải ghi ghi chú. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong chi tiết đơn chạm "Hủy nhận đơn". | Hộp "Hủy nhận đơn?" nói "Bạn sẽ không còn giữ đơn này. Hệ thống tìm shipper khác theo thời hạn còn lại." và yêu cầu chọn lý do. |
| 2 | Chọn lý do rồi chạm "Xác nhận hủy". | Đơn rời khỏi "Đang thực hiện"; trong "Lịch sử" ghi "Bạn đã hủy nhận". |
| 3 | Mở "Ví của tôi". | Số tiền tạm giữ được giải phóng; số dư khả dụng trở về như trước khi nhận. Tổng số dư KHÔNG đổi. |
| 4 | Quán xem đơn. | Đơn quay về "Đang tìm shipper" (không bị hủy), không còn tên SP-A. |
| 5 | Shipper khác (hoặc chính SP-A) mở "Có thể nhận". | Đơn nhận lại được (trong thời hạn tìm còn lại, đồng hồ 30 phút KHÔNG bị tính lại). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (Hủy nhận đơn); apps/backend/src/delivery/delivery-handback.ts; docs/current/M07-owner-delivery-flow-20261023.md mục I`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-013 · Shipper bấm "Đã nhận hàng": một bước xác nhận, phí bị khóa

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #154 (trong ngày: 34) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đã nhận hàng nghĩa là shipper đã cầm hàng ở quán: từ đây phí khóa, không hủy nhận được. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-009 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | SP-A đã nhận đơn, phí đã chốt (theo bảng giá). Quán đã chuẩn bị hàng. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở đơn trong "Đang thực hiện", chạm "Đã nhận hàng". | Hộp thoại "Xác nhận đã nhận hàng?" giải thích phí sẽ bị khóa và không hủy nhận được nữa. |
| 2 | Chạm xác nhận trong hộp thoại. | Đơn chuyển sang trạng thái "Đã lấy hàng"/"Đang giao". Chỉ còn nút "Giao thành công" (không còn "Hủy nhận đơn" và không có nút "Giao thất bại"). |
| 3 | Xem phần phí trong chi tiết đơn. | Phí hiển thị là "Phí đã khóa"; không còn nút "Đề xuất mức phí khác". |
| 4 | Nhìn danh sách nút. | Chỉ còn "Giao thành công" (và gọi/liên hệ quán, người nhận). KHÔNG còn "Hủy nhận đơn", KHÔNG có "Giao thất bại". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (m07-pickup, m07-complete); docs/current/M07-owner-delivery-flow-20261023.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-015 · Sau khi đã lấy hàng shipper không có nút hủy hoặc "Giao thất bại"

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #155 (trong ngày: 35) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quy tắc của Owner: sau khi lấy hàng, shipper chỉ có thể hoàn thành giao hàng; không giao được thì gọi quán thống nhất, chỉ người tạo đơn mới hủy. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-013 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một đơn ở trạng thái "Đang giao". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn, xem hết màn hình (cuộn xuống cuối). | Chỉ có nút "Giao thành công". KHÔNG có "Hủy nhận đơn", "Hủy đơn", "Giao thất bại", "Bỏ đơn". |
| 2 | Đọc dòng hướng dẫn. | Có câu "Chỉ cần bấm "Giao thành công" khi đã giao xong. Nếu không giao được, hãy gọi quán để thống nhất; chỉ người tạo đơn mới hủy được." |
| 3 | [CHỈ KỸ THUẬT VIÊN - người mới bỏ qua] Kỹ thuật viên thử gửi trực tiếp lệnh hủy/giao thất bại của shipper tới máy chủ. | Máy chủ từ chối lệnh (kỹ thuật viên ghi mã lỗi vào Ghi chú kết quả). Nếu không có kỹ thuật viên: bỏ bước này, ghi "bỏ qua bước 3"; không ảnh hưởng PASS/FAIL. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục I, VII; mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (kReleaseExplain)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-014 · Shipper giao thành công: hoa hồng thu đúng một lần

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #156 (trong ngày: 36) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Hoàn thành đơn thì ví bị trừ đúng hoa hồng một lần, đơn kết thúc và vào lịch sử. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-013 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| **Có thể chặn thử nghiệm bên ngoài** | Giao dịch tài chính (ví, nạp, rút, hoa hồng): Sai số dư, tạm giữ, cộng/trừ trùng hoặc rút nhầm là lỗi NGHIÊM TRỌNG. Chỉ chạy bằng tiền thử nghiệm đã được Owner duyệt (HUONG_DAN mục 7). |
| Điều kiện ban đầu | Đơn đang "Đang giao". Ghi: Tổng số dư B1 và số dư khả dụng A1 trước khi bấm. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Giao thành công". | Hộp thoại "Giao thành công?" với nội dung "Xác nhận đã giao hàng cho người nhận. Hoa hồng sẽ được thu một lần khi hoàn tất." |
| 2 | Chạm "Giao thành công" trong hộp thoại. | Đơn chuyển vào "Lịch sử" của shipper với trạng thái hoàn thành. |
| 3 | Mở "Ví của tôi" > "Lịch sử giao dịch". | Có đúng MỘT dòng "Hoa hồng" mới, số tiền = hoa hồng đang áp dụng (mặc định 1.000đ). Tổng số dư = B1 - hoa hồng. Tiền tạm giữ của đơn này về 0. |
| 4 | Mở tab "Đơn hàng" > "Lịch sử". | Đơn hiện ở lịch sử, trạng thái hoàn thành. |
| 5 | Thử mở lại đơn và tìm nút bấm. | Không còn nút nào để hoàn thành lần nữa. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu hoa hồng bị trừ 0 lần hoặc nhiều hơn 1 lần. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart; docs/current/ADR-004-driver-wallet-consistency.md; apps/backend/src/delivery`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m04-wallet-holds.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-016 · Lịch sử đơn của shipper

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #157 (trong ngày: 37) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper xem lại đơn đã giao, đã hủy nhận, bị admin gỡ… |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A có ít nhất 1 đơn hoàn thành và 1 đơn đã hủy nhận. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Đơn hàng" > "Lịch sử". | Danh sách đơn đã kết thúc, mỗi dòng có kết quả: hoàn thành / "Bạn đã hủy nhận" / "Quán đã hủy yêu cầu giao" / "Admin đã gỡ bạn khỏi đơn" / "Hệ thống hủy quá hạn" / "Phí không được đồng ý". |
| 2 | Mở một đơn đã hoàn thành. | Chi tiết có địa chỉ, phí, "Hoa hồng đã được thu theo quy định ví. Tiền hàng và phí giao do các bên giao nhận trực tiếp." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (own_outcome chips)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-010 · Hai shipper bấm nhận cùng một đơn: chỉ một người nhận được

**Mức độ:** P0 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #158 (trong ngày: 38) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Không giao trùng một đơn cho hai shipper; người thua không bị giữ tiền. |
| Người thực hiện | Hai shipper (SP-A, SP-B) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | SP-A (Điện thoại 3) và SP-B (Điện thoại 1, 11Ship) đều đủ tiền, online, trong 3 km. Một đơn đang tìm shipper. Ghi số dư khả dụng của cả hai trước test. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | SP-B cần đã được nạp tiền (sau khi xong các test "không đủ tiền"). Cần hai điện thoại: bấm "Nhận đơn" gần như cùng lúc (đếm 1-2-3). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Cả hai mở "Đơn hàng" > "Có thể nhận" và thấy cùng thẻ đơn. | Hai máy cùng thấy thẻ đơn. |
| 2 | Hai người cùng đếm "1-2-3" và bấm "Nhận đơn" cùng lúc. | Chỉ MỘT máy nhận được ("Đang thực hiện"). Máy kia báo đơn không còn nhận được: "Đơn này không còn có thể nhận" (hoặc thẻ biến mất). |
| 3 | Kiểm tra ví hai người. | Chỉ người nhận được bị tạm giữ hoa hồng; người không nhận được KHÔNG bị tạm giữ, số dư khả dụng không đổi. |
| 4 | Quán xem đơn. | Chỉ hiện MỘT shipper (đúng người nhận được). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu cả hai cùng được ghi nhận nhận đơn hoặc người thua bị giữ tiền. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `apps/backend/src/delivery (accept dưới khóa); docs/current/M07-implementation-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts (đua nhận đơn)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-001 · Đơn khách đặt qua 11Food - quán TRẢ phí giao - giao thành công (luồng chuẩn)

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #159 (trong ngày: 39) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG · **Smoke #23**

| Mục | Nội dung |
|---|---|
| Mục đích | Kiểm tra trọn vẹn hành trình quan trọng nhất: khách đặt món -> quán xác nhận -> quán gọi shipper -> shipper nhận, lấy hàng, giao -> ví shipper trừ hoa hồng đúng một lần. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-009, TC-SHOP-012, TC-WAL-005 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; Tiền thử nghiệm trong ví shipper (Owner duyệt); GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Quán Test A đang mở, có món và phí giao tính được (bảng phí đã áp dụng). KH-A có địa chỉ đã lưu (có ghim). SP-A đã đăng nhập 11Ship trên Điện thoại 3, ví ĐỦ TIỀN (đã nạp xác nhận ít nhất mức nạp tối thiểu và số dư khả dụng lớn hơn hoa hồng một đơn; xem TC-WAL-005), đứng trong bán kính 3 km quanh Quán Test A, GPS bật. Ba điện thoại đã đăng nhập đúng tài khoản; CQ-A ở chế độ quản lý quán. |
| Dữ liệu nhập | Đơn: 2 phần "Bún chả Test" + 1 phần "Trà đá Test" (tiền món 95.000đ). Người trả phí: "Quán trả phí". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 (máy KHÁCH), mở 11Food (đang đăng nhập khách), tab "Trang chủ". Gõ "Quán Test A" vào ô "Tìm quán hoặc món" hoặc chọn quán trong "Quán gần bạn", chạm vào quán. | Trang quán hiện tên quán, giờ hoạt động và danh sách món có giá. |
| 2 | Chạm vào món "Bún chả Test", đặt Số lượng = 2, (có thể ghi chú "ít cay"), rồi chạm "Thêm vào giỏ · 90.000đ". Chạm món "Trà đá Test", số lượng 1, "Thêm vào giỏ · 5.000đ". | Thanh dưới cùng hiện "Xem giỏ · … món · 95.000đ" với tiền món đúng 95.000đ. |
| 3 | Chạm "Xem giỏ · …". | Màn "Giỏ hàng" liệt kê đúng: 2 phần "Bún chả Test" (45.000đ/phần) và 1 phần "Trà đá Test" (5.000đ); có dòng "Phí giao (dự tính)" và "Tổng dự kiến". Tiền món = 95.000đ. |
| 4 | Chạm nút "Tiếp tục · …" ở cuối màn hình giỏ. | Mở màn "Xác nhận đơn" gồm ô "Tên người nhận", "Số điện thoại người nhận", phần "Địa chỉ giao", "Giao sớm nhất"/"Hẹn giờ nhận món", "Ghi chú cho đơn", dòng "Thanh toán trực tiếp". |
| 5 | Điền "Tên người nhận" = Khách Test A, "Số điện thoại người nhận" = SĐT-KH-A. Chạm "Chọn từ sổ địa chỉ" và chọn "địa chỉ nhà KH-A đã lưu ở TC-CUS-022" (nếu chưa có: "Địa chỉ khác" rồi nhập địa chỉ và "Dùng vị trí hiện tại" nếu có). | Các ô đã điền; địa chỉ đã chọn hiện đúng. |
| 6 | Chạm nút "Gửi đơn · …". | Hiện thông báo xanh "Đã gửi đơn" (nội dung "Đơn đang chờ quán xác nhận. Bạn hủy được cho đến khi quán xác nhận."), mở chi tiết đơn có mã đơn (dạng "Đơn …") và trạng thái "Chờ quán xác nhận". Ghi lại mã đơn. |
| 7 | Trên Điện thoại 2 (máy QUÁN) (chủ quán, đang ở chế độ quản lý quán), mở tab "Đơn hàng", chọn "Đơn món". Chạm vào đơn có trạng thái "Chờ xác nhận" đúng mã đơn vừa ghi. | Đơn mới hiện ở đầu danh sách; chi tiết đơn có đủ món, số lượng, tiền món, tên và số điện thoại người nhận. |
| 8 | Chạm "Xác nhận đơn". | Đơn chuyển sang "Đang chuẩn bị". Không còn nút "Xác nhận đơn". Có nút "Gọi shipper". |
| 9 | Trên Điện thoại 2 (máy QUÁN), trong chi tiết đơn đang "Đang chuẩn bị", chạm "Gọi shipper". | Hộp thoại "Gọi shipper" hỏi "Ai trả phí giao? ..." với hai nút "Khách trả phí" và "Quán trả phí". KHÔNG có bước/nút "Món đã sẵn sàng" riêng. |
| 10 | Chạm "Quán trả phí". | Đơn hiện phần giao hàng với trạng thái "Đang tìm shipper"; hiện phí giao theo bảng giá và người trả phí đúng như đã chọn; có đồng hồ/ghi chú thời gian tìm shipper. |
| 11 | Trên Điện thoại 3 (SP-A) chạm "Bật online" nếu chưa bật; ghi lại Tổng số dư và Số dư khả dụng trong "Ví của tôi" (B0, A0). | SP-A online, đang chia sẻ vị trí. Ghi B0 và A0. |
| 12 | Trên Điện thoại 3 chạm tab "Đơn hàng" > "Có thể nhận". | Thấy thẻ đơn của Quán Test A: phí giao theo bảng giá và "Quán trả ship". KHÔNG thấy số điện thoại và địa chỉ chi tiết của KH-A. |
| 13 | Chạm "Nhận đơn". | Đơn sang "Đang thực hiện"; hiện địa chỉ và số điện thoại quán, thông tin người nhận. Ví: số dư khả dụng giảm đúng hoa hồng (tạm giữ), Tổng số dư vẫn B0. |
| 14 | Trên máy khách mở chi tiết đơn; trên máy quán mở chi tiết đơn. | Cả hai thấy shipper đã nhận (khách: "Shipper đang đến quán"; quán: "Shipper đã nhận") kèm tên shipper và biển số/số điện thoại. KHÔNG có bước "Món đã sẵn sàng". |
| 15 | Trên Điện thoại 3 mở đơn, chạm "Đã nhận hàng" rồi xác nhận. | Đơn sang "Đã lấy hàng/Đang giao"; chỉ còn nút "Giao thành công". Khách thấy "Đang giao"; quán thấy "Đang giao". |
| 16 | Trên Điện thoại 3 chạm "Giao thành công" rồi xác nhận. | Đơn kết thúc. Khách thấy "Hoàn thành"; quán thấy đơn "Hoàn thành" trong lịch sử. |
| 17 | Trên Điện thoại 3 mở "Ví của tôi". | Tổng số dư = B0 - hoa hồng (mặc định 1.000đ); số dư khả dụng = A0 - hoa hồng; có đúng MỘT dòng "Hoa hồng" mới; không còn tiền tạm giữ của đơn này. |
| 18 | Trên máy khách kiểm tra mục đánh giá trong chi tiết đơn đã hoàn thành. | Có thẻ "Đánh giá và phản ánh" (đánh giá quán, đánh giá shipper, gửi phản ánh). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu: đơn bị tạo trùng; hoa hồng trừ sai số lần/số tiền; thông báo sai người; shipper nhận được thông tin chi tiết của khách trước khi nhận. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ. Đơn đã hoàn thành nên không cần hủy. Nạp thêm tiền cho SP-A nếu số dư khả dụng xuống dưới mức nhận đơn.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục II; apps/backend/src/orders, apps/backend/src/delivery; mobile m10/m07 views`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts; m04-wallet-holds.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-002 · Đơn khách đặt qua 11Food - KHÁCH trả phí giao - giao thành công

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #160 (trong ngày: 40) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Khi khách trả phí, phí tính theo bảng giá thì không cần ai đồng ý thêm; thông tin người trả phí hiện đúng cho cả ba bên. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Như TC-FLOW-001. |
| Dữ liệu nhập | Giống TC-FLOW-001 nhưng chọn "Khách trả phí" khi gọi shipper. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 (máy KHÁCH), mở 11Food (đang đăng nhập khách), tab "Trang chủ". Gõ "Quán Test A" vào ô "Tìm quán hoặc món" hoặc chọn quán trong "Quán gần bạn", chạm vào quán. | Trang quán hiện tên quán, giờ hoạt động và danh sách món có giá. |
| 2 | Chạm vào món "Bún chả Test", đặt Số lượng = 2, (có thể ghi chú "ít cay"), rồi chạm "Thêm vào giỏ · 90.000đ". Chạm món "Trà đá Test", số lượng 1, "Thêm vào giỏ · 5.000đ". | Thanh dưới cùng hiện "Xem giỏ · … món · 95.000đ" với tiền món đúng 95.000đ. |
| 3 | Chạm "Xem giỏ · …". | Màn "Giỏ hàng" liệt kê đúng: 2 phần "Bún chả Test" (45.000đ/phần) và 1 phần "Trà đá Test" (5.000đ); có dòng "Phí giao (dự tính)" và "Tổng dự kiến". Tiền món = 95.000đ. |
| 4 | Chạm nút "Tiếp tục · …" ở cuối màn hình giỏ. | Mở màn "Xác nhận đơn" gồm ô "Tên người nhận", "Số điện thoại người nhận", phần "Địa chỉ giao", "Giao sớm nhất"/"Hẹn giờ nhận món", "Ghi chú cho đơn", dòng "Thanh toán trực tiếp". |
| 5 | Điền "Tên người nhận" = Khách Test A, "Số điện thoại người nhận" = SĐT-KH-A. Chạm "Chọn từ sổ địa chỉ" và chọn "địa chỉ nhà KH-A đã lưu ở TC-CUS-022" (nếu chưa có: "Địa chỉ khác" rồi nhập địa chỉ và "Dùng vị trí hiện tại" nếu có). | Các ô đã điền; địa chỉ đã chọn hiện đúng. |
| 6 | Chạm nút "Gửi đơn · …". | Hiện thông báo xanh "Đã gửi đơn" (nội dung "Đơn đang chờ quán xác nhận. Bạn hủy được cho đến khi quán xác nhận."), mở chi tiết đơn có mã đơn (dạng "Đơn …") và trạng thái "Chờ quán xác nhận". Ghi lại mã đơn. |
| 7 | Trên Điện thoại 2 (máy QUÁN) (chủ quán, đang ở chế độ quản lý quán), mở tab "Đơn hàng", chọn "Đơn món". Chạm vào đơn có trạng thái "Chờ xác nhận" đúng mã đơn vừa ghi. | Đơn mới hiện ở đầu danh sách; chi tiết đơn có đủ món, số lượng, tiền món, tên và số điện thoại người nhận. |
| 8 | Chạm "Xác nhận đơn". | Đơn chuyển sang "Đang chuẩn bị". Không còn nút "Xác nhận đơn". Có nút "Gọi shipper". |
| 9 | Trên Điện thoại 2 (máy QUÁN), trong chi tiết đơn đang "Đang chuẩn bị", chạm "Gọi shipper". | Hộp thoại "Gọi shipper" hỏi "Ai trả phí giao? ..." với hai nút "Khách trả phí" và "Quán trả phí". KHÔNG có bước/nút "Món đã sẵn sàng" riêng. |
| 10 | Chạm "Khách trả phí". | Đơn hiện phần giao hàng với trạng thái "Đang tìm shipper"; hiện phí giao theo bảng giá và người trả phí đúng như đã chọn; có đồng hồ/ghi chú thời gian tìm shipper. |
| 11 | Trên Điện thoại 3 (SP-A) chạm "Bật online" nếu chưa bật; ghi lại Tổng số dư và Số dư khả dụng trong "Ví của tôi" (B0, A0). | SP-A online, đang chia sẻ vị trí. Ghi B0 và A0. |
| 12 | Trên Điện thoại 3 chạm tab "Đơn hàng" > "Có thể nhận". | Thấy thẻ đơn của Quán Test A: phí giao theo bảng giá và "Khách trả ship". KHÔNG thấy số điện thoại và địa chỉ chi tiết của KH-A. |
| 13 | Chạm "Nhận đơn". | Đơn sang "Đang thực hiện"; hiện địa chỉ và số điện thoại quán, thông tin người nhận. Ví: số dư khả dụng giảm đúng hoa hồng (tạm giữ), Tổng số dư vẫn B0. |
| 14 | Trên máy khách mở chi tiết đơn; trên máy quán mở chi tiết đơn. | Cả hai thấy shipper đã nhận (khách: "Shipper đang đến quán"; quán: "Shipper đã nhận") kèm tên shipper và biển số/số điện thoại. KHÔNG có bước "Món đã sẵn sàng". |
| 15 | Trên Điện thoại 3 mở đơn, chạm "Đã nhận hàng" rồi xác nhận. | Đơn sang "Đã lấy hàng/Đang giao"; chỉ còn nút "Giao thành công". Khách thấy "Đang giao"; quán thấy "Đang giao". |
| 16 | Trên Điện thoại 3 chạm "Giao thành công" rồi xác nhận. | Đơn kết thúc. Khách thấy "Hoàn thành"; quán thấy đơn "Hoàn thành" trong lịch sử. |
| 17 | Trên Điện thoại 3 mở "Ví của tôi". | Tổng số dư = B0 - hoa hồng (mặc định 1.000đ); số dư khả dụng = A0 - hoa hồng; có đúng MỘT dòng "Hoa hồng" mới; không còn tiền tạm giữ của đơn này. |
| 18 | Trên máy khách kiểm tra mục đánh giá trong chi tiết đơn đã hoàn thành. | Có thẻ "Đánh giá và phản ánh" (đánh giá quán, đánh giá shipper, gửi phản ánh). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục II; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-003 · Quán chủ động gọi shipper (DIRECT) - quán trả phí - giao thành công

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #161 (trong ngày: 41) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG · **Smoke #25**

| Mục | Nội dung |
|---|---|
| Mục đích | Luồng thứ hai: quán gọi shipper giao một món không qua 11Food; không cần GPS điểm giao, không theo dõi hành trình. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-031, TC-WAL-005 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; Tiền thử nghiệm trong ví shipper (Owner duyệt); GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | CQ-A ở chế độ quản lý quán. SP-A đã đăng nhập 11Ship trên Điện thoại 3, ví ĐỦ TIỀN (đã nạp xác nhận ít nhất mức nạp tối thiểu và số dư khả dụng lớn hơn hoa hồng một đơn; xem TC-WAL-005), đứng trong bán kính 3 km quanh Quán Test A, GPS bật. |
| Dữ liệu nhập | Như TC-SHOP-031: người nhận "Người Nhận Test", SĐT-NHẬN, địa chỉ mô tả, hàng "1 hộp bánh Test", giá trị hàng 100000, "Quán trả", "Theo bảng giá" + một mốc quãng đường. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán: tab "Đơn hàng" > "Giao hàng" > "Gọi shipper", nhập "Tên người nhận" = Người Nhận Test, số điện thoại người nhận SĐT-NHẬN, địa chỉ giao (mô tả) "Số 20 đường Test, tổ 5, phường Test - cạnh cửa hàng tạp hóa", mô tả hàng "1 hộp bánh Test", giá trị hàng 100000, chọn "Quán trả", "Theo bảng giá" và một mốc ở "Chọn mốc quãng đường ước tính", chạm "Gọi shipper" và xác nhận "Gọi shipper?". | Yêu cầu giao tạo thành công ("Đang tìm shipper"), có mã "G-…" và phí đúng mốc đã chọn. |
| 2 | Shipper: ghi B0, A0 trong ví; chạm "Bật online" (nếu chưa), vào "Đơn hàng" > "Có thể nhận". | Thấy thẻ đơn: tên quán, khu vực giao (mô tả), phí giao, "Quán trả ship". Không thấy số điện thoại/địa chỉ chi tiết. |
| 3 | Shipper chạm "Nhận đơn". | Sang "Đang thực hiện"; thấy địa chỉ mô tả, tên, số điện thoại người nhận; có dòng "Giao theo địa chỉ mô tả, không cần ghim điểm giao.". Hoa hồng được tạm giữ. |
| 4 | Chủ quán mở yêu cầu giao. | Thấy "Shipper đã nhận" cùng tên, số điện thoại, biển số shipper. KHÔNG có bản đồ theo dõi hành trình (quán chỉ theo dõi trạng thái). |
| 5 | Shipper chạm "Đã nhận hàng", xác nhận. | Trạng thái "Đang giao"; quán thấy "Đang giao". |
| 6 | Shipper chạm "Giao thành công", xác nhận. | Quán thấy "Hoàn thành". Shipper thấy đơn trong "Lịch sử". |
| 7 | Shipper mở "Ví của tôi". | Tổng số dư = B0 - hoa hồng; đúng MỘT dòng "Hoa hồng" mới. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần (đơn đã hoàn thành). Nếu dừng giữa chừng: quán "Hủy yêu cầu giao" (trước lấy hàng).

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục III; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart; mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-004 · Quán gọi shipper (DIRECT) - KHÁCH trả phí (khách không có tài khoản 11Food) - giao thành công

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #162 (trong ngày: 42) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi người nhận không dùng 11Food nhưng là người trả phí, mức phí theo bảng giá vẫn đi tiếp bình thường; shipper thấy "Khách trả ship". |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-003 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Như TC-FLOW-003. |
| Dữ liệu nhập | Như TC-FLOW-003 nhưng chọn "Khách trả" và "Theo bảng giá". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán tạo yêu cầu giao DIRECT với "Khách trả", "Theo bảng giá" + mốc, chạm "Gọi shipper". | Tạo thành công; hiện "Khách trả ship". Không yêu cầu ai xác nhận thêm vì phí đúng bảng giá. |
| 2 | Shipper mở "Có thể nhận". | Thẻ hiện "Khách trả ship" và nút "Nhận đơn" bấm được. |
| 3 | Shipper nhận, lấy hàng, giao thành công. | Các trạng thái chuyển đúng như TC-FLOW-003; hoa hồng thu một lần. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục III.5; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-030 · Xem hộp thông báo và cài đặt thông báo của chủ quán

**Mức độ:** P1 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #163 (trong ngày: 43) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chủ quán xem được thông báo đơn mới và chỉnh âm thanh/nhóm thông báo. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đã có vài thông báo (đơn mới, nhắc…). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Trang chủ 11Food chạm biểu tượng chuông "Thông báo". | Mở hộp thông báo, có nhãn "Tất cả" và "Chưa đọc (n)". |
| 2 | Chạm một thông báo về đơn. | Mở đúng đơn đó (đúng mã đơn), không mở đơn khác. |
| 3 | Chạm "Đánh dấu tất cả đã đọc". | Số chưa đọc về 0; hiện "Bạn đã đọc hết thông báo." hoặc "Không có thông báo chưa đọc". |
| 4 | Vào Tài khoản > "Cài đặt thông báo". | Màn có nhóm "Nhận thông báo về" (ví dụ "Đơn hàng và giao hàng") và mục "Âm thanh". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m08/m08_views.dart; mobile/food/lib/food_tabs.dart (foodNotificationRouter)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts; mobile/packages/n11_shared/test/m08_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-023 · Thông báo trong 11Ship và cài đặt "Đơn có thể nhận"

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #164 (trong ngày: 44) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper xem hộp thông báo và tắt/bật nhóm thông báo, âm thanh. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Thông báo đẩy (Firebase) nếu muốn kiểm push |
| Điều kiện ban đầu | SP-A đăng nhập, có vài thông báo. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm tab "Thông báo". | Hiện danh sách; nếu trống: "Chưa có thông báo". Có "Tất cả"/"Chưa đọc". |
| 2 | Tab "Tài khoản" > "Cài đặt thông báo". | Màn có "Đơn có thể nhận" (nhóm "Dành cho shipper"), "Đơn hàng và giao hàng", "Ví và hồ sơ", công tắc "Âm thanh". Có lời "Tắt âm thanh không làm tắt nhận đơn." |
| 3 | Tắt nhóm "Đơn có thể nhận" rồi lưu. | Lưu thành công; ghi nhận: thông báo vẫn vào hộp thư nhưng không đẩy lên màn hình khóa. |
| 4 | Bật lại nhóm đó. | Lưu thành công; nhóm "Đơn có thể nhận" đang bật như ban đầu. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Bật lại nhóm "Đơn có thể nhận".

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m08/m08_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts; mobile/packages/n11_shared/test/m08_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-021 · Danh sách và chi tiết "Đơn hàng" trên Web Admin

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #165 (trong ngày: 45) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin tra cứu mọi đơn món theo mã, người nhận, trạng thái, quán, ngày; chi tiết có bản gốc và bản chốt. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Có vài đơn ở các trạng thái khác nhau. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Đơn hàng". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Gõ mã đơn vào "Tìm theo mã đơn hoặc người nhận", rồi thử lọc "Từ ngày"/"Đến ngày" và trạng thái. | Kết quả khớp bộ lọc. |
| 3 | Mở "Chi tiết đơn hàng" của đơn từng chỉnh (TC-SHOP-024). | Thấy "Tiền món (khách đặt)" và "Tiền món (hiện tại)", món "Quán đã sửa", lý do chỉnh, các lần gọi shipper và diễn biến. |
| 4 | Tìm dòng thanh toán. | Có thể hiện "Khách đã trả"/"Còn phải thu" trong dữ liệu quản trị (ghi nhận hiện trạng; app khách/quán đã bỏ các dòng này). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/orders-view.ts; docs/current/M10-implementation-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-admin-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-023 · Danh sách và chi tiết "Giao hàng" trên Web Admin (kể cả vị trí shipper)

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #166 (trong ngày: 46) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin theo dõi toàn bộ yêu cầu giao: trạng thái, người nhận, phí, shipper, vị trí mới nhất kèm độ cũ. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Có yêu cầu giao ở nhiều trạng thái; một shipper đang giữ đơn và đang bật chia sẻ vị trí. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Giao hàng". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Xem bộ đếm "Tổng quan giao hàng" và lọc theo nhóm "Đang tìm", "Đang giao", "Cần xử lý". | Các bộ đếm khớp danh sách lọc. |
| 3 | Mở "Chi tiết giao hàng" của yêu cầu có shipper giữ đơn. | Thấy mã, nguồn (đơn/trực tiếp), quán, người nhận, "Phí giao", "Chế độ phí", "Người trả phí", shipper, "Hoa hồng đã chốt", và phần vị trí với giờ cập nhật; nếu quá cũ có "GPS cũ: vị trí này không còn là trực tiếp". |
| 4 | Mở yêu cầu đã kết thúc. | Nói rõ "Yêu cầu giao không còn ở giai đoạn đang giao nên không theo dõi vị trí." (không còn vị trí). |
| 5 | Với yêu cầu DIRECT: nhìn thông tin người nhận/điện thoại. | Hiển thị theo quyền ("Ẩn: tài khoản này không có quyền xem liên hệ" với ADMIN thiếu quyền). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/deliveries-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts (admin); admin-web tests

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-017 · Danh sách và chi tiết shipper trên Web Admin

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #167 (trong ngày: 47) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin xem thông tin shipper (mã, họ tên, số điện thoại, biển số, ví, trạng thái hoạt động). |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SP-A, SP-B đã đăng ký. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Shipper". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Tìm SP-A bằng họ tên hoặc số điện thoại ("Tìm theo họ tên, số điện thoại hoặc mã Shipper"). | Danh sách chỉ còn đúng SP-A. |
| 3 | Mở chi tiết. | Thấy trạng thái hoạt động (đang hoạt động), "Nhận đơn" Đang bật/Đang tắt, thông tin ngân hàng ("Chưa có" nếu chưa nhập), biển số, "Đủ điều kiện bật". Số điện thoại hiển thị theo quyền. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Khi FAIL: lập báo lỗi theo BAO_CAO_LOI_MAU.md (ghi mã test, số bước, kết quả thật, ảnh/video). Muốn chạy lại: làm theo mục "Cách khôi phục để chạy lại" rồi bắt đầu từ bước 1.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/shippers-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts; admin-shippers-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---
