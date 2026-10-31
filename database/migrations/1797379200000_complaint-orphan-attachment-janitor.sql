-- Up Migration
-- Issue #261 (Owner 2026-10-31): a picture uploaded for a complaint and never attached (complaint_id IS NULL) is removed 24 hours after it was uploaded.
-- app.complaint_attachments was "never deleted" by a statement trigger. It is replaced by (a) a TRUNCATE guard that keeps the old refusal and (b) a row guard that lets a
-- DELETE through ONLY for a row that is still unlinked AND older than 24 hours on the database clock. A linked picture (evidence of a complaint, a supplement, a
-- reconsideration) can never be deleted, and neither can a fresh upload: the janitor cannot remove what a user is still about to attach.

DROP TRIGGER complaint_attachments_no_delete ON app.complaint_attachments;
CREATE TRIGGER complaint_attachments_no_truncate BEFORE TRUNCATE ON app.complaint_attachments FOR EACH STATEMENT EXECUTE FUNCTION app.complaint_attachments_guard();

CREATE FUNCTION app.complaint_attachments_delete_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.complaint_id IS NOT NULL OR OLD.created_at > clock_timestamp() - interval '24 hours' THEN
    RAISE EXCEPTION 'app.complaint_attachments: only an unlinked picture older than 24 hours may be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER complaint_attachments_delete_guard BEFORE DELETE ON app.complaint_attachments FOR EACH ROW EXECUTE FUNCTION app.complaint_attachments_delete_guard();

-- Down Migration
DROP TRIGGER complaint_attachments_delete_guard ON app.complaint_attachments;
DROP FUNCTION app.complaint_attachments_delete_guard();
DROP TRIGGER complaint_attachments_no_truncate ON app.complaint_attachments;
CREATE TRIGGER complaint_attachments_no_delete BEFORE DELETE OR TRUNCATE ON app.complaint_attachments FOR EACH STATEMENT EXECUTE FUNCTION app.complaint_attachments_guard();
