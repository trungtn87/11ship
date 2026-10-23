import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TechnicalError } from '../common/app-errors';
import { DeliveryCancel } from '../delivery/delivery-cancel';
import { DeliveryRecorder } from '../delivery/delivery-recorder';
import { DeliveryRepository } from '../delivery/delivery-repository';
import { DriverRepository } from '../driver/driver-repository';
import { freshClockMs } from '../idempotency/idempotency-repository';
import { OrderRecorder } from '../orders/order-recorder';
import { OrderRepository } from '../orders/order-repository';
import { TransactionContext } from '../transaction/transaction-context';
import { TransactionManager } from '../transaction/transaction-manager';
import { TimeoutSnapshot, timeoutDue } from './timeout-policy';

/** Hints only: each item is rechecked in its own transaction under driver -> delivery -> order locks.
 * Durable stage snapshots survive restart. SKIP LOCKED permits multiple runners; state + markers prevent repeat effects.
 */
@Injectable()
export class OrderTimeoutSweeper {
  constructor(
    private readonly transactions: TransactionManager,
    private readonly orders: OrderRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly drivers: DriverRepository,
    private readonly orderRecorder: OrderRecorder,
    private readonly deliveryRecorder: DeliveryRecorder,
    private readonly cancelling: DeliveryCancel,
  ) {}

  async sweep(): Promise<void> {
    const candidates = await this.transactions.withTransaction(async (c) => ({
      orders: (
        await c.query<{ order_id: string }>(`SELECT order_id FROM app.orders
        WHERE status='PENDING_CONFIRMATION' AND scheduled_for IS NULL AND timeout_snapshot IS NOT NULL
        AND (timeout_next_reminder_at<=clock_timestamp() OR (timeout_snapshot->>'cancel_at')::timestamptz<=clock_timestamp())
        ORDER BY timeout_next_reminder_at,order_id LIMIT 50`)
      ).rows,
      deliveries: (
        await c.query<{ delivery_id: string }>(`SELECT d.delivery_id FROM app.deliveries d
        LEFT JOIN app.delivery_assignments a ON a.delivery_id=d.delivery_id AND a.status='ACTIVE'
        WHERE d.order_id IS NOT NULL AND d.state IN ('waiting_driver','search_stopped','accepted','location_confirmed')
        AND NOT EXISTS(SELECT 1 FROM app.deliveries n WHERE n.order_id=d.order_id AND (n.created_at,n.delivery_id)>(d.created_at,d.delivery_id))
        AND ((d.state IN ('waiting_driver','search_stopped') AND (d.timeout_snapshot->>'cancel_at')::timestamptz<=clock_timestamp())
          OR (a.status='ACTIVE' AND a.picked_up_at IS NULL AND ((a.timeout_snapshot->>'cancel_at')::timestamptz<=clock_timestamp()
            OR (a.timeout_warned_at IS NULL AND (a.timeout_snapshot->>'warning_at')::timestamptz<=clock_timestamp()))))
        ORDER BY d.created_at,d.delivery_id LIMIT 50`)
      ).rows,
    }));
    for (const o of candidates.orders) await this.transactions.withTransaction((c) => this.confirmation(c, o.order_id));
    for (const d of candidates.deliveries) await this.transactions.withTransaction((c) => this.delivery(c, d.delivery_id));
  }

  async confirmation(c: TransactionContext, id: string): Promise<void> {
    if ((await c.query('SELECT 1 FROM app.orders WHERE order_id=$1::uuid FOR UPDATE SKIP LOCKED', [id])).rows.length === 0) return;
    const order = await this.orders.lockById(c, id);
    if (!order || order.status !== 'PENDING_CONFIRMATION' || order.scheduledForMs !== null) return;
    const raw = (
      await c.query<{ timeout_snapshot: TimeoutSnapshot | null; timeout_next_reminder_at: Date | null }>(
        'SELECT timeout_snapshot,timeout_next_reminder_at FROM app.orders WHERE order_id=$1::uuid',
        [id],
      )
    ).rows[0]!;
    const snapshot = raw.timeout_snapshot;
    if (!snapshot) return;
    const now = await freshClockMs(c),
      requestId = randomUUID();
    if (timeoutDue(snapshot, now)) {
      const reason = 'QUÁ HẠN QUÁN XÁC NHẬN';
      await this.markTimeout(c, requestId);
      const after = await this.orders.update(c, id, order.version, { status: 'CANCELLED_BY_SYSTEM', endedNow: 'SYSTEM', endReason: reason });
      if (!after) throw new TechnicalError('internal', 'Locked order changed');
      await this.orderRecorder.record(c, {
        order: after,
        type: 'confirmation_timeout',
        actorType: 'SYSTEM',
        actorId: null,
        operation: 'order.timeout.v1',
        requestId,
        note: reason,
        details: { before_status: order.status, source: 'timeout', ...snapshot },
        metadata: { source: 'timeout', ...snapshot },
      });
      return;
    }
    let next = raw.timeout_next_reminder_at?.getTime();
    while (next !== undefined && next <= now && next < Date.parse(snapshot.cancel_at)) {
      const at = new Date(next).toISOString();
      next += snapshot.reminder_interval * 60_000;
      await c.query('UPDATE app.orders SET timeout_next_reminder_at=$2::timestamptz,version=version+1,updated_at=clock_timestamp() WHERE order_id=$1::uuid', [
        id,
        new Date(next).toISOString(),
      ]);
      const current = (await this.orders.findById(c, id))!;
      await this.orderRecorder.record(c, {
        order: current,
        type: 'confirmation_reminder',
        actorType: 'SYSTEM',
        actorId: null,
        operation: 'order.timeout_reminder.v1',
        requestId,
        note: 'Nhắc quán xác nhận đơn',
        details: { milestone_at: at, ...snapshot },
      });
    }
  }

  async delivery(c: TransactionContext, id: string): Promise<void> {
    const peeked = await this.deliveries.findActiveAssignment(c, id);
    if (peeked && !(await this.drivers.tryLockById(c, peeked.driverId))) return;
    if ((await c.query('SELECT 1 FROM app.deliveries WHERE delivery_id=$1::uuid FOR UPDATE SKIP LOCKED', [id])).rows.length === 0) return;
    const delivery = await this.deliveries.lockById(c, id);
    if (
      !delivery?.orderId ||
      delivery.pickedUpAtMs !== null ||
      !['waiting_driver', 'search_stopped', 'accepted', 'location_confirmed'].includes(delivery.state)
    )
      return;
    const assignment = await this.deliveries.lockActiveAssignment(c, id);
    if (assignment?.assignmentId !== peeked?.assignmentId) return;
    const order = await this.orders.lockById(c, delivery.orderId);
    if (!order || order.status !== 'PREPARING') return;
    const latest = await c.query<{ delivery_id: string }>(
      'SELECT delivery_id FROM app.deliveries WHERE order_id=$1::uuid ORDER BY created_at DESC,delivery_id DESC LIMIT 1',
      [order.orderId],
    );
    if (latest.rows[0]?.delivery_id !== id) return;
    if (assignment && (assignment.pickedUpAtMs !== null || !['accepted', 'location_confirmed'].includes(delivery.state))) return;
    if (!assignment && !['waiting_driver', 'search_stopped'].includes(delivery.state)) return;
    const raw = assignment
      ? (
          await c.query<{ timeout_snapshot: TimeoutSnapshot | null; timeout_warned_at: Date | null }>(
            'SELECT timeout_snapshot,timeout_warned_at FROM app.delivery_assignments WHERE assignment_id=$1::uuid',
            [assignment.assignmentId],
          )
        ).rows[0]!
      : (
          await c.query<{ timeout_snapshot: TimeoutSnapshot | null; timeout_warned_at: null }>(
            'SELECT timeout_snapshot,NULL AS timeout_warned_at FROM app.deliveries WHERE delivery_id=$1::uuid',
            [id],
          )
        ).rows[0]!;
    const snapshot = raw.timeout_snapshot;
    if (!snapshot) return;
    const now = await freshClockMs(c),
      requestId = randomUUID();
    if (timeoutDue(snapshot, now)) {
      const reason = assignment ? 'QUÁ HẠN SHIPPER LẤY HÀNG' : 'QUÁ HẠN CHỜ SHIPPER NHẬN';
      await this.markTimeout(c, requestId);
      await this.cancelling.cancel(c, { type: 'SYSTEM', userId: null }, delivery, reason, requestId, true);
      const after = await this.orders.update(c, order.orderId, order.version, { status: 'CANCELLED_BY_SYSTEM', endedNow: 'SYSTEM', endReason: reason });
      if (!after) throw new TechnicalError('internal', 'Locked order changed');
      await this.orderRecorder.record(c, {
        order: after,
        type: 'delivery_timeout',
        actorType: 'SYSTEM',
        actorId: null,
        operation: 'order.timeout.v1',
        requestId,
        note: reason,
        details: { before_status: order.status, delivery_id: id, assignment_id: assignment?.assignmentId ?? null, ...snapshot },
        metadata: { source: 'timeout', delivery_id: id, assignment_id: assignment?.assignmentId ?? null, ...snapshot },
      });
    } else if (assignment && raw.timeout_warned_at === null && now >= Date.parse(snapshot.warning_at)) {
      await c.query(
        'UPDATE app.delivery_assignments SET timeout_warned_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE assignment_id=$1::uuid',
        [assignment.assignmentId],
      );
      const after = await this.deliveries.update(c, id, delivery.version, {});
      if (!after) throw new TechnicalError('internal', 'Locked delivery changed');
      await this.deliveryRecorder.record(c, {
        delivery: after,
        type: 'pickup_timeout_warning',
        actorType: 'SYSTEM',
        actorId: null,
        operation: 'delivery.timeout_warning.v1',
        requestId,
        assignmentId: assignment.assignmentId,
        driverId: assignment.driverId,
        note: 'Shipper chưa lấy hàng',
        metadata: { ...snapshot },
      });
    }
  }
  async markTimeout(c: TransactionContext, requestId: string): Promise<void> {
    await c.query("SELECT set_config('app.cancellation_source','timeout',true),set_config('app.cancellation_request_id',$1,true)", [requestId]);
  }
}
