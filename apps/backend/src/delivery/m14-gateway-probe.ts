import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { M14RoutingConfig } from '../config/m14-routing-config';
import { Fetcher, M14_FETCH, M14_ROUTING, ROUTE_VERSION_PATTERN } from './m14-route-client';

// Startup probe of the M14 gateway (P6-1 review round 2, SỬA-6). It never blocks or fails the backend's start, and it never changes a route:
// it only tells operators, once per process, that the gateway is not ready or answers without a valid routeVersion. The deploy gate
// (scripts/deploy/vps-update.py, ops/m14/gateway-gate.sh) is what stops a release; this is the backend-side signal.

export type GatewayState = 'READY' | 'NOT_READY' | 'VERSION_INVALID' | 'UNREACHABLE' | 'NOT_CONFIGURED';

const obj = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** Reads the gateway's /health answer: READY only when the service is ready AND its routeVersion matches the backend's accepted pattern. */
export function gatewayState(body: unknown): GatewayState {
  const root = obj(body);
  if (root?.ready !== true) return 'NOT_READY';
  const version = root.routeVersion;
  return typeof version === 'string' && ROUTE_VERSION_PATTERN.test(version) ? 'READY' : 'VERSION_INVALID';
}

@Injectable()
export class M14GatewayProbe implements OnApplicationBootstrap {
  readonly #log = new Logger(M14GatewayProbe.name);
  #reported = false;

  constructor(
    @Optional() @Inject(M14_ROUTING) private readonly config?: M14RoutingConfig,
    @Optional() @Inject(M14_FETCH) private readonly fetcher?: Fetcher,
  ) {}

  onApplicationBootstrap(): void {
    // Not awaited: a gateway that is down or slow must never delay or fail the start of the backend.
    void this.probe().catch(() => undefined);
  }

  /** One probe. Logs at most one ERROR (version missing or invalid) and one WARN (not ready or unreachable) per process. */
  async probe(): Promise<GatewayState> {
    const config = this.config;
    if (config === undefined) return 'NOT_CONFIGURED';
    let state: GatewayState;
    try {
      const fetcher: Fetcher = this.fetcher ?? ((url, init) => fetch(url, init));
      const response = await fetcher(`${config.origin}/health`, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs) });
      state = gatewayState(await response.json());
    } catch {
      state = 'UNREACHABLE';
    }
    if (state === 'VERSION_INVALID' && !this.#reported) {
      this.#reported = true;
      this.#log.error('M14 routing gateway answers without a valid routeVersion: routes stay unavailable until the gateway is upgraded (ops/runbooks/m14-valhalla-vps.md)');
    } else if ((state === 'NOT_READY' || state === 'UNREACHABLE') && !this.#reported) {
      this.#reported = true;
      this.#log.warn('M14 routing gateway is not ready at startup; routes are unavailable until it is');
    }
    return state;
  }
}
