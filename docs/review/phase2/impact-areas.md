# G-6 Vùng tác động của 15 điểm nóng

**SHA khảo sát:** `549572696efb4bbc18af3c362b7f56a5fcd335e6` (`main`, merge PR #298) · **Graphify:** graphifyy 0.9.100 · **Ngày:** 2026-11-02 · **Người lập:** Claude Lead (Executor Phase 2)

**Cách đo:** từ file hạt nhân của từng điểm nóng, lấy bao đóng ngược trên đồ thị import file sản phẩm trong `apps/backend/src` (bỏ `*.spec`/fixture). Số liệu là **cận dưới**: DI bằng token `Symbol` (`useExisting`/`useFactory`) và luồng outbox không có cạnh import, nên bị bỏ sót (ví dụ H09 chỉ 8 file nhưng thực tế mọi producer outbox tác động tới nó). Phần client (Dart/web) chưa tính; tìm bằng chuỗi route.

| # | Điểm nóng | File hạt nhân | Trực tiếp | Bao đóng (file) | Thư mục bị tác động | Controller bị tác động | Ghi chú |
|---|---|---|---|---|---|---|---|

**Quy ước độ tin:** `ĐÃ MỞ SOURCE` = người lập đã đọc đoạn mã nêu (file:dòng). `CHỈ TỪ GRAPH` = chỉ thấy trong graph, chưa mở source, không được xếp vào finding. `HEURISTIC` = suy từ script đọc source nhưng chưa đọc từng dòng.

| H01 | Ví (số dư, ledger, hold) | `wallet/wallet-service.ts`, `wallet/wallet-repository.ts`, `wallet/wallet-types.ts` | 18 | 113 | delivery(21), wallet(9), notifications(8), orders(8), admin-finance(5), order-chat(5), driver-wallet(5), wallet-topup(4) | 26 | Wallet được dùng qua cổng `useExisting` nên số thật lớn hơn; M11 điều chỉnh tiền đi vào qua `COMMISSION_ADJUSTMENT_PORT` |
| H02 | Đơn hàng (tạo, sửa, hủy) | `orders/order-customer-service.ts`, `orders/order-rules.ts` | 6 | 18 | orders(6), delivery(3), address-change(2), admin-orders(2), main.ts(1), app.module.ts(1), admin-auth(1) | 5 | Đặt đơn chỉ 18 file; chạm M14 (route), M05 (địa chỉ), M10 (chat) |
| H03 | OTP và đăng nhập | `auth/verification-service.ts`, `auth/login-service.ts` | 3 | 9 | account-recovery(3), auth(2), main.ts(1), app.module.ts(1) | 3 | Hẹp: 9 file; nhưng OTP còn đi qua SMS Gateway (nối động) |
| H04 | Phiên và phân quyền app | `auth/session-auth.guard.ts`, `auth/session-service.ts`, `auth/session-authorization-participant.ts` | 35 | 88 | delivery(8), onboarding(7), feedback(6), orders(6), notifications(5), driver-wallet(5), client-auth(4), order-chat(4) | 33 | Mọi route app dùng `SessionAuthGuard` (167); đổi guard = đổi toàn bộ API app |
| H05 | Hoa hồng và điều chỉnh | `wallet/commission-hold-service.ts`, `wallet/wallet-adjustment-service.ts`, `wallet/wallet-commission-adjustment.adapter.ts` | 9 | 58 | delivery(15), orders(8), order-chat(5), admin-orders(3), notifications(3), address-change(2), admin-deliveries(2), admin-feedback(2) | 14 | Hold ở `commission-hold-service` được gọi trong transaction nhận đơn (F3) |
| H06 | Nạp tiền và đối soát | `wallet/topup-posting-service.ts`, `wallet/topup-request-repository.ts`, `wallet/topup-settlement-repository.ts` | 8 | 51 | notifications(8), admin-finance(5), driver-wallet(5), wallet-topup(4), business-dashboard(3), admin-topups(3), wallet(3), delivery(3) | 7 | Quyền ví Admin (M04-R-15) cũng bám vào đây |
| H07 | GPS và vị trí shipper | `delivery/shipper-location.ts` | 10 | 57 | delivery(11), notifications(8), orders(7), ops-analytics(4), order-chat(4), admin-orders(3), admin-overview(3), shipper-self(3) | 19 | 19 controller; ảnh hưởng nhận đơn, tracking, M06 |
| H08 | Định tuyến (Valhalla/M14) | `delivery/m14-route-client.ts` | 8 | 33 | delivery(10), orders(5), discovery-route(3), notifications(3), address-change(2), admin-orders(2), order-chat(2), app.module.ts(1) | 8 | Một client duy nhất (xem F8): đổi hợp đồng `/route` ảnh hưởng 8 controller |
| H09 | Thông báo | `notifications/notification-event-service.ts`, `notifications/notification-signal.ts` | 3 | 8 | notifications(4), main.ts(1), app.module.ts(1) | 1 | **Cận dưới nặng**: producer outbox ở khắp nơi |
| H10 | Idempotency | `idempotency/idempotency-executor.ts` | 94 | 199 | delivery(15), orders(14), feedback(10), notifications(10), ops(8), client-auth(6), sms-gateway(6), ops-analytics(6) | 62 | Mọi mutation (M00-R-02): 62 controller |
| H11 | Giao dịch DB | `transaction/transaction-manager.ts` | 112 | 255 | delivery(15), orders(14), ops(12), admin-auth(12), feedback(10), notifications(10), sms-gateway(8), auth(8) | 68 | Mọi truy vấn: 68 controller |
| H12 | Vòng đời giao hàng | `delivery/delivery-shipper-service.ts`, `delivery/delivery-rules.ts` | 17 | 64 | delivery(15), orders(8), notifications(8), ops-analytics(4), order-chat(4), admin-orders(3), admin-overview(3), shipper-self(3) | 19 | Chạm M04, M06, M10, M14 |
| H13 | Phiên Admin | `admin-auth/admin-session-service.ts`, `admin-auth/admin-login-service.ts` | 3 | 7 | admin-auth(2), admin-monitoring(1), main.ts(1), app.module.ts(1) | 2 | Hẹp 7 file; nhưng `AdminTransport` ở `admin-shipper.controller` mới là điểm chung |
| H14 | Rút tiền | `wallet/withdrawal-money-service.ts`, `wallet/withdrawal-repository.ts` | 7 | 38 | notifications(8), driver-wallet(5), admin-finance(4), delivery(3), order-chat(3), address-change(1), app.module.ts(1), shipper-settlement(1) | 3 | 3 controller nhưng 18 thư mục |
| H15 | Outbox | `outbox/outbox-dispatcher.ts` | 1 | 5 | notifications(2), main.ts(1), app.module.ts(1) | 0 | Dispatcher; consumer duy nhất là M08 |

## Cách dùng
Trước khi sửa một điểm nóng ở Phase 8, lấy danh sách này làm **checklist test tối thiểu**; sau đó mở file thật vì đây là cận dưới. Hai điểm nóng thuộc tầng nền (H10 Idempotency, H11 Giao dịch DB) chạm gần như toàn backend nên chỉ sửa với test hồi quy đầy đủ.

## Danh sách controller đầy đủ
Nằm trong `impact.json` (cùng thư mục reports). Để file Markdown gọn, báo cáo chỉ đếm.
