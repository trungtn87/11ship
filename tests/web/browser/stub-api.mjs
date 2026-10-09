// A CONTRACT STUB of the Auth + onboarding API, for browser checks of the client ONLY. It follows the controllers and
// error registry of apps/backend/src (envelope shape, status codes, strict keys, idempotency replay, role rules) but it
// is NOT the backend: a pass against it proves the client behaves per contract, never that the real API works. It holds
// no real credential: accounts are created by the caller at run time with throw-away passwords.
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

const PHONE = /^(?:\+84|84|0)([0-9]{9})$/;
const DEVICE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const DEVICE_TOKEN = /^[A-Z0-9_]{1,32}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEFINITIONS = {
  INVALID_PHONE: 400, BAD_REQUEST: 400, INVALID_CREDENTIALS: 401, ACCOUNT_DISABLED: 403, ROLE_NOT_AVAILABLE: 403,
  SESSION_INVALID: 401, SESSION_REVOKED: 401, SESSION_EXPIRED: 401, IDEMPOTENCY_KEY_REQUIRED: 400, INVALID_IDEMPOTENCY_KEY: 400,
  IDEMPOTENCY_KEY_REUSED: 409, SHOP_ONBOARDING_EXISTS: 409, SHOP_PROFILE_INCOMPLETE: 409, INVALID_SERVICE_AREA: 400,
  VERSION_CONFLICT: 409, DRIVER_PROFILE_EXISTS: 409, TRANSACTION_OUTCOME_UNKNOWN: 503, SERVICE_UNAVAILABLE: 503, NOT_FOUND: 404,
};

class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function exactKeys(body, keys) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('BAD_REQUEST');
  const actual = Object.keys(body);
  if (actual.length !== keys.length || !actual.every((k) => keys.includes(k))) throw new ApiError('BAD_REQUEST');
  return body;
}

function onlyKeys(body, required, optional) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('BAD_REQUEST');
  const allowed = new Set([...required, ...optional]);
  if (!Object.keys(body).every((k) => allowed.has(k))) throw new ApiError('BAD_REQUEST');
  if (!required.every((k) => Object.hasOwn(body, k))) throw new ApiError('BAD_REQUEST');
  return body;
}

export function createStubApi() {
  const users = new Map(); // phone -> user
  const sessions = new Map(); // token -> session
  const areas = new Map(); // id -> status
  const idempotency = new Map(); // `${userId}|${op}|${key}` -> { fingerprint, status, payload }
  const calls = []; // every API call, for assertions: { method, path, key, body, auth }
  const faults = { dropAfterCommit: new Set(), failBefore: new Set(), delayMs: new Map() };

  const state = {
    calls,
    faults,
    addArea(status = 'ACTIVE') {
      const id = randomUUID();
      areas.set(id, status);
      return id;
    },
    addUser({ phone, password, status = 'ACTIVE' }) {
      const user = { id: randomUUID(), phone: `+84${PHONE.exec(phone)[1]}`, password, status, roles: new Set(), shop: null, driver: null, origin: 'STAGING_FIXTURE' };
      users.set(user.phone, user);
      return user;
    },
    user: (phone) => users.get(`+84${PHONE.exec(phone)[1]}`),
    sessionsOf: (user) => [...sessions.values()].filter((s) => s.userId === user.id),
    tokensOf: (user) => [...sessions].filter(([, s]) => s.userId === user.id).map(([token]) => token),
    expire(token) {
      sessions.get(token).expired = true;
    },
    disable(user) {
      user.status = 'DISABLED';
    },
    count(method, path) {
      return calls.filter((c) => c.method === method && c.path === path).length;
    },
    login(phone) {
      const user = users.get(`+84${PHONE.exec(phone)[1]}`);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { userId: user.id, activeRole: null, revoked: false, expired: false });
      return token;
    },
    selectRoleDirect(token, role) {
      const s = sessions.get(token);
      const user = [...users.values()].find((u) => u.id === s.userId);
      selectRole(user, token, role);
    },
  };

  function availableRoles(user) {
    return ['DRIVER', 'SHOP'].filter((role) => {
      if (!user.roles.has(role)) return false;
      if (role === 'SHOP') return user.shop !== null && user.shop.status === 'ACTIVE';
      return user.driver !== null && user.driver.status !== 'CLOSED';
    });
  }

  function roleContext(user, activeRole) {
    const roles = availableRoles(user);
    const shopState = user.shop === null ? 'NOT_STARTED' : user.shop.status === 'INCOMPLETE' ? 'INCOMPLETE' : 'COMPLETED';
    const driverState = user.driver === null ? 'NOT_STARTED' : user.driver.status === 'PENDING' ? 'PENDING_APPROVAL' : user.driver.status;
    const effective = activeRole !== null && roles.includes(activeRole) ? activeRole : null;
    return {
      available_roles: roles,
      active_role: effective,
      onboarding_required: roles.length === 0 && shopState !== 'COMPLETED' && driverState === 'NOT_STARTED',
      role_selection_required: roles.length > 0 && effective === null,
      shopState,
      driverState,
    };
  }

  function authenticate(req) {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header) : null;
    const session = match ? sessions.get(match[1]) : undefined;
    if (!session) throw new ApiError('SESSION_INVALID');
    if (session.revoked) throw new ApiError('SESSION_REVOKED');
    if (session.expired) throw new ApiError('SESSION_EXPIRED');
    const user = [...users.values()].find((u) => u.id === session.userId);
    if (user.status !== 'ACTIVE') throw new ApiError('ACCOUNT_DISABLED');
    return { session, user, token: match[1] };
  }

  function selectRole(user, token, role) {
    if (role !== 'SHOP' && role !== 'DRIVER') throw new ApiError('ROLE_NOT_AVAILABLE');
    if (!availableRoles(user).includes(role)) throw new ApiError('ROLE_NOT_AVAILABLE');
    if (role === 'SHOP') {
      for (const [other, s] of sessions) {
        if (other !== token && s.userId === user.id && s.activeRole === 'SHOP' && !s.revoked) s.revoked = true;
      }
    }
    sessions.get(token).activeRole = role;
  }

  function idempotent(user, op, req, body, run) {
    const raw = req.headers['idempotency-key'];
    if (raw === undefined) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
    if (typeof raw !== 'string' || !UUID.test(raw) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(raw)) throw new ApiError('INVALID_IDEMPOTENCY_KEY');
    const slot = `${user.id}|${op}|${raw.toLowerCase()}`;
    const fingerprint = canonical(body);
    const stored = idempotency.get(slot);
    if (stored) {
      if (stored.fingerprint !== fingerprint) throw new ApiError('IDEMPOTENCY_KEY_REUSED');
      return { status: stored.status, payload: stored.payload, replayed: true };
    }
    const outcome = run();
    idempotency.set(slot, { fingerprint, status: outcome.status, payload: outcome.payload });
    return { ...outcome, replayed: false };
  }

  function route(req, body, url) {
    const key = `${req.method} ${url}`;
    if (key === 'POST /v1/auth/login') {
      const input = exactKeys(body, ['phone', 'password', 'device']);
      const device = exactKeys(input.device, ['device_id', 'platform', 'app']);
      if (typeof device.device_id !== 'string' || !DEVICE_ID.test(device.device_id) || !DEVICE_TOKEN.test(device.platform) || !DEVICE_TOKEN.test(device.app)) throw new ApiError('BAD_REQUEST');
      if (typeof input.password !== 'string' || input.password.length > 1024) throw new ApiError('BAD_REQUEST');
      const match = typeof input.phone === 'string' ? PHONE.exec(input.phone.trim()) : null;
      if (!match) throw new ApiError('INVALID_PHONE');
      const user = users.get(`+84${match[1]}`);
      if (!user || user.password !== input.password) throw new ApiError('INVALID_CREDENTIALS');
      if (user.status !== 'ACTIVE') throw new ApiError('ACCOUNT_DISABLED');
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { userId: user.id, activeRole: null, revoked: false, expired: false });
      const ctx = roleContext(user, null);
      return { status: 200, data: { user_id: user.id, available_roles: ctx.available_roles, active_role: null, onboarding_required: ctx.onboarding_required, role_selection_required: ctx.role_selection_required, phone_verification_status: 'UNVERIFIED_TEST', access_token: token } };
    }
    if (key === 'GET /v1/auth/me') {
      const { session, user } = authenticate(req);
      const ctx = roleContext(user, session.activeRole);
      return { status: 200, data: { user_id: user.id, phone_normalized: user.phone, available_roles: ctx.available_roles, active_role: ctx.active_role, onboarding_required: ctx.onboarding_required, role_selection_required: ctx.role_selection_required, onboarding: { shop: ctx.shopState, driver: ctx.driverState }, phone_verification_status: 'UNVERIFIED_TEST' } };
    }
    if (key === 'POST /v1/auth/role/select') {
      const { user, token } = authenticate(req);
      const input = exactKeys(body, ['role']);
      if (typeof input.role !== 'string' || input.role.length < 1 || input.role.length > 64) throw new ApiError('BAD_REQUEST');
      selectRole(user, token, input.role);
      const ctx = roleContext(user, input.role);
      return { status: 200, data: { user_id: user.id, phone_normalized: user.phone, available_roles: ctx.available_roles, active_role: ctx.active_role, onboarding_required: ctx.onboarding_required, role_selection_required: ctx.role_selection_required } };
    }
    if (key === 'GET /v1/onboarding/shop/profile') {
      const { user } = authenticate(req);
      return { status: 200, data: user.shop === null ? null : { ...user.shop } };
    }
    if (key === 'PUT /v1/onboarding/shop/profile') {
      const { user } = authenticate(req);
      const input = onlyKeys(body, ['name', 'contact_phone', 'address_text'], ['zalo', 'facebook', 'pickup_lat', 'pickup_lng', 'service_area_id', 'expected_version']);
      const outcome = idempotent(user, 'onboarding.shop.profile.save.v1', req, input, () => {
        if (!PHONE.test(input.contact_phone)) throw new ApiError('INVALID_PHONE');
        const lat = input.pickup_lat ?? null;
        const lng = input.pickup_lng ?? null;
        if ((lat === null) !== (lng === null)) throw new ApiError('BAD_REQUEST');
        const area = input.service_area_id ?? null;
        if (area !== null && (!CANONICAL_UUID.test(area))) throw new ApiError('BAD_REQUEST');
        const expected = input.expected_version ?? null;
        if (expected === null && user.shop !== null) throw new ApiError('SHOP_ONBOARDING_EXISTS');
        if (expected !== null) {
          if (user.shop === null) throw new ApiError('VERSION_CONFLICT');
          if (user.shop.status !== 'INCOMPLETE') throw new ApiError('SHOP_ONBOARDING_EXISTS');
          if (user.shop.version !== expected) throw new ApiError('VERSION_CONFLICT');
        }
        if (area !== null && areas.get(area) !== 'ACTIVE') throw new ApiError('INVALID_SERVICE_AREA');
        const created = user.shop === null;
        user.shop = { shop_id: user.shop?.shop_id ?? randomUUID(), name: input.name, contact_phone: `+84${PHONE.exec(input.contact_phone)[1]}`, zalo: input.zalo ?? null, facebook: input.facebook ?? null, address_text: input.address_text, pickup_lat: lat, pickup_lng: lng, service_area_id: area, status: 'INCOMPLETE', accepting_orders: false, version: created ? 1 : user.shop.version + 1 };
        return { status: created ? 201 : 200, payload: { shop_id: user.shop.shop_id, status: 'INCOMPLETE', version: user.shop.version, role_granted: false } };
      });
      return { status: outcome.status, data: outcome.payload, afterCommit: true };
    }
    if (key === 'POST /v1/onboarding/shop/complete') {
      const { user } = authenticate(req);
      const input = exactKeys(body, ['expected_version']);
      const outcome = idempotent(user, 'onboarding.shop.complete.v1', req, input, () => {
        const shop = user.shop;
        if (shop === null) throw new ApiError('SHOP_PROFILE_INCOMPLETE');
        if (shop.status !== 'INCOMPLETE') throw new ApiError('SHOP_ONBOARDING_EXISTS');
        if (shop.version !== input.expected_version) throw new ApiError('VERSION_CONFLICT');
        if (shop.pickup_lat === null || shop.pickup_lng === null || shop.service_area_id === null) throw new ApiError('SHOP_PROFILE_INCOMPLETE');
        if (areas.get(shop.service_area_id) !== 'ACTIVE') throw new ApiError('INVALID_SERVICE_AREA');
        shop.status = 'ACTIVE';
        shop.version += 1;
        user.roles.add('SHOP');
        return { status: 200, payload: { shop_id: shop.shop_id, status: 'ACTIVE', accepting_orders: false, role_granted: true, version: shop.version } };
      });
      return { status: outcome.status, data: outcome.payload, afterCommit: true };
    }
    if (key === 'POST /v1/onboarding/driver') {
      const { user } = authenticate(req);
      const input = onlyKeys(body, ['full_name'], ['plate_number']);
      const outcome = idempotent(user, 'onboarding.driver.create.v1', req, input, () => {
        if (user.driver !== null) throw new ApiError('DRIVER_PROFILE_EXISTS');
        user.driver = { driver_id: randomUUID(), full_name: input.full_name, plate_number: input.plate_number ?? null, status: 'PENDING' };
        user.roles.add('DRIVER');
        return { status: 201, payload: { driver_id: user.driver.driver_id, driver_type: 'EXTERNAL', status: 'PENDING', accepting_deliveries: false, role_granted: true, version: 1 } };
      });
      return { status: outcome.status, data: outcome.payload, afterCommit: true };
    }
    throw new ApiError('NOT_FOUND');
  }

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const requestId = randomUUID();
      const url = req.url.split('?')[0];
      let body;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = Symbol.for('bad-json');
      }
      const faultKey = `${req.method} ${url}`;
      calls.push({ method: req.method, path: url.replace(/^\/v1/, ''), key: req.headers['idempotency-key'] ?? null, body, hasAuth: Boolean(req.headers.authorization), query: req.url.includes('?') });
      const delay = faults.delayMs.get(faultKey);
      if (delay) {
        faults.delayMs.delete(faultKey);
        await new Promise((r) => setTimeout(r, delay));
      }
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-ID': requestId });
        res.end(JSON.stringify(payload));
      };
      try {
        if (faults.failBefore.has(faultKey)) {
          faults.failBefore.delete(faultKey);
          throw new ApiError('TRANSACTION_OUTCOME_UNKNOWN');
        }
        if (body === Symbol.for('bad-json')) throw new ApiError('BAD_REQUEST');
        const result = route(req, body, url);
        if (faults.dropAfterCommit.has(faultKey) && result.afterCommit) {
          faults.dropAfterCommit.delete(faultKey);
          req.socket.destroy(); // committed, but the answer never arrives
          return;
        }
        send(result.status, { data: result.data });
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
        send(DEFINITIONS[code] ?? 500, { error: { code, message: 'English text that the client must not show', request_id: requestId, details: {} } });
      }
    });
  });

  return {
    state,
    server,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
