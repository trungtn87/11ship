import { describe, expect, it } from '@jest/globals';
import { JsonLogger } from '../logging/json-logger';
import { SMS_SWEEP_LOG_EVERY, SmsQueueSweeper } from './sms-queue-sweeper';
import { SmsQueueService } from './sms-queue-service';

function build(sweep: () => Promise<{ closed: number }>) {
  const lines: string[] = [];
  const logger = new JsonLogger((line) => lines.push(line));
  const queue = { sweep } as unknown as SmsQueueService;
  return { sweeper: new SmsQueueSweeper(queue, logger), lines };
}

describe('SmsQueueSweeper diagnostics (review round 2)', () => {
  it('counts consecutive failures, logs the first and then once per SMS_SWEEP_LOG_EVERY, and never logs the error message', async () => {
    let fail = true;
    const { sweeper, lines } = build(async () => {
      if (fail) {
        throw Object.assign(new Error('relation app.sms_jobs for +84912345678 code 123456 password=secret'), { code: '57014' });
      }
      return { closed: 0 };
    });

    for (let i = 0; i < SMS_SWEEP_LOG_EVERY + 1; i += 1) {
      await sweeper.runOnce();
    }
    expect(sweeper.consecutiveFailures).toBe(SMS_SWEEP_LOG_EVERY + 1);
    // Logged: the first failure and the SMS_SWEEP_LOG_EVERY-th, nothing in between.
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(parsed.map((entry) => [entry.level, entry.event, entry.status])).toEqual([
      ['warn', 'sms_sweep_failed', 1],
      ['warn', 'sms_sweep_failed', SMS_SWEEP_LOG_EVERY],
    ]);
    expect(parsed[0]?.code).toBe('57014');
    const text = lines.join('\n');
    for (const secret of ['sms_jobs', '+84912345678', '123456', 'password', 'secret', 'relation']) {
      expect(text).not.toContain(secret);
    }

    fail = false;
    await sweeper.runOnce();
    expect(sweeper.consecutiveFailures).toBe(0);
    const recovered = JSON.parse(lines[2] as string) as Record<string, unknown>;
    expect([recovered.level, recovered.event, recovered.status]).toEqual(['info', 'sms_sweep_recovered', SMS_SWEEP_LOG_EVERY + 1]);
  });

  it('a healthy run logs nothing and runs one at a time', async () => {
    let running = 0;
    let peak = 0;
    const { sweeper, lines } = build(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return { closed: 0 };
    });
    await Promise.all([sweeper.runOnce(), sweeper.runOnce(), sweeper.runOnce()]);
    expect(peak).toBe(1);
    expect(lines).toEqual([]);
    expect(sweeper.consecutiveFailures).toBe(0);
  });
});
