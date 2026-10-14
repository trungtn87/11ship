// Fixed vocabulary of the SMS gateway (issue #102). Nothing here is configuration.

export type SmsPurpose = 'REGISTER' | 'RESET_PASSWORD';

export type SmsJobStatus = 'QUEUED' | 'CLAIMED' | 'SENT' | 'FAILED' | 'UNKNOWN' | 'EXPIRED';

/** A queued OTP with less than this much life left is not worth sending: it expires instead of being handed out. */
export const SMS_MIN_REMAINING_SECONDS = 20;

/** Advisory-lock domain that serializes the global cap check + insert of the queue. */
export const SMS_ENQUEUE_LOCK_DOMAIN = '11ship.sms-gateway.enqueue.v1';

/** Result codes the gateway may report (stored as given, bounded by the schema CHECK). */
export const SMS_ACK_RESULTS = ['SENT', 'FAILED', 'UNKNOWN', 'DELIVERED'] as const;
export type SmsAckResult = (typeof SMS_ACK_RESULTS)[number];

export const SMS_ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,24}$/;
export const SMS_APP_VERSION_PATTERN = /^[0-9A-Za-z.+_-]{1,32}$/;
export const SMS_DEVICE_LABEL_PATTERN = /^[A-Za-z0-9 ._-]{1,64}$/;

/**
 * The ONLY texts the backend ever queues. The OTP is the single variable part; recipient and text can never come from a
 * request. The Android gateway validates the same shape before it calls SmsManager (defence in depth). ASCII only, so the
 * message stays one GSM-7 segment.
 */
export function renderOtpSms(purpose: SmsPurpose, otp: string, ttlSeconds: number): string {
  if (!/^[0-9]{6}$/.test(otp)) {
    throw new RangeError('OTP shape');
  }
  const minutes = Math.min(99, Math.max(1, Math.ceil(ttlSeconds / 60)));
  const what = purpose === 'REGISTER' ? 'xac thuc dang ky' : 'dat lai mat khau';
  return `11Ship: Ma ${what} cua ban la ${otp}. Hieu luc ${minutes} phut. Khong chia se ma nay.`;
}

/** Same pattern the Android gateway enforces. */
export const SMS_TEXT_PATTERN =
  /^11Ship: Ma (?:xac thuc dang ky|dat lai mat khau) cua ban la [0-9]{6}\. Hieu luc [0-9]{1,2} phut\. Khong chia se ma nay\.$/;
