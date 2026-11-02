# 11Ship — Báo cáo kết thúc Phase 1 (Functional Baseline)

**Ngày:** 2026-11-02 · **Người lập:** Claude Lead · **PR:** #298 (mở, chưa merge) · **Trạng thái:** Owner duyệt về hướng kết luận (02/11); bản này đã chỉnh theo 5 yêu cầu của Owner, chờ xác nhận bản chính thức
**Mốc:** `main` `fb3ba2c`; baseline `requirements.md` v0.7; sổ điểm lệch `b04-deviations.md` v3.1; review B-03 `b03-lead-review.md` v2.

## 1. Kết luận

Phase 1 hoàn thành **phần tài liệu baseline**. Phase 1 **chưa nghiệm thu tính năng thực tế**: B-03 đã khảo sát xong nhưng CHƯA ĐẠT NGHIỆM THU, và không luồng nào được ghi PASS.

Hai điều này tách biệt:

| | Tình trạng | Ý nghĩa |
|---|---|---|
| **Baseline tài liệu** | Hoàn thành, chờ Owner duyệt | 198 dòng yêu cầu M00–M14, 28 xung đột đã được Owner chốt, 20 điểm lệch có phân loại. Đây là chuẩn để review và sửa lỗi |
| **Nghiệm thu tính năng** | Chưa đạt | Chỉ có API một phần và UI trên emulator một phần. 3 lỗi có bằng chứng (#294, #295, #299), #238 chưa xác minh, S-09 chưa kết luận, S-02 BLOCKED |

Baseline mô tả điều sản phẩm phải làm. Việc baseline được duyệt không có nghĩa code đã đạt baseline.

## 2. Kết quả theo hạng mục

| Hạng mục | Kết quả | Bằng chứng |
|---|---|---|
| B-00 Kiểm kê tự động | Kiểm kê xong (69 module, 412 route, 141 bảng, 36 màn Admin, 64 màn mobile, 15 runner, 11 workflow). 234 mục CHƯA MAP đều có một dòng gán của Codex (Req ID hoặc "không có yêu cầu"); Lead kiểm đủ số lượng và Req ID tồn tại, **chưa kiểm ngữ nghĩa từng dòng** | `b00-inventory.md` (có mục trạng thái đối chiếu và bảng gán) |
| B-01 Baseline | Xong v0.7: 198 yêu cầu, Conflict Register C-01..C-28 | `requirements.md` |
| B-02 Ma trận trạng thái và bằng chứng | Xong, Lead đã chấp nhận: 3 Đã làm, 18 Một phần, 3 Chưa, 174 Chưa đủ bằng chứng | Bình luận Codex trên PR #298; "Chưa đủ bằng chứng" là chấm thận trọng, không phải thiếu chức năng |
| B-03 Smoke VPS test | Hoàn thành khảo sát, **chưa đạt nghiệm thu** | `b03-lead-review.md` |
| B-04 Điểm lệch | Sổ 20 điểm, đã áp quyết định Owner 02/11; B-03 đã đóng khảo sát | `b04-deviations.md` |
| B-05 Conflict Register | C-01..C-28 đã chốt | `requirements.md` mục 16 |

## 3. Số liệu B-04

20 điểm, tổng số mục thực tế cần sửa:

- **12 sửa code sản phẩm** (B04-01..09, 11, 13, 20; gồm B04-08 và B04-13 do Owner quyết).
- **2 sửa hoặc bổ sung test** (B04-18, B04-19).
- **2 điều kiện hoặc hoãn** (B04-14 kiểm rồi mới quyết, B04-17 sau kiểm thử Android 17): chưa biết có phải sửa code.
- **4 giữ nguyên** (B04-10, 12, 15, 16).
- **0 sửa tài liệu**: baseline không bị sửa để hợp thức hóa hành vi chưa đúng.

## 4. Lỗi và việc còn lại sang các Phase sau

| Mục | Trạng thái | Phase |
|---|---|---|
| #295 "Ví của tôi" còn hiện sau đăng xuất (11Ship) | Có bằng chứng UI | 8 |
| #294 Khoảng cách không đồng nhất, Chi tiết quán thiếu khoảng cách | Có bằng chứng (API và UI) | 8 |
| #299 11Food hết bộ nhớ ở màn Chọn địa chỉ | Có bằng chứng trên emulator; chưa biết trên máy thật | 8, **làm trước** test Checkout và Sửa đơn |
| #238 Đổi địa chỉ khi sửa đơn | Chưa xác minh trên UI | 8, sau #299 |
| S-09 Online, GPS (409/400) | Chưa kết luận; cần request thô và điều kiện đầu vào | 6 |
| S-02 Quên mật khẩu | BLOCKED | Chờ phương án OTP test do Owner duyệt |
| DEFECT-01 / B04-17 Android 17 | Hoãn, không chặn | Đợt kiểm thử tương thích Android 17 |
| B04-14 DiagnosticsView, bảng Admin | Giữ có điều kiện | 4, 5: kiểm chức năng, phân quyền, bảo mật rồi mới thêm yêu cầu |
| Các gap sửa code còn lại (B04-04..07, 09, 11, 18, 19) | Đã ghi vào sổ | 5, 6, 8 theo sổ |
| Danh sách test UI chưa chạy (S-01..S-14) | `b03-lead-review.md` mục 8 | 6, 8 |

## 5. Quy tắc đã giữ

Không sửa code sản phẩm, không merge, không deploy, không phát hành APK lên VPS. Không giao dịch thật, không SMS thật. Không ghi PASS khi thiếu bằng chứng. Không đưa log thô hay thông tin đăng nhập vào repo.

## 6. Điều kiện sẵn sàng merge PR #298 (Owner duyệt riêng)

PR #298 chỉ chứa tài liệu trong `docs/baseline/`. Đề xuất Lead chỉ trình merge khi đủ các điều kiện sau:

1. **CI xanh trên đúng head hiện tại**, gồm Verify và kiểm tra bàn giao/readiness; trường `Remote-head-SHA` trong mô tả PR khớp head. Nếu Verify đỏ do lỗi hạ tầng hay test phụ thuộc giờ (đã gặp ở `admin-shops.int.spec.ts`), ghi rõ nguyên nhân và chạy lại đúng một lần.
2. **Diff chỉ gồm tài liệu**: không có thay đổi code, workflow, cấu hình, APK, log thô, ảnh hay thông tin đăng nhập. Lead đã quét `docs/baseline/`, không thấy token, mật khẩu hay chuỗi tương tự; kiểm lại ở head cuối.
3. **Owner duyệt nội dung**: baseline v0.7, sổ B-04 20 điểm (đặc biệt 4 điểm Owner đã quyết) và `b03-lead-review.md`.
4. **Trạng thái ghi đúng**: tiêu đề các tài liệu và mô tả PR nêu rõ "baseline tài liệu, chưa nghiệm thu tính năng", để không bị đọc nhầm là code đã đạt.
5. **Codex xem lại phần thay đổi từ v0.6 (bbfce73) đến head**: quyết định B-04, `b04-deviations.md` và `b03-lead-review.md`. B-02 trước đó được Codex làm ở bản cũ hơn. Nếu Owner thấy không cần, ghi rõ miễn xem lại.
6. **Không còn xung đột với `main`**; nếu `main` đổi, cập nhật nhánh và kiểm lại 1 và 2.
7. **Cách merge**: squash do Owner ra lệnh rõ ràng, thông điệp merge không chứa dấu bỏ qua CI. Merge không đồng nghĩa deploy; không deploy kèm theo.
8. **Việc sau merge** (không chặn): mở issue theo sổ B-04 cho các gap chưa có issue, gán Phase.

Không điều kiện nào ở trên yêu cầu chạy thêm test UI. Việc chạy thêm UI do Owner quyết riêng.

## 7. Đề xuất bước tiếp theo

1. Owner duyệt báo cáo này và các tài liệu; Lead cập nhật PR cho khớp.
2. Owner quyết merge PR #298 (riêng), theo mục 6.
3. Chuyển sang phase tiếp theo theo Master Plan v3. Các lỗi #299, #295, #294, #238 vào hàng đợi Phase 8 với test đỏ→xanh; #299 đứng đầu.
