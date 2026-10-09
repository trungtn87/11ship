import { shopMissingConditions } from '../core/projection.js';
import { describeDriver } from '../core/projection.js';
import { Alert, Badge, Button, Card, Heading, Skeleton } from '../ui/components.js';
import { h } from '../ui/dom.js';
import { failureAlert, replaceContent } from './shared.js';

function switchButton(ctx) {
  const me = ctx.state.me;
  const others = me.availableRoles.filter((role) => role !== me.activeRole && (role === 'SHOP' || role === 'DRIVER'));
  return others.length > 0 ? Button({ label: 'Đổi vai trò', variant: 'secondary', onClick: () => ctx.startRoleSwitch() }) : null;
}

/** Home of an effective SHOP role: the saved profile and what is still missing. No order / menu / wallet controls. */
export function renderShopHome(ctx) {
  const host = h('div', { class: 'stack' }, Skeleton({ lines: 4 }));
  const el = Card({
    className: 'card-wide',
    children: [
      Heading({ text: 'Quán của bạn' }),
      host,
      h('p', { class: 'note' }, 'Giờ mở cửa và quản lý quán sẽ có ở bước sau. Bản thử nghiệm này mới có đăng nhập và hồ sơ.'),
      h('div', { class: 'actions' }, switchButton(ctx)),
    ],
  });

  async function load() {
    replaceContent(host, Skeleton({ lines: 4 }));
    const fresh = await ctx.refreshMeForHome('SHOP');
    if (fresh.redirected) {
      return;
    }
    if (!fresh.ok) {
      replaceContent(host, failureAlert(fresh.result, { actions: Button({ label: 'Thử lại', variant: 'secondary', onClick: load }) }));
      return;
    }
    const result = await ctx.api.request({ method: 'GET', path: '/onboarding/shop/profile', signal: ctx.signal });
    if (result.stale || ctx.signal.aborted) {
      return;
    }
    if (!result.ok) {
      if (ctx.handleFailure(result) !== null) {
        return;
      }
      replaceContent(host, failureAlert(result, { actions: Button({ label: 'Thử lại', variant: 'secondary', onClick: load }) }));
      return;
    }
    const profile = result.data;
    if (profile === null || typeof profile !== 'object') {
      replaceContent(host, Alert({ tone: 'warning', message: 'Chưa tìm thấy hồ sơ quán của tài khoản này.' }));
      return;
    }
    const missing = shopMissingConditions(profile);
    replaceContent(
      host,
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'Tên quán'),
        h('dd', null, String(profile.name ?? '')),
        h('dt', null, 'Địa chỉ'),
        h('dd', null, String(profile.address_text ?? '')),
        h('dt', null, 'Trạng thái hồ sơ'),
        h('dd', null, profile.status === 'ACTIVE' ? Badge({ tone: 'success', label: 'Đã hoàn tất' }) : Badge({ tone: 'danger', label: 'Quán đang tạm khóa' })),
      ),
      missing.complete ? null : Alert({ tone: 'warning', message: 'Hồ sơ còn thiếu: ' + missing.items.filter((item) => !item.done).map((item) => item.label).join(', ') + '.' }),
    );
  }

  load();
  return { title: 'Quán của bạn', el, layout: 'app' };
}

/** Home of an effective DRIVER role: only the profile status. No "accept delivery" button exists in this build. */
export function renderDriverHome(ctx) {
  const host = h('div', { class: 'stack' }, Skeleton({ lines: 3 }));
  const el = Card({
    className: 'card-wide',
    children: [
      Heading({ text: 'Xế 11Ship' }),
      host,
      h('p', { class: 'note' }, 'Nhận đơn và thu nhập sẽ có ở bước sau. Bản thử nghiệm này mới có đăng nhập và hồ sơ.'),
      h('div', { class: 'actions' }, switchButton(ctx)),
    ],
  });

  async function load() {
    replaceContent(host, Skeleton({ lines: 3 }));
    const fresh = await ctx.refreshMeForHome('DRIVER');
    if (fresh.redirected) {
      return;
    }
    if (!fresh.ok) {
      replaceContent(host, failureAlert(fresh.result, { actions: Button({ label: 'Thử lại', variant: 'secondary', onClick: load }) }));
      return;
    }
    const status = describeDriver(fresh.me);
    replaceContent(
      host,
      h('dl', { class: 'facts' }, h('dt', null, 'Trạng thái hồ sơ xế'), h('dd', null, Badge({ tone: status.tone, label: status.label }))),
      fresh.me.driver === 'PENDING_APPROVAL'
        ? Alert({ tone: 'warning', message: 'Hồ sơ đang chờ vận hành duyệt. Bạn chưa nhận đơn được cho tới khi được duyệt.' })
        : fresh.me.driver === 'SUSPENDED'
          ? Alert({ tone: 'danger', message: 'Hồ sơ xế đang bị tạm ngưng. Liên hệ đội vận hành 11Ship.' })
          : null,
    );
  }

  load();
  return { title: 'Xế 11Ship', el, layout: 'app' };
}
