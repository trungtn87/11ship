export const ADDRESS_CHANGE_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'] as const;
export type AddressChangeStatus = (typeof ADDRESS_CHANGE_STATUSES)[number];

export const ADDRESS_CHANGE_TARGET_ACTORS = ['SHOP', 'SHIPPER'] as const;
export type AddressChangeTargetActor = (typeof ADDRESS_CHANGE_TARGET_ACTORS)[number];

export const ADDRESS_CHANGE_EXPIRY_MS = 5 * 60_000; // 5 minutes to answer

export const ADDRESS_CHANGE_OPERATIONS = {
  orderRequest: 'order.address_change_request.v1',
  orderDecide: 'order.address_change_decide.v1',
  orderCancel: 'order.address_change_cancel.v1',
  deliveryRequest: 'delivery.address_change_request.v1',
  deliveryDecide: 'delivery.address_change_decide.v1',
  deliveryCancel: 'delivery.address_change_cancel.v1',
} as const;
