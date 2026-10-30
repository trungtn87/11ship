import { Injectable } from '@nestjs/common';
import { TransactionContext } from '../transaction/transaction-context';
import { AddressChangeStatus, AddressChangeTargetActor } from './address-change-constants';

export interface AddressChangeRequestRow {
  readonly changeRequestId: string;
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly source: 'ORDER' | 'CUSTOMER';
  readonly requestedBy: string;
  readonly status: AddressChangeStatus;
  readonly targetActor: AddressChangeTargetActor;
  readonly targetDriverId: string | null;
  readonly originalRecipientName: string;
  readonly originalRecipientPhone: string;
  readonly originalAddressText: string;
  readonly originalLat: number | null;
  readonly originalLng: number | null;
  readonly originalFeeVnd: number | null;
  readonly originalDistanceM: number | null;
  readonly newRecipientName: string;
  readonly newRecipientPhone: string;
  readonly newAddressText: string;
  readonly newLat: number | null;
  readonly newLng: number | null;
  readonly newFeeVnd: number | null;
  readonly newDistanceM: number | null;
  readonly feeDifferenceVnd: number | null;
  readonly note: string | null;
  readonly rejectReason: string | null;
  readonly resolvedBy: string | null;
  readonly resolvedAtMs: number | null;
  readonly expiresAtMs: number;
  readonly orderVersion: number | null;
  readonly deliveryVersion: number | null;
  readonly version: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type NewAddressChangeRequest = Omit<AddressChangeRequestRow, 'resolvedBy' | 'resolvedAtMs' | 'rejectReason' | 'version' | 'createdAtMs' | 'updatedAtMs'>;

interface RawAddressChangeRequest {
  readonly change_request_id: string;
  readonly order_id: string | null;
  readonly delivery_id: string | null;
  readonly source: 'ORDER' | 'CUSTOMER';
  readonly requested_by: string;
  readonly status: AddressChangeStatus;
  readonly target_actor: AddressChangeTargetActor;
  readonly target_driver_id: string | null;
  readonly original_recipient_name: string;
  readonly original_recipient_phone: string;
  readonly original_address_text: string;
  readonly original_lat: number | null;
  readonly original_lng: number | null;
  readonly original_fee_vnd: string | null;
  readonly original_distance_m: number | null;
  readonly new_recipient_name: string;
  readonly new_recipient_phone: string;
  readonly new_address_text: string;
  readonly new_lat: number | null;
  readonly new_lng: number | null;
  readonly new_fee_vnd: string | null;
  readonly new_distance_m: number | null;
  readonly fee_difference_vnd: string | null;
  readonly note: string | null;
  readonly reject_reason: string | null;
  readonly resolved_by: string | null;
  readonly resolved_at_ms: string | null;
  readonly expires_at_ms: string;
  readonly order_version: string | null;
  readonly delivery_version: string | null;
  readonly version: string;
  readonly created_at_ms: string;
  readonly updated_at_ms: string;
}

const SELECT_COLUMNS = `
  change_request_id, order_id, delivery_id, source, requested_by, status, target_actor, target_driver_id,
  original_recipient_name, original_recipient_phone, original_address_text, original_lat, original_lng,
  original_fee_vnd, original_distance_m,
  new_recipient_name, new_recipient_phone, new_address_text, new_lat, new_lng,
  new_fee_vnd, new_distance_m, fee_difference_vnd, note, reject_reason, resolved_by,
  floor(extract(epoch from resolved_at) * 1000)::text as resolved_at_ms,
  floor(extract(epoch from expires_at) * 1000)::text as expires_at_ms,
  order_version, delivery_version, version,
  floor(extract(epoch from created_at) * 1000)::text as created_at_ms,
  floor(extract(epoch from updated_at) * 1000)::text as updated_at_ms
`;

function mapRow(raw: RawAddressChangeRequest): AddressChangeRequestRow {
  return {
    changeRequestId: raw.change_request_id,
    orderId: raw.order_id,
    deliveryId: raw.delivery_id,
    source: raw.source,
    requestedBy: raw.requested_by,
    status: raw.status,
    targetActor: raw.target_actor,
    targetDriverId: raw.target_driver_id,
    originalRecipientName: raw.original_recipient_name,
    originalRecipientPhone: raw.original_recipient_phone,
    originalAddressText: raw.original_address_text,
    originalLat: raw.original_lat === null ? null : Number(raw.original_lat),
    originalLng: raw.original_lng === null ? null : Number(raw.original_lng),
    originalFeeVnd: raw.original_fee_vnd === null ? null : Number(raw.original_fee_vnd),
    originalDistanceM: raw.original_distance_m === null ? null : Number(raw.original_distance_m),
    newRecipientName: raw.new_recipient_name,
    newRecipientPhone: raw.new_recipient_phone,
    newAddressText: raw.new_address_text,
    newLat: raw.new_lat === null ? null : Number(raw.new_lat),
    newLng: raw.new_lng === null ? null : Number(raw.new_lng),
    newFeeVnd: raw.new_fee_vnd === null ? null : Number(raw.new_fee_vnd),
    newDistanceM: raw.new_distance_m === null ? null : Number(raw.new_distance_m),
    feeDifferenceVnd: raw.fee_difference_vnd === null ? null : Number(raw.fee_difference_vnd),
    note: raw.note,
    rejectReason: raw.reject_reason,
    resolvedBy: raw.resolved_by,
    resolvedAtMs: raw.resolved_at_ms === null ? null : Number(raw.resolved_at_ms),
    expiresAtMs: Number(raw.expires_at_ms),
    orderVersion: raw.order_version === null ? null : Number(raw.order_version),
    deliveryVersion: raw.delivery_version === null ? null : Number(raw.delivery_version),
    version: Number(raw.version),
    createdAtMs: Number(raw.created_at_ms),
    updatedAtMs: Number(raw.updated_at_ms),
  };
}

@Injectable()
export class AddressChangeRepository {
  async insert(context: TransactionContext, req: NewAddressChangeRequest): Promise<void> {
    await context.query(
      `INSERT INTO app.address_change_requests (
        change_request_id, order_id, delivery_id, source, requested_by, status, target_actor, target_driver_id,
        original_recipient_name, original_recipient_phone, original_address_text, original_lat, original_lng,
        original_fee_vnd, original_distance_m,
        new_recipient_name, new_recipient_phone, new_address_text, new_lat, new_lng,
        new_fee_vnd, new_distance_m, fee_difference_vnd, note,
        expires_at, order_version, delivery_version, version, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24,
        to_timestamp($25::bigint / 1000.0), $26, $27, 1, clock_timestamp(), clock_timestamp()
      )`,
      [
        req.changeRequestId,
        req.orderId,
        req.deliveryId,
        req.source,
        req.requestedBy,
        req.status,
        req.targetActor,
        req.targetDriverId,
        req.originalRecipientName,
        req.originalRecipientPhone,
        req.originalAddressText,
        req.originalLat,
        req.originalLng,
        req.originalFeeVnd,
        req.originalDistanceM,
        req.newRecipientName,
        req.newRecipientPhone,
        req.newAddressText,
        req.newLat,
        req.newLng,
        req.newFeeVnd,
        req.newDistanceM,
        req.feeDifferenceVnd,
        req.note,
        req.expiresAtMs,
        req.orderVersion,
        req.deliveryVersion,
      ],
    );
  }

  async findActiveByOrderId(context: TransactionContext, orderId: string): Promise<AddressChangeRequestRow | undefined> {
    const result = await context.query<RawAddressChangeRequest>(
      `SELECT ${SELECT_COLUMNS} FROM app.address_change_requests WHERE order_id = $1::uuid AND status = 'PENDING'`,
      [orderId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async findActiveByDeliveryId(context: TransactionContext, deliveryId: string): Promise<AddressChangeRequestRow | undefined> {
    const result = await context.query<RawAddressChangeRequest>(
      `SELECT ${SELECT_COLUMNS} FROM app.address_change_requests WHERE delivery_id = $1::uuid AND status = 'PENDING'`,
      [deliveryId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async findById(context: TransactionContext, changeRequestId: string): Promise<AddressChangeRequestRow | undefined> {
    const result = await context.query<RawAddressChangeRequest>(
      `SELECT ${SELECT_COLUMNS} FROM app.address_change_requests WHERE change_request_id = $1::uuid`,
      [changeRequestId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async listByOrderId(context: TransactionContext, orderId: string, limit = 5): Promise<AddressChangeRequestRow[]> {
    const result = await context.query<RawAddressChangeRequest>(
      `SELECT ${SELECT_COLUMNS} FROM app.address_change_requests WHERE order_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
      [orderId, limit],
    );
    return result.rows.map(mapRow);
  }

  async listByDeliveryId(context: TransactionContext, deliveryId: string, limit = 5): Promise<AddressChangeRequestRow[]> {
    const result = await context.query<RawAddressChangeRequest>(
      `SELECT ${SELECT_COLUMNS} FROM app.address_change_requests WHERE delivery_id = $1::uuid ORDER BY created_at DESC LIMIT $2`,
      [deliveryId, limit],
    );
    return result.rows.map(mapRow);
  }

  async resolve(
    context: TransactionContext,
    changeRequestId: string,
    status: AddressChangeStatus,
    resolvedBy: string | null,
    rejectReason: string | null,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await context.query(
      `UPDATE app.address_change_requests
       SET status = $2, resolved_by = $3::uuid, reject_reason = $4, resolved_at = clock_timestamp(),
           version = version + 1, updated_at = clock_timestamp()
       WHERE change_request_id = $1::uuid AND version = $5 AND status = 'PENDING'`,
      [changeRequestId, status, resolvedBy, rejectReason, expectedVersion],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async expirePendingForDelivery(
    context: TransactionContext,
    deliveryId: string,
    orderId: string | null,
    reason = 'Hàng đã được lấy',
  ): Promise<number> {
    const result = await context.query(
      `UPDATE app.address_change_requests
       SET status = 'EXPIRED',
           reject_reason = $1,
           resolved_at = clock_timestamp(),
           version = version + 1,
           updated_at = clock_timestamp()
       WHERE (delivery_id = $2::uuid OR ($3::uuid IS NOT NULL AND order_id = $3::uuid))
         AND status = 'PENDING'`,
      [reason, deliveryId, orderId],
    );
    return result.rowCount ?? 0;
  }
}
