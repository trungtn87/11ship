import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth-principal';
import { AppError, TechnicalError } from '../common/app-errors';
import { AssignmentRow, DeliveryRepository, DeliveryRow } from '../delivery/delivery-repository';
import { DriverRepository } from '../driver/driver-repository';
import { IdempotencyExecutor, IdempotentOutcome, JsonObject } from '../idempotency/idempotency-executor';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { isCanonicalUuid } from '../shared/identifiers';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { Caller, FeedbackActors } from './feedback-actors';
import { ATTACHMENT_MAX_COUNT, AudienceRole, FEEDBACK_SCOPE_TYPE, OPERATIONS, PartyRole, UNLINKED_ATTACHMENT_LIMIT } from './feedback-constants';
import { FEEDBACK_ORDER_PORT, FeedbackOrderPort } from './feedback-order-port';
import { FeedbackRecorder } from './feedback-recorder';
import { categoryAllowedFor, executingAssignment, partyHasDisclosure, reconsiderationOpen } from './feedback-rules';
import { AttachmentUpload, ComplaintListQuery, CreateComplaintInput, ReconsiderInput, SupplementInput } from './feedback-validation';
import { AttachmentMeta, ComplaintRepository, ComplaintRow, MessageRow, NewComplaint } from './complaint-repository';
import { attachmentVisible, complaintDetail, complaintListItem, Viewer } from './complaint-views';
import { ReviewRepository } from './review-repository';

type Key = string | readonly string[] | undefined;

interface Subject {
  readonly orderId: string | null;
  readonly deliveryId: string | null;
  readonly reviewId: string | null;
  readonly shopId: string;
  readonly shopName: string;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly driverCode: string | null;
  readonly relatedCode: string;
  readonly scopeKey: string;
}

/**
 * Complaints, the apps' side (M11.02): open one, follow it, add to it, look at pictures, ask for another review after it closed. The caller is the
 * authenticated principal and the role of the ROUTE FAMILY (customer, shop, Shipper), re-checked under the locks; what a complaint is about is resolved
 * against what the caller really is (their account's order, their shop's delivery, a delivery they carried, a rating of them), so a stranger's order or
 * delivery reads as "not found". Each write is ONE transaction opened by the idempotency executor: user, session, shop or driver row -> the complaint row
 * (or the open file of the same issue) -> the pictures -> the thread line -> audit -> outbox. The unique index on the open issue is the last line of
 * defence: a duplicate adds to the old file and a double tap changes nothing the second time. Nothing here changes a delivery, a custody, a rating or a
 * wallet: a complaint only records what the person says and what the Administration answers.
 */
@Injectable()
export class ComplaintService {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly executor: IdempotencyExecutor,
    private readonly actors: FeedbackActors,
    private readonly complaints: ComplaintRepository,
    private readonly reviews: ReviewRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly recorder: FeedbackRecorder,
    @Inject(FEEDBACK_ORDER_PORT) private readonly orders: FeedbackOrderPort,
  ) {}

  // ---- pictures ------------------------------------------------------------------------------------------------------------------

  /** Uploads one picture, unattached and owned by the caller. Not idempotent on purpose (like the menu pictures): a repeat only adds one unattached picture, bounded per account. */
  async upload(principal: AuthPrincipal, role: PartyRole, upload: AttachmentUpload): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, role, 'update');
      if ((await this.complaints.countUnlinked(context, caller.userId)) >= UNLINKED_ATTACHMENT_LIMIT) {
        throw new AppError('COMPLAINT_ATTACHMENT_LIMIT');
      }
      const attachmentId = randomUUID();
      await this.complaints.insertAttachment(context, { attachmentId, uploaderUserId: caller.userId, contentType: upload.contentType, bytes: upload.bytes });
      return { attachment_id: attachmentId, content_type: upload.contentType, byte_size: upload.bytes.length };
    });
  }

  /**
   * Opens a picture. The right comes from the complaint the picture belongs to and the line it was attached to, decided now under the caller's own locks:
   * the submitter reads what they or the Administration wrote for them, a related party only what was shown to it; an unattached picture is only its uploader's.
   */
  async readAttachment(principal: AuthPrincipal, role: PartyRole, attachmentId: string): Promise<{ contentType: string; data: Buffer }> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, role, 'share');
      const attachment = await this.complaints.findAttachment(context, attachmentId);
      if (attachment === undefined) {
        throw new AppError('COMPLAINT_ATTACHMENT_NOT_FOUND');
      }
      if (attachment.complaintId === null) {
        if (attachment.uploaderUserId !== caller.userId) {
          throw new AppError('COMPLAINT_ATTACHMENT_NOT_FOUND');
        }
        return { contentType: attachment.contentType, data: attachment.data };
      }
      const complaint = await this.complaints.findById(context, attachment.complaintId);
      const messages = complaint === undefined ? [] : await this.complaints.listMessages(context, complaint.complaintId);
      const viewer = complaint === undefined ? undefined : this.#viewerOf(caller, complaint, messages);
      if (complaint === undefined || viewer === undefined || !attachmentVisible(viewer, attachment, messages)) {
        throw new AppError('COMPLAINT_ATTACHMENT_NOT_FOUND');
      }
      return { contentType: attachment.contentType, data: attachment.data };
    });
  }

  // ---- create --------------------------------------------------------------------------------------------------------------------

  /** Opens a complaint, or adds to the open one about the same thing. */
  async create(principal: AuthPrincipal, role: PartyRole, input: CreateComplaintInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, role, OPERATIONS.complaintCreate, { category: input.category, body: input.body, order_id: input.orderId, delivery_id: input.deliveryId, review_id: input.reviewId, attachment_ids: [...input.attachmentIds].sort() }, key, async (context, caller) => {
      if (!categoryAllowedFor(role, input.category)) {
        throw new AppError('COMPLAINT_TARGET_NOT_FOUND');
      }
      const subject = await this.#subjectOf(context, caller, input);
      const attachments = await this.#lockPictures(context, caller.userId, input.attachmentIds);
      let complaint = await this.complaints.lockOpenIssue(context, caller.userId, role, input.category, subject.scopeKey);
      let appended = complaint !== undefined;
      if (complaint === undefined) {
        const candidate: NewComplaint = {
          complaintId: randomUUID(),
          code: await this.complaints.nextCode(context),
          submitterUserId: caller.userId,
          submitterRole: role,
          category: input.category,
          orderId: subject.orderId,
          deliveryId: subject.deliveryId,
          reviewId: subject.reviewId,
          shopId: subject.shopId,
          driverId: subject.driverId,
          relatedCode: subject.relatedCode,
          shopName: subject.shopName,
          driverName: subject.driverName,
          driverCode: subject.driverCode,
          scopeKey: subject.scopeKey,
          body: input.body,
        };
        if (await this.complaints.insert(context, candidate)) {
          complaint = await this.complaints.lockById(context, candidate.complaintId);
          if (complaint === undefined) {
            throw new TechnicalError('internal', 'Complaint missing after insert');
          }
          const messageId = randomUUID();
          await this.complaints.appendMessage(context, { messageId, complaintId: complaint.complaintId, kind: 'SUBMITTED', visibility: 'SUBMITTER', audienceRole: null, authorType: 'SUBMITTER', authorUserId: caller.userId, body: input.body });
          await this.complaints.linkAttachments(context, attachments.map((a) => a.attachmentId), complaint.complaintId, messageId);
          await this.recorder.complaint(context, { requestId, actorType: 'USER', actorId: caller.userId, action: OPERATIONS.complaintCreate }, complaint, 'submitted');
          return this.#created(context, caller, complaint, false);
        }
        // Another request opened the same issue between our look and our write: it is the one to add to.
        complaint = await this.complaints.lockOpenIssue(context, caller.userId, role, input.category, subject.scopeKey);
        appended = true;
        if (complaint === undefined) {
          throw new AppError('COMPLAINT_STATE_CONFLICT');
        }
      }
      const updated = await this.#addByParty(context, complaint, 'SUBMITTER', 'APPENDED', input.body, attachments, caller.userId);
      await this.recorder.complaint(context, { requestId, actorType: 'USER', actorId: caller.userId, action: OPERATIONS.complaintCreate }, updated, 'appended');
      return this.#created(context, caller, updated, appended);
    });
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------------

  /** "Phản ánh của tôi": the files I opened and, for a shop or a Shipper, the files where something was shown to me as a related party. */
  async list(principal: AuthPrincipal, role: PartyRole, query: ComplaintListQuery): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, role, 'share');
      const nowMs = await freshClockMs(context);
      const own = await this.complaints.listOfSubmitter(context, caller.userId, role, query.scope, query.limit, query.offset);
      const counts = await this.complaints.countsOfSubmitter(context, caller.userId, role);
      const items: JsonObject[] = [];
      for (const c of own) {
        const recon = (await this.complaints.listReconsiderations(context, c.complaintId)).find((r) => r.closureNo === c.closureNo);
        items.push(complaintListItem(c, nowMs, 'SUBMITTER', recon));
      }
      let involving: JsonObject[] = [];
      let involvingCounts = { open: 0, closed: 0 };
      const party = partyOf(caller);
      if (party !== undefined) {
        involving = (await this.complaints.listOfParty(context, party.role, party.id, query.scope, query.limit, query.offset)).map((c) => complaintListItem(c, nowMs, 'PARTY', undefined));
        involvingCounts = await this.complaints.countsOfParty(context, party.role, party.id);
      }
      return { counts, items, involving_me: involving, involving_me_counts: involvingCounts, scope: query.scope, limit: query.limit, offset: query.offset, server_now: new Date(nowMs).toISOString() };
    });
  }

  async read(principal: AuthPrincipal, role: PartyRole, complaintId: string): Promise<JsonObject> {
    return this.transactions.withTransaction(async (context) => {
      const caller = await this.actors.resolve(context, principal, role, 'share');
      return this.#detail(context, caller, complaintId);
    });
  }

  // ---- supplement ----------------------------------------------------------------------------------------------------------------

  /** The submitter adds text and pictures; a related party answers a request addressed to it. A closed file takes neither (it is looked at again through the reconsideration). */
  async supplement(principal: AuthPrincipal, role: PartyRole, complaintId: string, input: SupplementInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, role, OPERATIONS.complaintSupplement, { complaint_id: complaintId, body: input.body, attachment_ids: [...input.attachmentIds].sort() }, key, async (context, caller) => {
      const complaint = await this.complaints.lockById(context, complaintId);
      if (complaint === undefined) {
        throw new AppError('COMPLAINT_NOT_FOUND');
      }
      const messages = await this.complaints.listMessages(context, complaintId);
      const viewer = this.#viewerOf(caller, complaint, messages);
      if (viewer === undefined || viewer.kind === 'ADMIN') {
        throw new AppError('COMPLAINT_NOT_FOUND');
      }
      const mine = viewer.kind === 'SUBMITTER' ? ('SUBMITTER' as const) : viewer.role;
      const open = complaint.status === 'PENDING' || complaint.status === 'IN_PROGRESS' || complaint.status === 'AWAITING_INFO';
      if (!open || (viewer.kind === 'PARTY' && !(complaint.status === 'AWAITING_INFO' && complaint.awaitingFrom === mine))) {
        throw new AppError('COMPLAINT_STATE_CONFLICT');
      }
      const attachments = await this.#lockPictures(context, caller.userId, input.attachmentIds);
      const updated = await this.#addByParty(context, complaint, mine, viewer.kind === 'SUBMITTER' ? 'SUPPLEMENT' : 'PARTY_RESPONSE', input.body, attachments, caller.userId);
      await this.recorder.complaint(context, { requestId, actorType: 'USER', actorId: caller.userId, action: OPERATIONS.complaintSupplement }, updated, 'supplement');
      return { status: 200, payload: await this.#detail(context, caller, complaintId, updated) };
    });
  }

  // ---- reconsideration -----------------------------------------------------------------------------------------------------------

  /** Only the submitter, only for a closed file, only inside 7 days of the closing (server clock), once per closing. The Administration decides. */
  async requestReconsideration(principal: AuthPrincipal, role: PartyRole, complaintId: string, input: ReconsiderInput, key: Key, requestId: string): Promise<IdempotentOutcome> {
    return this.#write(principal, role, OPERATIONS.complaintReconsider, { complaint_id: complaintId, reason: input.reason }, key, async (context, caller) => {
      const complaint = await this.complaints.lockById(context, complaintId);
      if (complaint === undefined || complaint.submitterUserId !== caller.userId || complaint.submitterRole !== role) {
        throw new AppError('COMPLAINT_NOT_FOUND');
      }
      if (complaint.status !== 'RESOLVED' && complaint.status !== 'CLOSED_NO_ACTION') {
        throw new AppError('RECONSIDERATION_NOT_AVAILABLE');
      }
      const nowMs = await freshClockMs(context);
      if (!reconsiderationOpen(complaint.status, complaint.closedAtMs, nowMs)) {
        throw new AppError('RECONSIDERATION_EXPIRED');
      }
      if (!(await this.complaints.insertReconsideration(context, { requestId: randomUUID(), complaintId, closureNo: complaint.closureNo, requestedBy: caller.userId, reason: input.reason }))) {
        throw new AppError('RECONSIDERATION_NOT_AVAILABLE');
      }
      await this.complaints.appendMessage(context, { messageId: randomUUID(), complaintId, kind: 'REOPEN_REQUEST', visibility: 'SUBMITTER', audienceRole: null, authorType: 'SUBMITTER', authorUserId: caller.userId, body: input.reason });
      const bumped = await this.complaints.setStatus(context, complaintId, complaint.version, { status: complaint.status, awaitingFrom: null });
      if (bumped === undefined) {
        throw new AppError('VERSION_CONFLICT');
      }
      await this.recorder.complaint(context, { requestId, actorType: 'USER', actorId: caller.userId, action: OPERATIONS.complaintReconsider }, bumped, 'reopen_requested');
      return { status: 200, payload: await this.#detail(context, caller, complaintId, bumped) };
    });
  }

  // ---- internals -----------------------------------------------------------------------------------------------------------------

  async #write(
    principal: AuthPrincipal,
    role: PartyRole,
    operationId: string,
    logicalRequest: JsonObject,
    key: Key,
    body: (context: TransactionContext, caller: Caller) => Promise<{ status: number; payload: JsonObject }>,
  ): Promise<IdempotentOutcome> {
    return this.executor.execute(
      {
        scopeType: FEEDBACK_SCOPE_TYPE,
        scopeId: principal.userId,
        operationId,
        idempotencyKey: key,
        logicalRequest: { role, ...logicalRequest },
        replay: {
          kind: 'sensitive',
          authorize: async (context, guard): Promise<true> => {
            if (!isCanonicalUuid(guard.user_id) || guard.user_id !== principal.userId || guard.role !== role) {
              throw new TechnicalError('internal', 'Invalid replay guard');
            }
            await this.actors.resolve(context, principal, role, 'update');
            return true;
          },
        },
      },
      async (context) => {
        const caller = await this.actors.resolve(context, principal, role, 'update');
        const result = await body(context, caller);
        return { status: result.status, replayGuard: { user_id: caller.userId, role }, payload: result.payload };
      },
    );
  }

  async #created(context: TransactionContext, caller: Caller, complaint: ComplaintRow, appended: boolean): Promise<{ status: number; payload: JsonObject }> {
    return { status: appended ? 200 : 201, payload: { appended, complaint: await this.#detail(context, caller, complaint.complaintId, complaint) } };
  }

  async #detail(context: TransactionContext, caller: Caller, complaintId: string, known?: ComplaintRow): Promise<JsonObject> {
    const complaint = known ?? (await this.complaints.findById(context, complaintId));
    if (complaint === undefined) {
      throw new AppError('COMPLAINT_NOT_FOUND');
    }
    const messages = await this.complaints.listMessages(context, complaintId);
    const viewer = this.#viewerOf(caller, complaint, messages);
    if (viewer === undefined || viewer.kind === 'ADMIN') {
      throw new AppError('COMPLAINT_NOT_FOUND');
    }
    return complaintDetail({
      complaint,
      viewer,
      messages,
      attachments: await this.complaints.listAttachments(context, complaintId),
      reconsiderations: await this.complaints.listReconsiderations(context, complaintId),
      nowMs: await freshClockMs(context),
    });
  }

  /** The submitter, or a related party to which something was shown. Anyone else is not a reader of the file. */
  #viewerOf(caller: Caller, c: ComplaintRow, messages: readonly MessageRow[]): Viewer | undefined {
    if (c.submitterUserId === caller.userId && c.submitterRole === caller.role) {
      return { kind: 'SUBMITTER' };
    }
    const party = partyOf(caller);
    if (party === undefined || c.submitterRole === caller.role) {
      return undefined;
    }
    const linked = party.role === 'SHOP' ? c.shopId === party.id : c.driverId === party.id;
    return linked && partyHasDisclosure(messages, party.role) ? { kind: 'PARTY', role: party.role } : undefined;
  }

  /** A line from the submitter or a party: it may move the file back to "being handled" when it answers what was asked. */
  async #addByParty(context: TransactionContext, complaint: ComplaintRow, mine: 'SUBMITTER' | AudienceRole, kind: 'APPENDED' | 'SUPPLEMENT' | 'PARTY_RESPONSE', body: string | null, attachments: readonly AttachmentMeta[], userId: string): Promise<ComplaintRow> {
    const messageId = randomUUID();
    const fromParty = kind === 'PARTY_RESPONSE';
    await this.complaints.appendMessage(context, {
      messageId,
      complaintId: complaint.complaintId,
      kind,
      visibility: fromParty ? 'PARTY_ONLY' : 'SUBMITTER',
      audienceRole: fromParty ? (mine as AudienceRole) : null,
      authorType: fromParty ? 'PARTY' : 'SUBMITTER',
      authorUserId: userId,
      body,
    });
    await this.complaints.linkAttachments(context, attachments.map((a) => a.attachmentId), complaint.complaintId, messageId);
    const answers = complaint.status === 'AWAITING_INFO' && complaint.awaitingFrom === mine;
    const updated = await this.complaints.setStatus(context, complaint.complaintId, complaint.version, answers ? { status: 'IN_PROGRESS', awaitingFrom: null } : { status: complaint.status, awaitingFrom: complaint.awaitingFrom });
    if (updated === undefined) {
      throw new AppError('VERSION_CONFLICT');
    }
    return updated;
  }

  /** The caller's own, still unattached pictures: all of them or none (somebody else's, attached already or missing reads as one answer). */
  async #lockPictures(context: TransactionContext, userId: string, ids: readonly string[]): Promise<AttachmentMeta[]> {
    if (ids.length > ATTACHMENT_MAX_COUNT) {
      throw new AppError('COMPLAINT_ATTACHMENT_LIMIT');
    }
    const found = await this.complaints.lockUnlinkedOwned(context, ids, userId);
    if (found.length !== ids.length) {
      throw new AppError('COMPLAINT_ATTACHMENT_NOT_FOUND');
    }
    return found;
  }

  /** What the complaint is about, resolved against what the caller really is. Anything else reads as "not found". */
  async #subjectOf(context: TransactionContext, caller: Caller, input: CreateComplaintInput): Promise<Subject> {
    const notFound = (): never => {
      throw new AppError('COMPLAINT_TARGET_NOT_FOUND');
    };
    if (caller.role === 'CUSTOMER') {
      if (input.orderId === null) {
        return notFound();
      }
      const order = await this.orders.orderOfCustomer(context, input.orderId, caller.userId);
      if (order === undefined) {
        return notFound();
      }
      const all = await this.deliveries.listByOrder(context, order.orderId);
      const latest = all.at(-1);
      const driver = latest === undefined ? undefined : await this.#driverOf(context, latest);
      return {
        orderId: order.orderId,
        deliveryId: latest?.deliveryId ?? null,
        reviewId: null,
        shopId: order.shopId,
        shopName: order.shopName,
        driverId: driver?.driverId ?? null,
        driverName: driver?.name ?? null,
        driverCode: driver?.code ?? null,
        relatedCode: order.code.slice(0, 16),
        scopeKey: order.orderId,
      };
    }
    if (caller.role === 'SHOP') {
      if (input.deliveryId === null) {
        return notFound();
      }
      const delivery = await this.deliveries.findOfShop(context, input.deliveryId, caller.shop.shopId);
      if (delivery === undefined) {
        return notFound();
      }
      return this.#subjectOfDelivery(context, delivery, null);
    }
    // A Shipper: a delivery they carried (any of their assignments on it), or a rating about them.
    if (input.reviewId !== null) {
      const review = await this.reviews.findById(context, input.reviewId);
      if (review === undefined || review.driverId !== caller.driver.driverId || review.visibility !== 'VISIBLE' || review.deliveryId === null) {
        return notFound();
      }
      const delivery = await this.deliveries.findById(context, review.deliveryId);
      return delivery === undefined ? notFound() : this.#subjectOfDelivery(context, delivery, review.reviewId);
    }
    if (input.deliveryId === null) {
      return notFound();
    }
    const delivery = await this.deliveries.findById(context, input.deliveryId);
    if (delivery === undefined || !(await this.deliveries.listAssignments(context, delivery.deliveryId)).some((a) => a.driverId === caller.driver.driverId)) {
      return notFound();
    }
    return this.#subjectOfDelivery(context, delivery, null);
  }

  async #subjectOfDelivery(context: TransactionContext, delivery: DeliveryRow, reviewId: string | null): Promise<Subject> {
    const driver = await this.#driverOf(context, delivery);
    return {
      orderId: delivery.orderId,
      deliveryId: delivery.deliveryId,
      reviewId,
      shopId: delivery.shopId ?? '',
      shopName: delivery.shopName,
      driverId: driver?.driverId ?? null,
      driverName: driver?.name ?? null,
      driverCode: driver?.code ?? null,
      relatedCode: delivery.code,
      scopeKey: reviewId ?? delivery.deliveryId,
    };
  }

  /** The Shipper of a delivery: the one that carried it to its end, else the one holding it, else the last who took it. */
  async #driverOf(context: TransactionContext, delivery: DeliveryRow): Promise<{ driverId: string; name: string; code: string } | undefined> {
    const assignments: AssignmentRow[] = await this.deliveries.listAssignments(context, delivery.deliveryId);
    const chosen = executingAssignment(assignments) ?? assignments.find((a) => a.status === 'ACTIVE') ?? assignments.at(-1);
    if (chosen === undefined) {
      return undefined;
    }
    const driver = await this.drivers.findById(context, chosen.driverId);
    return driver === undefined ? undefined : { driverId: driver.driverId, name: driver.fullName.slice(0, 80), code: driver.shipperCode.slice(0, 16) };
  }
}

function partyOf(caller: Caller): { role: AudienceRole; id: string } | undefined {
  if (caller.role === 'SHOP') {
    return { role: 'SHOP', id: caller.shop.shopId };
  }
  if (caller.role === 'SHIPPER') {
    return { role: 'SHIPPER', id: caller.driver.driverId };
  }
  return undefined;
}
