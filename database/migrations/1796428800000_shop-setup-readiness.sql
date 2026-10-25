-- Up Migration
-- Issue #190: shop setup checklist and automatic activation. Readiness itself is never stored: the server derives it from the real profile, schedule,
-- pickup point and menu rows on every read. These columns only remember (a) WHEN the system first activated a shop that had met every condition, so
-- the activation is audited exactly once, and (b) a pending "please complete the setup" request an administrator left for the owner.
-- Additive and nullable: the previous backend never sets or reads them, so it keeps working and ignores them. No grant change (table-level grants cover
-- new columns). No existing row is rewritten except the backfill of activated_at below.
ALTER TABLE app.shops ADD COLUMN activated_at timestamptz;
ALTER TABLE app.shops ADD COLUMN setup_request_note varchar(500);
ALTER TABLE app.shops ADD COLUMN setup_request_at timestamptz;
ALTER TABLE app.shops ADD CONSTRAINT shops_setup_request_pair_ck CHECK ((setup_request_note IS NULL) = (setup_request_at IS NULL));
ALTER TABLE app.shops ADD CONSTRAINT shops_setup_request_note_ck CHECK (
  setup_request_note IS NULL OR (setup_request_note = btrim(setup_request_note) AND char_length(setup_request_note) BETWEEN 1 AND 500)
);

-- Backfill: a shop that already satisfies every condition today (profile, schedule, a real pickup point and one sellable dish with a picture) is
-- recorded as activated at its last change, with no audit row (nothing happened now). A shop that lacks any of them keeps NULL: it is "not set up" and
-- is activated by the system, with an audit row, the first time it becomes complete. Orders, deliveries and accounts are not touched.
UPDATE app.shops s
   SET activated_at = s.updated_at
 WHERE s.status <> 'INCOMPLETE'
   AND s.activated_at IS NULL
   AND s.pickup_lat IS NOT NULL AND s.pickup_lng IS NOT NULL AND NOT (s.pickup_lat = 0 AND s.pickup_lng = 0)
   AND s.service_area_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM app.shop_business_hours h WHERE h.shop_id = s.shop_id)
   AND EXISTS (SELECT 1 FROM app.menu_items i WHERE i.shop_id = s.shop_id AND i.status = 'VISIBLE' AND i.price_vnd > 0 AND i.image_id IS NOT NULL);

-- Down Migration
ALTER TABLE app.shops DROP CONSTRAINT shops_setup_request_note_ck;
ALTER TABLE app.shops DROP CONSTRAINT shops_setup_request_pair_ck;
ALTER TABLE app.shops DROP COLUMN setup_request_at;
ALTER TABLE app.shops DROP COLUMN setup_request_note;
ALTER TABLE app.shops DROP COLUMN activated_at;
