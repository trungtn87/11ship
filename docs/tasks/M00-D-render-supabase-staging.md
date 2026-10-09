# M00-D — Render Free + Supabase staging
Date: 2026-10-09 (Vietnam).
Status: design prepared; NOT deployed or accepted.
Reviewed source: a53ffc949ec298cac232b046c2515a7c19b547ef.

## Authorized decisions
Owner chose Render Free backend and a separate Supabase project for online testing.
Local/CI PostgreSQL remains isolated for automated tests. No destructive integration suite runs on staging.
Real SMS integration is deferred until final acceptance before production.
Production provider may be Mat Bao; deployment must not depend on Render-specific business logic.
ChatGPT designs/reviews; Claude implements under the existing project workflow.

## Actual blockers
No Render Blueprint exists at reviewed source.
bindOtpProvider rejects staging and production; do not deploy as development to evade this gate.
Registration currently requires OTP proof. Disabling an SMS provider does not implement test registration.
Supabase project supplied and checked via connector: blavybabrrhfudxxrqlz, ACTIVE_HEALTHY, region ap-northeast-1, PostgreSQL 17.11; app schema absent at preflight.
Render workspace confirmed by Owner: tea-cvu8f4be5dus73ch67sg (Trung's workspace). No existing 11Ship service found.
Still required: verified session pooler endpoint/CA and restricted runtime connection. Database password is confidential and must never enter repository artifacts.
No frontend currently exists: backend deployment alone is not an Owner-testable app.
Supabase connector is available. Preflight query was read-only; no migrations or infrastructure changes have run.

## D1: Connection and deploy configuration
Create render.yaml for one Node web service, plan free, no paid worker/database.
Use committed Node/npm versions and lockfile; build npm ci including devDependencies then npm run build.
Start npm start; HOST=0.0.0.0, APP_ENV=staging, NODE_ENV=production.
Render supplies PORT. Health path /v1/health/ready.
Disable automatic deployment until exact reviewed commit and migrations pass acceptance.
Use explicit secret env vars: DATABASE_URL, AUTH_OTP_HMAC_SECRET, CRYPTO_ACTIVE_KEY_ID, CRYPTO_KEYRING.
Use Supabase session pooler over IPv4; small initial pool (2 connections).
Verify server certificate using Supabase CA; never use rejectUnauthorized=false.
Inspect existing pg setup before selecting SSL configuration. URL query options must not override certificate verification.
Separate migration and runtime credentials. Runtime role gets only required app privileges, not schema ownership or Supabase admin.
Migration runs explicitly, once, with lock, before deployment; never in app start/build.
Confirm actual Supabase PostgreSQL version and migration compatibility, including transaction_timeout.
Do not alter auth/public/storage schemas owned by Supabase or expose app schema through client Data API.
Secrets go through secret settings, not chat, repo, logs, evidence or Blueprint literals.

## D2: Test accounts without real SMS
Preferred initial implementation: allowlisted fixture accounts loaded through an explicit staging seed command.
No public registration bypass endpoint. UI communicates registration/SMS is temporarily unavailable.
Do not forge phone_verified=true; model fixture authorization explicitly if current invariants require verification.
Before implementation, inspect M01 invariants and document any minimal schema/API extension; design gate required.
Seed supports existing SHOP/DRIVER capabilities only, never invented ADMIN/SYSTEM/wallet/delivery privileges.
Allow test-only OTP-disabled binding in staging only when explicit configuration is present.
This binding must reject phone verification sends clearly; production always rejects it.
Keep existing fake OTP unit/integration coverage and production startup refusal.
Persist accounts/sessions in DB. Restart must not require an in-memory verification proof.
If Owner later wants self-service registration, design a protected staging-specific path separately.

## D3: Operations and portability
Provide deploy runbook, migration step, readiness check, exact SHA and rollback instructions.
Back up app data and migration history outside Supabase; encrypted keyring requires separate secure backup.
Never regenerate crypto keys per redeploy; historical replay needs historical keys.
Validate restore in isolated DB. No reset command targeting staging by default.
No always-on worker acceptance claim on Render Free. Dispatcher remains explicitly deferred until separately implemented.
Apps Script keepalive is optional and not an uptime guarantee; never changes business state.
Prepare replacement application server to use the same authoritative DB; application fallback is not DB failover.
No dual independent writable databases for orders/wallets.
Provider migration requires compatible schema, consistent backup, retained secrets and controlled cutover.

## D4: Acceptance
- [ ] Exact commit passes lint/typecheck/build/unit/integration CI.
- [ ] Blueprint validates; contains only authorized free service.
- [ ] Invalid production OTP-disabled configuration refuses startup.
- [ ] Staging fixture users login and session replacement behaves correctly.
- [ ] No fixture is falsely marked phone-verified.
- [ ] Supabase TLS verification and runtime permissions tested.
- [ ] Migrations succeed on actual remote PostgreSQL version.
- [ ] Health ready returns 200 with DB, fails correctly without DB.
- [ ] Restart/redeploy retains data and crypto replay ability.
- [ ] HTTP onboarding checks transaction/audit/idempotency on staging.
- [ ] Backup restore passes in isolated DB.
- [ ] Owner receives backend URL and separately identifies missing UI.
- [ ] Evidence records base/head, deploy ID, DB version and limitations, with no secrets.

## Dashboard
Add M00-D as foundation work with separate design, implementation, remote deployment and Owner acceptance.
Do not mark DONE on Blueprint generation or CI alone.
M01-UI may develop alongside D1/D2, and uses staging API after acceptance.
Real SMS remains a separate final gate for production.
