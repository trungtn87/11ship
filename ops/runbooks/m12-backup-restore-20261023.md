# M12-F — Backup, verification and restore runbook (2026-10-23)

Update 24/10: automatic backup to Google Drive (rclone, encrypted before upload) is described in [m12-drive-backup-20261024.md](m12-drive-backup-20261024.md); that page lists the schedule, retention, alerts and the step-by-step restore from Drive. Everything below still holds.

Status: scripts and the Web Admin pages exist and a **local rehearsal on a test server was run** ([evidence](../../docs/evidence/m12/restore-rehearsal-20261023.txt)). **Nothing here has run on the VPS.** No scheduled backup exists on the VPS, no off-VPS store is configured and **no restore of production was performed or is authorised by this document**. The Web Admin says so itself: it shows "no verified backup" until the job below has recorded one.

## What is fixed (Owner, spec section 6)

Daily backup; keep 7 daily and 4 weekly; one more before a migration or a big change; a copy **outside the VPS**, encrypted, access-limited; a backup counts as successful **only after it was restored into a scratch database and checked**. Restore is SYSTEM only, through this controlled procedure.

## Missing inputs (needed from the Owner before the VPS can claim backups)

Decided 24/10: **Google Drive through rclone, encrypted before upload.** What is still needed from the Owner is listed in [m12-drive-backup-20261024.md](m12-drive-backup-20261024.md) section 3 (OAuth client, passphrase kept off the VPS, connecting Drive on the VPS, approval to install and enable the timers). Until then every run records `DRIVE_NOT_CONFIGURED` and the page reports "no copy outside the VPS".

## Backup run — `ops/backup/backup.sh`

`pg_dump -Fc` (+ extra files if configured) + manifest → one tar → `openssl enc -aes-256-cbc -pbkdf2` → **restore of the encrypted file into `ship11_verify_*`** and the checks in `verify.sql` (schema version equals the source, `audit_logs` and `wallet_ledger_entries` counts lie between the counts before and after the dump, **sum of the ledger = sum of the wallet balances**) → upload to Google Drive and check size + MD5 there → retention → `app.backup_records` → report to M13. Any failed step records `FAILED` with a code and keeps the stage it stopped at; the encrypted local copy of a good backup is kept for the retry. The database refuses `SUCCEEDED` without size, checksum, schema version, encryption and `verified_at`, and refuses `offsite` without the verified upload (`backup_records_success_ck`, `backup_records_offsite_ck`). Run it with the **database owner role**; the application role can only read `backup_records` and queue `backup_jobs` (`ops/selfhosted/02-runtime-grants.sql`).

## Restore — controlled, SYSTEM request first

1. SYSTEM opens **Hệ thống › Sao lưu và phục hồi**, chooses a backup marked "Dùng để khôi phục được" and sends a request **with a reason**. Only one request can be open (database unique index). The page records the request and the audit entry `admin.restore.request.v1`. **It does not restore anything.**
2. The operator (two people if possible) takes the request id and does, on the VPS, in this order:
   1. Announce a maintenance window; stop the backend and the front (`systemctl stop ship11-backend …`) so **no writes happen** (this is the "lock writes").
   2. `BACKUP_KIND=PRE_RESTORE ops/backup/backup.sh` — a backup of the current state before touching it. Do not continue if it fails.
   3. Rehearse the chosen file first: `ops/backup/restore-rehearsal.sh <file> <passphrase-file> <admin-url> ship11_restore_<name>` and read the printed figures.
   4. Restore into a **new** database (`createdb`, `pg_restore --no-owner --no-privileges`), check `verify.sql`, then switch the application to it (rename the old database aside, never drop it). `ship11_staging` is never overwritten in place and never renamed away without the Owner's decision on the day.
   5. Run `npm run db:migrate` to bring a restored older schema up to date (migrations are idempotent).
   6. **Reconcile before opening again** — everything after the backup's time is missing, so check against the outside world: wallets vs ledger (`ledger_wallet_difference_vnd` must be 0); top-up requests and bank transfers received after the backup time (re-enter from the bank statement through the normal top-up flow); withdrawals that were `PROCESSING` or `UNKNOWN_OUTCOME` (the bank decides, not the restored row); active holds; orders and deliveries that changed after the backup; transactions of the payment channel.
   7. **Do not replay** payments, bank calls, push notifications or SMS from before the backup time: they are expired or already delivered. Notifications older than their lifetime stay unsent.
   8. Start the backend, check `/health`, log in, read the overview and the money report, then open to users.
   9. Record the outcome: `UPDATE app.restore_requests SET state = 'COMPLETED' (or 'ABORTED'), operator_note = '…', version = version + 1, updated_at = now() WHERE request_id = '…'` with the owner role.
3. SYSTEM may cancel a request that is still `REQUESTED` (button on the page; audited). After `IN_PROGRESS` only the operator closes it.

## What the rehearsal proved (and did not)

Proved locally: dump, encryption, restore of the encrypted file into a new scratch database, the checks above, the name guards (a production, staging or test name, or an existing database, is refused and nothing is overwritten), a wrong passphrase fails, and a source whose wallet no longer matches its ledger is recorded `FAILED` and leaves no usable file. **Not proved:** the real VPS database, real data volume and duration, the off-VPS copy, the scheduler, the passphrase custody, and a restore of live data. The sample data had no real drivers behind its wallets (foreign keys dropped in the throwaway copy), so referential integrity of live data is not part of that evidence.
