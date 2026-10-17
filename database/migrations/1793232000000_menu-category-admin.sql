-- Up Migration
-- M02 dish-group management on the Administration web. Adds only what the management screen needs on top of 1793145600000_create-menu:
--  1. the catalog right of an ADMIN (a flag on the existing per-app permission rows: SHOP only, always together with VIEW);
--  2. the duplicate rule of a group name: ignoring case, white space and Unicode composition, but NOT Vietnamese marks;
--  3. a non-negative order.
-- No table, no seed data, no data change. Groups created earlier by SQL keep their ids, names, order and status.

-- ---------------------------------------------------------------------------------------------------
-- 1. Catalog right. Existing administrators and pending invitations get false: nobody gains a right by this migration.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE app.admin_app_permissions ADD COLUMN can_manage_catalog boolean NOT NULL DEFAULT false;
ALTER TABLE app.admin_app_permissions ADD CONSTRAINT admin_app_permissions_catalog_view_ck CHECK (NOT can_manage_catalog OR can_view);
ALTER TABLE app.admin_app_permissions ADD CONSTRAINT admin_app_permissions_catalog_app_ck CHECK (NOT can_manage_catalog OR app = 'SHOP');

ALTER TABLE app.admin_invitation_permissions ADD COLUMN can_manage_catalog boolean NOT NULL DEFAULT false;
ALTER TABLE app.admin_invitation_permissions ADD CONSTRAINT admin_invitation_permissions_catalog_view_ck CHECK (NOT can_manage_catalog OR can_view);
ALTER TABLE app.admin_invitation_permissions ADD CONSTRAINT admin_invitation_permissions_catalog_app_ck CHECK (NOT can_manage_catalog OR app = 'SHOP');

-- ---------------------------------------------------------------------------------------------------
-- 2. Group name key. Two names are the same group when their keys are equal: white space collapsed and trimmed, canonical
-- (NFC) composition, lower case. Vietnamese marks are NOT removed ("Ốc" and "Oc" are different groups). The previous unique index
-- (fold_vi, which removes marks) is STRICTER than this one, so every existing row already satisfies the new index: nothing can
-- fail here and no row is merged or deleted. fold_vi stays: it is still the search comparison.
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.menu_category_key(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(normalize(btrim(regexp_replace(input, '\s+', ' ', 'g')), NFC))
$$;

DROP INDEX app.menu_categories_name_uq;
CREATE UNIQUE INDEX menu_categories_name_uq ON app.menu_categories (app.menu_category_key(name));

-- ---------------------------------------------------------------------------------------------------
-- 3. Order is a non-negative integer. NOT VALID: new and changed rows must satisfy it, rows written by SQL before are not
-- rescanned (a negative order set by hand is reported by the management screen when someone edits that group).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE app.menu_categories ADD CONSTRAINT menu_categories_sort_order_ck CHECK (sort_order >= 0 AND sort_order <= 100000) NOT VALID;

-- Down Migration
ALTER TABLE app.menu_categories DROP CONSTRAINT menu_categories_sort_order_ck;
DROP INDEX app.menu_categories_name_uq;
CREATE UNIQUE INDEX menu_categories_name_uq ON app.menu_categories (app.fold_vi(name));
DROP FUNCTION app.menu_category_key(text);
ALTER TABLE app.admin_invitation_permissions DROP CONSTRAINT admin_invitation_permissions_catalog_app_ck;
ALTER TABLE app.admin_invitation_permissions DROP CONSTRAINT admin_invitation_permissions_catalog_view_ck;
ALTER TABLE app.admin_invitation_permissions DROP COLUMN can_manage_catalog;
ALTER TABLE app.admin_app_permissions DROP CONSTRAINT admin_app_permissions_catalog_app_ck;
ALTER TABLE app.admin_app_permissions DROP CONSTRAINT admin_app_permissions_catalog_view_ck;
ALTER TABLE app.admin_app_permissions DROP COLUMN can_manage_catalog;
