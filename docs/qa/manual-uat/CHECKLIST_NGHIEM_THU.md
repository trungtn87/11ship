# Checklist nghiệm thu phiên bản 11Ship

Dùng sau khi chạy xong bộ test (hoặc sau mỗi vòng thử). Mục tiêu: **quyết định rõ ràng** phiên bản này ở mức nào trong ba mức bên dưới. **Owner quyết định cuối cùng**; checklist chỉ cung cấp bằng chứng.

> **Không được tuyên bố đạt nghiệm thu chỉ vì CI (kiểm thử tự động) xanh.** CI không thay thế thử trên điện thoại thật, nhiều người cùng lúc, GPS thật, SMS thật và quy trình tiền thật.

## 1. Thông tin phiên bản đang đánh giá (điền)

| Mục | Giá trị |
|---|---|
| Mã commit/phiên bản đang thử (theo Người phụ trách) | |
| Phiên bản APK 11Food | |
| Phiên bản APK 11Ship | |
| Phiên bản máy chủ / Web Admin | |
| Môi trường (máy chủ thật / môi trường thử riêng) | |
| Tiền thử nghiệm được Owner duyệt (ngày, người duyệt) | |
| Điện thoại đã dùng (hãng, model, Android) | |
| Người kiểm thử, khoảng ngày | |

## 2. Ba kết luận và điều kiện (rõ ràng, đo được)

### 2.1 ✅ Có thể **tiếp tục thử nghiệm nội bộ**
Tất cả điều kiện sau phải đúng:

- [ ] **100% test P0 đã chạy** (không còn NOT RUN); P0 NOT READY chỉ được chấp nhận nếu Owner ghi rõ "chấp nhận" ở mục 6.
- [ ] Mọi test FAIL đều có **mã lỗi** và báo cáo theo `BAO_CAO_LOI_MAU.md`.
- [ ] **Không còn lỗi NGHIÊM TRỌNG đang mở mà chưa có người nhận sửa** (xem mục 3).
- [ ] Hai luồng chính **TC-FLOW-001** (khách đặt qua 11Food) và **TC-FLOW-003** (quán gọi shipper) đã chạy **hết hành trình** ít nhất một lần.
- [ ] Tiền thử nghiệm phát sinh được ghi lại đủ (mục 4).

### 2.2 🟡 Có thể **chạy thử với quán và shipper thật** (pilot nhỏ)
Tất cả điều kiện của 2.1 **và**:

- [ ] **100% test P0 PASS trên điện thoại thật** (không có P0 FAIL/BLOCKED), trừ P0 NOT READY có ghi chấp nhận.
- [ ] **Không có lỗi NGHIÊM TRỌNG hoặc CAO đang mở.**
- [ ] **≥ 90% test P1 PASS**; phần còn lại có lý do và được Owner chấp nhận.
- [ ] Các test sau **PASS** ở **ít nhất 3 lần chạy khác nhau** (hai người khác nhau): TC-FLOW-001, 002, 003, 007, 008, 009, 013, 016, 019, 020; TC-DRV-010; TC-WAL-005, 012; TC-ABN-002, 013.
- [ ] **Đối chiếu ví khớp từng đồng** (TC-WAL-012: chênh lệch = 0) sau toàn bộ vòng thử; "Đối soát" Admin không báo ví lệch.
- [ ] **Phân quyền đúng**: TC-ADM-007, 008; TC-SEC-001, 002; TC-WAL-019 PASS.
- [ ] **Thông báo đúng người, đúng đơn** (TC-FLOW-023, TC-NOTI-002, 005 PASS); nếu dùng thông báo đẩy: TC-NOTI-001 PASS.
- [ ] **Kiểm trên ≥ 2 hãng/đời điện thoại Android** (TC-ABN-018) và kiểm chạy nền/khóa màn hình (TC-ABN-004, 014).
- [ ] Owner đã **duyệt Điều khoản/Chính sách** và các lệch ở `DOI_CHIEU_CODE_TESTCASE.md` mục 4 (nhất là #4, #5, #6) đã được quyết định.
- [ ] **Sao lưu** có bản gần nhất đã kiểm chứng (TC-ADM-031) và SMS Gateway chạy ổn (TC-ADM-030).
- [ ] Có **người liên hệ hỗ trợ** và quy trình xử lý sự cố tiền/đơn trong thời gian pilot.

### 2.3 ⛔ **Chưa được đưa vào sử dụng** – chỉ cần MỘT điều sau là đủ
- [ ] Có lỗi liên quan **mất tiền, sai số dư, giao nhầm đơn, mất đơn, sai quyền người dùng, hoặc giao dịch lặp** (kể cả mới xảy ra 1 lần chưa tái hiện được: phải điều tra).
- [ ] Có test **P0 FAIL** hoặc **P0 BLOCKED** chưa giải quyết (không phải NOT READY đã chấp nhận).
- [ ] Đối chiếu ví **không khớp** hoặc "Đối soát" báo ví lệch.
- [ ] Thông báo/dữ liệu riêng tư gửi **sai người**; shipper/quán thấy dữ liệu **không được phép**.
- [ ] Chưa có tiền thử nghiệm được duyệt nên **không kiểm được nhóm Ví** (nhóm F) – không thể kết luận an toàn tiền.
- [ ] Chỉ có CI xanh, **chưa thử trên thiết bị thật**.

## 3. Phân loại lỗi nghiêm trọng (luôn là NGHIÊM TRỌNG, chặn nghiệm thu)

| Nhóm lỗi | Ví dụ cụ thể cần canh | Test đầu mối |
|---|---|---|
| **Mất tiền / tiền tăng sai** | Số dư tự giảm/tăng; yêu cầu nạp chưa xác nhận mà ví tăng; rút tiền trừ 2 lần | TC-WAL-003/005/008/012/015/024, TC-FLOW-026 |
| **Sai số dư / tạm giữ treo** | Tạm giữ không được giải phóng sau hủy; khả dụng ≠ Tổng − Tạm giữ | TC-DRV-009/012/014, TC-FLOW-016/018/019/020 |
| **Giao nhầm đơn / mất đơn** | Hai shipper cùng nhận; đơn biến mất sau đăng nhập lại; trạng thái hai bên khác nhau | TC-DRV-010, TC-ACC-026, TC-ABN-004/010/011 |
| **Sai quyền người dùng** | Quán B thấy đơn quán A; ADMIN làm được việc của SYSTEM; shipper thấy SĐT khách trước khi nhận; khách xem đơn người khác | TC-SEC-001/002, TC-ADM-007/008, TC-DRV-007, TC-CUS-039 |
| **Giao dịch / đơn lặp** | Hai đơn một lần bấm; hai dòng hoa hồng; hai yêu cầu giao | TC-FLOW-024/025, TC-ABN-002/003/013, TC-WAL-024 |
| **Quyền riêng tư / bảo mật** | Lộ OTP/mật khẩu trong thông báo/ảnh; thông báo màn hình khóa có số điện thoại | TC-NOTI-001, TC-SEC-003/004 |

## 4. Tiền thử nghiệm đã phát sinh (điền để Owner xử lý sổ sách)

| Ngày | Tài khoản shipper | Loại (nạp/ rút/ hoa hồng/ điều chỉnh) | Số tiền (đ) | Mã giao dịch TEST | Người thực hiện | Ghi chú |
|---|---|---|---|---|---|---|
| | | | | | | |

Tổng tiền thử nghiệm còn trong ví cuối vòng: ………… đ · Cách xử lý do Owner quyết định: ………………………

## 5. Bảng tổng hợp theo nhóm (điền số sau khi chạy)

| Nhóm | Tổng | P0 | P1 | P2 | PASS | FAIL | BLOCKED | NOT READY | NOT RUN |
|---|---|---|---|---|---|---|---|---|---|
| A. Cài đặt, thiết bị và phiên bản | 12 | 5 | 5 | 2 | | | | | |
| A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên | 33 | 16 | 10 | 7 | | | | | |
| B. Khách hàng 11Food | 40 | 13 | 19 | 8 | | | | | |
| C. Chủ quán 11Food | 37 | 16 | 16 | 5 | | | | | |
| D. Shipper 11Ship | 25 | 13 | 8 | 4 | | | | | |
| E. Luồng giao hàng liên thông | 30 | 22 | 7 | 1 | | | | | |
| F. Ví và tài chính | 25 | 15 | 10 | 0 | | | | | |
| G. Web Admin | 36 | 19 | 14 | 3 | | | | | |
| H. Trường hợp bất thường | 22 | 9 | 10 | 3 | | | | | |
| Bổ sung: Thông báo | 7 | 2 | 5 | 0 | | | | | |
| Bổ sung: Đánh giá và phản ánh | 8 | 0 | 6 | 2 | | | | | |
| Bổ sung: Quyền, riêng tư và an toàn dữ liệu | 7 | 2 | 5 | 0 | | | | | |
| Bổ sung: Rủi ro chỉ kiểm được bằng kỹ thuật (đối chiếu kiểm thử tự động) | 7 | 0 | 7 | 0 | | | | | |
| **Tổng** | **289** | **132** | **122** | **35** | | | | | |

## 6. Quyết định của Owner

| Mục | Lựa chọn |
|---|---|
| Kết luận | ☐ Tiếp tục thử nghiệm nội bộ ☐ Chạy thử quán/shipper thật ☐ Chưa được đưa vào sử dụng |
| Các test NOT READY chấp nhận (ghi mã) | |
| Các lệch tài liệu ↔ code đã quyết định (ghi số ở DOI_CHIEU mục 4) | |
| Điều kiện bổ sung / việc phải làm trước vòng sau | |
| Người quyết định, ngày | |

## 7. Danh sách đánh dấu từng test (in hoặc dán vào Excel)

Chép trạng thái thật vào cột "Trạng thái" của `TESTCASE_11SHIP.csv`; bảng dưới chỉ để đánh dấu nhanh. Thứ tự là **thứ tự nên chạy**.

### Ngày 1 - Cài ứng dụng, làm quen, tạo tài khoản và chuẩn bị Web Admin

| # | Mã | Tên | Mức | Kết quả |
|---|---|---|---|---|
| 1 | TC-SET-001 | Cài đặt 11Food lần đầu từ file APK | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 2 | TC-SET-002 | Cài đặt 11Ship lần đầu từ file APK | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 3 | TC-SET-003 | Cài cả 11Food và 11Ship trên cùng một điện thoại | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 4 | TC-SET-004 | Cấp quyền vị trí (GPS) cho 11Food lần đầu | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 5 | TC-SET-006 | Xem số phiên bản của ứng dụng để ghi vào báo cáo | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 6 | TC-SET-011 | Điện thoại không đạt yêu cầu bảo mật thiết bị | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 7 | TC-ACC-001 | Đăng ký tài khoản khách hàng KH-A trên 11Food (có mã OTP) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 8 | TC-ACC-002 | Đăng ký tài khoản khách hàng thứ hai KH-B | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 9 | TC-ACC-003 | Đăng ký với mục đích "Chủ quán" (CQ-A) và chuyển thẳng sang tạo hồ sơ quán | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 10 | TC-ACC-004 | Đăng ký tài khoản shipper SP-A trên 11Ship (có mã OTP) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 11 | TC-ACC-005 | Đăng ký tài khoản shipper thứ hai SP-B | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 12 | TC-ACC-006 | Đăng ký bị chặn khi nhập thiếu hoặc sai thông tin (màn 1/3) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 13 | TC-ACC-007 | Số điện thoại sai định dạng khi đăng ký và đăng nhập | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 14 | TC-ACC-008 | Đăng ký lại bằng số điện thoại đã có tài khoản | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 15 | TC-ACC-009 | Nhập sai mã OTP khi đăng ký | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 16 | TC-ACC-010 | Mã OTP hết hạn và nút "Gửi lại mã" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 17 | TC-ACC-011 | Xin mã OTP quá nhiều lần bị giới hạn | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 18 | TC-ACC-012 | Không gửi được SMS: ứng dụng phải báo thật, không giả thành công | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 19 | TC-ACC-013 | Sửa số điện thoại giữa chừng khi đang xác minh OTP | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 20 | TC-ACC-014 | Đăng nhập thành công bằng KH-A | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 21 | TC-ACC-015 | Đăng nhập sai mật khẩu và sai số điện thoại | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 22 | TC-SET-005 | Cấp quyền thông báo và vị trí cho 11Ship | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 23 | TC-ACC-016 | Đăng nhập shipper SP-A trên 11Ship | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 24 | TC-ACC-017 | Đăng xuất có hộp xác nhận | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 25 | TC-ACC-018 | Tắt hẳn rồi mở lại ứng dụng: vẫn đăng nhập | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 26 | TC-ACC-019 | Khởi động lại điện thoại: vẫn đăng nhập | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 27 | TC-ACC-020 | Quên mật khẩu: đặt lại bằng mã OTP qua SMS | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 28 | TC-ACC-021 | Quên mật khẩu: mã sai, hết hạn và số chưa đăng ký | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 29 | TC-ACC-022 | Sau khi đặt lại mật khẩu, các phiên đăng nhập cũ bị đăng xuất | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 30 | TC-ACC-023 | Đổi mật khẩu khi đang đăng nhập | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 31 | TC-ACC-024 | Đổi mật khẩu: mật khẩu mới không hợp lệ hoặc nhập lại không khớp | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 32 | TC-ACC-025 | Đăng nhập cùng một tài khoản trên điện thoại thứ hai: máy cũ bị đăng xuất | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 33 | TC-ACC-028 | Xem và sửa họ tên của tài khoản | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 34 | TC-ACC-029 | Xem Điều khoản sử dụng và Chính sách quyền riêng tư | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 35 | TC-ACC-033 | Mục Voucher trong 11Food báo rõ chưa hỗ trợ | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 36 | TC-SET-007 | Cập nhật đè bản mới của 11Food (không gỡ app) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 37 | TC-SET-008 | Cập nhật đè bản mới của 11Ship khi đang đăng nhập | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 38 | TC-SET-012 | Gỡ ứng dụng rồi cài lại: phải đăng nhập lại, dữ liệu trên máy chủ còn nguyên | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 39 | TC-ADM-001 | Mở Web Admin bằng trình duyệt và thấy trang đăng nhập | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 40 | TC-ADM-002 | SYSTEM đăng nhập Web Admin (mật khẩu + mã Authenticator) và đăng xuất | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 41 | TC-ADM-004 | SYSTEM tạo lời mời ADMIN và phân quyền ban đầu | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 42 | TC-ADM-005 | Kích hoạt tài khoản ADMIN: mã OTP SMS, đặt mật khẩu, thiết lập Authenticator | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 43 | TC-ADM-006 | Thêm quản trị viên thứ hai (ADMIN-2) chỉ có quyền Xem Quán | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 44 | TC-ADM-011 | ADMIN quên mật khẩu: đặt lại bằng SMS (SYSTEM không tự đặt lại trên web) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 45 | TC-ADM-003 | Đăng nhập Web Admin sai mật khẩu hoặc sai mã Authenticator | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 46 | TC-ADM-020 | Quản lý "Nhóm món" (danh mục) để chủ quán thêm món | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 47 | TC-ADM-024 | Bảng "Phí & điều kiện giao": xem, thử tính phí; chỉ SYSTEM được sửa | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |

### Ngày 2 - Khách đặt hàng và chủ quán nhận đơn

| # | Mã | Tên | Mức | Kết quả |
|---|---|---|---|---|
| 1 | TC-SHOP-001 | Chủ quán A tạo hồ sơ quán, ghim vị trí lấy hàng và hoàn tất hồ sơ | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 2 | TC-ADM-015 | Không có bước "Admin duyệt quán": quán đủ điều kiện hoạt động ngay | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 3 | TC-SHOP-002 | Quán C chưa đủ điều kiện kích hoạt: không hoàn tất được khi thiếu địa chỉ hoặc vị trí ghim | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 4 | TC-ADM-012 | Danh sách người dùng: tìm, lọc "Đang khóa", xem chi tiết | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 5 | TC-SHOP-003 | Lấy vị trí quán khi chưa cấp quyền GPS, GPS tắt hoặc GPS yếu | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 6 | TC-SHOP-004 | Vị trí quán nằm ngoài khu vực phục vụ | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 7 | TC-SHOP-005 | Chủ quán chuyển qua lại giữa chế độ quản lý quán và chế độ khách hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 8 | TC-SHOP-006 | Sửa hồ sơ quán đang hoạt động (tên, số điện thoại liên hệ) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 9 | TC-SHOP-007 | Thêm logo quán (không bắt buộc) và gỡ logo | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 10 | TC-SHOP-008 | Quán chưa cài giờ hoạt động thì bị coi là đóng cửa | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 11 | TC-SHOP-009 | Cài giờ hoạt động "Cả tuần 00:00-24:00" để quán luôn mở khi thử | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 12 | TC-SHOP-010 | Cài giờ riêng từng ngày, nhiều khoảng giờ và ca qua đêm | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 13 | TC-CUS-001 | Trang chủ 11Food: lấy vị trí hiện tại và hiện danh sách quán gần bạn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 14 | TC-SHOP-011 | Dựng "Quán Test B" ngoài giờ hoạt động (đóng cửa theo lịch) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 15 | TC-CUS-002 | Trang chủ khi GPS (dịch vụ vị trí) của điện thoại đang tắt | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 16 | TC-SHOP-012 | Thêm món có ảnh vào thực đơn "Quán Test A" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 17 | TC-CUS-003 | Khách đứng ngoài khu vực phục vụ | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 18 | TC-SHOP-013 | Thêm món: kiểm tra dữ liệu nhập sai | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 19 | TC-CUS-004 | Hiện khoảng cách, điểm đánh giá và trạng thái mở cửa trên thẻ quán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 20 | TC-SHOP-014 | Sửa giá món và khách thấy giá mới | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 21 | TC-CUS-005 | Tìm quán theo tên (không cần gõ dấu) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 22 | TC-SHOP-015 | Ẩn món và hiện lại món | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 23 | TC-CUS-006 | Tìm quán theo tên món | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 24 | TC-SHOP-016 | Tìm và lọc món trong thực đơn của chủ quán | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 25 | TC-CUS-007 | Tìm không có kết quả và xóa từ khóa | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 26 | TC-SHOP-017 | Xóa món khỏi thực đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 27 | TC-CUS-008 | Bộ lọc "Chỉ quán đang mở cửa" và lọc theo nhóm món | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 28 | TC-SHOP-018 | Chưa có nhóm món thì không thêm được món | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 29 | TC-CUS-009 | Trang chi tiết quán: tên, giờ hoạt động, thực đơn và giá | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 30 | TC-CUS-011 | Quán chưa có món nào đang hiện | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 31 | TC-SHOP-037 | Thêm một món cho "Quán Test B" (quán ngoài giờ) để thử đặt món khi quán đóng cửa | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 32 | TC-SHOP-019 | Xem trước thực đơn "như khách sẽ thấy" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 33 | TC-CUS-010 | Quán đóng cửa (Quán Test B): khách thấy nhưng không đặt được | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 34 | TC-SHOP-020 | Thoát màn sửa khi còn thay đổi chưa lưu | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 35 | TC-CUS-012 | Tìm món trong một quán | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 36 | TC-CUS-013 | Điểm đánh giá của quán khi chưa có đánh giá | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 37 | TC-ADM-014 | Danh sách quán trên Web Admin: tìm, lọc theo hồ sơ/lịch, xem chi tiết và xem như khách | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 38 | TC-CUS-015 | Thêm món vào giỏ (số lượng và ghi chú) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 39 | TC-CUS-016 | Thêm cùng món cùng ghi chú thì gộp dòng; khác ghi chú thì tách dòng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 40 | TC-CUS-017 | Tăng, giảm số lượng và xóa món khỏi giỏ | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 41 | TC-CUS-018 | Giỏ chỉ đặt từ một quán: đổi quán thì hỏi thay giỏ | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 42 | TC-CUS-019 | Xóa toàn bộ giỏ hàng | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 43 | TC-CUS-020 | Giỏ hàng được giữ khi thoát ứng dụng và khi đăng nhập lại | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 44 | TC-CUS-022 | Thêm địa chỉ giao hàng vào sổ địa chỉ | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 45 | TC-CUS-021 | Giỏ hiển thị phí giao dự tính và tổng dự kiến | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 46 | TC-CUS-023 | Sửa, đặt mặc định và xóa địa chỉ trong sổ | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 47 | TC-CUS-024 | Địa chỉ giao: kiểm tra dữ liệu sai | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 48 | TC-CUS-025 | Gửi đơn đặt món: kiểm tra màn "Xác nhận đơn", tiền và thông báo "Đã gửi đơn" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 49 | TC-SHOP-021 | Quán nhận đơn mới của khách và thấy đủ thông tin | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 50 | TC-CUS-026 | Không gửi được đơn khi chưa chọn địa chỉ hoặc thiếu thông tin | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 51 | TC-SHOP-022 | Quán xác nhận đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 52 | TC-SHOP-023 | Quán từ chối đơn có lý do | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 53 | TC-CUS-027 | Dùng vị trí hiện tại làm điểm giao khi đặt đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 54 | TC-SHOP-024 | Quán chỉnh đơn (đổi số lượng, bỏ món) - bắt buộc ghi lý do | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 55 | TC-SHOP-025 | Không xác nhận được đơn đã bị bỏ hết món | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 56 | TC-CUS-028 | Đặt hộ: người nhận khác người đặt | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 57 | TC-SHOP-026 | Quán hủy đơn món trước khi shipper lấy hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 58 | TC-CUS-029 | Đặt đơn hẹn giờ nhận món | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 59 | TC-SHOP-028 | Đơn hẹn giờ: quán thấy ở tab "Đơn hẹn" và nhận nhắc trước giờ hẹn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 60 | TC-SHOP-029 | Quán đổi lịch sau khi nhận đơn hẹn: đơn không tự hủy, có cảnh báo | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 61 | TC-CUS-030 | Hẹn giờ không hợp lệ: quá gần, quá xa, ngoài giờ mở cửa | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 62 | TC-CUS-031 | Đặt món ở quán đang đóng cửa bị từ chối | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 63 | TC-CUS-032 | Giá món thay đổi trước khi khách gửi đơn: yêu cầu kiểm tra lại | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 64 | TC-CUS-033 | Món bị ẩn trước khi khách gửi đơn: báo "Có món không còn bán" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 65 | TC-CUS-034 | Giới hạn: số lượng tối đa mỗi món và độ dài ghi chú | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 66 | TC-CUS-035 | Khách xem danh sách đơn: "Đang xử lý", "Đơn hẹn", "Lịch sử" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 67 | TC-CUS-036 | Khách hủy đơn khi quán chưa xác nhận | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 68 | TC-CUS-037 | Khách không hủy được sau khi quán xác nhận (chỉ còn khi shipper đã lấy hàng) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 69 | TC-CUS-038 | Đặt lại đơn cũ ("Đặt lại") với giá hôm nay | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 70 | TC-CUS-039 | Khách chỉ thấy đơn của chính mình | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 71 | TC-CUS-040 | Chi tiết đơn của khách: trạng thái, người trả phí, lịch sử đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 72 | TC-SHOP-027 | Lọc, tìm và xem lịch sử đơn của quán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 73 | TC-ACC-030 | Duyệt xem ứng dụng khi chưa đăng nhập (khách vãng lai) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |

### Ngày 3 - Shipper nhận, lấy và giao hàng (kèm nạp ví thử nghiệm)

| # | Mã | Tên | Mức | Kết quả |
|---|---|---|---|---|
| 1 | TC-WAL-020 | SYSTEM quản lý "Tài khoản nhận tiền" của hệ thống; ADMIN không có quyền | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 2 | TC-WAL-001 | Ví shipper mới: số dư 0đ, chưa có giao dịch | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 3 | TC-WAL-002 | Nạp tiền: số tiền dưới mức tối thiểu bị từ chối | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 4 | TC-WAL-003 | Tạo yêu cầu nạp tiền: thông tin chuyển khoản và trạng thái "Chờ xử lý" (tiền chưa vào ví) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 5 | TC-WAL-004 | Admin thấy yêu cầu nạp tiền và đối chiếu thông tin | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 6 | TC-WAL-005 | Admin ghi nhận tiền: ví shipper được cộng đúng một lần (nạp cho SP-A bằng tiền thử nghiệm) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 7 | TC-DRV-003 | Shipper không đủ tiền trong ví (SP-B) không bật online / không nhận được đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 8 | TC-WAL-010 | Shipper mới phải nạp tối thiểu một lần được xác nhận mới nhận được đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 9 | TC-WAL-006 | Admin từ chối yêu cầu nạp: ví không thay đổi | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 10 | TC-WAL-007 | Shipper hủy yêu cầu nạp khi còn "Chờ xử lý" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 11 | TC-WAL-008 | Admin không được ghi nhận trùng mã giao dịch ngân hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 12 | TC-WAL-009 | Số tiền thực nhận khác số tiền yêu cầu: ví cộng đúng số thực nhận | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 13 | TC-DRV-001 | Trang chủ 11Ship khi chưa bật online: trạng thái, ví và điều kiện nhận đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 14 | TC-DRV-002 | Bật online thành công khi ví đủ điều kiện và GPS tốt | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 15 | TC-DRV-004 | Bật online khi GPS của điện thoại đang tắt | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 16 | TC-DRV-005 | Tắt online | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 17 | TC-DRV-006 | Trạng thái online được giữ khi mở lại ứng dụng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 18 | TC-DRV-020 | Hồ sơ shipper: xem và sửa thông tin cá nhân | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 19 | TC-DRV-022 | Tab "Thu nhập" của shipper | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 20 | TC-DRV-019 | Chỉ đường từng bước (dẫn đường) cho shipper | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 21 | TC-SHOP-031 | Quán tạo yêu cầu giao hàng trực tiếp (DIRECT) - nhập đủ thông tin | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 22 | TC-SHOP-032 | Tạo yêu cầu giao trực tiếp: kiểm tra dữ liệu nhập sai | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 23 | TC-SHOP-033 | Tạo yêu cầu giao trực tiếp với phí "Thỏa thuận" (ngoài bảng giá) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 24 | TC-DRV-011 | Đơn có phí thương lượng: nút "Đồng ý", "Đề xuất mức khác", "Bỏ qua" trên thẻ đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 25 | TC-DRV-024 | Đề xuất mức phí khác: nhập sai (không phải số, quá lớn, âm) | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 26 | TC-SHOP-034 | Quán hủy yêu cầu giao khi chưa có shipper nhận | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 27 | TC-SHOP-035 | Danh sách "Giao hàng" của quán: lọc theo trạng thái và tìm theo mã | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 28 | TC-DRV-007 | Danh sách "Có thể nhận": thông tin thấy và không thấy trước khi nhận đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 29 | TC-DRV-008 | Chỉ nhận được đơn trong bán kính 3 km quanh quán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 30 | TC-DRV-009 | Shipper nhận đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 31 | TC-DRV-017 | Đơn DIRECT: shipper giao theo địa chỉ mô tả, không cần ghim điểm giao | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 32 | TC-DRV-018 | Xem vị trí quán/người nhận trên bản đồ của shipper | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 33 | TC-DRV-012 | Shipper hủy nhận đơn trước khi lấy hàng (có lý do) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 34 | TC-DRV-013 | Shipper bấm "Đã nhận hàng": một bước xác nhận, phí bị khóa | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 35 | TC-DRV-015 | Sau khi đã lấy hàng shipper không có nút hủy hoặc "Giao thất bại" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 36 | TC-DRV-014 | Shipper giao thành công: hoa hồng thu đúng một lần | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 37 | TC-DRV-016 | Lịch sử đơn của shipper | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 38 | TC-DRV-010 | Hai shipper bấm nhận cùng một đơn: chỉ một người nhận được | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 39 | TC-FLOW-001 | Đơn khách đặt qua 11Food - quán TRẢ phí giao - giao thành công (luồng chuẩn) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 40 | TC-FLOW-002 | Đơn khách đặt qua 11Food - KHÁCH trả phí giao - giao thành công | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 41 | TC-FLOW-003 | Quán chủ động gọi shipper (DIRECT) - quán trả phí - giao thành công | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 42 | TC-FLOW-004 | Quán gọi shipper (DIRECT) - KHÁCH trả phí (khách không có tài khoản 11Food) - giao thành công | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 43 | TC-SHOP-030 | Xem hộp thông báo và cài đặt thông báo của chủ quán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 44 | TC-DRV-023 | Thông báo trong 11Ship và cài đặt "Đơn có thể nhận" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 45 | TC-ADM-021 | Danh sách và chi tiết "Đơn hàng" trên Web Admin | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 46 | TC-ADM-023 | Danh sách và chi tiết "Giao hàng" trên Web Admin (kể cả vị trí shipper) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 47 | TC-ADM-017 | Danh sách và chi tiết shipper trên Web Admin | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |

### Ngày 4 - Hủy đơn, đổi phí, các tình huống bất thường

| # | Mã | Tên | Mức | Kết quả |
|---|---|---|---|---|
| 1 | TC-ADM-026 | Cài đặt "Thời hạn xử lý đơn" và "Thời gian trả lời đề xuất phí": kiểm tra giá trị và quyền | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 2 | TC-FLOW-005 | Không có shipper nhận: sau 30 phút hệ thống ngừng tìm, đơn món không bị hủy | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 3 | TC-FLOW-006 | Sau khi ngừng tìm, quán gọi lại shipper và có người nhận | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 4 | TC-FLOW-007 | Đơn khách đặt, QUÁN trả phí: shipper đề xuất phí mới và quán ĐỒNG Ý | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 5 | TC-FLOW-008 | Đơn khách đặt, QUÁN trả phí: quán TỪ CHỐI đề xuất phí của shipper | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 6 | TC-FLOW-009 | Đơn khách đặt, KHÁCH trả phí: khách ĐỒNG Ý đề xuất phí trong 11Food | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 7 | TC-FLOW-010 | Đơn khách đặt, KHÁCH trả phí: khách TỪ CHỐI đề xuất phí | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 8 | TC-FLOW-011 | Quán không được trả lời thay khi KHÁCH là người trả phí của đơn khách đặt | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 9 | TC-FLOW-012 | Đề xuất phí quá hạn trả lời: giữ phí cũ, shipper bị gỡ, không hủy đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 10 | TC-FLOW-013 | Quán gọi shipper (DIRECT), QUÁN trả phí: shipper đề xuất, quán đồng ý rồi từ chối | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 11 | TC-FLOW-014 | Quán gọi shipper (DIRECT), KHÁCH trả phí nhưng không có tài khoản: quán xác nhận thay khách | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 12 | TC-FLOW-015 | Shipper đề xuất phí SAU khi nhận đơn, trước khi lấy hàng: chưa lấy hàng được cho đến khi có trả lời | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 13 | TC-FLOW-016 | Shipper bỏ lượt nhận (hủy nhận) rồi shipper khác nhận; đồng hồ tìm không bị tính lại | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 14 | TC-FLOW-017 | Quán hủy yêu cầu giao khi shipper đã nhận nhưng chưa lấy hàng (đơn ORDER vẫn còn) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 15 | TC-FLOW-018 | Quán hủy đơn món khi shipper đã nhận nhưng chưa lấy hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 16 | TC-FLOW-019 | Khách hủy đơn SAU khi shipper đã lấy hàng (đơn ORDER) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 17 | TC-FLOW-020 | Quán hủy yêu cầu giao (DIRECT) SAU khi shipper đã lấy hàng, rồi xử lý hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 18 | TC-FLOW-021 | Chủ quán KHÔNG hủy được đơn khách đặt sau khi shipper đã lấy hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 19 | TC-FLOW-022 | Hàng sau khi đơn bị hủy: "Đã xử lý, không giao tiếp" và Admin đóng "Không hoàn tất" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 20 | TC-FLOW-023 | Thông báo đến đúng người, đúng đơn, đúng nội dung trong cả luồng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 21 | TC-FLOW-024 | Không tạo trùng đơn / trùng yêu cầu giao khi bấm nhiều lần | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 22 | TC-FLOW-025 | Mất mạng đúng lúc khách gửi đơn: ứng dụng báo "chưa biết đơn đã gửi chưa" và không tạo đơn thứ hai | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 23 | TC-FLOW-026 | Hoa hồng của shipper: giữ chỗ khi nhận, trả lại khi hủy, thu đúng một lần khi hoàn thành | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 24 | TC-FLOW-027 | Đơn hẹn giờ chạy trọn luồng: đặt, quán xác nhận, gọi shipper, giao | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 25 | TC-FLOW-028 | Đơn ORDER chưa tính được phí giao (thiếu ghim/tuyến): quán phải đề xuất phí để gọi được shipper | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 26 | TC-FLOW-029 | SYSTEM tự hủy đơn: chờ quán quá lâu và chờ shipper quá lâu | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 27 | TC-FLOW-030 | Shipper đang giữ một đơn nhận thêm đơn thứ hai (giới hạn số đơn cùng lúc) | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 28 | TC-NOTI-001 | Thông báo đẩy (push) tới điện thoại khi tắt màn hình | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 29 | TC-NOTI-002 | Hộp thông báo trong ứng dụng đồng bộ khi mở lại và cập nhật trực tiếp | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 30 | TC-NOTI-003 | Tắt nhóm thông báo: thông báo vẫn vào hộp thư nhưng không đẩy | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 31 | TC-NOTI-004 | Quyền thông báo của điện thoại bị tắt: ứng dụng hướng dẫn bật | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 32 | TC-NOTI-005 | Sau khi đăng xuất, máy không còn nhận thông báo của tài khoản cũ | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 33 | TC-NOTI-007 | Thông báo dừng tìm shipper và nhắc 5/15 phút tới quán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 34 | TC-SHOP-036 | Quán xác nhận hàng đã về / đã xử lý sau khi hủy giao đã lấy hàng | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 35 | TC-ACC-026 | Đăng nhập lại khi đang có đơn đang giao: đơn không mất | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 36 | TC-DRV-025 | Shipper nhắc "chưa lấy hàng" sau khi nhận đơn | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 37 | TC-ACC-027 | Phiên bị thu hồi khi Admin khóa tài khoản đang đăng nhập | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 38 | TC-ACC-031 | Khôi phục tài khoản đã bị khóa theo yêu cầu xóa | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 39 | TC-ADM-013 | Khóa tài khoản bị chặn khi tài khoản còn đơn đang xử lý | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 40 | TC-ADM-016 | Admin vô hiệu hóa và kích hoạt lại quán | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 41 | TC-ADM-018 | Admin "Khóa hoạt động" và "Mở lại" shipper; "Nhận đơn" bị tắt | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 42 | TC-DRV-021 | Shipper bị Admin khóa: không nhận đơn mới nhưng vẫn xem ví | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 43 | TC-ADM-036 | Admin xử lý yêu cầu giao: giải phóng shipper, ghi nhận hàng, điều chỉnh sau lấy hàng, chuyển phản ánh | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 44 | TC-ADM-022 | Admin hủy đơn món và đóng "Không hoàn tất" (cần lý do, cần quyền) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 45 | TC-CUS-014 | Quán bị Admin vô hiệu hóa không còn hiện cho khách | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 46 | TC-ABN-001 | Mất Internet khi đang xem quán và giỏ hàng (khách) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 47 | TC-ABN-002 | Shipper mất Internet lúc bấm "Giao thành công" hoặc "Đã nhận hàng" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 48 | TC-ABN-003 | Quán mất mạng lúc bấm "Xác nhận đơn" hoặc "Gọi shipper" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 49 | TC-ABN-004 | Tắt đột ngột ứng dụng 11Ship khi đang giao: đơn không mất, vị trí tiếp tục được chia sẻ | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 50 | TC-ABN-005 | Khởi động lại điện thoại shipper khi đang online hoặc đang có đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 51 | TC-ABN-006 | GPS tắt giữa lúc shipper đang giữ đơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 52 | TC-ABN-007 | GPS yếu (trong nhà / dưới hầm): không có vị trí nhưng ứng dụng không treo | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 53 | TC-ABN-008 | Vị trí giả (ứng dụng giả GPS) bị từ chối | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 54 | TC-ABN-009 | Máy chủ phản hồi chậm hoặc không sẵn sàng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 55 | TC-ABN-010 | Hai người cùng thao tác một đơn: quán hủy trong lúc shipper bấm "Nhận đơn" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 56 | TC-ABN-011 | Khách hủy đơn trong lúc quán bấm "Xác nhận đơn" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 57 | TC-ABN-012 | Hai quản trị viên cùng sửa một dữ liệu: người sau nhận cảnh báo "đã thay đổi ở nơi khác" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 58 | TC-ABN-013 | Bấm nhiều lần liên tiếp vào các nút quan trọng ("Nhận đơn", "Đã nhận hàng", "Giao thành công", "Xác nhận đơn") | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 59 | TC-ABN-014 | Chuyển ứng dụng 11Ship sang chạy nền và khóa màn hình: vẫn nhận đơn và chia sẻ vị trí | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 60 | TC-ABN-015 | Bật chế độ tiết kiệm pin: vị trí và thông báo vẫn hoạt động (hoặc báo rõ giới hạn) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 61 | TC-ABN-016 | Nhập ký tự đặc biệt, rất dài hoặc kiểu "mã độc" vào các ô văn bản | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 62 | TC-ABN-017 | Điện thoại có giờ sai (đồng hồ lệch nhiều) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 63 | TC-ABN-018 | Chạy trên các phiên bản Android khác nhau (8, 10, 12, 13, 14) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 64 | TC-ABN-019 | Màn hình nhỏ, cỡ chữ lớn và xoay ngang | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 65 | TC-ABN-020 | Chủ quán đăng nhập trên điện thoại khác: phiên cũ kết thúc, quán không mất đơn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 66 | TC-ABN-021 | Hai màn hình mở cùng một đơn: thao tác trên màn đã cũ bị yêu cầu tải lại | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 67 | TC-ABN-022 | Nút Back và đóng hộp thoại giữa chừng không làm mất hoặc gửi nhầm thao tác | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 68 | TC-SEC-001 | Quán này không thấy đơn và yêu cầu giao của quán khác | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 69 | TC-SEC-002 | Shipper này không thấy đơn đang giữ của shipper khác | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 70 | TC-SEC-003 | Người dùng không thấy mã tra cứu/UUID/mã kỹ thuật trên màn hình | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 71 | TC-SEC-004 | Mật khẩu luôn bị ẩn và không hiện trong thông báo hay chẩn đoán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |

### Ngày 5 - Ví, quản trị, đối chiếu kết quả và nghiệm thu

| # | Mã | Tên | Mức | Kết quả |
|---|---|---|---|---|
| 1 | TC-WAL-011 | Lịch sử giao dịch: lọc "Nạp tiền", "Hoa hồng", "Tạm giữ" | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 2 | TC-WAL-012 | Đối chiếu tay: tổng số dư = tổng các dòng giao dịch | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 3 | TC-WAL-013 | Ví không đủ tiền hoa hồng thì không nhận được đơn mới, nhưng đơn đang giao vẫn hoàn tất | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 4 | TC-WAL-014 | Yêu cầu dừng hoạt động của shipper: tắt nhận đơn ngay, đơn đang giao vẫn hoàn tất | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 5 | TC-WAL-015 | Rút toàn bộ số dư khi dừng hoạt động: Admin nhận xử lý và ghi nhận đã chuyển (tiền thử nghiệm) | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 6 | TC-FEED-001 | Khách đánh giá quán và shipper sau khi đơn hoàn thành | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 7 | TC-ADM-019 | Hồ sơ shipper chờ duyệt / xác minh ngân hàng cũ: ghi nhận trạng thái thực tế | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 8 | TC-WAL-016 | Rút tiền: Admin nhập số tiền chuyển khác số yêu cầu thì không kết luận "đã chuyển đủ" | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 9 | TC-FEED-002 | Không đánh giá được khi đơn chưa hoàn thành hoặc khi không phải đơn của mình | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 10 | TC-WAL-017 | Shipper hủy yêu cầu rút tiền khi còn "Chờ xử lý": tiền được giải phóng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 11 | TC-FEED-003 | Khách gửi phản ánh về một đơn (có ảnh minh chứng) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 12 | TC-WAL-018 | Tài chính Admin: tổng quan, danh sách ví và giao dịch | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 13 | TC-FEED-004 | Chủ quán đánh giá shipper và phản hồi đánh giá của khách | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 14 | TC-FEED-005 | Admin ẩn và khôi phục một đánh giá | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 15 | TC-FEED-006 | Admin xử lý phản ánh: tiếp nhận, yêu cầu bổ sung, kết luận, đóng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 16 | TC-WAL-021 | SYSTEM đổi mức hoa hồng: chỉ áp dụng cho đơn nhận sau đó | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 17 | TC-FEED-007 | Bên liên quan giải trình và khách yêu cầu xem xét lại (trong 7 ngày, một lần) | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 18 | TC-WAL-022 | SYSTEM đổi mức nạp/rút tối thiểu; ADMIN chỉ xem | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 19 | TC-FEED-008 | Ảnh minh chứng phản ánh: giới hạn số lượng, dung lượng và định dạng | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 20 | TC-WAL-023 | Admin hoàn tất đóng tài khoản shipper chỉ khi đã tất toán | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 21 | TC-WAL-024 | Mất mạng hoặc bấm lặp khi tạo yêu cầu nạp/rút: không tạo trùng, không trừ hai lần | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 22 | TC-WAL-025 | Admin điều chỉnh tài chính từ phản ánh (thu thêm / hoàn hoa hồng) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 23 | TC-ADM-007 | Phân biệt quyền ADMIN và SYSTEM: ADMIN không vào được trang chỉ dành cho SYSTEM | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 24 | TC-ADM-008 | ADMIN-2 (chỉ quyền Xem Quán) không thao tác được các hành động cần quyền cao hơn | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 25 | TC-WAL-019 | Phân quyền tài chính: ADMIN không có quyền thì không thấy hoặc không thao tác được | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 26 | TC-ADM-009 | SYSTEM cấp và thu hồi quyền của ADMIN; hiệu lực ở thao tác kế tiếp | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 27 | TC-ADM-010 | SYSTEM khóa và mở khóa tài khoản ADMIN; thu hồi mọi phiên | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 28 | TC-ADM-025 | SYSTEM đổi bảng phí giao bằng bản nháp rồi áp dụng; đơn cũ không bị tính lại | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 29 | TC-ADM-027 | "Cấu hình tập trung": mọi quản trị viên xem, chỉ SYSTEM sửa, có lý do và lịch sử | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 30 | TC-ADM-028 | "Nhật ký hoạt động" (audit): xem, lọc, không sửa được, không lộ bí mật | P0 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 31 | TC-ADM-029 | "Điều hành" và "Báo cáo": số liệu khớp danh sách và xuất CSV/Excel | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 32 | TC-ADM-030 | "Vận hành hệ thống": sức khỏe, sự cố, SMS Gateway, nhật ký, phiên bản | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 33 | TC-ADM-031 | "Sao lưu và phục hồi": xem lịch sử sao lưu và yêu cầu sao lưu ngay (chỉ SYSTEM) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 34 | TC-ADM-032 | Nhật ký lỗi hệ thống ("Giám sát > Nhật ký lỗi") | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 35 | TC-ADM-033 | Mục "Vùng hoạt động" ghi "Sắp có" | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 36 | TC-ADM-034 | Trang chủ Web Admin sau khi đăng nhập và nội dung hướng dẫn cũ | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 37 | TC-ADM-035 | Xóa tài khoản người dùng: chỉ xóa hẳn khi không có dữ liệu liên quan | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 38 | TC-SET-009 | Ứng dụng báo "Có bản mới" và cập nhật ngay trong ứng dụng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 39 | TC-NOTI-006 | Web Admin > Thông báo: tra cứu, "Việc cần xử lý" và cấu hình (chỉ SYSTEM sửa) | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 40 | TC-SET-010 | Bản bắt buộc cập nhật: ứng dụng bản cũ bị chặn | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 41 | TC-ACC-032 | SYSTEM tắt/bật bắt buộc OTP khi đăng ký (công tắc hệ thống) | P2 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 42 | TC-SEC-005 | Phiên Web Admin hết hạn khi bỏ không và sau khi đăng xuất | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 43 | TC-SEC-006 | Số điện thoại và tài khoản ngân hàng được che bớt ở Web Admin | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 44 | TC-SEC-007 | Chính sách quyền riêng tư nói "không theo dõi vị trí nền" nhưng 11Ship chia sẻ vị trí khi online | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 45 | TC-AUTO-001 | Đối chiếu CI: nhận đơn đồng thời, hủy/nhận/lấy hàng/hoàn thành xung đột | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 46 | TC-AUTO-002 | Đối chiếu CI: chống xử lý lặp (idempotency) và mất phản hồi | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 47 | TC-AUTO-003 | Đối chiếu CI: sổ cái ví, tạm giữ, nạp, rút và đối soát | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 48 | TC-AUTO-004 | Đối chiếu CI: quyền người dùng và quyền quản trị | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 49 | TC-AUTO-005 | Đối chiếu CI: giao nhận sự kiện (outbox) và thông báo không mất, không trùng | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 50 | TC-AUTO-006 | Đối chiếu CI: nâng cấp cơ sở dữ liệu giữ nguyên dữ liệu | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |
| 51 | TC-AUTO-007 | Đối chiếu CI: sao lưu, nhật ký (audit) không sửa/xóa được | P1 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY |

