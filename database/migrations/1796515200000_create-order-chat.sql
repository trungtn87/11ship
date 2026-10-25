-- #191: "Trao đổi đơn hàng", the text chat of ONE order (an ORDER room) or of ONE direct delivery with no order (a DELIVERY room).
-- Only what people WROTE is stored here. The milestones of the order (placed, confirmed, shipper accepted, picked up, delivered, cancelled...) are read from the
-- order and delivery events (app.order_events / app.delivery_events, untouched) when the room is read, so a milestone is never copied, never counted twice and
-- the audit trail is not changed. The room is open while the order (or the direct delivery) has not ended; the server checks that, and the sender's right to
-- see that very order, inside the transaction that writes the message.
-- Messages are deleted by a batch job N days after the room closed (SYSTEM setting chat.retention_days, default 90, range 30-365: a PROPOSAL not yet fixed by
-- the Owner), later when a complaint about the order is open or was closed more recently.

CREATE TABLE app.order_chat_messages (
  message_id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  room_type varchar(8) NOT NULL,
  order_id uuid,
  delivery_id uuid,
  sender_user_id uuid NOT NULL,
  sender_role varchar(10) NOT NULL,
  sender_name varchar(120) NOT NULL,
  body varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),

  CONSTRAINT order_chat_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT order_chat_messages_seq_uq UNIQUE (seq),
  CONSTRAINT order_chat_messages_order_fk FOREIGN KEY (order_id) REFERENCES app.orders (order_id) ON DELETE RESTRICT,
  CONSTRAINT order_chat_messages_delivery_fk FOREIGN KEY (delivery_id) REFERENCES app.deliveries (delivery_id) ON DELETE RESTRICT,
  CONSTRAINT order_chat_messages_room_ck CHECK (
    (room_type = 'ORDER' AND order_id IS NOT NULL AND delivery_id IS NULL)
    OR (room_type = 'DELIVERY' AND delivery_id IS NOT NULL AND order_id IS NULL)
  ),
  CONSTRAINT order_chat_messages_role_ck CHECK (sender_role IN ('CUSTOMER', 'SHOP', 'SHIPPER')),
  CONSTRAINT order_chat_messages_body_ck CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  CONSTRAINT order_chat_messages_name_ck CHECK (char_length(btrim(sender_name)) BETWEEN 1 AND 120)
);

CREATE INDEX order_chat_messages_order_idx ON app.order_chat_messages (order_id, created_at, seq) WHERE order_id IS NOT NULL;
CREATE INDEX order_chat_messages_delivery_idx ON app.order_chat_messages (delivery_id, created_at, seq) WHERE delivery_id IS NOT NULL;
CREATE INDEX order_chat_messages_sender_rate_idx ON app.order_chat_messages (sender_user_id, created_at DESC);

-- The write path inserts and the retention job deletes whole rows; a message is never edited (the first version has no edit or recall).
CREATE FUNCTION app.order_chat_messages_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.order_chat_messages is append-only (UPDATE rejected)' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER order_chat_messages_no_update
  BEFORE UPDATE ON app.order_chat_messages
  FOR EACH ROW EXECUTE FUNCTION app.order_chat_messages_reject_update();
