# Runbook — Render (free) + Supabase staging (M00-D1)

Status: **prepared, not executed.** Nothing in this runbook has been run against the real Supabase project or Render.
No secret value belongs in this file, in a commit, in a log, in evidence, or in a PR. Every `<placeholder>` below is
entered by the operator in a shell or in the Render dashboard.

Target (non-secret facts from the task spec): Supabase project ref `blavybabrrhfudxxrqlz`, PostgreSQL 17.11, region
Tokyo (ap-northeast-1). Render: one Free web service from `render.yaml` (`11ship-api-staging`).

## 0. Preconditions and blockers

| Item | State |
|---|---|
| M00-D2 (staging fixtures, OTP binding) | **Implemented in code (issue #49), not deployed.** `APP_ENV=staging` starts only in the staging fixture mode (§8). Do not set `APP_ENV=development` on Render to get around it. |
| Admin web hosted by the service | **Implemented in code (issue #49), not deployed.** Same origin as the API (§9). |
| Frontend / app for the Owner | The Admin web only; no mobile app. |
| Remote migrations | Not applied. |
| Render deploy | Not performed. `autoDeployTrigger` is `off`. |

## 1. Database endpoint

- Use the **Supabase session pooler** (port **5432**, IPv4, supports session features and advisory locks, which the
  migration lock needs). Never the transaction pooler (port 6543) and never the direct IPv6 host.
- Use the DNS host name shown in the dashboard (Connect → Session pooler). Never an IP address: the certificate host
  name is verified against it.
- Username has the pooler form `<role>.blavybabrrhfudxxrqlz`.
- The URL must have **no query string** (no `?sslmode=...`). The application and the migration tool refuse one,
  because pg lets URL parameters override explicit TLS options.
- Percent-encode special characters in the password.

## 2. TLS CA

1. Download the CA certificate from the Supabase dashboard (Database settings → SSL configuration). Treat the file as
   untrusted input until its fingerprint is recorded.
2. Record `openssl x509 -noout -fingerprint -sha256` of each certificate in the evidence file (fingerprints are not
   secret).
3. Provide the PEM through **exactly one** of `DB_SSL_CA` (PEM text; a single line with literal `\n` is accepted) or
   `DB_SSL_CA_FILE` (path of a secret file). Setting both or neither fails startup in staging/production.
4. Behaviour: chain and host name are verified (`rejectUnauthorized: true`), there is no plaintext fallback,
   `NODE_TLS_REJECT_UNAUTHORIZED=0` is refused. A successful start logs the fixed event `db_tls_verify_full`.
5. Rotation: replace the secret, redeploy manually. Verification failures surface as safe codes only
   (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, ...).

## 3. Roles and schema (templates — NOT executed)

Two roles. Run once, as the Supabase admin, in the SQL editor; replace passwords with generated values that are never
written down in the repo.

```sql
CREATE ROLE ship11_migrator LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE ship11_app      LOGIN PASSWORD '<generated>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE postgres TO ship11_migrator, ship11_app;
GRANT CREATE ON DATABASE postgres TO ship11_migrator;  -- needed by migration 1 (CREATE SCHEMA IF NOT EXISTS app)
CREATE SCHEMA app AUTHORIZATION ship11_migrator;      -- the migration tool never creates this schema
GRANT USAGE ON SCHEMA app TO ship11_app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated, service_role;
```

`GRANT CREATE ON DATABASE` is required even though schema `app` already exists: PostgreSQL checks that privilege
before honouring `IF NOT EXISTS` in the first migration (found by the disposable-database integration test; editing the
already-merged migration is not an option). It lets the migrator create further schemas in that database; keep that
role off the runtime service.

`ship11_migrator` owns schema `app`, runs `npm run db:migrate:remote`, and keeps its history table at
`app.pgmigrations` (never in `public`, which Supabase exposes through the Data API). `ship11_app` is the only role
the Render service uses.

Runtime grants are **explicit per table**, applied after the migrations create the tables. There is no
`ALTER DEFAULT PRIVILEGES`, no sequence grant (no sequences are used), and no access to `app.pgmigrations`.

| Table | Privileges for `ship11_app` |
|---|---|
| users | SELECT, INSERT, UPDATE |
| user_roles | SELECT, INSERT |
| phone_verifications | SELECT, INSERT, UPDATE |
| verification_proofs | SELECT, INSERT, UPDATE |
| sessions | SELECT, INSERT, UPDATE |
| service_areas | SELECT, UPDATE (UPDATE only because `FOR SHARE` needs it) |
| shops | SELECT, INSERT, UPDATE |
| shop_members | SELECT, INSERT |
| drivers | SELECT, INSERT, UPDATE |
| shop_business_hours | SELECT, INSERT, DELETE |
| idempotency_records | SELECT, INSERT, UPDATE, DELETE |
| outbox_events | SELECT, INSERT, UPDATE |
| audit_logs | INSERT only |
| admin_memberships | SELECT, INSERT, UPDATE (INSERT: the activation (M01-D-ADMIN-1C) creates ADMIN-role rows; the SYSTEM row is created by the operator command; UPDATE also because `FOR UPDATE/SHARE` needs it) |
| admin_auth_challenges | SELECT, INSERT, UPDATE |
| admin_totp_factors | SELECT, INSERT, UPDATE, DELETE |
| admin_sessions | SELECT, INSERT, UPDATE |
| admin_auth_limit_config | SELECT only (written once by the operator command) |
| admin_auth_limits | SELECT, INSERT, UPDATE |
| admin_invitations | SELECT, INSERT, UPDATE (no DELETE: a trigger refuses it; UPDATE is the seal, the terminal transition and `FOR UPDATE`) |
| admin_invitation_permissions | SELECT, INSERT (snapshot rows are immutable) |
| admin_sensitive_operations | SELECT, INSERT, UPDATE (no DELETE: a trigger refuses it; UPDATE is the replace/verify/consume/attempt transition and `FOR UPDATE`) |
| admin_activation_attempts | SELECT, INSERT, UPDATE (no DELETE: a trigger refuses it; UPDATE is the state transition, the wrong-TOTP counter and `FOR UPDATE`) |
| admin_activation_otp_challenges | SELECT, INSERT, UPDATE (no DELETE: a trigger refuses it; UPDATE is promote/verify/lock/invalidate and `FOR UPDATE`) |
| admin_profiles | SELECT, INSERT (written once at activation) |
| admin_app_permissions | SELECT, INSERT (written once at activation) |
| customer_profiles | SELECT, INSERT, UPDATE (M01.02: UPDATE is the version-checked profile edit and `FOR UPDATE`; no DELETE: a customer profile is never removed by the runtime) |
| user_consents | SELECT, INSERT (M01.02: append-only; a trigger refuses UPDATE and DELETE for every role, and the runtime has neither privilege nor TRUNCATE) |

```sql
-- example shape, repeat per row of the table above
GRANT SELECT, INSERT, UPDATE ON app.users TO ship11_app;
```

This matrix is derived from reading the source (static analysis), not from running the application against a
restricted role. **D4 must verify it** by exercising the real endpoints. Row locks (`FOR UPDATE/SHARE`) need UPDATE,
and `ON CONFLICT (cols)` needs SELECT; a missing grant shows up as `42501`.

Verification queries (run as admin; expected result: no access / not exposed):

```sql
SELECT has_schema_privilege(r, 'app', 'USAGE') FROM unnest(ARRAY['anon','authenticated','service_role']) r;  -- all false
SHOW pgrst.db_schemas;   -- or Dashboard → API settings: schema "app" must not be an exposed schema
```

### Administration authentication (M01-D-LOGIN)

The administration web login is **off by default** (`ADMIN_AUTH_ENABLED` unset or `false`: no route is mounted and no
admin variable is read). The account-origin migration changes `app.users` (`phone_verified_at` becomes nullable, a new
`account_origin` column defaults to `PHONE_VERIFIED`), so apply the migrations **before** deploying the code that reads
it. The rows of the table above for `admin_*` are likewise derived from reading the source and must be verified in D4.

Two operator commands run from a controlled machine, never from Render and never at build or start. They use the
**migration** credential and the same target rules as `db:migrate:remote` (`APP_ENV=staging`, `MIGRATION_DATABASE_URL`,
`DATABASE_URL`, a CA variable, `MIGRATION_CONFIRM_TARGET`) plus the limiter key variables, set in the shell only:

1. `ADMIN_RATE_LIMIT_HMAC_KEY` (base64, 32 random bytes) and `ADMIN_RATE_LIMIT_KEY_ID`. The same pair must be set on the
   Render service when `ADMIN_AUTH_ENABLED=true`; the service refuses to start if it differs from the stored one.
2. `npm run admin-auth:init-limit-config` - writes the limiter configuration row once; a second run with the same key
   says `unchanged`, a different key is refused.
3. `npm run admin-auth:bootstrap-system` - creates the single SYSTEM account. The credentials come from **standard
   input only**, as one JSON object `{"phone": "...", "password": "..."}` (no argument, no environment variable). Feed it
   from a protected file that you delete afterwards, for example `npm run admin-auth:bootstrap-system < /secure/path`.
   The command prints one fixed word (`created` / `unchanged`) or one refusal code, never the phone, password or ids.

Do not run step 3 until the owner has approved the account; there is no recovery path in this slice (a lost password or
authenticator on the only SYSTEM account needs a separate, reviewed procedure).

M01-D-ADMIN-1B (ADMIN invitations) adds, when `ADMIN_AUTH_ENABLED=true`:

- `ADMIN_ACTIVATION_ORIGIN` - **required**; must be exactly one of `ADMIN_AUTH_ALLOWED_ORIGINS`. The service refuses to
  start when it is missing or not allowed (it never picks an origin by itself). Activation links are
  `<origin>/activate#t=<token>`; the token is shown once to the SYSTEM administrator and only its SHA-256 is stored.
- `ADMIN_INVITATION_TTL_HOURS` - optional, integer 1..168, default 72. It applies to NEW invitations only (snapshotted
  into `expires_at`); a change never extends an existing invitation.
- The table `admin_sensitive_operations` (grant row above). Apply the migration before deploying the code that uses it.

M01-D-ADMIN-1C (account activation) adds, **off by default** (`ADMIN_ACTIVATION_ENABLED` unset or `false`: no route is mounted):

- Three migrations (activation tables, limiter kinds, membership origin guard) and the four tables with the grant rows above. Apply the migrations **before** deploying the code that uses them. The grant of `admin_memberships` gains `INSERT`.
- `ADMIN_ACTIVATION_ENABLED=true` needs `ADMIN_AUTH_ENABLED=true` and an **explicit** `ADMIN_ACTIVATION_OTP_MODE`. There is no real SMS adapter yet, so `SMS` refuses startup; `FAKE` and `TEST_DISPLAY` are accepted **only** with `APP_ENV` of `development` or `test` and never in staging/production, and nothing falls back to a test provider.
- Optional: `ADMIN_ACTIVATION_OTP_PROVIDER_TIMEOUT_MS` (500..30000, default 8000) and `ADMIN_ACTIVATION_OTP_PROMOTE_GRACE_MS` (1000..60000, default 10000). The section 7 TTLs and thresholds are optional variables whose defaults ARE the approved section 7 values (`ADMIN_ACTIVATION_ATTEMPT_TTL_SECONDS` 1800, `…_OTP_TTL_SECONDS` 300, `…_OTP_RESEND_COOLDOWN_SECONDS` 60, `…_PASSWORD_DEADLINE_SECONDS` 600, `…_OTP_SEND_LIMIT` 5, `…_OTP_SEND_WINDOW_SECONDS` 3600, `…_REQUEST_LIMIT` 30, `…_REQUEST_WINDOW_SECONDS` 60, `…_LINK_FAILURE_LIMIT` 10, `…_LINK_FAILURE_WINDOW_SECONDS` 900, `…_LINK_FAILURE_LOCK_SECONDS` 900, `…_TOTP_FAILURE_WINDOW_SECONDS` 900, `…_TOTP_FAILURE_LOCK_SECONDS` 900). Leave them unset unless the Owner changes a value. An invalid value stops startup naming the variable only. The wrong-code limits (OTP 5, TOTP 5) are fixed by the database schema and are not variables.
- Down migration B refuses to run while activation limiter buckets exist (by design): clear them with the operator procedure first.

### Customer schema (M01.02)

Migration `1792540800000_create-customer-profiles-consents` adds `app.customer_profiles` and `app.user_consents`, accepts the
storage role `CUSTOMER` (the role CHECK was already open) and backfills ordinary phone-verified accounts. **Not applied to
any remote database by this package**; the Owner decides when. Procedure when the time comes:

1. Apply the migration with `db:migrate:remote` **before** deploying code that uses the participant. The legacy `/auth`
   routes ignore `CUSTOMER`, so old code keeps working against the new schema.
2. The migration refuses to run (message starting `M01.02 prerequisite failed:`) when `app.users`, `app.user_roles`,
   `app.admin_memberships`, `users.account_origin` or the role CHECK are not what it expects. That is schema drift:
   stop and report it (issue #49); never mask it with `IF EXISTS` or a hand-made enum/fixture.
3. Grant the runtime role exactly the two new rows of the table above, as admin:

```sql
GRANT SELECT, INSERT, UPDATE ON app.customer_profiles TO ship11_app;
GRANT SELECT, INSERT ON app.user_consents TO ship11_app;
```

4. Backfill report (counts only, no phone, name or id), read-only:

```sql
SELECT (SELECT count(*) FROM app.user_roles WHERE role = 'CUSTOMER')   AS customer_roles,
       (SELECT count(*) FROM app.customer_profiles)                    AS profiles,
       (SELECT count(*) FROM app.customer_profiles WHERE full_name IS NOT NULL) AS named_profiles,
       (SELECT count(*) FROM app.user_consents)                        AS consents;
```

   The migration also prints one `NOTICE` with `users / eligible / excluded / customer_roles_inserted /
   customer_profiles_inserted`. Eligible means `account_origin = 'PHONE_VERIFIED'`, `phone_verified_at` set and **no**
   `app.admin_memberships` row. Backfilled profiles have `full_name = NULL` (no driver name is copied) and no consent is
   invented. Re-running the backfill adds nothing and overwrites nothing.
5. Consents are append-only: a trigger refuses `UPDATE` and `DELETE` for every role, and the runtime has no `TRUNCATE`.
   A wrong consent row is corrected forward by a new migration or a reviewed one-off by the schema owner, never by the
   application.
6. **Never run the Down migration on a remote database.** It refuses while a consent or a named/edited profile exists;
   the fix for a defect is a new forward migration.

## 4. Migration procedure

Run from a controlled machine, never from Render, never at build or start.

1. Check out the exact reviewed commit SHA; `npm ci`; `npm run build` (the tool loads `apps/backend/dist`).
2. Set in the shell only (never a file): `APP_ENV=staging`; `MIGRATION_DATABASE_URL` (migrator role); `DATABASE_URL`
   (runtime role — **required**, used only to prove the split); one of `DB_SSL_CA`/`DB_SSL_CA_FILE`; and
   `MIGRATION_CONFIRM_TARGET=<pooler host>:5432/postgres/<project ref>`. Both URLs must be the **session pooler on
   port 5432** with user names `<role>.<project ref>`; the host name alone does not identify a project on a shared
   pooler, which is why the project ref and port are part of the typed target.
3. `npm run db:migrate:remote` — default is a **read-only check**: prints applied / pending / unknown migration names
   and counts.
4. `npm run db:migrate:remote -- --apply` — applies pending migrations with the tool lock kept. It refuses, before
   creating any database client, when: not staging/production; either URL missing, malformed, not port 5432 (6543 and
   every other port are refused), or without a `<role>.<project ref>` user name; the two URLs differ in host, port,
   database or project ref; both URLs use the same role; TLS settings are unmet; the typed target does not match.
   After connecting it refuses when PostgreSQL < 17, when schema `app` is missing, or when the database history
   contains a migration **name** this checkout does not have.
5. Record the printed names/counts, the commit SHA and the time in the evidence. Never paste URLs or errors that may
   contain them.

`npm run db:migrate` refuses `APP_ENV=staging|production`.

## 5. Deploy on Render (manual, after the Owner accepted the issue #49 PR)

1. Dashboard → New → Blueprint → select the repo; review the plan (one Free web service).
2. Enter secret values: `DATABASE_URL` (runtime role), `DB_SSL_CA`, `AUTH_OTP_HMAC_SECRET`, `CRYPTO_ACTIVE_KEY_ID`,
   `CRYPTO_KEYRING`, `ADMIN_RATE_LIMIT_HMAC_KEY`, `AUTH_STAGING_ALLOWED_PHONES`, `ADMIN_AUTH_ALLOWED_ORIGINS` and
   `ADMIN_ACTIVATION_ORIGIN` (§8, §9). Never the migration credential.
3. Manual deploy of the exact commit whose migrations were applied in §4.
4. Success = `/v1/health/ready` returns 200 (database reachable over verified TLS). 503 means the database is not
   reachable or TLS verification failed; the log shows safe codes only.
5. Free tier spins down when idle; the first request after a spin-down is slow (cold start plus TLS/auth, bounded by
   `DB_CONNECT_TIMEOUT_MS=5000`).

## 6. Rollback

- Application: manual redeploy of the previous known-good commit in Render.
- Database: **fix forward** with a new migration. Never run `down`, never reset the database, never drop schema `app`.
- A migration that was applied remotely is **never edited**; this is a rule for people, not something the tool
  enforces. The tool compares migration **names** only: it detects a database history that contains a name this
  checkout does not know. It stores and compares **no checksum**, so it does **not** detect a migration file whose
  content was changed after it was applied. Checksum verification is not implemented in D1.

## 7. Not verified yet (remote unknowns)

These could not be checked from the build environment (no outbound access to the vendors' documentation or to the
real services). Each must be confirmed in D2/D4 or at first manual deploy:

- Supavisor accepting the `statement_timeout` startup parameter the pool sends.
- The pooler certificate chain/SAN matching the pooler host name with the downloaded CA.
- `npx --yes npm@11.9.0 ...` in the Render build.
- `autoDeployTrigger: "off"` is confirmed as a Blueprint key in Render's official Blueprint specification
  (https://render.com/docs/blueprint-spec). That confirms one key only; it is **not** a validation of the whole
  Blueprint by Render's tooling.
- Render region choice (`singapore` is a proposal; cannot be changed after creation).
- Official Render Blueprint validation (`render blueprints validate`) — **not performed**; only the repository's
  structural check (`npm run deploy:validate`) has run.
- node-pg-migrate 8.0.4 `runner` option names (`dbClient`, `migrationsSchema`, `createMigrationsSchema`) — exercised
  only by CI (`remote-migration-runner.int.spec.ts`).
- Grants matrix in §3 (static analysis only).
- The whole of §8 and §9 on a real Render service and the real Supabase project (nothing was deployed, seeded or
  migrated remotely by issue #49).

## 8. Staging fixtures (issue #49, from M00-D2)

Staging has no SMS provider, so the service runs in a **closed fixture mode**: `AUTH_STAGING_FIXTURES_ENABLED=true` (in
`render.yaml`) and `AUTH_STAGING_ALLOWED_PHONES` (dashboard; JSON array of at most 20 normalized `+84…` numbers).

- `DisabledOtpProvider` is bound; registration and OTP request/verify answer `503 AUTH_REGISTRATION_UNAVAILABLE`.
- Only accounts with `account_origin = 'STAGING_FIXTURE'` whose phone is in the allowlist can sign in through the
  application Auth, and verified (`PHONE_VERIFIED`) accounts are **not** accepted while the mode is on. Removing a number
  from the allowlist (or switching the mode off) invalidates that account's existing sessions at the next request: the
  policy is applied again at every bearer authentication and under the row locks of every command.
- A fixture has no role, no profile and no session until it logs in, and it can **never** hold an administration
  membership (the database refuses it; see `1792454400000`). `ADMIN`/`SYSTEM` are never created by the seed.
- Production: the flag is refused at startup (`APP_ENV=production` + the flag stops the process naming the variable),
  and the policy ignores it a second time.
- The mode is for the Owner's staging only; it is not a way to test real OTP.

Seed (operator machine, **never** Render, **never** run by the assistant against the Owner's database):

1. `npm ci && npm run build`; set the same shell variables as §4 plus `AUTH_STAGING_FIXTURES_ENABLED=true` and
   `AUTH_STAGING_ALLOWED_PHONES`.
2. Apply the migrations first (§4). The seed checks that `users_account_origin_ck` accepts `STAGING_FIXTURE` and stops
   otherwise.
3. Pipe the accounts on standard input (no argument exists, so nothing reaches a process list):
   `printf '%s' '[{"phone":"+84…","password":"…"}]' | npm run staging:seed-fixtures`
4. The command prints only counts. One transaction, one advisory lock: a batch that meets a verified or an
   administration account writes nothing; an existing fixture is left unchanged (re-running is safe, passwords are not
   reset).

## 9. Admin web on the same origin (issue #49, from PR #42)

The Node process serves `apps/admin-web/dist` (built by the build command, `npm run build:admin-web`) and the API on one
origin; Render terminates HTTPS. This is required because the administration cookies are `__Host-*` cookies (Secure,
`Path=/`, no `Domain`) and the page calls the API with `credentials: 'same-origin'`.

- Enabled by `ADMIN_WEB_STAGING_ENABLED=true`, valid only for `APP_ENV=staging` **and** `ADMIN_AUTH_ENABLED=true`
  (otherwise startup stops naming the variable). `ADMIN_AUTH_ALLOWED_ORIGINS` = `["https://<service>.onrender.com"]` and
  `ADMIN_ACTIVATION_ORIGIN` = that same origin.
- Served: an explicit allowlist of built files and the exact browser routes of the frontend (`/`, `/activate`,
  `/invitations`, `/invitations/new`, `/invitations/<uuid>[/reissue|/revoke]`). Everything else is `404` with the security
  headers (CSP `default-src 'none'`, `no-store`, `nosniff`, …). `GET`/`HEAD` only (`405` otherwise). Nothing under
  `/v1` is ever answered by the hosting, including health. It is installed before the body parser.
- `ADMIN_ACTIVATION_ENABLED` stays **off** on Render: activation needs an OTP adapter that does not exist yet (the
  application refuses `SMS`, and `FAKE`/`TEST_DISPLAY` outside development/test). The `/activate` page is served, but its
  API is not exposed on staging until that adapter exists. Local activation testing uses the local HTTPS front.
- The SYSTEM administrator is created by the operator command `admin-auth:bootstrap-system` (not by this issue).

## 10. Migration history of `account_origin` (issue #49)

Two histories exist for the same column:

| History | Migrations that touch `account_origin` | Where it can exist |
|---|---|---|
| current main | `1791936000000_add-users-account-origin` then `1792627200000_allow-staging-fixture-account-origin` (after the M01.02 customer migration `1792540800000`; the timestamp was moved from `1792540800000` before it was ever applied) | fresh databases, databases migrated from main |
| D2 (PR #27) | `1791849600000_add-users-account-origin` (PHONE_VERIFIED/STAGING_FIXTURE only) | only a database that applied PR #27's branch |
| #42 | `1791849600000_…` + its own `1791936000000_…` | only a database that applied PR #42's branch |

The repository contains only the main history. The runner refuses (names an applied migration it does not know), loudly
and without changing anything, on a D2/#42 database. **Operator gate — not performed by the assistant.** To recognise
which history a REAL database has, run these **read-only** queries with the operator role and record the results in the
evidence (never paste URLs or credentials):

```sql
SELECT name FROM app.pgmigrations WHERE name LIKE '%add-users-account-origin' ORDER BY id;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'app.users'::regclass AND conname IN ('users_account_origin_ck', 'users_origin_verified_ck');
SELECT account_origin, count(*) FROM app.users GROUP BY 1;
```

- Only `…1791936000000_add-users-account-origin` listed (or nothing, on a fresh database): the normal path, §4.
- `…1791849600000_…` is listed: the database is on the D2/#42 history. If it is a disposable staging database, recreate
  it (or drop schema `app` and the history table) and apply §4 from scratch; **any fixture or administration row in it is
  lost, so decide with the Owner first**. If it holds data that must be kept, **stop**: report to ChatGPT/Owner; a
  hand-written reconciliation of `app.pgmigrations` is an operator decision with a backup, and is outside this issue.
