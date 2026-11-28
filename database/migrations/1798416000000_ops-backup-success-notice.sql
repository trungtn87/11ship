-- Up Migration
-- M12-F: a successful off-VPS backup run is announced once on Discord as an INFO notice (kind BACKUP_OK). The CHECK lists the notice kinds; this only widens it.
-- Adds no column, grant or data: the old backend never writes BACKUP_OK and keeps working.
ALTER TABLE app.ops_notifications DROP CONSTRAINT ops_notifications_kind_ck;
ALTER TABLE app.ops_notifications ADD CONSTRAINT ops_notifications_kind_ck
  CHECK (kind IN ('OPEN', 'REMINDER', 'ESCALATION', 'RECOVERY', 'SNOOZE_END', 'TEST', 'DEPLOY', 'MAINTENANCE', 'BACKUP_OK'));

-- Down Migration
-- Only for disposable or experimental databases. Refused, data untouched, when any success notice exists: the history of sent messages is never dropped.
LOCK TABLE app.ops_notifications IN ACCESS EXCLUSIVE MODE;
DO $latch$
BEGIN
  IF EXISTS (SELECT 1 FROM app.ops_notifications WHERE kind = 'BACKUP_OK') THEN
    RAISE EXCEPTION 'Down refused: backup success notices exist; the history is kept';
  END IF;
END
$latch$;
ALTER TABLE app.ops_notifications DROP CONSTRAINT ops_notifications_kind_ck;
ALTER TABLE app.ops_notifications ADD CONSTRAINT ops_notifications_kind_ck
  CHECK (kind IN ('OPEN', 'REMINDER', 'ESCALATION', 'RECOVERY', 'SNOOZE_END', 'TEST', 'DEPLOY', 'MAINTENANCE'));
