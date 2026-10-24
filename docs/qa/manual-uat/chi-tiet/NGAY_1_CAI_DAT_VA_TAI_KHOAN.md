# Ngày 1 - Cài ứng dụng, làm quen, tạo tài khoản và chuẩn bị Web Admin

Tài liệu này là bản ĐỌC ĐƯỢC của các test case trong file `TESTCASE_11SHIP.csv` (cùng nội dung). Làm lần lượt từ trên xuống dưới vì các test sau dùng dữ liệu của test trước.
Trước khi bắt đầu: đọc `HUONG_DAN_KIEM_THU_11SHIP.md` (nhất là mục chuẩn bị tài khoản, tiền thử nghiệm và cách báo lỗi).

Tổng số test case trong ngày: **47** (P0: 27, P1: 13, P2: 7).

| # | Mã | Tên | Mức | Cần | Sẵn sàng |
|---|---|---|---|---|---|
| 1 | TC-SET-001 | Cài đặt 11Food lần đầu từ file APK | P0 | 1 ĐT | SẴN SÀNG |
| 2 | TC-SET-002 | Cài đặt 11Ship lần đầu từ file APK | P0 | 1 ĐT | SẴN SÀNG |
| 3 | TC-SET-003 | Cài cả 11Food và 11Ship trên cùng một điện thoại | P1 | 1 ĐT | SẴN SÀNG |
| 4 | TC-SET-004 | Cấp quyền vị trí (GPS) cho 11Food lần đầu | P1 | 1 ĐT | SẴN SÀNG |
| 5 | TC-SET-006 | Xem số phiên bản của ứng dụng để ghi vào báo cáo | P0 | 1 ĐT | CẦN XÁC MINH |
| 6 | TC-SET-011 | Điện thoại không đạt yêu cầu bảo mật thiết bị | P2 | 1 ĐT | CẦN XÁC MINH |
| 7 | TC-ACC-001 | Đăng ký tài khoản khách hàng KH-A trên 11Food (có mã OTP) | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 8 | TC-ACC-002 | Đăng ký tài khoản khách hàng thứ hai KH-B | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 9 | TC-ACC-003 | Đăng ký với mục đích "Chủ quán" (CQ-A) và chuyển thẳng sang tạo hồ sơ quán | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 10 | TC-ACC-004 | Đăng ký tài khoản shipper SP-A trên 11Ship (có mã OTP) | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 11 | TC-ACC-005 | Đăng ký tài khoản shipper thứ hai SP-B | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 12 | TC-ACC-006 | Đăng ký bị chặn khi nhập thiếu hoặc sai thông tin (màn 1/3) | P1 | 1 ĐT | SẴN SÀNG |
| 13 | TC-ACC-007 | Số điện thoại sai định dạng khi đăng ký và đăng nhập | P1 | 1 ĐT | SẴN SÀNG |
| 14 | TC-ACC-008 | Đăng ký lại bằng số điện thoại đã có tài khoản | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 15 | TC-ACC-009 | Nhập sai mã OTP khi đăng ký | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 16 | TC-ACC-010 | Mã OTP hết hạn và nút "Gửi lại mã" | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 17 | TC-ACC-011 | Xin mã OTP quá nhiều lần bị giới hạn | P2 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 18 | TC-ACC-012 | Không gửi được SMS: ứng dụng phải báo thật, không giả thành công | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 19 | TC-ACC-013 | Sửa số điện thoại giữa chừng khi đang xác minh OTP | P2 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 20 | TC-ACC-014 | Đăng nhập thành công bằng KH-A | P0 | 1 ĐT | SẴN SÀNG |
| 21 | TC-ACC-015 | Đăng nhập sai mật khẩu và sai số điện thoại | P0 | 1 ĐT | SẴN SÀNG |
| 22 | TC-SET-005 | Cấp quyền thông báo và vị trí cho 11Ship | P1 | 1 ĐT | SẴN SÀNG |
| 23 | TC-ACC-016 | Đăng nhập shipper SP-A trên 11Ship | P0 | 1 ĐT | SẴN SÀNG |
| 24 | TC-ACC-017 | Đăng xuất có hộp xác nhận | P0 | 1 ĐT | SẴN SÀNG |
| 25 | TC-ACC-018 | Tắt hẳn rồi mở lại ứng dụng: vẫn đăng nhập | P0 | 1 ĐT | SẴN SÀNG |
| 26 | TC-ACC-019 | Khởi động lại điện thoại: vẫn đăng nhập | P1 | 1 ĐT | SẴN SÀNG |
| 27 | TC-ACC-020 | Quên mật khẩu: đặt lại bằng mã OTP qua SMS | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 28 | TC-ACC-021 | Quên mật khẩu: mã sai, hết hạn và số chưa đăng ký | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 29 | TC-ACC-022 | Sau khi đặt lại mật khẩu, các phiên đăng nhập cũ bị đăng xuất | P1 | 2 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 30 | TC-ACC-023 | Đổi mật khẩu khi đang đăng nhập | P0 | 1 ĐT | SẴN SÀNG |
| 31 | TC-ACC-024 | Đổi mật khẩu: mật khẩu mới không hợp lệ hoặc nhập lại không khớp | P2 | 1 ĐT | SẴN SÀNG |
| 32 | TC-ACC-025 | Đăng nhập cùng một tài khoản trên điện thoại thứ hai: máy cũ bị đăng xuất | P0 | 2 ĐT | SẴN SÀNG |
| 33 | TC-ACC-028 | Xem và sửa họ tên của tài khoản | P1 | 1 ĐT | SẴN SÀNG |
| 34 | TC-ACC-029 | Xem Điều khoản sử dụng và Chính sách quyền riêng tư | P2 | 1 ĐT | CẦN XÁC MINH |
| 35 | TC-ACC-033 | Mục Voucher trong 11Food báo rõ chưa hỗ trợ | P2 | 1 ĐT | NOT READY |
| 36 | TC-SET-007 | Cập nhật đè bản mới của 11Food (không gỡ app) | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 37 | TC-SET-008 | Cập nhật đè bản mới của 11Ship khi đang đăng nhập | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 38 | TC-SET-012 | Gỡ ứng dụng rồi cài lại: phải đăng nhập lại, dữ liệu trên máy chủ còn nguyên | P2 | 1 ĐT | SẴN SÀNG |
| 39 | TC-ADM-001 | Mở Web Admin bằng trình duyệt và thấy trang đăng nhập | P0 | PC | SẴN SÀNG |
| 40 | TC-ADM-002 | SYSTEM đăng nhập Web Admin (mật khẩu + mã Authenticator) và đăng xuất | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 41 | TC-ADM-004 | SYSTEM tạo lời mời ADMIN và phân quyền ban đầu | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 42 | TC-ADM-005 | Kích hoạt tài khoản ADMIN: mã OTP SMS, đặt mật khẩu, thiết lập Authenticator | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 43 | TC-ADM-006 | Thêm quản trị viên thứ hai (ADMIN-2) chỉ có quyền Xem Quán | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 44 | TC-ADM-011 | ADMIN quên mật khẩu: đặt lại bằng SMS (SYSTEM không tự đặt lại trên web) | P1 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 45 | TC-ADM-003 | Đăng nhập Web Admin sai mật khẩu hoặc sai mã Authenticator | P0 | 1 ĐT | CẦN HỖ TRỢ KỸ THUẬT |
| 46 | TC-ADM-020 | Quản lý "Nhóm món" (danh mục) để chủ quán thêm món | P0 | PC | CẦN HỖ TRỢ KỸ THUẬT |
| 47 | TC-ADM-024 | Bảng "Phí & điều kiện giao": xem, thử tính phí; chỉ SYSTEM được sửa | P0 | PC | CẦN HỖ TRỢ KỸ THUẬT |

---

### TC-SET-001 · Cài đặt 11Food lần đầu từ file APK

**Mức độ:** P0 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #1 (trong ngày: 1) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Bảo đảm người mới cài được ứng dụng dành cho khách và chủ quán lên điện thoại Android và mở được lần đầu. |
| Người thực hiện | Người kiểm thử (chưa cần tài khoản) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có file APK 11Food (tên dạng "11Food-vX.Y.Z.apk") do Người phụ trách gửi. Điện thoại Android 8.0 trở lên, đang có Internet. Chưa cài 11Food (nếu đã cài, gỡ trước ở Cài đặt > Ứng dụng > 11Food > Gỡ cài đặt). |
| Dữ liệu nhập | Không có. Dùng đúng file APK Người phụ trách gửi, không tải từ nơi khác. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chép file APK 11Food vào Điện thoại 1 (qua Zalo, Google Drive hoặc cáp USB). Mở ứng dụng "Tệp" (Files) > thư mục "Tải xuống" (Downloads). | Thấy file APK 11Food trong danh sách. |
| 2 | Chạm vào file APK. | Android hiện màn hình cài đặt ứng dụng (hoặc hỏi quyền cài từ nguồn này nếu là lần đầu). |
| 3 | Nếu Android hỏi "Cho phép cài ứng dụng không xác định từ nguồn này": chạm "Cài đặt", bật công tắc "Cho phép từ nguồn này", rồi bấm nút quay lại. Nếu Google Play Protect hiện cảnh báo, chỉ chạm "Vẫn cài đặt" khi file do Người phụ trách gửi. | Công tắc được bật; quay lại được màn hình cài đặt ứng dụng. |
| 4 | Chạm "Cài đặt" (Install) và chờ đến khi xong. | Android báo cài thành công, có nút "Mở". Không có thông báo "Ứng dụng chưa được cài đặt". |
| 5 | Chạm "Mở". | Ứng dụng 11Food mở ra, thanh dưới cùng có các tab "Trang chủ", "Đơn hàng", "Tài khoản". Không hiện thanh báo lỗi kết nối màu đỏ/cam kéo dài (nếu có "Đang kiểm tra…" thì biến mất sau vài giây). |
| 6 | Thoát ứng dụng (nút Home) và tìm biểu tượng trên màn hình điện thoại. | Có biểu tượng ứng dụng tên "11Food". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không bắt buộc. Nếu muốn chạy lại từ đầu: Cài đặt > Ứng dụng > 11Food > Gỡ cài đặt, rồi làm lại từ bước 1.

**Căn cứ:** `.github/workflows/mobile-apk.yml (tạo APK 11Food); mobile/README.md (mục "Get the APKs"); mobile/tool/prepare-android.sh (nhãn ứng dụng "11Food", minSdk 26)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** CI workflow "Mobile APK": kiểm chữ ký, quyền, applicationId (không thay thế việc cài tay).

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-002 · Cài đặt 11Ship lần đầu từ file APK

**Mức độ:** P0 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #2 (trong ngày: 2) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Bảo đảm shipper cài được ứng dụng giao hàng lên điện thoại Android và mở được lần đầu. |
| Người thực hiện | Người kiểm thử (chưa cần tài khoản) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có file APK 11Ship (tên dạng "11Ship-vX.Y.Z.apk") do Người phụ trách gửi. Điện thoại Android 8.0 trở lên có GPS và Internet. Chưa cài 11Ship. |
| Dữ liệu nhập | Không có. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chép file APK 11Ship vào Điện thoại 3, mở ứng dụng "Tệp" > "Tải xuống" và chạm vào file APK. | Android hiện màn hình cài đặt ứng dụng. |
| 2 | Cho phép cài từ nguồn này nếu Android hỏi (như test TC-SET-001), rồi chạm "Cài đặt". | Cài thành công, có nút "Mở". |
| 3 | Chạm "Mở". | Ứng dụng 11Ship mở ra; thanh dưới cùng có các tab "Trang chủ", "Đơn hàng", "Thu nhập", "Thông báo", "Tài khoản". |
| 4 | Nhìn trang chủ khi chưa đăng nhập. | Hiện lời mời đăng nhập tài khoản shipper (dòng "Đăng nhập tài khoản shipper"). Không hiện số dư, đơn hay doanh thu giả. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Gỡ cài đặt ở Cài đặt > Ứng dụng > 11Ship nếu cần làm lại.

**Căn cứ:** `mobile/ship/lib/ship_tabs.dart (5 tab); mobile/ship/lib/ship_home.dart (guest-login); mobile/tool/prepare-android.sh`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Workflow "Mobile APK" (build + kiểm quyền).

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-003 · Cài cả 11Food và 11Ship trên cùng một điện thoại

**Mức độ:** P1 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #3 (trong ngày: 3) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Một số người kiểm thử chỉ có 1-2 điện thoại nên phải cài cả hai ứng dụng trên một máy. Hai ứng dụng không được làm hỏng nhau. |
| Người thực hiện | Người kiểm thử |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có cả hai file APK. Chưa cài ứng dụng nào trên máy này. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Cài 11Food theo TC-SET-001. | 11Food cài và mở được. |
| 2 | Cài 11Ship theo TC-SET-002 trên cùng điện thoại. | 11Ship cài và mở được. Không có thông báo xung đột; 11Food vẫn còn trên máy. |
| 3 | Mở lần lượt từng ứng dụng, chạm tab "Tài khoản" ở mỗi ứng dụng. | Mỗi ứng dụng hiện màn hình Tài khoản của riêng mình (11Food: "Tạo tài khoản"/"Đăng nhập"; 11Ship: màn Tài khoản của shipper). |
| 4 | Dùng nút nhiều nhiệm (Recent apps) chuyển qua lại giữa hai ứng dụng 3 lần. | Chuyển qua lại bình thường, không tự thoát, không báo lỗi. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `mobile/README.md (mục "Two apps, one phone": hai app cùng khóa ký, tìm nhau qua cổng Binder)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/gateway/test; mobile/tool/android-templates (kiểm thử Binder) trong CI.

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-004 · Cấp quyền vị trí (GPS) cho 11Food lần đầu

**Mức độ:** P1 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #4 (trong ngày: 4) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khách cần cho phép ứng dụng biết vị trí để thấy quán gần mình. Kiểm tra cả hai lựa chọn "Cho phép" và "Không cho phép". |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | 11Food mới cài (hoặc đã xóa quyền vị trí: Cài đặt > Ứng dụng > 11Food > Quyền > Vị trí > Không cho phép). Bật GPS (Vị trí) của điện thoại. Người kiểm thử đang ở trong khu vực phục vụ (TP Cao Bằng, bán kính khoảng 10 km tính từ trung tâm). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food, ở tab "Trang chủ" làm theo lời nhắc xin quyền vị trí. Chọn "Không cho phép". | Trang chủ báo chưa có vị trí: có dòng "Chưa được cấp quyền vị trí. Thử lại". Ứng dụng không bị thoát. |
| 2 | Vào Cài đặt điện thoại > Ứng dụng > 11Food > Quyền > Vị trí, chọn "Chỉ cho phép khi dùng ứng dụng". | Quyền được bật. |
| 3 | Quay lại 11Food, chạm "Thử lại". | Ứng dụng chờ định vị ("Đang định vị…" / "Đang xác định khu vực…") rồi hiện khu vực và danh sách "Quán gần bạn". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Có thể để quyền bật. Muốn chạy lại: Cài đặt > Ứng dụng > 11Food > Quyền > Vị trí > Không cho phép.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/m02/discovery_views.dart ("Chưa được cấp quyền vị trí. Thử lại", "Đang định vị…")`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/m02_discovery_test.dart; m02_gps_area_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-006 · Xem số phiên bản của ứng dụng để ghi vào báo cáo

**Mức độ:** P0 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #5 (trong ngày: 5) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi báo cáo lỗi và mỗi dòng kết quả phải ghi đúng phiên bản APK đang thử. Test này hướng dẫn cách tìm số phiên bản. |
| Người thực hiện | Người kiểm thử |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Đã cài 11Food và/hoặc 11Ship. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Trong mã nguồn hiện tại màn "Chẩn đoán kết nối" (có dòng "Phiên bản") KHÔNG có đường vào từ tab Tài khoản của 11Food và 11Ship (cờ showDiagnostics bị tắt/loại trừ). Vì vậy dùng cách thay thế qua cài đặt Android. Cần Người phụ trách xác nhận nơi xem phiên bản trong ứng dụng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên điện thoại vào Cài đặt > Ứng dụng > 11Food > kéo xuống cuối màn hình thông tin ứng dụng. | Thấy dòng "Phiên bản" (ví dụ 1.0.x). Ghi lại số này vào cột "Phiên bản APK" của file kết quả. |
| 2 | Làm tương tự cho 11Ship. | Thấy "Phiên bản" của 11Ship. Ghi lại. |
| 3 | Đối chiếu với tên file APK do Người phụ trách gửi (ví dụ 11Food-v1.0.5.apk). | Số phiên bản trên máy khớp với tên file. Nếu khác, báo Người phụ trách trước khi thử tiếp. |
| 4 | (Tùy chọn) Nhờ Người phụ trách mở Web Admin > Vận hành hệ thống > "Phiên bản & cập nhật" và đối chiếu phiên bản thiết bị báo lên. | Phiên bản thiết bị báo lên khớp với phiên bản trên máy (nếu mục này đã được bật). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart:212 (showDiagnostics); mobile/ship/lib/ship_tabs.dart (showDiagnostics:false); docs/process/release-versioning-20261019.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/health_test.dart (màn chẩn đoán, không có đường vào từ Tài khoản).

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-011 · Điện thoại không đạt yêu cầu bảo mật thiết bị

**Mức độ:** P2 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #6 (trong ngày: 6) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Ứng dụng chỉ chạy trên điện thoại có khóa bảo mật phần cứng và hệ điều hành nguyên bản. Kiểm tra ứng dụng nói rõ khi máy không đạt (không cho đăng ký/đăng nhập giả). |
| Người thực hiện | Người kiểm thử |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Một điện thoại/máy ảo không đạt yêu cầu bảo mật do Người phụ trách cung cấp. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chỉ làm được khi có một điện thoại không đạt (đã root/mở khóa bootloader, máy ảo, hoặc máy rất cũ). Nếu không có máy như vậy thì đánh dấu BLOCKED, KHÔNG cố root máy. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Cài 11Food lên máy không đạt yêu cầu và mở ứng dụng. | Ứng dụng mở được. |
| 2 | Thử "Tạo tài khoản" hoặc "Đăng nhập" tới bước gửi. | Hiện thông báo: "Thiết bị này chưa hỗ trợ xác thực phần cứng nên chưa dùng được tài khoản trên bản Android này. (DEVICE_PROOF_UNSUPPORTED)". Không tạo được tài khoản. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Gỡ ứng dụng khỏi máy thử.

**Căn cứ:** `mobile/README.md (Device proof / DEVICE_PROOF_UNSUPPORTED); account_views.dart (thông báo)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/native-device-binding.int.spec.ts; mobile/packages/n11_shared/test/device_proof_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-001 · Đăng ký tài khoản khách hàng KH-A trên 11Food (có mã OTP)

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #7 (trong ngày: 7) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Một người hoàn toàn mới tạo được tài khoản khách để đặt món. OTP là mã 6 số gửi qua tin nhắn SMS để chứng minh số điện thoại là của bạn. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | 11Food đã cài. Số điện thoại SĐT-KH-A là số có SIM thật, nhận được SMS, CHƯA từng đăng ký 11Food/11Ship. Hệ thống gửi SMS (máy "SMS Gateway") đang bật và số này được phép nhận SMS (nếu hệ thống đang giới hạn danh sách số thì Người phụ trách phải thêm sẵn). Có Internet. |
| Dữ liệu nhập | Họ và tên: "Khách Test A". Mật khẩu: 8-128 ký tự do bạn tự đặt và ghi vào bảng riêng (ví dụ 1 chữ hoa, 1 chữ số). Nhập lại mật khẩu: giống hệt. Số điện thoại: SĐT-KH-A (10 số, bắt đầu bằng 0, ví dụ 0912345678). Mục đích sử dụng: "Khách hàng". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Food > tab "Tài khoản" > chạm "Tạo tài khoản". | Màn hình "Đăng ký · 1/3" với tiêu đề "Tạo tài khoản", có ô "Họ và tên", "Mật khẩu", "Nhập lại mật khẩu", khung điều khoản và ô tích đồng ý. |
| 2 | Nhập Họ và tên "Khách Test A", Mật khẩu, Nhập lại mật khẩu. Kéo đọc khung điều khoản. Tích ô "Tôi đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư." rồi chạm "Tiếp tục". | Sang màn "Đăng ký · 2/3" tiêu đề "Mục đích sử dụng", có hai lựa chọn "Khách hàng" và "Chủ quán". |
| 3 | Chọn "Khách hàng" rồi chạm "Tiếp tục". | Sang màn "Đăng ký · 3/3" tiêu đề "Số điện thoại & OTP", có ô "Số điện thoại". Có dòng "Xác minh số điện thoại: Mã gồm 6 số được gửi bằng tin nhắn SMS đến số điện thoại đăng ký." |
| 4 | Nhập số điện thoại SĐT-KH-A, chạm "Gửi mã xác minh". | Hiện "Đang gửi tin nhắn…" và nút/đồng hồ "Gửi lại sau … giây". Ô "Mã xác minh" chỉ nhập được sau khi tin nhắn đã được gửi đi. |
| 5 | Chờ tin nhắn SMS đến điện thoại (có thể chậm vài chục giây). Gõ 6 số trong tin nhắn vào ô "Mã xác minh" rồi chạm "Xác nhận mã". | Hiện thông báo xanh "Đã xác minh số điện thoại". |
| 6 | Chạm "Hoàn tất đăng ký". | Hiện "Đăng ký thành công." và ứng dụng trở về, đã đăng nhập: tab "Tài khoản" hiện "Khách Test A", số điện thoại che bớt, nhãn "Khách hàng". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không xóa được tài khoản bằng ứng dụng. Muốn chạy lại cần số điện thoại khác, hoặc nhờ Admin (SYSTEM) dùng "Xóa tài khoản" ở Web Admin (chỉ xóa hẳn khi tài khoản chưa có dữ liệu). Ghi lại KH-A là tài khoản dùng cho các ngày sau.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (RegisterScreen/_foodForm, 3 bước); apps/backend/src/client-auth; ops/runbooks/sms-gateway.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-auth-register.int.spec.ts; native-required-register.int.spec.ts; mobile/packages/n11_shared/test/otp_flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-002 · Đăng ký tài khoản khách hàng thứ hai KH-B

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #8 (trong ngày: 8) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Cần hai khách khác nhau để thử việc người này không được thấy đơn của người kia. |
| Người thực hiện | Khách (KH-B) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đã đăng xuất khỏi KH-A trên máy. Có số SĐT-KH-B (SIM thật, chưa đăng ký) nhận được SMS. |
| Dữ liệu nhập | Họ và tên "Khách Test B"; mật khẩu tự đặt; mục đích "Khách hàng"; số SĐT-KH-B. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 (máy KHÁCH), mở 11Food, tab "Tài khoản", kéo xuống cuối và chạm "Đăng xuất". | Hộp thoại "Đăng xuất?" hiện ra với nút "Huỷ" và "Đăng xuất". |
| 2 | Chạm "Đăng xuất" trong hộp thoại. | Quay về màn hình khách chưa đăng nhập, lại thấy nút "Đăng nhập". |
| 3 | Làm lại các bước của TC-ACC-001 với Họ và tên "Khách Test B" và số SĐT-KH-B (đủ 3 màn hình, nhập mã OTP, "Hoàn tất đăng ký"). | Đăng ký thành công, tab "Tài khoản" hiện "Khách Test B". |
| 4 | Đăng xuất rồi đăng nhập lại bằng KH-A. | Vào đúng tài khoản "Khách Test A", không lẫn thông tin của KH-B. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Như TC-ACC-001.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-auth-register.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-003 · Đăng ký với mục đích "Chủ quán" (CQ-A) và chuyển thẳng sang tạo hồ sơ quán

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #9 (trong ngày: 9) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Chủ quán đăng ký bằng chính ứng dụng 11Food, chọn mục đích "Chủ quán" thì được dẫn sang tạo hồ sơ quán. |
| Người thực hiện | Chủ quán (CQ-A) |
| Thiết bị cần có | Điện thoại 2 (máy QUÁN) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | 11Food cài trên Điện thoại 2. Số SĐT-CQ-A (SIM thật, chưa đăng ký). |
| Dữ liệu nhập | Họ và tên "Chủ quán Test A"; mật khẩu tự đặt; mục đích "Chủ quán"; số SĐT-CQ-A. |
| Ghi chú đặc biệt | Câu chữ "Chỉ bán hàng sau khi được duyệt" còn xuất hiện trên màn đăng ký, nhưng theo mã nguồn quán được kích hoạt ngay khi hồ sơ đủ điều kiện (không có bước Admin duyệt). Ghi nhận trong DOI_CHIEU_CODE_TESTCASE.md. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 mở 11Food > "Tài khoản" > "Tạo tài khoản". Nhập "Chủ quán Test A", mật khẩu, nhập lại mật khẩu, tích đồng ý, "Tiếp tục". | Sang màn "Đăng ký · 2/3". |
| 2 | Chọn "Chủ quán" (dòng phụ: "Gửi hồ sơ đăng ký quán sau khi xác minh. Chỉ bán hàng sau khi được duyệt.") rồi "Tiếp tục". | Sang màn nhập số điện thoại và OTP. |
| 3 | Nhập SĐT-CQ-A, "Gửi mã xác minh", nhập mã SMS, "Xác nhận mã", "Hoàn tất đăng ký". | Hiện "Đăng ký thành công." rồi tự mở màn "Quản lý cửa hàng" (hồ sơ quán). |
| 4 | Đọc màn hình đang mở. | Có nội dung "Bạn chưa có hồ sơ cửa hàng" và nút "Tạo hồ sơ cửa hàng". (Việc điền hồ sơ làm ở TC-SHOP-001.) |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Như TC-ACC-001.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (_leaveWhenSignedIn mở ShopStartScreen); mobile/packages/n11_shared/lib/src/flows/shop_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/food-register-browser.int.spec.ts; shop-onboarding.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-004 · Đăng ký tài khoản shipper SP-A trên 11Ship (có mã OTP)

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #10 (trong ngày: 10) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper mới tạo được tài khoản; theo quy định hiện hành tài khoản shipper được kích hoạt ngay, không chờ Admin duyệt, ví khởi tạo 0 đồng. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | 11Ship cài trên Điện thoại 3. Số SĐT-SP-A (SIM thật, chưa đăng ký). Hệ thống SMS đang bật. |
| Dữ liệu nhập | Họ và tên "Shipper Test A"; mật khẩu tự đặt; số SĐT-SP-A. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Ship > tab "Tài khoản" > "Tạo tài khoản" (hoặc "Đăng ký shipper"). | Màn hình "Đăng ký" với các ô "Số điện thoại", "Họ và tên", "Mật khẩu", "Nhập lại mật khẩu", ô tích đồng ý điều khoản. |
| 2 | Nhập số SĐT-SP-A, "Shipper Test A", mật khẩu, nhập lại mật khẩu; tích "Tôi đã đọc và đồng ý với Điều khoản sử dụng và Chính sách bảo mật"; chạm "Tiếp tục". | Sang màn "Xác thực số điện thoại" với dòng "Bước 2/2 · Nhập mã OTP gồm 6 số được gửi qua SMS đến" và số điện thoại bạn vừa nhập. |
| 3 | Chạm "Gửi mã xác minh", chờ SMS, nhập 6 số vào ô "Mã xác minh", chạm "Xác nhận mã". | Hiện "Đã xác minh số điện thoại". |
| 4 | Chạm "Hoàn tất đăng ký". | Đăng ký thành công, đã đăng nhập; tab "Tài khoản" có nhãn "Shipper". |
| 5 | Sang tab "Trang chủ". | Hiện "Bạn đang offline" và các lựa chọn ví ("Ví tiền / Nạp tiền"). Chưa nhận được đơn vì chưa nạp tiền (sẽ kiểm ở nhóm Ví). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Như TC-ACC-001.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (nhánh _ship, _otpPage); docs/current/M03-simplified-onboarding-20261020.md (đăng ký shipper = ACTIVE ngay, ví 0đ)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts; driver-onboarding.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-005 · Đăng ký tài khoản shipper thứ hai SP-B

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #11 (trong ngày: 11) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Cần hai shipper khác nhau: SP-A có tiền trong ví, SP-B không đủ tiền. |
| Người thực hiện | Shipper (SP-B) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-SET-003 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | 11Ship cài trên Điện thoại 1 (hoặc Điện thoại 3 sau khi đăng xuất SP-A). Có số SĐT-SP-B (SIM thật, chưa đăng ký). |
| Dữ liệu nhập | Họ và tên "Shipper Test B"; mật khẩu tự đặt; số SĐT-SP-B. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Làm lại các bước của TC-ACC-004 với Họ và tên "Shipper Test B" và số SĐT-SP-B. | Đăng ký thành công; tab "Tài khoản" hiện "Shipper Test B", nhãn "Shipper". |
| 2 | Vào "Ví tiền / Nạp tiền" từ Trang chủ hoặc mục "Ví" ở tab Tài khoản. | Ví hiện số dư 0đ (hoặc "0 đ"), chưa có giao dịch ("Chưa có giao dịch"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Như TC-ACC-001.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart; mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m03-shipper.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-006 · Đăng ký bị chặn khi nhập thiếu hoặc sai thông tin (màn 1/3)

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #12 (trong ngày: 12) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Ứng dụng phải nói rõ lỗi bằng tiếng Việt khi bạn bỏ trống, đặt mật khẩu quá ngắn, nhập lại sai hoặc quên tích đồng ý, và không đi tiếp. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | 11Food ở trạng thái chưa đăng nhập. Mở "Tài khoản" > "Tạo tài khoản". |
| Dữ liệu nhập | Lần 1: để trống tất cả. Lần 2: Họ tên "Khách Lỗi", mật khẩu "abc12" (5 ký tự), nhập lại "abc12". Lần 3: mật khẩu "matkhau123", nhập lại "matkhau124". Lần 4: nhập đúng nhưng KHÔNG tích đồng ý. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Không nhập gì, chạm "Tiếp tục". | Không sang bước 2; các ô báo lỗi (ví dụ họ tên, mật khẩu, "Nhập lại mật khẩu.") và dòng "Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật.". |
| 2 | Nhập dữ liệu lần 2 (mật khẩu 5 ký tự), tích đồng ý, "Tiếp tục". | Không đi tiếp; ô mật khẩu báo lỗi mật khẩu phải từ 8 đến 128 ký tự (gợi ý "Dùng từ 8 đến 128 ký tự."). |
| 3 | Nhập dữ liệu lần 3 (hai mật khẩu khác nhau). | Ô nhập lại báo "Mật khẩu chưa khớp." / "Mật khẩu nhập lại chưa khớp."; không đi tiếp. |
| 4 | Nhập dữ liệu lần 4 (đủ, đúng, bỏ ô đồng ý). | Không đi tiếp; hiện lỗi cần đồng ý điều khoản. |
| 5 | Tích đồng ý và chạm "Tiếp tục". | Đi tiếp sang "Đăng ký · 2/3". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thoát màn đăng ký bằng nút quay lại; không có gì được tạo.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (_detailsErrors, passwordError, textError)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/flows_test.dart; form_feedback_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-007 · Số điện thoại sai định dạng khi đăng ký và đăng nhập

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #13 (trong ngày: 13) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Số điện thoại Việt Nam có 10 số và bắt đầu bằng 0. Ứng dụng phải từ chối số sai ngay trên màn hình. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | 11Food chưa đăng nhập. Mở màn "Đăng nhập" (không cần tài khoản thật). |
| Dữ liệu nhập | Thử lần lượt: "12345", "09123456", "abcdefghij", "0912 345 67x", "+84912345678" (số này hợp lệ theo mẫu nhưng ghi nhận kết quả thực tế), 25 chữ số. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở màn "Đăng nhập", nhập vào ô "Số điện thoại" từng giá trị trong mục Dữ liệu nhập và nhập mật khẩu bất kỳ, chạm "Đăng nhập". | Với số rõ ràng sai ("12345", "09123456", "abcdefghij", có chữ): ô báo lỗi số điện thoại, KHÔNG gửi lên máy chủ. Ghi lại kết quả cho số "+84912345678". |
| 2 | Nhập 25 chữ số liên tiếp. | Ô không nhận quá 20 ký tự (giới hạn của ô) hoặc báo lỗi; ứng dụng không bị treo. |
| 3 | Lặp lại một vài giá trị ở màn đăng ký bước 3/3 (cần đi qua bước 1-2). | Báo lỗi tương tự, nút "Gửi mã xác minh" không gửi mã với số sai. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (phoneError); mobile/packages/n11_shared/lib/src/account/models.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-008 · Đăng ký lại bằng số điện thoại đã có tài khoản

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #14 (trong ngày: 14) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Một số điện thoại chỉ được một tài khoản. Ứng dụng phải báo rõ và hướng dẫn đăng nhập. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đã đăng xuất. KH-A đã tồn tại. |
| Dữ liệu nhập | Số SĐT-KH-A (đã đăng ký), Họ và tên "Khách Trùng", mật khẩu tự đặt. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Tạo tài khoản", nhập "Khách Trùng", mật khẩu, tích đồng ý, chọn "Khách hàng", đến màn 3/3. | Hiện màn nhập số điện thoại. |
| 2 | Nhập SĐT-KH-A, chạm "Gửi mã xác minh", nhập mã SMS (nếu nhận được), "Xác nhận mã", "Hoàn tất đăng ký". | Đăng ký không thành công; hiện thông báo "Số điện thoại này đã có tài khoản." hoặc "Số điện thoại này đã đăng ký. Hãy đăng nhập." Không tạo tài khoản thứ hai. |
| 3 | Đăng nhập bằng KH-A và mật khẩu cũ. | Đăng nhập được, tên vẫn là "Khách Test A" (không bị đổi thành "Khách Trùng"). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (phoneRegistered); apps/backend/src/client-auth`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-auth-register.int.spec.ts; auth-register.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-009 · Nhập sai mã OTP khi đăng ký

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #15 (trong ngày: 15) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Mã OTP sai không được cho đăng ký. Kiểm tra thông báo và việc bị khóa sau nhiều lần sai. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đã đến màn đăng ký 3/3, số điện thoại mới hợp lệ (số SĐT-KH-B chưa đăng ký nếu chưa chạy TC-ACC-002, hoặc một số dự phòng). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Gửi mã xác minh", chờ SMS đến. | Ô "Mã xác minh" mở nhập được. |
| 2 | Nhập mã sai "000000", chạm "Xác nhận mã". | Hiện lỗi "Mã xác minh chưa đúng, hoặc tin nhắn chưa được gửi đi. Kiểm tra lại mã trong tin nhắn." Nút "Hoàn tất đăng ký" vẫn chưa bấm được. |
| 3 | Nhập sai thêm vài lần liên tiếp (tối đa 5 lần). | Sau một số lần sai, hiện "Mã xác minh này đã được dùng hoặc bị khóa. Hãy gửi mã mới." hoặc "Mã này không dùng được nữa. Hãy gửi mã mới." |
| 4 | Chạm "Gửi lại mã" (khi hết thời gian chờ), nhập đúng mã mới. | Hiện "Đã xác minh số điện thoại"; đăng ký tiếp tục được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thoát màn đăng ký nếu không muốn tạo tài khoản.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (_otpSection, failureMessage); apps/backend/src/auth (AUTH_OTP_MAX_ATTEMPTS)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/auth-otp.int.spec.ts; mobile/packages/n11_shared/test/otp_flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-010 · Mã OTP hết hạn và nút "Gửi lại mã"

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #16 (trong ngày: 16) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Mã OTP chỉ dùng được trong thời gian ngắn. Kiểm tra mã hết hạn bị từ chối và gửi lại được sau thời gian chờ. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đang ở màn đăng ký 3/3 sau khi đã chạm "Gửi mã xác minh". Hỏi Người phụ trách thời hạn hiệu lực OTP đang cấu hình (ghi vào ô ghi chú). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ngay sau khi gửi, quan sát nút gửi lại. | Có dòng đếm ngược "Gửi lại sau … giây"; không bấm gửi lại được trong lúc đếm. |
| 2 | Chờ đếm ngược về 0. | Nút "Gửi lại mã" bấm được. |
| 3 | Chờ tiếp cho đến khi quá thời hạn hiệu lực OTP rồi nhập mã SMS cũ. | Hiện "Mã xác minh đã hết hạn. Hãy gửi mã mới." (hoặc "Mã đã hết hạn hoặc chưa gửi được. Hãy gửi lại mã."). |
| 4 | Chạm "Gửi lại mã", nhập mã mới. | Xác nhận thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thoát màn đăng ký.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (otp-resend-countdown); auth-otp (AUTH_OTP_TTL_SECONDS, AUTH_OTP_RESEND_SECONDS)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/auth-otp.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-011 · Xin mã OTP quá nhiều lần bị giới hạn

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #17 (trong ngày: 17) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Hệ thống chặn việc xin mã liên tục (chống lạm dụng, tốn tiền SMS). Ứng dụng phải báo rõ, không treo. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Người phụ trách đồng ý chạy test. Dùng một số điện thoại thử riêng (không dùng SĐT-KH-A). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Mỗi lần xin mã tốn một tin nhắn SMS thật. Chỉ chạy khi Người phụ trách cho phép. Giới hạn mặc định theo tài liệu: 3 lần/giờ và 5 lần/ngày cho mỗi số, 30 lần/ngày toàn hệ thống. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở màn đăng ký 3/3 xin mã, chờ đếm ngược, bấm "Gửi lại mã"; lặp lại đến khi bị chặn (tối đa 4-5 lần). | Đến một lúc hiện thông báo "Thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại." hoặc tương tự; không có thêm tin nhắn nào được gửi. |
| 2 | Chụp màn hình thông báo. Đợi đủ thời gian (theo giới hạn) rồi thử lại, hoặc hỏi Người phụ trách. | Sau khi hết giới hạn xin được mã mới. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Chờ hết giới hạn giờ/ngày. Không dùng lại số này cho test khác trong ngày.

**Căn cứ:** `ops/runbooks/sms-gateway.md (SMS_GATEWAY_LIMIT_*); account_views.dart (Thử quá nhiều lần)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/sms-gateway.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-012 · Không gửi được SMS: ứng dụng phải báo thật, không giả thành công

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #18 (trong ngày: 18) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Khi máy gửi SMS (SMS Gateway) tắt hoặc mất mạng, ứng dụng phải nói thật là chưa gửi được mã, không cho nhập mã giả. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Kỹ thuật viên tạm tắt máy SMS Gateway (hoặc tạm dừng gửi) theo hướng dẫn ops/runbooks/sms-gateway.md, và sẽ bật lại sau test. Không tự tắt. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở màn đăng ký 3/3 nhập số hợp lệ và chạm "Gửi mã xác minh". | Hiện thông báo lỗi trung thực, ví dụ "Không gửi được tin nhắn. Hãy gửi lại mã." hoặc "Máy chủ chưa gửi được mã SMS...". KHÔNG hiện "Đã xác minh". Ô nhập mã không cho xác nhận. |
| 2 | Thử nhập một mã bất kỳ. | Không xác nhận được; nút "Hoàn tất đăng ký" vẫn khóa. |
| 3 | Nhờ kỹ thuật viên bật lại SMS Gateway rồi chạm "Gửi lại mã". | Lần này gửi được, nhận SMS. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Kỹ thuật viên bật lại SMS Gateway; kiểm tra TC-ACC-001 chạy lại được.

**Căn cứ:** `ops/runbooks/sms-gateway.md; docs/current/M01-production-profile-20261014.md (OTP chỉ qua SMS Gateway, hỏng thì báo thật)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/sms-gateway.int.spec.ts; admin-activation-sms-gateway.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-013 · Sửa số điện thoại giữa chừng khi đang xác minh OTP

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #19 (trong ngày: 19) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Gõ nhầm số điện thoại thì sửa được, mã OTP cũ không dùng được cho số mới. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đang ở màn đăng ký 3/3, đã chạm "Gửi mã xác minh" cho số A và đã nhận SMS. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Chạm "Đổi số điện thoại". | Ô số điện thoại mở nhập lại được, ô mã OTP bị xóa/khóa. |
| 2 | Nhập số khác (số B) và chạm "Gửi mã xác minh". Nhập mã SMS của SỐ A vào ô mã. | Không xác nhận được (mã của số A không dùng cho số B). |
| 3 | Nhập đúng mã SMS gửi cho số B. | Xác nhận thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thoát màn đăng ký nếu không muốn tạo tài khoản.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (otp-change-phone)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/otp_flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-014 · Đăng nhập thành công bằng KH-A

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #20 (trong ngày: 20) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khách đã đăng ký đăng nhập lại được bằng số điện thoại và mật khẩu. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đã đăng ký. Đang đăng xuất trên Điện thoại 1. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 (máy KHÁCH), mở ứng dụng 11Food rồi chạm tab "Tài khoản" ở thanh dưới cùng. | Màn hình "Tài khoản" mở ra, có hai nút "Tạo tài khoản" và "Đăng nhập". |
| 2 | Chạm nút "Đăng nhập". Ở ô "Số điện thoại" gõ số điện thoại của tài khoản KH-A. Ở ô "Mật khẩu" gõ mật khẩu của tài khoản KH-A (lấy từ bảng thông tin riêng của Người phụ trách). | Màn hình "Đăng nhập" hiện dòng "Chào mừng trở lại"; hai ô đã có chữ, nút "Đăng nhập" bấm được. |
| 3 | Chạm nút "Đăng nhập". | Đăng nhập thành công, trở về tab "Tài khoản"; thấy tên của KH-A, số điện thoại đã che bớt và nhãn vai trò "Khách hàng". |
| 4 | Chạm tab "Trang chủ" rồi quay lại tab "Tài khoản". | Vẫn đăng nhập; tên và số điện thoại giữ nguyên. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (LoginScreen); session_controller.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-auth-session.int.spec.ts; mobile/packages/n11_shared/test/session_controller_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-015 · Đăng nhập sai mật khẩu và sai số điện thoại

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #21 (trong ngày: 21) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đăng nhập sai phải bị từ chối với thông báo chung, không tiết lộ số nào đã có tài khoản. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đã đăng xuất. Mở màn "Đăng nhập" của 11Food. |
| Dữ liệu nhập | Lần 1: số SĐT-KH-A, mật khẩu sai "SaiMatKhau123". Lần 2: số chưa đăng ký (số bất kỳ hợp lệ khác), mật khẩu bất kỳ. Lần 3: bỏ trống mật khẩu. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Nhập dữ liệu lần 1, chạm "Đăng nhập". | Hiện lỗi "Số điện thoại hoặc mật khẩu không đúng. Vui lòng thử lại."; không vào được ứng dụng. |
| 2 | Nhập dữ liệu lần 2, chạm "Đăng nhập". | Hiện CÙNG thông báo như lần 1 (không phân biệt "số chưa đăng ký" với "sai mật khẩu"). |
| 3 | Nhập số hợp lệ nhưng bỏ trống mật khẩu. | Ô mật khẩu báo bắt buộc nhập; không gửi đi. |
| 4 | Nhập sai mật khẩu liên tiếp nhiều lần (khoảng 6-10 lần). | Có thể hiện "Thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại."; ứng dụng không treo. Ghi lại số lần sai trước khi bị chặn. |
| 5 | Đợi một lát (hoặc hỏi Người phụ trách), nhập đúng mật khẩu. | Đăng nhập được (nếu còn bị chặn, ghi nhận thời gian chặn). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (invalidCredentials); apps/backend/src/client-auth`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-auth-session.int.spec.ts; admin-auth-limits.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-005 · Cấp quyền thông báo và vị trí cho 11Ship

**Mức độ:** P1 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #22 (trong ngày: 22) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper cần vị trí và thông báo để nhận đơn gần mình. Kiểm tra ứng dụng hướng dẫn rõ khi thiếu quyền. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Tiền thử nghiệm trong ví shipper (Owner duyệt) |
| Điều kiện ban đầu | 11Ship mới cài và đã đăng nhập SP-A (làm TC-ACC-004 trước). Android 13 trở lên sẽ hỏi quyền thông báo; Android thấp hơn tự bật. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở 11Ship, ở Trang chủ chạm "Bật online". Khi điện thoại hỏi quyền vị trí chọn "Không cho phép". | Ứng dụng không bật được online; có hướng dẫn bằng chữ và nút "Mở cài đặt vị trí" hoặc "Thử lại". Không hiện mã lỗi kỹ thuật. |
| 2 | Chạm "Mở cài đặt vị trí", bật quyền vị trí "Chỉ cho phép khi dùng ứng dụng" rồi quay lại ứng dụng. | Quay lại được ứng dụng. |
| 3 | Nếu điện thoại Android 13+ chưa cấp quyền thông báo: chạm "Bật online" lại, chọn "Không cho phép" ở hộp hỏi quyền thông báo. | Ứng dụng hiện hướng dẫn "Hãy bật thông báo của 11Ship để vị trí được chia sẻ khi bạn dùng ứng dụng khác." cùng nút "Mở cài đặt thông báo". |
| 4 | Chạm "Mở cài đặt thông báo", bật thông báo, quay lại và chạm "Thử lại". | Trạng thái chuyển sang "Đang lấy vị trí…" rồi "Đang chia sẻ vị trí" (nếu ví đủ điều kiện). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Tắt online (nút "Tắt online") sau khi xong. Quyền có thể để bật.

**Căn cứ:** `mobile/ship/lib/ship_online.dart (các thông báo hướng dẫn quyền); docs/current/M14-online-location-20261024.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test (ship_online_test); m07_location_test.

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-016 · Đăng nhập shipper SP-A trên 11Ship

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #23 (trong ngày: 23) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper đăng nhập lại được; ứng dụng 11Ship chỉ cho tài khoản shipper dùng chức năng giao hàng. |
| Người thực hiện | Shipper (SP-A) |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đã đăng xuất 11Ship. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 3 (máy SHIPPER), mở ứng dụng 11Ship rồi chạm tab "Tài khoản" ở thanh dưới cùng. | Màn hình "Tài khoản" của 11Ship mở ra, có nút "Đăng nhập". |
| 2 | Chạm nút "Đăng nhập". Ở ô "Số điện thoại" gõ số của SP-A, ở ô "Mật khẩu" gõ mật khẩu của SP-A. | Màn hình "Đăng nhập" hiện dòng "Đăng nhập tài khoản shipper."; hai ô đã có chữ. |
| 3 | Chạm nút "Đăng nhập". | Đăng nhập thành công; tab "Tài khoản" hiện tên SP-A và nhãn "Shipper". |
| 4 | Chạm tab "Trang chủ". | Thấy trạng thái "Bạn đang offline" và nút "Bật online"; có "Ví tiền / Nạp tiền". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/ship/lib/ship_home.dart; account_views.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/native-device-binding.int.spec.ts; ship-driver-profile-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-017 · Đăng xuất có hộp xác nhận

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #24 (trong ngày: 24) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đăng xuất phải hỏi lại để tránh bấm nhầm, và sau khi đăng xuất không còn xem được dữ liệu cá nhân. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A trên 11Food, giỏ hàng có thể có món. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở tab "Tài khoản", kéo xuống cuối, chạm "Đăng xuất". | Hộp thoại "Đăng xuất?" với nội dung "Bạn sẽ cần đăng nhập lại để dùng tài khoản. Phiên trên máy chủ sẽ được thu hồi khi có kết nối." và nút "Huỷ", "Đăng xuất". |
| 2 | Chạm "Huỷ". | Hộp thoại đóng, vẫn đăng nhập. |
| 3 | Chạm "Đăng xuất" lần nữa rồi chạm "Đăng xuất" trong hộp thoại. | Quay về màn hình chưa đăng nhập, có "Tạo tài khoản" và "Đăng nhập". |
| 4 | Chạm tab "Đơn hàng". | Không hiện đơn hàng của KH-A; có lời mời "Đăng nhập để xem đơn hàng của bạn." |
| 5 | Nhấn nút Back của Android nhiều lần. | Không quay lại được màn hình có dữ liệu của KH-A. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng nhập lại nếu cần cho test sau.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (confirmLogout)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/session_controller_test.dart; tests/integration/client-auth-session.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-018 · Tắt hẳn rồi mở lại ứng dụng: vẫn đăng nhập

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #25 (trong ngày: 25) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Người dùng không phải đăng nhập lại mỗi lần mở app (phiên còn hạn). |
| Người thực hiện | Khách / Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A trên 11Food. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trong danh sách ứng dụng gần đây (Recent apps), vuốt tắt hẳn 11Food. | 11Food biến mất khỏi danh sách. |
| 2 | Mở lại 11Food, chạm tab "Tài khoản". | Hiện "Đang kiểm tra phiên đăng nhập…" ít giây rồi vẫn đăng nhập KH-A (không bị đẩy ra màn đăng nhập). |
| 3 | Lặp lại với 11Ship và SP-A (nếu đang đăng nhập). | Vẫn đăng nhập SP-A. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/session_controller.dart (khôi phục phiên khi khởi động)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/session_controller_test.dart; tests/integration/client-runtime.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-019 · Khởi động lại điện thoại: vẫn đăng nhập

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #26 (trong ngày: 26) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Sau khi điện thoại tắt nguồn và bật lại, tài khoản vẫn dùng được trong thời hạn phiên. |
| Người thực hiện | Khách / Shipper |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A (và SP-A nếu có 11Ship). |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tắt nguồn điện thoại, đợi 10 giây, bật lại và mở khóa. | Điện thoại khởi động bình thường. |
| 2 | Mở 11Food, vào tab "Tài khoản". | Vẫn đăng nhập KH-A (hoặc nếu phiên đã hết hạn thì có thông báo "Phiên đăng nhập đã kết thúc" rõ ràng; ghi lại thời gian đã trôi qua). |
| 3 | Mở 11Ship (nếu đã đăng nhập SP-A). | Vẫn đăng nhập; shipper nếu đang bật online thì ứng dụng tự khôi phục chia sẻ vị trí khi mở lại hoặc báo hướng dẫn cần mở. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `docs/current/M14-online-location-20261024.md (khởi động lại: dịch vụ vị trí chỉ dựng lại khi còn ý định online)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/ship/test/ship_online_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-020 · Quên mật khẩu: đặt lại bằng mã OTP qua SMS

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #27 (trong ngày: 27) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Người dùng quên mật khẩu tự đặt lại được bằng mã SMS, và đăng nhập được bằng mật khẩu mới (mật khẩu cũ hết tác dụng). |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đã đăng xuất. Hệ thống SMS đang bật. |
| Dữ liệu nhập | Số SĐT-KH-A. Mật khẩu mới: tự đặt 8-128 ký tự, khác mật khẩu cũ; nhập lại giống hệt. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Tài khoản" > "Đăng nhập" > chạm "Quên mật khẩu?". | Màn "Quên mật khẩu" với dòng "Nhập số điện thoại đã đăng ký, mã xác minh nhận qua SMS, rồi đặt mật khẩu mới." |
| 2 | Nhập SĐT-KH-A, chạm "Gửi mã xác minh". | Hiện "Nếu số điện thoại đã đăng ký, bạn sẽ nhận tin nhắn SMS chứa mã xác minh trong ít phút. Nhập mã vào ô bên dưới." |
| 3 | Nhập mã SMS vào "Mã xác minh", chạm "Xác nhận mã". | Hiện "Đã xác minh mã"; xuất hiện ô "Mật khẩu mới" và "Nhập lại mật khẩu mới". |
| 4 | Nhập mật khẩu mới, nhập lại, chạm "Đặt lại mật khẩu". | Hiện "Đã xử lý yêu cầu"/"Yêu cầu đã xử lý" kèm câu "Nếu số điện thoại hợp lệ, hãy đăng nhập bằng mật khẩu mới. Ứng dụng không tự đăng nhập cho bạn." |
| 5 | Chạm "Đăng nhập", thử đăng nhập bằng MẬT KHẨU CŨ. | Bị từ chối "Số điện thoại hoặc mật khẩu không đúng." |
| 6 | Đăng nhập bằng mật khẩu MỚI. | Đăng nhập thành công. Ghi mật khẩu mới vào bảng riêng (không ghi vào tài liệu này). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Dùng mật khẩu mới cho các test sau; cập nhật bảng thông tin riêng.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/flows/reset_views.dart, reset_controller.dart; docs/tasks/M01-B-RESET-password-recovery-design.md; ops/runbooks/sms-gateway.md (Password reset by SMS)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/account-recovery-*.int.spec.ts; client-password.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-021 · Quên mật khẩu: mã sai, hết hạn và số chưa đăng ký

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #28 (trong ngày: 28) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Kiểm tra các nhánh lỗi: mã sai bị từ chối; số chưa đăng ký nhận cùng thông báo chung (không lộ số nào có tài khoản). |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy) |
| Điều kiện ban đầu | Đã đăng xuất, mở màn "Quên mật khẩu". |
| Dữ liệu nhập | Số chưa đăng ký (số bất kỳ, chú ý chỉ số được phép nhận SMS mới nhận được mã); mã sai "111111". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Nhập một số chưa từng đăng ký, chạm "Gửi mã xác minh". | Vẫn hiện đúng câu chung "Nếu số điện thoại đã đăng ký, bạn sẽ nhận tin nhắn SMS…" (không nói số không tồn tại). |
| 2 | Nhập mã bất kỳ "111111", chạm "Xác nhận mã". | Không qua được; hiện lỗi mã không đúng/không dùng được. |
| 3 | Đổi sang SĐT-KH-A, gửi mã, nhập mã sai, rồi nhập đúng mã sau khi chờ. | Mã sai bị từ chối; mã đúng được chấp nhận (nếu chưa bị khóa quá số lần). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `reset_views.dart; apps/backend/src/account-recovery`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/account-recovery-reset-test.int.spec.ts; mobile/packages/n11_shared/test/lifecycle_flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-022 · Sau khi đặt lại mật khẩu, các phiên đăng nhập cũ bị đăng xuất

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #29 (trong ngày: 29) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Nếu ai đó đang dùng tài khoản của bạn trên máy khác thì đặt lại mật khẩu phải đuổi họ ra. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ACC-020 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đang đăng nhập trên Điện thoại 2 (11Food). Điện thoại 1 sẽ đặt lại mật khẩu. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 2 đăng nhập KH-A và để ở tab "Tài khoản". | Đang đăng nhập. |
| 2 | Trên Điện thoại 1 thực hiện đặt lại mật khẩu cho SĐT-KH-A (như TC-ACC-020, bước 1-4). | Đặt lại thành công. |
| 3 | Trên Điện thoại 2 chạm vào tab "Đơn hàng" rồi "Tài khoản". | Bị đăng xuất: hiện "Phiên đăng nhập đã kết thúc" cùng dòng "Tài khoản có thể đã đăng nhập trên thiết bị khác hoặc phiên đã hết hạn. Vì an toàn, vui lòng đăng nhập lại." và nút "Đăng nhập lại". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Dùng mật khẩu mới ở các test sau.

**Căn cứ:** `ops/runbooks/sms-gateway.md ("revokes every app / admin session"); account_views.dart (session-ended)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/account-recovery-reset-test.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-023 · Đổi mật khẩu khi đang đăng nhập

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #30 (trong ngày: 30) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đổi mật khẩu đúng cách; mật khẩu cũ sai bị từ chối; các máy khác bị đăng xuất. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A. |
| Dữ liệu nhập | Mật khẩu hiện tại: mật khẩu đang dùng. Mật khẩu mới: tự đặt, khác mật khẩu cũ. Lần thử sai: mật khẩu hiện tại "SaiHetRoi1". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > chạm "Đổi mật khẩu". | Màn "Đổi mật khẩu" với các ô "Mật khẩu hiện tại", "Mật khẩu mới", "Nhập lại mật khẩu mới" và gợi ý "Dùng từ 8 đến 128 ký tự. Sau khi đổi, các phiên khác sẽ được đăng xuất." |
| 2 | Nhập mật khẩu hiện tại SAI, mật khẩu mới hợp lệ, nhập lại đúng; chạm "Đổi mật khẩu". | Hiện lỗi "Chưa đổi được mật khẩu" + "Mật khẩu hiện tại không đúng." |
| 3 | Sửa mật khẩu hiện tại thành đúng, chạm "Đổi mật khẩu". | Hiện thông báo thành công "Đã đổi mật khẩu — Bạn có thể dùng mật khẩu mới để đăng nhập." |
| 4 | Đăng xuất rồi đăng nhập bằng mật khẩu CŨ. | Bị từ chối. |
| 5 | Đăng nhập bằng mật khẩu MỚI. | Thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Có thể đổi lại về mật khẩu cũ bằng chính chức năng này (nhớ cập nhật bảng thông tin riêng).

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (ChangePasswordScreen); tests: client-password.int.spec.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-password.int.spec.ts; mobile/packages/n11_shared/test/session_controller_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-024 · Đổi mật khẩu: mật khẩu mới không hợp lệ hoặc nhập lại không khớp

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #31 (trong ngày: 31) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Mật khẩu mới phải từ 8 đến 128 ký tự và nhập lại phải khớp. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A, mở màn "Đổi mật khẩu". |
| Dữ liệu nhập | Mật khẩu mới "abc12" (quá ngắn); sau đó mật khẩu mới "matkhaumoi1" nhưng nhập lại "matkhaumoi2". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Nhập mật khẩu hiện tại đúng, mật khẩu mới "abc12", nhập lại "abc12". | Ô mật khẩu mới báo lỗi độ dài; nút đổi không gửi. |
| 2 | Nhập mật khẩu mới "matkhaumoi1", nhập lại "matkhaumoi2". | Hiện "Mật khẩu chưa khớp."; không đổi. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thoát màn hình, không có gì thay đổi.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (passwordError, confirmPasswordError)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-025 · Đăng nhập cùng một tài khoản trên điện thoại thứ hai: máy cũ bị đăng xuất

**Mức độ:** P0 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #32 (trong ngày: 32) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Mỗi tài khoản chỉ dùng trên một thiết bị tại một thời điểm. Đăng nhập máy mới phải làm máy cũ hết phiên, tránh hai người cùng thao tác. |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH); Điện thoại 2 (máy QUÁN) (tối thiểu 2 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Điện thoại 1 đang đăng nhập KH-A. Điện thoại 2 đã cài 11Food, chưa đăng nhập. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên Điện thoại 1 mở 11Food, tab "Tài khoản" - đang đăng nhập KH-A. | Thấy "Khách Test A". |
| 2 | Trên Điện thoại 2 đăng nhập KH-A. | Đăng nhập thành công trên Điện thoại 2. |
| 3 | Trên Điện thoại 1 chạm tab "Đơn hàng", rồi tab "Tài khoản". | Điện thoại 1 bị đăng xuất: hiện "Phiên đăng nhập đã kết thúc - Tài khoản có thể đã đăng nhập trên thiết bị khác…" và nút "Đăng nhập lại". |
| 4 | Trên Điện thoại 2 chạm tab "Tài khoản". | Điện thoại 2 vẫn đăng nhập bình thường. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất Điện thoại 2 (và Điện thoại 1 nếu cần).

**Căn cứ:** `mobile/README.md ("A login from another phone replaces the binding and ends the sessions of both apps"); account_views.dart (session-ended)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/native-device-binding.int.spec.ts; client-auth-session.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-028 · Xem và sửa họ tên của tài khoản

**Mức độ:** P1 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #33 (trong ngày: 33) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | Người dùng xem và sửa được họ tên hiển thị; số điện thoại chỉ xem (được che bớt). |
| Người thực hiện | Khách (KH-A) |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A. |
| Dữ liệu nhập | Họ tên mới: "Khách Test A Sửa". Sau đó đổi lại "Khách Test A". |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > chạm vào thẻ thông tin cá nhân (mục "Thông tin cá nhân" / "Xem và sửa họ tên"). | Màn hồ sơ có ô "Họ và tên" và dòng "Số điện thoại: …" (che bớt). |
| 2 | Đổi họ tên thành "Khách Test A Sửa", chạm lưu. | Hiện "Đã lưu họ tên." Quay lại tab Tài khoản thấy tên mới. |
| 3 | Xóa trống họ tên rồi lưu. | Báo lỗi bắt buộc nhập; không lưu tên trống. |
| 4 | Đổi lại thành "Khách Test A" và lưu. | Lưu thành công. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đã đổi lại tên cũ ở bước 4.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (ProfileScreen)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/client-profile.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-029 · Xem Điều khoản sử dụng và Chính sách quyền riêng tư

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #34 (trong ngày: 34) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Người dùng đọc được điều khoản và chính sách trong ứng dụng. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **CẦN XÁC MINH** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | 11Food mở. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chưa xác định chắc chắn mục vào "Chính sách và điều khoản" trong tab Tài khoản (có màn PolicyScreen trong mã). Tài liệu điều khoản còn ghi "chờ Owner duyệt nội dung" (docs/current/M01-terms-privacy-20261014.md). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở "Tài khoản" > "Tạo tài khoản" và đọc khung điều khoản ở màn 1/3 (kéo trong khung). | Hiện đầy đủ hai phần "Điều khoản sử dụng" và "Chính sách quyền riêng tư" bằng tiếng Việt. |
| 2 | Nếu trong tab "Tài khoản" có mục "Chính sách và điều khoản", chạm vào. | Mở màn hình có cùng nội dung. Nếu không có mục này thì ghi "không có mục" vào ghi chú (không phải lỗi nếu đọc được ở bước 1). |
| 3 | Đối chiếu nội dung điều khoản với bản đã được Owner duyệt (Người phụ trách cung cấp). | Nội dung khớp bản đã duyệt. |
| 4 | Đọc kỹ câu mô tả chức năng trong "Điều khoản sử dụng" và so với những gì ứng dụng đang làm được (đặt món, giao hàng, ví). | Ghi lại nguyên văn. Hiện trong mã nguồn, Điều khoản ghi "đặt món, giao hàng, ví và doanh thu chưa hoạt động" và "quyền chỉ có sau khi hồ sơ được duyệt", trong khi các chức năng này đã hoạt động: nếu câu này còn hiện, báo mức CAO (nội dung pháp lý sai so với thực tế) để Owner quyết định sửa và đổi phiên bản điều khoản. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (PolicyScreen, kTermsText); docs/current/M01-terms-privacy-20261014.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ACC-033 · Mục Voucher trong 11Food báo rõ chưa hỗ trợ

**Mức độ:** P2 · **Nhóm:** A. Tài khoản, OTP, đăng nhập, mật khẩu, phiên · **Số thứ tự chạy:** #35 (trong ngày: 35) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Chức năng voucher chưa làm. Màn hình phải nói thật là chưa hỗ trợ, không giả vờ có mã giảm giá. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **NOT READY** |
| Phụ thuộc | TC-ACC-014 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Đang đăng nhập KH-A. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Chức năng chưa có theo mã nguồn: màn Voucher chỉ hiện "Tính năng voucher chưa được hỗ trợ.". Test này kiểm chứng việc báo trung thực. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tab "Tài khoản" > mục "Ưu đãi" > "Voucher của tôi". | Màn hình voucher mở ra, có dòng "Tính năng voucher chưa được hỗ trợ. Chưa thể nhập hoặc áp mã." Các thẻ "Chưa có voucher", "Chưa có voucher đã dùng", "Chưa có voucher hết hạn". |
| 2 | Thử nhập mã vào bất cứ ô nào (nếu có). | Không có chỗ nhập mã giảm giá có tác dụng. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `mobile/packages/n11_shared/lib/src/account/account_views.dart (VoucherScreen)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/flows_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-007 · Cập nhật đè bản mới của 11Food (không gỡ app)

**Mức độ:** P0 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #36 (trong ngày: 36) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Khi có bản mới, người dùng cài đè lên bản cũ mà không mất đăng nhập, giỏ hàng và dữ liệu. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có HAI file APK 11Food: bản cũ (A) và bản mới hơn (B), cùng do Người phụ trách cấp (cùng chữ ký, số hiệu bản dựng của B lớn hơn A). Máy đang cài bản A và đã đăng nhập KH-A, có 1 món trong giỏ. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên 11Food bản A, chụp màn hình tab "Tài khoản" (thấy tên KH-A) và giỏ hàng (có 1 món). | Có ảnh chụp "trước khi cập nhật". |
| 2 | Chép file APK bản B vào điện thoại, chạm vào file, chọn "Cập nhật" / "Cài đặt". | Android báo "Bạn có muốn cập nhật ứng dụng này không?" và cài thành công. KHÔNG phải gỡ ứng dụng trước. |
| 3 | Mở 11Food sau khi cài xong. | Ứng dụng mở bình thường. |
| 4 | Chạm tab "Tài khoản". | Vẫn đăng nhập KH-A, không bị hỏi đăng nhập lại. |
| 5 | Mở giỏ hàng. | Món trong giỏ vẫn còn đúng như trước. |
| 6 | Ghi phiên bản mới (cách xem ở TC-SET-006). | Phiên bản mới lớn hơn phiên bản cũ. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng. Nếu Android báo "Ứng dụng chưa được cài đặt vì xung đột với gói hiện có" thì FAIL nghiêm trọng (chữ ký hoặc số hiệu bản dựng sai).

**Cách khôi phục để chạy lại:** Không cần. Muốn thử lại cần có thêm một bản cũ hơn (không thể hạ phiên bản ngay; phải gỡ app rồi cài bản cũ).

**Căn cứ:** `AGENTS.md (mục "Android test updates"); mobile/README.md; .github/workflows/mobile-apk.yml (versionCode tăng dần, khóa ký bền vững)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Workflow "Mobile APK": bước kiểm chữ ký và versionCode.

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-008 · Cập nhật đè bản mới của 11Ship khi đang đăng nhập

**Mức độ:** P0 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #37 (trong ngày: 37) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Shipper cập nhật app không bị mất phiên đăng nhập và không mất trạng thái hoạt động. |
| Người thực hiện | Shipper |
| Thiết bị cần có | Điện thoại 3 (máy SHIPPER) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ACC-004 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | Có hai file APK 11Ship (bản cũ A, bản mới B). Máy đang cài bản A, đã đăng nhập SP-A, đang TẮT online, không có đơn đang giao. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên 11Ship bản A, vào tab "Tài khoản" và chụp màn hình (thấy tên SP-A). | Có ảnh chụp trước khi cập nhật. |
| 2 | Cài đè file APK bản B (không gỡ bản cũ). | Cài thành công, báo cập nhật. |
| 3 | Mở 11Ship. | Mở bình thường. |
| 4 | Chạm tab "Tài khoản". | Vẫn đăng nhập SP-A. |
| 5 | Chạm tab "Trang chủ". | Hiện "Bạn đang offline" (đúng trạng thái trước khi cập nhật). Không tự bật online khi shipper chưa bấm. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần.

**Căn cứ:** `AGENTS.md (cập nhật đè giữ dữ liệu); mobile/ship/lib/ship_online.dart (không tự bật online khi chưa có ý định)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** Workflow "Mobile APK".

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-SET-012 · Gỡ ứng dụng rồi cài lại: phải đăng nhập lại, dữ liệu trên máy chủ còn nguyên

**Mức độ:** P2 · **Nhóm:** A. Cài đặt, thiết bị và phiên bản · **Số thứ tự chạy:** #38 (trong ngày: 38) · **Mức nghiêm trọng nếu FAIL:** Thấp

| Mục | Nội dung |
|---|---|
| Mục đích | Dữ liệu thật (tài khoản, đơn, ví) nằm trên máy chủ, không nằm trên điện thoại. Gỡ app không làm mất tài khoản. |
| Người thực hiện | Khách |
| Thiết bị cần có | Điện thoại 1 (máy KHÁCH) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | TC-ACC-001 |
| Điều kiện hệ thống cần có | Không có điều kiện đặc biệt ngoài tài khoản và Internet |
| Điều kiện ban đầu | KH-A đã đăng ký và đã từng đăng nhập trên máy này. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Gỡ cài đặt 11Food (Cài đặt > Ứng dụng > 11Food > Gỡ cài đặt). | Ứng dụng biến mất khỏi máy. |
| 2 | Cài lại 11Food từ file APK và mở ứng dụng. | Mở ra ở trạng thái chưa đăng nhập. |
| 3 | Đăng nhập lại bằng KH-A. | Đăng nhập được (hoặc, nếu máy chủ yêu cầu xác minh thiết bị mới, ứng dụng nói rõ lý do). Tên, địa chỉ đã lưu của KH-A vẫn còn. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Đăng xuất khỏi các tài khoản đã dùng trong test này (tab "Tài khoản" > "Đăng xuất").

**Căn cứ:** `mobile/README.md (Storage: token mã hóa trong kho không sao lưu); session_controller.dart`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** mobile/packages/n11_shared/test/session_controller_test.dart

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-001 · Mở Web Admin bằng trình duyệt và thấy trang đăng nhập

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #39 (trong ngày: 39) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Người kiểm thử vào được trang quản trị bằng địa chỉ do Người phụ trách cung cấp (kết nối an toàn https). |
| Người thực hiện | Quản trị |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Thủ công |
| Tình trạng sẵn sàng | **SẴN SÀNG** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Có địa chỉ Web Admin (Người phụ trách cung cấp; theo cấu hình hiện tại của dự án là https://103.9.78.67.sslip.io). Trình duyệt Chrome/Edge/Firefox bản mới. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Mở trình duyệt, gõ địa chỉ Web Admin vào thanh địa chỉ, bấm Enter. | Hiện trang "Đăng nhập quản trị" (dòng "Dành cho tài khoản được cấp quyền."), có ô "Số điện thoại", "Mật khẩu", nút "Tiếp tục" và liên kết "Quên mật khẩu?". Có biểu tượng ổ khóa/"Bảo mật" trên thanh địa chỉ (không có cảnh báo chứng chỉ). |
| 2 | Chạm biểu tượng con mắt cạnh ô mật khẩu ("Hiện mật khẩu"). | Mật khẩu đang gõ hiện/ẩn được ("Ẩn mật khẩu"). |
| 3 | Mở cùng địa chỉ trên điện thoại. | Trang vẫn dùng được trên màn hình nhỏ (menu thu gọn). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/view.ts (#mountLogin); apps/backend/src/http/admin-web-hosting.ts`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-web-browser.int.spec.ts; admin-web-hosted-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-002 · SYSTEM đăng nhập Web Admin (mật khẩu + mã Authenticator) và đăng xuất

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #40 (trong ngày: 40) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Tài khoản quyền cao nhất đăng nhập hai lớp (mật khẩu và mã 6 số đổi liên tục). SYSTEM là tài khoản do kỹ thuật viên tạo; người mới không tự tạo được. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Kỹ thuật viên/Người phụ trách cung cấp thông tin đăng nhập SYSTEM và đã cài Google Authenticator (hoặc tương đương) cho tài khoản đó trên điện thoại của bạn. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của SYSTEM rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: SYSTEM". |
| 4 | Nhìn menu bên trái. | Thấy đầy đủ các nhóm: Tổng quan, Điều hành, Báo cáo; TÀI KHOẢN (Người dùng, Quản trị viên, Phân quyền, Lời mời Admin); VẬN HÀNH (Quán, Shipper, Đơn hàng, Giao hàng, Thông báo, Đánh giá, Phản ánh); DANH MỤC; TÀI CHÍNH; VẬN HÀNH HỆ THỐNG; HỆ THỐNG. |
| 5 | Chạm tên tài khoản/"Menu tài khoản" ở góc trên, chọn "Đăng xuất". | Hiện "Đang đăng xuất…" rồi quay về trang đăng nhập; nút Back của trình duyệt không mở lại được trang quản trị. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/view.ts; apps/admin-web/src/core/menu.ts; docs/current/M01-final-package-20261014.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-auth.int.spec.ts; admin-web-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-004 · SYSTEM tạo lời mời ADMIN và phân quyền ban đầu

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #41 (trong ngày: 41) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | ADMIN không tự đăng ký: chỉ SYSTEM mời. Lời mời có liên kết kích hoạt dùng một lần. |
| Người thực hiện | SYSTEM |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập Web Admin. |
| Dữ liệu nhập | Họ tên "Admin Test 1", số điện thoại SĐT-ADMIN-1 (SIM thật nhận được SMS). Quyền: Quán - Xem + Quản lý hoạt động quán + Khóa; Shipper - Xem + Duyệt hồ sơ + Khóa; Đơn hàng/Giao hàng theo mặc định; nhóm món (Danh mục); quyền tiền: Xem yêu cầu nạp tiền + Xác nhận/từ chối nạp tiền (nếu cần cho TC-WAL). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Trên máy tính, mở trình duyệt, gõ địa chỉ Web Admin (xem mục "Thông tin do Người phụ trách cung cấp"). | Trang "Đăng nhập quản trị" hiện ra với ô "Số điện thoại" và "Mật khẩu". |
| 2 | Gõ số điện thoại và mật khẩu của SYSTEM rồi bấm "Tiếp tục". | Trang "Xác thực hai bước" hiện ra, yêu cầu mã 6 số. |
| 3 | Mở ứng dụng Authenticator trên điện thoại, đọc mã 6 số hiện trong ứng dụng Authenticator trên điện thoại của bạn, gõ vào ô mã rồi bấm nút xác nhận đăng nhập. | Vào được trang chủ Web Admin: tiêu đề "Đăng nhập thành công" và dòng "Vai trò: SYSTEM". |
| 4 | Ở menu bên trái của Web Admin, chọn: TÀI KHOẢN > "Lời mời Admin". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 5 | Chạm "Tạo lời mời ADMIN". | Mở biểu mẫu "Tạo lời mời ADMIN" với "Họ tên", "Số điện thoại", phần "Quyền theo ứng dụng" (Khách hàng/Quán/Shipper: Xem, Duyệt hồ sơ, Khóa/Mở khóa, Nhóm món, Quản lý hoạt động quán). |
| 6 | Nhập dữ liệu, chọn quyền, chạm "Tạo lời mời". | Hiện "Đã tạo lời mời" cùng "Liên kết kích hoạt" và cảnh báo "Liên kết này là bí mật. Chỉ gửi cho đúng người được mời…". Có nút "Sao chép liên kết". |
| 7 | Chạm "Sao chép liên kết" và gửi riêng cho người được mời (ví dụ Zalo cá nhân). | Liên kết sao chép được. Trạng thái lời mời "Chờ kích hoạt". |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Thu hồi lời mời ("Thu hồi lời mời") nếu không dùng; nếu đã kích hoạt thì tài khoản ADMIN-1 được dùng tiếp.

**Căn cứ:** `apps/admin-web/src/dom/provisioning-view.ts; docs/current/M01-final-package-20261014.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-provisioning.int.spec.ts; admin-invitations.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-005 · Kích hoạt tài khoản ADMIN: mã OTP SMS, đặt mật khẩu, thiết lập Authenticator

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #42 (trong ngày: 42) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Người được mời tự kích hoạt trong 3 bước; không ai khác biết mật khẩu hay mã Authenticator. |
| Người thực hiện | ADMIN-1 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-004 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị |
| Điều kiện ban đầu | Có liên kết kích hoạt chưa dùng của lời mời cho SĐT-ADMIN-1. Điện thoại có ứng dụng Google Authenticator (hoặc Microsoft Authenticator). SMS Gateway đang bật. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Dán liên kết kích hoạt vào trình duyệt. | Hiện trang kích hoạt: "Bước 1/3 · Xác minh số điện thoại" và thông tin lời mời (số che bớt). |
| 2 | Chạm "Gửi mã OTP", đợi SMS, nhập "Mã OTP 6 số", "Xác nhận". | Chỉ khi tin nhắn đã gửi mới mở ô nhập; xác nhận thành công và sang "Bước 2/3 · Đặt mật khẩu". |
| 3 | Nhập mật khẩu 8-128 ký tự ("Tạo mật khẩu mới từ 8 đến 128 ký tự."), nhập lại, "Tiếp tục". | Sang "Bước 3/3 · Thiết lập Authenticator" với mã QR và "Hiện khóa thiết lập". |
| 4 | Mở Google Authenticator > thêm tài khoản > quét mã QR (hoặc nhập khóa). Nhập mã 6 số đang hiển thị, bấm "Hoàn tất kích hoạt". | Kích hoạt thành công; trạng thái lời mời "Đã kích hoạt". |
| 5 | Đăng nhập Web Admin bằng ADMIN-1 (số, mật khẩu, mã Authenticator). | Vào được; hiện "Vai trò: ADMIN" và chỉ các mục đúng quyền đã cấp. |
| 6 | Mở lại liên kết kích hoạt cũ. | Không dùng lại được (báo liên kết đã dùng/hết hạn). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Ghi nhận ADMIN-1 đã sẵn sàng. Mật khẩu/khóa Authenticator giữ riêng, không ghi vào tài liệu.

**Căn cứ:** `apps/admin-web/src/dom/activation-view.ts; docs/current/M01-production-profile-20261014.md (OTP kích hoạt ADMIN qua SMS Gateway)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-activation.int.spec.ts; admin-activation-sms-gateway.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-006 · Thêm quản trị viên thứ hai (ADMIN-2) chỉ có quyền Xem Quán

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #43 (trong ngày: 43) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Cần một ADMIN quyền hạn chế để kiểm thử phân quyền. |
| Người thực hiện | SYSTEM + ADMIN-2 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-005 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | SYSTEM đăng nhập; có số điện thoại thứ hai nhận SMS. |
| Dữ liệu nhập | Họ tên "Admin Test 2", SĐT-ADMIN-2. Quyền: CHỈ "Quán - Xem". Không cấp quyền tiền, không cấp quyền khóa. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Tạo lời mời cho ADMIN-2 với quyền như Dữ liệu nhập (làm như TC-ADM-004). | Lời mời được tạo. |
| 2 | Kích hoạt tài khoản (làm như TC-ADM-005). | Kích hoạt thành công. |
| 3 | Đăng nhập ADMIN-2 và nhìn menu. | Chỉ thấy các mục liên quan đến Quán (ví dụ Người dùng, Quán, Đơn hàng, Giao hàng, Thông báo...). Không thấy Phân quyền, Lời mời Admin, TÀI CHÍNH, Cài đặt hệ thống. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Giữ ADMIN-2 cho các test phân quyền.

**Căn cứ:** `apps/admin-web/src/core/menu.ts (grantsFromPermissions)`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-provisioning.int.spec.ts; m12-access.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-011 · ADMIN quên mật khẩu: đặt lại bằng SMS (SYSTEM không tự đặt lại trên web)

**Mức độ:** P1 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #44 (trong ngày: 44) · **Mức nghiêm trọng nếu FAIL:** Trung bình

| Mục | Nội dung |
|---|---|
| Mục đích | ADMIN tự đặt lại mật khẩu bằng OTP SMS nhưng vẫn cần mã Authenticator sẵn có; SYSTEM chỉ khôi phục bằng công cụ trên máy chủ. |
| Người thực hiện | ADMIN-2 |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | TC-ADM-006 |
| Điều kiện hệ thống cần có | SMS (máy SMS Gateway đang chạy); Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | ADMIN-2 đã kích hoạt, SMS Gateway bật. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở trang đăng nhập bấm "Quên mật khẩu?". | Trang "Đặt lại mật khẩu": "Nhập số điện thoại của tài khoản quản trị để nhận mã OTP.", có ghi chú "SYSTEM khôi phục bằng công cụ trên máy chủ". |
| 2 | Nhập SĐT-ADMIN-2, "Gửi mã OTP"; nhập mã SMS; đặt mật khẩu mới. | Hiện "Đã đặt lại mật khẩu" kèm nội dung "...mọi phiên cũ đã bị đăng xuất. Hãy đăng nhập bằng mật khẩu mới; tài khoản quản trị vẫn cần mã Authenticator hiện có." |
| 3 | Đăng nhập bằng mật khẩu mới + mã Authenticator cũ. | Đăng nhập thành công; mật khẩu cũ không còn dùng được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Cập nhật mật khẩu ADMIN-2 trong bảng riêng.

**Căn cứ:** `apps/admin-web/src/dom/reset-view.ts; ops/runbooks/sms-gateway.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-reset-sms-browser.int.spec.ts; account-recovery-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-003 · Đăng nhập Web Admin sai mật khẩu hoặc sai mã Authenticator

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #45 (trong ngày: 45) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Đăng nhập sai bị từ chối bằng thông báo chung; sai nhiều lần bị khóa tạm thời. |
| Người thực hiện | Quản trị |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu 1 điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | ADMIN-2 đã kích hoạt (TC-ADM-006). |
| Dữ liệu nhập | Mật khẩu sai "SaiHetRoi1"; mã Authenticator sai "000000". |
| Ghi chú đặc biệt | Cẩn thận: sai nhiều lần sẽ khóa tài khoản tạm thời. Chỉ thử vài lần, dùng tài khoản ADMIN-2 (không dùng SYSTEM). |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Nhập số điện thoại ADMIN-2 và mật khẩu SAI rồi "Tiếp tục". | Báo lỗi chung ("Số điện thoại hoặc mật khẩu không đúng" hoặc tương tự); không vào bước mã. |
| 2 | Nhập mật khẩu ĐÚNG; ở bước "Xác thực hai bước" nhập mã "000000". | Báo mã không đúng; không vào được. |
| 3 | Nhập mã đúng từ Authenticator. | Đăng nhập được. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/view.ts; apps/backend/src/admin-auth`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-auth.int.spec.ts; admin-auth-limits.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-020 · Quản lý "Nhóm món" (danh mục) để chủ quán thêm món

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #46 (trong ngày: 46) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Nhóm món do Admin tạo; thiếu nhóm thì chủ quán không thêm được món. Test này tạo dữ liệu cần cho Ngày 2. |
| Người thực hiện | ADMIN/SYSTEM (quyền Nhóm món) |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã đăng nhập Web Admin với quyền quản lý nhóm món (SYSTEM hoặc ADMIN-1). |
| Dữ liệu nhập | Hai nhóm: "Món chính" (thứ tự 1) và "Đồ uống" (thứ tự 2). |
| Ghi chú đặc biệt | Nhóm món KHÔNG xóa được, chỉ "Ngừng dùng" và "Kích hoạt lại". Vì vậy chỉ tạo đúng hai nhóm cần thiết; không tạo nhóm tạm. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: DANH MỤC > Danh mục > "Nhóm món". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Nếu chưa có nhóm nào, trang ghi "Chưa có nhóm món": chạm "+ Thêm nhóm". Ở màn "Thêm nhóm món" nhập "Tên nhóm" = "Món chính", "Thứ tự" = 1, chạm "Lưu". | Nhóm "Món chính" xuất hiện trong "Danh sách nhóm món" ở trạng thái đang dùng, cột "Số món" = 0. |
| 3 | Chạm "+ Thêm nhóm" lần nữa, nhập "Đồ uống", thứ tự 2, "Lưu". | Có hai nhóm trong danh sách. |
| 4 | Ở nhóm "Đồ uống" chạm "Sửa", đổi thứ tự thành 3 rồi "Lưu", sau đó sửa lại thành 2. | Thứ tự đổi đúng, lưu thành công, không tạo nhóm trùng. |
| 5 | Chạm "Ngừng dùng" ở nhóm "Đồ uống" (chỉ khi chưa có quán nào dùng nhóm này) rồi xác nhận "Ngừng dùng nhóm món"; kiểm tra bằng cách chủ quán thử "+ Thêm món". | Nhóm "Đồ uống" không còn chọn được khi chủ quán thêm món mới ("Ngừng hoạt động · chỉ giữ liên kết hiện có…"). |
| 6 | Chạm "Kích hoạt" ("Kích hoạt lại nhóm món") ở nhóm "Đồ uống". | Nhóm đang dùng trở lại và chọn được khi thêm món. |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Giữ hai nhóm "Món chính" và "Đồ uống" ở trạng thái ĐANG DÙNG (không có chức năng xóa nhóm).

**Căn cứ:** `apps/admin-web/src/dom/catalog-view.ts; apps/backend/src/admin-menu-categories`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/admin-menu-categories.int.spec.ts; admin-menu-categories-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---

### TC-ADM-024 · Bảng "Phí & điều kiện giao": xem, thử tính phí; chỉ SYSTEM được sửa

**Mức độ:** P0 · **Nhóm:** G. Web Admin · **Số thứ tự chạy:** #47 (trong ngày: 47) · **Mức nghiêm trọng nếu FAIL:** Cao

| Mục | Nội dung |
|---|---|
| Mục đích | Bảng phí 3 khung là nguồn của mọi phí giao. Test này kiểm tra bảng đã được áp dụng và đọc được. Giá trong tài liệu (10k/15k/20k) chỉ là ví dụ, KHÔNG phải giá thật. |
| Người thực hiện | SYSTEM, ADMIN |
| Thiết bị cần có | Máy tính có trình duyệt (Web Admin) (tối thiểu chỉ cần máy tính điện thoại) |
| Loại kiểm thử | Cần hỗ trợ kỹ thuật |
| Tình trạng sẵn sàng | **CẦN HỖ TRỢ KỸ THUẬT** |
| Phụ thuộc | Không (làm độc lập) |
| Điều kiện hệ thống cần có | Web Admin + tài khoản quản trị; Bảng phí giao đã được SYSTEM áp dụng; Tài khoản SYSTEM (kỹ thuật viên cấp) |
| Điều kiện ban đầu | Đã đăng nhập Web Admin. |
| Dữ liệu nhập | Không cần nhập dữ liệu riêng. |
| Ghi chú đặc biệt | Nếu bảng phí chưa được SYSTEM áp dụng thì mọi phí hiện "Chưa xác định phí" và các luồng đơn phải dùng đường đề xuất phí. Người phụ trách (SYSTEM) phải chốt giá thực tế trước khi chạy Ngày 2-3. |

| Bước | Việc cần làm | Kết quả mong đợi |
|---|---|---|
| 1 | Ở menu bên trái của Web Admin, chọn: HỆ THỐNG > "Phí & điều kiện giao". | Trang tương ứng mở ra, có tiêu đề đúng với mục vừa chọn, không báo lỗi đỏ. |
| 2 | Đọc "Ba khung tính phí" và "Các phiên bản đã áp dụng". | Hiện đúng 3 khung với "Đến dưới (km)" và "Phí ship (đ)"; bán kính tìm shipper hiển thị 3 km (chỉ đọc). Nếu chưa có bảng: "Chưa có bảng giá nào được áp dụng: hệ thống chưa tính được phí." |
| 3 | Ghi lại ba mức phí và ba ranh giới vào bảng chuẩn (F1, F2, F3; b1, b2, b3). | Có bảng chuẩn để đối chiếu mọi test phí. |
| 4 | Ở "Thử tính phí" nhập "Quãng đường giao (km)" lần lượt 1, 4, 8 và 15. | Phí hiện đúng khung (khung 1 cho 1 km...). Với quãng đường vượt mốc cuối (15 km): "Chưa xác định phí" (KHÔNG phải 0đ). |
| 5 | ADMIN-1 mở cùng trang. | Chỉ xem và thử tính ("Bạn chỉ có quyền xem và thử tính phí. Chỉ tài khoản SYSTEM được chỉnh sửa bảng giá."). |

**Cách kết luận:** PASS: mọi bước đều đúng như cột "Kết quả mong đợi". FAIL: có ít nhất một bước khác kết quả mong đợi - ghi rõ bước số mấy, chụp ảnh hoặc quay màn hình ngay khi lỗi xảy ra. BLOCKED: không làm tiếp được vì thiếu điều kiện (tài khoản, dữ liệu, mạng, thiết bị) - ghi điều kiện còn thiếu và báo Người phụ trách. NOT READY: chỉ dùng khi cột "Tình trạng sẵn sàng" đã ghi NOT READY và màn hình thật sự không có chức năng.

**Cách khôi phục để chạy lại:** Không cần khôi phục: test này không làm thay đổi dữ liệu.

**Căn cứ:** `apps/admin-web/src/dom/shipping-policy-view.ts; docs/current/M06-v1.1-3km-3tiers-fee-agreement-20261018.md`

**Kiểm thử tự động liên quan (chỉ đối chiếu):** tests/integration/m06-shipping-fee-policy.int.spec.ts; admin-shipping-policy-browser.int.spec.ts

**GHI KẾT QUẢ** (chép vào file TESTCASE_11SHIP.csv):

| Trạng thái | Ngày kiểm thử | Người kiểm thử | Phiên bản APK/bản triển khai | Mã lỗi liên quan | Ảnh/video bằng chứng |
|---|---|---|---|---|---|
| ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT READY | | | | | |

Ghi chú: 

---
