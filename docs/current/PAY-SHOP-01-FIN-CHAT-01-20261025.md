# PAY-SHOP-01 (#198) + FIN-CHAT-01 (#199) — implementation note, 2026-10-25

One branch/PR for both issues because they share the shop payment request. Reuses M04 (wallet/top-up), Admin finance permissions, M08 notifications and the #191 chat foundation. The order chat is unchanged except for the shared Flutter/Admin chat widgets now accepting the two payment room kinds.

## Rules implemented

**Payment (#198)**
- The shop creates a payment request (`purpose` ACCOUNT_OPENING / MENU_EXPANSION / OTHER, amount entered by the shop — no amount is hardcoded), transfers money OUTSIDE the app, then taps "Tôi đã chuyển khoản" (`reported_at`, once). Reporting changes no money, no right and no ledger.
- An administrator with `shop.payment.record` records the money received (actual amount, bank transaction id, received time, system account). One immutable settlement per request; the bank identity `(bank_id, account, transaction id)` is unique across Shipper top-ups AND shop payments (advisory lock + trigger), so one transfer cannot pay twice or pay both.
- Opening the account / granting the dish right is a SEPARATE act (`shop.entitlement.manage`, append-only GRANT/REVOKE with a mandatory reason; may name a CONFIRMED payment once). Confirming money never grants anything.
- No subscription, renewal, expiry, shop wallet or auto-charge.
- Menu: at most 20 VISIBLE dishes without the manual expansion right; HIDDEN dishes do not count; the check runs under the shop row lock so parallel creates/shows cannot exceed it; revoking the right never deletes or hides dishes. The #190/#195 shop readiness guards are unchanged and a payment report/confirmation does not bypass them.

**Payment chat (#199)**
- One room per `DRIVER_TOPUP` or `SHOP_PAYMENT` request, separate from order chat. Card "Trao đổi thanh toán" on 11Ship (top-up), 11Food (shop payment) and Web Admin (both details).
- Text only, ≤ 500 chars, rendered as text everywhere. System milestones come from real events (created, reported, money confirmed, rejected, cancelled, account/right opened).
- Cursor paging, `Idempotency-Key` per message (retry never duplicates), per-sender rate limit, offline outbox on the apps.
- A terminal request (confirmed / rejected / cancelled) locks sending atomically (request row FOR SHARE vs state UPDATE); history stays readable.
- M08 notifies the right person (administrator → shop/shipper; shop/shipper → handling administrators), collapsed card per room. A chat message never confirms money, credits a wallet or grants a right.
- Retention: NOT applied. 90 days is only a proposal; nothing purges.

## Admin permissions (new keys)
`shop.payment.read`, `shop.payment.record`, `shop.entitlement.manage`. SYSTEM has them implicitly. Read-only administrators see requests and the room but no money/right/composer controls; the server refuses their writes anyway.

## API (summary)
- Shop: `/v1/shop/me/payment-receiving-accounts`, `/v1/shop/me/payment-requests` (+ `/{id}`, `/{id}/report-transfer`, `/{id}/cancel`, `/{id}/chat`); menu `limits` report the dish quota.
- Shipper: `/v1/driver/wallet/topup-requests/{id}/report-transfer`, `/{id}/chat`.
- Admin: `/v1/admin/shop-payments` (+ `/{id}`, `/{id}/confirm`, `/{id}/reject`, `/shops/{shop}/entitlements`, `/shops/{shop}/menu-expanded/{change}`, `/receiving-accounts`), chat at `/v1/admin/shop-payments/{id}/chat` and `/v1/admin/finance/topup-requests/{id}/chat`.
- Migration: `database/migrations/1796688000000_create-payment-requests-chat.sql` (new; merged ones untouched), grants in `ops/selfhosted/02-runtime-grants.sql`, manifest entry added.

## How the Owner can try it (local)
Backend + PostgreSQL as in `AGENTS.md`; Admin Web via `npm run admin-web:dev`; Flutter apps from `mobile/food`, `mobile/ship`. Shop: Quản lý quán → "Thanh toán" → create request → report. Admin: Tài chính → "Thanh toán quán" → open request → record money → (separately) "Cấp quyền".

## Limitations / not done
- No VPS deploy, no migration on staging, no real notifications sent, no store release.
- Evidence so far is local/CI on the code SHA stated in the PR report; the VPS is not claimed to work.

## Business decisions still open (not invented)
1. Fee amounts per purpose and whether the 20-dish cap should be configurable.
2. Chat retention period (90 days is a proposal) and whether production purge is enabled.
3. Store-policy review of in-app payment wording for Play/App Store.
4. Admin push channel for new reports (currently the queue + M08 inbox).
5. Whether "mở tài khoản" stays inside Quản lý quán or moves to a dedicated screen.
