# M04-B2.1 — Shipper tạo, xem, hủy yêu cầu nạp tiền (backend) — 18/10/2026

Nguồn: `docs/tasks/M04-B2-1-shipper-topup-request-backend-20261018.md`, ADR-004 v0.2, M04-B1. **Chỉ backend; yêu cầu nạp không cộng ví, không ghi ledger.**

## Route (client session, Bearer; app SHIP + context DRIVER + role DRIVER còn hiệu lực + Shipper chưa CLOSED)
Tiền tố `/v1/driver/wallet`. PENDING được phép (nạp là điều kiện để được xét kích hoạt). Không nhận driver/wallet/user id từ client.
| Route | Mô tả |
|---|---|
| `GET topup-receiving-accounts` | Tài khoản nhận của hệ thống có `can_receive=true` ({bank_id, account_number, account_holder}); rỗng nếu chưa cấu hình. Không có số giả. |
| `GET topup-requests?status&limit&cursor` | Danh sách của chính Shipper, mới nhất trước, `limit` 1..50 (mặc định 20), `next_cursor`. Không tạo ví. |
| `POST topup-requests` | Body đúng `{amount_vnd}` (số nguyên an toàn ≥ 1) + `Idempotency-Key`. Mức tối thiểu đọc từ `shipper_wallet_parameters.topup_min_vnd` lúc tạo (`TOPUP_AMOUNT_BELOW_MINIMUM`). Chưa có tài khoản nhận → `TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED`, không ghi gì. 201 `{request_id, amount_requested_vnd, state, version, created_at, resolved_at}`. |
| `GET topup-requests/:request_id` | Chỉ chủ sở hữu; request của người khác/không tồn tại/id sai định dạng đều là `404 TOPUP_REQUEST_NOT_FOUND`. |
| `POST topup-requests/:request_id/cancel` | Body đúng `{expected_version}` + `Idempotency-Key`. Chỉ PENDING → CANCELLED (`resolved_by`=người hủy, `resolved_at`=giờ DB, version+1). Đã đóng → `TOPUP_REQUEST_STATE_CONFLICT`; sai version → `VERSION_CONFLICT`. |

## Giao dịch
Executor idempotency → khóa user → session hiện tại → driver `FOR UPDATE` → (ví 0đ tạo cùng transaction) → request → audit → outbox (chỉ `request_id, state, version`). Replay kiểm lại quyền hiện tại. Hủy dùng UPDATE có điều kiện `state='PENDING' AND version=$n` nên thắng/thua với Admin (B2.2) do database quyết định.

## Quyền DB
`wallet_topup_requests`: `SELECT, INSERT, UPDATE` (không DELETE). Các bảng B1 khác vẫn `SELECT`; không UPDATE ví, không INSERT ledger/topup/bank record; cổng ledger A1 không đổi.

## Phụ thuộc B2.2
Admin `wallet.topup.record` + SYSTEM cấu hình tài khoản nhận; xác nhận thực nhận (bank identity, số tiền thực nhận) và mở `wallet_ledger_source_gate()` cho TOPUP trong một migration atomic cùng quyền hẹp; Admin từ chối. B3: nối app/Admin Web.
