import { FailureCode } from './states.js';

// The seam between the screens (display) and the backend (calls). A screen asks a PORT for a result and shows it; it
// never builds a URL or reads a cookie. When a backend piece becomes available, only the port implementation and the flag
// in features.ts change, the screens stay.
//
// The request/response shapes below are the OLD PROPOSALS written from the design set before the backend existed. They are NOT
// the wire format and they are too small for it: no verification_id, no phone proof, no consent versions, no device, no
// identity/session. The real, tested adapter of the backend that is on main now is apps/client-shared/src/auth (createAuthClient);
// its types are the reference. The screens keep using these ports (all NOT_WIRED) until the packages that connect them (M01.07-.10)
// map the screen inputs onto the adapter, so nothing here changes in this package.

export type Outcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'failure'; readonly code: FailureCode; readonly retryAfterSeconds?: number };

export const ok = <T>(value: T): Outcome<T> => ({ kind: 'ok', value });
export const failure = (code: FailureCode, retryAfterSeconds?: number): Outcome<never> =>
  retryAfterSeconds === undefined ? { kind: 'failure', code } : { kind: 'failure', code, retryAfterSeconds };

export interface OtpIssued {
  /** Seconds until the code expires (server value). */
  readonly expiresInSeconds: number;
  /** Seconds until a new code may be requested (server value; the UI never shortens it). */
  readonly resendInSeconds: number;
}

export interface SignedInAccount {
  readonly phoneMasked: string;
  readonly fullName: string | null;
  /** Roles as the server reports them (CUSTOMER, SHOP_OWNER, DRIVER). The client never grants or changes one. */
  readonly roles: readonly string[];
}

export interface ClientAuthPort {
  requestRegisterOtp(input: { readonly phone: string }): Promise<Outcome<OtpIssued>>;
  verifyRegisterOtp(input: { readonly phone: string; readonly code: string }): Promise<Outcome<void>>;
  register(input: { readonly phone: string; readonly password: string; readonly fullName: string; readonly acceptedTerms: true }): Promise<Outcome<SignedInAccount>>;
  login(input: { readonly phone: string; readonly password: string }): Promise<Outcome<SignedInAccount>>;
  logout(): Promise<Outcome<void>>;
  requestResetOtp(input: { readonly phone: string }): Promise<Outcome<OtpIssued>>;
  verifyResetOtp(input: { readonly phone: string; readonly code: string }): Promise<Outcome<void>>;
  completeReset(input: { readonly newPassword: string }): Promise<Outcome<void>>;
}

export interface ShopDraft {
  readonly name: string;
  readonly contactPhone: string;
  readonly addressText: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly version: number;
}

export interface ShopPort {
  read(): Promise<Outcome<ShopDraft | null>>;
  saveDraft(input: Omit<ShopDraft, 'version'> & { readonly expectedVersion: number | null }): Promise<Outcome<ShopDraft>>;
  complete(input: { readonly expectedVersion: number }): Promise<Outcome<void>>;
}

export interface DriverProfile {
  readonly legalName: string;
  readonly plate: string | null;
  readonly status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  readonly type: 'EXTERNAL' | 'PLATFORM';
}

export interface DriverPort {
  submit(input: { readonly legalName: string; readonly plate: string | null }): Promise<Outcome<DriverProfile>>;
  read(): Promise<Outcome<DriverProfile | null>>;
}

export interface ClientPorts {
  readonly auth: ClientAuthPort;
  readonly shop: ShopPort;
  readonly driver: DriverPort;
}

const notWired = (): Promise<Outcome<never>> => Promise.resolve(failure('NOT_WIRED'));

/**
 * The ports of this release: every call answers NOT_WIRED and never "ok". Used so the screens exist and can be exercised
 * without pretending a backend answered. A test asserts none of these can ever return `ok`.
 */
export const NOT_WIRED_PORTS: ClientPorts = {
  auth: {
    requestRegisterOtp: notWired,
    verifyRegisterOtp: notWired,
    register: notWired,
    login: notWired,
    logout: notWired,
    requestResetOtp: notWired,
    verifyResetOtp: notWired,
    completeReset: notWired,
  },
  shop: { read: notWired, saveDraft: notWired, complete: notWired },
  driver: { submit: notWired, read: notWired },
};
