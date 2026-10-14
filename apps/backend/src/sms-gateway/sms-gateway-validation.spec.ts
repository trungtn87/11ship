import { describe, expect, it } from '@jest/globals';
import { parseAckBody, parseClaimBody, parseHeartbeatBody, parseJobId } from './sms-gateway-validation';

const ATTEMPT = '3f1c2b6a-0d4e-4f5a-8b9c-1a2b3c4d5e6f';

describe('gateway request validation', () => {
  it('accepts exactly the documented heartbeat and claim fields', () => {
    expect(parseHeartbeatBody({ app_version: '0.2.0', sms_permission: true, paused: false })).toEqual({ appVersion: '0.2.0', smsPermission: true, paused: false });
    expect(parseHeartbeatBody({})).toEqual({ appVersion: null, smsPermission: null, paused: null });
    expect(parseHeartbeatBody(undefined)).toEqual({ appVersion: null, smsPermission: null, paused: null });
    expect(parseClaimBody({ sms_permission: false })).toEqual({ smsPermission: false, paused: null });
  });

  it('refuses a recipient, a text or any other field, and wrong types', () => {
    for (const body of [{ to: '+84900000000' }, { text: 'x' }, { paused: 'yes' }, { app_version: 'bad version!' }, [], 'x', null]) {
      expect(() => parseHeartbeatBody(body)).toThrow();
    }
    expect(() => parseClaimBody({ to: '+84900000000', text: 'hello' })).toThrow();
  });

  it('parses an acknowledgement strictly', () => {
    expect(parseAckBody({ attempt_id: ATTEMPT, result: 'SENT' })).toEqual({ attemptId: ATTEMPT, result: 'SENT', errorCode: null });
    expect(parseAckBody({ attempt_id: ATTEMPT, result: 'FAILED', error_code: 'NO_SERVICE' })).toEqual({ attemptId: ATTEMPT, result: 'FAILED', errorCode: 'NO_SERVICE' });
    for (const body of [
      { result: 'SENT' },
      { attempt_id: 'nope', result: 'SENT' },
      { attempt_id: ATTEMPT, result: 'MAYBE' },
      { attempt_id: ATTEMPT, result: 'SENT', error_code: 'lowercase' },
      { attempt_id: ATTEMPT, result: 'SENT', text: '123456' },
      null,
    ]) {
      expect(() => parseAckBody(body)).toThrow();
    }
    expect(parseJobId(ATTEMPT)).toBe(ATTEMPT);
    expect(() => parseJobId('1')).toThrow();
  });
});
