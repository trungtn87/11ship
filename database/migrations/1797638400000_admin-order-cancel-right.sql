-- Up Migration
-- OD-12: the right to cancel a running order from the administration web (admin.order.cancel) becomes its own right, "Hủy đơn đang chạy". Until now the
-- action was gated by the DRIVER app's can_lock (the right that locks accounts). Same shape as can_manage_shops: one more boolean on the two permission
-- tables, only for the DRIVER app and only together with VIEW.
-- DEFAULT false: every existing administrator and every existing invitation stays WITHOUT the right (nothing is copied from can_lock), so an Admin who
-- cancelled orders through can_lock on DRIVER can no longer do it until SYSTEM grants the new right. SYSTEM is unaffected. Closing an order
-- as not completed keeps its own gate (the DRIVER review right).
-- No grant change: both tables already have SELECT/INSERT for the runtime role, and a new column is covered by the table grant.
ALTER TABLE app.admin_app_permissions ADD COLUMN can_cancel_orders boolean NOT NULL DEFAULT false;
ALTER TABLE app.admin_app_permissions ADD CONSTRAINT admin_app_permissions_cancel_orders_view_ck CHECK (NOT can_cancel_orders OR can_view);
ALTER TABLE app.admin_app_permissions ADD CONSTRAINT admin_app_permissions_cancel_orders_app_ck CHECK (NOT can_cancel_orders OR app = 'DRIVER');

ALTER TABLE app.admin_invitation_permissions ADD COLUMN can_cancel_orders boolean NOT NULL DEFAULT false;
ALTER TABLE app.admin_invitation_permissions ADD CONSTRAINT admin_invitation_permissions_cancel_orders_view_ck CHECK (NOT can_cancel_orders OR can_view);
ALTER TABLE app.admin_invitation_permissions ADD CONSTRAINT admin_invitation_permissions_cancel_orders_app_ck CHECK (NOT can_cancel_orders OR app = 'DRIVER');

-- Down Migration
ALTER TABLE app.admin_invitation_permissions DROP CONSTRAINT admin_invitation_permissions_cancel_orders_app_ck;
ALTER TABLE app.admin_invitation_permissions DROP CONSTRAINT admin_invitation_permissions_cancel_orders_view_ck;
ALTER TABLE app.admin_invitation_permissions DROP COLUMN can_cancel_orders;
ALTER TABLE app.admin_app_permissions DROP CONSTRAINT admin_app_permissions_cancel_orders_app_ck;
ALTER TABLE app.admin_app_permissions DROP CONSTRAINT admin_app_permissions_cancel_orders_view_ck;
ALTER TABLE app.admin_app_permissions DROP COLUMN can_cancel_orders;
