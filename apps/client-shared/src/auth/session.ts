import { AuthIdentity } from './contract.js';

// The signed-in state of one app, in MEMORY only: this module has no storage of any kind, so a reload (F5) starts signed out
// by design. The bearer token is readable only through `bearer()`, which the transport layer of this folder uses; the
// screens read the identity, never the token.
//
// GENERATION. Every change of who is signed in (a sign-in, a sign-out, a session the server called invalid) moves the
// generation forward. A request notes the generation when it STARTS (a ticket); when its response arrives the ticket must
// still be current, otherwise the response is stale and is dropped without touching the state. That one rule is what stops
//   - a late sign-in response from bringing a session back after a sign-out,
//   - a late answer for an old session from replacing the identity of a newer one,
//   - a late "session expired" for an old token from signing a new session out.

export interface SessionTicket {
  readonly generation: number;
}

export type SessionState =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'authenticated'; readonly identity: AuthIdentity; readonly expiresAtMs: number };

export type SessionListener = (state: SessionState) => void;

export class SessionStore {
  #generation = 0;
  #token: string | undefined;
  #identity: AuthIdentity | undefined;
  #expiresAtMs = 0;
  readonly #listeners = new Set<SessionListener>();
  readonly #inflight = new Set<AbortController>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  /** The ticket a request takes when it starts. */
  ticket(): SessionTicket {
    return { generation: this.#generation };
  }

  isCurrent(ticket: SessionTicket): boolean {
    return ticket.generation === this.#generation;
  }

  state(): SessionState {
    this.#expireIfDue();
    return this.#identity === undefined ? { kind: 'anonymous' } : { kind: 'authenticated', identity: this.#identity, expiresAtMs: this.#expiresAtMs };
  }

  identity(): AuthIdentity | undefined {
    this.#expireIfDue();
    return this.#identity;
  }

  /** Transport use only. Undefined when signed out or when the absolute expiry the server reported has passed. */
  bearer(): string | undefined {
    this.#expireIfDue();
    return this.#token;
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Aborts when the session changes: authenticated calls register here so a sign-out ends them. */
  track(controller: AbortController): () => void {
    this.#inflight.add(controller);
    return () => {
      this.#inflight.delete(controller);
    };
  }

  /** A sign-in result. Applied only if nothing about the session changed since the request started. */
  establish(ticket: SessionTicket, token: string, identity: AuthIdentity, expiresAtMs: number): boolean {
    if (!this.isCurrent(ticket)) {
      return false;
    }
    this.#advance();
    this.#token = token;
    this.#identity = identity;
    this.#expiresAtMs = expiresAtMs;
    this.#emit();
    return true;
  }

  /** A fresh identity of the SAME session (me, context). Stale or signed-out calls change nothing. */
  refresh(ticket: SessionTicket, identity: AuthIdentity, expiresAtMs: number): boolean {
    if (!this.isCurrent(ticket) || this.#token === undefined) {
      return false;
    }
    this.#identity = identity;
    this.#expiresAtMs = expiresAtMs;
    this.#emit();
    return true;
  }

  /** The server reported this person's own profile (read, or after a save): the shown name and version follow it. Stale or signed-out calls change nothing. */
  updateProfile(ticket: SessionTicket, fullName: string, version: number): boolean {
    if (!this.isCurrent(ticket) || this.#token === undefined || this.#identity === undefined) {
      return false;
    }
    this.#identity = { ...this.#identity, profile: { fullName, version } };
    this.#emit();
    return true;
  }

  /** The server called THIS session invalid. Clears only if the ticket is still current, so an old answer cannot end a newer session. */
  invalidate(ticket: SessionTicket): boolean {
    if (!this.isCurrent(ticket)) {
      return false;
    }
    this.clear();
    return true;
  }

  /** Sign-out and every other end of a session: token and personal data are dropped and running authenticated calls are cancelled. */
  clear(): void {
    this.#advance();
    this.#token = undefined;
    this.#identity = undefined;
    this.#expiresAtMs = 0;
    for (const controller of [...this.#inflight]) {
      controller.abort();
    }
    this.#inflight.clear();
    this.#emit();
  }

  #expireIfDue(): void {
    if (this.#token !== undefined && this.#now() >= this.#expiresAtMs) {
      this.clear();
    }
  }

  #advance(): void {
    this.#generation += 1;
  }

  #emit(): void {
    const state: SessionState = this.#identity === undefined ? { kind: 'anonymous' } : { kind: 'authenticated', identity: this.#identity, expiresAtMs: this.#expiresAtMs };
    for (const listener of [...this.#listeners]) {
      listener(state);
    }
  }
}

/** The same idea for a multi-step flow (the register OTP flow): restarting or leaving it makes every earlier response stale. */
export class FlowGeneration {
  #generation = 0;
  ticket(): SessionTicket {
    return { generation: this.#generation };
  }
  isCurrent(ticket: SessionTicket): boolean {
    return ticket.generation === this.#generation;
  }
  reset(): void {
    this.#generation += 1;
  }
}
