# M04-C — hoàn thiện module Ví Shipper (Issue #136)

Một gói triển khai duy nhất: nối 7 màn hình ví của app 11Ship vào server thật, rút tiền Shipper ↔ Admin ↔ DB, màn hình tài chính Admin Web, hoa hồng cấu hình theo phiên bản và cổng kích hoạt M03 theo số tiền đã nạp thật. Không đổi M07 (ngoài nguồn hoa hồng), M03 hay 5 tab của app.

## Preflight (Đã có / Thiếu / Sẽ nối / Phụ thuộc)

| Phần | Đã có | Thiếu | Nối trong gói này | Phụ thuộc |
| --- | --- | --- | --- | --- |
| Ví, sổ cái, hold, nạp tiền, sổ ngân hàng IN | A1, A2.1, B1, B2.1, B2.2a/b | Đường OUT, rút tiền | Bảng `wallet_withdrawals`, event, hold `WITHDRAWAL`, `WITHDRAWAL_DEBIT`, bản ghi OUT | Migration `1794182400000` |
| App Shipper (7 màn hình ví) | UI + nguồn giả | Nguồn thật | `HttpWalletSource` qua `SessionController.protectedCall` | `driver/wallet/*` |
| Admin Web tài chính | Quyền, tài khoản nhận, ghi nhận nạp | Tổng quan, ví, rút tiền, giao dịch, đối soát | Màn hình + API đọc theo cursor | `admin/finance/*` |
| Hoa hồng | Hằng 1.000đ | Cấu hình | `wallet_commission_policies` (append-only, version), chụp vào lượt nhận đơn | M07 giữ nguyên reserve/capture-once/release |
| Kích hoạt M03 | Duyệt không cần tiền | Nguồn tiền | Duyệt cần ≥ 100.000đ đã nạp xác nhận (`DRIVER_FUNDING_REQUIRED`), không cộng đôi | B2.2b |

## Routes

Shipper (`driver/wallet`, cho phép tài xế bị khóa xem/hủy): `GET ""`, `GET holds`, `GET transactions`, `GET withdrawal-account`, `GET|POST withdrawals`, `GET withdrawals/:id`, `POST withdrawals/:id/cancel`.

Admin (`admin/finance`): `withdrawals` (list/đọc), `withdrawals/:id/start-processing|mark-paid|report-reconciliation|reconcile`, `overview`, `wallets`, `wallets/:driver_id`, `transactions`, `reconciliation`, `reconciliation/check`, `commission-policy` (GET/POST).

## Quyết định nghiệp vụ

- Rút tối thiểu 10.000đ, từ tài khoản ngân hàng đã VERIFIED (M03); ảnh chụp tài khoản bất biến; giữ tiền (hold) ngay khi tạo; chỉ hủy khi PENDING.
- Admin chuyển tiền ngoài hệ thống. PAID ⇒ hold CAPTURED + đúng một `WITHDRAWAL_DEBIT` + một bản ghi OUT; RECONCILIATION giữ hold ACTIVE; kết quả cuối `CONFIRMED_PAID` / `CONFIRMED_NOT_SENT_FINAL` (hủy, trả hold, không trừ).
- Mã giao dịch ngân hàng ra là duy nhất toàn hệ thống (cùng sổ đăng ký với IN).
- Quyền tài chính tách riêng, chỉ SYSTEM cấp.

## Chưa được Owner duyệt — hệ thống từ chối an toàn (fail-closed)

- Không có API điều chỉnh số dư (adjustment).
- Không hỗ trợ chuyển một phần: số tiền lệch với yêu cầu ở lại RECONCILIATION.
- Không tải ảnh chứng từ / không tạo mã QR giả; app chỉ hiện thông tin chuyển khoản thật.
- Lịch sử trong app tải từng trang 50 dòng theo cursor của server; nút "Tải thêm" xem được toàn bộ lịch sử, không giới hạn 200 dòng.
- Quyền tiền toàn hệ thống của SYSTEM giữ nguyên.
- Phát hiện lệch (drift) chỉ báo cáo, không tự sửa.

## Migration

`1795132800000_create-wallet-withdrawals.sql` (up/down/up đã kiểm). Down có chốt chặn: từ chối khi đã có yêu cầu rút. Ops grants cập nhật trong `ops/selfhosted/02-runtime-grants.sql`. Không chạy migration production trong gói này.
