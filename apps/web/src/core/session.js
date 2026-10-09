// The session lives only in memory of this tab (task FE0 section 3): no localStorage, sessionStorage, IndexedDB or
// cookie, and never in a URL. Reloading or closing the tab signs the user out of the browser (the server session
// stays valid until its absolute TTL ends; this build has no logout endpoint to call).
//
// `generation` increases on every change of token or role context. A request remembers the generation it was sent
// under; a response that belongs to an older generation is stale and must not change state, route or clear the token.

export const SESSION_STATES = Object.freeze({
  SIGNED_OUT: 'SIGNED_OUT',
  AUTHENTICATING: 'AUTHENTICATING',
  RESOLVING: 'RESOLVING',
  READY: 'READY',
});

export function createSession() {
  let token = null;
  let generation = 0;
  let state = SESSION_STATES.SIGNED_OUT;
  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener({ state, generation, signedIn: token !== null });
    }
  }

  return {
    get token() {
      return token;
    },
    get generation() {
      return generation;
    },
    get state() {
      return state;
    },
    setState(next) {
      if (!Object.hasOwn(SESSION_STATES, next)) {
        throw new Error('SESSION_STATE_INVALID');
      }
      state = next;
      emit();
    },
    /** A new token: the generation moves, so everything sent before is stale. */
    setToken(value) {
      if (typeof value !== 'string' || value === '') {
        throw new Error('SESSION_TOKEN_INVALID');
      }
      token = value;
      generation += 1;
      state = SESSION_STATES.RESOLVING;
      emit();
    },
    /** The role context changed (role selected, onboarding finished): in-flight answers are stale. */
    bumpGeneration() {
      generation += 1;
      emit();
    },
    /** Forget the token in this tab. Does not revoke anything on the server. */
    clear() {
      token = null;
      generation += 1;
      state = SESSION_STATES.SIGNED_OUT;
      emit();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
