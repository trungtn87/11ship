-- Up Migration
-- Nhóm 15 (issue #255): a SUSPENDED Shipper may ask to close the account and get the balance back WITHOUT being unlocked. The suspension reason and time must
-- therefore survive the SUSPENDED -> CLOSING (and later CLOSED) transition, and come back untouched when the closure is cancelled or rejected.
-- The earlier check only allowed them while status = 'SUSPENDED'. It is replaced (the applied migration stays as it is) by one that also allows them
-- while the closure was requested FROM a suspension (status_before_closing = 'SUSPENDED'). No data changes.

ALTER TABLE app.drivers DROP CONSTRAINT drivers_suspension_reason_ck;
ALTER TABLE app.drivers
  ADD CONSTRAINT drivers_suspension_reason_ck CHECK (
    status = 'SUSPENDED'
    OR (suspension_reason IS NULL AND suspended_at IS NULL)
    OR (status IN ('CLOSING', 'CLOSED') AND status_before_closing = 'SUSPENDED')
  );

-- Down Migration
-- Only valid while no row carries a suspension through a closure; clear those first so the stricter check can be restored.
UPDATE app.drivers SET suspension_reason = NULL, suspended_at = NULL WHERE status <> 'SUSPENDED';
ALTER TABLE app.drivers DROP CONSTRAINT drivers_suspension_reason_ck;
ALTER TABLE app.drivers ADD CONSTRAINT drivers_suspension_reason_ck CHECK (status = 'SUSPENDED' OR (suspension_reason IS NULL AND suspended_at IS NULL));
