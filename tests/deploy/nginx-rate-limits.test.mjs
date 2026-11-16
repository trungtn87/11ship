// Static checks of the nginx rate limits (P5-7d) against the template and the backend routes/constants they mirror.
// Nothing here starts nginx or touches a server. A real `nginx -t` and a request-level run were done separately, see the runbook.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative) => readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const nginx = read('ops/vinahost/nginx-11ship-staging.conf');
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

const PROXY_HEADERS = [
  /proxy_set_header Host \$host;/,
  /proxy_set_header X-Forwarded-For \$remote_addr;/,
  /proxy_set_header X-Real-IP \$remote_addr;/,
  /proxy_set_header Forwarded "";/,
];

describe('zones', () => {
  const rates = zones(nginx);

  test('the six zones exist, keyed on the socket address, with a fixed rate per minute', () => {
    assert.deepEqual([...rates.keys()].sort(), ['ship11_admin_login', 'ship11_client_login', 'ship11_deletion', 'ship11_otp_send', 'ship11_route_dist', 'ship11_tracking']);
    assert.equal(nginx.match(/^limit_req_zone /gm)?.length, 6);
  });

  test('every limit_req names a defined zone, with a burst and nodelay (over the burst is 429, never queued)', () => {
    const used = [...nginx.matchAll(/^\s+limit_req zone=(\w+) burst=(\d+) nodelay;$/gm)];
    assert.equal(used.length, 6, 'one limit_req per limited location');
    for (const [, zone, burst] of used) {
      assert.ok(rates.has(zone), `${zone} must be defined`);
      assert.ok(Number(burst) > 0);
    }
  });

  test('over-limit answers are 429, the status the backend uses for its own limits', () => {
    assert.match(nginx, /^    limit_req_status 429;$/m);
  });

  test('the zones are keyed on $remote_addr only, never on a header a client controls', () => {
    assert.doesNotMatch(nginx, /limit_req_zone [^;]*\$(http_|cookie_|request_header)/);
  });
});

describe('limited locations', () => {
  const limited = locations(nginx).filter((l) => /limit_req /.test(l.body));

  test('every limited location repeats the full proxy header set (a location-level proxy_set_header hides the inherited ones)', () => {
    assert.equal(limited.length, 6);
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
  const byHeader = (header) => locations(nginx).find((l) => l.header === header);

  test('tracking: the regex covers /v1/public/tracking/ and /v1/track/, and the rate is the backend PUBLIC_TRACKING_LIMIT (60/min)', () => {
    const loc = locations(nginx).find((l) => /limit_req zone=ship11_tracking /.test(l.body));
    assert.equal(loc.header, '~ ^/v1/(public/tracking|track)/');
    assert.match(backendSource('delivery/delivery-tracking-public.controller.ts'), /@Get\('public\/tracking\/:token'\)/);
    assert.match(backendSource('delivery/delivery-tracking-public.controller.ts'), /@Get\('track\/:token'\)/);
    assert.equal(zones(nginx).get('ship11_tracking'), Number(/PUBLIC_TRACKING_LIMIT = (\d+)/.exec(backendSource('delivery/public-tracking-rate-limiter.ts'))[1]));
  });

  test('route-distances: exact POST route, rate = ROUTE_DISTANCES_LIMIT_PER_MINUTE', () => {
    assert.ok(byHeader('= /v1/discovery/route-distances'));
    const src = backendSource('discovery-route/discovery-route.controller.ts');
    assert.match(src, /@Controller\('discovery'\)/);
    assert.match(src, /@Post\('route-distances'\)/);
    assert.equal(zones(nginx).get('ship11_route_dist'), Number(/ROUTE_DISTANCES_LIMIT_PER_MINUTE = (\d+)/.exec(src)[1]));
  });

  test('admin login: exact route, rate = LOGIN_REQUEST_LIMIT (per address per 60 s)', () => {
    assert.ok(byHeader('= /v1/admin-auth/login'));
    assert.match(backendSource('admin-auth/admin-auth.controller.ts'), /@Controller\('admin-auth'\)/);
    assert.match(backendSource('admin-auth/admin-auth.controller.ts'), /@Post\('login'\)/);
    assert.equal(zones(nginx).get('ship11_admin_login'), Number(/LOGIN_REQUEST_LIMIT = (\d+)/.exec(backendSource('admin-auth/admin-auth-constants.ts'))[1]));
  });

  test('client login: exact route; the backend limit is per PHONE (30/min), so the per-IP rate here is a new backstop, not a mirror', () => {
    assert.ok(byHeader('= /v1/client-auth/login'));
    assert.match(backendSource('client-auth/client-auth.controller.ts'), /@Controller\('client-auth'\)/);
    assert.match(backendSource('client-auth/client-auth.controller.ts'), /@Post\('login'\)/);
    assert.match(backendSource('client-auth/client-login-limiter.ts'), /30 attempts\/minute per normalized phone/);
  });

  test('OTP send: exactly the create routes, not the verify routes', () => {
    const otp = locations(nginx).find((l) => /zone=ship11_otp_send/.test(l.body));
    const re = new RegExp(otp.header.replace(/^~ /, ''));
    for (const path of ['/v1/auth/phone-verifications', '/v1/account-recovery/otp', '/v1/account-recovery/locked/otp', '/v1/admin-recovery/otp']) {
      assert.match(path, re, `${path} must be limited`);
    }
    for (const path of ['/v1/auth/phone-verifications/abc/verify', '/v1/account-recovery/otp/abc/verify', '/v1/auth/phone-verifications/abc']) {
      assert.doesNotMatch(path, re, `${path} must not be limited here`);
    }
    assert.match(backendSource('auth/auth.controller.ts'), /@Controller\('auth'\)[\s\S]*@Post\('phone-verifications'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Controller\('account-recovery'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Post\('otp'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Post\('locked\/otp'\)/);
    assert.match(backendSource('account-recovery/account-recovery.controller.ts'), /@Controller\('admin-recovery'\)[\s\S]*@Post\('otp'\)/);
  });

  test('account deletion: exact confirm route, rate ≈ ACCOUNT_DELETE_IP_LIMIT (20) per ACCOUNT_DELETE_IP_WINDOW_SECONDS (600 s) = 2/min', () => {
    assert.ok(byHeader('= /v1/account-deletion/confirm'));
    assert.match(backendSource('account-deletion/account-deletion.controller.ts'), /@Controller\('account-deletion'\)/);
    assert.match(backendSource('account-deletion/account-deletion.controller.ts'), /@Post\('confirm'\)/);
    const cfg = backendSource('config/account-deletion-config.ts');
    assert.match(cfg, /ip: Object\.freeze\(\{ limit: 20, windowSeconds: 600 \}\)/);
    assert.equal(zones(nginx).get('ship11_deletion'), 2);
  });

  test('the global prefix is v1, so every route above is under /v1 (the health path is /v1/health/ready in code; not yet confirmed on the VPS)', () => {
    assert.match(backendSource('app.setup.ts'), /export const GLOBAL_PREFIX = 'v1';/);
    assert.match(backendSource('health/health.controller.ts'), /@Controller\('health'\)/);
  });
});
