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

{{GROUP_SUMMARY}}

## 6. Điểm có thể CHẶN việc đưa cho người ngoài thử (pilot)

Có {{GATE_COUNT}} test thuộc 5 nhóm dưới đây. **Mọi dòng phải "đạt" (PASS) hoặc đã có quyết định bằng văn bản của Owner** trước khi mời quán/shipper/khách bên ngoài dùng thử. Một dòng FAIL, BLOCKED hoặc chưa chạy = **chưa đưa cho người ngoài**.

{{GATE_TABLE}}

## 7. Câu hỏi cần Owner quyết định (bộ test KHÔNG tự quyết thay)

| Mã | Câu hỏi | Test liên quan | Ảnh hưởng nếu chưa trả lời |
|---|---|---|---|
| OQ-01 | Quán có cần **Admin duyệt** trước khi bán (như màn đăng ký ghi "Chỉ bán hàng sau khi được duyệt") hay được **hoạt động ngay** khi hồ sơ đủ (như code hiện tại)? | TC-ADM-015, TC-ADM-019, TC-ACC-003 | Test ADM-015 chỉ ghi nhận hiện trạng; chưa có kết luận đúng/sai nghiệp vụ |
| OQ-02 | Ai sửa và duyệt lại **Điều khoản sử dụng** (đang nói các chức năng chưa hoạt động)? Khi nào đổi số phiên bản điều khoản? | TC-ACC-029 | Chặn pilot ngoài |
| OQ-03 | Ai sửa **Chính sách quyền riêng tư** (đang nói không theo dõi vị trí nền) và có cần thêm thông báo "đang chia sẻ vị trí" cho shipper? | TC-SEC-007, TC-ABN-014 | Chặn pilot ngoài |
| OQ-04 | Có cần hiển thị **số phiên bản** ngay trong ứng dụng không? (Hiện kiểm tra qua Cài đặt Android, đủ để test.) | TC-SET-006 | Không chặn; chỉ tiện lợi |
| OQ-05 | Duyệt **quy tắc tiền thử nghiệm** (HUONG_DAN mục 7): tài khoản nhận tiền thử, mức nạp, cách xử lý số dư cuối vòng. | Nhóm Ví (TC-WAL-*) | Không thể chạy các test tiền P0 |
| OQ-06 | Có bật **thông báo đẩy (Firebase)** cho vòng thử này không? | TC-NOTI-001 | Thông báo chỉ kiểm được khi mở ứng dụng |
| OQ-07 | Có đưa **gói bản đồ ngoại tuyến** vào APK thử không? | TC-DRV-018, TC-CUS-027 | Bản đồ không kiểm được |
| OQ-08 | **Chỉ đường, Thu nhập, Voucher** hiện "chưa có": chấp nhận không có trong vòng pilot này? | TC-DRV-019, TC-DRV-022, TC-ACC-033 | Giữ NOT READY |
| OQ-09 | Khi điện thoại **giờ sai**, kết quả mong muốn là gì (báo lỗi kết nối/chứng chỉ, hay vẫn đăng nhập)? | TC-ABN-017 | Test chỉ ghi nhận hiện trạng |
| OQ-10 | Nhóm phát triển **dọn `mobile/README.md`** (mục "Device proof" đã lỗi thời sau quyết định 23/10)? | TC-SET-011 | Người đọc README cũ hiểu sai |

## 8. Quyết định của Owner

| Mục | Lựa chọn |
|---|---|
| Kết luận | ☐ Tiếp tục thử nghiệm nội bộ ☐ Chạy thử quán/shipper thật ☐ Chưa được đưa vào sử dụng |
| Các test NOT READY chấp nhận (ghi mã) | |
| Các lệch tài liệu ↔ code đã quyết định (ghi số ở DOI_CHIEU mục 4) | |
| Điều kiện bổ sung / việc phải làm trước vòng sau | |
| Người quyết định, ngày | |

## 9. Danh sách đánh dấu từng test (in hoặc dán vào Excel)

Chép trạng thái thật vào cột "Trạng thái" của `TESTCASE_11SHIP.csv`; bảng dưới chỉ để đánh dấu nhanh. Thứ tự là **thứ tự nên chạy**.

{{CHECK_TABLES}}
