import { describe, expect, it } from '@jest/globals';
import { parseAckBody, parseClaimBody, parseHeartbeatBody, parseJobId } from './sms-gateway-validation';

const ATTEMPT = '3f1c2b6a-0d4e-4f5a-8b9c-1a2b3c4d5e6f';

describe('gateway request validation', () => {
  it('accepts exactly the documented heartbeat and claim fields', () => {
    const none = { batteryPercent: null, charging: null, simState: null, pendingReports: null, currentTask: null, lastErrorCode: null };
    expect(parseHeartbeatBody({ app_version: '0.2.0', sms_permission: true, paused: false })).toEqual({ appVersion: '0.2.0', appVersionCode: null, smsPermission: true, paused: false, telemetry: none });
    expect(parseHeartbeatBody({})).toEqual({ appVersion: null, appVersionCode: null, smsPermission: null, paused: null, telemetry: none });
    expect(parseHeartbeatBody(undefined)).toEqual({ appVersion: null, appVersionCode: null, smsPermission: null, paused: null, telemetry: none });
    // M13: what the phone says about itself (every field optional, bounded, a fixed vocabulary).
    expect(parseHeartbeatBody({ battery_percent: 18, charging: false, sim_state: 'READY', pending_reports: 0, current_task: 'IDLE', last_error_code: 'NO_SERVICE', app_version_code: 12 })).toMatchObject({
      appVersionCode: 12,
      telemetry: { batteryPercent: 18, charging: false, simState: 'READY', pendingReports: 0, currentTask: 'IDLE', lastErrorCode: 'NO_SERVICE' },
    });
    expect(parseClaimBody({ sms_permission: false })).toEqual({ smsPermission: false, paused: null });
  });

  it('refuses a recipient, a text or any other field, and wrong types', () => {
    for (const body of [{ to: '+84900000000' }, { text: 'x' }, { paused: 'yes' }, { app_version: 'bad version!' }, { battery_percent: 101 }, { battery_percent: 1.5 }, { charging: 'yes' }, { sim_state: 'RICH' }, { current_task: 'FLYING' }, { last_error_code: 'lower' }, { sim_balance: 100000 }, [], 'x', null]) {
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
