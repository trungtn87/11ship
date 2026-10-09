// A tiny DOM builder. Text always goes through createTextNode / textContent: nothing from the API, the form or the
// URL is ever parsed as HTML, so there is no innerHTML anywhere in this client.

export function h(tag, attrs, ...children) {
  const element = document.createElement(tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) {
        continue;
      }
      if (name.startsWith('on') && typeof value === 'function') {
        element.addEventListener(name.slice(2).toLowerCase(), value);
      } else if (name === 'class') {
        element.className = value;
      } else if (name === 'dataset') {
        for (const [key, item] of Object.entries(value)) {
          element.dataset[key] = String(item);
        }
      } else if (name === 'value' || name === 'checked' || name === 'disabled' || name === 'readOnly') {
        element[name] = value;
      } else {
        element.setAttribute(name, value === true ? '' : String(value));
      }
    }
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) {
      continue;
    }
    parent.append(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

export function clear(node) {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}

let idCounter = 0;
export function uniqueId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Polite status announcements (toasts) and assertive ones, in two always-present live regions. */
export function createAnnouncer(host) {
  const polite = h('div', { class: 'live-region', role: 'status', 'aria-live': 'polite' });
  const toasts = h('div', { class: 'toast-stack' });
  host.append(polite, toasts);
  return {
    say(message) {
      polite.textContent = '';
      // A change of text content is what screen readers announce: clear first, then set on the next frame.
      requestAnimationFrame(() => {
        polite.textContent = message;
      });
    },
    toast(message, tone = 'success') {
      const item = h('div', { class: `toast toast-${tone}` }, message);
      toasts.append(item);
      this.say(message);
      setTimeout(() => item.remove(), 4500);
    },
  };
}

/**
 * Modal confirmation on the native <dialog>: it traps focus, closes on Escape and returns focus to the control that
 * opened it. Resolves true only for the confirm button.
 */
export function confirmDialog({ title, body, confirmLabel, cancelLabel = 'Quay lại', tone = 'primary' }) {
  return new Promise((resolve) => {
    if (typeof HTMLDialogElement === 'undefined') {
      resolve(window.confirm(`${title}\n\n${body}`));
      return;
    }
    const opener = document.activeElement;
    const titleId = uniqueId('dialog-title');
    const bodyId = uniqueId('dialog-body');
    let answer = false;
    const dialog = h(
      'dialog',
      { class: 'dialog', 'aria-labelledby': titleId, 'aria-describedby': bodyId },
      h('h2', { id: titleId, class: 'dialog-title' }, title),
      h('p', { id: bodyId, class: 'dialog-body' }, body),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onClick: () => dialog.close() }, cancelLabel),
        h(
          'button',
          {
            type: 'button',
            class: tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary',
            onClick: () => {
              answer = true;
              dialog.close();
            },
          },
          confirmLabel,
        ),
      ),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('.btn-secondary')?.focus();
  });
}
