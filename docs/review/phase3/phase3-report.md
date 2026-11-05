# Phase 3 — Báo cáo đối chiếu Graph ↔ Baseline (E)

Trạng thái: **bản nháp chờ review độc lập** (Codex, Antigravity). Chưa có ai nghiệm thu. Chức năng vẫn **NOT ACCEPTED**; bug #295, #294, #299 giữ nguyên trạng thái.

- Code SHA phân tích: `549572696efb4bbc18af3c362b7f56a5fcd335e6` (không đổi). Nhánh tài liệu dựa trên `main` d5f8f28 (Phase 2 đã merge).
- Phạm vi: chỉ tài liệu/dữ liệu trong `docs/review/phase3/`. Không sửa code sản phẩm, không deploy, không build/phát hành APK, không chạy runtime.
- Nhãn bằng chứng: ĐÃ MỞ SOURCE / CHỈ TỪ GRAPH / HEURISTIC / NOT TESTED. Không dùng cạnh INFERRED hay `n_tests=0` làm căn cứ kết luận.

## 1. Sản phẩm bàn giao

| Mã | Tệp | Nội dung |
|---|---|---|
| A | `reconciliation-table.md` | 198 yêu cầu: verdict, bằng chứng file:dòng, nhãn, lý do, loại B-04, issue |
| B | `discrepancies.md` | Thiếu / lệch / một phần / chưa xác định / mã chết-legacy / baseline không còn khớp |
| C | `graph-baseline-links.v2.csv` | 198 dòng; cột ứng viên gốc giữ nguyên, thêm `candidate_confidence`, `semantic_verdict`, `evidence`, `evidence_label`, `review_note`, `b04_class`, `related_issue` |
| D | `b00-semantic-review.md/.csv` | 234 mục B-00 đã rà ngữ nghĩa |
| Carry-over | `flows-f1-f4-f6.md`, `delivery-sweeper.md`, `ops-scripts.md`, `ops-client-ingest.md`, `public-routes.md`, `outbox-m08.md`, `open-questions.md` | Việc còn thiếu của Phase 2 và Q1–Q9 |
| Quyết định Owner | `owner-decisions.md` | OD-1..OD-18, mỗi mục có đề xuất của Lead |

## 2. Tổng theo verdict (198 yêu cầu)

| Verdict | Số dòng |
|---|---:|
| IMPLEMENTED | 78 |
| PARTIAL | 84 |
| MISMATCH | 4 |
| MISSING | 1 |
| UNKNOWN | 31 |
| **Tổng** | **198** |

Theo độ tin cậy của ứng viên Phase 2:

| Ứng viên | IMPLEMENTED | PARTIAL | MISMATCH | MISSING | UNKNOWN |
|---|---:|---:|---:|---:|---:|
| MEDIUM | 33 | 35 | 2 | 0 | 17 |
| STRONG | 26 | 20 | 2 | 0 | 3 |
| WEAK | 4 | 6 | 0 | 1 | 0 |
| WEAK(ident only) | 15 | 23 | 0 | 0 | 11 |

Cách đọc: IMPLEMENTED nghĩa là đã mở source và hành vi chính khớp; mỗi dòng ghi riêng phần chưa kiểm (nhiều dòng còn "UI/runtime NOT TESTED"). Đây là đối chiếu tĩnh, **không phải PASS chức năng**. UNKNOWN không bị đổi thành MISSING; MISSING (1 dòng) có nêu phạm vi quét.

## 3. Rà 234 mục B-00

| Kết luận | Số dòng |
|---|---:|
| CONFIRMED | 132 |
| TOO_NARROW | 34 |
| WRONG | 24 |
| TOO_BROAD | 15 |
| NO_REQUIREMENT | 10 |
| LABEL_UNRELIABLE+CONFIRMED | 10 |
| LABEL_UNRELIABLE | 8 |
| LABEL_UNRELIABLE+WRONG | 1 |
| **Tổng** | **234** |

Phát hiện chính: 14 nhãn route sai đường dẫn trong inventory, 8 dòng `order-parameters` lặp nhãn nên không gán 1-1, thiếu một số màn admin và workflow trong inventory, và nhiều ánh xạ gốc sai ngữ nghĩa (ví dụ `order_parameters` là `fee_answer_minutes` chứ không phải timeout đơn). Chi tiết trong `b00-semantic-review.md`.

## 4. Câu hỏi bắt buộc Q1–Q9

| Q | Kết luận ngắn | Nhãn | Tệp |
|---|---|---|---|
| Q1 | `phone-verifications` (3 route) ĐANG được app dùng dù nằm dưới `/v1/auth/*`; `register/login/role/select/me` legacy không client gọi, đường login legacy không qua `ClientLoginLimiter` | ĐÃ MỞ SOURCE | public-routes.md |
| Q2 | #295 xác nhận bằng static trace: `ship_tabs.dart:141,201` dựng mục ví không kiểm `signedIn` (các mục cạnh có kiểm). Runtime sau đăng xuất đã có bằng chứng FAIL ở B-03, không lặp lại | ĐÃ MỞ SOURCE / NOT TESTED | open-questions.md |
| Q3 | Một `M14RouteClient`, không fallback; thẻ quán đo thiết bị→quán, xem trước đơn đo quán→điểm giao; nguyên nhân 617 m vs 720 m cùng cặp điểm **không giải thích được từ source** | ĐÃ MỞ SOURCE; nguyên nhân UNKNOWN | open-questions.md |
| Q4 | `NotIntegratedCommissionAdjustmentPort` là mã chết duy nhất; `NotIntegratedDriverWalletPort` và 4 port shipping là placeholder fail-closed/test-only | ĐÃ MỞ SOURCE | open-questions.md |
| Q5 | Vòng Dart `shell⇄m08_views⇄account_views` có thật nhưng chỉ qua hàm `n11Route` không giữ trạng thái | ĐÃ MỞ SOURCE | open-questions.md |
| Q6 | `BusinessClientController` là nửa client của cùng cặp service tài chính với `BusinessAdminController`; đặt trong `AdminAuthModule` do dùng chung provider | ĐÃ MỞ SOURCE | open-questions.md |
| Q7 | `IdempotencyCleanup` tồn tại, được đăng ký, không có scheduler hay call site ngoài test; công cụ ngoài repo: UNKNOWN | ĐÃ MỞ SOURCE; UNKNOWN | open-questions.md |
| Q8 | Producer → outbox → dispatcher → consumer → `NotificationEventService` → push đã theo dõi bằng tay; Graphify không thấy đường này | ĐÃ MỞ SOURCE | outbox-m08.md |
| Q9 | `VoucherScreen` còn lối vào (B04-13); không có route xóa tài khoản trong app (Admin xóa bằng POST); `DiagnosticsView` không có lối vào; `admin_sensitive_operations` có hợp đồng task | ĐÃ MỞ SOURCE | open-questions.md |

## 5. Việc carry-over từ Phase 2

- **F1/F4/F6**: đọc entry→service→trạng thái→lưu→tác động phụ→lỗi. Phần chưa đọc được đánh dấu CHƯA ĐỌC và thành UNKNOWN trong bảng (xem `flows-f1-f4-f6.md`: SMS Gateway kéo hàng đợi, `ClientDeviceProofService`, foreground service Android, tần suất báo vị trí).
- **Hai sweeper giao hàng** (`#searchReminders`, `#pickupReminders`): 30 s/tick, tối đa 50 mục, nhắc phút 5 và 15, ngừng tìm phút 30; nhắc lấy hàng mỗi 5 phút không có số lần tối đa riêng (OD-10).
- **Ba script vận hành**: mục đích, điều kiện chạy, chống chạy nhầm đã ghi trong `ops-scripts.md`; có drift tài liệu "staging only" của `db-migrate-remote.js`.
- **Ingest `ops-client.controller.ts`**: khóa máy Bearer sha256, mỗi khóa một scope; không thấy limiter cho ingest; log client giới hạn 300/giờ/tài khoản.
- **41 route công khai**: từng route có cơ chế và phân loại; không kết luận "không bảo vệ" chỉ vì thiếu `SessionAuthGuard`. `trust proxy` không được đặt trong source nên limiter theo IP phía sau reverse proxy là UNKNOWN.

## 6. Quy tắc số liệu

- **AdminTransport**: 129 route handler mang nhãn `AdminTransport` trong `nest.json` (Phase 2, quét AST theo handler, đếm theo route), thuộc 21 controller; tái lập lại cùng số 129 trong Phase 3 bằng cùng script/dữ liệu. Không đối chiếu được con số Codex (142) và 154 (đếm theo controller) vì chưa có script của họ: 129 vẫn là **cận dưới theo phương pháp này**, không phải số tuyệt đối. Nếu Codex đếm lại, yêu cầu nêu đơn vị, phạm vi loại trừ và cách xử lý trùng.
- **Tác vụ nền**: grep `setInterval(` trong `apps/backend/src` (không tính test) cho 12 lời gọi trong 11 file (một dòng của `ops-analytics-runtime.ts` có hai lời gọi), trùng Phase 2. Con số 11 tác vụ logic và 10 runtime owner giữ nguyên theo Phase 2, chưa đếm lại bằng phương pháp độc lập. `delivery-tracking-public.controller.ts` có một `setInterval` thuộc bộ giới hạn trong RAM, không phải tác vụ nghiệp vụ.

## 7. Giới hạn và điểm yếu cần reviewer soi

- Đây là đối chiếu **tĩnh**; không chạy app, test, CI hay VPS. Giá trị cấu hình thực trên VPS (APP_ENV, native gate, phiên bản điều khoản) là UNKNOWN.
- Độ sâu đọc không đồng đều: các dòng có nhãn "CHƯA MỞ" trong cột bằng chứng nghĩa là chưa đọc đến dòng. Các verdict IMPLEMENTED có thể còn nhánh chưa kiểm; Codex nên kiểm mẫu có chủ đích, đặc biệt M01, M04, M10 và các dòng MISSING/MISMATCH.
- MISSING cho M10-R-26 dựa vào phạm vi quét đã nêu (12 file có `PREPARING`, các sweeper, hàng đợi Admin); cần Codex xác nhận bằng cách quét độc lập.
- 31 dòng UNKNOWN chủ yếu là hành vi giao diện/thiết bị/runtime; không dòng nào bị quy thành thiếu.
- Lead chưa tái lập thủ công con số 412 route/69 controller; dùng dữ liệu Phase 2 đã được review.

## 8. Chuyển giao Phase 4/5

- **Phase 4 (review code)**: dọn mã chết/legacy (mục 5 của `discrepancies.md`), comment lỗi thời `wallet.module.ts:22-27`, route `/fail`, trường `bankVerified`, `finance-view` có thể trùng, `pubspec.lock` Flutter (đã ghi từ Phase 0).
- **Phase 5 (bảo mật)**: giới hạn đăng nhập đường legacy, `trust proxy` và limiter IP, ingest ops không limiter, ma trận quyền Admin (M08-R-12/15, M12-R-07, M04-R-15), 52 mutation không `Idempotency-Key`, xóa thiết bị khi xóa vĩnh viễn (M01-R-19), `IdempotencyCleanup`, quét nơi tiêu thụ `account origin` (M01-R-22).
- **Phase 6 (test/runtime)**: toàn bộ UNKNOWN thuộc giao diện/thiết bị; nguyên nhân #294; nơi lưu giỏ; `ShopCallScreen`.
- **Phase 8 (sửa)**: #295, #294, #299, #238, B04-13, M10-R-26, tắt DIRECT mới, `wallet.adjustment.post`, hạn mức tương ứng theo OD.

## 9. Kiểm tra điều kiện nghiệm thu của Phase 3 (tự kiểm, không phải nghiệm thu)

| Điều kiện cấm báo hoàn thành | Tình trạng |
|---|---|
| Còn dòng ứng viên chưa rà | Không: 198/198 có verdict |
| Còn dòng B-00 chưa rà | Không: 234/234 có kết luận |
| Verdict không có bằng chứng source | Không có; mỗi dòng có cột evidence và nhãn (một số dòng UNKNOWN ghi rõ phần chưa mở) |
| Chỉ dựa cạnh INFERRED | Không dùng |
| Dùng `n_tests=0` để kết luận không có test | Không dùng |
| UNKNOWN gộp vào MISSING | Không |
| F1/F4/F6, 2 sweeper, 3 script, 41 route chưa đọc | Đã đọc; các đoạn chưa đọc đã ghi CHƯA ĐỌC và thành UNKNOWN |
| Câu hỏi bắt buộc chưa trả lời hoặc chưa đánh UNKNOWN | Q1–Q9 có kết luận; Q3 nguyên nhân và Q7 công cụ ngoài repo là UNKNOWN |

## 10. Review độc lập và kết luận Lead

- Codex (read-only): CHƯA CHẠY. Brief: `/mnt/project-files/handoffs/codex-review-phase3-reconciliation.md`.
- Antigravity (read-only): CHƯA CHẠY. Brief: `/mnt/project-files/handoffs/antigravity-review-phase3-reconciliation.md`.
- Khuyến nghị của Lead: chưa nghiệm thu cho tới khi hai review xong và mọi finding được xử lý. Nếu Owner muốn tiết kiệm thời gian, ưu tiên Codex trước (xác nhận MISSING/MISMATCH, mẫu IMPLEMENTED của M01/M04/M10, đếm lại AdminTransport).
- Chỉ Owner quyết định ACCEPTED hoặc NOT ACCEPTED, và việc merge.
