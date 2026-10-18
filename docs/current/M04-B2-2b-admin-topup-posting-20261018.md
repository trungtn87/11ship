# M04-B2.2b — Admin đối soát nạp tiền và ghi ví TOPUP (2026-10-18)

## Phạm vi
Admin có quyền `wallet.read` xem, có quyền `wallet.topup.record` xác nhận (cộng ví theo **số tiền thực nhận**) hoặc từ chối yêu cầu nạp của Shipper. SYSTEM bật/tắt tài khoản nhận tiền. Không UI/APK/SMS/bank gateway, không kích hoạt Shipper, không mở loại ledger nào ngoài `TOPUP`.

## Route (`/v1/admin/finance`)
| Route | Quyền |
|---|---|
| `GET topup-requests?status&limit&cursor`, `GET topup-requests/:id` | `wallet.read` (SYSTEM ngầm định) |
| `POST topup-requests/:id/confirm` `{expected_version, actual_amount_vnd, bank_id, system_owned_account_id, canonical_transaction_id, received_at}` | `wallet.topup.record` |
| `POST topup-requests/:id/reject` `{expected_version, reason_code}` | `wallet.topup.record` |
| `POST bank-accounts/:id/receiving` `{expected_version, can_receive}` | chỉ SYSTEM |

Mọi ghi: cookie phiên + Origin + CSRF + `Idempotency-Key`; quyền hỏi lại **dưới khóa** (FOR SHARE) trong mỗi lệnh và khi replay.

## Giao dịch xác nhận (một transaction)
Thứ tự khóa (ADR-004): idempotency → admin (user/membership/factor/session) → quyền tài chính → `drivers` FOR UPDATE → request FOR UPDATE → ví FOR UPDATE → tài khoản nhận FOR SHARE → bank record (`ON CONFLICT DO NOTHING`) → topup → ledger `TOPUP` → số dư ví → request `CONFIRMED` → audit → outbox → bản ghi idempotency. Lỗi ở bất kỳ bước nào rollback toàn bộ.

* Một giao dịch ngân hàng ghi một lần toàn hệ thống: khóa duy nhất `(bank_id, system_owned_account_id, canonical_transaction_id)`; thua → `409 BANK_TRANSACTION_ALREADY_RECORDED`, không ghi gì.
* Chỉ cộng số thực nhận; số yêu cầu giữ nguyên. Vượt trần ví → `409 TOPUP_WALLET_LIMIT_EXCEEDED`.
* Hồ sơ Shipper `CLOSED` không được cộng (`DRIVER_STATE_CONFLICT`), vẫn từ chối được yêu cầu. Trạng thái hồ sơ khác không bị đổi.
* Audit/outbox chỉ có định danh, trạng thái, phiên bản, số tiền; không có số tài khoản, tên chủ tài khoản, mã giao dịch.

## Migration `1794009600000_open-topup-ledger-gate`
Thay `wallet_ledger_source_gate`: chỉ cho ledger `TOPUP` có `topup_id` trỏ tới `wallet_topups` cùng ví và đúng số tiền; mọi loại khác vẫn bị từ chối. Down từ chối (`WALLET_TOPUP_POSTING_DOWN_REFUSED`) nếu đã có ledger/topup/bank record. Các ràng buộc B1 (chuỗi ledger, deferred check, FK, append-only) giữ nguyên.

## Grants (runtime role)
`driver_wallets` +UPDATE; `wallet_ledger_entries` +INSERT; `wallet_bank_transactions`, `wallet_topups` +INSERT; `system_owned_bank_accounts` +UPDATE. Không DELETE ở đâu.

## Chính sách tiền về muộn cho tài khoản đã tắt
Fail closed: không ghi nhận được khi tài khoản `can_receive=false` (registry gate B1 không nới). Cách xử lý: SYSTEM bật lại tài khoản (có version, audit), Admin xác nhận, SYSTEM tắt lại.

## Còn phụ thuộc
UI Web Admin / APK (B3); kích hoạt Shipper (M03) chưa nối; rút tiền, hoa hồng, điều chỉnh, hold (A2.2/M04-C) vẫn đóng.
