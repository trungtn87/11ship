import { normalizeVietnamPhone } from '../auth/phone';

// The quick-contact answer of the public shop page (issue #190, B). Phone, Zalo and Facebook are stored as the owner typed them; before they reach a
// customer each is turned into either a safe canonical value or null. Nothing is guessed: a value that is not exactly a recognised shape yields no
// button. Only https links to a fixed list of hosts are produced, rebuilt from validated parts (never echoed), so a stored `javascript:` / `intent:`
// / foreign-host string can never reach the app. The login phone of the account is never used here, only the shop's own contact phone.

export interface PublicContact {
  /** Normalized +84XXXXXXXXX, or null. */
  readonly phone: string | null;
  /** https://zalo.me/<national number or path>, or null. */
  readonly zaloUrl: string | null;
  /** https://m.me/<page or numeric id>, or null. */
  readonly messengerUrl: string | null;
  /** https://www.facebook.com/<page or profile.php?id=...>, or null. */
  readonly facebookUrl: string | null;
}

const ZALO_HOSTS = new Set(['zalo.me', 'www.zalo.me', 'chat.zalo.me']);
const FACEBOOK_HOSTS = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com']);
const MESSENGER_HOSTS = new Set(['m.me', 'www.m.me']);
const MESSENGER_COM_HOSTS = new Set(['messenger.com', 'www.messenger.com']);
const ZALO_PATH = /^[A-Za-z0-9._-]{1,64}$/;
const FB_NAME = /^[A-Za-z0-9.]{5,50}$/;
const FB_NUMERIC_ID = /^[0-9]{5,20}$/;
// First path segments of facebook.com that are features, not a page: never read as a page name.
const FB_RESERVED = new Set(['profile.php', 'pages', 'groups', 'people', 'watch', 'share', 'sharer', 'sharer.php', 'login', 'login.php', 'dialog', 'plugins', 'events', 'marketplace', 'gaming', 'stories', 'reel', 'reels', 'photo', 'photo.php', 'permalink.php', 'story.php', 'help', 'policies', 'privacy', 'ads', 'business', 'hashtag', 'search', 'public', 'l.php', 'home.php', 'messages', 'notes', 'fundraisers', 'friends', 'bookmarks', 'settings']);

function parseHttps(raw: string): URL | undefined {
  const text = raw.trim();
  if (text === '' || text.length > 300 || /[\s\u0000-\u001f\u007f]/u.test(text)) {
    return undefined;
  }
  // "zalo.me/xxx" typed without a scheme is accepted; any other scheme (javascript:, intent:, http:, tel:) is not.
  const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return undefined;
  }
  return url;
}

function segments(url: URL): string[] | undefined {
  const parts = url.pathname.split('/').filter((part) => part !== '');
  return parts.every((part) => !part.includes('%')) ? parts : undefined;
}

export function zaloUrlOf(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const phone = normalizeVietnamPhone(raw);
  if (phone !== undefined) {
    return `https://zalo.me/0${phone.slice(3)}`;
  }
  const url = parseHttps(raw);
  if (url === undefined || !ZALO_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }
  const parts = segments(url);
  if (parts === undefined) {
    return null;
  }
  // zalo.me/<phone or oa name>, or chat.zalo.me/?... is not a contact.
  if (parts.length === 1 && ZALO_PATH.test(parts[0] as string)) {
    return `https://zalo.me/${parts[0] as string}`;
  }
  return null;
}

/** Page name or numeric id of the Facebook / Messenger link, or undefined when the text is not exactly such a link. */
function facebookTarget(raw: string): { readonly kind: 'name' | 'id'; readonly value: string } | undefined {
  const url = parseHttps(raw);
  if (url === undefined) {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const parts = segments(url);
  if (parts === undefined) {
    return undefined;
  }
  if (MESSENGER_HOSTS.has(host)) {
    const value = parts[0];
    return parts.length === 1 && value !== undefined && (FB_NAME.test(value) || FB_NUMERIC_ID.test(value)) ? { kind: FB_NUMERIC_ID.test(value) ? 'id' : 'name', value } : undefined;
  }
  if (MESSENGER_COM_HOSTS.has(host)) {
    const value = parts[1];
    return parts.length === 2 && parts[0] === 't' && value !== undefined && (FB_NAME.test(value) || FB_NUMERIC_ID.test(value)) ? { kind: FB_NUMERIC_ID.test(value) ? 'id' : 'name', value } : undefined;
  }
  if (!FACEBOOK_HOSTS.has(host)) {
    return undefined;
  }
  if (parts.length === 1 && parts[0] === 'profile.php') {
    const id = url.searchParams.get('id');
    return id !== null && FB_NUMERIC_ID.test(id) ? { kind: 'id', value: id } : undefined;
  }
  const first = parts[0];
  if (parts.length === 1 && first !== undefined && !FB_RESERVED.has(first.toLowerCase()) && FB_NAME.test(first)) {
    return { kind: FB_NUMERIC_ID.test(first) ? 'id' : 'name', value: first };
  }
  return undefined;
}

export function facebookUrlsOf(raw: string | null): { readonly facebookUrl: string | null; readonly messengerUrl: string | null } {
  const target = raw === null ? undefined : facebookTarget(raw);
  if (target === undefined) {
    return { facebookUrl: null, messengerUrl: null };
  }
  const facebookUrl = target.kind === 'id' ? `https://www.facebook.com/profile.php?id=${target.value}` : `https://www.facebook.com/${target.value}`;
  return { facebookUrl, messengerUrl: `https://m.me/${target.value}` };
}

export function publicContactOf(shop: { readonly contactPhoneNormalized: string; readonly zalo: string | null; readonly facebook: string | null }): PublicContact {
  const phone = normalizeVietnamPhone(shop.contactPhoneNormalized) ?? null;
  return { phone, zaloUrl: zaloUrlOf(shop.zalo), ...facebookUrlsOf(shop.facebook) };
}
