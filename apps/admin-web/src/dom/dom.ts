import { encodeQr, qrPath } from '../core/qr.js';

// DOM helpers shared by every view. Nodes are built with createElement/textContent only (no innerHTML), so no server
// value can become markup.

export type Attrs = Record<string, string | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | undefined)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child !== undefined) {
      element.append(child);
    }
  }
  return element;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Record<string, string>, ...children: SVGElement[]): SVGElement {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/** 24x24, stroke 2, round caps: the brand icon grid. */
export function eyeIcon(open: boolean): SVGElement {
  const paths = [
    svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z' }),
    svg('circle', { cx: '12', cy: '12', r: '3' }),
  ];
  if (!open) {
    paths.push(svg('path', { d: 'M3 3l18 18' }));
  }
  return svg(
    'svg',
    { viewBox: '0 0 24 24', width: '24', height: '24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' },
    ...paths,
  );
}

/**
 * The brand slot: the Owner-approved "11" logo (public/logo-11-ui.png, cropped and resized from docs/brand/originals by
 * tools/brand/build-brand-assets.py; never redrawn) followed by the name of this console. The logo has dark ink, so on the dark
 * sidebar it sits on a light tile (see styles.css).
 */
export function brand(): HTMLElement {
  return h(
    'div',
    { class: 'brand' },
    h('span', { class: 'brand-tile' }, h('img', { class: 'brand-logo', src: '/logo-11-ui.png', alt: '11' })),
    h('span', { class: 'brand-text' }, h('span', { class: 'brand-title' }, '11 Admin'), h('span', { class: 'brand-name' }, 'Quản trị')),
  );
}

/**
 * The page around the signed-out screens (login, 2FA, activation, reset): a dark panel that says this is the ADMIN area,
 * and the screen's card on the light side (M01 Design, AdminView). On narrow screens the panel shrinks to a band on top.
 */
export function authPage(card: HTMLElement): HTMLElement {
  const aside = h(
    'aside',
    { class: 'auth-aside', 'aria-label': 'Khu vực quản trị' },
    h('span', { class: 'auth-tile' }, h('img', { class: 'auth-logo', src: '/logo-11-ui.png', alt: '11' })),
    h(
      'div',
      { class: 'auth-intro' },
      h('span', { class: 'auth-badge' }, 'ADMIN'),
      h('p', { class: 'auth-title' }, 'Quản trị hệ sinh thái 11'),
      h('p', { class: 'auth-text' }, 'Khu vực dành riêng cho quản trị viên. Không dành cho khách hàng, chủ quán hay shipper.'),
    ),
    h('p', { class: 'auth-slogan' }, '11 — Cần là có'),
  );
  return h('div', { class: 'page page-auth' }, aside, h('main', { class: 'main' }, card));
}

export function message(kind: 'error' | 'notice' | 'warning', id: string): HTMLElement {
  // Live regions exist from the first render (empty) so screen readers announce later changes.
  return h('p', { id, class: `message message-${kind}`, role: kind === 'error' ? 'alert' : 'status', hidden: true });
}

export function setMessage(element: HTMLElement, text: string | undefined): void {
  const value = text ?? '';
  if (element.textContent !== value) {
    element.textContent = value;
  }
  element.hidden = value === '';
}

export function field(label: string, id: string, input: HTMLInputElement, extra?: HTMLElement, after?: HTMLElement): HTMLElement {
  const wrap = h('div', { class: 'input-wrap' }, input, extra);
  return h('div', { class: 'field' }, h('label', { for: id, class: 'label' }, label), wrap, after);
}

export function primary(label: string, type: 'submit' | 'button' = 'submit'): HTMLButtonElement {
  return h('button', { type, class: 'btn btn-primary' }, label);
}

export function secondary(label: string): HTMLButtonElement {
  return h('button', { type: 'button', class: 'btn btn-secondary' }, label);
}

/** The QR of an otpauth URI as an inline SVG (drawn locally; the URI goes nowhere). White quiet zone, dark modules. */
export function renderQr(uri: string, size = 208): SVGElement {
  const matrix = encodeQr(uri);
  const quiet = 4;
  const box = String(matrix.size + quiet * 2);
  return svg(
    'svg',
    { viewBox: `0 0 ${box} ${box}`, width: String(size), height: String(size), 'shape-rendering': 'crispEdges', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { width: box, height: box, fill: '#FFFFFF' }),
    svg('path', { d: qrPath(matrix, quiet), fill: '#2A2A2E' }),
  );
}

/**
 * dd/mm/yyyy HH:mm on the VIETNAM clock (Asia/Ho_Chi_Minh), whatever zone the browser is set to: every moment of the administration (periods, filters,
 * reports) is a Vietnam moment, so a time on screen must not shift with the machine of whoever looks at it. Unparseable input is shown as is (never throws).
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** A six-digit code field: numeric keypad, one-time-code autofill, and paste/typing reduced to ASCII digits (leading zeros kept: it is a string). */
export function codeInput(id: string, errorId: string): HTMLInputElement {
  return h('input', {
    id,
    name: 'code',
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    pattern: '[0-9]*',
    class: 'code-input',
    'aria-describedby': errorId,
    spellcheck: 'false',
    maxlength: '64',
  });
}

/** Copies text with the Clipboard API; false when the browser refuses (the caller shows a manual-copy hint). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The small "Bước x/y · title" label above a step. */
export function stepLabel(text: string): HTMLElement {
  return h('p', { class: 'step-label' }, text);
}
