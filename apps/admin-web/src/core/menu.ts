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
  | 'monitoring'
  // M13: the "Vận hành hệ thống" section. An ADMIN gets it only from the server's answer (GET /admin/ops/me), never from the application grants.
  | 'ops';

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
  /** Shop activity management (SHOP only). Absent = false. */
  readonly canManageShops?: boolean;
  /** Cancelling a running order (DRIVER only). Absent = false. */
  readonly canCancelOrders?: boolean;
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
  /**
   * Sidebar section heading: ĐIỀU HÀNH / QUẢN LÝ / HỆ THỐNG. Consecutive groups with the same section share one heading.
   * Grouping is presentation only: ids, routes, access and the server's rights are unchanged.
   */
  readonly section?: string;
  readonly items: readonly MenuItem[];
}


export const MENU: readonly MenuGroup[] = [
  {
    id: 'overview',
    section: 'ĐIỀU HÀNH',
    items: [
      // The landing page (route home) only says the sign-in worked; the working overview is "Điều hành". M12-A/E: the server gates every figure and export per administrator.
      {
        id: 'overview-group',
        label: 'Tổng quan',
        icon: 'home',
        ready: true,
        access: 'any',
        children: [
          { id: 'overview', label: 'Việc cần xử lý & số liệu', route: { name: 'overview' }, ready: true, access: 'any' },
          { id: 'reports', label: 'Báo cáo', route: { name: 'reports' }, ready: true, access: 'any' },
        ],
      },
    ],
  },
  {
    id: 'operations',
    section: 'ĐIỀU HÀNH',
    items: [
      {
        id: 'orders-group',
        label: 'Đơn & giao hàng',
        icon: 'receipt',
        ready: true,
        access: 'any',
        children: [
          { id: 'orders', label: 'Đơn hàng', route: { name: 'orders' }, ready: true, access: 'orders' },
          { id: 'deliveries', label: 'Giao hàng', route: { name: 'deliveries' }, ready: true, access: 'deliveries' },
        ],
      },
      {
        id: 'shops-group',
        label: 'Quán & thực đơn',
        icon: 'store',
        ready: true,
        access: 'any',
        children: [
          // M02 shop management; an ADMIN needs VIEW on the SHOP app (the server decides every call again).
          { id: 'shops', label: 'Quán', route: { name: 'shops' }, ready: true, access: 'shops' },
          { id: 'catalog-categories', label: 'Nhóm món', route: { name: 'categories' }, ready: true, access: 'catalog' },
        ],
      },
      { id: 'drivers', label: 'Shipper', icon: 'rider', route: { name: 'shippers' }, ready: true, access: 'drivers' },
      {
        id: 'feedback-group',
        label: 'Phản hồi & thông báo',
        icon: 'chat',
        ready: true,
        access: 'any',
        children: [
          { id: 'reviews', label: 'Đánh giá', route: { name: 'reviews' }, ready: true, access: 'feedback' },
          { id: 'complaints', label: 'Phản ánh', route: { name: 'complaints' }, ready: true, access: 'feedback' },
          { id: 'notifications', label: 'Thông báo', route: { name: 'notifications' }, ready: true, access: 'notifications' },
        ],
      },
    ],
  },
  {
    id: 'accounts',
    section: 'QUẢN LÝ',
    items: [
      {
        id: 'users',
        label: 'Tài khoản',
        icon: 'user',
        ready: true,
        access: 'any',
        children: [
          { id: 'users-list', label: 'Người dùng', route: { name: 'users' }, ready: true, access: 'users' },
          { id: 'users-locked', label: 'Đang khóa', route: { name: 'users', status: 'LOCKED' }, ready: true, access: 'users' },
          // SYSTEM only: administrators, their rights (M12-C) and invitations.
          { id: 'administrators', label: 'Quản trị viên', route: { name: 'administrators' }, ready: true, access: 'system' },
          { id: 'access', label: 'Phân quyền', route: { name: 'access' }, ready: true, access: 'system' },
          { id: 'invitations', label: 'Lời mời Admin', route: { name: 'invitations' }, ready: true, access: 'system' },
        ],
      },
    ],
  },
  {
    // M04: SYSTEM sees all of it; an ADMIN needs the matching grant; a parent without a visible child is dropped.
    id: 'finance',
    section: 'QUẢN LÝ',
    items: [
      {
        id: 'finance',
        label: 'Tài chính',
        icon: 'wallet',
        ready: true,
        access: 'any',
        children: [
          { id: 'finance-overview', label: 'Tổng quan', route: { name: 'finance' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-wallets', label: 'Ví Shipper', route: { name: 'finance-wallets' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-topups', label: 'Nạp tiền', route: { name: 'finance-topups' }, ready: true, access: 'topups' },
          { id: 'finance-withdrawals', label: 'Rút tiền', route: { name: 'finance-withdrawals' }, ready: true, access: 'withdrawals' },
          { id: 'finance-transactions', label: 'Giao dịch', route: { name: 'finance-transactions' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-reconciliation', label: 'Đối soát', route: { name: 'finance-reconciliation' }, ready: true, access: 'driver-wallets' },
          { id: 'finance-bank-accounts', label: 'Tài khoản nhận tiền', route: { name: 'finance-bank-accounts' }, ready: true, access: 'system' },
        ],
      },
    ],
  },
  {
    // M13: SYSTEM sees all; an ADMIN only with a grant from SYSTEM (read from the server, which decides every call again).
    id: 'sysops',
    section: 'HỆ THỐNG',
    items: [
      {
        id: 'sysops',
        label: 'Vận hành hệ thống',
        icon: 'activity',
        ready: true,
        access: 'ops',
        children: [
          { id: 'sysops-overview', label: 'Tổng quan', route: { name: 'ops' }, ready: true, access: 'ops' },
          { id: 'sysops-vps', label: 'Giám sát VPS', route: { name: 'ops-vps' }, ready: true, access: 'ops' },
          { id: 'sysops-incidents', label: 'Sự cố', route: { name: 'ops-incidents' }, ready: true, access: 'ops' },
          { id: 'sysops-gateway', label: 'SMS Gateway', route: { name: 'ops-gateway' }, ready: true, access: 'ops' },
          { id: 'sysops-logs', label: 'Nhật ký máy chủ', route: { name: 'ops-logs' }, ready: true, access: 'ops' },
          { id: 'sysops-releases', label: 'Phiên bản & cập nhật', route: { name: 'ops-releases' }, ready: true, access: 'ops' },
          { id: 'sysops-config', label: 'Cấu hình', route: { name: 'ops-config' }, ready: true, access: 'ops' },
        ],
      },
    ],
  },
  {
    id: 'system',
    section: 'HỆ THỐNG',
    items: [
      {
        // Every setting in one place. Every administrator reads; only SYSTEM changes; each owner decides again.
        id: 'settings-group',
        label: 'Cài đặt',
        icon: 'gear',
        ready: true,
        access: 'any',
        children: [
          { id: 'system-settings', label: 'Cài đặt hệ thống', route: { name: 'settings' }, ready: true, access: 'system' },
          { id: 'config', label: 'Cấu hình tập trung', route: { name: 'config' }, ready: true, access: 'any' },
          { id: 'order-timeouts', label: 'Thời hạn xử lý đơn', route: { name: 'order-timeouts' }, ready: true, access: 'order-timeouts' },
          { id: 'zones', label: 'Vùng hoạt động', route: { name: 'zones' }, ready: true, access: 'any' },
          { id: 'parameters-shipper-wallet', label: 'Ví Shipper', route: { name: 'wallet-parameters' }, ready: true, access: 'any' },
          { id: 'parameters-otp', label: 'SMS & OTP', route: { name: 'otp-policy' }, ready: true, access: 'any' },
          { id: 'shipping-policy', label: 'Phí & điều kiện giao', route: { name: 'shipping-policy' }, ready: true, access: 'any' },
        ],
      },
      {
        id: 'logs-group',
        label: 'Nhật ký',
        icon: 'doc',
        ready: true,
        access: 'any',
        children: [
          // M12-F: the audit log (the server needs the audit.read right) and the error log (SYSTEM only).
          { id: 'audit', label: 'Hoạt động quản trị', route: { name: 'audit' }, ready: true, access: 'any' },
          { id: 'monitoring-errors', label: 'Lỗi hệ thống', route: { name: 'monitoring-errors' }, ready: true, access: 'system' },
        ],
      },
      { id: 'backups', label: 'Sao lưu và phục hồi', icon: 'shield', route: { name: 'backups' }, ready: true, access: 'system' },
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
    case 'audit':
    case 'config':
    case 'activate':
    case 'reset':
    case 'wallet-parameters':
    case 'otp-policy':
    case 'zones':
    case 'zone':
    case 'shipping-policy':
      return true;
    case 'users':
    case 'user':
      return canSee(role, grants, 'users');
    case 'categories':
      return canSee(role, grants, 'catalog');
    case 'shops':
    case 'shop':
      return canSee(role, grants, 'shops');
    case 'shippers':
    case 'shipper':
      return canSee(role, grants, 'drivers');
    case 'orders':
      return canSee(role, grants, 'orders');
    case 'deliveries':
      return canSee(role, grants, 'deliveries');
    case 'notifications':
      return canSee(role, grants, 'notifications');
    case 'ops':
    case 'ops-vps':
    case 'ops-incidents':
    case 'ops-incident':
    case 'ops-gateway':
    case 'ops-logs':
    case 'ops-releases':
    case 'ops-config':
      return canSee(role, grants, 'ops');
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
    case 'backups':
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
    case 'shops':
    case 'shop':
      return 'shops';
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
    case 'otp-policy':
      return 'parameters-otp';
    case 'zones':
    case 'zone':
      return 'zones';
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
    case 'ops':
      return 'sysops-overview';
    case 'ops-incidents':
    case 'ops-incident':
      return 'sysops-incidents';
    case 'ops-gateway':
      return 'sysops-gateway';
    case 'ops-logs':
      return 'sysops-logs';
    case 'ops-releases':
      return 'sysops-releases';
    case 'ops-config':
      return 'sysops-config';
    case 'ops-vps':
      return 'sysops-vps';
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
    case 'audit':
      return 'audit';
    case 'backups':
      return 'backups';
    case 'config':
      return 'config';
    case 'home':
    case 'activate':
    case 'reset':
      return 'overview';
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
      return ['Quán & thực đơn', 'Nhóm món'];
    case 'shops':
      return ['Quán & thực đơn', 'Quán'];
    case 'shop':
      return ['Quán & thực đơn', 'Quán', 'Chi tiết'];
    case 'shippers':
      return ['Shipper'];
    case 'shipper':
      return ['Shipper', 'Chi tiết'];
    case 'orders':
      return ['Đơn & giao hàng', 'Đơn hàng'];
    case 'deliveries':
      return ['Đơn & giao hàng', 'Giao hàng'];
    case 'notifications':
      return ['Phản hồi & thông báo', 'Thông báo'];
    case 'reviews':
      return ['Phản hồi & thông báo', 'Đánh giá'];
    case 'complaints':
      return ['Phản hồi & thông báo', 'Phản ánh'];
    case 'wallet-parameters':
      return ['Cài đặt', 'Ví Shipper'];
    case 'otp-policy':
      return ['Cài đặt', 'SMS & OTP'];
    case 'zones':
      return ['Cài đặt', 'Vùng hoạt động'];
    case 'zone':
      return ['Cài đặt', 'Vùng hoạt động', 'Chi tiết'];
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
      return ['Cài đặt', 'Ví Shipper'];
    case 'ops':
      return ['Vận hành hệ thống', 'Tổng quan'];
    case 'ops-vps':
      return ['Vận hành hệ thống', 'Giám sát VPS'];
    case 'ops-incidents':
      return ['Vận hành hệ thống', 'Sự cố'];
    case 'ops-incident':
      return ['Vận hành hệ thống', 'Sự cố', route.ref.toUpperCase()];
    case 'ops-gateway':
      return ['Vận hành hệ thống', 'SMS Gateway'];
    case 'ops-logs':
      return ['Vận hành hệ thống', 'Nhật ký máy chủ'];
    case 'ops-releases':
      return ['Vận hành hệ thống', 'Phiên bản & cập nhật'];
    case 'ops-config':
      return ['Vận hành hệ thống', 'Cấu hình'];
    case 'administrators':
      return ['Tài khoản', 'Quản trị viên'];
    case 'access':
      return ['Tài khoản', 'Phân quyền'];
    case 'order-timeouts':
      return ['Cài đặt', 'Thời hạn xử lý đơn'];
    case 'settings':
      return ['Cài đặt', 'Cài đặt hệ thống'];
    case 'monitoring-errors':
      return ['Nhật ký', 'Lỗi hệ thống'];
    case 'invitations':
      return ['Tài khoản', 'Lời mời Admin'];
    case 'invitation-new':
      return ['Tài khoản', 'Lời mời Admin', 'Tạo lời mời'];
    case 'invitation':
      return ['Tài khoản', 'Lời mời Admin', 'Chi tiết lời mời'];
    case 'invitation-reissue':
      return ['Tài khoản', 'Lời mời Admin', 'Cấp lại lời mời'];
    case 'invitation-revoke':
      return ['Tài khoản', 'Lời mời Admin', 'Thu hồi lời mời'];
    case 'overview':
      return ['Tổng quan', 'Điều hành'];
    case 'reports':
      return ['Tổng quan', 'Báo cáo'];
    case 'audit':
      return ['Nhật ký', 'Hoạt động quản trị'];
    case 'backups':
      return ['Sao lưu và phục hồi'];
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
