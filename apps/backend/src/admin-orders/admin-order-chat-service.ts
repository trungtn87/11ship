import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminAccountReadRepository } from '../admin-accounts/admin-account-read-repository';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AuditWriter } from '../audit/audit-writer';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { ChatRoomType } from '../order-chat/order-chat-constants';
import { OrderChatParticipants } from '../order-chat/order-chat-participants';
import { OrderChatRepository } from '../order-chat/order-chat-repository';
import { AdminAccess, ChatAdmin, OrderChatService } from '../order-chat/order-chat-service';
import { PageQuery, SendInput } from '../order-chat/order-chat-validation';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';

type Right = 'view' | 'review';

const HOLD_PLACE = 'admin.order_chat.hold.v1';
const HOLD_RELEASE = 'admin.order_chat.release.v1';

/**
 * The order chat for the Administration web (#191). SYSTEM, or an ADMIN whose CURRENT permission rows give VIEW on the SHOP or DRIVER app (the very rule of the
 * order / delivery detail), reads a room and may write in it while its file is open; there is no other staff door to a conversation. Placing or releasing an
 * EVIDENCE HOLD (the retention job and the expiry then leave that room alone) needs SYSTEM or the review right on DRIVER, a reason, and leaves an audit row.
 * A hold never changes the order, the delivery or any money.
 */
@Injectable()
export class AdminOrderChatService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly chat: OrderChatService,
    private readonly repo: OrderChatRepository,
    private readonly participants: OrderChatParticipants,
    private readonly executor: IdempotencyExecutor,
    private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  async read(sessionToken: string | undefined, kind: ChatRoomType, id: string, page: PageQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.chat.readForAdmin(await this.#admin(known, 'view'), kind, id, page);
  }

  async send(sessionToken: string | undefined, csrfHeader: unknown, kind: ChatRoomType, id: string, input: SendInput, key: string | readonly string[] | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.chat.sendForAdmin(await this.#admin(known, 'view'), kind, id, input, key);
  }

  /** "Lưu lịch sử trao đổi" of a file: retention, what keeps it, and what this account may do about it. */
  async holdState(sessionToken: string | undefined, kind: ChatRoomType, id: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.chat.holdOverview(await this.#admin(known, 'view'), kind, id);
  }

  async placeHold(sessionToken: string | undefined, csrfHeader: unknown, kind: ChatRoomType, id: string, reason: string, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#hold(HOLD_PLACE, sessionToken, csrfHeader, kind, id, reason, key, meta);
  }

  async releaseHold(sessionToken: string | undefined, csrfHeader: unknown, kind: ChatRoomType, id: string, reason: string, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    return this.#hold(HOLD_RELEASE, sessionToken, csrfHeader, kind, id, reason, key, meta);
  }

  async #hold(operation: string, sessionToken: string | undefined, csrfHeader: unknown, kind: ChatRoomType, id: string, reason: string, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    const placing = operation === HOLD_PLACE;
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: operation,
        idempotencyKey: key,
        logicalRequest: { room_type: kind, room_id: id, reason },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard) => {
            if (guard.actor_user_id !== known.userId || !isCanonicalUuid(guard.room_id)) {
              throw new TechnicalError('internal', 'Invalid replay guard');
            }
            await this.#authorize(context, known, 'review');
            return true;
          },
        },
      },
      async (context) => {
        await setBusinessLockTimeout(context, this.#lockTimeoutMs);
        await this.#authorize(context, known, 'review');
        const room = kind === 'ORDER' ? await this.participants.orderRoom(context, id) : await this.participants.directRoom(context, id);
        if (room === undefined) {
          throw new AppError(kind === 'ORDER' ? 'ORDER_NOT_FOUND' : 'DELIVERY_NOT_FOUND');
        }
        const open = await this.repo.openHold(context, kind, id);
        let holdId: string;
        if (placing) {
          if (open !== undefined) {
            throw new AppError('ORDER_STATE_CONFLICT');
          }
          // A hold keeps what is still there; it never brings a conversation back. Once the retention ran out (the job may not have run yet) it is refused.
          if ((await this.chat.retentionState(context, room, await freshClockMs(context))).expired) {
            throw new AppError('ORDER_CHAT_EXPIRED');
          }
          holdId = randomUUID();
          if (!(await this.repo.placeHold(context, holdId, kind, id, reason, known.userId))) {
            throw new AppError('ORDER_STATE_CONFLICT');
          }
        } else {
          if (open === undefined) {
            throw new AppError('ORDER_STATE_CONFLICT');
          }
          holdId = open.holdId;
          if (!(await this.repo.releaseHold(context, holdId, reason, known.userId))) {
            throw new AppError('ORDER_STATE_CONFLICT');
          }
        }
        await this.audit.append(context, {
          requestId: meta.requestId,
          actorType: 'ADMIN',
          actorId: known.userId,
          action: operation,
          resourceType: 'order_chat',
          resourceId: id,
          resourceVersion: 1,
          outcome: 'SUCCESS',
          metadata: { room_type: kind, hold_id: holdId, reason },
        });
        return { status: 200, replayGuard: { actor_user_id: known.userId, room_id: id }, payload: { held: placing, room_type: kind, room_id: id } };
      },
    );
  }

  async #inTransaction<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.transactions.withTransaction(work);
  }

  async #admin(known: SessionLookup, right: Right): Promise<ChatAdmin> {
    // The role is only needed for the label; the right itself is decided again, inside the room's transaction, under the admin's locks.
    return { userId: known.userId, authorize: (context) => this.#authorize(context, known, right) };
  }

  async #authorize(context: TransactionContext, known: SessionLookup, right: Right): Promise<AdminAccess> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'SYSTEM') {
      return { role: 'SYSTEM', review: true };
    }
    const driver = rows.find((candidate) => candidate.app === 'DRIVER');
    const shop = rows.find((candidate) => candidate.app === 'SHOP');
    const mayView = (driver?.canView ?? false) || (shop?.canView ?? false);
    const review = (driver?.canView ?? false) && (driver?.canReviewProfile ?? false);
    if (!mayView || (right === 'review' && !review)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    return { role: 'ADMIN', review };
  }
}
