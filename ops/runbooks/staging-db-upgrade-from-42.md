# Runbook — move the staging database from the PR #42 history to the standard history (issue #49 follow-up)

Status: **prepared for review. Nothing here has been run against any remote database.** The Owner decides when to run it,
after ChatGPT's review of the PR and after the PR is merged (or the reviewed commit is checked out). Green CI is not Owner acceptance.

## What it is

`npm run staging:db-upgrade-from-42` moves a **disposable staging database** whose migration history comes from PR #42
(10 migrations, including `1791849600000_add-users-account-origin` and PR #42's own `1791936000000_add-users-account-origin`)
onto the history and schema of this checkout (15 migrations, the standard history). Owner's decision it implements: keep
**only the current SYSTEM administrator**; every other test row is dropped; old login sessions are not carried over.

Kept bit for bit: the `users` row (id, phone, argon2id hash, origin, status, version, timestamps), the SYSTEM membership,
the ACTIVE TOTP factor (id, version, key id, ciphertext, iv, tag, `last_accepted_step` = anti-replay, timestamps), and the
limiter check row. So the **password and the Google Authenticator keep working, nothing is reset or re-enrolled, there is no second SYSTEM.**
The factor is sealed with the keyring (`CRYPTO_KEYRING`/`CRYPTO_ACTIVE_KEY_ID`); the tool never changes the keyring, and
**proves** before and after that the stored factor decrypts with the keyring you give it.

How: in ONE transaction it takes the migration advisory lock, locks the tables, re-reads the identity (must equal the encrypted
snapshot), drops the tables and the function of schema `app` (one `DROP TABLE … RESTRICT` statement, **no CASCADE**: PostgreSQL refuses any dependency from outside, so nothing outside schema `app` is ever dropped), empties the history table, **really executes every
migration file in order** (recording each), puts the SYSTEM rows back, restores the table grants that existed, verifies, writes
one audit row (`ops.staging_db_rebuild.v1`) and commits. The history is never edited to hide a difference. Any error rolls the
transaction back **when the failure is before COMMIT**. A failure *during* COMMIT (connection lost, acknowledgement lost) leaves the outcome **unknown**: the tool says so (`COMMIT_OUTCOME_UNKNOWN`, exit code 2), sends nothing more, and the read-only `--verify` tells what happened (section 5).

It does **not**: touch roles, passwords of database roles, the keyring, Render, Supabase settings, or any other schema; carry
fixture accounts (re-seed them afterwards with `npm run staging:seed-fixtures`, runbook §8); grant the runtime role access to
the tables that did not exist before (do that from §3).

## 0. Preconditions (all of them)

1. The database is **disposable staging** and the Owner agreed that everything except the SYSTEM account may be lost.
2. The commit is the reviewed one; `npm ci && npm run build` succeeded here (the tool needs the compiled application).
3. **The Render service is suspended** (no request, no deploy, no job while the tool runs). The tool cannot see Render: it needs
   the typed phrase `STAGING_UPGRADE_CONFIRM` to say so.
4. A provider backup exists (Supabase backup / point-in-time) **and** you know how to restore it. The tool's own snapshot is a
   second line (only the SYSTEM rows), not a database backup.
5. The same environment as `db:migrate:remote` (runbook §4): `APP_ENV=staging`, `MIGRATION_DATABASE_URL`, `DATABASE_URL`
   (different roles, same project), `DB_SSL_CA`/`DB_SSL_CA_FILE`, `MIGRATION_CONFIRM_TARGET`. Plus
   `CRYPTO_KEYRING` and `CRYPTO_ACTIVE_KEY_ID`: **the values the service uses today** (copy from the Render environment; never from Git).
6. For `--apply` (and `--restore-snapshot`): `STAGING_UPGRADE_SNAPSHOT_KEY` = `openssl rand -base64 32` (store it in the
   password manager, **not next to the snapshot file**); `STAGING_UPGRADE_SNAPSHOT_FILE` = an absolute path **outside the repository**,
   in an existing private folder, to a file that does **not** exist yet.

Set these in the shell only (not in a file under the repository, not in shell history shared with others).

## 1. Read-only check (as the migrator role; record only counts and yes/no in the evidence)

```sql
SELECT count(*) AS migrations, bool_or(name = '1791849600000_add-users-account-origin') AS has_d2_name FROM app.pgmigrations;
SELECT count(*) FILTER (WHERE account_origin = 'ADMIN_PROVISIONED') AS provisioned, count(*) AS users FROM app.users;
SELECT (SELECT count(*) FROM app.admin_memberships WHERE admin_role = 'SYSTEM' AND status = 'ACTIVE') AS system_memberships,
       (SELECT count(*) FROM app.admin_totp_factors WHERE state = 'ACTIVE') AS active_factors;
```

Expected: 10 migrations, `has_d2_name` true, `provisioned` 1, `system_memberships` 1, `active_factors` 1. The tool repeats and extends
these checks (exact history list, exact table/function inventory, constraint shape, data linked to the SYSTEM user, keyring decryption).

## 2. Dry-run (the default; changes nothing)

```
npm run staging:db-upgrade-from-42
```

Expect exit 0 and: `the database is on the PR #42 history (10 migrations) and ready for the rebuild`, `SYSTEM identity verified`, and the
count of tables/rows that would be dropped. Any `STOP` line is a stop condition (section 6): **do not continue, report the codes.**
It prints only counts and fixed codes.

## 3. Apply

```
npm run staging:db-upgrade-from-42 -- --apply
```
with `STAGING_UPGRADE_CONFIRM=rebuild-keep-system-service-suspended` set. Order inside the command: gates → inspection →
encrypted snapshot written (mode 0600, created exclusively, read back) → the transaction. Expect `committed. 15 migrations applied`. Exit code 2 and `COMMIT_OUTCOME_UNKNOWN` instead means the outcome is not known: go to section 5, do not run any write again.
If the output says `N table(s) have no runtime grant yet`, those are the tables of newer migrations: apply the §3 grant rows
for them (runtime role) **before** starting the service.

## 4. After it

1. `npm run db:migrate:remote` must report nothing pending (history equals the files).
2. Re-run the section 1 queries: now 15 migrations, `has_d2_name` false, one SYSTEM, one active factor; `app.admin_sessions` and `app.sessions` empty.
3. Apply missing runtime grants (§3), start the service (§5), and let the Owner log in with the **old** phone/password and the **old** Authenticator.
   Re-seed fixtures if the Owner wants them (§8). Staging activation remains un-accepted (no OTP adapter).
4. Keep the snapshot file and the key (in separate places) until the Owner accepts the staging login, then delete both. After a `COMMIT_OUTCOME_UNKNOWN` never delete them before `--verify` has said `UPGRADED_OK`.

## 5. If something goes wrong

### 5.1 `COMMIT_OUTCOME_UNKNOWN` (exit code 2) — the outcome is NOT known

The connection failed while `COMMIT` was in flight. PostgreSQL may have committed (and the acknowledgement was lost) or not. The tool does not
claim either, does not retry, and sends nothing after the `COMMIT`. **Do not run `--apply` or `--restore-snapshot` again. Do not delete
the snapshot file or its key — they are the evidence and the recovery.** Run the read-only check with the same environment (snapshot file and key included):

```
npm run staging:db-upgrade-from-42 -- --verify
```

It compares the database with the snapshot (a complete history alone proves nothing about the identity) in one read-only transaction:

| Result | Meaning | Next step |
|---|---|---|
| `PRE_UNCHANGED` | PR #42 history, SYSTEM identical to the snapshot: the run did not commit. | Keep the old snapshot. Run `--apply` again with a **new** `STAGING_UPGRADE_SNAPSHOT_FILE` (and the same key or a new one, stored). |
| `UPGRADED_OK` | History of this checkout, exactly one SYSTEM identical to the snapshot, factor decrypts with the keyring. The run did commit. | Do not apply again. Continue with section 4. |
| `MIGRATED_WITHOUT_SYSTEM` | Complete history and no administrator (an unknown outcome of `--restore-snapshot`, or the SYSTEM was lost). | Run `--restore-snapshot` with this snapshot and key. |
| `ABNORMAL` (exit 1, with codes) | Anything else: another history, another identity, extra users. | **Stop.** No write command. Restore the provider backup and report to ChatGPT/Owner. |

### 5.2 Other failures

| Situation | What it means | What to do |
|---|---|---|
| `rebuild failed … never reached COMMIT` (migration error, lock busy, timeout, `EXTERNAL_DEPENDENCY`, connection lost before COMMIT) | The transaction did not commit; PostgreSQL discards an unfinished transaction. | Run the dry-run (or `--verify`): it must say `ready for the rebuild` / `PRE_UNCHANGED`. Fix the cause, retry with a **new** `STAGING_UPGRADE_SNAPSHOT_FILE`. The old snapshot file may be deleted securely only after the dry-run/`--verify` confirmed the database is still on the PR #42 history with the SYSTEM intact (and never after a `COMMIT_OUTCOME_UNKNOWN` until `--verify` says `UPGRADED_OK` and the Owner accepted the login). |
| `snapshot` stage fails | Nothing was changed. | Fix the path/key and run again. |
| Database found migrated but **without** the SYSTEM | Something deleted the identity after the commit. | `--restore-snapshot` with the snapshot file and key of the successful run. It refuses a non-empty target (`TARGET_NOT_EMPTY`), a different history, and a different limiter row. |
| Anything unexplained, or the SYSTEM cannot log in after the upgrade | — | Stop. Do not edit rows by hand. Restore the provider backup, report to ChatGPT/Owner. |

## 6. Stop conditions (nothing is changed, no snapshot is written)

| Code | Meaning |
|---|---|
| `HISTORY_NOT_42`, `HISTORY_UNKNOWN` | The history is not exactly the 10 migrations (e.g. main history, partial history, an extra name). A database on main's history is for `db:migrate:remote`, not this tool. |
| `CHECKOUT_MISMATCH` | This checkout lacks migrations the database needs: use the reviewed commit. |
| `UNEXPECTED_OBJECTS`, `MISSING_OBJECTS`, `ORIGIN_SHAPE` | Schema `app` is not the PR #42 shape (extra/missing table, function, view, type; constraints). |
| `SYSTEM_USER`, `SYSTEM_MEMBERSHIP`, `SYSTEM_FACTOR`, `LIMIT_CONFIG` | Not exactly one ACTIVE ADMIN_PROVISIONED user + one SYSTEM membership + one ACTIVE factor of that user. |
| `SYSTEM_LINKED` | The SYSTEM user also owns roles/shop/driver data that the rebuild would drop. |
| `KEYRING_KEY_MISSING`, `KEYRING_CANNOT_DECRYPT` | The keyring you gave cannot open the stored factor. Use the service's keyring; never re-enrol. |
| `EXTERNAL_DEPENDENCY` | A view, rule or foreign key in **another schema** depends on a table of `app` (or the database refused the drop with `RESTRICT`). The tool never drops objects outside `app`: remove or move that dependency deliberately (Owner decision), then run again. |
| `SERVER_VERSION`, `SCHEMA_MISSING` | PostgreSQL older than 17, or no schema `app`. |

## 7. Never in Git, logs, PR, chat or evidence

The password hash, TOTP secret/ciphertext/iv/tag, the keyring, `STAGING_UPGRADE_SNAPSHOT_KEY`, the snapshot file and its path,
database URLs/passwords, the phone number, the user id. The tool prints none of them; do not add them when you copy output.
