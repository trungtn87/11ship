-- Up Migration
-- Issue #412: one optional icon picture per dish group (Administration web uploads it; 11Food home shows it). Stored in the row itself
-- as jsonb, the same way as the shop logo (1795046400000_add-shop-logo.sql): no file system, no new storage service, saved in the same
-- transaction as the group's version. Adds one nullable column and one CHECK; nothing existing is changed and no data is written.
-- Limits mirror apps/backend/src/menu/menu-category-image.ts: PNG or WebP, at most 1 MiB, base64 at most 1398104 characters.
ALTER TABLE app.menu_categories ADD COLUMN image jsonb;
ALTER TABLE app.menu_categories ADD CONSTRAINT menu_categories_image_shape_ck CHECK (
  image IS NULL OR (jsonb_typeof(image) = 'object'
    AND image ? 'content_type' AND image ? 'data_base64'
    AND image->>'content_type' IN ('image/png', 'image/webp')
    AND jsonb_typeof(image->'data_base64') = 'string'
    AND length(image->>'data_base64') BETWEEN 1 AND 1398104)
);

-- Down Migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app.menu_categories WHERE image IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot remove dish group icons while stored icons exist';
  END IF;
END $$;
ALTER TABLE app.menu_categories DROP CONSTRAINT menu_categories_image_shape_ck;
ALTER TABLE app.menu_categories DROP COLUMN image;
