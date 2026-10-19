-- Up Migration
-- M11 (docs/current/M11-implementation-20261018.md): ratings (customer -> shop, customer -> Shipper, shop -> Shipper), the shop's reply and its history, the
-- Administration's hide / restore of a rating (the original is kept), complaints with evidence pictures, follow-up messages, the 7-day reconsideration
-- window, and the outcome adjustments an Admin records against a delivery result (NEVER a second completion: the delivery and its capture are untouched).
--
-- ADDITIVE and safe on a database with data: it creates tables, functions, triggers and one sequence, and replaces exactly ONE constraint of M08
-- (notifications_target_ck gains the target 'COMPLAINT'). Nothing is dropped, truncated or rewritten; no CASCADE; earlier migrations are not edited.
-- Foreign keys point at M07 (deliveries, assignments), M02 (shops), M03 (drivers) and M01 (users). The Order module (M10) does not exist yet, so
-- order_id is a plain column: the application refuses an order-based rating or complaint until M10 is connected (the M07 adapter does the same).

-- ---------------------------------------------------------------------------------------------------
-- app.reviews: one row per rating. Immutable: stars, comment, author, subject and links never change; only the moderation columns do.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.reviews (
  review_id uuid NOT NULL,
  kind varchar(24) NOT NULL,
  reviewer_user_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  driver_id uuid,
  order_id uuid,
  delivery_id uuid,
  assignment_id uuid,
  stars smallint NOT NULL,
  comment text,
  -- Name shown on the public shop page (customer ratings only): taken once when the rating is written, never the phone number.
  reviewer_name varchar(80) NOT NULL,
  -- Names and the code people see, copied when the rating is written (the Administration lists them without reaching into other modules' tables).
  shop_name varchar(120) NOT NULL,
  driver_name varchar(80),
  related_code varchar(16) NOT NULL,
  visibility varchar(8) NOT NULL DEFAULT 'VISIBLE',
  moderated_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,

  CONSTRAINT reviews_pkey PRIMARY KEY (review_id),
  CONSTRAINT reviews_kind_ck CHECK (kind IN ('SHOP_BY_CUSTOMER', 'SHIPPER_BY_CUSTOMER', 'SHIPPER_BY_SHOP')),
  CONSTRAINT reviews_stars_ck CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT reviews_comment_ck CHECK (comment IS NULL OR (comment = btrim(comment) AND char_length(comment) BETWEEN 1 AND 2000)),
  CONSTRAINT reviews_visibility_ck CHECK (visibility IN ('VISIBLE', 'HIDDEN')),
  CONSTRAINT reviews_version_ck CHECK (version >= 1),
  -- Each kind carries exactly the links its rule needs.
  CONSTRAINT reviews_links_ck CHECK (
    (kind = 'SHOP_BY_CUSTOMER' AND order_id IS NOT NULL AND delivery_id IS NULL AND assignment_id IS NULL AND driver_id IS NULL)
    OR (kind = 'SHIPPER_BY_CUSTOMER' AND order_id IS NOT NULL AND delivery_id IS NOT NULL AND assignment_id IS NOT NULL AND driver_id IS NOT NULL)
    OR (kind = 'SHIPPER_BY_SHOP' AND delivery_id IS NOT NULL AND assignment_id IS NOT NULL AND driver_id IS NOT NULL)
  ),
  CONSTRAINT reviews_reviewer_fk FOREIGN KEY (reviewer_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT reviews_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT reviews_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT reviews_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT reviews_assignment_fk FOREIGN KEY (assignment_id) REFERENCES app.delivery_assignments (assignment_id) ON DELETE RESTRICT
);
-- One rating per actor and subject: the database is the last line of defence for two concurrent requests.
CREATE UNIQUE INDEX reviews_shop_by_customer_uq ON app.reviews (order_id) WHERE kind = 'SHOP_BY_CUSTOMER';
CREATE UNIQUE INDEX reviews_shipper_by_customer_uq ON app.reviews (delivery_id) WHERE kind = 'SHIPPER_BY_CUSTOMER';
CREATE UNIQUE INDEX reviews_shipper_by_shop_uq ON app.reviews (delivery_id) WHERE kind = 'SHIPPER_BY_SHOP';
CREATE INDEX reviews_shop_idx ON app.reviews (shop_id, created_at DESC) WHERE kind = 'SHOP_BY_CUSTOMER';
CREATE INDEX reviews_driver_idx ON app.reviews (driver_id, kind, created_at DESC) WHERE driver_id IS NOT NULL;
CREATE INDEX reviews_created_idx ON app.reviews (created_at DESC);

-- A rating is never edited or deleted. Moderation changes only visibility (+ moderated_at), advances the version by one, and the "who and why"
-- lives in app.review_moderations (written in the same transaction by the application).
CREATE FUNCTION app.reviews_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.reviews is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.review_id <> OLD.review_id OR NEW.kind <> OLD.kind OR NEW.reviewer_user_id <> OLD.reviewer_user_id OR NEW.shop_id <> OLD.shop_id
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
CREATE TRIGGER reviews_guard BEFORE UPDATE ON app.reviews FOR EACH ROW EXECUTE FUNCTION app.reviews_guard();
CREATE TRIGGER reviews_no_delete BEFORE DELETE OR TRUNCATE ON app.reviews FOR EACH STATEMENT EXECUTE FUNCTION app.reviews_guard();

-- ---------------------------------------------------------------------------------------------------
-- app.review_moderations (append-only): hide / restore with a mandatory reason. The rating itself is kept.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.review_moderations (
  moderation_id uuid NOT NULL,
  review_id uuid NOT NULL,
  action varchar(8) NOT NULL,
  reason_code varchar(24) NOT NULL,
  reason_note varchar(500),
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT review_moderations_pkey PRIMARY KEY (moderation_id),
  CONSTRAINT review_moderations_review_fk FOREIGN KEY (review_id) REFERENCES app.reviews (review_id) ON DELETE RESTRICT,
  CONSTRAINT review_moderations_actor_fk FOREIGN KEY (actor_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT review_moderations_action_ck CHECK (action IN ('HIDE', 'RESTORE')),
  CONSTRAINT review_moderations_reason_ck CHECK (reason_code IN ('WRONG_ORDER', 'ABUSIVE', 'PERSONAL_DATA', 'SPAM', 'VERIFIED_FALSE', 'MISTAKE_RESOLVED', 'OTHER')),
  CONSTRAINT review_moderations_note_ck CHECK (reason_note IS NULL OR char_length(btrim(reason_note)) BETWEEN 1 AND 500),
  CONSTRAINT review_moderations_other_ck CHECK (reason_code <> 'OTHER' OR reason_note IS NOT NULL)
);
CREATE INDEX review_moderations_review_idx ON app.review_moderations (review_id, created_at);

-- ---------------------------------------------------------------------------------------------------
-- app.review_replies: at most ONE reply per customer rating of a shop, updated in place; every saved text is kept in app.review_reply_history.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.review_replies (
  review_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  body text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT review_replies_pkey PRIMARY KEY (review_id),
  CONSTRAINT review_replies_review_fk FOREIGN KEY (review_id) REFERENCES app.reviews (review_id) ON DELETE RESTRICT,
  CONSTRAINT review_replies_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT review_replies_body_ck CHECK (body = btrim(body) AND char_length(body) BETWEEN 1 AND 2000),
  CONSTRAINT review_replies_version_ck CHECK (version >= 1),
  CONSTRAINT review_replies_time_ck CHECK (updated_at >= created_at)
);
CREATE TABLE app.review_reply_history (
  review_id uuid NOT NULL,
  version bigint NOT NULL,
  body text NOT NULL,
  written_by uuid NOT NULL,
  written_at timestamptz NOT NULL,

  CONSTRAINT review_reply_history_pkey PRIMARY KEY (review_id, version),
  CONSTRAINT review_reply_history_review_fk FOREIGN KEY (review_id) REFERENCES app.reviews (review_id) ON DELETE RESTRICT,
  CONSTRAINT review_reply_history_by_fk FOREIGN KEY (written_by) REFERENCES app.users (user_id) ON DELETE RESTRICT
);

CREATE FUNCTION app.review_replies_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  kind_of varchar;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'app.review_replies is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT r.kind INTO kind_of FROM app.reviews r WHERE r.review_id = NEW.review_id AND r.shop_id = NEW.shop_id;
    IF kind_of IS DISTINCT FROM 'SHOP_BY_CUSTOMER' THEN
      RAISE EXCEPTION 'REPLY_TARGET_INVALID' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.review_id <> OLD.review_id OR NEW.shop_id <> OLD.shop_id OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'REPLY_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER review_replies_guard BEFORE INSERT OR UPDATE ON app.review_replies FOR EACH ROW EXECUTE FUNCTION app.review_replies_guard();
CREATE TRIGGER review_replies_no_delete BEFORE DELETE OR TRUNCATE ON app.review_replies FOR EACH STATEMENT EXECUTE FUNCTION app.review_replies_guard();

CREATE FUNCTION app.m11_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER review_reply_history_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.review_reply_history FOR EACH STATEMENT EXECUTE FUNCTION app.m11_append_only();
CREATE TRIGGER review_moderations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.review_moderations FOR EACH STATEMENT EXECUTE FUNCTION app.m11_append_only();

-- ---------------------------------------------------------------------------------------------------
-- app.complaints: one file per issue, opened by one party of an order / delivery (or by a Shipper about a rating of them).
-- ---------------------------------------------------------------------------------------------------
CREATE SEQUENCE app.complaint_code_seq AS bigint START WITH 1 MINVALUE 1 NO CYCLE;

-- The runtime role gets no sequence privilege (the grant matrix has none): it reaches the sequence only through this function, which runs with its owner's
-- rights, exactly like app.next_shipper_code. The runtime role gets EXECUTE in 03-runtime-function-grants.sql.
CREATE FUNCTION app.next_complaint_code() RETURNS varchar
  LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT 'PA' || lpad(nextval('app.complaint_code_seq')::text, 5, '0')
$$;
REVOKE ALL ON FUNCTION app.next_complaint_code() FROM PUBLIC;

CREATE TABLE app.complaints (
  complaint_id uuid NOT NULL,
  code varchar(16) NOT NULL,
  submitter_user_id uuid NOT NULL,
  submitter_role varchar(8) NOT NULL,
  category varchar(16) NOT NULL,
  order_id uuid,
  delivery_id uuid,
  review_id uuid,
  shop_id uuid NOT NULL,
  driver_id uuid,
  -- The code shown to people (delivery or order code) and the names of the parties, copied when the file is opened.
  related_code varchar(16) NOT NULL,
  shop_name varchar(120) NOT NULL,
  driver_name varchar(80),
  driver_code varchar(16),
  -- What "the same issue" means: the rating, else the delivery, else the order.
  scope_key uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  awaiting_from varchar(10),
  assigned_to uuid,
  received_at timestamptz,
  body text NOT NULL,
  conclusion text,
  concluded_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  -- How many times the file was closed: a reconsideration request belongs to one closure.
  closure_no integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,

  CONSTRAINT complaints_pkey PRIMARY KEY (complaint_id),
  CONSTRAINT complaints_code_uq UNIQUE (code),
  CONSTRAINT complaints_submitter_fk FOREIGN KEY (submitter_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaints_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops (shop_id) ON DELETE RESTRICT,
  CONSTRAINT complaints_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT complaints_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT complaints_review_fk FOREIGN KEY (review_id) REFERENCES app.reviews (review_id) ON DELETE RESTRICT,
  CONSTRAINT complaints_assignee_fk FOREIGN KEY (assigned_to) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaints_role_ck CHECK (submitter_role IN ('CUSTOMER', 'SHOP', 'SHIPPER')),
  CONSTRAINT complaints_category_ck CHECK (category IN ('DELIVERY_RESULT', 'GOODS', 'MONEY_FEE', 'SERVICE', 'SHIPPER_REVIEW', 'OTHER')),
  CONSTRAINT complaints_status_ck CHECK (status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO', 'RESOLVED', 'CLOSED_NO_ACTION')),
  CONSTRAINT complaints_awaiting_ck CHECK ((status = 'AWAITING_INFO') = (awaiting_from IS NOT NULL) AND (awaiting_from IS NULL OR awaiting_from IN ('SUBMITTER', 'SHOP', 'SHIPPER'))),
  CONSTRAINT complaints_target_ck CHECK (order_id IS NOT NULL OR delivery_id IS NOT NULL OR review_id IS NOT NULL),
  CONSTRAINT complaints_review_category_ck CHECK ((category = 'SHIPPER_REVIEW') = (review_id IS NOT NULL)),
  CONSTRAINT complaints_body_ck CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT complaints_closed_ck CHECK (
    (status IN ('RESOLVED', 'CLOSED_NO_ACTION')) = (closed_at IS NOT NULL)
    AND (status <> 'RESOLVED' OR conclusion IS NOT NULL)
    AND (status <> 'CLOSED_NO_ACTION' OR close_reason IS NOT NULL)
  ),
  CONSTRAINT complaints_received_ck CHECK (status = 'PENDING' OR received_at IS NOT NULL),
  CONSTRAINT complaints_closure_ck CHECK (closure_no >= 0),
  CONSTRAINT complaints_version_ck CHECK (version >= 1),
  CONSTRAINT complaints_time_ck CHECK (updated_at >= created_at)
);
-- The same open issue of the same party on the same order / delivery / rating is ONE file: a second request adds to it.
CREATE UNIQUE INDEX complaints_open_issue_uq ON app.complaints (submitter_user_id, submitter_role, category, scope_key)
  WHERE status IN ('PENDING', 'IN_PROGRESS', 'AWAITING_INFO');
CREATE INDEX complaints_submitter_idx ON app.complaints (submitter_user_id, created_at DESC);
CREATE INDEX complaints_status_idx ON app.complaints (status, created_at DESC);
CREATE INDEX complaints_shop_idx ON app.complaints (shop_id, created_at DESC);
CREATE INDEX complaints_driver_idx ON app.complaints (driver_id, created_at DESC) WHERE driver_id IS NOT NULL;
CREATE INDEX complaints_delivery_idx ON app.complaints (delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX complaints_assignee_idx ON app.complaints (assigned_to) WHERE assigned_to IS NOT NULL;

-- Identity never changes; the version advances by one; the status follows the graph. A closed file is only re-opened (to IN_PROGRESS) by an explicit
-- Admin decision, which the application records (app.complaint_reconsiderations). Nothing deletes a file.
CREATE FUNCTION app.complaints_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaints is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.complaint_id <> OLD.complaint_id OR NEW.code <> OLD.code OR NEW.submitter_user_id <> OLD.submitter_user_id OR NEW.submitter_role <> OLD.submitter_role
     OR NEW.category <> OLD.category OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.review_id IS DISTINCT FROM OLD.review_id OR NEW.shop_id <> OLD.shop_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
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
CREATE TRIGGER complaints_guard BEFORE UPDATE ON app.complaints FOR EACH ROW EXECUTE FUNCTION app.complaints_guard();
CREATE TRIGGER complaints_no_delete BEFORE DELETE OR TRUNCATE ON app.complaints FOR EACH STATEMENT EXECUTE FUNCTION app.complaints_guard();

-- ---------------------------------------------------------------------------------------------------
-- app.complaint_messages (append-only): the whole thread. `visibility` decides who may read a line, `audience_role` addresses a request to a party.
--   SUBMITTER  the submitter and the Administration
--   PARTIES    the submitter, the related parties and the Administration (the conclusion, what a party must explain)
--   PARTY_ONLY the party named in audience_role and the Administration (a request to a party and its answer)
--   INTERNAL   the Administration only (internal notes, assignment)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.complaint_messages (
  message_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  seq integer NOT NULL,
  kind varchar(24) NOT NULL,
  visibility varchar(10) NOT NULL,
  audience_role varchar(8),
  author_type varchar(10) NOT NULL,
  author_user_id uuid,
  body text,
  created_at timestamptz NOT NULL,

  CONSTRAINT complaint_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT complaint_messages_seq_uq UNIQUE (complaint_id, seq),
  CONSTRAINT complaint_messages_complaint_fk FOREIGN KEY (complaint_id) REFERENCES app.complaints (complaint_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_messages_author_fk FOREIGN KEY (author_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_messages_kind_ck CHECK (kind IN ('SUBMITTED', 'APPENDED', 'SUPPLEMENT', 'PARTY_RESPONSE', 'RECEIVED', 'REQUEST_INFO', 'CONCLUSION', 'CLOSED', 'REOPEN_REQUEST', 'REOPEN_DECISION', 'ASSIGNED', 'NOTE', 'ADJUSTMENT')),
  CONSTRAINT complaint_messages_visibility_ck CHECK (visibility IN ('SUBMITTER', 'PARTIES', 'PARTY_ONLY', 'INTERNAL')),
  CONSTRAINT complaint_messages_audience_ck CHECK ((visibility = 'PARTY_ONLY') = (audience_role IS NOT NULL) AND (audience_role IS NULL OR audience_role IN ('SHOP', 'SHIPPER'))),
  CONSTRAINT complaint_messages_author_type_ck CHECK (author_type IN ('SUBMITTER', 'PARTY', 'ADMIN', 'SYSTEM')),
  CONSTRAINT complaint_messages_body_ck CHECK (body IS NULL OR char_length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT complaint_messages_seq_ck CHECK (seq >= 1)
);
CREATE TRIGGER complaint_messages_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON app.complaint_messages FOR EACH STATEMENT EXECUTE FUNCTION app.m11_append_only();

-- ---------------------------------------------------------------------------------------------------
-- app.complaint_attachments: the evidence pictures. Uploaded first by their owner (unlinked), then attached to ONE message of ONE file, once.
-- The bytes never change. Reading is decided by the application from the file the picture belongs to (never from the picture id alone).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.complaint_attachments (
  attachment_id uuid NOT NULL,
  uploader_user_id uuid NOT NULL,
  complaint_id uuid,
  message_id uuid,
  content_type varchar(16) NOT NULL,
  byte_size integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL,
  linked_at timestamptz,

  CONSTRAINT complaint_attachments_pkey PRIMARY KEY (attachment_id),
  CONSTRAINT complaint_attachments_uploader_fk FOREIGN KEY (uploader_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_attachments_complaint_fk FOREIGN KEY (complaint_id) REFERENCES app.complaints (complaint_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_attachments_message_fk FOREIGN KEY (message_id) REFERENCES app.complaint_messages (message_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_attachments_type_ck CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT complaint_attachments_size_ck CHECK (byte_size BETWEEN 1 AND 5242880 AND byte_size = octet_length(data)),
  CONSTRAINT complaint_attachments_link_ck CHECK ((complaint_id IS NULL) = (message_id IS NULL) AND (complaint_id IS NULL) = (linked_at IS NULL))
);
CREATE INDEX complaint_attachments_owner_idx ON app.complaint_attachments (uploader_user_id, created_at) WHERE complaint_id IS NULL;
CREATE INDEX complaint_attachments_complaint_idx ON app.complaint_attachments (complaint_id) WHERE complaint_id IS NOT NULL;

CREATE FUNCTION app.complaint_attachments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaint_attachments is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.attachment_id <> OLD.attachment_id OR NEW.uploader_user_id <> OLD.uploader_user_id OR NEW.content_type <> OLD.content_type
     OR NEW.byte_size <> OLD.byte_size OR NEW.data <> OLD.data OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ATTACHMENT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.complaint_id IS NOT NULL THEN
    RAISE EXCEPTION 'ATTACHMENT_ALREADY_LINKED' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER complaint_attachments_guard BEFORE UPDATE ON app.complaint_attachments FOR EACH ROW EXECUTE FUNCTION app.complaint_attachments_guard();
CREATE TRIGGER complaint_attachments_no_delete BEFORE DELETE OR TRUNCATE ON app.complaint_attachments FOR EACH STATEMENT EXECUTE FUNCTION app.complaint_attachments_guard();

-- ---------------------------------------------------------------------------------------------------
-- app.complaint_reconsiderations: "xem xét lại". One request per closure of a file, inside 7 days of the closure (server clock, checked by the
-- application); the Admin decides and gives a reason.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.complaint_reconsiderations (
  request_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  closure_no integer NOT NULL,
  requested_by uuid NOT NULL,
  reason text NOT NULL,
  requested_at timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'PENDING',
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,

  CONSTRAINT complaint_reconsiderations_pkey PRIMARY KEY (request_id),
  CONSTRAINT complaint_reconsiderations_once_uq UNIQUE (complaint_id, closure_no),
  CONSTRAINT complaint_reconsiderations_complaint_fk FOREIGN KEY (complaint_id) REFERENCES app.complaints (complaint_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_reconsiderations_by_fk FOREIGN KEY (requested_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_reconsiderations_decider_fk FOREIGN KEY (decided_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_reconsiderations_status_ck CHECK (status IN ('PENDING', 'REOPENED', 'REJECTED')),
  CONSTRAINT complaint_reconsiderations_reason_ck CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  CONSTRAINT complaint_reconsiderations_decision_ck CHECK (
    (status = 'PENDING') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL) AND (decided_at IS NULL) = (decision_reason IS NULL)
  )
);
CREATE FUNCTION app.complaint_reconsiderations_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaint_reconsiderations is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.request_id <> OLD.request_id OR NEW.complaint_id <> OLD.complaint_id OR NEW.closure_no <> OLD.closure_no OR NEW.requested_by <> OLD.requested_by
     OR NEW.reason <> OLD.reason OR NEW.requested_at <> OLD.requested_at OR OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'RECONSIDERATION_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER complaint_reconsiderations_guard BEFORE UPDATE ON app.complaint_reconsiderations FOR EACH ROW EXECUTE FUNCTION app.complaint_reconsiderations_guard();
CREATE TRIGGER complaint_reconsiderations_no_delete BEFORE DELETE OR TRUNCATE ON app.complaint_reconsiderations FOR EACH STATEMENT EXECUTE FUNCTION app.complaint_reconsiderations_guard();

-- ---------------------------------------------------------------------------------------------------
-- app.complaint_adjustments: the Administration's correction of a delivery RESULT or a commission, written against the ORIGINAL result. A row never
-- changes the delivery, its assignment, its commission hold or the order: those stay as they were (the guards of M07 reject a terminal delivery that
-- moves). The money part is only requested here: M04 posts it (or answers that it cannot), and a missing balance leaves it PENDING_FINANCE.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE app.complaint_adjustments (
  adjustment_id uuid NOT NULL,
  complaint_id uuid NOT NULL,
  kind varchar(16) NOT NULL,
  delivery_id uuid NOT NULL,
  assignment_id uuid,
  driver_id uuid,
  original_state varchar(24) NOT NULL,
  original_assignment_status varchar(24),
  corrected_result varchar(16),
  direction varchar(20),
  amount_vnd bigint,
  status varchar(16) NOT NULL,
  pending_reason varchar(24),
  history_reviewed boolean NOT NULL,
  successor_delivery_ids uuid[] NOT NULL DEFAULT '{}',
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,

  CONSTRAINT complaint_adjustments_pkey PRIMARY KEY (adjustment_id),
  CONSTRAINT complaint_adjustments_once_uq UNIQUE (complaint_id, kind),
  CONSTRAINT complaint_adjustments_complaint_fk FOREIGN KEY (complaint_id) REFERENCES app.complaints (complaint_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_adjustments_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_adjustments_assignment_fk FOREIGN KEY (assignment_id) REFERENCES app.delivery_assignments (assignment_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_adjustments_driver_fk FOREIGN KEY (driver_id) REFERENCES app.drivers (driver_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_adjustments_by_fk FOREIGN KEY (created_by) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT complaint_adjustments_kind_ck CHECK (kind IN ('DELIVERY_RESULT', 'COMMISSION')),
  CONSTRAINT complaint_adjustments_status_ck CHECK (status IN ('RECORDED', 'PENDING_FINANCE', 'EXECUTED')),
  CONSTRAINT complaint_adjustments_pending_ck CHECK ((status = 'PENDING_FINANCE') = (pending_reason IS NOT NULL) AND (pending_reason IS NULL OR pending_reason IN ('M04_UNAVAILABLE', 'INSUFFICIENT_BALANCE'))),
  CONSTRAINT complaint_adjustments_result_ck CHECK (
    (kind = 'DELIVERY_RESULT' AND corrected_result IN ('DELIVERED', 'NOT_DELIVERED') AND direction IS NULL AND amount_vnd IS NULL AND status = 'RECORDED')
    OR (kind = 'COMMISSION' AND corrected_result IS NULL AND direction IN ('REFUND_TO_SHIPPER', 'CHARGE_TO_SHIPPER') AND amount_vnd BETWEEN 1 AND 9007199254740991
        AND assignment_id IS NOT NULL AND driver_id IS NOT NULL AND status IN ('PENDING_FINANCE', 'EXECUTED'))
  ),
  CONSTRAINT complaint_adjustments_reason_ck CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT complaint_adjustments_version_ck CHECK (version >= 1)
);
CREATE INDEX complaint_adjustments_delivery_idx ON app.complaint_adjustments (delivery_id, created_at);
-- The row records WHAT was decided and against which original; only the money status (and its reason) may move afterwards, forward, by one version.
CREATE FUNCTION app.complaint_adjustments_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'app.complaint_adjustments is never deleted (% rejected)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.adjustment_id <> OLD.adjustment_id OR NEW.complaint_id <> OLD.complaint_id OR NEW.kind <> OLD.kind OR NEW.delivery_id <> OLD.delivery_id
     OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id OR NEW.original_state <> OLD.original_state
     OR NEW.original_assignment_status IS DISTINCT FROM OLD.original_assignment_status OR NEW.corrected_result IS DISTINCT FROM OLD.corrected_result
     OR NEW.direction IS DISTINCT FROM OLD.direction OR NEW.amount_vnd IS DISTINCT FROM OLD.amount_vnd OR NEW.history_reviewed <> OLD.history_reviewed
     OR NEW.successor_delivery_ids <> OLD.successor_delivery_ids OR NEW.reason <> OLD.reason OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.version <> OLD.version + 1 OR OLD.status = 'EXECUTED' THEN
    RAISE EXCEPTION 'ADJUSTMENT_VERSION_CONFLICT' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER complaint_adjustments_guard BEFORE UPDATE ON app.complaint_adjustments FOR EACH ROW EXECUTE FUNCTION app.complaint_adjustments_guard();
CREATE TRIGGER complaint_adjustments_no_delete BEFORE DELETE OR TRUNCATE ON app.complaint_adjustments FOR EACH STATEMENT EXECUTE FUNCTION app.complaint_adjustments_guard();

-- ---------------------------------------------------------------------------------------------------
-- M08: a notification may open a complaint (the only change to an earlier table: one CHECK constraint widened by one value).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE app.notifications DROP CONSTRAINT notifications_target_ck;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_target_ck
  CHECK (target_type IN ('ORDER', 'DELIVERY', 'WALLET_TXN', 'PROFILE', 'DELIVERY_LIST', 'NONE', 'COMPLAINT'));

-- Down Migration
-- Only for disposable test or experimental databases. Restores the M08 constraint (refused while a COMPLAINT notification exists) and drops the M11 objects, children first.
DELETE FROM app.notification_pushes WHERE notification_id IN (SELECT notification_id FROM app.notifications WHERE target_type = 'COMPLAINT');
DELETE FROM app.notifications WHERE target_type = 'COMPLAINT';
ALTER TABLE app.notifications DROP CONSTRAINT notifications_target_ck;
ALTER TABLE app.notifications ADD CONSTRAINT notifications_target_ck
  CHECK (target_type IN ('ORDER', 'DELIVERY', 'WALLET_TXN', 'PROFILE', 'DELIVERY_LIST', 'NONE'));
DROP TABLE app.complaint_adjustments;
DROP FUNCTION app.complaint_adjustments_guard();
DROP TABLE app.complaint_reconsiderations;
DROP FUNCTION app.complaint_reconsiderations_guard();
DROP TABLE app.complaint_attachments;
DROP FUNCTION app.complaint_attachments_guard();
DROP TABLE app.complaint_messages;
DROP TABLE app.complaints;
DROP FUNCTION app.complaints_guard();
DROP FUNCTION app.next_complaint_code();
DROP SEQUENCE app.complaint_code_seq;
DROP TABLE app.review_reply_history;
DROP TABLE app.review_replies;
DROP FUNCTION app.review_replies_guard();
DROP TABLE app.review_moderations;
DROP TABLE app.reviews;
DROP FUNCTION app.reviews_guard();
DROP FUNCTION app.m11_append_only();
