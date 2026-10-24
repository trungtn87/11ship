import { commandFailureText, CommandResult } from '../core/commands.js';
import { BACKUP_ERROR_TEXT, BACKUP_KIND_LABEL, BACKUP_STAGE_LABEL, BACKUP_TRIGGER_LABEL, BackupItem, BackupPage, OperationsSource, RESTORE_REASON_MAX, RESTORE_REASON_MIN, RESTORE_REFUSAL, RESTORE_STATE_LABEL, RestoreItem } from '../core/operations.js';
import { formatDateTime, h, primary, secondary } from './dom.js';
import { DialogHandle, openDialog } from './dialog.js';
import { failurePanel, notWiredPanel, skeleton } from './states.js';

// DOM of "Hệ thống › Sao lưu và phục hồi" (M12-F). SYSTEM only (the server decides again). The page never claims a backup works that was not verified: the health banner is the
// server's, "NONE" and "NOT_OFFSITE" are shown as warnings, and a restore REQUEST only records the intent: an operator restores by the runbook. No button restores anything.

export interface BackupsHost {
  readonly source: OperationsSource;
  readonly newKey: () => string;
  readonly onSessionLost: () => void;
  readonly onForbidden: () => void;
  readonly login: () => void;
  readonly home: () => void;
  readonly dialogHost?: HTMLElement;
}

const HEALTH_TEXT = { OK: 'Đạt', STALE: 'Quá hạn', NOT_OFFSITE: 'Chưa có bản ngoài VPS', NONE: 'Chưa có bản sao lưu' } as const;
const sizeText = (bytes: number | null): string => (bytes === null ? '—' : bytes < 1024 * 1024 ? `${(Math.round((bytes / 1024) * 10) / 10).toLocaleString('vi-VN')} KB` : `${(Math.round((bytes / 1048576) * 10) / 10).toLocaleString('vi-VN')} MB`);

export class BackupsView {
  readonly #body: HTMLElement;
  readonly #notice: HTMLElement;
  #dialog: DialogHandle | undefined;
  #disposed = false;
  #latest = 0;
  #poll: ReturnType<typeof setTimeout> | undefined;
  /** The Idempotency-Key of the "Sao lưu ngay" intent in flight; kept until the server has answered, so a retry after a lost answer is the SAME request. */
  #runKey: string | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: BackupsHost,
  ) {
    this.#body = h('div', { class: 'bk-body', 'aria-live': 'polite' });
    this.#notice = h('p', { class: 'notice', role: 'status', hidden: true });
    root.replaceChildren(
      h(
        'section',
        { class: 'content content-wide', 'aria-labelledby': 'backups-title' },
        h('header', { class: 'page-head' }, h('div', {}, h('h1', { class: 'title', tabindex: '-1', id: 'backups-title' }, 'Sao lưu và phục hồi'), h('p', { class: 'lead lead-last' }, 'Chỉ SYSTEM. Một bản sao lưu chỉ được tính là thành công khi đã mã hóa và đã được khôi phục thử vào cơ sở dữ liệu tạm rồi kiểm tra. Trang này ghi nhận yêu cầu khôi phục; việc khôi phục do bộ phận vận hành thực hiện theo quy trình, không có nút nào ở đây tự khôi phục dữ liệu.'))),
        this.#notice,
        this.#body,
      ),
    );
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#poll !== undefined) {
      clearTimeout(this.#poll);
    }
    this.#dialog?.close();
  }

  #say(text: string | undefined): void {
    this.#notice.textContent = text ?? '';
    this.#notice.hidden = text === undefined;
  }

  async load(): Promise<void> {
    const token = ++this.#latest;
    this.#body.setAttribute('aria-busy', 'true');
    this.#body.replaceChildren(skeleton(4));
    const read = await this.host.source.readBackups();
    if (this.#disposed || token !== this.#latest) {
      return;
    }
    this.#body.removeAttribute('aria-busy');
    if (read.kind === 'not-wired') {
      this.#body.replaceChildren(notWiredPanel(read.reason));
      return;
    }
    if (read.kind === 'failed') {
      if (read.failure === 'session-expired') {
        this.host.onSessionLost();
      } else if (read.failure === 'forbidden') {
        this.host.onForbidden();
      }
      this.#body.replaceChildren(failurePanel(read.failure, { retry: () => void this.load(), login: this.host.login, home: this.host.home }, read.retryAfterSec));
      return;
    }
    this.#body.replaceChildren(...this.#render(read.page));
    if (this.#poll !== undefined) {
      clearTimeout(this.#poll);
      this.#poll = undefined;
    }
    // While a job is queued or running the page follows it on its own (the job is picked up by the backup service within a minute).
    if (read.page.job !== null && (read.page.job.state === 'QUEUED' || read.page.job.state === 'RUNNING')) {
      this.#poll = setTimeout(() => void this.load(), 5000);
    }
  }

  async #runNow(button: HTMLButtonElement): Promise<void> {
    button.disabled = true; // a double click sends nothing more
    this.#runKey ??= this.host.newKey();
    const result = await this.host.source.runBackup({ key: this.#runKey });
    if (this.#disposed) {
      return;
    }
    if (result.kind === 'ok') {
      this.#runKey = undefined;
      this.#say('Đã xếp lịch sao lưu ngay. Bản sao được tạo ở nền; trang tự cập nhật khi chạy xong.');
      void this.load();
      return;
    }
    if (result.kind === 'session-expired') {
      this.host.onSessionLost();
      return;
    }
    if (result.kind === 'forbidden') {
      this.host.onForbidden();
    }
    if (result.kind !== 'unknown') {
      this.#runKey = undefined;
    }
    button.disabled = false;
    this.#say(commandFailureText(result, RESTORE_REFUSAL));
    if (result.kind === 'refused' || result.kind === 'conflict') {
      void this.load();
    }
  }

  #render(page: BackupPage): HTMLElement[] {
    const health = page.health;
    const banner = h(
      'div',
      { class: `bk-health bk-${health.state.toLowerCase()}`, id: 'backup-health', role: health.state === 'OK' ? 'status' : 'alert' },
      h('strong', {}, `Tình trạng: ${HEALTH_TEXT[health.state]}`),
      h('span', {}, health.message),
      h('span', { class: 'cell-sub' }, health.lastVerifiedAt === null ? 'Chưa có lần kiểm chứng nào.' : `Kiểm chứng gần nhất: ${formatDateTime(health.lastVerifiedAt)} (giờ Việt Nam)`),
    );
    const when = (value: string | null): string => (value === null ? 'Chưa có' : `${formatDateTime(value)} (giờ Việt Nam)`);
    const job = page.job;
    const jobOpen = job !== null && (job.state === 'QUEUED' || job.state === 'RUNNING');
    const run = primary('Sao lưu ngay', 'button');
    run.id = 'backup-run';
    run.disabled = jobOpen;
    run.title = jobOpen ? 'Đang có một lần sao lưu chờ hoặc đang chạy.' : '';
    run.addEventListener('click', () => void this.#runNow(run));
    const jobText = job === null ? 'Chưa có yêu cầu "Sao lưu ngay" nào.' : job.state === 'QUEUED' ? 'Đã xếp hàng, đang chờ dịch vụ sao lưu nhận việc.' : job.state === 'RUNNING' ? 'Đang chạy.' : job.state === 'DONE' ? `Lần "Sao lưu ngay" gần nhất đã xong lúc ${when(job.finishedAt)}.` : `Lần "Sao lưu ngay" gần nhất thất bại: ${BACKUP_ERROR_TEXT[job.errorCode ?? ''] ?? job.errorCode ?? '—'}`;
    const facts = h(
      'dl',
      { class: 'bk-facts', id: 'backup-facts' },
      h('dt', {}, 'Lịch chạy'),
      h('dd', {}, `Hằng ngày lúc ${page.policy.scheduleTime} (${page.policy.scheduleTimezone}); thêm một bản trước mỗi lần deploy có migration`),
      h('dt', {}, 'Bản gần nhất tạo trên VPS'),
      h('dd', { id: 'backup-latest-local' }, when(page.latestLocalAt)),
      h('dt', {}, 'Bản gần nhất đã xác minh ngoài VPS'),
      h('dd', { id: 'backup-latest-offsite' }, when(page.latestOffsiteAt)),
      h('dt', {}, 'Sao lưu ngay'),
      h('dd', {}, run, h('span', { class: 'cell-sub', id: 'backup-job-text' }, jobText)),
    );
    const policy = h(
      'ul',
      { class: 'plain-list' },
      h('li', {}, `Sao lưu hằng ngày; giữ ${String(page.policy.keepDaily)} bản ngày và ${String(page.policy.keepWeekly)} bản tuần; thêm một bản trước migration hoặc thay đổi lớn.`),
      h('li', {}, 'Bản sao nằm ngoài VPS, được mã hóa và giới hạn truy cập.'),
      h('li', {}, `Quá ${String(page.policy.maxAgeHours)} giờ không có bản mới đã kiểm chứng thì báo "Quá hạn".`),
    );
    const open = page.restoreRequests.some((r) => r.state === 'REQUESTED' || r.state === 'IN_PROGRESS');
    const rows = page.items.map((item) => this.#backupRow(item, open));
    const history =
      page.items.length === 0
        ? h('p', { class: 'empty', id: 'backup-empty' }, 'Chưa có bản sao lưu nào được ghi nhận. Việc sao lưu chạy bằng công việc của bộ phận vận hành (ops/backup/backup.sh); khi nó chạy, kết quả hiện ở đây.')
        : h('div', { class: 'table-card' }, h('table', { class: 'table', id: 'backup-table' }, h('caption', { class: 'sr-only' }, 'Lịch sử sao lưu'), h('thead', {}, h('tr', {}, ...['Bắt đầu', 'Loại', 'Kết quả', 'Kích thước', 'Phiên bản', 'Mã hóa', 'Ngoài VPS', 'Kiểm chứng', ''].map((label) => h('th', { scope: 'col' }, label)))), h('tbody', {}, ...rows)));
    const requests =
      page.restoreRequests.length === 0
        ? h('p', { class: 'empty' }, 'Chưa có yêu cầu khôi phục nào.')
        : h('ul', { class: 'rp-jobs', id: 'restore-list' }, ...page.restoreRequests.map((r) => this.#restoreRow(r)));
    return [
      banner,
      facts,
      h('section', { class: 'ov-section', 'aria-labelledby': 'bk-policy-title' }, h('h2', { class: 'subtitle', id: 'bk-policy-title' }, 'Chính sách'), policy),
      h('section', { class: 'ov-section', 'aria-labelledby': 'bk-history-title' }, h('h2', { class: 'subtitle', id: 'bk-history-title' }, 'Lịch sử sao lưu'), history),
      h('section', { class: 'ov-section', 'aria-labelledby': 'bk-restore-title' }, h('h2', { class: 'subtitle', id: 'bk-restore-title' }, 'Yêu cầu khôi phục'), requests),
    ];
  }

  #backupRow(item: BackupItem, restoreOpen: boolean): HTMLElement {
    // The steps are told apart: made on the VPS, uploaded, verified outside the VPS; "Thành công ngoài VPS" only when the copy on Drive was checked.
    const result = item.state === 'SUCCEEDED' ? (item.offsite ? 'Thành công ngoài VPS' : `Thành công, chỉ trên VPS (${BACKUP_STAGE_LABEL[item.stage]})`) : item.state === 'RUNNING' ? BACKUP_STAGE_LABEL[item.stage] : `Thất bại${item.failedStage === null ? '' : ` sau bước "${BACKUP_STAGE_LABEL[item.failedStage]}"`}`;
    let action: HTMLElement | undefined;
    if (item.restorable) {
      const button = secondary('Yêu cầu khôi phục');
      button.classList.add('btn-inline');
      button.disabled = restoreOpen;
      button.title = restoreOpen ? 'Đang có một yêu cầu khôi phục chưa xong.' : '';
      button.setAttribute('aria-label', `Yêu cầu khôi phục từ bản ${formatDateTime(item.startedAt)}`);
      button.addEventListener('click', () => this.#requestDialog(item));
      action = button;
    }
    return h(
      'tr',
      {},
      h('td', { 'data-label': 'Bắt đầu' }, formatDateTime(item.startedAt)),
      h('td', { 'data-label': 'Loại' }, BACKUP_KIND_LABEL[item.kind], h('span', { class: 'cell-sub' }, BACKUP_TRIGGER_LABEL[item.trigger])),
      h('td', { 'data-label': 'Kết quả' }, h('span', { class: `badge ${item.state === 'SUCCEEDED' && item.offsite ? 'badge-ok' : item.state === 'FAILED' ? 'badge-lock' : 'badge-wait'}` }, result), item.errorCode === null ? undefined : h('span', { class: 'cell-sub' }, BACKUP_ERROR_TEXT[item.errorCode] ?? item.errorCode)),
      h('td', { 'data-label': 'Kích thước' }, sizeText(item.sizeBytes)),
      h('td', { 'data-label': 'Phiên bản' }, item.releaseVersion ?? '—', h('span', { class: 'cell-sub' }, item.schemaVersion ?? '')),
      h('td', { 'data-label': 'Mã hóa' }, item.encrypted ? 'Có' : 'Không'),
      h('td', { 'data-label': 'Ngoài VPS' }, item.offsite ? 'Có (đã xác minh)' : 'Chưa'),
      h('td', { 'data-label': 'Kiểm chứng' }, item.verifiedAt === null ? 'Chưa' : formatDateTime(item.verifiedAt), item.verifyNote === null ? undefined : h('span', { class: 'cell-sub' }, item.verifyNote)),
      h('td', { class: 'cell-end' }, action),
    );
  }

  #restoreRow(request: RestoreItem): HTMLElement {
    let cancel: HTMLElement | undefined;
    if (request.state === 'REQUESTED') {
      const button = secondary('Hủy yêu cầu');
      button.classList.add('btn-inline');
      button.addEventListener('click', () => void this.#cancel(request, button));
      cancel = button;
    }
    return h(
      'li',
      { class: 'rp-job' },
      h('span', { class: 'rp-job-title' }, `Từ bản ${BACKUP_KIND_LABEL[request.backupKind]} ${formatDateTime(request.backupStartedAt)}`),
      h('span', { class: `badge ${request.state === 'COMPLETED' ? 'badge-ok' : request.state === 'ABORTED' || request.state === 'CANCELLED' ? 'badge-lock' : 'badge-wait'}` }, RESTORE_STATE_LABEL[request.state]),
      h('span', { class: 'cell-sub' }, `${formatDateTime(request.createdAt)} · Lý do: ${request.reason}${request.operatorNote === null ? '' : ` · Vận hành: ${request.operatorNote}`}`),
      cancel,
    );
  }

  async #cancel(request: RestoreItem, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const result = await this.host.source.cancelRestore({ requestId: request.id, expectedVersion: request.version, key: this.host.newKey() });
    if (this.#disposed) {
      return;
    }
    if (result.kind === 'ok') {
      this.#say('Đã hủy yêu cầu khôi phục và ghi vào nhật ký.');
      void this.load();
      return;
    }
    if (result.kind === 'session-expired') {
      this.host.onSessionLost();
      return;
    }
    button.disabled = false;
    this.#say(commandFailureText(result, RESTORE_REFUSAL));
    if (result.kind === 'conflict') {
      void this.load();
    }
  }

  #requestDialog(item: BackupItem): void {
    const reason = h('textarea', { class: 'textarea', rows: '4', maxlength: String(RESTORE_REASON_MAX), id: 'restore-reason', 'aria-label': 'Lý do khôi phục', placeholder: `Lý do khôi phục (bắt buộc, từ ${String(RESTORE_REASON_MIN)} ký tự, ghi vào nhật ký)` });
    const understood = h('input', { type: 'checkbox', id: 'restore-understood' });
    const error = h('p', { class: 'message message-error', role: 'alert', hidden: true });
    const confirm = primary('Gửi yêu cầu', 'button');
    const back = secondary('Quay lại');
    const scope = h(
      'ul',
      { class: 'plain-list' },
      h('li', {}, `Bản sao lưu: ${BACKUP_KIND_LABEL[item.kind]} lúc ${formatDateTime(item.startedAt)} (giờ Việt Nam), phiên bản dữ liệu ${item.schemaVersion ?? '—'}.`),
      h('li', {}, 'Mọi thay đổi SAU thời điểm này sẽ mất: đơn, giao hàng, giao dịch ví, tài khoản và phản ánh phát sinh sau đó phải được đối chiếu thủ công.'),
      h('li', {}, 'Vận hành sẽ khóa ghi, sao lưu trạng thái hiện tại trước, khôi phục vào cơ sở dữ liệu mới, đối chiếu ví/hold/đơn/giao dịch rồi mới mở lại.'),
      h('li', {}, 'Thanh toán, thông báo và tin nhắn cũ không được gửi lại.'),
      h('li', {}, 'Yêu cầu này chỉ ghi nhận ý định. Không có dữ liệu nào bị thay đổi cho đến khi vận hành thực hiện.'),
    );
    const handle = (this.#dialog = openDialog({
      title: 'Yêu cầu khôi phục dữ liệu',
      description: 'Đọc phạm vi ảnh hưởng, nhập lý do và xác nhận.',
      body: [scope, reason, h('label', { class: 'check', for: 'restore-understood' }, understood, h('span', {}, 'Tôi hiểu dữ liệu sau thời điểm của bản sao lưu này sẽ mất.')), error],
      actions: [back, confirm],
      ...(this.host.dialogHost === undefined ? {} : { host: this.host.dialogHost }),
      onDismiss: () => handle.close(),
    }));
    back.addEventListener('click', () => handle.close());
    let key: string | undefined;
    let sent: { reason: string } | undefined;
    confirm.addEventListener('click', () => {
      const why = sent?.reason ?? reason.value.trim();
      if (why.length < RESTORE_REASON_MIN || why.length > RESTORE_REASON_MAX || !understood.checked) {
        error.textContent = !understood.checked ? 'Hãy xác nhận bạn hiểu phạm vi ảnh hưởng.' : `Lý do cần từ ${String(RESTORE_REASON_MIN)} đến ${String(RESTORE_REASON_MAX)} ký tự.`;
        error.hidden = false;
        return;
      }
      // The same intent keeps the same key: a retry after an unknown outcome is the SAME request.
      key ??= this.host.newKey();
      sent = { reason: why };
      confirm.disabled = true;
      back.disabled = true;
      reason.disabled = true;
      understood.disabled = true;
      void this.host.source.requestRestore({ backupId: item.id, reason: why, key }).then((result: CommandResult) => {
        if (this.#disposed) {
          return;
        }
        if (result.kind === 'ok') {
          handle.close();
          this.#say('Đã ghi nhận yêu cầu khôi phục. Chưa có dữ liệu nào thay đổi; bộ phận vận hành sẽ thực hiện theo quy trình.');
          void this.load();
          return;
        }
        if (result.kind === 'session-expired') {
          this.host.onSessionLost();
          return;
        }
        if (result.kind === 'forbidden') {
          this.host.onForbidden();
        }
        error.textContent = commandFailureText(result, RESTORE_REFUSAL) ?? '';
        error.hidden = false;
        back.disabled = false;
        if (result.kind === 'unknown') {
          confirm.textContent = 'Thử lại';
          confirm.disabled = false;
        } else {
          sent = undefined;
          key = undefined;
          if (result.kind === 'conflict') {
            void this.load();
          }
        }
      });
    });
  }
}
