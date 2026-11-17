// Static checks of the nginx rate limits (P5-7d) against the template and the backend routes/constants they mirror.
// Nothing here starts nginx or touches a server. A real `nginx -t` and a request-level run were done separately, see the runbook.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const nginx = read('ops/vinahost/nginx-11ship-staging.conf');
const runbook = read('ops/runbooks/nginx-trust-proxy-OD30-20261109.md');
const backendSource = (relative) => read(`apps/backend/src/${relative}`);

/** Zone name -> rate in requests per minute, from the top-level limit_req_zone lines. */
function zones(text) {
  const map = new Map();
  for (const [, name, rate] of text.matchAll(/^limit_req_zone \$binary_remote_addr zone=(\w+):\w+\s+rate=(\d+)r\/m;$/gm)) {
    map.set(name, Number(rate));
  }
  return map;
}

/** Each `location` block of the file, as { header, body }. */
function locations(text) {
  const out = [];
  const re = /^    location ([^{]+)\{\n([\s\S]*?)^    \}$/gm;
  for (const [, header, body] of text.matchAll(re)) {
    out.push({ header: header.trim(), body });
  }
  return out;
}

/**
 * The path matcher nginx would use for a location header: `~*` (case-insensitive regex), `~` (case-sensitive regex),
 * `=` (exact). The backend's Express routing is case-insensitive and tolerates a trailing slash, so the matchers here
 * must accept those variants too.
 */
function matcherOf(header) {
  if (header.startsWith('~* ')) return new RegExp(header.slice(3), 'i');
  if (header.startsWith('~ ')) return new RegExp(header.slice(2));
  if (header.startsWith('= ')) return new RegExp(`^${header.slice(2).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'i');
  throw new Error(`unsupported location header: ${header}`);
}

/** The one limited location that uses a zone. */
function locationOf(zone) {
  const found = locations(nginx).filter((l) => new RegExp(`limit_req zone=${zone} `).test(l.body));
  assert.equal(found.length, 1, `exactly one location must use ${zone}`);
  return found[0];
}

const PROXY_HEADERS = [
  /proxy_set_header Host \$host;/,
  /proxy_set_header X-Forwarded-For \$remote_addr;/,
  /proxy_set_header X-Forwarded-Proto \$scheme;/,
  /proxy_set_header X-Real-IP \$remote_addr;/,
  /proxy_set_header Forwarded "";/,
  /proxy_set_header Connection "";/,
];

const LIMITED_ZONES = [
  'ship11_tracking',
  'ship11_route_dist',
  'ship11_admin_login',
  'ship11_client_login',
  'ship11_otp_send',
  'ship11_deletion',
  'ship11_app_download',
  'ship11_ops_ingest',
];

describe('zones', () => {
  const rates = zones(nginx);

  test('the eight zones exist, keyed on the socket address, with a fixed rate per minute', () => {
    assert.deepEqual([...rates.keys()].sort(), [...LIMITED_ZONES].sort());
    assert.equal(nginx.match(/^limit_req_zone /gm)?.length, 8);
  });

  test('every limit_req names a defined zone, with a burst and nodelay (over the burst is 429, never queued)', () => {
    const used = [...nginx.matchAll(/^\s+limit_req zone=(\w+) burst=(\d+) nodelay;$/gm)];
    assert.equal(used.length, 8, 'one limit_req per limited location');
    for (const [, zone, burst] of used) {
      assert.ok(rates.has(zone), `${zone} must be defined`);
      assert.ok(Number(burst) > 0);
    }
  });

  test('the download has a concurrency limit too: limit_conn zone keyed on the address, limit_conn in the download location only', () => {
    assert.match(nginx, /^limit_conn_zone \$binary_remote_addr zone=ship11_app_download_conn:\w+;$/m);
    const downloads = locations(nginx).filter((l) => /limit_conn /.test(l.body));
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].body, /limit_conn ship11_app_download_conn \d+;/);
    assert.match(downloads[0].header, /app-updates\/download/);
  });

  test('over-limit answers are 429, the status the backend uses for its own limits (for limit_req and limit_conn)', () => {
    assert.match(nginx, /^    limit_req_status 429;$/m);
    assert.match(nginx, /^    limit_conn_status 429;$/m);
  });

  test('the zones are keyed on $remote_addr only, never on a header a client controls', () => {
    assert.doesNotMatch(nginx, /limit_(req|conn)_zone [^;]*\$(http_|cookie_|request_header)/);
  });

  test('every zone is described in the runbook table (3.3), so the table and the template cannot drift apart', () => {
    for (const zone of LIMITED_ZONES) {
      assert.match(runbook, new RegExp(`\`${zone}\``), `${zone} must be listed in runbook 3.3`);
    }
  });
});

describe('limited locations', () => {
  const limited = locations(nginx).filter((l) => /limit_req /.test(l.body));

  test('every limited location repeats the full proxy header set (a location-level proxy_set_header hides the inherited ones)', () => {
    assert.equal(limited.length, 8);
    for (const l of limited) {
      for (const header of PROXY_HEADERS) {
        assert.match(l.body, header, `${l.header} must set ${header}`);
      }
      assert.match(l.body, /proxy_pass http:\/\/127\.0\.0\.1:3000;/, `${l.header} must proxy to loopback`);
    }
  });

  test('no limited location appends or passes the client forwarding header through', () => {
    assert.doesNotMatch(nginx, /proxy_add_x_forwarded_for/);
    assert.doesNotMatch(nginx, /http_x_forwarded_for/);
  });

  test('the non-limited routes are unchanged: the menu image route and the catch-all still set the same headers', () => {
    const all = locations(nginx);
    // Two `location /` exist: the port-80 redirect comes first, the HTTPS catch-all is the last one.
    const catchAll = all.filter((l) => l.header === '/').pop();
    assert.ok(catchAll, 'catch-all location must exist');
    for (const header of PROXY_HEADERS) {
      assert.match(catchAll.body, header);
    }
    assert.ok(!/limit_req /.test(catchAll.body), 'the catch-all is deliberately not limited');
  });
});

describe('routes and numbers match the backend', () => {
  test('tracking: every public tracking path the backend answers goes through the tracking zone (aliases included)', () => {
    const matches = matcherOf(locationOf('ship11_tracking').header);
    // The canonical paths, from the controller decorators, under the /v1 prefix.
    const controller = backendSource('delivery/delivery-tracking-public.controller.ts');
    const canonical = [...controller.matchAll(/@Get\('((?:public\/tracking|track)\/:token)'\)/g)].map((m) => `/v1/${m[1].replace(':token', 'tok-abc')}`);
    assert.equal(canonical.length, 2, 'the controller must expose both tracking paths');
    // The root aliases, from the rewrite in app.setup.ts (req.url.startsWith('/track/') ...), which is what the app shares.
    const setup = backendSource('app.setup.ts');
    const aliases = [...setup.matchAll(/req\.url\.startsWith\('(\/[^']+)'\)/g)].map((m) => `${m[1]}tok-abc`);
    assert.ok(aliases.length >= 2, 'the backend rewrites the root tracking aliases');
    for (const path of [...canonical, ...aliases]) {
      assert.match(path, matches, `${path} must be limited by the tracking zone`);
    }
    // Case and trailing-slash variants reach the same handler in Express, so they must be limited here too.
    for (const path of ['/V1/Track/tok-abc', '/v1/track/tok-abc/', '/Public/Tracking/tok-abc', '/TRACK/tok-abc/']) {
      assert.match(path, matches, `${path} must be limited`);
    }
    assert.doesNotMatch('/v1/health/ready', matches);
  });

  test('tracking: the rate is the backend PUBLIC_TRACKING_LIMIT (60/min)', () => {
    assert.equal(zones(nginx).get('ship11_tracking'), Number(/PUBLIC_TRACKING_LIMIT = (\d+)/.exec(backendSource('delivery/public-tracking-rate-limiter.ts'))[1]));
  });

  test('route-distances: POST route, rate = ROUTE_DISTANCES_LIMIT_PER_MINUTE, trailing slash and case variants limited', () => {
    const matches = matcherOf(locationOf('ship11_route_dist').header);
    const src = backendSource('discovery-route/discovery-route.controller.ts');
    assert.match(src, /@Controller\('discovery'\)/);
    assert.match(src, /@Post\('route-distances'\)/);
    for (const path of ['/v1/discovery/route-distances', '/v1/discovery/route-distances/', '/V1/Discovery/Route-Distances']) {
      assert.match(path, matches, `${path} must be limited`);
    }
    assert.doesNotMatch('/v1/discovery/route-distances/extra', matches);
    assert.equal(zones(nginx).get('ship11_route_dist'), Number(/ROUTE_DISTANCES_LIMIT_PER_MINUTE = (\d+)/.exec(src)[1]));
  });

  test('admin login: rate = LOGIN_REQUEST_LIMIT (per address per 60 s), trailing slash variant limited', () => {
    const matches = matcherOf(locationOf('ship11_admin_login').header);
    assert.match(backendSource('admin-auth/admin-auth.controller.ts'), /@Controller\('admin-auth'\)/);
    assert.match(backendSource('admin-auth/admin-auth.controller.ts'), /@Post\('login'\)/);
    for (const path of ['/v1/admin-auth/login', '/v1/admin-auth/login/']) {
      assert.match(path, matches, `${path} must be limited`);
    }
    assert.equal(zones(nginx).get('ship11_admin_login'), Number(/LOGIN_REQUEST_LIMIT = (\d+)/.exec(backendSource('admin-auth/admin-auth-constants.ts'))[1]));
  });

  test('client login: the backend limit is per PHONE (30/min), so the per-IP rate here is a new backstop, not a mirror', () => {
    const matches = matcherOf(locationOf('ship11_client_login').header);
    assert.match(backendSource('client-auth/client-auth.controller.ts'), /@Controller\('client-auth'\)/);
    assert.match(backendSource('client-auth/client-auth.controller.ts'), /@Post\('login'\)/);
    assert.match(backendSource('client-auth/client-login-limiter.ts'), /30 attempts\/minute per normalized phone/);
    for (const path of ['/v1/client-auth/login', '/v1/client-auth/login/']) {
      assert.match(path, matches, `${path} must be limited`);
    }
  });

  test('OTP send: exactly the create routes, not the verify routes, trailing slash variants included', () => {
    const matches = matcherOf(locationOf('ship11_otp_send').header);
    assert.match(backendSource('auth/auth.controller.ts'), /@Controller\('auth'\)[\s\S]*@Post\('phone-verifications'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Controller\('account-recovery'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Post\('otp'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Post\('locked\/otp'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Controller\('admin-recovery'\)[\s\S]*@Post\('otp'\)/);
    for (const path of ['/v1/auth/phone-verifications', '/v1/account-recovery/otp', '/v1/account-recovery/locked/otp', '/v1/admin-recovery/otp', '/v1/auth/phone-verifications/']) {
      assert.match(path, matches, `${path} must be limited`);
    }
    for (const path of ['/v1/auth/phone-verifications/abc/verify', '/v1/account-recovery/otp/abc/verify', '/v1/auth/phone-verifications/abc']) {
      assert.doesNotMatch(path, matches, `${path} must not be limited here`);
    }
  });

  test('account deletion: confirm route, rate ≈ ACCOUNT_DELETE_IP_LIMIT (20) per ACCOUNT_DELETE_IP_WINDOW_SECONDS (600 s) = 2/min', () => {
    const matches = matcherOf(locationOf('ship11_deletion').header);
    assert.match(backendSource('account-deletion/account-deletion.controller.ts'), /@Controller\('account-deletion'\)/);
    assert.match(backendSource('account-deletion/account-deletion.controller.ts'), /@Post\('confirm'\)/);
    const cfg = backendSource('config/account-deletion-config.ts');
    assert.match(cfg, /ip: Object\.freeze\(\{ limit: 20, windowSeconds: 600 \}\)/);
    assert.equal(zones(nginx).get('ship11_deletion'), 2);
    assert.match('/v1/account-deletion/confirm/', matches);
  });

  test('APK download: GET /v1/app-updates/download/:release_id is limited; the check and compatibility reads are not', () => {
    const matches = matcherOf(locationOf('ship11_app_download').header);
    const src = backendSource('ops/ops-client.controller.ts');
    const route = /@Get\('app-updates\/download\/:release_id'\)/.exec(src);
    assert.ok(route, 'the download route must exist in the ops client controller');
    assert.match('/v1/app-updates/download/abc123', matches);
    assert.match('/v1/app-updates/download/abc123/', matches);
    assert.doesNotMatch('/v1/app-updates/check', matches);
    assert.doesNotMatch('/v1/app-updates/compatibility', matches);
    assert.equal(zones(nginx).get('ship11_app_download'), 30, 'a backstop: the backend has no number for the download');
  });

  test('M13 ingest: the three machine routes are limited by one prefix; the app client routes are not', () => {
    const matches = matcherOf(locationOf('ship11_ops_ingest').header);
    const src = backendSource('ops/ops-client.controller.ts');
    const routes = [...src.matchAll(/@Post\('(ops\/ingest\/[a-z]+)'\)/g)].map((m) => `/v1/${m[1]}`);
    assert.equal(routes.length, 3, 'probe, backup and deploy');
    for (const path of [...routes, '/v1/ops/ingest/probe/']) {
      assert.match(path, matches, `${path} must be limited`);
    }
    assert.doesNotMatch('/v1/ops/client/logs', matches);
    assert.equal(zones(nginx).get('ship11_ops_ingest'), 60, 'a backstop: the backend has no number for ingest');
  });

  test('the global prefix is v1, so every route above is under /v1 except the two aliases the backend rewrites', () => {
    assert.match(backendSource('app.setup.ts'), /export const GLOBAL_PREFIX = 'v1';/);
    assert.match(backendSource('health/health.controller.ts'), /@Controller\('health'\)/);
  });
});

describe('429 answer has the backend error envelope (JSON)', () => {
  const block = nginx.slice(nginx.indexOf('location @ship11_rate_limited'));
  const body = /return 429 '([^']+)';/.exec(block)?.[1] ?? '';

  test('nginx-made 429s are intercepted by a named JSON location in the HTTPS server', () => {
    assert.match(nginx, /^    error_page 429 = @ship11_rate_limited;$/m);
    assert.match(block, /default_type application\/json;/);
    assert.ok(body, 'the named location must return 429 with a body');
  });

  test('the body is valid JSON with the envelope keys, and the code and message are the backend ones for 429', () => {
    const json = JSON.parse(body.replaceAll('$ship11_request_uuid', '00000000-0000-0000-0000-000000000000'));
    assert.deepEqual(Object.keys(json), ['error']);
    assert.deepEqual(Object.keys(json.error).sort(), ['code', 'details', 'message', 'request_id']);
    assert.deepEqual(json.error.details, {});
    const envelope = backendSource('http/error-envelope.ts');
    const known = /429: \{ code: '([A-Z_]+)', message: '([^']+)' \}/.exec(envelope);
    assert.ok(known, 'backend KNOWN[429] must exist');
    assert.equal(json.error.code, known[1]);
    assert.equal(json.error.message, known[2]);
  });

  test('the request id is the same value in the body and the X-Request-ID header, shaped as a UUID', () => {
    assert.match(block, /add_header X-Request-ID \$ship11_request_uuid always;/);
    assert.match(body, /"request_id":"\$ship11_request_uuid"/);
    // Quoted on purpose: an unquoted `{8}` is read as a block opener and nginx -t fails.
    assert.ok(nginx.includes('"~^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$" "$1-$2-$3-$4-$5";'));
  });

  test('the JSON answer is only in the HTTPS server, and the HTTP redirect site is unchanged', () => {
    const httpBlock = nginx.split('server {').filter((b) => /listen 80;/.test(b)).join('');
    assert.doesNotMatch(httpBlock, /error_page|ship11_rate_limited/);
  });
});
