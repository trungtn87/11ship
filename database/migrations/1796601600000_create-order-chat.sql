-- Up Migration
-- Issue #191: "Trao đổi đơn hàng", the text chat of ONE food order (M10) or ONE direct delivery (M07 DIRECT, no order around it). Messages typed by people are
-- stored here; the business milestones in the same feed are NOT stored: they are projected from order_events / delivery_events when the feed is read, so each
-- source event shows once and the investigation logs stay untouched. A message never changes an order, a fee, a right or a state.
-- Forward-only and additive: a new table and its indexes; nothing existing is altered.

CREATE TABLE app.order_chat_messages (
  message_id uuid NOT NULL,
  room_type varchar(8) NOT NULL,
  order_id uuid,
  delivery_id uuid,
  sender_user_id uuid NOT NULL,
  sender_role varchar(8) NOT NULL,
  -- Snapshot of the sender's name at sending time (customer: the name on the order; shop: the shop; shipper: the Shipper's full name).
  sender_name varchar(120) NOT NULL,
  body varchar(500) NOT NULL,
  -- The Idempotency-Key of the send: one key is one message (a retry returns the stored message; it never writes a second one).
  client_key uuid NOT NULL,
  created_at timestamptz NOT NULL,

  CONSTRAINT order_chat_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT order_chat_messages_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (order_id) ON DELETE RESTRICT,
  CONSTRAINT order_chat_messages_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT order_chat_messages_sender_fk FOREIGN KEY (sender_user_id) REFERENCES app.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT order_chat_messages_room_ck CHECK (
    (room_type = 'ORDER' AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (room_type = 'DIRECT' AND delivery_id IS NOT NULL AND order_id IS NULL)
  ),
  CONSTRAINT order_chat_messages_role_ck CHECK (sender_role IN ('CUSTOMER', 'SHOP', 'SHIPPER')),
  CONSTRAINT order_chat_messages_body_ck CHECK (char_length(body) BETWEEN 1 AND 500 AND body = btrim(body)),
  CONSTRAINT order_chat_messages_client_key_uq UNIQUE (sender_user_id, client_key)
);
CREATE INDEX order_chat_messages_order_idx ON app.order_chat_messages (order_id, created_at DESC, message_id DESC) WHERE order_id IS NOT NULL;
CREATE INDEX order_chat_messages_delivery_idx ON app.order_chat_messages (delivery_id, created_at DESC, message_id DESC) WHERE delivery_id IS NOT NULL;
CREATE INDEX order_chat_messages_sender_idx ON app.order_chat_messages (sender_user_id, created_at DESC);

-- A message is never rewritten (no edit, no recall in this version).
CREATE FUNCTION app.order_chat_messages_reject_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.order_chat_messages rows are never updated' USING ERRCODE = 'restrict_violation';
END
$$;
CREATE TRIGGER order_chat_messages_no_update BEFORE UPDATE ON app.order_chat_messages FOR EACH ROW EXECUTE FUNCTION app.order_chat_messages_reject_update();

-- Down Migration
-- Only for disposable test or experimental databases: refuses to run once a message exists (safety latch ORDER_CHAT_DOWN_REFUSED).
DO $latch$
DECLARE
  rows_found bigint;
BEGIN
  SELECT count(*) INTO rows_found FROM app.order_chat_messages;
  IF rows_found > 0 THEN
    RAISE EXCEPTION 'ORDER_CHAT_DOWN_REFUSED: % message(s) exist; chat history is not dropped by a migration', rows_found USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END
$latch$;
DROP TRIGGER order_chat_messages_no_update ON app.order_chat_messages;
DROP FUNCTION app.order_chat_messages_reject_update();
DROP TABLE app.order_chat_messages;
