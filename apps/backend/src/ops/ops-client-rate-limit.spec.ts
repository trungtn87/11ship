import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureApp } from '../app.setup';
import { APP_CONFIG } from '../config/app-config';
import { AppError } from '../common/app-errors';
import { JsonLogger } from '../logging/json-logger';
import { APP_LOGGER } from '../logging/logging.module';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { OpsClientController } from './ops-client.controller';
import { APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE, OPS_INGEST_LIMIT_PER_MINUTE } from './ops-client-rate-limits';
import { OpsIngestService } from './ops-ingest-service';
import { OtpClientIp } from '../auth/otp-client-ip';

/**
 * HTTP-level tests of the per-address backstop on the two routes that have no limit in the backend: GET /v1/app-updates/download/:id and
 * POST /v1/ops/ingest/* (probe, backup, deploy share one quota). The real controller and the real client-address rule run through the app
 * pipeline; the service is a stub that counts calls, so a refused request is proven to stop before any authentication or download.
 */

const DOWNLOAD_ID = '11111111-1111-4111-8111-111111111111';
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

interface Harness {
  app: INestApplication;
  origin: string;
  serviceCalls: { authenticate: number; openArtifact: number };
}

async function start(trustedProxyIps: readonly string[]): Promise<Harness> {
  const serviceCalls = { authenticate: 0, openArtifact: 0 };
  // Every allowed request reaches these stubs and fails there (401-class), so "reached the service" is observable and "429" is not.
  const service = {
    authenticate: async () => {
      serviceCalls.authenticate += 1;
      throw new AppError('SESSION_INVALID');
    },
    openArtifact: async () => {
      serviceCalls.openArtifact += 1;
      throw new AppError('SESSION_INVALID');
    },
  };
  const module = await Test.createTestingModule({
    controllers: [OpsClientController],
    providers: [
      { provide: OpsIngestService, useValue: service },
      { provide: APP_CONFIG, useValue: { adminAuth: { trustedProxyIps } } },
      { provide: OtpClientIp, useClass: OtpClientIp },
      { provide: APP_LOGGER, useValue: new JsonLogger(() => undefined) },
    ],
  })
    // The session guard only guards the /ops/client/* routes, which these tests do not call; the four routes under test have no guard.
    .overrideGuard(SessionAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, origin: await app.getUrl(), serviceCalls };
}

async function post(h: Harness, path: string, forwardedFor?: string): Promise<Response> {
  return fetch(`${h.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) },
    body: '{}',
  });
}

async function get(h: Harness, path: string, forwardedFor?: string): Promise<Response> {
  return fetch(`${h.origin}${path}`, { headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {} });
}

const DOWNLOAD = `/v1/app-updates/download/${DOWNLOAD_ID}`;
const INGEST_ROUTES = ['/v1/ops/ingest/probe', '/v1/ops/ingest/backup', '/v1/ops/ingest/deploy'];

describe('ops client route backstops (per client address)', () => {
  describe('limits', () => {
    it('the reference numbers match the nginx zones (ship11_app_download 30 r/min, ship11_ops_ingest 60 r/min)', () => {
      expect(APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE).toBe(30);
      expect(OPS_INGEST_LIMIT_PER_MINUTE).toBe(60);
    });
  });

  describe('trusted proxy (the production shape: nginx overwrites X-Forwarded-For with the one address it saw)', () => {
    let h: Harness;

    beforeAll(async () => {
      h = await start(LOOPBACK);
    });

    afterAll(async () => {
      await h?.app.close();
    });

    beforeEach(() => {
      h.serviceCalls.authenticate = 0;
      h.serviceCalls.openArtifact = 0;
    });

    it('download: serves the quota from one address, then refuses the next call with the standard 429 envelope before the service', async () => {
      const client = '203.0.113.10';
      for (let i = 0; i < APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE; i += 1) {
        expect((await get(h, DOWNLOAD, client)).status).not.toBe(429);
      }
      expect(h.serviceCalls.openArtifact).toBe(APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE);

      const refused = await get(h, DOWNLOAD, client);
      expect(refused.status).toBe(429);
      const body = (await refused.json()) as { error: { code: string; message: string; request_id: string } };
      expect(body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(body.error.message).toBe('Too many requests');
      expect(typeof body.error.request_id).toBe('string');
      expect(h.serviceCalls.openArtifact).toBe(APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE);
    });

    it('ingest: probe, backup and deploy share ONE quota of 60 per address; the 61st call on any of them is refused before authentication', async () => {
      const client = '203.0.113.20';
      for (let i = 0; i < OPS_INGEST_LIMIT_PER_MINUTE; i += 1) {
        const route = INGEST_ROUTES[i % INGEST_ROUTES.length];
        expect((await post(h, route, client)).status).not.toBe(429);
      }
      expect(h.serviceCalls.authenticate).toBe(OPS_INGEST_LIMIT_PER_MINUTE);

      for (const route of INGEST_ROUTES) {
        const refused = await post(h, route, client);
        expect(refused.status).toBe(429);
        expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('TOO_MANY_REQUESTS');
      }
      expect(h.serviceCalls.authenticate).toBe(OPS_INGEST_LIMIT_PER_MINUTE);
    });

    it('the two quotas are independent: an exhausted ingest quota does not refuse the download, and the reverse', async () => {
      const client = '203.0.113.30';
      for (let i = 0; i < OPS_INGEST_LIMIT_PER_MINUTE + 1; i += 1) {
        await post(h, INGEST_ROUTES[0], client);
      }
      expect((await post(h, INGEST_ROUTES[0], client)).status).toBe(429);
      expect((await get(h, DOWNLOAD, client)).status).not.toBe(429);
    });

    it('two clients behind the trusted proxy do not share a quota (identity is the forwarded client, not the proxy)', async () => {
      for (let i = 0; i < APP_UPDATE_DOWNLOAD_LIMIT_PER_MINUTE; i += 1) {
        await get(h, DOWNLOAD, '198.51.100.40');
      }
      expect((await get(h, DOWNLOAD, '198.51.100.40')).status).toBe(429);
      expect((await get(h, DOWNLOAD, '198.51.100.41')).status).not.toBe(429);
    });
  });

  describe('untrusted socket (no proxy listed): X-Forwarded-For cannot choose the identity', () => {
    let h: Harness;

    beforeAll(async () => {
      h = await start([]);
    });

    afterAll(async () => {
      await h?.app.close();
    });

    it('a forged X-Forwarded-For does not escape the quota of the socket', async () => {
      for (let i = 0; i < OPS_INGEST_LIMIT_PER_MINUTE; i += 1) {
        await post(h, INGEST_ROUTES[1], `203.0.113.${(i % 200) + 1}`);
      }
      expect((await post(h, INGEST_ROUTES[1], '203.0.113.250')).status).toBe(429);
    });
  });

  it('unlimited routes are untouched: /v1/app-updates/check is not refused by the download or ingest quota', async () => {
    const h = await start(LOOPBACK);
    try {
      for (let i = 0; i < OPS_INGEST_LIMIT_PER_MINUTE + 5; i += 1) {
        await post(h, INGEST_ROUTES[0], '203.0.113.200');
      }
      const check = await get(h, '/v1/app-updates/check?component=FOOD&version_code=1', '203.0.113.200');
      expect(check.status).not.toBe(429);
    } finally {
      await h.app.close();
    }
  });
});
