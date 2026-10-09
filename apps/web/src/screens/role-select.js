import { describeDriver, selectableRoles } from '../core/projection.js';
import { Alert, Badge, Card, Heading } from '../ui/components.js';
import { h } from '../ui/dom.js';
import { failureAlert, replaceContent } from './shared.js';
import { profilePanel } from './profile-panel.js';

const ROLE_COPY = Object.freeze({
  SHOP: {
    title: 'Quán',
    description: 'Vào với tư cách chủ quán.',
    note: 'Chỉ một phiên Quán hoạt động cùng lúc: chọn vai trò này sẽ thoát phiên Quán đang mở ở thiết bị khác (nếu có).',
  },
  DRIVER: {
    title: 'Xế',
    description: 'Vào với tư cách xế giao hàng.',
    note: null,
  },
});

export function renderRoleSelect(ctx) {
  const me = ctx.state.me;
  const roles = selectableRoles(me);
  const alertHost = h('div', { class: 'form-alert' });
  let busyRole = null;
  const cards = new Map();

  function setBusy(role) {
    busyRole = role;
    for (const [name, card] of cards) {
      card.setAttribute('aria-disabled', role !== null ? 'true' : 'false');
      card.classList.toggle('is-loading', name === role);
      card.setAttribute('aria-busy', name === role ? 'true' : 'false');
    }
  }

  async function choose(role) {
    if (busyRole !== null) {
      return;
    }
    replaceContent(alertHost);
    setBusy(role);
    const result = await ctx.selectRole(role);
    if (result.stale || result.handled) {
      return;
    }
    if (!result.ok) {
      setBusy(null);
      replaceContent(alertHost, failureAlert(result));
    }
    // On success the app already routed to the next screen.
  }

  for (const role of roles) {
    const copy = ROLE_COPY[role];
    const statusBadge = role === 'DRIVER' ? describeDriver(me) : null;
    const card = h(
      'button',
      { type: 'button', class: 'role-card', onClick: () => choose(role) },
      h('span', { class: 'role-card-title' }, copy.title),
      h('span', { class: 'role-card-desc' }, copy.description),
      statusBadge ? Badge({ tone: statusBadge.tone, label: statusBadge.label }) : null,
      copy.note ? h('span', { class: 'help' }, copy.note) : null,
    );
    cards.set(role, card);
  }

  const switching = me.activeRole !== null;
  const panel = profilePanel(ctx);
  const el = Card({
    className: 'card-wide',
    children: [
      Heading({ text: 'Chọn vai trò' }),
      h('p', { class: 'lead' }, switching ? 'Chọn vai trò bạn muốn dùng. Vai trò hiện tại vẫn giữ nếu bạn quay lại.' : 'Tài khoản này dùng được nhiều vai trò. Bạn muốn vào với vai trò nào?'),
      alertHost,
      h('div', { class: 'role-grid' }, [...cards.values()]),
      switching ? h('button', { type: 'button', class: 'btn btn-ghost', onClick: () => ctx.cancelRoleSwitch() }, 'Quay lại') : null,
      panel.hasAction ? h('div', { class: 'section' }, h('h2', { class: 'h2' }, 'Hồ sơ của bạn'), panel.el) : null,
    ],
  });
  return { title: 'Chọn vai trò', el, layout: 'app' };
}

export function roleSelectUnavailable() {
  return Alert({ tone: 'warning', message: 'Không có vai trò nào để chọn.' });
}
