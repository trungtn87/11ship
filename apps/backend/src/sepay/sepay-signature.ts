import { createHmac, timingSafeEqual } from 'node:crypto';

/** SePay's documented replay window: a signed timestamp more than five minutes away from this server's clock is refused. */
export const SEPAY_SIGNATURE_WINDOW_SECONDS = 300;

export type SepaySignatureVerdict = 'VALID' | 'MISSING_HEADERS' | 'BAD_SIGNATURE' | 'BAD_TIMESTAMP' | 'EXPIRED';

function singleHeader(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * HMAC-SHA256 over `{X-SePay-Timestamp}.{raw body}` (the bytes exactly as received, never a re-serialised object), compared in constant
 * time. The signature is checked BEFORE the timestamp window, so an unsigned or forged request learns nothing about the clock.
 * Header values are never returned or logged by this function.
 */
export function verifySepaySignature(input: {
  readonly secret: string;
  readonly timestampHeader: unknown;
  readonly signatureHeader: unknown;
  readonly rawBody: Buffer;
  readonly nowSeconds: number;
}): SepaySignatureVerdict {
  const timestamp = singleHeader(input.timestampHeader);
  const signature = singleHeader(input.signatureHeader);
  if (timestamp === undefined || signature === undefined) {
    return 'MISSING_HEADERS';
  }
  const claimed = /^sha256=([0-9a-fA-F]{64})$/.exec(signature);
  if (claimed === null) {
    return 'BAD_SIGNATURE';
  }
  if (!/^[0-9]{1,12}$/.test(timestamp)) {
    return 'BAD_TIMESTAMP';
  }
  const expected = createHmac('sha256', input.secret).update(`${timestamp}.`).update(input.rawBody).digest();
  const given = Buffer.from(claimed[1]!, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'BAD_SIGNATURE';
  }
  if (Math.abs(input.nowSeconds - Number(timestamp)) > SEPAY_SIGNATURE_WINDOW_SECONDS) {
    return 'EXPIRED';
  }
  return 'VALID';
}
