# Smoke test cho người mới – chạy lần đầu để biết "đường chính" có thông không

> Bản dành cho người **chưa biết 11Ship** và chưa từng làm kiểm thử. Gồm **{{SMOKE_COUNT}} test case** chọn từ bộ {{TOTAL}} test case, chạy khoảng **một buổi (3–4 giờ)**. Đây là **bước làm quen**, KHÔNG thay cho nghiệm thu: danh sách **{{P0}} test P0** của `DANH_SACH_P0.md` và 5 ngày kiểm thử đầy đủ vẫn giữ nguyên.

Bạn sẽ đi hết "đường chính" một lần: **đăng ký → đăng nhập → khách đặt đơn → quán xác nhận → quán gọi shipper → shipper nhận hàng → giao thành công → kiểm tra số dư ví → xem thông báo.**

## 1. Cần gì trước khi bắt đầu (hỏi Người phụ trách, đừng tự làm)

| # | Cần có | Ai chuẩn bị | Nếu chưa có thì |
|---|---|---|---|
| 1 | File APK **11Food** và **11Ship** (bản mới) và địa chỉ **Web Admin** | Kỹ thuật viên | Chưa làm được gì: dừng, báo Người phụ trách |
| 2 | **Máy SMS Gateway đang bật** và 3 số điện thoại có SIM thật chưa đăng ký (khách, chủ quán, shipper) | Kỹ thuật viên | Test #4–#6 ghi **BLOCKED** (không có mã OTP) |
| 3 | Tài khoản **ADMIN-1** (có quyền Nhóm món, Tài chính nạp tiền) + ứng dụng Authenticator đã cài | Kỹ thuật viên (SYSTEM tạo) | Test #10 và #20–#22 ghi **BLOCKED** |
| 4 | **Bảng phí giao đã được SYSTEM áp dụng** | Kỹ thuật viên (SYSTEM) | Phí hiện "Chưa xác định phí": test #11, #17 và #23–#25 ghi **BLOCKED** |
| 5 | **Owner duyệt tiền thử nghiệm** (HUONG_DAN mục 7) và đã bật "Tài khoản nhận tiền" thử | Owner + SYSTEM | Test #20–#22 ghi **BLOCKED**. **Tuyệt đối không chuyển tiền thật** |
| 6 | **3 điện thoại Android** (hoặc 2 điện thoại – xem HUONG_DAN mục 5.3) + 1 máy tính có trình duyệt | Người kiểm thử | Làm theo mục 5.3 |
| 7 | Bạn đứng trong **khu vực phục vụ** (khoảng 10 km quanh TP Cao Bằng), bật GPS | Người kiểm thử | Test #23–#25 ghi **BLOCKED** |
| 8 | **Bảng thông tin riêng** (số điện thoại thử, mật khẩu, địa chỉ Web Admin) do Người phụ trách đưa | Người phụ trách | Không bịa dữ liệu. Hỏi lại |

Đọc nhanh `HUONG_DAN_KIEM_THU_11SHIP.md` mục **1** (11Ship là gì), **2** (PASS/FAIL), **3** (chụp ảnh) và **5** (chuẩn bị) trước khi làm.

## 2. Quy tắc làm smoke test

1. **Làm đúng thứ tự** trong bảng dưới. Mỗi test sau dùng dữ liệu của test trước (ví dụ tài khoản vừa đăng ký).
2. Mỗi test: mở file chi tiết (cột "Ở đâu"), làm **từng bước**, so với cột **Kết quả mong đợi**, rồi ghi **PASS / FAIL / BLOCKED** vào cột "Kết quả" của bảng này (và chép vào `TESTCASE_11SHIP.csv`).
3. **FAIL** → chụp/quay màn hình ngay, lập báo lỗi theo `BAO_CAO_LOI_MAU.md`, rồi **làm tiếp** test kế tiếp nếu nó không phụ thuộc test lỗi.
4. **BLOCKED** (thiếu điều kiện) → ghi điều kiện còn thiếu, báo Người phụ trách, **làm test kế tiếp**; đừng đứng đợi và đừng tự làm thay kỹ thuật viên.
5. **DỪNG HẲN và báo ngay** nếu gặp một trong các lỗi nghiêm trọng: số dư ví sai/tự đổi, tiền bị cộng hoặc trừ hai lần, đơn bị trùng hoặc mất, hai shipper cùng nhận một đơn, bạn thấy đơn/tiền của người khác.
6. Test có dấu **KTV** ở cột "Ai làm": kỹ thuật viên/SYSTEM làm một phần – xem cột "Phần cần kỹ thuật viên".

## 3. Danh sách {{SMOKE_COUNT}} test (làm từ trên xuống)

{{SMOKE_TABLE}}

Trong {{SMOKE_COUNT}} test smoke có **{{SMOKE_P0}}** test thuộc nhóm {{P0}} test P0 của nghiệm thu đầy đủ (làm smoke xong là đã xong phần đó của P0, nhưng bạn vẫn phải làm các P0 còn lại).

## 4. Smoke test này có phủ những gì?

{{SMOKE_COVERAGE}}

## 5. Đọc kết quả smoke (không phải kết luận nghiệm thu)

| Kết quả | Ý nghĩa | Việc tiếp theo |
|---|---|---|
| **Tất cả PASS** | "Đường chính" chạy được trên bản APK này | Chuyển sang 5 ngày đầy đủ: bắt đầu từ `chi-tiet/NGAY_1_…` và làm tiếp các test P0 chưa làm |
| **Có BLOCKED, không có FAIL** | Thiếu điều kiện chuẩn bị | Xin kỹ thuật viên/Owner bổ sung (mục 1), chạy lại **đúng các test BLOCKED** |
| **Có FAIL** | Đường chính hỏng ở chỗ đó | Gửi báo lỗi. **Chưa** mời quán/shipper/khách bên ngoài. Sau khi sửa: chạy lại test FAIL và các test phụ thuộc nó |
| **Gặp lỗi nghiêm trọng (mục 2.5)** | Dừng thử nghiệm | Báo Owner ngay |

Smoke xong **không** có nghĩa hệ thống đã đạt: nghiệm thu còn cần P0 đầy đủ, các cổng "chặn thử nghiệm bên ngoài" (CHECKLIST_NGHIEM_THU mục 6) và quyết định của Owner. CI xanh cũng không thay thế việc thử tay.

## 6. Bị kẹt giữa chừng?

- Không biết **bấm vào đâu / nhập gì**: đọc lại cột "Việc cần làm" và "Dữ liệu nhập" của test; nếu vẫn không rõ, chụp màn hình bạn đang thấy và hỏi Người phụ trách (ghi lại câu hỏi để sửa tài liệu).
- Màn hình **khác** kết quả mong đợi nhưng bạn không chắc: coi là **FAIL**, ghi chữ thật bạn thấy.
- Nút hoặc màn hình **không tồn tại** theo mô tả: chụp màn hình, ghi **FAIL** (hoặc **NOT READY** nếu test ghi sẵn là chưa có) và báo.
- Mất mạng, app đơ: xem `HUONG_DAN_KIEM_THU_11SHIP.md` mục 12.
