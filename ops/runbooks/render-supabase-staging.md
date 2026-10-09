# Runbook — Render (free) + Supabase staging (M00-D1)

Status: **prepared, not executed.** Nothing in this runbook has been run against the real Supabase project or Render.
No secret value belongs in this file, in a commit, in a log, in evidence, or in a PR. Every `<placeholder>` below is
entered by the operator in a shell or in the Render dashboard.

Target (non-secret facts from the task spec): Supabase project ref `blavybabrrhfudxxrqlz`, PostgreSQL 17.11, region
Tokyo (ap-northeast-1). Render: one Free web service from `render.yaml` (`11ship-api-staging`).

## 0. Preconditions and blockers

| Item | State |
|---|---|
| M00-D2 (staging OTP binding) | **Not done.** `APP_ENV=staging` refuses to start without an OTP provider, so the service cannot become live until D2. Do not set `APP_ENV=development` on Render to get around it. |
| Frontend / app for the Owner | None. |
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

## 5. Deploy on Render (manual, after D2)

1. Dashboard → New → Blueprint → select the repo; review the plan (one Free web service).
2. Enter secret values: `DATABASE_URL` (runtime role), `DB_SSL_CA`, `AUTH_OTP_HMAC_SECRET`, `CRYPTO_ACTIVE_KEY_ID`,
   `CRYPTO_KEYRING`. Never the migration credential.
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
