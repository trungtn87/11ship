import { DynamicModule, Module, OnApplicationShutdown } from '@nestjs/common';

// Ties the test SMS runtime to the application lifecycle (M01.22): when the application shuts down (SIGTERM/SIGINT go
// through the shutdown hooks main.ts enables) the private listener is closed and this instance's discovery state is
// removed. Imported only when TEST_INBOX is active; otherwise nothing of the test inbox exists.

export interface StoppableRuntime {
  stop(): Promise<void>;
}

export const TEST_SMS_LIFECYCLE = Symbol('TEST_SMS_LIFECYCLE');

class TestSmsLifecycle implements OnApplicationShutdown {
  readonly #runtime: StoppableRuntime;

  constructor(runtime: StoppableRuntime) {
    this.#runtime = runtime;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.#runtime.stop();
  }
}

@Module({})
export class TestSmsModule {
  static register(runtime: StoppableRuntime): DynamicModule {
    return {
      module: TestSmsModule,
      providers: [{ provide: TEST_SMS_LIFECYCLE, useFactory: () => new TestSmsLifecycle(runtime) }],
    };
  }
}
