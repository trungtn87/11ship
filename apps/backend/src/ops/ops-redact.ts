// Redaction of everything M13 stores, logs or sends (design sections 2, 8, 11): no OTP, password, token, webhook or secret key ever reaches the
// operations log, an incident, an audit entry or a Discord message, and a phone number is masked. The functions are total (never throw), bounded, and
// applied by the repository BEFORE the INSERT, so a producer that forgets cannot leak.

const MAX_TEXT = 300;
const MAX_STRING_IN_DETAIL = 200;
const MAX_DEPTH = 4;
const MAX_KEYS = 30;
const MAX_ARRAY = 20;
const MAX_DETAIL_BYTES = 4096;

const REDACTED = '[đã che]';

const WEBHOOK_URL = /https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+/gi;
const ANY_URL_CREDENTIAL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const SMS_OTP_TEXT = /11Ship:\s*Ma\s.{0,60}?\bla\s+\d{4,8}\b[^"]{0,80}/gi;
const OTP_CONTEXT = /\b(?:otp|ma\s+xac\s+thuc|mã\s+xác\s+thực|verification\s+code)\b[^0-9\n]{0,16}\d{4,8}\b/gi;
const SECRET_PAIR = /\b(password|passwd|pwd|secret|token|otp|authorization|api[_-]?key|webhook|cookie|credential|mật\s*khẩu|mat\s*khau)\s*[=:]\s*\S+/gi;
// Vietnamese mobile number in any usual spelling: 0912345678, +84 912 345 678, 84.912.345.678.
const PHONE = /(?<![\dA-Za-z])(?:\+?84|0)[\s.-]?[1-9](?:[\s.-]?\d){8}(?![\d])/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// '/' is not part of the class: a URL path (an Admin link) is not a secret, a 32-character token is.
const LONG_TOKEN = /[A-Za-z0-9_+=-]{32,}/g;

const SENSITIVE_KEY = /(otp|pass(word|wd)?|pwd|token|secret|webhook|authorization|cookie|credential|api[_-]?key|private|signature|digest|sealed|ciphertext|session|csrf)/i;
const PHONE_KEY = /(phone|sdt|msisdn|mobile)/i;

export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 3 ? `+84••••••${digits.slice(-3)}` : '+84•••';
}

/** Text safe to store and show: secrets removed, phone numbers masked, length bounded. */
export function redactText(input: unknown, maxLength: number = MAX_TEXT): string {
  let text = typeof input === 'string' ? input : input === undefined || input === null ? '' : String(input);
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ');
  text = text
    .replace(SMS_OTP_TEXT, REDACTED)
    .replace(WEBHOOK_URL, REDACTED)
    .replace(ANY_URL_CREDENTIAL, '://')
    .replace(BEARER, `Bearer ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(SECRET_PAIR, (_m, key: string) => `${key}=${REDACTED}`)
    .replace(OTP_CONTEXT, REDACTED)
    .replace(PHONE, (m) => maskPhone(m))
    .replace(LONG_TOKEN, (m) => (UUID.test(m) ? m : REDACTED));
  text = text.trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function redactValue(value: unknown, key: string, depth: number): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (SENSITIVE_KEY.test(key)) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return PHONE_KEY.test(key) ? maskPhone(value) : redactText(value, MAX_STRING_IN_DETAIL);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => redactValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, MAX_KEYS)) {
      out[k.slice(0, 48)] = redactValue(v, k, depth + 1);
    }
    return out;
  }
  return null;
}

/** A JSON object safe to store as detail: keys that name a secret are blanked, strings are redacted, depth/size are bounded. */
export function redactDetail(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {};
  }
  const out = redactValue(input, '', 0) as Record<string, unknown>;
  let json = JSON.stringify(out);
  if (json.length <= MAX_DETAIL_BYTES) {
    return out;
  }
  // Too big: keep the first keys that fit (never a partial value).
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out)) {
    kept[k] = v;
    json = JSON.stringify(kept);
    if (json.length > MAX_DETAIL_BYTES) {
      delete kept[k];
      break;
    }
  }
  return { ...kept, truncated: true };
}

/** Free text a person typed (an incident note, a maintenance reason): redacted and bounded like a log line. */
export const redactNote = (input: unknown, maxLength = 500): string => redactText(input, maxLength);
