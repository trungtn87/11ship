import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { HttpAdapterHost } from '@nestjs/core';
import { ADMIN_AUTH_CONFIG } from '../admin-auth/admin-auth-config.provider';
import { AppError } from '../common/app-errors';
import { APP_LOGGER } from '../logging/logging.module';
import { AllExceptionsFilter } from '../http/all-exceptions.filter';
import { createRequestContextMiddleware } from '../http/request-context.middleware';
import { AdminSessionService } from '../admin-auth/admin-session-service';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { JsonLogger } from '../logging/json-logger';
import { AdminErrorLogsController } from './admin-error-logs.controller';

const requestId = '11111111-2222-4333-8444-555555555555';
const request = { headers: { cookie: 'test', origin: 'https://admin.example.test' }, requestId };
const config = { allowedOrigins: ['https://admin.example.test'] } as unknown as AdminAuthConfig;

function controller(role: 'SYSTEM' | 'ADMIN') {
  const logger = new JsonLogger(() => undefined);
  logger.log('error', 'request_failed', {
    request_id: requestId, status: 500, code: 'INTERNAL_ERROR',
    app: 'SHIP', module: 'M04', error_class: 'Error', password: 'should-never-leak',
  });
  const sessions = { me: async () => ({ adminRole: role }) } as unknown as AdminSessionService;
  return new AdminErrorLogsController(sessions, logger, config);
}

describe('M13 error log query access', () => {
  it('rejects ADMIN even with a live session and returns no events', async () => {
    await expect(controller('ADMIN').errors(request, {})).rejects.toMatchObject({ code: 'ADMIN_FORBIDDEN' });
  });

  it('requires a valid current session', async () => {
    const logger = new JsonLogger(() => undefined);
    const sessions = { me: async () => { throw new Error('invalid session'); } } as unknown as AdminSessionService;
    await expect(new AdminErrorLogsController(sessions, logger, config).errors(request, {})).rejects.toThrow('invalid session');
  });

  it('rejects untrusted Origin and malformed filters', async () => {
    const api = controller('SYSTEM');
    await expect(api.errors({ headers: { cookie: 'test', origin: 'https://evil.test' } }, {})).rejects.toMatchObject({ code: 'ADMIN_CSRF_INVALID' });
    await expect(api.errors(request, { level: 'fatal' })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
    await expect(api.errors(request, { module: '../secret' })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
    await expect(api.errors(request, { page: '0' })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
    await expect(api.errors(request, { made_up_key: '1' })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
    await expect(api.errors(request, { request_id: ['bad'] })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
  });

  it('lets SYSTEM retrieve matching sanitized error and filter it by request ID', async () => {
    const api = controller('SYSTEM');
    const result = await api.errors(request, { request_id: requestId, app: 'SHIP', level: 'error', module: 'M04', page: '1' });
    expect(result.data.total).toBe(1);
    expect(result.data.items[0]).toMatchObject({ request_id: requestId, code: 'INTERNAL_ERROR', app: 'SHIP', module: 'M04' });
    expect(JSON.stringify(result)).not.toContain('should-never-leak');
    const empty = await api.errors(request, { code: 'ROLE_NOT_AVAILABLE' });
    expect(empty.data.total).toBe(0);
  });
});


it('M13 HTTP transport: anonymous is 401, ADMIN is 403 and SYSTEM can correlate a safe recorded error', async () => {
  const logger = new JsonLogger(() => undefined);
  logger.log('error', 'request_failed', { request_id: requestId, status: 500, code: 'INTERNAL_ERROR',
    method: 'POST', app: 'SHIP', module: 'M04', route: '/v1/driver/wallet/topup-requests', password: 'SECRET_TRANSPORT' });
  const sessions = { me: async (token: string | undefined) => {
    if (token === 'S'.repeat(43)) return { adminRole: 'SYSTEM' };
    if (token === 'A'.repeat(43)) return { adminRole: 'ADMIN' };
    throw new AppError('ADMIN_SESSION_INVALID');
  } };
  const module = await Test.createTestingModule({ controllers: [AdminErrorLogsController], providers: [
    { provide: AdminSessionService, useValue: sessions }, { provide: APP_LOGGER, useValue: logger },
    { provide: ADMIN_AUTH_CONFIG, useValue: config },
  ] }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1');
  app.use(createRequestContextMiddleware(logger));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost), logger));
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl() + '/v1/admin/monitoring/errors?request_id=' + requestId;
    expect((await fetch(url)).status).toBe(401);
    const denied = await fetch(url, { headers: { cookie: '__Host-11admin=' + 'A'.repeat(43) } });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain('topup-requests');
    const allowed = await fetch(url, { headers: { cookie: '__Host-11admin=' + 'S'.repeat(43) } });
    expect(allowed.status).toBe(200);
    const text = await allowed.text();
    expect(text).toContain(requestId);
    expect(text).toContain('topup-requests');
    expect(text).not.toContain('SECRET_TRANSPORT');
  } finally { await app.close(); }
});
