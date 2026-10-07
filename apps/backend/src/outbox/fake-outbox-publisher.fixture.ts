import { OutboxPublisher, OutboxPublishEvent } from './outbox-publisher';

// TEST-ONLY (excluded from the production build by tsconfig.build.json: *.fixture.ts). C1C connects no real
// broker, Redis, push or WebSocket: this fake is the only publisher that exists, and it exists for tests.

export type FakePublishMode =
  /** Resolves immediately. */
  | 'resolve'
  /** Rejects immediately with `rejection`. */
  | 'reject'
  /** Returns a promise that the TEST settles through the recorded call. It ignores the AbortSignal. */
  | 'manual';

export interface FakePublishCall {
  readonly event: OutboxPublishEvent;
  readonly signal: AbortSignal;
  /** true once the underlying promise returned to the dispatcher has settled (either way). */
  settled: boolean;
  /** Only in 'manual' mode: settle the underlying promise. No-ops afterwards. */
  resolve(): void;
  reject(reason?: unknown): void;
}

export class FakeOutboxPublisher implements OutboxPublisher {
  readonly calls: FakePublishCall[] = [];
  mode: FakePublishMode;
  rejection: unknown;
  /** Observes every call synchronously, before its promise is returned (for ordering assertions). */
  onPublish: ((call: FakePublishCall) => void) | undefined;

  constructor(mode: FakePublishMode = 'resolve', rejection: unknown = new Error('fake publish failure')) {
    this.mode = mode;
    this.rejection = rejection;
  }

  publish(event: OutboxPublishEvent, signal: AbortSignal): Promise<void> {
    let resolveFn: () => void = () => undefined;
    let rejectFn: (reason?: unknown) => void = () => undefined;
    const call: FakePublishCall = {
      event,
      signal,
      settled: false,
      resolve: () => {
        resolveFn();
      },
      reject: (reason?: unknown) => {
        rejectFn(reason);
      },
    };
    this.calls.push(call);
    this.onPublish?.(call);

    if (this.mode === 'resolve') {
      call.settled = true;
      return Promise.resolve();
    }
    if (this.mode === 'reject') {
      call.settled = true;
      return Promise.reject(this.rejection);
    }
    return new Promise<void>((resolve, reject) => {
      resolveFn = () => {
        call.settled = true;
        resolve();
      };
      rejectFn = (reason?: unknown) => {
        call.settled = true;
        reject(reason);
      };
    });
  }

  /** Event ids in call order (a redelivery appears more than once). */
  get eventIds(): string[] {
    return this.calls.map((call) => call.event.eventId);
  }

  /** Settles every still-pending manual call successfully (test cleanup). */
  releaseAll(): void {
    for (const call of this.calls) {
      call.resolve();
    }
  }
}
