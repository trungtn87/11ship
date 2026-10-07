# M03–M04 — Design patch, scope và handoff gates

Ngày 07/10/2026. Version 0.1. Trạng thái DESIGN PATCH — READY FOR REVIEW. Không phải prompt triển khai, không CODE_READY.

## 1. Base và quy trình

Repo `trungtn87/11ship`; base thiết kế kiểm ngày 07/10 là `main@cfd901f698dde33dc8db07ad24b5fa0551bc4a56` sau PR #3/#4 merge. M00-C1A0 đã tích hợp; toàn C1 chưa hoàn tất. PR #5 C1A1 đóng không merge; không lấy code/branch đó làm nền đã được chấp nhận. Không đổi ADR-003 v0.3, scope A0/A1 hoặc evidence các PR trước.

Owner yêu cầu sửa phần chưa hợp lý và đưa lên GitHub; gói này chỉ tài liệu. ChatGPT thiết kế/chia task/audit, Claude triển khai, ChatGPT review, Owner duyệt. Chưa gửi lệnh implementation và không merge từ phiên này.

Đọc: ADR-001/002/003, ADR-004-driver-wallet-consistency.md, M03-M04-acceptance-matrix.md, manifest 4.1 và onboarding 4.2 đã đồng bộ. Nguồn chat/baseline cũ không override Owner hoặc ADR mới đã được duyệt.

## 2. Audit disposition

| Finding | Bản sửa | Trạng thái thực |
|---|---|---|
| F01 ledger/hold/projection | ADR-004 §4–5: arithmetic, immutable source, business unique, deferred invariants | Design addressed; migration/runtime pending |
| F02 races | §3 global lock order/root/recheck; acceptance R01–R18 | Design addressed; runtime pending |
| F03 funding | §5–6 bank identity chung, two modes, one coordinator | Design addressed |
| F04 payout | §7 processing owner/no timeout transfer takeover/final reconciliation | Design addressed; manual transfer không exactly-once guarantee |
| F05 custody/closure | §8 atomic fail incident, responsibility guard, fail closed adapter | Design addressed; M07 integration required |
| F06 auth/privacy | §3, §9 current auth locking, permission/scope, bank allowlists | Design addressed; M01 ports required |
| F07 ownership cycle | §2 M03-A/Coordinator split, service ports, M04 không activate | Design addressed |
| F08 rename/status | §11 + targeted 4.1/4.2/4.3 changes | Current repo docs normalized; legacy historical sources retained |
| F09 M00 clock | ADR-003 v0.3 §5/§13 và C17 | Already fixed in design before this PR; no duplicate patch |
| F10 tests | Acceptance file: barriers, precise sums/counts, faults | Specified, NOT RUN |
| F11 checklist drift | Canonical checklist dưới đây thay các dòng Driver/Wallet cũ | Old Library file not edited; không dùng làm handoff hiện hành |

Không đánh F01–F06 runtime PASS từ việc viết spec. Audit ban đầu ở b1fed874; base mới cfd901f đã có A0, nên không lặp kết luận “toàn M00 chưa implementation”.

## 3. Canonical Driver/Wallet checklist

- Driver self-onboarding EXTERNAL/PENDING/accepting_deliveries=false; DRIVER role không ACTIVE.
- PLATFORM chỉ miễn count và registered service area; EXTERNAL không có hai miễn trừ đó.
- M04 duy nhất ghi wallet/hold/ledger; M03-B điều phối nạp-duyệt.
- 100.000 là tiền nạp chung; không duy trì deposit sau ACTIVE.
- Reserve assignment1000, complete capture/debit; fail/return/cancel release; không refund credit giả.
- Withdraw >=10000, hold từ create, PROCESSING/RECONCILIATION không ordinary cancel; external unknown không resend.
- Closure không tự payout; balance nhỏ còn nguyên; không closed nếu còn hàng/assignment/hold.
- Admin permissions độc lập driver type, scope/view không là mutation permission.

## 4. Task split và dependency

| Task | Scope thiết kế/implementation về sau | Depends on / gate | Acceptance chính |
|---|---|---|---|
| M03-A | Identity/type/areas/bank, driver root port, onboarding canonical fields | M00-C1 toàn bộ, M01 auth/onboarding boundary, M02 areas contract | N01, R12/R15 phần driver, S01/S03/S04 |
| M04-A1 | Wallet zero provisioning, ledger, amount/sequence/invariants, source linkage nền | M03-A identity/root; M00 audit/idempotency | F06/F07/F09/F10/F12, R03–R05 qua harness |
| M04-A2 | Hold reserve/capture/release participants, terminal uniqueness | M04-A1; source harness constrained | R09, F05/F06; COMMISSION production chờ M07 FK |
| M04-B | Admin received-topup primitive/API, shared wallet_bank_transactions registry, funding read port | M04-A, M01 money permissions/privileged session contract | R01, F01–F03/F08, S02/R17 |
| M03-B1 | Initial approve coordinator NEW_TOPUP/EXISTING_FUNDS, reject/availability/suspend/resume | M04-B, M03-A; không closure finalization | R02/R10/R11/R12, F04/L01 |
| M04-C1 | Withdrawal create/cancel-pending, verified snapshot + hold | M04-A/M03-A | R03/R05/R15, F07/W01/W04 |
| M04-C2 | Processing ownership, paid/reconciliation, payout uniqueness | M04-C1 + permissions/evidence contract | R14/R16/R17, F11, W01–W05, C04/C05 |
| M06/M07 integration | Route/accept/terminal participants, source FK, atomic failed incident | M03/M04 primitives; routing/version/policy binding contract | R06–R08/R10/R12/R18, C01–C03/C06 |
| M03-B2 | Closure request/cancel/evaluate/finalize và money/custody guards | M04-C + M07 responsibility adapter thật | R13/R14/R18, L02–L04/S05 |

Task IDs A1/A2 ở đây là slice của M04, không M00-C1A1. Không giao toàn bảng cho Claude trong một prompt. M03-B2 chờ M07 là integration gate, không làm M07 phụ thuộc ngược vào lifecycle workflow: M07 chỉ dùng M03-A port. Driver state primitives không phụ thuộc M07.

## 5. Service contracts cần đưa vào từng task chi tiết

Tất cả participant signature nhận TransactionContext + server-validated actor/target + immutable inputs; trả typed result hoặc fixed error. Không expose arbitrary SQL/table names, không nhận context từ client.

| Owner port | Input/contract | Result |
|---|---|---|
| M03-A lockDriver | driver_id, discovery expected identity | Locked canonical status/type/version; bank version khi cần |
| M03-A bankSnapshot | driver, expected bank version; verified dưới root | Immutable payout data cho M04, không log |
| M04 ensureZeroWallet | locked driver, ctx | Một wallet zero hoặc existing locked wallet |
| M04 creditTopup | locked wallet, actual amount, canonical bank identity, actor | source ID, entry ID, new wallet version; không activate |
| M04 reserve | source kind/id, amount, wallet; approved coordinator | hold ID, wallet version; reject duplicate/opposite data |
| M04 capture/release | hold ID + exact source/wallet; ctx | Same terminal result hoặc conflict; tiền chỉ đổi từ ACTIVE |
| M04 fundingGuard | locked wallet, referenced topup IDs/mode | net eligible funding, available; không write credit |
| M04 closureMoneyGuard | locked driver/wallet | balance/active hold count/unsettled withdrawal flags; no asynchronous cache |
| M07 responsibilityGuard | locked driver | active assignments + unresolved custody incidents; missing adapter deny |
| M06 routeValidate | locked driver/routing/delivery versions, evaluation | Valid binding hoặc stale; không network call |

Participant methods không tự cấp permission: coordinator chạy current authorization trong transaction trước call; port module chỉ cho workflow hợp lệ inject, không controller tùy ý reserve. Invariant DB vẫn là lớp cuối.

## 6. API contract delta để hoàn thiện handoff

Mutation headers: bearer opaque session và Idempotency-Key UUID. Existing resource mutation body có expected_version (driver/withdrawal tương ứng); create có bank_account_version cho snapshot. Target trong URL; actor không từ body. Unknown/forbidden input reject, không silently ignore. ID wire format theo canonical module schema đã chốt trước task, không tự trộn prefix/string UUID.

| Endpoint / operation_id đề xuất | Body cụ thể về nghiệp vụ | Success |
|---|---|---|
| POST /v1/admin/drivers/{id}/topups / wallet.topup.create.v1 | actual_amount_vnd, bank_identity, received_at | 201 topup_id, wallet_id, amount, wallet_version |
| POST /v1/admin/drivers/{id}/approve / driver.approve.v1 | oneOf NEW_TOPUP hoặc EXISTING_FUNDS theo ADR §6 | 200 driver_id/status/version, activation_id; topup_id chỉ nếu mới |
| POST /v1/admin/drivers/{id}/withdrawals / wallet.withdrawal.create.v1 | amount_vnd, bank_account_version | 201 withdrawal_id/PENDING/version, amount, masked destination |
| POST /v1/admin/withdrawals/{id}/cancel / wallet.withdrawal.cancel.v1 | expected_version, reason_code | 200 CANCELLED/version; chỉ PENDING |
| POST /v1/admin/withdrawals/{id}/start-processing / wallet.withdrawal.start.v1 | expected_version | 200 PROCESSING/version, processing_attempt_id; snapshot qua detail có quyền |
| POST /v1/admin/withdrawals/{id}/mark-paid / wallet.withdrawal.paid.v1 | expected_version, processing_attempt_id, bank_identity, transferred_at, evidence_id, confirmed amount/destination binding | 200 PAID/version; không gọi ngân hàng |
| POST /v1/admin/withdrawals/{id}/reconcile / wallet.withdrawal.reconcile.v1 | expected_version, outcome, reason_code, evidence_id; paid outcome có bank identity và transfer facts | 200 RECONCILIATION/PAID/CANCELLED theo guarded outcome |
| POST /v1/drivers/me/closure-requests / driver.closure.request.v1 | expected_driver_version, reason_code | 201 closure_id, CLOSING/version |
| POST /v1/drivers/me/closure-requests/{id}/cancel / driver.closure.cancel.v1 | expected_version, expected_driver_version | 200 closure state và restored driver status/accepting |
| POST /v1/admin/closure-requests/{id}/resolve / driver.closure.evaluate.v1 | expected_version, expected_driver_version | 200 actual current result và safe blockers, không payout |

Đây là contract delta cho review, chưa OpenAPI CODE_READY: task cụ thể phải chốt max lengths, enums reason/evidence access, chính xác mọi success/error schema và examples. Evidence ID phải tham chiếu business evidence thuộc đúng withdrawal/actor scope, không URL tùy ý; không dùng attachment như tự động chứng minh chuyển tiền.

Fixed errors cần mapping qua M00: INVALID_MONEY(422), INSUFFICIENT_AVAILABLE_BALANCE(409), VERSION_CONFLICT(409), DRIVER_NOT_ELIGIBLE(409), BANK_TRANSACTION_ALREADY_RECORDED(409), BANK_NOT_VERIFIED(409), BANK_SNAPSHOT_STALE(409), HOLD_STATE_CONFLICT(409), WITHDRAWAL_STATE_CONFLICT(409), WITHDRAWAL_PROCESSING_OWNER_MISMATCH(403), RECONCILIATION_EVIDENCE_REQUIRED(422), CLOSURE_GUARD_UNAVAILABLE(503), WALLET_INVARIANT_VIOLATION(500 safe message). M00 idempotency/transaction/auth errors giữ nguyên. Không public raw SQL/bank details trong error. GET wallet/withdrawal/closure trả current version/allowed projection để recover lost response, kiểm ownership như mutation.

## 7. CODE_READY checklist của từng slice

Trước khi đổi trạng thái task:
1. Owner lock ADR-004 hoặc ghi quyết định sửa rõ ràng; không giả Owner đã lock vì đồng ý thiết kế lại.
2. Base code và design SHA mới nhất được pin; chỉ dependencies đã accepted/merge dùng làm nền.
3. Physical columns/FK/CHECK/unique/trigger/index và upgrade/down strategy của slice hoàn chỉnh; M04 không tham chiếu bảng M07 chưa tồn tại mà vẫn bật command.
4. Permission matrix + root locks + input/output/errors/replay fingerprint đã chốt, bao gồm M01 admin/2FA guard trước mở API tiền và policy selector contract của M06 trước accept.
5. Required fixture/barrier/assertion và failure paths map đủ; test thực do Claude cung cấp khi implement.
6. Scope files, commands, no cross-module writes/no auto-retry/no external transfer callback và review gates rõ.

Sau thiết kế: Claude code đúng slice -> CI/test evidence -> ChatGPT audit diff -> Owner duyệt. Bản tài liệu này không mở M03/M04 implementation ngay và không thay task M00-C1A1 do phiên khác chuẩn bị.
