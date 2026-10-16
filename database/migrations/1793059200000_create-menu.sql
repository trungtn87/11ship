-- Up Migration
-- M02-MON: the system dish groups, the dishes of a shop and the dish images. Contract: docs/tasks/M02-menu-contract-20261014.md.
-- Three new tables; nothing existing is altered. No seed data (the groups are provisioned by the operator command
-- scripts/menu-categories-ctl.js, never invented by a migration), no trigger, no function, no CASCADE and no IF [NOT] EXISTS:
-- an existing table must make the migration fail instead of hiding schema drift.
--
-- A dish is never physically deleted by the application: DELETED is a soft state (the row, its price and its group stay for
-- history; no public or owner list returns it). Images are immutable rows: a dish points at an image, replacing a picture
-- means a new image row and a new reference. The image id is an unguessable random UUID and is the only capability needed to
-- read the picture (it is a dish photo, not personal data); the bytes live in this table so that no new storage service or
-- directory has to be deployed.

-- ---------------------------------------------------------------------------------------------------
-- app.fold_vi: the text a search compares: lower case, Vietnamese marks removed (precomposed letters and combining marks), đ -> d,
-- white space collapsed and trimmed. The application folds the typed search the same way (apps/backend/src/shared/fold-vietnamese.ts),
-- so "oc huong" finds "Ốc hương". Pure SQL: no extension is needed.
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION app.fold_vi(input text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(
      translate(lower(input),
        'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
        'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
      '[\u0300-\u036f]', '', 'g'),
    '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------------------------------
-- app.menu_categories: the system groups. Not writable by shop owners (the SYSTEM administrator manages them). ACTIVE groups can
-- be chosen for a NEW or changed dish and appear in discovery; INACTIVE ones only keep the link of dishes that already have it.
-- A group is never deleted physically.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.menu_categories (
  category_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT menu_categories_pkey PRIMARY KEY (category_id),
  CONSTRAINT menu_categories_name_ck CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT menu_categories_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT menu_categories_version_ck CHECK (version >= 1),
  CONSTRAINT menu_categories_time_order_ck CHECK (updated_at >= created_at)
);

-- A group name is unique ignoring case, marks and spacing, so two groups never look the same to a person.
CREATE UNIQUE INDEX menu_categories_name_uq ON app.menu_categories (app.fold_vi(name));

-- ---------------------------------------------------------------------------------------------------
-- app.menu_images: immutable picture bytes owned by a shop.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.menu_images (
  image_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT menu_images_pkey PRIMARY KEY (image_id),
  CONSTRAINT menu_images_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id),
  CONSTRAINT menu_images_type_ck CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT menu_images_size_ck CHECK (byte_size BETWEEN 1 AND 2097152 AND byte_size = octet_length(data))
);
CREATE INDEX menu_images_shop_idx ON app.menu_images (shop_id);

-- ---------------------------------------------------------------------------------------------------
-- app.menu_items: the dishes. status VISIBLE (public), HIDDEN (owner only) or DELETED (soft, nobody lists it).
-- version is the dish's own optimistic-lock counter (the shop's profile/schedule version is a different one).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.menu_items (
  item_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  category_id uuid NOT NULL,
  name text NOT NULL,
  price_vnd integer NOT NULL,
  image_id uuid,
  status text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,

  CONSTRAINT menu_items_pkey PRIMARY KEY (item_id),
  CONSTRAINT menu_items_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id),
  CONSTRAINT menu_items_category_fk FOREIGN KEY (category_id) REFERENCES app.menu_categories (category_id),
  CONSTRAINT menu_items_image_fk FOREIGN KEY (image_id) REFERENCES app.menu_images (image_id),
  CONSTRAINT menu_items_name_ck CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT menu_items_price_ck CHECK (price_vnd BETWEEN 1 AND 99999999),
  CONSTRAINT menu_items_status_ck CHECK (status IN ('VISIBLE', 'HIDDEN', 'DELETED')),
  CONSTRAINT menu_items_version_ck CHECK (version >= 1),
  CONSTRAINT menu_items_time_order_ck CHECK (updated_at >= created_at),
  CONSTRAINT menu_items_deleted_ck CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL))
);
CREATE INDEX menu_items_shop_idx ON app.menu_items (shop_id, status);
CREATE INDEX menu_items_category_idx ON app.menu_items (category_id);
CREATE INDEX menu_items_image_idx ON app.menu_items (image_id) WHERE image_id IS NOT NULL;

-- Down Migration
-- Only for disposable test or experimental databases. Drops exactly the three tables above, children first.
DROP TABLE app.menu_items;
DROP TABLE app.menu_images;
DROP TABLE app.menu_categories;
DROP FUNCTION app.fold_vi(text);
