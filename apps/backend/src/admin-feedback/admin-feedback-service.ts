import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AdminAccountReadRepository, PermissionRow } from '../admin-accounts/admin-account-read-repository';
import { AdminRole } from '../admin-auth/admin-auth-constants';
import { AdminMembershipRepository } from '../admin-auth/admin-membership-repository';
import { SessionLookup } from '../admin-auth/admin-session-repository';
import { PROVISIONING_SCOPE_TYPE } from '../admin-provisioning/admin-provisioning-constants';
import { setBusinessLockTimeout } from '../admin-provisioning/admin-provisioning-locks';
import { AdminSystemActor } from '../admin-provisioning/admin-system-actor';
import { AppError, TechnicalError } from '../common/app-errors';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { DeliveryViews } from '../delivery/delivery-views';
import { FinanceAccessRepository } from '../finance-access/finance-access-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { AdjustmentRow, AttachmentMeta, ComplaintRepository, ComplaintRow, MessageRow } from '../feedback/complaint-repository';
import { attachmentView, reconsiderationView } from '../feedback/complaint-views';
import { COMMISSION_ADJUSTMENT_PORT, CommissionAdjustmentPort } from '../feedback/feedback-finance-port';
import { CLOSED_STATUSES, complaintInScope, FeedbackScope, OPERATIONS, OPEN_STATUSES, reviewInScope } from '../feedback/feedback-constants';
import { FeedbackRecorder } from '../feedback/feedback-recorder';
import { awaitingTargetValid, correctionDiffers, reconsiderationOpen } from '../feedback/feedback-rules';
import { ReviewRepository, ReviewRow, ReviewWithReply } from '../feedback/review-repository';
import { iso, replyView } from '../feedback/review-views';
import { AdminComplaintQuery, AdminReviewQuery, ComplaintAction, ComplaintActionInput, ModerationInput, ReviewAction } from './admin-feedback-validation';

/** Money moves through M04 only, and only for an administrator who holds the money right of adjustments (never implied by the right to handle complaints). */
export const FINANCE_ADJUSTMENT_RIGHT = 'wallet.adjustment.post';

type Right = 'view' | 'handle';

interface Authorized {
  readonly role: AdminRole;
  readonly actorId: string;
  readonly handle: boolean;
  /** Issue #261: the parts of M11 (shop, Shipper) this administrator may READ, and may HANDLE (view + review right on that app). Records outside read as not found. */
  readonly view: FeedbackScope;
  readonly manage: FeedbackScope;
  /** Reserved for the money right: true for SYSTEM and for an ADMIN whose grant row is GRANTED now. */
  readonly finance: boolean;
}

const operationOf = (name: string): string => `${OPERATIONS.adminAction}.${name.replace(/-/g, '_')}`;

const STATE_LABEL_COMPLETED = 'Giao thành công';
const STATE_LABEL_FAILED = 'Giao thất bại';

/**
 * Reviews and complaints for the administration web (M11.03). SYSTEM, or an ADMIN whose CURRENT permission rows give VIEW on the SHOP or DRIVER app (read),
 * and for every change also the review right (`can_review_profile`) on one of them. The money right is a separate row (`wallet.adjustment.post`): handling
 * complaints never implies it, and neither does locking an account. The backend decides on every read and write under the actor's locks after the database
 * clock was read.
 *
 * Nothing here edits a rating (stars and text belong to their author: an Administrator only hides or restores it, with a reason, keeping the original),
 * changes a delivery, completes or captures anything again, or writes a ledger row: a result correction is its own row that points at the ORIGINAL
 * result and shows in the delivery history; a money correction is only REQUESTED from M04 and stays PENDING_FINANCE when M04 cannot post it or the
 * wallet lacks the balance. Closing a complaint never changes who holds the goods: custody is M07's.
 *
 * Lock order is the module's: actor rows, then the complaint (or rating) row, then the delivery row (to append the history line without a clash).
 */
@Injectable()
export class AdminFeedbackService {
  readonly #lockTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actor: AdminSystemActor,
    private readonly permissions: AdminAccountReadRepository,
    private readonly memberships: AdminMembershipRepository,
    private readonly grants: FinanceAccessRepository,
    private readonly reviews: ReviewRepository,
    private readonly complaints: ComplaintRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly deliveryViews: DeliveryViews,
    private readonly recorder: FeedbackRecorder,
    @Inject(COMMISSION_ADJUSTMENT_PORT) private readonly finance: CommissionAdjustmentPort,
    @Inject(APP_CONFIG) appConfig: AppConfig,
  ) {
    this.#lockTimeoutMs = appConfig.idempotency.businessLockTimeoutMs;
  }

  // =========================================================================================================== reviews

  async listReviews(sessionToken: string | undefined, query: AdminReviewQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const page = await this.reviews.listForAdmin(context, { kind: query.kind, stars: query.stars, visibility: query.visibility, q: query.q, fromMs: query.fromMs, toMs: query.toMs, shop: query.shop, shipper: query.shipper }, { limit: query.limit, offset: query.offset }, auth.view);
      const counters = await this.reviews.adminCounters(context, auth.view);
      return { items: page.rows.map((r) => this.#reviewLine(r)), total: page.total, limit: query.limit, offset: query.offset, counters: { total: counters.total, hidden: counters.hidden, low: counters.low } };
    });
  }

  async reviewDetail(sessionToken: string | undefined, reviewId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const review = await this.reviews.findShopReviewWithReply(context, reviewId);
      if (review === undefined || !reviewInScope(review.kind, auth.view)) {
        throw new AppError('REVIEW_NOT_FOUND');
      }
      return this.#reviewDetail(context, review, auth);
    });
  }

  async reviewAction(action: ReviewAction, sessionToken: string | undefined, csrfHeader: unknown, reviewId: string, input: ModerationInput, key: string | readonly string[] | undefined, meta: { requestId: string }): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: operationOf(`review-${action}`),
        idempotencyKey: key,
        logicalRequest: { review_id: reviewId, action, expected_version: input.expectedVersion, reason_code: input.reasonCode, reason_note: input.reasonNote },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, 'handle') },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, 'handle');
        const review = await this.reviews.lockById(context, reviewId);
        if (review === undefined || !reviewInScope(review.kind, auth.manage)) {
          throw new AppError('REVIEW_NOT_FOUND');
        }
        if (review.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const target = action === 'hide' ? 'HIDDEN' : 'VISIBLE';
        if (review.visibility === target) {
          throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
        }
        if (!(await this.reviews.setVisibility(context, reviewId, review.version, target))) {
          throw new AppError('VERSION_CONFLICT');
        }
        await this.reviews.appendModeration(context, { moderationId: randomUUID(), reviewId, action: action === 'hide' ? 'HIDE' : 'RESTORE', reasonCode: input.reasonCode, reasonNote: input.reasonNote, actorUserId: auth.actorId });
        await this.recorder.review(
          context,
          { requestId: meta.requestId, actorType: 'ADMIN', actorId: auth.actorId, action: operationOf(`review-${action}`), metadata: { before: review.visibility, after: target, reason_code: input.reasonCode } },
          { reviewId, kind: review.kind, version: review.version + 1, shopId: review.shopId, driverId: review.driverId, stars: review.stars, visibility: target },
        );
        const after = await this.reviews.findShopReviewWithReply(context, reviewId);
        if (after === undefined) {
          throw new TechnicalError('internal', 'Review missing after moderation');
        }
        return { status: 200, replayGuard: { actor_user_id: auth.actorId, action: 'handle' }, payload: await this.#reviewDetail(context, after, auth) };
      },
    );
  }

  #reviewLine(r: ReviewWithReply): JsonObject {
    return {
      review_id: r.reviewId,
      kind: r.kind,
      stars: r.stars,
      comment: r.comment === null ? null : r.comment.slice(0, 160),
      visibility: r.visibility,
      shop: { shop_id: r.shopId, name: r.shopName },
      shipper: r.driverId === null ? null : { driver_id: r.driverId, name: r.driverName },
      related_code: r.relatedCode,
      has_reply: r.reply !== null,
      created_at: iso(r.createdAtMs),
      version: r.version,
    };
  }

  async #reviewDetail(context: TransactionContext, r: ReviewWithReply, auth: Authorized): Promise<JsonObject> {
    const history = r.kind === 'SHOP_BY_CUSTOMER' ? await this.reviews.replyHistory(context, r.reviewId) : [];
    const moderations = await this.reviews.moderations(context, r.reviewId);
    const delivery = r.deliveryId === null ? undefined : await this.deliveries.findById(context, r.deliveryId);
    const complaints = await this.complaints.complaintsOfReview(context, r.reviewId, auth.view);
    const can: string[] = [];
    if (reviewInScope(r.kind, auth.manage)) {
      can.push(r.visibility === 'VISIBLE' ? 'hide' : 'restore');
    }
    return {
      ...this.#reviewLine(r),
      // The ORIGINAL text, always: hiding keeps it and an Administrator never edits it.
      comment: r.comment,
      source: r.kind === 'SHIPPER_BY_CUSTOMER' ? 'CUSTOMER' : r.kind === 'SHIPPER_BY_SHOP' ? 'SHOP' : 'CUSTOMER',
      reviewer_name: r.reviewerName,
      order_id: r.orderId,
      delivery: delivery === undefined ? null : { delivery_id: delivery.deliveryId, code: delivery.code, state: delivery.state },
      assignment_id: r.assignmentId,
      reply: replyView(r.reply),
      reply_history: history.map((h) => ({ version: h.version, body: h.body, written_at: iso(h.writtenAtMs) })),
      moderations: moderations.map((m) => ({ action: m.action, reason_code: m.reasonCode, reason_note: m.reasonNote, actor_user_id: m.actorUserId, at: iso(m.atMs) })),
      complaints: complaints.map((c) => ({ complaint_id: c.complaintId, code: c.code, status: c.status })),
      can,
    };
  }

  // ========================================================================================================= complaints

  async listComplaints(sessionToken: string | undefined, query: AdminComplaintQuery): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const assignee = query.assignee === 'ME' ? auth.actorId : query.assignee;
      const page = await this.complaints.listForAdmin(
        context,
        { q: query.q, status: query.status, category: query.category, submitterRole: query.submitterRole, shop: query.shop, shipper: query.shipper, assignee, fromMs: query.fromMs, toMs: query.toMs },
        { limit: query.limit, offset: query.offset },
        auth.view,
      );
      const waiting = await this.complaints.pendingReconsiderationIds(context, page.rows.map((c) => c.complaintId));
      const counters = await this.complaints.adminCounters(context, auth.view);
      return {
        items: page.rows.map((c) => ({
          complaint_id: c.complaintId,
          code: c.code,
          summary: c.body.slice(0, 120),
          category: c.category,
          status: c.status,
          submitter_role: c.submitterRole,
          related_code: c.relatedCode,
          shop: { shop_id: c.shopId, name: c.shopName },
          shipper: c.driverId === null ? null : { driver_id: c.driverId, name: c.driverName, code: c.driverCode },
          assigned_to: c.assignedTo,
          reconsideration_pending: waiting.has(c.complaintId),
          created_at: iso(c.createdAtMs),
          updated_at: iso(c.updatedAtMs),
        })),
        total: page.total,
        limit: query.limit,
        offset: query.offset,
        counters: { pending: counters.pending, in_progress: counters.inProgress, awaiting_info: counters.awaitingInfo, reconsiderations: counters.reconsiderations },
      };
    });
  }

  /** The administrators who can take a complaint (for the assignment list and the filter): SYSTEM and the ADMINs with VIEW + review on the SHOP or DRIVER app. */
  async handlers(sessionToken: string | undefined): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      return { handlers: await this.#handlers(context, auth.view) };
    });
  }

  async complaintDetail(sessionToken: string | undefined, complaintId: string): Promise<JsonObject> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context): Promise<JsonObject> => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const complaint = await this.complaints.findById(context, complaintId);
      if (complaint === undefined || !complaintInScope(complaint, auth.view)) {
        throw new AppError('COMPLAINT_NOT_FOUND');
      }
      return this.#complaintDetail(context, complaint, auth);
    });
  }

  /** A picture of any complaint, for the Administration (view right): the bytes only, with the type fixed by the table. */
  async complaintPicture(sessionToken: string | undefined, complaintId: string, attachmentId: string): Promise<{ contentType: string; data: Buffer }> {
    const known = await this.actor.precheck(sessionToken, { required: false });
    return this.transactions.withTransaction(async (context) => {
      await setBusinessLockTimeout(context, this.#lockTimeoutMs);
      const auth = await this.#authorize(context, known, 'view');
      const owner = await this.complaints.findById(context, complaintId);
      if (owner === undefined || !complaintInScope(owner, auth.view)) {
        throw new AppError('COMPLAINT_NOT_FOUND');
      }
      const attachment = await this.complaints.findAttachment(context, attachmentId);
      if (attachment === undefined || attachment.complaintId !== complaintId) {
        throw new AppError('COMPLAINT_ATTACHMENT_NOT_FOUND');
      }
      return { contentType: attachment.contentType, data: attachment.data };
    });
  }

  async complaintAction(
    name: ComplaintAction,
    sessionToken: string | undefined,
    csrfHeader: unknown,
    complaintId: string,
    input: ComplaintActionInput,
    key: string | readonly string[] | undefined,
    meta: { requestId: string },
  ): Promise<IdempotentOutcome> {
    const known = await this.actor.precheck(sessionToken, { required: true, header: csrfHeader });
    return this.executor.execute(
      {
        scopeType: PROVISIONING_SCOPE_TYPE,
        scopeId: known.userId,
        operationId: operationOf(name),
        idempotencyKey: key,
        logicalRequest: {
          complaint_id: complaintId,
          action: name,
          expected_version: input.expectedVersion,
          assignee: input.assignee,
          body: input.body,
          from: input.from,
          decision: input.decision,
          corrected_result: input.correctedResult,
          direction: input.direction,
          amount_vnd: input.amountVnd,
          history_reviewed: input.historyReviewed,
        },
        replay: { kind: 'sensitive', authorize: (context, guard) => this.#authorizeReplay(context, guard, known, 'handle') },
      },
      async (context) => {
        const auth = await this.#authorize(context, known, 'handle');
        const complaint = await this.complaints.lockById(context, complaintId);
        if (complaint === undefined || !complaintInScope(complaint, auth.manage)) {
          throw new AppError('COMPLAINT_NOT_FOUND');
        }
        if (complaint.version !== input.expectedVersion) {
          throw new AppError('VERSION_CONFLICT');
        }
        const after = await this.#apply(context, name, auth, complaint, input, meta.requestId);
        return { status: 200, replayGuard: { actor_user_id: auth.actorId, action: 'handle' }, payload: await this.#complaintDetail(context, after, auth) };
      },
    );
  }

  async #apply(context: TransactionContext, name: ComplaintAction, auth: Authorized, c: ComplaintRow, input: ComplaintActionInput, requestId: string): Promise<ComplaintRow> {
    const operation = operationOf(name);
    const audit = { requestId, actorType: 'ADMIN' as const, actorId: auth.actorId, action: operation };
    const conflict = (): never => {
      throw new AppError('COMPLAINT_STATE_CONFLICT');
    };
    const line = (kind: MessageRow['kind'], visibility: MessageRow['visibility'], body: string | null, audienceRole: 'SHOP' | 'SHIPPER' | null = null): Promise<void> =>
      this.complaints.appendMessage(context, { messageId: randomUUID(), complaintId: c.complaintId, kind, visibility, audienceRole, authorType: 'ADMIN', authorUserId: auth.actorId, body });
    const moved = (row: ComplaintRow | undefined): ComplaintRow => row ?? (conflict() as never);

    switch (name) {
      case 'receive': {
        if (c.status !== 'PENDING') {
          return conflict();
        }
        const after = moved(await this.complaints.setStatus(context, c.complaintId, c.version, { status: 'IN_PROGRESS', awaitingFrom: null, receive: true }));
        const assigned = c.assignedTo === null ? moved(await this.complaints.assign(context, c.complaintId, after.version, auth.actorId)) : after;
        await line('RECEIVED', 'SUBMITTER', null);
        await this.recorder.complaint(context, audit, assigned, 'received');
        return assigned;
      }
      case 'assign': {
        if (!OPEN_STATUSES.includes(c.status)) {
          return conflict();
        }
        if (input.assignee !== null && !(await this.#mayHandle(context, input.assignee, c))) {
          throw new AppError('ADMIN_INPUT_INVALID');
        }
        if (input.assignee === c.assignedTo) {
          return conflict();
        }
        const after = moved(await this.complaints.assign(context, c.complaintId, c.version, input.assignee));
        await line('ASSIGNED', 'INTERNAL', input.assignee === null ? 'Bỏ phân công' : `Phân công cho ${input.assignee}`);
        await this.recorder.complaint(context, { ...audit, metadata: { assignee: input.assignee } }, after, 'assigned');
        return after;
      }
      case 'note': {
        // An internal note never reaches an app; it still advances the version so two administrators do not overwrite each other blindly.
        await line('NOTE', 'INTERNAL', input.body);
        const after = moved(await this.complaints.setStatus(context, c.complaintId, c.version, { status: c.status, awaitingFrom: c.awaitingFrom }));
        await this.recorder.complaint(context, audit, after, 'note');
        return after;
      }
      case 'request-info': {
        if (c.status !== 'IN_PROGRESS' && c.status !== 'AWAITING_INFO') {
          return conflict();
        }
        const from = input.from as 'SUBMITTER' | 'SHOP' | 'SHIPPER';
        if (!awaitingTargetValid(from, c.submitterRole, c.driverId !== null)) {
          return conflict();
        }
        await line('REQUEST_INFO', from === 'SUBMITTER' ? 'SUBMITTER' : 'PARTY_ONLY', input.body, from === 'SUBMITTER' ? null : from);
        const after = moved(await this.complaints.setStatus(context, c.complaintId, c.version, { status: 'AWAITING_INFO', awaitingFrom: from }));
        await this.recorder.complaint(context, { ...audit, metadata: { from } }, after, 'info_requested');
        return after;
      }
      case 'conclude': {
        if (c.status !== 'IN_PROGRESS' && c.status !== 'AWAITING_INFO') {
          return conflict();
        }
        const after = moved(await this.complaints.setStatus(context, c.complaintId, c.version, { status: 'RESOLVED', awaitingFrom: null, conclusion: input.body, closing: true }));
        // Shown to the submitter AND the related parties: that is what the conclusion is for.
        await line('CONCLUSION', 'PARTIES', input.body);
        await this.recorder.complaint(context, audit, after, 'concluded');
        return after;
      }
      case 'close': {
        if (!OPEN_STATUSES.includes(c.status)) {
          return conflict();
        }
        const after = moved(await this.complaints.setStatus(context, c.complaintId, c.version, { status: 'CLOSED_NO_ACTION', awaitingFrom: null, closeReason: input.body, closing: true, receive: true }));
        await line('CLOSED', 'SUBMITTER', input.body);
        // Closing records a decision about the FILE. The goods, the delivery, the money and the ratings are exactly as they were.
        await this.recorder.complaint(context, audit, after, 'closed');
        return after;
      }
      case 'decide-reconsideration': {
        if (!CLOSED_STATUSES.includes(c.status)) {
          return conflict();
        }
        const request = await this.complaints.lockReconsideration(context, c.complaintId, c.closureNo);
        if (request === undefined || request.status !== 'PENDING') {
          return conflict();
        }
        const reopen = input.decision === 'REOPEN';
        if (reopen && (await this.complaints.lockOpenIssue(context, c.submitterUserId, c.submitterRole, c.category, c.scopeKey)) !== undefined) {
          // The same party already opened a new file about the same thing: that one is the open file.
          return conflict();
        }
        if (!(await this.complaints.decideReconsideration(context, request.requestId, reopen ? 'REOPENED' : 'REJECTED', auth.actorId, input.body as string))) {
          return conflict();
        }
        const after = moved(
          await this.complaints.setStatus(context, c.complaintId, c.version, reopen ? { status: 'IN_PROGRESS', awaitingFrom: null, reopening: true } : { status: c.status, awaitingFrom: null }),
        );
        await line('REOPEN_DECISION', 'SUBMITTER', `${reopen ? 'Mở lại hồ sơ' : 'Giữ nguyên kết quả'}: ${input.body as string}`);
        await this.recorder.complaint(context, { ...audit, metadata: { decision: input.decision } }, after, reopen ? 'reopened' : 'reconsideration_rejected');
        return after;
      }
      case 'adjust-result':
        return this.#adjustResult(context, auth, c, input, audit);
      case 'adjust-commission':
        return this.#adjustCommission(context, auth, c, input, audit);
      case 'retry-commission':
        return this.#retryCommission(context, auth, c, input, audit);
    }
  }

  /**
   * A wrong delivery result: a row that points at the ORIGINAL result and says what the Administration found. The delivery, its assignment, the commission
   * hold and the order are NOT touched (so nothing is completed, captured or re-opened a second time); the correction appears in the delivery history. When a
   * later delivery of the same chain exists, the whole history must have been looked at first.
   */
  async #adjustResult(context: TransactionContext, auth: Authorized, c: ComplaintRow, input: ComplaintActionInput, audit: { requestId: string; actorType: 'ADMIN'; actorId: string; action: string }): Promise<ComplaintRow> {
    const delivery = await this.#adjustableDelivery(context, c);
    const corrected = input.correctedResult as 'DELIVERED' | 'NOT_DELIVERED';
    if (!correctionDiffers(delivery.state, corrected)) {
      throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
    }
    const successors = await this.#successors(context, delivery);
    if (successors.length > 0 && !input.historyReviewed) {
      throw new AppError('ADJUSTMENT_HISTORY_REVIEW_REQUIRED');
    }
    const assignments = await this.deliveries.listAssignments(context, delivery.deliveryId);
    const executing = assignments.find((a) => a.status === 'COMPLETED' || a.status === 'FAILED');
    const adjustmentId = randomUUID();
    if (
      !(await this.complaints.insertAdjustment(context, {
        adjustmentId,
        complaintId: c.complaintId,
        kind: 'DELIVERY_RESULT',
        deliveryId: delivery.deliveryId,
        assignmentId: executing?.assignmentId ?? null,
        driverId: executing?.driverId ?? null,
        originalState: delivery.state,
        originalAssignmentStatus: executing?.status ?? null,
        correctedResult: corrected,
        direction: null,
        amountVnd: null,
        status: 'RECORDED',
        pendingReason: null,
        historyReviewed: input.historyReviewed,
        successorDeliveryIds: successors.map((s) => s.deliveryId),
        reason: input.body as string,
        createdBy: auth.actorId,
      }))
    ) {
      throw new AppError('COMPLAINT_STATE_CONFLICT');
    }
    const original = delivery.state === 'completed' ? STATE_LABEL_COMPLETED : STATE_LABEL_FAILED;
    const now = corrected === 'DELIVERED' ? STATE_LABEL_COMPLETED : 'Chưa giao được';
    await this.deliveries.appendEvent(context, {
      eventId: randomUUID(),
      deliveryId: delivery.deliveryId,
      type: 'delivery.result_adjusted',
      actorType: 'ADMIN',
      actorId: auth.actorId,
      assignmentId: executing?.assignmentId ?? null,
      note: `Điều chỉnh theo phản ánh ${c.code}: kết quả gốc "${original}" → "${now}". Kết quả gốc được giữ nguyên.`.slice(0, 500),
    });
    await this.complaints.appendMessage(context, { messageId: randomUUID(), complaintId: c.complaintId, kind: 'ADJUSTMENT', visibility: 'INTERNAL', audienceRole: null, authorType: 'ADMIN', authorUserId: auth.actorId, body: `Điều chỉnh kết quả giao: ${original} → ${now}. ${input.body as string}` });
    const after = await this.complaints.setStatus(context, c.complaintId, c.version, { status: c.status, awaitingFrom: c.awaitingFrom });
    if (after === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    await this.recorder.complaint(context, { ...audit, metadata: { adjustment_id: adjustmentId, kind: 'DELIVERY_RESULT', corrected, original: delivery.state, successors: successors.length } }, after, 'result_adjusted');
    return after;
  }

  /**
   * A commission correction: REQUESTED from M04 through the port, by an administrator with the separate money right. M04 either posts it, or says it cannot
   * (not connected) or that the balance is missing; in both of those the row stays PENDING_FINANCE with the reason. This code never writes a wallet,
   * a ledger row or a hold, and never touches the money held for another delivery.
   */
  async #adjustCommission(context: TransactionContext, auth: Authorized, c: ComplaintRow, input: ComplaintActionInput, audit: { requestId: string; actorType: 'ADMIN'; actorId: string; action: string }): Promise<ComplaintRow> {
    if (!auth.finance) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    const delivery = await this.#adjustableDelivery(context, c);
    const assignments = await this.deliveries.listAssignments(context, delivery.deliveryId);
    const executing = assignments.find((a) => a.status === 'COMPLETED' || a.status === 'FAILED');
    if (executing === undefined) {
      throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
    }
    const successors = await this.#successors(context, delivery);
    if (successors.length > 0 && !input.historyReviewed) {
      throw new AppError('ADJUSTMENT_HISTORY_REVIEW_REQUIRED');
    }
    const adjustmentId = randomUUID();
    const direction = input.direction as 'REFUND_TO_SHIPPER' | 'CHARGE_TO_SHIPPER';
    const amountVnd = input.amountVnd as number;
    if (
      !(await this.complaints.insertAdjustment(context, {
        adjustmentId,
        complaintId: c.complaintId,
        kind: 'COMMISSION',
        deliveryId: delivery.deliveryId,
        assignmentId: executing.assignmentId,
        driverId: executing.driverId,
        originalState: delivery.state,
        originalAssignmentStatus: executing.status,
        correctedResult: null,
        direction,
        amountVnd,
        status: 'PENDING_FINANCE',
        pendingReason: 'M04_UNAVAILABLE',
        historyReviewed: input.historyReviewed,
        successorDeliveryIds: successors.map((s) => s.deliveryId),
        reason: input.body as string,
        createdBy: auth.actorId,
      }))
    ) {
      throw new AppError('COMPLAINT_STATE_CONFLICT');
    }
    const result = await this.finance.post(context, { adjustmentId, complaintId: c.complaintId, driverId: executing.driverId, assignmentId: executing.assignmentId, direction, amountVnd, actorUserId: auth.actorId });
    const row = await this.complaints.lockAdjustment(context, c.complaintId, 'COMMISSION');
    if (row === undefined) {
      throw new TechnicalError('internal', 'Adjustment missing after insert');
    }
    if (result.kind === 'POSTED') {
      await this.complaints.setAdjustmentMoney(context, adjustmentId, row.version, 'EXECUTED', null);
    } else if (result.kind === 'INSUFFICIENT_BALANCE') {
      await this.complaints.setAdjustmentMoney(context, adjustmentId, row.version, 'PENDING_FINANCE', 'INSUFFICIENT_BALANCE');
    }
    await this.complaints.appendMessage(context, {
      messageId: randomUUID(),
      complaintId: c.complaintId,
      kind: 'ADJUSTMENT',
      visibility: 'INTERNAL',
      audienceRole: null,
      authorType: 'ADMIN',
      authorUserId: auth.actorId,
      body: `Điều chỉnh tài chính ${direction === 'REFUND_TO_SHIPPER' ? 'hoàn cho shipper' : 'thu thêm từ shipper'} ${String(amountVnd)}đ: ${result.kind === 'POSTED' ? 'đã thực hiện' : result.kind === 'INSUFFICIENT_BALANCE' ? 'chờ xử lý tài chính (thiếu số dư)' : 'chờ xử lý tài chính (chưa thực hiện được)'}. ${input.body as string}`,
    });
    const after = await this.complaints.setStatus(context, c.complaintId, c.version, { status: c.status, awaitingFrom: c.awaitingFrom });
    if (after === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    await this.recorder.complaint(context, { ...audit, metadata: { adjustment_id: adjustmentId, kind: 'COMMISSION', direction, amount_vnd: amountVnd, outcome: result.kind } }, after, 'commission_adjusted');
    return after;
  }

  /**
   * The money of a commission adjustment that stayed PENDING_FINANCE, requested from M04 AGAIN on the SAME adjustment (same id, same direction, amount and
   * Shipper: nothing is re-created and nothing is edited). M04 is idempotent on the adjustment id, so a repeat can never write a second ledger row. The
   * complaint's own conclusion is not reopened: the money is owed (or refunded) whether the file is open or already resolved. A wallet that still cannot
   * pay keeps the row PENDING_FINANCE with the reason; the attempt is recorded either way.
   */
  async #retryCommission(context: TransactionContext, auth: Authorized, c: ComplaintRow, input: ComplaintActionInput, audit: { requestId: string; actorType: 'ADMIN'; actorId: string; action: string }): Promise<ComplaintRow> {
    if (!auth.finance) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    const current = await this.complaints.lockAdjustment(context, c.complaintId, 'COMMISSION');
    if (current === undefined || current.status !== 'PENDING_FINANCE' || current.direction === null || current.amountVnd === null || current.driverId === null || current.assignmentId === null) {
      // Nothing waiting (never adjusted, or already executed by this or another administrator): never a second posting.
      throw new AppError('COMPLAINT_STATE_CONFLICT');
    }
    const result = await this.finance.post(context, { adjustmentId: current.adjustmentId, complaintId: c.complaintId, driverId: current.driverId, assignmentId: current.assignmentId, direction: current.direction, amountVnd: current.amountVnd, actorUserId: auth.actorId });
    const posted = result.kind === 'POSTED';
    const reason = result.kind === 'INSUFFICIENT_BALANCE' ? 'INSUFFICIENT_BALANCE' : 'M04_UNAVAILABLE';
    if (!(await this.complaints.setAdjustmentMoney(context, current.adjustmentId, current.version, posted ? 'EXECUTED' : 'PENDING_FINANCE', posted ? null : reason))) {
      throw new AppError('VERSION_CONFLICT');
    }
    const label = this.#retryLabel(result.kind);
    await this.complaints.appendMessage(context, {
      messageId: randomUUID(),
      complaintId: c.complaintId,
      kind: 'ADJUSTMENT',
      visibility: 'INTERNAL',
      audienceRole: null,
      authorType: 'ADMIN',
      authorUserId: auth.actorId,
      body: `Xử lý lại điều chỉnh tài chính ${current.direction === 'REFUND_TO_SHIPPER' ? 'hoàn cho shipper' : 'thu thêm từ shipper'} ${String(current.amountVnd)}đ: ${label}. ${input.body as string}`,
    });
    const after = await this.complaints.setStatus(context, c.complaintId, c.version, { status: c.status, awaitingFrom: c.awaitingFrom });
    if (after === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    await this.recorder.complaint(context, { ...audit, metadata: { adjustment_id: current.adjustmentId, kind: 'COMMISSION', direction: current.direction, amount_vnd: current.amountVnd, finance_outcome: result.kind, status: posted ? 'EXECUTED' : 'PENDING_FINANCE' } }, after, posted ? 'commission_executed' : 'commission_retry_pending');
    return after;
  }

  #retryLabel(kind: 'POSTED' | 'INSUFFICIENT_BALANCE' | 'UNAVAILABLE'): string {
    return kind === 'POSTED' ? 'đã thực hiện' : kind === 'INSUFFICIENT_BALANCE' ? 'vẫn chờ xử lý tài chính (số dư khả dụng chưa đủ)' : 'vẫn chờ xử lý tài chính (chưa thực hiện được)';
  }

  /** The delivery a correction applies to: the complaint's own, ended (completed or failed), and the file in a state where a conclusion is being made or was made. */
  async #adjustableDelivery(context: TransactionContext, c: ComplaintRow): Promise<DeliveryRow> {
    if (c.deliveryId === null || (c.status !== 'IN_PROGRESS' && c.status !== 'AWAITING_INFO' && c.status !== 'RESOLVED')) {
      throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
    }
    // The delivery row is locked before the history line is appended (the same row M07's own writers take), so the line never clashes with theirs.
    const delivery = await this.deliveries.lockById(context, c.deliveryId);
    if (delivery === undefined || (delivery.state !== 'completed' && delivery.state !== 'failed')) {
      throw new AppError('ADMIN_ACTION_NOT_ALLOWED');
    }
    return delivery;
  }

  /** Deliveries of the same chain created AFTER this one (a call again, a later Shipper): the whole history is checked before a conclusion is applied. */
  async #successors(context: TransactionContext, delivery: DeliveryRow): Promise<DeliveryRow[]> {
    return (await this.deliveries.listChain(context, delivery.deliveryId)).filter((d) => d.deliveryId !== delivery.deliveryId && d.createdAtMs >= delivery.createdAtMs);
  }

  // ---- detail ------------------------------------------------------------------------------------------------------------------

  async #complaintDetail(context: TransactionContext, c: ComplaintRow, auth: Authorized): Promise<JsonObject> {
    const nowMs = await freshClockMs(context);
    const messages = await this.complaints.listMessages(context, c.complaintId);
    const attachments = await this.complaints.listAttachments(context, c.complaintId);
    const reconsiderations = await this.complaints.listReconsiderations(context, c.complaintId);
    const adjustments = await this.complaints.listAdjustments(context, c.complaintId);
    const delivery = c.deliveryId === null ? undefined : await this.deliveries.findById(context, c.deliveryId);
    const chain = delivery === undefined ? [] : await this.deliveries.listChain(context, delivery.deliveryId);
    const review: ReviewRow | undefined = c.reviewId === null ? undefined : await this.reviews.findById(context, c.reviewId);
    const handlers = await this.#handlers(context, auth.view);
    const assignee = c.assignedTo === null ? null : { user_id: c.assignedTo, name: handlers.find((h) => h.user_id === c.assignedTo)?.name ?? '—' };
    const pending = reconsiderations.find((r) => r.closureNo === c.closureNo && r.status === 'PENDING');
    const can = this.#can(c, auth, delivery, adjustments, pending !== undefined);
    return {
      complaint: {
        complaint_id: c.complaintId,
        code: c.code,
        category: c.category,
        status: c.status,
        awaiting_from: c.awaitingFrom,
        submitter_role: c.submitterRole,
        body: c.body,
        conclusion: c.conclusion,
        close_reason: c.closeReason,
        related_code: c.relatedCode,
        shop: { shop_id: c.shopId, name: c.shopName },
        shipper: c.driverId === null ? null : { driver_id: c.driverId, name: c.driverName, code: c.driverCode },
        assigned_to: assignee,
        received_at: iso(c.receivedAtMs),
        created_at: iso(c.createdAtMs),
        updated_at: iso(c.updatedAtMs),
        closed_at: iso(c.closedAtMs),
        closure_no: c.closureNo,
        version: c.version,
        reconsideration_open: reconsiderationOpen(c.status, c.closedAtMs, nowMs),
      },
      messages: messages.map((m) => ({
        message_id: m.messageId,
        seq: m.seq,
        kind: m.kind,
        visibility: m.visibility,
        audience_role: m.audienceRole,
        author_type: m.authorType,
        author_user_id: m.authorUserId,
        body: m.body,
        created_at: iso(m.createdAtMs),
        attachments: attachments.filter((a: AttachmentMeta) => a.messageId === m.messageId).map(attachmentView),
      })),
      reconsiderations: reconsiderations.map((r) => ({ ...reconsiderationView(r), request_id: r.requestId, requested_by: r.requestedBy })),
      order: c.orderId === null ? null : { order_id: c.orderId, code: c.relatedCode },
      // The delivery as the Administration reads it (assignments, timeline, goods custody, fee) without the recipient's contact.
      delivery: delivery === undefined ? null : await this.deliveryViews.forAdmin(context, delivery, false, []),
      chain: chain.map((d) => ({ delivery_id: d.deliveryId, code: d.code, state: d.state, previous_delivery_id: d.previousDeliveryId, created_at: iso(d.createdAtMs) })),
      review: review === undefined ? null : { review_id: review.reviewId, source: review.kind === 'SHIPPER_BY_CUSTOMER' ? 'CUSTOMER' : 'SHOP', stars: review.stars, comment: review.comment, visibility: review.visibility, created_at: iso(review.createdAtMs) },
      adjustments: adjustments.map((a) => ({
        adjustment_id: a.adjustmentId,
        kind: a.kind,
        original_state: a.originalState,
        original_assignment_status: a.originalAssignmentStatus,
        corrected_result: a.correctedResult,
        direction: a.direction,
        amount_vnd: a.amountVnd,
        status: a.status,
        pending_reason: a.pendingReason,
        history_reviewed: a.historyReviewed,
        successor_delivery_ids: [...a.successorDeliveryIds],
        reason: a.reason,
        created_at: iso(a.createdAtMs),
        updated_at: iso(a.updatedAtMs),
      })),
      finance: { allowed: auth.finance, integrated: this.finance.integrated },
      can,
    };
  }

  #can(c: ComplaintRow, auth: Authorized, delivery: DeliveryRow | undefined, adjustments: readonly AdjustmentRow[], reconsiderationPending: boolean): string[] {
    const adjusted = adjustments.map((a) => a.kind);
    if (!complaintInScope(c, auth.manage)) {
      return [];
    }
    const open = OPEN_STATUSES.includes(c.status);
    const working = c.status === 'IN_PROGRESS' || c.status === 'AWAITING_INFO';
    const can: string[] = ['note'];
    if (c.status === 'PENDING') {
      can.push('receive');
    }
    if (open) {
      can.push('assign', 'close');
    }
    if (working) {
      can.push('request-info', 'conclude');
    }
    if (CLOSED_STATUSES.includes(c.status) && reconsiderationPending) {
      can.push('decide-reconsideration');
    }
    const adjustable = delivery !== undefined && (delivery.state === 'completed' || delivery.state === 'failed') && (working || c.status === 'RESOLVED');
    if (adjustable && !adjusted.includes('DELIVERY_RESULT')) {
      can.push('adjust-result');
    }
    if (adjustable && auth.finance && !adjusted.includes('COMMISSION')) {
      can.push('adjust-commission');
    }
    // The waiting money does not depend on the file's state (it may be resolved long ago) nor on the delivery: only on the two rights and on the row still waiting.
    if (auth.finance && adjustments.some((a) => a.kind === 'COMMISSION' && a.status === 'PENDING_FINANCE')) {
      can.push('retry-commission');
    }
    return can;
  }

  async #handlers(context: TransactionContext, view: FeedbackScope): Promise<{ user_id: string; name: string; role: string }[]> {
    const out: { user_id: string; name: string; role: string }[] = [];
    const system = await this.memberships.findSystemUserId(context);
    if (system !== undefined) {
      out.push({ user_id: system, name: 'Quản trị hệ thống', role: 'SYSTEM' });
    }
    const admins = await this.permissions.listAdministrators(context, { status: 'ACTIVE', search: { pattern: null, phoneDigits: null }, cursor: null, fetch: 200 });
    const rights = await this.permissions.permissionsOf(context, admins.map((a) => a.userId));
    for (const admin of admins) {
      // Issue #261: only administrators who can handle something inside the caller's own scope are listed.
      const manage = manageScopeOf(rights.get(admin.userId) ?? []);
      if ((manage.shop && view.shop) || (manage.driver && view.driver)) {
        out.push({ user_id: admin.userId, name: admin.fullName, role: 'ADMIN' });
      }
    }
    return out;
  }

  /** May this administrator take a complaint now? (the assignee must be able to handle it, or the file would be unreachable) */
  async #mayHandle(context: TransactionContext, userId: string, c: ComplaintRow): Promise<boolean> {
    if (!isCanonicalUuid(userId)) {
      return false;
    }
    const membership = await this.memberships.find(context, userId);
    if (membership === undefined || membership.status !== 'ACTIVE') {
      return false;
    }
    if (membership.adminRole === 'SYSTEM') {
      return true;
    }
    return complaintInScope(c, manageScopeOf(await this.permissions.permissions(context, userId)));
  }

  // ---- authorization -----------------------------------------------------------------------------------------------------------

  /**
   * Actor locks in the module order, the CURRENT permission rows (ADMIN), the database clock after the last lock, then the right. The money right is read
   * as its own grant row (FOR SHARE, kept to the end of the transaction, so a revocation waits for a command that already passed).
   */
  async #authorize(context: TransactionContext, known: SessionLookup, right: Right): Promise<Authorized> {
    const locked = await this.actor.lock(context, known, { user: 'read', factor: 'read' });
    const role = locked.checked.membership.adminRole;
    const rows = role === 'ADMIN' ? await this.permissions.permissions(context, known.userId) : [];
    const nowMs = await freshClockMs(context);
    this.actor.assertSessionLive(locked, nowMs);
    if (role === 'SYSTEM') {
      const all = { shop: true, driver: true };
      return { role, actorId: known.userId, handle: true, view: all, manage: all, finance: true };
    }
    const view = viewScopeOf(rows);
    const manage = manageScopeOf(rows);
    const mayView = view.shop || view.driver;
    const handle = mayHandle(rows);
    if (!mayView || (right === 'handle' && !handle)) {
      throw new AppError('ADMIN_FORBIDDEN');
    }
    // The money right is its own row (read FOR SHARE, kept to the end of the transaction): a revocation waits for a command that already passed.
    const grant = await this.grants.lockForShare(context, known.userId, FINANCE_ADJUSTMENT_RIGHT);
    return { role, actorId: known.userId, handle, view, manage, finance: grant?.state === 'GRANTED' };
  }

  async #authorizeReplay(context: TransactionContext, guard: JsonObject, known: SessionLookup, right: Right): Promise<true> {
    if (guard.actor_user_id !== known.userId || guard.action !== right) {
      throw new TechnicalError('internal', 'Invalid replay guard');
    }
    await this.#authorize(context, known, right);
    return true;
  }
}

/** Handling a complaint needs VIEW and the review right on the shop or the Shipper app: never the lock right and never a money right. */
function mayHandle(rows: readonly PermissionRow[]): boolean {
  return rows.some((r) => r.canView && r.canReviewProfile && (r.app === 'SHOP' || r.app === 'DRIVER'));
}


/** The parts of M11 an ADMIN may read: the SHOP app grant covers shop data, the DRIVER app grant covers Shipper data (issue #261). */
function viewScopeOf(rows: readonly PermissionRow[]): FeedbackScope {
  return { shop: rows.some((r) => r.canView && r.app === 'SHOP'), driver: rows.some((r) => r.canView && r.app === 'DRIVER') };
}

/** ... and may handle: VIEW and the review right on that app. The lock right and the money right are never part of this. */
function manageScopeOf(rows: readonly PermissionRow[]): FeedbackScope {
  return { shop: rows.some((r) => r.canView && r.canReviewProfile && r.app === 'SHOP'), driver: rows.some((r) => r.canView && r.canReviewProfile && r.app === 'DRIVER') };
}
