# Evidence — issue #49: staging fixtures and same-origin Admin web reconciled with current main

Status: **DRAFT PR, not merged, not deployed, not seeded, not migrated remotely.** Nothing here is Owner acceptance, and
green CI is not Owner acceptance.

## Revisions

| Item | Value |
|---|---|
| Issue | #49 "M00 follow-up: reconcile staging fixtures and hosted Admin with current main (#27/#42)" |
| Sources (closed, not merged) | PR #27 `18cb54b6afc524655c075958bb61b84164e43532`, PR #42 `13a596254fed75544bfc1f461d48086c863e4c43` |
| Base (`main`) | `f90b78a938036aa169179185aba6adab81e6d473` |
| Branch | `feat/m00-staging-fixtures-hosted-admin-49` |
| Final head | the PR head SHA in the PR and the hand-over report (a commit cannot contain its own SHA) |

## What was reconciled

- **Account origin.** Main already has `account_origin` (`PHONE_VERIFIED` / `ADMIN_PROVISIONED`, migration `1791936000000`) and
  the membership origin guard (`1792454400000`). One new forward-only migration `1792627200000_allow-staging-fixture-account-origin`
  replaces `users_account_origin_ck` and `users_origin_verified_ck` so `STAGING_FIXTURE` (no `phone_verified_at`) is accepted.
  It adds no column, uses no `IF [NOT] EXISTS`, no `CASCADE`; its down refuses while a fixture exists.
- **Application Auth.** `AccountOriginPolicy` decides, for every origin, whether an account may use the application Auth
  in this process; it is applied at login, at bearer authentication and again under the row locks in the session
  authorization participant (policy rejection is not revocation). `ADMIN_PROVISIONED` is never accepted (login keeps its
  constant-time dummy verify). Fixture mode is exclusive of verified accounts; registration/OTP answer 503
  `AUTH_REGISTRATION_UNAVAILABLE`. Production ignores and refuses the flag. Password/TOTP admin auth, 1C activation,
  subkeys, lock order and the session policy are untouched.
- **Seed.** `StagingFixtureSeeder` + `scripts/staging-seed-fixtures.js` (`npm run staging:seed-fixtures`): operator command,
  APP_ENV=staging only, same target gates as `db:migrate:remote`, accounts on STDIN, one transaction, one advisory lock,
  existing fixtures untouched, other accounts abort the batch, no role/profile/session, audit
  `auth.staging_fixture_created.v1`. A fixture can never be ADMIN/SYSTEM (database trigger).
- **Same-origin Admin web.** `installAdminWebHosting` (explicit asset allowlist + the frontend's exact routes, GET/HEAD,
  `/v1` never intercepted, security headers, installed before the body parser). `ADMIN_WEB_STAGING_ENABLED` is valid only on
  staging with `ADMIN_AUTH_ENABLED=true`. `render.yaml` builds `apps/admin-web` and declares the new variables
  (`sync: false` for origins, limiter key, phone allowlist); the blueprint validator and its tests were extended.

## Migration decision

**Timestamp (sync with main after M01.02).** Main gained `1792540800000_create-customer-profiles-consents` (M01.02), the same timestamp this PR's
unapplied fixture migration used. The fixture migration was never applied anywhere, so it was renamed to the next free slot
`1792627200000_allow-staging-fixture-account-origin` (after the last migration of main); the applied/merged migrations are untouched. Both migrations are kept,
the four history pins (auth, driver, shop, business-hours) list customer then fixture, and the M01.02 suite pins customer as the newest M01.02 migration followed by the fixture one (its `BEFORE` history now ends before the customer migration, not before the last file).
Main's new `customer-legacy-compat` suite pinned the exact `/auth/login` and `/auth/me` keys of the time; this PR adds the additive field `phone_verification_status` to both (already in the PR's contract), so those two pins list it. `/auth/register` is unchanged.

Main's history is canonical; the earlier `1791849600000_add-users-account-origin` is NOT part of the repository (next to
`1791936000000` it would add the column twice). History matrix (`tests/integration/staging-fixture-migration.int.spec.ts`):

| History | Result |
|---|---|
| fresh | applies; column once; three origins and pairing enforced; fixture cannot become ADMIN/SYSTEM |
| main history | upgrades in place; existing `PHONE_VERIFIED`/`ADMIN_PROVISIONED` rows unchanged |
| D2 history | runner refuses (unknown applied name), nothing changes |
| #42 history | runner refuses; the new SQL converges the constraints to the fresh text |

Real databases on the D2/#42 history need an **operator gate** with read-only queries (runbook §10). Not performed.

## Design points to return to ChatGPT / Owner

1. A real database that applied PR #27/#42 cannot be upgraded by the single linear migration set; options: recreate a
   disposable staging DB, or an operator-approved history repair with a backup. Decision needed only if such a database exists.
2. `ADMIN_ACTIVATION_ENABLED` cannot be on in staging (no OTP adapter); the hosted `/activate` page is served but its API is off.
   "Frontend activation on the same origin" is therefore verified at the asset/route/relative-API level and by the existing
   browser suite on the local HTTPS front, not end to end on staging.
3. The M00-D2 design (PR #26) states it must merge before code; it is referenced, not changed, here.

## Follow-up F1/F2 (review of PR #51, after the first green CI)

CI was green on `849764264b20ed8e00dd1e71beb1e347644dafee` (Verify Node 24 / PostgreSQL 17; Windows PowerShell 5.1 launcher). That result
does NOT cover what follows; the final SHA of this follow-up is reported in the PR.

- **F1 transport headers before the body parser.** `configureApp` now installs `adminTransportMiddleware` with `app.use` for
  `/v1/admin-auth` and `/v1/admin` (like `/v1/admin-activation`, per
  `docs/tasks/M01-D-ADMIN-BACKEND-transport-headers-followup.md`). It only sets `Cache-Control: no-store`, `Pragma`,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; Auth/Origin/CSRF are untouched (module middleware kept).
  Test: `admin-transport.int.spec.ts` (broken JSON → 400 `BAD_REQUEST`, body over the limit → 413 `CLIENT_ERROR`, standard
  envelope + headers, on both prefixes; health, `/v1/auth` and `/v1/administrator` unaffected; wrong Origin/no session unchanged).
- **F2 browser evidence for the NEW hosting.** `admin-web-hosted-browser.int.spec.ts` serves the built frontend with
  `installAdminWebHosting` from the same Nest process as the Admin API and PostgreSQL, behind a byte-copying TLS terminator
  (not `scripts/admin-web-dev.mjs`). It checks login → TOTP → `GET /me` → shell → deep-link reload of `/invitations` and
  `/invitations/new` → logout; the CSP the browser enforces equals the hosting's; no CSP violation, blocked or failed request,
  console error or off-origin request; `__Host-` cookie attributes; no credential in storage; unknown path = 404 with headers; `/v1`
  not intercepted.
- **Older browser suites** (`admin-web-browser`, `admin-web-admin`, `admin-web-proxy`) still use the local HTTPS front proxy. They
  prove the frontend and the Admin API, NOT the hosting middleware; they are not evidence for it.
- **Not accepted:** activation on staging. The activation API is not enabled there (no OTP adapter; no fake OTP is enabled
  on staging), and F2 does not run an activation. Activation on the hosted page remains un-accepted until a real OTP adapter exists.
- **DB history gate unchanged:** the D2/#42 history check stays read-only (runbook §10); nothing in the history was edited
  and no database was deleted.

## Tests

Local sandbox limits: the npm registry is blocked (no `npm ci`), Node 22 instead of 24, PostgreSQL 16 instead of 17. Locally
verified: deploy tests (`node --test tests/deploy`), the blueprint validator, the migration SQL matrix on PG16, and the unit
specs through stand-ins for jest/Nest/argon2. Everything else (lint, typecheck, build, unit, integration, launcher tests on
PS7 / Windows PS5.1) is **verified by CI on the exact final SHA** only; see the PR for the result.

## Module checklist (docs/templates/module-delivery-checklist.md)

| Ứng dụng | Phạm vi | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|
| Web quản trị | Hosting cùng origin + fixtures auth backend | Draft PR, CI chờ | Owner chạy theo runbook | N/A (web) | Chưa — Owner quyết định |
| Khách / Quán / Shipper | Chỉ ảnh hưởng đăng nhập bằng fixture (backend) | Draft PR, CI chờ | Chưa | Chưa | Chưa — Owner quyết định |
| Food / Ship | N/A: ngoài phạm vi issue #49 (không triển khai) | N/A | N/A | N/A | N/A |
| App quản lý | N/A: không có trong issue #49 | N/A | N/A | N/A | N/A |
