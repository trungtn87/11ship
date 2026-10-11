import { normalizeVietnamPhone } from '../auth/phone';
import { Platform } from './test-sms-platform';
import { ResolvedRepo, StateError, StateFailure, VerifiedState, readVerifiedState, resolveRepo } from './test-sms-state';
import { TestSmsPurpose } from './test-sms-types';
import { MessageDetail, MessageSummary, ToolClient, ToolClientError, createToolClient } from './tool-client';

// The interactive flow of the operator tool (M01.22). Read-only: it lists messages and shows a code on purpose. It never
// resends, verifies, registers or logs in. Text is Vietnamese. Nothing here writes a code, a token or a port to a file,
// the environment or the command line; the code appears only on the screen, after the operator asked for that message.

export interface ToolIo {
  /** Returns the typed line, or undefined when input is closed. */
  ask(prompt: string): Promise<string | undefined>;
  print(line: string): void;
}

export interface ToolSessionOptions {
  readonly io: ToolIo;
  readonly platform: Platform;
  readonly repoRoot: string;
  readonly createClient?: (state: VerifiedState) => ToolClient;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Number of reconnect attempts after the backend disappeared or restarted (default 3, 1 s apart). */
  readonly reconnectAttempts?: number;
}

const PURPOSE_LABEL: Readonly<Record<TestSmsPurpose, string>> = {
  REGISTER: 'Đăng ký',
  ADMIN_ACTIVATION: 'Kích hoạt Admin',
  RESET_PASSWORD: 'Quên mật khẩu',
};

const PURPOSE_CHOICES: readonly TestSmsPurpose[] = ['REGISTER', 'ADMIN_ACTIVATION', 'RESET_PASSWORD'];

export const TOOL_TEXT = {
  title: '11Ship - Hộp OTP test (chỉ đọc)',
  noBackend: 'Backend chưa chạy ở chế độ TEST_INBOX trên máy này. Hãy khởi động backend (OTP_PROVIDER=TEST_INBOX), rồi thử lại.',
  stale: 'Backend đã dừng hoặc khởi động lại. Hộp thư cũ đã bị xoá; hãy khởi động lại backend rồi thử lại.',
  restarted: 'Backend vừa khởi động lại: hộp thư đã được xoá và phải gửi lại OTP từ ứng dụng.',
  unsafe: 'Thông tin kết nối không an toàn hoặc không thuộc bạn/repo này nên công cụ không dùng. Không có mã nào được gửi đi.',
  repo: 'Không xác định được thư mục repo 11ship. Hãy chạy công cụ từ thư mục repo.',
  unsupported: 'Hệ điều hành này chưa được hỗ trợ.',
  busy: 'Đang bị giới hạn tần suất đọc. Chờ vài giây rồi thử lại.',
  gone: 'Không tìm thấy tin nhắn này (có thể đã hết hạn sau 10 phút).',
  empty: 'Chưa có tin nhắn nào.',
  badChoice: 'Lựa chọn không hợp lệ.',
  badPhone: 'Số điện thoại không hợp lệ.',
  closed: 'Đã thoát.',
} as const;

const FAILURE_TEXT: Readonly<Record<StateFailure, string>> = {
  REPO_UNRESOLVED: TOOL_TEXT.repo,
  NOT_PRIVATE: TOOL_TEXT.unsafe,
  UNSUPPORTED: TOOL_TEXT.unsupported,
  MISSING: TOOL_TEXT.noBackend,
  MALFORMED: TOOL_TEXT.unsafe,
  FOREIGN_REPO: TOOL_TEXT.unsafe,
  FOREIGN_USER: TOOL_TEXT.unsafe,
  STALE: TOOL_TEXT.stale,
  IN_USE: TOOL_TEXT.unsafe,
  WRITE_FAILED: TOOL_TEXT.unsafe,
};

function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString('vi-VN', { hour12: false });
}

function listLine(index: number, message: MessageSummary): string {
  return `${index}. ${timeOf(message.receivedAt)}  ${PURPOSE_LABEL[message.purpose].padEnd(16)} ${message.phoneMasked}`;
}

/** Runs the session and resolves with a process exit code: 0 normal exit, 1 backend/state not usable. */
export async function runToolSession(options: ToolSessionOptions): Promise<number> {
  const { io, platform } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.reconnectAttempts ?? 3;
  const makeClient = options.createClient ?? ((state: VerifiedState) => createToolClient({ host: state.host, port: state.port, token: state.token }));
  let repo: ResolvedRepo;

  io.print(TOOL_TEXT.title);
  try {
    repo = await resolveRepo(platform, options.repoRoot);
  } catch {
    io.print(TOOL_TEXT.repo);
    return 1;
  }

  let connection: { state: VerifiedState; client: ToolClient } | undefined;

  /** Verifies ownership of the published state and builds a client. Returns the failure text when it is not usable. */
  async function connect(): Promise<string | undefined> {
    try {
      const state = await readVerifiedState(platform, repo);
      if (connection !== undefined && connection.state.instanceId !== state.instanceId) {
        io.print(TOOL_TEXT.restarted);
      }
      connection = { state, client: makeClient(state) };
      return undefined;
    } catch (error) {
      connection = undefined;
      return error instanceof StateError ? FAILURE_TEXT[error.failure] : TOOL_TEXT.unsafe;
    }
  }

  /** Runs one request; if the backend vanished or restarted, re-verifies and retries a bounded number of times. */
  async function withClient<T>(action: (client: ToolClient) => Promise<T>): Promise<{ value: T } | { failure: string }> {
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      if (connection === undefined) {
        const failure = await connect();
        if (failure !== undefined) {
          if (attempt >= attempts || failure === TOOL_TEXT.unsafe) {
            return { failure };
          }
          await sleep(1000);
          continue;
        }
      }
      try {
        return { value: await action((connection as { client: ToolClient }).client) };
      } catch (error) {
        if (!(error instanceof ToolClientError)) {
          return { failure: TOOL_TEXT.unsafe };
        }
        if (error.kind === 'RATE_LIMITED') {
          return { failure: `${TOOL_TEXT.busy} (${error.retryAfterSeconds ?? 1}s)` };
        }
        if (error.kind === 'NOT_FOUND') {
          return { failure: TOOL_TEXT.gone };
        }
        if (error.kind === 'UNAUTHORIZED' || error.kind === 'UNREACHABLE' || error.kind === 'TIMEOUT') {
          // Probably a restart: drop the old connection and verify the (new) state again before using any token.
          const previous = connection?.state.instanceId;
          connection = undefined;
          if (attempt >= attempts) {
            return { failure: TOOL_TEXT.stale };
          }
          const failure = await connect();
          if (failure !== undefined) {
            await sleep(1000);
            connection = undefined;
            continue;
          }
          if (previous !== undefined && connection !== undefined && (connection as { state: VerifiedState }).state.instanceId !== previous) {
            io.print(TOOL_TEXT.restarted);
          }
          continue;
        }
        return { failure: TOOL_TEXT.unsafe };
      }
    }
    return { failure: TOOL_TEXT.stale };
  }

  async function showList(filter: { purpose?: TestSmsPurpose; phone?: string }): Promise<void> {
    const result = await withClient((client) => client.list(filter));
    if ('failure' in result) {
      io.print(result.failure);
      return;
    }
    const messages = result.value;
    if (messages.length === 0) {
      io.print(TOOL_TEXT.empty);
      return;
    }
    messages.forEach((message, index) => io.print(listLine(index + 1, message)));
    const pick = await io.ask('Nhập số thứ tự để xem mã (Enter để quay lại): ');
    const trimmed = pick?.trim() ?? '';
    if (trimmed === '') {
      return;
    }
    const chosen = /^[0-9]{1,3}$/.test(trimmed) ? messages[Number(trimmed) - 1] : undefined;
    if (chosen === undefined) {
      io.print(TOOL_TEXT.badChoice);
      return;
    }
    const detail = await withClient((client) => client.get(chosen.messageId));
    if ('failure' in detail) {
      io.print(detail.failure);
      return;
    }
    printDetail(detail.value);
  }

  function printDetail(detail: MessageDetail): void {
    io.print(`Mục đích : ${PURPOSE_LABEL[detail.purpose]}`);
    io.print(`Số điện thoại: ${detail.phoneNormalized}`);
    io.print(`Nhận lúc : ${timeOf(detail.receivedAt)}`);
    io.print(`MÃ OTP   : ${detail.otp}`);
  }

  // The first connection decides whether there is anything to do at all.
  const first = await connect();
  if (first !== undefined) {
    io.print(first);
    return 1;
  }

  for (;;) {
    io.print('');
    io.print('1) Tin mới nhất   2) Lọc theo mục đích   3) Lọc theo số điện thoại   q) Thoát');
    const answer = (await io.ask('Chọn: '))?.trim().toLowerCase();
    if (answer === undefined || answer === 'q') {
      io.print(TOOL_TEXT.closed);
      return 0;
    }
    if (answer === '1' || answer === '') {
      await showList({});
    } else if (answer === '2') {
      PURPOSE_CHOICES.forEach((purpose, index) => io.print(`${index + 1}. ${PURPOSE_LABEL[purpose]}`));
      const pick = (await io.ask('Mục đích: '))?.trim() ?? '';
      const purpose = /^[1-3]$/.test(pick) ? PURPOSE_CHOICES[Number(pick) - 1] : undefined;
      if (purpose === undefined) {
        io.print(TOOL_TEXT.badChoice);
      } else {
        await showList({ purpose });
      }
    } else if (answer === '3') {
      const typed = (await io.ask('Số điện thoại: '))?.trim() ?? '';
      const phone = normalizeVietnamPhone(typed);
      if (phone === undefined) {
        io.print(TOOL_TEXT.badPhone);
      } else {
        await showList({ phone });
      }
    } else {
      io.print(TOOL_TEXT.badChoice);
    }
  }
}
