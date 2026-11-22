/**
 * SePay automatic top-up configuration (M04 step 1 and 2, Issue #403). Read from the process environment on every request, so a rotated secret
 * or a switched flag takes effect without code. Secrets are never logged or echoed.
 *
 * Fail closed (Owner contract, handoff "Configuration"): automatic credit is possible ONLY when the switch is exactly "true" AND the webhook
 * secret AND the API key are both set. Missing one of them never credits anything, from the webhook or from the reconciliation job. A verified
 * webhook is still stored as evidence in that case (the same as with the switch off), so nothing is lost and recovery can settle it later.
 */
export const SEPAY_TRANSFER_PREFIX = 'NAP';
/** The one receiving bank of automatic top-ups (MB Bank main account). */
export const SEPAY_BANK_ID = 'MB';

export interface SepayConfig {
  /** Null when SEPAY_WEBHOOK_SECRET is empty: every webhook is refused (503), because a signature cannot be checked. */
  readonly webhookSecret: string | null;
  /** Null when SEPAY_API_KEY is empty: the reconciliation job does not call SePay at all. */
  readonly apiKey: string | null;
  /** Automatic credit is OFF unless the variable is exactly "true". */
  readonly autoTopupEnabled: boolean;
  /** True only when the switch is on AND both credentials are present. The only gate of an automatic credit. */
  readonly autoCreditReady: boolean;
  /** The reason a held verified transfer is kept as evidence instead of credited (stored in the inbox; a fixed code). */
  readonly holdReason: 'AUTO_TOPUP_DISABLED' | 'AUTO_TOPUP_NOT_CONFIGURED';
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
  const autoTopupEnabled = env.SEPAY_AUTO_TOPUP_ENABLED === 'true';
  const autoCreditReady = autoTopupEnabled && secret.length > 0 && apiKey.length > 0;
  return {
    webhookSecret: secret.length > 0 ? secret : null,
    apiKey: apiKey.length > 0 ? apiKey : null,
    autoTopupEnabled,
    autoCreditReady,
    holdReason: autoTopupEnabled ? 'AUTO_TOPUP_NOT_CONFIGURED' : 'AUTO_TOPUP_DISABLED',
    misconfiguration: prefix === SEPAY_TRANSFER_PREFIX ? null : 'SEPAY_TRANSFER_PREFIX must be NAP',
  };
}
