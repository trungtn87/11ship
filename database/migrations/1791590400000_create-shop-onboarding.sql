-- Up Migration
-- M01-A2S: Shop onboarding schema (M02-owned service_areas, shops, shop_members). It follows
-- docs/tasks/M01-A2-onboarding.md section 6 and the M01-A2S handoff. M02 tables only: no Driver, Wallet,
-- Order or Delivery tables, no business-hours table, no geometry and no seed data.
--
-- No IF [NOT] EXISTS anywhere: if any of these objects already exists the migration must fail (and be
-- rolled back as a whole, with no history row) instead of hiding schema drift. Applied migrations are
-- never edited; this is a new file after the Auth Core migration, which it references (app.users).
--
-- No CASCADE anywhere: no delete of a user, a shop or a service area silently removes related rows.
--
-- Cross-row rules stay in the service layer and are re-checked under lock: whether the service area a shop
-- points at is ACTIVE (a CHECK cannot read another row), and that an ACTIVE shop has its OWNER membership.

-- ---------------------------------------------------------------------------------------------------
-- app.service_areas
-- ---------------------------------------------------------------------------------------------------
-- The areas a shop can be located in. A2S has no geometry or polygon and no management API: tests insert
-- their own fixtures, and production onboarding stays unavailable until a later operator/configuration
-- slice creates at least one ACTIVE area. Nothing is seeded here.
CREATE TABLE app.service_areas (
  service_area_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  status varchar(16) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT service_areas_pkey PRIMARY KEY (service_area_id),
  CONSTRAINT service_areas_code_uq UNIQUE (code),
  -- Trimmed and not blank: an identifier with surrounding whitespace is a typo, not a code.
  CONSTRAINT service_areas_code_ck CHECK (code = btrim(code) AND length(code) >= 1),
  CONSTRAINT service_areas_name_ck CHECK (name = btrim(name) AND length(name) >= 1),
  CONSTRAINT service_areas_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT service_areas_version_ck CHECK (version >= 1),
  CONSTRAINT service_areas_time_order_ck CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------------------------------
-- app.shops
-- ---------------------------------------------------------------------------------------------------
-- One row per shop. A shop starts INCOMPLETE (a resumable draft) and becomes ACTIVE only when onboarding
-- completes. accepting_orders is a separate operational switch and starts false: a completed shop is
-- OFFLINE until the later business-hours slice exists.
CREATE TABLE app.shops (
  shop_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  -- The contact number shown to riders and customers. It is NOT a login credential and is not required to
  -- equal the owner's login phone. Same normalized +84 shape the Auth contract produces.
  contact_phone_normalized varchar(16) NOT NULL,
  zalo varchar(160),
  facebook varchar(300),
  address_text varchar(500) NOT NULL,
  pickup_lat double precision,
  pickup_lng double precision,
  service_area_id uuid,
  status varchar(16) NOT NULL,
  accepting_orders boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT shops_pkey PRIMARY KEY (shop_id),
  CONSTRAINT shops_service_area_fk FOREIGN KEY (service_area_id) REFERENCES app.service_areas (service_area_id),
  CONSTRAINT shops_name_ck CHECK (length(btrim(name)) >= 1),
  CONSTRAINT shops_address_ck CHECK (length(btrim(address_text)) >= 1),
  CONSTRAINT shops_contact_phone_ck CHECK (contact_phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT shops_status_ck CHECK (status IN ('INCOMPLETE', 'ACTIVE', 'DISABLED')),
  CONSTRAINT shops_version_ck CHECK (version >= 1),
  CONSTRAINT shops_time_order_ck CHECK (updated_at >= created_at),
  -- Latitude and longitude are one point: both present or both absent.
  CONSTRAINT shops_pickup_gps_pair_ck CHECK ((pickup_lat IS NULL) = (pickup_lng IS NULL)),
  -- NULL passes a CHECK, so these only bound a present value. NaN and the infinities sort above every finite
  -- double in PostgreSQL, so BETWEEN rejects them too.
  CONSTRAINT shops_pickup_lat_ck CHECK (pickup_lat BETWEEN -90 AND 90),
  CONSTRAINT shops_pickup_lng_ck CHECK (pickup_lng BETWEEN -180 AND 180),
  -- An ACTIVE shop is a complete one: it has a pickup point and a service area.
  CONSTRAINT shops_active_complete_ck CHECK (
    status <> 'ACTIVE'
    OR (pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL AND service_area_id IS NOT NULL)
  ),
  -- A draft can never take orders.
  CONSTRAINT shops_incomplete_not_accepting_ck CHECK (status <> 'INCOMPLETE' OR accepting_orders = false)
);

-- ---------------------------------------------------------------------------------------------------
-- app.shop_members
-- ---------------------------------------------------------------------------------------------------
-- Who may act for a shop. A2S creates exactly one OWNER membership per shop, together with the shop. An
-- INCOMPLETE shop already has its OWNER membership, so only that authenticated user can resume the draft.
-- Membership does NOT grant the SHOP role: only completion does.
--
-- The OWNER invariants are PARTIAL unique indexes on member_role = 'OWNER', not plain unique constraints on
-- shop_id or user_id, so a later slice can add other member roles (staff, for instance) by widening the
-- member_role CHECK without touching these two rules.
CREATE TABLE app.shop_members (
  shop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  member_role varchar(16) NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT shop_members_pkey PRIMARY KEY (shop_id, user_id),
  CONSTRAINT shop_members_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id),
  CONSTRAINT shop_members_user_fk FOREIGN KEY (user_id) REFERENCES app.users (user_id),
  CONSTRAINT shop_members_role_ck CHECK (member_role IN ('OWNER'))
);

-- A shop has at most one OWNER.
CREATE UNIQUE INDEX shop_members_one_owner_per_shop_uq
  ON app.shop_members (shop_id)
  WHERE member_role = 'OWNER';

-- A user is the OWNER of at most one shop ("one account owns one shop").
CREATE UNIQUE INDEX shop_members_one_owner_shop_per_user_uq
  ON app.shop_members (user_id)
  WHERE member_role = 'OWNER';

-- Down Migration
-- Only for disposable test or experimental databases. Reverse dependency order (shop_members references shops
-- and users, shops references service_areas); indexes go with their table. No CASCADE and no IF EXISTS: it
-- fails loudly if anything is missing instead of hiding drift. It must run BEFORE the Auth Core down migration
-- because shop_members references app.users.
DROP TABLE app.shop_members;
DROP TABLE app.shops;
DROP TABLE app.service_areas;
