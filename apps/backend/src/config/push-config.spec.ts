import { describe, expect, it } from '@jest/globals';
import { parsePushConfig } from './push-config';

const parse = (env: Record<string, string | undefined>, appEnv = 'production') => parsePushConfig({ env, appEnv });
const OK = { PUSH_FCM_PROJECT_ID: 'eleven-ship-prod', PUSH_FCM_SERVICE_ACCOUNT_FILE: '/etc/11ship/fcm.json' };

describe('push (FCM) configuration', () => {
  it('is absent by default: push is then not configured, never faked', () => {
    expect(parse({})).toEqual({ ok: true, config: undefined });
    expect(parse({ PUSH_FCM_PROJECT_ID: '', PUSH_FCM_SERVICE_ACCOUNT_FILE: '' })).toEqual({ ok: true, config: undefined });
  });

  it('accepts a project id with an absolute credential path and defaults to the Google origin', () => {
    expect(parse(OK)).toEqual({ ok: true, config: { projectId: 'eleven-ship-prod', serviceAccountFile: '/etc/11ship/fcm.json', apiOrigin: 'https://fcm.googleapis.com' } });
  });

  it('refuses exactly one of the two, and a relative or traversing path, naming only the variable', () => {
    expect(parse({ PUSH_FCM_PROJECT_ID: 'eleven-ship-prod' })).toEqual({ ok: false, invalid: ['PUSH_FCM_SERVICE_ACCOUNT_FILE'] });
    expect(parse({ PUSH_FCM_SERVICE_ACCOUNT_FILE: '/etc/x.json' })).toEqual({ ok: false, invalid: ['PUSH_FCM_PROJECT_ID'] });
    expect(parse({ ...OK, PUSH_FCM_SERVICE_ACCOUNT_FILE: 'fcm.json' })).toEqual({ ok: false, invalid: ['PUSH_FCM_SERVICE_ACCOUNT_FILE'] });
    expect(parse({ ...OK, PUSH_FCM_SERVICE_ACCOUNT_FILE: '/etc/../x.json' })).toEqual({ ok: false, invalid: ['PUSH_FCM_SERVICE_ACCOUNT_FILE'] });
    expect(parse({ ...OK, PUSH_FCM_PROJECT_ID: 'Bad Id' })).toEqual({ ok: false, invalid: ['PUSH_FCM_PROJECT_ID'] });
  });

  it('only a loopback origin over http, and only in development / test', () => {
    expect(parse({ ...OK, PUSH_FCM_API_ORIGIN: 'http://127.0.0.1:9' }, 'production')).toEqual({ ok: false, invalid: ['PUSH_FCM_API_ORIGIN'] });
    expect(parse({ ...OK, PUSH_FCM_API_ORIGIN: 'http://127.0.0.1:9' }, 'test')).toMatchObject({ ok: true, config: { apiOrigin: 'http://127.0.0.1:9' } });
    expect(parse({ ...OK, PUSH_FCM_API_ORIGIN: 'https://fcm.example/path' })).toEqual({ ok: false, invalid: ['PUSH_FCM_API_ORIGIN'] });
  });
});
