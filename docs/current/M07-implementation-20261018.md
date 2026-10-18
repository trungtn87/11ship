# M07 — Quy trình giao hàng: kế hoạch triển khai và hợp đồng dữ liệu (18/10/2026)

Nguồn: `11Ship-M07-Functional-Approved-UI-v1.0.md` (Owner duyệt chức năng 16/10/2026), phụ lục M14 (chỉ vị trí mới nhất), ADR-004 (hold/capture/release), M06 v1.1 (18/10, 3 km, ba khung phí, thỏa thuận phí). Nhánh `ccr-20044309-7dr277`, base `main@d77b9c4`. Không merge main, không deploy.

## 1. Quyết định khi tài liệu lệch nhau (cần Owner/ChatGPT biết)

| # | Lệch | Cách làm trong gói này |
|---|---|---|
| 1 | M07 ghi bán kính 5 km; M06 v1.1 (18/10, Owner khóa) ghi 3 km | Dùng `SHIPPER_SEARCH_RADIUS_M` của M06 (3000 m). Không thêm hằng số thứ hai |
| 2 | Ảnh bộ thiết kế `Design-UI-LOCKED-v1.0.zip` không có trong tệp đính kèm | UI làm theo văn bản (mục 8–10 của tài liệu M07) và component hiện có; nếu zip khác văn bản thì sửa sau |
| 3 | M04-A2.2 (reserve/capture/release hoa hồng) và nguồn ledger hoa hồng chưa tồn tại | Làm trong migration M07.03 theo lộ trình đã ghi ở migration M04 (assert bảng rỗng → FK → thay cổng nguồn). Chỉ mở nguồn `COMMISSION`; `WITHDRAWAL`/`TOPUP` vẫn đóng |
| 4 | Đường nạp tiền: M04-B2.2b (đã trên main) cho Admin xác nhận nạp và ghi sổ TOPUP; M04-B3 (UI Admin tài chính) và rút tiền (M04-C) chưa có | Shipper có số dư qua nạp thật (yêu cầu nạp của shipper → Admin có quyền `wallet.topup.record` xác nhận) thì nhận được đơn. Chưa kiểm chứng trên thiết bị/UI Admin tài chính. WITHDRAWAL/ADJUSTMENT vẫn bị cổng ledger chặn |
| 5 | Hoa hồng: ADR-004 ghi 1.000 VND/đơn thành công, snapshot theo assignment | Hằng số `COMMISSION_VND = 1000`, chốt vào `delivery_assignments.commission_vnd` và hold; capture dùng số đã chốt |
| 6 | M06 cần xác nhận của khách khi khách trả phí và mức khác bảng giá, nhưng chưa có app khách | Quán ghi nhận "khách đã đồng ý" (hành động CUSTOMER do quán chuyển lời, có audit). Cần Owner xác nhận cách này |
| 7 | M10 (Order), M08 (push), M11 (phản ánh) chưa có | Adapter rõ ràng: tạo từ Order trả `ORDER_MODULE_NOT_READY`; sự kiện đi qua outbox (M08 đọc sau); chuyển M11 chỉ ghi dấu `m11_referred_at` + audit, không giả lập ticket |
| 8 | M14 backend (vị trí, tuyến) chưa có | Bảng "vị trí mới nhất" tối thiểu + route client tới dịch vụ tuyến (`M14_ROUTING_ORIGIN`); không đặt thì tuyến "không sẵn sàng" và phí = null, không lấy đường thẳng |

## 2. Gói và thứ tự commit

0. Tài liệu này.
A. UI: `mobile/packages/n11_shared/lib/src/m07/` (models, sources, controllers, màn quán Q01–Q08, màn shipper S01–S08), Admin Web `apps/admin-web` (tab "Giao hàng"). Dữ liệu mẫu chỉ khi `M07_UI_PREVIEW=true` và trong test, luôn có nhãn "Dữ liệu minh họa".
B. M07.01 tạo/xem · M07.02 tìm/timer/gọi lại · M07.03 nhận/hủy nhận/hold · M07.04 điểm giao/phí/pickup · M07.05 thành công/thất bại/giữ hàng · M07.06 ghép đơn/vị trí · M07.07 Admin/Order adapter.
C. Nối app với API thật, CI, APK.

## 3. Trạng thái

`delivery.state` (CHECK trong DB): `waiting_driver`, `accepted`, `location_confirmed`, `picked_up`, `delivering`, `completed`, `failed`, `cancelled_by_merchant`, `search_stopped`.

- `picked_up` là mốc (cột `picked_up_at` + sự kiện); lệnh "Đã nhận hàng" ghi mốc và đặt `delivering` trong cùng giao dịch — không bao giờ nằm lại ở `picked_up`, không có nút "Bắt đầu giao".
- `location_confirmed`: shipper đã xác nhận ghim và phí thỏa thuận (chỉ với đơn thiếu điểm giao hoặc phí `null`).
- Đang hoạt động: `waiting_driver`, `accepted`, `location_confirmed`, `delivering`. Kết thúc: `completed`, `failed`, `cancelled_by_merchant`, `search_stopped`.
- Một Order tối đa một delivery hoạt động (UNIQUE một phần). Gọi lại = delivery mới có `previous_delivery_id`.
- Assignment: `ACTIVE` → `COMPLETED` | `FAILED` | `CANCELLED_BY_SHIPPER` | `CANCELLED_BY_SHOP`. Một delivery tối đa một assignment `ACTIVE`.
- Mọi chuyển trạng thái là `UPDATE ... WHERE state = <cũ> AND version = <cũ>`; chỉ một transition thắng (hủy vs pickup, complete vs fail).

## 4. Quy tắc thời gian

`search_expires_at = search_started_at + 30 phút` (giờ DB). Nhắc quán ở phút 5 và 15 (`reminded_5_at`, `reminded_15_at`, mỗi mốc một lần), phút 30 → `search_stopped`. Hủy nhận không đổi `search_expires_at`. Shipper đã nhận trước hạn tiếp tục. Nhắc shipper "chưa nhận hàng" mỗi 5 phút tính từ `accepted_at` (`last_pickup_reminder_at`). Bộ quét (`DeliverySweeper`) chỉ dựa trên mốc lưu trong DB nên khởi động lại không reset.

## 5. API (envelope `{ "data": ... }`, lỗi `{ "error": { "code": ... } }`, mọi lệnh ghi có `Idempotency-Key`)

Quán (phiên SHOP): `POST /v1/shop/me/deliveries` · `GET /v1/shop/me/deliveries?scope=active|history&q=` · `GET /v1/shop/me/deliveries/{id}` · `POST .../{id}/cancel` {reason, expected_version} · `POST .../{id}/recall` · `POST .../{id}/fee/counter-accept|counter-reject|customer-confirm` · `POST .../{id}/custody` {resolution: GOODS_RETURNED|HANDLED_NO_RETURN, note}.

Shipper (phiên DRIVER): `GET /v1/driver/deliveries/offers` → `{offers: [...]}` · `GET /v1/driver/deliveries/mine?scope=active|history` (`active` gồm cả `search_stopped`/`failed` còn sự cố mở của shipper này; `own_outcome` = released | released_by_admin | cancelled_by_shop cho lịch sử của chính shipper) · `GET /v1/driver/deliveries/{id}` · `POST .../{id}/accept` · `POST .../{id}/release` {reason} · `POST .../{id}/fee/agree|skip|counter` · `POST .../{id}/destination` {lat,lng,fee_vnd?} · `POST .../{id}/pickup` · `POST .../{id}/complete` · `POST .../{id}/fail` {reason_code, note, goods_condition} · `PUT /v1/driver/location` {lat,lng,accuracy_m?} · `GET /v1/driver/deliveries/offers` có `eligible` + `reasons[]`.

Admin (phiên admin): `GET /v1/admin/deliveries` · `GET /v1/admin/deliveries/{id}` · `POST /v1/admin/deliveries/{id}/actions/{record-custody|adjust-after-pickup|refer-m11|release-assignment}`.

### Delivery (quán thấy đủ; shipper trước nhận chỉ thấy `offer`)

```
delivery: { delivery_id, code, source: DIRECT|ORDER, order_id|null, previous_delivery_id|null, state, own_outcome|null, version,
  pickup: { shop_name, phone, address_text, lat, lng },   // điểm lấy = toạ độ quán (snapshot lúc gọi); shipper chỉ thấy sau khi nhận
  recipient: { name, phone, address_text, lat|null, lng|null },
  goods: { description, value_vnd, paid_vnd, unpaid_vnd },
  fee: { mode: STANDARD|AGREED|PICKUP_AGREEMENT, payer: CUSTOMER|SHOP, amount_vnd|null, status: FINAL|UNKNOWN|PENDING_AGREEMENT|AWAITING_CUSTOMER,
         distance_m|null, agreement: { state, proposed_vnd, counter_vnd|null, reason_code, reason_note|null, expires_at } | null },
  search: { started_at, expires_at, server_now, stopped_at|null },
  assignment: null | { assignment_id, shipper: { name, phone, plate_number }, accepted_at, picked_up_at|null, destination_confirmed },
  location: null | { lat, lng, recorded_at, age_seconds, freshness: LIVE|STALE|LOST },
  result: null | { outcome, at, reason|null, goods_condition|null },
  incident: null | { incident_id, status: OPEN|CLOSED, custody: SHIPPER|SHOP|HANDLED, reason, opened_at },
  can: { cancel, recall, resolve_custody }, timeline?: [ { at, type, actor, note|null } ] }
offer: { delivery_id, code, shop: { name, area_text }, distance_to_shop_m|null, dropoff_area_text|null, goods_value_vnd, unpaid_vnd,
  fee_vnd|null, fee_status, fee_payer, search_expires_at, server_now, eligible, reasons[], agreement: {...}|null }
```

Vị trí (`freshness`): `LIVE` ≤ 120 s, `STALE` ≤ 600 s, `LOST` sau đó (hoặc M14 báo không hợp lệ). Luôn trả `recorded_at`. Chỉ quán chủ delivery, shipper đang giữ assignment `ACTIVE`, hoặc Admin đọc được; hủy nhận/kết thúc/đổi assignment làm `location` = null ngay.

## 6. Dữ liệu (migration `1794096000000_create-m07-delivery.sql`)

`app.deliveries`, `app.delivery_assignments` (ETA gốc bất biến, hoa hồng chốt), `app.delivery_events` (chỉ thêm), `app.delivery_incidents`, `app.shipper_latest_locations` (một dòng/shipper, ghi đè, không lịch sử). Mở cổng hold COMMISSION và thêm COMMISSION_DEBIT vào cổng ledger (giữ nguyên TOPUP đã mở bởi `1794009600000_open-topup-ledger-gate`; WITHDRAWAL/ADJUSTMENT vẫn bị chặn). Không xóa cứng nghiệp vụ; trigger chặn DELETE/TRUNCATE.

## 7. Chưa nối / chặn thật

Xem mục 1 (#3, #4, #6, #7, #8). Báo cáo bàn giao ghi lại phần nào đã chạy thật, phần nào chỉ chạy trong test.

## Ghi chú sau triển khai (18/10/2026)

- `reprice` (tính lại phí do quán yêu cầu) **chưa làm**: quán gọi lại (`recall`) thì giao mới được tính phí lại; hằng `OPERATIONS.reprice` chỉ để dành tên.
- Khoá FK: `shipping_fee_agreements.delivery_id → deliveries` (M06 trước đó chưa có bảng giao hàng); các test M04/M06 đã được cập nhật dùng dòng giao hàng/assignment thật (`tests/integration/support/delivery-fixtures.ts`).
- M04-A2.2 nằm trong migration M07: hold COMMISSION chỉ ghi được khi có assignment ACTIVE; ghi sổ COMMISSION_DEBIT chỉ khi hold đã CAPTURED, đúng một lần. `app.wallet_ledger_source_gate()` được hợp nhất: TOPUP (có `wallet_topups` cùng ví, cùng số tiền, như main) **hoặc** COMMISSION_DEBIT hợp lệ; mọi loại khác bị chặn như trước.
- Thứ tự migration: sau `1794009600000_open-topup-ledger-gate` của main nên M07 là `1794096000000_create-m07-delivery.sql` (chưa môi trường nào áp dụng tên cũ; nếu sau này có, phải chuyển tiếp bằng migration mới chứ không đổi lịch sử).
- Điều kiện nâng cấp: migration **không** đòi ledger rỗng. Nó chỉ yêu cầu bảng hold rỗng và mọi dòng ledger là TOPUP có bản ghi nạp khớp ví/số tiền; nếu không, từ chối `M07_MIGRATION_REFUSED` và không đụng dữ liệu. Dòng TOPUP, số dư và lịch sử được giữ nguyên.
- Down: chỉ khi không có dòng giao hàng/hoa hồng (safety latch `M07_DOWN_REFUSED`); khôi phục cổng ledger về đúng bản của main (vẫn nhận TOPUP), cổng hold về đóng; tiền TOPUP không bị đụng.
- Kiểm thử: `tests/integration/m07-delivery.int.spec.ts` (23 test, luồng nghiệp vụ; dịch vụ định tuyến M14 là HTTP server cục bộ thật; ví nạp bằng ghi sổ thử nghiệm) và `tests/integration/m07-topup-upgrade.int.spec.ts` (7 test: gỡ M07 bằng Down, nạp TOPUP thật qua Shipper → Admin xác nhận, áp M07, so sánh nguyên trạng, nạp tiếp, nhận đơn/giữ hoa hồng/hoàn thành trừ một lần/hủy/thất bại giải phóng, nguồn ledger sai bị chặn, Down bị chốt chặn).
