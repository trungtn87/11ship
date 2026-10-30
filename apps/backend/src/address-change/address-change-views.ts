import { JsonObject } from '../idempotency/idempotency-executor';
import { AddressChangeRequestRow } from './address-change-repository';

export function addressChangeView(req: AddressChangeRequestRow | undefined, nowMs: number): JsonObject | null {
  if (req === undefined) {
    return null;
  }
  const isExpired = req.status === 'PENDING' && nowMs >= req.expiresAtMs;
  const effectiveStatus = isExpired ? 'EXPIRED' : req.status;
  const timeRemainingSeconds = req.status === 'PENDING' && !isExpired ? Math.max(0, Math.floor((req.expiresAtMs - nowMs) / 1000)) : 0;

  return {
    change_request_id: req.changeRequestId,
    status: effectiveStatus,
    is_expired: isExpired,
    time_remaining_seconds: timeRemainingSeconds,
    source: req.source,
    target_actor: req.targetActor,
    target_driver_id: req.targetDriverId,
    original_recipient: {
      name: req.originalRecipientName,
      phone: req.originalRecipientPhone,
      address_text: req.originalAddressText,
      lat: req.originalLat,
      lng: req.originalLng,
    },
    new_recipient: {
      name: req.newRecipientName,
      phone: req.newRecipientPhone,
      address_text: req.newAddressText,
      lat: req.newLat,
      lng: req.newLng,
    },
    original_fee_vnd: req.originalFeeVnd,
    new_fee_vnd: req.newFeeVnd,
    fee_difference_vnd: req.feeDifferenceVnd,
    note: req.note,
    reject_reason: req.rejectReason,
    version: req.version,
    expires_at: new Date(req.expiresAtMs).toISOString(),
    created_at: new Date(req.createdAtMs).toISOString(),
    resolved_at: req.resolvedAtMs ? new Date(req.resolvedAtMs).toISOString() : null,
  };
}
