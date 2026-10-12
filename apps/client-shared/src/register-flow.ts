import { AuthClient, AuthResult, OtpIssued, SignedIn } from './auth/client.js';
import { deadlineAfter } from './auth/contract.js';
import { ConsentOffer } from './consent.js';
import { FlowStore } from './screen.js';
import { FailureCode } from './states.js';

// The 11Food register flow as ONE in-memory object (M01.07): F11 asks for the code, F12 verifies it and registers.
//
// What it holds, in memory only: the form as it was submitted (name, phone, password, the consent pair), the OTP challenge the
// server issued (verification_id and the deadlines it computed), and - once the code is right - the one-use phone proof.
// Nothing here is written to the URL, history, any storage or any log, and none of it reaches the screen's DOM except what the
// screen shows. The password and the proof live ONLY here until the account is created or the flow is left.
//
// Rules this object enforces (the screens only display its state):
// * One call at a time. While verify / resend / register runs, another action answers IN_PROGRESS: no second request.
// * Register is ONE intent. Its input (phone, password, proof, name, consent) never changes after the code was verified, so a
//   lost or unknown answer is retried with the SAME input and the adapter replays the SAME Idempotency-Key and body. The flow
//   never goes back to the code step (or asks for a new code) because an answer has not arrived.
// * A successful resend REPLACES the challenge (new verification_id and deadlines); an answer for the old one is dropped.
// * Leaving (cancel) drops the form, the proof and the challenge and makes every answer still on its way stale - including a
//   register answer, which then establishes no session.
// * A 429 shortens nothing and invents nothing: the screen gets the server's Retry-After when there is one.

export const REGISTER_FLOW = 'register-otp';

export interface RegisterForm {
  readonly fullName: string;
  readonly phone: string;
  /** As typed: the register request sends it exactly. */
  readonly password: string;
}

/** What the screens may read. No password, no proof, no key. */
export interface RegisterView {
  readonly phone: string;
  readonly challenge: OtpIssued;
  /**
   * otp: waiting for the code. register: the code was right, the account is not created yet (the call is running or its answer
   * is unknown: "try again" replays the same request). failed: the server refused the register for good; this flow cannot go on.
   */
  readonly stage: 'otp' | 'register' | 'failed';
  readonly failure?: { readonly code: FailureCode };
  readonly busy: boolean;
}

export type RegisterStepResult =
  | { readonly kind: 'ok'; readonly value: SignedIn }
  | { readonly kind: 'failure'; readonly where: 'verify' | 'register'; readonly code: FailureCode; readonly retryAfterSeconds?: number; readonly unresolved: boolean }
  | { readonly kind: 'stale' };

export interface RegisterController {
  readonly consent: ConsentOffer;
  /** F11: asks for a REGISTER code. On success the flow exists (F12 may open). */
  begin(form: RegisterForm): Promise<AuthResult<OtpIssued>>;
  view(): RegisterView | undefined;
  /** F12: verifies the code and, when it is right, registers with the kept form. */
  verify(code: string): Promise<RegisterStepResult>;
  /** F12: registers again with the kept form and proof (after an unknown answer). Same input, same key. */
  retryRegister(): Promise<RegisterStepResult>;
  /** F12: asks for a new code for the same phone. A success replaces the challenge. */
  resend(): Promise<AuthResult<OtpIssued>>;
  /** The person left the flow: wipes everything and makes every answer on its way stale. The session, if any, is untouched. */
  cancel(): void;
}

interface State {
  readonly form: RegisterForm;
  challenge: OtpIssued;
  proof: string | undefined;
  stage: 'otp' | 'register' | 'failed';
  failure: FailureCode | undefined;
  busy: boolean;
}

// Codes that end this flow for good: the proof or the phone cannot be used again, so retrying the same request is pointless.
const IN_PROGRESS_RESULT: RegisterStepResult = { kind: 'failure', where: 'verify', code: 'IN_PROGRESS', unresolved: false };

export interface RegisterControllerOptions {
  readonly auth: AuthClient;
  readonly flows: FlowStore;
  readonly consent: ConsentOffer;
  readonly now?: () => number;
}

export function createRegisterController(options: RegisterControllerOptions): RegisterController {
  const { auth, flows, consent } = options;
  const now = options.now ?? ((): number => Date.now());
  let state: State | undefined;
  let beginRun: { readonly phone: string; readonly promise: Promise<AuthResult<OtpIssued>> } | undefined;

  const wipe = (): void => {
    state = undefined;
    beginRun = undefined;
    flows.end(REGISTER_FLOW);
  };

  const cancel = (): void => {
    auth.resetRegisterFlow();
    wipe();
  };

  const view = (): RegisterView | undefined =>
    state === undefined
      ? undefined
      : {
          phone: state.form.phone,
          challenge: state.challenge,
          stage: state.stage,
          busy: state.busy,
          ...(state.failure === undefined ? {} : { failure: { code: state.failure } }),
        };

  function begin(form: RegisterForm): Promise<AuthResult<OtpIssued>> {
    const phone = form.phone.trim();
    if (beginRun?.phone === phone && state === undefined) {
      return beginRun.promise;
    }
    // A new start replaces whatever the previous one left (an old challenge, a proof, an answer on its way).
    auth.resetRegisterFlow();
    wipe();
    const promise = auth.requestRegisterOtp({ phone }).then((result): AuthResult<OtpIssued> => {
      if (beginRun?.promise !== promise) {
        // Left or restarted while the request was on its way.
        return { kind: 'stale' };
      }
      beginRun = undefined;
      if (result.kind === 'ok') {
        state = { form: { fullName: form.fullName, phone, password: form.password }, challenge: result.value, proof: undefined, stage: 'otp', failure: undefined, busy: false };
        flows.start(REGISTER_FLOW, { phone });
      }
      return result;
    });
    beginRun = { phone, promise };
    return promise;
  }

  async function register(current: State): Promise<RegisterStepResult> {
    if (current.proof === undefined) {
      return { kind: 'failure', where: 'register', code: 'UNKNOWN', unresolved: false };
    }
    current.busy = true;
    const result = await auth.register({
      phone: current.form.phone,
      password: current.form.password,
      verificationToken: current.proof,
      fullName: current.form.fullName,
      consent: { termsVersion: consent.termsVersion, privacyVersion: consent.privacyVersion },
    });
    if (state !== current) {
      // The flow was left (or restarted) while this ran: nothing of it may show or stay.
      return { kind: 'stale' };
    }
    current.busy = false;
    if (result.kind === 'stale') {
      return { kind: 'stale' };
    }
    if (result.kind === 'ok') {
      // Account created and session established by the adapter. The flow data goes; the session stays.
      wipe();
      return { kind: 'ok', value: result.value };
    }
    if (!result.unresolved) {
      current.stage = 'failed';
      current.failure = result.code;
      // The proof is spent or refused: it is never sent again.
      current.proof = undefined;
    }
    return { kind: 'failure', where: 'register', code: result.code, unresolved: result.unresolved, ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
  }

  async function verify(code: string): Promise<RegisterStepResult> {
    const current = state;
    if (current === undefined) {
      return { kind: 'stale' };
    }
    if (current.busy || current.stage !== 'otp') {
      return IN_PROGRESS_RESULT;
    }
    current.busy = true;
    const challenge = current.challenge;
    const result = await auth.verifyRegisterOtp({ verificationId: challenge.verificationId, code });
    if (state !== current || current.challenge !== challenge) {
      return { kind: 'stale' };
    }
    if (result.kind === 'stale') {
      current.busy = false;
      return { kind: 'stale' };
    }
    if (result.kind === 'failure') {
      current.busy = false;
      return { kind: 'failure', where: 'verify', code: result.code, unresolved: false, ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
    }
    current.proof = result.value.verificationToken;
    current.stage = 'register';
    return register(current);
  }

  async function retryRegister(): Promise<RegisterStepResult> {
    const current = state;
    if (current === undefined) {
      return { kind: 'stale' };
    }
    if (current.busy || current.stage !== 'register') {
      return IN_PROGRESS_RESULT;
    }
    return register(current);
  }

  async function resend(): Promise<AuthResult<OtpIssued>> {
    const current = state;
    if (current === undefined) {
      return { kind: 'stale' };
    }
    if (current.busy || current.stage !== 'otp') {
      return { kind: 'failure', code: 'IN_PROGRESS', unresolved: false };
    }
    current.busy = true;
    const result = await auth.requestRegisterOtp({ phone: current.form.phone });
    if (state !== current) {
      return { kind: 'stale' };
    }
    current.busy = false;
    if (result.kind === 'ok') {
      current.challenge = result.value;
    } else if (result.kind === 'failure' && result.code === 'RATE_LIMITED' && result.retryAfterSeconds !== undefined) {
      // The server said when; "send again" waits for that and for nothing else. Without Retry-After nothing is invented.
      current.challenge = { ...current.challenge, resendAtMs: Math.max(current.challenge.resendAtMs, deadlineAfter(now(), result.retryAfterSeconds)) };
    }
    return result;
  }

  return { consent, begin, view, verify, retryRegister, resend, cancel };
}
