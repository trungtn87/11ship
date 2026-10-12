// Why a health check failed, in words the person can read, and the last line of defence against a secret reaching the screen.
//
// The wording is FIXED here, keyed by a closed list of reasons. Nothing a server or an exception said is ever copied into
// it: a person never sees a raw exception message, a stack, a connection string or a token. `sanitizeDiagnosticText` exists
// for the few free-text fragments that are still shown or copied (for example a page address); it removes what looks like a
// credential. This file has no DOM and no network access, so it also runs in the Node tests.

/** The only reasons a health probe can fail. A closed list on purpose: no free-form error text travels with a result. */
export type HealthFailureReason =
  | 'OFFLINE' // the request never reached a server (no network, refused, DNS)
  | 'TIMEOUT' // no complete answer within the time limit
  | 'BAD_RESPONSE' // the server answered 200 but the body is not the agreed health body
  | 'NOT_READY' // /ready answered 503: the process is alive but not ready to serve
  | 'UNEXPECTED_STATUS'; // any other HTTP status

export interface HealthCopy {
  readonly title: string;
  readonly text: string;
}

/** Vietnamese copy per phase of the connection state (03-ui-catalog C01-C03, F05, F06). */
export const HEALTH_COPY = {
  checking: { title: 'Đang kiểm tra kết nối…', text: 'Vui lòng chờ trong giây lát.' },
  ready: { title: 'Máy chủ sẵn sàng', text: 'Ứng dụng đã kết nối được với máy chủ.' },
  backend_not_ready: { title: 'Máy chủ chưa sẵn sàng', text: 'Máy chủ đã phản hồi nhưng chưa sẵn sàng phục vụ. Vui lòng thử lại sau ít phút.' },
  offline: { title: 'Không có kết nối mạng', text: 'Vui lòng kiểm tra kết nối internet và thử lại.' },
  timeout: { title: 'Máy chủ phản hồi quá lâu', text: 'Chưa nhận được phản hồi. Vui lòng thử lại.' },
  bad_response: { title: 'Máy chủ phản hồi chưa đúng', text: 'Phản hồi từ máy chủ không như mong đợi. Vui lòng thử lại; nếu vẫn lỗi, hãy gửi thông tin chẩn đoán cho người hỗ trợ.' },
} as const satisfies Record<string, HealthCopy>;

export type HealthPhase = keyof typeof HEALTH_COPY;

/** Short Vietnamese label of a failure reason, for the rows of the diagnostics screen. Never a raw message. */
export const HEALTH_REASON_LABEL: Readonly<Record<HealthFailureReason, string>> = {
  OFFLINE: 'Không kết nối được',
  TIMEOUT: 'Quá thời gian chờ',
  BAD_RESPONSE: 'Nội dung phản hồi không đúng',
  NOT_READY: 'Chưa sẵn sàng (503)',
  UNEXPECTED_STATUS: 'Mã phản hồi không đúng',
};

const REDACTED = '[đã ẩn]';

// Keys whose value must never be shown. Matched case-insensitively as whole words before ":" or "=".
const SENSITIVE_KEY = 'pass(?:word|wd)?|secret|token|api[_-]?key|authorization|cookie|set-cookie|session(?:[_-]?id)?|otp|dsn|database[_-]?url|credential|private[_-]?key|csrf';

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // user:password@host inside any URL / connection string (postgres://, https://, ...)
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`],
  // Authorization header values
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`],
  // key=value / key: value / "key":"value" for sensitive keys
  [new RegExp(`(["']?\\b(?:${SENSITIVE_KEY})s?\\b["']?)\\s*[:=]\\s*(?:"[^"]*"|'[^']*'|[^\\s,;&}]+)`, 'gi'), `$1=${REDACTED}`],
  // JSON Web Tokens
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED],
  // any long opaque run (hex, base64, base64url): looks like a key, a hash of a secret or a token
  [/[A-Za-z0-9_+/=-]{32,}/g, REDACTED],
];

/**
 * Cleans one free-text fragment before it is shown or copied: drops stack-trace lines, removes control characters, redacts
 * credentials (URL user-info, Bearer/Basic values, password/token/cookie/... pairs, JWTs, long opaque strings) and cuts the
 * result to `maxLength`. It never throws and never returns more than `maxLength` characters.
 *
 * Do NOT pass the public build fingerprint through this (64 hex characters look like a key and would be hidden).
 */
export function sanitizeDiagnosticText(input: unknown, maxLength = 200): string {
  if (typeof input !== 'string') {
    return '';
  }
  const withoutStack = input
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s+\S/.test(line))
    .join(' ');
  let text = withoutStack.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
  for (const [pattern, replacement] of REDACTIONS) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/\s+/g, ' ').trim();
  const limit = Math.max(1, Math.floor(maxLength));
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
