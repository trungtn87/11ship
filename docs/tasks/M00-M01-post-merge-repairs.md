# M00/M01 — post-merge corrective contract and Claude handoff

Date: 2026-10-08. Status: OWNER-AUTHORIZED REPAIR DESIGN; implementation on DRAFT PR #19, re-audit correction pending.
Repository: trungtn87/11ship. Verified design base: 307fa3a0175cae1c1c1b8466de0bf606938ee8cc.
Review reference: c6aab20379249178febb5a0e7c55f72f6df6611a (A2D merge).
This focused addendum overrides conflicting M00/M01 task/ADR sentences ONLY for the fixes below. Preserve A2 §22: no Driver area registration or GPS onboarding.
Owner authorized repair of session authorization, bounded rollback, stale-role routing and progress accuracy. ChatGPT writes the repair contract; Claude implements; independent review and Owner merge follow. Do not claim whole M01 complete.

## 1. Session authorization inside onboarding transactions (P1)

HTTP SessionAuthGuard stays. It is a precheck, not authorization for a later mutation.
Pass server-authenticated userId AND sessionId into Shop save/complete and Driver create coordinators. Do not accept either from body; do not pass/log raw bearer tokens.

M01 provides a narrow transaction participant, reusing UserRepository/SessionRepository and existing error registry, rather than exposing their SQL to Onboarding/M02/M03. It opens no transaction.
New execution lock order: M00 advisory/existing idempotency record → user FOR UPDATE → current session FOR UPDATE → existing owner aggregate → Shop service-area locks when applicable → role grant → audit/outbox → final idempotency persistence.
Driver has no area locks.

After acquiring user and session locks, check: user/session exist, session.userId matches actor; revoked; fresh PostgreSQL clock AFTER all authorization lock waits (expiresAt <= now is expired); user ACTIVE. Error precedence for an existing matching session: SESSION_REVOKED → SESSION_EXPIRED → ACCOUNT_DISABLED; missing/mismatched → SESSION_INVALID.
Keep locks until transaction ends, so revocation cannot commit between authorization and business effects. Match role/select's user-before-session order. No requirement to already hold/select SHOP/DRIVER for onboarding.

Sensitive replay runs this same authorization participant BEFORE decrypting/serving stored results. Retain replay guard user identity; sessionId is authorization context, not logical request or idempotency scope/guard. A valid replacement session of the same user can replay; an invalid/revoked/expired session cannot. No callback rerun, no extra effects or deletion of existing successful replay records on denial.

Acceptance:
- For Shop save (create and update), Shop complete, Driver create: a request authenticated before waiting is revoked during the wait, then rejected with no new business/role/audit-success/outbox/idempotency effects.
- Expiry across a deterministic lock wait is rejected at fresh DB time, equality included.
- Mismatched/missing session and disabled user refused; no cross-user disclosure.
- Each operation's sensitive replay is revoked/expired during authorization wait: no replay payload returned; successful record preserved.
- Valid new same-user session replays once-stored result unchanged.
- Actual SHOP replacement flow revokes old SHOP session and a pending Driver command from that session is refused.
- Deterministic PostgreSQL barriers observe the BUSINESS transaction's waiting authorization statement, not merely the HTTP guard query. No sleep-only races.
- Simultaneous role/select/onboarding has no reverse lock order; A1 SHOP device-switch regression and A2 same-user Shop+Driver coexistence pass.

## 2. Bounded rollback with the existing transaction deadline (P2)

TransactionManager's one monotonic budget starts before BEGIN; pool acquisition remains excluded. Extend that SAME deadline through abort/ROLLBACK and connection disposition; do not restart timeout or give rollback a new full budget.

Close participant context before abort. If budget already exhausted, in-flight query, dirty state or connection error: destroy exactly once, never send ROLLBACK or return suspect connection to pool.
If trustworthy and time remains, race rollback against remaining deadline. Successful rollback within budget returns client normally; rollback rejection, deadline or late completion destroys it exactly once.
Account for timer delivery lag via monotonic check, including after rollback settles. Consume late promise rejection; no unhandled rejection, double release or late context query.
Capture/translate original callback failure BEFORE cleanup, so rollback failure/timeout does not replace the original business/technical error. If original cause was deadline, retain DEADLINE_EXCEEDED.
COMMIT outcome-unknown rules remain unchanged: no rollback after unknown COMMIT, no callback retry, no false success.

StandaloneAuditRecorder's existing <=500 ms total budget includes acquisition plus transaction cleanup. Do not simply detach a stuck rollback and leave its client checked out. Audit remains best effort, original caller error preserved, safe fixed logging only.
No CPU-synchronous/event-loop hard-real-time guarantee; asynchronous waits must be bounded by the same deadline.

Acceptance (controlled deferred client and timers/clock, plus existing PG tests):
- callback throws AppError, rollback never resolves: call finishes by deadline, client destroyed once, identical original error retained.
- rollback slow but within budget → normal release once; beyond budget → destroy once.
- already exhausted budget → no rollback sent; callback not started if setup exhausted budget.
- late rollback resolve/reject → no reuse/double release/unhandled rejection.
- standalone audit writer fails + hung rollback under smaller test budget: recorder resolves, client destroyed, original protected operation denial unchanged.
- all existing detached-query, setup deadline, COMMIT late/error/unknown and callback-once tests still pass.

## 3. Effective role and session-router projection (P2)

One shared rule for login, /auth/me, role/select responses:
effective_active_role = stored/current active role if contained in available_roles, else null.
Return active_role = effective_active_role.
role_selection_required = available_roles.length > 0 AND effective_active_role is null.
Keep accepted onboarding_required semantics: only no usable role + Shop not COMPLETED + Driver NOT_STARTED.
No available role means role_selection_required=false, active_role=null; never route into invalid role or force completed onboarding again.
Do not mutate session rows merely to shape GET /auth/me.

For /auth/me acquire user FOR SHARE, then session FOR SHARE through M01-owned read/lock port; validate matching current session with fresh DB time and user state. Read CURRENT active_role from locked session, not the guard's earlier principal. This keeps concurrent readers compatible and serializes with role/select/revocation (user FOR UPDATE before session). Keep shared user lock while reading role and profile eligibility. No nested transaction, SERIALIZABLE, raw cross-owner SQL or forwardRef.

Acceptance:
- DRIVER selected, Driver becomes CLOSED, usable SHOP remains → active_role=null, available_roles=[SHOP], selection required=true.
- SHOP selected, Shop becomes DISABLED, usable DRIVER remains → null/[DRIVER]/true.
- selected role removed or no profile → same effective-role rule.
- no usable role with completed disabled/closed profile → null/[]/false, no onboarding loop.
- valid active role stays selected; roleless login unchanged.
- /me waiting behind role/select/revocation reads fresh session state, or returns session error; simultaneous /me readers remain compatible.
- PG fixture lifecycle/status changes take user root lock (test-only transitions; no new lifecycle endpoints).

## 4. Accurate progress and README (P2; separate implementation commit)

Inspect existing progress collector/resolver schema before editing.
Map historical merged implementations via explicit supported plan pins:
M00-B1 #2, C1A0 #4, C1A1 #6, C1B #9, C1C #10;
M01-A1 #12, A2S #16, A2D #17; designs #11 (A1), #15 (A2).
Split current monolithic M01 leaf into planned A1 and A2S/A2D leaves/group with correct dependencies and acceptance/evidence paths.
Represent corrective work honestly; merged historical leaves remain completed history, but unresolved repairs must not be hidden behind overall completion. Do not claim full M01 or production readiness.
Use supported explicit metadata/pins and real exact-SHA evidence. Do not fake review/check status, weaken fail-closed rules, invent unsupported manifest fields or edit generated percentages manually. If missing historical review evidence prevents DONE, display the actual gap; do not fabricate a PASS annotation.
Record this corrective contract and its implementation mapping using supported design/implementation linkage once PR numbers exist.
Preserve Vietnamese dashboard from merged #13. Run progress validation/tests/check and regenerate from real data in the established workflow.
README states implemented M00 foundations and M01-A1/A2, with deferred logout/recovery, ADMIN/SYSTEM/2FA, production SMS, runtime publisher/worker and scheduled cleanup clearly separated.
M02 #18 may continue design work; implementation must wait for relevant corrective code merge and green main CI.

## 5. Claude execution handoff

Fetch this design branch, verify base and design-only diff, record actual SHA. Inspect any new main code/spec change before implementation; do not blindly reset/force-push.
Implement as small commits: session → rollback → router → progress/docs. Same focused DRAFT implementation PR may contain them; no unrelated features/dependency/framework changes. No applied migration edits expected.
Reconcile affected ADR-003/M01 task descriptions to this addendum without rewriting historical evidence. Add repair evidence with exact acceptance/test mapping.
Meaningful regressions must fail on old code and pass on fix; record proof honestly (controlled isolated runs or CI). Run lint/typecheck/build, unit, PG integration local and CI modes, migration smoke, progress tests/check.
If local dependency installation remains unavailable, report that and use exact-head GitHub CI; do not call tests locally passed.
Handoff base, code head, final head, CI URL/status/counts, old tests changed/reasons, timeout resource-disposition proofs, PG session barriers, router matrix, accurate progress gaps.
Keep PR DRAFT; no merge/Ready or next-module code until independent review. This design PR alone does NOT fix production code.


## 6. Re-audit correction: explicit combined PR linkage (P2)

Audit reference: PR #19 head 43a7013e45c0b74ee1eccb4449989f55e5dd4679. Sections 1–3 have no remaining blocking finding from that review; section 4 is incomplete. The current plan pins #19 only as design, so it reports DESIGNING while implementation exists and would report READY_FOR_CLAUDE after merging the implementation. The tests currently encode that wrong projection. Disclosure in evidence does not satisfy accurate progress.

This section authorizes a narrow, explicit exception for the already combined design/repair PR. It does not change the normal design-first workflow or authorize a merge.

### 6.1 Manifest and validation

Add supported optional task field `combined_design_implementation: true`. Absent or false preserves all existing behavior. Validate the field as boolean when present. True is valid ONLY on a leaf with positive integer `design_pr` and `implementation_pr` that are equal. For M01-R1 use both pins = 19 and this flag = true.

Permit the repeated PR pin only for these two fields of that same explicitly combined leaf. A PR reused across tasks, an unflagged duplicate, a combined group, unequal/missing pins, nonpositive/noninteger pins or a pinned-and-ignored PR remain validation errors. Do not infer the exception from titles, authors, labels, code paths or PR bodies. Document the schema extension in the progress README and manifest comments; fixed owner/design/review roles remain unchanged.

### 6.2 Classification and resolution

Classify the one real PR once with an explicit combined role; do not duplicate its dashboard row, task weight, progress total or attention entries. The combined PR supplies both the task's design reference and implementation lifecycle. Keep the factual design lifecycle: an open combined PR does not mean the design has already merged.

For this explicitly combined leaf only, resolve its implementation lifecycle without waiting for that same PR to merge as a separate design gate. Reuse the existing implementation precedence, dependency gates, required-check evaluation and exact-head review binding:
- Draft with green CI -> CLAUDE_CODING; never DONE.
- Failing required CI -> CI_FAILED; existing changes-requested precedence stays intact.
- Ready/non-draft with green CI and no valid bound review -> WAITING_CHATGPT_REVIEW.
- Review labels without trusted status on the exact current head remain ignored with the existing attention behavior.
- Valid bound in-progress / changes-requested / pass reviews -> the existing CHATGPT_REVIEW / CHANGES_REQUESTED / READY_TO_MERGE states.
- Merged with green required checks on its actual head and satisfied dependencies -> DONE exactly once.
- Merged with failed/missing/pending required checks -> existing CI_FAILED / CI_RUNNING, never DONE.
- Closed without merge -> CANCELLED PR; task not DONE and not READY_FOR_CLAUDE as though its design had merged.
- Unsatisfied dependencies remain blocking even for a merged combined PR.

Do not introduce runtime status into plan.yml, weaken review/CI binding, mark open work DONE or fabricate a separate implementation PR. A manual workflow_dispatch check on the exact head is legitimate CI evidence; it is not independent review evidence. Ordinary separate design/implementation tasks must retain their prior behavior.

### 6.3 Regression and handoff

Replace the current-plan test asserting that #19 must be pinned only as design. Add meaningful resolver/validation tests covering the lifecycle above, stale review head after a push, cross-task duplicate rejection, invalid flag/pin combinations, ordinary tasks unchanged and no double counting. Demonstrate the old model's merged-green #19 -> READY_FOR_CLAUDE failure against the corrected expectation, then the repaired result -> DONE; record how the proof was run.

Regenerate the Vietnamese dashboard from real GitHub data. While #19 is Draft, it must identify Claude implementation as in progress (or the actual CI/error state), rather than say Claude has not started. Do not manually patch generated status/percentages or report full M01 completed.

Update repair evidence to remove the deferred linkage gap and accurately record the correction, test mapping, actual code/final heads and CI. Preserve prior audit/CI history. Run progress tests/check plus required repository CI on the new final head. Keep PR #19 Draft, do not merge/mark Ready/start M02 code, and hand back the new SHA and evidence for independent re-audit.
