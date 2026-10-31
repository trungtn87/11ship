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
import { breadcrumb, canOpenRoute, GrantId, Grants, NO_GRANTS } from '../core/menu.js';
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
import { formatRoute, parseRoute, Route, routeOfLink } from '../core/routes.js';
import { AccountsHooks, AdministratorsView, openLockDialog, renderUserDetail, UsersView } from './accounts-view.js';
import { DialogHandle } from './dialog.js';
import { h } from './dom.js';
import { ProvisioningView } from './provisioning-view.js';
import { orderTimeoutsPage } from './order-timeouts-page.js';
import { otpPolicyPage } from './otp-policy-page.js';
import { zonesPage } from './zones-page.js';
import { SettingsView } from './settings-view.js';
import { NOT_WIRED_CATALOG, CatalogSource } from '../core/catalog.js';
import { CatalogController } from '../core/catalog-controller.js';
import { CatalogView } from './catalog-view.js';
import { NOT_WIRED_SHIPPERS, ShipperFilter, ShipperSource } from '../core/shippers.js';
import { NOT_WIRED_SHOPS, ShopSource } from '../core/shops.js';
import { ShopDetailView, ShopHost, ShopListMemory, ShopListView } from './shops-view.js';
import { ShipperDetailView, ShipperHost, ShipperListView, WalletParametersView } from './shippers-view.js';
import { NOT_WIRED_SHIPPING, ShippingPolicySource } from '../core/shipping-policy.js';
import { ShippingPolicyView } from './shipping-policy-view.js';
import { DeliverySource, NOT_WIRED_DELIVERIES } from '../core/deliveries.js';
import { NOT_WIRED_OVERVIEW, OverviewSource } from '../core/overview.js';
import { OverviewHost, OverviewView } from './overview-view.js';
import { AccessSource, NOT_WIRED_ACCESS } from '../core/access.js';
import { AccessHost, AccessView } from './access-view.js';
import { ConfigSource, NOT_WIRED_CONFIG } from '../core/config.js';
import { ConfigHost, ConfigView } from './config-view.js';
import { NOT_WIRED_REPORTS, ReportSource } from '../core/reports.js';
import { ReportsHost, ReportsView } from './reports-view.js';
import { NOT_WIRED_OPERATIONS, OperationsSource } from '../core/operations.js';
import { AuditHost, AuditView } from './audit-view.js';
import { BackupsHost, BackupsView } from './backups-view.js';
import { FeedbackSource, NOT_WIRED_FEEDBACK } from '../core/feedback.js';
import { ComplaintListView, FeedbackHost, ReviewListView } from './feedback-view.js';
import { DeliveryHost, DeliveryListView } from './deliveries-view.js';
import { NOT_WIRED_ORDERS, OrderSource } from '../core/orders.js';
import { OrderHost, OrderListView } from './orders-view.js';
import { NOT_WIRED_CHAT, OrderChatSource } from '../core/order-chat.js';
import { NOT_WIRED_NOTIFICATIONS, NotificationSource } from '../core/notifications.js';
import { QueueTarget } from '../core/action-queue.js';
import { NotificationHost, NotificationsView } from './notifications-view.js';
import { FinanceController, isFinanceRoute } from '../core/finance-controller.js';
import { FinanceSource, NOT_WIRED_FINANCE } from '../core/finance.js';
import { FinanceView } from './finance-view.js';
import { FinanceAdminSource, FinanceRights, NO_FINANCE_RIGHTS, NOT_WIRED_FINANCE_ADMIN, TopupFilter } from '../core/finance-admin.js';
import { FinanceOpsSource, NOT_WIRED_FINANCE_OPS } from '../core/finance-ops.js';
import { FinanceOpsHost, OpsOverviewView, ReconciliationPageView, TransactionsView, WalletListView, WithdrawalDetailView, WithdrawalListView } from './finance-ops-view.js';
import { BankAccountsView, FinanceAdminHost, FINANCE_RECORD_REQUIRES_READ, openFinanceAccessDialog, TopupDetailView, TopupListView } from './finance-admin-view.js';
import { NOT_WIRED_OPS, OpsLevel, OpsSource } from '../core/ops.js';
import { OpsConfigView, OpsGatewayView, OpsHost, OpsIncidentDetailView, OpsIncidentsView, OpsLogsView, SysOpsOverviewView, OpsReleasesView, OpsVpsView, openOpsAccessDialog } from './ops-view.js';
import { ErrorLogView } from './monitoring-errors-view.js';
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
  /** The caller's own access to "Vận hành hệ thống" as the server last said it (GET ops/me); NONE until it answers (fail closed). */
  #opsLevel: OpsLevel = 'NONE';
  #opsLoaded = false;
  #financeDialog: { close(): void } | undefined;
  #opsDialog: { close(): void } | undefined;
  #errorLogView: ErrorLogView | undefined;
  #roles: readonly UserRole[] = [];
  #grantsState: GrantsState = { kind: 'loading' };
  /** The users filter, kept only so "Back" from a detail returns to the same list. Dropped with the shell. */
  #usersFilter: UserFilter | undefined;
  /** The shop list filter, kept only so "Danh sách quán" from a detail returns to the same list. Dropped with the shell. */
  readonly #shopMemory: ShopListMemory = { value: undefined };
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
    /** Where the operating finance pages (M04-C: overview, wallets, withdrawals, transactions, reconciliation, commission) come from. By default nothing is wired and the earlier not-wired pages are shown. */
    /** Where the operating finance pages (M04-C: overview, wallets, withdrawals, transactions, reconciliation, commission) come from. By default nothing is wired and the earlier not-wired pages are shown. */
    /** Where the food orders (Vận hành › Đơn hàng, M10.05) come from. By default nothing is wired, so the page says so. */
    private readonly orders: OrderSource = NOT_WIRED_ORDERS,
    /** Where the ratings and complaints (Vận hành › Đánh giá / Phản ánh, M11.03) come from. By default nothing is wired, so the pages say so. */
    private readonly feedback: FeedbackSource = NOT_WIRED_FEEDBACK,
    private readonly financeOps: FinanceOpsSource = NOT_WIRED_FINANCE_OPS,
    private readonly sessionCsrf: () => string | undefined = () => undefined,
    /** Where the overview figures (Tổng quan › Điều hành, M12-A) come from. By default nothing is wired, so the page says so. */
    private readonly overview: OverviewSource = NOT_WIRED_OVERVIEW,
    /** Where the administrator permission matrix (Tài khoản › Phân quyền, M12-C) comes from. By default nothing is wired, so the page says so. */
    private readonly access: AccessSource = NOT_WIRED_ACCESS,
    /** Where the central configuration (Cài đặt › Cấu hình tập trung, M12-D) comes from. By default nothing is wired, so the page says so. */
    private readonly config: ConfigSource = NOT_WIRED_CONFIG,
    /** Where the reports and their CSV/Excel exports (Tổng quan › Báo cáo, M12-E) come from. By default nothing is wired, so the page says so. */
    private readonly reports: ReportSource = NOT_WIRED_REPORTS,
    /** Where the audit log and the backup history / restore requests (Hệ thống › Nhật ký, Sao lưu và phục hồi, M12-F) come from. By default nothing is wired, so the pages say so. */
    private readonly operations: OperationsSource = NOT_WIRED_OPERATIONS,
    /** Where "Vận hành hệ thống" (M13) comes from. By default nothing is wired, so every page says so and no control works. */
    private readonly ops: OpsSource = NOT_WIRED_OPS,
    /** Where the shops (Vận hành › Quán, M02 shop management) come from. By default nothing is wired, so the pages say so. */
    private readonly shops: ShopSource = NOT_WIRED_SHOPS,
    /** Where "Trao đổi đơn hàng" and the evidence hold of the order / delivery drawers (issue #191) come from. By default nothing is wired, so the drawers say so. */
    private readonly chat: OrderChatSource = NOT_WIRED_CHAT,
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
      this.#opsLevel = 'SYSTEM';
      this.#opsLoaded = true;
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
    this.#opsLevel = 'NONE';
    this.#opsLoaded = false;
    this.#opsDialog?.close();
    this.#opsDialog = undefined;
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
    this.#loadOpsLevel();
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
      const changed =
        !this.#financeLoaded ||
        next.canRead !== this.#financeRights.canRead ||
        next.canRecord !== this.#financeRights.canRecord ||
        next.canProcess !== this.#financeRights.canProcess ||
        next.canConfirm !== this.#financeRights.canConfirm ||
        next.canReconcile !== this.#financeRights.canReconcile;
      this.#financeRights = next;
      this.#financeLoaded = true;
      if (!changed) {
        return;
      }
      // Only a money page depends on these rights. Anywhere else just the menu is redrawn: redrawing the whole page would wipe a form the
      // administrator has already started to fill when the answer arrives late.
      const route = parseRoute(this.history.pathname(), this.history.search());
      if (route.name === 'finance-topups' || route.name === 'finance-topup' || route.name === 'finance-bank-accounts' || route.name.startsWith('finance')) {
        this.#apply();
      } else if (this.#layout !== undefined && this.#role !== undefined) {
        this.#layout.render({ role: this.#role, grants: this.#effectiveGrants(), route, navigate: (next) => this.go(next) });
      }
    });
  }

  /** GET ops/me (ADMIN only; SYSTEM has it implicitly). A failure leaves NO access (fail closed); 401 ends the session. A changed level redraws the menu and, on an ops page, the page. */
  #loadOpsLevel(): void {
    if (this.#role !== 'ADMIN') {
      return;
    }
    const mount = this.#mounts;
    void this.ops.me().then((read) => {
      if (mount !== this.#mounts || this.#role === undefined) {
        return;
      }
      if (read.kind === 'failed' && read.failure === 'session-expired') {
        this.onSessionLost();
        return;
      }
      const next: OpsLevel = read.kind === 'ready' ? read.data : 'NONE';
      const changed = !this.#opsLoaded || next !== this.#opsLevel;
      this.#opsLevel = next;
      this.#opsLoaded = true;
      if (!changed) {
        return;
      }
      const route = parseRoute(this.history.pathname(), this.history.search());
      if (route.name.startsWith('ops')) {
        this.#apply();
      } else if (this.#layout !== undefined && this.#role !== undefined) {
        this.#layout.render({ role: this.#role, grants: this.#effectiveGrants(), route, navigate: (target) => this.go(target) });
      }
    });
  }

  /** What the shell may show: the application grants plus the finance READ right and the M13 access (never inferred from the application rights). */
  #effectiveGrants(): Grants {
    const extra: GrantId[] = [];
    // The finance READ right opens every finance page (the actions on them need their own rights, which the server asks again).
    if (this.#financeRights.canRead) extra.push('topups', 'driver-wallets', 'withdrawals');
    if (this.#opsLevel !== 'NONE') extra.push('ops');
    return extra.length === 0 ? this.#grants : new Set([...this.#grants, ...extra]);
  }

  #opsHost(): OpsHost {
    return {
      source: this.ops,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => this.#loadOpsLevel(),
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      go: (route) => this.go(route),
      level: () => (this.#role === 'SYSTEM' ? 'SYSTEM' : this.#opsLevel),
    };
  }

  #opsPage(content: HTMLElement, route: Route): void {
    const host = this.#opsHost();
    const view =
      route.name === 'ops-vps'
        ? new OpsVpsView(content, host)
        : route.name === 'ops-incident'
          ? new OpsIncidentDetailView(content, host, route.ref)
        : route.name === 'ops-incidents'
          ? new OpsIncidentsView(content, host)
          : route.name === 'ops-gateway'
            ? new OpsGatewayView(content, host)
            : route.name === 'ops-logs'
              ? new OpsLogsView(content, host)
              : route.name === 'ops-releases'
                ? new OpsReleasesView(content, host)
                : route.name === 'ops-config'
                  ? new OpsConfigView(content, host)
                  : new SysOpsOverviewView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  #rights(): FinanceRights {
    return this.#role === 'SYSTEM' ? { role: 'SYSTEM', implicit: true, canRead: true, canRecord: true, canProcess: true, canConfirm: true, canReconcile: true } : this.#financeRights;
  }

  #teardown(): void {
    this.#errorLogView?.dispose();
    this.#errorLogView = undefined;
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
    const moneyRoute = route.name.startsWith('finance') && route.name !== 'finance-bank-accounts';
    if (moneyRoute && role === 'ADMIN' && !this.#financeLoaded) {
      content.replaceChildren(h('section', { class: 'content content-narrow', 'aria-busy': 'true' }, skeleton()));
      return;
    }
    if (route.name.startsWith('ops') && role === 'ADMIN' && !this.#opsLoaded) {
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
      case 'order-timeouts':
        orderTimeoutsPage(content,this.sessionCsrf,this.onSessionLost);
        break;
      case 'monitoring-errors': {
        const view = new ErrorLogView(this.onSessionLost);
        this.#errorLogView = view;
        content.replaceChildren(view.root);
        return;
      }
      case 'settings':
        this.#settings(content);
        return;
      case 'categories':
        this.#categories(content);
        return;
      case 'shops':
        this.#shopList(content, route);
        return;
      case 'shop':
        this.#shopDetail(content, route.id, route.tab);
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
      case 'otp-policy':
        otpPolicyPage(content, this.sessionCsrf, this.onSessionLost);
        return;
      case 'zones':
      case 'zone':
        zonesPage(content, { role: this.#role ?? 'ADMIN', csrf: this.sessionCsrf, onSessionLost: () => this.onSessionLost(), go: (target) => this.go(target) }, route.name === 'zone' ? route.id : undefined);
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
      case 'access':
        this.#accessPage(content);
        return;
      case 'config':
        this.#configPage(content);
        return;
      case 'reports':
        this.#reportsPage(content);
        return;
      case 'audit':
        this.#auditPage(content);
        return;
      case 'backups':
        this.#backupsPage(content);
        return;
      case 'orders':
        this.#orderList(content);
        return;
      case 'notifications':
        this.#notificationPage(content);
        return;
      case 'ops':
      case 'ops-vps':
      case 'ops-incidents':
      case 'ops-incident':
      case 'ops-gateway':
      case 'ops-logs':
      case 'ops-releases':
      case 'ops-config':
        this.#opsPage(content, route);
        return;
      case 'reviews':
        this.#feedbackPage(content, 'reviews');
        return;
      case 'complaints':
        this.#feedbackPage(content, 'complaints');
        return;
      case 'finance':
      case 'finance-wallets':
      case 'finance-withdrawals':
      case 'finance-withdrawal':
      case 'finance-transactions':
      case 'finance-reconciliation':
        if (this.financeOps !== NOT_WIRED_FINANCE_OPS) {
          this.#financeOpsPage(content, route);
          return;
        }
        // Not wired (design preview or a build without the finance routes): the earlier pages that say so and draw no data.
        this.#financePage(content, route);
        return;
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
      case 'unverified':
        ui.phase('failed', LOCK_MESSAGE.unverified);
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

  /** What the shop pages need from the shell. 401 ends the session; 403 re-reads the rights. */
  #shopHost(): ShopHost {
    return {
      source: this.shops,
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
      memory: this.#shopMemory,
    };
  }

  /** "Vận hành › Quán": the list with search, area / profile / schedule filters and pages of 20. */
  #shopList(content: HTMLElement, route: Extract<Route, { name: 'shops' }>): void {
    const view = new ShopListView(content, this.#shopHost(), { ...(route.q === undefined ? {} : { q: route.q }), ...(route.area === undefined ? {} : { area: route.area }), ...(route.profile === undefined ? {} : { profile: route.profile }), ...(route.schedule === undefined ? {} : { schedule: route.schedule }) });
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** One shop: profile, schedule, menu and management history, with the disable / enable commands the server allows. */
  #shopDetail(content: HTMLElement, id: string, tab: Extract<Route, { name: 'shop' }>['tab']): void {
    const view = new ShopDetailView(content, this.#shopHost(), id, tab);
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
      chat: this.chat,
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

  /** "Hệ thống › Nhật ký" (M12-F): read only; the server needs the audit.read right (SYSTEM has it). */
  #auditPage(content: HTMLElement): void {
    const host: AuditHost = {
      source: this.operations,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
    };
    const view = new AuditView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Hệ thống › Sao lưu và phục hồi" (M12-F): SYSTEM only; a restore request is recorded, never performed here. */
  #backupsPage(content: HTMLElement): void {
    const host: BackupsHost = {
      source: this.operations,
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
    const view = new BackupsView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Tổng quan › Báo cáo" (M12-E): the server decides every read, export and download; a number that counts deliveries opens the list with the same filter. */
  #reportsPage(content: HTMLElement): void {
    const host: ReportsHost = {
      source: this.reports,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      openDeliveries: (query) => this.go(routeOfLink('deliveries', query)),
    };
    const view = new ReportsView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Cài đặt › Cấu hình tập trung" (M12-D): every administrator reads; SYSTEM changes through the owners' own commands. */
  #configPage(content: HTMLElement): void {
    const host: ConfigHost = {
      source: this.config,
      newKey: this.newKey,
      onSessionLost: () => this.onSessionLost(),
      onForbidden: () => {
        if (this.#role === 'ADMIN') {
          this.#loadGrants(true);
        }
      },
      login: () => this.history.restart(),
      home: () => this.go({ name: 'home' }),
      openFeeTable: () => this.go({ name: 'shipping-policy' }),
    };
    const view = new ConfigView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Tài khoản › Phân quyền" (M12-C): SYSTEM only; the server decides every read and command again. */
  #accessPage(content: HTMLElement): void {
    const host: AccessHost = {
      source: this.access,
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
    const view = new AccessView(content, host);
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
      openQueue: () => this.go({ name: 'notifications' }),
    };
    const view = new OverviewView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** Opens what a "Việc cần xử lý" row points at. The owning screen or endpoint decides the right and the version again; nothing is changed from here. */
  #openQueueTarget(target: QueueTarget): void {
    switch (target.kind) {
      case 'route':
        this.go(routeOfLink(target.area, target.query));
        break;
      case 'detail':
        this.go(target.area === 'shipper' ? { name: 'shipper', id: target.id } : target.area === 'finance-topup' ? { name: 'finance-topup', id: target.id } : { name: 'finance-withdrawal', id: target.id });
        break;
      case 'page':
        window.location.assign(target.href);
        break;
    }
  }

  /** "Vận hành › Đơn hàng" (M10.05): filters, list and the detail drawer; the server decides every read and action. */
  #orderList(content: HTMLElement): void {
    const host: OrderHost = {
      source: this.orders,
      chat: this.chat,
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
    const view = new OrderListView(content, host);
    this.#unsubscribe = () => view.dispose();
    void view.load();
  }

  /** "Vận hành › Đánh giá" and "Vận hành › Phản ánh" (M11.03): the lists, the detail drawers and the actions; the server decides every read and action. */
  #feedbackPage(content: HTMLElement, page: 'reviews' | 'complaints'): void {
    const host: FeedbackHost = {
      source: this.feedback,
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
    const view = page === 'reviews' ? new ReviewListView(content, host) : new ComplaintListView(content, host);
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
      actionQueue: {
        read: (query) => this.overview.actionQueue(query),
        onSessionLost: () => this.onSessionLost(),
        onForbidden: () => {
          if (this.#role === 'ADMIN') {
            this.#loadGrants(true);
          }
        },
        login: () => this.history.restart(),
        home: () => this.go({ name: 'home' }),
        open: (target) => this.#openQueueTarget(target),
      },
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

  /** What the operating finance pages (M04-C) need from the shell. 401 ends the session; 403 re-reads the rights (and so redraws what is still allowed). */
  #financeOpsHost(): FinanceOpsHost {
    const { source, ...rest } = this.#financeHost();
    void source;
    return { ...rest, ops: this.financeOps };
  }

  /** "Tài chính": overview, Shipper wallets, withdrawals, transactions and reconciliation, from the server (M04-C). */
  #financeOpsPage(content: HTMLElement, route: Route): void {
    const host = this.#financeOpsHost();
    let view: { load(): Promise<void>; dispose(): void };
    switch (route.name) {
      case 'finance':
        view = new OpsOverviewView(content, host);
        break;
      case 'finance-wallets':
        view = new WalletListView(content, host);
        break;
      case 'finance-withdrawals':
        view = new WithdrawalListView(content, host, route.status ?? (route.tab === undefined ? 'PENDING' : route.tab === 'COMPLETED' ? 'PAID' : route.tab === 'NEEDS_RECONCILE' ? 'RECONCILIATION' : route.tab));
        break;
      case 'finance-withdrawal':
        view = new WithdrawalDetailView(content, host, route.id);
        break;
      case 'finance-transactions':
        view = new TransactionsView(content, host, route.shipper ?? null);
        break;
      case 'finance-reconciliation':
        view = new ReconciliationPageView(content, host);
        break;
      default:
        return;
    }
    this.#unsubscribe = () => view.dispose();
    void view.load();
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
      // M13: SYSTEM gives or takes back an administrator's access to "Vận hành hệ thống" (the server refuses anyone else again).
      ...(this.#role === 'SYSTEM' && this.ops !== NOT_WIRED_OPS
        ? {
            opsAccess: (row: { readonly id: string; readonly fullName: string }) => {
              this.#opsDialog?.close();
              this.#opsDialog = openOpsAccessDialog(this.#opsHost(), row);
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
