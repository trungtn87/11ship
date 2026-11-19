/**
 * A SePay transaction webhook, validated field by field (docs: developer.sepay.vn tich-hop-webhook, 19/11/2026). Only the fields the
 * decision and the evidence need are kept; the description and the running balance are not stored (data minimisation).
 */
export interface SepayTransferEvent {
  /** SePay's integer event id: identical across retries and replays, so it is the webhook dedupe key. */
  readonly webhookEventId: number;
  readonly gateway: string;
  /** SePay sends Vietnam time without a zone; it is stored as a timestamp with +07:00. */
  readonly transactionAtIso: string;
  /** The text as SePay sent it; part of the bank identity so two transfers at the same second stay distinct. */
  readonly transactionDateText: string;
  readonly accountNumber: string;
  /** Null when SePay extracted no code. Null and empty are different facts; both mean "no code" to the decision. */
  readonly code: string | null;
  readonly content: string;
  readonly transferType: 'in' | 'out';
  readonly transferAmountVnd: number;
  readonly referenceCode: string;
}

const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})$/;

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** Returns the event, or undefined when any field is missing or has the wrong type or shape. Never throws. */
export function parseSepayEvent(body: unknown): SepayTransferEvent | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const raw = body as Record<string, unknown>;
  const id = raw.id;
  const amount = raw.transferAmount;
  const date = raw.transactionDate;
  const code = raw.code;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return undefined;
  if (!isText(raw.gateway, 1, 64) || !isText(raw.accountNumber, 1, 40) || !isText(raw.content, 0, 2000)) return undefined;
  if (!isText(raw.referenceCode, 0, 128)) return undefined;
  if (code !== null && !isText(code, 0, 64)) return undefined;
  if (raw.transferType !== 'in' && raw.transferType !== 'out') return undefined;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) return undefined;
  if (!isText(date, 19, 19)) return undefined;
  const parts = DATE_PATTERN.exec(date);
  if (parts === null) return undefined;
  const transactionAtIso = `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:${parts[6]}+07:00`;
  if (Number.isNaN(Date.parse(transactionAtIso))) return undefined;
  return {
    webhookEventId: id,
    gateway: raw.gateway as string,
    transactionAtIso,
    transactionDateText: date,
    accountNumber: raw.accountNumber as string,
    code,
    content: raw.content as string,
    transferType: raw.transferType,
    transferAmountVnd: amount,
    referenceCode: raw.referenceCode as string,
  };
}
