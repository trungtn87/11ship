import { FailureCode } from '../states.js';

// The wire contract of the client authentication, exactly as the backend of THIS repository answers it today:
//   REGISTER OTP   POST /v1/auth/phone-verifications               {phone, purpose:"REGISTER"}  -> 201 {data:{verification_id, expires_in_seconds, resend_after_seconds}}
//                  POST /v1/auth/phone-verifications/:id/verify    {otp}                        -> 200 {data:{verification_token, purpose, expires_in_seconds}}
//   client-auth    POST /v1/client-auth/register  (Idempotency-Key) {phone, password, verification_token, device, full_name, consent} -> 201 identity + access_token + session
//                  POST /v1/client-auth/register  (Idempotency-Key) {phone, password, device, full_name, consent}  (DISABLED_TEST mode only: no token) -> 201 identity + access_token + session
//                  GET  /v1/client-auth/config    (public, no query/body)                                                              -> 200 {data:{registration_verification:"REQUIRED"|"DISABLED_TEST"}}
//   recovery (no-OTP test build, M01-RESET)
//                  GET  /v1/account-recovery/config      (public, no query/body)                                                       -> 200 {data:{mode:"DISABLED_TEST"|"UNAVAILABLE"}}
//                  POST /v1/account-recovery/reset-test  (Idempotency-Key) {phone, password}  (DISABLED_TEST only; no code/proof)       -> 200 {data:{next:"LOGIN"}}
//                  POST /v1/client-auth/login     (Idempotency-Key) {phone, password, device}                                          -> 200 identity + access_token + session
//                  GET  /v1/client-auth/me        (Bearer)                                                                              -> 200 identity + session
//                  POST /v1/client-auth/context   (Bearer, Idempotency-Key) {context}                                                   -> 200 identity + session
//                  POST /v1/client-auth/logout    (Bearer) {}                                                                           -> 204
//   profile        GET  /v1/customer/me/profile   (Bearer, no query/body)                                                               -> 200 {data:{user_id, full_name, version}} | {data:null}
//                  PUT  /v1/customer/me/profile   (Bearer, Idempotency-Key) {full_name, expected_version}                              -> 200 {data:{user_id, full_name, version}}
//   shop (11Food)  GET  /v1/onboarding/shop/profile       (Bearer, no query/body)                                                     -> 200 {data:null} | {data:{shop_id, name, contact_phone, zalo, facebook, address_text, pickup_lat, pickup_lng, service_area_id, status, accepting_orders, version}}
//                  PUT  /v1/onboarding/shop/profile       (Bearer, Idempotency-Key) {name, contact_phone, address_text, zalo?, facebook?, pickup_lat?, pickup_lng?, service_area_id?, expected_version?} -> 201 (created) | 200 (updated) {data:{shop_id, status:"INCOMPLETE", version, role_granted:false}}
//                  POST /v1/onboarding/shop/complete      (Bearer, Idempotency-Key) {expected_version}                                -> 200 {data:{shop_id, status:"ACTIVE", accepting_orders:false, role_granted:true, version}}
//                  GET  /v1/onboarding/shop/service-areas (Bearer, no query/body)                                                     -> 200 {data:[{service_area_id, name}]}
//   driver (11Ship) GET /v1/driver/me                 (Bearer, no query/body)                                                     -> 200 {data:null} | {data:{driver_id, user_id, full_name, plate_number, driver_type, status, accepting_deliveries, version}}
//                  POST /v1/onboarding/driver            (Bearer, Idempotency-Key) {full_name, plate_number?}                        -> 201 {data:{driver_id, driver_type:"EXTERNAL", status:"PENDING", accepting_deliveries:false, role_granted:true, version:1}}
// Errors: {error:{code, message, request_id, details}}. Only `code` is read, and only from a closed list per operation;
// `message`, `details` and `request_id` are never shown, stored or logged.
//
// Pure: no DOM, no network, no timers. It runs in the browser and in the Node tests.

export type ClientApp = 'FOOD' | 'SHIP';
export type PublicContext = 'CUSTOMER' | 'SHOP_OWNER' | 'DRIVER';
export const PUBLIC_CONTEXTS: readonly PublicContext[] = ['CUSTOMER', 'SHOP_OWNER', 'DRIVER'];

export const AUTH_PATHS = {
  requestOtp: '/v1/auth/phone-verifications',
  verifyOtp: (verificationId: string): string => `/v1/auth/phone-verifications/${verificationId}/verify`,
  register: '/v1/client-auth/register',
  config: '/v1/client-auth/config',
  recoveryConfig: '/v1/account-recovery/config',
  recoveryReset: '/v1/account-recovery/reset-test',
  login: '/v1/client-auth/login',
  me: '/v1/client-auth/me',
  context: '/v1/client-auth/context',
  logout: '/v1/client-auth/logout',
  profile: '/v1/customer/me/profile',
  shopProfile: '/v1/onboarding/shop/profile',
  shopComplete: '/v1/onboarding/shop/complete',
  shopServiceAreas: '/v1/onboarding/shop/service-areas',
  driverMe: '/v1/driver/me',
  driverOnboarding: '/v1/onboarding/driver',
} as const;

export const REGISTER_PURPOSE = 'REGISTER';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONSENT_VERSION = /^[A-Za-z0-9._-]{1,64}$/;
const DEVICE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_TOKEN_CHARS = 512;
const TOKEN_TEXT = /^[A-Za-z0-9._~+/=-]+$/;
/** Longest delay a server value may ask for (one day). Anything bigger is not a delay the screen should show. */
export const MAX_SERVER_SECONDS = 86_400;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const isConsentVersion = (value: unknown): value is string => typeof value === 'string' && CONSENT_VERSION.test(value);
export const isDeviceId = (value: unknown): value is string => typeof value === 'string' && DEVICE_ID.test(value);

// ---- identity and session -----------------------------------------------------------------------------------------

export type ShopOnboarding = 'NOT_STARTED' | 'INCOMPLETE' | 'COMPLETED';
export type DriverOnboarding = 'NOT_STARTED' | 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING' | 'CLOSED';
const SHOP_STATES: readonly string[] = ['NOT_STARTED', 'INCOMPLETE', 'COMPLETED'];
const DRIVER_STATES: readonly string[] = ['NOT_STARTED', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'];

/** What the server says about the signed-in person. Routing hints and capabilities only guide the screen: the server rechecks every action. */
export interface AuthIdentity {
  readonly userId: string;
  readonly phoneNormalized: string;
  /** Selectable contexts in the fixed order CUSTOMER, SHOP_OWNER, DRIVER. */
  readonly availableRoles: readonly PublicContext[];
  readonly activeRole: PublicContext | null;
  readonly profile: { readonly fullName: string | null; readonly version: number | null };
  readonly capabilities: { readonly customerAccess: boolean; readonly shopProfileRead: boolean; readonly shopManage: boolean; readonly driverProfileRead: boolean };
  readonly onboarding: { readonly shop: ShopOnboarding; readonly driver: DriverOnboarding };
  readonly onboardingRequired: boolean;
  readonly roleSelectionRequired: boolean;
}

export interface AuthSessionInfo {
  /** Epoch ms of the absolute expiry the server reported. */
  readonly expiresAtMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const isContext = (value: unknown): value is PublicContext => typeof value === 'string' && (PUBLIC_CONTEXTS as readonly string[]).includes(value);

function parseRoles(value: unknown): readonly PublicContext[] | undefined {
  if (!Array.isArray(value) || value.length > PUBLIC_CONTEXTS.length || !value.every(isContext)) {
    return undefined;
  }
  // Fixed order and no repeat: the contract sorts them, so anything else is not this contract.
  const indexes = value.map((role) => PUBLIC_CONTEXTS.indexOf(role));
  return indexes.every((index, position) => position === 0 || index > (indexes[position - 1] as number)) ? value : undefined;
}

const IDENTITY_KEYS = ['user_id', 'phone_normalized', 'available_roles', 'active_role', 'profile', 'capabilities', 'onboarding', 'onboarding_required', 'role_selection_required'] as const;
const CAPABILITY_KEYS = ['customer_access', 'shop_profile_read', 'shop_manage', 'driver_profile_read'] as const;

function parseIdentityFields(data: Record<string, unknown>): AuthIdentity | undefined {
  const roles = parseRoles(data.available_roles);
  const { profile, capabilities, onboarding } = data;
  if (
    !isUuid(data.user_id) ||
    typeof data.phone_normalized !== 'string' ||
    !/^\+84[0-9]{9}$/.test(data.phone_normalized) ||
    roles === undefined ||
    !(data.active_role === null || isContext(data.active_role)) ||
    (data.active_role !== null && !roles.includes(data.active_role as PublicContext)) ||
    typeof data.onboarding_required !== 'boolean' ||
    typeof data.role_selection_required !== 'boolean' ||
    !isRecord(profile) ||
    !hasExactKeys(profile, ['full_name', 'version']) ||
    !(profile.full_name === null || (typeof profile.full_name === 'string' && profile.full_name.length <= 480)) ||
    !(profile.version === null || (typeof profile.version === 'number' && Number.isSafeInteger(profile.version) && profile.version >= 1)) ||
    !isRecord(capabilities) ||
    !hasExactKeys(capabilities, CAPABILITY_KEYS) ||
    !CAPABILITY_KEYS.every((key) => typeof capabilities[key] === 'boolean') ||
    !isRecord(onboarding) ||
    !hasExactKeys(onboarding, ['shop', 'driver']) ||
    typeof onboarding.shop !== 'string' ||
    !SHOP_STATES.includes(onboarding.shop) ||
    typeof onboarding.driver !== 'string' ||
    !DRIVER_STATES.includes(onboarding.driver)
  ) {
    return undefined;
  }
  return {
    userId: data.user_id,
    phoneNormalized: data.phone_normalized,
    availableRoles: roles,
    activeRole: data.active_role as PublicContext | null,
    profile: { fullName: profile.full_name as string | null, version: profile.version as number | null },
    capabilities: {
      customerAccess: capabilities.customer_access as boolean,
      shopProfileRead: capabilities.shop_profile_read as boolean,
      shopManage: capabilities.shop_manage as boolean,
      driverProfileRead: capabilities.driver_profile_read as boolean,
    },
    onboarding: { shop: onboarding.shop as ShopOnboarding, driver: onboarding.driver as DriverOnboarding },
    onboardingRequired: data.onboarding_required,
    roleSelectionRequired: data.role_selection_required,
  };
}

function parseSession(value: unknown): AuthSessionInfo | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['expires_at']) || typeof value.expires_at !== 'string' || value.expires_at.length > 64) {
    return undefined;
  }
  const expiresAtMs = Date.parse(value.expires_at);
  return Number.isFinite(expiresAtMs) ? { expiresAtMs } : undefined;
}

function dataOf(body: unknown): Record<string, unknown> | undefined {
  return isRecord(body) && hasExactKeys(body, ['data']) && isRecord(body.data) ? body.data : undefined;
}

/** register / login: identity + access_token + session. The token leaves this function only to the session store. */
export function parseSignInResponse(body: unknown): { readonly identity: AuthIdentity; readonly accessToken: string; readonly session: AuthSessionInfo } | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, [...IDENTITY_KEYS, 'access_token', 'session'])) {
    return undefined;
  }
  const { access_token: token } = data;
  if (typeof token !== 'string' || token.length < 16 || token.length > MAX_TOKEN_CHARS || !TOKEN_TEXT.test(token)) {
    return undefined;
  }
  const identity = parseIdentityFields(data);
  const session = parseSession(data.session);
  return identity === undefined || session === undefined ? undefined : { identity, accessToken: token, session };
}

/** me / context: identity + session, and NO token (a token here is a wrong answer). */
export function parseIdentityResponse(body: unknown): { readonly identity: AuthIdentity; readonly session: AuthSessionInfo } | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, [...IDENTITY_KEYS, 'session'])) {
    return undefined;
  }
  const identity = parseIdentityFields(data);
  const session = parseSession(data.session);
  return identity === undefined || session === undefined ? undefined : { identity, session };
}

// ---- own customer profile -----------------------------------------------------------------------------------------

/** The server's own customer profile: the name and the version the next update must name (expected_version). */
export interface ProfileWire {
  readonly userId: string;
  readonly fullName: string;
  readonly version: number;
}

/** GET/PUT /v1/customer/me/profile: exactly {data:{user_id, full_name, version}}. `null` = a GET answered {data:null} (no profile row). */
export function parseProfileResponse(body: unknown): ProfileWire | null | undefined {
  if (isRecord(body) && hasExactKeys(body, ['data']) && body.data === null) {
    return null;
  }
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['user_id', 'full_name', 'version'])) {
    return undefined;
  }
  const { user_id: userId, full_name: fullName, version } = data;
  if (!isUuid(userId) || typeof fullName !== 'string' || fullName.length < 1 || fullName.length > 480 || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return undefined;
  }
  return { userId, fullName, version };
}

// ---- shop onboarding (11Food) -------------------------------------------------------------------------------------

export type ShopStatusWire = 'INCOMPLETE' | 'ACTIVE' | 'DISABLED';
const SHOP_STATUS_VALUES: readonly string[] = ['INCOMPLETE', 'ACTIVE', 'DISABLED'];

/** The owned shop as the server holds it. `version` is the expected_version of the next save / of completion. */
export interface ShopProfileWire {
  readonly shopId: string;
  readonly name: string;
  readonly contactPhone: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly addressText: string;
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly serviceAreaId: string | null;
  readonly status: ShopStatusWire;
  readonly acceptingOrders: boolean;
  readonly version: number;
}

const SHOP_KEYS = ['shop_id', 'name', 'contact_phone', 'zalo', 'facebook', 'address_text', 'pickup_lat', 'pickup_lng', 'service_area_id', 'status', 'accepting_orders', 'version'] as const;

const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const nullableText = (value: unknown, max: number): value is string | null => value === null || (typeof value === 'string' && value.length <= max * 2);

/** GET /v1/onboarding/shop/profile: `null` = no shop yet ({data:null}); undefined = not this contract. */
export function parseShopProfileResponse(body: unknown): ShopProfileWire | null | undefined {
  if (isRecord(body) && hasExactKeys(body, ['data']) && body.data === null) {
    return null;
  }
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, SHOP_KEYS)) {
    return undefined;
  }
  const { shop_id: shopId, name, contact_phone: phone, zalo, facebook, address_text: address, pickup_lat: lat, pickup_lng: lng, service_area_id: areaId, status, accepting_orders: accepting, version } = data;
  const pointOk = (lat === null && lng === null) || (typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng) <= 180);
  if (
    !isUuid(shopId) ||
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 240 ||
    typeof phone !== 'string' ||
    !/^\+84[0-9]{9}$/.test(phone) ||
    !nullableText(zalo, 160) ||
    !nullableText(facebook, 300) ||
    typeof address !== 'string' ||
    address.length < 1 ||
    address.length > 1000 ||
    !pointOk ||
    !(areaId === null || isUuid(areaId)) ||
    typeof status !== 'string' ||
    !SHOP_STATUS_VALUES.includes(status) ||
    typeof accepting !== 'boolean' ||
    !isVersion(version)
  ) {
    return undefined;
  }
  return {
    shopId,
    name,
    contactPhone: phone,
    zalo: zalo as string | null,
    facebook: facebook as string | null,
    addressText: address,
    pickupLat: lat as number | null,
    pickupLng: lng as number | null,
    serviceAreaId: areaId as string | null,
    status: status as ShopStatusWire,
    acceptingOrders: accepting,
    version,
  };
}

export interface ShopSavedWire {
  readonly shopId: string;
  readonly version: number;
}

/** PUT /v1/onboarding/shop/profile: exactly {data:{shop_id, status:"INCOMPLETE", version, role_granted:false}}. */
export function parseShopSaveResponse(body: unknown): ShopSavedWire | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['shop_id', 'status', 'version', 'role_granted'])) {
    return undefined;
  }
  return isUuid(data.shop_id) && data.status === 'INCOMPLETE' && isVersion(data.version) && data.role_granted === false ? { shopId: data.shop_id, version: data.version } : undefined;
}

export interface ShopCompletedWire {
  readonly shopId: string;
  readonly version: number;
}

/** POST /v1/onboarding/shop/complete: exactly {data:{shop_id, status:"ACTIVE", accepting_orders:false, role_granted:true, version}}. */
export function parseShopCompleteResponse(body: unknown): ShopCompletedWire | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['shop_id', 'status', 'accepting_orders', 'role_granted', 'version'])) {
    return undefined;
  }
  return isUuid(data.shop_id) && data.status === 'ACTIVE' && data.accepting_orders === false && data.role_granted === true && isVersion(data.version) ? { shopId: data.shop_id, version: data.version } : undefined;
}

export interface ServiceAreaWire {
  readonly serviceAreaId: string;
  readonly name: string;
}

const MAX_SERVICE_AREAS = 500;

/** GET /v1/onboarding/shop/service-areas: exactly {data:[{service_area_id, name}]}; each id once. */
export function parseServiceAreasResponse(body: unknown): readonly ServiceAreaWire[] | undefined {
  if (!isRecord(body) || !hasExactKeys(body, ['data']) || !Array.isArray(body.data) || body.data.length > MAX_SERVICE_AREAS) {
    return undefined;
  }
  const seen = new Set<string>();
  const rows: ServiceAreaWire[] = [];
  for (const row of body.data as unknown[]) {
    if (!isRecord(row) || !hasExactKeys(row, ['service_area_id', 'name']) || !isUuid(row.service_area_id) || typeof row.name !== 'string' || row.name.length < 1 || row.name.length > 400 || seen.has(row.service_area_id)) {
      return undefined;
    }
    seen.add(row.service_area_id);
    rows.push({ serviceAreaId: row.service_area_id, name: row.name });
  }
  return rows;
}

// ---- registration config ------------------------------------------------------------------------------------------

/** What the server says about the phone verification of a registration. The client never guesses it. */
export type RegistrationVerificationMode = 'REQUIRED' | 'DISABLED_TEST';

/** GET /v1/client-auth/config: exactly {data:{registration_verification}} with one of the two known values, else no usable answer. */
export function parseRegistrationConfig(body: unknown): RegistrationVerificationMode | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['registration_verification'])) {
    return undefined;
  }
  const mode = data.registration_verification;
  return mode === 'REQUIRED' || mode === 'DISABLED_TEST' ? mode : undefined;
}

// ---- account recovery (no-OTP test build) -------------------------------------------------------------------------

/** What the server says about the password reset. The client never guesses it. */
export type RecoveryMode = 'DISABLED_TEST' | 'UNAVAILABLE';

/** GET /v1/account-recovery/config: exactly {data:{mode}} with one of the two known values, else no usable answer. */
export function parseRecoveryConfig(body: unknown): RecoveryMode | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['mode'])) {
    return undefined;
  }
  return data.mode === 'DISABLED_TEST' || data.mode === 'UNAVAILABLE' ? data.mode : undefined;
}

/** POST /v1/account-recovery/reset-test: exactly {data:{next:"LOGIN"}}. It says nothing about which account was touched. */
export function parseRecoveryAck(body: unknown): 'LOGIN' | undefined {
  const data = dataOf(body);
  return data !== undefined && hasExactKeys(data, ['next']) && data.next === 'LOGIN' ? 'LOGIN' : undefined;
}

// ---- REGISTER OTP -------------------------------------------------------------------------------------------------

export interface OtpIssuedWire {
  readonly verificationId: string;
  readonly expiresInSeconds: number;
  readonly resendAfterSeconds: number;
}

const isServerSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_SERVER_SECONDS;

export function parseOtpIssued(body: unknown): OtpIssuedWire | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['verification_id', 'expires_in_seconds', 'resend_after_seconds'])) {
    return undefined;
  }
  const { verification_id: id, expires_in_seconds: expires, resend_after_seconds: resend } = data;
  return isUuid(id) && isServerSeconds(expires) && isServerSeconds(resend) ? { verificationId: id, expiresInSeconds: expires, resendAfterSeconds: resend } : undefined;
}

export interface OtpVerifiedWire {
  /** The one-use phone proof. It is sent in the register body and nowhere else: never in a URL, never stored. */
  readonly verificationToken: string;
  readonly expiresInSeconds: number;
}

export function parseOtpVerified(body: unknown): OtpVerifiedWire | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['verification_token', 'purpose', 'expires_in_seconds'])) {
    return undefined;
  }
  const { verification_token: token, purpose, expires_in_seconds: expires } = data;
  if (typeof token !== 'string' || token.length < 1 || token.length > 256 || purpose !== REGISTER_PURPOSE || !isServerSeconds(expires)) {
    return undefined;
  }
  return { verificationToken: token, expiresInSeconds: expires };
}

// ---- errors -------------------------------------------------------------------------------------------------------

const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** The `code` of an error envelope, or undefined when the body is not one. Nothing else of the body is read. */
// ---- driver profile (11Ship) --------------------------------------------------------------------------------------

export type DriverStatusWire = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSING' | 'CLOSED';
export type DriverTypeWire = 'EXTERNAL' | 'PLATFORM';
const DRIVER_STATUS_VALUES: readonly string[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSING', 'CLOSED'];
const DRIVER_TYPE_VALUES: readonly string[] = ['EXTERNAL', 'PLATFORM'];

/** The caller's own driver profile as the server holds it. Stored values only: nothing is derived or made up. */
export interface DriverProfileWire {
  readonly driverId: string;
  readonly userId: string;
  readonly fullName: string;
  readonly plateNumber: string | null;
  readonly driverType: DriverTypeWire;
  readonly status: DriverStatusWire;
  readonly acceptingDeliveries: boolean;
  readonly version: number;
}

const DRIVER_KEYS = ['driver_id', 'user_id', 'full_name', 'plate_number', 'driver_type', 'status', 'accepting_deliveries', 'version'] as const;

/** GET /v1/driver/me: `null` = no driver profile ({data:null}); undefined = not this contract. */
export function parseDriverProfileResponse(body: unknown): DriverProfileWire | null | undefined {
  if (isRecord(body) && hasExactKeys(body, ['data']) && body.data === null) {
    return null;
  }
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, DRIVER_KEYS)) {
    return undefined;
  }
  const { driver_id: driverId, user_id: userId, full_name: fullName, plate_number: plate, driver_type: type, status, accepting_deliveries: accepting, version } = data;
  if (
    !isUuid(driverId) ||
    !isUuid(userId) ||
    typeof fullName !== 'string' ||
    fullName.length < 1 ||
    fullName.length > 480 ||
    !nullableText(plate, 32) ||
    typeof type !== 'string' ||
    !DRIVER_TYPE_VALUES.includes(type) ||
    typeof status !== 'string' ||
    !DRIVER_STATUS_VALUES.includes(status) ||
    typeof accepting !== 'boolean' ||
    !isVersion(version)
  ) {
    return undefined;
  }
  return { driverId, userId, fullName, plateNumber: plate as string | null, driverType: type as DriverTypeWire, status: status as DriverStatusWire, acceptingDeliveries: accepting, version };
}

export interface DriverSubmittedWire {
  readonly driverId: string;
}

/** POST /v1/onboarding/driver: exactly {data:{driver_id, driver_type:"EXTERNAL", status:"PENDING", accepting_deliveries:false, role_granted:true, version:1}}. */
export function parseDriverSubmitResponse(body: unknown): DriverSubmittedWire | undefined {
  const data = dataOf(body);
  if (data === undefined || !hasExactKeys(data, ['driver_id', 'driver_type', 'status', 'accepting_deliveries', 'role_granted', 'version'])) {
    return undefined;
  }
  return isUuid(data.driver_id) && data.driver_type === 'EXTERNAL' && data.status === 'PENDING' && data.accepting_deliveries === false && data.role_granted === true && data.version === 1 ? { driverId: data.driver_id } : undefined;
}

export function errorCodeOf(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) {
    return undefined;
  }
  const { code } = body.error;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : undefined;
}

export type AuthOperation = 'config' | 'recoveryConfig' | 'recoveryReset' | 'otpRequest' | 'otpVerify' | 'register' | 'login' | 'me' | 'context' | 'logout' | 'profileRead' | 'profileSave' | 'shopRead' | 'shopSave' | 'shopComplete' | 'shopAreas' | 'driverRead' | 'driverSubmit';

export interface MappedFailure {
  readonly code: FailureCode;
  /**
   * True when the server may or may not have done the work (5xx, busy, unknown outcome): a keyed operation then keeps its
   * Idempotency-Key and body, so the person's next try replays the SAME request.
   */
  readonly unresolved: boolean;
  /** True only for a known "this session is not valid" answer to an authenticated call. */
  readonly sessionInvalid: boolean;
}

type Row = readonly [FailureCode, boolean?];

const SESSION_CODES: Readonly<Record<string, FailureCode>> = { SESSION_INVALID: 'SESSION_EXPIRED', SESSION_REVOKED: 'SESSION_EXPIRED', SESSION_EXPIRED: 'SESSION_EXPIRED' };

// What a keyed mutation (register, login, context) may answer besides its own codes: the idempotency family and the infrastructure envelope.
const KEYED: Readonly<Record<string, Row>> = {
  BAD_REQUEST: ['BAD_REQUEST'],
  IDEMPOTENCY_KEY_REQUIRED: ['UNKNOWN'],
  INVALID_IDEMPOTENCY_KEY: ['UNKNOWN'],
  IDEMPOTENCY_KEY_REUSED: ['UNKNOWN'],
  IDEMPOTENCY_BUSY: ['OUTCOME_UNKNOWN', true],
  IDEMPOTENCY_REPLAY_EXPIRED: ['RESULT_NOT_REPLAYABLE'],
  IDEMPOTENCY_KEY_UNAVAILABLE: ['SERVICE_UNAVAILABLE', true],
  TRANSACTION_OUTCOME_UNKNOWN: ['OUTCOME_UNKNOWN', true],
  SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE', true],
  INTERNAL_ERROR: ['UNKNOWN', true],
};

const TABLES: Readonly<Record<AuthOperation, Readonly<Record<string, Row>>>> = {
  config: { SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  recoveryConfig: { SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  recoveryReset: { ...KEYED, INVALID_PHONE: ['INVALID_PHONE'] },
  otpRequest: {
    BAD_REQUEST: ['BAD_REQUEST'],
    INVALID_PHONE: ['INVALID_PHONE'],
    PHONE_ALREADY_REGISTERED: ['PHONE_ALREADY_REGISTERED'],
    OTP_RATE_LIMITED: ['RATE_LIMITED'],
    AUTH_REGISTRATION_UNAVAILABLE: ['REGISTRATION_UNAVAILABLE'],
    SERVICE_UNAVAILABLE: ['PROVIDER_UNAVAILABLE'],
    INTERNAL_ERROR: ['UNKNOWN'],
  },
  otpVerify: {
    BAD_REQUEST: ['BAD_REQUEST'],
    OTP_INVALID: ['OTP_INVALID'],
    OTP_EXPIRED: ['OTP_EXPIRED'],
    OTP_ALREADY_USED: ['OTP_ALREADY_USED'],
    OTP_RATE_LIMITED: ['OTP_LOCKED'],
    AUTH_REGISTRATION_UNAVAILABLE: ['REGISTRATION_UNAVAILABLE'],
    SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'],
    INTERNAL_ERROR: ['UNKNOWN'],
  },
  register: {
    ...KEYED,
    INVALID_PHONE: ['INVALID_PHONE'],
    VERIFICATION_PROOF_INVALID: ['PROOF_INVALID'],
    VERIFICATION_PROOF_USED: ['PROOF_USED'],
    VERIFICATION_PURPOSE_MISMATCH: ['PROOF_INVALID'],
    PHONE_ALREADY_REGISTERED: ['PHONE_ALREADY_REGISTERED'],
    CONSENT_VERSION_UNSUPPORTED: ['CONSENT_UNSUPPORTED'],
    DEVICE_PROOF_REQUIRED: ['DEVICE_PROOF_REQUIRED'],
    AUTH_REGISTRATION_UNAVAILABLE: ['REGISTRATION_UNAVAILABLE'],
    AUTH_RESULT_NOT_REPLAYABLE: ['RESULT_NOT_REPLAYABLE'],
  },
  login: {
    ...KEYED,
    INVALID_PHONE: ['INVALID_PHONE'],
    INVALID_CREDENTIALS: ['INVALID_CREDENTIALS'],
    ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'],
    DEVICE_PROOF_REQUIRED: ['DEVICE_PROOF_REQUIRED'],
    AUTH_RESULT_NOT_REPLAYABLE: ['RESULT_NOT_REPLAYABLE'],
  },
  me: { ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'], SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  context: { ...KEYED, ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'], ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'] },
  logout: { BAD_REQUEST: ['BAD_REQUEST'], SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  profileRead: { ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'], ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'], SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  profileSave: { ...KEYED, VERSION_CONFLICT: ['VERSION_CONFLICT'], ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'], ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'] },
  shopRead: { ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'], ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'], SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  shopSave: {
    ...KEYED,
    INVALID_PHONE: ['INVALID_PHONE'],
    VERSION_CONFLICT: ['VERSION_CONFLICT'],
    SHOP_ONBOARDING_EXISTS: ['SHOP_EXISTS'],
    INVALID_SERVICE_AREA: ['AREA_INVALID'],
    ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'],
    ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'],
  },
  shopComplete: {
    ...KEYED,
    VERSION_CONFLICT: ['VERSION_CONFLICT'],
    SHOP_ONBOARDING_EXISTS: ['SHOP_EXISTS'],
    SHOP_PROFILE_INCOMPLETE: ['SHOP_INCOMPLETE'],
    INVALID_SERVICE_AREA: ['AREA_INVALID'],
    ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'],
    ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'],
  },
  driverRead: { ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'], SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
  driverSubmit: { ...KEYED, DRIVER_PROFILE_EXISTS: ['DRIVER_EXISTS'], ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'] },
  shopAreas: { ACCOUNT_DISABLED: ['ACCOUNT_DISABLED'], ROLE_NOT_AVAILABLE: ['ROLE_NOT_AVAILABLE'], SERVICE_UNAVAILABLE: ['SERVICE_UNAVAILABLE'], INTERNAL_ERROR: ['UNKNOWN'] },
};

const KEYED_OPERATIONS: readonly AuthOperation[] = ['recoveryReset', 'register', 'login', 'context', 'profileSave', 'shopSave', 'shopComplete', 'driverSubmit'];
const AUTHENTICATED_OPERATIONS: readonly AuthOperation[] = ['me', 'context', 'logout', 'profileRead', 'profileSave', 'shopRead', 'shopSave', 'shopComplete', 'shopAreas', 'driverRead', 'driverSubmit'];

/**
 * Server answer -> one typed failure. A code that this operation does not list is NOT trusted: INVALID_CREDENTIALS from a login
 * is a wrong password and never "session expired"; a session code from a login, a register or an OTP call is unexpected and
 * ends as UNKNOWN. Only an authenticated call may report a session as invalid, and only through the three session codes.
 */
export function mapHttpFailure(operation: AuthOperation, status: number, serverCode: string | undefined): MappedFailure {
  const keyed = KEYED_OPERATIONS.includes(operation);
  if (serverCode !== undefined && AUTHENTICATED_OPERATIONS.includes(operation) && (status === 401 || status === 403) && Object.hasOwn(SESSION_CODES, serverCode)) {
    return { code: 'SESSION_EXPIRED', unresolved: false, sessionInvalid: true };
  }
  const row = serverCode === undefined ? undefined : Object.hasOwn(TABLES[operation], serverCode) ? TABLES[operation][serverCode] : undefined;
  if (row !== undefined) {
    return { code: row[0], unresolved: keyed && row[1] === true, sessionInvalid: false };
  }
  if (status === 429) {
    return { code: 'RATE_LIMITED', unresolved: false, sessionInvalid: false };
  }
  if (status === 503) {
    return { code: 'SERVICE_UNAVAILABLE', unresolved: keyed, sessionInvalid: false };
  }
  return { code: 'UNKNOWN', unresolved: keyed && status >= 500, sessionInvalid: false };
}

/** Retry-After as the server sends it: whole seconds, or an HTTP date. Anything else (missing, zero, negative, huge) is "not given". */
export function parseRetryAfter(header: string | null | undefined, nowMs: number): number | undefined {
  if (header === null || header === undefined) {
    return undefined;
  }
  const text = header.trim();
  let seconds: number;
  if (/^[0-9]{1,6}$/.test(text)) {
    seconds = Number(text);
  } else {
    const date = Date.parse(text);
    if (text.length > 64 || !Number.isFinite(date)) {
      return undefined;
    }
    seconds = Math.ceil((date - nowMs) / 1000);
  }
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_SERVER_SECONDS ? seconds : undefined;
}

/** The instant a server-given delay ends. `fromMs` is when the request STARTED, so the screen never shows more time than the server gave. */
export function deadlineAfter(fromMs: number, seconds: number): number {
  return fromMs + Math.max(0, Math.floor(seconds)) * 1000;
}
