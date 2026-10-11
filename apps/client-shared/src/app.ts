import { AppBrand } from './brand.js';
import { toast } from './components.js';
import { featureStatus, isWired } from './features.js';
import { NOT_WIRED_PORTS } from './ports.js';
import { HistoryPort, RouteDef, Router, RouteTable } from './router.js';
import { FlowStore, ScreenDef, ScreenEnv } from './screen.js';

// Wires the screens to the real app: router, real paths, no session, ports that answer "not wired". The design preview
// (design/start.ts) is a separate module that the live build removes.

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

export function startLive(root: HTMLElement, definition: AppDefinition): Router {
  const flows = new FlowStore();
  const table = routeTable(definition);
  // The screens' `go` is needed before the router exists (it is built from the same table), so it reads the router through this holder.
  const routerRef: { current: Router | undefined } = { current: undefined };
  const env: ScreenEnv = {
    mode: 'live',
    brand: definition.brand,
    ports: NOT_WIRED_PORTS,
    flows,
    // Nobody can be signed in yet: there is no login backend, so no screen ever receives an account.
    account: undefined,
    go: (id) => routerRef.current?.go(id),
    back: () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        routerRef.current?.go(definition.homeId);
      }
    },
    toast: (text) => toast(text),
    dialogHost: undefined,
    isWired,
    featureReason: (feature) => featureStatus(feature).reason,
    testSmsNotice: definition.testSmsNotice,
  };
  let first = true;
  const router = new Router(table, windowHistory(), {
    state: () => ({ signedIn: false, flows: flows.names() }),
    render: (route) => {
      const screen = definition.screens.find((candidate) => candidate.id === route.id);
      if (screen === undefined) {
        return;
      }
      const content = screen.render(env, 'default');
      root.replaceChildren(content);
      document.title = `${screen.title} · ${definition.brand.name}`;
      window.scrollTo(0, 0);
      if (!first) {
        const heading = content.querySelector<HTMLElement>('h1');
        if (heading !== null) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      }
      first = false;
    },
  });
  routerRef.current = router;
  router.start();
  return router;
}
