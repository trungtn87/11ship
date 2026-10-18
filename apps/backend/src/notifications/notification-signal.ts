import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';

/**
 * In-process wake-up of the long-poll sync (M08.05). It only shortens the wait: the database is the source of truth, and a waiter that misses a signal (another
 * process produced the row, a restart) still re-reads on its own short interval.
 */
@Injectable()
export class NotificationSignal {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  /** Resolves true when signalled, false after `ms`. */
  wait(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      const done = (value: boolean): void => {
        clearTimeout(timer);
        this.#emitter.off('changed', onChange);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onChange = (): void => done(true);
      const onAbort = (): void => done(false);
      const timer = setTimeout(() => done(false), ms);
      this.#emitter.once('changed', onChange);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  changed(): void {
    this.#emitter.emit('changed');
  }
}
