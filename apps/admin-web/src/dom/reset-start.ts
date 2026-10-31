import { fetchTransport } from '../core/api.js';
import { AdminRecoveryApi, RECOVERY_BASE } from '../core/recovery-api.js';
import { RecoveryController } from '../core/recovery-controller.js';
import { ResetPage } from './reset-view.js';

/**
 * The public "forgot password" page of an ADMIN (M01-RESET, issue #102): the server's mode decides (GET /config); phone -> SMS code ->
 * new password. Closed or unknown mode: no form, nothing is sent. The same flow serves the Web Admin (`/reset`, back to `/`) and the
 * Mini Business PWA (`/business/reset`, back to `/business/`, issue #235): `loginHref` is the only difference, so the page never
 * sends a standalone PWA outside its scope and never ends on the other app's login. SYSTEM is refused by the server, as before.
 */
export function startReset(host: HTMLElement, loginHref: string): void {
  const controller = new RecoveryController(new AdminRecoveryApi(fetchTransport(window.fetch.bind(window), { base: RECOVERY_BASE })), () => window.crypto.randomUUID());
  const page = new ResetPage(host, {
    wired: true,
    loginHref,
    retryConfig: () => void controller.start(),
    sendCode: (phone) => void controller.sendCode(phone),
    verify: (code) => void controller.verify(code),
    // "Gửi lại mã" asks again for the number the code was requested for (the controller keeps it).
    resend: () => void controller.resend(),
    setPassword: (password) => void controller.setPassword(password),
    toLogin: () => {
      controller.leave();
      window.location.assign(loginHref);
    },
  });
  controller.subscribe((screen) => page.render(screen));
  page.render(controller.screen);
  void controller.start();
}
