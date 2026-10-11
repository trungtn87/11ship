import { h } from './dom.js';

// A modal dialog: role="dialog" aria-modal, a focus trap, Esc to close, focus returned to what opened it. The caller builds the
// body and the buttons. Nothing here knows about the screens that use it (lock/unlock of a user, later others).

export interface DialogOptions {
  readonly title: string;
  readonly description?: string;
  readonly body: readonly Node[];
  readonly actions: readonly HTMLElement[];
  /** Called when the dialog is dismissed with Esc (not when the caller closes it). Omit to make Esc do nothing. */
  readonly onDismiss?: () => void;
  /** Where to mount. The page body by default; the design preview mounts it inside its desktop frame. */
  readonly host?: HTMLElement;
}

export interface DialogHandle {
  readonly element: HTMLElement;
  close(): void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let serial = 0;

export function openDialog(options: DialogOptions): DialogHandle {
  serial += 1;
  const titleId = `dialog-title-${serial}`;
  const descriptionId = `dialog-description-${serial}`;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const contained = options.host !== undefined;
  const host = options.host ?? document.body;
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, ...(options.description === undefined ? {} : { 'aria-describedby': descriptionId }), tabindex: '-1' },
    h('h2', { id: titleId, class: 'dialog-title' }, options.title),
    options.description === undefined ? undefined : h('p', { id: descriptionId, class: 'dialog-text' }, options.description),
    ...options.body,
    h('div', { class: 'dialog-actions' }, ...options.actions),
  );
  const overlay = h('div', { class: contained ? 'dialog-overlay dialog-overlay-contained' : 'dialog-overlay' }, dialog);
  const app = contained ? undefined : document.getElementById('app');
  if (app !== null && app !== undefined) {
    app.setAttribute('inert', '');
  }
  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    overlay.removeEventListener('keydown', onKey);
    overlay.remove();
    if (app !== null && app !== undefined) {
      app.removeAttribute('inert');
    }
    if (opener !== undefined && opener.isConnected) {
      opener.focus();
    }
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && options.onDismiss !== undefined) {
      event.stopPropagation();
      options.onDismiss();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener('keydown', onKey);
  host.append(overlay);
  const firstField = dialog.querySelector<HTMLElement>('textarea, input, select');
  (firstField ?? dialog.querySelector<HTMLElement>('button') ?? dialog).focus();
  return { element: dialog, close };
}
