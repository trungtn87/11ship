import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../transaction/transaction-manager';
import { reminderCopy } from './notification-composer';
import { CATEGORY_OF_KIND, PICKUP_REMINDER_STALE_MS, PUSH_TTL_MS, REMINDER_GATHER_MS, SEARCH_REMINDER_STALE_MS } from './notification-constants';
import { NotificationPushQueue } from './notification-push-queue';
import { NotificationRecipients } from './notification-recipients';
import { NotificationRepository, ReminderRow } from './notification-repository';

export interface ReminderRunResult {
  readonly sent: number;
  readonly stale: number;
  readonly invalid: number;
}

/**
 * Turns the reminders M07 decided on (stored when the event was consumed) into notifications (M08.04). M07 owns the timers (5 and 15 minutes of a search, the
 * stop at 30, a pickup reminder every 5 minutes from the acceptance); M08 never starts or moves a timer. Before anything is sent EVERY reminder is checked
 * again against the rows as they are now (state, assignment, owner, deadline): a delivery that was picked up, taken back, cancelled or stopped silences its
 * reminder, and a reminder that waited past its own window is dropped, never sent late. Several deliveries due together for the same person and kind become
 * ONE notification ("Bạn còn 2 đơn chưa lấy hàng"). All state is in the table, so a restart neither resets a time nor replays old marks.
 */
@Injectable()
export class ReminderBatcher {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly repo: NotificationRepository,
    private readonly recipients: NotificationRecipients,
    private readonly pushes: NotificationPushQueue,
  ) {}

  async runOnce(): Promise<ReminderRunResult> {
    return this.transactions.withTransaction(async (context) => {
      const result = { sent: 0, stale: 0, invalid: 0 };
      const config = await this.repo.readConfig(context);
      const due = await this.repo.listDueReminders(context, REMINDER_GATHER_MS, 200);
      const clock = await context.query<{ now_ms: string }>(`SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint::text AS now_ms`);
      const nowMs = Number(clock.rows[0]?.now_ms ?? '0');

      const groups = new Map<string, { head: ReminderRow; valid: { row: ReminderRow; code: string }[] }>();
      // For one assignment only the LATEST pickup reminder counts: an older one in the same backlog is dropped, not added.
      const latestPickup = new Map<string, number>();
      for (const r of due) {
        if (r.kind === 'PICKUP' && r.assignmentId !== null) {
          latestPickup.set(r.assignmentId, Math.max(latestPickup.get(r.assignmentId) ?? 0, r.dueAtMs));
        }
      }
      for (const r of due) {
        const window = r.kind === 'PICKUP' ? PICKUP_REMINDER_STALE_MS : SEARCH_REMINDER_STALE_MS;
        if (nowMs >= r.validUntilMs || nowMs - r.dueAtMs >= window || (r.kind === 'PICKUP' && r.assignmentId !== null && latestPickup.get(r.assignmentId) !== r.dueAtMs)) {
          await this.repo.resolveReminders(context, [r.reminderId], 'SKIPPED_STALE', null);
          result.stale += 1;
          continue;
        }
        const facts = await this.recipients.reminderFacts(context, r.deliveryId, r.assignmentId);
        const ok = r.kind === 'PICKUP' ? facts.assignmentWaiting && facts.assignmentUser === r.recipientUserId : facts.searchOpen && facts.shopOwner === r.recipientUserId;
        if (!ok) {
          await this.repo.resolveReminders(context, [r.reminderId], 'SKIPPED_INVALID', null);
          result.invalid += 1;
          continue;
        }
        const key = `${r.recipientUserId}|${r.app}|${r.kind}`;
        const group = groups.get(key) ?? { head: r, valid: [] };
        group.valid.push({ row: r, code: facts.code });
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        const rows = group.valid;
        const copy = reminderCopy(group.head.kind, rows.length, rows.map((v) => v.code));
        const inserted = await this.repo.insertNotification(context, {
          notificationId: randomUUID(),
          recipientUserId: group.head.recipientUserId,
          app: group.head.app,
          kind: copy.kind,
          category: CATEGORY_OF_KIND[copy.kind],
          title: copy.title,
          body: copy.body,
          targetType: rows.length === 1 ? 'DELIVERY' : 'DELIVERY_LIST',
          targetId: rows.length === 1 ? group.head.deliveryId : null,
          targetVersion: 0,
          dedupeKey: `reminder:${group.head.kind}:${(rows[0] as { row: ReminderRow }).row.reminderId}`,
          sourceEventId: null,
          validForMs: group.head.kind === 'PICKUP' ? PICKUP_REMINDER_STALE_MS : SEARCH_REMINDER_STALE_MS,
          purgeDays: config.purgeDays,
        });
        await this.repo.resolveReminders(context, rows.map((v) => v.row.reminderId), 'SENT', inserted.notificationId);
        if (inserted.created) {
          await this.pushes.queue(context, { config, notificationId: inserted.notificationId, userId: group.head.recipientUserId, app: group.head.app, category: 'REMINDERS', pushKey: `n:${inserted.notificationId}`, ttlMs: PUSH_TTL_MS.reminder });
        }
        result.sent += rows.length;
      }
      return result;
    });
  }
}
