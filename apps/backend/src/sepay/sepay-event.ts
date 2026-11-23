/**
 * A verified SePay transfer, from either source (docs: developer.sepay.vn tich-hop-webhook and sepay-api/v2/giao-dich/danh-sach, 19-20/11/2026).
 * The webhook path sets webhookEventId; the reconciliation path sets sepayTransactionUuid. The two identifiers are different and are never
 * compared with each other: the bank identity (account, reference, amount, time) is what makes one transfer one transfer.
 * Only the fields the decision and the evidence need are kept; the description and the running balance are not stored (data minimisation).
 */
export interface SepayTransferEvent {
  /** SePay's integer webhook id (identical across retries and replays). Null for an event that came from the transactions API. */
  readonly webhookEventId: number | null;
  /** SePay's transaction UUID from the transactions API. Null for a webhook event. */
  readonly sepayTransactionUuid: string | null;
  readonly gateway: string;
  /** SePay sends Vietnam time without a zone; it is stored as a timestamp with +07:00. */
  readonly transactionAtIso: string;
  /** The text as SePay sent it ("YYYY-MM-DD HH:mm:ss"); part of the bank identity so two transfers at the same second stay distinct. */
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
const ISO_VN_PATTERN = /^([0-9]{4}-[0-9]{2}-[0-9]{2})[T ]([0-9]{2}:[0-9]{2}:[0-9]{2})\+07:00$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

function instantOf(iso: string): boolean {
  return !Number.isNaN(Date.parse(iso));
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
  if (!instantOf(transactionAtIso)) return undefined;
  return {
    webhookEventId: id,
    sepayTransactionUuid: null,
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

/**
 * One item of GET /v2/transactions (requested with timestamp_format=iso8601, so the time carries +07:00). Returns the same event shape as
 * the webhook, with the bank identity built from the same text, so a transfer seen by both paths has the same key. Undefined when anything
 * is not exactly as documented: the caller then stops the run instead of guessing.
 */
export function parseSepayApiTransaction(item: unknown): SepayTransferEvent | undefined {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return undefined;
  }
  const raw = item as Record<string, unknown>;
  const uuid = raw.id;
  const amount = raw.amount_in;
  const when = raw.transaction_date;
  const code = raw.code;
  const reference = raw.reference_number;
  if (typeof uuid !== 'string' || !UUID_PATTERN.test(uuid)) return undefined;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1) return undefined;
  if (!isText(when, 25, 25)) return undefined;
  const parts = ISO_VN_PATTERN.exec(when);
  if (parts === null) return undefined;
  if (!isText(raw.account_number, 1, 40) || !isText(raw.transaction_content, 0, 2000) || !isText(raw.bank_brand_name, 1, 64)) return undefined;
  if (raw.transfer_type !== 'in') return undefined;
  if (code !== null && code !== undefined && !isText(code, 0, 64)) return undefined;
  if (reference !== null && reference !== undefined && !isText(reference, 0, 128)) return undefined;
  const dateText = `${parts[1]} ${parts[2]}`;
  const transactionAtIso = `${parts[1]}T${parts[2]}+07:00`;
  if (!instantOf(transactionAtIso)) return undefined;
  return {
    webhookEventId: null,
    sepayTransactionUuid: uuid.toLowerCase(),
    gateway: raw.bank_brand_name as string,
    transactionAtIso,
    transactionDateText: dateText,
    accountNumber: raw.account_number as string,
    code: typeof code === 'string' ? code : null,
    content: raw.transaction_content as string,
    transferType: 'in',
    transferAmountVnd: amount,
    referenceCode: typeof reference === 'string' ? reference : '',
  };
}
