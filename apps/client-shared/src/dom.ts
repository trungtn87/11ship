// DOM helpers shared by the 11Food and 11Ship UI. Nodes are built with createElement/textContent only (no innerHTML), so a
// value that came from a server or from the person typing can never become markup.

export type Attrs = Record<string, string | boolean | undefined>;
export type Child = Node | string | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) {
    if (child !== undefined && child !== null && child !== false) {
      element.append(child);
    }
  }
  return element;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** Sets text only when it changed (keeps screen-reader live regions quiet) and toggles `hidden` for empty text. */
export function setText(element: HTMLElement, text: string | undefined): void {
  const value = text ?? '';
  if (element.textContent !== value) {
    element.textContent = value;
  }
  element.hidden = value === '';
}

/** mm:ss for a whole number of seconds (>= 0). */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** dd/mm/yyyy HH:mm in the browser's zone. Unparseable input is shown as is (never throws). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
