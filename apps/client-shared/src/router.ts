// Client-side navigation of the phone apps. The decision "may this person see this path" is a pure function so it can be
// tested without a browser. It is only a convenience for the UI: the backend refuses what the session may not do anyway.
// (The client never decides a right; it only avoids showing a screen that cannot work.)

export type Access = 'public' | 'authed' | 'flow';

export interface RouteDef {
  readonly id: string;
  readonly path: string;
  readonly access: Access;
  /** For `flow` routes: the in-memory flow that must be in progress (e.g. a register step that needs a code request). */
  readonly flow?: string;
}

export interface RouteTable {
  readonly routes: readonly RouteDef[];
  /** Where an unknown path goes. */
  readonly fallback: string;
  /** Where a path that needs a session goes when there is none. */
  readonly loginPath: string;
  /** Where a flow route goes when its flow is not in progress, by flow name. */
  readonly flowStart: Readonly<Record<string, string>>;
}

export interface NavState {
  readonly signedIn: boolean;
  readonly flows: ReadonlySet<string>;
}

export type Resolution =
  | { readonly kind: 'render'; readonly route: RouteDef }
  | { readonly kind: 'redirect'; readonly to: string; readonly reason: 'login' | 'flow' | 'unknown' };

export function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '');
  return path === '' ? '/' : path;
}

export function resolveRoute(pathname: string, table: RouteTable, state: NavState): Resolution {
  const path = normalizePath(pathname);
  const route = table.routes.find((candidate) => candidate.path === path);
  if (route === undefined) {
    return { kind: 'redirect', to: table.fallback, reason: 'unknown' };
  }
  if (route.access === 'authed' && !state.signedIn) {
    return { kind: 'redirect', to: table.loginPath, reason: 'login' };
  }
  if (route.access === 'flow') {
    const flow = route.flow;
    if (flow === undefined || !state.flows.has(flow)) {
      return { kind: 'redirect', to: (flow === undefined ? undefined : table.flowStart[flow]) ?? table.fallback, reason: 'flow' };
    }
  }
  return { kind: 'render', route };
}

/**
 * A "return to" target is kept only if it is a plain same-origin path (no scheme, no `//`, no backslash, no control
 * character) AND is a screen that exists. Anything else is dropped, so a crafted link cannot send the person elsewhere.
 * It is only ever followed with a GET navigation, never replays a submitted action.
 */
export function safeReturnTo(candidate: string | null | undefined, table: RouteTable): string | undefined {
  if (candidate === null || candidate === undefined || candidate.length > 200) {
    return undefined;
  }
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[\u0000-\u001f\u007f]/.test(candidate)) {
    return undefined;
  }
  const path = normalizePath(candidate.split(/[?#]/, 1)[0]);
  const route = table.routes.find((entry) => entry.path === path);
  return route !== undefined && route.access === 'authed' ? path : undefined;
}

export interface HistoryPort {
  pathname(): string;
  push(path: string): void;
  replace(path: string): void;
  onPop(listener: () => void): () => void;
}

export interface RouterHooks {
  readonly state: () => NavState;
  readonly render: (route: RouteDef) => void;
}

export class Router {
  #off: (() => void) | undefined;

  constructor(
    private readonly table: RouteTable,
    private readonly history: HistoryPort,
    private readonly hooks: RouterHooks,
  ) {}

  start(): void {
    this.#off?.();
    this.#off = this.history.onPop(() => this.#apply(0));
    this.#apply(0);
  }

  stop(): void {
    this.#off?.();
    this.#off = undefined;
  }

  go(id: string): void {
    const route = this.table.routes.find((candidate) => candidate.id === id);
    if (route === undefined) {
      return;
    }
    if (normalizePath(this.history.pathname()) !== route.path) {
      this.history.push(route.path);
    }
    this.#apply(0);
  }

  /** A redirect replaces the history entry (Back never returns to the refused path). Bounded, so a bad table cannot loop. */
  #apply(depth: number): void {
    const resolution = resolveRoute(this.history.pathname(), this.table, this.hooks.state());
    if (resolution.kind === 'redirect') {
      if (depth < 3) {
        this.history.replace(resolution.to);
        this.#apply(depth + 1);
      }
      return;
    }
    this.hooks.render(resolution.route);
  }
}
