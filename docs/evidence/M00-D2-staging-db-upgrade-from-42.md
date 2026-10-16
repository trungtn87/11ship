# Evidence — staging DB upgrade package from the PR #42 history (issue #49 follow-up)

Status: **DRAFT PR, code/test/plan only. Not merged, not deployed, nothing executed against any remote database.** This is not
Owner acceptance and green CI is not Owner acceptance.

## Revisions

| Item | Value |
|---|---|
| Base | PR #51 head `54492df16f824b74cccf3552a33316b3d8ac5b1b` (branch `feat/m00-staging-fixtures-hosted-admin-49`) |
| Branch | `ops/staging-db-upgrade-from-42-49` |
| Final head | the PR head SHA in the PR and the hand-over report |

## Sync with main after M01.02

Main gained `1792540800000_create-customer-profiles-consents`; PR #51 moved its unapplied fixture migration to `1792627200000_allow-staging-fixture-account-origin`.
The standard history is now 16 migrations. The tool executes every migration file of the checkout, so the upgrade now also creates `customer_profiles` and `user_consents`
(empty: the SYSTEM is ADMIN_PROVISIONED and is never backfilled as a customer). The suite pins the 16-name history, the two M01.02 tables, and compares schema/history with a fresh database.

## Owner decision implemented

Keep only the current SYSTEM account (user, phone, password hash, SYSTEM membership, TOTP factor and its anti-replay step, limiter
check row). Other test data may be dropped; old sessions are revoked. Password and Authenticator must keep working; keyring unchanged.

## Deliverables

- `scripts/staging-db-upgrade-from-42.js` / `npm run staging:db-upgrade-from-42` — dry-run default; `--apply`; `--restore-snapshot`.
- `ops/runbooks/staging-db-upgrade-from-42.md` — operator procedure, stop conditions, failure recovery (linked from runbook §10).
- Tests: `tests/deploy/staging-db-upgrade-from-42.test.mjs` (gates, snapshot crypto/permissions, no output of secrets) and
  `tests/integration/staging-db-upgrade-from-42.int.spec.ts` (PostgreSQL, guarded test DB, exact PR #42 history).

## Design points

- **No history surgery.** The history table is emptied and refilled by really executing every migration file of the checkout in
  order; the result is compared with a database migrated by the real runner (schema fingerprint: columns, constraints, indexes,
  triggers, functions; history ids and names).
- **One transaction** with the runner's advisory lock, `lock_timeout` 10 s, `ACCESS EXCLUSIVE` on the tables, the identity re-read and
  compared with the snapshot under the locks. A failure before COMMIT rolls back; the database is as before.
- **COMMIT outcome unknown (review finding F1).** A failure of the `COMMIT` statement itself (lost connection or lost acknowledgement) is reported as the fixed code
  `COMMIT_OUTCOME_UNKNOWN`, exit code 2, for `--apply` and `--restore-snapshot`. The tool does not claim a rollback, sends nothing after the COMMIT
  (no ROLLBACK, no retry), and keeps the snapshot and key. `--verify` (read-only, REPEATABLE READ READ ONLY) classifies `PRE_UNCHANGED` /
  `UPGRADED_OK` / `MIGRATED_WITHOUT_SYSTEM` / `ABNORMAL` by comparing the SYSTEM identity with the snapshot (a complete history alone is not accepted).
- **No CASCADE (review finding F2).** All target tables are dropped by ONE `DROP TABLE … RESTRICT` statement and the function by `DROP FUNCTION … RESTRICT`.
  PostgreSQL resolves the dependencies between the tables of the list and refuses any dependency from outside (`2BP01` → `EXTERNAL_DEPENDENCY`, transaction
  rolled back). An early check (also in the dry-run) reports views/rules and foreign keys of other schemas. Checked on the 15 real migrations: all 19+ tables drop in
  one RESTRICT statement; a view in `public` over `app.users` makes it fail.
- **Identity preserved exactly** (ids, versions, factor ciphertext/iv/tag, key id, `last_accepted_step`). The factor is proven to decrypt with the
  provided keyring before and after (AAD binds key id, user id, factor id, factor version).
- **Snapshot**: AES-256-GCM, exclusive create, mode 0600, outside the repository, read back; used only by `--restore-snapshot` on a migrated,
  administrator-less database. Nothing sensitive is printed (counts and fixed codes only).
- **Stop conditions** (no change, no snapshot): wrong/partial/extra history, unexpected or missing objects, wrong origin constraints, not exactly one
  SYSTEM user/membership/factor, data linked to the SYSTEM, keyring unable to open the factor, PostgreSQL < 17.
- **Not done by the tool**: the runtime role's grants on tables that did not exist before (runbook §3), fixtures (runbook §8), Render.

## What the integration suite proves

Upgrade succeeds; the SYSTEM logs in again through the real Admin API with the OLD password and a code from the OLD secret; a code of a
step not after the stored step is refused (anti-replay carried over); exactly one user/membership/factor; the old admin session cookie is
rejected; `admin_sessions`/`sessions`/test data are empty; schema and history equal a fresh database; existing table grants return; one
audit row; dry-run changes nothing; a failing migration (middle/last), a failing audit write, a busy advisory lock, a busy table and a changed
identity each leave the whole database state unchanged (and the same database then upgrades); snapshot is encrypted (no hash/phone in the file),
0600, decrypts to the identity, and recovers a lost SYSTEM; each stop condition above changes nothing and writes no snapshot.
Follow-up suite: COMMIT succeeded with the ACK lost, and the connection terminated before COMMIT, for both `--apply` and `--restore-snapshot` (exit 2, fixed code, no
"rolled back" claim, COMMIT asked once and nothing sent after it, snapshot kept, `--verify` reports the true state and changes nothing, `--verify` is `ABNORMAL` for a
different identity or a second user although the history is complete); a view outside `app`, a foreign key from a table outside `app`, and a function body in another schema
each make the tool refuse (dry-run/`--apply`/`rebuild()`), the transaction rolls back, and objects and data outside `app` are unchanged; independent outside objects survive an upgrade.

## Local verification limits

The npm registry is blocked in the sandbox (no `npm ci`, no `pg`), Node 22, PostgreSQL 16. Verified locally: `node --test tests/deploy`
(74 pass), and a `psql` rehearsal of the core rebuild SQL (drop every table of `app` in one RESTRICT statement + execute all 15 Up sections (before M01.02 was merged; CI now runs the 16); a view outside `app` makes the drop fail) on a database
built with the exact PR #42 history: its schema fingerprint equals a fresh database. The JavaScript tool and the integration suite are
**verified by CI on the exact final SHA only**.

## Module checklist (docs/templates/module-delivery-checklist.md)

| Ứng dụng | Phạm vi | Code/CI/review | Local | Thiết bị thật | Owner nghiệm thu |
|---|---|---|---|---|---|
| Web quản trị | Công cụ vận hành DB staging (giữ SYSTEM) | Draft PR, CI chờ, ChatGPT review chờ | Chưa — Owner chạy theo runbook sau review | N/A (web) | Chưa — Owner quyết định |
| Khách / Quán / Shipper | N/A: không đổi mã ứng dụng; dữ liệu thử bị bỏ khi nâng cấp | N/A | N/A | N/A | N/A |
| Food / Ship / App quản lý | N/A: ngoài phạm vi | N/A | N/A | N/A | N/A |
