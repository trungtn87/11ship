import { ScreenEnv } from '../screen.js';
import { STATE_COPY } from '../states.js';

/**
 * Connected logout (S19 / F18 "Đăng xuất"). The local session is dropped first, whatever the network does; the notice says the
 * server revoked it ONLY when it answered 204. Offline or any other answer is told as "cleared on this device, not confirmed".
 */
export async function signOutLive(env: ScreenEnv, after: string): Promise<void> {
  if (env.signOut === undefined) {
    return;
  }
  const result = await env.signOut();
  env.toast(result.serverRevoked || !result.hadSession ? STATE_COPY.loggedOut : STATE_COPY.loggedOutUnconfirmed);
  env.go(after);
}
