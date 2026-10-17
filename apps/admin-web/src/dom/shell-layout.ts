import { AdminRole } from '../core/api.js';
import { activeMenuId, breadcrumb, compactSidebar, DRAWER_QUERY, Grants, MENU, MenuGroup, visibleMenu } from '../core/menu.js';
import { formatRoute, Route } from '../core/routes.js';
import { brand, h, message } from './dom.js';
import { icon } from './icons.js';
import { renderMenu } from './sidebar.js';

// The frame of every signed-in page: sidebar (240 px, or a 64 px rail, or a drawer on a narrow screen), top bar with the
// breadcrumb, and the content area. It draws no business content. The real app and the design preview use this same
// function, so the Owner reviews the real frame.

const COLLAPSE_KEY = '11admin.sidebar';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ShellOptions {
  /** Called when "Đăng xuất" is chosen. */
  readonly onLogout: () => void;
  /** Where the collapsed/expanded choice is remembered. Omitted (design preview) = remembered nowhere. */
  readonly store?: KeyValueStore;
  /** Preview only: start collapsed or with the drawer open. */
  readonly initial?: { readonly collapsed?: boolean; readonly drawerOpen?: boolean; readonly accountMenuOpen?: boolean };
  /** Tells whether the window is narrow (drawer mode). Default: the browser's `matchMedia(DRAWER_QUERY)`. */
  readonly viewport?: DrawerViewport;
}

export interface DrawerViewport {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export interface ShellState {
  readonly role: AdminRole;
  readonly grants: Grants;
  readonly route: Route;
  readonly navigate: (route: Route) => void;
}

export interface ShellLayout {
  readonly root: HTMLElement;
  /** Where the page content goes. Focused after a route change. */
  readonly content: HTMLElement;
  readonly notice: HTMLElement;
  readonly error: HTMLElement;
  readonly logout: HTMLButtonElement;
  /** The text inside the logout item (changes to "Đang đăng xuất…" while the request runs). */
  readonly logoutLabel: HTMLElement;
  render(state: ShellState): void;
  setDrawer(open: boolean): void;
  /** Removes the listener this frame put on the document. */
  dispose(): void;
}

function readCollapsed(store: KeyValueStore | undefined): boolean {
  try {
    return store?.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function writeCollapsed(store: KeyValueStore | undefined, collapsed: boolean): void {
  try {
    store?.setItem(COLLAPSE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Not kept (storage blocked): the choice still holds for this page.
  }
}

function accountOf(role: AdminRole): { readonly name: string; readonly caption: string } {
  return role === 'SYSTEM' ? { name: 'SYSTEM', caption: 'Tài khoản hệ thống' } : { name: 'ADMIN', caption: 'Quản trị viên' };
}

export function buildShell(options: ShellOptions): ShellLayout {
  let collapsed = options.initial?.collapsed ?? readCollapsed(options.store);
  let drawerOpen = options.initial?.drawerOpen ?? false;
  let accountOpen = options.initial?.accountMenuOpen ?? false;
  const expanded = new Set<string>(['users']);
  let lastActive: string | undefined;
  let last: ShellState | undefined;
  const viewport: DrawerViewport | undefined = options.viewport ?? (typeof window.matchMedia === 'function' ? window.matchMedia(DRAWER_QUERY) : undefined);
  // The rail (collapsed) is a desktop-only mode; in drawer mode the menu is always shown in full.
  const compact = (): boolean => compactSidebar(collapsed, viewport?.matches === true);

  const root = h('div', { class: 'shell' });
  const nav = h('nav', { class: 'side-nav', id: 'side-nav', 'aria-label': 'Chức năng quản trị' });
  const toggle = h('button', { type: 'button', class: 'side-toggle', 'aria-controls': 'side-nav' });
  const accountButton = h('button', { type: 'button', class: 'side-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'account-menu', 'aria-label': 'Menu tài khoản' }, icon('more'));
  const accountName = h('span', { class: 'side-account-name' });
  const accountCaption = h('span', { class: 'side-account-caption' });
  const logoutLabel = h('span', {}, 'Đăng xuất');
  const logout = h('button', { type: 'button', class: 'menu-item menu-item-danger', role: 'menuitem' }, icon('log-out', 18), logoutLabel);
  const resetEntry = h('span', { class: 'menu-slot' });
  const menu = h(
    'div',
    { id: 'account-menu', class: 'account-menu', role: 'menu', 'aria-label': 'Tài khoản', hidden: true },
    h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'aria-disabled': 'true' }, icon('user', 18), h('span', {}, 'Hồ sơ của tôi'), h('span', { class: 'side-badge' }, 'Sắp có')),
    resetEntry,
    logout,
  );
  const foot = h(
    'div',
    { class: 'side-foot' },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, icon('user', 18)),
    h('span', { class: 'side-account' }, accountName, accountCaption),
    accountButton,
    menu,
  );
  const sidebar = h('aside', { class: 'sidebar' }, h('div', { class: 'side-head' }, brand(), toggle), nav, foot);
  const scrim = h('button', { type: 'button', class: 'shell-scrim', tabindex: '-1', 'aria-label': 'Đóng menu' });
  const hamburger = h('button', { type: 'button', class: 'shellbar-menu', 'aria-label': 'Mở menu', 'aria-controls': 'side-nav', 'aria-expanded': 'false' }, icon('menu', 24));
  const crumbs = h('ol', { class: 'crumbs' });
  const roleChip = h('span', { class: 'shellbar-role' });
  const help = h('button', { type: 'button', class: 'shellbar-help', 'aria-disabled': 'true', title: 'Trợ giúp - Sắp có', 'aria-label': 'Trợ giúp, sắp có' }, icon('help', 22));
  const bar = h(
    'header',
    { class: 'shellbar' },
    hamburger,
    h('nav', { class: 'crumbs-nav', 'aria-label': 'Vị trí hiện tại' }, crumbs),
    help,
    h('span', { class: 'shellbar-account' }, h('span', { class: 'avatar avatar-small', 'aria-hidden': 'true' }, icon('user', 16)), roleChip),
  );
  const notice = message('notice', 'shell-notice');
  const error = message('error', 'shell-error');
  const content = h('div', { class: 'content-area', id: 'content', tabindex: '-1' });
  root.append(sidebar, scrim, h('div', { class: 'shell-body' }, bar, h('main', { class: 'shell-main' }, notice, error, content)));

  const closeAccountMenu = (): void => {
    accountOpen = false;
    menu.hidden = true;
    accountButton.setAttribute('aria-expanded', 'false');
  };
  const apply = (): void => {
    root.classList.toggle('shell-collapsed', compact());
    root.classList.toggle('shell-drawer-open', drawerOpen);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Mở rộng menu' : 'Thu gọn menu');
    toggle.title = collapsed ? 'Mở rộng menu' : 'Thu gọn menu';
    toggle.replaceChildren(icon(collapsed ? 'chevrons-right' : 'chevrons-left'));
    hamburger.setAttribute('aria-expanded', String(drawerOpen));
    scrim.hidden = !drawerOpen;
    menu.hidden = !accountOpen;
    accountButton.setAttribute('aria-expanded', String(accountOpen));
  };
  const redraw = (): void => {
    if (last === undefined) {
      return;
    }
    const state = last;
    const groups: readonly MenuGroup[] = visibleMenu(state.role, state.grants);
    renderMenu(nav, {
      groups,
      route: state.route,
      collapsed: compact(),
      expanded,
      navigate: (route) => {
        drawerOpen = false;
        closeAccountMenu();
        apply();
        state.navigate(route);
      },
      toggle: (id) => {
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
        }
        redraw();
      },
    });
  };
  const setCollapsed = (value: boolean): void => {
    collapsed = value;
    writeCollapsed(options.store, collapsed);
    apply();
    redraw();
  };
  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  hamburger.addEventListener('click', () => {
    drawerOpen = !drawerOpen;
    apply();
    if (drawerOpen) {
      nav.querySelector<HTMLElement>('a, button')?.focus();
    }
  });
  scrim.addEventListener('click', () => {
    drawerOpen = false;
    apply();
    hamburger.focus();
  });
  accountButton.addEventListener('click', () => {
    accountOpen = !accountOpen;
    apply();
    if (accountOpen) {
      menu.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    }
  });
  logout.addEventListener('click', () => {
    closeAccountMenu();
    options.onLogout();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    if (accountOpen) {
      closeAccountMenu();
      accountButton.focus();
    } else if (drawerOpen) {
      drawerOpen = false;
      apply();
      hamburger.focus();
    }
  });
  const outside = (event: MouseEvent): void => {
    if (accountOpen && event.target instanceof Node && !foot.contains(event.target)) {
      closeAccountMenu();
    }
  };
  document.addEventListener('click', outside);
  // Crossing the breakpoint switches mode: the drawer starts closed on the way in and out, and the saved rail choice is kept.
  const onViewport = (): void => {
    // No slide animation while the mode changes: a sidebar that is still sliding away (or kept visible by the delayed
    // visibility transition) would sit on top of the menu button for a moment and swallow the first tap.
    root.classList.add('shell-instant');
    drawerOpen = false;
    closeAccountMenu();
    apply();
    redraw();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => root.classList.remove('shell-instant')));
  };
  viewport?.addEventListener('change', onViewport);
  // Actions that are only announced never run.
  root.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]') !== null) {
      event.preventDefault();
    }
  });

  apply();
  return {
    root,
    content,
    notice,
    error,
    logout,
    logoutLabel,
    setDrawer: (open) => {
      drawerOpen = open;
      apply();
    },
    dispose: () => {
      document.removeEventListener('click', outside);
      viewport?.removeEventListener('change', onViewport);
    },
    render: (state) => {
      last = state;
      // Opening a page (a bookmark, a reload) shows its own menu entry: the parent of the current page opens once per page.
      const activeId = activeMenuId(state.route);
      if (activeId !== lastActive) {
        lastActive = activeId;
        for (const group of MENU) {
          for (const item of group.items) {
            if (item.children?.some((child) => child.id === activeId) === true) {
              expanded.add(item.id);
            }
          }
        }
      }
      const account = accountOf(state.role);
      accountName.textContent = account.name;
      accountCaption.textContent = account.caption;
      roleChip.textContent = account.name;
      crumbs.replaceChildren(
        ...breadcrumb(state.route).map((text, index, all) => h('li', index === all.length - 1 ? { 'aria-current': 'page' } : {}, text)),
      );
      // ADMIN resets a forgotten password through the public page; SYSTEM recovers through the server tools (design D08/D09).
      resetEntry.replaceChildren(
        state.role === 'SYSTEM'
          ? h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'aria-disabled': 'true', title: 'SYSTEM khôi phục bằng công cụ trên máy chủ' }, icon('key', 18), h('span', {}, 'Đặt lại mật khẩu'), h('span', { class: 'side-badge' }, 'Máy chủ'))
          : h('a', { href: formatRoute({ name: 'reset' }), class: 'menu-item', role: 'menuitem' }, icon('key', 18), h('span', {}, 'Đặt lại mật khẩu')),
      );
      redraw();
    },
  };
}
