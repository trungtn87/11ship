export const SHOP_SETUP_RESOURCE_TYPE = 'shop';
export const SHOP_SETUP_EVENT_SCHEMA_VERSION = 1;

/** Audit actions of the setup/activation transitions. The administrator's lock/unlock keep admin.shop.disable.v1 / admin.shop.enable.v1. */
export const SHOP_SETUP_AUDIT_ACTIONS = {
  autoActivated: 'shop.auto_activated.v1',
  requestInfo: 'admin.shop.request_info.v1',
  clearRequest: 'admin.shop.clear_request.v1',
  /** Issue #252: the SYSTEM withdrew the administrator's completion request because the owner restored all four conditions of an already activated shop. */
  requestAutoCleared: 'shop.setup_request_auto_cleared.v1',
} as const;

export const SHOP_ACTIVATED_EVENT_TYPE = 'shop.activated.v1';
export const SHOP_SETUP_REQUESTED_EVENT_TYPE = 'shop.setup_requested.v1';
export const SHOP_SETUP_REQUEST_CLEARED_EVENT_TYPE = 'shop.setup_request_cleared.v1';
