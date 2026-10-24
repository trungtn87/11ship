# Kịch bản kiểm thử liên thông – ba người phối hợp (khách, quán, shipper)

Dùng khi cần thử **cả hành trình một đơn hàng** với nhiều người cùng lúc. Mỗi kịch bản bên dưới **sắp xếp thao tác của từng người theo thứ tự thời gian**; chi tiết từng bước nhấn nút nằm trong test case có mã tương ứng (file `TESTCASE_11SHIP.csv` hoặc `chi-tiet/…`). Làm kịch bản **sau khi** đã xong các test chuẩn bị ở Ngày 1–2. **Nếu đây là lần đầu bạn chạm vào 11Ship:** làm `SMOKE_TEST_NGUOI_MOI.md` trước (Kịch bản A và C bên dưới chính là phiên bản đầy đủ hơn của hai đơn trong smoke).

> Ba người kiểm thử đứng **cùng khu vực** (thành phố Cao Bằng). Người SHIPPER phải đứng trong **bán kính 3 km quanh Quán Test A**. Nếu chỉ có 1–2 người, xem mục 5.3 "Nếu chỉ có 1 hoặc 2 điện thoại" trong `HUONG_DAN_KIEM_THU_11SHIP.md`.

## 1. Vai trò và cách liên lạc

| Người | Máy | Ứng dụng / tài khoản | Việc chính |
|---|---|---|---|
| **K – Khách** | Điện thoại 1 | 11Food – KH-A | Đặt món, theo dõi, hủy, đánh giá |
| **Q – Chủ quán** | Điện thoại 2 | 11Food (chế độ quản lý quán) – CQ-A | Xác nhận, gọi shipper, hủy, xử lý hàng |
| **S – Shipper** | Điện thoại 3 | 11Ship – SP-A (và SP-B nếu có người thứ tư) | Nhận, lấy, giao |
| **A – Admin** (người thứ tư hoặc Q kiêm) | Máy tính | Web Admin – ADMIN-1 / SYSTEM | Theo dõi, đối chiếu ví, xử lý |

**Quy ước liên lạc (dùng nhóm chat, ví dụ Zalo):**
- Trước mỗi bước, người làm **hô ngắn**: "K gửi đơn", "Q xác nhận", "S nhận đơn".
- Sau mỗi bước, **cả ba nhìn màn hình của mình** và báo "thấy gì" (ví dụ: "K thấy: Quán đang chuẩn bị").
- Có **một người ghi chép** (thư ký): ghi **giờ:phút**, mã đơn, mã giao G-…, số dư ví trước/sau, và dán ảnh vào thư mục chung.
- Hai người **bấm cùng lúc** chỉ khi kịch bản yêu cầu: đếm "1 – 2 – 3 – bấm".
- Gặp lỗi: **dừng**, chụp/quay màn hình, báo lỗi theo `BAO_CAO_LOI_MAU.md`, rồi quyết định đi tiếp hay dừng kịch bản.

**Trước mỗi kịch bản** (5 phút): kiểm tra checklist
- [ ] Quán Test A **đang mở**; có món; CQ-A ở **chế độ quản lý quán**.
- [ ] KH-A đã đăng nhập; **giỏ trống**; có địa chỉ giao đã ghim.
- [ ] SP-A đã đăng nhập, **ví đủ tiền**, **Tắt online** (sẽ bật trong kịch bản); đứng trong 3 km quanh quán.
- [ ] Thư ký ghi **số dư ví SP-A** ban đầu: Tổng (B0) và Khả dụng (A0).
- [ ] Ghi mức phí 3 khung và hoa hồng hiện hành (bảng chuẩn).

---

## 2. Kịch bản A – Khách đặt món, quán trả phí giao, giao thành công
*Test tương ứng: **TC-FLOW-001** (luồng chuẩn), TC-CUS-025, TC-SHOP-021/022, TC-DRV-009/013/014, TC-WAL-011/012.*

| # | K (Điện thoại 1) | Q (Điện thoại 2) | S (Điện thoại 3) | A (Máy tính) | Mọi người cùng kiểm tra |
|---|---|---|---|---|---|
| 1 | Chọn Quán Test A, thêm 2× Bún chả Test + 1× Trà đá Test, xem giỏ | — | Ghi B0, A0 | — | Giỏ: tiền món **95.000đ**, có "Phí giao (dự tính)" |
| 2 | Chọn địa chỉ đã ghim, **Gửi đơn** | — | — | — | K thấy "Đã gửi đơn", trạng thái "Chờ quán xác nhận"; ghi **mã đơn** |
| 3 | — | Mở "Đơn hàng > Đơn món": thấy đơn mới; **Xác nhận đơn** | — | — | Q: "Đang chuẩn bị"; K: "Quán đang chuẩn bị"; K **không còn nút Hủy** |
| 4 | — | **Gọi shipper > Quán trả phí** (KHÔNG có bước "Món đã sẵn sàng") | **Bật online** | — | Q: "Đang tìm shipper", có phí theo bảng |
| 5 | — | — | Đơn hàng > **Có thể nhận**: kiểm tra **không thấy** số điện thoại/địa chỉ chi tiết của khách; **Nhận đơn** | — | S: "Đang thực hiện"; ví S: khả dụng giảm đúng hoa hồng (tạm giữ), tổng vẫn B0; K: "Shipper đang đến quán"; Q: "Shipper đã nhận" |
| 6 | — | — | **Đã nhận hàng** (một bước xác nhận) | — | S chỉ còn nút "Giao thành công" (không có Hủy nhận, không có Giao thất bại); K, Q: "Đang giao" |
| 7 | — | — | **Giao thành công** | Mở Web Admin > Giao hàng, Đơn hàng: đối chiếu trạng thái | K: "Hoàn thành"; Q: đơn "Hoàn thành"; Admin: trạng thái khớp |
| 8 | Mở "Đánh giá và phản ánh" | — | Mở Ví: **tổng = B0 − hoa hồng**, đúng **một** dòng "Hoa hồng" | A: Tài chính > Giao dịch: dòng hoa hồng đúng | Tổng/Khả dụng khớp từng đồng; không còn tiền tạm giữ |

**Kết quả cần ghi:** mã đơn, mã G-…, B0/A0 → B1/A1, giờ từng bước, ảnh bước 5 (thẻ đơn trước khi nhận) và bước 8 (ví).

## 3. Kịch bản B – Khách trả phí giao
*Test tương ứng: **TC-FLOW-002**.* Làm như kịch bản A, **bước 4** chọn **"Khách trả phí"**. Kiểm tra thêm: S thấy "Khách trả ship"; K thấy "Khách trả phí" ở chi tiết đơn; phí không cần ai đồng ý thêm vì đúng bảng giá.

## 4. Kịch bản C – Quán chủ động gọi shipper (không qua 11Food)
*Test tương ứng: **TC-FLOW-003**, TC-FLOW-004, TC-SHOP-031…035, TC-DRV-017.*

| # | Q | S | Mọi người kiểm tra |
|---|---|---|---|
| 1 | Đơn hàng > **Giao hàng** > **Gọi shipper**: nhập người nhận "Người Nhận Test", SĐT-NHẬN, địa chỉ mô tả, hàng "1 hộp bánh Test", giá trị 100000, **Quán trả**, **Theo bảng giá** + một mốc; **Gọi shipper** | Ghi B0, A0; **Bật online** | Q: mã **G-…**, "Đang tìm shipper", ghi chú "phí ước tính theo mốc, không phải quãng đường đo trên bản đồ" |
| 2 | — | Có thể nhận: thẻ đơn **không** lộ số điện thoại/địa chỉ chi tiết; **Nhận đơn** | S thấy thêm dòng "Giao theo địa chỉ mô tả, không cần ghim điểm giao." |
| 3 | Xem yêu cầu giao: thấy shipper, **không có bản đồ theo dõi hành trình** | **Đã nhận hàng** | Q chỉ theo dõi **trạng thái** |
| 4 | — | **Giao thành công** | Q: "Hoàn thành"; ví S đúng B0 − hoa hồng |

Kịch bản C2 (khách trả phí, khách không có tài khoản): làm TC-FLOW-004 – chọn "Khách trả"; kiểm tra "Khách trả ship" ở S.

## 5. Kịch bản D – Không có shipper nhận, ngừng tìm, gọi lại
*Test tương ứng: **TC-FLOW-005**, **TC-FLOW-006**, TC-NOTI-007.*

> Mặc định chờ **30 phút**. Để rút ngắn, kỹ thuật viên giữ tài khoản SYSTEM đổi "Chờ shipper: dừng tìm / cảnh báo (phút)" (TC-ADM-026) **trước khi** gọi shipper và đặt lại sau test (bạn không tự làm bước này).

| # | K | Q | S | Ghi nhận |
|---|---|---|---|---|
| 1 | Gửi đơn | Xác nhận, **Gọi shipper** (S đang **offline**) | Offline | Ghi **giờ bắt đầu** |
| 2 | — | Phút 5 và 15: kiểm tra thông báo nhắc | — | Nhắc đúng mốc, đúng đơn |
| 3 | Theo dõi đơn | Đến mốc ngừng tìm: thấy **"Chưa tìm được shipper"** | Mở "Có thể nhận": không có đơn đã ngừng tìm | K: "Chưa tìm được shipper — quán đang xử lý."; **đơn món KHÔNG bị hủy** |
| 4 | — | **Gọi lại shipper** | **Bật online**, nhận đơn | Q: "Lần gọi shipper thứ 2"; lần 1 còn trong lịch sử |
| 5 | — | — | Lấy hàng, giao thành công | Hoàn thành đúng một lần |

## 6. Kịch bản E – Đề xuất phí: người trả phí đồng ý / từ chối / hết hạn
*Test tương ứng: **TC-FLOW-007…015**.*

**E1 – Quán trả phí, quán ĐỒNG Ý (TC-FLOW-007)**

| # | Q | S | K | Ghi nhận |
|---|---|---|---|---|
| 1 | Xác nhận đơn, Gọi shipper (**Quán trả phí**) | Có thể nhận → **Đề xuất mức phí khác** (+5.000đ so với phí bảng) → Gửi đề xuất | — | S: "đang chờ Quán (người trả phí) trả lời"; shipper khác không nhận được |
| 2 | Thấy thẻ **"Shipper đề xuất đổi phí giao"** → **Đồng ý** | Thẻ đơn hiện phí mới; **Nhận đơn** | K chỉ thấy tiến độ | Phí đơn = mức đã đồng ý ở cả ba bên |
| 3 | — | Lấy hàng → Giao thành công | — | Hoàn thành; hoa hồng một lần |

**E2 – Quán trả phí, quán TỪ CHỐI (TC-FLOW-008):** bước 2 Q bấm **Từ chối** → phí **giữ như cũ**, S **không còn giữ đơn** ("Phí không được đồng ý"), đơn **tiếp tục tìm shipper khác**, **không** tính lại 30 phút, **không** hủy đơn món.

**E3 – Khách trả phí, khách ĐỒNG Ý/TỪ CHỐI trong 11Food (TC-FLOW-009/010):** K mở chi tiết đơn, thấy thẻ **"Shipper muốn lấy phí giao …"** với **Đồng ý/Từ chối**. **Q không có nút trả lời** (TC-FLOW-011).

**E4 – Hết hạn (TC-FLOW-012):** người trả phí không trả lời trong **5 phút** (mặc định) → đề xuất tự hết hạn, giữ phí cũ, S bị gỡ; trả lời muộn bị từ chối.

**E5 – DIRECT, khách trả phí nhưng không có tài khoản (TC-FLOW-014):** Q liên hệ người nhận ngoài ứng dụng, bấm **Đồng ý** = "quán xác nhận thay khách"; hệ thống ghi rõ như vậy.

**E6 – Đề xuất phí sau khi đã nhận đơn (TC-FLOW-015):** S đã nhận, **chưa lấy hàng**, đề xuất phí → trong lúc chờ S **không bấm được "Đã nhận hàng"**; từ chối/hết hạn thì S mất đơn; sau "Đã nhận hàng" phí **khóa**.

## 7. Kịch bản F – Hủy đơn ở các thời điểm khác nhau

| Thời điểm | Ai hủy | Test | Kết quả mong đợi chính |
|---|---|---|---|
| Khách vừa gửi, quán chưa xác nhận | Khách | TC-CUS-036 | Hủy được, có lý do; quán thấy "Đã hủy" |
| Quán đã xác nhận | Khách | TC-CUS-037 | **Không có nút Hủy**; chỉ liên hệ quán |
| Shipper đã nhận, **chưa** lấy hàng | Shipper "Hủy nhận đơn" | TC-DRV-012, TC-FLOW-016 | Đơn vẫn còn, tìm shipper khác; hoa hồng trả lại; **không tính lại 30 phút** |
| Shipper đã nhận, chưa lấy hàng | Quán "Hủy yêu cầu giao" | TC-FLOW-017 | Đơn món còn, có thể gọi lại; shipper được giải phóng |
| Shipper đã nhận, chưa lấy hàng | Quán "Hủy đơn món" | TC-FLOW-018 | Cả đơn món và yêu cầu giao kết thúc; hoa hồng trả lại |
| Shipper **đã lấy hàng** (đơn khách đặt) | **Khách** "Hủy đơn (shipper đã lấy hàng)" | TC-FLOW-019 | Hủy có lý do; **hoa hồng không bị thu**; quán xác nhận hàng đã về; **không** tự thành "Giao thành công" |
| Shipper **đã lấy hàng** (đơn khách đặt) | **Quán** | TC-FLOW-021 | **Không hủy được**; chỉ ghi chú "chỉ khách mới hủy được" |
| Shipper **đã lấy hàng** (quán tự gọi) | **Quán** "Hủy giao (shipper đã lấy hàng)" | TC-FLOW-020 | Hủy được; hàng ở shipper đến khi quán xác nhận; chưa gọi lại được |
| Shipper **đã lấy hàng** | **Shipper** | TC-DRV-015 | **Không có** nút hủy/giao thất bại; chỉ "Giao thành công" |

## 8. Kịch bản G – Hai người bấm cùng lúc (đua)

> Làm mỗi bài **3 lần**, mỗi lần với đơn mới; thư ký ghi kết quả từng lần.

| Bài | Người 1 | Người 2 | Test | Kết quả hợp lệ |
|---|---|---|---|---|
| G1 | S (SP-A) bấm **Nhận đơn** | S' (SP-B) bấm **Nhận đơn** | TC-DRV-010 | **Chỉ một** người nhận được; người kia không bị giữ tiền |
| G2 | Q bấm **Hủy yêu cầu giao** | S bấm **Nhận đơn** | TC-ABN-010 | Một trạng thái cuối nhất quán, không treo tiền |
| G3 | K bấm **Hủy đơn** | Q bấm **Xác nhận đơn** | TC-ABN-011 | Chỉ một thắng; hai bên cùng thấy một trạng thái |

Cần SP-B đã có tiền (sau TC-WAL-008/009) và một điện thoại thứ hai chạy 11Ship (có thể là Điện thoại 1).

## 9. Kịch bản H – Ma trận thông báo (TC-FLOW-023, TC-NOTI-001…007)

Thư ký điền bảng sau. **✓** = phải nhận; **✗** = **không được** nhận; **?** = tài liệu chưa quy định rõ, chỉ **ghi nhận** thực tế và gửi Owner xác nhận. Với mỗi sự kiện, ghi **giờ** và xem chạm thông báo có mở **đúng đơn** không.

| Sự kiện | Khách | Quán | Shipper |
|---|---|---|---|
| Khách gửi đơn | ? | ✓ đơn mới | ✗ |
| Quán xác nhận | ✓ | — | ✗ |
| Quán gọi shipper | ? (không được nhận thông báo dành riêng cho shipper) | — | ✓ "đơn giao hàng mới" (nếu đủ điều kiện, trong 3 km) |
| Shipper nhận đơn | ? | ✓ | — |
| Đề xuất phí (quán trả) | ? tiến độ | ✓ cần trả lời | ✓ kết quả |
| Đề xuất phí (khách trả) | ✓ cần trả lời | ? tiến độ | ✓ kết quả |
| Shipper lấy hàng / giao xong | ✓ | ✓ | — |
| Ngừng tìm shipper | ✓ | ✓ | ✗ |
| Hủy đơn / hủy yêu cầu giao | ✓ (khi liên quan) | ✓ | ✓ nếu đang giữ đơn |
| Đã đăng xuất | ✗ **không nhận gì** (TC-NOTI-005) | | |

## 10. Kịch bản I – Bất thường trong lúc có đơn đang chạy

| Tình huống | Làm | Test | Phải thấy |
|---|---|---|---|
| Mất Internet của K lúc **Gửi đơn** | Bật máy bay ngay sau khi bấm | TC-FLOW-025 | "Chưa biết đơn đã gửi chưa", **Kiểm tra kết quả**, không tạo đơn thứ hai |
| Mất mạng của S lúc **Giao thành công** | Bật máy bay | TC-ABN-002 | Không trừ hoa hồng hai lần; trạng thái đúng sau khi có mạng |
| Tắt hẳn 11Ship của S khi đang giao | Vuốt tắt app | TC-ABN-004 | Đơn còn; vị trí vẫn cập nhật (nếu điện thoại cho phép) |
| Tắt GPS của S khi đang giữ đơn | Tắt Vị trí | TC-ABN-006 | Hướng dẫn "GPS đang tắt…"; quán thấy vị trí **cũ/mất kết nối**, không thấy vị trí giả |
| Khởi động lại điện thoại S | Tắt/bật máy | TC-ABN-005 | Vẫn đăng nhập; đơn còn; hướng dẫn bật lại vị trí |
| Bấm một nút 5 lần liên tiếp | "Gọi shipper", "Nhận đơn", "Đã nhận hàng", "Giao thành công" | TC-FLOW-024, TC-ABN-013 | Chỉ tác dụng **một lần**; đúng **một** dòng hoa hồng |
| Đăng xuất rồi đăng nhập lại khi đơn đang giao | Cả ba bên | TC-ACC-026 | Đơn không mất, trạng thái nguyên vẹn |

## 11. Sau mỗi kịch bản: đối chiếu cuối

1. **Ví SP-A:** Tổng/Khả dụng sau = trước ± hoa hồng đúng số đơn hoàn thành (TC-WAL-012).
2. **Web Admin:** Đơn hàng, Giao hàng: trạng thái và phí khớp với ba màn hình điện thoại.
3. **Không còn "tiền tạm giữ" treo** của đơn đã kết thúc.
4. **Không có đơn/yêu cầu giao trùng** (đếm lại).
5. Ghi **kết quả cuối** vào CSV cho từng test; lỗi → `BAO_CAO_LOI_MAU.md`.
