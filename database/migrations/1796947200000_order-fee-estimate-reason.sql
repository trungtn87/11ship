-- Preserve the canonical reason a customer explicitly confirmed when an Order
-- had no automatic delivery fee. Existing rows stay NULL: their old snapshots
-- do not contain enough evidence to reconstruct a specific cause safely.
ALTER TABLE app.orders
  ADD COLUMN fee_estimate_reason varchar(32),
  ADD CONSTRAINT orders_fee_estimate_reason_ck CHECK (
    fee_estimate_reason IS NULL OR fee_estimate_reason IN (
      'PICKUP_PIN_MISSING',
      'DROPOFF_PIN_MISSING',
      'ROUTE_TIMEOUT',
      'ROUTE_UNAVAILABLE',
      'POLICY_NOT_CONFIGURED',
      'OUT_OF_PRICE_RANGE'
    )
  );
