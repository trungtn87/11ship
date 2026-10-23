import { randomInt } from 'node:crypto';
import {
  AREA_TEXT_MAX,
  BEFORE_PICKUP_STATES,
  DeliveryState,
  LOCATION_LIVE_SECONDS,
  LOCATION_MAX_ACCURACY_M,
  LOCATION_STALE_SECONDS,
  PICKUP_REMINDER_MS,
  REMINDER_MINUTES,
  RUNNING_STATES,
  SEARCH_MS,
} from './delivery-constants';

// M07 pure rules: no I/O and no clock of their own (the caller passes the database time). Everything the apps show as a timer, a reminder or
// a permission comes from here, so it is the same on every path and testable without a database.

export type Freshness = 'LIVE' | 'STALE' | 'LOST';

/** How old a position is. A position M14 calls invalid is LOST whatever its age: it is never drawn as live. */
export function freshnessOf(ageSeconds: number, valid: boolean): Freshness {
  if (!valid || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return 'LOST';
  }
  if (ageSeconds <= LOCATION_LIVE_SECONDS) {
    return 'LIVE';
  }
  return ageSeconds <= LOCATION_STALE_SECONDS ? 'STALE' : 'LOST';
}

/** M14's verdict on a stored position: coordinates in range and an accuracy no worse than the limit when one was given. */
export function locationValid(lat: number, lng: number, accuracyM: number | null): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (accuracyM === null || (accuracyM >= 0 && accuracyM <= LOCATION_MAX_ACCURACY_M));
}

/** The shop may cancel the request until the goods are picked up (including a stopped search, to close it); never after. */
export function shopMayCancel(state: DeliveryState): boolean {
  return BEFORE_PICKUP_STATES.includes(state) || state === 'search_stopped';
}

/** The Shipper may give up the delivery only while it is accepted and not yet picked up. */
export function shipperMayRelease(state: DeliveryState): boolean {
  return state === 'accepted' || state === 'location_confirmed';
}

/** Where a delivery goes when its Shipper gives it up: back to the search while the original deadline allows, otherwise the search stops. The deadline never moves. */
export function stateAfterRelease(nowMs: number, searchExpiresAtMs: number): 'waiting_driver' | 'search_stopped' {
  return nowMs < searchExpiresAtMs ? 'waiting_driver' : 'search_stopped';
}

export function searchExpired(nowMs: number, searchExpiresAtMs: number): boolean {
  return nowMs >= searchExpiresAtMs;
}

/** Reminders (minutes of the search) that are due at `nowMs` and have not been sent. Both are returned when the sweeper was down past both marks. */
export function dueSearchReminders(nowMs: number, searchStartedAtMs: number, sent: { readonly m5: boolean; readonly m15: boolean }, searchExpiresAtMs = searchStartedAtMs + SEARCH_MS): readonly number[] {
  const elapsed = nowMs - searchStartedAtMs;
  return REMINDER_MINUTES.filter((minute) => elapsed >= minute * 60_000 && nowMs < searchExpiresAtMs && !(minute === 5 ? sent.m5 : sent.m15));
}

/** Whether a Shipper who accepted and has not picked up is due another "pick up the goods" reminder (every 5 minutes since the last one, or the accept). */
export function pickupReminderDue(nowMs: number, acceptedAtMs: number, lastReminderAtMs: number | null): boolean {
  return nowMs - (lastReminderAtMs ?? acceptedAtMs) >= PICKUP_REMINDER_MS;
}

/** A new delivery for the same goods may be requested only from a stopped, cancelled or failed one, and for a failed one only when the goods are back at the shop or handled. */
export function mayRecall(state: DeliveryState, incidentOpen: boolean): boolean {
  if (state === 'search_stopped' || state === 'cancelled_by_merchant') {
    return true;
  }
  return state === 'failed' && !incidentOpen;
}

/** What a Shipper may see of the drop-off BEFORE accepting: the coarse area, never the first (street) line. Null when there is nothing coarse to show. */
export function dropoffAreaOf(addressText: string): string | null {
  const parts = addressText
    .split(',')
    .map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part !== '');
  if (parts.length < 2) {
    return null;
  }
  const area = parts
    .slice(1)
    // A segment with a long digit run could be a phone number or a house/flat number string: it is dropped from the coarse area.
    .filter((part) => !/\d{4,}/u.test(part))
    .join(', ');
  if (area === '') {
    return null;
  }
  return [...area].slice(0, AREA_TEXT_MAX).join('');
}

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** `G-` and six characters of an alphabet without look-alikes (0/O, 1/I). Uniqueness is the database's: the caller retries on a collision. */
export function newDeliveryCode(): string {
  let code = 'G-';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
  }
  return code;
}

/**
 * The original ETA of a delivery for the batching protection: the moment the hand-over is expected, from the Shipper's position to the shop, the
 * shop to the drop-off and the service times. Null when any leg is unknown (the delivery is then not protected and cannot be batched into: M06
 * answers BATCH_ORDER_DATA_MISSING). Stored once; never recomputed.
 */
export function originalEtaMs(nowMs: number, secondsToShop: number | null, secondsShopToDropoff: number | null, pickupServiceSeconds: number, handoffServiceSeconds: number): number | null {
  if (secondsToShop === null || secondsShopToDropoff === null) {
    return null;
  }
  return nowMs + Math.round((secondsToShop + pickupServiceSeconds + secondsShopToDropoff + handoffServiceSeconds) * 1000);
}

export function isRunning(state: DeliveryState): boolean {
  return RUNNING_STATES.includes(state);
}

/** The fee as the apps show it: FINAL (a number), PENDING_AGREEMENT / AWAITING_CUSTOMER (an agreement is open), or UNKNOWN (null, never 0). */
export function feeStatusOf(input: { readonly feeVnd: number | null; readonly agreementStatus: string | null }): 'FINAL' | 'PENDING_AGREEMENT' | 'AWAITING_CUSTOMER' | 'UNKNOWN' {
  if (input.feeVnd !== null) {
    return 'FINAL';
  }
  switch (input.agreementStatus) {
    case 'PROPOSED':
    case 'COUNTERED':
      return 'PENDING_AGREEMENT';
    case 'AWAITING_CUSTOMER':
      return 'AWAITING_CUSTOMER';
    default:
      return 'UNKNOWN';
  }
}
