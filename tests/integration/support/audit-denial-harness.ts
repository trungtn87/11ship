import { Controller, DynamicModule, Get, Inject, Module, Param, Req } from '@nestjs/common';
import { StandaloneAuditRecorder } from '../../../apps/backend/src/audit/standalone-audit-recorder';
import { AppError } from '../../../apps/backend/src/common/app-errors';
import { RequestWithContext } from '../../../apps/backend/src/http/request-context.middleware';
import { TransactionManager } from '../../../apps/backend/src/transaction/transaction-manager';
import { denial } from './audit-outbox-fixtures';
import { IdempotencyHarness, insertItem } from './idempotency-fixtures';

export const DENIAL_HARNESS = Symbol('DENIAL_HARNESS');

export interface DenialHarnessContext {
  readonly harness: IdempotencyHarness;
  /** Manager on the SAME pool as the recorder profile it is paired with. */
  readonly manager: TransactionManager;
  /** profile name -> recorder (healthy, exhausted pool, outage, ...). */
  readonly recorders: Readonly<Record<string, StandaloneAuditRecorder>>;
}

// Test-only coordinator, the shape every real denial path will have: the business transaction rolls back
// and releases its connection, THEN the standalone audit is attempted, and the ORIGINAL denial is what the
// client gets, whatever happened to the audit.
@Controller('harness/denial')
export class DenialHarnessController {
  constructor(@Inject(DENIAL_HARNESS) private readonly context: DenialHarnessContext) {}

  @Get(':profile/:scope')
  async deny(
    @Param('profile') profile: string,
    @Param('scope') scope: string,
    @Req() request: RequestWithContext,
  ): Promise<never> {
    const { harness, manager, recorders } = this.context;
    const recorder = recorders[profile] as StandaloneAuditRecorder;
    try {
      await manager.withTransaction(async (context) => {
        await insertItem(harness, context, scope);
        throw new AppError('IDEMPOTENCY_KEY_REUSED'); // the business denial
      });
    } catch (original) {
      await recorder.recordBestEffort(denial(request.requestId as string, { action: 'fixture.deny.v1' }));
      throw original;
    }
    throw new Error('unreachable');
  }
}

@Module({})
export class DenialHarnessModule {
  static register(context: DenialHarnessContext): DynamicModule {
    return {
      module: DenialHarnessModule,
      controllers: [DenialHarnessController],
      providers: [{ provide: DENIAL_HARNESS, useValue: context }],
    };
  }
}
