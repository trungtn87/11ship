-- Up Migration
-- M02-A: the weekly business-hours schedule of a shop (M02-owned). It follows docs/tasks/M02-A-shop-management.md
-- section 3. One table, no seed data, no trigger, no function. Applied migrations are never edited: this is a new
-- file after the Driver onboarding one, and it references only app.shops (created by the Shop onboarding migration).
--
-- No IF [NOT] EXISTS anywhere: if the table already exists the migration must fail (and be rolled back as a whole,
-- with no history row) instead of hiding schema drift. No CASCADE anywhere: deleting a shop never silently removes
-- its schedule.
--
-- The schedule is the ONLY input of availability. Whether the shop is open is never stored: it is computed from
-- these rows, the shop and service-area status and the PostgreSQL clock. app.shops.accepting_orders (A2S) is left
-- exactly as it is and is NOT read by anything that decides availability.
--
-- Meaning of a row (ISO weekday, Monday = 1, wall clock of Asia/Ho_Chi_Minh):
--   opens at start_minute of `weekday`, closes at end_minute of weekday + end_day_offset; the close is EXCLUSIVE.
--   18:00-02:00 is start=1080, end=120, offset=1. 00:00-24:00 is start=0, end=1440, offset=0.
-- Cross-row rules (no overlap on the 10080-minute week ring, at most 28 rows per shop) stay in the service layer,
-- which re-checks them under the shop lock: a CHECK cannot read another row.

-- ---------------------------------------------------------------------------------------------------
-- app.shop_business_hours
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.shop_business_hours (
  shop_id uuid NOT NULL,
  weekday smallint NOT NULL,
  start_minute smallint NOT NULL,
  end_minute smallint NOT NULL,
  end_day_offset smallint NOT NULL,

  CONSTRAINT shop_business_hours_pkey PRIMARY KEY (shop_id, weekday, start_minute),
  CONSTRAINT shop_business_hours_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id),
  CONSTRAINT shop_business_hours_weekday_ck CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT shop_business_hours_start_ck CHECK (start_minute BETWEEN 0 AND 1439),
  CONSTRAINT shop_business_hours_end_ck CHECK (end_minute BETWEEN 0 AND 1440),
  CONSTRAINT shop_business_hours_offset_ck CHECK (end_day_offset IN (0, 1)),
  -- Every interval is longer than 0 and at most 24 hours:
  --   same day (offset 0): the close is after the open, so it is at most 00:00-24:00;
  --   next day (offset 1): the close is at or before the open and before 24:00, so it is at most 24 hours
  --   (start = end means exactly 24 hours) and never reaches the day after the next.
  CONSTRAINT shop_business_hours_span_ck CHECK (
    (end_day_offset = 0 AND end_minute > start_minute)
    OR (end_day_offset = 1 AND end_minute <= start_minute AND end_minute < 1440)
  )
);

-- Down Migration
-- Only for disposable test or experimental databases. It drops exactly the table this migration created: the
-- accepting_orders column of app.shops (A2S, legacy) is not touched. No CASCADE and no IF EXISTS: it fails loudly
-- if anything is missing instead of hiding drift. It must run BEFORE the Shop onboarding down migration because
-- the table references app.shops; the primary key index goes with the table.
DROP TABLE app.shop_business_hours;
