# M04 — SePay automatic inbound top-ups (implementation handoff, 2026-11-19)

**Status:** Owner-approved scope in [#403](https://github.com/trungtn87/11ship/issues/403). **This document is a handoff, not implemented code.** Claude Code local is the sole assigned implementer on this draft PR; finish backend + Flutter + tests in the same branch. No merge/deploy/live money without Owner approval.

**Owner decision change (2026-11-19):** a periodic reconciliation job **is now in scope** as a safety net for missed or delayed webhooks. The earlier "no automated reconciliation" decision is withdrawn. Everything else in the locked behavior below is unchanged.

## Locked product behavior
- 11Ship **in-app** balance top-up for service-fee deductions. **MB Bank main account → SePay**; a new bank account will be created at launch.
- Shipper enters amount (existing DB minimum), creates current pending top-up request, sees MB recipient + **VietQR exact amount and unique transfer content** `NAP...`. Only verified bank evidence (webhook or reconciliation pull from the same SePay account) can trigger **automatic** credit; manual Admin confirmation remains the fallback for anomalies.
- No payout API, no VA created by us, no new wallet, no 11Food merchant payment integration. No fee/commission/driver eligibility semantic change. No credit for transfer screenshots or self-reported transfer.
- **Matching rule (strict):** transfer code (`NAP…`) exact match + amount exactly equal to the request + the receiving account is the configured MB main account. No matching by amount + time, no regex on transfer content. Transfer code must be at the **start** of the transfer content and contain only uppercase letters and digits (no diacritics, no spaces, no symbols).
- Anomalies (wrong/missing/extra/short amount, wrong or missing code, late or duplicate payment) → **Admin manual reconciliation**. Never auto-credit these.
- Automatic top-up can be disabled with `SEPAY_AUTO_TOPUP_ENABLED=false` (default) without breaking manual top-ups. Fail closed when `SEPAY_WEBHOOK_SECRET` or `SEPAY_API_KEY` is empty.
- Not yet enabled: no real money, no live flag, no production connection in this PR.

## SePay provider facts (verified 2026-11-19 from SePay docs; re-verify before enabling)

Sources: developer.sepay.vn `/vi/sepay-webhooks/tich-hop-webhook`, `/vi/sepay-webhooks/xac-thuc`, `/vi/sepay-webhooks/xu-ly-loi`, `/vi/sepay-webhooks/bao-mat`, `/vi/sepay-api/v2/giao-dich/danh-sach`, `/vi/sepay-api/v2/xac-thuc`; docs.sepay.vn `/ket-noi-mb-api.html`, `/tao-qr-code-vietqr-dong.html`.

### A. Webhook payload (`tich-hop-webhook`)
JSON body fields (all 12 documented):

| field | type | notes (as documented) |
| --- | --- | --- |
| `id` | integer, not null | SePay transaction ID; **unchanged across retries and replays**; SePay recommends using it as dedup key |
| `gateway` | string, not null | bank name, e.g. `Vietcombank` |
| `transactionDate` | string, not null | `YYYY-MM-DD HH:mm:ss`, Vietnam time |
| `accountNumber` | string, not null | bank account number |
| `subAccount` | string, may be `""` | matched VA; empty if none |
| `code` | string, **may be null** | payment code extracted from content **per the company's prefix configuration**; `null` when no configured pattern matches; null ≠ `""` |
| `content` | string, not null | original transfer content, unprocessed |
| `transferType` | string | `in` or `out` |
| `description` | string, may be `""` | full bank description; empty for banks that do not provide it |
| `transferAmount` | integer, not null | VND, always positive |
| `accumulated` | integer, may be 0 | balance after the transaction; 0 when bank does not provide it |
| `referenceCode` | string, may be `""` | bank reference code |

Example from the doc: `id 92704`, `gateway "Vietcombank"`, `transactionDate "2024-07-02 11:08:33"`, `accountNumber "1017588888"`, `code "SEVN63DC8E5C"`, `content "SEVN63DC8E5C chuyen tien"`, `transferType "in"`, `transferAmount 5000000`, `referenceCode "FT24012345678"`.

Implication: the webhook `id` is an **integer** (not UUID). Store it as the webhook event ID. Do not use `code` blindly: treat `null` and `""` as "no code" → manual queue.

### B. Authentication (`xac-thuc`)
Auth is chosen **per webhook** in SePay (None / API Key / HMAC-SHA256 / OAuth 2.0). Our choice: **HMAC-SHA256 (SePay-recommended)**.
- Headers SePay sends: `X-SePay-Signature: sha256={hex_hash}`, `X-SePay-Timestamp: {unix seconds}`.
- Signature: `HMAC-SHA256(SecretKey, "{timestamp}.{raw_body}")`, hex. The doc signs the **original body bytes**; never re-serialize a parsed body. Form-encoded webhooks are signed over the `http_build_query`-style string; we accept JSON only.
- Secret: stored in server env as `SEPAY_WEBHOOK_SECRET` (the doc's suggested name). SePay shows only the last 4 characters after save.
- Replay window: the security page says reject timestamps more than **5 minutes** from now, plus NTP on the server. The 5-minute rule is stated on `bao-mat`; the PHP sample in `xac-thuc` uses ±300 s.
- Not stated: hex case, signing for non-JSON bodies beyond the PHP note, IP allowlisting on this page (see D).
- API Key option (`Authorization: Apikey <key>`) is **not** used by us: it verifies the sender but does not protect the payload.

### C. Retry and delivery (`xu-ly-loi`, `tich-hop-webhook`)
- Success requires **all three**: HTTP `200` or `201`, body exactly `{"success": true}`, response within **30 seconds**. Anything else counts as failure (the doc lists 202, redirects, 4xx, 5xx, a different body, timeout).
- Connection failures (DNS, refused, timeout, SSL) are always retried.
- HTTP status outside 200–299 is retried only if the webhook has "auto-resend on server error" enabled.
- Schedule when retried: attempts at 0, +1, +1, +2, +3, +5, +8, +13 minutes (Fibonacci), i.e. 8 sends in total, about 33 minutes. Then the webhook is marked Failed.
- Webhooks older than 5 hours are **not** picked up by the retry cron.
- Ordering is **not guaranteed**: a retried older webhook can arrive after newer ones. Use `transactionDate` for ordering, not arrival order.
- Two webhooks to the same URL send two POSTs with the same `id`.
- Manual resend and replay exist in the SePay portal (not an API).
- Mismatch to keep in mind: `tich-hop-webhook` treats 202 as failure, `xu-ly-loi` retries only outside 200–299. Handle by always returning `200 {"success": true}` immediately after durable persistence.

### D. Rate limits and network (`xu-ly-loi`, `bao-mat`)
- Webhooks: SePay states there is no hard limit on the number of webhooks per company and "recommends keeping under 20" (the unit is not specified on the page). No request-rate limit stated for inbound posts.
- Webhook URL: publicly reachable HTTPS, valid certificate, private IPs rejected. SePay returns 403 for non-whitelisted IPs (the sender IP list is at `/vi/dia-chi-ip`, **not yet read** — open item).
- Our endpoint: rate-limit by source where feasible; reject oversized bodies.

### E. Transactions API v2 (`/v2/transactions`) — used by the reconciliation job
- Base URL: `https://userapi.sepay.vn/v2/transactions`. Production only was documented; a sandbox URL was not verified.
- Auth: `Authorization: Bearer {api_key}`; the key is a 64-char string from SePay "Cài đặt công ty > API Keys". Our env name: `SEPAY_API_KEY` (our naming; SePay does not define it).
- **Transaction `id` is a UUID string**, not an integer. It is a different identifier from the webhook `id`. Store the two separately (`sepay_webhook_event_id BIGINT`, `sepay_transaction_uuid UUID`); never compare them.
- Query parameters used: `since_id`, `per_page=100` (max 100), `page`, `transaction_date_sort=asc`, `transfer_type=in`, `timestamp_format=iso8601` (returns `+07:00`). Other filters exist; we do not use them.
- `since_id` semantics: returns transactions **recorded after** the given ID. An unknown ID returns an **empty list**. The doc does not say "inclusive/exclusive" explicitly; "after" is the stated meaning.
- Ordering: `since_id` does not change ordering; the default is newest first. The doc tells pollers to sort `transaction_date_sort=asc`, read **all** pages, then use the last transaction's `id` as the next `since_id`.
- Pagination: response contains `meta.pagination.has_more`, `total`, `per_page`, `current_page`, `last_page`. Our loop: follow pages until `has_more = false` **and** stop on an empty page. Behavior for `page > last_page` is not stated.
- Response fields used: `id` (UUID), `transaction_date`, `account_number`, `transfer_type`, `amount_in` (integer), `transaction_content`, `reference_number`, `code` (string or null), `bank_brand_name`, `bank_account_id` (UUID), `va_id` (UUID or null), `webhook_success`. Currency fields are integers. Other field types are inferred from examples, not formally documented.
- Rate limit: **3 requests per second per IP**. Checked before authentication. Over the limit returns HTTP `429` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Auth failure returns `401` (`error_code: unauthorized`). No per-minute or daily quota stated.

### F. Reconciliation rationale (`bao-mat`)
SePay's own guidance: a webhook can be lost if the endpoint is down more than 5 hours; recommended cron every 15–30 minutes that calls the transactions API and fills missing transactions. This is the basis of section 2 below.

### G. MB Bank linking and transfer content (`ket-noi-mb-api`, VietQR page)
- Linking uses the account number, CCCD/CMND (or tax code for business), phone and OTP. **No VA is required to link.** By default SePay receives credit/debit transactions on the **main account number** for MB API linking; this is why we use the main account.
- Official VA for MB can be added via "Thêm VA" (bank-generated, random number). Not used by this design. The legacy `TKP` prefix VA mechanism that authenticated by transfer content is being upgraded to official VA for MB accounts linked from 01/11/2024.
- **Not stated:** that a special prefix/format is required for MB incoming transfers to appear in SePay; that transfer content needs a SePay-side prefix; character/length rules for matching.
- VietQR generator page (`tao-qr-code-vietqr-dong.html`, the QR tool, not SePay matching): transfer content max **94** characters; Vietnamese diacritics and special characters are removed automatically; account number letters/digits only.
- Our rule (Owner-approved and conservative): build the `NAP…` code without diacritics and symbols, placed first in the transfer content.
- **Open:** whether SePay's `code` extraction for our company needs a configured prefix (the SePay doc ties `code` to "company prefix configuration"). Confirm in the SePay portal before acceptance; without it, `code` may be null and everything goes to manual review.

## Open items (must be closed before enabling; none block sandbox coding)
1. **Header/secret name for our endpoint:** `X-SePay-Signature` / `X-SePay-Timestamp` are confirmed; our env names (`SEPAY_WEBHOOK_SECRET`, `SEPAY_API_KEY`) are ours.
2. **Sender IP allowlist** (`/vi/dia-chi-ip`): not read yet.
3. **MB/VA:** no statement that MB needs a VA or a content prefix for SePay to see incoming transfers. Confirm in SePay portal with a real small transfer after activation; manual review covers any gap.
4. **SePay `code` prefix config:** how to configure the `NAP` prefix in the company settings. Not documented in the pages read.
5. **Canonical bank transaction key:** SePay does **not** document a dedup key across webhook and API. The webhook `id` and API `id` are different identifiers. Our bank key is **`referenceCode`/`reference_number` + `transferAmount`/`amount_in` + `accountNumber` + `transactionDate`**. Risk: `referenceCode` may be empty for some banks, and `transactionDate` has only second precision. If `referenceCode` is empty, the row goes to manual review (no guessing).
6. **since_id edge cases:** behavior when page > last_page and whether since_id is recorded-order or sort-order; plan: verify in sandbox with a fixed test sequence; if cursor returns empty for a known ID, alert and stop (never silently reset the cursor).
7. **Rate of 429 under our loop:** cron at 15–30 minutes with one IP and max 3 rps is well below the limit; no client-side throttle beyond a sleep between pages is planned.

## Current code (verified against main 9b3c0c23b1de76f3363f8cf6e9aec5b47750e4ff)
- Request creation already exists: `apps/backend/src/wallet-topup/{topup-request-service.ts,topup-transfer-code.ts,wallet-topup.controller.ts}`. `topupTransferCodeOf` = `NAP` + first 10 hex of request UUID. **Check collision** on new request creation (40-bit prefix is not guaranteed globally unique): add constraint or deterministic generation with DB-enforced uniqueness; preserve old request codes and ensure bank parsing is exact. Hex uppercase only, no separators.
- System receiving accounts exist: `app.system_owned_bank_accounts`, listed via `GET /v1/driver/wallet/topup-receiving-accounts`; account is configured by SYSTEM and `can_receive`.
- Existing money participant: `apps/backend/src/wallet/topup-posting-service.ts` + `topup-settlement-repository.ts`; bank record ↔ topup ↔ ledger ↔ wallet balance have strict FK/deferrable invariant. **Reuse exactly one posting path.** Do not create a second wallet credit writer or silently change old migrations.
- Manual Admin settlement: `apps/backend/src/admin-topups/admin-topup-service.ts`. Review `#256` delayed-transfer/CLOSING decisions and honor them.
- UI `mobile/packages/n11_shared/lib/src/wallet/wallet_views.dart` has existing bank-transfer info, pending/detail, a QR placeholder, and wording “Admin sẽ kiểm tra”; `wallet_http.dart` already reads request code. Replace the placeholder only when server returns a valid payment destination. Keep the existing `WalletSource`/session epoch contract and fit the Wallet area being changed in draft PR #401.
- DB current `resolved_by_user_id` on `wallet_topup_requests`, and `confirmed_by_user_id` on `wallet_topups` are user FKs. **Webhook and reconciliation job are not human Administrators.** Use an additive migration for an explicit automated settlement actor (type/source/ID), retain existing manual Admin user references and ensure CHECKs, FKs, deferred triggers, audit/outbox are valid for both. Never insert fake Admin user or attribute automatic actions to an existing person.

## Integration boundary

### 1. Webhook receiver (primary path)
- `SePayWebhookController`: public HTTPS `POST` at a dedicated `/v1/integrations/sepay/transaction` endpoint (exact path per repo conventions). No shipper/Admin session auth.
- Verify `X-SePay-Signature: sha256=<hex>` and `X-SePay-Timestamp` over the **raw body bytes**: `HMAC_SHA256(secret, timestamp + '.' + raw_body)`; constant-time compare; reject timestamps more than 5 minutes from now; reject unsigned/invalid/oversized bodies. Nest middleware must keep raw bytes before JSON parse. Secret lives only in VPS env.
- Persist the verified event (inbox) **before** responding; then respond `200 {"success": true}` within the 30 s limit. Processing may continue asynchronously after durable persistence.

### 2. Reconciliation job (safety net, new)
- Cron every **15–30 minutes** (chosen: 15 minutes, configurable). Only runs when `SEPAY_AUTO_TOPUP_ENABLED=true`.
- Calls `GET https://userapi.sepay.vn/v2/transactions?since_id=<cursor>&per_page=100&transfer_type=in&transaction_date_sort=asc&timestamp_format=iso8601` with `Authorization: Bearer <SEPAY_API_KEY>`. Follows pages until `meta.pagination.has_more = false` and an empty page is returned, then saves the **last transaction `id` as the cursor** (in a DB table, one row per linked account).
- Cursor advances only after all pages of a run are processed and committed. A run that fails midway keeps the old cursor; the next run re-reads the same window (idempotency below makes this safe).
- Each transaction is mapped into the **same** verified-evidence path as a webhook (same canonical bank key, same matching rule, same posting function). The job never has its own credit writer.
- Stored: `sepay_transaction_uuid` (UUID) and `sepay_webhook_event_id` (integer) in separate columns, both nullable and independently unique when present. They are never used as the cross-source dedup key.
- HTTP 429: honor `Retry-After`; stop the run and retry at the next cron tick. HTTP 401: stop, raise an alert, do not advance the cursor.
- An unknown cursor (empty list while `has_more` is false and the cursor is non-empty for a long time) raises an alert and stops. The cursor is never silently reset.

### 3. Shared matching and posting (both paths)
- Verified incoming transfer → receiving account equals the enabled, SYSTEM-configured MB main account → `transferType = in` → `code` exactly equals one `PENDING` request's transfer code → `amount` exactly equals the requested amount → driver/account/eligibility checks under existing lock discipline.
- Canonical bank key (unique constraint on the existing `wallet_bank_transactions` path, after posting): `referenceCode` (or `reference_number`) + amount + account number + `transactionDate`. If `referenceCode` is empty or the key is ambiguous → manual queue, never guessed.
- One SQL transaction for posting, request state transition, audit/outbox and inbox status.
- Idempotent: webhook replay, reconciliation re-read, and the same bank transaction seen by both paths all result in at most one request CONFIRMED and one TOPUP ledger credit. Replay returns success only after durable processing.

### 4. Manual exception queue
- Verified incoming money with wrong/no code, wrong amount, unexpected account, cancelled/rejected/late request, closed driver, duplicate bank key, empty reference code or any ambiguity → Admin review with reason.
- Never auto-assign money to another shipper, silently ignore a real transfer, auto-refund, or auto-credit a cancelled request. Admin resolves with existing finance permissions; audit trail links to the original SePay event (webhook id and/or transaction UUID).
- Distinguish a replay of an already-confirmed payment from an unmatched new transfer.

### 5. Flutter
- Backend is server truth. Flutter refreshes the request status after returning from the bank app. Offline or pending shows “Chưa xác nhận”, never fabricated success.
- Copy changes from Admin-only language to “Hệ thống sẽ tự xác nhận khi nhận được tiền; nếu có vấn đề, Admin sẽ đối soát”.
- VietQR shows the real server-provided destination and exact amount only.

### 6. Configuration and runbook
- `SEPAY_AUTO_TOPUP_ENABLED=false` by default. `SEPAY_WEBHOOK_SECRET` and `SEPAY_API_KEY` are env-only; no real values in the repo. Empty secret or key → fail closed; manual path keeps working.
- Receiving-account mapping, bank link and Nginx HTTPS. No production connection or receiving-account creation in code.
- Runbook: staged activation, rollback (disable the flag; do not drop history), human reconciliation for the manual queue.

## Data/invariants & dangerous races
- `wallet_bank_transactions` currently requires a posted topup for an IN bank record: **do not misuse it to store an unmatched webhook**. Use a separate inbox for verified unmatched money, then settle atomically when reconciled. Preserve every existing immutable ledger rule.
- Respect lock order ADR-004 3.1, defer business decisions until rows locked. Concurrent Admin confirmation / Shipper cancel / 2 identical webhook deliveries / webhook + reconciliation seeing the same transfer / distinct notifications of the same bank transaction: **at most one** topup and one TOPUP ledger credit.
- An already created request may receive money after account starts CLOSING; no new request allowed. Define any exceptional bank arrival per #256 (do not silently reject or credit if guard forbids), route to Admin; if driver CLOSED never auto-credit.
- Exact amount only for automatic settlement. Excess/short and wrong code → inbox review. No balance update without matching bank evidence and a transaction committed successfully.
- Sensitive event payload minimization (no full raw payload in logs), provider identity normalization (webhook `id` integer vs transaction UUID kept separate), migration compatibility with existing admin rows, rollback by disabling auto mode (NOT dropping history).

## Tests / delivery gates
- Focused tests: signed+valid inbound transfer → 1 ledger credit, request CONFIRMED, wallet invariant. Duplicates/replay/racing Admin confirm and cancel. Tampered body, invalid HMAC, timestamp older than 5 minutes, outbound transfer, unrecognized account, mismatched amount/code, `code` null or empty, empty `referenceCode` → **zero automatic credits**.
- Reconciliation: since_id pagination until empty page, cursor advances only after a full committed run, 429 and 401 handling, a webhook and a reconciliation read of the same transfer → one credit.
- DB transaction rollback, uniqueness, and metadata attribution under the real migration schema.
- Test inbox anomaly + manual Admin path without double posting; CLOSING and delayed payments; wrong-user sessions and logout. Flutter shows real VietQR info, never reports success merely because the transfer screen was opened.
- Tests: Nest unit + affected integration DB migration, Flutter focused tests/analyze, CI on head SHA. Antigravity cross-flow/E2E, then Codex audit of money/security/DB, as governed.
- Acceptance after Owner separately authorizes the real account test: MB connected per https://docs.sepay.vn/ket-noi-mb-api.html → SePay HMAC webhook over HTTPS → one small controlled inbound deposit → server ledger/balance and Admin evidence verified; a duplicate webhook and a reconciliation pass must not double-credit.

## Provider specifications (re-verify when coding)
- https://developer.sepay.vn/vi/sepay-webhooks/tich-hop-webhook — payload fields.
- https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc — HMAC headers and formula.
- https://developer.sepay.vn/vi/sepay-webhooks/xu-ly-loi — retry schedule, success criteria.
- https://developer.sepay.vn/vi/sepay-webhooks/bao-mat — replay window, reconciliation guidance.
- https://developer.sepay.vn/vi/sepay-api/v2/giao-dich/danh-sach — transactions API.
- https://developer.sepay.vn/vi/sepay-api/v2/xac-thuc — API auth and rate limit.
- https://docs.sepay.vn/ket-noi-mb-api.html — MB linking, main account, VA.

## Agent assignment
- Owner approval: #403 and chat 19/11/2026; reconciliation decision changed by Owner on 19/11/2026.
- Executor: **Claude Code local (Windows)** only; start by reading AGENTS.md, CLAUDE.md, governance README/checklist, delivery rules, issue #403, and current PR head; run local sync guard preflight in the actual worktree. Do not overlap #401 changes; coordinate/merge UI only after inspecting latest head.
- This PR currently contains **design/handoff only**. Implementation, tests, CI and device acceptance are **NOT DONE / NOT TESTED** until the executor updates the same PR. No merge, deploy, migration to production or AAB/APK publication without Owner approval.
