import { AdminRole } from './api.js';
import { Route } from './routes.js';

// The left menu of the administration web, as DATA: what exists, what is already built ("ready") and what is only announced
// ("Sắp có"), and who may see it. The DOM (dom/sidebar.ts) only draws this list. The menu only HIDES what a role cannot use:
// every right is checked again by the backend (403 ADMIN_FORBIDDEN is shown as such), so hiding is a convenience, never a lock.
//
// Who sees what (design "11Ship · Sidebar Web quản trị"):
//  * SYSTEM sees every entry. Administrators and invitations are SYSTEM-only.
//  * ADMIN sees only the entries it was granted (VIEW on a domain). The grants come from GET /v1/admin-auth/permissions
//    (grantsFromPermissions); until they arrive, or when they cannot be read, an ADMIN sees "Tổng quan" only. The design
//    preview passes sample grants. The page never computes a right from anything else.

export type IconName =
  | 'home'
  | 'user'
  | 'shield'
  | 'mail'
  | 'store'
  | 'rider'
  | 'receipt'
  | 'truck'
  | 'bell'
  | 'chat'
  | 'wallet'
  | 'plus-circle'
  | 'minus-circle'
  | 'map-pin'
  | 'gear'
  | 'doc'
  | 'key'
  | 'activity'
  | 'star';

/** A domain an ADMIN can be granted. SYSTEM does not need a grant. */
export type GrantId =
  | 'users'
  | 'shops'
  | 'drivers'
  | 'orders'
  | 'deliveries'
  | 'notifications'
  | 'feedback'
  | 'driver-wallets'
  | 'topups'
  | 'withdrawals'
  | 'catalog'
  | 'zones'
  | 'order-timeouts'
  | 'parameters'
  | 'audit'
  | 'monitoring';

export type Grants = ReadonlySet<GrantId>;

/** Nothing granted: what an ADMIN is shown until (and unless) the server's permissions arrive. Fail closed. */
export const NO_GRANTS: Grants = new Set<GrantId>();

/** One row of GET /v1/admin-auth/permissions. */
export interface AppPermission {
  readonly app: 'CUSTOMER' | 'SHOP' | 'DRIVER';
  readonly canView: boolean;
  readonly canReviewProfile: boolean;
  readonly canLock: boolean;
  /** Dish-group management (SHOP only). Absent = false. */
  readonly canManageCatalog?: boolean;
}

/**
 * Menu grants of an ADMIN from the server's CURRENT can_view rows: CUSTOMER -> users, SHOP -> users + shops,
 * DRIVER -> users + drivers. Review/lock rights open no menu entry (and no mutation is wired yet). The catalog right (SHOP row with
 * VIEW and canManageCatalog) opens "Danh mục · Nhóm món".
 */
export function grantsFromPermissions(permissions: readonly AppPermission[]): Grants {
  const grants = new Set<GrantId>();
  for (const row of permissions) {
    if (!row.canView) {
      continue;
    }
    grants.add('users');
    if (row.app === 'SHOP') {
      grants.add('shops');
      if (row.canManageCatalog === true) {
        grants.add('catalog');
      }
    } else if (row.app === 'DRIVER') {
      grants.add('drivers');
      if(row.canLock)grants.add('order-timeouts');
    }
    // M07.07: the delivery pages open for an administrator who may view the shop or the Shipper side; the server decides every read and action again.
    if (row.app === 'SHOP' || row.app === 'DRIVER') {
      grants.add('deliveries');
      grants.add('orders');
      // M08.06: the notification pages open for the same viewers; the server narrows what is listed to the apps the administrator may view.
      grants.add('notifications');
      // M11.03: the rating and complaint pages open for the same viewers; the server decides every read and every action again (an action needs the review right).
      grants.add('feedback');
    }
  }
  return grants;
}

export type MenuAccess = 'any' | 'system' | GrantId;

export interface MenuLeaf {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Present exactly when `ready`. A not-ready entry never navigates anywhere (no blank page). */
  readonly route?: Route;
  readonly ready: boolean;
  readonly access: MenuAccess;
}

export interface MenuItem extends MenuLeaf {
  readonly icon: IconName;
  readonly children?: readonly MenuLeaf[];
}

export interface MenuGroup {
  readonly id: string;
  /** Section heading ("TÀI KHOẢN"); the first group has none. */
  readonly label?: string;
  readonly items: readonly MenuItem[];
}

const soon = (id: string, label: string, icon: IconName, access: GrantId): MenuItem => ({ id, label, icon, ready: false, access });

export const MENU: readonly MenuGroup[] = [
  {
    id: 'overview',
    items: [
      { id: 'home', label: 'Tổng quan', icon: 'home', route: { name: 'home' }, ready: true, access: 'any' },
      // M12-A: the figures and the work waiting; every figure is gated by the server per administrator (FORBIDDEN / NOT_READY / ERROR are shown as such).
      { id: 'overview', label: 'Điều hành', icon: 'activity', route: { name: 'overview' }, ready: true, access: 'any' },
      // M12-E: reports and CSV/Excel export; the server checks the report and export rights again on every read and download.
      { id: 'reports', label: 'Báo cáo', icon: 'activity', route: { name: 'reports' }, ready: true, access: 'any' },
    ],
  },
  {
    id: 'accounts',
    label: 'TÀI KHOẢN',
    items: [
      {
        id: 'users',
        label: 'Người dùng',
        icon: 'user',
        ready: true,
        access: 'users',
        children: [
          { id: 'users-list', label: 'Danh sách', route: { name: 'users' }, ready: true, access: 'users' },
          { id: 'users-locked', label: 'Đang khóa', route: { name: 'users', status: 'LOCKED' }, ready: true, access: 'users' },
        ],
      },
      { id: 'administrators', label: 'Quản trị viên', icon: 'shield', route: { name: 'administrators' }, ready: true, access: 'system' },
      // M12-C: SYSTEM gives and takes back the rights of each ADMIN, locks the account and ends its sessions.
      { id: 'access', label: 'Phân quyền', icon: 'key', route: { name: 'access' }, ready: true, access: 'system' },
      { id: 'invitations', label: 'Lời mời Admin', icon: 'mail', route: { name: 'invitations' }, ready: true, access: 'system' },
    ],
  },
  {
    id: 'operations',
    label: 'VẬN HÀNH',
    items: [
      soon('shops', 'Quán', 'store', 'shops'),
      { id: 'drivers', label: 'Shipper', icon: 'rider', route: { name: 'shippers' }, ready: true, access: 'drivers' },
      { id: 'orders', label: 'Đơn hàng', icon: 'receipt', route: { name: 'orders' }, ready: true, access: 'orders' },
      { id: 'deliveries', label: 'Giao hàng', icon: 'truck', route: { name: 'deliveries' }, ready: true, access: 'deliveries' },
      { id: 'notifications', label: 'Thông báo', icon: 'bell', route: { name: 'notifications' }, ready: true, access: 'notifications' },
      { id: 'reviews', label: 'Đánh giá', icon: 'star', route: { name: 'reviews' }, ready: true, access: 'feedback' },
      { id: 'complaints', label: 'Phản ánh', icon: 'chat', route: { name: 'complaints' }, ready: true, access: 'feedback' },
    ],
  },
  {
    id: 'catalog',
    label: 'DANH MỤC',
    items: [
      {
        id: 'catalog',
        label: 'Danh mục',
        icon: 'store',
        ready: true,
        access: 'catalog',
        children: [{ id: 'catalog-categories', label: 'Nhóm món', route: { name: 'categories' }, ready: true, access: 'catalog' }],
      },
    ],
  },
  {
    // M04 (UI phase, Owner-approved 2026-10-15): Tổng quan / Ví Shipper / Nạp tiền / Rút tiền / Giao dịch / Đối soát. SYSTEM sees all of it;
    // an ADMIN needs the matching grant, which the server does not send yet (grantsFromPermissions), so for now only SYSTEM sees it.
    id: 'finance',
    label: 'TÀI CHÍNH',
    items: [
      {
        id: 'finance',
        label: 'Tài chính',
        icon: 'wallet',
        ready: true,
        // B3a: the children decide (an ADMIN with only wallet.read sees only "Nạp tiền"); a parent without a visible child is dropped.
        access: 'any',
        children: [
          { id: 'finance-overview', label: 'Tổng quan', route: { name: 'finance' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-wallets', label: 'Ví Shipper', route: { name: 'finance-wallets' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-topups', label: 'Nạp tiền', route: { name: 'finance-topups' }, ready: true, access: 'topups' },
          { id: 'finance-withdrawals', label: 'Rút tiền', route: { name: 'finance-withdrawals' }, ready: true, access: 'withdrawals' },
          { id: 'finance-transactions', label: 'Giao dịch', route: { name: 'finance-transactions' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-reconciliation', label: 'Đối soát', route: { name: 'finance-reconciliation' }, ready: true, access: 'driver-wallets' },
          // B3a: the receiving accounts of the system (SYSTEM only; the server decides again).
          { id: 'finance-bank-accounts', label: 'Tài khoản nhận tiền', route: { name: 'finance-bank-accounts' }, ready: true, access: 'system' },
        ],
      },
    ],
  },
  {
    id: 'system',
    label: 'HỆ THỐNG',
    items: [
      // Owner decision 2026-10-14: the SYSTEM account's switches (phone verification first). SYSTEM only.
      { id: 'system-settings', label: 'Cài đặt hệ thống', icon: 'gear', route: { name: 'settings' }, ready: true, access: 'system' },
      // M12-D: every group of configuration in one place (every administrator reads; only SYSTEM changes, and each owner decides again).
      { id: 'config', label: 'Cấu hình tập trung', icon: 'gear', route: { name: 'config' }, ready: true, access: 'any' },
      { id:'order-timeouts',label:'Thời hạn xử lý đơn',icon:'gear',route:{name:'order-timeouts'},ready:true,access:'order-timeouts' },
      soon('zones', 'Vùng hoạt động', 'map-pin', 'zones'),
      // M03: Cài đặt › Tham số hệ thống › Ví Shipper (minimum top-up / withdrawal per request). Every administrator sees the values; only SYSTEM changes them
      // (Owner decision 2026-10-17; the server decides again on every call).
      {
        id: 'parameters',
        label: 'Tham số hệ thống',
        icon: 'gear',
        ready: true,
        access: 'any',
        children: [{ id: 'parameters-shipper-wallet', label: 'Ví Shipper', route: { name: 'wallet-parameters' }, ready: true, access: 'any' }],
      },
      // M06-A: Phí & điều kiện giao (fee table; every administrator reads, only SYSTEM changes, the server decides again).
      { id: 'shipping-policy', label: 'Phí & điều kiện giao', icon: 'gear', route: { name: 'shipping-policy' }, ready: true, access: 'any' },
      soon('audit', 'Nhật ký', 'doc', 'audit'),
      { id: 'monitoring', label: 'Giám sát', icon: 'activity', ready: true, access: 'system', children: [
        { id: 'monitoring-errors', label: 'Nhật ký lỗi', route: { name: 'monitoring-errors' }, ready: true, access: 'system' },
      ] },
    ],
  },
];

export function canSee(role: AdminRole, grants: Grants, access: MenuAccess): boolean {
  if (access === 'any') {
    return true;
  }
  if (role === 'SYSTEM') {
    return true;
  }
  return access !== 'system' && grants.has(access);
}

/** The menu one role is shown: entries it cannot use are dropped, and so are children-less parents and empty sections. */
export function visibleMenu(role: AdminRole, grants: Grants = NO_GRANTS): readonly MenuGroup[] {
  const groups: MenuGroup[] = [];
  for (const group of MENU) {
    const items: MenuItem[] = [];
    for (const item of group.items) {
      if (!canSee(role, grants, item.access)) {
        continue;
      }
      if (item.children === undefined) {
        items.push(item);
        continue;
      }
      const children = item.children.filter((child) => canSee(role, grants, child.access));
      if (children.length > 0) {
        items.push({ ...item, children });
      }
    }
    if (items.length > 0) {
      groups.push({ ...group, items });
    }
  }
  return groups;
}

/** Where an entry leads: its own route, or the first child's for a parent ("Người dùng" opens "Danh sách"). */
export function entryRoute(item: MenuItem): Route | undefined {
  return item.route ?? item.children?.find((child) => child.route !== undefined)?.route;
}

/** Whether `role` may open a page. The backend decides again; this only avoids drawing a page the menu hides. */
export function canOpenRoute(role: AdminRole, grants: Grants, route: Route): boolean {
  switch (route.name) {
    case 'home':
    case 'overview':
    case 'reports':
    case 'config':
    case 'activate':
    case 'reset':
    case 'wallet-parameters':
    case 'shipping-policy':
      return true;
    case 'users':
    case 'user':
      return canSee(role, grants, 'users');
    case 'categories':
      return canSee(role, grants, 'catalog');
    case 'shippers':
    case 'shipper':
      return canSee(role, grants, 'drivers');
    case 'orders':
      return canSee(role, grants, 'orders');
    case 'deliveries':
      return canSee(role, grants, 'deliveries');
    case 'notifications':
      return canSee(role, grants, 'notifications');
    case 'reviews':
    case 'complaints':
      return canSee(role, grants, 'feedback');
    case 'finance':
    case 'finance-wallets':
    case 'finance-transactions':
    case 'finance-reconciliation':
      return canSee(role, grants, 'driver-wallets');
    case 'finance-topups':
    case 'finance-topup':
      return canSee(role, grants, 'topups');
    case 'finance-bank-accounts':
    case 'monitoring-errors':
      return role === 'SYSTEM';
    case 'finance-withdrawals':
    case 'finance-withdrawal':
      return canSee(role, grants, 'withdrawals');
    case 'wallet-params':
      return canSee(role, grants, 'parameters');
    case 'order-timeouts':
      return canSee(role,grants,'order-timeouts');
    case 'administrators':
    case 'access':
    case 'settings':
    case 'invitations':
    case 'invitation-new':
    case 'invitation':
    case 'invitation-reissue':
    case 'invitation-revoke':
      return role === 'SYSTEM';
  }
}

/** The id of the menu entry that is "current" for a route (a user's detail keeps "Danh sách" lit). */
export function activeMenuId(route: Route): string {
  switch (route.name) {
    case 'users':
      return route.status === 'LOCKED' ? 'users-locked' : 'users-list';
    case 'user':
      return 'users-list';
    case 'categories':
      return 'catalog-categories';
    case 'shippers':
    case 'shipper':
      return 'drivers';
    case 'orders':
      return 'orders';
    case 'deliveries':
      return 'deliveries';
    case 'notifications':
      return 'notifications';
    case 'reviews':
      return 'reviews';
    case 'complaints':
      return 'complaints';
    case 'wallet-parameters':
      return 'parameters-shipper-wallet';
    case 'shipping-policy':
      return 'shipping-policy';
    case 'finance':
      return 'finance-overview';
    case 'finance-wallets':
      return 'finance-wallets';
    case 'finance-topups':
    case 'finance-topup':
      return 'finance-topups';
    case 'finance-bank-accounts':
      return 'finance-bank-accounts';
    case 'finance-withdrawals':
    case 'finance-withdrawal':
      return 'finance-withdrawals';
    case 'finance-transactions':
      return 'finance-transactions';
    case 'finance-reconciliation':
      return 'finance-reconciliation';
    case 'wallet-params':
      return 'parameters';
    case 'administrators':
      return 'administrators';
    case 'access':
      return 'access';
    case 'order-timeouts':
      return 'order-timeouts';
    case 'settings':
      return 'system-settings';
    case 'monitoring-errors':
      return 'monitoring-errors';
    case 'invitations':
    case 'invitation-new':
    case 'invitation':
    case 'invitation-reissue':
    case 'invitation-revoke':
      return 'invitations';
    case 'overview':
      return 'overview';
    case 'reports':
      return 'reports';
    case 'config':
      return 'config';
    case 'home':
    case 'activate':
    case 'reset':
      return 'home';
  }
}

/** Breadcrumb of the top bar: [section, page] or [page]. */
export function breadcrumb(route: Route): readonly string[] {
  switch (route.name) {
    case 'users':
      return route.status === 'LOCKED' ? ['Tài khoản', 'Người dùng', 'Đang khóa'] : ['Tài khoản', 'Người dùng'];
    case 'user':
      return ['Tài khoản', 'Người dùng', 'Chi tiết'];
    case 'categories':
      return ['Danh mục', 'Nhóm món'];
    case 'shippers':
      return ['Vận hành', 'Shipper'];
    case 'shipper':
      return ['Vận hành', 'Shipper', 'Chi tiết'];
    case 'orders':
      return ['Vận hành', 'Đơn hàng'];
    case 'deliveries':
      return ['Vận hành', 'Giao hàng'];
    case 'notifications':
      return ['Vận hành', 'Thông báo'];
    case 'reviews':
      return ['Vận hành', 'Đánh giá'];
    case 'complaints':
      return ['Vận hành', 'Phản ánh'];
    case 'wallet-parameters':
      return ['Cài đặt', 'Tham số hệ thống', 'Ví Shipper'];
    case 'shipping-policy':
      return ['Cài đặt', 'Phí & điều kiện giao'];
    case 'finance':
      return ['Tài chính', 'Tổng quan'];
    case 'finance-wallets':
      return ['Tài chính', 'Ví Shipper'];
    case 'finance-topups':
      return ['Tài chính', 'Nạp tiền'];
    case 'finance-topup':
      return ['Tài chính', 'Nạp tiền', 'Chi tiết'];
    case 'finance-bank-accounts':
      return ['Tài chính', 'Tài khoản nhận tiền'];
    case 'finance-withdrawals':
      return ['Tài chính', 'Rút tiền'];
    case 'finance-withdrawal':
      return ['Tài chính', 'Rút tiền', 'Chi tiết'];
    case 'finance-transactions':
      return ['Tài chính', 'Giao dịch'];
    case 'finance-reconciliation':
      return ['Tài chính', 'Đối soát'];
    case 'wallet-params':
      return ['Cài đặt', 'Tham số hệ thống', 'Ví Shipper'];
    case 'administrators':
      return ['Tài khoản', 'Quản trị viên'];
    case 'access':
      return ['Tài khoản', 'Phân quyền'];
    case 'order-timeouts':
      return ['Cài đặt hệ thống','Đơn hàng & giao hàng','Thời hạn xử lý'];
    case 'settings':
      return ['Hệ thống', 'Cài đặt hệ thống'];
    case 'monitoring-errors':
      return ['Hệ thống', 'Giám sát', 'Nhật ký lỗi'];
    case 'invitations':
      return ['Tài khoản', 'Lời mời Admin'];
    case 'invitation-new':
      return ['Lời mời Admin', 'Tạo lời mời'];
    case 'invitation':
      return ['Lời mời Admin', 'Chi tiết lời mời'];
    case 'invitation-reissue':
      return ['Lời mời Admin', 'Cấp lại lời mời'];
    case 'invitation-revoke':
      return ['Lời mời Admin', 'Thu hồi lời mời'];
    case 'overview':
      return ['Tổng quan', 'Điều hành'];
    case 'reports':
      return ['Tổng quan', 'Báo cáo'];
    case 'config':
      return ['Cài đặt', 'Cấu hình tập trung'];
    case 'home':
    case 'activate':
    case 'reset':
      return ['Tổng quan'];
  }
}

/** Every leaf of the menu, flattened (tests and the "coming soon" report). */
export function allLeaves(): readonly MenuLeaf[] {
  return MENU.flatMap((group) => group.items.flatMap((item) => [item, ...(item.children ?? [])]));
}

/**
 * The sidebar has two separate modes: the desktop rail (a saved choice, 64 px, icons only) and the phone/tablet drawer (always
 * the full menu, with its sub-entries, opened by the top bar). The saved "collapsed" choice only applies to the desktop rail:
 * in drawer mode the menu is never compact, and the choice comes back untouched when the window is wide again.
 */
export function compactSidebar(collapsedChoice: boolean, drawerMode: boolean): boolean {
  return collapsedChoice && !drawerMode;
}

/** Width at which the sidebar becomes a drawer. Keep in step with the `max-width` media query of styles.css. */
export const DRAWER_QUERY = '(max-width: 900px)';
