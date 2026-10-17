// Model of "Danh mục › Nhóm món" (M02 dish groups): the system groups shop owners choose from when they add a dish. They are PLAIN DATA:
// dom/catalog-view.ts draws them and `CatalogSource` supplies them. The real source (core/catalog-api.ts) talks to /v1/admin/menu-categories;
// NOT_WIRED_CATALOG answers "not wired" and never invents a group. Who may open the page (SYSTEM, or an ADMIN with the catalog right) is decided
// by the server on every call; the menu only hides what a role cannot use. There is no delete: a group is switched off ("Ngừng dùng") and on again.

import { Failure } from './accounts.js';

export type CatalogStatus = 'ACTIVE' | 'INACTIVE';
export type CatalogStatusFilter = CatalogStatus | 'ALL';

export const CATALOG_STATUS_LABEL: Record<CatalogStatus, string> = { ACTIVE: 'Đang dùng', INACTIVE: 'Ngừng dùng' };
export const CATALOG_FILTER_LABEL: Record<CatalogStatusFilter, string> = { ALL: 'Tất cả', ACTIVE: 'Đang dùng', INACTIVE: 'Ngừng dùng' };

export const CATALOG_PAGE_SIZE = 10;
export const NAME_MAX = 80;
export const ORDER_MAX = 100000;

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly status: CatalogStatus;
  /** Dishes of any shop that are not deleted (visible or hidden) and belong to the group. */
  readonly itemCount: number;
  /** The group's own version: sent back with a change so a stale screen cannot overwrite a newer one. */
  readonly version: number;
  /** ISO timestamp. */
  readonly updatedAt: string;
}

export interface CatalogFilter {
  readonly query: string;
  readonly status: CatalogStatusFilter;
  /** 1-based. */
  readonly page: number;
}

export const EMPTY_CATALOG_FILTER: CatalogFilter = { query: '', status: 'ALL', page: 1 };

export type CatalogRead =
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number }
  | { readonly kind: 'ready'; readonly rows: readonly CategoryRow[]; readonly total: number; readonly nextSortOrder: number };

export type CatalogList =
  | { readonly kind: 'not-wired'; readonly reason: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly failure: Failure; readonly retryAfterSec?: number }
  | { readonly kind: 'empty'; readonly filtered: boolean }
  | { readonly kind: 'ready'; readonly rows: readonly CategoryRow[]; readonly total: number; readonly pages: number; readonly nextSortOrder: number };

export const NOT_WIRED_CATALOG_REASON = 'Nhóm món chưa được nối với máy chủ. Không có nhóm nào được hiển thị.';

// ---- the form ---------------------------------------------------------------------------------------------------------

/** What the popup shows. The order is TEXT while typing: nothing is rewritten, only reported. */
export interface CategoryDraft {
  readonly name: string;
  readonly sortOrder: string;
  readonly status: CatalogStatus;
}

export interface DraftErrors {
  readonly name?: string;
  readonly sortOrder?: string;
}

export interface ValidDraft {
  readonly name: string;
  /** null = "after the last group" (create only). */
  readonly sortOrder: number | null;
  readonly status: CatalogStatus;
}

/** The stored form of a typed name: composed (NFC), white space collapsed, trimmed. Case and Vietnamese marks are never touched. */
export function normalizeCategoryName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;

/** Reports errors only: a draft that is not valid is never repaired. `create` lets the order stay empty (= last). */
export function validateCategoryDraft(draft: CategoryDraft, create: boolean): { readonly ok: true; readonly value: ValidDraft } | { readonly ok: false; readonly errors: DraftErrors } {
  const errors: { name?: string; sortOrder?: string } = {};
  const name = normalizeCategoryName(draft.name);
  const length = [...name].length;
  if (length === 0) {
    errors.name = 'Nhập tên nhóm.';
  } else if (length > NAME_MAX) {
    errors.name = `Tên nhóm tối đa ${String(NAME_MAX)} ký tự.`;
  } else if (FORBIDDEN.test(name)) {
    errors.name = 'Tên nhóm chứa ký tự không hợp lệ.';
  }
  const typed = draft.sortOrder.trim();
  let sortOrder: number | null = null;
  if (typed === '') {
    if (!create) {
      errors.sortOrder = 'Nhập thứ tự (số nguyên không âm).';
    }
  } else if (!/^[0-9]{1,6}$/.test(typed) || Number(typed) > ORDER_MAX) {
    errors.sortOrder = `Thứ tự là số nguyên từ 0 đến ${String(ORDER_MAX)}.`;
  } else {
    sortOrder = Number(typed);
  }
  if (errors.name !== undefined || errors.sortOrder !== undefined) {
    return { ok: false, errors };
  }
  return { ok: true, value: { name, sortOrder, status: draft.status } };
}

// ---- the dialogs ------------------------------------------------------------------------------------------------------

export type CatalogPhase = 'form' | 'working' | 'unknown' | 'conflict' | 'failed';

export type CatalogDialog =
  | {
      readonly kind: 'form';
      readonly mode: 'create' | 'edit';
      /** The group being edited (edit only). */
      readonly id?: string;
      readonly draft: CategoryDraft;
      readonly errors: DraftErrors;
      readonly phase: CatalogPhase;
      /** The status-area text (server answer or guidance); never a toast. */
      readonly message?: string;
      /** A group of the same name exists and is INACTIVE: the guidance is to turn it on again. */
      readonly inactiveTwin?: boolean;
    }
  | {
      readonly kind: 'toggle';
      readonly id: string;
      readonly name: string;
      readonly to: CatalogStatus;
      readonly itemCount: number;
      readonly phase: CatalogPhase;
      readonly message?: string;
    };

export interface CatalogScreen {
  readonly name: 'categories';
  readonly filter: CatalogFilter;
  readonly list: CatalogList;
  readonly dialog?: CatalogDialog;
  /** A confirmation of the last change ("Đã thêm nhóm «…»."). */
  readonly notice?: string;
}

// ---- the source -------------------------------------------------------------------------------------------------------

export type CatalogCommand =
  | { readonly kind: 'create'; readonly name: string; readonly sortOrder: number | null; readonly status: CatalogStatus; readonly key: string }
  | { readonly kind: 'update'; readonly id: string; readonly version: number; readonly name: string; readonly sortOrder: number; readonly status: CatalogStatus; readonly key: string };

export type CatalogSaveResult =
  | { readonly kind: 'ok' }
  /** MENU_CATEGORY_VERSION_CONFLICT: somebody changed the group in between. Nothing was written. */
  | { readonly kind: 'conflict' }
  /** The name belongs to another group (case, spacing and composition ignored; marks are NOT). */
  | { readonly kind: 'name-taken'; readonly inactive: boolean }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'session-expired' }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec?: number }
  | { readonly kind: 'rejected' }
  /** The answer was lost: the save MAY have been executed. Retry with the same key only. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-wired' };

export interface CatalogQuery {
  readonly query: string;
  readonly status: CatalogStatusFilter;
  readonly page: number;
}

export interface CatalogSource {
  list(query: CatalogQuery): Promise<CatalogRead>;
  /** Sends exactly one request per call and never repeats it by itself. */
  save(command: CatalogCommand): Promise<CatalogSaveResult>;
}

export const NOT_WIRED_CATALOG: CatalogSource = {
  list: () => Promise.resolve({ kind: 'not-wired', reason: NOT_WIRED_CATALOG_REASON }),
  save: () => Promise.resolve({ kind: 'not-wired' }),
};

export const CATALOG_MESSAGE = {
  forbidden: 'Tài khoản này không còn quyền quản lý nhóm món.',
  rateLimited: 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  rejected: 'Yêu cầu không hợp lệ. Hãy tải lại trang và thử lại.',
  notWired: 'Nhóm món chưa được nối với máy chủ.',
  notFound: 'Nhóm này không còn tồn tại. Danh sách đã được tải lại.',
  unknown: 'Chưa xác nhận được kết quả. Hãy kiểm tra lại danh sách; yêu cầu này không bị gửi lại tự động. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm nhóm.',
  conflict: 'Nhóm đã được thay đổi ở nơi khác. Hãy tải lại danh sách để xem dữ liệu hiện tại trước khi sửa. Nội dung bạn đã nhập vẫn còn trên màn hình này.',
  nameTaken: 'Đã có nhóm trùng tên này. Tên nhóm không phân biệt chữ hoa/thường và khoảng trắng thừa; dấu tiếng Việt vẫn được phân biệt.',
  nameTakenInactive: 'Đã có nhóm ngừng dùng trùng tên này. Hãy kích hoạt lại nhóm cũ thay vì tạo nhóm mới.',
} as const;

/** The wording of the confirmation that switches a group off. The text is the specification; keep it exact. */
export function deactivateText(name: string): string {
  return `Ngừng dùng nhóm «${name}»? Chủ quán sẽ không chọn được nhóm này cho món mới. Các món đang thuộc nhóm vẫn được giữ nguyên.`;
}

export function activateText(name: string): string {
  return `Kích hoạt lại nhóm «${name}»? Nhóm sẽ xuất hiện lại trong bộ chọn của chủ quán.`;
}
