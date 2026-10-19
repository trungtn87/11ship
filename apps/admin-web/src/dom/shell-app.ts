import {
  AccountsSource,
  AdministratorFilter,
  AdministratorRow,
  EMPTY_ADMIN_FILTER,
  EMPTY_USER_FILTER,
  Failure,
  ListState,
  LOCK_MESSAGE,
  LockCommand,
  LockDialog,
  LockResult,
  NOT_WIRED_SOURCE,
  PageState,
  UserDetail,
  UserFilter,
  UserRole,
  UserRow,
} from '../core/accounts.js';
import { AdminRole } from '../core/api.js';
import { Clock } from '../core/controller.js';
import { breadcrumb, canOpenRoute, Grants, NO_GRANTS } from '../core/menu.js';
import { ProvisioningController } from '../core/provisioning-controller.js';
import {
  NOT_WIRED_SETTINGS,
  PhoneVerificationSettings,
  SaveCommand,
  SaveResult,
  SETTINGS_MESSAGE,
  SettingsDraft,
  SettingsPhase,
  SettingsSource,
  SettingsState,
} from '../core/settings.js';
import { routeOfLink, formatRoute, parseRoute, Route } from '../core/routes.js';
import { AccountsHooks, AdministratorsView, openLockDialog, renderUserDetail, UsersView } from './accounts-view.js';
import { DialogHandle } from './dialog.js';
import { h } from './dom.js';
import { ProvisioningView } from './provisioning-view.js';
import { SettingsView } from './settings-view.js';
import { NOT_WIRED_CATALOG, CatalogSource } from '../core/catalog.js';
import { CatalogController } from '../core/catalog-controller.js';
import { CatalogView } from './catalog-view.js';
import { NOT_WIRED_SHIPPERS, ShipperFilter, ShipperSource } from '../core/shippers.js';
import { ShipperDetailView, ShipperHost, ShipperListView, WalletParametersView } from './shippers-view.js';
import { NOT_WIRED_SHIPPING, ShippingPolicySource } from '../core/shipping-policy.js';
import { ShippingPolicyView } from './shipping-policy-view.js';
import { DeliverySource, NOT_WIRED_DELIVERIES } from '../core/deliveries.js';
import { NOT_WIRED_OVERVIEW, OverviewSource } from '../core/overview.js';
import { OverviewHost, OverviewView } from './overview-view.js';
import { DeliveryHost, DeliveryListView } from './deliveries-view.js';
import { NOT_WIRED_NOTIFICATIONS, NotificationSource } from '../core/notifications.js';
import { NotificationHost, NotificationsView } from './notifications-view.js';
import { FinanceController, isFinanceRoute } from '../core/finance-controller.js';
import { FinanceSource, NOT_WIRED_FINANCE } from '../core/finance.js';
import { FinanceView } from './finance-view.js';
import { FinanceAdminSource, FinanceRights, NO_FINANCE_RIGHTS, NOT_WIRED_FINANCE_ADMIN, TopupFilter } from '../core/finance-admin.js';
import { BankAccountsView, FinanceAdminHost, FINANCE_RECORD_REQUIRES_READ, openFinanceAccessDialog, TopupDetailView, TopupListView } from './finance-admin-view.js';
import { statePanel } from './states.js';
import { ShellLayout } from './shell-layout.js';
import { failurePanel, skeleton } from './states.js';
import { ShellHost } from './view.js';

// What lives inside the signed-in shell: the address (history API), the menu, and the pages. The menu only HIDES what the
// role cannot use; the backend refuses it anyway (403 ADMIN_FORBIDDEN, shown as such). A page the role may not open shows
// the "no permission" state, never a blank area.
//
// An ADMIN's menu and pages come from the server's CURRENT permissions (GET /v1/admin-auth/permissions), read when the shell
// is mounted. Until they arrive, or when they cannot be read, an ADMIN is granted nothing (fail closed). Nothing the server
// sent about accounts (rows, names, phones, filters, rights) outlives the shell: it is dropped on unmount and on session loss.

export interface History {
  pathname(): string;
  search(): string;
  push(path: string): void;
  onPop(listener: () => void): () => void;
  /** Back to the start page (a full load, which re-checks the session). */
  restart(): void;
}

const FILTER_DELAY_MS = 300;

type GrantsState = { readonly kind: 'loading' } | { readonly kind: 'ready' } | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number };

const ALL_ROLES: readonly UserRole[] = ['CUSTOMER', 'SHOP_OWNER', 'DRIVER'];

const sameGrants = (a: Grants, b: Grants): boolean => a.size === b.size && [...a].every((id) => b.has(id));

export class ShellApp implements ShellHost {
  #layout: ShellLayout | undefined;
  #role: AdminRole | undefined;
  #view: ProvisioningView | undefined;
  #unsubscribe: (() => void) | undefined;
  #unpop: (() => void) | undefined;
  #generation = 0;
  /** Changes on mount/unmount: a grants answer of an earlier shell never applies to a later one. */
  #mounts = 0;
  #filterTimer: unknown;
  #grants: Grants = NO_GRANTS;
  /** The finance rights of THIS session as the server last said them (GET access/me). Independent of the application grants above. */
  #financeRights: FinanceRights = NO_FINANCE_RIGHTS;
  #financeLoaded = false;
  #financeDialog: { close(): void } | undefined;
  #roles: readonly UserRole[] = [];
  #grantsState: GrantsState = { kind: 'loading' };
  /** The users filter, kept only so "Back" from a detail returns to the same list. Dropped with the shell. */
  #usersFilter: UserFilter | undefined;
  #restoreFilter = false;
  /** The open lock / unlock dialog, if any. Closed with the page: nothing about it outlives the screen or the session. */
  #dialog: DialogHandle | undefined;

  constructor(
    private readonly provisioning: ProvisioningController,
    private readonly history: History,
    private readonly clock: Clock,
    /** Where the account pages and the admin's rights come from. By default nothing is wired, so every page says so. */
    private readonly source: AccountsSource = NOT_WIRED_SOURCE,
    /** An account read answered 401: the session is gone (the caller goes back to login, which unmounts the shell). */
    private readonly onSessionLost: () => void = () => undefined,
    /** A new Idempotency-Key for a NEW lock / unlock intent. A retry after an unknown outcome never calls it. */
    private readonly newKey: () => string = () => globalThis.crypto.randomUUID(),
    /** Where the SYSTEM settings come from. By default nothing is wired, so the page says so. */
    private readonly settings: SettingsSource = NOT_WIRED_SETTINGS,
    /** Where the dish groups (Danh mục › Nhóm món) come from. By default nothing is wired, so the page says so. */
    private readonly catalog: CatalogSource = NOT_WIRED_CATALOG,
    /** Where the Shippers (Vận hành › Shipper) and the Shipper wallet parameters come from. By default nothing is wired, so the pages say so. */
    private readonly shippers: ShipperSource = NOT_WIRED_SHIPPERS,
    /** Where the finance pages (M04) come from. By default nothing is wired, so every page says so and every money button is disabled. */
    private readonly finance: FinanceSource = NOT_WIRED_FINANCE,
    /** Where the notifications (Vận hành › Thông báo, M08.06) come from. By default nothing is wired, so the page says so. */
    private readonly notifications: NotificationSource = NOT_WIRED_NOTIFICATIONS,
    /** Where the shipping-fee table (Phí & điều kiện giao, M06-A) comes from. By default nothing is wired, so the page says so. */
    private readonly shipping: ShippingPolicySource = NOT_WIRED_SHIPPING,
    /** Where the deliveries (Vận hành › Giao hàng, M07.07) come from. By default nothing is wired, so the page says so. */
    private readonly deliveries: DeliverySource = NOT_WIRED_DELIVERIES,
    /** Where the REAL finance pages (M04-B3a: top-up requests, receiving accounts, finance rights) come from. By default nothing is wired and no page shows data. */
    private readonly financeAdmin: FinanceAdminSource = NOT_WIRED_FINANCE_ADMIN,
    /** Where the overview figures (Tổng quan › Điều hành, M12-A) come from. By default nothing is wired, so the page says so. */
    private readonly overview: OverviewSource = NOT_WIRED_OVERVIEW,
  ) {}

  mount(parts: { readonly layout: ShellLayout; readonly role: AdminRole }): void {
    this.unmount();
    this.#layout = parts.layout;
    this.#role = parts.role;
    this.#unpop = this.history.onPop(() => this.#apply());
    if (parts.role === 'SYSTEM') {
      // SYSTEM reads everything; the server still decides every call.
      this.#roles = ALL_ROLES;
      this.#grantsState = { kind: 'ready' };
      this.#apply();
      this.#loadFinanceRights();
      return;
    }
    this.#grantsState = { kind: 'loading' };
    this.#apply();
    this.#loadGrants();
  }

  unmount(): void {
    this.#mounts += 1;
    this.#unpop?.();
    this.#unpop = undefined;
    this.#teardown();
    this.provisioning.clear();
    // Nothing read about accounts stays in memory or on screen once the shell is gone.
    this.#layout?.content.replaceChildren();
    this.#grants = NO_GRANTS;
    this.#financeRights = NO_FINANCE_RIGHTS;
    this.#financeLoaded = false;
    this.#roles = [];
    this.#usersFilter = undefined;
    this.#restoreFilter = false;
    this.#grantsState = { kind: 'loading' };
    this.#layout = undefined;
    this.#role = undefined;
  }

  go(route: Route): void {
    this.history.push(formatRoute(route));
    this.#apply();
    this.#layout?.content.focus({ preventScroll: true });
  }

  /** Reads the admin's CURRENT permissions. `quiet`: a re-check after a 403, which only updates the menu/pages when they changed. */
  #loadGrants(quiet = false): void {
    const mount = this.#mounts;
    // The finance rights are read again with the application rights (mount, retry, a 403): they are the ones that decide the money pages.
    this.#loadFinanceRights();
    if (!quiet) {
      this.#grantsState = { kind: 'loading' };
    }
    void this.source.grants().then((result) => {
      if (mount !== this.#mounts || this.#role === undefined) {
        return;
      }
      if (result.kind === 'failed') {
        if (result.failure === 'session-expired') {
          this.onSessionLost();
          return;
        }
        if (quiet) {
          return;
        }
        this.#grantsState = { kind: 'failed', failure: result.failure, ...(result.retryAfterSec === undefined ? {} : { retryAfterSec: result.retryAfterSec }) };
        this.#grants = NO_GRANTS;
        this.#roles = [];
        this.#apply();
        return;
      }
      const changed = !sameGrants(this.#grants, result.grants) || this.#roles.join() !== result.roles.join() || this.#grantsState.kind !== 'ready';
      this.#grants = result.grants;
      this.#roles = result.roles;
      this.#grantsState = { kind: 'ready' };
      if (changed) {
        this.#apply();
      }
    });
  }

  /** GET access/me. A failure leaves NO finance right (fail closed); 401 ends the session. Changed rights redraw the page, so content that is no longer allowed disappears. */
  #loadFinanceRights(): void {
    const mount = this.#mounts;
    void this.financeAdmin.rights().then((read) => {
      if (mount !== this.#mounts || this.#role === undefined) {
        return;
      }
      if (read.kind === 'failed' && read.failure === 'session-expired') {
        this.onSessionLost();
        return;
      }
      const next = read.kind === 'ready' ? read.data : NO_FINANCE_RIGHTS;
      const changed = !this.#financeLoaded || next.canRead !== this.#financeRights.canRead || next.canRecord !== this.#financeRights.canRecord;
      this.#financeRights = next;
      this.#financeLoaded = true;
      if (!changed) {
        return;
      }
      // Only a money page depends on these rights. Anywhere else just the menu is redrawn: redrawing the whole page would wipe a form the
      // administrator has already started to fill when the answer arrives late.
      const route = parseRoute(this.history.pathname(), this.history.search());
      if (route.name === 'finance-topups' || route.name === 'finance-topup' || route.name === 'finance-bank-accounts') {
        this.#apply();
      } else if (this.#layout !== undefined && this.#role !== undefined) {
        this.#layout.render({ role: this.#role, grants: this.#effectiveGrants(), route, navigate: (next) => this.go(next) });
      }
    });
  }

  /** What the shell may show: the application grants plus the finance READ right (never inferred from the application rights). */
  #effectiveGrants(): Grants {
    return this.#financeRights.canRead ? new Set([...this.#grants, 'topups' as const]) : this.#grants;
  }

  #rights(): FinanceRights {
    return this.#role === 'SYSTEM' ? { role: 'SYSTEM', implicit: true, canRead: true, canRecord: true } : this.#financeRights;
  }

  #teardown(): void {
    this.#financeDialog?.close();
    this.#financeDialog = undefined;
    this.#generation += 1;
    if (this.#filterTimer !== undefined) {
      this.clock.clearTimeout(this.#filterTimer);
      this.#filterTimer = undefined;
    }
    this.#dialog?.close();
    this.#dialog = undefined;
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
    layout.render({ role, grants: this.#effectiveGrants(), route, navigate: (next) => this.go(next) });
    document.title = `${breadcrumb(route).at(-1) ?? 'Tổng quan'} · Quản trị · 11`;
    this.#teardown();
    this.provisioning.clear();
    if (route.name === 'home' || route.name === 'activate' || route.name === 'reset') {
      content.replaceChildren(this.#home(role));
      return;
    }
    if (this.#grantsState.kind === 'loading') {
      content.replaceChildren(h('section', { class: 'content content-narrow', 'aria-busy': 'true' }, skeleton()));
      return;
    }
    if (this.#grantsState.kind === 'failed') {
      const failed = this.#grantsState;
      content.replaceChildren(
        h(
          'section',
          { class: 'content content-narrow' },
          h('h1', { class: 'title', tabindex: '-1' }, 'Không tải được quyền truy cập'),
          failurePanel(failed.failure, { retry: () => this.#retryGrants(), login: () => this.history.restart(), home: () => this.go({ name: 'home' }) }, failed.retryAfterSec),
        ),
      );
      return;
    }
    const moneyRoute = route.name === 'finance-topups' || route.name === 'finance-topup';
    if (moneyRoute && role === 'ADMIN' && !this.#financeLoaded) {
      content.replaceChildren(h('section', { class: 'content content-narrow', 'aria-busy': 'true' }, skeleton()));
      return;
    }
    if (!canOpenRoute(role, this.#effectiveGrants(), route)) {
      if (moneyRoute && role === 'ADMIN' && this.#financeRights.canRecord && !this.#financeRights.canRead) {
        // Record without read: nothing is listed or shown; the sentence tells what to ask SYSTEM for.
        content.replaceChildren(h('section', { class: 'content content-narrow' }, statePanel({ icon: 'lock', title: 'Cần quyền xem yêu cầu nạp tiền', text: FINANCE_RECORD_REQUIRES_READ, tone: 'warning' })));
        return;
      }
      content.replaceChildren(this.#forbidden());
      return;
    }
    switch (route.name) {
      case 'users': {
        const keep = this.#restoreFilter && this.#usersFilter !== undefined;
        this.#restoreFilter = false;
        const base = keep ? (this.#usersFilter as UserFilter) : route.status === 'LOCKED' ? { ...EMPTY_USER_FILTER, status: 'LOCKED' as const } : EMPTY_USER_FILTER;
        this.#users(content, base.role !== 'ALL' && !this.#roles.includes(base.role) ? { ...base, role: 'ALL' } : base);
        return;
      }
      case 'user':
        this.#user(content, route.id);
        return;
      case 'administrators':
        this.#administrators(content);
        return;
      case 'settings':
        this.#settings(content);
        return;
      case 'categories':
        this.#categories(content);
        return;
      case 'shippers':
        this.#shipperList(content, route.status);
        return;
      case 'shipper':
        this.#shipperDetail(content, route.id);
        return;
      case 'wallet-parameters':
        this.#walletParameters(content);
        return;
      case 'shipping-policy':
        this.#shippingPolicy(content);
        return;
      case 'finance-topups':
        this.#topupList(content, route.status ?? 'PENDING');
        return;
      case 'finance-topup':
        this.#topupDetail(content, route.id);
        return;
      case 'finance-bank-accounts':
        this.#bankAccounts(content);
        return;
      case 'deliveries':
        this.#deliveryList(content, route.filter);
        return;
      case 'overview':
        this.#overviewPage(content);
        return;
      case 'notifications':
        this.#notificationPage(content);
        return;
      case 'finance':
      case 'finance-wallets':
      case 'finance-withdrawals':
      case 'finance-withdrawal':
      case 'finance-transactions':
      case 'finance-reconciliation':
      case 'wallet-params':
        this.#financePage(content, route);
        return;
      default:
        this.#invitations(content, route);
    }
  }

  #retryGrants(): void {
    this.#loadGrants();
    this.#apply();
  }

  #wired(): boolean {
    return this.source !== NOT_WIRED_SOURCE;
  }

  /**
   * Paging of one list. Late answers are dropped (page left, filter changed, newer request started). A cursor the server no
   * longer accepts (filter or rights changed) is dropped and page 1 is read again. 401 ends the session; 403 re-reads the rights.
   */
  #pager<Row>(fetch: (cursor: string | null) => Promise<PageState<Row>>, draw: (state: ListState<Row>) => void): { readonly load: () => void; readonly more: () => void } {
    const generation = this.#generation;
    let rows: readonly Row[] = [];
    let cursor: string | null = null;
    let latest = 0;
    const current = (token: number): boolean => generation === this.#generation && token === latest;
    const settled = (state: ListState<Row>): boolean => {
      if (state.kind === 'failed' && state.failure === 'session-expired') {
        this.onSessionLost();
        return false;
      }
      if (state.kind === 'failed' && state.failure === 'forbidden' && this.#role === 'ADMIN') {
        this.#loadGrants(true);
      }
      return true;
    };
    const load = (): void => {
      latest += 1;
      const token = latest;
      rows = [];
      cursor = null;
      draw({ kind: 'loading' });
      void fetch(null).then((result) => {
        if (!current(token)) {
          return;
        }
        const state: ListState<Row> = result.kind === 'cursor-invalid' ? { kind: 'failed', failure: 'unknown' } : result;
        if (!settled(state)) {
          return;
        }
        if (state.kind === 'rows') {
          rows = state.rows;
          cursor = state.nextCursor;
        }
        draw(state);
      });
    };
    const more = (): void => {
      const from = cursor;
      if (from === null) {
        return;
      }
      latest += 1;
      const token = latest;
      draw({ kind: 'rows', rows, nextCursor: from, loadingMore: true });
      void fetch(from).then((result) => {
        if (!current(token)) {
          return;
        }
        if (result.kind === 'cursor-invalid') {
          load();
          return;
        }
        if (!settled(result)) {
          return;
        }
        if (result.kind === 'rows') {
          rows = [...rows, ...result.rows];
          cursor = result.nextCursor;
          draw({ kind: 'rows', rows, nextCursor: cursor });
        } else if (result.kind === 'empty') {
          cursor = null;
          draw({ kind: 'rows', rows, nextCursor: null });
        } else {
          draw(result);
        }
      });
    };
    return { load, more };
  }

  #later(generation: number, action: () => void): void {
    if (this.#filterTimer !== undefined) {
      this.clock.clearTimeout(this.#filterTimer);
    }
    this.#filterTimer = this.clock.setTimeout(() => {
      this.#filterTimer = undefined;
      if (generation === this.#generation) {
        action();
      }
    }, FILTER_DELAY_MS);
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
    const pager = this.#pager<UserRow>(
      (cursor) => this.source.users(filter, cursor),
      (state) => view.render({ name: 'users', filter, state }),
    );
    const view = new UsersView(content, {
      ...this.#hooks(() => pager.load()),
      ...(this.#wired() ? { roles: this.#roles } : {}),
      loadMore: () => pager.more(),
      filter: (next) => {
        filter = next;
        this.#usersFilter = next;
        this.#later(generation, () => pager.load());
      },
    });
    this.#usersFilter = filter;
    pager.load();
  }

  #user(content: HTMLElement, id: string): void {
    const generation = this.#generation;
    const live = (): boolean => generation === this.#generation;
    let current: UserDetail | undefined;
    /** The user as the admin saw it when opening the dialog: its version is the one the command carries, even if the page reloads behind it. */
    let target: UserDetail | undefined;
    /** The lock / unlock the admin confirmed: kept (key, reason, version) only until it is answered, so a retry is the same request. */
    let intent: LockCommand | undefined;
    let dialog: LockDialog | undefined;

    const load = (): void => {
      current = undefined;
      draw({ kind: 'loading' });
      void this.source.user(id).then((state) => {
        if (!live()) {
          return;
        }
        if (state.kind === 'failed' && state.failure === 'session-expired') {
          this.onSessionLost();
          return;
        }
        if (state.kind === 'failed' && state.failure === 'forbidden' && this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
        if (state.kind === 'ready') {
          current = state.user;
        } else if (state.kind === 'not-found' || (state.kind === 'failed' && state.failure === 'forbidden')) {
          // The account or the right to it is gone: nothing may be confirmed on it any more.
          closeDialog();
        }
        draw(state);
      });
    };
    const draw = (state: Parameters<typeof renderUserDetail>[0]['state']): void => {
      content.replaceChildren(
        renderUserDetail(
          { name: 'user', id, state },
          {
            wired: this.#wired(),
            back: () => {
              this.#restoreFilter = true;
              this.go({ name: 'users' });
            },
            reload: load,
            retry: load,
            login: () => this.history.restart(),
            home: () => this.go({ name: 'home' }),
            action: (action) => {
              if (current !== undefined && this.#wired()) {
                target = current;
                intent = undefined;
                show({ action, reason: '', phase: 'form' });
              }
            },
          },
        ),
      );
    };
    const closeDialog = (): void => {
      this.#dialog?.close();
      this.#dialog = undefined;
      dialog = undefined;
      intent = undefined;
      target = undefined;
    };
    const show = (next: LockDialog): void => {
      dialog = next;
      this.#dialog?.close();
      this.#dialog = undefined;
      if (target === undefined) {
        return;
      }
      this.#dialog = openLockDialog(target, next, {
        submit: (reason, category) => {
          if (target === undefined || dialog === undefined) {
            return;
          }
          // A NEW confirmation is a new intent with a new key; only "Thử lại" reuses the key of an unanswered one.
          intent = { id, action: dialog.action, version: target.version, reason, key: this.newKey(), ...(category === undefined ? {} : { category }) };
          void send();
        },
        cancel: () => closeDialog(),
        // Read the state again behind the dialog; the unanswered intent (and its key) is kept for an explicit "Thử lại".
        recheck: () => load(),
        retry: () => void send(),
        reload: () => {
          closeDialog();
          load();
        },
      });
    };
    const send = async (): Promise<void> => {
      const command = intent;
      if (command === undefined || dialog === undefined) {
        return;
      }
      const base = { action: command.action, reason: command.reason, ...(command.category === undefined ? {} : { category: command.category }) };
      show({ ...base, phase: 'working' });
      const result = await this.source.lock(command);
      if (!live() || intent !== command) {
        return;
      }
      this.#afterLock(result, {
        done: () => {
          closeDialog();
          // The acknowledgement says the intent happened, not what the account is NOW: read the current detail.
          load();
        },
        phase: (phase, error) => show({ ...base, phase, ...(error === undefined ? {} : { error }) }),
        gone: () => {
          closeDialog();
          load();
        },
        deleted: () => {
          // The account no longer exists: nothing about it stays on screen; the list is the next place.
          closeDialog();
          this.#restoreFilter = true;
          this.go({ name: 'users' });
        },
      });
    };
    load();
  }

  /** What each server answer to a lock / unlock changes on screen. 401 ends the session; 403 re-reads the admin's rights. */
  #afterLock(
    result: LockResult,
    ui: { done(): void; phase(phase: LockDialog['phase'], error?: string): void; gone(): void; deleted(): void },
  ): void {
    switch (result.kind) {
      case 'ok':
        ui.done();
        return;
      case 'deleted':
        ui.deleted();
        return;
      case 'has-active-work':
        ui.phase('failed', LOCK_MESSAGE.activeWork);
        return;
      case 'conflict':
        ui.phase('conflict');
        return;
      case 'unknown':
        ui.phase('unknown');
        return;
      case 'session-expired':
        this.onSessionLost();
        return;
      case 'not-found':
        ui.gone();
        return;
      case 'forbidden':
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
        ui.phase('failed', LOCK_MESSAGE.forbidden);
        return;
      case 'review-required':
        ui.phase('failed', LOCK_MESSAGE.reviewRequired);
        return;
      case 'rate-limited':
        ui.phase('failed', LOCK_MESSAGE.rateLimited);
        return;
      case 'not-wired':
        ui.phase('failed', LOCK_MESSAGE.notWired);
        return;
      case 'rejected':
        ui.phase('failed', LOCK_MESSAGE.rejected);
        return;
    }
  }

  /**
   * "Cài đặt hệ thống" (SYSTEM only; the server decides again on every call). The switches edit a draft; "Lưu" sends ONE request with a
   * key of its own, "Hủy" drops the draft. A lost answer keeps the key and the body for an explicit "Thử lại"; a version conflict asks
   * to reload before anything else is sent. Nothing read or typed here outlives the page.
   */
  #settings(content: HTMLElement): void {
    const generation = this.#generation;
    const live = (): boolean => generation === this.#generation;
    let saved: PhoneVerificationSettings | undefined;
    let draft: SettingsDraft | undefined;
    let intent: SaveCommand | undefined;
    let phase: SettingsPhase = 'idle';
    let error: string | undefined;

    const draw = (state: SettingsState): void =>
      view.render({ name: 'settings', state, ...(draft === undefined ? {} : { draft }), phase, ...(error === undefined ? {} : { error }) });
    const redraw = (): void => {
      if (saved !== undefined) {
        draw({ kind: 'ready', settings: saved });
      }
    };
    const load = (keepPhase = false): void => {
      saved = undefined;
      draft = undefined;
      intent = undefined;
      if (!keepPhase) {
        phase = 'idle';
        error = undefined;
      }
      draw({ kind: 'loading' });
      void this.settings.read().then((state) => {
        if (!live()) {
          return;
        }
        if (state.kind === 'failed' && state.failure === 'session-expired') {
          this.onSessionLost();
          return;
        }
        if (state.kind === 'ready') {
          saved = state.settings;
        }
        draw(state);
      });
    };
    const send = async (): Promise<void> => {
      const command = intent;
      if (command === undefined) {
        return;
      }
      phase = 'working';
      error = undefined;
      redraw();
      const result = await this.settings.save(command);
      if (!live() || intent !== command) {
        return;
      }
      this.#afterSave(result, {
        done: () => {
          // The acknowledgement says the intent happened, not what the settings are NOW: read them.
          phase = 'saved';
          load(true);
        },
        phase: (next, text) => {
          phase = next;
          error = text;
          redraw();
        },
      });
    };
    const view = new SettingsView(content, {
      wired: this.settings !== NOT_WIRED_SETTINGS,
      change: (next) => {
        draft = next;
        phase = 'idle';
        error = undefined;
        redraw();
      },
      save: () => {
        if (saved === undefined || draft === undefined) {
          return;
        }
        // A NEW confirmation is a new intent with a new key; only "Thử lại" reuses the key of an unanswered one.
        intent = { version: saved.version, otpRegistrationEnabled: draft.otpRegistrationEnabled, otpPasswordResetEnabled: draft.otpPasswordResetEnabled, key: this.newKey() };
        void send();
      },
      cancel: () => {
        draft = undefined;
        phase = 'idle';
        error = undefined;
        redraw();
      },
      // Read the values again; the unanswered intent (and its key) is dropped by the reload, as the page shows what the server holds now.
      recheck: () => load(),
      retry: () => void send(),
      reload: () => load(),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
    });
    load();
  }

  /** What the finance pages (B3a) need from the shell. 401 ends the session; 403 re-reads the rights (and so redraws what is still allowed). */
  #financeHost(): FinanceAdminHost {
    return {
      source: this.financeAdmin,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        this.#loadFinanceRights();
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      go: (route) => this.go(route),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      rights: () => this.#rights(),
      now: () => this.clock.now(),
    };
  }

  /** "Tài chính › Nạp tiền": the requests of the server, one status per tab, cursor paging. */
  #topupList(content: HTMLElement, filter: TopupFilter): void {
    const view = new TopupListView(content, this.#financeHost(), filter);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  #topupDetail(content: HTMLElement, id: string): void {
    const view = new TopupDetailView(content, this.#financeHost(), id);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Tài chính › Tài khoản nhận tiền" (SYSTEM only; the server decides again). */
  #bankAccounts(content: HTMLElement): void {
    const view = new BankAccountsView(content, this.#financeHost());
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** What the Shipper pages need from the shell. 401 ends the session; 403 re-reads the rights. */
  #shipperHost(): ShipperHost {
    return {
      source: this.shippers,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      go: (route) => this.go(route),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      canEditParameters: this.#role === 'SYSTEM',
    };
  }

  /** "Vận hành › Shipper": the list with search and status filter. The view owns the filter and the page. */
  #shipperList(content: HTMLElement, status: ShipperFilter | undefined): void {
    const view = new ShipperListView(content, this.#shipperHost(), status);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** One Shipper: profile, bank account, readiness, classification, history and the review / activity commands. */
  #shipperDetail(content: HTMLElement, id: string): void {
    const view = new ShipperDetailView(content, this.#shipperHost(), id);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Vận hành › Giao hàng" (M07.07): counters, filters, list and the detail drawer; the server decides every read and action. */
  #deliveryList(content: HTMLElement, filter?: Extract<Route, { name: 'deliveries' }>['filter']): void {
    const host: DeliveryHost = {
      ...(filter === undefined ? {} : { initial: filter }),
      // The Shipper page opens from a delivery only for an administrator who may open it (the server decides again on the read).
      ...(this.#role !== undefined && canOpenRoute(this.#role, this.#effectiveGrants(), { name: 'shippers' }) ? { openShipper: (driverId: string) => this.go({ name: 'shipper', id: driverId }) } : {}),
      source: this.deliveries,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
    };
    const view = new DeliveryListView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Tổng quan › Điều hành" (M12-A): the figures, read-only; every figure is gated by the server for this administrator. */
  #overviewPage(content: HTMLElement): void {
    const host: OverviewHost = {
      source: this.overview,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      open: (link) => this.go(routeOfLink(link.area, link.query)),
    };
    const view = new OverviewView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Vận hành › Thông báo" (M08.06): the work queue, the search and the settings; the server decides every read and the one write (SYSTEM only). */
  #notificationPage(content: HTMLElement): void {
    const host: NotificationHost = {
      source: this.notifications,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      openDeliveries: () => this.go({ name: 'deliveries' }),
      canEdit: this.#role === 'SYSTEM',
    };
    const view = new NotificationsView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Hệ thống › Phí & điều kiện giao" (M06-A): every administrator reads and previews, only SYSTEM edits; the server decides again. */
  #shippingPolicy(content: HTMLElement): void {
    const view = new ShippingPolicyView(content, {
      source: this.shipping,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      canEdit: this.#role === 'SYSTEM',
    });
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Hệ thống › Tham số hệ thống › Ví Shipper" (every administrator reads, only SYSTEM edits; the server decides again). */
  #walletParameters(content: HTMLElement): void {
    const view = new WalletParametersView(content, this.#shipperHost());
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /**
   * "Danh mục › Nhóm món" (SYSTEM, or an ADMIN with the catalog right; the server decides again on every call). The controller owns the
   * filter, the page, the popup and the one save in flight; this only connects it to the view, the typing pause and the session.
   */
  #categories(content: HTMLElement): void {
    const generation = this.#generation;
    const controller = new CatalogController({
      source: this.catalog,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
    });
    const view = new CatalogView(content, {
      wired: this.catalog !== NOT_WIRED_CATALOG,
      filter: (next) => {
        controller.filter(next);
        this.#later(generation, () => controller.load());
      },
      refresh: () => controller.load(),
      retry: () => controller.load(),
      page: (page) => controller.page(page),
      create: () => controller.beginCreate(),
      edit: (id) => controller.beginEdit(id),
      toggle: (id) => controller.beginToggle(id),
      draft: (draft) => controller.edit(draft),
      submit: () => controller.submit(),
      cancel: () => controller.cancel(),
      retrySave: () => controller.retry(),
      recheck: () => controller.recheck(),
      reload: () => controller.reload(),
      showTwin: () => controller.showTwin(),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
    });
    const unsubscribe = controller.subscribe((screen) => view.render(screen));
    this.#unsubscribe = () => {
      unsubscribe();
      controller.dispose();
      view.dispose();
    };
    view.render(controller.screen);
    controller.load();
  }

  /**
   * "Tài chính" (M04, UI phase) and the wallet parameters. The controller owns the filter, the page and the two drafts; this only connects it
   * to the view and the session. There is no write: every money button is drawn disabled while the source is NOT_WIRED_FINANCE.
   */
  #financePage(content: HTMLElement, route: Route): void {
    if (!isFinanceRoute(route)) {
      return;
    }
    const wired = this.finance !== NOT_WIRED_FINANCE;
    const controller = new FinanceController({
      source: this.finance,
      route,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
    });
    const view = new FinanceView(content, {
      wired,
      retry: () => controller.load(),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      refresh: () => controller.load(),
      open: (next) => this.go(next),
      search: (query) => controller.search(query),
      page: (page) => controller.page(page),
      ledgerFilter: (next) => controller.ledgerFilter(next),
      topupDraft: (draft) => controller.topupDraft(draft),
      topupAttempt: (action) => controller.attemptTopup(action),
      // Nothing below sends anything in the UI phase: the buttons are disabled until a backend package connects them.
      topupDecide: () => undefined,
      withdrawalAct: () => undefined,
      paramsDraft: (draft) => controller.paramsDraft(draft),
      paramsAttempt: () => controller.attemptParams(),
      paramsSave: () => undefined,
      paramsReset: () => controller.resetParams(),
      exportLedger: () => undefined,
    });
    const unsubscribe = controller.subscribe((screen) => view.render(screen));
    this.#unsubscribe = () => {
      unsubscribe();
      controller.dispose();
    };
    view.render(controller.screen);
    controller.load();
  }

  /** What each server answer to a save changes on screen. 401 ends the session. */
  #afterSave(result: SaveResult, ui: { done(): void; phase(phase: SettingsPhase, error?: string): void }): void {
    switch (result.kind) {
      case 'ok':
        ui.done();
        return;
      case 'conflict':
        ui.phase('conflict');
        return;
      case 'unknown':
        ui.phase('unknown');
        return;
      case 'session-expired':
        this.onSessionLost();
        return;
      case 'forbidden':
        ui.phase('failed', SETTINGS_MESSAGE.forbidden);
        return;
      case 'rate-limited':
        ui.phase('failed', SETTINGS_MESSAGE.rateLimited);
        return;
      case 'not-wired':
        ui.phase('failed', SETTINGS_MESSAGE.notWired);
        return;
      case 'rejected':
        ui.phase('failed', SETTINGS_MESSAGE.rejected);
        return;
    }
  }

  #administrators(content: HTMLElement): void {
    const generation = this.#generation;
    let filter: AdministratorFilter = EMPTY_ADMIN_FILTER;
    const pager = this.#pager<AdministratorRow>(
      (cursor) => this.source.administrators(filter, cursor),
      (state) => view.render({ name: 'administrators', filter, state }),
    );
    const view = new AdministratorsView(content, {
      retry: () => pager.load(),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      invite: () => this.go({ name: 'invitation-new' }),
      // B3a: SYSTEM gives and takes back each finance right here (the server refuses anyone else again).
      ...(this.#role === 'SYSTEM' && this.financeAdmin !== NOT_WIRED_FINANCE_ADMIN
        ? {
            financeAccess: (row: { readonly id: string; readonly fullName: string }) => {
              this.#financeDialog?.close();
              this.#financeDialog = openFinanceAccessDialog(this.#financeHost(), row);
            },
          }
        : {}),
      wired: this.#wired(),
      // The live list holds activated accounts only; invitations that wait for activation are in "Lời mời Admin".
      pending: !this.#wired(),
      filter: (next) => {
        filter = next;
        this.#later(generation, () => pager.load());
      },
      refresh: () => pager.load(),
      loadMore: () => pager.more(),
    });
    pager.load();
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
