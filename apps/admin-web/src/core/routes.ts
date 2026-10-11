// Paths of the administration web. The server decides what a path may show (role, session); this only parses the URL.
// The activation page lives at /activate and the invitation token is in the URL FRAGMENT (#t=...), never in the path
// or the query, so it is not sent to any server by the browser and is removed from the address bar right after reading.

import { InvitationStatus, INVITATION_STATUSES, isUuid } from './provisioning-api.js';

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
  | { readonly name: 'administrators' };

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
  if (path === '/accounts/administrators') {
    return { name: 'administrators' };
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
