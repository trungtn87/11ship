# 11Ship — B-03 smoke: review của Claude Lead

**Phiên bản:** 2 (hoàn chỉnh) · **Ngày:** 2026-11-02 · **Người review:** Claude Lead
**Baseline:** `requirements.md` v0.7 · **Sổ điểm lệch:** `b04-deviations.md` v3.3 (20 điểm)

## 1. Kết luận B-03

**B-03 đã hoàn thành vòng khảo sát, CHƯA ĐẠT NGHIỆM THU.** Không luồng nào được ghi PASS cuối cùng, vì không luồng nào có đủ bằng chứng API và UI cùng đạt.

Owner chốt (02/11): dừng B-03 tại trạng thái hiện tại, không mở rộng kiểm thử UI trong đợt này.

- **Lỗi đã có bằng chứng:** #295 (UI 11Ship), #294 (hai con số khoảng cách và Chi tiết quán thiếu khoảng cách), #299 (11Food hết bộ nhớ ở màn Chọn địa chỉ).
- **Chưa xác minh đầy đủ:** #238 (đổi địa chỉ khi sửa đơn), vì bị #299 chặn.
- **Không kết luận:** S-09 (xem mục 5).
- **Giữ BLOCKED:** S-02.

## 2. Môi trường và phạm vi

| Hạng mục | Giá trị |
|---|---|
| Thiết bị UI | Emulator Android 14, API 34, `sdk_gphone64_x86_64`, AVD `B03_API34`. **Không phải thiết bị thật; không ghi nghiệm thu thiết bị thật** |
| Giả lập | GPS `22.6680, 106.2600`; không SIM, SMS, push thật |
| APK | v480 (versionCode 480), Actions run 41221145655, nguồn `9ed95a2`. SHA256 11Food `6c9fbaed…0c48`, 11Ship `a39e0817…2889`. Hash 11Food trong manifest của Codex trùng với hash CI đã ghi |
| Backend | VPS test, SHA `9b0d9d7` (chỉ khác main `fb3ba2c` ở tài liệu và một file test), DB `ship11_staging` |
| Tài khoản | `B03-*` (khách, tài xế, chủ quán) |
| Không làm | Không sửa code, merge, deploy, phát hành APK lên VPS, không SMS hay giao dịch thật |

## 3. Bằng chứng Lead đã kiểm

- Gói `mnt.rar` do Owner chuyển: 76 file. **Đã xem:** 33 ảnh Antigravity đọc được (xem cả 33 qua bảng ghép, mở riêng 2 ảnh), 9 ảnh Codex, 18 XML Codex (đọc nội dung chữ của các tệp liên quan đến S-01), báo cáo Markdown, `smoke_full_report.json`, `issue-defect02.md`, `SOURCE-PROVENANCE.md`.
- **Toàn vẹn:** manifest Codex 28/28 tệp khớp SHA-256. Manifest Antigravity: 43/46 khớp.
- **Ngoại lệ:** `emulator_screen.png` (31 KB) không mở được là ảnh; `s01_ship_current.png` Codex đã tự ghi là chụp hỏng. `11Food-test.apk` trong gói bị hỏng khi truyền (lỗi CRC, hash không khớp manifest, trong khi hash trong manifest khớp hash CI), `11Ship-test.apk` và `android-signers.json` không giải nén được. Lead không tự kiểm APK; dựa vào hash CI và lời Codex.
- **Chưa kiểm:** log thô `logcat_full_raw.txt` (chưa che, không đính kèm lên GitHub, không đọc hết). Lead chỉ quét thấy không có chuỗi giống token trong báo cáo và JSON.
- **Provenance:** `SOURCE-PROVENANCE.md` ghi base commit `fb3ba2ce18f75b…`, trong khi baseline đã ghim là `fb3ba2ce18ada30…`. Đây có vẻ là lỗi ghi chép, không ảnh hưởng kết luận; Lead đề nghị sửa khi Codex chép lại gói.
- **Nhãn ảnh sai:** `S-04-buoc-01.png` là màn 11Ship kèm hộp thoại quyền của 11Food; `S-04-buoc-09`, `S-04-buoc-15`, `S-06-buoc-07`, `S-06-buoc-08` kết thúc ở màn hình chính của điện thoại (app đã thoát). Các ảnh này không dùng làm bằng chứng cho bước tương ứng.

## 4. Phân loại 14 luồng: API và UI

Từ khóa: **PASS** (có bằng chứng đạt) · **FAIL** (bằng chứng trái baseline) · **BLOCKED** (có điều kiện chặn đã ghi) · **PARTIAL** (chỉ một phần hợp đồng đã chạy) · **NOT TESTED** (không có bằng chứng thực thi).

| Luồng | Req baseline | API | UI v480 (emulator) | Kết luận | Căn cứ |
|---|---|---|---|---|---|
| S-01 Đăng nhập, đăng xuất, ví ẩn | M01-R-02..08, M01-R-15/16, M04-R-13 | PARTIAL (khách 403 ví; tài xế ví 200, đăng xuất 204, token cũ 401; chưa thử mọi trạng thái) | 11Food **PASS** cho đăng nhập, đăng xuất, mở lại; 11Ship **FAIL** | **FAIL** | Ảnh và XML Codex: 11Ship sau đăng xuất và sau force-stop vẫn hiện "Ví của tôi · Số dư, nạp và rút tiền" ở Tài khoản; tab Thu nhập vẫn mở được. Xác nhận #295. Thêm: Antigravity cho thấy 11Food hiện "Phiên đăng nhập đã kết thúc" khi có đăng nhập ở nơi khác (đúng một phiên) |
| S-02 Quên mật khẩu OTP | M01-R-03/04/18 | BLOCKED | BLOCKED | **BLOCKED** | `PASSWORD_RESET_DISABLED`; Owner: không bật, không PASS bằng mock |
| S-03 Thiết lập quán, ghim, thêm món | M02-R-01..03, M02-R-09/10 | PARTIAL (báo cáo lần 1, thao tác API) | NOT TESTED | **NOT TESTED** (UI) | Lần 1 chạy trên APK v470 và API 37, không dùng làm nghiệm thu |
| S-04 Khoảng cách, tuyến | M02-R-11/12, M10-R-06, M14 | **FAIL**: cùng cặp điểm ra 617 m và 720 m | **FAIL** một phần: Home 0,6 km và Tìm kiếm 0,6 km khớp nhau; **Chi tiết quán không hiện khoảng cách**; Giỏ hàng chỉ hiện phí tạm tính 10.000đ; Checkout và tuyến trên bản đồ NOT TESTED (bị #299) | **FAIL** | Ảnh `S-04-buoc-02-search`, `-03-detail`, `-05-cart`; JSON API. Xác nhận #294 ở tầng API; thiếu khoảng cách Chi tiết quán trái M02-R-12 |
| S-05 Vòng đời đơn | M10-R-01..11, M06, M07-R-01..03, M04-R-03 | PARTIAL (tạo đơn, xác nhận, gọi shipper tới `waiting_driver`; shipper nhận đơn trả 409 `FUNDING_TOO_LOW`) | NOT TESTED | **PARTIAL** | Chưa lấy hàng, giao, tính phí. Cần tài xế B03 đủ điều kiện nhận đơn |
| S-06 Sửa đơn, đổi địa chỉ (#238) | M10-R-09 | PARTIAL (đổi số lượng và ghi chú, tổng tiền tính lại) | NOT TESTED; **BLOCKED** bởi #299 | **BLOCKED** | Chưa chứng minh đổi địa chỉ. Tám ảnh gắn S-06 là thiết lập sổ địa chỉ (có ảnh ghim bản đồ thành công, rồi app thoát) |
| S-07 Các kiểu hủy | M07-R-02/14, M10-R-10 | PARTIAL (khách hủy trước xác nhận) | NOT TESTED | **PARTIAL** | Chưa có quán từ chối, hủy sau lấy hàng, shipper nhả đơn |
| S-08 Gọi shipper, link theo dõi | M07-R-05/11 | PARTIAL (tạo yêu cầu, link, trang theo dõi chạy); **không đạt B04-09**: chưa có mã công khai 8 ký tự | NOT TESTED | **PARTIAL** | Link dùng token dài |
| S-09 Online/Offline, GPS | M03-R-07/08, M14-R-01/02/12 | **Chưa kết luận** (xem mục 5) | NOT TESTED | **NOT TESTED** | JSON thô: bật Online 409, cập nhật GPS 400 |
| S-10 Nạp tiền, đóng tài khoản | M04-R-04/05, M03-R-04..06 | PARTIAL (tạo yêu cầu nạp, yêu cầu đóng và hủy đóng) | NOT TESTED | **PARTIAL** | Chưa duyệt nạp, rút |
| S-11 Chat, thông báo | M10-R-21, M08-R-01..07 | PARTIAL (gửi và đọc chat; đọc danh sách thông báo) | NOT TESTED | **PARTIAL** | Chưa kiểm hiển thị, push |
| S-12 Đánh giá, phản ánh | M11-R-01..07 | PARTIAL (tạo phản ánh; đánh giá bị chặn vì đơn chưa hoàn thành) | NOT TESTED | **PARTIAL** | Phụ thuộc S-05 |
| S-13 Admin Web | M01-R-09, M02-R-13, M12, M13-R-04 | PARTIAL (trang tải được, chặn Origin lạ, sai mật khẩu bị từ chối) | NOT TESTED | **PARTIAL** | Chưa đăng nhập 2FA, chưa mở màn hình nào |
| S-14 Cập nhật phiên bản | M13-R-05/06 | PARTIAL (API trả `UPDATE_REQUIRED` và `UP_TO_DATE`; v480 chưa phát hành, VPS vẫn v470) | NOT TESTED | **PARTIAL** | Popup trong app chưa kiểm; theo Owner không phát hành v480 |

Luồng không có PASS: lý do là API chỉ PARTIAL và UI NOT TESTED hoặc FAIL. Báo cáo lần 1 của Antigravity chấm 12 luồng "PASS" chỉ bằng API; các chấm đó không được dùng.

## 5. S-09: ghi nhận, không kết luận

- **Dữ liệu thô** (`smoke_full_report.json`, S-09): tắt Online trả 200; **bật Online trả 409**; **cập nhật GPS trả 400**. Báo cáo Markdown cùng bộ dữ liệu ghi "PASS".
- **Không kết luận** đây là lỗi sản phẩm hay PASS. Hai khả năng cần loại trừ trước:
  1. Điều kiện đầu vào: tài xế B03 mới, ký quỹ bằng 0 và chưa xác thực ngân hàng (xem S-05: `FUNDING_TOO_LOW`), nên 409 có thể là chặn đúng thiết kế; GPS 400 có thể do thiếu trường, sai phạm vi hoặc sai thứ tự gọi.
  2. Lỗi ghi chép của báo cáo.
- **Cần làm khi chạy lại:** lấy request và response thô (body, mã lỗi, `request_id`) của hai lệnh, đối chiếu với validator trong code, rồi mới phân loại. Phase xử lý: Phase 6 (kiểm chức năng backend) nếu là điều kiện đầu vào; Phase 8 nếu hóa ra lỗi.

## 6. Quan sát phụ (không đổi phân loại)

- Màn Chi tiết quán hiện "Chưa tải được đánh giá · Thử lại" khi chưa đăng nhập và "Chưa có đánh giá (0 lượt)" khi đã đăng nhập. Cần xem lại ở Phase 3 nếu baseline M11 yêu cầu khác.
- 11Food có mục "Voucher của tôi" ở Tài khoản (xác nhận B04-13, Owner đã duyệt gỡ).
- 11Ship khi chưa đăng nhập vẫn hiện thanh điều hướng Thu nhập, Thông báo, Đơn hàng (cùng nhóm lỗi #295: trạng thái chưa đăng nhập chưa được áp cho cả điều hướng).
- DEFECT-01 (APK không mở) chỉ xảy ra trên emulator API 37 trang 16 KB; trên API 34 cả hai app mở được. Giữ là lỗi tương thích đang điều tra, không chặn B-03; B04-17 hoãn theo Owner.

## 7. Lỗi có bằng chứng

| Lỗi | Bằng chứng | Mức chắc chắn | Phase xử lý |
|---|---|---|---|
| #295 Ví của tôi còn hiện sau đăng xuất (11Ship) | Ảnh và XML trên v480, hai trạng thái (sau đăng xuất, sau mở lại) | Cao trên emulator API 34 | Phase 8 |
| #294 Khoảng cách không đồng nhất; Chi tiết quán thiếu khoảng cách | API 617 m và 720 m; UI Home và Tìm kiếm khớp, Chi tiết quán thiếu | Cao ở API; UI Checkout chưa đo | Phase 8 |
| #299 OOM màn Chọn địa chỉ | 4 lần app thoát về màn hình chính trong 2 luồng, log lọc và issue | Cao trên emulator (heap 192 MB); chưa biết trên máy thật | Phase 8, **ưu tiên trước** các test Checkout và Sửa đơn |
| #238 Đổi địa chỉ khi sửa đơn | Chưa có | **Chưa xác minh** | Phase 8, sau khi #299 được xử lý |

## 8. Danh sách test UI chưa hoàn thành

Điều kiện chung để chạy lại: APK v480 (hoặc bản mới hơn từ cùng quy trình, ghi SHA256 và commit), emulator API 34 hoặc thiết bị thật, tài khoản `B03-*`, VPS test, không SMS thật, không giao dịch thật.

| Luồng | Req baseline | Điều kiện chạy lại | Phase xử lý |
|---|---|---|---|
| S-04 Checkout, tuyến bản đồ | M02-R-12, M10-R-06, M14-R-10..12 | #299 đã sửa hoặc đi vòng bằng sổ địa chỉ; đo khoảng cách ở Checkout và so với Home, Tìm kiếm | Phase 8 (#294) rồi chạy lại |
| S-06 Sửa đơn, đổi địa chỉ | M10-R-09 (#238) | Có đơn PENDING_CONFIRMATION; picker bản đồ không crash (sau #299) | Phase 8 |
| S-01 Ship (xác nhận sau sửa) | M04-R-13, M01-R-15/16 | Sau sửa #295: kiểm đăng xuất, mở lại, deep link, thông báo | Phase 8 |
| S-03 Thiết lập quán | M02-R-01..03, 09/10 | Quán mới, ghim bản đồ, thêm món trên UI v480 | Phase 6 (kiểm chức năng) |
| S-05 Vòng đời đơn | M10-R-01..11, M06, M07, M04-R-03 | Tài xế B03 đủ điều kiện nhận đơn (Admin duyệt nạp trên VPS test, không giao dịch thật) | Phase 6 |
| S-07 Các kiểu hủy | M07-R-02/14, M10-R-10 | Quán từ chối, hủy sau lấy hàng, shipper nhả đơn | Phase 6 |
| S-08 Link theo dõi | M07-R-05/11 | Sau B04-09: kiểm mã công khai 8 ký tự, thu hồi link | Phase 8 |
| S-09 Online, GPS | M03-R-07/08, M14 | Lấy request/response thô, điều kiện đầu vào đủ (xem mục 5) | Phase 6 |
| S-10 Nạp, đóng tài khoản | M04-R-04/05, M03-R-04..06 | Admin duyệt nạp, lệnh rút trên môi trường test | Phase 6 |
| S-11 Chat, thông báo | M10-R-21, M08-R-01..07 | Hiển thị chat, thông báo trong app (push là NOT TESTED ở emulator không FCM) | Phase 6 |
| S-12 Đánh giá, phản ánh | M11-R-01..07 | Có đơn hoàn thành (sau S-05) | Phase 6 |
| S-13 Admin Web | M01-R-09, M02-R-13, M12, M13-R-04 | Đăng nhập 2FA và các màn theo quyền; kiểm phân quyền (B04-06, B04-14) | Phase 5, Phase 6 |
| S-14 Cập nhật phiên bản | M13-R-05/06 | Chỉ khi Owner cho phát hành bản test; không phát hành trong B-03 | Phase 6, sau quyết định phát hành |
| S-02 Quên mật khẩu | M01-R-03/04/18 | Có phương án SMS Gateway/OTP test phù hợp do Owner duyệt; không mock | Sau quyết định Owner |

## 9. Ghi chú vận hành

- Không đính kèm log thô lên GitHub. Chỉ dùng bản log đã lọc cho issue và tài liệu.
- Script trợ giúp của Antigravity chứa thông tin đăng nhập test dạng chữ thường; Codex đã không chép sang gói. Không đưa các script đó vào repo.
