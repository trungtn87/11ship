import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { backoffDelayMs } from '../../apps/backend/src/outbox/outbox-backoff';
import { FakeOutboxPublisher } from '../../apps/backend/src/outbox/fake-outbox-publisher.fixture';
import { captureLogs, dbClockMs } from './support/audit-outbox-fixtures';
import {
  ageLease,
  createDispatchHarness,
  DispatchHarness,
  envelopeOf,
  first,
  forcePendingAttempts,
  forceProcessing,
  leaseOf,
  makeDue,
  only,
  rowOf,
  seedEvents,
  SECRET_MARKER,
  statusCounts,
  wholeOutboxText,
} from './support/outbox-dispatch-fixtures';

// M00-C1C — C14: publish failure, timeout, exact exponential backoff, DEAD after the last attempt, and no raw
// error text in the database or the logs. Real PostgreSQL; the backoff and every timestamp come from its clock.
describe('M00-C1C C14 — outbox retry, backoff and DEAD', () => {
  let h: DispatchHarness;

  beforeAll(async () => {
    h = await createDispatchHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await h.reset();
  });

  describe('publish failure', () => {
    it('a failing publisher: attempt recorded, PENDING again, available_at = DB time + base backoff, lease cleared, fixed error code', async () => {
      const [id] = await seedEvents(h, 1);
      const envelope = await envelopeOf(h, id as string);
      const publisher = new FakeOutboxPublisher('reject');
      const dispatcher = h.dispatcher({ publisher, config: { backoffBaseMs: 1000, backoffCapMs: 60_000 } });

      const before = await dbClockMs(h.pool);
      const summary = await dispatcher.dispatchOnce();
      const after = await dbClockMs(h.pool);

      expect(summary.retryScheduled).toBe(1);
      expect(summary.published).toBe(0);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PENDING');
      expect(row.attempt_count).toBe(1);
      expect(row.last_error_code).toBe('PUBLISH_FAILED');
      expect(row.locked_at).toBeNull();
      expect(row.lock_token).toBeNull();
      expect(row.published_at).toBeNull();
      const availableAt = (row.available_at as Date).getTime();
      expect(availableAt).toBeGreaterThanOrEqual(before + 1000 - 1);
      expect(availableAt).toBeLessThanOrEqual(after + 1000 + 1);
      expect(await envelopeOf(h, id as string)).toBe(envelope);
    });

    it('is not claimed again until the backoff has passed (by DB time), then is retried with the SAME event id', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('reject');
      // A long backoff keeps the row not-due for the whole test, however slow the machine is.
      const dispatcher = h.dispatcher({ publisher, config: { backoffBaseMs: 200_000, backoffCapMs: 300_000 } });

      expect((await dispatcher.dispatchOnce()).retryScheduled).toBe(1);
      const waiting = await dispatcher.dispatchOnce();
      expect(waiting.claimed).toBe(0);
      expect(publisher.calls).toHaveLength(1);

      await makeDue(h, id as string); // the DB clock now says it is due
      const retry = await dispatcher.dispatchOnce();
      expect(retry.claimed).toBe(1);
      expect(publisher.calls).toHaveLength(2);
      expect(publisher.eventIds).toEqual([id, id]);
      expect(publisher.calls.map((call) => call.event.attemptCount)).toEqual([1, 2]);
      expect((await rowOf(h, id as string)).attempt_count).toBe(2);
    });

    it('then succeeds on a later attempt: PUBLISHED with the attempts it took, error code left as the last failure', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('reject');
      const dispatcher = h.dispatcher({ publisher });
      await dispatcher.dispatchOnce();
      await makeDue(h, id as string);
      publisher.mode = 'resolve';
      const summary = await dispatcher.dispatchOnce();

      expect(summary.published).toBe(1);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PUBLISHED');
      expect(row.attempt_count).toBe(2);
      expect(row.published_at).not.toBeNull();
      expect(row.lock_token).toBeNull();
      expect(row.last_error_code).toBe('PUBLISH_FAILED'); // history of the last failure, not an error now
    });
  });

  describe('exact exponential backoff', () => {
    it('min(cap, base * 2^(attempt_count - 1)): 1000, 2000, 4000, then capped at 4000', async () => {
      const [id] = await seedEvents(h, 1);
      const store = h.store({ maxAttempts: 8, backoffBaseMs: 1000, backoffCapMs: 4000 });
      const expected = [1000, 2000, 4000, 4000, 4000];

      for (let attempt = 1; attempt <= expected.length; attempt += 1) {
        const claimed = only((await store.claim(1)).events);
        expect(claimed.attemptCount).toBe(attempt);
        const before = await dbClockMs(h.pool);
        expect(await store.fail(leaseOf(claimed), 'PUBLISH_FAILED')).toBe('RETRY_SCHEDULED');
        const after = await dbClockMs(h.pool);

        const delay = expected[attempt - 1] as number;
        expect(delay).toBe(backoffDelayMs(attempt, 1000, 4000));
        const availableAt = ((await rowOf(h, id as string)).available_at as Date).getTime();
        expect(availableAt).toBeGreaterThanOrEqual(before + delay - 1);
        expect(availableAt).toBeLessThanOrEqual(after + delay + 1);
        await makeDue(h, id as string);
      }
    });

    it('uses the default 1 s base and 60 s cap exactly', async () => {
      const [id] = await seedEvents(h, 1);
      const store = h.store({ maxAttempts: 20 });
      const expected = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000];
      for (let attempt = 1; attempt <= expected.length; attempt += 1) {
        const claimed = only((await store.claim(1)).events);
        const before = await dbClockMs(h.pool);
        await store.fail(leaseOf(claimed), 'PUBLISH_FAILED');
        const after = await dbClockMs(h.pool);
        const delay = expected[attempt - 1] as number;
        const availableAt = ((await rowOf(h, id as string)).available_at as Date).getTime();
        expect(availableAt).toBeGreaterThanOrEqual(before + delay - 1);
        expect(availableAt).toBeLessThanOrEqual(after + delay + 1);
        await makeDue(h, id as string);
      }
    });

    it('has no jitter: two events failing on the same attempt get the same delay (within the DB clock window)', async () => {
      const ids = await seedEvents(h, 2);
      const store = h.store();
      const claimed = (await store.claim(2)).events;
      const before = await dbClockMs(h.pool);
      await Promise.all(claimed.map((event) => store.fail(leaseOf(event), 'PUBLISH_FAILED')));
      const after = await dbClockMs(h.pool);
      for (const id of ids) {
        const availableAt = ((await rowOf(h, id)).available_at as Date).getTime();
        expect(availableAt).toBeGreaterThanOrEqual(before + 1000 - 1);
        expect(availableAt).toBeLessThanOrEqual(after + 1000 + 1);
      }
    });
  });

  describe('timeout', () => {
    it('a publisher that never answers: PUBLISH_TIMEOUT, retry scheduled, signal aborted; its late result changes nothing', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('manual'); // ignores the AbortSignal
      const dispatcher = h.dispatcher({ publisher, config: { publishTimeoutMs: 150 } });

      const before = await dbClockMs(h.pool);
      const summary = await dispatcher.dispatchOnce();
      const after = await dbClockMs(h.pool);

      expect(summary.timedOut).toBe(1);
      expect(summary.retryScheduled).toBe(1);
      const call = first(publisher.calls);
      expect(call.signal.aborted).toBe(true);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('PENDING');
      expect(row.attempt_count).toBe(1);
      expect(row.last_error_code).toBe('PUBLISH_TIMEOUT');
      expect(row.lock_token).toBeNull();
      const availableAt = (row.available_at as Date).getTime();
      expect(availableAt).toBeGreaterThanOrEqual(before + 1000 - 1);
      expect(availableAt).toBeLessThanOrEqual(after + 1000 + 1);

      // The publisher finally succeeds: the database must not move (no second ack/fail).
      call.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(await rowOf(h, id as string)).toEqual(row);
    });

    it('a late REJECTION after the timeout does not fail the attempt a second time', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('manual');
      const dispatcher = h.dispatcher({ publisher, config: { publishTimeoutMs: 150 } });
      await dispatcher.dispatchOnce();
      const row = await rowOf(h, id as string);

      first(publisher.calls).reject(new Error(SECRET_MARKER));
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(await rowOf(h, id as string)).toEqual(row);
      expect(row.last_error_code).toBe('PUBLISH_TIMEOUT');
    });

    it('timeout on the last attempt ends DEAD', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('manual');
      const dispatcher = h.dispatcher({ publisher, config: { publishTimeoutMs: 120, maxAttempts: 1 } });
      const summary = await dispatcher.dispatchOnce();
      expect(summary.timedOut).toBe(1);
      expect(summary.deadAfterFailure).toBe(1);
      const row = await rowOf(h, id as string);
      expect(row.status).toBe('DEAD');
      expect(row.last_error_code).toBe('PUBLISH_TIMEOUT');
      expect(row.lock_token).toBeNull();
      publisher.releaseAll();
    });
  });

  describe('DEAD', () => {
    it('the last allowed attempt that fails ends DEAD: lease cleared, event and payload kept, never claimed again', async () => {
      const [id] = await seedEvents(h, 1);
      const envelope = await envelopeOf(h, id as string);
      const publisher = new FakeOutboxPublisher('reject');
      const dispatcher = h.dispatcher({ publisher, config: { maxAttempts: 3 } });

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const summary = await dispatcher.dispatchOnce();
        expect(summary.claimed).toBe(1);
        const row = await rowOf(h, id as string);
        expect(row.attempt_count).toBe(attempt);
        if (attempt < 3) {
          expect(row.status).toBe('PENDING');
          expect(summary.retryScheduled).toBe(1);
          await makeDue(h, id as string);
        } else {
          expect(row.status).toBe('DEAD');
          expect(summary.deadAfterFailure).toBe(1);
        }
      }

      const dead = await rowOf(h, id as string);
      expect(dead.status).toBe('DEAD');
      expect(dead.attempt_count).toBe(3);
      expect(dead.last_error_code).toBe('PUBLISH_FAILED');
      expect(dead.locked_at).toBeNull();
      expect(dead.lock_token).toBeNull();
      expect(dead.published_at).toBeNull();
      expect(await envelopeOf(h, id as string)).toBe(envelope);

      // DEAD is final in C1C: nothing claims or resets it.
      const calls = publisher.calls.length;
      expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
      expect((await dispatcher.dispatchOnce()).claimed).toBe(0);
      expect(publisher.calls).toHaveLength(calls);
      expect(publisher.eventIds).toEqual([id, id, id]);
      expect(await statusCounts(h)).toEqual({ DEAD: 1 });
    });

    it('a due PENDING event that already used all its attempts is turned DEAD at claim, never published', async () => {
      const [exhausted, healthy, notDue] = await seedEvents(h, 3);
      await forcePendingAttempts(h, exhausted as string, 5);
      await forcePendingAttempts(h, notDue as string, 5);
      await h.pool.query("UPDATE app.outbox_events SET available_at = occurred_at + interval '1 hour' WHERE event_id = $1", [
        notDue,
      ]);
      const publisher = new FakeOutboxPublisher('resolve');
      const summary = await h.dispatcher({ publisher, config: { maxAttempts: 5 } }).dispatchOnce();

      expect(summary.deadMarked).toBe(1);
      expect(summary.claimed).toBe(1);
      expect(publisher.eventIds).toEqual([healthy]);
      const dead = await rowOf(h, exhausted as string);
      expect(dead.status).toBe('DEAD');
      expect(dead.attempt_count).toBe(5);
      expect(dead.lock_token).toBeNull();
      expect(dead.locked_at).toBeNull();
      expect(dead.payload).toEqual({ n: 0, note: 'safe-payload' });
      // Not due yet: left alone even though it is exhausted (it is judged when it becomes due).
      expect((await rowOf(h, notDue as string)).status).toBe('PENDING');
    });

    it('a STALE PROCESSING event that already used all its attempts is turned DEAD at claim, never published again', async () => {
      const [id] = await seedEvents(h, 1);
      await forceProcessing(h, id as string, 5);
      await ageLease(h, id as string);
      const publisher = new FakeOutboxPublisher('resolve');
      const summary = await h.dispatcher({ publisher, config: { maxAttempts: 5 } }).dispatchOnce();

      expect(summary.deadMarked).toBe(1);
      expect(summary.claimed).toBe(0);
      expect(publisher.calls).toHaveLength(0);
      const dead = await rowOf(h, id as string);
      expect(dead.status).toBe('DEAD');
      expect(dead.attempt_count).toBe(5);
      expect(dead.lock_token).toBeNull();
      expect(dead.locked_at).toBeNull();
    });

    it('an exhausted PROCESSING event whose lease is still ACTIVE is not touched', async () => {
      const [id] = await seedEvents(h, 1);
      await forceProcessing(h, id as string, 5);
      const before = await rowOf(h, id as string);
      const summary = await h.dispatcher({ publisher: new FakeOutboxPublisher('resolve'), config: { maxAttempts: 5 } }).dispatchOnce();
      expect(summary.deadMarked).toBe(0);
      expect(await rowOf(h, id as string)).toEqual(before);
    });

    it('dead events do not use up publish slots', async () => {
      const ids = await seedEvents(h, 4);
      for (const id of ids.slice(0, 3)) {
        await forcePendingAttempts(h, id, 5);
      }
      const publisher = new FakeOutboxPublisher('resolve');
      const summary = await h
        .dispatcher({ publisher, config: { maxAttempts: 5, publishConcurrency: 1, batchSize: 1 } })
        .dispatchOnce();
      expect(summary.deadMarked).toBe(3);
      expect(summary.claimed).toBe(1);
      expect(summary.published).toBe(1);
    });
  });

  describe('no raw error and no secret in the database or the logs', () => {
    it('a publisher error full of secrets leaves only the fixed code behind, in every column and in every log line', async () => {
      const ids = await seedEvents(h, 3);
      const nasty = Object.assign(new Error(`broker rejected token=${SECRET_MARKER}`), {
        code: `E_${SECRET_MARKER}`,
        stack: `Error: ${SECRET_MARKER}\n    at secret (${SECRET_MARKER}.js:1:1)`,
        response: { body: SECRET_MARKER },
      });
      const publisher = new FakeOutboxPublisher('reject', nasty);
      const { logger, lines } = captureLogs();
      const summary = await h.dispatcher({ publisher, logger }).dispatchOnce();

      expect(summary.retryScheduled).toBe(3);
      for (const id of ids) {
        expect((await rowOf(h, id)).last_error_code).toBe('PUBLISH_FAILED');
      }
      const everything = await wholeOutboxText(h);
      expect(everything).not.toContain(SECRET_MARKER);
      expect(everything).not.toContain('broker rejected');
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toContain(SECRET_MARKER);
        expect(line).not.toContain('broker rejected');
        expect(line).not.toContain('E_SECRET');
      }
      expect(JSON.stringify(summary)).not.toContain(SECRET_MARKER);
    });

    it('a timeout logs and stores only PUBLISH_TIMEOUT', async () => {
      const [id] = await seedEvents(h, 1);
      const publisher = new FakeOutboxPublisher('manual');
      const { logger, lines } = captureLogs();
      await h.dispatcher({ publisher, logger, config: { publishTimeoutMs: 120 } }).dispatchOnce();
      first(publisher.calls).reject(new Error(SECRET_MARKER));
      await new Promise<void>((resolve) => setTimeout(resolve, 80));

      expect((await rowOf(h, id as string)).last_error_code).toBe('PUBLISH_TIMEOUT');
      expect(await wholeOutboxText(h)).not.toContain(SECRET_MARKER);
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(parsed.some((entry) => entry['code'] === 'PUBLISH_TIMEOUT')).toBe(true);
      expect(lines.join('\n')).not.toContain(SECRET_MARKER);
    });

    it('the database itself refuses an error code that is not an UPPER_SNAKE token (a raw message cannot be stored)', async () => {
      const [id] = await seedEvents(h, 1);
      let error: unknown;
      try {
        await h.pool.query('UPDATE app.outbox_events SET last_error_code = $2 WHERE event_id = $1', [
          id,
          `boom: ${SECRET_MARKER}`,
        ]);
      } catch (caught) {
        error = caught;
      }
      expect((error as { code?: string }).code).toBe('23514');
      expect((error as { constraint?: string }).constraint).toBe('outbox_events_last_error_code_ck');
    });
  });
});
