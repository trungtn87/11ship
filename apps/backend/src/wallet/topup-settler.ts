/**
 * Who settled a top-up request: a human Administrator (manual confirmation or rejection) or the automatic bank-evidence path (SePay webhook,
 * M04 step 1). Exactly one of them is written to the database on every ended request and every topup (CHECK constraints from the
 * 1798070400000 migration). The automatic path never borrows an Administrator's user id.
 */
export type TopupSettler = { readonly kind: 'ADMIN'; readonly userId: string } | { readonly kind: 'SEPAY_WEBHOOK' };

export const SEPAY_WEBHOOK_SETTLER_TOKEN = 'SEPAY_WEBHOOK';

/** The two stored columns for a settler: exactly one is non-null. */
export function settlerColumns(settler: TopupSettler): { readonly userId: string | null; readonly system: string | null } {
  return settler.kind === 'ADMIN' ? { userId: settler.userId, system: null } : { userId: null, system: SEPAY_WEBHOOK_SETTLER_TOKEN };
}
