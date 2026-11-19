# M04 — SePay automatic inbound top-ups (implementation handoff, 2026-11-19)

**Status:** Owner-approved scope in [#403](https://github.com/trungtn87/11ship/issues/403). **This document is a handoff, not implemented code.** Claude Code local is the sole assigned implementer on this draft PR; finish backend + Flutter + tests in the same branch. No merge/deploy/live money without Owner approval.

## Locked product behavior
- 11Ship **in-app** balance top-up for service-fee deductions. **MB Bank account main number → SePay webhook**; a new bank account will be created at launch.
- Shipper enters amount (existing DB minimum), creates current pending top-up request, sees MB recipient + **VietQR exact amount and unique transfer content** `NAP...`. Only the bank webhook can trigger **automatic** credit; manual Admin confirmation remains the fallback for anomalies.
- No payout API, no VA, no automated periodic bank reconciliation, no new wallet, no 11Food merchant payment integration. No fee/commission/driver eligibility semantic change. No credit for transfer screenshots or self-reported transfer.
- Automatic top-up can be disabled without breaking manual top-ups; default **disabled** before bank + webhook credentials and real-account acceptance.

## Current code (verified against main 9b3c0c23b1de76f3363f8cf6e9aec5b47750e4ff)
- Request creation already exists: `apps/backend/src/wallet-topup/{topup-request-service.ts,topup-transfer-code.ts,wallet-topup.controller.ts}`. `topupTransferCodeOf` = `NAP` + first 10 hex of request UUID. **Check collision** on new request creation (40-bit prefix is not guaranteed globally unique): add constraint or deterministic generation with DB-enforced uniqueness; preserve old request codes and ensure bank parsing is exact.
- System receiving accounts exist: `app.system_owned_bank_accounts`, listed via `GET /v1/driver/wallet/topup-receiving-accounts`; account is configured by SYSTEM and `can_receive`.
- Existing money participant: `apps/backend/src/wallet/topup-posting-service.ts` + `topup-settlement-repository.ts`; bank record ↔ topup ↔ ledger ↔ wallet balance have strict FK/deferrable invariant. **Reuse exactly one posting path.** Do not create a second wallet credit writer or silently change old migrations.
- Manual Admin settlement: `apps/backend/src/admin-topups/admin-topup-service.ts`. Review `#256` delayed-transfer/CLOSING decisions and honor them.
- UI `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart` has existing bank-transfer info, pending/detail, a QR placeholder, and wording “Admin sẽ kiểm tra”; `wallet_http.dart` already reads request code. Replace the placeholder only when server returns a valid payment destination. Keep the existing `WalletSource`/session epoch contract and fit the Wallet area being changed in draft PR #401.
- DB current `resolved_by_user_id` on `wallet_topup_requests`, and `confirmed_by_user_id` on `wallet_topups` are user FKs. **Webhook is not a human Administrator.** Use an additive migration for an explicit automated settlement actor (type/source/ID), retain existing manual Admin user references and ensure CHECKs, FKs, deferred triggers, audit/outbox are valid for both. Never insert fake Admin user or attribute automatic actions to an existing person.

## Suggested integration boundary
1. `SePayWebhookController` public HTTPS POST at a dedicated /v1/integrations/sepay/transaction endpoint (exact path per repo conventions). This route does **not** use shipper/Admin session authentication. Instead verify mandatory `X-SePay-Signature: sha256=<hex>`, `X-SePay-Timestamp` and raw request body: HMAC_SHA256(secret, timestamp + '.' + raw_body); constant-time comparison; 5 minute timestamp freshness; reject unsigned/invalid/oversized requests. Ensure Nest middleware preserves **raw body bytes** before JSON parse; keep HMAC secret in VPS environment only. Limit requests by source where feasible.
2. Inbox table for **verified SePay inbound notifications** with unique provider+provider event ID scoped to linked account, received time, safe payload digest or encrypted raw payload, processing state/reason; no secrets or unmasked PII in logs. Track an independently **canonical bank transaction key** with unique constraint in existing `wallet_bank_transactions`, mapped reliably from SePay data; if bank identity missing/ambiguous, do not guess — manual review.
3. Validated inbound notification → receiving bank/account match exact SYSTEM-configured enabled MB main account → `transferType = in` → exact transfer code mapping to exactly one `PENDING` request → exact amount equal to requested → driver/account/eligibility checks under existing lock discipline. Use 1 SQL transaction for posting, state transition, audit/outbox, inbox status. For manual path, same canonical bank identity blocks double-credit between webhook and Admin.
4. **Manual exception queue:** verified incoming money with wrong/no code, wrong amount, unexpected account, cancelled/rejected/late request, closed driver, duplicate bank key or anything ambiguous goes to admin review with reason. Never automatically assign money to a different shipper, silently ignore a real transfer, auto-refund, or auto-credit a cancelled request. Admin resolves using existing finance permissions and settlement checks; keep audit trail and links to original SePay event. Differentiate a replay of an already confirmed payment from an unmatched new transfer.
5. Backend is server truth. Flutter requests existing status endpoint / refresh after return from bank; if offline or pending show “Chưa xác nhận”, not fabricated success. On confirmed update balance and history. Update copy from Admin-only language to “Hệ thống sẽ tự xác nhận khi nhận được tiền; nếu có vấn đề, Admin sẽ đối soát”.
6. Configure `SEPAY_AUTO_TOPUP_ENABLED=false` by default + `SEPAY_WEBHOOK_SECRET` (no real value in repo), receiving-account mapping, bank link and Nginx HTTPS. No production connection or receiving-account creation in code. If missing config or verification fails, fail closed and preserve manual path. Document runbook for staged activation/rollback and human reconciliation.

## Data/invariants & dangerous races
- `wallet_bank_transactions` currently requires a posted topup for an IN bank record: **do not misuse it to store an unmatched webhook**. Use separate inbox for verified unmatched money, then settle atomically when reconciled. Preserve every existing immutable ledger rule.
- Respect lock order ADR-004 3.1, defer business decisions until rows locked. Concurrent Admin confirmation / Shipper cancel / 2 identical webhook deliveries / distinct notifications of same bank transaction: **at most one** topup and one TOPUP ledger credit. Replay is harmless and returns success after durable processing (not before).
- An already created request may receive money after account starts CLOSING; no new request allowed. Define any exceptional bank arrival per #256 (do not silently reject or credit if guard forbids), route to Admin; if driver CLOSED never auto-credit.
- Exact amount only for automatic settlement. Excess/short and wrong code → verified inbox review. No balance update without matching bank evidence and a transaction committed successfully.
- Sensitive event payload minimization, API/provider identity normalization, migration compatibility with existing admin rows, capacity for rollback by disabling auto mode (NOT dropping history).

## Tests / delivery gates
- Focused tests: signed+valid inbound transfer → 1 ledger credit, request CONFIRMED, wallet invariant; duplicates/replay/racing Admin confirm and cancel; tampered body/invalid HMAC/expired timestamp/outbound transfer/unrecognized account/mismatched amount/code/no canonical bank transaction id → **zero automatic credits**. DB transaction rollback, uniqueness and metadata attribution under real migration schema.
- Test inbox anomaly + manual Admin path without double posting; verify CLOSING and delayed payments, wrong-user sessions and logout; Flutter shows real VietQR info, never reports success merely because transfer screen was opened.
- Tests: Nest unit + affected integration DB migration, Flutter focused tests/analyze, CI on head SHA. Antigravity cross-flow/E2E then Codex audit of money/security/DB, as governed.
- Acceptance after Owner separately authorizes real account test: MB connected per https://docs.sepay.vn/ket-noi-mb-api.html → SePay HMAC webhook HTTPS → one small controlled inbound deposit → server ledger/balance and Admin evidence verified; duplicate webhook must not double-credit. No background polling/reconciliation job in this scope.

## Provider specifications (re-verify when coding)
- https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc — HMAC raw-body signature and timestamp.
- https://developer.sepay.vn/vi/sepay-webhooks/bao-mat — replay, dedup, account/amount checks.
- https://docs.sepay.vn/ket-noi-mb-api.html — MB linking to SePay via bank API.

## Agent assignment
- Owner approval: #403 and chat 19/11/2026.
- Executor: **Claude Code local (Windows)** only; start by reading AGENTS.md, CLAUDE.md, governance README/checklist, delivery rules, issue #403, and current PR head; run local sync guard preflight in the actual worktree. Do not overlap #401 changes; coordinate/merge UI only after inspecting latest head.
- This PR initially contains **design/handoff only**. Implementation, tests, CI and device acceptance are **NOT DONE / NOT TESTED** until executor updates the same PR. No merge, deploy, migration to production or AAB/APK publication without Owner approval.
