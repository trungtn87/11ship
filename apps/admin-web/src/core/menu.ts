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
  | 'chat'
  | 'wallet'
  | 'plus-circle'
  | 'minus-circle'
  | 'map-pin'
  | 'gear'
  | 'doc'
  | 'activity';

/** A domain an ADMIN can be granted. SYSTEM does not need a grant. */
export type GrantId =
  | 'users'
  | 'shops'
  | 'drivers'
  | 'orders'
  | 'deliveries'
  | 'feedback'
  | 'driver-wallets'
  | 'topups'
  | 'withdrawals'
  | 'zones'
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
}

/**
 * Menu grants of an ADMIN from the server's CURRENT can_view rows: CUSTOMER -> users, SHOP -> users + shops,
 * DRIVER -> users + drivers. Review/lock rights open no menu entry (and no mutation is wired yet).
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
    } else if (row.app === 'DRIVER') {
      grants.add('drivers');
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
  { id: 'overview', items: [{ id: 'home', label: 'Tổng quan', icon: 'home', route: { name: 'home' }, ready: true, access: 'any' }] },
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
      { id: 'invitations', label: 'Lời mời Admin', icon: 'mail', route: { name: 'invitations' }, ready: true, access: 'system' },
    ],
  },
  {
    id: 'operations',
    label: 'VẬN HÀNH',
    items: [
      soon('shops', 'Quán', 'store', 'shops'),
      soon('drivers', 'Xế', 'rider', 'drivers'),
      soon('orders', 'Đơn hàng', 'receipt', 'orders'),
      soon('deliveries', 'Giao hàng', 'truck', 'deliveries'),
      soon('feedback', 'Phản ánh', 'chat', 'feedback'),
    ],
  },
  {
    id: 'finance',
    label: 'TÀI CHÍNH',
    items: [soon('driver-wallets', 'Ví xế', 'wallet', 'driver-wallets'), soon('topups', 'Nạp tiền', 'plus-circle', 'topups'), soon('withdrawals', 'Rút tiền', 'minus-circle', 'withdrawals')],
  },
  {
    id: 'system',
    label: 'HỆ THỐNG',
    items: [
      soon('zones', 'Vùng hoạt động', 'map-pin', 'zones'),
      soon('parameters', 'Tham số', 'gear', 'parameters'),
      soon('audit', 'Nhật ký', 'doc', 'audit'),
      soon('monitoring', 'Giám sát', 'activity', 'monitoring'),
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
    case 'activate':
    case 'reset':
      return true;
    case 'users':
    case 'user':
      return canSee(role, grants, 'users');
    case 'administrators':
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
    case 'administrators':
      return 'administrators';
    case 'invitations':
    case 'invitation-new':
    case 'invitation':
    case 'invitation-reissue':
    case 'invitation-revoke':
      return 'invitations';
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
    case 'administrators':
      return ['Tài khoản', 'Quản trị viên'];
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
