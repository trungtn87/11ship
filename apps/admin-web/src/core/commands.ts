// What every M12 write answers, in one closed set (the pages of M12-C/D/E/F use it): a command is sent ONCE per click with the caller's Idempotency-Key; an answer that
// did not arrive is `unknown` (the command MAY have run) and only a retry with the SAME key is offered. Nothing here repeats a request by itself.

import { CsrfPort } from './accounts-api.js';
import { ApiResult } from './api.js';

export type CommandResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

/** Codes that mean "the thing you saw is no longer what is stored": the page offers a reload, never a blind retry. */
const CONFLICT_CODES: readonly string[] = ['ADMIN_ACCESS_VERSION_CONFLICT', 'FINANCE_VERSION_CONFLICT', 'VERSION_CONFLICT', 'CONFIG_VERSION_CONFLICT', 'ADMIN_ACCESS_STATE_CONFLICT', 'FINANCE_GRANT_STATE_CONFLICT', 'SYSTEM_SETTING_VERSION_CONFLICT', 'WALLET_PARAMETER_VERSION_CONFLICT', 'SHIPPING_ELIGIBILITY_VERSION_CONFLICT', 'RESTORE_REQUEST_STATE_CONFLICT'];

export async function commandResultOf(result: ApiResult<unknown>, session: CsrfPort): Promise<CommandResult> {
  if (result.kind === 'ok') {
    return { kind: 'ok' };
  }
  if (result.kind === 'network' || result.status >= 500) {
    return { kind: 'unknown' };
  }
  if (CONFLICT_CODES.includes(result.code)) {
    return { kind: 'conflict' };
  }
  switch (result.code) {
    case 'ADMIN_CSRF_INVALID':
      // Refused before anything ran; a fresh token is read and the administrator retries with the SAME key.
      await session.refresh();
      return { kind: 'unknown' };
    case 'IDEMPOTENCY_BUSY':
      return { kind: 'unknown' };
    case 'ADMIN_SESSION_INVALID':
      return { kind: 'session-expired' };
    case 'ADMIN_FORBIDDEN':
      return { kind: 'forbidden' };
    case 'ADMIN_AUTH_RATE_LIMITED':
      return { kind: 'rate-limited', ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSec: result.retryAfterSeconds }) };
    default:
      return { kind: 'refused', code: result.code };
  }
}

/** The sentence for an answer that was not `ok` (a page adds its own wording for `refused` codes it knows). */
export function commandFailureText(result: CommandResult, refusals: Readonly<Record<string, string>> = {}): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Dữ liệu vừa được thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy tải lại để xem trạng thái hiện tại.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return refusals[result.code] ?? 'Máy chủ từ chối yêu cầu này. Kiểm tra lại thông tin rồi thử lại.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Yêu cầu không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}
