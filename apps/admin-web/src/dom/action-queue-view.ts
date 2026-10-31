import {
  ActionQueue,
  ActionQueueRead,
  ageText,
  QUEUE_KIND_LABEL,
  QUEUE_KINDS,
  QUEUE_SORTS,
  QUEUE_STATUS_LABEL,
  QueueItem,
  QueueKind,
  QueueQuery,
  QueueSort,
  QueueTarget,
  queueTarget,
  sourceProblemText,
  WAITING_ON_LABEL,
} from '../core/action-queue.js';
import { formatDateTime, h } from './dom.js';
import { icon } from './icons.js';
import { emptyPanel, failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Việc cần xử lý" (#216): the files that still wait, drawn from what the server sent. It sends no write: a row only OPENS the screen that owns the file
// (its endpoint checks the right and the version again). A source that is FORBIDDEN or failed is named with its reason and never drawn as an empty list or 0.
// Every node is created with createElement/textContent.

export interface ActionQueueHost {
  readonly read: (query: QueueQuery) => Promise<ActionQueueRead>;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly open: (target: QueueTarget) => void;
}

const SORT_LABEL: Record<QueueSort, string> = { oldest: 'Chờ lâu nhất trước', newest: 'Mới chờ trước' };

export class ActionQueuePanel {
  readonly element: HTMLElement;
  readonly #results: HTMLElement;
  readonly #kind: HTMLSelectElement;
  readonly #status: HTMLSelectElement;
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #sort: HTMLSelectElement;
  #latest = 0;
  #disposed = false;

  constructor(private readonly host: ActionQueueHost) {
    this.#kind = h('select', { class: 'select', 'aria-label': 'Loại việc' }, h('option', { value: '' }, 'Mọi loại việc'), ...QUEUE_KINDS.map((kind) => h('option', { value: kind }, QUEUE_KIND_LABEL[kind])));
    this.#status = h('select', { class: 'select', 'aria-label': 'Trạng thái' }, h('option', { value: '' }, 'Mọi trạng thái'), ...Object.entries(QUEUE_STATUS_LABEL).map(([value, label]) => h('option', { value }, label)));
    this.#from = h('input', { type: 'date', class: 'search-input', 'aria-label': 'Chờ từ ngày' });
    this.#to = h('input', { type: 'date', class: 'search-input', 'aria-label': 'Chờ đến ngày' });
    this.#sort = h('select', { class: 'select', 'aria-label': 'Sắp xếp' }, ...QUEUE_SORTS.map((sort) => h('option', { value: sort }, SORT_LABEL[sort])));
    const refresh = h('button', { type: 'button', class: 'btn btn-secondary btn-inline' }, icon('refresh', 18), 'Làm mới');
    refresh.addEventListener('click', () => void this.load());
    for (const control of [this.#kind, this.#status, this.#from, this.#to, this.#sort]) {
      control.addEventListener('change', () => void this.load());
    }
    this.#results = h('div', { class: 'results' });
    this.element = h(
      'section',
      { class: 'queue-files', 'aria-labelledby': 'queue-files-title' },
      h('h2', { class: 'subtitle', id: 'queue-files-title' }, 'Hồ sơ đang chờ xử lý'),
      h('div', { class: 'toolbar toolbar-filters', role: 'search' }, this.#kind, this.#status, this.#sort, refresh),
      h('div', { class: 'toolbar toolbar-filters' }, this.#from, this.#to),
      this.#results,
    );
  }

  dispose(): void {
    this.#disposed = true;
    this.#latest += 1;
  }

  /** The current filter as the query the server takes. A file's start day filters on the Vietnam calendar day the server compares. */
  query(): QueueQuery {
    const kind = this.#kind.value;
    return {
      ...(kind === '' ? {} : { kind: kind as QueueKind }),
      ...(this.#status.value === '' ? {} : { status: this.#status.value }),
      ...(this.#from.value === '' ? {} : { from: this.#from.value }),
      ...(this.#to.value === '' ? {} : { to: this.#to.value }),
      sort: this.#sort.value === 'newest' ? 'newest' : 'oldest',
    };
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#results.replaceChildren(skeleton(3));
    const read = await this.host.read(this.query());
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    if (read.kind === 'not-wired') {
      this.#results.replaceChildren(notWiredPanel(read.reason));
    } else if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#results.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
    } else {
      this.#results.replaceChildren(...this.#draw(read.queue));
    }
  }

  #draw(queue: ActionQueue): HTMLElement[] {
    const blocks: HTMLElement[] = [];
    // One line per source: a number only when the server read it; "—" and the reason when it could not (never 0).
    const summary = queue.sources.map((source) => {
      const label = QUEUE_KIND_LABEL[source.kind];
      if (source.status === 'OK') {
        return h('li', { class: 'queue-source' }, h('span', { class: 'queue-source-count' }, `${source.count}${source.truncated ? '+' : ''}`), h('span', {}, ` ${label}`));
      }
      return h('li', { class: 'queue-source queue-source-problem' }, h('span', { class: 'queue-source-count' }, '—'), h('span', {}, ` ${label}: ${sourceProblemText(source.status)}`));
    });
    blocks.push(h('ul', { class: 'queue-sources', 'aria-label': 'Các nhóm việc cần xử lý' }, ...summary));
    if (queue.sources.some((source) => source.status === 'OK' && source.truncated)) {
      blocks.push(h('p', { class: 'message message-warning', role: 'status' }, 'Một số nhóm có nhiều hồ sơ hơn danh sách hiển thị. Danh sách đang cho thấy các hồ sơ gần nhất; hãy xử lý rồi làm mới để xem tiếp.'));
    }
    if (queue.items.length === 0) {
      const anyProblem = queue.sources.some((source) => source.status !== 'OK');
      blocks.push(anyProblem ? emptyPanel('Chưa có hồ sơ nào trong các nhóm đọc được', 'Có nhóm không đọc được hoặc không có quyền xem, xem danh sách phía trên. Danh sách trống không có nghĩa là những nhóm đó không có việc.') : emptyPanel('Không có hồ sơ nào đang chờ', 'Không có hồ sơ tồn trong phạm vi quyền và bộ lọc hiện tại.'));
      return blocks;
    }
    const rows = queue.items.map((item) => this.#row(item));
    blocks.push(
      h(
        'div',
        { class: 'table-card' },
        h(
          'table',
          { class: 'table' },
          h('caption', { class: 'sub-caption' }, `${queue.total} hồ sơ · cập nhật ${formatDateTime(queue.generatedAt)}`),
          h('thead', {}, h('tr', {}, ...['Loại việc', 'Mã', 'Trạng thái', 'Lý do chờ', 'Chờ từ', 'Đã chờ', 'Bên cần xử lý', 'Thao tác'].map((label) => h('th', { scope: 'col', class: label === 'Thao tác' ? 'cell-end' : '' }, label)))),
          h('tbody', {}, ...rows),
        ),
      ),
    );
    return blocks;
  }

  #row(item: QueueItem): HTMLElement {
    const handle = item.action === 'HANDLE';
    const open = h('button', { type: 'button', class: `table-link table-action`, 'aria-label': `${handle ? 'Xử lý' : 'Xem chi tiết'} ${item.code}` }, handle ? 'Xử lý' : 'Xem chi tiết');
    open.addEventListener('click', () => this.host.open(queueTarget(item.link)));
    const age = h('span', {}, ageText(item.ageSeconds));
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Loại việc', class: 'cell-name' }, QUEUE_KIND_LABEL[item.kind]),
      h('td', { 'data-label': 'Mã' }, item.code),
      h('td', { 'data-label': 'Trạng thái' }, QUEUE_STATUS_LABEL[item.status] ?? item.status),
      h('td', { 'data-label': 'Lý do chờ' }, item.reason),
      h('td', { 'data-label': 'Chờ từ' }, formatDateTime(item.waitingSince)),
      // "Quá hạn" is printed only when the server named a rule the system already has; an absent mark means nothing about being on time.
      h('td', { 'data-label': 'Đã chờ' }, age, item.overdue === true ? h('span', { class: 'badge badge-lock' }, 'Quá hạn') : undefined),
      h('td', { 'data-label': 'Bên cần xử lý' }, item.waitingOn === null ? '—' : (WAITING_ON_LABEL[item.waitingOn] ?? item.waitingOn)),
      h('td', { 'data-label': 'Thao tác', class: 'cell-end' }, h('span', { class: 'table-actions' }, open)),
    );
  }
}
