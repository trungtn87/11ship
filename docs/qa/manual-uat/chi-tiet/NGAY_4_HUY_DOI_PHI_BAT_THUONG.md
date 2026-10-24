# Ngày 4 - Hủy đơn, đổi phí, các tình huống bất thường

Tài liệu này là bản ĐỌC ĐƯỢC của các test case trong file `TESTCASE_11SHIP.csv` (cùng nội dung). Làm lần lượt từ trên xuống dưới vì các test sau dùng dữ liệu của test trước.
Trước khi bắt đầu: đọc `HUONG_DAN_KIEM_THU_11SHIP.md` (nhất là mục chuẩn bị tài khoản, tiền thử nghiệm và cách báo lỗi).

Tổng số test case trong ngày: **71** (P0: 38, P1: 27, P2: 6).

| # | Mã | Tên | Mức | Cần | Sẵn sàng |
|---|---|---|---|---|---|
| 1 | TC-ADM-026 | Cài đặt "Thời hạn xử lý đơn" và "Thời gian trả lời đề xuất phí": kiểm tra giá trị và quyền | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 2 | TC-FLOW-005 | Không có shipper nhận: sau 30 phút hệ thống ngừng tìm, đơn món không bị hủy | P0 | 3 ĐT | SẴN SÀNG |
| 3 | TC-FLOW-006 | Sau khi ngừng tìm, quán gọi lại shipper và có người nhận | P0 | 2 ĐT | SẴN SÀNG |
| 4 | TC-FLOW-007 | Đơn khách đặt, QUÁN trả phí: shipper đề xuất phí mới và quán ĐỒNG Ý | P0 | 3 ĐT | SẴN SÀNG |
| 5 | TC-FLOW-008 | Đơn khách đặt, QUÁN trả phí: quán TỪ CHỐI đề xuất phí của shipper | P0 | 2 ĐT | SẴN SÀNG |
| 6 | TC-FLOW-009 | Đơn khách đặt, KHÁCH trả phí: khách ĐỒNG Ý đề xuất phí trong 11Food | P0 | 3 ĐT | SẴN SÀNG |
| 7 | TC-FLOW-010 | Đơn khách đặt, KHÁCH trả phí: khách TỪ CHỐI đề xuất phí | P0 | 2 ĐT | SẴN SÀNG |
| 8 | TC-FLOW-011 | Quán không được trả lời thay khi KHÁCH là người trả phí của đơn khách đặt | P1 | 1 ĐT | SẴN SÀNG |
| 9 | TC-FLOW-012 | Đề xuất phí quá hạn trả lời: giữ phí cũ, shipper bị gỡ, không hủy đơn | P1 | 2 ĐT | SẴN SÀNG |
| 10 | TC-FLOW-013 | Quán gọi shipper (DIRECT), QUÁN trả phí: shipper đề xuất, quán đồng ý rồi từ chối | P0 | 2 ĐT | SẴN SÀNG |
| 11 | TC-FLOW-014 | Quán gọi shipper (DIRECT), KHÁCH trả phí nhưng không có tài khoản: quán xác nhận thay khách | P0 | 2 ĐT | SẴN SÀNG |
| 12 | TC-FLOW-015 | Shipper đề xuất phí SAU khi nhận đơn, trước khi lấy hàng: chưa lấy hàng được cho đến khi có trả lời | P0 | 2 ĐT | SẴN SÀNG |
| 13 | TC-FLOW-016 | Shipper bỏ lượt nhận (hủy nhận) rồi shipper khác nhận; đồng hồ tìm không bị tính lại | P0 | 3 ĐT | SẴN SÀNG |
| 14 | TC-FLOW-017 | Quán hủy yêu cầu giao khi shipper đã nhận nhưng chưa lấy hàng (đơn ORDER vẫn còn) | P0 | 3 ĐT | SẴN SÀNG |
| 15 | TC-FLOW-018 | Quán hủy đơn món khi shipper đã nhận nhưng chưa lấy hàng | P0 | 3 ĐT | SẴN SÀNG |
| 16 | TC-FLOW-019 | Khách hủy đơn SAU khi shipper đã lấy hàng (đơn ORDER) | P0 | 3 ĐT | SẴN SÀNG |
| 17 | TC-FLOW-020 | Quán hủy yêu cầu giao (DIRECT) SAU khi shipper đã lấy hàng, rồi xử lý hàng | P0 | 2 ĐT | SẴN SÀNG |
| 18 | TC-FLOW-021 | Chủ quán KHÔNG hủy được đơn khách đặt sau khi shipper đã lấy hàng | P0 | 1 ĐT | SẴN SÀNG |
| 19 | TC-FLOW-022 | Hàng sau khi đơn bị hủy: "Đã xử lý, không giao tiếp" và Admin đóng "Không hoàn tất" | P1 | 1 ĐT | SẴN SÀNG |
| 20 | TC-FLOW-023 | Thông báo đến đúng người, đúng đơn, đúng nội dung trong cả luồng | P0 | 3 ĐT | SẴN SÀNG |
| 21 | TC-FLOW-024 | Không tạo trùng đơn / trùng yêu cầu giao khi bấm nhiều lần | P0 | 2 ĐT | SẴN SÀNG |
| 22 | TC-FLOW-025 | Mất mạng đúng lúc khách gửi đơn: ứng dụng báo "chưa biết đơn đã gửi chưa" và không tạo đơn thứ hai | P0 | 1 ĐT | SẴN SÀNG |
| 23 | TC-FLOW-026 | Hoa hồng của shipper: giữ chỗ khi nhận, trả lại khi hủy, thu đúng một lần khi hoàn thành | P0 | 2 ĐT | SẴN SÀNG |
| 24 | TC-FLOW-027 | Đơn hẹn giờ chạy trọn luồng: đặt, quán xác nhận, gọi shipper, giao | P1 | 3 ĐT | SẴN SÀNG |
| 25 | TC-FLOW-028 | Đơn ORDER chưa tính được phí giao (thiếu ghim/tuyến): quán phải đề xuất phí để gọi được shipper | P1 | 3 ĐT | SẴN SÀNG |
| 26 | TC-FLOW-029 | SYSTEM tự hủy đơn: chờ quán quá lâu và chờ shipper quá lâu | P1 | 2 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 27 | TC-FLOW-030 | Shipper đang giữ một đơn nhận thêm đơn thứ hai (giới hạn số đơn cùng lúc) | P2 | 2 ĐT | CẦN XÁC MINH |
| 28 | TC-NOTI-001 | Thông báo đẩy (push) tới điện thoại khi tắt màn hình | P1 | 3 ĐT | CẦN XÁC MINH |
| 29 | TC-NOTI-002 | Hộp thông báo trong ứng dụng đồng bộ khi mở lại và cập nhật trực tiếp | P0 | 3 ĐT | SẴN SÀNG |
| 30 | TC-NOTI-003 | Tắt nhóm thông báo: thông báo vẫn vào hộp thư nhưng không đẩy | P1 | 1 ĐT | SẴN SÀNG |
| 31 | TC-NOTI-004 | Quyền thông báo của điện thoại bị tắt: ứng dụng hướng dẫn bật | P1 | 1 ĐT | SẴN SÀNG |
| 32 | TC-NOTI-005 | Sau khi đăng xuất, máy không còn nhận thông báo của tài khoản cũ | P0 | 2 ĐT | SẴN SÀNG |
| 33 | TC-NOTI-007 | Thông báo dừng tìm shipper và nhắc 5/15 phút tới quán | P1 | 2 ĐT | SẴN SÀNG |
| 34 | TC-SHOP-036 | Quán xác nhận hàng đã về / đã xử lý sau khi hủy giao đã lấy hàng | P0 | 1 ĐT | SẴN SÀNG |
| 35 | TC-ACC-026 | Đăng nhập lại khi đang có đơn đang giao: đơn không mất | P0 | 3 ĐT | SẴN SÀNG |
| 36 | TC-DRV-025 | Shipper nhắc "chưa lấy hàng" sau khi nhận đơn | P2 | 1 ĐT | SẴN SÀNG |
| 37 | TC-ACC-027 | Phiên bị thu hồi khi Admin khóa tài khoản đang đăng nhập | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 38 | TC-ACC-031 | Khôi phục tài khoản đã bị khóa theo yêu cầu xóa | P2 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 39 | TC-ADM-013 | Khóa tài khoản bị chặn khi tài khoản còn đơn đang xử lý | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 40 | TC-ADM-016 | Admin vô hiệu hóa và kích hoạt lại quán | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 41 | TC-ADM-018 | Admin "Khóa hoạt động" và "Mở lại" shipper; "Nhận đơn" bị tắt | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 42 | TC-DRV-021 | Shipper bị Admin khóa: không nhận đơn mới nhưng vẫn xem ví | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 43 | TC-ADM-036 | Admin xử lý yêu cầu giao: giải phóng shipper, ghi nhận hàng, điều chỉnh sau lấy hàng, chuyển phản ánh | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 44 | TC-ADM-022 | Admin hủy đơn món và đóng "Không hoàn tất" (cần lý do, cần quyền) | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 45 | TC-CUS-014 | Quán bị Admin vô hiệu hóa không còn hiện cho khách | P0 | 1 ĐT | SẴN SÀNG |
| 46 | TC-ABN-001 | Mất Internet khi đang xem quán và giỏ hàng (khách) | P0 | 1 ĐT | SẴN SÀNG |
| 47 | TC-ABN-002 | Shipper mất Internet lúc bấm "Giao thành công" hoặc "Đã nhận hàng" | P0 | 1 ĐT | SẴN SÀNG |
| 48 | TC-ABN-003 | Quán mất mạng lúc bấm "Xác nhận đơn" hoặc "Gọi shipper" | P0 | 1 ĐT | SẴN SÀNG |
| 49 | TC-ABN-004 | Tắt đột ngột ứng dụng 11Ship khi đang giao: đơn không mất, vị trí tiếp tục được chia sẻ | P0 | 2 ĐT | SẴN SÀNG |
| 50 | TC-ABN-005 | Khởi động lại điện thoại shipper khi đang online hoặc đang có đơn | P1 | 1 ĐT | SẴN SÀNG |
| 51 | TC-ABN-006 | GPS tắt giữa lúc shipper đang giữ đơn | P0 | 2 ĐT | SẴN SÀNG |
| 52 | TC-ABN-007 | GPS yếu (trong nhà / dưới hầm): không có vị trí nhưng ứng dụng không treo | P1 | 1 ĐT | SẴN SÀNG |
| 53 | TC-ABN-008 | Vị trí giả (ứng dụng giả GPS) bị từ chối | P2 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 54 | TC-ABN-009 | Máy chủ phản hồi chậm hoặc không sẵn sàng | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 55 | TC-ABN-010 | Hai người cùng thao tác một đơn: quán hủy trong lúc shipper bấm "Nhận đơn" | P0 | 2 ĐT | SẴN SÀNG |
| 56 | TC-ABN-011 | Khách hủy đơn trong lúc quán bấm "Xác nhận đơn" | P0 | 2 ĐT | SẴN SÀNG |
| 57 | TC-ABN-012 | Hai quản trị viên cùng sửa một dữ liệu: người sau nhận cảnh báo "đã thay đổi ở nơi khác" | P1 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 58 | TC-ABN-013 | Bấm nhiều lần liên tiếp vào các nút quan trọng ("Nhận đơn", "Đã nhận hàng", "Giao thành công", "Xác nhận đơn") | P0 | 2 ĐT | SẴN SÀNG |
| 59 | TC-ABN-014 | Chuyển ứng dụng 11Ship sang chạy nền và khóa màn hình: vẫn nhận đơn và chia sẻ vị trí | P0 | 2 ĐT | SẴN SÀNG |
| 60 | TC-ABN-015 | Bật chế độ tiết kiệm pin: vị trí và thông báo vẫn hoạt động (hoặc báo rõ giới hạn) | P1 | 1 ĐT | SẴN SÀNG |
| 61 | TC-ABN-016 | Nhập ký tự đặc biệt, rất dài hoặc kiểu "mã độc" vào các ô văn bản | P1 | 2 ĐT | SẴN SÀNG |
| 62 | TC-ABN-017 | Điện thoại có giờ sai (đồng hồ lệch nhiều) | P1 | 1 ĐT | SẴN SÀNG |
| 63 | TC-ABN-018 | Chạy trên các phiên bản Android khác nhau (8, 10, 12, 13, 14) | P1 | 1 ĐT | CẦN XÁC MINH |
| 64 | TC-ABN-019 | Màn hình nhỏ, cỡ chữ lớn và xoay ngang | P2 | 1 ĐT | SẴN SÀNG |
| 65 | TC-ABN-020 | Chủ quán đăng nhập trên điện thoại khác: phiên cũ kết thúc, quán không mất đơn | P1 | 2 ĐT | SẴN SÀNG |
| 66 | TC-ABN-021 | Hai màn hình mở cùng một đơn: thao tác trên màn đã cũ bị yêu cầu tải lại | P1 | 2 ĐT | SẴN SÀNG |
| 67 | TC-ABN-022 | Nút Back và đóng hộp thoại giữa chừng không làm mất hoặc gửi nhầm thao tác | P2 | 1 ĐT | SẴN SÀNG |
| 68 | TC-SEC-001 | Quán này không thấy đơn và yêu cầu giao của quán khác | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 69 | TC-SEC-002 | Shipper này không thấy đơn đang giữ của shipper khác | P0 | 2 ĐT | SẴN SÀNG |
| 70 | TC-SEC-003 | Người dùng không thấy mã tra cứu/UUID/mã kỹ thuật trên màn hình | P1 | 1 ĐT | SẴN SÀNG |
| 71 | TC-SEC-004 | Mật khẩu luôn bị ẩn và không hiện trong thông báo hay chẩn đoán | P1 | 1 ĐT | SẴN SÀNG |

---

### TC-ADM-026 · Cài đặt "Thời hạn xử lý đơn" và "Thời gian trả lời đề xuất phí": kiểm tra giá trị và quyền

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #168 (trong ngày: 1) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Các thời hạn tự hủy/nhắc phải nhập đúng ràng buộc; thay đổi có lịch sử và chỉ áp dụng cho giai đoạn mới. |
| Người thực hiện | SYSTEM, ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập. |
| Dữ liệu nhập | Giá trị hợp lệ: số nguyên 1-1440 phút. Thử sai: 0, 1441, "abc"; mốc nhắc lớn hơn mốc hủy. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: HỆ THỐNG > "Thời hạn xử lý đơn". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Đọc 7 ô: "Chờ quán: bắt đầu nhắc / nhắc lại mỗi / tự hủy sau", "Chờ shipper: dừng tìm / tự hủy đơn sau", "Đã nhận: cảnh báo chưa lấy hàng sau / tự hủy khi chưa lấy hàng sau". | Giá trị mặc định 15/5/30, 30/60, 30/60 (hoặc giá trị hiện hành); có dòng "Mốc nhắc phải trước mốc hủy; dừng tìm không được sau mốc hủy." |
| 3 | Nhập giá trị sai (0, 1441, chữ, nhắc > hủy) rồi "Lưu thời hạn". | Không lưu; báo lỗi giá trị cụ thể. |
| 4 | Nhập giá trị hợp lệ khác và lưu. | Hiện "Đã lưu. Áp dụng cho giai đoạn mới."; có dòng mới trong "Lịch sử thay đổi" (phiên bản, cũ -> mới). |
| 5 | Mở "Cấu hình tập trung", tìm dòng "Thời gian trả lời đề xuất phí" và đổi thành 6 phút có lý do; sau đó đặt lại 5. | Lưu thành công; ADMIN chỉ xem được. |
| 6 | Đặt lại toàn bộ thời hạn về giá trị ban đầu. | Về mặc định. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đặt lại mọi thời hạn về giá trị ban đầu.

**Căn cứ:** `apps/admin-web/src/dom/order-timeouts-page.ts; apps/admin-web/src/core/config.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts (timeouts); admin tests (order timeouts; config-orders.spec.ts)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-005 · Không có shipper nhận: sau 30 phút hệ thống ngừng tìm, đơn món không bị hủy

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #169 (trong ngày: 2) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn không ai nhận thì dừng tìm và báo quán, khách; quán quyết định gọi lại hay hủy; đơn món chưa tự hủy ở mốc này. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-022 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đơn đã được quán xác nhận ("Đang chuẩn bị"). TẤT CẢ shipper đang OFFLINE (SP-A tắt online). Ghi giờ bắt đầu. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Mặc định dừng tìm sau 30 phút. Để rút ngắn: SYSTEM vào Web Admin > "Thời hạn xử lý đơn" đặt "Chờ shipper: dừng tìm / cảnh báo (phút)" nhỏ (ví dụ 3) và "Chờ shipper: tự hủy đơn sau (phút)" lớn hơn (ví dụ 10) - xong test PHẢI đặt lại 30/60. Giai đoạn đang chạy giữ cấu hình lúc bắt đầu, nên đặt TRƯỚC khi gọi shipper. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 (máy QUÁN), trong chi tiết đơn đang "Đang chuẩn bị", chạm "Gọi shipper". | Hộp thoại "Gọi shipper" hỏi "Ai trả phí giao? ..." với hai nút "Khách trả phí" và "Quán trả phí". KHÔNG có bước/nút "Món đã sẵn sàng" riêng. |
| 2 | Chạm "Quán trả phí". | Đơn hiện phần giao hàng với trạng thái "Đang tìm shipper"; hiện phí giao theo bảng giá và người trả phí đúng như đã chọn; có đồng hồ/ghi chú thời gian tìm shipper. |
| 3 | Khách và quán mở chi tiết đơn, ghi giờ. Chờ đến khoảng phút thứ 5 và 15 (nếu dùng thời gian mặc định) rồi mở hộp "Thông báo" của quán. | Quán nhận nhắc "đang tìm shipper" ở phút 5 và phút 15 (nếu dùng cấu hình rút ngắn thì các mốc nhắc tương ứng). |
| 4 | Chờ đến mốc dừng tìm (30 phút hoặc mốc đã rút ngắn). | Yêu cầu giao chuyển "Đã ngừng tìm shipper". Quán thấy "Chưa tìm được shipper - Đơn món vẫn còn. Bạn có thể gọi lại shipper hoặc hủy đơn món." Khách thấy "Chưa tìm được shipper — quán đang xử lý." |
| 5 | Kiểm tra trạng thái đơn món. | Đơn món KHÔNG bị hủy: vẫn "Đang chuẩn bị" (hoặc hiển thị chưa tìm được shipper). |
| 6 | Bật online SP-A rồi mở "Có thể nhận". | Không thấy đơn đã ngừng tìm. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đặt lại cấu hình thời hạn về 30/60 phút (nếu đã sửa). Quán "Hủy đơn món" hoặc làm tiếp TC-FLOW-006.

**Căn cứ:** `docs/current/M10-timeouts-20261021.md; docs/current/M07-implementation-20261018.md mục 4; apps/backend/src/delivery (sweeper)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-006 · Sau khi ngừng tìm, quán gọi lại shipper và có người nhận

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #170 (trong ngày: 3) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán bấm "Gọi lại shipper" để tạo lần tìm mới; lần tìm cũ vẫn nằm trong lịch sử. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-005 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn món ở trạng thái "Chưa tìm được shipper" (kết quả TC-FLOW-005). SP-A đủ điều kiện, sẽ online ở bước 2. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chủ quán mở đơn, chạm "Gọi lại shipper", chọn người trả phí. | Tạo lần tìm mới: "Lần gọi shipper thứ 2", trạng thái "Đang tìm shipper"; lần gọi trước vẫn hiện trong lịch sử gọi. Chỉ một yêu cầu giao đang hoạt động. |
| 2 | SP-A bật online, mở "Có thể nhận", chạm "Nhận đơn". | Nhận được đơn (chỉ một thẻ, không trùng). |
| 3 | Hoàn tất giao như TC-FLOW-001 (Đã nhận hàng, Giao thành công). | Đơn hoàn thành đúng một lần. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (Gọi lại shipper); apps/backend/src/orders/order-delivery-adapter.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-007 · Đơn khách đặt, QUÁN trả phí: shipper đề xuất phí mới và quán ĐỒNG Ý

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #171 (trong ngày: 4) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper không đồng ý phí theo bảng, đề xuất phí khác; người trả phí (quán) đồng ý thì phí của đơn đổi và shipper tiếp tục. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Quán đã gọi shipper cho một đơn ORDER với "Quán trả phí" (làm các bước 1-3 của TC-FLOW-001 xong tới "Đang tìm shipper"). SP-A online đủ điều kiện. |
| Dữ liệu nhập | Shipper đề xuất mức phí cao hơn phí bảng 5.000đ (ví dụ phí bảng 15.000đ thì đề xuất 20000). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper: "Đơn hàng" > "Có thể nhận", trên thẻ đơn chạm "Đề xuất mức phí khác", nhập mức phí đề xuất, chạm "Gửi đề xuất". | Hiện "Bạn đã đề xuất … (phí hiện tại …), đang chờ Quán (người trả phí) trả lời." Đơn được giữ cho riêng shipper này trong lúc chờ (shipper khác không nhận được). |
| 2 | Quán mở đơn. | Hiện thẻ "Shipper đề xuất đổi phí giao" với mức đề xuất, mức hiện tại, hạn trả lời, nút "Đồng ý" và "Từ chối". |
| 3 | Khách mở đơn. | Khách chỉ được báo tiến độ (không phải người quyết định vì quán trả phí). |
| 4 | Quán chạm "Đồng ý". | Phí của đơn đổi đúng bằng mức đề xuất; thẻ đề xuất biến mất. |
| 5 | Shipper kiểm tra thẻ đơn. | Phí giao đã là mức mới; nút "Nhận đơn" bấm được. Chạm "Nhận đơn". |
| 6 | Hoàn tất lấy hàng và giao thành công như TC-FLOW-001. | Hoàn thành; phí giao hiển thị ở khách/quán/shipper đều bằng mức đã đồng ý; hoa hồng thu một lần. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu phí cuối cùng khác mức đã đồng ý, hoặc hai shipper cùng nhận.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục II (nhánh đề xuất phí), Addendum 2026-10-24; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (Shipper đề xuất đổi phí giao)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-008 · Đơn khách đặt, QUÁN trả phí: quán TỪ CHỐI đề xuất phí của shipper

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #172 (trong ngày: 5) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Từ chối thì giữ phí cũ, shipper đề xuất không còn giữ đơn, đơn tiếp tục tìm shipper khác, KHÔNG hủy đơn món và KHÔNG tính lại 30 phút. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-007 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Như bước 1-2 của TC-FLOW-007: SP-A đã gửi đề xuất, quán đang thấy thẻ "Shipper đề xuất đổi phí giao". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán chạm "Từ chối" (và xác nhận nếu có hộp thoại). | Thẻ đề xuất biến mất; phí đơn vẫn là mức cũ; đơn vẫn "Đang tìm shipper". |
| 2 | Shipper kiểm tra. | Thẻ đơn không còn do SP-A giữ; hiện ở lịch sử "Phí không được đồng ý". SP-A nhận được thông báo kết quả bị từ chối. |
| 3 | Kiểm tra đồng hồ tìm shipper của đơn. | Thời gian tìm KHÔNG được tính lại (vẫn đếm theo lần gọi ban đầu). |
| 4 | Một shipper khác (SP-B đã nạp tiền, hoặc SP-A) nhận lại đơn ở mức phí cũ. | Nhận được với phí cũ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md Addendum (2) mục 1; apps/backend/src/delivery/delivery-handback.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-009 · Đơn khách đặt, KHÁCH trả phí: khách ĐỒNG Ý đề xuất phí trong 11Food

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #173 (trong ngày: 6) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Người trả phí là khách thì khách (không phải quán) quyết định đề xuất phí của shipper, ngay trong 11Food. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-002 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Quán đã gọi shipper cho đơn ORDER với "Khách trả phí" (đang "Đang tìm shipper"). SP-A online. |
| Dữ liệu nhập | Shipper đề xuất phí cao hơn bảng 5.000đ. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper chạm "Đề xuất mức phí khác" trên thẻ đơn, nhập mức, "Gửi đề xuất". | Hiện "đang chờ Khách (người trả phí) trả lời." |
| 2 | Khách mở chi tiết đơn. | Hiện thẻ "Shipper muốn lấy phí giao … " / "Phí giao … đang chờ bạn đồng ý" với nút "Đồng ý" và "Từ chối", và nội dung "Bạn là người trả phí nên cần bạn đồng ý để shipper nhận đơn." |
| 3 | Quán mở đơn. | Quán KHÔNG có nút trả lời (chỉ thông báo chờ khách); nếu cố thao tác sẽ bị từ chối. |
| 4 | Khách chạm "Đồng ý". | Phí đơn đổi theo mức đề xuất. Shipper nhận được thông báo và nhận đơn được. |
| 5 | Hoàn tất giao như TC-FLOW-001. | Hoàn thành, phí hiển thị mức đã đồng ý ở cả ba bên. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục VII (decision khách trong 11Food, customers/me/orders/:id/delivery/fee); mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (fee-accept)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-010 · Đơn khách đặt, KHÁCH trả phí: khách TỪ CHỐI đề xuất phí

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #174 (trong ngày: 7) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách từ chối thì giữ phí cũ, shipper bị gỡ khỏi đơn, đơn tìm shipper khác, đơn món vẫn còn. |
| Người thực hiện | Khách + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-009 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Như bước 1-2 của TC-FLOW-009. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách chạm "Từ chối". | Thẻ biến mất; khách vẫn thấy đơn "Đang tìm shipper". Dòng giải thích: "Nếu từ chối, đơn món vẫn giữ nguyên, phí giữ mức cũ và hệ thống tìm shipper khác." |
| 2 | Shipper kiểm tra. | SP-A không còn giữ đơn; lịch sử ghi "Phí không được đồng ý". |
| 3 | Khách xem lại đơn món. | Đơn món KHÔNG bị hủy. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục II, VII`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-011 · Quán không được trả lời thay khi KHÁCH là người trả phí của đơn khách đặt

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #175 (trong ngày: 8) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quyền quyết định thuộc đúng người trả phí; quán không thể chấp nhận tiền phát sinh thay khách của đơn đặt qua 11Food. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-009 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đề xuất phí của shipper đang chờ KHÁCH trả lời (bước 1 của TC-FLOW-009). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở đơn, tìm nút "Đồng ý"/"Từ chối" cho đề xuất phí. | KHÔNG có nút trả lời; quán chỉ thấy dòng "Khách là người trả phí nên khách quyết định mức này trong 11Food. Bạn chỉ cần chờ." |
| 2 | Kỹ thuật viên (tùy chọn) thử gọi API quán trả lời thay. | Máy chủ từ chối (DELIVERY_STATE_CONFLICT). Ghi vào ghi chú nếu có kỹ thuật viên. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục VII dòng "Phí shipper đề xuất"; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-012 · Đề xuất phí quá hạn trả lời: giữ phí cũ, shipper bị gỡ, không hủy đơn

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #176 (trong ngày: 9) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu người trả phí không trả lời kịp (mặc định 5 phút) thì đề xuất tự hết hạn. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-007 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SP-A gửi đề xuất phí, quán KHÔNG trả lời. Ghi giờ gửi. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Thời gian trả lời mặc định 5 phút (SYSTEM chỉnh ở Web Admin > Hệ thống > "Cấu hình tập trung", dòng "Thời gian trả lời đề xuất phí"; tối thiểu 1 phút). Hạn trả lời không bao giờ vượt hạn tìm shipper. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chờ quá thời gian trả lời (5 phút). | Thẻ đề xuất biến mất khỏi màn quán; phí vẫn mức cũ. |
| 2 | Quán thử bấm "Đồng ý" ở thẻ cũ nếu còn hiện (làm mới màn hình trước). | Không cho trả lời muộn: báo đề xuất đã hết hạn (FEE_ANSWER_EXPIRED / "Đã hết hạn"). |
| 3 | Shipper kiểm tra. | Không còn giữ đơn; lịch sử "Phí không được đồng ý"/hết hạn; đơn tiếp tục tìm shipper. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ. Nếu đã sửa cấu hình thời gian trả lời, đặt lại 5 phút.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md Addendum 2026-10-24 mục 1-3; apps/admin-web/src/core/config.ts (fee_answer_minutes)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-013 · Quán gọi shipper (DIRECT), QUÁN trả phí: shipper đề xuất, quán đồng ý rồi từ chối

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #177 (trong ngày: 10) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nhánh thương lượng của luồng quán chủ động gọi. Đồng ý đổi phí; từ chối giữ phí cũ và tìm shipper khác nhưng KHÔNG hủy yêu cầu giao. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-003 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Quán tạo yêu cầu giao DIRECT, "Quán trả", "Theo bảng giá" + mốc (phí P). SP-A online. |
| Dữ liệu nhập | Lần 1: shipper đề xuất 25000, quán ĐỒNG Ý. Lần 2 (đơn khác): shipper đề xuất 40000, quán TỪ CHỐI. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SP-A đề xuất 25000 ở thẻ đơn. | Hiện "đang chờ Quán (người trả phí) trả lời." |
| 2 | Quán mở yêu cầu giao. | Thấy "Shipper đề xuất đổi phí giao" 25.000đ với "Đồng ý"/"Từ chối". |
| 3 | Quán chạm "Đồng ý". | Phí đổi thành 25.000đ; SP-A nhận được và có thể "Nhận đơn". |
| 4 | Tạo yêu cầu giao DIRECT mới và để SP-A đề xuất 40000; quán chạm "Từ chối". | Phí giữ như ban đầu; yêu cầu giao KHÔNG bị hủy ("Đang tìm shipper"); SP-A không còn giữ. |
| 5 | Quán hủy yêu cầu giao thử của lần 2 ("Hủy yêu cầu giao"). | Dọn xong. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đã hủy yêu cầu thử ở bước 5.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục III.4`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-014 · Quán gọi shipper (DIRECT), KHÁCH trả phí nhưng không có tài khoản: quán xác nhận thay khách

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #178 (trong ngày: 11) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khi khách không dùng 11Food, quán liên hệ khách ngoài ứng dụng rồi xác nhận thay; hệ thống ghi rõ là "quán xác nhận thay khách". |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-004 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Yêu cầu giao DIRECT với "Khách trả" đang tìm shipper; SP-A online. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SP-A đề xuất mức phí khác. | Gửi được. |
| 2 | Quán mở yêu cầu giao. | Thấy nội dung "Khách trả ship: hãy liên hệ khách trước. Bấm Đồng ý nghĩa là quán xác nhận thay khách, hệ thống sẽ ghi lại như vậy." cùng "Đồng ý"/"Từ chối". |
| 3 | Quán gọi điện cho người nhận (người trong nhóm test) để xin đồng ý, rồi chạm "Đồng ý". | Phí đổi; trong lịch sử/diễn biến của yêu cầu ghi nhận do quán xác nhận thay khách. |
| 4 | Làm lại với đề xuất khác và chạm "Từ chối". | Phí giữ nguyên; shipper không còn giữ đơn; yêu cầu vẫn tìm shipper khác. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Hủy yêu cầu giao thử.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục III.5, VII; m07_shop_views.dart (quán xác nhận thay khách)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-015 · Shipper đề xuất phí SAU khi nhận đơn, trước khi lấy hàng: chưa lấy hàng được cho đến khi có trả lời

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #179 (trong ngày: 12) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Phí hiện hành không đổi khi chờ; trong lúc chờ shipper chưa bấm được "Đã nhận hàng"; sau lấy hàng thì khóa. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-009 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | SP-A đã nhận một đơn (phí theo bảng), chưa lấy hàng. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper mở chi tiết đơn, chạm "Đề xuất mức phí khác", nhập mức, "Gửi đề xuất". | Hiện "Đang chờ trả lời mức phí" và "Bạn đã đề xuất … Chưa nhận hàng được cho đến khi … đồng ý. Nếu không được đồng ý hoặc quá hạn, bạn không còn giữ đơn này và đơn tiếp tục tìm shipper khác." |
| 2 | Shipper thử tìm nút "Đã nhận hàng". | KHÔNG bấm được/không có nút trong lúc chờ. |
| 3 | Quán chạm "Từ chối" đề xuất. | Shipper không còn giữ đơn (kết thúc lượt nhận), hoa hồng được giải phóng, đơn tìm shipper khác với phí cũ. |
| 4 | Làm lại bước 1 với đơn khác và để quán "Đồng ý"; shipper bấm "Đã nhận hàng" rồi xác nhận. | Phí chốt theo mức mới; sau "Đã nhận hàng" nút đề xuất phí biến mất ("Phí đã khóa"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md Addendum (2) mục 2; mobile/packages/n11_shared/lib/src/m07/m07_ship_views.dart (m07-propose-fee, "Chưa nhận hàng được cho đến khi")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-016 · Shipper bỏ lượt nhận (hủy nhận) rồi shipper khác nhận; đồng hồ tìm không bị tính lại

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #180 (trong ngày: 13) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Hủy nhận chỉ kết thúc lượt nhận của shipper đó; đơn và đồng hồ tìm tiếp tục; hoa hồng giải phóng đúng một lần. |
| Người thực hiện | Hai shipper + Quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-012, TC-WAL-005 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | Một đơn đang tìm shipper. SP-A và SP-B đều đủ tiền, online. Ghi số dư khả dụng của SP-A và SP-B. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SP-A nhận đơn. | SP-A giữ đơn; hoa hồng tạm giữ. |
| 2 | SP-A chạm "Hủy nhận đơn", chọn lý do, "Xác nhận hủy". | Đơn quay lại "Đang tìm shipper"; SP-A thấy "Bạn đã hủy nhận"; hoa hồng của SP-A được giải phóng (khả dụng trở lại). |
| 3 | Kiểm tra: SP-A có tự thấy lại đơn vừa bỏ không? | Người vừa hủy nhận KHÔNG bị báo đơn đó lại ngay (không nhận lại ngay lập tức). |
| 4 | SP-B mở "Có thể nhận" và nhận đơn. | SP-B nhận được; hoa hồng của SP-B tạm giữ; quán thấy tên SP-B. |
| 5 | Quán kiểm tra đồng hồ tìm shipper của đơn. | Đồng hồ vẫn tính từ lần gọi ban đầu (không đặt lại 30 phút). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục I và Addendum (2) mục 1; docs/current/M07-implementation-20261018.md mục 4`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-017 · Quán hủy yêu cầu giao khi shipper đã nhận nhưng chưa lấy hàng (đơn ORDER vẫn còn)

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #181 (trong ngày: 14) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Hủy yêu cầu giao chỉ dừng việc giao, không hủy đơn món; shipper được giải phóng; có thể gọi lại. |
| Người thực hiện | Chủ quán + Shipper + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn ORDER ở trạng thái shipper (SP-A) đã nhận, CHƯA lấy hàng. |
| Dữ liệu nhập | Lý do hủy: "Gọi nhầm (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở phần giao hàng của đơn, chạm "Hủy yêu cầu giao", nhập lý do, "Xác nhận hủy". | Yêu cầu giao chuyển "Đã hủy yêu cầu giao". Đơn món vẫn "Đang chuẩn bị" (không bị hủy). |
| 2 | Shipper kiểm tra. | Đơn rời "Đang thực hiện"; lịch sử ghi "Quán đã hủy yêu cầu giao". Hoa hồng tạm giữ được giải phóng. |
| 3 | Khách mở đơn. | Đơn vẫn còn; cập nhật trạng thái phù hợp (quán đang xử lý). |
| 4 | Quán chạm "Gọi lại shipper". | Tạo lần gọi mới; không bị chặn (vì hàng chưa rời quán). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục I; apps/backend/src/delivery/delivery-cancel.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-018 · Quán hủy đơn món khi shipper đã nhận nhưng chưa lấy hàng

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #182 (trong ngày: 15) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Hủy đơn món thì cả yêu cầu giao kết thúc, hoa hồng giải phóng, mọi bên được báo. |
| Người thực hiện | Chủ quán + Shipper + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn ORDER, SP-A đã nhận, chưa lấy hàng. Ghi khả dụng của SP-A. |
| Dữ liệu nhập | Lý do: "Quán hết món (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở đơn, chạm "Hủy đơn món". Đọc hộp thoại. | Hộp "Hủy đơn món?" nói rõ đơn món và yêu cầu giao đang chờ lấy sẽ cùng kết thúc, hoa hồng shipper được giải phóng. |
| 2 | Nhập lý do, xác nhận. | Đơn món "Đã hủy". |
| 3 | Shipper kiểm tra. | Đơn không còn trong "Đang thực hiện"; thông báo báo đơn bị hủy; hoa hồng được giải phóng (khả dụng như cũ). |
| 4 | Khách mở đơn. | Hiện "Đã hủy" cùng lý do của quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `docs/current/M10-implementation-20261018.md (hủy đơn món trước lấy hàng); mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-019 · Khách hủy đơn SAU khi shipper đã lấy hàng (đơn ORDER)

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #183 (trong ngày: 16) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Quyền hủy sau lấy hàng thuộc người tạo đơn (khách). Hủy phải có lý do; hoa hồng giải phóng (không thu); hàng ở shipper cho đến khi quán xác nhận. |
| Người thực hiện | Khách + Shipper + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn ORDER: SP-A đã bấm "Đã nhận hàng" (đang "Đang giao"). Ghi tổng số dư B và khả dụng A của SP-A. |
| Dữ liệu nhập | Lý do hủy: "Khách không nhận được (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách mở chi tiết đơn, chạm "Hủy đơn (shipper đã lấy hàng)". | Hộp "Hủy đơn khi shipper đã lấy hàng?" nói "Shipper đã lấy món và đang giao. Nếu hủy bây giờ, đơn kết thúc và shipper sẽ gọi quán để trả lại món. Ứng dụng không tự hoàn tiền hay bồi thường." và yêu cầu "Lý do hủy". |
| 2 | Nhập lý do, xác nhận. | Đơn của khách chuyển "Đã hủy". Không tự chuyển thành "Giao thành công". |
| 3 | Quán mở đơn. | Thấy đơn đã hủy bởi khách; có hồ sơ xử lý hàng ("Hàng đang ở shipper hoặc chưa rõ") và chưa gọi lại shipper được. |
| 4 | Shipper kiểm tra. | Đơn kết thúc, nhận thông báo hủy; ví: hoa hồng được giải phóng, KHÔNG bị trừ; Tổng số dư vẫn B. |
| 5 | Quán thực hiện TC-SHOP-036 (xác nhận hàng đã về). | Hồ sơ hàng đóng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu hoa hồng bị thu khi đơn bị hủy sau lấy hàng, hoặc đơn bị chuyển thành giao thành công.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục I, VII ("Hủy sau lấy hàng"); mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (order-cancel-after-pickup)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-020 · Quán hủy yêu cầu giao (DIRECT) SAU khi shipper đã lấy hàng, rồi xử lý hàng

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #184 (trong ngày: 17) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Với đơn do quán tạo, quán là người hủy sau lấy hàng; hoa hồng không thu; hàng chưa về quán thì chưa gọi lại được. |
| Người thực hiện | Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-003 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Yêu cầu giao DIRECT: SP-A đã "Đã nhận hàng" (đang "Đang giao"). Ghi B, A của SP-A. |
| Dữ liệu nhập | Lý do: "Người nhận từ chối nhận (TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở yêu cầu giao, chạm "Hủy giao (shipper đã lấy hàng)". | Hộp "Hủy giao khi shipper đã lấy hàng?" nói "Hủy bây giờ thì yêu cầu giao kết thúc, hoa hồng của shipper không bị thu, và hàng vẫn ở shipper cho tới khi bạn xác nhận đã nhận lại hoặc đã xử lý." |
| 2 | Nhập lý do, "Xác nhận hủy". | Yêu cầu giao kết thúc "Đã hủy yêu cầu giao"; hiện "Hàng hiện ở: Hàng đang ở shipper hoặc chưa rõ". |
| 3 | Quán thử gọi lại shipper. | Chưa gọi lại được cho đến khi xác nhận hàng đã về hoặc đã xử lý. |
| 4 | Shipper kiểm tra. | Chỉ còn thông báo hủy; ví không bị trừ hoa hồng; có dòng hồ sơ hàng "Hồ sơ xử lý hàng đang mở…". |
| 5 | Quán chạm "Xác nhận hàng đã về quán" (sau khi shipper trả hàng). | Hồ sơ đóng; gọi lại được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục III, VII; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (Hủy giao khi shipper đã lấy hàng)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-021 · Chủ quán KHÔNG hủy được đơn khách đặt sau khi shipper đã lấy hàng

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #185 (trong ngày: 18) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quyền hủy sau lấy hàng của đơn ORDER thuộc khách, không thuộc quán; kiểm tra phía giao diện quán. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn ORDER ở "Đang giao" (đã lấy hàng). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở đơn, tìm nút hủy. | KHÔNG có "Hủy đơn món" và không có "Hủy giao". Có banner "Shipper đã lấy hàng - Đơn này do khách đặt nên chỉ khách mới hủy được. Nếu shipper báo không giao được, hãy gọi khách và shipper để thống nhất." |
| 2 | (Tùy chọn - kỹ thuật viên) gọi lệnh hủy sau lấy hàng của quán. | Bị từ chối (AFTER_PICKUP_NO_CANCEL). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục VII; mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart; mobile m10_shop_views.dart (order-delivering-note)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-022 · Hàng sau khi đơn bị hủy: "Đã xử lý, không giao tiếp" và Admin đóng "Không hoàn tất"

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #186 (trong ngày: 19) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu hàng không thể trả về (đã xử lý) thì quán ghi nhận và đơn được đóng là "Không hoàn tất"; hệ thống không tự bồi thường hay hoàn tiền. |
| Người thực hiện | Chủ quán + ADMIN |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-019 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn có hồ sơ xử lý hàng đang mở sau khi bị hủy lúc đã lấy hàng. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở yêu cầu giao, chạm "Đã xử lý, không giao tiếp" và xác nhận ("Đã xử lý, không giao tiếp?"). | Hồ sơ hàng đóng với "Hàng hiện ở: Đã xử lý, không giao tiếp". Có chú thích "Hệ thống chỉ ghi nhận, không tự hoàn tiền hay bồi thường." |
| 2 | Với đơn món: quán chạm "Đóng đơn "Không hoàn tất"" và nhập lý do. | Đơn chuyển "Không hoàn tất". |
| 3 | Admin (có quyền duyệt) mở Web Admin > VẬN HÀNH > Đơn hàng, tìm đơn. | Thấy trạng thái "Không hoàn tất" và nhật ký thao tác. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_shop_views.dart (m07-custody-handled); m10_shop_views.dart (order-close); apps/admin-web/src/dom/orders-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m10-admin-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-023 · Thông báo đến đúng người, đúng đơn, đúng nội dung trong cả luồng

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #187 (trong ngày: 20) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi sự kiện chỉ báo cho đúng bên liên quan; chạm thông báo mở đúng đơn; không lộ thông tin nhạy cảm trên màn hình khóa. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Bảng phí giao đã được SYSTEM áp dụng; Thông báo đẩy (Firebase) nếu muốn kiểm push |
| Điều kiện ban đầu | Cả ba điện thoại đăng nhập, bật thông báo. Chuẩn bị bảng ghi: sự kiện - ai phải nhận - ai KHÔNG được nhận. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Thông báo đẩy khi tắt màn hình cần Firebase đã cấu hình (xem TC-NOTI-001). Không có push thì kiểm bằng hộp thông báo trong ứng dụng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách gửi đơn. | Quán nhận thông báo "đơn mới". Shipper KHÔNG nhận. (Khách: ghi nhận có hay không; tài liệu không bắt buộc.) |
| 2 | Quán xác nhận đơn. | Khách nhận thông báo "quán xác nhận". Shipper KHÔNG nhận. |
| 3 | Quán gọi shipper. | Shipper (đủ điều kiện, trong 3 km) nhận thông báo "có đơn giao hàng mới". Khách KHÔNG nhận thông báo dành riêng cho shipper (ghi nhận nếu khách nhận thông báo khác). |
| 4 | Shipper nhận đơn. | Quán nhận thông báo "shipper đã nhận đơn, đang đến lấy". Khách: ghi nhận có/không nhận thông báo; khi mở đơn trạng thái phải là "Shipper đang đến quán". |
| 5 | Shipper bấm "Đã nhận hàng". | Quán và khách nhận thông báo "shipper đã lấy hàng/đang giao" (hoặc ít nhất trạng thái đơn cập nhật đúng khi mở app). |
| 6 | Shipper bấm "Giao thành công". | Quán và khách nhận thông báo "đã giao thành công" (hoặc ít nhất trạng thái cập nhật đúng); khách còn nhận nhắc đánh giá một lần. |
| 7 | Chạm từng thông báo trên mỗi máy. | Mỗi thông báo mở ĐÚNG đơn đó (mã đơn khớp). Thông báo của đơn đã kết thúc mở ở dạng lịch sử ("Nội dung này đã kết thúc. Bạn đang xem ở lịch sử."). |
| 8 | Nhìn nội dung thông báo hiện trên màn hình khóa (nếu có push). | Chỉ có mã giao hàng/nội dung ngắn, KHÔNG có số điện thoại, địa chỉ, ngân hàng hay mã OTP. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu thông báo gửi nhầm cho người không liên quan hoặc mở sai đơn.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M08-implementation-20261018.md mục 2 (nội dung push cố định); mobile m08_views.dart; food_tabs.dart (foodNotificationRouter)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts; m08-admin-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-024 · Không tạo trùng đơn / trùng yêu cầu giao khi bấm nhiều lần

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #188 (trong ngày: 21) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Bấm "Gửi đơn" hoặc "Gọi shipper" nhiều lần liên tiếp chỉ tạo đúng một đơn/một yêu cầu. |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Giỏ khách có món, đang ở màn "Xác nhận đơn". Một đơn đã xác nhận sẵn ở quán để thử "Gọi shipper". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách bấm "Gửi đơn" 5-6 lần thật nhanh liên tiếp. | Ứng dụng chỉ gửi một lần (nút chuyển trạng thái chờ). Trong "Đang xử lý" chỉ có MỘT đơn mới. Quán cũng chỉ thấy MỘT đơn. |
| 2 | Quán bấm "Gọi shipper" rồi chọn người trả phí; ngay sau đó bấm lặp nút trong hộp thoại nhiều lần. | Chỉ tạo MỘT yêu cầu giao ("Lần gọi shipper thứ 1"). Không có yêu cầu thứ hai. |
| 3 | Đóng và mở lại cả hai ứng dụng. | Vẫn chỉ MỘT đơn và MỘT yêu cầu giao. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu có hai đơn/hai yêu cầu giao.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M10-implementation-20261018.md mục 2 (client_ref + Idempotency-Key); mobile m10/m07 sources (act/idempotency)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; idempotency-executor.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-025 · Mất mạng đúng lúc khách gửi đơn: ứng dụng báo "chưa biết đơn đã gửi chưa" và không tạo đơn thứ hai

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #189 (trong ngày: 22) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Khi không chắc đơn đã gửi, ứng dụng phải cho khách kiểm tra kết quả thay vì gửi lại mù quáng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Giỏ có món, ở màn "Xác nhận đơn". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Khó tái hiện chính xác thời điểm mất mạng. Thử vài lần: bật Chế độ máy bay ngay sau khi bấm "Gửi đơn". Kết quả có thể là "đơn đã gửi" hoặc "chưa gửi" - cả hai đều đúng nếu ứng dụng nói đúng sự thật; điều không được phép là tạo hai đơn. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Bấm "Gửi đơn" rồi bật ngay Chế độ máy bay. | Ứng dụng báo "Chưa biết đơn đã gửi chưa" / "Mất kết nối khi gửi. Đơn có thể đã được tạo. Hãy kiểm tra kết quả trước khi gửi lại để không bị đặt hai lần." với nút "Kiểm tra kết quả" và "Gửi lại". (Nếu app báo "Chưa gửi được đơn" ngay, ghi lại và thử lại.) |
| 2 | Tắt Chế độ máy bay, chạm "Kiểm tra kết quả". | Ứng dụng cho biết đơn đã tạo hay chưa dựa trên máy chủ. |
| 3 | Nếu báo chưa tạo: chạm "Gửi lại". Sau đó đếm số đơn trong "Đang xử lý". | Tổng cộng đúng MỘT đơn cho lần đặt này. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu có hai đơn cho cùng một lần đặt.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart (checkout-lookup, checkout-resend); docs/current/M10-implementation-20261018.md (lookup client_ref)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-026 · Hoa hồng của shipper: giữ chỗ khi nhận, trả lại khi hủy, thu đúng một lần khi hoàn thành

**Mức độ:** P0 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #190 (trong ngày: 23) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Kiểm tra bằng số liệu thật rằng tiền ví shipper luôn khớp với các biến cố nhận/hủy/hoàn thành. |
| Người thực hiện | Shipper + Quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-WAL-005 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | SP-A online đủ tiền. Ghi Tổng số dư B0 và khả dụng A0. Hoa hồng đang áp dụng = H (mặc định 1.000đ). |
| Dữ liệu nhập | Dùng 3 đơn DIRECT liên tiếp: (1) nhận rồi hủy nhận, (2) nhận rồi quán hủy trước lấy hàng, (3) nhận, lấy hàng, giao thành công. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đơn 1: SP-A nhận, xem ví; sau đó SP-A "Hủy nhận đơn". | Sau khi nhận: khả dụng = A0 - H, tổng B0. Sau khi hủy nhận: khả dụng = A0, tổng B0. |
| 2 | Đơn 2: SP-A nhận; quán "Hủy yêu cầu giao". | Sau khi quán hủy: khả dụng = A0, tổng B0 (hoa hồng giải phóng, không thu). |
| 3 | Đơn 3: SP-A nhận, "Đã nhận hàng", "Giao thành công". | Cuối cùng: tổng = B0 - H; khả dụng = A0 - H; đúng MỘT dòng "Hoa hồng" cho đơn 3 và KHÔNG có dòng hoa hồng cho đơn 1, 2. |
| 4 | Mở "Lịch sử giao dịch" và cộng/trừ lại các dòng. | Tổng số dư hiện tại = B0 + các dòng nạp - các dòng hoa hồng. Khớp đến từng đồng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG với bất kỳ sai lệch số dư nào (kể cả 1đ).

**Cách khôi phục để chạy lại:** Không cần (tiền đã hạch toán đúng).

**Căn cứ:** `docs/current/ADR-004-driver-wallet-consistency.md; docs/current/M07-owner-delivery-flow-20261023.md mục I`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m04-wallet-holds.int.spec.ts; m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-027 · Đơn hẹn giờ chạy trọn luồng: đặt, quán xác nhận, gọi shipper, giao

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #191 (trong ngày: 24) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn hẹn vẫn đi qua đủ các bước và không bị tự hủy vì chờ quán xác nhận (đơn hẹn không áp thời hạn chờ xác nhận mới). |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-029 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | Đơn hẹn giờ cách hiện tại ~40 phút đã được khách đặt (TC-CUS-029). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán xác nhận đơn hẹn ngay. | Đơn "Đang chuẩn bị" nhưng vẫn là "Đơn hẹn". |
| 2 | Đến sát giờ hẹn, quán gọi shipper. | Tạo yêu cầu giao bình thường. |
| 3 | Shipper nhận, lấy hàng, giao. | Hoàn thành; khách thấy đơn trong "Lịch sử". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M10-timeouts-20261021.md ("Đơn hẹn không áp timeout chờ xác nhận mới")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-028 · Đơn ORDER chưa tính được phí giao (thiếu ghim/tuyến): quán phải đề xuất phí để gọi được shipper

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #192 (trong ngày: 25) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Không có đơn "không ai nhận được": nếu phí chưa tính được, hệ thống yêu cầu quán đề xuất phí. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-021 |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng; GPS thật trong khu vực phục vụ (+ gói bản đồ nếu có) |
| Điều kiện ban đầu | Quán Test A mở. Khách đặt đơn bằng địa chỉ không có ghim; quán xác nhận. |
| Dữ liệu nhập | Khách đặt đơn với địa chỉ KHÔNG ghim vị trí. Quán đề xuất phí 25000, lý do chọn một lý do trong danh sách. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán chạm "Gọi shipper" và chọn người trả phí. | Hệ thống KHÔNG tạo yêu cầu giao ngay mà mở màn "Đề xuất phí giao" kèm lời "Hệ thống chưa tính được phí giao tự động cho đơn này. Hãy đề xuất một mức phí; shipper đồng ý hoặc đề xuất mức khác, và người trả phí quyết định." |
| 2 | Nhập mức 25000, chọn lý do, gửi. | Tạo yêu cầu giao với phí thỏa thuận 25.000đ ("Đang tìm shipper"). Nếu khách là người trả phí và mức khác bảng giá, có dòng "Khách trả phí: mức khác bảng giá cần khách đồng ý trong ứng dụng 11Food." |
| 3 | Shipper xem thẻ đơn. | Thấy "Phí đề xuất 25.000đ" với "Đồng ý", "Đề xuất mức khác", "Bỏ qua". |
| 4 | Hoàn tất theo các luồng thương lượng ở trên. | Đi được đến hoàn thành; phí hiển thị đúng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_shop_views.dart (_callWith, FEE_REQUIRED); docs/current/M07-owner-delivery-flow-20261023.md mục VII`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; m06-shipping-fee-agreement.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-029 · SYSTEM tự hủy đơn: chờ quán quá lâu và chờ shipper quá lâu

**Mức độ:** P1 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #193 (trong ngày: 26) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn bị bỏ quên không để vô hạn: hệ thống nhắc rồi tự hủy, báo đúng người, hoa hồng giải phóng. |
| Người thực hiện | Khách + Chủ quán + SYSTEM |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Máy tính có trình duyệt (Web Admin) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đã đặt "Chờ quán: tự hủy sau (phút)" = 6, "Chờ quán: bắt đầu nhắc" = 2, "nhắc lại mỗi" = 2 (ví dụ). Ghi giờ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Mặc định: chờ quán nhắc ở phút 15, 20, 25 và hủy ở phút 30; chờ shipper dừng tìm phút 30, hủy phút 60; đã nhận chưa lấy hàng cảnh báo phút 30, hủy phút 60. Để thử nhanh SYSTEM rút ngắn các mốc ở Web Admin > HỆ THỐNG > "Thời hạn xử lý đơn" (giá trị 1-1440 phút, mốc nhắc phải trước mốc hủy) rồi đặt lại. Không tự hủy đơn đã lấy hàng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách gửi một đơn mới, quán KHÔNG xác nhận. | Đơn "Chờ quán xác nhận". |
| 2 | Chờ đến mốc nhắc. | Quán nhận các thông báo nhắc xác nhận đơn. |
| 3 | Chờ quá mốc tự hủy. | Đơn chuyển "Hệ thống hủy quá hạn"; khách nhận thông báo; quán thấy đơn đã hủy. |
| 4 | Kiểm tra đơn trong Web Admin > Đơn hàng. | Trạng thái hủy do hệ thống (SYSTEM), có nhật ký. |
| 5 | Đặt lại các thời hạn về mặc định. | Giá trị về 15/5/30, 30/60, 30/60. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đặt lại thời hạn mặc định.

**Căn cứ:** `docs/current/M10-timeouts-20261021.md; apps/admin-web/src/dom/order-timeouts-page.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts (timeouts); admin tests

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-FLOW-030 · Shipper đang giữ một đơn nhận thêm đơn thứ hai (giới hạn số đơn cùng lúc)

**Mức độ:** P2 · **Nhóm:** E. Luồng giao hàng liên thông · **Số thứ tự chạy:** #194 (trong ngày: 27) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Ghi nhận giới hạn số đơn mỗi shipper được giữ cùng lúc (mặc định 3 đơn cho shipper ngoài) và quy tắc ghép đơn. |
| Người thực hiện | Shipper + Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Bảng phí giao đã được SYSTEM áp dụng |
| Điều kiện ban đầu | SP-A đang giữ một đơn đã nhận. Quán tạo thêm một yêu cầu giao DIRECT. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Quy tắc ghép đơn phụ thuộc dịch vụ tính tuyến và cấu hình ("Số đơn tối đa shipper ngoài giữ cùng lúc", "Chậm tối đa khi ghép đơn"). Kết quả mong đợi chính xác cần Người phụ trách xác nhận trước khi chạy. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper mở "Có thể nhận". | Ghi nhận: đơn thứ hai hiện hay không, nút "Nhận đơn" bấm được hay bị khóa kèm lý do (ví dụ đã đạt giới hạn hoặc ghép đơn làm chậm đơn đầu). |
| 2 | Nếu nhận được đơn thứ hai, hoàn tất hai đơn lần lượt. | Hai đơn hoàn thành độc lập; hoa hồng thu mỗi đơn đúng một lần. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `apps/admin-web/src/core/config.ts (external_max_deliveries); docs/current/M06-BC-eligibility-batching-20261017.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-eligibility.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-001 · Thông báo đẩy (push) tới điện thoại khi tắt màn hình

**Mức độ:** P1 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #195 (trong ngày: 28) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Người dùng nhận thông báo kể cả khi không mở ứng dụng. Chức năng này cần cấu hình dịch vụ Firebase phía máy chủ và bản APK có hỗ trợ push. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Thông báo đẩy (Firebase) nếu muốn kiểm push |
| Điều kiện ban đầu | Push đã được kỹ thuật viên cấu hình (có thể xem Web Admin > Thông báo > "Cấu hình" không còn cảnh báo). Điện thoại đã cho phép thông báo. Cả ba máy đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Tài liệu ghi nhận "APK bàn giao hiện chưa có push vì dự án Firebase của Owner và khóa chưa được cung cấp" (M08). Cần Người phụ trách xác nhận push đã bật trên bản đang thử. Nếu chưa, ghi BLOCKED và dùng TC-NOTI-002 (hộp thư trong app). Web Admin > Thông báo > Cấu hình hiển thị cảnh báo "Máy chủ chưa cấu hình dịch vụ đẩy thông báo" nếu chưa bật. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khóa màn hình cả ba điện thoại. Khách gửi đơn. | Điện thoại quán sáng/nhận thông báo đơn mới (có âm thanh theo cài đặt). |
| 2 | Quán xác nhận và gọi shipper (từ điện thoại quán đã mở khóa rồi khóa lại). | Khách nhận thông báo "quán xác nhận"; shipper (online, đủ điều kiện) nhận "đơn giao hàng mới". |
| 3 | Chạm thông báo trên màn hình khóa. | Ứng dụng mở đúng đơn/đúng danh sách. |
| 4 | Đọc nội dung thông báo. | Chỉ có nội dung ngắn (mã giao hàng/loại sự kiện); KHÔNG có số điện thoại, địa chỉ, thông tin ngân hàng hay mã OTP. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M08-implementation-20261018.md mục 4; ops/runbooks/m08-push-deploy-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts (nhà cung cấp push giả); không kiểm được push thật tự động

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-002 · Hộp thông báo trong ứng dụng đồng bộ khi mở lại và cập nhật trực tiếp

**Mức độ:** P0 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #196 (trong ngày: 29) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Dù không có push, hộp thông báo luôn đúng khi mở ứng dụng; có trạng thái "Mất kết nối" khi mất mạng. |
| Người thực hiện | Khách + Chủ quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Cả ba đã tham gia ít nhất một đơn (đã có thông báo). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên mỗi máy mở chuông "Thông báo" (khách/quán: Trang chủ; shipper: tab "Thông báo"). | Có danh sách theo nhóm ngày ("Hôm nay", "Hôm qua"), dấu chưa đọc, số "Chưa đọc (n)". |
| 2 | Khi mở sẵn hộp thông báo, nhờ người khác tạo sự kiện mới (ví dụ quán xác nhận đơn). | Thông báo mới xuất hiện trong vài giây mà không cần thoát ra vào (cập nhật trực tiếp). |
| 3 | Bật Chế độ máy bay. | Hiện cảnh báo "Mất kết nối — dữ liệu có thể chưa cập nhật". |
| 4 | Tắt Chế độ máy bay. | Danh sách tự cập nhật. |
| 5 | Chạm "Đánh dấu tất cả đã đọc". | Số chưa đọc về 0. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m08/m08_views.dart; docs/current/M08-implementation-20261018.md (long-poll changes)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts; mobile/packages/n11_shared/test/m08_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-003 · Tắt nhóm thông báo: thông báo vẫn vào hộp thư nhưng không đẩy

**Mức độ:** P1 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #197 (trong ngày: 30) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Cài đặt thông báo theo nhóm; timer nghiệp vụ không bị ảnh hưởng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > "Cài đặt thông báo". | Hiện nhóm "Đơn hàng và giao hàng", "Ví và hồ sơ" (và "Đơn có thể nhận" chỉ ở 11Ship) với công tắc, mục "Âm thanh". |
| 2 | Tắt nhóm "Đơn hàng và giao hàng". | Lưu thành công (hoặc báo "Chưa lưu được. Hãy thử lại." nếu lỗi mạng). |
| 3 | Khách có một sự kiện đơn (ví dụ quán xác nhận). | Thông báo vẫn nằm trong hộp thông báo; không có thông báo đẩy. |
| 4 | Bật lại nhóm. | Trở lại bình thường. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Bật lại mọi nhóm.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m08/m08_views.dart (NotificationSettingsScreen)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-004 · Quyền thông báo của điện thoại bị tắt: ứng dụng hướng dẫn bật

**Mức độ:** P1 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #198 (trong ngày: 31) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi Android chặn thông báo, ứng dụng phải nói rõ và vẫn cập nhật khi mở app. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Cài đặt > Ứng dụng > 11Food > Thông báo: TẮT. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở Tài khoản > "Cài đặt thông báo". | Hiện "Thông báo đẩy chưa sẵn sàng"/"Chưa cấp" kèm hướng dẫn "Mở Cài đặt điện thoại › Thông báo và bật thông báo cho ứng dụng. Mở ứng dụng vẫn cập nhật trạng thái." và "Thông báo vẫn vào hộp thông báo khi bạn mở ứng dụng." |
| 2 | Bật thông báo trong cài đặt điện thoại và quay lại ứng dụng. | Trạng thái đổi thành "Đang bật"/"Đã cấp". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Để thông báo bật.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m08/m08_views.dart ("Chưa nhận được thông báo khi tắt màn hình")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m08_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-005 · Sau khi đăng xuất, máy không còn nhận thông báo của tài khoản cũ

**Mức độ:** P0 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #199 (trong ngày: 32) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Riêng tư: người dùng máy khác không nhận thông báo tài khoản đã đăng xuất. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Thông báo đẩy (Firebase) nếu muốn kiểm push |
| Điều kiện ban đầu | KH-A đăng nhập Điện thoại 1 và có đơn đang chạy. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng xuất KH-A trên Điện thoại 1. | Đăng xuất thành công. |
| 2 | Quán xác nhận/xử lý đơn của KH-A. | Điện thoại 1 KHÔNG nhận thông báo nào về đơn đó (kể cả trên màn hình khóa). |
| 3 | Đăng nhập KH-A trên Điện thoại 1 lại. | Hộp thông báo hiển thị đầy đủ thông báo đã bỏ lỡ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu máy đã đăng xuất vẫn nhận thông báo riêng tư.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M08-implementation-20261018.md (token push gắn session, vô hiệu khi đăng xuất)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-NOTI-007 · Thông báo dừng tìm shipper và nhắc 5/15 phút tới quán

**Mức độ:** P1 · **Nhóm:** Bổ sung: Thông báo · **Số thứ tự chạy:** #200 (trong ngày: 33) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Quán được nhắc khi chưa có shipper nhận và được báo khi hệ thống ngừng tìm. |
| Người thực hiện | Chủ quán + Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-005 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một yêu cầu giao không có shipper nhận (TC-FLOW-005). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Quán mở hộp thông báo ở phút 5 và phút 15. | Có thông báo nhắc tìm (loại "Nhắc việc"/"Đang tìm") cho đúng đơn. |
| 2 | Khi ngừng tìm, quán và khách mở hộp thông báo. | Cả hai nhận thông báo "ngừng tìm shipper" cho đúng đơn; nội dung khách không có thông tin dành riêng cho quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M08-implementation-20261018.md (M08.04)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m08-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SHOP-036 · Quán xác nhận hàng đã về / đã xử lý sau khi hủy giao đã lấy hàng

**Mức độ:** P0 · **Nhóm:** C. Chủ quán 11Food · **Số thứ tự chạy:** #201 (trong ngày: 34) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Sau khi bị hủy lúc shipper đã cầm hàng, quán phải xác nhận hàng đã về quán hoặc đã xử lý trước khi gọi lại shipper. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-020 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một yêu cầu giao đã bị hủy sau khi shipper lấy hàng (TC-FLOW-020), có hồ sơ xử lý hàng đang mở. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở yêu cầu giao đó. | Thấy phần "Xử lý hàng" / "Hàng hiện ở": "Hàng đang ở shipper hoặc chưa rõ", kèm lời giải thích "Hàng ở tay ai người đó chịu trách nhiệm...". Chưa có nút "Gọi lại shipper". |
| 2 | Chạm "Xác nhận hàng đã về quán" (nếu hàng đã về), hoặc "Đã xử lý, không giao tiếp" (nếu hàng đã được xử lý). Nhập ghi chú nếu hỏi. | Hồ sơ chuyển "Đã đóng"; "Hàng hiện ở" đổi thành "Hàng đã về quán" hoặc "Đã xử lý, không giao tiếp". Với đơn món: xuất hiện lại nút "Gọi lại shipper" khi hàng đã về. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `m07_shop_views.dart (m07-custody-returned, m07-custody-handled); docs/current/M07-owner-delivery-flow-20261023.md (custody)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-026 · Đăng nhập lại khi đang có đơn đang giao: đơn không mất

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #202 (trong ngày: 35) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đăng xuất/đăng nhập (hoặc bị đăng xuất) giữa lúc có đơn đang chạy không được làm mất đơn hay đổi trạng thái đơn. |
| Người thực hiện | Khách + Quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 3 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có một đơn đang ở trạng thái "Đang giao" (shipper đã bấm "Đã nhận hàng"), chuẩn bị theo TC-FLOW-001 đến bước shipper đã lấy hàng. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy Khách đăng xuất rồi đăng nhập lại KH-A, mở tab "Đơn hàng". | Đơn vẫn nằm ở "Đang xử lý", trạng thái "Đang giao", đúng mã đơn. |
| 2 | Trên máy Quán đăng xuất rồi đăng nhập lại CQ-A, mở tab "Đơn hàng". | Đơn vẫn có ở danh sách "Đang giao" với đúng mã. |
| 3 | Trên máy Shipper đăng xuất rồi đăng nhập lại SP-A, mở tab "Đơn hàng" > "Đang thực hiện". | Đơn vẫn còn, vẫn có nút "Giao thành công". Trạng thái chia sẻ vị trí được khôi phục (hoặc có hướng dẫn rõ để bật). |
| 4 | Shipper bấm "Giao thành công" và xác nhận. | Đơn kết thúc đúng một lần; khách và quán thấy "Hoàn thành". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/ship/lib/ship_online.dart; docs/current/M14-online-location-20261024.md (còn đơn thì vẫn chia sẻ vị trí); apps/backend/src/delivery`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-025 · Shipper nhắc "chưa lấy hàng" sau khi nhận đơn

**Mức độ:** P2 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #203 (trong ngày: 36) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Hệ thống nhắc shipper mỗi 5 phút nếu đã nhận đơn mà chưa bấm "Đã nhận hàng". |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-009 |
| Điều kiện hệ thống cần có | Thông báo đẩy (Firebase) nếu muốn kiểm push |
| Điều kiện ban đầu | SP-A đã nhận đơn, KHÔNG bấm "Đã nhận hàng". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần chờ khoảng 5-10 phút. Thông báo đẩy cần cấu hình Firebase (xem TC-NOTI-001); nếu chưa có thì nhắc chỉ hiện trong hộp thông báo. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chờ khoảng 5 phút rồi mở tab "Thông báo". | Có thông báo nhắc lấy hàng cho đúng đơn (dạng nhắc "chưa lấy hàng"). |
| 2 | Chờ thêm 5 phút. | Có thêm một nhắc nữa (mỗi 5 phút một lần), không nhắc dồn nhiều lần cùng lúc. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Hủy nhận đơn hoặc hoàn tất đơn.

**Căn cứ:** `docs/current/M07-implementation-20261018.md mục 4; docs/current/M08-implementation-20261018.md (PICKUP_REMINDER)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m08-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-027 · Phiên bị thu hồi khi Admin khóa tài khoản đang đăng nhập

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #204 (trong ngày: 37) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khi quản trị khóa tài khoản, người đó phải bị đăng xuất và không đăng nhập lại được cho đến khi mở khóa. |
| Người thực hiện | Khách + ADMIN |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Một tài khoản khách phụ (ví dụ KH-B) đang đăng nhập trên Điện thoại 1 và KHÔNG có đơn đang xử lý. ADMIN/SYSTEM có quyền "Khóa tài khoản" đăng nhập Web Admin trên máy tính. |
| Dữ liệu nhập | Lý do khóa: chọn loại "Vi phạm" hoặc "Bảo mật" như giao diện cho phép, ghi chú "TEST khóa tài khoản". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, vào Web Admin > TÀI KHOẢN > Người dùng > Danh sách, tìm số điện thoại của KH-B và mở chi tiết. | Thấy chi tiết người dùng KH-B, trạng thái đang hoạt động. |
| 2 | Bấm "Khóa", chọn loại khóa, nhập lý do, xác nhận ("Khóa tài khoản?" > "Khóa"). | Trạng thái đổi thành đã khóa; có dòng mới trong "Lịch sử tài khoản". |
| 3 | Trên Điện thoại 1, bấm vào tab "Đơn hàng" và "Tài khoản". | KH-B bị đăng xuất ("Phiên đăng nhập đã kết thúc"). |
| 4 | Thử đăng nhập lại KH-B. | Bị từ chối bằng thông báo tài khoản đã khóa (ví dụ "Tài khoản này đang bị khóa…"). |
| 5 | Admin bấm "Mở khóa" > xác nhận ("Mở khóa tài khoản?"). | Trạng thái về hoạt động. |
| 6 | Đăng nhập lại KH-B trên Điện thoại 1. | Đăng nhập thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đảm bảo tài khoản đã được MỞ KHÓA trước khi kết thúc test.

**Căn cứ:** `apps/admin-web/src/dom/accounts-view.ts; apps/backend/src/admin-account-lock; docs/current/M01-final-package-20261014.md (khóa/mở khóa)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-account-lock.int.spec.ts; account-lifecycle.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-031 · Khôi phục tài khoản đã bị khóa theo yêu cầu xóa

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #205 (trong ngày: 38) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Tài khoản bị "Xóa tài khoản" nhưng còn dữ liệu sẽ được khóa; chủ tài khoản đăng ký lại bằng số cũ thì khôi phục bằng OTP, không mất dữ liệu. |
| Người thực hiện | Khách + SYSTEM |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Tài khoản phụ KH-X đã có dữ liệu (từng đặt đơn đã hoàn thành). SYSTEM đăng nhập Web Admin. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Dùng một tài khoản phụ có dữ liệu liên quan (ví dụ đã có từng đặt đơn), KHÔNG dùng tài khoản chính. Cần quyền SYSTEM. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Web Admin > Người dùng > mở KH-X > "Xóa tài khoản" > xác nhận. | Hộp thoại nói rõ tài khoản có dữ liệu thì không xóa mà chuyển sang khóa theo yêu cầu xóa; sau xác nhận trạng thái hiện đã khóa. |
| 2 | Trên điện thoại, đăng nhập bằng KH-X. | Bị chặn với thông báo tài khoản đã khóa theo yêu cầu xóa. |
| 3 | Chọn "Tạo tài khoản" bằng đúng số KH-X. | Hiện cảnh báo "Tài khoản này đã khóa theo yêu cầu xóa" cùng nút "Khôi phục tài khoản". |
| 4 | Chạm "Khôi phục tài khoản", xác minh bằng mã SMS và đặt mật khẩu mới. | Hiện "Đã khôi phục tài khoản" / "Tài khoản đã được mở khóa với mật khẩu mới…". |
| 5 | Đăng nhập bằng mật khẩu mới và mở "Đơn hàng". | Lịch sử đơn cũ của KH-X vẫn còn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần (tài khoản phụ).

**Căn cứ:** `account_views.dart (recover-account); docs/current/M01-final-package-20261014.md mục 8; reset_views.dart (Khôi phục tài khoản)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/account-lifecycle.int.spec.ts; account-recovery-reset-test.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-013 · Khóa tài khoản bị chặn khi tài khoản còn đơn đang xử lý

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #206 (trong ngày: 39) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Không được khóa người đang có đơn hay yêu cầu giao chưa kết thúc để tránh mất đơn. |
| Người thực hiện | ADMIN/SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | KH-A có một đơn đang xử lý (chưa kết thúc). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết KH-A trong Người dùng, bấm "Khóa", điền lý do, xác nhận. | Không khóa được; hiện "Không thể khóa lúc này: tài khoản còn đơn hàng hoặc đơn giao hàng đang xử lý. Đơn đã hoàn thành hoặc đã hủy không cản trở việc khóa." |
| 2 | Hủy/hoàn tất đơn rồi khóa lại. | Khóa được (khi hết đơn đang xử lý). |
| 3 | Mở khóa. | Mở khóa thành công (xem thêm TC-ACC-027). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đảm bảo KH-A được mở khóa.

**Căn cứ:** `apps/admin-web/src/dom/accounts-view.ts; docs/current/M01-production-profile-20261014.md (khóa USER phải duyệt lại khi có đơn/ví)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/account-lifecycle.int.spec.ts; admin-account-lock.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-016 · Admin vô hiệu hóa và kích hoạt lại quán

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #207 (trong ngày: 40) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin có quyền "Quản lý hoạt động quán" dừng quán vi phạm; không dừng được khi quán còn đơn chưa kết thúc. |
| Người thực hiện | ADMIN (có quyền Quản lý hoạt động quán) / SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-SHOP-011 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Một quán thử không có đơn đang chạy (Quán Test B). Một quán khác có đơn đang xử lý (Quán Test A, đang có đơn). |
| Dữ liệu nhập | Lý do: "TEST vô hiệu hóa quán" (1-500 ký tự). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết quán có đơn đang xử lý, bấm "Vô hiệu hóa quán", nhập lý do, xác nhận. | Bị từ chối: quán còn đơn/yêu cầu giao chưa kết thúc (SHOP_HAS_OPEN_WORK, hiện thành câu tiếng Việt về việc đang xử lý). |
| 2 | Mở chi tiết quán KHÔNG có đơn, "Vô hiệu hóa quán", nhập lý do, xác nhận. | Hiện "Đã vô hiệu hóa quán."; trạng thái hồ sơ "Đã bị vô hiệu hóa"; có dòng trong lịch sử quản lý với lý do. |
| 3 | Chủ quán mở 11Food, vào quản lý quán. | Hiện "Quán đã bị vô hiệu hóa. Bạn không thể chỉnh sửa hồ sơ." / "Quán đã bị vô hiệu hóa nên không thể sửa món." |
| 4 | Khách tìm quán (xem TC-CUS-014). | Không thấy quán. |
| 5 | Admin bấm "Kích hoạt lại quán" và xác nhận. | Hiện "Đã kích hoạt lại quán."; quán hoạt động trở lại theo giờ mở cửa. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Quán phải được kích hoạt lại ở bước 5.

**Căn cứ:** `apps/admin-web/src/dom/shops-view.ts; docs/current/M02-admin-shops-20261024.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-shops.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-018 · Admin "Khóa hoạt động" và "Mở lại" shipper; "Nhận đơn" bị tắt

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #208 (trong ngày: 41) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Admin dừng một shipper vi phạm: shipper không nhận đơn mới nhưng đơn đang giao không bị hủy. |
| Người thực hiện | ADMIN (có quyền Khóa) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-017 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | SP-B (không có đơn đang giao) đang online. |
| Dữ liệu nhập | Lý do: "TEST khóa hoạt động". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chi tiết SP-B > "Khóa hoạt động", nhập lý do, xác nhận ("Khóa hoạt động Shipper"). | Trạng thái tạm khóa; "Nhận đơn" chuyển "Đang tắt"; ghi lý do. |
| 2 | Shipper kiểm tra 11Ship. | Không nhận đơn mới; có thông báo về việc bị khóa; đơn đang giao (nếu có) vẫn hoàn tất được ("Đơn đã nhận và số dư ví của bạn không bị ảnh hưởng."). |
| 3 | Admin "Mở lại hoạt động". | Hiện "Shipper quay lại trạng thái hoạt động với nhận đơn đang tắt." Shipper tự bật online khi đủ điều kiện. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** SP-B được mở lại.

**Căn cứ:** `apps/admin-web/src/dom/shippers-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-account-lock.int.spec.ts; m03-shipper.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-DRV-021 · Shipper bị Admin khóa: không nhận đơn mới nhưng vẫn xem ví

**Mức độ:** P1 · **Nhóm:** D. Shipper 11Ship · **Số thứ tự chạy:** #209 (trong ngày: 42) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khóa shipper dừng nhận đơn; vẫn cho xem ví và gửi yêu cầu rút theo quy định. |
| Người thực hiện | Shipper + ADMIN |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-018 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | Một tài khoản shipper phụ (SP-B), không có đơn đang giao. Admin có quyền khóa. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin khóa tài khoản SP-B (Người dùng > chi tiết > "Khóa", hoặc "Khóa hoạt động" ở trang Shipper). | Trạng thái đã khóa. |
| 2 | Trên 11Ship (đăng nhập lại SP-B nếu bị đăng xuất). | Hiện "Tài khoản đã khóa - Bạn không nhận đơn mới và không dùng các chức năng giao hàng. Bạn vẫn xem được số dư ví, lịch sử giao dịch và gửi yêu cầu rút tiền theo điều kiện hiện hành." (đối với khóa kiểu chỉ giữ ví). |
| 3 | Thử "Bật online". | Không bật được ("Tài khoản đang bị tạm khóa"). |
| 4 | Admin mở khóa. | Shipper bật lại online được khi ví đủ điều kiện. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đảm bảo SP-B được mở khóa.

**Căn cứ:** `account_views.dart (locked-wallet-only); driver_controller.dart (ACCOUNT_SUSPENDED)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-account-lock.int.spec.ts; m03-shipper.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-036 · Admin xử lý yêu cầu giao: giải phóng shipper, ghi nhận hàng, điều chỉnh sau lấy hàng, chuyển phản ánh

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #210 (trong ngày: 43) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Admin có công cụ xử lý sự cố khi shipper mất liên lạc, hàng bị kẹt hoặc phí/địa chỉ cần sửa sau khi lấy hàng; mọi thao tác phải có lý do và nhật ký. |
| Người thực hiện | ADMIN (quyền Khóa/Duyệt) / SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-023 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Chuẩn bị 3 yêu cầu giao DIRECT thử: (1) SP-A đã nhận, CHƯA lấy hàng; (2) SP-A đã lấy hàng, đang giao; (3) một yêu cầu đã bị hủy sau khi lấy hàng và còn hồ sơ hàng mở (TC-FLOW-020). Admin đăng nhập Web Admin. |
| Dữ liệu nhập | Lý do: "TEST xử lý sự cố". Phí mới: 20000. Địa chỉ mô tả mới: "Số 20 đường Test, tổ 6 (sửa TEST)". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: VẬN HÀNH > "Giao hàng". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Mở yêu cầu (1), chạm "Giải phóng shipper" (hộp có lời giải thích "Dùng khi tài khoản shipper bị khóa hoặc thiết bị hỏng và đơn chưa lấy hàng…"), thử xác nhận khi chưa nhập lý do. | Báo "Lý do là bắt buộc."; không thực hiện. |
| 3 | Nhập lý do và xác nhận. | Shipper bị gỡ khỏi đơn; yêu cầu quay lại "Đang tìm" (nếu còn thời hạn tìm); hoa hồng của shipper được giải phóng. Trên 11Ship SP-A thấy "Admin đã gỡ bạn khỏi đơn". |
| 4 | Mở yêu cầu (2), chạm "Điều chỉnh sau lấy hàng", nhập "Phí mới (đ)" = 20000 và/hoặc "Địa chỉ mới", lý do, xác nhận. | Phí/địa chỉ được đổi; trong diễn biến có dòng ghi trước/sau và lý do; shipper và quán thấy phí/địa chỉ mới. |
| 5 | Mở yêu cầu (3), chạm "Ghi nhận hàng" > chọn "Hàng đã về quán, sẵn sàng gọi lại" (hoặc "Đã xử lý, không giao tiếp") và nhập lý do. | Hồ sơ hàng đóng; hiện chú thích "Đây là ghi nhận, không tự bồi thường hay hoàn tiền." |
| 6 | (Nếu có hồ sơ phản ánh) Chạm "Chuyển phản ánh (M11)". | Chỉ đánh dấu "Đã chuyển M11" và ghi nhật ký; không tạo phiếu giả. |
| 7 | ADMIN-2 (chỉ xem) mở cùng trang. | Không có các nút thao tác ("Tài khoản này không có quyền thực hiện thao tác này."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Dọn các yêu cầu thử (hủy hoặc hoàn tất).

**Căn cứ:** `apps/admin-web/src/dom/deliveries-view.ts; docs/current/M07-implementation-20261018.md (Admin actions)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts (admin actions)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-022 · Admin hủy đơn món và đóng "Không hoàn tất" (cần lý do, cần quyền)

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #211 (trong ngày: 44) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Hai thao tác xử lý đơn của Admin có lý do bắt buộc, ghi nhật ký, thông báo đúng bên. |
| Người thực hiện | ADMIN (quyền khóa/duyệt) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin); Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-021 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Một đơn thử "Đang chuẩn bị" (chưa lấy hàng). |
| Dữ liệu nhập | Lý do: "TEST Admin hủy đơn". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở chi tiết đơn, chạm "Hủy đơn món". Thử xác nhận khi chưa nhập lý do. | Báo "Lý do là bắt buộc." |
| 2 | Nhập lý do và xác nhận. | Đơn chuyển "Đã hủy" (Quản trị hủy); hiện "Đã cập nhật." |
| 3 | Khách mở đơn trên 11Food. | Hiện đã hủy; có thông báo cho khách. |
| 4 | Tìm nút "Hủy đơn món" ở đơn mà shipper ĐÃ lấy hàng. | Không có/không dùng được ("Không dùng được sau khi shipper đã lấy hàng."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/orders-view.ts; apps/backend/src/admin-orders`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-admin-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-CUS-014 · Quán bị Admin vô hiệu hóa không còn hiện cho khách

**Mức độ:** P0 · **Nhóm:** B. Khách hàng 11Food · **Số thứ tự chạy:** #212 (trong ngày: 45) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Quán bị vô hiệu hóa không được nhận đơn và khách không thấy. |
| Người thực hiện | Khách + ADMIN |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ADM-016 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Quán Test C hoặc quán thử đã hoàn tất hồ sơ, không có đơn đang chạy. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách tìm thấy quán thử trong "Quán gần bạn". | Quán hiện bình thường. |
| 2 | Admin vô hiệu hóa quán (TC-ADM-016 bước 2-3). | Quán được ghi trạng thái "Đã vô hiệu hóa". |
| 3 | Khách kéo làm mới danh sách và tìm lại quán. | Không còn thấy quán trong danh sách và kết quả tìm. |
| 4 | Nếu khách đang ở trang quán đó và thử thêm món/đặt đơn. | Báo quán không khả dụng ("Quán hiện không khả dụng" / "Quán hiện chưa hiển thị cho khách"). |
| 5 | Admin kích hoạt lại quán. | Quán hiện lại cho khách. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Quán phải được kích hoạt lại ở bước 5.

**Căn cứ:** `apps/backend/src/admin-shops; preview_views.dart ("Quán hiện không khả dụng")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-shops.int.spec.ts; discovery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-001 · Mất Internet khi đang xem quán và giỏ hàng (khách)

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #213 (trong ngày: 46) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khi mất mạng ứng dụng phải báo rõ, không hiển thị dữ liệu cũ như thể mới, và tự phục hồi khi có mạng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-015 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đăng nhập, đang ở trang Quán Test A có giỏ hàng. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Bật Chế độ máy bay (hoặc tắt Wi-Fi và dữ liệu di động). Đợi 10-20 giây. | Xuất hiện thanh thông báo "Không có kết nối mạng - Vui lòng kiểm tra kết nối internet và thử lại." kèm nút "Thử lại" và dòng "Lần kiểm tra gần nhất: …". |
| 2 | Chạm tab "Đơn hàng" rồi trở lại trang quán. | Nội dung đã tải trước đó có thể vẫn hiện nhưng có nhãn "Đang hiển thị dữ liệu đã tải. Kiểm tra kết nối để xem bản mới nhất." Không có số liệu mới nào được bịa ra. |
| 3 | Thử thêm một món vào giỏ và "Gửi đơn" khi đang mất mạng. | Không tạo đơn; báo lỗi mất kết nối hoặc "Chưa lưu được giỏ"/"Giỏ trên máy có thể mới hơn giỏ trên máy chủ. Sẽ lưu lại khi có mạng." (xem TC-FLOW-025 về nhánh chưa biết kết quả). |
| 4 | Tắt Chế độ máy bay và chạm "Thử lại". | Thanh lỗi biến mất; dữ liệu cập nhật; giỏ còn đúng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tắt Chế độ máy bay.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/errors.dart (healthCopy); mobile/packages/n11_shared/lib/src/widgets/connection_banner.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/health_test.dart; m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-002 · Shipper mất Internet lúc bấm "Giao thành công" hoặc "Đã nhận hàng"

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #214 (trong ngày: 47) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Trạng thái giao hàng không được lệch: nếu chưa chắc đã ghi nhận thì ứng dụng phải nói thật và cho kiểm tra lại, không trừ tiền hai lần. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-013 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A có một đơn đã nhận (trước lấy hàng); sau đó có thêm một đơn đang giao. Ghi số dư trước. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở chi tiết đơn đã nhận, bấm "Đã nhận hàng" rồi xác nhận, và NGAY LẬP TỨC bật Chế độ máy bay. | Ứng dụng báo chưa xác nhận được kết quả ("Chưa xác nhận được") hoặc báo mất kết nối; không tự giả định thành công. |
| 2 | Tắt Chế độ máy bay, mở lại chi tiết đơn (kéo làm mới/ "Tải lại"). | Trạng thái hiện đúng thực tế trên máy chủ (đã lấy hàng hoặc chưa). Nếu chưa, bấm lại được; nếu rồi, chỉ còn "Giao thành công". |
| 3 | Với đơn đang giao: bấm "Giao thành công" và bật Chế độ máy bay ngay. | Như bước 1. |
| 4 | Tắt Chế độ máy bay, kiểm tra trạng thái và ví. | Đơn hoàn thành đúng một lần hoặc chưa hoàn thành (cả hai đều chấp nhận được nếu ứng dụng nói đúng); hoa hồng thu tối đa MỘT lần; nếu đơn chưa hoàn thành thì bấm lại được và vẫn chỉ thu một lần. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu hoa hồng bị thu hai lần hoặc trạng thái đơn hiển thị sai so với thực tế.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart (act, "Chưa xác nhận được"); apps/backend/src/idempotency`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; idempotency-commit-unknown.int.spec.ts; mobile/packages/n11_shared/test/m07_views_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-003 · Quán mất mạng lúc bấm "Xác nhận đơn" hoặc "Gọi shipper"

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #215 (trong ngày: 48) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Quán không bị tạo đôi/mất thao tác khi mạng chập chờn. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có một đơn "Chờ xác nhận". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Bấm "Xác nhận đơn" rồi bật Chế độ máy bay ngay. | Thông báo chưa xác nhận được kết quả hoặc mất kết nối. |
| 2 | Tắt Chế độ máy bay và làm mới danh sách. | Đơn ở trạng thái thật ("Đang chuẩn bị" hoặc vẫn "Chờ xác nhận"); không có đơn trùng. |
| 3 | Với đơn "Đang chuẩn bị": bấm "Gọi shipper" > chọn người trả phí, bật Chế độ máy bay ngay, rồi tắt. | Sau khi có mạng chỉ MỘT yêu cầu giao tồn tại (xem phần giao hàng của đơn), không có lần gọi thứ hai ngoài ý muốn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu có hai yêu cầu giao cho một đơn.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart; docs/current/M10-implementation-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; idempotency-executor.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-004 · Tắt đột ngột ứng dụng 11Ship khi đang giao: đơn không mất, vị trí tiếp tục được chia sẻ

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #216 (trong ngày: 49) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Vuốt tắt ứng dụng không được làm mất đơn; dịch vụ chia sẻ vị trí vẫn chạy khi còn đơn. |
| Người thực hiện | Shipper + Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-003 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đang online, có một đơn "Đang giao" (đã lấy hàng). Quán đang xem đơn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Một số hãng điện thoại (Xiaomi, Oppo, Vivo…) tự giết ứng dụng nền; đó là giới hạn của Android/hãng máy (xem tài liệu M14), không cam kết vượt qua. Ghi lại hãng máy và Android khi kết quả khác kỳ vọng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 3 mở nhiều nhiệm (Recent apps) và vuốt TẮT HẲN 11Ship. | Ứng dụng đóng; thanh thông báo vẫn còn thông báo thường trực chia sẻ vị trí (nếu điện thoại không chặn). |
| 2 | Đợi 3-4 phút. Quán xem đơn (phần vị trí, nếu đơn là ORDER). | Vị trí shipper vẫn cập nhật (giờ cập nhật mới) ở đơn ORDER; hoặc hiện "Vị trí đã cũ" nếu điện thoại giết dịch vụ (ghi nhận hãng máy, Android). |
| 3 | Mở lại 11Ship. | Vào thẳng tài khoản SP-A; đơn vẫn "Đang thực hiện" ở trạng thái "Đang giao"; có nút "Giao thành công". |
| 4 | Bấm "Giao thành công". | Hoàn thành bình thường, một lần. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M14-online-location-20261024.md (Dịch vụ nền Android)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/gateway/test; mobile/ship (LocationReporterTest JVM)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-005 · Khởi động lại điện thoại shipper khi đang online hoặc đang có đơn

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #217 (trong ngày: 50) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Sau khi điện thoại tắt/bật, shipper vẫn giữ đơn và (nếu còn lý do) được hướng dẫn bật lại chia sẻ vị trí; không tự online khi đã tắt. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-009 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A có một đơn đang thực hiện và đang online. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khởi động lại Điện thoại 3. | Điện thoại bật lên bình thường. |
| 2 | Mở 11Ship. | Vẫn đăng nhập; đơn vẫn có trong "Đang thực hiện". |
| 3 | Nhìn dòng trạng thái vị trí ở Trang chủ. | Dịch vụ vị trí được khôi phục ("Đang lấy vị trí…"/"Đang chia sẻ vị trí") hoặc hiện hướng dẫn rõ vì sao chưa chạy (quyền, GPS) cùng nút "Thử lại". |
| 4 | Hoàn tất đơn rồi bấm "Tắt online"; khởi động lại điện thoại lần nữa. | Sau khởi động KHÔNG tự bật online và không còn chia sẻ vị trí. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M14-online-location-20261024.md (Khởi động lại)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-006 · GPS tắt giữa lúc shipper đang giữ đơn

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #218 (trong ngày: 51) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu GPS tắt khi có đơn, ứng dụng phải báo rõ; đơn không bị hủy; quán thấy vị trí cũ/mất kết nối chứ không thấy vị trí giả. |
| Người thực hiện | Shipper + Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đang giữ đơn ORDER, đã lấy hàng, đang chia sẻ vị trí. Quán mở chi tiết đơn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper tắt GPS (Vị trí) trong thanh cài đặt nhanh của điện thoại. | Trên 11Ship hiện "Đang giao đơn · Chưa có vị trí" và hướng dẫn "GPS đang tắt. Hãy bật Vị trí trên điện thoại rồi thử lại." với nút "Mở cài đặt vị trí". Đơn vẫn còn, vẫn có "Giao thành công". |
| 2 | Đợi 2-3 phút; quán làm mới chi tiết đơn. | Phần vị trí shipper hiện cũ/mất kết nối: "Vị trí cũ"/"Vị trí đã cũ. Có thể shipper đã di chuyển." hoặc "Mất kết nối vị trí". Không hiện vị trí mới giả. |
| 3 | Shipper bật lại GPS và chạm "Thử lại". | Vị trí được chia sẻ lại; quán thấy giờ cập nhật mới và trạng thái mới. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md; mobile/ship/lib/ship_online.dart; mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart (freshness)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart; tests/integration/m07-delivery.int.spec.ts (location freshness)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-007 · GPS yếu (trong nhà / dưới hầm): không có vị trí nhưng ứng dụng không treo

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #219 (trong ngày: 52) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Không lấy được vị trí trong thời gian chờ thì phải báo và cho thử lại. |
| Người thực hiện | Shipper / Khách |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER); Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Người thử đứng trong nhà kín/tầng hầm. Quyền vị trí đã cấp, GPS bật. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper bấm "Bật online" trong nhà kín. | Sau thời gian chờ hiện "Chưa lấy được vị trí. Hãy ra nơi thoáng hơn rồi thử lại." Không bật online. |
| 2 | Khách mở "Trang chủ" 11Food trong nhà kín. | Hiện "Chưa xác định được khu vực theo GPS… Hãy thử định vị lại" và nút "Thử xác định lại khu vực"; ứng dụng không treo. |
| 3 | Ra nơi thoáng và thử lại. | Lấy được vị trí. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/ship/lib/ship_online.dart; mobile/packages/n11_shared/lib/src/flows/location.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-008 · Vị trí giả (ứng dụng giả GPS) bị từ chối

**Mức độ:** P2 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #220 (trong ngày: 53) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Vị trí giả không được dùng để lấy khu vực/ghim quán hoặc làm vị trí shipper. |
| Người thực hiện | Kỹ thuật viên / Người kiểm thử có kinh nghiệm |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Điện thoại thử bật "Chọn ứng dụng vị trí giả" với một ứng dụng giả vị trí. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chỉ thực hiện trên máy thử và khi Người phụ trách cho phép (cần bật "Tùy chọn nhà phát triển" và một ứng dụng giả vị trí). Không bắt buộc với người mới. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food, hồ sơ quán, chạm lấy vị trí tại quán. | Ứng dụng từ chối: "Không lấy được vị trí thật từ điện thoại. Bạn vẫn lưu nháp được, nhưng chưa hoàn tất hồ sơ." |
| 2 | Tắt vị trí giả và thử lại. | Lấy được vị trí thật. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tắt tùy chọn vị trí giả.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/location.dart; mobile/README.md (mock providers refused)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-009 · Máy chủ phản hồi chậm hoặc không sẵn sàng

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #221 (trong ngày: 54) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi máy chủ chậm/bảo trì ứng dụng phải báo thật và không treo. |
| Người thực hiện | Khách / Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Kỹ thuật viên sẵn sàng làm máy chủ chậm/không phản hồi. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần kỹ thuật viên làm chậm/dừng máy chủ thử trong thời gian ngắn theo quy trình vps-safe-update, hoặc dùng mạng rất yếu (3G yếu). KHÔNG dừng máy chủ khi đang có người dùng thật. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khi máy chủ chậm, thực hiện một thao tác đọc (mở tab "Đơn hàng"). | Hiện trạng thái chờ rồi báo "Máy chủ phản hồi quá lâu - Chưa nhận được phản hồi. Vui lòng thử lại." (không treo vô hạn). |
| 2 | Khi máy chủ báo chưa sẵn sàng. | Hiện "Máy chủ chưa sẵn sàng - Máy chủ đã phản hồi nhưng chưa sẵn sàng phục vụ. Vui lòng thử lại sau ít phút." |
| 3 | Thử một thao tác ghi (ví dụ gửi đơn) trong lúc này. | Không tạo đơn hoặc báo "Chưa biết đơn đã gửi chưa" và cho kiểm tra lại; không tạo đơn trùng. |
| 4 | Khi máy chủ trở lại bình thường, chạm "Thử lại". | Mọi thứ phục hồi. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Kỹ thuật viên khôi phục máy chủ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/errors.dart (healthCopy)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/health_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-010 · Hai người cùng thao tác một đơn: quán hủy trong lúc shipper bấm "Nhận đơn"

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #222 (trong ngày: 55) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Hai thao tác xung đột cùng lúc chỉ có một thao tác thắng; trạng thái cuối cùng nhất quán cho mọi bên. |
| Người thực hiện | Quán + Shipper |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một đơn "Đang tìm shipper"; shipper đang thấy thẻ đơn; quán đang ở màn hình có nút "Hủy yêu cầu giao". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Cần phối hợp hai người, đếm 1-2-3 và bấm cùng lúc. Lặp lại 3 lần với đơn mới mỗi lần; ghi kết quả từng lần. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Hai người cùng bấm: quán "Hủy yêu cầu giao" (xác nhận) và shipper "Nhận đơn". | Chỉ có MỘT kết quả: hoặc yêu cầu bị hủy và shipper không nhận (báo đơn không còn nhận được), hoặc shipper nhận trước rồi yêu cầu bị hủy sau (shipper thấy "Quán đã hủy yêu cầu giao" và hoa hồng được giải phóng). |
| 2 | Kiểm tra ví shipper. | Không có hoa hồng bị thu; không có tiền tạm giữ treo vĩnh viễn. |
| 3 | Kiểm tra màn hình quán và shipper. | Hai bên cùng thấy một trạng thái cuối nhất quán. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu hai bên thấy hai trạng thái khác nhau hoặc tiền tạm giữ bị treo.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục V ("race giữa hủy/nhận/lấy/hoàn thành"); apps/backend/src/delivery`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts (đua giữa các lệnh)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-011 · Khách hủy đơn trong lúc quán bấm "Xác nhận đơn"

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #223 (trong ngày: 56) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Hai thao tác xung đột chỉ một thắng; không có đơn "vừa hủy vừa xác nhận". |
| Người thực hiện | Khách + Chủ quán |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-036 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một đơn "Chờ xác nhận"; khách đang ở hộp thoại hủy; quán đang ở chi tiết đơn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Đếm 1-2-3 và bấm cùng lúc; lặp lại vài lần với đơn mới. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách xác nhận hủy và quán bấm "Xác nhận đơn" cùng lúc. | Chỉ có một kết quả: đơn "Đã hủy" HOẶC đơn "Đang chuẩn bị". Bên thua nhận thông báo/báo lỗi rõ ràng ("Đơn vừa được thay đổi ở nơi khác…"). |
| 2 | Đối chiếu màn hình khách, quán. | Hai bên thấy cùng một trạng thái cuối. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu hai bên thấy hai trạng thái khác nhau.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `apps/backend/src/orders (order rules, version); docs/current/M10-implementation-20261018.md mục 2`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-012 · Hai quản trị viên cùng sửa một dữ liệu: người sau nhận cảnh báo "đã thay đổi ở nơi khác"

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #224 (trong ngày: 57) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Không ghi đè mù quáng; bên thua phải tải lại rồi quyết định. |
| Người thực hiện | SYSTEM + ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Hai trình duyệt đăng nhập hai tài khoản (SYSTEM và ADMIN-1 có quyền) cùng mở chi tiết một quán thử. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trình duyệt 1: "Vô hiệu hóa quán" và xác nhận. | Thành công. |
| 2 | Trình duyệt 2 (chưa tải lại): cũng bấm "Vô hiệu hóa quán" và xác nhận. | Báo "Trạng thái quán đã thay đổi nên thao tác này không còn phù hợp. Đóng hộp thoại để xem trạng thái hiện tại." Không ghi trùng. |
| 3 | Trình duyệt 1 "Kích hoạt lại quán". | Quán hoạt động lại. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Quán được kích hoạt lại.

**Căn cứ:** `apps/admin-web/src/dom/shops-view.ts; tests: admin-shops.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-shops.int.spec.ts; admin-concurrency.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-013 · Bấm nhiều lần liên tiếp vào các nút quan trọng ("Nhận đơn", "Đã nhận hàng", "Giao thành công", "Xác nhận đơn")

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #225 (trong ngày: 58) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi thao tác chỉ tác động một lần dù bấm dồn; ví và đơn không bị lặp. |
| Người thực hiện | Shipper + Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-FLOW-003 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một yêu cầu giao DIRECT mới; ghi số dư ví SP-A (B0). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper bấm "Nhận đơn" 5 lần thật nhanh. | Chỉ nhận một lần; ví chỉ tạm giữ một lần hoa hồng. |
| 2 | Bấm "Đã nhận hàng" > ở hộp xác nhận bấm nút xác nhận 5 lần liên tiếp. | Chỉ chuyển trạng thái một lần. |
| 3 | Bấm "Giao thành công" > nút xác nhận 5 lần liên tiếp. | Chỉ hoàn thành một lần; có đúng MỘT dòng "Hoa hồng". |
| 4 | Kiểm tra ví. | Tổng số dư = B0 - hoa hồng (đúng một lần). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu có hơn một dòng hoa hồng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart (M07Actions.act chặn bấm lặp); apps/backend/src/idempotency`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; idempotency-executor.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-014 · Chuyển ứng dụng 11Ship sang chạy nền và khóa màn hình: vẫn nhận đơn và chia sẻ vị trí

**Mức độ:** P0 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #226 (trong ngày: 59) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper không phải mở app mới nhận đơn; vị trí được gửi đều khoảng 1 phút một lần khi màn hình khóa. |
| Người thực hiện | Shipper + Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-002 |
| Điều kiện hệ thống cần có | Thông báo đẩy (Firebase) nếu muốn kiểm push |
| Điều kiện ban đầu | SP-A online, đủ điều kiện, trong 3 km quanh quán. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Thông báo đẩy khi màn hình khóa cần Firebase đã cấu hình (TC-NOTI-001). Nếu chưa có, đơn mới chỉ thấy khi mở app; ghi nhận. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Shipper bấm Home để đưa 11Ship xuống nền, dùng một ứng dụng khác (ví dụ Chrome) 5 phút. | Thông báo chia sẻ vị trí của 11Ship vẫn hiển thị. |
| 2 | Khóa màn hình điện thoại, đợi 5 phút. Quán tạo yêu cầu giao mới. | Shipper nhận thông báo "Có đơn giao hàng mới" trên màn hình khóa (nếu push đã cấu hình); thông báo chỉ có nội dung ngắn, không có số điện thoại/địa chỉ. |
| 3 | Mở khóa, chạm thông báo. | Mở đúng danh sách/đơn "Có thể nhận". |
| 4 | Admin xem vị trí shipper (nếu đang giữ đơn) hoặc quán xem vị trí. | Vị trí được cập nhật liên tục khoảng 1 phút một lần trong thời gian khóa màn hình (ghi nhận số lần cập nhật). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tắt online.

**Căn cứ:** `docs/current/M14-online-location-20261024.md (Cách Owner thử)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship (LocationReporterTest); tests/integration/m07-delivery.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-015 · Bật chế độ tiết kiệm pin: vị trí và thông báo vẫn hoạt động (hoặc báo rõ giới hạn)

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #227 (trong ngày: 60) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chế độ tiết kiệm pin có thể làm hệ điều hành dừng dịch vụ; ghi nhận ảnh hưởng thực tế theo từng hãng máy. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A online với một đơn đang giữ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Đây là giới hạn của Android/hãng máy; không phải lỗi nếu ứng dụng phát hiện và hướng dẫn. Ghi hãng máy, đời Android. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Bật "Tiết kiệm pin" của điện thoại, khóa màn hình 5 phút. | Ghi nhận: vị trí có còn cập nhật? Thông báo có còn đến? |
| 2 | Mở 11Ship. | Đơn còn; nếu vị trí bị gián đoạn có hướng dẫn "Thử lại"/"Mở cài đặt"; không có số liệu sai. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tắt tiết kiệm pin.

**Căn cứ:** `docs/current/M14-online-location-20261024.md (Giới hạn của Android)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Không có (không thể tự động hóa).

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-016 · Nhập ký tự đặc biệt, rất dài hoặc kiểu "mã độc" vào các ô văn bản

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #228 (trong ngày: 61) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Ô văn bản phải hiển thị nguyên văn như chữ thường, không làm hỏng giao diện, không thực thi gì. |
| Người thực hiện | Khách + Chủ quán + Admin |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Máy tính có trình duyệt (Web Admin) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | KH-A có giỏ món. |
| Dữ liệu nhập | Ghi chú đơn: "<b>đậm</b> <script>alert(1)</script> ' OR 1=1 -- 😀 Nguyễn Văn Ở". Tên người nhận: "Ng@#$%^&*()". Ghi chú 200 ký tự toàn chữ "a". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Khách đặt đơn với ghi chú và tên người nhận như Dữ liệu nhập. | Gửi được hoặc báo lỗi rõ ràng nếu vượt giới hạn; không crash. |
| 2 | Quán mở đơn và đọc ghi chú. | Hiện NGUYÊN VĂN từng ký tự như chữ thường (không in đậm, không chạy script, emoji hiển thị hoặc ô vuông). |
| 3 | Admin mở đơn ở Web Admin > Đơn hàng. | Cũng hiện nguyên văn, không có cửa sổ cảnh báo lạ nào hiện ra. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu có cửa sổ cảnh báo của script hoặc giao diện bị vỡ do nội dung nhập.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `apps/admin-web/src/dom/dom.ts (h() tạo nút DOM an toàn); apps/backend (validators)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; admin-web unit tests

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-017 · Điện thoại có giờ sai (đồng hồ lệch nhiều)

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #229 (trong ngày: 62) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Giờ điện thoại sai làm xác thực thiết bị thất bại; ứng dụng phải hướng dẫn kiểm tra giờ. |
| Người thực hiện | Khách / Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đăng xuất. Tắt "Ngày và giờ tự động" và chỉnh giờ điện thoại lệch hơn 1 ngày. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food và đăng nhập. | Hiện lỗi "Máy chủ chưa xác nhận được thiết bị. Hãy kiểm tra giờ của điện thoại rồi thử lại." (hoặc thông báo tương tự), không vào được. |
| 2 | Bật lại "Ngày và giờ tự động", đăng nhập lại. | Đăng nhập thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Bật lại ngày giờ tự động.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart ("Hãy kiểm tra giờ của điện thoại")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/native-device-binding.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-018 · Chạy trên các phiên bản Android khác nhau (8, 10, 12, 13, 14)

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #230 (trong ngày: 63) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Ứng dụng hỗ trợ từ Android 8.0; mỗi đời máy có cách hỏi quyền khác nhau (vị trí, thông báo, cài APK). |
| Người thực hiện | Người kiểm thử |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một điện thoại thật Android 8.0+ (ghi hãng, model, đời Android). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chỉ làm với các điện thoại thật có sẵn; mỗi máy một dòng kết quả. Không bắt buộc có đủ 5 đời máy. Ghi rõ hãng + đời Android. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Cài 11Food và 11Ship, đăng nhập KH-A / SP-A. | Cài và đăng nhập được. |
| 2 | Kiểm tra hộp xin quyền vị trí, quyền thông báo (Android 13+), quyền cài đặt từ nguồn lạ. | Mỗi hộp hiện đúng và ứng dụng hướng dẫn nếu từ chối. |
| 3 | Thực hiện một vòng ngắn: tìm quán, thêm giỏ (khách); bật online (shipper). | Chạy được; không có màn trắng, không crash. |
| 4 | Chụp màn hình các màn chính. | Chữ không bị cắt, nút bấm được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/tool/prepare-android.sh (minSdk 26); mobile/tool/check-apk-permissions.sh`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Workflow "Mobile APK" (build); không kiểm trên máy thật

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-019 · Màn hình nhỏ, cỡ chữ lớn và xoay ngang

**Mức độ:** P2 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #231 (trong ngày: 64) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Nội dung vẫn đọc và bấm được khi người dùng chỉnh cỡ chữ lớn hoặc xoay màn hình. |
| Người thực hiện | Người kiểm thử |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Cài đặt > Màn hình > Cỡ chữ: lớn nhất. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food, duyệt Trang chủ, quán, giỏ và màn "Xác nhận đơn". | Chữ không bị cắt khuất nút "Gửi đơn"; vẫn cuộn được. |
| 2 | Xoay ngang điện thoại ở màn "Giỏ hàng". | Không mất dữ liệu đã nhập; không crash. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đặt lại cỡ chữ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/tokens.dart (kTapMin)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test (widget tests)

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-020 · Chủ quán đăng nhập trên điện thoại khác: phiên cũ kết thúc, quán không mất đơn

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #232 (trong ngày: 65) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Chuyển điện thoại quản lý quán không làm mất đơn; chỉ một thiết bị quản lý quán tại một thời điểm. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-SHOP-021 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | CQ-A đang ở chế độ quản lý quán trên Điện thoại 2; có một đơn "Đang chuẩn bị". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập CQ-A trên Điện thoại 1 và vào chế độ quản lý quán. | Vào được; thấy cùng đơn "Đang chuẩn bị". |
| 2 | Trên Điện thoại 2 thao tác bất kỳ (ví dụ làm mới danh sách). | Bị đăng xuất ("Phiên đăng nhập đã kết thúc"). |
| 3 | Trên Điện thoại 1 tiếp tục "Gọi shipper". | Thành công, không mất dữ liệu đơn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/README.md (login from another phone ends the sessions); apps/backend/src/client-auth`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/native-device-binding.int.spec.ts; client-auth-session.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-021 · Hai màn hình mở cùng một đơn: thao tác trên màn đã cũ bị yêu cầu tải lại

**Mức độ:** P1 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #233 (trong ngày: 66) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu dữ liệu đã đổi ở nơi khác, ứng dụng không ghi đè mà yêu cầu tải lại. |
| Người thực hiện | Chủ quán |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ABN-020 |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Quán mở chi tiết một đơn "Chờ xác nhận" trên Điện thoại 2; Admin có quyền mở cùng đơn trên Web Admin. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Dùng hai điện thoại nhưng cùng tài khoản là không thể (xem TC-ABN-020). Cách thay thế: một điện thoại quán + Web Admin cùng thao tác trên một đơn. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Admin hủy đơn món trên Web Admin (có lý do). | Đơn "Đã hủy". |
| 2 | Quán (màn chưa làm mới) bấm "Xác nhận đơn". | Không xác nhận được; hiện thông báo dữ liệu đã thay đổi và tải lại; đơn hiển thị "Đã hủy". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m07/m07_widgets.dart ("Dữ liệu đã thay đổi"); orders-view.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-admin-orders.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ABN-022 · Nút Back và đóng hộp thoại giữa chừng không làm mất hoặc gửi nhầm thao tác

**Mức độ:** P2 · **Nhóm:** H. Trường hợp bất thường · **Số thứ tự chạy:** #234 (trong ngày: 67) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Người dùng thoát ngang khi gửi đơn/hủy đơn thì không có thao tác ngoài ý muốn. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-CUS-025 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Giỏ có món, đang ở "Xác nhận đơn". |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Nhấn Back khi đang ở màn "Xác nhận đơn". | Quay về giỏ; chưa có đơn nào được tạo. |
| 2 | Mở hộp "Hủy đơn?" của một đơn đang chờ rồi bấm ra ngoài/Back. | Hộp đóng, đơn KHÔNG bị hủy. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m10/m10_customer_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m10_orders_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-001 · Quán này không thấy đơn và yêu cầu giao của quán khác

**Mức độ:** P0 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #235 (trong ngày: 68) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi chủ quán chỉ thấy đơn của quán mình. |
| Người thực hiện | Chủ quán A + Chủ quán B |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-SHOP-011 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Quán Test A có ít nhất một đơn. CQ-B đã hoàn tất hồ sơ Quán Test B. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Đăng nhập CQ-B, vào chế độ quản lý quán, mở "Đơn hàng" > "Đơn món" và "Giao hàng". | KHÔNG thấy bất kỳ đơn hay yêu cầu giao nào của Quán Test A. |
| 2 | Tìm bằng mã một đơn của Quán Test A trong ô tìm. | "Không có đơn phù hợp". |
| 3 | Đăng nhập CQ-A. | Thấy đầy đủ đơn của Quán Test A. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu lộ đơn của quán khác.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `apps/backend/src/orders/order-shop.controller.ts; tests: m10-orders.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m10-orders.int.spec.ts; shop-management.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-002 · Shipper này không thấy đơn đang giữ của shipper khác

**Mức độ:** P0 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #236 (trong ngày: 69) · **Mức nghiêm trọng nếu FAIL:** NGHIÊM TRỌNG

| Mục | Nội dung |
|---|---|
| Mục đích | Đơn đã được người khác nhận không hiện trong "Đang thực hiện" của shipper khác. |
| Người thực hiện | Shipper A + Shipper B |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-DRV-009 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | SP-A đang giữ một đơn; SP-B online. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | SP-B mở "Đơn hàng" > "Đang thực hiện" và "Có thể nhận". | Không thấy đơn của SP-A; đơn đã bị nhận không còn trong "Có thể nhận". |
| 2 | SP-B thử mở trực tiếp đơn của SP-A (nếu có đường dẫn từ thông báo cũ). | Bị từ chối hoặc báo không còn quyền xem ("Bạn không còn quyền xem nội dung này"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. FAIL NGHIÊM TRỌNG nếu SP-B thấy thông tin khách của đơn SP-A.

**Cách khôi phục để chạy lại:** Nếu đơn vẫn còn đang chạy: hủy đơn đúng cách (khách hủy khi quán chưa xác nhận, hoặc quán bấm "Hủy đơn món"; nếu shipper đã lấy hàng thì xử lý theo test FLOW tương ứng) rồi ghi mã đơn đã dùng vào ô ghi chú. Mỗi lần chạy lại hãy đặt đơn mới, không dùng lại đơn cũ.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m08/m08_views.dart ("Bạn không còn quyền xem nội dung này"); apps/backend/src/delivery`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m07-delivery.int.spec.ts; m08-notifications.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-003 · Người dùng không thấy mã tra cứu/UUID/mã kỹ thuật trên màn hình

**Mức độ:** P1 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #237 (trong ngày: 70) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Theo yêu cầu của Owner, thông báo lỗi không hiện "mã tra cứu"/request ID cho người dùng; thông tin này chỉ ở nhật ký máy chủ. |
| Người thực hiện | Khách + Quán + Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Dùng các màn đơn hàng/giao hàng khi gặp một lỗi (ví dụ thao tác khi mất mạng). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Gây một lỗi bất kỳ ở màn đơn hàng/giao hàng (ví dụ bật máy bay rồi bấm thao tác). | Thông báo lỗi bằng tiếng Việt đơn giản. |
| 2 | Đọc kỹ toàn bộ thông báo lỗi. | KHÔNG có "Mã tra cứu", chuỗi dài 32-36 ký tự kiểu UUID, hay tên lỗi tiếng Anh viết hoa liền nhau (ví dụ FEE_LOCKED). Ngoại lệ đã ghi: lỗi thiết bị "DEVICE_PROOF_UNSUPPORTED" ở màn đăng nhập. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `docs/current/M07-owner-delivery-flow-20261023.md mục IV (không hiển thị mã tra cứu/request ID/UUID)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m07_views_test.dart; error_request_trace_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SEC-004 · Mật khẩu luôn bị ẩn và không hiện trong thông báo hay chẩn đoán

**Mức độ:** P1 · **Nhóm:** Bổ sung: Quyền, riêng tư và an toàn dữ liệu · **Số thứ tự chạy:** #238 (trong ngày: 71) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Mật khẩu không lộ trên màn hình/ảnh chụp. |
| Người thực hiện | Người kiểm thử |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Mở màn Đăng nhập/Đăng ký/Đổi mật khẩu. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Gõ mật khẩu ở các màn hình. | Ký tự hiển thị dạng chấm (ẩn); ở Web Admin chỉ hiện khi chủ động bấm biểu tượng con mắt. |
| 2 | Gây lỗi đăng nhập và đọc thông báo. | Thông báo không in lại mật khẩu hay số điện thoại đầy đủ. |
| 3 | Đọc mọi màn hình có chữ "Phiên bản" hoặc "Mã nguồn" nếu có (ví dụ trang Phiên bản & cập nhật của Web Admin). | Không có mật khẩu, token, OTP hay chuỗi bí mật. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/errors.dart (sanitizeDiagnosticText)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/config_errors_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---
