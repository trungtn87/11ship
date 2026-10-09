// Shared UI primitives. Every control is at least 48px high (brand minimum 44px), has a visible label and focus ring,
// and never relies on colour alone: a badge or alert always carries text.

import { h, uniqueId } from './dom.js';

export function Button({ label, variant = 'primary', type = 'button', loading = false, loadingLabel, disabled = false, onClick, id, block = false }) {
  const classes = ['btn', `btn-${variant}`, block ? 'btn-block' : '', loading ? 'is-loading' : ''].filter(Boolean).join(' ');
  const button = h(
    'button',
    {
      id,
      type,
      class: classes,
      // aria-disabled (not disabled) while loading: the button keeps focus and the layout does not jump.
      'aria-disabled': loading || disabled ? 'true' : null,
      'aria-busy': loading ? 'true' : null,
      onClick: (event) => {
        if (button.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
          return;
        }
        if (onClick) onClick(event);
      },
    },
    loading ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
    h('span', { class: 'btn-label' }, loading && loadingLabel ? loadingLabel : label),
  );
  return button;
}

/** Puts an existing button into / out of the loading state without rebuilding it. */
export function setButtonLoading(button, loading, label, loadingLabel) {
  button.classList.toggle('is-loading', loading);
  if (loading) {
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
  } else {
    button.removeAttribute('aria-disabled');
    button.removeAttribute('aria-busy');
  }
  const text = button.querySelector('.btn-label');
  if (text) text.textContent = loading && loadingLabel ? loadingLabel : label;
  const spinner = button.querySelector('.spinner');
  if (loading && !spinner) {
    button.prepend(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
  } else if (!loading && spinner) {
    spinner.remove();
  }
}

/**
 * A labelled field. `control` is built by the caller with the returned ids so label, help and error are wired with
 * for / aria-describedby / aria-invalid. Returns { root, setError, input }.
 */
export function Field({ label, required = false, help, inputAttrs = {}, multiline = false, trailing }) {
  const id = uniqueId('f');
  const helpId = help ? `${id}-help` : null;
  const errorId = `${id}-error`;
  const input = h(multiline ? 'textarea' : 'input', {
    id,
    class: multiline ? 'input textarea' : 'input',
    'aria-describedby': [helpId, errorId].filter(Boolean).join(' '),
    ...(multiline ? { rows: 3 } : { type: 'text' }),
    ...inputAttrs,
  });
  const errorBox = h('p', { id: errorId, class: 'field-error', hidden: true });
  errorBox.hidden = true;
  const root = h(
    'div',
    { class: 'field' },
    h('label', { class: 'label', for: id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : h('span', { class: 'opt' }, ' (không bắt buộc)')),
    trailing ? h('div', { class: 'input-row' }, input, trailing) : input,
    help ? h('p', { id: helpId, class: 'help' }, help) : null,
    errorBox,
  );
  return {
    root,
    input,
    setError(message) {
      if (message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
        input.setAttribute('aria-invalid', 'true');
      } else {
        errorBox.textContent = '';
        errorBox.hidden = true;
        input.removeAttribute('aria-invalid');
      }
    },
  };
}

/** A password field with a show / hide toggle (a real button, keyboard reachable, state announced). */
export function PasswordField({ label = 'Mật khẩu', autocomplete = 'current-password' }) {
  let visible = false;
  const toggle = h('button', { type: 'button', class: 'btn btn-ghost toggle-visibility', 'aria-pressed': 'false' }, 'Hiện');
  const field = Field({
    label,
    required: true,
    inputAttrs: { type: 'password', autocomplete, autocapitalize: 'none', spellcheck: 'false', name: 'password' },
    trailing: toggle,
  });
  toggle.addEventListener('click', () => {
    visible = !visible;
    field.input.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Ẩn' : 'Hiện';
    toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggle.setAttribute('aria-label', visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  toggle.setAttribute('aria-label', 'Hiện mật khẩu');
  return field;
}

export function Badge({ tone = 'neutral', label }) {
  return h('span', { class: `badge badge-${tone}` }, h('span', { class: 'badge-dot', 'aria-hidden': 'true' }), label);
}

/**
 * An inline message. tone: info | success | warning | danger. role=alert for danger and warning so assistive tech
 * reads it at once; `detail` (status, code, request id) hides behind a native <details>.
 */
export function Alert({ tone = 'info', title, message, detail, actions }) {
  const detailRows =
    detail === undefined || detail === null
      ? null
      : [
          detail.status !== null && detail.status !== undefined ? `Mã HTTP: ${detail.status}` : null,
          detail.code ? `Mã lỗi: ${detail.code}` : null,
          detail.requestId ? `Mã yêu cầu: ${detail.requestId}` : null,
        ].filter(Boolean);
  return h(
    'div',
    { class: `alert alert-${tone}`, role: tone === 'danger' || tone === 'warning' ? 'alert' : 'status' },
    title ? h('p', { class: 'alert-title' }, title) : null,
    h('p', { class: 'alert-message' }, message),
    detailRows && detailRows.length > 0
      ? h('details', { class: 'alert-detail' }, h('summary', null, 'Chi tiết lỗi'), h('ul', null, detailRows.map((row) => h('li', null, row))))
      : null,
    actions ? h('div', { class: 'alert-actions' }, actions) : null,
  );
}

export function Skeleton({ lines = 3 }) {
  return h(
    'div',
    { class: 'skeleton', 'aria-hidden': 'true' },
    Array.from({ length: lines }, (_, index) => h('span', { class: `skeleton-line${index === lines - 1 ? ' short' : ''}` })),
  );
}

export function Card({ className = '', children }) {
  return h('section', { class: `card ${className}`.trim() }, children);
}

export function Heading({ text, level = 1, id }) {
  // tabindex -1: the router moves focus here after every screen change so screen readers announce the new screen.
  return h(`h${level}`, { id, class: level === 1 ? 'h1' : 'h2', tabindex: level === 1 ? '-1' : null }, text);
}
