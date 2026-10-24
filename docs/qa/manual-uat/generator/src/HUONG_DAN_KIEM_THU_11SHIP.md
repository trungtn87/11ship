# Hướng dẫn kiểm thử 11Ship từ con số 0

> Dành cho người **chưa từng nghe về 11Ship**, không biết lập trình, chỉ biết dùng điện thoại Android và trình duyệt web.
> Tài liệu này đối chiếu với mã nguồn nhánh `main` tại commit `{{COMMIT_SHORT}}` (24/10/2026). Nếu bản bạn được giao thử mới hơn, hãy hỏi Người phụ trách xem có thay đổi gì không.

## 0. Bộ tài liệu này gồm những gì và đọc theo thứ tự nào

| Thứ tự | File | Dùng để làm gì |
|---|---|---|
| 1 | `HUONG_DAN_KIEM_THU_11SHIP.md` (file này) | Hiểu hệ thống, chuẩn bị máy, tài khoản, dữ liệu, cách ghi kết quả |
| 2 | `SMOKE_TEST_NGUOI_MOI.md` | **Chạy thử lần đầu** ({{SMOKE_COUNT}} test, 3–4 giờ): đăng ký → đặt đơn → giao thành công → số dư ví → thông báo. Làm trước khi vào 5 ngày đầy đủ |
| 3 | `KICH_BAN_TEST_LIEN_THONG.md` | Hướng dẫn **ba người** (khách, quán, shipper) phối hợp thử cả hành trình đơn hàng |
| 4 | `DANH_SACH_P0.md` | Danh sách {{P0}} test **bắt buộc** (P0) để nghiệm thu |
| 5 | `TESTCASE_11SHIP.csv` | **Toàn bộ {{TOTAL}} test case** (mở bằng Excel) và nơi ghi kết quả |
| 6 | `chi-tiet/NGAY_1…NGAY_5` | Bản đọc dễ hơn của từng test case, chia theo 5 ngày làm việc (mỗi file có bảng thuật ngữ ở đầu) |
| 7 | `BAO_CAO_LOI_MAU.md` | Mẫu báo lỗi và cách điền |
| 8 | `CHECKLIST_NGHIEM_THU.md` | Bảng đánh dấu kết quả, điều kiện chấp nhận phiên bản, **cổng chặn thử nghiệm bên ngoài** và **câu hỏi cần Owner quyết định** |
| 9 | `DOI_CHIEU_CODE_TESTCASE.md` | Chức năng thật trong code ↔ test case, và những phần chưa xác minh được |

Bạn **không cần** đọc code, mở terminal, chạy lệnh SQL hay xem log. Mọi việc đều làm bằng điện thoại và trình duyệt.

---

## 1. 11Ship là gì? (giải thích như kể chuyện)

### 1.1 Ba phần của hệ thống

11Ship là hệ thống **đặt món ăn và giao hàng** cho địa phương (hiện cấu hình cho khu vực **thành phố Cao Bằng**). Hệ thống có ba phần:

| Phần | Là gì | Ai dùng | Dùng ở đâu |
|---|---|---|---|
| **11Food** | Ứng dụng Android để **đặt món** và để **chủ quán quản lý quán** (cùng một ứng dụng, tự chuyển chế độ) | Khách hàng, chủ quán | Điện thoại Android |
| **11Ship** | Ứng dụng Android để **nhận đơn, lấy hàng và giao hàng** | Shipper (người giao hàng) | Điện thoại Android |
| **Web Admin** | Trang web quản trị để duyệt/quản lý quán, shipper, đơn, tiền, cấu hình | Quản trị viên (ADMIN, SYSTEM) | Trình duyệt trên máy tính |

Cả ba nói chuyện với một **máy chủ** (một máy tính đặt ở xa, luôn bật) để lưu dữ liệu. Vì vậy điện thoại **phải có Internet**.

### 1.2 Ai là ai

| Vai trò | Nói đơn giản | Ví dụ việc làm |
|---|---|---|
| **Khách hàng** | Người đặt món | Tìm quán, bỏ món vào giỏ, gửi đơn, hủy đơn, đánh giá |
| **Chủ quán** | Người bán món | Tạo hồ sơ quán, đặt giờ mở cửa, thêm món, xác nhận đơn, gọi shipper |
| **Shipper** | Người giao hàng | Bật "online", nhận đơn, lấy hàng ở quán, giao cho người nhận |
| **ADMIN** | Quản trị viên **có quyền giới hạn** (SYSTEM cấp từng quyền) | Xem/khóa tài khoản, vô hiệu hóa quán, xử lý đơn, xử lý khiếu nại, xác nhận nạp tiền |
| **SYSTEM** | Quản trị viên **cao nhất**: mời ADMIN, cấp quyền, đổi cấu hình, bảng phí, hoa hồng, sao lưu | Chỉ rất ít người có; **tài khoản do kỹ thuật viên tạo** |
| **"hệ thống tự động"** | Không phải người: các việc máy tự làm (nhắc việc, tự hủy đơn quá hạn…) | Trong màn hình có thể ghi "Hệ thống hủy quá hạn"; trong nhật ký ghi người thực hiện là SYSTEM (do máy chủ tự làm, không phải một người) |

> Một số điện thoại có thể vừa là khách vừa là chủ quán (cùng một tài khoản, bấm đổi chế độ). Shipper đăng ký bằng 11Ship cũng đồng thời có vai trò khách.

### 1.3 Một đơn giao hàng hoạt động ra sao

Có **hai luồng** (trong tài liệu gọi là ORDER và DIRECT):

**Luồng 1 – Khách đặt món qua 11Food (ORDER)**

```
Khách chọn món → gửi đơn → Quán XÁC NHẬN (hoặc từ chối) → Quán bấm "Gọi shipper"
→ Shipper thấy đơn, bấm "Nhận đơn" → đến quán, bấm "Đã nhận hàng" → giao cho khách, bấm "Giao thành công"
→ Đơn hoàn thành → khách đánh giá
```

**Luồng 2 – Quán tự gọi shipper (DIRECT)** (không cần khách dùng 11Food)

```
Quán bấm "Giao hàng" → "Gọi shipper" → nhập tên, số điện thoại, địa chỉ mô tả của người nhận
→ chọn mốc phí → Shipper nhận → lấy hàng → giao → "Giao thành công"
```

Những điều cần nhớ (Owner đã quyết định ngày 23–24/10/2026):

- **"Nhận đơn"** = shipper nhận *việc* (chưa cầm hàng). **"Đã nhận hàng"** = đã cầm hàng ở quán. **"Giao thành công"** = đã giao xong.
- **Không còn bước "Món đã sẵn sàng"**: khi quán bấm "Gọi shipper" thì coi như món đã chuẩn bị xong.
- **Trước khi lấy hàng**, shipper được "Hủy nhận đơn" (đơn vẫn còn, tìm shipper khác). **Sau khi lấy hàng**, shipper **không** được hủy và **không** có nút "Giao thất bại"; nếu không giao được thì gọi cho quán để thống nhất. Người **tạo đơn** (khách với đơn ORDER; quán với đơn DIRECT) mới được hủy.
- **Phí giao** tính theo **bảng phí 3 khung** do SYSTEM đặt. Shipper có thể **đề xuất mức phí khác**; **người trả phí** (khách hoặc quán) đồng ý hay từ chối. Từ chối thì giữ phí cũ và tìm shipper khác (đơn không bị hủy).
- Hệ thống tìm shipper trong bán kính **3 km** quanh quán, tối đa **30 phút**; sau đó "ngừng tìm" và quán chọn gọi lại hay hủy.
- **Tiền món và phí giao do các bên trả trực tiếp cho nhau** ("Thanh toán trực tiếp"), ứng dụng **không** thu tiền món. Ứng dụng chỉ quản lý **ví của shipper** (xem 1.4).

### 1.4 Ví shipper – nói nôm na

- Mỗi shipper có **ví** trong 11Ship. Shipper **nạp tiền** vào ví (chuyển khoản vào tài khoản của hệ thống, rồi Admin kiểm tra sao kê và "ghi nhận").
- Mỗi đơn **thành công**, hệ thống thu một khoản **hoa hồng** nhỏ (mặc định **1.000đ/đơn**, SYSTEM chỉnh được) trừ vào ví.
- Khi shipper **nhận đơn**, số tiền hoa hồng được **tạm giữ** (không trừ ngay). Hủy thì trả lại; giao xong thì mới trừ thật. Vì thế có ba con số: **Tổng số dư**, **Tiền tạm giữ**, **Số dư khả dụng** (= Tổng − Tạm giữ).
- Ví không đủ tiền thì **không nhận đơn**. Shipper mới phải có **một lần nạp được Admin xác nhận đạt mức tối thiểu** (mặc định 100.000đ) mới được nhận đơn.
- **Đối soát** = so sánh số trên ví với các dòng giao dịch xem có khớp từng đồng không.

### 1.5 Từ điển nhanh

| Từ | Nghĩa |
|---|---|
| **APK** | File cài ứng dụng Android (đuôi `.apk`) |
| **OTP** | Mã **6 số** gửi qua tin nhắn SMS để chứng minh số điện thoại là của bạn. Dùng một lần, hết hạn nhanh. **Không bao giờ ghi OTP vào tài liệu hay báo cáo.** |
| **Authenticator** | Ứng dụng trên điện thoại (Google Authenticator…) tạo mã 6 số đổi liên tục, dùng để đăng nhập Web Admin |
| **GPS / Vị trí** | Vị trí của điện thoại; ứng dụng cần để biết quán/shipper ở đâu |
| **Khu vực phục vụ** | Vòng tròn quanh trung tâm TP Cao Bằng (bán kính khoảng 10 km). Ngoài vòng này không đặt/giao được |
| **Đơn món** (Order) | Đơn khách đặt món, có mã dạng "Đơn …" |
| **Yêu cầu giao** (Delivery) | Việc nhờ shipper giao, có mã dạng **G-…**; một đơn món có thể có nhiều lần gọi shipper |
| **Phiên đăng nhập** | Thời gian bạn đang "đăng nhập". Mỗi tài khoản chỉ có **một** phiên: đăng nhập ở nơi khác (kể cả đăng nhập cùng tài khoản ở 11Food rồi 11Ship) sẽ làm nơi cũ bị đăng xuất |
| **Smoke test** | Bộ test ngắn chạy lần đầu để biết "đường chính" có thông không; khác với nghiệm thu đầy đủ |
| **Idempotency / bấm lặp** | Bấm nhiều lần cũng chỉ tác dụng một lần (hệ thống có cơ chế chống trùng) |
| **ORDER / DIRECT** | Hai luồng đã nói ở 1.3 (xuất hiện trong tài liệu kỹ thuật) |
| **CI xanh** | Máy tự chạy kiểm thử và báo "đạt". **Không** đồng nghĩa phần mềm đã đạt nghiệm thu (xem mục 9) |
| **VND / đ** | Đồng Việt Nam; luôn là số nguyên, không có xu |

### 1.6 Cách nhận biết ứng dụng "đúng" và "lỗi"

**Dấu hiệu bình thường**
- Mở ứng dụng, **không có thanh cảnh báo màu cam/đỏ** ở trên cùng (khi máy chủ ổn thì thanh này **ẩn**).
- Bấm nút thì có phản hồi trong vài giây; thông báo lỗi luôn bằng **tiếng Việt dễ hiểu**.
- Tiền luôn là **số nguyên đồng**, có dấu chấm ngăn cách (ví dụ 45.000đ).

**Dấu hiệu lỗi (hãy ghi lại)**
- Ứng dụng đóng đột ngột, treo, màn hình trắng.
- Chữ tiếng Anh/viết hoa liền nhau lộ ra (ví dụ `FEE_LOCKED`) hoặc dãy ký tự dài giống mã (UUID) hiện cho người dùng.
- Số tiền **không khớp** (đơn, ví, tổng).
- **Hai** đơn / hai yêu cầu giao / hai dòng hoa hồng cho một thao tác.
- Người này thấy thông tin của người kia; thông báo gửi nhầm người hoặc mở sai đơn.
- Nút cho bấm nhưng không có gì xảy ra mà không có giải thích.

**Dấu hiệu "chưa làm" – KHÔNG phải lỗi, nhưng phải ghi** (xem `DOI_CHIEU_CODE_TESTCASE.md`): nhãn **"Sắp có"**, **"Chưa nối"**, **"Chưa xác định phí"**, "—" (nghĩa là chưa biết, **không phải** 0 đồng).

---

## 2. Kết quả của một test: PASS, FAIL, BLOCKED, NOT RUN, NOT READY

| Trạng thái | Khi nào dùng | Bạn phải làm gì thêm |
|---|---|---|
| **NOT RUN** | Chưa làm (mặc định) | — |
| **PASS** | Làm đủ **mọi bước**, kết quả **khớp từng dòng** "Kết quả mong đợi" | Điền ngày, người kiểm thử, phiên bản APK |
| **FAIL** | Có **ít nhất một bước** khác kết quả mong đợi (kể cả sai chữ quan trọng, sai tiền) | Chụp/quay màn hình, **lập báo lỗi** (`BAO_CAO_LOI_MAU.md`), ghi mã lỗi vào cột "Mã lỗi liên quan" |
| **BLOCKED** | **Không làm tiếp được** vì thiếu điều kiện bên ngoài (chưa có tài khoản, SMS không gửi, chưa có tiền thử nghiệm, thiếu máy…) | Ghi rõ thiếu gì, báo Người phụ trách. Đừng tự bịa dữ liệu để cho "PASS" |
| **NOT READY** | **Chức năng chưa có** trong ứng dụng (đã được xác nhận từ code hoặc bạn thấy nhãn "Sắp có") | Chụp màn hình bằng chứng. Test vẫn được giữ để Owner quyết định |

Thêm hai cột **chỉ để định hướng**, do người soạn đặt trước:

- **Tình trạng sẵn sàng**: `SẴN SÀNG` (bạn tự làm được sau khi xong các test phụ thuộc và có đủ "điều kiện hệ thống" ở mục 5) · `CẦN CHUẨN BỊ TRƯỚC` (kỹ thuật viên/Owner phải chuẩn bị xong TRƯỚC, rồi bạn tự làm một mình) · `CẦN KỸ THUẬT VIÊN LÀM CÙNG` (có bước chỉ kỹ thuật viên/SYSTEM làm được) · `CHỈ KỸ THUẬT VIÊN` (đối chiếu kiểm thử tự động; bạn bỏ qua) · `CẦN XÁC MINH` (code và tài liệu chưa khớp hoặc chưa chắc, cần Owner/kỹ thuật viên trả lời) · `NOT READY`.
- **Loại kiểm thử**: `Thủ công` · `Chuẩn bị trước, người mới tự làm` · `Cần kỹ thuật viên cùng làm` · `Tự động đã có (đối chiếu)`.

**Với test cần hỗ trợ kỹ thuật, ba cột sau cho bạn biết chính xác phải làm gì (để không bị kẹt giữa chừng):**

1. **Việc cần chuẩn bị trước (ai chuẩn bị)** – danh sách việc kỹ thuật viên/Owner phải xong trước giờ test. Trước khi bắt đầu test, hỏi: "phần chuẩn bị của test này xong chưa?".
2. **Phân công khi đang test** – bước nào do kỹ thuật viên/SYSTEM làm (trong bước ghi sẵn `[KỸ THUẬT VIÊN/SYSTEM làm, bạn quan sát và chụp màn hình]`), bước nào do bạn làm. Bạn **không bao giờ** được biết mật khẩu SYSTEM.
3. **Nếu thiếu điều kiện / kỹ thuật viên chưa sẵn sàng** – luôn là: ghi **BLOCKED**, ghi điều kiện còn thiếu, báo Người phụ trách rồi làm test kế tiếp. Đừng tự làm thay phần của kỹ thuật viên và đừng đứng đợi.

**Quy tắc vàng:** nghi ngờ thì **ghi lại và hỏi**, đừng đoán. Không tự sửa kết quả mong đợi cho khớp.

---

## 3. Cách chụp ảnh, quay màn hình và đặt tên file

**Trên điện thoại Android**
- **Chụp ảnh:** nhấn đồng thời **nút nguồn + nút giảm âm lượng** (khoảng 1 giây). Ảnh nằm trong Thư viện/Ảnh > Ảnh chụp màn hình.
- **Quay màn hình:** kéo thanh thông báo xuống 2 lần, chọn **"Quay màn hình"** (hoặc "Screen recorder"), bấm bắt đầu; thao tác xong bấm dừng. Nên quay **từ lúc bắt đầu thao tác** đến khi lỗi xuất hiện.
- Ảnh/video phải thấy **toàn màn hình**, kể cả **giờ** ở thanh trên cùng.

**Trên máy tính (Web Admin):** bấm **Windows + Shift + S** (chọn vùng) hoặc phím **PrtScn**; quay màn hình dùng **Windows + Alt + R** (Xbox Game Bar).

**Che thông tin nhạy cảm trước khi gửi:** mật khẩu, mã OTP, mã Authenticator, số tài khoản ngân hàng đầy đủ. Dùng công cụ "Chỉnh sửa" của điện thoại để khoanh/xóa vùng.

**Đặt tên file (để người sửa lỗi tìm được):** `NGÀY_MÃTEST_BƯỚC_MÔTẢ`, ví dụ `20261026_TC-FLOW-001_B13_phi-sai.png` hoặc `.mp4`. Lưu vào thư mục chung do Người phụ trách chỉ định (ví dụ Google Drive) và dán **đường dẫn** vào cột "Đường dẫn ảnh/video bằng chứng".

---

## 4. Cách báo một lỗi để lập trình viên sửa được

Mỗi lỗi **một báo cáo**, dùng mẫu trong `BAO_CAO_LOI_MAU.md`. Tóm tắt 8 thứ bắt buộc:

1. **Mã test** và **số bước** bị lỗi.
2. **Phiên bản APK / bản triển khai** (cách xem ở mục 5.4).
3. **Thiết bị** (hãng, model, đời Android) và tài khoản dùng (KH-A, SP-A… — **không ghi mật khẩu**).
4. **Các bước tái hiện** (làm lại được ít nhất một lần).
5. **Kết quả thực tế** và **kết quả mong đợi**.
6. **Ảnh/video** (thấy giờ).
7. **Mã đơn / mã G-…** liên quan, thời điểm xảy ra (giờ:phút).
8. **Mức nghiêm trọng** (xem bảng trong mẫu báo lỗi). **Lỗi liên quan tiền, số dư, giao nhầm/mất đơn, sai quyền, giao dịch lặp luôn là NGHIÊM TRỌNG.**

---

## 5. Chuẩn bị trước khi bắt đầu

### 5.1 Việc Người phụ trách/kỹ thuật viên phải cung cấp (người kiểm thử KHÔNG tự tìm, KHÔNG tự bịa)

| # | Cần có | Ai cung cấp | Nếu chưa có thì |
|---|---|---|---|
| 1 | File APK **11Food** và **11Ship** (tên dạng `11Food-vX.Y.Z.apk`, `11Ship-vX.Y.Z.apk`), kèm số phiên bản và mã commit | Người phụ trách (lấy từ lần chạy "Mobile APK" hoặc bản phát hành) | BLOCKED toàn bộ |
| 2 | **Địa chỉ Web Admin**. Theo cấu hình hiện tại của dự án (`config/endpoints.json`) là `https://103.9.78.67.sslip.io`; **phải được Người phụ trách xác nhận** còn đúng | Người phụ trách | BLOCKED nhóm Web Admin |
| 3 | Tài khoản **SYSTEM** (số điện thoại + mật khẩu + Authenticator đã cài sẵn) | **Kỹ thuật viên** tạo (người kiểm thử mới không tự tạo được) | BLOCKED các test cần SYSTEM; không thể mời ADMIN |
| 4 | **Số điện thoại thật nhận được SMS** cho các tài khoản: KH-A, KH-B, CQ-A, CQ-B, CQ-C, SP-A, SP-B, ADMIN-1, ADMIN-2 (tối thiểu 7–9 số, mỗi số một tài khoản). Nếu hệ thống đang giới hạn danh sách số được nhận SMS, kỹ thuật viên phải **thêm trước** các số này | Người phụ trách + kỹ thuật viên | BLOCKED đăng ký/OTP |
| 5 | **Máy SMS Gateway** (điện thoại gửi OTP) đang bật và được ghép cặp | Kỹ thuật viên | Đăng ký/quên mật khẩu sẽ báo lỗi trung thực → BLOCKED |
| 6 | **Bảng phí giao hàng** đã được SYSTEM áp dụng (3 khung, mức phí thật do Owner chốt) | Người phụ trách (SYSTEM) | Mọi phí hiện "Chưa xác định phí"; các test phí chỉ làm được nhánh đề xuất phí |
| 7 | **Dịch vụ tính quãng đường (tuyến)** đã cấu hình | Kỹ thuật viên | Phí đơn ORDER hiện "Chưa xác định phí" → quán phải đề xuất phí |
| 8 | **Quy định tiền thử nghiệm** bằng văn bản của Owner (mục 7) và ít nhất một **tài khoản nhận tiền thử nghiệm** do SYSTEM bật | Owner / SYSTEM | BLOCKED nhóm Ví có ghi nhận tiền |
| 9 | Ít nhất **1 điện thoại thứ hai có thể cài 11Ship** (hoặc dùng chung, xem 5.3) và **máy tính** có trình duyệt hiện đại | Người kiểm thử / Người phụ trách | Xem 5.3 |
| 10 | **Nơi lưu bằng chứng** (thư mục chia sẻ) và **bảng thông tin riêng** (mục 6.4) | Người phụ trách | — |
| 11 | (Tùy chọn) Thông báo đẩy (Firebase) đã bật; bản đồ offline Cao Bằng có trong APK | Kỹ thuật viên | Test push/bản đồ ghi CẦN XÁC MINH/BLOCKED |
| 12 | Điều khoản và chính sách quyền riêng tư đã được Owner duyệt (hiện tài liệu ghi "chờ Owner duyệt") | Owner | Test TC-ACC-029 ghi CẦN XÁC MINH |

### 5.2 Yêu cầu về thiết bị và địa điểm

- **Điện thoại Android 8.0 trở lên** (không phải iPhone). Nên dùng điện thoại **nguyên bản, bình thường** (không tự root, không tự mở khóa bootloader – việc này không cần thiết). Từ quyết định của Owner ngày 23/10 (PR #170), 11Food/11Ship bản mới đăng ký và đăng nhập bằng **số điện thoại + mật khẩu** và **không** còn chặn điện thoại vì lý do "xác thực phần cứng"; nếu bạn thấy chữ `DEVICE_PROOF_UNSUPPORTED` hoặc "chưa hỗ trợ xác thực phần cứng", rất có thể bạn đang cài **nhầm bản APK cũ** – hãy ghi lại và báo Người phụ trách (xem TC-SET-011).
- Có **GPS**, có **Internet** (Wi-Fi hoặc 4G), pin đủ (shipper bật vị trí rất tốn pin).
- Giờ điện thoại **đúng** (bật "Ngày và giờ tự động").
- **Địa điểm:** cả ba điện thoại phải ở **trong khu vực phục vụ** (khoảng 10 km quanh trung tâm TP Cao Bằng) và **điện thoại shipper phải trong bán kính 3 km quanh "Quán Test A"** khi thử nhận đơn. **Không dùng ứng dụng giả vị trí** (ứng dụng từ chối vị trí giả).
- Một **máy tính** có Chrome/Edge/Firefox bản mới cho Web Admin, và điện thoại có **Google Authenticator** (hoặc Microsoft Authenticator).

### 5.3 Nếu chỉ có 1 hoặc 2 điện thoại

Ưu tiên lý tưởng: **3 điện thoại** (Máy KHÁCH, Máy QUÁN, Máy SHIPPER) + **1 máy tính**. Cột "Số điện thoại tối thiểu" của mỗi test cho biết cần bao nhiêu máy.

| Bạn có | Cách làm thay thế | Test nào KHÔNG kiểm đúng được |
|---|---|---|
| **2 điện thoại** | Máy 1: 11Food, đăng nhập luân phiên **CQ-A** (quán) và **KH-A** (khách) bằng đăng xuất/đăng nhập. Máy 2: 11Ship (SP-A). Hoặc Máy 1: 11Food (KH) + 11Ship (SP) cùng máy; Máy 2: 11Food (CQ). Hai ứng dụng cài chung một máy được. | Thông báo/nhận đơn **đồng thời** của khách và quán (phải đăng nhập lần lượt); test đua tay hai người (TC-ABN-010/011); test hai shipper (TC-DRV-010, TC-FLOW-016); test thông báo màn hình khóa nhiều máy |
| **1 điện thoại** | Cài **cả hai ứng dụng** trên một máy; đổi vai bằng đăng xuất/đăng nhập (11Food: KH-A ⇄ CQ-A; 11Ship: SP-A). Mọi thao tác theo thứ tự rồi chuyển ứng dụng. | Mọi test cần ≥2 máy: đăng nhập thiết bị thứ hai (TC-ACC-025), phiên bị thu hồi từ máy khác, thông báo giữa các bên theo thời gian thực, vị trí shipper khi quán xem, tắt màn hình/ chạy nền **trong lúc** bên khác thao tác |
| **Không có máy tính** | Dùng trình duyệt trên điện thoại cho Web Admin (giao diện thu gọn). | Một số bảng rộng khó xem; khó cho nhóm Tài chính |

Khi dùng phương án thay thế: **ghi vào cột "Ghi chú kết quả"** "đã dùng 1/2 điện thoại" và đánh dấu test không kiểm đúng được là **BLOCKED** (không phải PASS).

### 5.4 Cài ứng dụng, mở Web Admin và xem số phiên bản

**Cài APK** (chi tiết ở TC-SET-001/002): chép file APK vào điện thoại → mở "Tệp" > "Tải xuống" → chạm file → cho phép "cài từ nguồn này" nếu hỏi → "Cài đặt" → "Mở". Nếu Google Play Protect cảnh báo, chỉ chọn "Vẫn cài đặt" khi file do Người phụ trách gửi.

**Cập nhật bản mới:** cài **đè** file APK mới lên (không gỡ ứng dụng cũ) – dữ liệu và đăng nhập được giữ (TC-SET-007/008).

**Mở Web Admin:** gõ địa chỉ (mục 5.1) vào trình duyệt → trang "Đăng nhập quản trị" → nhập số điện thoại, mật khẩu → "Tiếp tục" → nhập **mã 6 số** từ Authenticator → vào trang chủ ("Đăng nhập thành công", "Vai trò: …").

**Xem số phiên bản (để ghi vào báo cáo):** hiện **không có màn hình trong ứng dụng** cho phiên bản (đã kiểm tra mã nguồn – xem TC-SET-006). Dùng: **Cài đặt Android > Ứng dụng > 11Food (hoặc 11Ship) > cuối trang: "Phiên bản"** (hoặc nhấn giữ biểu tượng ứng dụng rồi chạm "Thông tin ứng dụng"; tên mục có thể khác chút theo hãng máy), và đối chiếu với tên file APK được giao. Với Web Admin, Người phụ trách cho biết phiên bản đang chạy trên máy chủ.

**Ghi mã commit/phiên bản đang thử** vào mọi dòng kết quả ở cột "Phiên bản APK hoặc bản triển khai", ví dụ `11Food v1.0.12 / 11Ship v1.0.12 / máy chủ v1.0.12`.

### 5.5 Đăng nhập, đăng xuất, mật khẩu

- Đăng nhập: tab **Tài khoản** → **Đăng nhập** → số điện thoại + mật khẩu → **Đăng nhập**.
- Đăng xuất: tab **Tài khoản** → kéo xuống → **Đăng xuất** → xác nhận.
- Mỗi tài khoản chỉ có **một phiên đăng nhập**: đăng nhập tài khoản đó ở máy/ứng dụng khác thì nơi cũ bị đăng xuất (đó là hành vi đúng, xem TC-ACC-025). Vì vậy dùng **tài khoản khác nhau** cho 11Food và 11Ship khi muốn cả hai cùng đăng nhập (ví dụ KH-A ở 11Food, SP-A ở 11Ship).
- Mật khẩu từ **8 đến 128 ký tự**. **Không bao giờ** ghi mật khẩu, OTP, mã Authenticator vào tài liệu này hay vào báo lỗi. Mỗi người giữ một **bảng thông tin riêng** (mục 6.4) ngoài kho mã nguồn.

---

## 6. Bộ dữ liệu và tài khoản thử nghiệm

### 6.1 Danh sách tài khoản (tên viết tắt dùng xuyên suốt)

| Mã | Dùng ở | Là ai | Cách có tài khoản | Ghi chú |
|---|---|---|---|---|
| **KH-A** | 11Food (Máy KHÁCH) | Khách hàng A "Khách Test A" | TC-ACC-001 | Khách chính |
| **KH-B** | 11Food | Khách hàng B "Khách Test B" | TC-ACC-002 | Thử riêng tư, đặt hộ |
| **CQ-A** | 11Food (Máy QUÁN) | Chủ quán A "Chủ quán Test A" → **Quán Test A** | TC-ACC-003 + TC-SHOP-001 | Quán **đang mở** |
| **CQ-B** | 11Food | Chủ quán B → **Quán Test B** | TC-SHOP-011 | Quán **ngoài giờ hoạt động** |
| **CQ-C** | 11Food | Chủ quán C → **Quán Test C** | TC-SHOP-002 | Quán **chưa đủ điều kiện** (không hoàn tất hồ sơ) |
| **SP-A** | 11Ship (Máy SHIPPER) | Shipper A "Shipper Test A" | TC-ACC-004 | Ví **đủ tiền** (sau TC-WAL-005) |
| **SP-B** | 11Ship | Shipper B "Shipper Test B" | TC-ACC-005 | Ví **không đủ tiền** (cho đến khi nạp ở TC-WAL-008) |
| **ADMIN-1** | Web Admin | Quản trị viên "Admin Test 1" quyền rộng vừa phải | SYSTEM mời: TC-ADM-004/005 | Quyền: Quán/Shipper (xem, khóa, quản lý hoạt động quán), nhóm món, xem+xác nhận nạp tiền |
| **ADMIN-2** | Web Admin | "Admin Test 2" **chỉ xem Quán** | TC-ADM-006 | Thử phân quyền |
| **SYSTEM** | Web Admin | Quản trị cao nhất | **Kỹ thuật viên tạo** | Không tự tạo được |

> Mỗi số điện thoại **chỉ đăng ký được một tài khoản** trong mỗi phạm vi (ứng dụng / Web Admin). Cần đủ số SIM thật (mục 5.1 #4). Nếu thiếu số, test liên quan ghi BLOCKED.

### 6.2 Quán, món, địa chỉ thử nghiệm

**Ba quán** (tạo bằng giao diện):

| Quán | Chủ | Trạng thái cần có | Cách dựng bằng giao diện |
|---|---|---|---|
| **Quán Test A – đang mở** | CQ-A | Hồ sơ đầy đủ + ghim vị trí, giờ **cả tuần 00:00–24:00**, có 3 món hiện + 1 món ẩn | TC-SHOP-001 → 009 → 012 → 015 |
| **Quán Test B – ngoài giờ** | CQ-B | Hồ sơ đầy đủ; giờ mở **không chứa giờ hiện tại** (ví dụ 03:00–04:00); có "Món B Test" | TC-SHOP-011 → 037 |
| **Quán Test C – chưa đủ điều kiện** | CQ-C | Hồ sơ **thiếu địa chỉ hoặc vị trí ghim** → "Hoàn tất hồ sơ" bị chặn ngay trên máy; quán **chưa lên máy chủ**, khách và Admin **không** thấy | TC-SHOP-002 |

**Nhóm món** (Admin tạo trước, TC-ADM-020): **"Món chính"**, **"Đồ uống"**.

**Món của Quán Test A:**

| Món | Giá | Nhóm | Trạng thái |
|---|---|---|---|
| Bún chả Test | 45.000đ | Món chính | Hiện |
| Nem rán Test | 30.000đ | Món chính | Hiện |
| Trà đá Test | 5.000đ | Đồ uống | Hiện |
| Món ẩn Test | 20.000đ | Món chính | **Ẩn** (sau TC-SHOP-015) |

**Món của Quán Test B:** "Món B Test" 25.000đ.

**Đơn mẫu:** 2 phần **Bún chả Test** + 1 phần **Trà đá Test** = tiền món **95.000đ** (cộng thêm phí giao theo bảng phí).

**Địa chỉ giao thử nghiệm** (đặt cho đúng chỗ bạn đứng trong khu vực phục vụ; các chữ "Test" để dễ nhận):

| Tên | Nội dung | Ghim |
|---|---|---|
| Địa chỉ nhà KH-A | "Số 10 đường Test, tổ 1, phường Test, thành phố Cao Bằng"; người nhận "Khách Test A" + SĐT-KH-A; ghi chú shipper "Gọi khi tới cổng" | **Có** (dùng "Vị trí hiện tại") |
| Địa chỉ cơ quan KH-A | "Số 5 đường Test, phường Test" | Không (dùng để thử "Chưa xác định phí") |
| Địa chỉ giao DIRECT | "Số 20 đường Test, tổ 5, phường Test - cạnh cửa hàng tạp hóa" (mô tả, **không cần ghim**) | Không |

**Người nhận thử (DIRECT):** tên "Người Nhận Test", số điện thoại **SĐT-NHẬN** = số thật của một người trong nhóm test (10 số, bắt đầu bằng 0) vì shipper sẽ gọi số này.

### 6.3 Chuẩn bị từng trường hợp bằng giao diện (đối chiếu yêu cầu của đề bài)

| Trường hợp cần có | Cách chuẩn bị (người thường làm được) | Test |
|---|---|---|
| Khách A, khách B | Đăng ký trong 11Food, chọn "Khách hàng" | TC-ACC-001/002 |
| Chủ quán A, B | Đăng ký trong 11Food, chọn "Chủ quán", tạo hồ sơ quán, ghim vị trí | TC-ACC-003, TC-SHOP-001/011 |
| Quán **đang mở** | Cài giờ "Cả tuần 00:00–24:00" | TC-SHOP-009 |
| Quán **ngoài giờ** | Cài giờ mở chỉ một khoảng hẹp xa giờ hiện tại | TC-SHOP-011 |
| Quán **chưa đủ điều kiện kích hoạt** | Tạo hồ sơ nhưng **không ghim vị trí / thiếu thông tin** → "Hoàn tất hồ sơ" bị chặn (ứng dụng không lưu hồ sơ nháp lên máy chủ). Một dạng "không đủ điều kiện" khác: quán bị Admin vô hiệu hóa (TC-ADM-016) hoặc chưa cài giờ mở (TC-SHOP-008) | TC-SHOP-002, TC-ADM-016, TC-SHOP-008 |
| Shipper A, B | Đăng ký trong 11Ship | TC-ACC-004/005 |
| Shipper **đủ tiền** | Tạo yêu cầu nạp (mức tối thiểu) rồi **Admin ghi nhận** bằng **tiền thử nghiệm** | TC-WAL-003/004/005 |
| Shipper **không đủ tiền** | Shipper mới, chưa nạp (hoặc nạp chưa được xác nhận) | TC-DRV-003, TC-WAL-010 |
| ADMIN | **SYSTEM** mời ADMIN-1/ADMIN-2 và kích hoạt bằng OTP + Authenticator | TC-ADM-004/005/006 |
| SYSTEM | **Kỹ thuật viên cấp** (không có đường tự tạo trên giao diện) | TC-ADM-002 |

### 6.4 Bảng thông tin riêng (tạo bằng Excel, **không đưa vào kho mã**, không chia sẻ công khai)

| Mã tài khoản | SĐT | Thiết bị đang dùng | Mật khẩu (ghi ở nơi an toàn, KHÔNG gõ vào đây) | Ghi chú |
|---|---|---|---|---|
| KH-A | | Máy 1 | (đã lưu ở … ) | |
| … | | | | |

Và **bảng chuẩn** để đối chiếu phép tính: mức phí 3 khung (F1, F2, F3), ranh giới km (b1, b2, b3), hoa hồng hiện tại (H), mức nạp tối thiểu (N), số dư ví đầu ngày của SP-A/SP-B.

---

## 7. Quy tắc an toàn khi kiểm thử tiền

**Mục tiêu:** không có đồng tiền thật nào bị chuyển hoặc ghi nhận nhầm.

1. **Tuyệt đối không chuyển khoản thật** để "thử nạp tiền" và không dùng thẻ/tài khoản ngân hàng của người thật.
2. Hiện hệ thống chạy ở chế độ **vận hành thật** (máy chủ dùng cùng cơ sở dữ liệu đang chạy thật). Ví chỉ tăng khi **Admin bấm "Ghi nhận tiền"**. Vì vậy mọi "tiền thử nghiệm" nhập bằng tay là **bút toán thật trong sổ**. Do đó:
   - Chỉ chạy các test ghi nhận tiền (TC-WAL-005, 008, 009, 015, 016, 021, 025…) **khi Owner đã duyệt bằng văn bản** một trong hai phương án: **(A)** dùng **môi trường thử riêng** (cơ sở dữ liệu riêng, chỉ có tài khoản test) – **khuyến nghị**; **(B)** dùng **đúng các tài khoản shipper thử** (SP-A, SP-B), số tiền **nhỏ nhất**, mã giao dịch ngân hàng **ghi rõ "TEST-…"**, ghi chú "TEST", và Owner chấp nhận bút toán này tồn tại trong sổ.
   - Nếu chưa có duyệt: các test này ghi **BLOCKED** (đừng bỏ qua im lặng). Nhóm đơn giao hàng cần ví có tiền (FLOW, DRV nhận đơn) cũng sẽ BLOCKED theo.
3. **Mã giao dịch ngân hàng thử nghiệm** phải duy nhất (mỗi mã chỉ ghi nhận một lần): đặt `TEST-<ngày>-<số thứ tự>`.
4. **Không ghi nhận "đã chuyển tiền" rút tiền thật** (TC-WAL-015). Chỉ làm khi có tài khoản ngân hàng thử do Owner chỉ định; nếu không, dừng ở bước "Nhận xử lý".
5. Mọi thay đổi **cấu hình tài chính** (hoa hồng, mức nạp/rút tối thiểu, bảng phí) phải **đặt lại giá trị ban đầu** sau khi thử, và chỉ làm khi được Owner cho phép.
6. Sau ngày 5, **đối chiếu số dư** (TC-WAL-012) và ghi lại tổng tiền thử nghiệm đã phát sinh để Owner xử lý (điều chỉnh/giải trình) theo quy định.

---

## 8. Trình tự thực hiện và chạy nhanh

Bộ test được sắp **theo hành trình người dùng**, không theo thư mục code. Mỗi "ngày" chỉ là cách chia nhóm (không ép thời lượng); điều chỉnh theo phụ thuộc thực tế.

| Ngày | Nội dung | Số test | File chi tiết |
|---|---|---|---|
| **1** | Cài ứng dụng, làm quen, đăng ký (khách, chủ quán, shipper), OTP, mật khẩu, phiên; dựng Web Admin (mời ADMIN, nhóm món, bảng phí) | {{N_DAY1}} | `chi-tiet/NGAY_1_…` |
| **2** | Dựng 3 quán; khách tìm quán, giỏ hàng, đặt đơn, hủy trước khi xác nhận; chủ quán nhận/xác nhận/từ chối/chỉnh đơn | {{N_DAY2}} | `chi-tiet/NGAY_2_…` |
| **3** | Nạp ví thử nghiệm; shipper online, nhận, lấy, giao; hai luồng giao hàng chính | {{N_DAY3}} | `chi-tiet/NGAY_3_…` |
| **4** | Hủy đơn (trước/sau lấy hàng), đổi phí, không có shipper, tự hủy quá hạn, bất thường (mất mạng, tắt app, GPS, nhấn nhiều lần, hai người cùng thao tác) | {{N_DAY4}} | `chi-tiet/NGAY_4_…` |
| **5** | Ví và tài chính, Web Admin (quyền, nhật ký, cấu hình, báo cáo), đánh giá/phản ánh, đối chiếu và nghiệm thu | {{N_DAY5}} | `chi-tiet/NGAY_5_…` |

**Lần đầu tiên:** làm `SMOKE_TEST_NGUOI_MOI.md` ({{SMOKE_COUNT}} test) để biết "đường chính" có thông. Smoke **không thay** nghiệm thu.

**Nghiệm thu đầy đủ:** làm theo `DANH_SACH_P0.md` ({{P0}} test, đúng thứ tự phụ thuộc) rồi các test P1/P2. Nếu một test P0 FAIL, **báo ngay** và chỉ thử tiếp những test không phụ thuộc vào nó.

**Thứ tự đề xuất cho người kiểm thử:**
1. Đọc tài liệu này và `KICH_BAN_TEST_LIEN_THONG.md`.
2. Họp 15 phút với Người phụ trách để xác nhận **mục 5.1** (đủ điều kiện hay thiếu gì).
3. Làm Ngày 1 → 2 → 3 → 4 → 5; sau mỗi test, cập nhật ngay file CSV.
4. Cuối mỗi ngày: gửi bảng kết quả + danh sách lỗi cho Người phụ trách.
5. Sau Ngày 5: điền `CHECKLIST_NGHIEM_THU.md` và áp dụng tiêu chí nghiệm thu (mục 9).

---

## 9. Điều kiện kết luận phiên bản (tóm tắt – bản đầy đủ trong `CHECKLIST_NGHIEM_THU.md`)

- ✅ **Tiếp tục thử nghiệm nội bộ** khi: 100% test P0 **đã chạy**; không có lỗi **NGHIÊM TRỌNG** còn mở; mọi FAIL P0 đã có báo lỗi.
- 🟡 **Chạy thử với quán và shipper thật** khi: toàn bộ P0 **PASS** trên **thiết bị thật**, các nhóm FLOW/WAL/SEC không còn lỗi nghiêm trọng hoặc cao; đối chiếu ví khớp; Owner duyệt điều khoản và chính sách tiền; kế hoạch hỗ trợ khi có sự cố.
- ⛔ **Chưa được đưa vào sử dụng** khi có **bất kỳ** lỗi liên quan: **mất tiền, sai số dư, giao nhầm đơn, mất đơn, sai quyền người dùng, giao dịch lặp**; hoặc có test P0 FAIL/BLOCKED chưa giải quyết.
- **Cổng chặn thử nghiệm bên ngoài:** trước khi mời quán, shipper hay khách bên ngoài dùng thử, các test thuộc 5 nhóm **Điều khoản · Chính sách quyền riêng tư · Thông báo vị trí nền · Sai quyền · Giao dịch tài chính** (bảng đầy đủ ở `CHECKLIST_NGHIEM_THU.md` mục 6, cột "Điểm có thể chặn thử nghiệm bên ngoài" của file CSV) phải đạt hoặc có quyết định bằng văn bản của Owner.
- **CI xanh KHÔNG đủ để nghiệm thu.** Kiểm thử tự động không thay thế thử trên thiết bị thật và không bao quát các quy trình nhiều người (khách + quán + shipper) như tài liệu này.

---

## 10. Những hạn chế đã biết (không phải lỗi của bạn, nhưng phải ghi lại nếu gặp)

| Hiện tượng | Ghi nhận |
|---|---|
| Tải lại trang (F5) một trang con của Web Admin bị **404** | Đã biết (tài liệu M02): hãy quay về trang chủ rồi đi bằng menu. Không phải lỗi phân quyền |
| Không có nút **chỉ đường từng bước** trong 11Ship | Chưa làm (TC-DRV-019 – NOT READY) |
| Tab **Thu nhập** của 11Ship chưa có số liệu | Chưa làm (TC-DRV-022 – NOT READY) |
| **Voucher**, **Trợ giúp**, **Vùng hoạt động** (Web Admin) | Chưa làm, màn hình ghi "chưa hỗ trợ"/"Sắp có" |
| Màn hình đăng ký còn câu "Chỉ bán hàng sau khi được duyệt" nhưng quán **hoạt động ngay** khi hồ sơ đủ điều kiện | Lệch tài liệu-mã nguồn: TC-ADM-015 chỉ **ghi nhận hiện trạng**; quyết định nghiệp vụ là câu hỏi OQ-01 của Owner (CHECKLIST_NGHIEM_THU mục 7) |
| Một số hãng điện thoại tự tắt ứng dụng nền / chia sẻ vị trí khi bật tiết kiệm pin | Giới hạn của Android; ghi hãng máy và đời Android (TC-ABN-004/015) |
| Thông báo **đẩy** (push) có thể chưa bật | Hộp thông báo trong ứng dụng vẫn hoạt động; TC-NOTI-001 CẦN XÁC MINH |
| Bản đồ trong 11Food/11Ship chỉ có khi APK được build kèm gói bản đồ Cao Bằng | TC-DRV-018, TC-CUS-027 CẦN XÁC MINH |

---

## 11. Danh sách kiểm tra "đã sẵn sàng bắt đầu chưa?"

Đánh dấu **đủ** các mục dưới trước khi làm Ngày 1 (mục chưa đủ → báo Người phụ trách, ghi BLOCKED cho các test bị ảnh hưởng):

- [ ] Có file APK 11Food + 11Ship, biết số phiên bản.
- [ ] Có địa chỉ Web Admin được xác nhận.
- [ ] Có tài khoản SYSTEM + Authenticator (do kỹ thuật viên cấp).
- [ ] Có đủ số điện thoại thật nhận SMS (tối thiểu 9 số), và đã được phép nhận SMS.
- [ ] Máy SMS Gateway đang bật.
- [ ] Có ít nhất 2 (tốt nhất 3) điện thoại Android 8.0+ và 1 máy tính.
- [ ] Đang ở trong khu vực phục vụ; có chỗ đứng gần "Quán Test A" (≤ 3 km) cho shipper.
- [ ] Owner đã duyệt **quy định tiền thử nghiệm** (mục 7) – hoặc ghi rõ các test ví sẽ BLOCKED.
- [ ] SYSTEM đã áp dụng bảng phí giao hàng (hoặc chấp nhận thử nhánh "Chưa xác định phí").
- [ ] Có thư mục lưu bằng chứng và bảng thông tin riêng.
- [ ] Đã đọc `BAO_CAO_LOI_MAU.md`.

## 12. Khi bị kẹt

1. Đọc lại phần "Điều kiện ban đầu" và "Phụ thuộc" của test.
2. Chụp màn hình, ghi lại bạn đang ở bước nào.
3. Hỏi Người phụ trách (không tự sửa dữ liệu hoặc cấu hình hệ thống).
4. Nếu thấy dữ liệu nhạy cảm (mật khẩu, OTP thật, thông tin cá nhân của người khác) trong ảnh chụp, **xóa trước khi chia sẻ**.
