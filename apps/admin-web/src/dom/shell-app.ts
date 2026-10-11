import { AdminRole } from '../core/api.js';
import { Clock } from '../core/controller.js';
import { ProvisioningController } from '../core/provisioning-controller.js';
import { ADMIN_COPY } from '../core/messages.js';
import { formatRoute, parseRoute, Route } from '../core/routes.js';
import { h } from './dom.js';
import { ProvisioningView } from './provisioning-view.js';
import { ShellHost } from './view.js';

// What lives inside the signed-in shell: the left menu, the address (history API) and the SYSTEM invitation screens.
// The menu only HIDES what the role cannot use; the backend refuses it anyway (403 ADMIN_FORBIDDEN, shown as such).

export interface History {
  pathname(): string;
  search(): string;
  push(path: string): void;
  onPop(listener: () => void): () => void;
}

export class ShellApp implements ShellHost {
  #content: HTMLElement | undefined;
  #nav: HTMLElement | undefined;
  #role: AdminRole | undefined;
  #view: ProvisioningView | undefined;
  #unsubscribe: (() => void) | undefined;
  #unpop: (() => void) | undefined;

  constructor(
    private readonly provisioning: ProvisioningController,
    private readonly history: History,
    private readonly clock: Clock,
  ) {}

  mount(parts: { readonly content: HTMLElement; readonly nav: HTMLElement; readonly role: AdminRole }): void {
    this.unmount();
    this.#content = parts.content;
    this.#nav = parts.nav;
    this.#role = parts.role;
    this.#unpop = this.history.onPop(() => this.#apply());
    this.#apply();
  }

  unmount(): void {
    this.#unpop?.();
    this.#unpop = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#view?.dispose();
    this.#view = undefined;
    this.provisioning.clear();
    this.#content = undefined;
    this.#nav = undefined;
    this.#role = undefined;
  }

  go(route: Route): void {
    this.history.push(formatRoute(route));
    this.#apply();
  }

  #apply(): void {
    const content = this.#content;
    const role = this.#role;
    if (content === undefined || role === undefined) {
      return;
    }
    const route = parseRoute(this.history.pathname(), this.history.search());
    this.#renderNav(route, role);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#view?.dispose();
    this.#view = undefined;
    this.provisioning.clear();
    if (route.name === 'home' || route.name === 'activate') {
      content.replaceChildren(this.#home(role));
      return;
    }
    if (role !== 'SYSTEM') {
      content.replaceChildren(h('section', { class: 'content content-narrow' }, h('h1', { class: 'title' }, 'Không có quyền'), h('p', { class: 'message message-error', role: 'alert' }, ADMIN_COPY.forbidden)));
      return;
    }
    const view = new ProvisioningView(content, this.provisioning, (next) => this.go(next), this.clock);
    this.#view = view;
    this.#unsubscribe = this.provisioning.subscribe((screen) => view.render(screen));
    switch (route.name) {
      case 'invitations':
        void this.provisioning.openList(route.status ?? 'ALL');
        break;
      case 'invitation-new':
        void this.provisioning.openCompose('create');
        break;
      case 'invitation':
        void this.provisioning.openDetail(route.id);
        break;
      case 'invitation-reissue':
        void this.provisioning.openCompose('reissue', route.id);
        break;
      case 'invitation-revoke':
        void this.provisioning.openCompose('revoke', route.id);
        break;
    }
    view.render(this.provisioning.screen);
  }

  /** Landing page of the shell. Markup kept stable: it is what the login browser tests look for. */
  #home(role: AdminRole): HTMLElement {
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'shell-title' }, 'Đăng nhập thành công');
    const lead = h('p', { class: 'lead lead-last' }, 'Vai trò: ', h('span', { class: 'role-badge' }, role));
    const hint =
      role === 'SYSTEM'
        ? h('p', { class: 'lead' }, 'Dùng menu bên trái để mời và quản lý tài khoản ADMIN.')
        : h('p', { class: 'lead' }, 'Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau.');
    return h('section', { class: 'content content-narrow', 'aria-labelledby': 'shell-title' }, title, lead, hint);
  }

  #renderNav(route: Route, role: AdminRole): void {
    const nav = this.#nav;
    if (nav === undefined) {
      return;
    }
    const items: { label: string; route: Route; active: boolean }[] = [{ label: 'Tổng quan', route: { name: 'home' }, active: route.name === 'home' }];
    if (role === 'SYSTEM') {
      items.push({ label: 'Lời mời ADMIN', route: { name: 'invitations' }, active: route.name.startsWith('invitation') });
    }
    nav.replaceChildren(
      ...items.map((item) => {
        const anchor = h('a', { href: formatRoute(item.route), class: item.active ? 'nav-link nav-active' : 'nav-link', ...(item.active ? { 'aria-current': 'page' } : {}) }, item.label);
        anchor.addEventListener('click', (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          this.go(item.route);
        });
        return anchor;
      }),
    );
  }
}
