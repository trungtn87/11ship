import { REAL_TIMERS, Timers } from '../health.js';
import { FailureCode } from '../states.js';
import { ADDRESS_MAX, FACEBOOK_MAX, isCompleteOtp, isValidCoordinatePair, isValidPassword, isValidPhone, isWellFormed, normalizeOptionalLink, normalizePersonName, normalizeRequiredText, SHOP_NAME_MAX, ZALO_MAX } from '../validation.js';
import {
  AUTH_PATHS,
  AuthIdentity,
  AuthOperation,
  ClientApp,
  deadlineAfter,
  errorCodeOf,
  isConsentVersion,
  isDeviceId,
  isUuid,
  mapHttpFailure,
  MappedFailure,
  parseIdentityResponse,
  parseProfileResponse,
  parseServiceAreasResponse,
  parseShopCompleteResponse,
  parseShopProfileResponse,
  parseShopSaveResponse,
  parseOtpIssued,
  parseOtpVerified,
  parseSignInResponse,
  parseRegistrationConfig,
  PUBLIC_CONTEXTS,
  PublicContext,
  REGISTER_PURPOSE,
  ProfileWire,
  RegistrationVerificationMode,
  ServiceAreaWire,
  ShopProfileWire,
} from './contract.js';
import { FlowGeneration, SessionListener, SessionState, SessionStore, SessionTicket } from './session.js';
import { AUTH_TIMEOUT_MS, createTransport, TransportRequest, TransportResult } from './transport.js';

// The client authentication of the phone apps, as one object: REGISTER OTP, register, login, me, context, logout.
//
// What the screens get: typed results (never a raw server message), the identity (never the bearer token), and the three
// guarantees below. What this file does NOT do: route, render, choose a feature flag, store anything outside memory, retry a
// POST by itself, or invent a cooldown. Wiring a screen to it is a later package.
//
// 1. STALE RESPONSES. Every call notes the session generation (or, for the OTP steps, the flow generation) when it starts. A
//    response that arrives after a sign-out, after another sign-in, or after the flow was reset answers `{kind:'stale'}`:
//    nothing was applied and the screen must show nothing.
// 2. ONE INTENT, ONE KEY. register, login and context carry an Idempotency-Key. The key and the exact body of an attempt whose
//    outcome is unknown (timeout, dropped connection, 5xx, busy) are kept; the NEXT call with the SAME input re-sends that key
//    and those bytes. A different input, or a definite answer, starts a new intent with a new key. Nothing is re-sent
//    automatically: the person decides.
// 3. NO DOUBLE SUBMIT. While a call of one kind runs, the same call returns the same promise (no second request) and a
//    different input answers IN_PROGRESS.

export type AuthResult<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | {
      readonly kind: 'failure';
      readonly code: FailureCode;
      /** Seconds from the server's Retry-After, only when the server gave one. The client never invents a cooldown. */
      readonly retryAfterSeconds?: number;
      /** The server may or may not have done the work: calling again with the same input re-sends the SAME request. */
      readonly unresolved: boolean;
    }
  | { readonly kind: 'stale' };

export interface OtpIssued {
  readonly verificationId: string;
  /** Epoch ms when the code stops being valid, from the server's value counted from the moment the request started. */
  readonly expiresAtMs: number;
  /** Epoch ms from which a new code may be asked. The screen enables "send again" at this instant and not before. */
  readonly resendAtMs: number;
}

export interface OtpVerified {
  /** The one-use phone proof for register. Keep it in memory only and hand it to `register` once. */
  readonly verificationToken: string;
  readonly expiresAtMs: number;
}

export interface SignedIn {
  readonly identity: AuthIdentity;
  readonly expiresAtMs: number;
}

export interface LogoutResult {
  /** False when nobody was signed in. */
  readonly hadSession: boolean;
  /** True ONLY when the server answered 204. Offline, timeout and every error leave it false: the local session is gone, the server's is not proven revoked. */
  readonly serverRevoked: boolean;
  /** Why the server did not confirm, when it did not. */
  readonly unconfirmedReason?: FailureCode;
}

/** The person's own profile as the server holds it. `version` is what the next save must name as expected_version. */
export interface ProfileView {
  readonly fullName: string;
  readonly version: number;
}

/** The owned shop as the server holds it (GET /v1/onboarding/shop/profile). */
export type ShopView = ShopProfileWire;
export type ServiceAreaChoice = ServiceAreaWire;

export interface ShopSaveInput {
  readonly name: string;
  readonly contactPhone: string;
  readonly addressText: string;
  readonly zalo: string | null;
  readonly facebook: string | null;
  /** Both or neither. Only a position the person took and confirmed. */
  readonly pickup: { readonly lat: number; readonly lng: number } | null;
  readonly serviceAreaId: string | null;
  /** null = create the draft; the exact current version = update it. */
  readonly expectedVersion: number | null;
}

export interface ShopSaved {
  readonly shopId: string;
  readonly version: number;
}

export interface ShopCompleted {
  readonly shopId: string;
  readonly version: number;
}

export interface RegisterInput {
  readonly phone: string;
  /** Sent exactly as typed: not trimmed, not normalized. */
  readonly password: string;
  readonly verificationToken: string;
  readonly fullName: string;
  /** The pair the server publishes (the register screen shows it). The client never invents or fixes it. */
  readonly consent: { readonly termsVersion: string; readonly privacyVersion: string };
}

/** The registration of the no-proof test mode: the same fields without the phone proof. */
export type RegisterWithoutProofInput = Omit<RegisterInput, 'verificationToken'>;

export interface LoginInput {
  readonly phone: string;
  /** Sent exactly as typed: not trimmed, not normalized. */
  readonly password: string;
}

/** What the screens may read of the session. No token, no way to establish one. */
export interface AuthSessionView {
  state(): SessionState;
  identity(): AuthIdentity | undefined;
  subscribe(listener: SessionListener): () => void;
}

export interface AuthClient {
  readonly session: AuthSessionView;
  /**
   * GET /v1/client-auth/config: what the server says about the phone verification of a registration. Only the two known values
   * are accepted; anything else is a failure and the register screen stays locked (nothing is guessed or defaulted).
   */
  registrationConfig(): Promise<AuthResult<RegistrationVerificationMode>>;
  requestRegisterOtp(input: { readonly phone: string }): Promise<AuthResult<OtpIssued>>;
  verifyRegisterOtp(input: { readonly verificationId: string; readonly code: string }): Promise<AuthResult<OtpVerified>>;
  /**
   * Restarting or leaving the register flow: every OTP answer AND a register answer still on its way becomes stale (no session is
   * established from it), and the kept key + body of an unresolved register (it holds the password and the phone proof) are dropped.
   */
  resetRegisterFlow(): void;
  register(input: RegisterInput): Promise<AuthResult<SignedIn>>;
  /**
   * Registration WITHOUT a phone proof, valid only when the server reported DISABLED_TEST. Same one-intent/one-key rules as
   * `register`: an unknown outcome keeps the key and the exact body, and the next call with the same input re-sends them.
   */
  registerWithoutProof(input: RegisterWithoutProofInput): Promise<AuthResult<SignedIn>>;
  login(input: LoginInput): Promise<AuthResult<SignedIn>>;
  me(): Promise<AuthResult<SignedIn>>;
  selectContext(context: PublicContext): Promise<AuthResult<SignedIn>>;
  logout(): Promise<AuthResult<LogoutResult>>;
  /** GET /v1/customer/me/profile. `null` = the server has no profile row for this person. Updates the name the session shows. */
  readProfile(): Promise<AuthResult<ProfileView | null>>;
  /**
   * PUT /v1/customer/me/profile {full_name, expected_version}. One intent = one Idempotency-Key + body: an unknown outcome keeps both
   * and the next call with the SAME input re-sends them (never automatically). VERSION_CONFLICT is a definite answer: nothing is
   * overwritten, the screen reads the current profile and lets the person decide. A saved name is taken from the server's answer.
   */
  saveProfile(input: { readonly fullName: string; readonly expectedVersion: number }): Promise<AuthResult<ProfileView>>;
  /** GET /v1/onboarding/shop/profile. `null` = this person has no shop yet. */
  readShop(): Promise<AuthResult<ShopView | null>>;
  /** GET /v1/onboarding/shop/service-areas: the ACTIVE areas, in the server's order. An empty list is a valid answer. */
  readServiceAreas(): Promise<AuthResult<readonly ServiceAreaChoice[]>>;
  /**
   * PUT /v1/onboarding/shop/profile. One intent = one Idempotency-Key + body: an unknown outcome keeps both and the next call with
   * the SAME input re-sends them (never automatically). VERSION_CONFLICT overwrites nothing.
   */
  saveShop(input: ShopSaveInput): Promise<AuthResult<ShopSaved>>;
  /** POST /v1/onboarding/shop/complete {expected_version}. Same one-intent rule. It mints no token and selects no context. */
  completeShop(input: { readonly expectedVersion: number }): Promise<AuthResult<ShopCompleted>>;
  /** Drops the session, the pending intents and every in-flight answer (the app closing a screen tree). */
  dispose(): void;
}

export interface AuthClientOptions {
  readonly fetch: typeof fetch;
  readonly app: ClientApp;
  /** '' = same origin. No trailing slash. */
  readonly baseUrl?: string;
  readonly timers?: Timers;
  readonly timeoutMs?: number;
  /** A fresh canonical UUID. Default: crypto.randomUUID(). Tests inject a counter. */
  readonly newKey?: () => string;
  /** The WEB device id of this page load. Default: `web-` + a random UUID. Never stored. */
  readonly deviceId?: string;
}

type Intent = 'register' | 'login' | 'context' | 'profile' | 'shopSave' | 'shopComplete';
const NO_RETRY: undefined = undefined;

const fail = (code: FailureCode, unresolved = false, retryAfterSeconds?: number): AuthResult<never> =>
  retryAfterSeconds === undefined ? { kind: 'failure', code, unresolved } : { kind: 'failure', code, unresolved, retryAfterSeconds };

type Classified<B> = { readonly kind: 'ok'; readonly body: B } | { readonly kind: 'failure'; readonly result: AuthResult<never>; readonly mapped: MappedFailure | undefined } | { readonly kind: 'aborted' };

export function createAuthClient(options: AuthClientOptions): AuthClient {
  const timers = options.timers ?? REAL_TIMERS;
  const store = new SessionStore(() => timers.now());
  const registerFlow = new FlowGeneration();
  const transport = createTransport({ fetch: options.fetch, ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }), timers, timeoutMs: options.timeoutMs ?? AUTH_TIMEOUT_MS });
  const newKey = options.newKey ?? ((): string => crypto.randomUUID());
  const deviceId = options.deviceId ?? `web-${crypto.randomUUID()}`;
  if (!isDeviceId(deviceId)) {
    throw new RangeError('deviceId does not match the device id grammar');
  }
  const device = { device_id: deviceId, platform: 'WEB', app: options.app } as const;

  // ---- intents (key + exact body of an unresolved attempt) and in-flight calls --------------------------------------
  interface IntentEntry {
    readonly key: string;
    readonly body: string;
  }
  const intents = new Map<Intent, IntentEntry>();
  const running = new Map<string, { readonly body: string; readonly promise: Promise<AuthResult<unknown>> }>();
  // The logout in progress belongs to the session it signs out (its token). A logout of a LATER session never joins it.
  interface LogoutEntry {
    readonly token: string;
    readonly promise: Promise<AuthResult<LogoutResult>>;
  }
  let logoutRun: LogoutEntry | undefined;

  const keyFor = (intent: Intent, body: string): IntentEntry => {
    const current = intents.get(intent);
    if (current !== undefined && current.body === body) {
      return current;
    }
    const entry: IntentEntry = { key: newKey(), body };
    intents.set(intent, entry);
    return entry;
  };
  /** Removes the intent only if it is still THE entry of the request that asks: an old request never ends a newer one's key. */
  const dropIntent = (intent: Intent, entry: IntentEntry): void => {
    if (intents.get(intent) === entry) {
      intents.delete(intent);
    }
  };
  // A context request belongs to the session it was made in: when WHO is signed in changes, its key and body are dropped.
  let seenGeneration = store.ticket().generation;
  store.subscribe(() => {
    const generation = store.ticket().generation;
    if (generation !== seenGeneration) {
      seenGeneration = generation;
      intents.delete('context');
      intents.delete('profile');
      intents.delete('shopSave');
      intents.delete('shopComplete');
    }
  });

  /** Single flight per call kind: the same input shares the running promise, another input answers IN_PROGRESS. */
  function single<T>(name: string, body: string, start: () => Promise<AuthResult<T>>): Promise<AuthResult<T>> {
    const current = running.get(name);
    if (current !== undefined) {
      return current.body === body ? (current.promise as Promise<AuthResult<T>>) : Promise.resolve(fail('IN_PROGRESS'));
    }
    const promise: Promise<AuthResult<T>> = start().finally(() => {
      // A sign-out empties `running`; an old call finishing late must not remove the entry of a newer one.
      if (running.get(name)?.promise === promise) {
        running.delete(name);
      }
    });
    running.set(name, { body, promise });
    return promise;
  }

  function classify<B>(operation: AuthOperation, result: TransportResult, expectedStatus: number | readonly number[], parse: (body: unknown) => B | undefined): Classified<B> {
    const keyed = operation === 'register' || operation === 'login' || operation === 'context' || operation === 'profileSave' || operation === 'shopSave' || operation === 'shopComplete';
    switch (result.kind) {
      case 'aborted':
        return { kind: 'aborted' };
      case 'timeout':
        return { kind: 'failure', result: fail('TIMEOUT', keyed), mapped: undefined };
      case 'network':
        return { kind: 'failure', result: fail('OFFLINE', keyed), mapped: undefined };
      case 'response': {
        if (typeof expectedStatus === 'number' ? result.status === expectedStatus : expectedStatus.includes(result.status)) {
          const parsed = parse(result.body);
          return parsed === undefined ? { kind: 'failure', result: fail('BAD_RESPONSE', keyed), mapped: undefined } : { kind: 'ok', body: parsed };
        }
        if (result.status >= 200 && result.status < 300) {
          return { kind: 'failure', result: fail('BAD_RESPONSE', keyed), mapped: undefined };
        }
        const mapped = mapHttpFailure(operation, result.status, errorCodeOf(result.body));
        return { kind: 'failure', result: fail(mapped.code, mapped.unresolved, mapped.code === 'RATE_LIMITED' ? result.retryAfterSeconds : undefined), mapped };
      }
    }
  }

  /** Applies the intent bookkeeping after an attempt: a definite answer ends the intent, an unresolved one keeps it. */
  function settle(intent: Intent, entry: IntentEntry, answer: AuthResult<unknown>): void {
    if (answer.kind !== 'failure' || !answer.unresolved) {
      dropIntent(intent, entry);
    }
  }

  // ---- registration config ---------------------------------------------------------------------------------------
  function registrationConfig(): Promise<AuthResult<RegistrationVerificationMode>> {
    return single('config', '', async () => {
      const result = await transport.send({ method: 'GET', path: AUTH_PATHS.config });
      const outcome = classify('config', result, 200, parseRegistrationConfig);
      if (outcome.kind === 'aborted') {
        return { kind: 'stale' };
      }
      return outcome.kind === 'failure' ? (outcome.result as AuthResult<RegistrationVerificationMode>) : { kind: 'ok', value: outcome.body };
    });
  }

  // ---- REGISTER OTP ----------------------------------------------------------------------------------------------
  function requestRegisterOtp(input: { readonly phone: string }): Promise<AuthResult<OtpIssued>> {
    if (typeof input.phone !== 'string' || !isValidPhone(input.phone)) {
      return Promise.resolve(fail('INVALID_PHONE'));
    }
    const phone = input.phone.trim();
    const body = JSON.stringify({ phone, purpose: REGISTER_PURPOSE });
    return single('otpRequest', body, async () => {
      const ticket = registerFlow.ticket();
      const startedAt = timers.now();
      const result = await transport.send({ method: 'POST', path: AUTH_PATHS.requestOtp, body });
      // The server counted its cooldown from when it created the code, somewhere between sending and this answer. Anchoring
      // at the answer can only make "send again" later than the server's rule, never earlier.
      const receivedAt = timers.now();
      if (!registerFlow.isCurrent(ticket)) {
        return { kind: 'stale' };
      }
      const outcome = classify('otpRequest', result, 201, parseOtpIssued);
      if (outcome.kind === 'aborted') {
        return { kind: 'stale' };
      }
      if (outcome.kind === 'failure') {
        return outcome.result as AuthResult<OtpIssued>;
      }
      return {
        kind: 'ok',
        value: { verificationId: outcome.body.verificationId, expiresAtMs: deadlineAfter(startedAt, outcome.body.expiresInSeconds), resendAtMs: deadlineAfter(receivedAt, outcome.body.resendAfterSeconds) },
      };
    });
  }

  function verifyRegisterOtp(input: { readonly verificationId: string; readonly code: string }): Promise<AuthResult<OtpVerified>> {
    // The id goes into the URL path, so it must be a canonical UUID. The code goes only in the body.
    if (!isUuid(input.verificationId)) {
      return Promise.resolve(fail('OTP_INVALID'));
    }
    if (typeof input.code !== 'string' || !isCompleteOtp(input.code)) {
      return Promise.resolve(fail('OTP_INVALID'));
    }
    const body = JSON.stringify({ otp: input.code });
    return single(`otpVerify:${input.verificationId}`, body, async () => {
      const ticket = registerFlow.ticket();
      const startedAt = timers.now();
      const result = await transport.send({ method: 'POST', path: AUTH_PATHS.verifyOtp(input.verificationId), body });
      if (!registerFlow.isCurrent(ticket)) {
        return { kind: 'stale' };
      }
      const outcome = classify('otpVerify', result, 200, parseOtpVerified);
      if (outcome.kind === 'aborted') {
        return { kind: 'stale' };
      }
      if (outcome.kind === 'failure') {
        return outcome.result as AuthResult<OtpVerified>;
      }
      return { kind: 'ok', value: { verificationToken: outcome.body.verificationToken, expiresAtMs: deadlineAfter(startedAt, outcome.body.expiresInSeconds) } };
    });
  }

  // ---- sign-in (register, login) ---------------------------------------------------------------------------------
  function signIn(intent: 'register' | 'login', path: string, body: string): Promise<AuthResult<SignedIn>> {
    return single(intent, body, async () => {
      const ticket = store.ticket();
      // A register belongs to the register flow it started in: leaving or restarting that flow (resetRegisterFlow) makes its answer stale.
      const flowTicket = registerFlow.ticket();
      const entry = keyFor(intent, body);
      const result = await transport.send({ method: 'POST', path, body, idempotencyKey: entry.key });
      if (intent === 'register' && !registerFlow.isCurrent(flowTicket)) {
        dropIntent(intent, entry);
        return { kind: 'stale' };
      }
      const outcome = classify(intent, result, intent === 'register' ? 201 : 200, parseSignInResponse);
      if (outcome.kind === 'aborted') {
        return { kind: 'stale' };
      }
      const answer: AuthResult<SignedIn> =
        outcome.kind === 'failure'
          ? (outcome.result as AuthResult<SignedIn>)
          : (() => {
              // Apply only if the session did not change meanwhile. A sign-in that lost that race is dropped here, token included.
              const applied = store.establish(ticket, outcome.body.accessToken, outcome.body.identity, outcome.body.session.expiresAtMs);
              return applied ? { kind: 'ok', value: { identity: outcome.body.identity, expiresAtMs: outcome.body.session.expiresAtMs } } : { kind: 'stale' };
            })();
      if (answer.kind === 'ok' && intent === 'register') {
        registerFlow.reset();
      }
      if (answer.kind === 'failure' && !store.isCurrent(ticket)) {
        // The session changed while this attempt ran: whatever it answered is not about the current session.
        dropIntent(intent, entry);
        return { kind: 'stale' };
      }
      settle(intent, entry, answer);
      return answer;
    });
  }

  function registerUser(input: RegisterInput): Promise<AuthResult<SignedIn>> {
    const fullName = typeof input.fullName === 'string' ? normalizePersonName(input.fullName) : undefined;
    if (typeof input.phone !== 'string' || !isValidPhone(input.phone)) {
      return Promise.resolve(fail('INVALID_PHONE'));
    }
    if (
      typeof input.password !== 'string' ||
      !isValidPassword(input.password) ||
      fullName === undefined ||
      typeof input.verificationToken !== 'string' ||
      input.verificationToken.length < 1 ||
      input.verificationToken.length > 256 ||
      !isConsentVersion(input.consent?.termsVersion) ||
      !isConsentVersion(input.consent?.privacyVersion)
    ) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    // Key order is fixed, so the same input always serializes to the same bytes.
    const body = JSON.stringify({
      phone: input.phone.trim(),
      password: input.password,
      verification_token: input.verificationToken,
      device,
      full_name: fullName,
      consent: { terms_version: input.consent.termsVersion, privacy_version: input.consent.privacyVersion },
    });
    return signIn('register', AUTH_PATHS.register, body);
  }

  function registerWithoutProof(input: RegisterWithoutProofInput): Promise<AuthResult<SignedIn>> {
    const fullName = typeof input.fullName === 'string' ? normalizePersonName(input.fullName) : undefined;
    if (typeof input.phone !== 'string' || !isValidPhone(input.phone)) {
      return Promise.resolve(fail('INVALID_PHONE'));
    }
    if (
      typeof input.password !== 'string' ||
      !isValidPassword(input.password) ||
      fullName === undefined ||
      !isConsentVersion(input.consent?.termsVersion) ||
      !isConsentVersion(input.consent?.privacyVersion)
    ) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    // Exactly the five fields of the DISABLED_TEST body, in a fixed order: no verification_token, no flag, no role.
    const body = JSON.stringify({
      phone: input.phone.trim(),
      password: input.password,
      device,
      full_name: fullName,
      consent: { terms_version: input.consent.termsVersion, privacy_version: input.consent.privacyVersion },
    });
    return signIn('register', AUTH_PATHS.register, body);
  }

  function login(input: LoginInput): Promise<AuthResult<SignedIn>> {
    if (typeof input.phone !== 'string' || !isValidPhone(input.phone)) {
      return Promise.resolve(fail('INVALID_PHONE'));
    }
    if (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 1024 || !isWellFormed(input.password)) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    return signIn('login', AUTH_PATHS.login, JSON.stringify({ phone: input.phone.trim(), password: input.password, device }));
  }

  // ---- authenticated calls ---------------------------------------------------------------------------------------
  /** One authenticated request whose answer is an identity (me, context). */
  async function identityCall(operation: 'me' | 'context', request: Omit<TransportRequest, 'bearer' | 'signal'>, pending: { readonly intent: Intent; readonly entry: IntentEntry } | undefined): Promise<AuthResult<SignedIn>> {
    const ticket = store.ticket();
    const bearer = store.bearer();
    if (bearer === undefined) {
      return fail('SESSION_EXPIRED');
    }
    const controller = new AbortController();
    const untrack = store.track(controller);
    let result: TransportResult;
    try {
      result = await transport.send({ ...request, bearer, signal: controller.signal });
    } finally {
      untrack();
    }
    const outcome = classify(operation, result, 200, parseIdentityResponse);
    if (outcome.kind === 'aborted' || !store.isCurrent(ticket)) {
      // A sign-out or a newer session happened while this ran: its answer must not touch anything.
      return { kind: 'stale' };
    }
    if (outcome.kind === 'failure') {
      if (outcome.mapped?.sessionInvalid === true) {
        store.invalidate(ticket);
      }
      if (pending !== undefined) {
        settle(pending.intent, pending.entry, outcome.result);
      }
      return outcome.result as AuthResult<SignedIn>;
    }
    const applied = store.refresh(ticket, outcome.body.identity, outcome.body.session.expiresAtMs);
    if (pending !== undefined) {
      dropIntent(pending.intent, pending.entry);
    }
    return applied ? { kind: 'ok', value: { identity: outcome.body.identity, expiresAtMs: outcome.body.session.expiresAtMs } } : { kind: 'stale' };
  }

  function me(): Promise<AuthResult<SignedIn>> {
    return single('me', '', () => identityCall('me', { method: 'GET', path: AUTH_PATHS.me }, NO_RETRY));
  }

  function selectContext(context: PublicContext): Promise<AuthResult<SignedIn>> {
    if (!(PUBLIC_CONTEXTS as readonly string[]).includes(context)) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    const body = JSON.stringify({ context });
    return single('context', body, () => {
      const entry = keyFor('context', body);
      return identityCall('context', { method: 'POST', path: AUTH_PATHS.context, body, idempotencyKey: entry.key }, { intent: 'context', entry });
    });
  }

  // ---- own profile -----------------------------------------------------------------------------------------------
  /** One authenticated profile call: the answer is checked against the signed-in person and applied to the session only if it is still current. */
  async function profileCall(
    operation: 'profileRead' | 'profileSave',
    request: Omit<TransportRequest, 'bearer' | 'signal'>,
    pending: { readonly intent: Intent; readonly entry: IntentEntry } | undefined,
  ): Promise<AuthResult<ProfileView | null>> {
    const ticket = store.ticket();
    const bearer = store.bearer();
    const identity = store.identity();
    if (bearer === undefined || identity === undefined) {
      return fail('SESSION_EXPIRED');
    }
    const controller = new AbortController();
    const untrack = store.track(controller);
    let result: TransportResult;
    try {
      result = await transport.send({ ...request, bearer, signal: controller.signal });
    } finally {
      untrack();
    }
    const outcome = classify<ProfileWire | null>(operation, result, 200, parseProfileResponse);
    if (outcome.kind === 'aborted' || !store.isCurrent(ticket)) {
      return { kind: 'stale' };
    }
    if (outcome.kind === 'failure') {
      if (outcome.mapped?.sessionInvalid === true) {
        store.invalidate(ticket);
      }
      if (pending !== undefined) {
        settle(pending.intent, pending.entry, outcome.result);
      }
      return outcome.result as AuthResult<ProfileView | null>;
    }
    if (pending !== undefined) {
      dropIntent(pending.intent, pending.entry);
    }
    const profile = outcome.body;
    // A profile of another user, or a save that answers "no profile", is not this contract.
    if ((profile !== null && profile.userId !== identity.userId) || (profile === null && operation === 'profileSave')) {
      return fail('BAD_RESPONSE');
    }
    if (profile === null) {
      return { kind: 'ok', value: null };
    }
    return store.updateProfile(ticket, profile.fullName, profile.version) ? { kind: 'ok', value: { fullName: profile.fullName, version: profile.version } } : { kind: 'stale' };
  }

  function readProfile(): Promise<AuthResult<ProfileView | null>> {
    return single('profileRead', '', () => profileCall('profileRead', { method: 'GET', path: AUTH_PATHS.profile }, NO_RETRY));
  }

  function saveProfile(input: { readonly fullName: string; readonly expectedVersion: number }): Promise<AuthResult<ProfileView>> {
    const fullName = typeof input.fullName === 'string' ? normalizePersonName(input.fullName) : undefined;
    if (fullName === undefined || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    const body = JSON.stringify({ full_name: fullName, expected_version: input.expectedVersion });
    return single('profileSave', body, async () => {
      const entry = keyFor('profile', body);
      const answer = await profileCall('profileSave', { method: 'PUT', path: AUTH_PATHS.profile, body, idempotencyKey: entry.key }, { intent: 'profile', entry });
      return answer as AuthResult<ProfileView>;
    });
  }

  // ---- own shop (11Food onboarding) ------------------------------------------------------------------------------
  /** One authenticated shop call: the answer is applied to nothing in the session, only returned, and only if the session is still the one that asked. */
  async function shopCall<T>(
    operation: 'shopRead' | 'shopSave' | 'shopComplete' | 'shopAreas',
    request: Omit<TransportRequest, 'bearer' | 'signal'>,
    expectedStatus: number | readonly number[],
    parse: (body: unknown) => T | undefined,
    pending: { readonly intent: Intent; readonly entry: IntentEntry } | undefined,
  ): Promise<AuthResult<T>> {
    const ticket = store.ticket();
    const bearer = store.bearer();
    if (bearer === undefined) {
      return fail('SESSION_EXPIRED');
    }
    const controller = new AbortController();
    const untrack = store.track(controller);
    let result: TransportResult;
    try {
      result = await transport.send({ ...request, bearer, signal: controller.signal });
    } finally {
      untrack();
    }
    const outcome = classify<T>(operation, result, expectedStatus, parse);
    if (outcome.kind === 'aborted' || !store.isCurrent(ticket)) {
      return { kind: 'stale' };
    }
    if (outcome.kind === 'failure') {
      if (outcome.mapped?.sessionInvalid === true) {
        store.invalidate(ticket);
      }
      if (pending !== undefined) {
        settle(pending.intent, pending.entry, outcome.result);
      }
      return outcome.result as AuthResult<T>;
    }
    if (pending !== undefined) {
      dropIntent(pending.intent, pending.entry);
    }
    return { kind: 'ok', value: outcome.body };
  }

  function readShop(): Promise<AuthResult<ShopView | null>> {
    return single('shopRead', '', () => shopCall<ShopView | null>('shopRead', { method: 'GET', path: AUTH_PATHS.shopProfile }, 200, parseShopProfileResponse, NO_RETRY));
  }

  function readServiceAreas(): Promise<AuthResult<readonly ServiceAreaChoice[]>> {
    return single('shopAreas', '', () => shopCall<readonly ServiceAreaChoice[]>('shopAreas', { method: 'GET', path: AUTH_PATHS.shopServiceAreas }, 200, parseServiceAreasResponse, NO_RETRY));
  }

  function saveShop(input: ShopSaveInput): Promise<AuthResult<ShopSaved>> {
    const name = typeof input.name === 'string' ? normalizeRequiredText(input.name, SHOP_NAME_MAX) : undefined;
    const address = typeof input.addressText === 'string' ? normalizeRequiredText(input.addressText, ADDRESS_MAX) : undefined;
    if (typeof input.contactPhone !== 'string' || !isValidPhone(input.contactPhone)) {
      return Promise.resolve(fail('INVALID_PHONE'));
    }
    const zalo = input.zalo === null ? ({ ok: true, value: null } as const) : normalizeOptionalLink(input.zalo, ZALO_MAX);
    const facebook = input.facebook === null ? ({ ok: true, value: null } as const) : normalizeOptionalLink(input.facebook, FACEBOOK_MAX);
    if (
      name === undefined ||
      address === undefined ||
      !zalo.ok ||
      !facebook.ok ||
      (input.pickup !== null && !isValidCoordinatePair(input.pickup.lat, input.pickup.lng)) ||
      !(input.serviceAreaId === null || isUuid(input.serviceAreaId)) ||
      !(input.expectedVersion === null || (Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 1))
    ) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    // Fixed key order: the same input always serializes to the same bytes. null expected_version = create.
    const body = JSON.stringify({
      name,
      contact_phone: input.contactPhone.trim(),
      address_text: address,
      zalo: zalo.value,
      facebook: facebook.value,
      pickup_lat: input.pickup === null ? null : input.pickup.lat,
      pickup_lng: input.pickup === null ? null : input.pickup.lng,
      service_area_id: input.serviceAreaId,
      expected_version: input.expectedVersion,
    });
    return single('shopSave', body, async () => {
      const entry = keyFor('shopSave', body);
      return shopCall<ShopSaved>('shopSave', { method: 'PUT', path: AUTH_PATHS.shopProfile, body, idempotencyKey: entry.key }, [200, 201], parseShopSaveResponse, { intent: 'shopSave', entry });
    });
  }

  function completeShop(input: { readonly expectedVersion: number }): Promise<AuthResult<ShopCompleted>> {
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      return Promise.resolve(fail('BAD_REQUEST'));
    }
    const body = JSON.stringify({ expected_version: input.expectedVersion });
    return single('shopComplete', body, async () => {
      const entry = keyFor('shopComplete', body);
      return shopCall<ShopCompleted>('shopComplete', { method: 'POST', path: AUTH_PATHS.shopComplete, body, idempotencyKey: entry.key }, 200, parseShopCompleteResponse, { intent: 'shopComplete', entry });
    });
  }

  // ---- logout ----------------------------------------------------------------------------------------------------
  function logout(): Promise<AuthResult<LogoutResult>> {
    const token = store.bearer();
    // Joins a logout only while it is still the same sign-out: a second tap, or no session left. A session that signed in
    // after it (token defined, different) gets its own logout.
    if (logoutRun !== undefined && (token === undefined || token === logoutRun.token)) {
      return logoutRun.promise;
    }
    // Local first and unconditionally: token and personal data are gone before the network is touched, running
    // authenticated calls are cancelled, and every sign-in still on its way is stale (the generation moved).
    store.clear();
    intents.clear();
    running.clear();
    registerFlow.reset();
    if (token === undefined) {
      return Promise.resolve({ kind: 'ok', value: { hadSession: false, serverRevoked: false } });
    }
    const run = (async (): Promise<AuthResult<LogoutResult>> => {
      const result = await transport.send({ method: 'POST', path: AUTH_PATHS.logout, body: '{}', bearer: token });
      if (result.kind === 'response' && result.status === 204) {
        return { kind: 'ok', value: { hadSession: true, serverRevoked: true } };
      }
      const reason: FailureCode =
        result.kind === 'timeout'
          ? 'TIMEOUT'
          : result.kind === 'network'
            ? 'OFFLINE'
            : result.kind === 'response'
              ? mapHttpFailure('logout', result.status, errorCodeOf(result.body)).code
              : 'UNKNOWN';
      // The local sign-out stands; the server's session is NOT proven revoked, and the result says so.
      return { kind: 'ok', value: { hadSession: true, serverRevoked: false, unconfirmedReason: reason } };
    })().finally(() => {
      if (logoutRun?.promise === run) {
        logoutRun = undefined;
      }
    });
    logoutRun = { token, promise: run };
    return run;
  }

  function dispose(): void {
    store.clear();
    intents.clear();
    running.clear();
    registerFlow.reset();
  }

  const session: AuthSessionView = {
    state: () => store.state(),
    identity: () => store.identity(),
    subscribe: (listener) => store.subscribe(listener),
  };

  function resetRegisterFlow(): void {
    registerFlow.reset();
    intents.delete('register');
    running.delete('register');
  }

  return { session, registrationConfig, requestRegisterOtp, verifyRegisterOtp, resetRegisterFlow, register: registerUser, registerWithoutProof, login, me, selectContext, logout, readProfile, saveProfile, readShop, readServiceAreas, saveShop, completeShop, dispose };
}

export type { SessionTicket };
