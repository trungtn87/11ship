import { ACTIVATION_BASE, AdminActivationApi } from '../core/activation-api.js';
import { ActivationController } from '../core/activation-controller.js';
import { AdminAuthApi, fetchTransport } from '../core/api.js';
import { AdminAuthController, Clock } from '../core/controller.js';
import { AdminProvisioningApi, PROVISIONING_BASE } from '../core/provisioning-api.js';
import { ProvisioningController } from '../core/provisioning-controller.js';
import { parseRoute, tokenFromFragment } from '../core/routes.js';
import { ActivationPage } from './activation-view.js';
import { ShellApp } from './shell-app.js';
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

const root = document.getElementById('app');

function startActivation(host: HTMLElement): void {
  // The invitation token is in the URL fragment. It is read once and removed from the address bar BEFORE any request, so
  // it is not left in the history entry, a copied address or a screenshot of the bar. It is never stored.
  const hash = window.location.hash;
  const token = tokenFromFragment(hash);
  window.history.replaceState(null, '', '/activate');
  const controller = new ActivationController(new AdminActivationApi(fetchTransport(window.fetch.bind(window), { base: ACTIVATION_BASE })), clock);
  const page = new ActivationPage(host, controller);
  controller.subscribe((screen) => page.render(screen));
  page.render(controller.screen);
  if (hash !== '' && token === undefined) {
    controller.rejectLink();
    return;
  }
  void controller.begin(token);
}

function startAdmin(host: HTMLElement): void {
  let cachedDeviceId: string | undefined;
  const api = new AdminAuthApi(fetchTransport(window.fetch.bind(window)));
  const controller = new AdminAuthController(api, clock, () => (cachedDeviceId ??= deviceId()));
  const provisioning = new ProvisioningController(
    new AdminProvisioningApi(fetchTransport(window.fetch.bind(window), { base: PROVISIONING_BASE })),
    { csrf: () => controller.sessionCsrf, lost: () => controller.sessionLost(), refresh: () => controller.refreshSession() },
    clock,
    () => window.crypto.randomUUID(),
  );
  const shell = new ShellApp(
    provisioning,
    {
      pathname: () => window.location.pathname,
      search: () => window.location.search,
      push: (path) => window.history.pushState(null, '', path),
      onPop: (listener) => {
        window.addEventListener('popstate', listener);
        return () => window.removeEventListener('popstate', listener);
      },
    },
    clock,
  );
  const view = new AdminView(host, controller, shell);
  controller.subscribe((screen) => view.render(screen));
  view.render(controller.screen);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void controller.recheck();
    }
  });
  void controller.start();
}

if (root !== null) {
  if (parseRoute(window.location.pathname).name === 'activate') {
    startActivation(root);
  } else {
    startAdmin(root);
  }
}
