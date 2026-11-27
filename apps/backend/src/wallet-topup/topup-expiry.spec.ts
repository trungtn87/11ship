import { describe, expect, it, jest } from '@jest/globals';
import { TOPUP_EXPIRY_AFTER_MINUTES, TopupExpiryJob } from './topup-expiry';

function harness(rows: { requestId: string; version: number }[]) {
  const audit = jest.fn(async () => undefined);
  const outbox = jest.fn(async () => undefined);
  const expire = jest.fn(async () => rows);
  const ctx = {};
  const job = new TopupExpiryJob(
    { withTransaction: async (fn: (c: unknown) => unknown) => fn(ctx) } as never,
    { expireUnreported: expire } as never,
    { append: audit } as never,
    { append: outbox } as never,
  );
  return { job, audit, outbox, expire };
}

describe('TopupExpiryJob', () => {
  it('ends due requests after 24 hours with one audit line and one event each', async () => {
    const h = harness([{ requestId: 'a', version: 2 }, { requestId: 'b', version: 3 }]);
    expect(await h.job.runOnce()).toBe(2);
    expect(h.expire).toHaveBeenCalledWith(expect.anything(), TOPUP_EXPIRY_AFTER_MINUTES, 200);
    expect(TOPUP_EXPIRY_AFTER_MINUTES).toBe(1440);
    expect(h.audit).toHaveBeenCalledTimes(2);
    expect(h.outbox).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when nothing is due', async () => {
    const h = harness([]);
    expect(await h.job.runOnce()).toBe(0);
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.outbox).not.toHaveBeenCalled();
  });
});
