import { AccountsSource, EMPTY_USER_FILTER, NOT_WIRED_SOURCE, UserFilter } from '../core/accounts.js';
import { AdminRole } from '../core/api.js';
import { Clock } from '../core/controller.js';
import { breadcrumb, canOpenRoute, Grants, NO_GRANTS } from '../core/menu.js';
import { ProvisioningController } from '../core/provisioning-controller.js';
import { formatRoute, parseRoute, Route } from '../core/routes.js';
import { AccountsHooks, AdministratorsView, renderUserDetail, UsersView } from './accounts-view.js';
import { h } from './dom.js';
import { ProvisioningView } from './provisioning-view.js';
import { ShellLayout } from './shell-layout.js';
import { failurePanel } from './states.js';
import { ShellHost } from './view.js';

// What lives inside the signed-in shell: the address (history API), the menu, and the pages. The menu only HIDES what the
// role cannot use; the backend refuses it anyway (403 ADMIN_FORBIDDEN, shown as such). A page the role may not open shows
// the "no permission" state, never a blank area.

export interface History {
  pathname(): string;
  search(): string;
  push(path: string): void;
  onPop(listener: () => void): () => void;
  /** Back to the start page (a full load, which re-checks the session). */
  restart(): void;
}

const FILTER_DELAY_MS = 300;

export class ShellApp implements ShellHost {
  #layout: ShellLayout | undefined;
  #role: AdminRole | undefined;
  #view: ProvisioningView | undefined;
  #unsubscribe: (() => void) | undefined;
  #unpop: (() => void) | undefined;
  #generation = 0;
  #filterTimer: unknown;

  constructor(
    private readonly provisioning: ProvisioningController,
    private readonly history: History,
    private readonly clock: Clock,
    /** Where the account pages get their data. Nothing is wired yet, so by default every page says so. */
    private readonly source: AccountsSource = NOT_WIRED_SOURCE,
    /** What an ADMIN was granted. The backend does not send it yet, so by default an ADMIN is granted nothing. */
    private readonly grants: Grants = NO_GRANTS,
  ) {}

  mount(parts: { readonly layout: ShellLayout; readonly role: AdminRole }): void {
    this.unmount();
    this.#layout = parts.layout;
    this.#role = parts.role;
    this.#unpop = this.history.onPop(() => this.#apply());
    this.#apply();
  }

  unmount(): void {
    this.#unpop?.();
    this.#unpop = undefined;
    this.#teardown();
    this.provisioning.clear();
    this.#layout = undefined;
    this.#role = undefined;
  }

  go(route: Route): void {
    this.history.push(formatRoute(route));
    this.#apply();
    this.#layout?.content.focus({ preventScroll: true });
  }

  #teardown(): void {
    this.#generation += 1;
    if (this.#filterTimer !== undefined) {
      this.clock.clearTimeout(this.#filterTimer);
      this.#filterTimer = undefined;
    }
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#view?.dispose();
    this.#view = undefined;
  }

  #apply(): void {
    const layout = this.#layout;
    const role = this.#role;
    if (layout === undefined || role === undefined) {
      return;
    }
    const content = layout.content;
    const route = parseRoute(this.history.pathname(), this.history.search());
    layout.render({ role, grants: this.grants, route, navigate: (next) => this.go(next) });
    document.title = `${breadcrumb(route).at(-1) ?? 'Tổng quan'} · Quản trị · 11`;
    this.#teardown();
    this.provisioning.clear();
    if (route.name === 'home' || route.name === 'activate' || route.name === 'reset') {
      content.replaceChildren(this.#home(role));
      return;
    }
    if (!canOpenRoute(role, this.grants, route)) {
      content.replaceChildren(this.#forbidden());
      return;
    }
    switch (route.name) {
      case 'users':
        this.#users(content, route.status === 'LOCKED' ? { ...EMPTY_USER_FILTER, status: 'LOCKED' } : EMPTY_USER_FILTER);
        return;
      case 'user':
        this.#user(content, route.id);
        return;
      case 'administrators':
        this.#administrators(content);
        return;
      default:
        this.#invitations(content, route);
    }
  }

  #wired(): boolean {
    return this.source !== NOT_WIRED_SOURCE;
  }

  #hooks(reload: () => void): AccountsHooks {
    return {
      wired: this.#wired(),
      filter: () => undefined,
      refresh: reload,
      retry: reload,
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      open: (id) => this.go({ name: 'user', id }),
      loadMore: () => undefined,
    };
  }

  #users(content: HTMLElement, initial: UserFilter): void {
    const generation = this.#generation;
    let filter = initial;
    const view = new UsersView(content, {
      ...this.#hooks(() => load()),
      filter: (next) => {
        filter = next;
        if (this.#filterTimer !== undefined) {
          this.clock.clearTimeout(this.#filterTimer);
        }
        this.#filterTimer = this.clock.setTimeout(() => {
          this.#filterTimer = undefined;
          if (generation === this.#generation) {
            load();
          }
        }, FILTER_DELAY_MS);
      },
    });
    const load = (): void => {
      view.render({ name: 'users', filter, state: { kind: 'loading' } });
      void this.source.users(filter).then((state) => {
        if (generation === this.#generation) {
          view.render({ name: 'users', filter, state });
        }
      });
    };
    load();
  }

  #user(content: HTMLElement, id: string): void {
    const generation = this.#generation;
    const load = (): void => {
      draw({ kind: 'loading' });
      void this.source.user(id).then((state) => {
        if (generation === this.#generation) {
          draw(state);
        }
      });
    };
    const draw = (state: Parameters<typeof renderUserDetail>[0]['state']): void => {
      content.replaceChildren(
        renderUserDetail(
          { name: 'user', id, state },
          {
            wired: this.#wired(),
            back: () => this.go({ name: 'users' }),
            reload: load,
            retry: load,
            login: () => this.history.restart(),
            home: () => this.go({ name: 'home' }),
            // Lock and unlock are not wired (backend M01.32, screen M01.33): the buttons exist only in the design preview.
            action: () => undefined,
          },
        ),
      );
    };
    load();
  }

  #administrators(content: HTMLElement): void {
    const generation = this.#generation;
    const view = new AdministratorsView(content, {
      retry: () => load(),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      invite: () => this.go({ name: 'invitation-new' }),
    });
    const load = (): void => {
      view.render({ name: 'administrators', state: { kind: 'loading' } });
      void this.source.administrators().then((state) => {
        if (generation === this.#generation) {
          view.render({ name: 'administrators', state });
        }
      });
    };
    load();
  }

  #invitations(content: HTMLElement, route: Route): void {
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

  #forbidden(): HTMLElement {
    return h('section', { class: 'content content-narrow' }, h('h1', { class: 'title', tabindex: '-1' }, 'Không có quyền'), failurePanel('forbidden', { home: () => this.go({ name: 'home' }) }));
  }

  /** Landing page of the shell. Markup kept stable: it is what the login browser tests look for. */
  #home(role: AdminRole): HTMLElement {
    const title = h('h1', { class: 'title', tabindex: '-1', id: 'shell-title' }, 'Đăng nhập thành công');
    const lead = h('p', { class: 'lead lead-last' }, 'Vai trò: ', h('span', { class: 'role-badge' }, role));
    const hint =
      role === 'SYSTEM'
        ? h('p', { class: 'lead' }, 'Dùng menu bên trái để mời và quản lý tài khoản ADMIN. Các mục có nhãn “Sắp có” sẽ được mở ở bước sau.')
        : h('p', { class: 'lead' }, 'Các chức năng quản lý dành cho ADMIN sẽ có ở bước sau.');
    return h('section', { class: 'content content-narrow', 'aria-labelledby': 'shell-title' }, title, lead, hint);
  }
}
