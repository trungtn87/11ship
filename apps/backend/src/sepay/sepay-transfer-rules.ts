import { SEPAY_TRANSFER_PREFIX } from './sepay-config';
import { SepayTransferEvent } from './sepay-event';

/**
 * The pure part of the matching rule (M04 step 1). A verified webhook is either ignored (money going out), held for an Administrator
 * (anything not exactly right), or a candidate for automatic credit. The database checks that come after (account, request, driver,
 * amount, duplicate) are in SepayWebhookService; this function never reads or writes anything.
 */
export type TransferDecision =
  | { readonly kind: 'IGNORED'; readonly reason: 'OUTBOUND_TRANSFER' }
  | { readonly kind: 'NEEDS_ADMIN'; readonly reason: string }
  | { readonly kind: 'CANDIDATE'; readonly transferCode: string; readonly canonicalTransactionId: string };

/** The exact shape topupTransferCodeOf produces: NAP + 10 upper-case hex digits. */
export const TRANSFER_CODE_PATTERN = new RegExp(`^${SEPAY_TRANSFER_PREFIX}[0-9A-F]{10}$`);
/** MB (and some other banks) put "<BANK> <receiving account> " in front of the customer's text; only that exact shape may precede the code. */
const BANK_CONTENT_PREFIX = /^\s*(?:[A-Za-z]{2,16} [0-9]{6,20} )?/;
const REFERENCE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function decideTransfer(event: SepayTransferEvent): TransferDecision {
  if (event.transferType === 'out') {
    return { kind: 'IGNORED', reason: 'OUTBOUND_TRANSFER' };
  }
  if (event.code === null || event.code === '') {
    return { kind: 'NEEDS_ADMIN', reason: 'NO_CODE' };
  }
  if (!TRANSFER_CODE_PATTERN.test(event.code)) {
    return { kind: 'NEEDS_ADMIN', reason: 'CODE_FORMAT' };
  }
  // The code must open the transfer content: only leading whitespace and the bank's own "<BANK> <account> " prefix are skipped, nothing else is read out of it.
  if (!event.content.slice(BANK_CONTENT_PREFIX.exec(event.content)![0].length).startsWith(event.code)) {
    return { kind: 'NEEDS_ADMIN', reason: 'CODE_NOT_AT_START' };
  }
  if (event.referenceCode === '') {
    return { kind: 'NEEDS_ADMIN', reason: 'NO_REFERENCE' };
  }
  if (!REFERENCE_PATTERN.test(event.referenceCode)) {
    return { kind: 'NEEDS_ADMIN', reason: 'REFERENCE_FORMAT' };
  }
  // ONE bank identity for the whole company: the bank's own reference (e.g. FT24012345678). The bank-record table enforces it per
  // (bank, receiving account, canonical id), and an Administrator who confirms the same statement line by hand types the same reference. So
  // a transfer is credited at most once, whichever side records it first, and the second attempt meets the unique key.
  return {
    kind: 'CANDIDATE',
    transferCode: event.code,
    canonicalTransactionId: event.referenceCode,
  };
}
