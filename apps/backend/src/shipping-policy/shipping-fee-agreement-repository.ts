import { Injectable } from '@nestjs/common';
import { TechnicalError } from '../common/app-errors';
import { toSafeInteger } from '../driver/driver-db';
import { TransactionContext } from '../transaction/transaction-context';
import { Agreement, AgreementPatch, AgreementReason, AgreementStatus, EventType, FeeMode, FeePayer, rejectedKey } from './shipping-fee-agreement';

export type ActorType = 'SHOP' | 'DRIVER' | 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

export interface AgreementEvent {
  readonly seq: number;
  readonly eventType: EventType;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly driverId: string | null;
  readonly amountVnd: number | null;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly agreementVersion: number;
  readonly onBehalfOf: 'CUSTOMER' | null;
  readonly feePayer: 'CUSTOMER' | 'SHOP' | null;
  readonly createdAtMs: number;
}

interface Raw {
  agreement_id: string;
  delivery_id: string;
  fee_mode: FeeMode;
  payer: FeePayer;
  status: AgreementStatus;
  base_fee_vnd: string | null;
  base_policy_version_no: string | null;
  reason_code: AgreementReason | null;
  reason_note: string | null;
  proposed_fee_vnd: string | null;
  counter_fee_vnd: string | null;
  counter_by: string | null;
  bound_driver_id: string | null;
  pending_fee_vnd: string | null;
  pending_source: 'PROPOSAL' | 'COUNTER' | null;
  final_fee_vnd: string | null;
  expires_ms: string;
  answer_expires_ms: string | null;
  version: string;
  created_by: string;
  created_ms: string;
  updated_ms: string;
  locked_ms: string | null;
}

const ms = (column: string, alias: string): string => `(extract(epoch FROM ${column}) * 1000)::bigint::text AS ${alias}`;
const COLUMNS = `agreement_id::text AS agreement_id, delivery_id::text AS delivery_id, fee_mode, payer, status, base_fee_vnd::text AS base_fee_vnd,
  base_policy_version_no::text AS base_policy_version_no, reason_code, reason_note, proposed_fee_vnd::text AS proposed_fee_vnd,
  counter_fee_vnd::text AS counter_fee_vnd, counter_by::text AS counter_by, bound_driver_id::text AS bound_driver_id,
  pending_fee_vnd::text AS pending_fee_vnd, pending_source, final_fee_vnd::text AS final_fee_vnd, ${ms('expires_at', 'expires_ms')}, ${ms('answer_expires_at', 'answer_expires_ms')},
  version::text AS version, created_by::text AS created_by, ${ms('created_at', 'created_ms')}, ${ms('updated_at', 'updated_ms')}, ${ms('locked_at', 'locked_ms')}`;

const num = (value: string | null): number | null => (value === null ? null : toSafeInteger(value));

function toAgreement(row: Raw): Agreement {
  return {
    agreementId: row.agreement_id,
    deliveryId: row.delivery_id,
    feeMode: row.fee_mode,
    payer: row.payer,
    status: row.status,
    baseFeeVnd: num(row.base_fee_vnd),
    basePolicyVersionNo: num(row.base_policy_version_no),
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    proposedFeeVnd: num(row.proposed_fee_vnd),
    counterFeeVnd: num(row.counter_fee_vnd),
    counterBy: row.counter_by,
    boundDriverId: row.bound_driver_id,
    pendingFeeVnd: num(row.pending_fee_vnd),
    pendingSource: row.pending_source,
    finalFeeVnd: num(row.final_fee_vnd),
    expiresAtMs: toSafeInteger(row.expires_ms),
    answerExpiresAtMs: num(row.answer_expires_ms),
    version: toSafeInteger(row.version),
    createdBy: row.created_by,
    createdAtMs: toSafeInteger(row.created_ms),
    updatedAtMs: toSafeInteger(row.updated_ms),
    lockedAtMs: num(row.locked_ms),
  };
}

export interface NewAgreement {
  readonly agreementId: string;
  readonly deliveryId: string;
  readonly feeMode: FeeMode;
  readonly payer: FeePayer;
  readonly status: AgreementStatus;
  readonly baseFeeVnd: number | null;
  readonly basePolicyVersionNo: number | null;
  readonly reasonCode: AgreementReason | null;
  readonly reasonNote: string | null;
  readonly proposedFeeVnd: number | null;
  readonly finalFeeVnd: number | null;
  readonly expiresAtMs: number;
  readonly createdBy: string;
}

/** SQL for the fee agreements and their append-only event log (M06 v1.1). */
@Injectable()
export class ShippingFeeAgreementRepository {
  /** Inserts a new agreement; false when this delivery already has one (the UNIQUE on delivery_id decides, whatever the callers do concurrently). */
  async insert(context: TransactionContext, input: NewAgreement): Promise<boolean> {
    const result = await context.query(
      `INSERT INTO app.shipping_fee_agreements
         (agreement_id, delivery_id, fee_mode, payer, status, base_fee_vnd, base_policy_version_no, reason_code, reason_note, proposed_fee_vnd, final_fee_vnd,
          expires_at, version, created_by, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::bigint, $7::bigint, $8, $9, $10::bigint, $11::bigint, to_timestamp($12::double precision / 1000.0), 1, $13::uuid,
               date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', clock_timestamp()))
       ON CONFLICT (delivery_id) DO NOTHING`,
      [
        input.agreementId,
        input.deliveryId,
        input.feeMode,
        input.payer,
        input.status,
        input.baseFeeVnd,
        input.basePolicyVersionNo,
        input.reasonCode,
        input.reasonNote,
        input.proposedFeeVnd,
        input.finalFeeVnd,
        input.expiresAtMs,
        input.createdBy,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async find(context: TransactionContext, agreementId: string): Promise<Agreement | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.shipping_fee_agreements WHERE agreement_id = $1::uuid`, [agreementId]);
    return result.rows[0] === undefined ? undefined : toAgreement(result.rows[0]);
  }

  async findByDelivery(context: TransactionContext, deliveryId: string): Promise<Agreement | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.shipping_fee_agreements WHERE delivery_id = $1::uuid`, [deliveryId]);
    return result.rows[0] === undefined ? undefined : toAgreement(result.rows[0]);
  }

  /** The row FOR UPDATE: every change of one agreement is serialized here, so two simultaneous answers cannot both win. */
  async lock(context: TransactionContext, agreementId: string): Promise<Agreement | undefined> {
    const result = await context.query<Raw>(`SELECT ${COLUMNS} FROM app.shipping_fee_agreements WHERE agreement_id = $1::uuid FOR UPDATE`, [agreementId]);
    return result.rows[0] === undefined ? undefined : toAgreement(result.rows[0]);
  }

  /** Applies a patch and advances the version by one. The row must be locked by the caller. */
  async update(context: TransactionContext, agreementId: string, patch: AgreementPatch): Promise<Agreement> {
    const has = (key: keyof AgreementPatch): boolean => Object.hasOwn(patch, key);
    const result = await context.query<Raw>(
      `UPDATE app.shipping_fee_agreements SET
          status = CASE WHEN $2::boolean THEN $3 ELSE status END,
          counter_fee_vnd = CASE WHEN $4::boolean THEN $5::bigint ELSE counter_fee_vnd END,
          counter_by = CASE WHEN $6::boolean THEN $7::uuid ELSE counter_by END,
          bound_driver_id = CASE WHEN $8::boolean THEN $9::uuid ELSE bound_driver_id END,
          pending_fee_vnd = CASE WHEN $10::boolean THEN $11::bigint ELSE pending_fee_vnd END,
          pending_source = CASE WHEN $12::boolean THEN $13 ELSE pending_source END,
          final_fee_vnd = CASE WHEN $14::boolean THEN $15::bigint ELSE final_fee_vnd END,
          expires_at = CASE WHEN $16::boolean THEN to_timestamp($17::double precision / 1000.0) ELSE expires_at END,
          locked_at = CASE WHEN $18::boolean THEN to_timestamp($19::double precision / 1000.0) ELSE locked_at END,
          answer_expires_at = CASE WHEN $20::boolean THEN to_timestamp($21::double precision / 1000.0) ELSE answer_expires_at END,
          version = version + 1, updated_at = date_trunc('milliseconds', clock_timestamp())
        WHERE agreement_id = $1::uuid
        RETURNING ${COLUMNS}`,
      [
        agreementId,
        has('status'), patch.status ?? null,
        has('counterFeeVnd'), patch.counterFeeVnd ?? null,
        has('counterBy'), patch.counterBy ?? null,
        has('boundDriverId'), patch.boundDriverId ?? null,
        has('pendingFeeVnd'), patch.pendingFeeVnd ?? null,
        has('pendingSource'), patch.pendingSource ?? null,
        has('finalFeeVnd'), patch.finalFeeVnd ?? null,
        has('expiresAtMs'), patch.expiresAtMs ?? null,
        has('lockedAtMs'), patch.lockedAtMs ?? null,
        has('answerExpiresAtMs'), patch.answerExpiresAtMs ?? null,
      ],
    );
    if (result.rows[0] === undefined) {
      throw new TechnicalError('internal', 'Shipping fee agreement vanished while locked');
    }
    return toAgreement(result.rows[0]);
  }

  async appendEvent(
    context: TransactionContext,
    input: { eventId: string; agreementId: string; eventType: EventType; actorType: ActorType; actorId: string | null; driverId: string | null; amountVnd: number | null; reason: string | null; requestId: string | null; agreementVersion: number;
      /** 'CUSTOMER' when `actorId` confirmed for the payer, who has no app: the actor stays the person who acted. */
      onBehalfOf: 'CUSTOMER' | null;
      /** Who pays the delivery fee (the agreement's payer), stored on every event. */
      feePayer: 'CUSTOMER' | 'SHOP' },
  ): Promise<void> {
    await context.query(
      `INSERT INTO app.shipping_fee_agreement_events
         (event_id, agreement_id, seq, event_type, actor_type, actor_id, driver_id, amount_vnd, reason, request_id, agreement_version, on_behalf_of, fee_payer, created_at)
       VALUES ($1::uuid, $2::uuid, (SELECT COALESCE(MAX(seq), 0) + 1 FROM app.shipping_fee_agreement_events WHERE agreement_id = $2::uuid), $3, $4, $5::uuid, $6::uuid,
               $7::bigint, $8, $9::uuid, $10::bigint, $11, $12, date_trunc('milliseconds', clock_timestamp()))`,
      [input.eventId, input.agreementId, input.eventType, input.actorType, input.actorId, input.driverId, input.amountVnd, input.reason, input.requestId, input.agreementVersion, input.onBehalfOf, input.feePayer],
    );
  }

  async eventByRequest(context: TransactionContext, agreementId: string, requestId: string): Promise<AgreementEvent | undefined> {
    const result = await context.query<RawEvent>(`${EVENT_SELECT} WHERE agreement_id = $1::uuid AND request_id = $2::uuid`, [agreementId, requestId]);
    return result.rows[0] === undefined ? undefined : toEvent(result.rows[0]);
  }

  async events(context: TransactionContext, agreementId: string): Promise<AgreementEvent[]> {
    const result = await context.query<RawEvent>(`${EVENT_SELECT} WHERE agreement_id = $1::uuid ORDER BY seq`, [agreementId]);
    return result.rows.map(toEvent);
  }

  /** The Shipper the latest answer to a counter-offer was about (accepted or refused), so they can be told even when the agreement no longer binds them. */
  async lastAnsweredDriver(context: TransactionContext, agreementId: string): Promise<string | undefined> {
    const result = await context.query<{ driver_id: string }>(
      `SELECT driver_id::text AS driver_id FROM app.shipping_fee_agreement_events
        WHERE agreement_id = $1::uuid AND event_type IN ('COUNTER_ACCEPTED', 'COUNTER_REJECTED', 'COUNTER_EXPIRED', 'CUSTOMER_CONFIRMED', 'CUSTOMER_DECLINED') AND driver_id IS NOT NULL
        ORDER BY agreement_version DESC, seq DESC LIMIT 1`,
      [agreementId],
    );
    return result.rows[0]?.driver_id;
  }

  /** True when the newest event of the agreement is the drop of an offer whose answer time ran out (so an answer to that offer arrives too late). */
  async lastEventIsExpiry(context: TransactionContext, agreementId: string): Promise<boolean> {
    const result = await context.query<{ event_type: string }>(
      `SELECT event_type FROM app.shipping_fee_agreement_events WHERE agreement_id = $1::uuid ORDER BY seq DESC LIMIT 1`,
      [agreementId],
    );
    return result.rows[0]?.event_type === 'COUNTER_EXPIRED';
  }

  /** Open agreements whose payer's time to answer a counter-offer has run out, oldest first (a sweeper's list; each is re-read under its locks before it is applied). */
  async answerDue(context: TransactionContext, nowMs: number, limit: number): Promise<{ agreementId: string; deliveryId: string; boundDriverId: string | null; counterBy: string | null }[]> {
    const result = await context.query<{ agreement_id: string; delivery_id: string; bound: string | null; counter_by: string | null }>(
      `SELECT agreement_id::text AS agreement_id, delivery_id::text AS delivery_id, bound_driver_id::text AS bound, counter_by::text AS counter_by
         FROM app.shipping_fee_agreements
        WHERE answer_expires_at IS NOT NULL AND answer_expires_at <= to_timestamp($1::double precision / 1000.0)
          AND (status = 'COUNTERED' OR (status = 'AWAITING_CUSTOMER' AND pending_source = 'COUNTER'))
        ORDER BY answer_expires_at, agreement_id LIMIT $2::int`,
      [nowMs, limit],
    );
    return result.rows.map((row) => ({ agreementId: row.agreement_id, deliveryId: row.delivery_id, boundDriverId: row.bound, counterBy: row.counter_by }));
  }

  /** Counter-offers the shop rejected, as `${driverId}:${amount}` keys. */
  async rejectedCounters(context: TransactionContext, agreementId: string): Promise<Set<string>> {
    const result = await context.query<{ driver_id: string; amount: string }>(
      `SELECT driver_id::text AS driver_id, amount_vnd::text AS amount FROM app.shipping_fee_agreement_events
        WHERE agreement_id = $1::uuid AND event_type = 'COUNTER_REJECTED' AND driver_id IS NOT NULL AND amount_vnd IS NOT NULL`,
      [agreementId],
    );
    return new Set(result.rows.map((row) => rejectedKey(row.driver_id, toSafeInteger(row.amount))));
  }
}

interface RawEvent {
  seq: number;
  event_type: EventType;
  actor_type: ActorType;
  actor_id: string | null;
  driver_id: string | null;
  amount_vnd: string | null;
  reason: string | null;
  request_id: string | null;
  agreement_version: string;
  on_behalf_of: 'CUSTOMER' | null;
  fee_payer: 'CUSTOMER' | 'SHOP' | null;
  created_ms: string;
}

const EVENT_SELECT = `SELECT seq, event_type, actor_type, actor_id::text AS actor_id, driver_id::text AS driver_id, amount_vnd::text AS amount_vnd, reason,
  request_id::text AS request_id, agreement_version::text AS agreement_version, on_behalf_of, fee_payer, ${ms('created_at', 'created_ms')} FROM app.shipping_fee_agreement_events`;

const toEvent = (row: RawEvent): AgreementEvent => ({
  seq: row.seq,
  eventType: row.event_type,
  actorType: row.actor_type,
  actorId: row.actor_id,
  driverId: row.driver_id,
  amountVnd: num(row.amount_vnd),
  reason: row.reason,
  requestId: row.request_id,
  agreementVersion: toSafeInteger(row.agreement_version),
  onBehalfOf: row.on_behalf_of,
  feePayer: row.fee_payer,
  createdAtMs: toSafeInteger(row.created_ms),
});
