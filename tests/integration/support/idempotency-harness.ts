import {
  Body,
  Controller,
  DynamicModule,
  Headers,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { IdempotencyExecutor } from '../../../apps/backend/src/idempotency/idempotency-executor';
import { IdempotencyHarness, SECRET_TOKEN, insertItem } from './idempotency-fixtures';

export const IDEMPOTENCY_HARNESS = Symbol('IDEMPOTENCY_HARNESS');

export interface IdempotencyHarnessContext {
  readonly harness: IdempotencyHarness;
  /** profile name -> executor. Lets a test pick the keyring / transaction manager per request. */
  readonly executors: Readonly<Record<string, IdempotencyExecutor>>;
  /** How many times the business callback ran, per scope. */
  readonly callbacks: Map<string, number>;
}

interface ResponseLike {
  status(code: number): unknown;
}

// Test-only stand-in for a future business endpoint. It goes through the REAL Nest pipeline
// (request-id middleware, route matching, AllExceptionsFilter) like every production controller will.
@Controller('harness/idempotent')
export class IdempotencyHarnessController {
  constructor(@Inject(IDEMPOTENCY_HARNESS) private readonly context: IdempotencyHarnessContext) {}

  @Post(':profile/:scope')
  async create(
    @Param('profile') profile: string,
    @Param('scope') scope: string,
    @Headers('idempotency-key') key: string | string[] | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<unknown> {
    const executor = this.context.executors[profile];
    if (executor === undefined) {
      throw new NotFoundException();
    }
    const { harness, callbacks } = this.context;
    const outcome = await executor.execute(
      {
        scopeType: harness.scopeType,
        scopeId: scope,
        operationId: 'harness.create.v1',
        idempotencyKey: key,
        logicalRequest: body ?? null,
        replay: { kind: 'non-sensitive' },
      },
      async (transaction) => {
        callbacks.set(scope, (callbacks.get(scope) ?? 0) + 1);
        const id = await insertItem(harness, transaction, scope);
        return { status: 201, replayGuard: { scope }, payload: { item_id: id, access_token: SECRET_TOKEN } };
      },
    );
    response.status(outcome.status);
    return outcome.payload;
  }
}

@Module({})
export class IdempotencyHarnessModule {
  static register(context: IdempotencyHarnessContext): DynamicModule {
    return {
      module: IdempotencyHarnessModule,
      controllers: [IdempotencyHarnessController],
      providers: [{ provide: IDEMPOTENCY_HARNESS, useValue: context }],
    };
  }
}
