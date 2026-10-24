# Danh sách kiểm thử P0 - hành trình bắt buộc chạy nhanh trước

P0 = bắt buộc: nếu một test P0 FAIL thì chưa nên thử tiếp phần phụ thuộc vào nó và phải báo lỗi ngay. Danh sách này lấy TẤT CẢ test mức P0 từ `TESTCASE_11SHIP.csv`, giữ đúng thứ tự phụ thuộc.

Tổng số: **132** test P0 (trên tổng 289 test).

Cách chạy nhanh: làm đúng thứ tự dưới đây. Dòng ghi **CẦN CHUẨN BỊ TRƯỚC**: kỹ thuật viên/Owner chuẩn bị xong rồi bạn tự làm một mình. Dòng ghi **CẦN KỸ THUẬT VIÊN LÀM CÙNG**: có bước chỉ kỹ thuật viên/SYSTEM làm được (bạn quan sát và ghi kết quả). Thiếu điều kiện thì ghi BLOCKED và làm test kế tiếp, đừng đứng đợi. Những dòng **NOT READY** chỉ ghi nhận hiện trạng.

## Ngày 1 - Cài ứng dụng, làm quen, tạo tài khoản và chuẩn bị Web Admin (27 test P0)

| STT P0 | Mã | Tên | Người thực hiện | Thiết bị | Sẵn sàng | Chặn pilot ngoài | Smoke | Kết quả (PASS / FAIL / BLOCKED) |
|---|---|---|---|---|---|---|---|---|
| 1 | TC-SET-001 | Cài đặt 11Food lần đầu từ file APK | Người kiểm thử (chưa cần tài khoản) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  | #1 | ☐ ☐ ☐ |
| 2 | TC-SET-002 | Cài đặt 11Ship lần đầu từ file APK | Người kiểm thử (chưa cần tài khoản) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #2 | ☐ ☐ ☐ |
| 3 | TC-SET-006 | Xem số phiên bản của ứng dụng để ghi vào báo cáo | Người kiểm thử | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #3 | ☐ ☐ ☐ |
| 4 | TC-ACC-001 | Đăng ký tài khoản khách hàng KH-A trên 11Food (có mã OTP) | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  | #4 | ☐ ☐ ☐ |
| 5 | TC-ACC-002 | Đăng ký tài khoản khách hàng thứ hai KH-B | Khách (KH-B) | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 6 | TC-ACC-003 | Đăng ký với mục đích "Chủ quán" (CQ-A) và chuyển thẳng sang tạo hồ sơ quán | Chủ quán (CQ-A) | Điện thoại 2 (máy QUÁN) | CẦN CHUẨN BỊ TRƯỚC |  | #5 | ☐ ☐ ☐ |
| 7 | TC-ACC-004 | Đăng ký tài khoản shipper SP-A trên 11Ship (có mã OTP) | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | CẦN CHUẨN BỊ TRƯỚC |  | #6 | ☐ ☐ ☐ |
| 8 | TC-ACC-005 | Đăng ký tài khoản shipper thứ hai SP-B | Shipper (SP-B) | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 9 | TC-ACC-008 | Đăng ký lại bằng số điện thoại đã có tài khoản | Khách | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 10 | TC-ACC-014 | Đăng nhập thành công bằng KH-A | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  | #7 | ☐ ☐ ☐ |
| 11 | TC-ACC-015 | Đăng nhập sai mật khẩu và sai số điện thoại | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  | #8 | ☐ ☐ ☐ |
| 12 | TC-ACC-016 | Đăng nhập shipper SP-A trên 11Ship | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #9 | ☐ ☐ ☐ |
| 13 | TC-ACC-017 | Đăng xuất có hộp xác nhận | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 14 | TC-ACC-018 | Tắt hẳn rồi mở lại ứng dụng: vẫn đăng nhập | Khách / Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 15 | TC-ACC-020 | Quên mật khẩu: đặt lại bằng mã OTP qua SMS | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 16 | TC-ACC-023 | Đổi mật khẩu khi đang đăng nhập | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 17 | TC-ACC-025 | Đăng nhập cùng một tài khoản trên điện thoại thứ hai: máy cũ bị đăng xuất | Khách (KH-A) | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 18 | TC-SET-007 | Cập nhật đè bản mới của 11Food (không gỡ app) | Khách | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 19 | TC-SET-008 | Cập nhật đè bản mới của 11Ship khi đang đăng nhập | Shipper | Điện thoại 3 (máy SHIPPER) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 20 | TC-ADM-001 | Mở Web Admin bằng trình duyệt và thấy trang đăng nhập | Quản trị | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 21 | TC-ADM-002 | SYSTEM đăng nhập Web Admin (mật khẩu + mã Authenticator) và đăng xuất | SYSTEM | Máy tính có trình duyệt (Web Admin) | CẦN KỸ THUẬT VIÊN LÀM CÙNG |  |  | ☐ ☐ ☐ |
| 22 | TC-ADM-004 | SYSTEM tạo lời mời ADMIN và phân quyền ban đầu | SYSTEM | Máy tính có trình duyệt (Web Admin) | CẦN KỸ THUẬT VIÊN LÀM CÙNG |  |  | ☐ ☐ ☐ |
| 23 | TC-ADM-005 | Kích hoạt tài khoản ADMIN: mã OTP SMS, đặt mật khẩu, thiết lập Authenticator | ADMIN-1 | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 24 | TC-ADM-006 | Thêm quản trị viên thứ hai (ADMIN-2) chỉ có quyền Xem Quán | SYSTEM + ADMIN-2 | Máy tính có trình duyệt (Web Admin) | CẦN KỸ THUẬT VIÊN LÀM CÙNG |  |  | ☐ ☐ ☐ |
| 25 | TC-ADM-003 | Đăng nhập Web Admin sai mật khẩu hoặc sai mã Authenticator | Quản trị | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 26 | TC-ADM-020 | Quản lý "Nhóm món" (danh mục) để chủ quán thêm món | ADMIN/SYSTEM (quyền Nhóm món) | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  | #10 | ☐ ☐ ☐ |
| 27 | TC-ADM-024 | Bảng "Phí & điều kiện giao": xem, thử tính phí; chỉ SYSTEM được sửa | SYSTEM, ADMIN | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  | #11 | ☐ ☐ ☐ |

## Ngày 2 - Khách đặt hàng và chủ quán nhận đơn (28 test P0)

| STT P0 | Mã | Tên | Người thực hiện | Thiết bị | Sẵn sàng | Chặn pilot ngoài | Smoke | Kết quả (PASS / FAIL / BLOCKED) |
|---|---|---|---|---|---|---|---|---|
| 28 | TC-SHOP-001 | Chủ quán A tạo hồ sơ quán, ghim vị trí lấy hàng và hoàn tất hồ sơ | Chủ quán (CQ-A) | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  | #12 | ☐ ☐ ☐ |
| 29 | TC-ADM-015 | Ghi nhận hiện trạng: quán hoạt động ngay khi hồ sơ đủ, không có bước "Admin duyệt quán" | ADMIN/SYSTEM + Chủ quán | Máy tính có trình duyệt (Web Admin); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 30 | TC-SHOP-002 | Quán C chưa đủ điều kiện kích hoạt: không hoàn tất được khi thiếu địa chỉ hoặc vị trí ghim | Chủ quán (CQ-C) | Điện thoại 2 (máy QUÁN) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 31 | TC-ADM-012 | Danh sách người dùng: tìm, lọc "Đang khóa", xem chi tiết | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 32 | TC-SHOP-005 | Chủ quán chuyển qua lại giữa chế độ quản lý quán và chế độ khách hàng | Chủ quán (CQ-A) | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 33 | TC-SHOP-009 | Cài giờ hoạt động "Cả tuần 00:00-24:00" để quán luôn mở khi thử | Chủ quán (CQ-A) | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  | #13 | ☐ ☐ ☐ |
| 34 | TC-CUS-001 | Trang chủ 11Food: lấy vị trí hiện tại và hiện danh sách quán gần bạn | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 35 | TC-SHOP-011 | Dựng "Quán Test B" ngoài giờ hoạt động (đóng cửa theo lịch) | Chủ quán (CQ-B) | Điện thoại 2 (máy QUÁN) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 36 | TC-SHOP-012 | Thêm món có ảnh vào thực đơn "Quán Test A" | Chủ quán (CQ-A) | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  | #14 | ☐ ☐ ☐ |
| 37 | TC-SHOP-014 | Sửa giá món và khách thấy giá mới | Chủ quán + Khách | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 38 | TC-CUS-005 | Tìm quán theo tên (không cần gõ dấu) | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 39 | TC-SHOP-015 | Ẩn món và hiện lại món | Chủ quán + Khách | Điện thoại 2 (máy QUÁN); Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 40 | TC-CUS-009 | Trang chi tiết quán: tên, giờ hoạt động, thực đơn và giá | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 41 | TC-SHOP-037 | Thêm một món cho "Quán Test B" (quán ngoài giờ) để thử đặt món khi quán đóng cửa | Chủ quán (CQ-B) | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 42 | TC-CUS-010 | Quán đóng cửa (Quán Test B): khách thấy nhưng không đặt được | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 43 | TC-ADM-014 | Danh sách quán trên Web Admin: tìm, lọc theo hồ sơ/lịch, xem chi tiết và xem như khách | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 44 | TC-CUS-015 | Thêm món vào giỏ (số lượng và ghi chú) | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  | #16 | ☐ ☐ ☐ |
| 45 | TC-CUS-022 | Thêm địa chỉ giao hàng vào sổ địa chỉ | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  | #15 | ☐ ☐ ☐ |
| 46 | TC-CUS-021 | Giỏ hiển thị phí giao dự tính và tổng dự kiến | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | CẦN CHUẨN BỊ TRƯỚC |  | #17 | ☐ ☐ ☐ |
| 47 | TC-CUS-025 | Gửi đơn đặt món: kiểm tra màn "Xác nhận đơn", tiền và thông báo "Đã gửi đơn" | Khách (KH-A) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 48 | TC-SHOP-021 | Quán nhận đơn mới của khách và thấy đủ thông tin | Khách + Chủ quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 49 | TC-SHOP-022 | Quán xác nhận đơn | Chủ quán + Khách | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 50 | TC-SHOP-023 | Quán từ chối đơn có lý do | Chủ quán + Khách | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 51 | TC-SHOP-026 | Quán hủy đơn món trước khi shipper lấy hàng | Chủ quán + Khách | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 52 | TC-CUS-031 | Đặt món ở quán đang đóng cửa bị từ chối | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 53 | TC-CUS-036 | Khách hủy đơn khi quán chưa xác nhận | Khách + Chủ quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 54 | TC-CUS-037 | Khách không hủy được sau khi quán xác nhận (chỉ còn khi shipper đã lấy hàng) | Khách + Chủ quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 55 | TC-CUS-039 | Khách chỉ thấy đơn của chính mình | Khách (KH-A, KH-B) | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |

## Ngày 3 - Shipper nhận, lấy và giao hàng (kèm nạp ví thử nghiệm) (29 test P0)

| STT P0 | Mã | Tên | Người thực hiện | Thiết bị | Sẵn sàng | Chặn pilot ngoài | Smoke | Kết quả (PASS / FAIL / BLOCKED) |
|---|---|---|---|---|---|---|---|---|
| 56 | TC-WAL-001 | Ví shipper mới: số dư 0đ, chưa có giao dịch | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #18 | ☐ ☐ ☐ |
| 57 | TC-WAL-002 | Nạp tiền: số tiền dưới mức tối thiểu bị từ chối | Shipper | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #19 | ☐ ☐ ☐ |
| 58 | TC-WAL-003 | Tạo yêu cầu nạp tiền: thông tin chuyển khoản và trạng thái "Chờ xử lý" (tiền chưa vào ví) | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) | #20 | ☐ ☐ ☐ |
| 59 | TC-WAL-004 | Admin thấy yêu cầu nạp tiền và đối chiếu thông tin | ADMIN | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  | #21 | ☐ ☐ ☐ |
| 60 | TC-WAL-005 | Admin ghi nhận tiền: ví shipper được cộng đúng một lần (nạp cho SP-A bằng tiền thử nghiệm) | ADMIN + Shipper | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) | #22 | ☐ ☐ ☐ |
| 61 | TC-DRV-003 | Shipper không đủ tiền trong ví (SP-B) không bật online / không nhận được đơn | Shipper (SP-B) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 62 | TC-WAL-010 | Shipper mới phải nạp tối thiểu một lần được xác nhận mới nhận được đơn | Shipper (SP-B) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 63 | TC-WAL-006 | Admin từ chối yêu cầu nạp: ví không thay đổi | ADMIN + Shipper | Máy tính có trình duyệt (Web Admin); Điện thoại 3 (máy SHIPPER) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 64 | TC-WAL-008 | Admin không được ghi nhận trùng mã giao dịch ngân hàng | ADMIN | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 65 | TC-DRV-001 | Trang chủ 11Ship khi chưa bật online: trạng thái, ví và điều kiện nhận đơn | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 66 | TC-DRV-002 | Bật online thành công khi ví đủ điều kiện và GPS tốt | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Thông báo/đồng ý về vị trí nền |  | ☐ ☐ ☐ |
| 67 | TC-DRV-004 | Bật online khi GPS của điện thoại đang tắt | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 68 | TC-DRV-005 | Tắt online | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 69 | TC-SHOP-031 | Quán tạo yêu cầu giao hàng trực tiếp (DIRECT) - nhập đủ thông tin | Chủ quán (CQ-A) | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  | #24 | ☐ ☐ ☐ |
| 70 | TC-SHOP-034 | Quán hủy yêu cầu giao khi chưa có shipper nhận | Chủ quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 71 | TC-DRV-007 | Danh sách "Có thể nhận": thông tin thấy và không thấy trước khi nhận đơn | Shipper + Quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 72 | TC-DRV-009 | Shipper nhận đơn | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 73 | TC-DRV-017 | Đơn DIRECT: shipper giao theo địa chỉ mô tả, không cần ghim điểm giao | Shipper | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 74 | TC-DRV-012 | Shipper hủy nhận đơn trước khi lấy hàng (có lý do) | Shipper (SP-A) + Quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 75 | TC-DRV-013 | Shipper bấm "Đã nhận hàng": một bước xác nhận, phí bị khóa | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 76 | TC-DRV-015 | Sau khi đã lấy hàng shipper không có nút hủy hoặc "Giao thất bại" | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 77 | TC-DRV-014 | Shipper giao thành công: hoa hồng thu đúng một lần | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 78 | TC-DRV-010 | Hai shipper bấm nhận cùng một đơn: chỉ một người nhận được | Hai shipper (SP-A, SP-B) | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 79 | TC-FLOW-001 | Đơn khách đặt qua 11Food - quán TRẢ phí giao - giao thành công (luồng chuẩn) | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #23 | ☐ ☐ ☐ |
| 80 | TC-FLOW-002 | Đơn khách đặt qua 11Food - KHÁCH trả phí giao - giao thành công | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 81 | TC-FLOW-003 | Quán chủ động gọi shipper (DIRECT) - quán trả phí - giao thành công | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #25 | ☐ ☐ ☐ |
| 82 | TC-ADM-021 | Danh sách và chi tiết "Đơn hàng" trên Web Admin | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 83 | TC-ADM-023 | Danh sách và chi tiết "Giao hàng" trên Web Admin (kể cả vị trí shipper) | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 84 | TC-ADM-017 | Danh sách và chi tiết shipper trên Web Admin | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |

## Ngày 4 - Hủy đơn, đổi phí, các tình huống bất thường (38 test P0)

| STT P0 | Mã | Tên | Người thực hiện | Thiết bị | Sẵn sàng | Chặn pilot ngoài | Smoke | Kết quả (PASS / FAIL / BLOCKED) |
|---|---|---|---|---|---|---|---|---|
| 85 | TC-FLOW-005 | Không có shipper nhận: sau 30 phút hệ thống ngừng tìm, đơn món không bị hủy | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 86 | TC-FLOW-006 | Sau khi ngừng tìm, quán gọi lại shipper và có người nhận | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 87 | TC-FLOW-007 | Đơn khách đặt, QUÁN trả phí: shipper đề xuất phí mới và quán ĐỒNG Ý | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 88 | TC-FLOW-008 | Đơn khách đặt, QUÁN trả phí: quán TỪ CHỐI đề xuất phí của shipper | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 89 | TC-FLOW-009 | Đơn khách đặt, KHÁCH trả phí: khách ĐỒNG Ý đề xuất phí trong 11Food | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 90 | TC-FLOW-010 | Đơn khách đặt, KHÁCH trả phí: khách TỪ CHỐI đề xuất phí | Khách + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 91 | TC-FLOW-013 | Quán gọi shipper (DIRECT), QUÁN trả phí: shipper đề xuất, quán đồng ý rồi từ chối | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 92 | TC-FLOW-014 | Quán gọi shipper (DIRECT), KHÁCH trả phí nhưng không có tài khoản: quán xác nhận thay khách | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 93 | TC-FLOW-015 | Shipper đề xuất phí SAU khi nhận đơn, trước khi lấy hàng: chưa lấy hàng được cho đến khi có trả lời | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 94 | TC-FLOW-016 | Shipper bỏ lượt nhận (hủy nhận) rồi shipper khác nhận; đồng hồ tìm không bị tính lại | Hai shipper + Quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 95 | TC-FLOW-017 | Quán hủy yêu cầu giao khi shipper đã nhận nhưng chưa lấy hàng (đơn ORDER vẫn còn) | Chủ quán + Shipper + Khách | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 96 | TC-FLOW-018 | Quán hủy đơn món khi shipper đã nhận nhưng chưa lấy hàng | Chủ quán + Shipper + Khách | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 97 | TC-FLOW-019 | Khách hủy đơn SAU khi shipper đã lấy hàng (đơn ORDER) | Khách + Shipper + Chủ quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 98 | TC-FLOW-020 | Quán hủy yêu cầu giao (DIRECT) SAU khi shipper đã lấy hàng, rồi xử lý hàng | Chủ quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 99 | TC-FLOW-021 | Chủ quán KHÔNG hủy được đơn khách đặt sau khi shipper đã lấy hàng | Chủ quán | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 100 | TC-FLOW-023 | Thông báo đến đúng người, đúng đơn, đúng nội dung trong cả luồng | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 101 | TC-FLOW-024 | Không tạo trùng đơn / trùng yêu cầu giao khi bấm nhiều lần | Khách + Chủ quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 102 | TC-FLOW-025 | Mất mạng đúng lúc khách gửi đơn: ứng dụng báo "chưa biết đơn đã gửi chưa" và không tạo đơn thứ hai | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 103 | TC-FLOW-026 | Hoa hồng của shipper: giữ chỗ khi nhận, trả lại khi hủy, thu đúng một lần khi hoàn thành | Shipper + Quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 104 | TC-NOTI-002 | Hộp thông báo trong ứng dụng đồng bộ khi mở lại và cập nhật trực tiếp | Khách + Chủ quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #27 | ☐ ☐ ☐ |
| 105 | TC-NOTI-005 | Sau khi đăng xuất, máy không còn nhận thông báo của tài khoản cũ | Khách | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 106 | TC-SHOP-036 | Quán xác nhận hàng đã về / đã xử lý sau khi hủy giao đã lấy hàng | Chủ quán | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 107 | TC-ACC-026 | Đăng nhập lại khi đang có đơn đang giao: đơn không mất | Khách + Quán + Shipper | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 108 | TC-ACC-027 | Phiên bị thu hồi khi Admin khóa tài khoản đang đăng nhập | Khách + ADMIN | Điện thoại 1 (máy KHÁCH); Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |
| 109 | TC-ADM-013 | Khóa tài khoản bị chặn khi tài khoản còn đơn đang xử lý | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |
| 110 | TC-ADM-016 | Admin vô hiệu hóa và kích hoạt lại quán | ADMIN (có quyền Quản lý hoạt động quán) / SYSTEM | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |
| 111 | TC-CUS-014 | Quán bị Admin vô hiệu hóa không còn hiện cho khách | Khách + ADMIN | Điện thoại 1 (máy KHÁCH); Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 112 | TC-ABN-001 | Mất Internet khi đang xem quán và giỏ hàng (khách) | Khách | Điện thoại 1 (máy KHÁCH) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 113 | TC-ABN-002 | Shipper mất Internet lúc bấm "Giao thành công" hoặc "Đã nhận hàng" | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 114 | TC-ABN-003 | Quán mất mạng lúc bấm "Xác nhận đơn" hoặc "Gọi shipper" | Chủ quán | Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 115 | TC-ABN-004 | Tắt đột ngột ứng dụng 11Ship khi đang giao: đơn không mất, vị trí tiếp tục được chia sẻ | Shipper + Chủ quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 116 | TC-ABN-006 | GPS tắt giữa lúc shipper đang giữ đơn | Shipper + Chủ quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 117 | TC-ABN-010 | Hai người cùng thao tác một đơn: quán hủy trong lúc shipper bấm "Nhận đơn" | Quán + Shipper | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 118 | TC-ABN-011 | Khách hủy đơn trong lúc quán bấm "Xác nhận đơn" | Khách + Chủ quán | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 119 | TC-ABN-013 | Bấm nhiều lần liên tiếp vào các nút quan trọng ("Nhận đơn", "Đã nhận hàng", "Giao thành công", "Xác nhận đơn") | Shipper + Chủ quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 120 | TC-ABN-014 | Chuyển ứng dụng 11Ship sang chạy nền và khóa màn hình: vẫn nhận đơn và chia sẻ vị trí | Shipper + Chủ quán | Điện thoại 2 (máy QUÁN); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Thông báo/đồng ý về vị trí nền |  | ☐ ☐ ☐ |
| 121 | TC-SEC-001 | Quán này không thấy đơn và yêu cầu giao của quán khác | Chủ quán A + Chủ quán B | Điện thoại 2 (máy QUÁN) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |
| 122 | TC-SEC-002 | Shipper này không thấy đơn đang giữ của shipper khác | Shipper A + Shipper B | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |

## Ngày 5 - Ví, quản trị, đối chiếu kết quả và nghiệm thu (10 test P0)

| STT P0 | Mã | Tên | Người thực hiện | Thiết bị | Sẵn sàng | Chặn pilot ngoài | Smoke | Kết quả (PASS / FAIL / BLOCKED) |
|---|---|---|---|---|---|---|---|---|
| 123 | TC-WAL-011 | Lịch sử giao dịch: lọc "Nạp tiền", "Hoa hồng", "Tạm giữ" | Shipper (SP-A) | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG |  | #26 | ☐ ☐ ☐ |
| 124 | TC-WAL-012 | Đối chiếu tay: tổng số dư = tổng các dòng giao dịch | Shipper + ADMIN | Điện thoại 3 (máy SHIPPER); Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 125 | TC-WAL-013 | Ví không đủ tiền hoa hồng thì không nhận được đơn mới, nhưng đơn đang giao vẫn hoàn tất | Shipper | Điện thoại 3 (máy SHIPPER) | SẴN SÀNG | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 126 | TC-WAL-015 | Rút toàn bộ số dư khi dừng hoạt động: Admin nhận xử lý và ghi nhận đã chuyển (tiền thử nghiệm) | Shipper + ADMIN | Điện thoại 3 (máy SHIPPER); Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 127 | TC-WAL-018 | Tài chính Admin: tổng quan, danh sách ví và giao dịch | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | SẴN SÀNG |  |  | ☐ ☐ ☐ |
| 128 | TC-WAL-024 | Mất mạng hoặc bấm lặp khi tạo yêu cầu nạp/rút: không tạo trùng, không trừ hai lần | Shipper | Điện thoại 3 (máy SHIPPER) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Giao dịch tài chính (ví, nạp, rút, hoa hồng) |  | ☐ ☐ ☐ |
| 129 | TC-ADM-007 | Phân biệt quyền ADMIN và SYSTEM: ADMIN không vào được trang chỉ dành cho SYSTEM | ADMIN-1 | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |
| 130 | TC-ADM-008 | ADMIN-2 (chỉ quyền Xem Quán) không thao tác được các hành động cần quyền cao hơn | ADMIN-2 | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |
| 131 | TC-WAL-019 | Phân quyền tài chính: ADMIN không có quyền thì không thấy hoặc không thao tác được | ADMIN-2 + SYSTEM | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC | ⚠ Sai quyền (xem/làm việc không được phép) |  | ☐ ☐ ☐ |
| 132 | TC-ADM-028 | "Nhật ký hoạt động" (audit): xem, lọc, không sửa được, không lộ bí mật | ADMIN/SYSTEM | Máy tính có trình duyệt (Web Admin) | CẦN CHUẨN BỊ TRƯỚC |  |  | ☐ ☐ ☐ |

## Hành trình quan trọng nhất (7 bước, làm đầu tiên nếu thời gian ít)

1. TC-SET-001, TC-SET-002: cài hai ứng dụng.
2. TC-ACC-001, TC-ACC-003, TC-ACC-004: đăng ký khách, chủ quán, shipper.
3. TC-ADM-020, TC-ADM-024: Admin chuẩn bị nhóm món và bảng phí giao.
4. TC-SHOP-001, TC-SHOP-009, TC-SHOP-012: dựng Quán Test A (hồ sơ, giờ mở, món).
5. TC-WAL-003, TC-WAL-004, TC-WAL-005: nạp tiền thử nghiệm cho shipper (cần Owner duyệt tiền thử nghiệm).
6. TC-FLOW-001 và TC-FLOW-003: hai luồng giao hàng chính (khách đặt qua 11Food; quán tự gọi shipper).
7. TC-WAL-012: đối chiếu số dư ví sau các đơn.
