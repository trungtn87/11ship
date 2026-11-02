# 11Ship — Báo cáo kết thúc Phase 1 (Functional Baseline)

**Ngày:** 2026-11-02 · **Người lập:** Claude Lead · **PR:** #298 (mở, chưa merge) · **Trạng thái:** Owner duyệt về hướng kết luận (02/11); bản này đã chỉnh theo 5 yêu cầu của Owner, chờ xác nhận bản chính thức
**Mốc:** `main` `fb3ba2c`; baseline `requirements.md` v0.7; sổ điểm lệch `b04-deviations.md` v3.3; review B-03 `b03-lead-review.md` v2.

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
| B-00 Kiểm kê tự động | Kiểm kê xong (69 module, 412 route, 141 bảng, 36 màn Admin, 64 màn mobile, 15 runner, 11 workflow). 234 mục CHƯA MAP đều có một dòng gán của Codex ([comment 6561712894](https://github.com/trungtn87/11ship/pull/298#issuecomment-6561712894)); Lead kiểm đủ số lượng và Req ID tồn tại. **Ngữ nghĩa chưa được xác minh**: review độc lập của Codex thấy 10/20 dòng mẫu gán sai hoặc quá rộng, đã ghi errata; 214 dòng còn lại chưa rà, để Phase 3 | `b00-inventory.md` |
| B-01 Baseline | Xong v0.7: 198 yêu cầu, Conflict Register C-01..C-28 | `requirements.md` |
| B-02 Ma trận trạng thái và bằng chứng | Xong, Lead đã chấp nhận: 3 Đã làm, 18 Một phần, 3 Chưa, 174 Chưa đủ bằng chứng | Bình luận Codex trên PR #298; "Chưa đủ bằng chứng" là chấm thận trọng, không phải thiếu chức năng |
| B-03 Smoke VPS test | Hoàn thành khảo sát, **chưa đạt nghiệm thu** | `b03-lead-review.md` |
| B-04 Điểm lệch | Sổ 20 điểm, đã áp quyết định Owner 02/11; B-03 đã đóng khảo sát | `b04-deviations.md` |
| B-05 Conflict Register | C-01..C-28 đã chốt | `requirements.md` mục 16 |

## 3. Số liệu B-04

20 điểm, tổng số mục thực tế cần sửa:

- **12 sửa code sản phẩm** (B04-01..09, 11, 13, 20; gồm B04-08 và B04-13 do Owner quyết).
- **1 sửa test** (B04-18).
- **1 rà soát bằng chứng** (B04-19): lập kế hoạch rà soát và chấm theo rủi ro; chỉ bổ sung test khi có assertion hoặc rủi ro cụ thể; không phải nghĩa vụ viết test cho 174 dòng.
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
| Các gap sửa code còn lại (B04-04..07, 09, 11) và sửa test B04-18 | Đã ghi vào sổ | 5, 6, 8 theo sổ |
| Rà lại 234 dòng gán B-00 và rà soát bằng chứng 174 dòng (B04-19) | Chưa làm | 3, 6 |
| Danh sách test UI chưa chạy (S-01..S-14) | `b03-lead-review.md` mục 8 | 6, 8 |

## 5. Quy tắc đã giữ

Không sửa code sản phẩm, không merge, không deploy, không phát hành APK lên VPS. Không giao dịch thật, không SMS thật. Không ghi PASS khi thiếu bằng chứng. Không đưa log thô hay thông tin đăng nhập vào repo.

## 6. Điều kiện sẵn sàng merge PR #298 (Owner duyệt riêng)

PR #298 chỉ chứa tài liệu trong `docs/baseline/`. Đề xuất Lead chỉ trình merge khi đủ **7 điều kiện** sau. Trạng thái ghi ở cột phải (cập nhật theo head cuối).

| # | Điều kiện | Trạng thái |
|---|---|---|
| 1 | **CI xanh trên đúng head cuối**, gồm Verify và kiểm tra bàn giao/readiness; `Remote-head-SHA` trong mô tả PR khớp head. Verify đỏ do hạ tầng hay test phụ thuộc giờ (đã gặp ở `admin-shops.int.spec.ts`) thì ghi nguyên nhân và chạy lại đúng một lần | Chờ head cuối |
| 2 | **Diff chỉ gồm tài liệu** (5 file trong `docs/baseline/`): không code, workflow, cấu hình, APK, log thô, ảnh hay thông tin đăng nhập. Codex đã quét 5 file ở head 41989cf, không thấy; kiểm lại ở head cuối | Cần kiểm lại ở head cuối |
| 3 | **Owner duyệt nội dung**: baseline v0.7, sổ B-04 (20 điểm, gồm 4 điểm Owner đã quyết), `b03-lead-review.md`, `b00-inventory.md` | Chờ Owner |
| 4 | **Trạng thái ghi đúng** trong tài liệu và mô tả PR: "baseline tài liệu, chưa nghiệm thu tính năng"; B-00: đã gán, chưa xác minh ngữ nghĩa | Đã ghi |
| 5 | **Review độc lập Codex đã chạy và mọi phát hiện có disposition** (đã sửa, ghi nhận hoặc bác bỏ có lý do, do Lead ghi và Owner xem). Nếu head đổi sau review, Codex xem lại phần sửa hoặc Owner miễn rõ ràng | Review xong ở 41989cf; disposition ở mục 8; chờ Codex xem phần sửa hoặc Owner miễn |
| 6 | **Không xung đột với `main`**; nếu `main` đổi thì cập nhật nhánh và kiểm lại 1 và 2 | Kiểm lại ở head cuối |
| 7 | **Cách merge**: squash do Owner ra lệnh rõ ràng, thông điệp không chứa dấu bỏ qua CI. Merge không đồng nghĩa deploy | Chờ Owner |

Không điều kiện nào ở trên yêu cầu chạy thêm test UI. Việc chạy thêm UI do Owner quyết riêng.

**Việc sau merge** (không phải điều kiện merge): mở issue theo sổ B-04 cho các gap chưa có issue và gán Phase; rà lại 234 dòng gán B-00 ở Phase 3.

## 7. Đề xuất bước tiếp theo

1. Owner duyệt báo cáo này và các tài liệu; Lead cập nhật PR cho khớp.
2. Codex xem lại phần sửa sau review (hoặc Owner miễn).
3. Owner quyết merge PR #298 (riêng), theo mục 6.
4. Chuyển sang phase tiếp theo theo Master Plan v3. Các lỗi #299, #295, #294, #238 vào hàng đợi Phase 8 với test đỏ→xanh; #299 đứng đầu.

## 8. Disposition review độc lập của Codex (02/11, head 41989cf, [review 5736935792](https://github.com/trungtn87/11ship/pull/298#pullrequestreview-5736935792))

Codex ghi 16 câu: 9 ĐẠT, 7 CÓ VẤN ĐỀ. Lead đã đối chiếu từng phát hiện với `main@fb3ba2c`; không phát hiện nào bị bác bỏ.

| Phát hiện | Disposition | Sửa ở |
|---|---|---|
| `requirements.md` còn "19 điểm" | Đã sửa thành 20 | `requirements.md` §17 mục 8 |
| Phiên bản B-04 ghi v3, v3.1, v3.2 ở các file khác nhau | Đã thống nhất v3.3 | `b04-deviations.md`, `b03-lead-review.md`, báo cáo này |
| Bảng B-00 không thấy bình luận nguồn | Nguồn có thật: comment 6561712894 (Codex đã tìm ở 6560506383). Đã ghi liên kết và so khớp | `b00-inventory.md` |
| 10/20 dòng B-00 mẫu gán sai hoặc quá rộng; mẫu 14 dòng của Lead thiếu sót | Chấp nhận. Đã thêm errata, hạ kết luận xuống "chưa xác minh ngữ nghĩa", đưa việc rà lại 234 dòng vào Phase 3 | `b00-inventory.md`, mục 2 báo cáo này |
| B04-06 mô tả sai tác động (viewer-only không hủy được: cancel cần quyền `lock`) | Đã sửa: gap là thiếu quyền riêng theo từng hành động | `b04-deviations.md` |
| B04-03 ghi sai (đã có chọn địa chỉ từ sổ địa chỉ) | Đã sửa: thiếu tìm địa chỉ offline và chỉnh ghim ngay trong editor | `b04-deviations.md` |
| B04-19 biến "chưa đủ bằng chứng" thành nghĩa vụ viết test | Chấp nhận. Đổi thành "Rà soát bằng chứng"; số đếm 12 / 1 / 1 / 2 / 4 = 20 | `b04-deviations.md`, mục 3 |
| Citation B04-02 (`ship_tabs.dart:138-145,200-202`), B04-07 (`:70-81`), B04-12 (ops-view, ops-vps, ops-settings) | Đã sửa, đã mở file ở `fb3ba2c` để xác nhận | `b04-deviations.md` |
| Mục 8 điều kiện merge tự ghi "không chặn" | Chấp nhận. Còn 7 điều kiện; thêm điều kiện về disposition của phát hiện độc lập; "việc sau merge" tách riêng | mục 6 |
