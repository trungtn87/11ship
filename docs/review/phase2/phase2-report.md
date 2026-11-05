# G-9 Báo cáo tổng Phase 2: Graphify Discovery

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Trạng thái:** BẢN NHÁP v2: đã áp review Antigravity (2026-11-05, xem §9); CHỜ review Codex rồi Owner nghiệm thu. Phase 2 **không** tuyên bố code đúng, đạt baseline hay có lỗi. Chưa merge, chưa deploy, chưa APK, không sửa code sản phẩm.


**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.


## 1. Kết luận ngắn

1. **Graphify dùng được** trên SHA đã chốt (G-0 đạt): 29.524 node, 83.282 cạnh, 61 giây, `built_at_commit` khớp. 7,1% cạnh là INFERRED.
2. **Graph chỉ phản ánh tốt cấu trúc import và gọi trực tiếp.** Với NestJS nó mù ở bốn chỗ đã chứng minh bằng source: (a) luồng **outbox → M08** (không có đường có hướng từ `OrderRecorder` đến `NotificationEventService`), (b) cổng `Symbol` + `useExisting` (ví dụ `COMMISSION_ADJUSTMENT_PORT`), (c) tác vụ nền `setInterval` (11 cái, không `@Cron`), (d) route/guard khai bằng decorator. Ngoài ra graph tạo **đường giả**: `graphify path OrderCustomerService WalletService` trả 4 bước EXTRACTED, nhưng `order-customer-service.ts` không hề nhắc ví; đường đi qua `m14-route-client.ts → shipping-ports.ts` vì hai lớp không liên quan nằm cùng một file.
3. **Cấu trúc backend lành mạnh về vòng phụ thuộc:** 0 vòng ở cấp module NestJS; 2 nhóm vòng cấp file, trong đó 1 là vòng kiểu không tồn tại lúc chạy (admin-web), 1 là vòng thật trong Flutter `n11_shared` (`shell ↔ m08_views ↔ account_views`, nơi chứa màn đăng xuất).
4. **Mã chết:** 0 file sản phẩm mồ côi; 1 ứng viên class thật (`NotIntegratedCommissionAdjustmentPort`); 4 stub `NotIntegrated*Port` chỉ test dùng.
5. **Hai dẫn mối cụ thể cho Phase 3 (chưa phải finding, chưa chạy app):**
   - **#295**: `mobile/ship/lib/ship_tabs.dart:201` và `:141` dựng mục "Ví của tôi" không điều kiện theo `session.status`, khác các mục bên cạnh (`:202-203`).
   - **#294**: backend chỉ có **một** client định tuyến (`delivery/m14-route-client.ts`); Home (`route`) và đặt đơn (`routeResult`) cùng lấy pickup từ snapshot quán. Chênh 617 m / 720 m khó đến từ hai thuật toán backend; cần xem điểm xuất phát GPS so với địa chỉ lưu, cache Valhalla, và client Dart.

## 2. System Map dạng bảng chữ (Master Plan v3.5)

| Tầng | Thành phần | Số lượng / quy mô | Nối với |
|---|---|---|---|
| Client | 11Food (Flutter), 11Ship (Flutter), SMS Gateway (Flutter/Android), Admin Web (TS DOM) + Mini Business PWA, food-web/ship-web | 40 / 44 / 17 / 164 file | `n11_shared` (UI+controller chung), `n11_m14`, `n11_m14_map`; HTTP `/v1/*` |
| Ranh giới vào | `app.setup.ts` (body parser, `rawBody`, prefix), `AllExceptionsFilter`, `SessionAuthGuard` (167 route), `AdminTransport` cookie+CSRF (129 route), `SmsGatewayAuthGuard` (4 route), 41 route không cơ chế thấy được | 412 route / 69 controller | Trust boundaries T1-T4 |
| Ứng dụng | 49 module NestJS (M00 nền → M14); `AdminAuthModule` gom admin | 811 file | Transaction, Idempotency, Outbox, Audit làm nền |
| Nền chung | `TransactionManager`, `IdempotencyExecutor`, `OutboxDispatcher`, `audit/` | H10, H11, H15 | gần như mọi service |
| Nền thời gian | 11 tác vụ `setInterval` trong tiến trình API | 2 s – 60 phút | DB, outbox |
| Dữ liệu | PostgreSQL 17, 67 migration, 141 bảng | TLS bật bằng `config.tls` | `create-pool.ts` |
| Ngoại vi | Valhalla/M14 (`POST /route`), FCM (OAuth JWT), SMS Gateway (kéo hàng đợi), GitHub Actions + VPS VinaHost | | Trust boundaries T5-T10 |

## 3. Kết quả theo hạng mục

| Mục | Đầu ra | Tình trạng | Mức xác nhận |
|---|---|---|---|
| G-1 | `graph-run-record.md` | Xong | Số liệu từ graph.json + manifest |
| G-2 | `components.md` | Xong | 49/69/412 từ script, khớp grep 412; quan sát chính đã mở source |
| G-3 | `flows.md` | **Một phần**: 11 luồng, F2/F3/F8/F9 đọc sâu; F1/F5/F6/F7 có đoạn đã mở; F4/F11 mới ở entry point | Phần chưa mở ghi rõ |
| G-4 | `cycles.md` | Xong | 2 nhóm vòng đều đã mở source |
| G-5 | `dead-code-candidates.md` | **Một phần**: cấp file, cấp class xong; cấp hàm, bảng SQL, endpoint không ai gọi **NOT TESTED** | |
| G-6 | `impact-areas.md` | Xong ở mức cận dưới (import) | Cần Antigravity bổ sung DI/outbox |
| G-7 | `trust-boundaries.md` | **Một phần**: T10 (workflow/runner) CHƯA LÀM; nhiều route công khai chưa mở limiter | |
| G-8 | `graph-baseline-links.csv` | 198/198 dòng; xem §4 | Liên kết ứng viên, KHÔNG phải kết luận |
| G-9 | báo cáo này | Bản nháp | |

## 4. G-8: liên kết 198 yêu cầu

- Phương pháp: gợi ý tìm kiếm tiếng Anh (`reports/scripts/hints.py`) do Claude Lead viết riêng cho từng yêu cầu (không dùng B-00 hay B-02), script `g8b.py` giải gợi ý thành file, controller/route (từ bảng route) và file test **import trực tiếp** component (đồ thị import).
- Phân bố độ tin **về việc định vị** (không phải về việc yêu cầu được đáp ứng): STRONG 52 (khớp đường dẫn + có route + có test import), MEDIUM 82, WEAK 10 + 54 (chỉ khớp tên định danh), NOT-FOUND 0. Không có dòng nào "không tìm thấy nút code", **nhưng** 0 không có nghĩa tốt: gợi ý do người viết nên thiên về tìm thấy. Phase 3 phải đọc lại ngữ nghĩa.
- Cột `n_tests = 0` (45 dòng) **không** có nghĩa là thiếu test: test tích hợp khởi động app qua `AppModule` và không import controller; cột chỉ đếm file test import trực tiếp component.
- Yêu cầu không tìm thấy nút code: **chưa có**. Yêu cầu nghi thiếu code đã biết từ Phase 1 (`M02-R-17`, `M10-R-26`, `M12-R-13`) vẫn nằm đúng trong danh sách để Phase 3 kiểm riêng: `M10-R-26`: hint khớp `orders/order-customer-delivery-service` nhưng điều đó **không** chứng minh có hành vi "đơn đã xác nhận nhưng chưa gọi shipper".

## 5. Giới hạn công cụ (đầy đủ)

1. AST không thấy DI, route, cron, event của NestJS (đã chứng minh, §1.2). Mọi đường dùng làm bằng chứng phải mở source; các đường trong báo cáo ghi trạng thái.
2. Cạnh `calls` INFERRED (4.961) và `indirect_call` (550) là phỏng đoán. `graphify path` mặc định có hướng trong khi graph ghi `directed:false`.
3. 338 file bị bỏ, gồm toàn bộ unit systemd, nginx, pg_hba, Dockerfile (hạ tầng): kết luận hạ tầng phải đọc tay. YAML workflow chỉ vào graph như nút `document/yml`; không có phân tích bước.
4. 4 file Kotlin lỗi parse. 94 file không có symbol.
5. `graph.html` chỉ có bản gộp 700 nút.
6. Script đọc source của Lead dùng regex nên là `HEURISTIC`: bỏ sót route khai báo động; đếm 412 khớp grep nhưng không có bằng chứng độc lập khác.
7. Mọi số về tiến trình chạy (khởi động, lock, cấu hình VPS) NOT TESTED: Phase 2 không chạy app, không truy cập VPS.

## 6. Câu hỏi và việc cho Phase 3
1. Làm rõ vì sao có hai controller đăng ký/đăng nhập (`AuthController` legacy `/v1/auth`, `ClientAuthController` `/v1/client-auth`); client nào còn gọi legacy.
2. #295: xác nhận bằng test/chạy app giả thuyết `ship_tabs.dart:201,141`.
3. #294: bổ sung đo điểm xuất phát Home (GPS) và luồng đặt đơn Dart; không sửa trước khi có số.
4. Quyết định giữ hay bỏ `NotIntegratedCommissionAdjustmentPort` và 4 stub `NotIntegrated*Port` nằm trong code sản phẩm.
5. Vòng Dart `shell ↔ m08_views ↔ account_views`.
6. Mở nốt các luồng F1/F4/F5/F6/F11 và các route công khai chưa mở limiter (M01-R-08 giới hạn đăng nhập, OTP).
7. `AdminAuthModule` gom cả `BusinessClientController` (API quán): xác nhận chủ ý và hệ quả khi `ADMIN_AUTH_ENABLED=false`.
8. `idempotency/idempotency-cleanup.ts`: chưa xác nhận nơi khởi động.
9. Mọi nội dung 214 dòng B-00 chưa rà ngữ nghĩa (từ Phase 1) vẫn thuộc Phase 3; G-8 không thay thế.

## 7. Đối chiếu tiêu chí hoàn thành (mục 6 handoff)

| # | Tiêu chí | Hiện tại |
|---|---|---|
| 1 | Graph Run Record đủ trường, SHA khớp | Đạt (tự kiểm; chờ Codex dựng lại) |
| 2 | G-2..G-9 có đầu ra, đường làm bằng chứng đã mở source | **Chưa đủ**: G-3, G-5, G-7 một phần (xem §3) |
| 3 | Vòng và mã chết có trạng thái "đã xác nhận" hay "chỉ từ graph" | Đạt cho vòng; mã chết cấp class đạt, cấp hàm NOT TESTED |
| 4 | 198/198 dòng G-8 | Đạt (độ tin ghi từng dòng) |
| 5 | Nêu giới hạn công cụ | Đạt (§5) |
| 6 | Không đổi code sản phẩm/workflow/cấu hình | Đạt: PR chỉ thêm `docs/review/phase2/` |
| 7 | Review độc lập có disposition | **Chưa**: chờ Codex, Antigravity |

Vì vậy Phase 2 **chưa** đủ điều kiện nghiệm thu; xem §8.

## 8. Việc còn lại trước khi trình Owner
- Codex và Antigravity review theo brief ở `/mnt/project-files/handoffs/` (Owner chuyển tay).
- Lead hoàn thiện phần "Một phần" của G-3, G-5, G-7 sau khi nhận review (hoặc Owner cho phép để sang Phase 3 với danh sách này).

## 9. Disposition review Antigravity (comment PR #301, 2026-11-05)

Người review chỉ đọc. Lead tự mở lại source cho từng ý trước khi nhận (ngoại trừ những ý ghi "chưa kiểm"). Antigravity không chạy hệ thống: các mục chạy thực tế đều NOT TESTED.

| Mục AG | Nhận định của AG | Disposition | Ghi chú |
|---|---|---|---|
| 1.1 F2 không tạo chuyến giao | Đúng | **Đã áp** (flows F2) | `order-shop.controller.ts:78`, `order-shop-service.ts:256` |
| 1.2 F3 `#preflight`, `complete()` | Đúng một phần | **Đã áp có hiệu chỉnh** | Preflight là một transaction đọc riêng (không phải "ngoài mọi transaction"); `complete()` đã đọc (`:559-591`) |
| 1.3 F5/F7 chuỗi nạp → duyệt shipper | Đúng | **Đã áp** | `admin-shipper-service.ts:222-223`; ngưỡng 100k **chưa kiểm** |
| 2.1 16 cổng DI | Đúng về bản chất; số khác | **Đã áp** (components §3b) | grep cho 24 token; 16 là cổng nghiệp vụ |
| 2.2 startup gate, `WalletModule.onModuleInit` | Đúng | **Đã áp** | bản trước đếm hook sai (24 lần xuất hiện, thực: 10 + 2) |
| 2.3 `IdempotencyCleanup` | Đúng, không khởi động ở đâu | **Đã áp** | Lead tự grep xác nhận; ghi nhận cho Phase 3/6 |
| 2.4 timer, `NotificationSignal` | Đúng | **Đã áp** (components) | |
| 2.5 workflow, runner, script CLI | Đúng | **Mở, chưa làm** (T10) | nhận làm ở bước hoàn thiện |
| 3.1-3.4 H01/H05/H09/H10/H11 | Đúng | **Đã áp** (impact-areas) | các file Admin Web Lead chưa mở |
| 4.1-4.3 scale ngang | An toàn dữ liệu, không leader lock | **Đã áp** (flows F10) | khóa hàng tự kiểm; hàm `#searchReminders`/`#pickupReminders` chưa mở; NOT TESTED |
| 5.1 vòng Dart | Xác nhận | Giữ nguyên | |
| 5.2 #295 "xác nhận lỗi code rõ ràng" | AG nâng mức | **Không nhận mức "lỗi"** | Ví chỉ là ứng viên nguyên nhân; chưa chạy app (NOT TESTED). AG cũng ghi NOT TESTED; "Guest bấm sẽ gặp lỗi" chưa kiểm. Giữ là dẫn mối cho Phase 3 |

Việc còn lại sau review này: T10 (workflow/script), mở nốt F1/F4/F6, hai hàm delivery sweeper chưa mở, review Codex.
