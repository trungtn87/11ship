// Controller of "Nhóm món". It owns the filter, the page, the popup and the one save in flight, and nothing else: no row is kept after the page
// is left (`dispose`). Rules that matter, each pinned by catalog-controller.spec.ts:
//  * a save sends ONE request with its own Idempotency-Key; the form is locked while it runs and a second click is ignored;
//  * a lost answer (timeout, offline, 5xx) is NOT a failure: the same key and body stay for an explicit "Thử lại", and nothing else may
//    be written meanwhile. The popup cannot be closed and "Kiểm tra lại" only re-reads the list: a list that does not show the change (or cannot
//    be loaded) proves nothing about the unanswered request, so it stays pending until an answer says ok or a clear refusal;
//  * a refusal (duplicate name, validation, conflict, no right) keeps everything the admin typed;
//  * validation only reports: the draft is never rewritten;
//  * a late answer of a page that was left, or of a filter that was replaced, is dropped.

import {
  CATALOG_MESSAGE,
  CATALOG_PAGE_SIZE,
  CatalogCommand,
  CatalogDialog,
  CatalogFilter,
  CatalogList,
  CatalogSaveResult,
  CatalogScreen,
  CatalogSource,
  CategoryDraft,
  CategoryRow,
  EMPTY_CATALOG_FILTER,
  validateCategoryDraft,
} from './catalog.js';

export interface CatalogDeps {
  readonly source: CatalogSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  /** An answer said 401: the session is gone (the caller goes back to login). */
  readonly onSessionLost: () => void;
  /** An answer said 403: the caller re-reads the administrator's rights. */
  readonly onForbidden: () => void;
}

type Listener = (screen: CatalogScreen) => void;

interface Intent {
  readonly command: CatalogCommand;
  /** What to say after it succeeded. */
  readonly done: string;
}

export class CatalogController {
  #filter: CatalogFilter = EMPTY_CATALOG_FILTER;
  #list: CatalogList = { kind: 'loading' };
  #dialog: CatalogDialog | undefined;
  #notice: string | undefined;
  #intent: Intent | undefined;
  #latest = 0;
  #disposed = false;
  readonly #listeners = new Set<Listener>();

  constructor(private readonly deps: CatalogDeps) {}

  get screen(): CatalogScreen {
    return {
      name: 'categories',
      filter: this.#filter,
      list: this.#list,
      ...(this.#dialog === undefined ? {} : { dialog: this.#dialog }),
      ...(this.#notice === undefined ? {} : { notice: this.#notice }),
    };
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#disposed = true;
    this.#latest += 1;
    this.#intent = undefined;
    this.#dialog = undefined;
    this.#listeners.clear();
  }

  #emit(): void {
    if (this.#disposed) {
      return;
    }
    const screen = this.screen;
    for (const listener of [...this.#listeners]) {
      listener(screen);
    }
  }

  // ---- the list ----------------------------------------------------------------------------------------------------------

  /** Changes the filter (no request); the caller calls `load()` now or after the typing pause. Any filter change goes back to page 1. */
  filter(next: Partial<Pick<CatalogFilter, 'query' | 'status'>>): void {
    this.#filter = { ...this.#filter, ...next, page: 1 };
    this.#emit();
  }

  page(page: number): void {
    if (this.#list.kind !== 'ready' || page < 1 || page > this.#list.pages || page === this.#filter.page) {
      return;
    }
    this.#filter = { ...this.#filter, page };
    this.load();
  }

  load(): void {
    this.#latest += 1;
    const token = this.#latest;
    this.#list = { kind: 'loading' };
    this.#emit();
    const asked = this.#filter;
    void this.deps.source.list({ query: asked.query, status: asked.status, page: asked.page }).then((read) => {
      if (this.#disposed || token !== this.#latest) {
        return;
      }
      switch (read.kind) {
        case 'not-wired':
          this.#list = { kind: 'not-wired', reason: read.reason };
          break;
        case 'failed':
          if (read.failure === 'session-expired') {
            this.deps.onSessionLost();
            return;
          }
          if (read.failure === 'forbidden') {
            this.deps.onForbidden();
          }
          this.#list = { kind: 'failed', failure: read.failure, ...(read.retryAfterSec === undefined ? {} : { retryAfterSec: read.retryAfterSec }) };
          break;
        case 'ready': {
          const pages = Math.max(1, Math.ceil(read.total / CATALOG_PAGE_SIZE));
          if (read.rows.length === 0 && read.total > 0 && asked.page > pages) {
            // The last page emptied meanwhile: show the new last one.
            this.#filter = { ...asked, page: pages };
            this.load();
            return;
          }
          this.#list =
            read.total === 0
              ? { kind: 'empty', filtered: asked.query.trim() !== '' || asked.status !== 'ALL' }
              : { kind: 'ready', rows: read.rows, total: read.total, pages, nextSortOrder: read.nextSortOrder };
          break;
        }
      }
      this.#emit();
    });
  }

  // ---- the popups --------------------------------------------------------------------------------------------------------

  beginCreate(): void {
    if (this.#dialog !== undefined || this.#list.kind === 'not-wired') {
      return;
    }
    const next = this.#list.kind === 'ready' ? this.#list.nextSortOrder : 0;
    this.#notice = undefined;
    this.#dialog = { kind: 'form', mode: 'create', draft: { name: '', sortOrder: String(next), status: 'ACTIVE' }, errors: {}, phase: 'form' };
    this.#emit();
  }

  beginEdit(id: string): void {
    const row = this.#row(id);
    if (row === undefined || this.#dialog !== undefined) {
      return;
    }
    this.#notice = undefined;
    this.#dialog = { kind: 'form', mode: 'edit', id, draft: { name: row.name, sortOrder: String(row.sortOrder), status: row.status }, errors: {}, phase: 'form' };
    this.#emit();
  }

  beginToggle(id: string): void {
    const row = this.#row(id);
    if (row === undefined || this.#dialog !== undefined) {
      return;
    }
    this.#notice = undefined;
    this.#dialog = { kind: 'toggle', id, name: row.name, to: row.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE', itemCount: row.itemCount, phase: 'form' };
    this.#emit();
  }

  /** Typing in the form: the draft changes, nothing is sent, nothing is rewritten. A previous refusal of the name is cleared by typing. */
  edit(draft: CategoryDraft): void {
    const dialog = this.#dialog;
    if (dialog === undefined || dialog.kind !== 'form' || (dialog.phase !== 'form' && dialog.phase !== 'failed')) {
      return;
    }
    this.#dialog = { kind: 'form', mode: dialog.mode, ...(dialog.id === undefined ? {} : { id: dialog.id }), draft, errors: {}, phase: 'form' };
    this.#emit();
  }

  /** "Hủy" / Esc. Not while a request is running or unanswered: its key and body must be retried, never abandoned. */
  cancel(): void {
    const dialog = this.#dialog;
    if (dialog === undefined || dialog.phase === 'working' || this.#intent !== undefined) {
      return;
    }
    this.#dialog = undefined;
    this.#emit();
  }

  // ---- saving ------------------------------------------------------------------------------------------------------------

  /** "Lưu" of the form, "Ngừng dùng" / "Kích hoạt" of the confirmation. A NEW intent with a NEW key. */
  submit(): void {
    const dialog = this.#dialog;
    if (dialog === undefined || (dialog.phase !== 'form' && dialog.phase !== 'failed') || this.#intent !== undefined) {
      return;
    }
    if (dialog.kind === 'toggle') {
      const row = this.#row(dialog.id);
      if (row === undefined) {
        return;
      }
      this.#send({
        command: { kind: 'update', id: row.id, version: row.version, name: row.name, sortOrder: row.sortOrder, status: dialog.to, key: this.deps.newKey() },
        done: dialog.to === 'ACTIVE' ? `Đã kích hoạt lại nhóm «${row.name}».` : `Đã ngừng dùng nhóm «${row.name}».`,
      });
      return;
    }
    const checked = validateCategoryDraft(dialog.draft, dialog.mode === 'create');
    if (!checked.ok) {
      this.#dialog = { ...dialog, errors: checked.errors, phase: 'form' };
      this.#emit();
      return;
    }
    const value = checked.value;
    if (dialog.mode === 'create') {
      this.#send({ command: { kind: 'create', name: value.name, sortOrder: value.sortOrder, status: value.status, key: this.deps.newKey() }, done: `Đã thêm nhóm «${value.name}».` });
      return;
    }
    const row = dialog.id === undefined ? undefined : this.#row(dialog.id);
    if (row === undefined || value.sortOrder === null) {
      return;
    }
    this.#send({
      command: { kind: 'update', id: row.id, version: row.version, name: value.name, sortOrder: value.sortOrder, status: value.status, key: this.deps.newKey() },
      done: `Đã lưu nhóm «${value.name}».`,
    });
  }

  /** After an unknown outcome: the SAME request (key and body), once more. */
  retry(): void {
    const dialog = this.#dialog;
    const intent = this.#intent;
    if (dialog === undefined || dialog.phase !== 'unknown' || intent === undefined) {
      return;
    }
    void this.#run(intent);
  }

  /** After an unknown outcome: read the list again for the admin to look at. The unanswered request stays pending (same key and body). */
  recheck(): void {
    const dialog = this.#dialog;
    if (dialog === undefined || dialog.phase !== 'unknown' || this.#intent === undefined) {
      return;
    }
    this.load();
  }

  /** After a version conflict: read the list again; the popup closes (what the admin typed is shown again by opening the group). */
  reload(): void {
    if (this.#intent !== undefined) {
      return;
    }
    this.#dialog = undefined;
    this.#emit();
    this.load();
  }

  /** "Xem nhóm cũ": the inactive twin of the name just refused. The popup closes and the list shows the inactive groups of that name. */
  showTwin(): void {
    const dialog = this.#dialog;
    if (dialog === undefined || dialog.kind !== 'form' || dialog.inactiveTwin !== true) {
      return;
    }
    const name = dialog.draft.name;
    this.#dialog = undefined;
    this.#intent = undefined;
    this.#filter = { query: name.trim(), status: 'INACTIVE', page: 1 };
    this.#emit();
    this.load();
  }

  #send(intent: Intent): void {
    this.#intent = intent;
    void this.#run(intent);
  }

  async #run(intent: Intent): Promise<void> {
    const dialog = this.#dialog;
    if (dialog === undefined) {
      return;
    }
    this.#dialog = { ...dialog, phase: 'working', message: undefined } as CatalogDialog;
    this.#emit();
    const result = await this.deps.source.save(intent.command);
    if (this.#disposed || this.#intent !== intent) {
      return;
    }
    this.#settle(result, intent);
  }

  #settle(result: CatalogSaveResult, intent: Intent): void {
    const dialog = this.#dialog;
    if (dialog === undefined) {
      return;
    }
    const fail = (message: string, phase: 'failed' | 'conflict' | 'unknown' = 'failed', extra: object = {}): void => {
      this.#dialog = { ...dialog, ...extra, phase, message } as CatalogDialog;
      if (phase !== 'unknown') {
        this.#intent = undefined;
      }
      this.#emit();
    };
    switch (result.kind) {
      case 'ok':
        this.#intent = undefined;
        this.#dialog = undefined;
        this.#notice = intent.done;
        this.#emit();
        this.load();
        return;
      case 'unknown':
        fail(CATALOG_MESSAGE.unknown, 'unknown');
        return;
      case 'conflict':
        fail(CATALOG_MESSAGE.conflict, 'conflict');
        return;
      case 'name-taken': {
        this.#intent = undefined;
        if (dialog.kind === 'form') {
          this.#dialog = {
            ...dialog,
            phase: 'form',
            errors: { name: result.inactive ? CATALOG_MESSAGE.nameTakenInactive : CATALOG_MESSAGE.nameTaken },
            inactiveTwin: result.inactive,
            message: undefined,
          };
        } else {
          fail(CATALOG_MESSAGE.nameTaken);
        }
        this.#emit();
        return;
      }
      case 'not-found':
        this.#intent = undefined;
        this.#dialog = { ...dialog, phase: 'failed', message: CATALOG_MESSAGE.notFound } as CatalogDialog;
        this.#emit();
        this.load();
        return;
      case 'session-expired':
        this.#intent = undefined;
        this.deps.onSessionLost();
        return;
      case 'forbidden':
        fail(CATALOG_MESSAGE.forbidden);
        this.deps.onForbidden();
        return;
      case 'rate-limited':
        fail(CATALOG_MESSAGE.rateLimited);
        return;
      case 'not-wired':
        fail(CATALOG_MESSAGE.notWired);
        return;
      case 'rejected':
        fail(CATALOG_MESSAGE.rejected);
        return;
    }
  }

  #row(id: string): CategoryRow | undefined {
    return this.#list.kind === 'ready' ? this.#list.rows.find((row) => row.id === id) : undefined;
  }
}
