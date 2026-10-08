# M00/M01 post-merge repairs — implementation evidence

Status: DRAFT PR #19, awaiting the independent ChatGPT audit. Not merged, not marked Ready, M02 not started.
No PASS or DONE claim is made here. Acceptance document: [M00-M01-post-merge-repairs](../tasks/M00-M01-post-merge-repairs.md).

## Base and heads

- Design head (pinned by the task): `24978ed35fc6410bf8304863acea0acfe506a048`. Main base of the design: `307fa3a`.
- Code commits, in the required order: session `974d5a6` (+ test follow-up `a226453`), rollback `ce3f6cc`, router `b62e5f4`, then progress/docs (this commit).
- The final head, its CI run URL and counts are in the handoff message. They cannot be written into the commit they describe.
- Local install is blocked (`npm ci` returns 403 from the organisation egress policy and was not worked around), so NO test was run locally.
  Every pass claim comes from the GitHub CI run of the exact head named in the handoff. The progress tests (`npm run progress:test`, no dependencies)
  did run locally on Node 22: 137/137.

## Acceptance → test mapping

### §1 Session authorization inside onboarding transactions

| Acceptance | Test |
| --- | --- |
| Participant order user → session → fresh DB clock; precedence REVOKED > EXPIRED > DISABLED; missing/foreign session SESSION_INVALID; `expiresAt <= now` expired; malformed actor refused before SQL; no token/bearer, no own transaction | `apps/backend/src/auth/session-authorization-participant.spec.ts` |
| Shop save (create, update), Shop complete, Driver create: revoked during the lock wait → refused, no business/role/audit-success/outbox/idempotency effect (`snapshot()` equality) | `tests/integration/onboarding-session-authorization.int.spec.ts`, `describe(<operation>)`, revoke |
| Expiry across a deterministic lock wait refused at fresh DB time | same file, expire |
| Disabled user; mismatched/missing session; no cross-user disclosure | same file, "the participant against real rows" + unit spec |
| Sensitive replay revoked/expired during the authorization wait: no payload, stored record preserved | same file, replay-revoked / replay-expired |
| Valid replacement session of the same user replays the stored result unchanged | same file, replacement-session replay |
| Real SHOP replacement revokes the old session; a pending Driver command from it is refused | same file, "an actual SHOP replacement revokes the old SHOP session…" |
| Barriers watch the BUSINESS transaction's statement, no sleep-only race | `rowLockWaitersRunning(pool, USER_LOCK \| SESSION_LOCK)` + `eventually`; the guard uses a plain SELECT and never waits |
| No reverse lock order; A1 SHOP device switch and A2 Shop+Driver coexistence still pass | same file, "simultaneous role selection and onboarding…"; existing `auth-session`, `shop-onboarding-concurrency`, `driver-onboarding-concurrency` specs |
| Services call the participant before any effect; replay hook before decrypt; sessionId not in guard/scope/request | `shop-onboarding-service.spec.ts`, `driver-onboarding-service.spec.ts`, boundary specs |

### §2 Bounded rollback and disposition

| Acceptance | Test (`apps/backend/src/transaction/transaction-manager.spec.ts`, describe "rollback and disposition share the transaction deadline") |
| --- | --- |
| Callback throws AppError, ROLLBACK never answers: finishes by the deadline, client destroyed once, identical original error | "callback throws an AppError and ROLLBACK never answers…" |
| Slow ROLLBACK within budget → normal release once; beyond budget → destroy once | "a slow ROLLBACK that still answers inside the budget…", "…answers only after the budget destroys…" |
| Budget already spent → no ROLLBACK sent; callback not started if setup spent it | "sends no ROLLBACK…", "does not let a hung ROLLBACK replace a DEADLINE_EXCEEDED cause…", setup tests |
| Late resolve/reject: no reuse, no double release, no unhandled rejection | "a ROLLBACK that rejects only after the deadline is consumed…" |
| Standalone audit: writer fails + hung ROLLBACK → recorder resolves, client destroyed, caller's denial unchanged | `standalone-audit-recorder.spec.ts` (budget 60 ms) |
| Real PostgreSQL, only ROLLBACK intercepted | `tests/integration/transaction-manager.int.spec.ts` |
| Detached-query, setup-deadline, COMMIT late/error/unknown, callback-once tests still pass | the pre-existing tests of the same file (unchanged except the four below) |

Timeout resource-disposition proofs: each case asserts `released` is exactly `[true]` (destroy) or `[false]` (clean release) once, via the fake pool's release log; the real-PG test asserts the backend is gone from `pg_stat_activity`.

### §3 Effective role and router

| Acceptance | Test |
| --- | --- |
| `effectiveActiveRole`, `role_selection_required = roles>0 AND effective null`, `onboarding_required` unchanged | `available-roles.spec.ts` |
| `/me` order user FOR SHARE → session FOR SHARE → clock → reads; current role from the locked session, not the principal; no session mutation; no nested tx | `role-context-service.spec.ts` (event order, refusal matrix, "current role from locked session", source scans) |
| DRIVER selected + CLOSED + usable SHOP; SHOP selected + DISABLED + usable DRIVER; role removed; no usable role with completed profile → null/[]/false; valid role stays; roleless unchanged | `role-context-service.spec.ts` (matrix) and over HTTP in `tests/integration/auth-me-router.int.spec.ts` ("effective active role over HTTP") |
| `/me` waiting behind role/select/revocation/disable reads fresh state or the session error; concurrent readers compatible | `auth-me-router.int.spec.ts` ("/me waits for writers…", "simultaneous /me readers are compatible") |
| PG fixture lifecycle changes take the user root lock | `lifecycle()` helper in `auth-me-router.int.spec.ts` (`SELECT … FROM app.users … FOR UPDATE` first); no new lifecycle endpoint |

### §4 Progress accuracy

| Acceptance | Where |
| --- | --- |
| Pins M00-B1 #2, C1A0 #4, C1A1 #6, C1B #9, C1C #10, M01-A1 #12, A2S #16, A2D #17; designs #11 (A1), #15 (A2) | `docs/progress/plan.yml`; `tests/progress/current-plan.test.mjs` |
| Monolithic M01 leaf split into A1 + group A2 (A2S, A2D) | same |
| Corrective work shown honestly: `M01-R1`, design PR #19 (draft) → `DESIGNING`, not DONE; no implementation PR invented | `plan.yml` comment; `current-plan.test.mjs` |
| No fake status, no manual percentage; Vietnamese dashboard kept | `docs/PROGRESS.md` regenerated by `scripts/generate-progress.mjs` (`--check` clean); `render.mjs` only gained Vietnamese titles |
| README states what exists and what is deferred (logout/recovery, ADMIN/SYSTEM/2FA, production SMS, runtime publisher/worker, scheduled cleanup) | `README.md` |

Known gap, stated plainly: PR #19 carries both the design document and the repair code, so the progress system can pin it only once. `M01-R1` therefore reads as a design in progress. After the Owner merges #19, the resolver would call `M01-R1` ready for Claude until an implementation PR is labelled; the Owner/ChatGPT should decide whether to pin #19 as the implementation of `M01-R1` at that point. Nothing was hand-edited to hide this.

## Old tests changed, and why

Four `transaction-manager.spec.ts` tests asserted that a ROLLBACK is sent (`log.at(-1) === 'ROLLBACK'`, `released [false]`) after the budget was spent. Section 2 forbids exactly that (budget spent → destroy, never ROLLBACK), so they now assert "no ROLLBACK in the log, `released [true]`":
"closes the context at the deadline…" (renamed "…destroys the connection without ROLLBACK…"), "counts BEGIN/setup against the budget…", "refuses to send COMMIT when the budget ran out while the event loop was busy…" (renamed) and "does not start the callback when BEGIN/setup used up the budget while the event loop was blocked".
Boundary specs (`shop-boundary.spec.ts`, `driver-boundary.spec.ts`) gained the new Auth import in their allow-lists. The progress test helper now loads a frozen copy of the
2026-10-07 plan (`tests/progress/fixtures/plan-2026-10-07.yml`) for the snapshot tests, and `livePlan` for the shipped plan.

## CI history

Run 1 on `974d5a6`: 3 unit failures (1074/1077), two boundary allow-lists and one test fixture; fixed in `a226453`. Run on `ce3f6cc` was cancelled by the next push. Later runs: see the handoff.
