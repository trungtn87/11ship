import { Failure } from '../core/accounts.js';
import { ADMIN_COPY, formatCountdown } from '../core/messages.js';
import { h, primary, secondary } from './dom.js';
import { icon, UiIconName } from './icons.js';

// The states every page can be in besides "has data" (design catalog C01-C10): loading, empty, offline/timeout, expired,
// forbidden, rate limited, not wired. One look for all of them, so a page never shows a blank area. Each is a small
// self-contained block drawn with createElement only.

export interface StateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly kind?: 'primary' | 'secondary';
}

export interface StateOptions {
  readonly icon: UiIconName;
  readonly title: string;
  readonly text?: string;
  readonly tone?: 'neutral' | 'error' | 'warning';
  /** `alert` is read out at once (errors); `status` is polite. */
  readonly live?: 'alert' | 'status';
  readonly badge?: string;
  readonly actions?: readonly StateAction[];
}

export function statePanel(options: StateOptions): HTMLElement {
  const tone = options.tone ?? 'neutral';
  const actions = (options.actions ?? []).map((action) => {
    const button = action.kind === 'secondary' ? secondary(action.label) : primary(action.label, 'button');
    button.classList.add('btn-inline');
    button.addEventListener('click', action.onClick);
    return button;
  });
  return h(
    'div',
    { class: `state state-${tone}`, role: options.live ?? 'status' },
    h('span', { class: 'state-icon' }, icon(options.icon, 32)),
    options.badge === undefined ? undefined : h('span', { class: 'badge badge-soon' }, options.badge),
    h('p', { class: 'state-title' }, options.title),
    options.text === undefined ? undefined : h('p', { class: 'state-text' }, options.text),
    actions.length === 0 ? undefined : h('div', { class: 'state-actions' }, ...actions),
  );
}

/** Rows of grey bars while a list loads. `aria-busy`; no text is announced for every bar. */
export function skeleton(rows = 5): HTMLElement {
  const lines: HTMLElement[] = [];
  for (let index = 0; index < rows; index += 1) {
    lines.push(h('div', { class: 'skeleton-row' }, h('span', { class: 'skeleton-bar skeleton-wide' }), h('span', { class: 'skeleton-bar' }), h('span', { class: 'skeleton-bar skeleton-short' })));
  }
  return h('div', { class: 'skeleton', 'aria-busy': 'true', role: 'status', 'aria-label': 'Đang tải dữ liệu' }, ...lines);
}

export function notWiredPanel(reason: string): HTMLElement {
  return statePanel({ icon: 'clock', title: 'Chưa kết nối máy chủ', text: reason, badge: 'Sắp có' });
}

export function emptyPanel(title: string, text: string): HTMLElement {
  return statePanel({ icon: 'file', title, text });
}

/** The panel of a failed read. `onRetry` is omitted when retrying makes no sense (forbidden) or is not allowed yet (rate limit). */
export function failurePanel(failure: Failure, handlers: { readonly retry?: () => void; readonly login?: () => void; readonly home?: () => void }, retryAfterSec?: number): HTMLElement {
  switch (failure) {
    case 'offline':
      return statePanel({
        icon: 'wifi-off',
        tone: 'error',
        live: 'alert',
        title: 'Không có kết nối mạng',
        text: 'Kiểm tra kết nối internet rồi thử lại. Dữ liệu đang xem không bị mất.',
        actions: handlers.retry === undefined ? [] : [{ label: 'Thử lại', onClick: handlers.retry }],
      });
    case 'timeout':
      return statePanel({
        icon: 'clock',
        tone: 'error',
        live: 'alert',
        title: 'Máy chủ phản hồi quá lâu',
        text: 'Chưa nhận được kết quả. Hãy thử lại sau ít phút.',
        actions: handlers.retry === undefined ? [] : [{ label: 'Thử lại', onClick: handlers.retry }],
      });
    case 'session-expired':
      return statePanel({
        icon: 'lock',
        tone: 'warning',
        live: 'alert',
        title: 'Phiên đăng nhập đã hết hạn',
        text: ADMIN_COPY.sessionEnded,
        actions: handlers.login === undefined ? [] : [{ label: 'Đăng nhập lại', onClick: handlers.login }],
      });
    case 'forbidden':
      return statePanel({
        icon: 'shield',
        tone: 'warning',
        live: 'alert',
        title: 'Không có quyền xem mục này',
        text: ADMIN_COPY.forbidden,
        actions: handlers.home === undefined ? [] : [{ label: 'Về tổng quan', onClick: handlers.home, kind: 'secondary' }],
      });
    case 'rate-limited':
      return statePanel({
        icon: 'clock',
        tone: 'warning',
        live: 'alert',
        title: 'Bạn thao tác quá nhanh',
        text: retryAfterSec === undefined ? ADMIN_COPY.rateLimited : `Vui lòng thử lại sau ${formatCountdown(retryAfterSec)}.`,
      });
    case 'unknown':
      return statePanel({
        icon: 'alert',
        tone: 'error',
        live: 'alert',
        title: 'Chưa thể tải dữ liệu',
        text: 'Đã có lỗi khi đọc dữ liệu. Vui lòng thử lại.',
        actions: handlers.retry === undefined ? [] : [{ label: 'Thử lại', onClick: handlers.retry }],
      });
  }
}
