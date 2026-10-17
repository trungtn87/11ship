# M04-B1 — Lõi nguồn tiền nạp và chứng từ ngân hàng (17/10/2026)

Nguồn: `docs/tasks/M04-B-topup-implementation-20261017.md`, ADR-004 v0.2 §4–6. Chỉ B1: **schema + ràng buộc + test + quyền chỉ đọc**. Không controller, không API tiền, không UI, không ghi được tiền.

## Đã có (migration `1793577600000_create-wallet-topup-sources.sql`, không sửa migration cũ)
- `app.system_owned_bank_accounts`: tài khoản nhận tiền **của hệ thống** (bank, số TK, chủ TK, `can_receive`); danh tính bất biến, không xóa; **không có dòng nào** (không bịa số TK); chỉ tài khoản `can_receive` mới nhận được bản ghi ngân hàng.
- `app.wallet_topup_requests`: yêu cầu nạp (wallet+driver nhất quán qua FK ghép, số tiền yêu cầu bất biến, PENDING→CONFIRMED|REJECTED|CANCELLED một lần, không xóa). Yêu cầu **không** cộng ví. CONFIRMED khi và chỉ khi có đúng một topup của chính ví đó (kiểm tại COMMIT).
- `app.wallet_bank_transactions`: registry dùng chung (IN; OUT bị chặn đến khi M04-C có nguồn). Định danh chuẩn UNIQUE `(bank_id, system_owned_account_id, canonical_transaction_id)`: không chứa driver/admin/yêu cầu; ID chỉ cắt biên (database từ chối khoảng trắng biên/ký tự điều khiển, không đổi chữ hoa/thường, không bỏ số 0). Append-only. Hai FK ghép DEFERRABLE hai chiều với topup (cùng số tiền thực nhận).
- `app.wallet_topups`: tiền **đã xác nhận nhận** (số thực nhận, `received_at`, người xác nhận, tùy chọn gắn yêu cầu, UNIQUE theo bank record). Append-only.
- `app.wallet_ledger_entries.topup_id`: cột nguồn typed + `CHECK (kind='TOPUP') = (topup_id IS NOT NULL)` + UNIQUE + FK ghép `(topup_id, wallet_id, delta_vnd) → wallet_topups` DEFERRABLE: đúng topup, đúng ví, đúng số tiền; tối đa một credit. Kind khác không giả nguồn.
- Bất biến tại COMMIT: mỗi topup có **đúng một** credit ledger cùng số tiền; yêu cầu liên kết phải CONFIRMED; ví vẫn thỏa `balance = SUM(ledger)` và `held = SUM(hold ACTIVE)`.
- **Cổng ledger của A1 không đổi** (vẫn từ chối mọi INSERT ledger). Vì topup không thể commit thiếu credit nên không có topup/bank record/CONFIRMED nào tồn tại được: đóng bằng toàn vẹn, không chỉ bằng quyền.
- Quyền runtime: chỉ `SELECT` trên 4 bảng mới; không UPDATE ví, không INSERT ledger/topup/registry. (Ma trận quyền buộc mỗi bảng có một dòng nên cả bốn có SELECT; B2/B3 điều chỉnh.)
- Down: khóa ACCESS EXCLUSIVE; từ chối `WALLET_TOPUP_DOWN_REFUSED` nếu có bất kỳ tài khoản hệ thống, yêu cầu (kể cả CANCELLED), bản ghi ngân hàng, topup hay credit ledger; rỗng thì gỡ cột/ràng buộc/bảng, không CASCADE, A1/A2.1/M03 không đổi.

## Còn lại
- **B2**: thay `wallet_ledger_source_gate()` trong **một migration atomic** để chỉ chấp nhận kind TOPUP có topup tương ứng; cấp quyền hẹp (INSERT request/topup/registry/ledger, UPDATE ví/request); service, API Shipper (tạo/xem/hủy), Admin xác nhận (quyền `wallet.topup.record`), idempotency, audit/outbox; tạo cấu hình tài khoản nhận tiền thật (SYSTEM).
- **B3**: nối app 11Ship và Admin Web; ảnh chứng từ chỉ khi có storage private.
- Không kích hoạt Shipper (M03 NEW_TOPUP/EXISTING_FUNDS) và không đổi `DRIVER_WALLET_PORT`.
