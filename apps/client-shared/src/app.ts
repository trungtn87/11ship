import { AppBrand } from './brand.js';
import { toast } from './components.js';
import { liveConnection } from './connection.js';
import { ConnectionBanner, createConnectionBanner } from './connection-ui.js';
import { loadBuildInfo } from './environment.js';
import { featureStatus, isWired } from './features.js';
import { HealthMonitor } from './health.js';
import { NOT_WIRED_PORTS } from './ports.js';
import { LeaveController } from './leave.js';
import { HistoryPort, RouteDef, Router, RouteTable } from './router.js';
import { FlowStore, ScreenDef, ScreenEnv } from './screen.js';

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
  const env: ScreenEnv = {
    mode: 'live',
    brand: definition.brand,
    ports: NOT_WIRED_PORTS,
    flows,
    // Nobody can be signed in yet: there is no login backend, so no screen ever receives an account.
    account: undefined,
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
    isWired,
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
    state: () => ({ signedIn: false, flows: flows.names() }),
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
