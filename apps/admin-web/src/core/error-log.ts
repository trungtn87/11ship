/** Fixed Vietnamese descriptions only. No raw server exception is shown. */
export interface ErrorEntry {
  readonly time: string;
  readonly level: 'warn' | 'error';
  readonly request_id: string;
  readonly status: number;
  readonly code: string;
  readonly method?: string;
  readonly app?: string;
  readonly module?: string;
  readonly route?: string;
  readonly error_class?: string;
  readonly count: number;
  readonly occurrences: readonly { readonly time: string; readonly request_id: string }[];
}
export interface ErrorPage { readonly items: readonly ErrorEntry[]; readonly total: number; readonly storage: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function occurrence(value: unknown): { time: string; request_id: string } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  return typeof row.time === 'string' && Number.isFinite(Date.parse(row.time)) && typeof row.request_id === 'string' && uuid.test(row.request_id)
    ? { time: row.time, request_id: row.request_id } : undefined;
}
function validError(value: unknown): ErrorEntry | undefined {
  const base = occurrence(value);
  if (!base) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.code !== 'string' || !/^[A-Z0-9_]{1,128}$/.test(row.code) ||
      typeof row.status !== 'number' || !Number.isInteger(row.status) || row.status < 400 || row.status > 599 ||
      (row.level !== 'warn' && row.level !== 'error') ||
      typeof row.count !== 'number' || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > 10000 ||
      !Array.isArray(row.occurrences) || row.occurrences.length !== row.count) return undefined;
  const occurrences = row.occurrences.map(occurrence);
  if (occurrences.some((r) => r === undefined)) return undefined;
  const optional = (key: string): string | undefined => typeof row[key] === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(row[key] as string) ? row[key] as string : undefined;
  return { ...base, code: row.code, status: row.status, level: row.level, count: row.count,
    occurrences: occurrences as { time: string; request_id: string }[],
    app: optional('app'), module: optional('module'), method: optional('method'), error_class: optional('error_class'),
    route: typeof row.route === 'string' && /^\/[A-Za-z0-9/:._-]{0,127}$/.test(row.route) ? row.route : undefined };
}
export function parseErrorPage(body: unknown): ErrorPage | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const data = (body as { data?: unknown }).data;
  if (data === null || typeof data !== 'object') return undefined;
  const page = data as { items?: unknown; total?: unknown; storage?: unknown };
  if (!Array.isArray(page.items) || page.items.length > 50 || typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0 ||
      (page.storage !== 'configured-file' && page.storage !== 'memory-only')) return undefined;
  const items = page.items.map(validError);
  if (items.some((item) => item === undefined)) return undefined;
  return { items: items as ErrorEntry[], total: page.total, storage: page.storage };
}

const explanations: Readonly<Record<string, string>> = {
  TOPUP_AMOUNT_BELOW_MINIMUM: 'Số tiền nạp thấp hơn mức tối thiểu đang áp dụng.',
  TOPUP_RECEIVING_ACCOUNT_NOT_CONFIGURED: 'Hệ thống chưa cấu hình tài khoản ngân hàng nhận tiền nạp.',
  TOPUP_REQUEST_STATE_CONFLICT: 'Yêu cầu nạp đã chuyển trạng thái nên thao tác này không còn phù hợp.',
  TOPUP_REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu nạp tiền.',
  WITHDRAWAL_INSUFFICIENT_AVAILABLE: 'Số dư khả dụng không đủ cho yêu cầu rút tiền.',
  WITHDRAWAL_BANK_NOT_VERIFIED: 'Tài khoản ngân hàng nhận tiền rút chưa được xác minh.',
  VERSION_CONFLICT: 'Dữ liệu đã thay đổi sau khi màn hình được tải.',
  IDEMPOTENCY_KEY_REUSED: 'Mã chống gửi trùng đã được dùng với nội dung khác.',
  TRANSACTION_OUTCOME_UNKNOWN: 'Máy chủ chưa xác nhận được kết quả. Yêu cầu có thể đã được ghi nhận; cần đối chiếu trước khi thao tác lại.',
  ROLE_NOT_AVAILABLE: 'Tài khoản chưa có vai trò phù hợp để thực hiện thao tác.',
  ADMIN_FORBIDDEN: 'Tài khoản quản trị không có quyền thực hiện thao tác.',
  SESSION_INVALID: 'Phiên đăng nhập không còn hiệu lực.',
  ADMIN_SESSION_INVALID: 'Phiên đăng nhập quản trị không còn hiệu lực.',
  ADMIN_AUTH_RATE_LIMITED: 'Đã thử quá nhiều lần đăng nhập quản trị trong thời gian ngắn.',
  OTP_RATE_LIMITED: 'Đã gửi hoặc nhập mã xác minh quá nhiều lần trong thời gian ngắn.',
  ORDER_INPUT_INVALID: 'Thông tin đơn hàng chưa hợp lệ.',
  DELIVERY_INPUT_INVALID: 'Thông tin giao hàng chưa hợp lệ.',
  ADMIN_INPUT_INVALID: 'Thông tin tra cứu hoặc thao tác quản trị chưa hợp lệ.',
  SESSION_EXPIRED: 'Phiên đăng nhập đã hết hạn.',
  SESSION_REVOKED: 'Phiên đăng nhập đã kết thúc hoặc bị thu hồi.',
  INVALID_CREDENTIALS: 'Thông tin đăng nhập không đúng.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  DELIVERY_ALREADY_TAKEN: 'Đơn giao đã có shipper khác nhận.',
};
export function errorExplanation(code: string): string {
  return explanations[code] ?? 'Chưa xác định nguyên nhân. Dùng mã tra cứu và thông tin kỹ thuật để kiểm tra thêm.';
}
export function errorAction(item: Pick<ErrorEntry, 'route' | 'module' | 'method'>): string {
  const route = item.route ?? '';
  if (/\/wallet\/topup-requests$/.test(route) && item.method === 'POST') return 'Tạo yêu cầu nạp tiền';
  if (/\/wallet\/topup-requests/.test(route)) return 'Xử lý yêu cầu nạp tiền';
  if (/\/wallet\/withdraw/.test(route)) return 'Xử lý yêu cầu rút tiền';
  if (route.includes('/wallet')) return 'Thao tác ví';
  if (route.includes('/orders') || item.module === 'M10') return 'Thao tác đơn hàng';
  if (route.includes('/notifications')) return 'Thao tác thông báo';
  if (route.includes('/auth') || route.includes('/sessions')) return 'Xác thực tài khoản';
  if (route.includes('/shop')) return 'Thao tác quán';
  return 'Thao tác trên ứng dụng';
}
export function errorSummary(item: ErrorEntry): string {
  if (['SESSION_EXPIRED', 'SESSION_REVOKED', 'SESSION_INVALID', 'ADMIN_SESSION_INVALID'].includes(item.code)) return errorExplanation(item.code);
  return 'Không thực hiện được: ' + errorAction(item).toLocaleLowerCase('vi-VN');
}
export function errorGroupKey(item: ErrorEntry): string {
  return JSON.stringify([item.app, item.module, item.method, item.route, item.code, item.status, item.level, item.error_class]);
}
export function vietnamTime(time: string): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(time));
}
