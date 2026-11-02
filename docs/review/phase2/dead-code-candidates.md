# G-5 Ứng viên mã không còn dùng

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.


**Nguyên tắc:** graph (AST) không thấy DI, route, cron, event; vì vậy mọi nút "không có cạnh vào" chỉ là ứng viên. Đã **loại trừ** theo framework: controller (nối bằng decorator và `*.module.ts`), provider khởi động qua `onApplicationBootstrap`/`setInterval` (11 tác vụ nền, xem components.md §3), class nạp bằng token `Symbol`/`useExisting`, entry point CLI và `main`. Mỗi dòng ghi cách đã loại trừ nối động.

## 1. Cấp file (backend, admin-web, Dart, web)
Phép đo: script `imports.py`, file sản phẩm (không `*.spec`, `*.test`, `tests/`, `*.fixture.ts`) không có cạnh import từ **file sản phẩm khác**.

| File | Số import từ test | Kết luận | Cách loại trừ nối động (`ĐÃ MỞ SOURCE`) |
|---|---|---|---|
| `apps/backend/src/main.ts` | 0 | Entry point | điểm vào Node |
| `apps/backend/src/ops/cli/ops-cli.ts` | 1 | Không chết | `scripts/ops-ctl.js:9` nạp `dist/ops/cli/ops-cli.js` |
| `apps/backend/src/sms-gateway/cli/sms-gateway-cli.ts` | 6 | Không chết | `scripts/sms-gateway-ctl.js:8` |
| `apps/backend/src/auth/staging-fixture-seeder.ts` | 2 | Không chết | `scripts/staging-seed-fixtures.js:43` |
| `apps/backend/src/test-sms/tool-session.ts` | 1 | Không chết | `scripts/test-sms-inbox.mjs:19-24` |
| `apps/backend/src/auth/auth-fakes.fixture.ts`, `database/test-tls.fixture.ts`, `shared/source-scan.fixture.ts` | 11 / 8 / 31 | Fixture của test | chỉ test dùng |
| `apps/admin-web/src/design/main.ts`, `dom/main.ts`, `dom/business-main.ts` | 0 | Entry point trình duyệt | nạp bằng HTML/bundle, **chưa mở file HTML**: `CHỈ TỪ GRAPH` cho `design/main.ts` |
| `apps/food-web/src/main.ts`, `ship-web/src/main.ts`, `*/design/main.ts` | 0 | Entry point | như trên |
| `mobile/food/lib/main.dart`, `ship/lib/main.dart`, `gateway/lib/main.dart` | 0/0/1 | Entry point Flutter | |
| `mobile/packages/n11_shared/lib/testing.dart` | 50 | Thư viện test | chỉ test dùng |

**Kết quả:** 0 file sản phẩm mồ côi ở cấp file. Điều này khớp quy ước repo (mỗi file đều được module/test dùng), nhưng cũng cho thấy phép đo cấp file quá thô để tìm mã chết.

## 2. Cấp class (backend): 635 class/interface không có cạnh vào từ file khác → lọc còn 14 `class` thật
Lọc: tên không xuất hiện ở file sản phẩm khác (`grep -w`, tìm cả `apps`, `scripts`, `ops`, `tools`). Còn lại 14 `class`, rồi mở source:

| Class | File:dòng | Trạng thái | Ghi chú |
|---|---|---|---|
| `NotIntegratedCommissionAdjustmentPort` | `feedback/feedback-finance-port.ts:30` | **Ứng viên thật** (`ĐÃ MỞ SOURCE`: 0 tham chiếu ở toàn repo kể cả test) | Comment trong file nói cố ý giữ cho bản build không nạp wallet package; thực tế `COMMISSION_ADJUSTMENT_PORT` luôn bind `WalletCommissionAdjustmentAdapter` (`admin-auth.module.ts:264`). Phase 3 quyết định giữ hay bỏ |
| `NotIntegratedDeliveryOfferPort`, `…ShipperWorkPort`, `…ShipperLocationPort`, `…RouteMatrixPort` | `shipping-policy/shipping-ports.ts:69-90` | Chỉ dùng trong test | `tests/integration/m06-shipping-eligibility.int.spec.ts:304-307`; không có tham chiếu ở code sản phẩm. Stub phục vụ test, không phải mã chết nhưng **nằm trong code sản phẩm** |
| `WalletInvariantError` | `wallet/wallet-types.ts:68` | Không chết | ném ở `:45`, `:118` cùng file; test dùng |
| `TestDisplayActivationOtpProvider` | `admin-activation/activation-otp-providers.ts:80` | Không chết | dựng ở `:127` cùng file |
| `TransactionSession`, `BoundContext`, `ReadTransport`, `ChatRoutes`, `ConsumerPublisher`, `NotPersistedResult`, `ReplayAnswer` | nhiều file | Không chết | lớp nội bộ không export, dùng trong chính file (2-9 lần) |

Từ 635 → 1 ứng viên thật + 4 stub test-only. Phần 621 còn lại là `interface`/`type` đã được tính "không ai import" vì chỉ dùng trong cùng file hoặc chỉ làm kiểu: không phải mã chết.

## 3. Chưa làm / giới hạn
- Hàm/method không ai gọi: **NOT TESTED**. Graph có cạnh `calls` (19.480) nhưng 4.961 là INFERRED và DI làm mất cạnh; nếu lọc ra sẽ có hàng trăm dương tính giả. Đề xuất để Codex chọn mẫu 15 hàm.
- Mã Dart không tham chiếu: chỉ đo cấp file (0 mồ côi); cấp symbol chưa làm.
- Cột SQL: bảng không code nào đọc/ghi: chưa làm (141 bảng, 67 migration). Gợi ý Phase 3.
- Endpoint không client nào gọi: chưa làm.
