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
  // The code must open the transfer content: only the leading whitespace of the bank text is ignored, nothing else is read out of it.
  if (!event.content.trimStart().startsWith(event.code)) {
    return { kind: 'NEEDS_ADMIN', reason: 'CODE_NOT_AT_START' };
  }
  if (event.referenceCode === '') {
    return { kind: 'NEEDS_ADMIN', reason: 'NO_REFERENCE' };
  }
  if (!REFERENCE_PATTERN.test(event.referenceCode)) {
    return { kind: 'NEEDS_ADMIN', reason: 'REFERENCE_FORMAT' };
  }
  // Bank identity, the key the bank-record table enforces (bank, account, canonical id). The account is its own column, so the canonical id
  // carries the bank reference, the amount and the transaction time exactly as SePay sent them.
  return {
    kind: 'CANDIDATE',
    transferCode: event.code,
    canonicalTransactionId: `SEPAY:${event.referenceCode}:${event.transferAmountVnd}:${event.transactionDateText}`,
  };
}
