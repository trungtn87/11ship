# M04-B2.2a — Quyền tài chính Admin + cấu hình tài khoản nhận của hệ thống (18/10/2026)

Nguồn: `docs/tasks/M04-B2-2-admin-topup-settlement-20261018.md` (B2.2a), ADR-004 v0.2 §9. **Chỉ backend/DB. Không mở cổng ledger, không cộng ví, không bật nhận tiền.**

## Migration `1793664000000_create-admin-finance-grants.sql` (additive)
`app.admin_finance_grants (user_id, permission_key)`: FK `admin_memberships`, `state GRANTED|REVOKED`, `granted_by/at`, `revoked_by/at` (REVOKED có đủ cả hai), `version`. Trigger: chỉ membership **ADMIN** mới được giữ quyền (SYSTEM có quyền ngầm, không có dòng), danh tính bất biến, version +1, không DELETE/TRUNCATE. `permission_key` chỉ kiểm định dạng nên gói sau thêm khóa không cần đổi schema. Down: khóa ACCESS EXCLUSIVE, từ chối `FINANCE_GRANTS_DOWN_REFUSED` nếu có **bất kỳ** dòng (kể cả REVOKED); rỗng thì gỡ sạch, không CASCADE.

## Quyền (default deny)
- Cấp được hôm nay: `wallet.read`, `wallet.topup.record`. Tên dự trữ (`wallet.withdrawal.process|confirm|reconcile`, `wallet.adjustment.post`, `driver.bank.read`) bị từ chối khi cấp cho đến khi gói của chúng định nghĩa.
- Không suy ra từ `can_view`, `can_review_profile`, `can_lock`, menu hay quyền Shipper M03; `app.admin_app_permissions` và snapshot invitation M01 không đổi.
- `FinanceAccessParticipant.require(context, lockedActor, key, nowMs)` — lệnh tài chính sau này gọi **trong transaction, sau khóa actor + giờ DB**: SYSTEM luôn qua; ADMIN cần dòng GRANTED, khóa `FOR SHARE` đến hết transaction nên revoke (`FOR UPDATE`) chờ lệnh đã qua kiểm tra, lệnh bắt đầu sau revoke bị `ADMIN_FORBIDDEN`.
- Thứ tự khóa của cấp/thu hồi: idempotency → user/membership/factor/session SYSTEM → user đích `FOR UPDATE` → membership đích `FOR UPDATE` → dòng quyền `FOR UPDATE` → audit/outbox/idempotency.

## Route (`/v1/admin/finance`, cookie phiên + CSRF + Origin; kiểm lại dưới khóa)
| Route | Ai |
|---|---|
| `GET access/me` | mọi phiên admin hợp lệ: quyền của chính mình (SYSTEM: ngầm đủ) |
| `GET access/admins/:user_id` | SYSTEM: các quyền của một ADMIN (`NONE/GRANTED/REVOKED`, version) |
| `POST access/admins/:user_id/grant` / `revoke` | SYSTEM: `{permission_key, expected_version}` (0 khi chưa có dòng) + Idempotency-Key; `FINANCE_VERSION_CONFLICT`, `FINANCE_GRANT_STATE_CONFLICT`, `FINANCE_ADMIN_NOT_FOUND` (SYSTEM/không tồn tại/user thường); cấp cho admin bị khóa bị từ chối, thu hồi vẫn được |
| `GET bank-accounts`, `GET bank-accounts/:account_id` | SYSTEM |
| `POST bank-accounts` | SYSTEM: `{bank_id, account_number, account_holder}` + Idempotency-Key. **Luôn tạo `can_receive=false`**; trùng (bank, số) → `FINANCE_BANK_ACCOUNT_EXISTS`; audit/outbox chỉ mang id + bank, không có số/tên chủ TK |
Không có route bật nhận tiền, sửa hay xóa tài khoản; không route Admin xác nhận/từ chối nạp.

## Quyền DB runtime
`admin_finance_grants`: `SELECT, INSERT, UPDATE`. `system_owned_bank_accounts`: `SELECT, INSERT` (**không UPDATE** → runtime không bật được `can_receive`). Ví, ledger, topup, bank record: không đổi (cổng ledger A1 giữ nguyên). B2.1 vẫn từ chối tạo yêu cầu khi chưa có tài khoản `can_receive=true`.

## Mở B2.2b cần
Lệnh Admin confirm/reject gọi `FinanceAccessParticipant.require(..., 'wallet.topup.record' | 'wallet.read')`; SYSTEM command bật/tắt `can_receive` (versioned, audited, UPDATE grant riêng); migration atomic mở `wallet_ledger_source_gate()` cho TOPUP và quyền ghi tối thiểu.
