import { createApp } from './app.js';
import { createApiClient } from './api/client.js';
import { readConfig } from './core/config.js';
import { createMutationCoordinator } from './core/mutation.js';
import { createSession } from './core/session.js';
import { uuidv4 } from './core/uuid.js';
import { h } from './ui/dom.js';

const root = document.getElementById('app');
const announcerHost = document.getElementById('announcer');

function showFatal(message) {
  root.replaceChildren(
    h('main', { id: 'main', class: 'auth-main' }, h('section', { class: 'card card-auth' }, h('h1', { class: 'h1' }, 'Không khởi động được'), h('p', { class: 'alert alert-danger' }, message))),
  );
}

let config;
try {
  config = readConfig(window.SHIP_WEB_CONFIG);
} catch {
  showFatal('Cấu hình ứng dụng chưa hợp lệ. Báo cho đội kỹ thuật.');
  throw new Error('CONFIG_INVALID');
}

document.getElementById('env-label').textContent = config.environmentLabel;

const session = createSession();
const api = createApiClient({ baseUrl: config.apiBaseUrl, timeoutMs: config.requestTimeoutMs, session });
const mutations = createMutationCoordinator({ api, uuid: uuidv4 });
const app = createApp({ root, announcerHost, config, api, session, mutations });
app.start();

// Offline strip: a plain network status, never a reason to hide an error the API returned.
const offline = document.getElementById('offline-banner');
function syncOnline() {
  offline.hidden = navigator.onLine;
}
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
syncOnline();

// The brand font is self-hosted (assets/fonts). If it is not there the page still works with the system font, but it
// must not fall back silently: the fallback is flagged on <html> and logged once (no personal data in the message).
if (document.fonts && document.fonts.load) {
  document.fonts
    .load('16px "Plus Jakarta Sans"')
    .then((faces) => {
      const ok = faces.length > 0;
      document.documentElement.dataset.font = ok ? 'plus-jakarta-sans' : 'fallback';
      if (!ok) {
        console.info('font_fallback: Plus Jakarta Sans asset missing, using system font');
      }
    })
    .catch(() => {
      document.documentElement.dataset.font = 'fallback';
    });
}
