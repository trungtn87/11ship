import {
  CHAT_BODY_MAX,
  CHAT_REASON_MAX,
  CHAT_REASON_MIN,
  CHAT_ROLE_LABEL,
  ChatItem,
  ChatRoomRef,
  ChatRoomState,
  ChatSendRequest,
  HoldAction,
  HoldOverview,
  HoldRequest,
  HoldResult,
  OrderChatSource,
} from '../core/order-chat.js';
import { DialogHandle, openDialog } from './dialog.js';
import { formatDateTime, h, message, primary, secondary, setMessage } from './dom.js';

// "Trao đổi đơn hàng" in the Administration drawers (issue #191), shared by the Order and the Delivery detail: the one feed of messages and neutral business
// milestones of the room the server names, a composer (when the server says this account may send), and "Lưu lịch sử trao đổi" (retention, complaint hold,
// manual evidence hold). Drawn with createElement/textContent only: what people typed is text, never markup.
//
// Rules kept here: the page decides nothing (room open, may send, expired and may hold all come from the server); a message is shown only after the server
// acknowledged it; one Idempotency-Key per message / hold intent, kept until the intent ends, so an unknown outcome retries the SAME key; a refresh never
// touches the draft and keeps the reading position; a panel that is disposed (drawer changed, screen left) cancels its timer, closes its popup and ignores
// every answer that was still on its way, so the data of an earlier record is never shown in a later one.

export interface ChatPanelHost {
  readonly source: OrderChatSource;
  /** A new Idempotency-Key for a NEW intent. A retry after an unknown outcome never calls it. */
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly dialogHost?: HTMLElement;
  /** Pause between two automatic reads of the newest messages (default 15 s). */
  readonly pollMs?: number;
}

const POLL_MS = 15_000;
const STICK_PX = 24;

const compare = (a: ChatItem, b: ChatItem): number => {
  const byTime = Date.parse(a.at) - Date.parse(b.at);
  if (byTime !== 0) {
    return byTime;
  }
  // Same moment: a milestone before a message, then by id (the order the server pages in).
  const rank = (item: ChatItem): number => (item.type === 'system' ? 0 : 1);
  return rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

const normalize = (value: string): string => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const length = (value: string): number => [...value].length;

function sendText(kind: string, retryAfterSec?: number): string {
  switch (kind) {
    case 'closed':
      return 'Hồ sơ đã đóng nên không gửi thêm được. Tin chưa được gửi.';
    case 'expired':
      return 'Lịch sử trao đổi đã hết hạn lưu. Tin chưa được gửi.';
    case 'forbidden':
      return 'Tài khoản này không có quyền gửi tin trong hồ sơ này. Tin chưa được gửi.';
    case 'not-found':
      return 'Không tìm thấy hồ sơ này. Tin chưa được gửi.';
    case 'rate-limited':
      return retryAfterSec === undefined ? 'Gửi quá nhanh. Vui lòng thử lại sau ít phút.' : `Gửi quá nhanh. Vui lòng thử lại sau ${String(retryAfterSec)} giây.`;
    case 'refused':
      return 'Máy chủ từ chối tin này. Tin chưa được gửi.';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. Tin có thể đã được gửi: “Thử lại” gửi đúng tin cũ, không tạo tin thứ hai.';
    default:
      return 'Chức năng này chưa được nối với máy chủ.';
  }
}

function holdText(result: HoldResult): string | undefined {
  switch (result.kind) {
    case 'conflict':
      return 'Trạng thái giữ chứng cứ vừa thay đổi ở nơi khác. Chưa có gì bị thay đổi. Hãy đóng cửa sổ này và xem lại.';
    case 'expired':
      return 'Lịch sử trao đổi đã hết hạn lưu nên không thể giữ chứng cứ nữa.';
    case 'forbidden':
      return 'Tài khoản này không có quyền thực hiện thao tác này.';
    case 'not-found':
      return 'Không tìm thấy hồ sơ này.';
    case 'rate-limited':
      return 'Thao tác quá nhanh. Vui lòng thử lại sau ít phút.';
    case 'refused':
      return 'Máy chủ từ chối yêu cầu này (lý do 3–300 ký tự).';
    case 'unknown':
      return 'Chưa xác nhận được kết quả. “Thử lại” gửi đúng yêu cầu cũ, không tạo thêm thay đổi.';
    case 'not-wired':
      return 'Chức năng này chưa được nối với máy chủ.';
    default:
      return undefined;
  }
}

export class OrderChatPanel {
  readonly element: HTMLElement;
  readonly #room: ChatRoomRef;
  readonly #host: ChatPanelHost;
  readonly #toggle: HTMLButtonElement;
  readonly #body: HTMLElement;
  readonly #feed: HTMLElement;
  readonly #older: HTMLButtonElement;
  readonly #newer: HTMLButtonElement;
  readonly #state: HTMLElement;
  readonly #composer: HTMLFormElement;
  readonly #input: HTMLTextAreaElement;
  readonly #count: HTMLElement;
  readonly #send: HTMLButtonElement;
  readonly #sendStatus: HTMLElement;
  readonly #keep: HTMLElement;
  #items: ChatItem[] = [];
  #olderCursor: string | null = null;
  #hasOlder = false;
  #roomState: ChatRoomState | undefined;
  #overview: HoldOverview | undefined;
  #loaded = false;
  #failure: string | undefined;
  #reading = false;
  #again = false;
  #disposed = false;
  #collapsed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #handle: DialogHandle | undefined;
  /** The message being sent / retried: its body and key stay together until it is acknowledged or dropped. */
  #pending: ChatSendRequest | undefined;
  #sending = false;
  #pendingUnknown = false;
  #notice: string | undefined;

  constructor(room: ChatRoomRef, host: ChatPanelHost) {
    this.#room = room;
    this.#host = host;
    const uid = `chat-${room.kind.toLowerCase()}-${room.id.slice(0, 8)}`;
    this.#toggle = h('button', { type: 'button', class: 'chat-toggle', id: `${uid}-toggle`, 'aria-expanded': 'true', 'aria-controls': `${uid}-body` }, 'Trao đổi đơn hàng');
    this.#body = h('div', { class: 'chat-body', id: `${uid}-body` });
    this.#state = h('p', { class: 'hint chat-state', role: 'status' });
    this.#feed = h('ol', { class: 'chat-feed', 'aria-label': 'Nội dung trao đổi', tabindex: '0' });
    this.#older = secondary('Xem tin cũ hơn');
    this.#older.classList.add('btn-inline', 'chat-older');
    this.#older.hidden = true;
    this.#newer = secondary('Tải tin mới');
    this.#newer.classList.add('btn-inline', 'chat-newer');
    this.#input = h('textarea', { class: 'textarea chat-input', id: `${uid}-input`, rows: '2', 'aria-label': 'Nội dung tin nhắn', 'aria-describedby': `${uid}-note ${uid}-status`, autocomplete: 'off' });
    this.#count = h('span', { class: 'chat-count', 'aria-hidden': 'true' }, `0/${String(CHAT_BODY_MAX)}`);
    this.#send = primary('Gửi', 'submit');
    this.#send.classList.add('btn-inline');
    this.#sendStatus = message('error', `${uid}-status`);
    const note = h('p', { class: 'hint chat-note', id: `${uid}-note` }, 'Tin nhắn hiển thị cho các bên tham gia hồ sơ này (khách, quán, shipper). Không nhập thông tin mật.');
    this.#composer = h('form', { class: 'chat-composer', novalidate: '' }, this.#input, h('div', { class: 'chat-composer-row' }, this.#count, this.#send), note, this.#sendStatus);
    this.#keep = h('section', { class: 'chat-keep', 'aria-label': 'Lưu lịch sử trao đổi' });
    this.#body.append(this.#state, this.#older, this.#feed, h('div', { class: 'chat-tools' }, this.#newer), this.#composer, this.#keep);
    this.element = h('section', { class: 'detail-block chat-block', 'data-room': room.kind }, h('h3', { class: 'subtitle chat-title' }, this.#toggle), this.#body);

    this.#toggle.addEventListener('click', () => this.#setCollapsed(!this.#collapsed));
    this.#older.addEventListener('click', () => void this.#loadOlder());
    this.#newer.addEventListener('click', () => void this.refresh());
    this.#input.addEventListener('input', () => this.#onInput());
    this.#composer.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.#submit();
    });
    this.#renderComposer();
  }

  /** Reads the newest messages and the retention state, then keeps reading them while the room is open. */
  start(): void {
    this.#setState('Đang tải trao đổi…');
    void this.refresh();
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#handle?.close();
    this.#handle = undefined;
  }

  // ---- reading ---------------------------------------------------------------------------------------------------------------

  #setCollapsed(collapsed: boolean): void {
    this.#collapsed = collapsed;
    this.#toggle.setAttribute('aria-expanded', String(!collapsed));
    this.#body.hidden = collapsed;
    if (collapsed) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    } else {
      void this.refresh();
    }
  }

  #schedule(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    // A closed or expired room has nothing new to wait for; a collapsed panel does not read at all.
    if (this.#disposed || this.#collapsed || this.#roomState === undefined || !this.#roomState.open || this.#roomState.expired) {
      return;
    }
    this.#timer = setTimeout(() => void this.refresh(), this.#host.pollMs ?? POLL_MS);
  }

  /** Reads again now; a read already on its way is followed by one more, so a change just made (a send, a hold) is never missed. */
  async refresh(): Promise<void> {
    if (this.#reading) {
      this.#again = true;
      return;
    }
    do {
      this.#again = false;
      await this.#readNewest();
    } while (this.#again && !this.#disposed);
  }

  async #readNewest(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#reading = true;
    this.#newer.disabled = true;
    const [page, overview] = await Promise.all([this.#host.source.read(this.#room, null), this.#host.source.holdOverview(this.#room)]);
    this.#reading = false;
    this.#newer.disabled = false;
    if (this.#disposed) {
      return;
    }
    if (page.kind === 'not-found' || overview.kind === 'not-found') {
      this.#stop('Không tìm thấy hồ sơ này hoặc bạn không còn quyền xem trao đổi của hồ sơ.');
      return;
    }
    if (page.kind === 'not-wired') {
      this.#stop(page.reason);
      return;
    }
    if (page.kind === 'failed') {
      if (page.failure === 'session-expired') {
        this.#host.onSessionLost();
        return;
      }
      if (page.failure === 'forbidden') {
        this.#stop('Tài khoản này không có quyền xem trao đổi của hồ sơ này.');
        this.#host.onForbidden();
        return;
      }
      this.#failure = page.failure === 'offline' || page.failure === 'timeout' ? 'Mất kết nối. Chưa tải được trao đổi mới.' : page.failure === 'rate-limited' ? 'Tải quá nhanh. Vui lòng thử lại sau ít phút.' : 'Chưa tải được trao đổi.';
      this.#setState(this.#failure);
      if (!this.#loaded) {
        this.#feed.replaceChildren();
      }
      this.#schedule();
      return;
    }
    this.#failure = undefined;
    this.#merge(page.page);
    this.#roomState = page.page.room;
    if (overview.kind === 'ready') {
      this.#overview = overview.overview;
    } else if (overview.kind === 'failed' && overview.failure === 'session-expired') {
      this.#host.onSessionLost();
      return;
    }
    this.#loaded = true;
    this.#paint(false);
    this.#schedule();
  }

  #stop(text: string): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#roomState = undefined;
    this.#loaded = false;
    this.#items = [];
    this.#feed.replaceChildren();
    this.#older.hidden = true;
    this.#newer.hidden = true;
    this.#composer.hidden = true;
    this.#keep.replaceChildren();
    this.#setState(text);
  }

  /** Newest page in: new items join, known ones stay, and a gap (more new items than one page) restarts from the new page. */
  #merge(page: { readonly items: readonly ChatItem[]; readonly hasMore: boolean; readonly nextBefore: string | null }): void {
    const known = new Set(this.#items.map((item) => item.id));
    const newest = this.#items.length === 0 ? 0 : Date.parse((this.#items[this.#items.length - 1] as ChatItem).at);
    const oldestIncoming = page.items[0];
    const gap = this.#loaded && page.hasMore && oldestIncoming !== undefined && !known.has(oldestIncoming.id) && Date.parse(oldestIncoming.at) > newest;
    if (!this.#loaded || gap) {
      this.#items = [...page.items];
      this.#olderCursor = page.nextBefore;
      this.#hasOlder = page.hasMore;
      return;
    }
    const fresh = page.items.filter((item) => !known.has(item.id));
    this.#items = [...this.#items, ...fresh].sort(compare);
  }

  async #loadOlder(): Promise<void> {
    if (this.#reading || this.#disposed || this.#olderCursor === null) {
      return;
    }
    this.#reading = true;
    this.#older.disabled = true;
    const result = await this.#host.source.read(this.#room, this.#olderCursor);
    this.#reading = false;
    this.#older.disabled = false;
    if (this.#disposed) {
      return;
    }
    if (result.kind !== 'ready') {
      if (result.kind === 'failed' && result.failure === 'session-expired') {
        this.#host.onSessionLost();
        return;
      }
      this.#setState(result.kind === 'not-found' ? 'Không tìm thấy hồ sơ này.' : 'Chưa tải được tin cũ hơn. Bấm “Xem tin cũ hơn” để thử lại.');
      return;
    }
    const known = new Set(this.#items.map((item) => item.id));
    this.#items = [...result.page.items.filter((item) => !known.has(item.id)), ...this.#items].sort(compare);
    this.#olderCursor = result.page.nextBefore;
    this.#hasOlder = result.page.hasMore;
    this.#roomState = result.page.room;
    this.#paint(false, 'older');
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------------

  #setState(text: string | undefined): void {
    this.#state.textContent = text ?? '';
    this.#state.hidden = text === undefined || text === '';
  }

  #paint(stickBottom: boolean, mode: 'newest' | 'older' = 'newest'): void {
    const room = this.#roomState;
    if (room === undefined) {
      return;
    }
    const feed = this.#feed;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= STICK_PX;
    const heightBefore = feed.scrollHeight;
    const topBefore = feed.scrollTop;
    const first = !feed.hasChildNodes();
    if (room.expired) {
      feed.replaceChildren(h('li', { class: 'chat-empty' }, 'Lịch sử trao đổi đã hết hạn lưu và không còn hiển thị. Nhật ký nghiệp vụ của đơn không bị ảnh hưởng.'));
    } else if (this.#items.length === 0) {
      feed.replaceChildren(h('li', { class: 'chat-empty' }, 'Chưa có tin nhắn hoặc mốc nào.'));
    } else {
      feed.replaceChildren(...this.#items.map((item) => this.#entry(item)));
    }
    if (mode === 'older') {
      feed.scrollTop = topBefore + (feed.scrollHeight - heightBefore);
    } else if (first || atBottom || stickBottom) {
      feed.scrollTop = feed.scrollHeight;
    } else {
      feed.scrollTop = topBefore;
    }
    this.#older.hidden = !this.#hasOlder || room.expired;
    this.#newer.hidden = !room.open || room.expired;
    this.#setState(room.expired ? undefined : !room.open ? 'Hồ sơ đã đóng: chỉ xem, không gửi thêm tin.' : this.#failure);
    this.#renderComposer();
    this.#renderKeep();
  }

  #entry(item: ChatItem): HTMLElement {
    if (item.type === 'system') {
      return h('li', { class: 'chat-item chat-system', 'data-id': item.id }, h('span', { class: 'chat-system-text' }, item.text), h('time', { class: 'chat-time', datetime: item.at }, formatDateTime(item.at)));
    }
    return h(
      'li',
      { class: `chat-item chat-message${item.mine ? ' chat-mine' : ''}`, 'data-id': item.id, 'data-role': item.role },
      h('p', { class: 'chat-meta' }, h('span', { class: 'chat-name' }, item.name), h('span', { class: 'chat-role' }, CHAT_ROLE_LABEL[item.role]), h('time', { class: 'chat-time', datetime: item.at }, formatDateTime(item.at))),
      h('p', { class: 'chat-text' }, item.body),
    );
  }

  // ---- sending ---------------------------------------------------------------------------------------------------------------

  #onInput(): void {
    this.#renderComposer();
  }

  #renderComposer(): void {
    const room = this.#roomState;
    const canSend = room !== undefined && room.canSend && room.open && !room.expired;
    this.#composer.hidden = !canSend;
    const used = length(normalize(this.#input.value));
    this.#count.textContent = `${String(used)}/${String(CHAT_BODY_MAX)}`;
    this.#count.classList.toggle('chat-count-over', used > CHAT_BODY_MAX);
    // While an outcome is unknown the box is locked: the retry must carry exactly the same message under the same key.
    this.#input.disabled = this.#sending || this.#pendingUnknown;
    this.#send.disabled = this.#sending || used === 0 || used > CHAT_BODY_MAX;
    this.#send.textContent = this.#sending ? 'Đang gửi…' : this.#pendingUnknown ? 'Thử lại' : 'Gửi';
    this.#send.setAttribute('aria-busy', String(this.#sending));
  }

  async #submit(): Promise<void> {
    if (this.#sending || this.#disposed) {
      return;
    }
    if (this.#pending === undefined) {
      const body = normalize(this.#input.value);
      const used = length(body);
      if (used === 0 || used > CHAT_BODY_MAX) {
        setMessage(this.#sendStatus, used === 0 ? 'Nhập nội dung tin nhắn.' : `Tin nhắn tối đa ${String(CHAT_BODY_MAX)} ký tự.`);
        return;
      }
      this.#pending = { room: this.#room, body, key: this.#host.newKey() };
    }
    const request = this.#pending;
    this.#sending = true;
    setMessage(this.#sendStatus, undefined);
    this.#renderComposer();
    const result = await this.#host.source.send(request);
    this.#sending = false;
    if (this.#disposed) {
      return;
    }
    if (result.kind === 'session-expired') {
      this.#host.onSessionLost();
      return;
    }
    if (result.kind === 'ok') {
      // Acknowledged by the server: only now does the message exist on screen and the draft go.
      this.#pending = undefined;
      this.#pendingUnknown = false;
      this.#input.value = '';
      this.#roomState = this.#roomState === undefined ? undefined : { ...this.#roomState, open: result.room.open, canSend: result.room.canSend };
      if (!this.#items.some((item) => item.id === result.item.id)) {
        this.#items = [...this.#items, result.item].sort(compare);
      }
      this.#paint(true);
      this.#input.focus();
      void this.refresh();
      return;
    }
    if (result.kind === 'forbidden') {
      this.#host.onForbidden();
    }
    this.#pendingUnknown = result.kind === 'unknown';
    if (!this.#pendingUnknown) {
      // Refused for good: the next attempt is a new intent (new key); the draft stays so nothing typed is lost.
      this.#pending = undefined;
    }
    setMessage(this.#sendStatus, sendText(result.kind, result.kind === 'rate-limited' ? result.retryAfterSec : undefined));
    this.#renderComposer();
    if (result.kind === 'closed' || result.kind === 'expired' || result.kind === 'forbidden' || result.kind === 'not-found') {
      // The room changed under the Admin: show the server's state now (read-only / expired / gone), keep the draft in the box.
      void this.refresh();
    }
  }

  // ---- "Lưu lịch sử trao đổi" --------------------------------------------------------------------------------------------------

  #renderKeep(): void {
    const overview = this.#overview;
    if (overview === undefined) {
      this.#keep.replaceChildren();
      return;
    }
    const lines: HTMLElement[] = [];
    lines.push(h('p', { class: 'chat-keep-line' }, h('strong', {}, 'Thời hạn lưu: '), `${String(overview.retentionDays)} ngày sau khi toàn bộ hồ sơ đóng.`));
    if (overview.expired) {
      lines.push(h('p', { class: 'chat-keep-line chat-keep-expired' }, 'Đã hết hạn lưu: nội dung trao đổi không còn hiển thị và không thể khôi phục.'));
    } else if (overview.open) {
      lines.push(h('p', { class: 'chat-keep-line' }, 'Hồ sơ đang mở: chưa tính hạn xóa.'));
    } else if (overview.complaintHold || overview.manualHold !== null) {
      lines.push(h('p', { class: 'chat-keep-line' }, 'Đang được giữ: chưa tính hạn xóa.'));
    } else if (overview.expiresAt !== null) {
      lines.push(h('p', { class: 'chat-keep-line' }, h('strong', {}, 'Hết hạn lúc: '), formatDateTime(overview.expiresAt)));
    }
    if (overview.closedAt !== null) {
      lines.push(h('p', { class: 'chat-keep-line' }, h('strong', {}, 'Hồ sơ đóng lúc: '), formatDateTime(overview.closedAt)));
    }
    lines.push(h('p', { class: 'chat-keep-line chat-hold-complaint' }, h('strong', {}, 'Giữ do khiếu nại: '), overview.complaintHold ? 'Có — còn khiếu nại chưa đóng.' : 'Không'));
    lines.push(
      overview.manualHold === null
        ? h('p', { class: 'chat-keep-line chat-hold-manual' }, h('strong', {}, 'Giữ chứng cứ: '), 'Không')
        : h('p', { class: 'chat-keep-line chat-hold-manual' }, h('strong', {}, 'Giữ chứng cứ: '), `Đang giữ từ ${formatDateTime(overview.manualHold.placedAt)} — lý do: `, h('span', { class: 'chat-hold-reason' }, overview.manualHold.reason)),
    );
    const actions: HTMLElement[] = [];
    if (overview.canPlaceHold) {
      const place = secondary('Giữ chứng cứ');
      place.classList.add('btn-inline');
      place.addEventListener('click', () => this.#askHold('place'));
      actions.push(place);
    }
    if (overview.canReleaseHold) {
      const release = secondary('Kết thúc giữ chứng cứ');
      release.classList.add('btn-inline');
      release.addEventListener('click', () => this.#askHold('release'));
      actions.push(release);
    }
    this.#keep.replaceChildren(
      h('h4', { class: 'chat-keep-title' }, 'Lưu lịch sử trao đổi'),
      ...lines,
      h('p', { class: 'hint' }, 'Giữ chứng cứ không mở lại phòng trao đổi đã đóng và không khôi phục nội dung đã xóa. Khi kết thúc giữ, hạn lưu tính lại từ lúc kết thúc nếu muộn hơn lúc hồ sơ đóng; khiếu nại còn mở vẫn tiếp tục giữ.'),
      ...(this.#notice === undefined ? [] : [h('p', { class: 'notice', role: 'status' }, this.#notice)]),
      ...(actions.length === 0 ? [] : [h('div', { class: 'detail-actions' }, ...actions)]),
    );
  }

  #askHold(action: HoldAction): void {
    let intent: HoldRequest | undefined;
    const title = action === 'place' ? 'Giữ chứng cứ' : 'Kết thúc giữ chứng cứ';
    const reasonInput = h('textarea', { id: 'chat-hold-reason', class: 'textarea', rows: '3', maxlength: String(CHAT_REASON_MAX), 'aria-describedby': 'chat-hold-reason-error', 'aria-label': 'Lý do' });
    const reasonError = message('error', 'chat-hold-reason-error');
    const status = message('error', 'chat-hold-status');
    const sure = h('input', { type: 'checkbox', id: 'chat-hold-sure' });
    const sureLabel = h('label', { class: 'field-label', for: 'chat-hold-sure' }, action === 'place' ? 'Tôi xác nhận giữ lịch sử trao đổi của hồ sơ này làm chứng cứ.' : 'Tôi xác nhận kết thúc giữ chứng cứ của hồ sơ này.');
    const back = secondary('Quay lại');
    const confirm = primary(title, 'button');
    let again = false;
    const lock = (working: boolean): void => {
      reasonInput.disabled = working || again;
      sure.disabled = working || again;
      back.disabled = working;
      confirm.disabled = working;
      confirm.setAttribute('aria-busy', String(working));
    };
    const finish = async (): Promise<void> => {
      if (intent === undefined) {
        const reason = normalize(reasonInput.value);
        if (length(reason) < CHAT_REASON_MIN || length(reason) > CHAT_REASON_MAX) {
          setMessage(reasonError, length(reason) === 0 ? 'Lý do là bắt buộc.' : `Lý do từ ${String(CHAT_REASON_MIN)} đến ${String(CHAT_REASON_MAX)} ký tự.`);
          reasonInput.focus();
          return;
        }
        if (!sure.checked) {
          setMessage(reasonError, 'Hãy tích ô xác nhận trước khi tiếp tục.');
          sure.focus();
          return;
        }
        setMessage(reasonError, undefined);
        intent = { room: this.#room, action, reason, key: this.#host.newKey() };
      }
      lock(true);
      confirm.textContent = 'Đang gửi…';
      const result = await this.#host.source.hold(intent);
      if (this.#disposed) {
        return;
      }
      if (result.kind === 'ok') {
        this.#handle?.close();
        this.#handle = undefined;
        this.#notice = action === 'place' ? 'Đã giữ chứng cứ.' : 'Đã kết thúc giữ chứng cứ.';
        await this.refresh();
        return;
      }
      if (result.kind === 'session-expired') {
        this.#host.onSessionLost();
        return;
      }
      if (result.kind === 'forbidden') {
        this.#host.onForbidden();
      }
      setMessage(status, holdText(result));
      again = result.kind === 'unknown';
      lock(false);
      confirm.textContent = again ? 'Thử lại' : title;
      if (result.kind !== 'unknown') {
        // The intent ended without effect: a later try is a new intent. Conflicts / expiry / refusals only offer "Quay lại".
        intent = undefined;
        confirm.disabled = result.kind === 'conflict' || result.kind === 'expired' || result.kind === 'not-found' || result.kind === 'forbidden';
        if (result.kind === 'conflict' || result.kind === 'expired') {
          void this.refresh();
        }
      }
    };
    back.addEventListener('click', () => {
      this.#handle?.close();
      this.#handle = undefined;
    });
    confirm.addEventListener('click', () => void finish());
    this.#notice = undefined;
    this.#handle?.close();
    this.#handle = openDialog({
      title,
      description:
        action === 'place'
          ? 'Giữ nguyên lịch sử trao đổi của hồ sơ này, không để quá hạn lưu tự xóa. Không mở lại phòng đã đóng và không khôi phục nội dung đã bị xóa.'
          : 'Ngừng giữ chứng cứ thủ công. Hạn lưu tính lại từ lúc này nếu muộn hơn lúc hồ sơ đóng; khiếu nại còn mở vẫn tiếp tục giữ lịch sử.',
      body: [h('label', { class: 'field-label', for: 'chat-hold-reason' }, 'Lý do (bắt buộc, ghi vào nhật ký kiểm toán)'), reasonInput, reasonError, h('div', { class: 'field-check' }, sure, sureLabel), status],
      actions: [back, confirm],
      ...(this.#host.dialogHost === undefined ? {} : { host: this.#host.dialogHost }),
    });
  }
}
