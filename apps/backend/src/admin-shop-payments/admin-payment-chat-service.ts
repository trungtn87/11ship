import { Inject, Injectable } from '@nestjs/common';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { FinanceAccessParticipant } from '../finance-access/finance-access-participant';
import { FINANCE_PERMISSION_READ, FINANCE_PERMISSION_TOPUP_RECORD, PERMISSION_SHOP_PAYMENT_READ, PERMISSION_SHOP_PAYMENT_RECORD } from '../finance-access/finance-access-constants';
import { JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { PageQuery, SendInput } from '../order-chat/order-chat-validation';
import { CaseKind } from '../payment-chat/payment-chat-constants';
import { PaymentChatAccess, PaymentChatAdmin, PaymentChatService } from '../payment-chat/payment-chat-service';
import { TransactionContext } from '../transaction/transaction-context';

/**
 * The payment conversation for the Administration web (#199). READING a room needs the right to READ that kind of request (wallet.read for a Shipper top-up,
 * shop.payment.read for a shop payment); WRITING needs the right to HANDLE its money (wallet.topup.record / shop.payment.record). SYSTEM holds all implicitly. Both
 * are asked again inside the room's transaction, under the administrator's locks, on every call: a hidden button or an old page grants nothing, and an
 * administrator who may only read is refused (ADMIN_FORBIDDEN) when writing. Confirming money is never done here: it has its own endpoints.
 */
@Injectable()
export class AdminPaymentChatService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly actor: AdminSystemActor,
    private readonly access: FinanceAccessParticipant,
    private readonly chat: PaymentChatService,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async read(sessionToken: string | undefined, kind: CaseKind, id: string, page: PageQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.chat.readForAdmin(this.#admin(known, kind), kind, id, page);
  }

  async send(sessionToken: string | undefined, csrfHeader: unknown, kind: CaseKind, id: string, input: SendInput, key: string | readonly string[] | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.chat.sendForAdmin(this.#admin(known, kind), kind, id, input, key);
  }

  #admin(known: SessionLookup, kind: CaseKind): PaymentChatAdmin {
    const readRight = kind === 'DRIVER_TOPUP' ? FINANCE_PERMISSION_READ : PERMISSION_SHOP_PAYMENT_READ;
    const writeRight = kind === 'DRIVER_TOPUP' ? FINANCE_PERMISSION_TOPUP_RECORD : PERMISSION_SHOP_PAYMENT_RECORD;
    return {
      userId: known.userId,
      authorize: async (context: TransactionContext): Promise<PaymentChatAccess> => {
        await setBusinessLockTimeout(context, this.#lockTimeoutMs);
        const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
        const nowMs = await freshClockMs(context);
        await this.access.require(context, locked, readRight, nowMs);
        const maySend = await this.access.has(context, locked, writeRight);
        return { role: locked.checked.membership.adminRole === 'SYSTEM' ? 'SYSTEM' : 'ADMIN', maySend };
      },
    };
  }
}
