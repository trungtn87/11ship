// Paths of the administration web. The server decides what a path may show (role, session); this only parses the URL.
// The activation page lives at /activate and the invitation token is in the URL FRAGMENT (#t=...), never in the path
// or the query, so it is not sent to any server by the browser and is removed from the address bar right after reading.

import { DELIVERY_GROUPS } from './deliveries.js';
import { TOPUP_TABS, TopupTab, WITHDRAWAL_TABS, WithdrawalTab } from './finance.js';
import { TopupFilter, TOPUP_FILTERS } from './finance-admin.js';
import { WithdrawalFilterOps, WITHDRAWAL_FILTERS } from './finance-ops.js';
import { InvitationStatus, INVITATION_STATUSES, isUuid } from './provisioning-api.js';
import { SHIPPER_FILTERS, ShipperFilter } from './shippers.js';
import { PROFILE_FILTERS, ProfileFilter, SCHEDULE_FILTERS, ScheduleFilter, SEARCH_MAX, SHOP_TABS, ShopTab } from './shops.js';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'invitations'; readonly status?: InvitationStatus }
  | { readonly name: 'invitation-new' }
  | { readonly name: 'invitation'; readonly id: string }
  | { readonly name: 'invitation-reissue'; readonly id: string }
  | { readonly name: 'invitation-revoke'; readonly id: string }
  | { readonly name: 'activate' }
  | { readonly name: 'reset' }
  | { readonly name: 'users'; readonly status?: UserStatusFilter }
  | { readonly name: 'user'; readonly id: string }
  | { readonly name: 'administrators' }
  | { readonly name: 'access' }
  | { readonly name: 'categories' }
  // M02 shop management: the list (initial filters from the address) and one shop (optionally on a tab).
  | { readonly name: 'shops'; readonly q?: string; readonly area?: string; readonly profile?: ProfileFilter; readonly schedule?: ScheduleFilter }
  | { readonly name: 'shop'; readonly id: string; readonly tab?: ShopTab }
  | { readonly name: 'shippers'; readonly status?: ShipperFilter }
  | { readonly name: 'shipper'; readonly id: string }
  | { readonly name: 'deliveries'; readonly filter?: DeliveryRouteFilter }
  | { readonly name: 'overview' }
  | { readonly name: 'orders' }
  | { readonly name: 'notifications' }
  // M11.03: ratings and complaints.
  | { readonly name: 'reviews' }
  | { readonly name: 'complaints' }
  | { readonly name: 'wallet-parameters' }
  | { readonly name: 'otp-policy' }
  | { readonly name: 'shipping-policy' }
  | { readonly name: 'settings' }
  | { readonly name: 'config' }
  | { readonly name: 'reports' }
  | { readonly name: 'audit' }
  | { readonly name: 'backups' }
  | { readonly name: 'order-timeouts' }
  | { readonly name: 'monitoring-errors' }
  // M04 (UI phase): "Tài chính" and the wallet parameters ("Cài đặt › Tham số hệ thống › Ví Shipper").
  | { readonly name: 'finance' }
  | { readonly name: 'finance-wallets' }
  | { readonly name: 'finance-topups'; readonly tab?: TopupTab; readonly status?: TopupFilter }
  | { readonly name: 'finance-bank-accounts' }
  | { readonly name: 'finance-topup'; readonly id: string }
  | { readonly name: 'finance-withdrawals'; readonly tab?: WithdrawalTab; readonly status?: WithdrawalFilterOps }
  | { readonly name: 'finance-withdrawal'; readonly id: string }
  | { readonly name: 'finance-transactions'; readonly shipper?: string }
  | { readonly name: 'finance-reconciliation' }
  | { readonly name: 'wallet-params' }
  // M13 "Vận hành hệ thống": overview, incidents (list and one), SMS Gateway, log, versions & updates, configuration & maintenance.
  | { readonly name: 'ops' }
  | { readonly name: 'ops-vps' }
  | { readonly name: 'ops-incidents' }
  | { readonly name: 'ops-incident'; readonly ref: string }
  | { readonly name: 'ops-gateway' }
  | { readonly name: 'ops-logs' }
  | { readonly name: 'ops-releases' }
  | { readonly name: 'ops-config' };

/** What a link (the overview tiles) opens the delivery list with. Every field is checked against the closed sets below; anything else is dropped. */
export interface DeliveryRouteFilter {
  readonly group?: (typeof DELIVERY_GROUPS)[number];
  readonly state?: (typeof DELIVERY_ROUTE_STATES)[number];
  readonly basis?: 'created' | 'ended';
  /** `YYYY-MM-DD` days of the Vietnam calendar. */
  readonly from?: string;
  readonly to?: string;
}

export const DELIVERY_ROUTE_STATES = ['waiting_driver', 'accepted', 'location_confirmed', 'delivering', 'completed', 'failed', 'cancelled_by_merchant', 'search_stopped'] as const;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function deliveryFilter(search: string): DeliveryRouteFilter | undefined {
  const params = new URLSearchParams(search);
  const group = params.get('group');
  const state = params.get('state');
  const basis = params.get('basis');
  const from = params.get('from');
  const to = params.get('to');
  const filter: { -readonly [K in keyof DeliveryRouteFilter]: DeliveryRouteFilter[K] } = {};
  if (group !== null && (DELIVERY_GROUPS as readonly string[]).includes(group)) {
    filter.group = group as (typeof DELIVERY_GROUPS)[number];
  }
  if (state !== null && (DELIVERY_ROUTE_STATES as readonly string[]).includes(state)) {
    filter.state = state as (typeof DELIVERY_ROUTE_STATES)[number];
  }
  if (basis === 'created' || basis === 'ended') {
    filter.basis = basis;
  }
  if (from !== null && DAY_RE.test(from)) {
    filter.from = from;
  }
  if (to !== null && DAY_RE.test(to)) {
    filter.to = to;
  }
  return Object.keys(filter).length === 0 ? undefined : filter;
}

/** The only status filter with its own menu entry ("Đang khóa"); any other value of ?status= is ignored. */
export type UserStatusFilter = 'LOCKED';

export function parseRoute(pathname: string, search = ''): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/activate') {
    return { name: 'activate' };
  }
  if (path === '/reset') {
    return { name: 'reset' };
  }
  if (path === '/accounts/users') {
    return new URLSearchParams(search).get('status') === 'LOCKED' ? { name: 'users', status: 'LOCKED' } : { name: 'users' };
  }
  if (path === '/accounts/access') {
    return { name: 'access' };
  }
  if (path === '/accounts/administrators') {
    return { name: 'administrators' };
  }
  if (path === '/catalog/categories') {
    return { name: 'categories' };
  }
  if (path === '/system/audit') {
    return { name: 'audit' };
  }
  if (path === '/system/backups') {
    return { name: 'backups' };
  }
  if (path === '/reports') {
    return { name: 'reports' };
  }
  if (path === '/system/config') {
    return { name: 'config' };
  }
  if (path === '/system/settings/order-timeouts') return { name: 'order-timeouts' };
  if (path === '/system/monitoring/errors') return { name: 'monitoring-errors' };
  if (path === '/system/settings') {
    return { name: 'settings' };
  }
  if (path === '/system/parameters/otp') {
    return { name: 'otp-policy' };
  }
  if (path === '/system/parameters/shipper-wallet') {
    return { name: 'wallet-parameters' };
  }
  if (path === '/system/shipping-fee-policy') {
    return { name: 'shipping-policy' };
  }
  if (path === '/overview') {
    return { name: 'overview' };
  }
  if (path === '/operations/orders') {
    return { name: 'orders' };
  }
  if (path === '/operations/deliveries') {
    const filter = deliveryFilter(search);
    return filter === undefined ? { name: 'deliveries' } : { name: 'deliveries', filter };
  }
  if (path === '/operations/notifications') {
    return { name: 'notifications' };
  }
  if (path === '/operations/reviews') {
    return { name: 'reviews' };
  }
  if (path === '/operations/complaints') {
    return { name: 'complaints' };
  }
  if (path === '/operations/shops') {
    const params = new URLSearchParams(search);
    const q = params.get('q')?.trim().slice(0, SEARCH_MAX);
    const area = params.get('area');
    const profile = params.get('profile');
    const schedule = params.get('schedule');
    const filters: { -readonly [K in keyof Extract<Route, { name: 'shops' }>]?: Extract<Route, { name: 'shops' }>[K] } = {};
    if (q !== undefined && q !== '') {
      filters.q = q;
    }
    if (area !== null && isUuid(area)) {
      filters.area = area;
    }
    if (profile !== null && profile !== 'ALL' && (PROFILE_FILTERS as readonly string[]).includes(profile)) {
      filters.profile = profile as ProfileFilter;
    }
    if (schedule !== null && schedule !== 'ALL' && (SCHEDULE_FILTERS as readonly string[]).includes(schedule)) {
      filters.schedule = schedule as ScheduleFilter;
    }
    return { name: 'shops', ...filters };
  }
  const shop = /^\/operations\/shops\/([^/]+)$/.exec(path);
  if (shop !== null && isUuid(shop[1])) {
    const tab = new URLSearchParams(search).get('tab');
    return tab !== null && (SHOP_TABS as readonly string[]).includes(tab) && tab !== 'profile' ? { name: 'shop', id: shop[1], tab: tab as ShopTab } : { name: 'shop', id: shop[1] };
  }
  if (path === '/operations/shippers') {
    const status = new URLSearchParams(search).get('status');
    return status !== null && status !== 'ALL' && (SHIPPER_FILTERS as readonly string[]).includes(status) ? { name: 'shippers', status: status as ShipperFilter } : { name: 'shippers' };
  }
  const shipper = /^\/operations\/shippers\/([^/]+)$/.exec(path);
  if (shipper !== null && isUuid(shipper[1])) {
    return { name: 'shipper', id: shipper[1] };
  }
  const ops = parseOpsRoute(path);
  if (ops !== undefined) {
    return ops;
  }
  const finance = parseFinanceRoute(path, search);
  if (finance !== undefined) {
    return finance;
  }
  const user = /^\/accounts\/users\/([^/]+)$/.exec(path);
  if (user !== null && isUuid(user[1])) {
    return { name: 'user', id: user[1] };
  }
  if (path === '/invitations') {
    const status = new URLSearchParams(search).get('status');
    return status !== null && (INVITATION_STATUSES as readonly string[]).includes(status)
      ? { name: 'invitations', status: status as InvitationStatus }
      : { name: 'invitations' };
  }
  if (path === '/invitations/new') {
    return { name: 'invitation-new' };
  }
  const match = /^\/invitations\/([^/]+)(?:\/(reissue|revoke))?$/.exec(path);
  if (match !== null && isUuid(match[1])) {
    const id = match[1];
    if (match[2] === 'reissue') {
      return { name: 'invitation-reissue', id };
    }
    if (match[2] === 'revoke') {
      return { name: 'invitation-revoke', id };
    }
    return { name: 'invitation', id };
  }
  return { name: 'home' };
}

/** A SC-013 style incident code or a canonical uuid (the server decides what exists). */
const INCIDENT_REF = /^(?:SC-\d{1,9}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function parseOpsRoute(path: string): Route | undefined {
  switch (path) {
    case '/system-ops':
      return { name: 'ops' };
    case '/system-ops/vps':
      return { name: 'ops-vps' };
    case '/system-ops/incidents':
      return { name: 'ops-incidents' };
    case '/system-ops/gateway':
      return { name: 'ops-gateway' };
    case '/system-ops/logs':
      return { name: 'ops-logs' };
    case '/system-ops/releases':
      return { name: 'ops-releases' };
    case '/system-ops/config':
      return { name: 'ops-config' };
  }
  const incident = /^\/system-ops\/incidents\/([^/]+)$/.exec(path);
  return incident !== null && INCIDENT_REF.test(incident[1] as string) ? { name: 'ops-incident', ref: incident[1] as string } : undefined;
}

function parseFinanceRoute(path: string, search: string): Route | undefined {
  switch (path) {
    case '/finance':
      return { name: 'finance' };
    case '/finance/wallets':
      return { name: 'finance-wallets' };
    case '/finance/transactions': {
      const shipper = new URLSearchParams(search).get('shipper')?.trim().slice(0, 80);
      return shipper === undefined || shipper === '' ? { name: 'finance-transactions' } : { name: 'finance-transactions', shipper };
    }
    case '/finance/reconciliation':
      return { name: 'finance-reconciliation' };
    case '/system/parameters/wallet':
      return { name: 'wallet-params' };
    case '/finance/bank-accounts':
      return { name: 'finance-bank-accounts' };
    case '/finance/topups': {
      // B3a: the server's own states, one per call (?status=PENDING|CONFIRMED|REJECTED|CANCELLED|ALL). The old ?tab= of the mock is still read.
      const status = new URLSearchParams(search).get('status');
      if (status !== null && (TOPUP_FILTERS as readonly string[]).includes(status)) {
        return { name: 'finance-topups', status: status as TopupFilter };
      }
      const tab = new URLSearchParams(search).get('tab');
      return tab !== null && (TOPUP_TABS as readonly string[]).includes(tab) ? { name: 'finance-topups', tab: tab as TopupTab } : { name: 'finance-topups' };
    }
    case '/finance/withdrawals': {
      const params = new URLSearchParams(search);
      const status = params.get('status');
      if (status !== null && (WITHDRAWAL_FILTERS as readonly string[]).includes(status)) {
        return { name: 'finance-withdrawals', status: status as WithdrawalFilterOps };
      }
      const tab = params.get('tab');
      return tab !== null && (WITHDRAWAL_TABS as readonly string[]).includes(tab) ? { name: 'finance-withdrawals', tab: tab as WithdrawalTab } : { name: 'finance-withdrawals' };
    }
  }
  const topup = /^\/finance\/topups\/([^/]+)$/.exec(path);
  if (topup !== null && isUuid(topup[1])) {
    return { name: 'finance-topup', id: topup[1] };
  }
  const withdrawal = /^\/finance\/withdrawals\/([^/]+)$/.exec(path);
  if (withdrawal !== null && isUuid(withdrawal[1])) {
    return { name: 'finance-withdrawal', id: withdrawal[1] };
  }
  return undefined;
}

/**
 * Where a figure of the overview leads: only the closed set of areas the server may name, and each filter is re-checked by the route parser (an unknown
 * or malformed value is dropped, never passed on). The list the link opens answers with the same filter the number was counted with.
 */
export function routeOfLink(area: 'deliveries' | 'shippers' | 'finance-topups' | 'finance-withdrawals' | 'orders' | 'complaints', query: Readonly<Record<string, string>>): Route {
  const search = new URLSearchParams(query as Record<string, string>).toString();
  const suffix = search === '' ? '' : `?${search}`;
  switch (area) {
    case 'deliveries':
      return parseRoute('/operations/deliveries', suffix);
    case 'shippers':
      return parseRoute('/operations/shippers', suffix);
    case 'finance-topups':
      return parseRoute('/finance/topups', suffix);
    case 'finance-withdrawals':
      return parseRoute('/finance/withdrawals', suffix);
    case 'orders':
      return parseRoute('/operations/orders', suffix);
    case 'complaints':
      return parseRoute('/operations/complaints', suffix);
  }
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'activate':
      return '/activate';
    case 'reset':
      return '/reset';
    case 'users':
      return route.status === undefined ? '/accounts/users' : `/accounts/users?status=${route.status}`;
    case 'user':
      return `/accounts/users/${route.id}`;
    case 'administrators':
      return '/accounts/administrators';
    case 'access':
      return '/accounts/access';
    case 'categories':
      return '/catalog/categories';
    case 'order-timeouts':
      return '/system/settings/order-timeouts';
    case 'settings':
      return '/system/settings';
    case 'reports':
      return '/reports';
    case 'audit':
      return '/system/audit';
    case 'backups':
      return '/system/backups';
    case 'config':
      return '/system/config';
    case 'monitoring-errors':
      return '/system/monitoring/errors';
    case 'otp-policy':
      return '/system/parameters/otp';
    case 'wallet-parameters':
      return '/system/parameters/shipper-wallet';
    case 'shipping-policy':
      return '/system/shipping-fee-policy';
    case 'shops': {
      const params = new URLSearchParams();
      if (route.q !== undefined) params.set('q', route.q);
      if (route.area !== undefined) params.set('area', route.area);
      if (route.profile !== undefined) params.set('profile', route.profile);
      if (route.schedule !== undefined) params.set('schedule', route.schedule);
      const text = params.toString();
      return text === '' ? '/operations/shops' : `/operations/shops?${text}`;
    }
    case 'shop':
      return route.tab === undefined || route.tab === 'profile' ? `/operations/shops/${route.id}` : `/operations/shops/${route.id}?tab=${route.tab}`;
    case 'shippers':
      return route.status === undefined ? '/operations/shippers' : `/operations/shippers?status=${route.status}`;
    case 'shipper':
      return `/operations/shippers/${route.id}`;
    case 'overview':
      return '/overview';
    case 'deliveries': {
      const entries = Object.entries(route.filter ?? {}).filter(([, value]) => value !== undefined) as Array<[string, string]>;
      return entries.length === 0 ? '/operations/deliveries' : `/operations/deliveries?${new URLSearchParams(entries).toString()}`;
    }
    case 'orders':
      return '/operations/orders';
    case 'notifications':
      return '/operations/notifications';
    case 'reviews':
      return '/operations/reviews';
    case 'complaints':
      return '/operations/complaints';
    case 'finance':
      return '/finance';
    case 'finance-wallets':
      return '/finance/wallets';
    case 'finance-topups':
      return route.status !== undefined ? `/finance/topups?status=${route.status}` : route.tab === undefined ? '/finance/topups' : `/finance/topups?tab=${route.tab}`;
    case 'finance-bank-accounts':
      return '/finance/bank-accounts';
    case 'finance-topup':
      return `/finance/topups/${route.id}`;
    case 'finance-withdrawals':
      return route.status !== undefined ? `/finance/withdrawals?status=${route.status}` : route.tab === undefined ? '/finance/withdrawals' : `/finance/withdrawals?tab=${route.tab}`;
    case 'finance-withdrawal':
      return `/finance/withdrawals/${route.id}`;
    case 'finance-transactions':
      return route.shipper === undefined ? '/finance/transactions' : `/finance/transactions?shipper=${encodeURIComponent(route.shipper)}`;
    case 'finance-reconciliation':
      return '/finance/reconciliation';
    case 'wallet-params':
      return '/system/parameters/wallet';
    case 'ops':
      return '/system-ops';
    case 'ops-vps':
      return '/system-ops/vps';
    case 'ops-incidents':
      return '/system-ops/incidents';
    case 'ops-incident':
      return `/system-ops/incidents/${encodeURIComponent(route.ref)}`;
    case 'ops-gateway':
      return '/system-ops/gateway';
    case 'ops-logs':
      return '/system-ops/logs';
    case 'ops-releases':
      return '/system-ops/releases';
    case 'ops-config':
      return '/system-ops/config';
    case 'invitations':
      return route.status === undefined ? '/invitations' : `/invitations?status=${route.status}`;
    case 'invitation-new':
      return '/invitations/new';
    case 'invitation':
      return `/invitations/${route.id}`;
    case 'invitation-reissue':
      return `/invitations/${route.id}/reissue`;
    case 'invitation-revoke':
      return `/invitations/${route.id}/revoke`;
  }
}

/** `#t=<43 base64url chars>` -> the token, or undefined for anything else (the backend answers one code either way). */
export function tokenFromFragment(hash: string): string | undefined {
  const match = /^#t=([A-Za-z0-9_-]{43})$/.exec(hash);
  return match === null ? undefined : match[1];
}
