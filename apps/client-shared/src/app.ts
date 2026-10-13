import { createAuthClient, LogoutResult } from './auth/client.js';
import { AuthIdentity } from './auth/contract.js';
import { AppBrand } from './brand.js';
import { toast } from './components.js';
import { ConsentOffer } from './consent.js';
import { liveConnection } from './connection.js';
import { ConnectionBanner, createConnectionBanner } from './connection-ui.js';
import { loadBuildInfo } from './environment.js';
import { FeatureId, featureStatus, isWired } from './features.js';
import { HealthMonitor } from './health.js';
import { NOT_WIRED_PORTS } from './ports.js';
import { LeaveController } from './leave.js';
import { createDriverController } from './driver-flow.js';
import { createRecoveryController } from './recovery-flow.js';
import { createRegisterController } from './register-flow.js';
import { browserGeolocation, createShopController } from './shop-flow.js';
import { HistoryPort, RouteDef, Router, RouteTable } from './router.js';
import { AccountView, FlowStore, ScreenDef, ScreenEnv } from './screen.js';
import { STATE_COPY } from './states.js';
import { maskPhone } from './validation.js';

// Wires the screens to the real app: router, real paths, no session, ports that answer "not wired". The design preview
// (design/start.ts) is a separate module that the live build removes.

/** How often a running app asks the server again while the page is visible (and no check was asked for sooner). */
export const HEALTH_POLL_MS = 30_000;

export interface AppDefinition {
  readonly brand: AppBrand;
  readonly screens: readonly ScreenDef[];
  /** Id of the guest home. */
  readonly homeId: string;
  /** Where an unknown path goes. */
  readonly fallbackPath: string;
  readonly loginPath: string;
  /** Flow name -> path of the screen that starts it (a flow screen opened directly goes back there). */
  readonly flowStart: Readonly<Record<string, string>>;
  /** Test build: OTP screens show the "SMS mô phỏng" notice. */
  readonly testSmsNotice: boolean;
  /**
   * Present = this app has a register flow connected to the server (M01.07: 11Food, and 11Ship with the same flow). It is switched
   * on only on a local https runtime (`isLocalHttpsRuntime`); everywhere else the register screens stay in their "chưa nối máy chủ" state.
   */
  readonly register?: { readonly consent: ConsentOffer };
  /** Present = this app connects the shop onboarding (11Food only; 11Ship never does). Same local-https-only rule as the account features. */
  readonly shopOnboarding?: true;
  /** Present = this app connects the driver profile (S12 submit, S13 status): 11Ship only. Same local-https-only rule. */
  readonly driverProfile?: true;
}

/** The features the register flow connects when it is on. Nothing else becomes wired by it. */
const REGISTER_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>(['auth.register', 'auth.registerOtp']);
/** The account features (login, logout, own profile) connected by the same client authentication on a local https runtime. */
const ACCOUNT_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>(['auth.resetRequest', 'auth.login', 'auth.logout', 'customer.profileSave', 'account.read']);
/** The shop onboarding features, connected by the shop controller (11Food, local https runtime). */
const SHOP_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>(['shop.draftSave', 'shop.location', 'shop.complete']);

/** The driver profile features, connected by the driver controller (11Ship, local https runtime). */
const DRIVER_FEATURES: ReadonlySet<FeatureId> = new Set<FeatureId>(['driver.submit', 'driver.statusRead']);

/** Longest delay setTimeout takes. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The page is served by the local https runtime of this machine (https://localhost:<port>): the only place the front forwards the
 * three register routes. A page from any other origin (a deployed test server, a plain http preview) never turns the flow on.
 */
export function isLocalHttpsRuntime(location: { readonly protocol: string; readonly hostname: string }): boolean {
  return location.protocol === 'https:' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '[::1]');
}

/** What the server says about the signed-in person, as a screen shows it. Roles are the server's list: the client grants nothing. */
export function accountOf(identity: AuthIdentity): AccountView {
  // Only what the server reports: the stored driver state, one to one (none is made up).
  const driverStates = { NOT_STARTED: 'NONE', PENDING_APPROVAL: 'PENDING', ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', CLOSING: 'CLOSING', CLOSED: 'CLOSED' } as const;
  const driverStatus = driverStates[identity.onboarding.driver];
  // The shop state the server reports for this person (never a made-up shop); its name is read from the profile when F23 opens.
  const shopState = identity.onboarding.shop === 'COMPLETED' ? 'COMPLETE' : identity.onboarding.shop === 'INCOMPLETE' ? 'DRAFT' : 'NONE';
  return {
    fullName: identity.profile.fullName,
    phoneMasked: maskPhone(identity.phoneNormalized) ?? '••• •••• •••',
    roles: identity.availableRoles,
    activeRole: identity.activeRole,
    shop: { state: shopState },
    ...(driverStatus === undefined ? {} : { driver: { status: driverStatus } }),
  };
}

export function routeTable(definition: AppDefinition): RouteTable {
  const routes: RouteDef[] = definition.screens.flatMap((screen) => (screen.path === undefined ? [] : [{ id: screen.id, path: screen.path, access: screen.access, flow: screen.flow }]));
  return { routes, fallback: definition.fallbackPath, loginPath: definition.loginPath, flowStart: definition.flowStart };
}

export function windowHistory(): HistoryPort {
  return {
    pathname: () => window.location.pathname,
    push: (path) => window.history.pushState(null, '', path),
    replace: (path) => window.history.replaceState(null, '', path),
    onPop: (listener) => {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
  };
}

interface Stamp {
  readonly ui: number;
}

function stampOf(state: unknown): number | undefined {
  const value = (state as Partial<Stamp> | null)?.ui;
  return typeof value === 'number' ? value : undefined;
}

/**
 * History of the real app with C08: each entry carries its position (`{ ui: n }`, no content), so a browser Back/Forward that
 * would leave a dirty form can be undone exactly (history.go back to where the person was) while the confirmation is open.
 * "Ở lại" leaves everything as it was; "Thoát" wipes the form and repeats the jump. Only a position number is stored.
 */
export function guardedHistory(leave: LeaveController): HistoryPort {
  let index = stampOf(window.history.state) ?? 0;
  window.history.replaceState({ ui: index } satisfies Stamp, '', window.location.pathname + window.location.search);
  let undoing = false;
  let bypass = false;
  return {
    pathname: () => window.location.pathname,
    push: (path) => {
      index += 1;
      window.history.pushState({ ui: index } satisfies Stamp, '', path);
    },
    replace: (path) => window.history.replaceState({ ui: index } satisfies Stamp, '', path),
    onPop: (listener) => {
      const onPopState = (event: PopStateEvent): void => {
        const target = stampOf(event.state);
        if (undoing) {
          undoing = false;
          return;
        }
        if (bypass) {
          bypass = false;
          index = target ?? index;
          listener();
          return;
        }
        if (!leave.dirty()) {
          index = target ?? index;
          listener();
          return;
        }
        if (target !== undefined && target !== index) {
          const delta = index - target;
          undoing = true;
          window.history.go(delta);
          leave.request(() => {
            bypass = true;
            window.history.go(-delta);
          });
          return;
        }
        // The entry has no known position: put the current page back on top, then go one step back if the person leaves.
        index += 1;
        window.history.pushState({ ui: index } satisfies Stamp, '', window.location.pathname + window.location.search);
        leave.request(() => {
          bypass = true;
          window.history.back();
        });
      };
      window.addEventListener('popstate', onPopState);
      return () => window.removeEventListener('popstate', onPopState);
    },
  };
}

export function startLive(root: HTMLElement, definition: AppDefinition): Router {
  const flows = new FlowStore();
  const table = routeTable(definition);
  // The screens' `go` is needed before the router exists (it is built from the same table), so it reads the router through this holder.
  const routerRef: { current: Router | undefined } = { current: undefined };
  const leave = new LeaveController();
  // Health of the server: real requests, same origin, no cache, no credentials (see health.ts). Nothing but reachability.
  const monitor = new HealthMonitor({
    fetch: (input, init) => window.fetch(input, init),
    intervalMs: HEALTH_POLL_MS,
    shouldPoll: () => document.visibilityState !== 'hidden',
  });
  const connection = liveConnection(monitor, window.location.origin);
  // The client authentication (register M01.07, login/profile/logout), only on a local https runtime. Session in memory only: a reload starts signed out.
  const auth =
    isLocalHttpsRuntime(window.location)
      ? createAuthClient({ fetch: (input, init) => window.fetch(input, init), app: definition.brand.id === 'FOOD' ? 'FOOD' : 'SHIP' })
      : undefined;
  const register = auth === undefined || definition.register === undefined ? undefined : createRegisterController({ auth, flows, consent: definition.register.consent });
  const recovery = auth === undefined ? undefined : createRecoveryController({ auth });
  const shop = auth === undefined || definition.shopOnboarding !== true ? undefined : createShopController({ auth, geo: browserGeolocation(window.navigator) });
  const driver = auth === undefined || definition.driverProfile !== true ? undefined : createDriverController({ auth });
  // Signing out on purpose is not "the session ended": the person asked, so no "sign in again" notice follows it.
  let signingOut = false;
  const signOut = async (): Promise<LogoutResult> => {
    if (auth === undefined) {
      return { hadSession: false, serverRevoked: false };
    }
    signingOut = true;
    const pending = auth.logout();
    signingOut = false; // the local sign-out (and its notification) happens synchronously inside logout()
    const result = await pending;
    return result.kind === 'ok' ? result.value : { hadSession: true, serverRevoked: false };
  };
  const env: ScreenEnv = {
    mode: 'live',
    brand: definition.brand,
    ports: NOT_WIRED_PORTS,
    flows,
    // Only a session the server established (register) gives an account; the login screens are still not connected.
    get account(): AccountView | undefined {
      const identity = auth?.session.identity();
      return identity === undefined ? undefined : accountOf(identity);
    },
    ...(register === undefined ? {} : { register }),
    ...(recovery === undefined ? {} : { recovery }),
    ...(auth === undefined ? {} : { auth, signOut }),
    ...(shop === undefined ? {} : { shop }),
    ...(driver === undefined ? {} : { driver }),
    // C08: every in-app navigation first asks about a form that is being filled.
    go: (id) => leave.request(() => routerRef.current?.go(id)),
    back: () =>
      leave.request(() => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          routerRef.current?.go(definition.homeId);
        }
      }),
    guard: (guard) => leave.register(guard),
    toast: (text) => toast(text),
    dialogHost: undefined,
    connection,
    isWired: (feature) => (register !== undefined && REGISTER_FEATURES.has(feature)) || (auth !== undefined && ACCOUNT_FEATURES.has(feature)) || (shop !== undefined && SHOP_FEATURES.has(feature)) || (driver !== undefined && DRIVER_FEATURES.has(feature)) || isWired(feature),
    featureReason: (feature) => featureStatus(feature).reason,
    testSmsNotice: definition.testSmsNotice,
  };
  let first = true;
  let connectionBanner: ConnectionBanner | undefined;
  const focusHeading = (content: HTMLElement): void => {
    const heading = content.querySelector<HTMLElement>('h1');
    if (heading !== null) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  };
  const router = new Router(table, guardedHistory(leave), {
    state: () => ({ signedIn: auth?.session.state().kind === 'authenticated', flows: flows.names() }),
    render: (route) => {
      const screen = definition.screens.find((candidate) => candidate.id === route.id);
      if (screen === undefined) {
        return;
      }
      // The previous screen is gone: whatever it still held (password, OTP) is wiped before the next one is drawn.
      leave.clear();
      const content = screen.render(env, 'default');
      root.replaceChildren(content);
      // The connection banner sits under the app bar of every screen that does not show the connection state itself.
      connectionBanner?.dispose();
      connectionBanner = undefined;
      if (screen.hideConnectionBanner !== true) {
        connectionBanner = createConnectionBanner(connection, { focusFallback: () => focusHeading(content) });
        const bar = content.querySelector(':scope > header');
        if (bar === null) {
          content.prepend(connectionBanner.element);
        } else {
          bar.after(connectionBanner.element);
        }
      }
      document.title = `${screen.title} · ${definition.brand.name}`;
      window.scrollTo(0, 0);
      if (!first) {
        focusHeading(content);
      }
      first = false;
    },
  });
  routerRef.current = router;
  // The session ended without the person asking (the server said invalid/revoked/expired, or its absolute expiry passed): everything
  // personal is dropped (forms, flows, the account) and the person is taken to the login screen with a notice.
  if (auth !== undefined) {
    let wasSignedIn = auth.session.state().kind === 'authenticated';
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const watch = (state: ReturnType<typeof auth.session.state>): void => {
      if (expiryTimer !== undefined) {
        clearTimeout(expiryTimer);
        expiryTimer = undefined;
      }
      if (state.kind === 'authenticated') {
        wasSignedIn = true;
        // Reading the state past the expiry signs out (and notifies), so the screen does not keep a dead session.
        expiryTimer = setTimeout(() => void auth.session.state(), Math.min(Math.max(state.expiresAtMs - Date.now(), 0) + 50, MAX_TIMER_MS));
        return;
      }
      const ended = wasSignedIn;
      wasSignedIn = false;
      if (ended) {
        flows.clear();
      }
      if (ended && !signingOut) {
        leave.clear();
        toast(STATE_COPY.sessionExpired.text);
        router.go('login');
      }
    };
    auth.session.subscribe(watch);
  }
  // Closing or reloading the page with a form being filled asks the browser's own confirmation.
  window.addEventListener('beforeunload', (event) => {
    if (leave.dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  router.start();
  // Connection state: ask now; ask again when the network returns or the page becomes visible; show "offline" at once when
  // the browser says the network is gone (no waiting for a timeout). A stale answer can never overwrite a newer check.
  window.addEventListener('offline', () => monitor.markOffline());
  window.addEventListener('online', () => void monitor.check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void monitor.check();
    }
  });
  monitor.start();
  void loadBuildInfo({ fetch: (input, init) => window.fetch(input, init) }).then((build) => connection.setBuild(build));
  return router;
}
