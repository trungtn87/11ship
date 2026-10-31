-- Up Migration
-- Nhóm 09 (issues #221, #212; review fixes F1, F3):
-- 1. Mở rộng payer trong app.shipping_fee_agreements để hỗ trợ SENDER/RECIPIENT.
-- 2. Cho phép shop_id nullable trong app.reviews và app.complaints đối với đơn gọi shipper trực tiếp (source CUSTOMER).

-- F1: shipping_fee_agreements payer
ALTER TABLE app.shipping_fee_agreements ALTER COLUMN payer TYPE varchar(16);
ALTER TABLE app.shipping_fee_agreements DROP CONSTRAINT shipping_fee_agreements_payer_ck;
ALTER TABLE app.shipping_fee_agreements ADD CONSTRAINT shipping_fee_agreements_payer_ck CHECK (payer IN ('CUSTOMER', 'SHOP', 'SENDER', 'RECIPIENT'));

ALTER TABLE app.shipping_fee_agreements DROP CONSTRAINT shipping_fee_agreements_pending_ck;
ALTER TABLE app.shipping_fee_agreements ADD CONSTRAINT shipping_fee_agreements_pending_ck CHECK (
  (status = 'AWAITING_CUSTOMER') = (pending_fee_vnd IS NOT NULL AND pending_source IS NOT NULL)
  AND (pending_fee_vnd IS NULL) = (pending_source IS NULL)
  AND (pending_source IS NULL OR pending_source IN ('PROPOSAL', 'COUNTER'))
  AND (status <> 'AWAITING_CUSTOMER' OR payer IN ('CUSTOMER', 'SENDER', 'RECIPIENT'))
);

-- F3: reviews
ALTER TABLE app.reviews ALTER COLUMN shop_id DROP NOT NULL;
ALTER TABLE app.reviews DROP CONSTRAINT reviews_links_ck;
ALTER TABLE app.reviews ADD CONSTRAINT reviews_links_ck CHECK (
  (kind = 'SHOP_BY_CUSTOMER' AND order_id IS NOT NULL AND delivery_id IS NULL AND assignment_id IS NULL AND driver_id IS NULL AND shop_id IS NOT NULL)
  OR (kind = 'SHIPPER_BY_CUSTOMER' AND delivery_id IS NOT NULL AND assignment_id IS NOT NULL AND driver_id IS NOT NULL AND ((order_id IS NOT NULL AND shop_id IS NOT NULL) OR (order_id IS NULL AND shop_id IS NULL)))
  OR (kind = 'SHIPPER_BY_SHOP' AND delivery_id IS NOT NULL AND assignment_id IS NOT NULL AND driver_id IS NOT NULL AND shop_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION app.reviews_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.reviews is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.review_id <> OLD.review_id OR NEW.kind <> OLD.kind OR NEW.reviewer_user_id <> OLD.reviewer_user_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
     OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.stars <> OLD.stars OR NEW.comment IS DISTINCT FROM OLD.comment
     OR NEW.reviewer_name <> OLD.reviewer_name OR NEW.shop_name <> OLD.shop_name OR NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.related_code <> OLD.related_code OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'REVIEW_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'REVIEW_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- F3: complaints
ALTER TABLE app.complaints ALTER COLUMN shop_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION app.complaints_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaints is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.complaint_id <> OLD.complaint_id OR NEW.code <> OLD.code OR NEW.submitter_user_id <> OLD.submitter_user_id OR NEW.submitter_role <> OLD.submitter_role
     OR NEW.category <> OLD.category OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.review_id IS DISTINCT FROM OLD.review_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
     OR NEW.scope_key <> OLD.scope_key OR NEW.body <> OLD.body OR NEW.related_code <> OLD.related_code OR NEW.shop_name <> OLD.shop_name
     OR NEW.driver_name IS DISTINCT FROM OLD.driver_name OR NEW.driver_code IS DISTINCT FROM OLD.driver_code OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'COMPLAINT_IDENTITY_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'COMPLAINT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('IN_PROGRESS', 'CLOSED_NO_ACTION'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_INFO', 'RESOLVED', 'CLOSED_NO_ACTION'))
    OR (OLD.status = 'AWAITING_INFO' AND NEW.status IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED_NO_ACTION'))
    OR (OLD.status IN ('RESOLVED', 'CLOSED_NO_ACTION') AND NEW.status = 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'COMPLAINT_STATE_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'restrict_violation';
  END IF;
  -- Every entry into a closed state counts one closure; nothing else moves the counter.
  IF (NEW.status IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND (OLD.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND NEW.closure_no <> OLD.closure_no + 1 THEN
    RAISE EXCEPTION 'COMPLAINT_CLOSURE_COUNT' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.status IN ('RESOLVED', 'CLOSED_NO_ACTION') AND OLD.status NOT IN ('RESOLVED', 'CLOSED_NO_ACTION')) AND NEW.closure_no <> OLD.closure_no THEN
    RAISE EXCEPTION 'COMPLAINT_CLOSURE_COUNT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Down Migration
DO $$ BEGIN RAISE EXCEPTION 'Customer courier agreements and reviews: rollback requires a forward corrective migration'; END $$;
