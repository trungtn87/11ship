# Claude handoff — M00-D1 Render/Supabase foundation
Owner authorized Render Free + Supabase online test. Implement D1 only first, preserving design → implementation → review workflow.

## Preflight
Fetch origin/main and record exact base SHA. Read repository instructions, ADR-001/002/003 and docs/tasks/M00-D-render-supabase-staging.md from design/m00-d-render-supabase (PR #22).
Do not assume PR #22 is merged. Carry approved design into implementation branch explicitly, or wait for design merge if repository workflow requires it.
Create feat/m00-d1-render-supabase. No unrelated changes, no auto-merge, keep PR Draft.

## Deliverables
1. render.yaml for a single free Node backend, no Render database/paid worker.
Build uses pinned runtime/npm and npm ci with build dependencies; start npm start.
HOST=0.0.0.0, APP_ENV=staging, NODE_ENV=production, health /v1/health/ready.
autoDeploy disabled until reviewed remote acceptance.
DATABASE_URL and crypto/auth secrets sync:false. Add required TLS secret configuration.
2. Strict pg TLS configuration compatible with Supabase session pooler:
CA supplied via secret/file mechanism, rejectUnauthorized:true, prevent connection URL SSL options from silently overriding CA.
Production/staging fail closed without required TLS configuration. Preserve local/CI behavior.
Audit pool creation and migration SSL separately. Dedicated explicit migration path, no migration on app boot or build.
3. Runbook: Supabase session pooler endpoint selection, migration credential vs limited runtime role, app schema privileges, migration lock, readiness, rollback.
Actual remote project is blavybabrrhfudxxrqlz, PostgreSQL 17.11, Tokyo. No secret in docs.
4. Meaningful tests for TLS fail-closed behavior, URL override rejection and config redaction; existing CI must pass.
5. Evidence of commands/checks with exact base/head. Clearly distinguish local/CI proof from remote proof.
6. Dashboard integration using existing manifest/resolver rules: D1 does not imply deployed/Owner-tested status.

## Scope boundaries
Do not weaken or bypass M01 OTP proof checks.
Current staging startup blocker is OTP binding; D1 must document that deploy cannot be live until D2 is implemented and reviewed.
Do not set APP_ENV=development on public Render to evade it.
Do not create fixture accounts with false phone verification.
D2 requires inspecting auth/onboarding invariants and a concrete follow-on design before schema/API changes.
No Supabase Auth migration, browser client DB credentials, wallet/delivery privileges or new UI.
No destructive integration suite on Supabase staging. No production data changes.
No live deploy from unreviewed code; deployment operator runs controlled remote migration and health checks after acceptance.
No secret/password values in commit, output, evidence or PR body.

## Validation
Run lint, typecheck, build, unit and integration suites on isolated PostgreSQL 17.
Validate Blueprint with official tool when available; otherwise report validation not performed.
Record limitations honestly. Keep PR Draft and return exact SHA, CI link and files changed for ChatGPT review.
