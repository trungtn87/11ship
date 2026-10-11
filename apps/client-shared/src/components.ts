import { Child, h } from './dom.js';
import { icon, IconName } from './icons.js';
import { sanitizeOtp, OTP_LENGTH } from './validation.js';
import { STATE_COPY } from './states.js';

// Display components of the phone apps. Pure presentation: they hold no business rule and call no backend.

// ---- Buttons ------------------------------------------------------------------------------------------------------

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'danger-outline';

export interface ButtonOptions {
  readonly label: string;
  readonly kind?: ButtonKind;
  readonly type?: 'button' | 'submit';
  readonly compact?: boolean;
  readonly icon?: IconName;
  readonly id?: string;
  readonly onClick?: () => void;
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const kind = options.kind ?? 'primary';
  const element = h(
    'button',
    { type: options.type ?? 'button', class: `c-btn c-btn--${kind}${options.compact === true ? ' c-btn--compact' : ''}`, id: options.id },
    options.icon === undefined ? undefined : icon(options.icon, 20),
    h('span', { class: 'c-btn__label' }, options.label),
  );
  if (options.onClick !== undefined) {
    const handler = options.onClick;
    element.addEventListener('click', () => {
      if (element.getAttribute('aria-disabled') !== 'true' && !element.disabled) {
        handler();
      }
    });
  }
  return element;
}

export function setButtonLabel(element: HTMLButtonElement, label: string): void {
  const span = element.querySelector('.c-btn__label');
  if (span !== null && span.textContent !== label) {
    span.textContent = label;
  }
}

/** Busy state of a submit: spinner, aria-busy and no second submit while the request runs. */
export function setBusy(element: HTMLButtonElement, busy: boolean, idleLabel: string, busyLabel: string): void {
  element.setAttribute('aria-busy', String(busy));
  element.toggleAttribute('data-busy', busy);
  element.disabled = busy;
  element.replaceChildren(...(busy ? [h('span', { class: 'c-spinner', 'aria-hidden': 'true' })] : []), h('span', { class: 'c-btn__label' }, busy ? busyLabel : idleLabel));
}

export function textLink(label: string, onClick: () => void, href?: string): HTMLElement {
  const element: HTMLElement = href === undefined ? h('button', { type: 'button', class: 'c-link' }, label) : h('a', { class: 'c-link', href }, label);
  element.addEventListener('click', (event) => {
    if (href !== undefined && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
      return;
    }
    event.preventDefault();
    onClick();
  });
  return element;
}

/** The visible reason a business action is not available yet (C10). It is text next to the control, not a tooltip. */
export function reasonNote(text: string, id?: string): HTMLElement {
  return h('p', { class: 'c-reason', id }, icon('info', 16), h('span', {}, text));
}

/**
 * Makes `target` unavailable WITHOUT removing it from the keyboard order: aria-disabled (not `disabled`) so a screen reader
 * still reaches it and reads the reason through aria-describedby. A click never runs the action (`onBlocked` may validate the
 * form). Returns the control and its reason.
 */
export function gate(target: HTMLButtonElement, reason: string, onBlocked?: () => void): HTMLElement {
  const id = `reason-${Math.random().toString(36).slice(2, 10)}`;
  target.setAttribute('aria-disabled', 'true');
  target.setAttribute('aria-describedby', id);
  target.type = 'button';
  target.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      // The action itself never runs; the screen may still check the form so the person sees what is wrong.
      onBlocked?.();
    },
    { capture: true },
  );
  return h('div', { class: 'c-stack c-stack--tight' }, target, reasonNote(reason, id));
}

// ---- Fields -------------------------------------------------------------------------------------------------------

export interface FieldOptions {
  readonly id: string;
  readonly label: string;
  readonly optional?: boolean;
  readonly icon?: IconName;
  readonly type?: string;
  readonly inputMode?: string;
  readonly autocomplete?: string;
  readonly placeholder?: string;
  readonly value?: string;
  readonly readOnly?: boolean;
  readonly maxLength?: number;
  readonly hint?: string;
  readonly trailing?: HTMLElement;
}

export interface FieldHandle {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  /** Shows (or clears, with undefined) the message under the field and marks the field invalid for assistive tech. */
  setError(text: string | undefined): void;
  error(): string | undefined;
}

function errorLine(id: string): HTMLElement {
  return h('p', { id, class: 'c-error', 'aria-live': 'polite', hidden: true });
}

export function textField(options: FieldOptions): FieldHandle {
  const errorId = `${options.id}-error`;
  const hintId = `${options.id}-hint`;
  const input = h('input', {
    id: options.id,
    name: options.id,
    type: options.type ?? 'text',
    inputmode: options.inputMode,
    autocomplete: options.autocomplete,
    placeholder: options.placeholder,
    maxlength: options.maxLength === undefined ? undefined : String(options.maxLength),
    readonly: options.readOnly === true,
    spellcheck: 'false',
    'aria-describedby': options.hint === undefined ? errorId : `${errorId} ${hintId}`,
  });
  if (options.value !== undefined) {
    input.value = options.value;
  }
  const wrap = h('div', { class: 'c-input', 'data-readonly': options.readOnly === true ? 'true' : undefined }, options.icon === undefined ? undefined : icon(options.icon, 20), input, options.trailing);
  const error = errorLine(errorId);
  const label = h('label', { for: options.id, class: 'c-label' }, options.label, options.optional === true ? h('small', {}, ' (tùy chọn)') : undefined);
  const hint = options.hint === undefined ? undefined : h('p', { id: hintId, class: 'c-hint' }, options.hint);
  const root = h('div', { class: 'c-field' }, label, wrap, hint, error);
  return {
    root,
    input,
    setError(text) {
      error.replaceChildren(...(text === undefined ? [] : [icon('alertCircle', 16), h('span', {}, text)]));
      error.hidden = text === undefined;
      wrap.setAttribute('data-invalid', String(text !== undefined));
      input.setAttribute('aria-invalid', String(text !== undefined));
    },
    error() {
      return error.hidden ? undefined : (error.textContent ?? undefined);
    },
  };
}

export function passwordField(options: Omit<FieldOptions, 'type' | 'trailing' | 'icon'> & { readonly autocomplete: 'current-password' | 'new-password' }): FieldHandle {
  const toggle = h('button', { type: 'button', class: 'c-iconbtn', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false', 'aria-controls': options.id }, icon('eye', 20));
  const field = textField({ ...options, type: 'password', icon: 'lock', trailing: toggle });
  toggle.addEventListener('click', () => {
    const show = field.input.type === 'password';
    field.input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    toggle.setAttribute('aria-pressed', String(show));
    toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye', 20));
  });
  return field;
}

export interface OtpHandle {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  value(): string;
  clear(): void;
  setError(text: string | undefined): void;
  focus(): void;
}

/**
 * Six digits. ONE real input carries the value (keyboard, paste, SMS autofill, screen reader); six decorative cells only
 * show the digits. Anything that is not an ASCII digit is dropped, leading zeros are kept (the value is a string).
 */
export function otpField(options: { readonly id: string; readonly label: string; readonly onChange?: (value: string) => void }): OtpHandle {
  const errorId = `${options.id}-error`;
  const input = h('input', {
    id: options.id,
    name: options.id,
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    pattern: '[0-9]*',
    maxlength: '12',
    class: 'c-otp__input',
    spellcheck: 'false',
    'aria-describedby': errorId,
  });
  const cells = Array.from({ length: OTP_LENGTH }, () => h('span', { class: 'c-otp__cell', 'aria-hidden': 'true' }));
  const box = h('div', { class: 'c-otp' }, ...cells, input);
  const error = errorLine(errorId);
  const root = h('div', { class: 'c-field' }, h('label', { for: options.id, class: 'c-label' }, options.label), box, error);

  const paint = (): void => {
    const value = input.value;
    const focused = document.activeElement === input;
    cells.forEach((cell, index) => {
      const digit = value[index] ?? '';
      if (cell.textContent !== digit) {
        cell.textContent = digit;
      }
      cell.setAttribute('data-active', String(focused && index === Math.min(value.length, OTP_LENGTH - 1)));
    });
  };
  input.addEventListener('input', () => {
    const clean = sanitizeOtp(input.value);
    if (clean !== input.value) {
      input.value = clean;
    }
    paint();
    options.onChange?.(clean);
  });
  input.addEventListener('focus', paint);
  input.addEventListener('blur', paint);
  paint();
  return {
    root,
    input,
    value: () => input.value,
    clear() {
      input.value = '';
      paint();
      options.onChange?.('');
    },
    setError(text) {
      error.replaceChildren(...(text === undefined ? [] : [icon('alertCircle', 16), h('span', {}, text)]));
      error.hidden = text === undefined;
      box.setAttribute('data-invalid', String(text !== undefined));
      input.setAttribute('aria-invalid', String(text !== undefined));
    },
    focus: () => input.focus(),
  };
}

export interface CheckboxHandle {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  setError(text: string | undefined): void;
}

export function checkbox(options: { readonly id: string; readonly label: Child; readonly checked?: boolean }): CheckboxHandle {
  const errorId = `${options.id}-error`;
  const input = h('input', { id: options.id, name: options.id, type: 'checkbox', 'aria-describedby': errorId, checked: options.checked === true });
  const error = errorLine(errorId);
  const root = h('div', { class: 'c-stack c-stack--tight' }, h('label', { class: 'c-check', for: options.id }, input, h('span', {}, options.label)), error);
  return {
    root,
    input,
    setError(text) {
      error.replaceChildren(...(text === undefined ? [] : [icon('alertCircle', 16), h('span', {}, text)]));
      error.hidden = text === undefined;
      input.setAttribute('aria-invalid', String(text !== undefined));
    },
  };
}

// ---- Feedback -----------------------------------------------------------------------------------------------------

export type BannerKind = 'info' | 'warn' | 'error' | 'success' | 'test';

export interface BannerOptions {
  readonly kind: BannerKind;
  readonly title?: string;
  readonly text?: Child;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

const BANNER_ICON: Record<BannerKind, IconName> = { info: 'info', warn: 'alert', error: 'alertCircle', success: 'checkCircle', test: 'info' };

export function banner(options: BannerOptions): HTMLElement {
  const role = options.kind === 'error' ? 'alert' : 'status';
  const body = h(
    'div',
    { class: 'c-banner__body' },
    options.title === undefined ? undefined : h('p', { class: 'c-banner__title' }, options.title),
    options.text === undefined ? undefined : h('p', { class: 'c-banner__text' }, options.text),
  );
  if (options.action !== undefined) {
    body.append(button({ label: options.action.label, kind: 'secondary', compact: true, onClick: options.action.onClick }));
  }
  return h('div', { class: `c-banner c-banner--${options.kind}`, role }, icon(BANNER_ICON[options.kind], 20), body);
}

export function chip(text: string, kind: 'soon' | 'ok' | 'warn' | 'bad' | 'info' = 'soon'): HTMLElement {
  return h('span', { class: `c-chip c-chip--${kind}` }, text);
}

export function skeleton(lines = 3): HTMLElement {
  return h(
    'div',
    { class: 'c-stack', role: 'status', 'aria-busy': 'true', 'aria-label': STATE_COPY.loading },
    h('span', { class: 'c-skeleton c-skeleton--block' }),
    ...Array.from({ length: lines }, (_, index) => h('span', { class: `c-skeleton c-skeleton--w${Math.min(index, 4)}` })),
  );
}

export interface EmptyOptions {
  readonly icon: IconName;
  readonly title: string;
  readonly text?: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

export function emptyState(options: EmptyOptions): HTMLElement {
  const root = h(
    'div',
    { class: 'c-empty' },
    h('span', { class: 'c-empty__icon' }, icon(options.icon, 32)),
    h('p', { class: 'c-h2' }, options.title),
    options.text === undefined ? undefined : h('p', { class: 'c-lead' }, options.text),
  );
  if (options.action !== undefined) {
    root.append(button({ label: options.action.label, kind: 'secondary', onClick: options.action.onClick }));
  }
  return root;
}

// ---- Lists --------------------------------------------------------------------------------------------------------

export interface ListItemOptions {
  readonly icon: IconName;
  readonly title: string;
  readonly sub?: string;
  readonly href?: string;
  readonly onClick?: () => void;
  /** Not available yet: not clickable, shows the "Sắp có" chip unless `trailing` is given. */
  readonly soon?: boolean;
  readonly trailing?: HTMLElement;
  readonly tone?: 'danger';
}

export function listItem(options: ListItemOptions): HTMLElement {
  const classes = `c-item${options.tone === 'danger' ? ' c-item--danger' : ''}`;
  const inner: Child[] = [
    h('span', { class: 'c-item__icon' }, icon(options.icon, 24)),
    h('span', { class: 'c-item__text' }, h('span', { class: 'c-item__title' }, options.title), options.sub === undefined ? undefined : h('span', { class: 'c-item__sub' }, options.sub)),
  ];
  if (options.soon === true) {
    inner.push(options.trailing ?? chip(STATE_COPY.soon, 'soon'));
    return h('li', {}, h('div', { class: classes, 'aria-disabled': 'true' }, ...inner));
  }
  inner.push(options.trailing ?? h('span', { class: 'c-item__chev' }, icon('chevronRight', 20)));
  const element: HTMLElement = options.href === undefined ? h('button', { type: 'button', class: classes }, ...inner) : h('a', { class: classes, href: options.href }, ...inner);
  element.addEventListener('click', (event) => {
    if (options.href !== undefined && (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
      return;
    }
    if (options.onClick !== undefined) {
      event.preventDefault();
      options.onClick();
    }
  });
  return h('li', {}, element);
}

export function list(items: readonly HTMLElement[]): HTMLElement {
  return h('ul', { class: 'c-list' }, ...items);
}

// ---- App chrome ---------------------------------------------------------------------------------------------------

export interface AppBarOptions {
  readonly title?: string;
  readonly onBack?: () => void;
  readonly variant?: 'plain' | 'yellow';
  readonly right?: HTMLElement;
  /** Brand logo slot on the left (home screens); replaces the back button and the centred title. */
  readonly logo?: HTMLElement;
}

export function appBar(options: AppBarOptions): HTMLElement {
  const variant = options.variant === 'yellow' ? ' c-appbar--yellow' : '';
  if (options.logo !== undefined) {
    return h('header', { class: `c-appbar c-appbar--logo${variant}` }, options.logo, h('div', { class: 'c-appbar__side' }, options.right));
  }
  const back =
    options.onBack === undefined
      ? h('span', { class: 'c-appbar__side' })
      : (() => {
          const element = h('button', { type: 'button', class: 'c-iconbtn', 'aria-label': STATE_COPY.back }, icon('back', 24));
          element.addEventListener('click', () => options.onBack?.());
          return element;
        })();
  return h('header', { class: `c-appbar${variant}` }, back, h('h1', { class: 'c-appbar__title' }, options.title ?? ''), h('div', { class: 'c-appbar__side' }, options.right));
}

export interface TabDef {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly href: string;
}

export function bottomNav(tabs: readonly TabDef[], active: string, onSelect: (id: string) => void, label = 'Điều hướng chính'): HTMLElement {
  return h(
    'nav',
    { class: 'c-bottomnav', 'aria-label': label },
    ...tabs.map((tab) => {
      const anchor = h(
        'a',
        { class: 'c-tab', href: tab.href, 'data-tab': tab.id, 'aria-current': tab.id === active ? 'page' : undefined },
        h('span', { class: 'c-tab__icon' }, icon(tab.icon, 22)),
        h('span', {}, tab.label),
      );
      anchor.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        onSelect(tab.id);
      });
      return anchor;
    }),
  );
}

// ---- Dialog and toast ---------------------------------------------------------------------------------------------

export interface DialogAction {
  readonly label: string;
  readonly kind?: ButtonKind;
  readonly onClick?: () => void;
}

export interface DialogOptions {
  readonly title: string;
  readonly text?: Child;
  readonly icon?: IconName;
  readonly tone?: 'danger' | 'neutral';
  /** Cancel first (left), the consequential action last (right). */
  readonly actions: readonly DialogAction[];
  readonly onClose?: () => void;
  /** Mount point. Default: the page body. The design preview passes its phone frame so the dialog stays inside it. */
  readonly host?: HTMLElement;
}

export interface DialogHandle {
  close(): void;
  readonly element: HTMLElement;
}

const openDialogs = new Set<() => void>();

/** Closes every open dialog (the design preview calls it before showing another screen so no focus trap is left behind). */
export function closeAllDialogs(): void {
  for (const close of Array.from(openDialogs)) {
    close();
  }
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Modal dialog: focus moves in and is trapped, Esc and Cancel close it, focus returns to where it was. */
export function openDialog(options: DialogOptions): DialogHandle {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const textId = `${titleId}-text`;
  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    openDialogs.delete(close);
    overlay.remove();
    previous?.focus();
    options.onClose?.();
  };
  const actions = options.actions.map((action) =>
    button({
      label: action.label,
      kind: action.kind ?? 'secondary',
      onClick: () => {
        close();
        action.onClick?.();
      },
    }),
  );
  const dialog = h(
    'div',
    { class: 'c-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': options.text === undefined ? undefined : textId },
    options.icon === undefined ? undefined : h('div', { class: `c-dialog__icon${options.tone === 'neutral' ? ' c-dialog__icon--neutral' : ''}` }, icon(options.icon, 28)),
    h('h2', { id: titleId, class: 'c-title c-center' }, options.title),
    options.text === undefined ? undefined : h('p', { id: textId, class: 'c-lead c-center' }, options.text),
    h('div', { class: 'c-dialog__actions' }, ...actions),
  );
  const overlay = h('div', { class: options.host === undefined ? 'c-overlay' : 'c-overlay c-overlay--contained' }, dialog);
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) {
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);
  openDialogs.add(close);
  (options.host ?? document.body).append(overlay);
  (actions[0] ?? dialog).focus();
  return { close, element: dialog };
}

let toastTimer: number | undefined;

export function toast(text: string, milliseconds = 4000, host?: HTMLElement): void {
  document.querySelectorAll('.c-toast').forEach((node) => node.remove());
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  const element = h('div', { class: host === undefined ? 'c-toast' : 'c-toast c-toast--contained', role: 'status' }, text);
  (host ?? document.body).append(element);
  toastTimer = window.setTimeout(() => element.remove(), milliseconds);
}

// ---- Countdown ----------------------------------------------------------------------------------------------------

export interface Ticker {
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(handle: number): void;
}

export const WINDOW_TICKER: Ticker = {
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (handle) => window.clearInterval(handle),
};

/** Counts down whole seconds from `seconds`; calls `onTick(remaining)` immediately and every second, `onDone` at zero. */
export function countdown(seconds: number, onTick: (remaining: number) => void, onDone: () => void, ticker: Ticker = WINDOW_TICKER): { stop(): void } {
  let remaining = Math.max(0, Math.floor(seconds));
  onTick(remaining);
  if (remaining === 0) {
    onDone();
    return { stop: () => undefined };
  }
  const handle = ticker.setInterval(() => {
    remaining -= 1;
    onTick(remaining);
    if (remaining <= 0) {
      ticker.clearInterval(handle);
      onDone();
    }
  }, 1000);
  return { stop: () => ticker.clearInterval(handle) };
}
