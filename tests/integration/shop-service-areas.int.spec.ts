import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import {
  ApiResponse,
  AuthApp,
  countRows,
  dataOf,
  errorCode,
  obtainProof,
  PASSWORD,
  randomPhone,
  registerUser,
  setUserStatus,
  startAuthApp,
} from './support/auth-fixtures';

// M01 (11Food shop onboarding connection) — GET /v1/onboarding/shop/service-areas on the REAL Nest pipeline and a REAL
// PostgreSQL (TEST database only): the ACTIVE areas a client may pick for a shop draft. Only ACTIVE rows, ordered by name and
// then by identifier, exactly {service_area_id, name}, no-store, read-only (no audit, outbox or idempotency row), no query and
// no body, and the caller must be an ordinary enabled CUSTOMER with a valid CLIENT session.

const TERMS = 'test-terms-20261011-v1';
const PRIVACY = 'test-privacy-20261011-v1';
const WEB_FOOD = { device_id: 'web-food-areas-1', platform: 'WEB', app: 'FOOD' };

describe('M01 — shop onboarding service-area list', () => {
  let app: AuthApp;
  // Names made of upper-case letters and digits only, so the order does not depend on the database collation.
  const run = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

  beforeAll(async () => {
    app = await startAuthApp({}, { relaxTimeouts: true, configOverride: { clientAuth: { termsVersion: TERMS, privacyVersion: PRIVACY } } });
  });

  afterAll(async () => {
    await app.close();
  });

  /** A fixture area with a given name. Its ZT- code lets purgeTestServiceAreas remove it when the app closes. */
  async function area(name: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): Promise<string> {
    const id = randomUUID();
    await app.pool.query(
      `INSERT INTO app.service_areas (service_area_id, code, name, status, version, created_at, updated_at)
       VALUES ($1::uuid, $2, $3, $4, 1, clock_timestamp(), clock_timestamp())`,
      [id, `ZT-${id}`, name, status],
    );
    return id;
  }

  /** A real CUSTOMER created through the client registration, with a client session on 11Food. */
  async function customer(): Promise<{ userId: string; token: string }> {
    const phone = randomPhone();
    const proof = await obtainProof(app, phone);
    const response = await app.call('POST', '/client-auth/register', {
      headers: { 'idempotency-key': randomUUID() },
      body: {
        phone: phone.local,
        password: PASSWORD,
        verification_token: proof.proofToken,
        device: { ...WEB_FOOD },
        full_name: 'Nguyễn Văn An',
        consent: { terms_version: TERMS, privacy_version: PRIVACY },
      },
    });
    expect(response.status).toBe(201);
    const data = dataOf(response);
    return { userId: String(data.user_id), token: String(data.access_token) };
  }

  const list = (token: string | undefined): Promise<ApiResponse> =>
    app.call('GET', '/onboarding/shop/service-areas', token === undefined ? {} : { bearer: token });

  function ids(response: ApiResponse): string[] {
    return (response.body.data as unknown as Array<{ service_area_id: string }>).map((row) => row.service_area_id);
  }

  /** A GET that carries a body (fetch refuses to build one), to prove the route refuses it. */
  function getWithBody(token: string, body: string): Promise<{ status: number; code: string | undefined }> {
    const url = new URL(`${app.running.baseUrl}/v1/onboarding/shop/service-areas`);
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            let code: string | undefined;
            try {
              code = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { error?: { code?: string } }).error?.code;
            } catch {
              code = undefined;
            }
            resolve({ status: incoming.statusCode ?? 0, code });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(body);
    });
  }

  it('answers only the ACTIVE areas, by name, as exactly {service_area_id, name}, with no-store', async () => {
    const user = await customer();
    const second = await area(`ZT${run}B`);
    const first = await area(`ZT${run}A`);
    const inactive = await area(`ZT${run}C`, 'INACTIVE');

    const response = await list(user.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(response.body)).toEqual(['data']);
    const rows = response.body.data as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['name', 'service_area_id']);
    }
    const mine = ids(response).filter((id) => [first, second, inactive].includes(id));
    expect(mine).toEqual([first, second]);
    // Every row is ACTIVE in the database.
    expect(await countRows(app.pool, "SELECT 1 FROM app.service_areas WHERE service_area_id = ANY($1::uuid[]) AND status <> 'ACTIVE'", [ids(response)])).toBe(0);
  });

  it('orders areas that share a name by their identifier, the same way on every call', async () => {
    const user = await customer();
    const created = [await area(`ZT${run}D`), await area(`ZT${run}D`), await area(`ZT${run}D`)];
    const expected = [...created].sort();
    const first = ids(await list(user.token)).filter((id) => created.includes(id));
    const again = ids(await list(user.token)).filter((id) => created.includes(id));
    expect(first).toEqual(expected);
    expect(again).toEqual(expected);
  });

  it('is a read: no audit row, no outbox event and no idempotency record, and an Idempotency-Key is ignored', async () => {
    const user = await customer();
    await area(`ZT${run}E`);
    const counts = async (): Promise<number[]> => [
      await countRows(app.pool, 'SELECT 1 FROM app.audit_logs'),
      await countRows(app.pool, 'SELECT 1 FROM app.outbox_events'),
      await countRows(app.pool, 'SELECT 1 FROM app.idempotency_records'),
    ];
    const before = await counts();
    const plain = await list(user.token);
    const keyed = await app.call('GET', '/onboarding/shop/service-areas', { bearer: user.token, headers: { 'idempotency-key': randomUUID() } });
    expect([plain.status, keyed.status]).toEqual([200, 200]);
    expect(await counts()).toEqual(before);
  });

  it('needs a valid session: no token is SESSION_INVALID and a signed-out session is refused', async () => {
    const none = await list(undefined);
    expect([none.status, errorCode(none)]).toEqual([401, 'SESSION_INVALID']);
    const user = await customer();
    expect((await list(user.token)).status).toBe(200);
    const out = await app.call('POST', '/client-auth/logout', { bearer: user.token, body: {} });
    expect(out.status).toBe(204);
    const after = await list(user.token);
    expect(after.status).toBe(401);
    expect(errorCode(after)).toMatch(/^SESSION_(INVALID|REVOKED)$/);
  });

  it('a disabled account is ACCOUNT_DISABLED and sees no area', async () => {
    const user = await customer();
    await setUserStatus(app.pool, user.userId, 'DISABLED');
    const response = await list(user.token);
    expect([response.status, errorCode(response)]).toEqual([403, 'ACCOUNT_DISABLED']);
    expect(response.body.data).toBeUndefined();
  });

  it('an account without the CUSTOMER role is ROLE_NOT_AVAILABLE', async () => {
    // A legacy account: ordinary and verified, with no CUSTOMER role and no profile row.
    const legacy = await registerUser(app);
    const login = await app.call('POST', '/client-auth/login', {
      headers: { 'idempotency-key': randomUUID() },
      body: { phone: legacy.phone.local, password: legacy.password, device: { ...WEB_FOOD } },
    });
    expect(login.status).toBe(200);
    const response = await list(String(dataOf(login).access_token));
    expect([response.status, errorCode(response)]).toEqual([403, 'ROLE_NOT_AVAILABLE']);
  });

  it('refuses a query string and a body', async () => {
    const user = await customer();
    const withQuery = await app.call('GET', '/onboarding/shop/service-areas?status=INACTIVE', { bearer: user.token });
    expect([withQuery.status, errorCode(withQuery)]).toEqual([400, 'BAD_REQUEST']);
    const withBody = await getWithBody(user.token, '{"status":"INACTIVE"}');
    expect([withBody.status, withBody.code]).toEqual([400, 'BAD_REQUEST']);
    expect((await list(user.token)).status).toBe(200);
  });
});
