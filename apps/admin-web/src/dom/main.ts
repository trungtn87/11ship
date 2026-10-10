import { AdminAuthApi, fetchTransport } from '../core/api.js';
import { AdminAuthController, Clock } from '../core/controller.js';
import { AdminView } from './view.js';

// Entry point of the administration web. Nothing here stores a credential: the session and the step are HttpOnly
// cookies set by the backend, and the CSRF token stays in the controller's memory.

const DEVICE_KEY = '11admin.device_id';

/**
 * The login body needs a device id (backend parser: [A-Za-z0-9._:-]{1,128}). It is a random label that proves nothing
 * and carries no right; it is kept in localStorage only so the same browser sends the same label. If storage is not
 * available a per-page value is used.
 */
function deviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_KEY);
    if (stored !== null && /^web-[0-9a-f]{32}$/.test(stored)) {
      return stored;
    }
  } catch {
    // storage blocked: fall through
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const value = `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  try {
    window.localStorage.setItem(DEVICE_KEY, value);
  } catch {
    // not kept; fine
  }
  return value;
}

const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
};

let cachedDeviceId: string | undefined;
const api = new AdminAuthApi(fetchTransport(window.fetch.bind(window)));
const controller = new AdminAuthController(api, clock, () => (cachedDeviceId ??= deviceId()));

const root = document.getElementById('app');
if (root !== null) {
  const view = new AdminView(root, controller);
  controller.subscribe((screen) => view.render(screen));
  view.render(controller.screen);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void controller.recheck();
    }
  });
  void controller.start();
}
