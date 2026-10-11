import { activeMenuId, entryRoute, MenuGroup, MenuItem, MenuLeaf } from '../core/menu.js';
import { formatRoute, Route } from '../core/routes.js';
import { h } from './dom.js';
import { icon } from './icons.js';

// Draws the menu list into the sidebar. Ready entries are real links (`<a href>`: middle-click and "open in a new tab"
// work, and a click is routed in the page); announced entries ("Sắp có") are focusable but inert buttons with
// `aria-disabled`, so they never lead to a blank page and a screen reader still hears what they are.

export interface MenuView {
  readonly groups: readonly MenuGroup[];
  readonly route: Route;
  /** Collapsed rail (64 px): only icons; a parent entry then goes straight to its first child. */
  readonly collapsed: boolean;
  /** Ids of the parents whose children are shown (expanded sidebar). */
  readonly expanded: ReadonlySet<string>;
  readonly navigate: (route: Route) => void;
  readonly toggle: (id: string) => void;
}

function plainClick(event: MouseEvent): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function link(item: MenuLeaf, route: Route, active: boolean, view: MenuView, child: boolean): HTMLElement {
  const label = h('span', { class: 'side-label' }, item.label);
  const anchor = h(
    'a',
    {
      href: formatRoute(route),
      class: `side-link${child ? ' side-child' : ''}${active ? ' side-active' : ''}`,
      title: item.label,
      'aria-label': item.label,
      ...(active ? { 'aria-current': 'page' } : {}),
    },
    ...(child || item.icon === undefined ? [] : [icon(item.icon)]),
    label,
  );
  anchor.addEventListener('click', (event) => {
    if (plainClick(event)) {
      event.preventDefault();
      view.navigate(route);
    }
  });
  return anchor;
}

function soonEntry(item: MenuItem): HTMLElement {
  return h(
    'button',
    { type: 'button', class: 'side-link side-soon', 'aria-disabled': 'true', title: `${item.label} - Sắp có`, 'aria-label': `${item.label}, sắp có` },
    icon(item.icon),
    h('span', { class: 'side-label' }, item.label),
    h('span', { class: 'side-badge' }, 'Sắp có'),
  );
}

function parentEntry(item: MenuItem, active: boolean, view: MenuView): HTMLElement {
  const open = view.expanded.has(item.id) && !view.collapsed;
  const subId = `side-sub-${item.id}`;
  const button = h(
    'button',
    {
      type: 'button',
      class: `side-link side-parent${active ? ' side-active-parent' : ''}`,
      title: item.label,
      'aria-label': item.label,
      'aria-expanded': String(open),
      'aria-controls': subId,
    },
    icon(item.icon),
    h('span', { class: 'side-label' }, item.label),
    h('span', { class: 'side-chevron' }, icon(open ? 'chevron-up' : 'chevron-down', 16)),
  );
  button.addEventListener('click', () => {
    if (view.collapsed) {
      const target = entryRoute(item);
      if (target !== undefined) {
        view.navigate(target);
      }
      return;
    }
    view.toggle(item.id);
  });
  return button;
}

export function renderMenu(nav: HTMLElement, view: MenuView): void {
  const activeId = activeMenuId(view.route);
  const sections: HTMLElement[] = [];
  view.groups.forEach((group, index) => {
    const entries = group.items.map((item) => {
      if (!item.ready) {
        return h('li', {}, soonEntry(item));
      }
      if (item.children === undefined) {
        const target = item.route;
        return h('li', {}, target === undefined ? soonEntry(item) : link(item, target, activeId === item.id, view, false));
      }
      const childActive = item.children.some((child) => child.id === activeId);
      const open = view.expanded.has(item.id) && !view.collapsed;
      const sub = h(
        'ul',
        { id: `side-sub-${item.id}`, class: 'side-sub', ...(open ? {} : { hidden: true }) },
        ...item.children.map((child) => h('li', {}, child.route === undefined ? undefined : link(child, child.route, child.id === activeId, view, true))),
      );
      return h('li', { class: 'side-item' }, parentEntry(item, childActive, view), sub);
    });
    const headingId = `side-heading-${group.id}`;
    sections.push(
      h(
        'div',
        { class: 'side-group', ...(group.label === undefined ? {} : { role: 'group', 'aria-labelledby': headingId }) },
        index === 0 || group.label === undefined ? undefined : h('div', { class: 'side-rule', 'aria-hidden': 'true' }),
        group.label === undefined ? undefined : h('p', { id: headingId, class: 'side-heading' }, group.label),
        h('ul', { class: 'side-list' }, ...entries),
      ),
    );
  });
  nav.replaceChildren(...sections);
}
