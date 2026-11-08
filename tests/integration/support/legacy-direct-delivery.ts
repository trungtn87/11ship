import { randomUUID } from 'node:crypto';
import { OPERATIONS } from '../../../apps/backend/src/delivery/delivery-constants';
import { DeliveryRecorder } from '../../../apps/backend/src/delivery/delivery-recorder';
import { DeliveryRepository, NewDelivery } from '../../../apps/backend/src/delivery/delivery-repository';
import { dropoffAreaOf, newDeliveryCode } from '../../../apps/backend/src/delivery/delivery-rules';
import { parseCreateBody } from '../../../apps/backend/src/delivery/delivery-validation';
import { freshClockMs } from '../../../apps/backend/src/idempotency/idempotency-repository';
import { ShippingFeeAgreementService } from '../../../apps/backend/src/shipping-policy/shipping-fee-agreement-service';
import { TransactionManager } from '../../../apps/backend/src/transaction/transaction-manager';
import { AuthApp } from './auth-fixtures';

// OD-5: POST /v1/shop/me/deliveries is closed (410 DELIVERY_DIRECT_CREATE_DISABLED), so a suite that needs a shop-created (DIRECT) delivery builds it
// here, through the same repositories and services the route used (the delivery row, the fee agreement, the 'created' event with its audit and
// outbox), inside one transaction. Test support only: the application has no flag and no route for this.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LegacyDirectShop {
  readonly userId: string;
  readonly shopId: string;
}

/**
 * Creates a DIRECT delivery from the body the old route took (same snake_case fields). `distance_m` stands for the route the M14 service measured
 * (default 2 500 m when the body has a map point); a body without a map point needs `fee_band` or `agreed_fee`, as before. Returns the delivery id.
 */
export async function createLegacyDirectDelivery(app: AuthApp, shop: LegacyDirectShop, rawBody: Json & { distance_m?: number | null }): Promise<string> {
  const { distance_m: measuredM, ...wire } = rawBody;
  // The route's own parser normalizes (phone, text, fee) exactly as the old route did.
  const input = parseCreateBody(wire);
  const body = { ...wire, distance_m: measuredM };
  const nest = app.running.app;
  const transactions = nest.get(TransactionManager, { strict: false });
  const deliveries = nest.get(DeliveryRepository, { strict: false });
  const agreements = nest.get(ShippingFeeAgreementService, { strict: false });
  const recorder = nest.get(DeliveryRecorder, { strict: false });
  const lat = input.lat;
  const lng = input.lng;
  const agreed = input.agreedFee ?? undefined;
  const deliveryId = randomUUID();
  await transactions.withTransaction(async (context) => {
    const shopRow = (
      await context.query<{ name: string; phone: string; address: string; lat: number; lng: number }>(
        `SELECT name, contact_phone_normalized AS phone, address_text AS address, pickup_lat AS lat, pickup_lng AS lng FROM app.shops WHERE shop_id = $1::uuid`,
        [shop.shopId],
      )
    ).rows[0];
    if (shopRow === undefined) {
      throw new Error('fixture: the shop does not exist');
    }
    let distanceM: number | null = null;
    if (agreed === undefined) {
      if (input.feeBand !== null) {
        const band = (await agreements.bands(context))?.bands[input.feeBand];
        if (band === undefined) {
          throw new Error('fixture: no such fee band');
        }
        distanceM = band.fromM;
      } else if (lat !== null && lng !== null) {
        distanceM = body.distance_m === undefined ? 2500 : body.distance_m;
      }
    } else if (lat !== null && lng !== null) {
      distanceM = body.distance_m === undefined ? 2500 : body.distance_m;
    }
    const measured = input.feeBand === null ? distanceM : null;
    const feeMode = agreed === undefined ? 'STANDARD' : 'AGREED';
    const feePayer = input.feePayer === 'SHOP' ? 'SHOP' : 'CUSTOMER';
    const row: NewDelivery = {
      deliveryId,
      code: newDeliveryCode(),
      source: 'DIRECT',
      orderId: null,
      previousDeliveryId: null,
      shopId: shop.shopId,
      requestedBy: shop.userId,
      shopName: shopRow.name,
      shopPhone: shopRow.phone,
      pickupAddressText: shopRow.address,
      pickupLat: shopRow.lat,
      pickupLng: shopRow.lng,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      dropoffAddressText: input.addressText,
      dropoffAreaText: dropoffAreaOf(input.addressText),
      dropoffLat: lat,
      dropoffLng: lng,
      goodsDescription: input.goodsDescription,
      goodsValueVnd: input.goodsValueVnd,
      paidVnd: input.paidVnd,
      codVnd: 0,
      note: input.note,
      dropoffNote: null,
      feeMode,
      feePayer,
      feeVnd: null,
      routeDistanceM: agreed === undefined ? measured : lat !== null && lng !== null ? distanceM : null,
    };
    if (!(await deliveries.insert(context, row))) {
      throw new Error('fixture: delivery code collision');
    }
    let delivery = (await deliveries.findById(context, deliveryId))!;
    const nowMs = await freshClockMs(context);
    const common = { deliveryId, payer: feePayer as 'CUSTOMER' | 'SHOP', distanceM, createdBy: shop.userId, expiresAtMs: delivery.searchExpiresAtMs, requestId: randomUUID(), nowMs };
    if (agreed !== undefined) {
      const outcome = await agreements.createAgreed(context, { ...common, reasonCode: agreed.reasonCode, reasonNote: agreed.reasonNote, proposedFeeVnd: agreed.amountVnd });
      if (outcome.kind !== 'ok' && outcome.kind !== 'replayed') {
        throw new Error(`fixture: the agreed fee was refused (${JSON.stringify(outcome)})`);
      }
    } else {
      const outcome = await agreements.createStandard(context, common);
      if ((outcome.kind === 'ok' || outcome.kind === 'replayed') && outcome.agreement.finalFeeVnd !== null) {
        delivery = (await deliveries.update(context, deliveryId, delivery.version, { feeVnd: outcome.agreement.finalFeeVnd }))!;
      }
    }
    await recorder.record(context, {
      delivery,
      type: 'created',
      actorType: 'SHOP',
      actorId: shop.userId,
      note: null,
      operation: OPERATIONS.create,
      requestId: randomUUID(),
      metadata: { fee_mode: feeMode, source: 'DIRECT' },
    });
  });
  return deliveryId;
}

/** The same, answered like the old route did: the shop's own view of the new delivery (what `data` carried). */
export async function createLegacyDirectDeliveryView(app: AuthApp, shop: LegacyDirectShop & { readonly token: string }, body: Json & { distance_m?: number | null }): Promise<Json> {
  const id = await createLegacyDirectDelivery(app, shop, body);
  const read = await app.call('GET', `/shop/me/deliveries/${id}`, { bearer: shop.token });
  if (read.status !== 200) {
    throw new Error(`fixture: the new delivery could not be read (${read.status} ${read.text.slice(0, 200)})`);
  }
  return (JSON.parse(read.text) as { data: Json }).data;
}
