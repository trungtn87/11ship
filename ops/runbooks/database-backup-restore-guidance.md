# Database backup and restore — guidance for the future

Status: **guidance only. A restore has NOT been tested**, and M00-B1 makes no claim that any
production backup or restore works. Do not treat this page as evidence of recoverability.

## Principles to apply when a real environment exists

1. Back up with `pg_dump` (custom format, `-Fc`) or physical backups with WAL archiving, using an
   account that has only the privileges the backup needs.
2. Store backups outside the database host, encrypted, with their own retention and access control.
3. A backup counts only after a restore into an empty scratch database has been run and its
   result checked (schema present, row counts, application readiness). Record the date, the
   backup identifier, the restore command and the outcome as evidence.
4. Restore into a new database first. Never restore over DEV, test or production data as a first
   attempt, and never point the restore at a target without verifying `current_database()`.
5. Migrations already applied are never edited in place. After a restore, run `npm run db:migrate`
   to bring the schema to the latest version; the tool's history table keeps this safe to repeat.

## Not done in M00-B1

- No backup schedule, no storage location, no restore drill, no point-in-time recovery.
- No reset command that deletes data. Tests clean up only the random schema they created.
