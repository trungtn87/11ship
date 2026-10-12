import { AuthClient, AuthResult, DriverSubmitInput, DriverView } from './auth/client.js';
import { FailureCode } from './states.js';

// The 11Ship driver profile (S12 submit -> S13 status) as ONE in-memory object.
//
// What it holds, in memory only (never the URL, history, any storage or a log): the driver profile the server last reported for the
// person signed in (or `null` = none), and whether it was read for this visit.
//
// Rules this object enforces (the screens only display its state and send intents):
// * The server decides. The profile is created only by POST /v1/onboarding/driver and shown only as GET /v1/driver/me reports it. This
//   object grants no role, selects no context (CUSTOMER stays) and never invents a status, a type or a reason.
// * There is no edit API: an existing profile is only read. Submit is offered only when the server said there is no profile.
// * Submit is ONE intent: an unknown outcome keeps the key and the exact body in the adapter, and the person's next press with the SAME
//   input re-sends them. Nothing retries on its own.
// * After a successful submit the identity is refreshed (`me`) and the profile is read again: S13 shows what the server holds.
// * DRIVER_EXISTS (another device/tab got there first) is answered by reading the own profile, never by creating again.

export type FailedStep = { readonly kind: 'failure'; readonly code: FailureCode; readonly retryAfterSeconds?: number; readonly unresolved: boolean };
export type DriverStep = { readonly kind: 'ok' } | FailedStep | { readonly kind: 'stale' };
export type DriverSubmitStep = { readonly kind: 'ok'; readonly identityRefreshed: boolean; readonly profileRead: boolean } | FailedStep | { readonly kind: 'stale' };

export interface DriverState {
  /** The own profile was read for this visit. */
  readonly loaded: boolean;
  /** The profile as the server holds it, or null (none yet). Meaningless until `loaded`. */
  readonly profile: DriverView | null;
}

export interface DriverController {
  state(): DriverState;
  /** Reads the own profile. Without `force`, an already loaded visit is kept. */
  load(options?: { readonly force?: boolean }): Promise<DriverStep>;
  /** Sends the profile (only while the server says there is none), then refreshes the identity and reads the profile. */
  submit(input: DriverSubmitInput): Promise<DriverSubmitStep>;
  /** The person left the screens: what was read is dropped and the next visit asks the server again. */
  discard(): void;
  /** Everything goes (sign-out, another person). Answers still on their way become stale. */
  reset(): void;
}

const failed = (answer: Extract<AuthResult<unknown>, { kind: 'failure' }>): FailedStep =>
  answer.retryAfterSeconds === undefined ? { kind: 'failure', code: answer.code, unresolved: answer.unresolved } : { kind: 'failure', code: answer.code, unresolved: answer.unresolved, retryAfterSeconds: answer.retryAfterSeconds };

export function createDriverController(options: { readonly auth: AuthClient }): DriverController {
  const { auth } = options;
  let epoch = 0;
  let loaded = false;
  let profile: DriverView | null = null;
  let loadRun: Promise<DriverStep> | undefined;

  const reset = (): void => {
    epoch += 1;
    loaded = false;
    profile = null;
    loadRun = undefined;
  };

  // The data belongs to the person signed in: sign-out, expiry or another person's sign-in drops it all.
  let owner = auth.session.identity()?.userId;
  auth.session.subscribe(() => {
    const now = auth.session.identity()?.userId;
    if (now !== owner) {
      owner = now;
      reset();
    }
  });

  function load(loadOptions: { readonly force?: boolean } = {}): Promise<DriverStep> {
    if (loaded && loadOptions.force !== true) {
      return Promise.resolve({ kind: 'ok' });
    }
    if (loadRun !== undefined) {
      return loadRun;
    }
    const mine = epoch;
    const run: Promise<DriverStep> = (async (): Promise<DriverStep> => {
      const answer = await auth.readDriver();
      if (mine !== epoch || answer.kind === 'stale') {
        return { kind: 'stale' };
      }
      if (answer.kind === 'failure') {
        return failed(answer);
      }
      profile = answer.value;
      loaded = true;
      return { kind: 'ok' };
    })().finally(() => {
      if (loadRun === run) {
        loadRun = undefined;
      }
    });
    loadRun = run;
    return run;
  }

  async function submit(input: DriverSubmitInput): Promise<DriverSubmitStep> {
    if (loaded && profile !== null) {
      // There is no edit API and the server refuses a second profile: do not even ask.
      return { kind: 'failure', code: 'DRIVER_EXISTS', unresolved: false };
    }
    const mine = epoch;
    const answer = await auth.submitDriver(input);
    if (mine !== epoch || answer.kind === 'stale') {
      return { kind: 'stale' };
    }
    if (answer.kind === 'failure') {
      if (answer.code === 'DRIVER_EXISTS') {
        // Someone (another tab or device) already sent it: show what the server holds.
        await load({ force: true });
      }
      return failed(answer);
    }
    // Sent. The identity the server reports now includes the driver state; the profile is what S13 shows.
    const me = await auth.me();
    if (mine !== epoch || me.kind === 'stale') {
      return { kind: 'stale' };
    }
    const read = await load({ force: true });
    if (read.kind === 'stale') {
      return { kind: 'stale' };
    }
    return { kind: 'ok', identityRefreshed: me.kind === 'ok', profileRead: read.kind === 'ok' };
  }

  return {
    state: () => ({ loaded, profile }),
    load,
    submit,
    discard: reset,
    reset,
  };
}
