/**
 * SePay automatic top-up configuration (M04 step 1, Issue #403). Read from the process environment on every request, so a rotated secret
 * or a switched flag takes effect without code. Fail closed: no secret means the webhook refuses every call (503), and the automatic
 * credit runs only when SEPAY_AUTO_TOPUP_ENABLED is exactly "true". Secrets are never logged or echoed.
 */
export const SEPAY_TRANSFER_PREFIX = 'NAP';
/** The one receiving bank of automatic top-ups (MB Bank main account). */
export const SEPAY_BANK_ID = 'MB';

export interface SepayConfig {
  /** Null when SEPAY_WEBHOOK_SECRET is empty: every webhook is refused. */
  readonly webhookSecret: string | null;
  /** Null when SEPAY_API_KEY is empty: the reconciliation job does not call SePay at all. */
  readonly apiKey: string | null;
  /** Automatic credit is OFF unless the variable is exactly "true". */
  readonly autoTopupEnabled: boolean;
  /**
   * The transfer prefix is fixed to NAP: the code of every request is derived with it (topupTransferCodeOf). A different value cannot match
   * any request, so it is refused as a configuration error rather than silently matching nothing.
   */
  readonly misconfiguration: string | null;
}

export function readSepayConfig(env: NodeJS.ProcessEnv): SepayConfig {
  const secret = (env.SEPAY_WEBHOOK_SECRET ?? '').trim();
  const apiKey = (env.SEPAY_API_KEY ?? '').trim();
  const prefix = (env.SEPAY_TRANSFER_PREFIX ?? SEPAY_TRANSFER_PREFIX).trim();
  return {
    webhookSecret: secret.length > 0 ? secret : null,
    apiKey: apiKey.length > 0 ? apiKey : null,
    autoTopupEnabled: env.SEPAY_AUTO_TOPUP_ENABLED === 'true',
    misconfiguration: prefix === SEPAY_TRANSFER_PREFIX ? null : 'SEPAY_TRANSFER_PREFIX must be NAP',
  };
}
