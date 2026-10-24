-- Up Migration
-- M02 shop management (Web Admin): the right "Quản lý hoạt động quán" (disable / enable a shop), separate from can_lock (which locks accounts).
-- Same shape as can_manage_catalog: one more boolean on the two permission tables, only for the SHOP app and only together with VIEW.
-- DEFAULT false: every existing administrator and every existing invitation stays without the right (nothing is copied from can_lock).
-- No grant change: both tables already have SELECT/INSERT for the runtime role, and a new column is covered by the table grant.
ALTER TABLE app.admin_app_permissions ADD COLUMN can_manage_shops boolean NOT NULL DEFAULT false;
ALTER TABLE app.admin_app_permissions ADD CONSTRAINT admin_app_permissions_shops_view_ck CHECK (NOT can_manage_shops OR can_view);
ALTER TABLE app.admin_app_permissions ADD CONSTRAINT admin_app_permissions_shops_app_ck CHECK (NOT can_manage_shops OR app = 'SHOP');

ALTER TABLE app.admin_invitation_permissions ADD COLUMN can_manage_shops boolean NOT NULL DEFAULT false;
ALTER TABLE app.admin_invitation_permissions ADD CONSTRAINT admin_invitation_permissions_shops_view_ck CHECK (NOT can_manage_shops OR can_view);
ALTER TABLE app.admin_invitation_permissions ADD CONSTRAINT admin_invitation_permissions_shops_app_ck CHECK (NOT can_manage_shops OR app = 'SHOP');

-- Down Migration
ALTER TABLE app.admin_invitation_permissions DROP CONSTRAINT admin_invitation_permissions_shops_app_ck;
ALTER TABLE app.admin_invitation_permissions DROP CONSTRAINT admin_invitation_permissions_shops_view_ck;
ALTER TABLE app.admin_invitation_permissions DROP COLUMN can_manage_shops;
ALTER TABLE app.admin_app_permissions DROP CONSTRAINT admin_app_permissions_shops_app_ck;
ALTER TABLE app.admin_app_permissions DROP CONSTRAINT admin_app_permissions_shops_view_ck;
ALTER TABLE app.admin_app_permissions DROP COLUMN can_manage_shops;
