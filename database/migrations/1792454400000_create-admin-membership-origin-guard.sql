-- Up Migration
-- M01-D-ADMIN-1C migration C: admin membership requires an ADMIN_PROVISIONED account.
-- DDL reviewed in docs/tasks/M01-D-ADMIN-1C-technical-contract.md section 5; verified by docs/verification/m01-d-admin-1c-ddl.
-- An administration membership may only belong to an operator/administration-provisioned account, never to an
-- account that registered through the apps (account_origin = 'PHONE_VERIFIED').
CREATE FUNCTION app.admin_membership_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM app.users WHERE user_id = NEW.user_id AND account_origin = 'ADMIN_PROVISIONED') THEN
  RAISE EXCEPTION 'admin membership requires an admin-provisioned account' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_membership_origin_guard BEFORE INSERT ON app.admin_memberships
 FOR EACH ROW EXECUTE FUNCTION app.admin_membership_origin_guard();

-- Down Migration
DROP TRIGGER admin_membership_origin_guard ON app.admin_memberships;
DROP FUNCTION app.admin_membership_origin_guard();
