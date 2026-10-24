# Ngày 5 - Ví, quản trị, đối chiếu kết quả và nghiệm thu

Tài liệu này là bản ĐỌC ĐƯỢC của các test case trong file `TESTCASE_11SHIP.csv` (cùng nội dung). Làm lần lượt từ trên xuống dưới vì các test sau dùng dữ liệu của test trước.
Trước khi bắt đầu: đọc `HUONG_DAN_KIEM_THU_11SHIP.md` (nhất là mục chuẩn bị tài khoản, tiền thử nghiệm và cách báo lỗi).

Tổng số test case trong ngày: **51** (P0: 10, P1: 35, P2: 6).

| # | Mã | Tên | Mức | Cần | Sẵn sàng |
|---|---|---|---|---|---|
| 1 | TC-WAL-011 | Lịch sử giao dịch: lọc "Nạp tiền", "Hoa hồng", "Tạm giữ" | P0 | 1 ĐT | SẴN SÀNG |
| 2 | TC-WAL-012 | Đối chiếu tay: tổng số dư = tổng các dòng giao dịch | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 3 | TC-WAL-013 | Ví không đủ tiền hoa hồng thì không nhận được đơn mới, nhưng đơn đang giao vẫn hoàn tất | P0 | 1 ĐT | SẴN SÀNG |
| 4 | TC-WAL-014 | Yêu cầu dừng hoạt động của shipper: tắt nhận đơn ngay, đơn đang giao vẫn hoàn tất | P1 | 1 ĐT | SẴN SÀNG |
| 5 | TC-WAL-015 | Rút toàn bộ số dư khi dừng hoạt động: Admin nhận xử lý và ghi nhận đã chuyển (tiền thử nghiệm) | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 6 | TC-FEED-001 | Khách đánh giá quán và shipper sau khi đơn hoàn thành | P1 | 1 ĐT | SẴN SÀNG |
| 7 | TC-ADM-019 | Hồ sơ shipper chờ duyệt / xác minh ngân hàng cũ: ghi nhận trạng thái thực tế | P1 | PC | CẦN XÁC MINH |
| 8 | TC-WAL-016 | Rút tiền: Admin nhập số tiền chuyển khác số yêu cầu thì không kết luận "đã chuyển đủ" | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 9 | TC-FEED-002 | Không đánh giá được khi đơn chưa hoàn thành hoặc khi không phải đơn của mình | P1 | 1 ĐT | SẴN SÀNG |
| 10 | TC-WAL-017 | Shipper hủy yêu cầu rút tiền khi còn "Chờ xử lý": tiền được giải phóng | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 11 | TC-FEED-003 | Khách gửi phản ánh về một đơn (có ảnh minh chứng) | P1 | 1 ĐT | SẴN SÀNG |
| 12 | TC-WAL-018 | Tài chính Admin: tổng quan, danh sách ví và giao dịch | P0 | PC | SẴN SÀNG |
| 13 | TC-FEED-004 | Chủ quán đánh giá shipper và phản hồi đánh giá của khách | P1 | 1 ĐT | SẴN SÀNG |
| 14 | TC-FEED-005 | Admin ẩn và khôi phục một đánh giá | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 15 | TC-FEED-006 | Admin xử lý phản ánh: tiếp nhận, yêu cầu bổ sung, kết luận, đóng | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 16 | TC-WAL-021 | SYSTEM đổi mức hoa hồng: chỉ áp dụng cho đơn nhận sau đó | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 17 | TC-FEED-007 | Bên liên quan giải trình và khách yêu cầu xem xét lại (trong 7 ngày, một lần) | P2 | 2 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 18 | TC-WAL-022 | SYSTEM đổi mức nạp/rút tối thiểu; ADMIN chỉ xem | P1 | PC | SẴN SÀNG |
| 19 | TC-FEED-008 | Ảnh minh chứng phản ánh: giới hạn số lượng, dung lượng và định dạng | P2 | 1 ĐT | SẴN SÀNG |
| 20 | TC-WAL-023 | Admin hoàn tất đóng tài khoản shipper chỉ khi đã tất toán | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 21 | TC-WAL-024 | Mất mạng hoặc bấm lặp khi tạo yêu cầu nạp/rút: không tạo trùng, không trừ hai lần | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 22 | TC-WAL-025 | Admin điều chỉnh tài chính từ phản ánh (thu thêm / hoàn hoa hồng) | P1 | 1 ĐT | CẦN XÁC MINH |
| 23 | TC-ADM-007 | Phân biệt quyền ADMIN và SYSTEM: ADMIN không vào được trang chỉ dành cho SYSTEM | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 24 | TC-ADM-008 | ADMIN-2 (chỉ quyền Xem Quán) không thao tác được các hành động cần quyền cao hơn | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 25 | TC-WAL-019 | Phân quyền tài chính: ADMIN không có quyền thì không thấy hoặc không thao tác được | P0 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 26 | TC-ADM-009 | SYSTEM cấp và thu hồi quyền của ADMIN; hiệu lực ở thao tác kế tiếp | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 27 | TC-ADM-010 | SYSTEM khóa và mở khóa tài khoản ADMIN; thu hồi mọi phiên | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 28 | TC-ADM-025 | SYSTEM đổi bảng phí giao bằng bản nháp rồi áp dụng; đơn cũ không bị tính lại | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 29 | TC-ADM-027 | "Cấu hình tập trung": mọi quản trị viên xem, chỉ SYSTEM sửa, có lý do và lịch sử | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 30 | TC-ADM-028 | "Nhật ký hoạt động" (audit): xem, lọc, không sửa được, không lộ bí mật | P0 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 31 | TC-ADM-029 | "Điều hành" và "Báo cáo": số liệu khớp danh sách và xuất CSV/Excel | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 32 | TC-ADM-030 | "Vận hành hệ thống": sức khỏe, sự cố, SMS Gateway, nhật ký, phiên bản | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 33 | TC-ADM-031 | "Sao lưu và phục hồi": xem lịch sử sao lưu và yêu cầu sao lưu ngay (chỉ SYSTEM) | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 34 | TC-ADM-032 | Nhật ký lỗi hệ thống ("Giám sát > Nhật ký lỗi") | P2 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 35 | TC-ADM-033 | Mục "Vùng hoạt động" ghi "Sắp có" | P2 | PC | NOT READY |
| 36 | TC-ADM-034 | Trang chủ Web Admin sau khi đăng nhập và nội dung hướng dẫn cũ | P2 | PC | CẦN XÁC MINH |
| 37 | TC-ADM-035 | Xóa tài khoản người dùng: chỉ xóa hẳn khi không có dữ liệu liên quan | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 38 | TC-SET-009 | Ứng dụng báo "Có bản mới" và cập nhật ngay trong ứng dụng | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 39 | TC-NOTI-006 | Web Admin > Thông báo: tra cứu, "Việc cần xử lý" và cấu hình (chỉ SYSTEM sửa) | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 40 | TC-SET-010 | Bản bắt buộc cập nhật: ứng dụng bản cũ bị chặn | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 41 | TC-ACC-032 | SYSTEM tắt/bật bắt buộc OTP khi đăng ký (công tắc hệ thống) | P2 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 42 | TC-SEC-005 | Phiên Web Admin hết hạn khi bỏ không và sau khi đăng xuất | P1 | 1 ĐT | CẦN XÁC MINH |
| 43 | TC-SEC-006 | Số điện thoại và tài khoản ngân hàng được che bớt ở Web Admin | P1 | PC | SẴN SÀNG |
| 44 | TC-SEC-007 | Chính sách quyền riêng tư nói "không theo dõi vị trí nền" nhưng 11Ship chia sẻ vị trí khi online | P1 | 1 ĐT | CẦN XÁC MINH |
| 45 | TC-AUTO-001 | Đối chiếu CI: nhận đơn đồng thời, hủy/nhận/lấy hàng/hoàn thành xung đột | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 46 | TC-AUTO-002 | Đối chiếu CI: chống xử lý lặp (idempotency) và mất phản hồi | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 47 | TC-AUTO-003 | Đối chiếu CI: sổ cái ví, tạm giữ, nạp, rút và đối soát | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 48 | TC-AUTO-004 | Đối chiếu CI: quyền người dùng và quyền quản trị | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 49 | TC-AUTO-005 | Đối chiếu CI: giao nhận sự kiện (outbox) và thông báo không mất, không trùng | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 50 | TC-AUTO-006 | Đối chiếu CI: nâng cấp cơ sở dữ liệu giữ nguyên dữ liệu | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 51 | TC-AUTO-007 | Đối chiếu CI: sao lưu, nhật ký (audit) không sửa/xóa được | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |

---

### TC-WAL-011 · Lịch sử giao dịch: lọc "Nạp tiền", "Hoa hồng", "Tạm giữ"

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #239 (trong ngày: 1) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper xem và lọc đầy đủ lịch sử ví; mỗi dòng có số tiền, số dư sau và thời gian. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đã có nạp, hoa hồng và tạm giữ/giải phóng (sau TC-FLOW-001 và TC-FLOW-026). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ví > "Xem tất cả" ở "Giao dịch gần đây". | Màn "Lịch sử giao dịch" với các nhãn lọc "Tất cả", "Nạp tiền", "Rút tiền", "Hoa hồng", "Tạm giữ". |
| 2 | Chạm "Nạp tiền". | Chỉ hiện các dòng nạp. |
| 3 | Chạm "Hoa hồng". | Chỉ hiện các dòng hoa hồng, mỗi dòng ứng với một đơn hoàn thành. |
| 4 | Chạm "Tạm giữ". | Hiện các dòng tạm giữ và giải phóng; có chú thích "Tạm giữ là thông tin giữ chỗ, không phải khoản trừ trong sổ giao dịch." |
| 5 | Chạm một dòng giao dịch bất kỳ. | Mở "Thông tin giao dịch" với số tiền, loại, thời gian, trạng thái. |
| 6 | Cuộn cuối danh sách; chạm "Tải thêm" nếu có. | Tải thêm các dòng cũ hơn (mỗi lần 50 dòng); không mất dòng nào. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart (TxnHistoryScreen, txnFilterLabel)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/wallet_views_test.dart; wallet_http_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-012 · Đối chiếu tay: tổng số dư = tổng các dòng giao dịch

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #240 (trong ngày: 2) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Phát hiện tiền "tự nhiên mất hoặc tăng sai": cộng trừ lại sổ giao dịch phải ra đúng số dư hiện tại. |
| Người thực hiện | Shipper + ADMIN |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-FLOW-026 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | SP-A có ít nhất 3 loại giao dịch (nạp, tạm giữ/giải phóng, hoa hồng). Ghi lại TẤT CẢ dòng giao dịch từ cũ đến mới (loại, số tiền). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Dùng bảng tính (Excel) do tester tự ghi từ màn hình, không cần truy cập cơ sở dữ liệu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở "Lịch sử giao dịch" (lọc "Tất cả") chép lại từng dòng vào bảng tính: thời gian, loại, số tiền (+/-). | Có bảng đầy đủ các dòng. |
| 2 | Tính: Tổng nạp - tổng hoa hồng - các khoản rút (nếu có). | Kết quả = "Tổng số dư" hiện trên màn Ví. (Các dòng "Tạm giữ"/"Giải phóng" chỉ là thông tin, không cộng trừ.) |
| 3 | Tính khả dụng: Tổng số dư - tiền đang tạm giữ. | Kết quả = "Số dư khả dụng". |
| 4 | Admin mở Web Admin > Tài chính > Ví Shipper, tìm SP-A. | Số dư B, tạm giữ H và khả dụng A = B - H khớp với app (tên và số điện thoại được che bớt). |
| 5 | Admin mở Tài chính > Đối soát > "Chạy kiểm tra và ghi nhận kết quả". | Hiện "Đã chạy kiểm tra: không có lệch." Nếu có ví lệch: ghi lỗi NGHIÊM TRỌNG. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Mọi chênh lệch dù chỉ 1đ giữa các con số là lỗi NGHIÊM TRỌNG.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/finance-ops-view.ts (Đối soát, Ví lệch sổ giao dịch); docs/current/ADR-004-driver-wallet-consistency.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-wallet-core.int.spec.ts; m04-withdrawals.int.spec.ts (reconciliation)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-013 · Ví không đủ tiền hoa hồng thì không nhận được đơn mới, nhưng đơn đang giao vẫn hoàn tất

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #241 (trong ngày: 3) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Khi số dư khả dụng không còn đủ hoa hồng, shipper không nhận thêm đơn; không bao giờ hủy đơn đang giao vì số dư giảm. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | SP-B số dư khả dụng đúng bằng hoa hồng một đơn (hoặc thấp hơn). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần đưa số dư khả dụng của SP-B về dưới mức hoa hồng (ví dụ 500đ). Cách: SP-B chỉ có dư lại sau khi đã bị trừ hoa hồng nhiều lần; hoặc dùng SP-B với số dư đúng bằng hoa hồng rồi nhận 1 đơn (hold = toàn bộ số dư), khi đó đơn thứ hai không nhận được. Hỏi Người phụ trách cách chuẩn bị an toàn. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SP-B nhận đơn thứ nhất (khi còn đủ). | Nhận được; khả dụng về 0 (toàn bộ tiền bị tạm giữ). |
| 2 | Quán gọi thêm một đơn; SP-B mở "Có thể nhận". | Không nhận được đơn thứ hai: thẻ đơn không đủ điều kiện kèm lý do số dư thấp (hoặc không hiện). |
| 3 | SP-B tiếp tục lấy hàng và giao thành công đơn thứ nhất. | Hoàn tất bình thường dù khả dụng đang 0; hoa hồng thu từ khoản đã tạm giữ; tổng số dư không âm. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu số dư âm hoặc đơn đang giao bị hủy vì thiếu tiền.

**Cách khôi phục để chạy lại:** Nạp thêm tiền thử nghiệm cho SP-B (TC-WAL-005) trước test sau.

**Căn cứ:** `apps/backend/src/shipping-policy/shipping-eligibility.ts (BALANCE_TOO_LOW); docs/current/M03-simplified-onboarding-20261020.md ("Không hủy đơn đang giao khi số dư giảm")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-eligibility.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-014 · Yêu cầu dừng hoạt động của shipper: tắt nhận đơn ngay, đơn đang giao vẫn hoàn tất

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #242 (trong ngày: 4) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper muốn nghỉ thì gửi yêu cầu dừng hoạt động; không mất tiền và đơn đang giao vẫn phải hoàn tất. |
| Người thực hiện | Shipper (SP-B) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-009 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | SP-B có số dư dương, KHÔNG có đơn đang giao. (Dùng SP-B, không dùng SP-A vì SP-A cần cho test khác.) |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > "Dừng hoạt động / Rút tiền". | Màn có "Gửi yêu cầu ngừng hoạt động" với nội dung "Bạn sẽ ngừng nhận đơn mới ngay. Các đơn đang giao vẫn phải hoàn tất. Số dư ví của bạn không bị mất. Bạn có thể hủy yêu cầu khi chưa được xử lý." |
| 2 | Chạm "Gửi yêu cầu" và xác nhận ("Ngừng hoạt động?"). | Hiện "Đã gửi yêu cầu ngừng hoạt động"; trạng thái hồ sơ "Đang đóng hồ sơ"/"Bạn đã ngừng nhận đơn mới." Nút bật online không còn dùng được. |
| 3 | Nhìn bước kế tiếp. | Hiện yêu cầu nhập ngân hàng nhận hoàn tiền ("Nhập ngân hàng nhận hoàn tiền", "Chọn ngân hàng", "Số tài khoản", "Tên chủ tài khoản" - phải khớp họ tên shipper). |
| 4 | Chạm "Hủy yêu cầu ngừng hoạt động" (nếu muốn quay lại). | Trở lại trạng thái hoạt động; có thể bật online lại khi ví đủ điều kiện. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Hủy yêu cầu ngừng hoạt động để dùng lại SP-B.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/driver_views.dart (Dừng hoạt động / Rút tiền); docs/current/M03-simplified-onboarding-20261020.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts; m04-withdrawals.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-015 · Rút toàn bộ số dư khi dừng hoạt động: Admin nhận xử lý và ghi nhận đã chuyển (tiền thử nghiệm)

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #243 (trong ngày: 5) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Đường rút tiền duy nhất hiện nay: shipper đóng tài khoản và rút toàn bộ số dư; Admin chuyển khoản thủ công ngoài hệ thống rồi ghi nhận; ví bị trừ đúng một lần. |
| Người thực hiện | Shipper + ADMIN |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-WAL-014 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | SP-B đã gửi yêu cầu ngừng hoạt động (TC-WAL-014), không có đơn/tiền giữ/yêu cầu nạp chờ. ADMIN có quyền tài chính "xử lý rút tiền". |
| Dữ liệu nhập | Chỉ dùng tài khoản SP-B (tài khoản thử). Ngân hàng: ngân hàng thử do Người phụ trách chỉ định; tên chủ tài khoản trùng họ tên shipper "Shipper Test B". |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. TUYỆT ĐỐI không chuyển tiền thật. Dùng tài khoản ngân hàng thử nghiệm đã được Admin xác minh (nếu Người phụ trách cung cấp) và mã giao dịch chuyển đi THỬ NGHIỆM. Nếu Người phụ trách không cho phép ghi nhận chuyển tiền thử nghiệm, test dừng ở bước 3 (Nhận xử lý) và ghi BLOCKED phần còn lại. Quy trình tách người: người nhận xử lý và người đối soát có thể khác nhau. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper nhập ngân hàng nhận hoàn tiền (ngân hàng thử, số tài khoản thử, tên chủ tài khoản khớp), chạm "Lưu tài khoản ngân hàng". | Hiện "Đã lưu tài khoản ngân hàng. Quản trị viên sẽ xác minh." Trạng thái "Chờ xác minh". |
| 2 | Admin vào VẬN HÀNH > Shipper > SP-B, chạm "Xác minh ngân hàng" và xác nhận. | Ngân hàng chuyển "Đã xác minh". |
| 3 | Shipper chạm "Rút toàn bộ số dư ví" (hoặc "Yêu cầu rút tiền"), xác nhận. | Hiện "Yêu cầu đã được gửi. Admin sẽ chuyển tiền và xác nhận kết quả."; toàn bộ số dư bị TẠM GIỮ ("Tiền tạm giữ" = số dư), tổng số dư chưa đổi. |
| 4 | Admin: TÀI CHÍNH > Rút tiền > mở yêu cầu của SP-B > "Nhận xử lý (tôi sẽ chuyển khoản thủ công)" và xác nhận. | Yêu cầu sang "Đang xử lý"; Admin thấy tài khoản nhận đầy đủ (chỉ người nhận xử lý thấy), số tiền yêu cầu. |
| 5 | Admin: "Ghi nhận đã chuyển": nhập "Số tiền đã chuyển (VND)" ĐÚNG bằng số yêu cầu, "Mã giao dịch chuyển đi" thử nghiệm, tài khoản hệ thống đã dùng, thời điểm chuyển; xác nhận ("Xác nhận đã chuyển tiền?"). | Yêu cầu chuyển "Đã chuyển và ghi nhận". Ví shipper: tổng số dư trừ đúng số tiền; tạm giữ về 0; đúng MỘT dòng "Rút tiền". |
| 6 | Shipper mở màn yêu cầu rút. | Hiện "Admin đã chuyển tiền tới tài khoản nhận của bạn." Số dư ví = 0 (hoặc phần còn lại đúng). |
| 7 | Admin bấm xác nhận lần nữa/ghi nhận lần hai (nếu còn nút). | Không ghi nhận lần hai; số dư không âm. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu ví bị trừ hai lần, số dư âm hoặc yêu cầu rút ghi nhận khi chưa qua các bước.

**Cách khôi phục để chạy lại:** Tài khoản SP-B ở trạng thái đóng sau test này: dùng tài khoản mới nếu cần tiếp tục thử shipper.

**Căn cứ:** `apps/admin-web/src/dom/finance-ops-view.ts (Nhận xử lý, Ghi nhận đã chuyển); docs/current/M04-C-withdrawal-completion-20261018.md; M03-simplified-onboarding`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-withdrawals.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-001 · Khách đánh giá quán và shipper sau khi đơn hoàn thành

**Mức độ:** P1 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #244 (trong ngày: 6) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chỉ khách đặt đơn đã hoàn thành mới đánh giá; gửi một lần, không sửa/xóa. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có một đơn "Hoàn thành" (TC-FLOW-001), chưa đánh giá. |
| Dữ liệu nhập | Quán: 5 sao, nhận xét "Món ngon (TEST)". Shipper: 4 sao, nhận xét "Giao nhanh (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn đã hoàn thành. | Có thẻ "Đánh giá và phản ánh" với "Đánh giá quán" và "Đánh giá shipper". |
| 2 | Chạm "Đánh giá quán", chạm 5 sao, nhập nhận xét, chạm "Gửi đánh giá". | Hộp "Gửi đánh giá?" nói "Bạn chọn 5 sao cho … Đánh giá chỉ gửi một lần và không sửa hoặc xóa được." Xác nhận. |
| 3 | Làm tương tự cho shipper (4 sao). | Gửi thành công; hiện "Đã đánh giá". |
| 4 | Mở lại đơn, thử đánh giá lần nữa. | Không đánh giá lại được (đã đánh giá). |
| 5 | Xem trang Quán Test A. | Điểm đánh giá của quán đã hiện (5 sao, 1 lượt) cùng nhận xét của khách. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không hoàn tác được; ghi lại.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m11/m11_rating_views.dart; docs/current/M11-implementation-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-feedback.int.spec.ts; m11-orders-real.int.spec.ts; mobile/packages/n11_shared/test/m11_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-019 · Hồ sơ shipper chờ duyệt / xác minh ngân hàng cũ: ghi nhận trạng thái thực tế

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #245 (trong ngày: 7) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Theo quy định 20/10/2026 shipper không cần Admin duyệt hồ sơ hay ngân hàng để hoạt động; Web Admin vẫn còn nút Xác minh/Từ chối cho dữ liệu cũ và cho ngân hàng hoàn tiền. Cần ghi nhận để Owner xác nhận không gây nhầm lẫn. |
| Người thực hiện | ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | SP-A đã đăng ký và đang hoạt động. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Lệch tài liệu-mã nguồn cần Owner xác nhận: giao diện Admin còn "Xác minh"/"Từ chối" hồ sơ/ngân hàng; Điều hành còn thẻ "Hồ sơ shipper chờ duyệt". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết SP-A và tìm các nút "Xác minh", "Từ chối", "Xác minh ngân hàng". | Ghi nhận nút nào đang hiện và có tác dụng gì với shipper đang hoạt động (không được làm shipper mất khả năng nhận đơn). |
| 2 | Thử "Xác minh ngân hàng" cho SP-B sau khi SP-B nhập ngân hàng hoàn tiền (TC-WAL-015). | Chỉ để cho phép rút/hoàn tiền; không ảnh hưởng nhận đơn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `docs/current/M03-simplified-onboarding-20261020.md; apps/admin-web/src/dom/shippers-view.ts; overview-view.ts ("Hồ sơ shipper chờ duyệt")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-016 · Rút tiền: Admin nhập số tiền chuyển khác số yêu cầu thì không kết luận "đã chuyển đủ"

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #246 (trong ngày: 8) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Hệ thống không cho coi là hoàn tất khi số tiền chuyển lệch; chuyển một phần chưa được Owner duyệt nên phải để "Cần đối soát". |
| Người thực hiện | ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-WAL-015 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Một yêu cầu rút ở trạng thái "Đang xử lý" do bạn nhận xử lý (làm lại TC-WAL-015 với tài khoản thử khác). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chọn "Ghi nhận đã chuyển" và nhập số tiền chuyển KHÁC số yêu cầu. | Hiện cảnh báo "Số tiền khác số tiền yêu cầu: không thể kết luận "đã chuyển đủ". Giữ trạng thái cần đối soát." và không cho hoàn tất. |
| 2 | Chạm "Chuyển sang cần đối soát" và xác nhận. | Yêu cầu sang "Cần đối soát"; tiền vẫn bị giữ ("Yêu cầu giữ nguyên, tiền vẫn bị giữ."). |
| 3 | Kiểm tra ví shipper. | Số dư chưa bị trừ; tạm giữ vẫn còn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Xử lý đối soát theo hướng dẫn của Người phụ trách (chọn kết luận đối soát phù hợp, KHÔNG chuyển tiền thật).

**Căn cứ:** `apps/admin-web/src/dom/finance-ops-view.ts (Chuyển sang cần đối soát, Đối soát)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-withdrawals.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-002 · Không đánh giá được khi đơn chưa hoàn thành hoặc khi không phải đơn của mình

**Mức độ:** P1 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #247 (trong ngày: 9) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quyền đánh giá chặt chẽ: chỉ khách của đơn hoàn thành, chỉ shipper đã giao thành công. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có một đơn chưa hoàn thành (đang chuẩn bị) và KH-B không có đơn đó. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn chưa hoàn thành. | Không có nút đánh giá, hoặc hiện "Đơn hoàn thành rồi bạn mới đánh giá được quán." / "Giao thành công rồi bạn mới đánh giá được shipper." |
| 2 | Với đơn bị hủy/chưa có shipper: tìm phần đánh giá shipper. | Hiện "Đơn này chưa có shipper giao hoặc không giao qua shipper nên không có phần đánh giá shipper." |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m11/m11_rating_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-017 · Shipper hủy yêu cầu rút tiền khi còn "Chờ xử lý": tiền được giải phóng

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #248 (trong ngày: 10) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Hủy yêu cầu rút chưa xử lý thì số tiền đang giữ trả lại khả dụng. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-WAL-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP (tài khoản thử đang trong trạng thái đóng) đã gửi yêu cầu rút "Chờ xử lý" và Admin CHƯA nhận xử lý. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper mở chi tiết yêu cầu rút, chạm "Hủy yêu cầu". | Hộp "Hủy yêu cầu rút?" nói "Yêu cầu rút tiền sẽ bị hủy và số tiền đang giữ được giải phóng." |
| 2 | Xác nhận. | Hiện "Yêu cầu đã được hủy. Số tiền đang giữ đã được giải phóng."; số dư khả dụng trở lại. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Giữ trạng thái; tạo yêu cầu mới nếu cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart (WithdrawDetailScreen)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-withdrawals.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-003 · Khách gửi phản ánh về một đơn (có ảnh minh chứng)

**Mức độ:** P1 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #249 (trong ngày: 11) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Phản ánh có nhóm vấn đề, mô tả và tối đa 5 ảnh (mỗi ảnh ≤ 5 MB, JPEG/PNG/WebP). |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A có đơn hoàn thành. |
| Dữ liệu nhập | Nhóm vấn đề: chọn một nhóm trong danh sách (ví dụ nhóm liên quan món ăn); mô tả "Thiếu 1 phần trà đá (TEST)"; 1 ảnh JPEG nhỏ. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chi tiết đơn > "Gửi phản ánh về đơn này". | Màn "Gửi phản ánh" với "Nhóm vấn đề", "Mô tả điều đã xảy ra", "Ảnh minh chứng · không bắt buộc" ("Tối đa 5 ảnh, mỗi ảnh 5 MB."). |
| 2 | Chọn nhóm bỏ trống mô tả rồi chạm "Gửi phản ánh". | Báo "Hãy chọn nhóm vấn đề." hoặc "Hãy nhập nội dung phản ánh." |
| 3 | Chọn nhóm, nhập mô tả, thêm 1 ảnh ("Thêm ảnh"), chạm "Gửi phản ánh". | Hiện "Đã gửi phản ánh. Chúng tôi sẽ cập nhật trạng thái ngay trong ứng dụng." Hồ sơ nằm trong Tài khoản > "Phản ánh của tôi" > "Đang mở" với trạng thái "Đã tiếp nhận"/"Chờ tiếp nhận". |
| 4 | Gửi thêm phản ánh cùng vấn đề khi đã có hồ sơ mở. | Nội dung được bổ sung vào hồ sơ đang mở ("Vấn đề này đang có hồ sơ mở nên nội dung của bạn đã được bổ sung vào hồ sơ đó."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Admin đóng hồ sơ thử (TC-FEED-006).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m11/m11_complaint_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-feedback.int.spec.ts; mobile/packages/n11_shared/test/m11_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-018 · Tài chính Admin: tổng quan, danh sách ví và giao dịch

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #250 (trong ngày: 12) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin có quyền thấy tổng số dư, tạm giữ, khả dụng và danh sách giao dịch khớp nhau. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tiền thử nghiệm trong ví shipper (Owner duyệt); Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã có vài giao dịch thử nghiệm (nạp, hoa hồng). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của SYSTEM rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: SYSTEM". |
| 4 | Ở menu bên trái của Web Admin, chọn: TÀI CHÍNH > Tài chính > "Tổng quan". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 5 | Đọc các số: "Tổng số dư ví", "Tổng khả dụng", "Tổng hold đang giữ", "Yêu cầu nạp chờ xử lý", "Yêu cầu rút chờ xử lý", "Hoa hồng đã thu". | Các số hiển thị ("Số liệu đọc trực tiếp từ cơ sở dữ liệu tại một thời điểm. Không có số liệu giả hoặc ước tính."). Tổng khả dụng = Tổng số dư - Tổng hold. |
| 6 | Ở menu bên trái của Web Admin, chọn: TÀI CHÍNH > Tài chính > "Ví Shipper". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 7 | Tìm SP-A. | Ví SP-A có số dư B, tạm giữ H, khả dụng A đúng như app. |
| 8 | Ở menu bên trái của Web Admin, chọn: TÀI CHÍNH > Tài chính > "Giao dịch". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 9 | Lọc theo SP-A. | Hiện các dòng giao dịch của SP-A khớp với lịch sử trong app (số tiền, loại, thứ tự thời gian). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất Web Admin.

**Căn cứ:** `apps/admin-web/src/dom/finance-view.ts; apps/admin-web/src/dom/finance-ops-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-finance-access.int.spec.ts; admin-finance-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-004 · Chủ quán đánh giá shipper và phản hồi đánh giá của khách

**Mức độ:** P1 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #251 (trong ngày: 13) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán đánh giá shipper sau khi giao (thành công hoặc không); quán phản hồi nhưng không sửa/xóa được đánh giá của khách. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FEED-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có đơn hoàn thành mà khách đã đánh giá quán. |
| Dữ liệu nhập | Đánh giá shipper 5 sao "Đúng giờ (TEST)". Phản hồi khách "Cảm ơn bạn (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở chi tiết yêu cầu giao đã hoàn thành, chạm "Đánh giá shipper", chọn sao, "Gửi đánh giá". | Gửi thành công một lần. |
| 2 | Vào Tài khoản > "Đánh giá của tôi" > "Khách đánh giá", mở đánh giá của khách, chạm "Phản hồi đánh giá", nhập, "Lưu phản hồi". | Phản hồi được lưu và hiện dưới đánh giá ("Phản hồi của quán"). |
| 3 | Tìm nút sửa/xóa đánh giá của khách. | Không có ("Quán không sửa hoặc xóa được đánh giá của khách."). Có "Sửa phản hồi" cho phản hồi của chính quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m11/m11_rating_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-005 · Admin ẩn và khôi phục một đánh giá

**Mức độ:** P1 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #252 (trong ngày: 14) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Đánh giá vi phạm bị ẩn khỏi điểm tổng hợp; bản gốc được giữ và có nhật ký. |
| Người thực hiện | ADMIN (quyền Duyệt) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-FEED-001 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Có đánh giá 5 sao của quán (TC-FEED-001). |
| Dữ liệu nhập | Lý do ẩn: "TEST vi phạm". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Đánh giá". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Mở "Chi tiết đánh giá" của đánh giá thử; chạm "Ẩn" (nếu có quyền), chọn lý do và xác nhận. | Đánh giá ghi "đã ẩn"; điểm tổng hợp của quán không còn tính đánh giá đó; có nhật ký. |
| 3 | Khách xem trang quán. | Đánh giá không còn hiển thị. |
| 4 | Admin chạm "Khôi phục đánh giá". | Đánh giá hiển thị lại và tính lại điểm. |
| 5 | Tìm cách sửa số sao/nhận xét thay người gửi. | Không có ("Admin không sửa sao hay nhận xét thay người gửi."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Khôi phục đánh giá (bước 4).

**Căn cứ:** `apps/admin-web/src/dom/feedback-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-admin-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-006 · Admin xử lý phản ánh: tiếp nhận, yêu cầu bổ sung, kết luận, đóng

**Mức độ:** P1 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #253 (trong ngày: 15) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Vòng đời hồ sơ phản ánh đi đúng thứ tự; người gửi và bên liên quan thấy đúng phần được phép. |
| Người thực hiện | ADMIN (quyền Duyệt) + Khách + Quán/Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-FEED-003 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Có hồ sơ phản ánh "Chờ tiếp nhận" (TC-FEED-003). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Phản ánh". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Mở "Chi tiết phản ánh", tiếp nhận hồ sơ (gán cho mình: "Của tôi"). | Trạng thái "Đã tiếp nhận"; khách nhận thông báo. |
| 3 | Ghi "Ghi chú nội bộ" và gửi "Yêu cầu bổ sung" cho người gửi. | Trạng thái "Chờ bổ sung"; khách thấy "Yêu cầu bổ sung" và nút "Bổ sung hồ sơ". KHÔNG thấy ghi chú nội bộ. |
| 4 | Khách bổ sung thông tin. | Admin thấy "Bạn bổ sung" trong hồ sơ. |
| 5 | Admin nhập "Kết luận" và đóng hồ sơ. | Trạng thái "Đã đóng"; khách thấy kết luận và hạn xem xét lại trong 7 ngày. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `apps/admin-web/src/dom/feedback-view.ts; mobile/packages/n11_shared/lib/src/m11/m11_complaint_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-admin-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-021 · SYSTEM đổi mức hoa hồng: chỉ áp dụng cho đơn nhận sau đó

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #254 (trong ngày: 16) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Mức hoa hồng đổi không làm thay đổi hoa hồng đã chốt của đơn đang chạy. |
| Người thực hiện | SYSTEM + Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập. SP-A đã nhận một đơn với mức hoa hồng cũ (tạm giữ đã chốt). |
| Dữ liệu nhập | Mức mới: 2000 (đ/đơn); sau test đặt lại về mức ban đầu. |
| Ghi chú đặc biệt | Thay đổi cấu hình tài chính thật. Chỉ làm khi Owner cho phép; đặt lại mức cũ sau test. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Web Admin > Tài chính > Rút tiền hoặc trang có "Đổi mức hoa hồng", chạm "Đổi mức hoa hồng". | Hiện mức "Đang áp dụng: … / đơn". |
| 2 | Nhập mức mới 2000, "Kiểm tra và đổi mức hoa hồng", xác nhận. | Hiện "Đã đổi mức hoa hồng: máy chủ đã xác nhận. Chỉ áp dụng cho đơn nhận sau thời điểm này." |
| 3 | SP-A hoàn thành đơn đã nhận TRƯỚC khi đổi. | Hoa hồng thu = mức CŨ đã chốt lúc nhận. |
| 4 | SP-A nhận và hoàn thành một đơn mới. | Hoa hồng thu = mức MỚI 2000đ. |
| 5 | Đặt lại mức hoa hồng về giá trị ban đầu. | Mức hiện hành về như cũ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Mức hoa hồng phải về như ban đầu.

**Căn cứ:** `apps/admin-web/src/dom/finance-ops-view.ts (Đổi mức hoa hồng); docs/current/M04-C-withdrawal-completion-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-withdrawals.int.spec.ts (commission policy)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-007 · Bên liên quan giải trình và khách yêu cầu xem xét lại (trong 7 ngày, một lần)

**Mức độ:** P2 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #255 (trong ngày: 17) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Bên bị phản ánh được nói ý kiến; người gửi được xin xem xét lại một lần cho mỗi lần đóng. |
| Người thực hiện | Khách + Quán/Shipper + ADMIN |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Máy tính có trình duyệt (Web Admin) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-FEED-006 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Hồ sơ phản ánh đã đóng trong vòng 7 ngày; Admin đã gửi yêu cầu giải trình cho quán/shipper liên quan. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán/shipper mở Tài khoản > "Phản ánh của tôi" > "Liên quan đến tôi", mở hồ sơ, nhập "Nội dung giải trình", gửi. | Hiện "Bạn giải trình"; người gửi KHÔNG thấy nội dung phản ánh gốc của ai khác ngoài phần được phép. |
| 2 | Khách chạm "Yêu cầu xem xét lại", nhập lý do, "Gửi yêu cầu". | Hiện "Đã gửi yêu cầu"; trạng thái "đang chờ quyết định"; không gửi lại được lần nữa cho lần đóng đó. |
| 3 | Admin quyết định ("Quyết định xem xét lại"). | Khách nhận kết quả "đã mở lại hồ sơ" hoặc từ chối kèm lý do. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m11/m11_complaint_views.dart; docs/current/M11-implementation-20261018.md mục 2.5`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-022 · SYSTEM đổi mức nạp/rút tối thiểu; ADMIN chỉ xem

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #256 (trong ngày: 18) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Các tham số ví chỉ SYSTEM sửa; mọi quản trị viên xem được. |
| Người thực hiện | SYSTEM, ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM và ADMIN-1 đều có tài khoản. |
| Dữ liệu nhập | Mức nạp tối thiểu hiện tại là N; thử đổi thành N + 10000 rồi đặt lại N. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SYSTEM: HỆ THỐNG > Tham số hệ thống > "Ví Shipper". | Thấy "Nạp tối thiểu mỗi yêu cầu" và "Rút tối thiểu mỗi yêu cầu" (có nút sửa). |
| 2 | Sửa mức nạp tối thiểu, ghi lý do, xác nhận lưu. | Lưu thành công, ghi nhật ký thay đổi. |
| 3 | Trên 11Ship: Ví > Nạp tiền. | Dòng "Tối thiểu … mỗi lần nạp" hiển thị mức mới. |
| 4 | SYSTEM đặt lại mức cũ. | Về mức cũ. |
| 5 | ADMIN-1 mở cùng trang. | Xem được giá trị nhưng không có nút sửa ("Chỉ tài khoản SYSTEM được sửa tham số."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đặt lại mức nạp/rút tối thiểu như ban đầu.

**Căn cứ:** `apps/admin-web/src/core/config.ts (topup_min_vnd, withdraw_min_vnd); shipping-policy-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-config.int.spec.ts; m04-finance-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FEED-008 · Ảnh minh chứng phản ánh: giới hạn số lượng, dung lượng và định dạng

**Mức độ:** P2 · **Nhóm:** Bổ sung: Đánh giá và phản ánh · **Số thứ tự chạy:** #257 (trong ngày: 19) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Hệ thống chỉ nhận ảnh JPEG/PNG/WebP ≤ 5 MB, tối đa 5 ảnh, kiểm tra nội dung tệp. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FEED-003 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang ở màn "Gửi phản ánh". |
| Dữ liệu nhập | 6 ảnh nhỏ; 1 ảnh lớn hơn 5 MB; 1 file không phải ảnh đổi đuôi thành .jpg. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Thêm 6 ảnh. | Chỉ nhận tối đa 5 ảnh ("Tối đa 5 ảnh, mỗi ảnh 5 MB."). |
| 2 | Thêm ảnh lớn hơn 5 MB. | Bị từ chối kèm thông báo; không treo ứng dụng. |
| 3 | Chọn file giả ảnh. | Hiện "Không đọc được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP khác." |
| 4 | Chạm "Bỏ ảnh cuối". | Số ảnh giảm 1. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thoát màn hình không gửi.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m11/m11_complaint_views.dart (kMaxEvidence=5)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-023 · Admin hoàn tất đóng tài khoản shipper chỉ khi đã tất toán

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #258 (trong ngày: 20) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Không đóng được tài khoản khi còn đơn, số dư, tiền giữ, nạp chờ hoặc yêu cầu rút mở. |
| Người thực hiện | ADMIN + Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-WAL-015 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Một shipper thử đang "Đang đóng hồ sơ". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin mở trang shipper đó, chạm "Hoàn tất ngừng hoạt động" khi vẫn còn số dư/ yêu cầu rút mở. | Máy chủ từ chối với lý do rõ (còn số dư/đơn/yêu cầu); không đóng. |
| 2 | Xử lý hết (rút toàn bộ, không còn tiền giữ) rồi bấm lại. | Hồ sơ chuyển "Đã đóng"; shipper mất quyền hoạt động nhưng lịch sử vẫn còn; vẫn đăng nhập như khách hàng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tài khoản thử đã đóng; không dùng lại.

**Căn cứ:** `apps/admin-web/src/dom/finance-ops-view.ts; apps/admin-web/src/dom/shippers-view.ts (Hoàn tất ngừng hoạt động)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-withdrawals.int.spec.ts; m03-shipper.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-024 · Mất mạng hoặc bấm lặp khi tạo yêu cầu nạp/rút: không tạo trùng, không trừ hai lần

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #259 (trong ngày: 21) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Giao dịch tiền phải an toàn khi mạng chập chờn: gửi lại cùng một yêu cầu chỉ có một kết quả. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-WAL-003 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Ở màn "Xác nhận nạp tiền" với số tiền hợp lệ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Bấm "Tôi đã chuyển tiền" nhiều lần liên tiếp thật nhanh. | Chỉ MỘT yêu cầu nạp được tạo. |
| 2 | Làm lại với mạng yếu: bật Chế độ máy bay ngay sau khi bấm "Tôi đã chuyển tiền", rồi tắt. | Ứng dụng báo "Chưa gửi được yêu cầu. Vui lòng thử lại." hoặc tương tự; khi thử lại không tạo yêu cầu thứ hai nếu lần đầu đã thành công. |
| 3 | Vào danh sách yêu cầu nạp (trong app và Web Admin). | Mỗi lần nhấn chỉ tương ứng tối đa MỘT yêu cầu; số dư chưa đổi. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu có hai yêu cầu cho cùng một lần bấm hoặc số dư đổi khi chưa có Admin.

**Cách khôi phục để chạy lại:** Hủy các yêu cầu thử còn "Chờ xử lý".

**Căn cứ:** `mobile/packages/n11_shared/lib/src/wallet/wallet_http.dart (giữ Idempotency-Key khi chưa rõ kết quả)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-topup-requests.int.spec.ts; idempotency-executor.int.spec.ts; mobile/packages/n11_shared/test/wallet_http_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-025 · Admin điều chỉnh tài chính từ phản ánh (thu thêm / hoàn hoa hồng)

**Mức độ:** P1 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #260 (trong ngày: 22) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Điều chỉnh tiền sau khiếu nại chỉ thực hiện bởi người có quyền tiền riêng; thiếu số dư thì chờ xử lý, không làm ví âm. |
| Người thực hiện | ADMIN (có quyền điều chỉnh) + Shipper |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Một hồ sơ phản ánh thử đang mở. ADMIN có quyền "điều chỉnh tài chính". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | QUY TẮC TIỀN THỬ NGHIỆM: không chuyển tiền thật và không tạo giao dịch ngân hàng thật. Chỉ chạy test này trên môi trường/tài khoản mà Người phụ trách (Owner) đã duyệt bằng văn bản là "tiền thử nghiệm" (xem mục 6 của HUONG_DAN_KIEM_THU_11SHIP.md). Nếu chưa có duyệt thì ghi BLOCKED. Cần một hồ sơ phản ánh thử gắn với một đơn đã giao (làm sau TC-FEED-003). Quyền điều chỉnh chỉ SYSTEM hoặc ADMIN được cấp riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin mở hồ sơ phản ánh > mục "Điều chỉnh tài chính", chọn hướng "Hoàn cho shipper" hoặc thu thêm, nhập số tiền nhỏ và lý do. | Hiện cảnh báo "Cần quyền tiền riêng. Thiếu số dư hoặc chưa thực hiện được thì chờ xử lý tài chính, không âm ví hay dùng tiền đang giữ." |
| 2 | Gửi yêu cầu điều chỉnh. | Nếu đủ số dư: ghi một dòng điều chỉnh vào ví; nếu thiếu: trạng thái "Chờ xử lý tài chính", ví KHÔNG âm. |
| 3 | Shipper xem ví. | Số dư thay đổi đúng số điều chỉnh (nếu đã thực hiện) hoặc không đổi (nếu đang chờ); lịch sử hiện dòng tương ứng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Ghi nhận mọi điều chỉnh đã làm vào ô ghi chú để đối soát.

**Căn cứ:** `apps/admin-web/src/dom/feedback-view.ts (Điều chỉnh tài chính); docs/current/M11-implementation-20261018.md mục 2.7, 3`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m11-adjustment-real.int.spec.ts; m11-admin-feedback.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-007 · Phân biệt quyền ADMIN và SYSTEM: ADMIN không vào được trang chỉ dành cho SYSTEM

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #261 (trong ngày: 23) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Quyền chỉ SYSTEM (quản trị viên, phân quyền, lời mời, cài đặt hệ thống, sao lưu) không bị lộ cho ADMIN, kể cả khi gõ địa chỉ trực tiếp. |
| Người thực hiện | ADMIN-1 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-005 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã đăng nhập ADMIN-1. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Xem menu. | Không có "Quản trị viên", "Phân quyền", "Lời mời Admin", "Cài đặt hệ thống", "Sao lưu và phục hồi", "Giám sát". |
| 2 | Gõ trực tiếp vào thanh địa chỉ phần đuôi /accounts/access rồi Enter (cùng tên miền Web Admin). | Hiện trang "Không có quyền" (hoặc quay về trang chủ); KHÔNG thấy dữ liệu phân quyền. |
| 3 | Lặp lại với /accounts/administrators, /invitations, /system/settings, /system/backups. | Mỗi lần đều bị từ chối như trên. |
| 4 | Nếu tải lại trang (F5) ở một trang con báo 404: đó là hạn chế đã biết (xem DOI_CHIEU_CODE_TESTCASE.md), quay về trang chủ rồi đi bằng menu. | Ghi nhận hiện tượng nhưng KHÔNG coi là lỗi phân quyền. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu ADMIN xem hoặc sửa được dữ liệu của trang chỉ dành cho SYSTEM.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/core/menu.ts (canOpenRoute); apps/backend/src/admin-access`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-business-decisions.int.spec.ts; m12-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-008 · ADMIN-2 (chỉ quyền Xem Quán) không thao tác được các hành động cần quyền cao hơn

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #262 (trong ngày: 24) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Menu chỉ là tiện ích; máy chủ kiểm quyền lại ở mỗi thao tác. Thử thao tác bị cấm phải bị từ chối. |
| Người thực hiện | ADMIN-2 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-006 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | ADMIN-2 đăng nhập. Có một quán thử không có đơn đang chạy. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở VẬN HÀNH > Quán, mở chi tiết một quán. | Xem được thông tin. |
| 2 | Tìm nút "Vô hiệu hóa quán". | Không có nút, hoặc nút khóa kèm lý do thiếu quyền ("Quản lý hoạt động quán"). |
| 3 | Mở Người dùng, tìm nút "Khóa". | Không có thao tác khóa/mở khóa ("Bạn không có thao tác khóa, mở khóa hoặc xóa với tài khoản này."). |
| 4 | Mở Đơn hàng, tìm "Hủy đơn món" hoặc "Đóng không hoàn tất". | Không có hoặc báo thiếu quyền ("Tài khoản này không có quyền thực hiện thao tác này."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu thao tác cấm thành công.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/shops-view.ts; accounts-view.ts; orders-view.ts; apps/backend/src/admin-*`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-shops.int.spec.ts; admin-account-lock.int.spec.ts; m10-admin-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-WAL-019 · Phân quyền tài chính: ADMIN không có quyền thì không thấy hoặc không thao tác được

**Mức độ:** P0 · **Nhóm:** F. Ví và tài chính · **Số thứ tự chạy:** #263 (trong ngày: 25) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Quyền tiền cấp riêng từng chức năng và do SYSTEM cấp; quyền xem ứng dụng khác không kéo theo quyền tiền. |
| Người thực hiện | ADMIN-2 + SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-008 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | ADMIN-2 chỉ có quyền Xem ứng dụng Quán (không có quyền tiền). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của ADMIN-2 rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: ADMIN". |
| 4 | Nhìn menu bên trái. | KHÔNG thấy mục "TÀI CHÍNH" (hoặc chỉ thấy mục con được cấp). |
| 5 | Gõ trực tiếp địa chỉ trang tài chính (ví dụ phần đuôi /finance... theo Người phụ trách) vào thanh địa chỉ. | Hiện "Không có quyền" hoặc "Cần quyền xem yêu cầu nạp tiền"; không có dữ liệu tài chính nào hiện ra. |
| 6 | SYSTEM cấp cho ADMIN-2 quyền "Xem yêu cầu nạp tiền" (Phân quyền); ADMIN-2 tải lại. | ADMIN-2 xem được danh sách nạp nhưng KHÔNG có nút "Kiểm tra và xác nhận" (chỉ có khi được cấp quyền "Xác nhận / từ chối nạp tiền"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** SYSTEM thu hồi quyền vừa cấp cho ADMIN-2 (Phân quyền).

**Căn cứ:** `apps/admin-web/src/core/menu.ts; finance-admin-view.ts ("Bạn chỉ có quyền xem…"); apps/backend/src/finance-access`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-finance-access.int.spec.ts; m12-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-009 · SYSTEM cấp và thu hồi quyền của ADMIN; hiệu lực ở thao tác kế tiếp

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #264 (trong ngày: 26) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Phân quyền có hiệu lực ngay sau khi lưu; mọi thay đổi được ghi nhật ký. |
| Người thực hiện | SYSTEM + ADMIN-2 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-006 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM và ADMIN-2 đăng nhập trên hai trình duyệt khác nhau (hoặc cửa sổ ẩn danh). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SYSTEM: TÀI KHOẢN > "Phân quyền" > chọn ADMIN-2. | Thấy các công tắc quyền ứng dụng và quyền chức năng ("Quyền tiền không suy ra từ quyền ứng dụng."). |
| 2 | Bật thêm "Quản lý nhóm món" (hoặc "Khóa") cho ADMIN-2, chạm "Xem lại và lưu" rồi "Xác nhận lưu". | Hiện "Đã lưu quyền và ghi vào nhật ký." |
| 3 | ADMIN-2 tải lại trang. | Menu/hành động mới xuất hiện đúng quyền vừa cấp. |
| 4 | SYSTEM thu hồi quyền vừa cấp. ADMIN-2 tải lại. | Mục/hành động biến mất; thao tác cũ bị từ chối. |
| 5 | SYSTEM bấm "Thu hồi phiên" của ADMIN-2. | ADMIN-2 bị đăng xuất ở thao tác kế tiếp. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Trả quyền ADMIN-2 về chỉ "Quán - Xem".

**Căn cứ:** `apps/admin-web/src/dom/access-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-010 · SYSTEM khóa và mở khóa tài khoản ADMIN; thu hồi mọi phiên

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #265 (trong ngày: 27) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Có cách chặn ngay một quản trị viên (mất điện thoại, nghỉ việc). |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-006 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | ADMIN-2 đang đăng nhập trên một trình duyệt khác. |
| Dữ liệu nhập | Lý do: "TEST khóa admin". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SYSTEM: "Phân quyền" > ADMIN-2 > "Khóa tài khoản", nhập lý do, xác nhận. | Hiện "Đã thực hiện và ghi vào nhật ký."; trạng thái "đang khóa". |
| 2 | ADMIN-2 thực hiện một thao tác bất kỳ. | Bị đăng xuất/chặn. |
| 3 | ADMIN-2 đăng nhập lại. | Bị từ chối vì tài khoản bị khóa. |
| 4 | SYSTEM "Mở khóa tài khoản ADMIN". | Trạng thái "đang hoạt động"; ADMIN-2 đăng nhập lại được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đảm bảo ADMIN-2 đã được mở khóa.

**Căn cứ:** `apps/admin-web/src/dom/access-view.ts (Khóa tài khoản ADMIN)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-access.int.spec.ts; admin-account-lock.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-025 · SYSTEM đổi bảng phí giao bằng bản nháp rồi áp dụng; đơn cũ không bị tính lại

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #266 (trong ngày: 28) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Bảng phí đổi qua nháp -> áp dụng -> tạo phiên bản bất biến; phí đã chốt của đơn cũ không đổi. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập; ghi bảng giá hiện tại; có một đơn đã chốt phí. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Thay đổi cấu hình thật. Chỉ làm khi Owner cho phép; sau test áp dụng lại bảng phí đúng như ban đầu (sẽ tạo thêm phiên bản mới - đó là bình thường). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở "Phí & điều kiện giao" đổi mức phí khung 1 thêm 1.000đ, bấm "Lưu bản nháp". | Hiện "Đã lưu bản nháp. Bản nháp chưa có hiệu lực cho đến khi bấm "Áp dụng bảng giá"." |
| 2 | Kiểm tra giỏ khách mới. | Phí giỏ vẫn theo bảng cũ vì chưa áp dụng. |
| 3 | Bấm "Áp dụng bảng giá" và xác nhận. | Tạo phiên bản mới (đang áp dụng); phiên bản cũ nằm trong lịch sử. |
| 4 | Khách tạo giỏ mới. | Phí theo bảng mới; đơn cũ đã chốt vẫn giữ phí cũ. |
| 5 | Đặt lại mức phí ban đầu và áp dụng. | Về giá trị ban đầu. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Áp dụng lại đúng bảng phí ban đầu.

**Căn cứ:** `apps/admin-web/src/dom/shipping-policy-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-fee-policy.int.spec.ts; admin-shipping-policy-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-027 · "Cấu hình tập trung": mọi quản trị viên xem, chỉ SYSTEM sửa, có lý do và lịch sử

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #267 (trong ngày: 29) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Một nơi xem mọi tham số hệ thống; mọi thay đổi có lý do và nhật ký. |
| Người thực hiện | SYSTEM, ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM và ADMIN-1 đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: HỆ THỐNG > "Cấu hình tập trung". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | SYSTEM xem các nhóm cấu hình (OTP, Ví Shipper, Điều kiện nhận đơn, Đơn hàng, Thông báo). | Mỗi nhóm hiển thị tham số và phiên bản; có nút "Sửa". |
| 3 | Sửa một tham số vô hại (ví dụ số ngày hiển thị trong hộp thư), nhập lý do bắt buộc, "Xác nhận lưu". | Hiện "Đã lưu cấu hình thành phiên bản mới và ghi vào nhật ký."; "Lịch sử thay đổi" có dòng mới. |
| 4 | Dùng "Hoàn nguyên giá trị này". | Giá trị về như cũ. |
| 5 | ADMIN-1 mở cùng trang. | Xem được nhưng không có nút sửa ("Mọi quản trị viên được xem, chỉ SYSTEM được sửa."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Hoàn nguyên mọi thay đổi thử.

**Căn cứ:** `apps/admin-web/src/dom/config-view.ts; apps/backend/src/admin-config`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-config.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-028 · "Nhật ký hoạt động" (audit): xem, lọc, không sửa được, không lộ bí mật

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #268 (trong ngày: 30) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Ai làm gì và khi nào được ghi lại; nhật ký chỉ xem; không chứa mật khẩu, OTP, khóa bí mật. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-016 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã có các thao tác (khóa/mở khóa, vô hiệu hóa quán, đổi cấu hình). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: HỆ THỐNG > "Nhật ký". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Lọc "Hôm nay", "Kết quả" = "Thành công", rồi "Bị từ chối". | Hiện các bản ghi: Thời gian (giờ Việt Nam), Người thực hiện, Hành động, Đối tượng, Kết quả. |
| 3 | Tìm bản ghi của thao tác vừa làm (ví dụ vô hiệu hóa quán) và mở "Chi tiết". | Có hành động, người làm, lý do (nếu có), trước/sau. KHÔNG có mật khẩu, mã OTP hay khóa bí mật. |
| 4 | Tìm nút sửa/xóa bản ghi. | Không có (chỉ xem). |
| 5 | Chạm "Tải thêm". | Tải thêm bản ghi cũ hơn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/audit-view.ts; apps/backend/src/audit`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-audit-backup.int.spec.ts; audit-writer.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-029 · "Điều hành" và "Báo cáo": số liệu khớp danh sách và xuất CSV/Excel

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #269 (trong ngày: 31) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi con số bấm vào mở đúng danh sách tạo ra nó; báo cáo xuất được và chỉ người có quyền xuất. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Có dữ liệu đơn/giao hàng của các ngày test. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: Tổng quan > "Điều hành". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Chọn khoảng ngày hôm nay (hoặc kỳ test), "Áp dụng". Đọc "Order phát sinh", "Giao thành công", "Giao thất bại", "Tỷ lệ giao thành công", "Hoa hồng đã thu". | Các số hiển thị; không có số "giả". Với mục không có quyền: "Bạn không có quyền xem số này". |
| 3 | Chạm một con số ("Mở danh sách"). | Mở danh sách đã lọc; số dòng khớp con số. |
| 4 | Ở menu bên trái của Web Admin, chọn: Tổng quan > "Báo cáo". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 5 | Chọn một loại báo cáo, khoảng ngày, chạm "Xuất CSV" (và "Xuất Excel"). | Hiện "Đã nhận yêu cầu xuất. File được tạo ở nền…"; file xuất hiện trong "File đã xuất" và tải được ("Tải về"). |
| 6 | Mở file CSV bằng Excel. | Tiếng Việt hiển thị đúng; số liệu khớp màn hình. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/overview-view.ts; reports-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-overview.int.spec.ts; m12-reports.int.spec.ts; admin-m12-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-030 · "Vận hành hệ thống": sức khỏe, sự cố, SMS Gateway, nhật ký, phiên bản

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #270 (trong ngày: 32) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Người phụ trách theo dõi hệ thống (SMS Gateway có sống không, phiên bản đang chạy, sự cố). |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Một số mục cần cấu hình hạ tầng (Discord webhook, máy kiểm tra ngoài, báo cáo từ pipeline). Mục chưa cấu hình phải ghi "Chưa cấu hình"/"Chưa ghi", không hiện số giả. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH HỆ THỐNG > Vận hành hệ thống > "Tổng quan". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Đọc tình trạng các kiểm tra ("Bình thường"/cảnh báo). | Mỗi kiểm tra có trạng thái và bằng chứng/giá trị đo; mục chưa có dữ liệu ghi "Chưa có số đo nào". |
| 3 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH HỆ THỐNG > Vận hành hệ thống > "SMS Gateway". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 4 | Xem thiết bị ghép cặp (pin, SIM, phiên bản, liên lạc gần nhất) và "Chưa có OTP nào trong hàng đợi". | Hiển thị thật; thiết bị offline phải được ghi rõ; số điện thoại người nhận được che bớt. |
| 5 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH HỆ THỐNG > Vận hành hệ thống > "Phiên bản & cập nhật". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 6 | Xem "Các bản phát hành" và phiên bản các thiết bị báo lên. | Có bảng phiên bản; nếu chưa có bản phát hành: "Chưa có bản phát hành nào". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/ops-view.ts; docs/current/M13-implementation-20261023.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m13-ops.int.spec.ts; m13-ops-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-031 · "Sao lưu và phục hồi": xem lịch sử sao lưu và yêu cầu sao lưu ngay (chỉ SYSTEM)

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #271 (trong ngày: 33) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Dữ liệu có bản sao lưu đã được khôi phục thử thành công. Test này KHÔNG yêu cầu khôi phục thật. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | TUYỆT ĐỐI không gửi "Yêu cầu khôi phục dữ liệu" trên môi trường đang có dữ liệu thật. Chỉ xem lịch sử và (nếu Người phụ trách cho phép) "Sao lưu ngay". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: HỆ THỐNG > "Sao lưu và phục hồi". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Đọc "Lịch sử sao lưu" (cột Loại, Mã hóa, Kiểm chứng, Ngoài VPS, Kích thước). | Có bản sao lưu gần nhất ghi "Đạt"/"Có (đã xác minh)" hoặc "Chưa có bản sao lưu" - trung thực, không số giả. |
| 3 | (Nếu được phép) Chạm "Sao lưu ngay". | Hiện "Đã xếp lịch sao lưu ngay. Bản sao được tạo ở nền; trang tự cập nhật khi chạy xong." |
| 4 | KHÔNG gửi yêu cầu khôi phục. Chỉ đọc phần mô tả. | Phần khôi phục nói rõ "Chưa có dữ liệu nào thay đổi" cho đến khi bộ phận vận hành thực hiện. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/backups-view.ts; ops/runbooks/m12-backup-restore-20261023.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-audit-backup.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-032 · Nhật ký lỗi hệ thống ("Giám sát > Nhật ký lỗi")

**Mức độ:** P2 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #272 (trong ngày: 34) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Lỗi do ứng dụng báo lên được thu gọn và lưu cho kỹ thuật viên; không chứa dữ liệu nhạy cảm. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: HỆ THỐNG > Giám sát > "Nhật ký lỗi". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Đọc danh sách lỗi (nếu có). | Mỗi dòng có thời gian, loại lỗi, ứng dụng, phiên bản; không có mật khẩu/OTP/mã thông báo (token) hay số điện thoại đầy đủ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/monitoring-errors-view.ts; docs/current/M13-error-logs-155.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** apps/admin-web/src/core/monitoring-errors.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-033 · Mục "Vùng hoạt động" ghi "Sắp có"

**Mức độ:** P2 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #273 (trong ngày: 35) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Ghi nhận mục menu chưa làm; phải hiện nhãn "Sắp có" và không dẫn tới trang trống. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **NOT READY** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chức năng chưa có theo mã nguồn (menu "Vùng hoạt động" ready:false). Khu vực phục vụ hiện được cấu hình bởi kỹ thuật viên. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của SYSTEM rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: SYSTEM". |
| 4 | Trong nhóm HỆ THỐNG ở menu bên trái tìm "Vùng hoạt động" và chạm vào. | Mục có nhãn "Sắp có", không mở trang nào (nút bị khóa, không dẫn tới trang trống). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/core/menu.ts (soon("zones")); docs/ops/service-area-gps-154.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** apps/admin-web/src/core/menu.spec.ts (nếu có)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-034 · Trang chủ Web Admin sau khi đăng nhập và nội dung hướng dẫn cũ

**Mức độ:** P2 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #274 (trong ngày: 36) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Ghi nhận nội dung chào còn nói "chức năng quản lý dành cho ADMIN sẽ có ở bước sau" dù các chức năng đã có; để Owner quyết định sửa chữ. |
| Người thực hiện | ADMIN-1 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đăng nhập ADMIN-1. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Lệch nội dung: trang chủ ghi "Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau." và với SYSTEM ghi "Các mục có nhãn “Sắp có” sẽ được mở ở bước sau." nhưng nhiều mục đã hoạt động. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của ADMIN-1 rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: ADMIN". |
| 4 | Đọc nội dung trang chủ ngay sau đăng nhập (tiêu đề "Đăng nhập thành công" và hai dòng bên dưới). | Ghi lại nguyên văn; so với các mục thực tế trong menu. Nếu câu chữ gây hiểu nhầm, báo như lỗi mức Thấp. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/shell-app.ts (#home)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Không có.

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-035 · Xóa tài khoản người dùng: chỉ xóa hẳn khi không có dữ liệu liên quan

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #275 (trong ngày: 37) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Tránh mất dữ liệu: tài khoản có đơn/ví chỉ bị khóa; tài khoản chưa có gì mới bị xóa vĩnh viễn. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Một tài khoản rác KH-DEL vừa đăng ký, chưa có đơn/địa chỉ. Một tài khoản có dữ liệu (KH-B đã có đơn). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Xóa vĩnh viễn KHÔNG hoàn tác được. Chỉ dùng tài khoản rác tạo riêng cho test này (đăng ký xong chưa làm gì). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết KH-B (có dữ liệu), bấm "Xóa tài khoản". | Hộp thoại nói rõ "Tài khoản có dữ liệu liên quan: "Xóa tài khoản" không xóa mà chuyển sang khóa theo yêu cầu xóa, giữ nguyên mọi dữ liệu." |
| 2 | Hủy hộp thoại (không xóa KH-B). | Không thay đổi. |
| 3 | Mở chi tiết KH-DEL (chưa có dữ liệu), bấm "Xóa tài khoản" > "Xóa tài khoản?" và xác nhận. | Tài khoản bị xóa vĩnh viễn; số điện thoại đó đăng ký lại sẽ tạo tài khoản mới. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không hoàn tác được; chỉ dùng tài khoản rác.

**Căn cứ:** `apps/admin-web/src/dom/accounts-view.ts (Xóa tài khoản); docs/current/M01-final-package-20261014.md mục 8`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/account-lifecycle.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-009 · Ứng dụng báo "Có bản mới" và cập nhật ngay trong ứng dụng

**Mức độ:** P1 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #276 (trong ngày: 38) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Kiểm tra cơ chế tự báo bản mới (tải, kiểm tra mã an toàn, mở trình cài đặt Android). |
| Người thực hiện | Khách hoặc Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Kỹ thuật viên (tài khoản SYSTEM) đã đăng ký một bản phát hành mới trong Web Admin > Vận hành hệ thống > "Phiên bản & cập nhật" và điện thoại đang chạy bản cũ hơn. Chưa có bản nào được đăng ký thì test này BLOCKED. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở ứng dụng bản cũ, đăng nhập và ở yên trên Trang chủ vài giây. | Hiện thông báo "Có bản mới X.Y.Z" với nút "Cập nhật (… MB)" và "Để sau". |
| 2 | Chạm "Để sau". | Thông báo ẩn đi, ứng dụng dùng bình thường. |
| 3 | Đóng và mở lại ứng dụng. Chạm "Cập nhật". | Hiện "Đang tải..." rồi Android mở trình cài đặt. Nếu Android hỏi cho phép cài ứng dụng thì chọn cho phép rồi bấm "Cập nhật" lại. |
| 4 | Xác nhận cài trong màn hình của Android. | Cài xong, ứng dụng mở lại ở phiên bản mới. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nhờ kỹ thuật viên đặt lại điều kiện phát hành nếu muốn thử lại.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m13/m13_views.dart, m13_update.dart; docs/current/M13-implementation-20261023.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m13_test.dart; tests/integration/m13-ops.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-006 · Web Admin > Thông báo: tra cứu, "Việc cần xử lý" và cấu hình (chỉ SYSTEM sửa)

**Mức độ:** P1 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #277 (trong ngày: 39) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Admin xem thông báo gửi lỗi và hàng cần xử lý; chỉ SYSTEM đổi cấu hình kênh/lưu trữ. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã có thông báo từ các test trước. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Thông báo". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Mở thẻ "Việc cần xử lý". | Hiện "Gửi lỗi" và "Hàng cần xử lý" (sau giao thất bại); nếu không có: "Không có việc cần xử lý". |
| 3 | Mở thẻ tra cứu, tìm theo mã đơn. | Hiện các thông báo của đơn đó: loại, người nhận (che bớt), kênh ("App (hộp thông báo)", "Push điện thoại"), trạng thái, "Lý do chưa gửi được" nếu có. |
| 4 | Mở thẻ "Cấu hình". | SYSTEM sửa được "Bật thông báo đẩy", số ngày hiển thị, số lần thử lại; ADMIN chỉ xem ("Chỉ tài khoản SYSTEM được thay đổi cấu hình."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Hoàn nguyên mọi thay đổi cấu hình thử.

**Căn cứ:** `apps/admin-web/src/dom/notifications-view.ts; docs/current/M08-implementation-20261018.md (M08.06)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-admin-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-010 · Bản bắt buộc cập nhật: ứng dụng bản cũ bị chặn

**Mức độ:** P1 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #278 (trong ngày: 40) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi bản cũ không còn dùng được, ứng dụng phải nói rõ phải cập nhật, và không cho mất đơn đang giao. |
| Người thực hiện | Khách hoặc Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên đã đánh dấu "Bắt buộc cập nhật" cho một bản phát hành mới hơn bản đang cài (Web Admin > Vận hành hệ thống > "Phiên bản & cập nhật"). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở ứng dụng bản cũ khi KHÔNG có đơn đang giao. | Hiện thông báo "Cần cập nhật ứng dụng" hoặc "Cần cập nhật lên X.Y.Z" và dòng "Bản hiện tại không còn dùng được. Cập nhật lên … để tiếp tục." |
| 2 | (Chỉ với shipper) Lặp lại khi shipper đang có một đơn đã nhận. | Hiện "Cần cập nhật X.Y.Z sau khi xong đơn": shipper vẫn hoàn tất được đơn đang giao trước khi cập nhật. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Kỹ thuật viên gỡ cờ "Bắt buộc" hoặc phát hành bản mới.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m13/m13_views.dart (dòng "Cần cập nhật … sau khi xong đơn")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m13_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-032 · SYSTEM tắt/bật bắt buộc OTP khi đăng ký (công tắc hệ thống)

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #279 (trong ngày: 41) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Công tắc này quyết định đăng ký có bắt buộc mã OTP hay không. Phải thử cả hai trạng thái và luôn trả về Bật. |
| Người thực hiện | SYSTEM + Khách |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Owner đồng ý. SYSTEM đăng nhập Web Admin. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Thay đổi cấu hình thật của hệ thống. Chỉ làm khi Owner cho phép bằng văn bản; bắt buộc bật lại ngay sau test. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Web Admin > HỆ THỐNG > "Cài đặt hệ thống". Quan sát nhóm "Xác thực số điện thoại". | Có hai công tắc "OTP khi đăng ký" và "OTP khi quên mật khẩu" (mặc định Bật) cùng "Lịch sử thay đổi". |
| 2 | Tắt "OTP khi đăng ký", lưu. | Hiện "Đã lưu. Thay đổi có hiệu lực ngay, không cần khởi động lại máy chủ." |
| 3 | Trên điện thoại mở màn đăng ký bước 3/3. | Hiện thông báo "Đăng ký không cần mã xác minh - Số điện thoại sẽ ở trạng thái chưa xác minh…". Không có ô OTP. |
| 4 | Bật lại "OTP khi đăng ký", lưu. | Đã lưu; đăng ký lại cần OTP như cũ. |
| 5 | Kiểm tra "Lịch sử thay đổi". | Có hai dòng thay đổi (tắt rồi bật), ghi người thực hiện và thời gian. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Nếu sau test công tắc không về Bật thì ghi lỗi nghiêm trọng và bật lại ngay.

**Cách khôi phục để chạy lại:** Công tắc "OTP khi đăng ký" và "OTP khi quên mật khẩu" phải ở trạng thái Bật.

**Căn cứ:** `apps/admin-web/src/dom/settings-view.ts; docs/current/M01-final-package-20261014.md (mục 1, 4)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/auth-config-process.int.spec.ts; admin-activation-phone-mode.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-005 · Phiên Web Admin hết hạn khi bỏ không và sau khi đăng xuất

**Mức độ:** P1 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #280 (trong ngày: 42) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Phiên quản trị không tồn tại vĩnh viễn; đăng xuất xong không dùng lại được bằng nút Back. |
| Người thực hiện | ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | ADMIN-1 đang đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Thời hạn phiên quản trị do cấu hình; hỏi Người phụ trách để biết thời gian chờ. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng xuất, rồi bấm nút Back của trình duyệt. | Không xem được dữ liệu quản trị; quay về đăng nhập. |
| 2 | Đăng nhập lại, để yên không thao tác trong thời gian phiên cho phép rồi thao tác. | Bị yêu cầu đăng nhập lại. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/backend/src/admin-auth; docs/current/ADR-002-auth-security-foundation.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-auth.int.spec.ts; admin-expiry-after-locks.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-006 · Số điện thoại và tài khoản ngân hàng được che bớt ở Web Admin

**Mức độ:** P1 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #281 (trong ngày: 43) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Giảm lộ thông tin cá nhân; chỉ người có quyền xử lý mới thấy đầy đủ. |
| Người thực hiện | ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ADM-012 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | ADMIN-2 (không có quyền xem liên hệ) đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở danh sách người dùng, quán, shipper, yêu cầu nạp/rút. | Số điện thoại hiển thị dạng che bớt; số tài khoản ngân hàng che bớt ("Số tài khoản được che."). |
| 2 | Mở chi tiết giao hàng DIRECT. | Liên hệ người nhận hiện "Ẩn: tài khoản này không có quyền xem liên hệ". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom (finance-ops-view.ts, deliveries-view.ts)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-007 · Chính sách quyền riêng tư nói "không theo dõi vị trí nền" nhưng 11Ship chia sẻ vị trí khi online

**Mức độ:** P1 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #282 (trong ngày: 44) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nội dung chính sách phải đúng với hành vi thật: shipper đang online gửi vị trí khoảng 1 phút một lần, kể cả khi khóa màn hình. Cần Owner xác nhận chính sách đã bao quát việc này. |
| Người thực hiện | Shipper + Người phụ trách |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đăng nhập 11Ship. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Lệch tài liệu-mã nguồn: kPrivacyText ghi "ứng dụng không theo dõi vị trí nền" (nói về hồ sơ quán), còn 11Ship có dịch vụ chia sẻ vị trí nền khi bật online (M14). Chỉ ghi nhận, không phải lỗi người kiểm thử. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong màn đăng ký hoặc "Chính sách và điều khoản" đọc đoạn "Chính sách quyền riêng tư" liên quan đến vị trí. | Ghi lại nguyên văn câu nói về vị trí. |
| 2 | Trên Trang chủ 11Ship đọc lời giải thích dưới nút "Bật online" và chạm "Bật online". | Có thông báo "Bật online sẽ chia sẻ vị trí của bạn khoảng 1 phút một lần, kể cả khi khóa màn hình…" (shipper được báo trước khi bật). Sau khi bật hiện thông báo thường trực của dịch vụ vị trí. |
| 3 | Đối chiếu hai nội dung và ghi nhận có mâu thuẫn hay không. | Nếu chính sách nói không theo dõi vị trí nền mà app vẫn chia sẻ nền: báo CÂU HỎI mức CAO cho Owner; shipper vẫn được báo trước khi bật. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tắt online.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (kPrivacyText); mobile/ship/lib/ship_home.dart (home-online-disclosure); docs/current/M14-online-location-20261024.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Không có.

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-001 · Đối chiếu CI: nhận đơn đồng thời, hủy/nhận/lấy hàng/hoàn thành xung đột

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #283 (trong ngày: 45) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Rủi ro "hai người cùng thao tác" khó tái hiện chính xác bằng tay. |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/m07-delivery.int.spec.ts, m10-orders.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: hai shipper nhận cùng đơn; hủy và nhận cùng lúc; hoàn thành hai lần. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/m07-delivery.int.spec.ts, m10-orders.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts, m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-002 · Đối chiếu CI: chống xử lý lặp (idempotency) và mất phản hồi

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #284 (trong ngày: 46) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Bấm lặp, gửi lại khi mất phản hồi không tạo bản ghi trùng. |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/idempotency-executor.int.spec.ts, idempotency-replay-guard.int.spec.ts, idempotency-commit-unknown.int.spec.ts, admin-lost-response.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: đơn trùng, yêu cầu giao trùng, hoa hồng trùng, nạp/rút trùng. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/idempotency-executor.int.spec.ts, idempotency-replay-guard.int.spec.ts, idempotency-commit-unknown.int.spec.ts, admin-lost-response.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/idempotency-executor.int.spec.ts, idempotency-replay-guard.int.spec.ts, idempotency-commit-unknown.int.spec.ts, admin-lost-response.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-003 · Đối chiếu CI: sổ cái ví, tạm giữ, nạp, rút và đối soát

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #285 (trong ngày: 47) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Sai số dư/tiền tự tăng giảm không được xảy ra. |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/m04-wallet-core.int.spec.ts, m04-wallet-holds.int.spec.ts, m04-wallet-topup-sources.int.spec.ts, m04-topup-requests.int.spec.ts, m04-admin-topup.int.spec.ts, m04-withdrawals.int.spec.ts, m11-adjustment-real.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: số dư âm, hoa hồng hai lần, nạp hai lần, rút hai lần, lệch sổ. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/m04-wallet-core.int.spec.ts, m04-wallet-holds.int.spec.ts, m04-wallet-topup-sources.int.spec.ts, m04-topup-requests.int.spec.ts, m04-admin-topup.int.spec.ts, m04-withdrawals.int.spec.ts, m11-adjustment-real.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-wallet-core.int.spec.ts, m04-wallet-holds.int.spec.ts, m04-wallet-topup-sources.int.spec.ts, m04-topup-requests.int.spec.ts, m04-admin-topup.int.spec.ts, m04-withdrawals.int.spec.ts, m11-adjustment-real.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-004 · Đối chiếu CI: quyền người dùng và quyền quản trị

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #286 (trong ngày: 48) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Sai quyền (xem/sửa dữ liệu không được phép). |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/m12-access.int.spec.ts, m04-finance-access.int.spec.ts, admin-business-decisions.int.spec.ts, admin-account-lock.int.spec.ts, admin-shops.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: ADMIN vượt quyền SYSTEM; thao tác tiền không có quyền riêng. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/m12-access.int.spec.ts, m04-finance-access.int.spec.ts, admin-business-decisions.int.spec.ts, admin-account-lock.int.spec.ts, admin-shops.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-access.int.spec.ts, m04-finance-access.int.spec.ts, admin-business-decisions.int.spec.ts, admin-account-lock.int.spec.ts, admin-shops.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-005 · Đối chiếu CI: giao nhận sự kiện (outbox) và thông báo không mất, không trùng

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #287 (trong ngày: 49) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Thông báo gửi nhầm/trùng/mất khi hệ thống lỗi giữa chừng. |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/outbox-dispatch-at-least-once.int.spec.ts, outbox-dispatch-crash-matrix.int.spec.ts, m08-notifications.int.spec.ts, m08-admin-notifications.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: sự kiện bị mất/nhân đôi; thông báo sai người. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/outbox-dispatch-at-least-once.int.spec.ts, outbox-dispatch-crash-matrix.int.spec.ts, m08-notifications.int.spec.ts, m08-admin-notifications.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/outbox-dispatch-at-least-once.int.spec.ts, outbox-dispatch-crash-matrix.int.spec.ts, m08-notifications.int.spec.ts, m08-admin-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-006 · Đối chiếu CI: nâng cấp cơ sở dữ liệu giữ nguyên dữ liệu

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #288 (trong ngày: 50) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Cập nhật phần mềm không làm mất dữ liệu đã có. |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/migration.int.spec.ts, staging-db-upgrade-from-42.int.spec.ts, remote-migration-runner.int.spec.ts, m07-topup-upgrade.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: mất/đổi dữ liệu khi nâng cấp. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/migration.int.spec.ts, staging-db-upgrade-from-42.int.spec.ts, remote-migration-runner.int.spec.ts, m07-topup-upgrade.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/migration.int.spec.ts, staging-db-upgrade-from-42.int.spec.ts, remote-migration-runner.int.spec.ts, m07-topup-upgrade.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-AUTO-007 · Đối chiếu CI: sao lưu, nhật ký (audit) không sửa/xóa được

**Mức độ:** P1 · **Nhóm:** Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) · **Số thứ tự chạy:** #289 (trong ngày: 51) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nhật ký chỉ thêm, bản sao lưu kiểm chứng được. |
| Người thực hiện | Kỹ thuật viên (KHÔNG dành cho người kiểm thử mới) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Tự động đã có (đối chiếu) |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Kỹ thuật viên có quyền xem GitHub Actions của dự án và đúng mã nguồn (commit) của bản đang thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Test này chỉ ghi nhận kết quả bộ kiểm thử tự động đã có cho rủi ro khó thử bằng tay. Kết quả xanh KHÔNG thay thế các test thủ công liên quan và KHÔNG đủ để nghiệm thu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Kỹ thuật viên mở trang GitHub Actions của dự án, chọn lần chạy "CI" của ĐÚNG commit đang thử (đối chiếu mã commit với phiên bản đã ghi). | Lần chạy có mã commit trùng với bản đang thử. |
| 2 | Mở công việc "Verify (Node 24, PostgreSQL 17)" và tìm kết quả các bộ test: tests/integration/m12-audit-backup.int.spec.ts, audit-writer.int.spec.ts, audit-outbox-atomicity.int.spec.ts. | Các bộ test liên quan đều "passed", không có test bị bỏ qua (skipped) ngoài ngoại lệ đã ghi trong README. |
| 3 | Ghi lại đường dẫn lần chạy và mã commit vào cột "Đường dẫn bằng chứng". | Có đường dẫn bằng chứng. |
| 4 | Đối chiếu rủi ro: sửa/xóa nhật ký; thao tác không có nhật ký. | Rủi ro này được bộ kiểm thử bao phủ; các test thủ công liên quan (xem DOI_CHIEU_CODE_TESTCASE.md) vẫn phải chạy riêng. |

**Cách kết luận:** PASS (đối chiếu): các bộ test liên quan xanh trên đúng commit. FAIL: bất kỳ bộ test nào đỏ, hoặc commit không khớp bản đang thử. Không được dùng kết quả này để tuyên bố đạt nghiệm thu.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `.github/workflows/ci.yml; tests/integration/m12-audit-backup.int.spec.ts, audit-writer.int.spec.ts, audit-outbox-atomicity.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m12-audit-backup.int.spec.ts, audit-writer.int.spec.ts, audit-outbox-atomicity.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---
