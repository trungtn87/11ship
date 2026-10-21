import { describe, expect, it } from '@jest/globals';
import { AdminSessionService } from '../admin-auth/admin-session-service';
import { AdminAuthConfig } from '../config/admin-auth-config';
import { JsonLogger } from '../logging/json-logger';
import { AdminErrorLogsController } from './admin-error-logs.controller';

const requestId = '11111111-2222-4333-8444-555555555555';
const request = { headers: { cookie: 'test', origin: 'https://admin.example.test' }, requestId };
const config = { allowedOrigins: ['https://admin.example.test'] } as AdminAuthConfig;

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
    await expect(api.errors(request, { page: '0' })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
    await expect(api.errors(request, { made_up_key: '1' })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
    await expect(api.errors(request, { request_id: ['bad'] })).rejects.toMatchObject({ code: 'ADMIN_INPUT_INVALID' });
  });

  it('lets SYSTEM retrieve matching sanitized error and filter it by request ID', async () => {
    const api = controller('SYSTEM');
    const result = await api.errors(request, { request_id: requestId, app: 'SHIP', page: '1' });
    expect(result.data.total).toBe(1);
    expect(result.data.items[0]).toMatchObject({ request_id: requestId, code: 'INTERNAL_ERROR', app: 'SHIP', module: 'M04' });
    expect(JSON.stringify(result)).not.toContain('should-never-leak');
    const empty = await api.errors(request, { code: 'ROLE_NOT_AVAILABLE' });
    expect(empty.data.total).toBe(0);
  });
});
