import { openDialog } from './components.js';

// C08 "Dirty Back/logout confirmation" of the design catalog: a form that is being filled must not be lost by accident, and
// what was typed (password, OTP) must be wiped when the person really leaves the flow. This module holds the rule for the
// whole app; screens only describe their form (layout.ts `guardForm`).
//
// Nothing here stores anything: the typed values live only in the form fields. They are never written to the URL,
// localStorage, sessionStorage or a cookie, and leaving (or releasing) the guard clears them from the fields.

export interface LeaveGuard {
  /** Whether something was typed or changed since the screen was drawn. */
  dirty(): boolean;
  /** Clears what was typed (password, OTP, ...) and ends the in-memory flows tied to the screen. Runs on every real exit. */
  wipe(): void;
}

export interface GuardHandle {
  /** The screen is done with the form (success): wipe now and stop asking. */
  release(): void;
}

export const LEAVE_COPY = {
  title: 'Bỏ thay đổi?',
  text: 'Thông tin bạn đang nhập (kể cả mật khẩu và mã OTP) sẽ bị xóa nếu thoát khỏi màn hình này.',
  stay: 'Ở lại',
  leave: 'Thoát',
} as const;

/** Shows the question. `stay` and `leave` are the two answers; closing the question without answering counts as `stay`. */
export type AskLeave = (host: HTMLElement | undefined, answers: { stay(): void; leave(): void; closed(): void }) => void;

const askWithDialog: AskLeave = (host, answers) => {
  openDialog({
    title: LEAVE_COPY.title,
    text: LEAVE_COPY.text,
    icon: 'alert',
    tone: 'neutral',
    host,
    actions: [
      { label: LEAVE_COPY.stay, kind: 'secondary', onClick: () => answers.stay() },
      { label: LEAVE_COPY.leave, kind: 'danger', onClick: () => answers.leave() },
    ],
    onClose: () => answers.closed(),
  });
};

export class LeaveController {
  #guard: LeaveGuard | undefined;
  #dialogOpen = false;

  constructor(private readonly ask: AskLeave = askWithDialog) {}

  /** One guard per screen: registering replaces (and wipes) the previous one. */
  register(guard: LeaveGuard): GuardHandle {
    this.clear();
    this.#guard = guard;
    return {
      release: () => {
        if (this.#guard === guard) {
          this.#guard = undefined;
        }
        guard.wipe();
      },
    };
  }

  /** The screen is being replaced: wipe what it kept and forget it. */
  clear(): void {
    const guard = this.#guard;
    this.#guard = undefined;
    guard?.wipe();
  }

  dirty(): boolean {
    return this.#guard?.dirty() === true;
  }

  dialogOpen(): boolean {
    return this.#dialogOpen;
  }

  /**
   * Runs `proceed` (the navigation) now when nothing would be lost; otherwise asks first. "Ở lại" (or Esc) keeps the
   * screen and its content untouched and does not navigate; "Thoát" wipes the form and navigates.
   */
  request(proceed: () => void, host?: HTMLElement): void {
    const guard = this.#guard;
    if (guard === undefined) {
      proceed();
      return;
    }
    if (!guard.dirty()) {
      this.#guard = undefined;
      guard.wipe();
      proceed();
      return;
    }
    if (this.#dialogOpen) {
      return;
    }
    this.#dialogOpen = true;
    this.ask(host, {
      stay: () => undefined,
      leave: () => {
        if (this.#guard === guard) {
          this.#guard = undefined;
        }
        guard.wipe();
        proceed();
      },
      closed: () => {
        this.#dialogOpen = false;
      },
    });
  }
}
