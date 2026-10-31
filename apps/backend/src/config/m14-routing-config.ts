// Configuration of the M14 routing service the delivery flow asks for road distance and travel time (M07: fee distance, ETA, batching). Pure
// validation: nothing here reads the environment by itself and only the NAMES of invalid variables are reported.
//
//   M14_ROUTING_ORIGIN       unset (default: routing is NOT available, a fee that needs a route stays unknown) | an HTTPS origin such as
//                            https://routing.example.vn (no path, query, fragment or credentials). `http://` is accepted ONLY for a loopback
//                            host (localhost, 127.0.0.1, [::1]) in every environment, production included: the routing container on the same VPS
//                            publishes its port on 127.0.0.1 only, so that traffic never leaves the machine. Any other host must be https.
//   M14_ROUTING_TIMEOUT_MS   default 8000, 500..20000. A route that takes longer is "unavailable": never replaced by a straight line.

export const M14_ROUTING_ORIGIN_ENV = 'M14_ROUTING_ORIGIN';
export const M14_ROUTING_TIMEOUT_ENV = 'M14_ROUTING_TIMEOUT_MS';

export interface M14RoutingConfig {
  /** `scheme://host[:port]`, no trailing slash. */
  readonly origin: string;
  readonly timeoutMs: number;
}

export type M14RoutingResult = { readonly ok: true; readonly config: M14RoutingConfig | undefined } | { readonly ok: false; readonly invalid: readonly string[] };

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function parseM14Routing(input: { readonly env: Readonly<Record<string, string | undefined>>; readonly appEnv: string }): M14RoutingResult {
  const raw = input.env[M14_ROUTING_ORIGIN_ENV];
  const timeoutRaw = input.env[M14_ROUTING_TIMEOUT_ENV];
  const invalid: string[] = [];
  let timeoutMs = 8000;
  if (timeoutRaw !== undefined) {
    const value = /^\d{1,6}$/.test(timeoutRaw) ? Number(timeoutRaw) : Number.NaN;
    if (!Number.isSafeInteger(value) || value < 500 || value > 20_000) {
      invalid.push(M14_ROUTING_TIMEOUT_ENV);
    } else {
      timeoutMs = value;
    }
  }
  if (raw === undefined || raw === '') {
    return invalid.length === 0 ? { ok: true, config: undefined } : { ok: false, invalid };
  }
  let origin: string | undefined;
  try {
    const url = new URL(raw);
    const local = LOOPBACK.has(url.hostname);
    const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && local);
    const bare = url.username === '' && url.password === '' && (url.pathname === '/' || url.pathname === '') && url.search === '' && url.hash === '';
    if (schemeOk && bare) {
      origin = url.origin;
    }
  } catch {
    origin = undefined;
  }
  if (origin === undefined) {
    invalid.push(M14_ROUTING_ORIGIN_ENV);
  }
  return invalid.length > 0 || origin === undefined ? { ok: false, invalid } : { ok: true, config: { origin, timeoutMs } };
}
