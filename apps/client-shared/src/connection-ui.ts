import { button, setButtonLabel } from './components.js';
import { ConnectionState, ConnectionView } from './connection.js';
import { formatDateTime, h, setText } from './dom.js';
import { HEALTH_COPY, HealthPhase } from './errors.js';
import { icon, IconName } from './icons.js';

// Connection banner (catalog F06, C03). One element per screen, placed under the app bar by the app. It follows the
// ConnectionView: nothing is shown while the server is ready, so a stale "connected" mark can never stay on screen; when a
// check is running, or the server is not usable, it says so in Vietnamese and offers "Thử lại".
//
// The DOM is built once and updated in place. That keeps the keyboard focus on "Thử lại" while the state changes from
// "not ready" to "checking" and back (a rebuilt button would drop the focus).

type Shown = Exclude<HealthPhase, 'ready'>;

const LOOK: Record<Shown, { readonly kind: 'info' | 'warn' | 'error'; readonly icon: IconName }> = {
  checking: { kind: 'info', icon: 'info' },
  backend_not_ready: { kind: 'warn', icon: 'alert' },
  offline: { kind: 'error', icon: 'wifiOff' },
  timeout: { kind: 'error', icon: 'clock' },
  bad_response: { kind: 'error', icon: 'alertCircle' },
};

export const RETRY_LABEL = 'Thử lại';
export const CHECKING_LABEL = 'Đang kiểm tra…';

export function lastCheckedText(epochMs: number | undefined): string | undefined {
  return epochMs === undefined ? undefined : `Lần kiểm tra gần nhất: ${formatDateTime(new Date(epochMs).toISOString())}`;
}

export interface ConnectionBannerOptions {
  /** Called when the banner disappears while the keyboard focus was inside it (so the focus is not lost to the page body). */
  readonly focusFallback?: () => void;
}

export interface ConnectionBanner {
  readonly element: HTMLElement;
  dispose(): void;
}

export function createConnectionBanner(view: ConnectionView, options: ConnectionBannerOptions = {}): ConnectionBanner {
  const iconSlot = h('span', { class: 'c-connection__icon', 'aria-hidden': 'true' });
  const title = h('p', { class: 'c-banner__title' });
  const text = h('p', { class: 'c-banner__text' });
  const meta = h('p', { class: 'c-banner__text' });
  const retry = button({ label: RETRY_LABEL, kind: 'secondary', compact: true, id: 'connection-retry', onClick: () => view.recheck() });
  const root = h('div', { class: 'c-banner c-banner--info' }, iconSlot, h('div', { class: 'c-banner__body' }, title, text, meta, retry));
  // role=status + aria-live=polite on the host: the text changes are announced without taking the focus.
  const element = h('div', { class: 'c-connection', role: 'status', 'aria-live': 'polite', 'data-connection': 'checking' }, root);

  let settled: HealthPhase | undefined;
  let iconName: IconName | undefined;

  const render = (state: ConnectionState): void => {
    const { phase, lastCheckedAt } = state.health;
    if (phase !== 'checking') {
      settled = phase;
    }
    element.setAttribute('data-connection', phase);
    // A background re-check after a good answer stays invisible (no flicker every poll); the first check and any re-check
    // after a problem are shown. A ready server shows nothing at all.
    if (phase === 'ready' || (phase === 'checking' && settled === 'ready')) {
      const hadFocus = element.contains(document.activeElement);
      element.hidden = true;
      if (hadFocus) {
        options.focusFallback?.();
      }
      return;
    }
    element.hidden = false;
    const look = LOOK[phase];
    root.className = `c-banner c-banner--${look.kind}`;
    if (iconName !== look.icon) {
      iconName = look.icon;
      iconSlot.replaceChildren(icon(look.icon, 20));
    }
    const copy = HEALTH_COPY[phase];
    setText(title, copy.title);
    setText(text, copy.text);
    setText(meta, lastCheckedText(lastCheckedAt));
    const checking = phase === 'checking';
    setButtonLabel(retry, checking ? CHECKING_LABEL : RETRY_LABEL);
    // aria-disabled (not `disabled`) keeps the button focusable, so the focus survives the state change.
    retry.setAttribute('aria-disabled', String(checking));
    retry.setAttribute('aria-busy', String(checking));
  };

  const off = view.subscribe(render);
  render(view.state());
  return { element, dispose: off };
}
