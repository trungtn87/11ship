// Reads the server projections (login result and GET /v1/auth/me) and decides the screen. Pure: no DOM, no network.
// The client never invents a role and never adds one itself: it only shows what the server projected, and anything
// it does not understand fails closed (an "unsupported" screen with a retry), never a guessed route.

export const SUPPORTED_ROLES = Object.freeze(['SHOP', 'DRIVER']);
export const SHOP_STATES = Object.freeze(['NOT_STARTED', 'INCOMPLETE', 'COMPLETED']);
export const DRIVER_STATES = Object.freeze(['NOT_STARTED', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED']);
export const PHONE_STATUSES = Object.freeze(['VERIFIED', 'UNVERIFIED_TEST']);

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** GET /v1/auth/me data -> normalized projection, or null when the shape is not the contract. */
export function parseMe(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const onboarding = data.onboarding;
  if (
    typeof data.user_id !== 'string' ||
    typeof data.phone_normalized !== 'string' ||
    !isStringArray(data.available_roles) ||
    !(data.active_role === null || typeof data.active_role === 'string') ||
    typeof data.onboarding_required !== 'boolean' ||
    typeof data.role_selection_required !== 'boolean' ||
    onboarding === null ||
    typeof onboarding !== 'object' ||
    !SHOP_STATES.includes(onboarding.shop) ||
    !DRIVER_STATES.includes(onboarding.driver) ||
    !PHONE_STATUSES.includes(data.phone_verification_status)
  ) {
    return null;
  }
  return Object.freeze({
    userId: data.user_id,
    phone: data.phone_normalized,
    availableRoles: Object.freeze([...data.available_roles]),
    activeRole: data.active_role,
    onboardingRequired: data.onboarding_required,
    roleSelectionRequired: data.role_selection_required,
    shop: onboarding.shop,
    driver: onboarding.driver,
    phoneStatus: data.phone_verification_status,
  });
}

/** POST /v1/auth/login data -> what the router needs before the first /me, or null. */
export function parseLogin(data) {
  if (
    data === null ||
    typeof data !== 'object' ||
    typeof data.access_token !== 'string' ||
    data.access_token === '' ||
    typeof data.user_id !== 'string' ||
    !PHONE_STATUSES.includes(data.phone_verification_status)
  ) {
    return null;
  }
  return Object.freeze({
    accessToken: data.access_token,
    userId: data.user_id,
    phoneStatus: data.phone_verification_status,
  });
}

/** The roles the router may offer: only SHOP and DRIVER ever enter this router. */
export function selectableRoles(projection) {
  return projection.availableRoles.filter((role) => SUPPORTED_ROLES.includes(role));
}

/**
 * The screen for a projection, in the order of the design (FE0 section 4):
 *   1. an effective SHOP / DRIVER role that is still available -> its home;
 *   2. a role to choose -> role selection;
 *   3. no role -> the onboarding / profile status hub.
 * Anything inconsistent (an active role the server also says is unavailable, or an unknown role) -> unsupported.
 */
export function decideRoute(projection) {
  const roles = selectableRoles(projection);
  const active = projection.activeRole;
  if (active !== null) {
    if (!SUPPORTED_ROLES.includes(active) || !projection.availableRoles.includes(active)) {
      return { view: 'unsupported', reason: 'ACTIVE_ROLE_NOT_AVAILABLE' };
    }
    return { view: active === 'SHOP' ? 'shop-home' : 'driver-home' };
  }
  if (roles.length > 0) {
    return { view: 'role-select' };
  }
  return { view: 'onboarding-hub' };
}

/** Status badges for the two profiles. Text always says the state: colour is never the only signal. */
export function describeShop(projection) {
  const selectable = projection.availableRoles.includes('SHOP');
  switch (projection.shop) {
    case 'NOT_STARTED':
      return { tone: 'neutral', label: 'Chưa tạo hồ sơ', action: 'start' };
    case 'INCOMPLETE':
      return { tone: 'warning', label: 'Đang soạn, chưa hoàn tất', action: 'continue' };
    default:
      return selectable
        ? { tone: 'success', label: 'Đã hoàn tất', action: null }
        : { tone: 'danger', label: 'Quán đang tạm khóa hoặc chưa dùng được', action: null };
  }
}

export function describeDriver(projection) {
  switch (projection.driver) {
    case 'NOT_STARTED':
      return { tone: 'neutral', label: 'Chưa tạo hồ sơ', action: 'start' };
    case 'PENDING_APPROVAL':
      return { tone: 'warning', label: 'Chờ vận hành duyệt', action: null };
    case 'ACTIVE':
      return { tone: 'success', label: 'Đã được duyệt', action: null };
    case 'SUSPENDED':
      return { tone: 'danger', label: 'Đang bị tạm ngưng', action: null };
    case 'CLOSING':
      return { tone: 'warning', label: 'Đang đóng hồ sơ', action: null };
    default:
      return { tone: 'danger', label: 'Hồ sơ đã đóng', action: null };
  }
}

/** The conditions a shop draft still lacks before it can be completed, from the SAVED server profile. */
export function shopMissingConditions(profile) {
  const items = [
    { key: 'name', label: 'Tên quán', done: typeof profile.name === 'string' && profile.name !== '' },
    { key: 'contact_phone', label: 'Số điện thoại liên hệ', done: typeof profile.contact_phone === 'string' && profile.contact_phone !== '' },
    { key: 'address_text', label: 'Địa chỉ lấy hàng', done: typeof profile.address_text === 'string' && profile.address_text !== '' },
    { key: 'gps', label: 'Vị trí lấy hàng (GPS)', done: profile.pickup_lat !== null && profile.pickup_lng !== null },
    { key: 'service_area', label: 'Khu vực phục vụ', done: profile.service_area_id !== null },
  ];
  return { items, complete: items.every((item) => item.done) };
}

/** First six and last three characters only: enough to recognise the number, safe in a screenshot. */
export function maskPhone(phone) {
  if (typeof phone !== 'string' || phone.length < 10) {
    return '';
  }
  return `${phone.slice(0, 6)} ••• ${phone.slice(-3)}`;
}
