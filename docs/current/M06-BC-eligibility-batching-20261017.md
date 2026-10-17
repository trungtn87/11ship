# M06-B/C — Điều kiện nhận đơn & ghép đơn (Gói 2)

Thiết kế: [M06-design-UI-LOCKED-2026-10-16.md](M06-design-UI-LOCKED-2026-10-16.md) mục 3–4. Gói này làm **bộ quyết định** (đủ/không đủ điều kiện + mã lý do), tham số Admin và adapter fail-closed. **Không** nhận đơn, không tạo assignment, không giữ/trừ tiền, không gửi thông báo, không làm GPS/routing — những việc đó thuộc M07/M04/M08/M14. Chưa có API hay UI 11Food/11Ship (Gói 3).

## Cách M07 dùng (`ShippingEligibilityService`, module `ShippingEligibilityModule`)

1. `preview({driverId, deliveryId}, nowMs)` — chỉ đọc, giao dịch ngắn. Gọi ma trận tuyến M14 **ngoài transaction**. Trả `{decision, route}`; `decision = {eligible, reasons[], distanceToShopM, batch}`.
2. `confirm(context, request, route, nowMs)` — chạy **trong transaction commit của M07**: khóa hàng Shipper trước (cùng khóa gốc của mọi đường tiền/assignment), đọc lại mọi dữ kiện, yêu cầu `route` còn mới (≤ 60 s) và đúng các điểm cũ (`ROUTE_STALE` nếu không), rồi quyết định lại. M07 phải chèn assignment + hold **trong cùng transaction đó** (khóa giữ đến COMMIT) thì hai yêu cầu nhận đồng thời của một Shipper không vượt số đơn hoặc số dư.

## Điều kiện nhận (B) — `shipping-eligibility.ts`

Hồ sơ `ACTIVE`, bật nhận đơn, ngân hàng đã xác minh; đơn đang tìm, chưa có shipper, chưa quá hạn tìm; GPS hợp lệ và mới (cờ do M14); **bán kính 5 km cố định** đường chim bay quán → GPS shipper (không phải tham số, không có ô Admin; PLATFORM miễn bán kính); EXTERNAL tối đa `external_max_deliveries` (mặc định 3), PLATFORM không giới hạn số đơn nhưng **vẫn** cần GPS, số dư khả dụng ≥ hold (so sánh chính xác bằng bigint) và bảo vệ ETA. Mã lý do: `DRIVER_NOT_ACTIVE`, `DRIVER_NOT_ACCEPTING`, `DRIVER_BANK_NOT_VERIFIED`, `DELIVERY_NOT_AVAILABLE`, `DELIVERY_SEARCH_EXPIRED`, `LOCATION_UNAVAILABLE`, `LOCATION_STALE`, `SHOP_LOCATION_MISSING`, `OUT_OF_SEARCH_RADIUS`, `ACTIVE_LIMIT_REACHED`, `WALLET_UNAVAILABLE`, `BALANCE_TOO_LOW`, `DEPENDENCY_NOT_READY`. Không khu vực đăng ký (đã bỏ ở M03).

## Ghép đơn (C) — `shipping-batching.ts`

- ETA gốc của đơn đã nhận (do M07 lưu, bất biến) được bảo vệ: tổng độ chậm so với **ETA gốc** ≤ `batch_max_delay_seconds` (mặc định 300). Ví dụ A gốc 18:30: ghép B làm A 18:33 (+180 s) hợp lệ; ghép tiếp C làm A 18:37 (+420 s) bị chặn — không reset ETA gốc thành 18:33 (có test chứng minh).
- Đánh giá mọi điểm lấy/giao còn lại; pickup luôn trước dropoff của cùng đơn; cộng thời gian nhận (`pickup_service_seconds`) và bàn giao (`handoff_service_seconds`).
- Thiếu tọa độ/ETA → `BATCH_ORDER_DATA_MISSING`; GPS cũ/không hợp lệ → `LOCATION_STALE`; ma trận thiếu/lỗi → `ROUTE_DATA_UNAVAILABLE` (không đoán đường thẳng); hết ngân sách tìm kiếm (100.000 bước) → `BATCH_BUDGET_EXCEEDED` (từ chối, không âm thầm giới hạn số đơn); vượt giới hạn → `BATCH_DELAY_EXCEEDED`. Shipper trống: không cần tuyến (đơn chưa có GPS giao vẫn nhận được).
- Shipper tự chọn thứ tự giao; kết quả chỉ là đánh giá lúc nhận, không ép tuyến, không đổi ETA.

### Giả định cần Owner/ChatGPT xác nhận

1. **Tuyến dự báo = phương án hoàn tất mọi điểm nhanh nhất** (hòa thì phương án làm chậm đơn cũ ít nhất). Thiết kế đã duyệt chỉ chốt giới hạn và ví dụ, không chốt cách chọn tuyến; nếu chỉ kiểm "tồn tại một thứ tự thỏa" thì quy tắc vô nghĩa (luôn giao đơn cũ trước).
2. **Thời gian nhận 120 s / bàn giao 60 s** (giá trị mặc định tạm; Admin đổi được ở tab Điều kiện nhận & ghép). Thiết kế chưa nêu số.

## Dữ liệu và API

- Migration `1793664000000_create-shipping-eligibility-parameters.sql`: một dòng tham số (có version, CHECK khoảng giá trị, không xóa) + nhật ký thay đổi chỉ-thêm (cũ, mới, actor, thời gian). Seed: 3 / 300 / 120 / 60. Grants runtime đã thêm vào `02-runtime-grants.sql` và runbook.
- Admin API `/v1/admin/shipping-eligibility-policy`: GET (mọi Admin), POST (chỉ SYSTEM; `expected_version`, bốn giá trị; idempotency, audit, outbox). Bán kính không phải trường của API (gửi lên bị từ chối). `SHIPPING_ELIGIBILITY_VERSION_CONFLICT` (409).
- Admin Web: tab **Điều kiện nhận & ghép** chỉnh được (bán kính 5 km khóa chỉ đọc, PLATFORM "Không giới hạn"); tab **Lịch sử chính sách** có thêm nhật ký thay đổi điều kiện.

## Ports (mặc định fail-closed)

| Port | Chủ | Mặc định hiện tại |
|---|---|---|
| `DELIVERY_OFFER_PORT`, `SHIPPER_WORK_PORT` | M07 | chưa nối → `DEPENDENCY_NOT_READY` |
| `SHIPPER_LOCATION_PORT`, `ROUTE_MATRIX_PORT` | M14 | chưa nối → `LOCATION_UNAVAILABLE` / `ROUTE_DATA_UNAVAILABLE` |
| `AVAILABLE_BALANCE_PORT` | M04 | **đã nối** `WalletService.readWallet` (số dư khả dụng thật; ví chưa có = 0) |

M07 và M14 bind implementation của mình vào token; M06 không đổi. Sau M04-A2 (hold) M07 cung cấp `requiredHoldVnd` qua `DeliveryOffer`.

## Kiểm thử

Unit: `shipping-eligibility.spec.ts`, `shipping-batching.spec.ts`, `apps/admin-web/src/core/shipping-policy.spec.ts`. PostgreSQL thật: `tests/integration/m06-shipping-eligibility.int.spec.ts` (tham số: quyền, biên, version, log bất biến; quyết định: EXTERNAL/PLATFORM, port fail-closed, tuyến, snapshot cũ; **hai yêu cầu nhận đồng thời không vượt số đơn hay số dư** — bỏ khóa hàng Shipper thì test đỏ 3/3 được nhận). Chrome thật: `tests/integration/admin-shipping-policy-browser.int.spec.ts`.
