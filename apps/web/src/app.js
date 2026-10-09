// Application controller: owns the screen state, the session flows and the router. Screens never call each other;
// they ask the controller (ctx) to move. The route is ALWAYS derived from a fresh GET /v1/auth/me projection
// (core/projection.js decideRoute): the client never adds a role or a status by itself.

import { describeFailure, ERROR_COPY, isSessionFailure } from './api/errors.js';
import { decideRoute, maskPhone, parseLogin, parseMe } from './core/projection.js';
import { SESSION_STATES } from './core/session.js';
import { uuidv4 } from './core/uuid.js';
import { Alert, Button } from './ui/components.js';
import { clear, confirmDialog, createAnnouncer, h } from './ui/dom.js';
import { renderDriverHome, renderShopHome } from './screens/home.js';
import { renderLogin } from './screens/login.js';
import { renderOnboardingHub } from './screens/onboarding-hub.js';
import { renderDriverOnboarding } from './screens/driver-onboarding.js';
import { renderRoleSelect } from './screens/role-select.js';
import { renderShopOnboarding } from './screens/shop-onboarding.js';
import { renderRefusal, renderResolving, renderUnsupported } from './screens/status.js';

const SCREENS = Object.freeze({
  login: renderLogin,
  resolving: renderResolving,
  'role-select': renderRoleSelect,
  'onboarding-hub': renderOnboardingHub,
  'shop-onboarding': renderShopOnboarding,
  'driver-onboarding': renderDriverOnboarding,
  'shop-home': renderShopHome,
  'driver-home': renderDriverHome,
  unsupported: renderUnsupported,
  refusal: renderRefusal,
});

const ROLE_LABEL = Object.freeze({ SHOP: 'Quán', DRIVER: 'Xế' });

export function createApp({ root, announcerHost, config, api, session, mutations }) {
  const state = { view: 'login', params: {}, me: null, notice: null };
  const announcer = createAnnouncer(announcerHost);
  // One id per page load, never persisted: it only tells the server which browser tab opened the session.
  const deviceId = `web-${uuidv4()}`;
  let renderController = null;

  function takeNotice() {
    const notice = state.notice;
    state.notice = null;
    return notice;
  }

  function wordmark() {
    // TEMPORARY text wordmark: the official logo asset is not in the repository yet (brand guideline section 12), and
    // the logo must not be re-drawn or re-typeset. Replace this element with the official SVG when the asset lands.
    return h('p', { class: 'wordmark', 'aria-label': '11Ship', 'data-temp-wordmark': 'true' }, '11Ship');
  }

  function authLayout(screen) {
    return h(
      'div',
      { class: 'auth-layout' },
      h(
        'aside',
        { class: 'brand-panel' },
        wordmark(),
        h('p', { class: 'tagline' }, 'Gọi là có'),
        h('p', { class: 'brand-copy' }, 'Ứng dụng giao hàng cho Quán và Xế.'),
      ),
      h('main', { id: 'main', class: 'auth-main' }, screen.el),
    );
  }

  function appLayout(screen) {
    const me = state.me;
    const roleText = me === null ? '' : me.activeRole === null ? 'Chưa chọn vai trò' : `Vai trò: ${ROLE_LABEL[me.activeRole] ?? me.activeRole}`;
    const fixtureNote =
      me !== null && me.phoneStatus === 'UNVERIFIED_TEST'
        ? h('p', { class: 'fixture-note', role: 'note' }, 'Tài khoản thử nghiệm — chưa xác minh SĐT')
        : null;
    const clearSession = h('button', { type: 'button', class: 'btn btn-ghost', onClick: confirmClearSession }, 'Xóa phiên trên trình duyệt');
    return h(
      'div',
      { class: 'app-layout' },
      h(
        'header',
        { class: 'app-header' },
        wordmark(),
        h('div', { class: 'user-meta' }, me === null ? null : h('span', { class: 'user-phone' }, maskPhone(me.phone)), roleText ? h('span', { class: 'role-chip' }, roleText) : null),
      ),
      h('main', { id: 'main', class: 'app-main' }, fixtureNote, screen.el),
      h(
        'footer',
        { class: 'app-footer' },
        clearSession,
        h('p', { class: 'help' }, 'Chỉ xóa phiên khỏi trình duyệt này; phiên trên máy chủ chưa bị thu hồi. Bản thử nghiệm chưa có đăng xuất.'),
      ),
    );
  }

  async function confirmClearSession() {
    const confirmed = await confirmDialog({
      title: 'Xóa phiên trên trình duyệt?',
      body: 'Bạn sẽ về màn đăng nhập để dùng tài khoản khác. Phiên trên máy chủ chưa bị thu hồi và còn hiệu lực đến khi hết hạn.',
      confirmLabel: 'Xóa phiên',
    });
    if (confirmed) {
      signOutLocal({ tone: 'info', message: 'Đã xóa phiên khỏi trình duyệt này.' });
    }
  }

  function render() {
    if (renderController !== null) {
      renderController.abort();
    }
    renderController = new AbortController();
    const screenCtx = { ...ctx, signal: renderController.signal };
    let screen;
    try {
      screen = SCREENS[state.view](screenCtx);
    } catch {
      screen = {
        title: 'Có lỗi hiển thị',
        layout: 'auth',
        el: h(
          'section',
          { class: 'card card-auth' },
          h('h1', { class: 'h1', tabindex: '-1' }, 'Có lỗi hiển thị'),
          Alert({ tone: 'danger', message: 'Màn hình này không hiển thị được. Tải lại trang rồi đăng nhập lại.' }),
          Button({ label: 'Tải lại trang', onClick: () => window.location.reload() }),
        ),
      };
    }
    clear(root);
    root.append(screen.layout === 'app' ? appLayout(screen) : authLayout(screen));
    document.title = `${screen.title} · 11Ship`;
    const heading = root.querySelector('main h1');
    if (heading instanceof HTMLElement) {
      heading.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  }

  function go(view, params = {}) {
    state.view = view;
    state.params = params;
    render();
  }

  function route() {
    if (state.me === null) {
      go('login');
      return;
    }
    const decision = decideRoute(state.me);
    go(decision.view, decision.view === 'unsupported' ? { failure: null } : {});
  }

  function signOutLocal(notice) {
    session.clear();
    mutations.clearAll();
    state.me = null;
    state.notice = notice ?? null;
    go('login');
  }

  /**
   * Central reaction to a failed result: 'stale' (ignore), 'session_ended' (back to login), 'disabled' (typed refusal)
   * or null (the caller shows the error itself). A stale answer never clears a newer session.
   */
  function handleFailure(result) {
    if (result.ok) {
      return null;
    }
    if (result.stale) {
      return 'stale';
    }
    if (isSessionFailure(result)) {
      signOutLocal({ tone: 'warning', message: describeFailure(result).message });
      return 'session_ended';
    }
    if (result.kind === 'http' && result.code === 'ACCOUNT_DISABLED') {
      go('refusal', { failure: result });
      return 'disabled';
    }
    return null;
  }

  /** GET /v1/auth/me -> state.me. Result flags: stale (ignore), handled (the app already navigated), ok / result. */
  async function refreshMe() {
    const result = await api.request({ method: 'GET', path: '/auth/me' });
    if (result.stale) {
      return { ok: false, stale: true, handled: false };
    }
    if (!result.ok) {
      const handled = handleFailure(result);
      return { ok: false, result, stale: false, handled: handled !== null };
    }
    const me = parseMe(result.data);
    if (me === null) {
      return { ok: false, result: { ok: false, kind: 'invalid_response', status: result.status, requestId: result.requestId }, stale: false, handled: false };
    }
    state.me = me;
    return { ok: true, me, stale: false, handled: false };
  }

  async function resolveAndRoute() {
    if (state.view !== 'resolving') {
      go('resolving');
    }
    const fresh = await refreshMe();
    if (fresh.stale || fresh.handled) {
      return;
    }
    if (!fresh.ok) {
      go('unsupported', { failure: fresh.result });
      return;
    }
    route();
  }

  /** Home screens bootstrap the projection first; a role that is no longer effective routes elsewhere. */
  async function refreshMeForHome(role) {
    const fresh = await refreshMe();
    if (fresh.stale || fresh.handled) {
      return { redirected: true };
    }
    if (!fresh.ok) {
      return { ok: false, result: fresh.result };
    }
    const decision = decideRoute(fresh.me);
    if (decision.view !== (role === 'SHOP' ? 'shop-home' : 'driver-home')) {
      route();
      return { redirected: true };
    }
    return { ok: true, me: fresh.me };
  }

  async function signIn(values) {
    session.setState(SESSION_STATES.AUTHENTICATING);
    const result = await api.request({
      method: 'POST',
      path: '/auth/login',
      auth: false,
      body: { phone: values.phone, password: values.password, device: { device_id: deviceId, platform: 'WEB', app: 'SHIP_WEB' } },
    });
    if (result.stale) {
      return { stale: true };
    }
    if (!result.ok) {
      session.setState(SESSION_STATES.SIGNED_OUT);
      if (result.kind === 'http' && result.code === 'ACCOUNT_DISABLED') {
        go('refusal', { failure: result });
        return { handled: true };
      }
      return result;
    }
    const login = parseLogin(result.data);
    if (login === null) {
      session.setState(SESSION_STATES.SIGNED_OUT);
      return { ok: false, kind: 'invalid_response', status: result.status, requestId: result.requestId, stale: false };
    }
    mutations.clearAll();
    state.me = null;
    session.setToken(login.accessToken);
    await resolveAndRoute();
    session.setState(state.me === null ? SESSION_STATES.SIGNED_OUT : SESSION_STATES.READY);
    return { handled: true };
  }

  async function selectRole(role) {
    const result = await api.request({ method: 'POST', path: '/auth/role/select', body: { role } });
    if (result.stale) {
      return { stale: true };
    }
    if (!result.ok) {
      const handled = handleFailure(result);
      if (handled === 'stale') {
        return { stale: true };
      }
      if (handled !== null) {
        return { handled: true };
      }
      if (result.kind === 'http' && result.code === 'ROLE_NOT_AVAILABLE') {
        const fresh = await refreshMe();
        if (fresh.stale || fresh.handled) {
          return { handled: true };
        }
        if (fresh.ok) {
          route();
          announcer.toast(ERROR_COPY.ROLE_NOT_AVAILABLE, 'warning');
          return { handled: true };
        }
      }
      return result;
    }
    // The role context changed: answers still in flight from before are stale from now on.
    session.bumpGeneration();
    const fresh = await refreshMe();
    if (fresh.stale || fresh.handled) {
      return { handled: true };
    }
    if (!fresh.ok) {
      go('unsupported', { failure: fresh.result });
      return { handled: true };
    }
    route();
    return { handled: true, ok: true };
  }

  const ctx = {
    state,
    config,
    api,
    session,
    mutations,
    go,
    route,
    resolveAndRoute,
    refreshMe,
    refreshMeForHome,
    handleFailure,
    signIn,
    selectRole,
    signOutLocal,
    takeNotice,
    announce: (message) => announcer.say(message),
    startRoleSwitch: () => go('role-select'),
    cancelRoleSwitch: () => route(),
  };

  return {
    start() {
      go('login');
    },
    state,
    ctx,
  };
}
