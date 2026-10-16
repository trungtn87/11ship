// Fixed vocabulary and limits of Menu (M02-MON). Part of the contract in docs/tasks/M02-menu-contract-20261014.md; the limits
// mirror the CHECK constraints of database/migrations/1793059200000_create-menu.sql and are sent to the app in GET /shop/me/menu
// so that the two cannot drift.

export const MENU_SCOPE_TYPE = 'user';
export const MENU_ITEM_CREATE_OPERATION_ID = 'menu.item.create.v1';
export const MENU_ITEM_UPDATE_OPERATION_ID = 'menu.item.update.v1';
export const MENU_ITEM_HIDE_OPERATION_ID = 'menu.item.hide.v1';
export const MENU_ITEM_SHOW_OPERATION_ID = 'menu.item.show.v1';
export const MENU_ITEM_DELETE_OPERATION_ID = 'menu.item.delete.v1';

export const MENU_RESOURCE_TYPE = 'menu_item';
export const MENU_ITEM_CHANGED_EVENT_TYPE = 'menu.item_changed.v1';
export const MENU_EVENT_SCHEMA_VERSION = 1;

export const MENU_ITEM_NAME_MAX_LENGTH = 120;
export const MENU_PRICE_MAX_VND = 99_999_999;
/** Live (not deleted) dishes one shop may hold. The whole list is returned in one answer, so it is bounded. */
export const MENU_ITEMS_MAX_PER_SHOP = 300;
export const MENU_IMAGE_MAX_BYTES = 2_097_152;
/** Uploaded pictures one shop may hold (a picture that no dish uses any more still counts: nothing is deleted physically). */
export const MENU_IMAGES_MAX_PER_SHOP = 400;

export const MENU_IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type MenuImageContentType = (typeof MENU_IMAGE_CONTENT_TYPES)[number];

export const MENU_ITEM_STATUSES = ['VISIBLE', 'HIDDEN', 'DELETED'] as const;
export type MenuItemStatus = (typeof MENU_ITEM_STATUSES)[number];

export const MENU_LIMITS = Object.freeze({
  name_max_length: MENU_ITEM_NAME_MAX_LENGTH,
  price_max_vnd: MENU_PRICE_MAX_VND,
  items_max: MENU_ITEMS_MAX_PER_SHOP,
  image_max_bytes: MENU_IMAGE_MAX_BYTES,
});
